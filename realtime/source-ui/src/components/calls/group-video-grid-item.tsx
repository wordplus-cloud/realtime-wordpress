import React, {memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import {CallContext, CallContextInterface, CallParticipant} from "./context.ts";
import {getSpeakerHighlightStyles} from "../../inc/functions.ts";
import {_x} from "../../inc/globals.ts";
import { host } from "../../host.ts";
import Tooltip from "../helpers/tooltip.tsx";
import useStateRef from "../../inc/hooks/state-ref.ts";
import UserName from "../users/user-name.tsx";
import Resizable from "../helpers/resizable.tsx";
import Icon, { IconName } from "../../primitives/icon.tsx";
import { moderates, useModerationActs } from "./moderation.ts";
import { usePictureDrawn } from "../../inc/calls/ratio.ts";
import usePendingActions from "../../inc/calls/pending.ts";
import useHeld, { PAUSED_NOTICE_MS } from "../../inc/hooks/held.ts";
import { Piece } from "../../pieces.tsx";
import { CameraOptimizingNotice, useCameraOptimizing } from "./optimizing.tsx";

/**
 * One person's tile in a group video call: their camera or shared screen (their picture until one comes; the user's
 * own camera shown once a frame of it is drawn), their name, the ring of whoever speaks, microphone and raised hand,
 * "Reconnecting..." while they are briefly away, "Paused: weak connection" over their last frame while the media server
 * holds their video back from this page's download, and a moderator's controls for them (pin, broadcast, microphone,
 * remove, speaker), each spinning until the tile shows what it asked for.
 */
export default memo(function GroupVideoGridItem({ unique_key, participant, width, height, x, y } : {
    unique_key: string,
    participant: CallParticipant,
    width: number,
    height: number,
    x: number,
    y: number
}){
    const itemRef = useRef<HTMLDivElement>(null);

    const {
        connectionState,
        adminMode,
        selectedSpeakerDevice,
        lowerHand,
        callMode,
        promoteParticipant,
        demoteParticipant,
        moderate,
        moderation,
        optimizingMaxMs
    } = useContext<CallContextInterface>( CallContext );

    const [ videoElement, setVideoElement ] = useStateRef<HTMLVideoElement | null>(null);
    const [ audioElement, setAudioElement ] = useState<HTMLAudioElement | null>(null);
    const [ screenElement, setScreenElement ] = useState<HTMLVideoElement | null>(null);

    useEffect(() => {
        if( !! audioElement && audioElement.setSinkId ){
            audioElement.setSinkId(selectedSpeakerDevice);
        }
    }, [ audioElement, selectedSpeakerDevice ]);

    useEffect(() => {
        if( !! screenElement && screenElement.setSinkId ){
            screenElement.setSinkId(selectedSpeakerDevice);
        }
    }, [ screenElement, selectedSpeakerDevice ]);

    useEffect(() => {
        if ( videoElement && !! participant && !! participant.video && ! participant.video.attachedElements.includes(videoElement) ) {
            participant.video.attach(videoElement);
        }
    }, [ videoElement, participant ]);

    useEffect(() => {
        if ( audioElement && !! participant && !! participant.audio && ! participant.audio.attachedElements.includes(audioElement) ) {
            participant.audio.attach(audioElement);
        }
    }, [ audioElement, participant ]);

    useEffect(() => {
        if ( screenElement && !! participant && !! participant.screen && ! participant.screen.attachedElements.includes(screenElement) ) {
            participant.screen.attach(screenElement);

            if ( unique_key !== 'me' && !! participant.screenAudio && ! participant.screenAudio.attachedElements.includes(screenElement) ) {
                participant.screenAudio.attach(screenElement);
            }
        }
    }, [ screenElement, participant ]);

    // The own camera's picture waits for the browser to have drawn a frame of
    // it before it takes the tile's size, as the 1:1 call's own chip does: on
    // a phone, WebKit fits the camera's turned frame only when the picture
    // is resized, and a picture already at its size when the first frame came
    // in stayed about half the tile's width in a black frame (see
    // usePictureDrawn).
    const selfPicture = usePictureDrawn( unique_key === 'me' ? videoElement : null, participant.video );

    const selfPictureClass = unique_key !== 'me' ? undefined : "bm-group-call-self-video"
        + ( selfPicture ? " bm-group-call-self-video--ready" : "" )
        + ( selfPicture === 'counted' ? " bm-group-call-self-video--counted" : "" );

    let className = "bm-group-call-input-video";
    let innerClass = "bm-group-call-input-video-inner";

    if( !! participant.screen ) className += " bm-group-call-input-video-screen";
    if( unique_key === 'me' ) className += " bm-group-call-input-mine";

    let style : React.CSSProperties = {
        width: width + '%',
        height: height + '%',
        top: y + '%',
        left: x + '%'
    }

    let callerInfoStyle : React.CSSProperties = {}

    let innerStyle : React.CSSProperties = {
        backgroundImage: "url('" + participant.avatar + "')"
    };

    if( !! participant.video || !! participant.screen ) {
        delete innerStyle.backgroundImage;
    }

    const accentColor = host().accentColor();

    const speakerHighlight = useMemo(() => {
        return getSpeakerHighlightStyles( participant.isSpeaking, participant.audioLevel, accentColor );
    }, [ accentColor, participant.audioLevel, participant.isSpeaking ]);

    if( speakerHighlight ){
        innerClass += " bm-active-speaker";
        innerStyle['boxShadow'] = speakerHighlight.boxShadow;
    }

    let user_id : number | string = host().currentUserId();

    if( unique_key.startsWith('user_') ){
        // A user of the app: their id of digits as a number, as Better Messages has it, any other id as it is.
        const id = unique_key.substring(5);
        user_id = /^[1-9][0-9]*$/.test( id ) ? Number( id ) : id;
    }

    const { kickUser, muteUser, unmuteUser, muteMic, unmuteMic, pinUser, unpinUser } = useModerationActs( moderate, 'video' );

    // A control waits from the click until the tile shows what it asked for
    // (see pending.ts). One key per slot, so pin and unpin share one: the
    // spinner stays put while the button under it swaps.
    const [ isPending, run ] = usePendingActions(
        [ participant.isPinned, participant.canPublish, participant.micMuted, participant.handRaised ].join( '|' )
    );
    const busy = ( key: string ) => isPending( key ) ? 1 : undefined;
    const glyph = ( key: string, name: IconName ) => isPending( key )
        ? <Icon name="spinner" size={ 14 } className="bm-svg-animate" />
        : <Icon name={ name } size={ 14 } />;

    // Their camera moving to another codec: "Optimizing video quality..." over its last frame until the new one draws,
    // the user's own tile too while theirs moves (the call marks it), rather than their avatar for the gap. Only where
    // the tile shows their camera: a shared screen fills it then, and is never covered for the camera.
    const optimizing = useCameraOptimizing( participant, videoElement, optimizingMaxMs );
    const optimizingShown = optimizing.shown && ! participant.screen && ! participant.reconnecting;

    // A picture the media server paused for this page's download: frozen on its last frame, so the tile says why once
    // it has stayed so for a moment (most pauses end within one, when its guard finds a smaller picture fits).
    const paused = useHeld( unique_key !== 'me' && ! participant.reconnecting && ! optimizingShown
        && ( ( !! participant.video && !! participant.videoPaused ) || ( !! participant.screen && !! participant.screenPaused ) ), PAUSED_NOTICE_MS );

    // Their sound, in the tile's media, and after an app's own tile in its place (pieces.tsx).
    const sound = ( !! participant.audio && unique_key !== 'me' ) &&
        <audio ref={setAudioElement} autoPlay playsInline muted={false} style={{display: 'none'}}/>;

    return <div ref={itemRef} data-key={ unique_key } className={className} style={style} part="grid-tile">
        <Piece name="GridTile" props={ { participant, layout: 'group-video' } } always={ sound }>
        <Tooltip content={ participant.name }>
            <div className={innerClass} style={innerStyle}>
                { ( adminMode && connectionState === 'connected' ) &&
                    <span className="bm-admin-controls">
                        { ! participant.isPinned && moderates( moderation, 'pin_participant' ) && <Tooltip content={_x('Pin Participant', 'Group Video Chat', 'bp-better-messages')}>
                            <span onClick={() => run( 'pin', () => pinUser( participant.identity ) )} data-busy={ busy( 'pin' ) } style={{position: "relative"}}>
                                { glyph( 'pin', 'pin' ) }
                            </span>
                        </Tooltip> }
                        { participant.isPinned && moderates( moderation, 'unpin_participant' ) && <Tooltip content={_x('Unpin Participant', 'Group Video Chat', 'bp-better-messages')}>
                            <span onClick={() => run( 'pin', () => unpinUser( participant.identity ) )} data-busy={ busy( 'pin' ) } style={{position: "relative"}}>
                                { glyph( 'pin', 'pinOff' ) }
                            </span>
                        </Tooltip> }

                        { ( unique_key !== 'me') && <>
                            { callMode !== 'broadcast' && <>
                                { participant.canPublish && moderates( moderation, 'mute_participant' ) &&
                                    <Tooltip content={_x('Block Broadcast', 'Group Video Chat', 'bp-better-messages')}>
                                        <span onClick={() => run( 'broadcast', () => muteUser( participant.identity ) )} data-busy={ busy( 'broadcast' ) } style={{position: "relative"}}>
                                            { glyph( 'broadcast', 'megaphoneOff' ) }
                                        </span>
                                    </Tooltip>
                                }

                                { ! participant.canPublish && moderates( moderation, 'unmute_participant' ) && <Tooltip content={_x('Allow Broadcast', 'Group Video Chat', 'bp-better-messages')}>
                                    <span onClick={() => run( 'broadcast', () => unmuteUser( participant.identity ) )} data-busy={ busy( 'broadcast' ) }>
                                        { glyph( 'broadcast', 'megaphone' ) }
                                    </span>
                                    </Tooltip>
                                }
                            </> }

                            { participant.canPublish && <>
                                { ! participant.micMuted && moderates( moderation, 'mute_mic' ) &&
                                    <Tooltip content={_x('Mute Microphone', 'Group Video Chat', 'bp-better-messages')}>
                                        <span onClick={() => run( 'mic', () => muteMic( participant.identity ) )} data-busy={ busy( 'mic' ) } style={{position: "relative"}}>
                                            { glyph( 'mic', 'micOff' ) }
                                        </span>
                                    </Tooltip>
                                }

                                { participant.micMuted && moderates( moderation, 'unmute_mic' ) &&
                                    <Tooltip content={_x('Unmute Microphone', 'Group Video Chat', 'bp-better-messages')}>
                                        <span onClick={() => run( 'mic', () => unmuteMic( participant.identity ) )} data-busy={ busy( 'mic' ) }>
                                            { glyph( 'mic', 'mic' ) }
                                        </span>
                                    </Tooltip>
                                }
                            </> }

                            { moderates( moderation, 'remove_participant' ) && <Tooltip content={_x('Kick User', 'Group Video Chat', 'bp-better-messages')}>
                                <span onClick={() => run( 'kick', () => kickUser( participant.identity ) )} data-busy={ busy( 'kick' ) }>{ glyph( 'kick', 'userX' ) }</span>
                            </Tooltip> }

                            { ( callMode === 'broadcast' && ! participant.canAdmin ) && <>
                                { ! participant.canPublish &&
                                    <Tooltip content={_x('Promote to Speaker', 'Group Video Chat', 'bp-better-messages')}>
                                        <span onClick={() => run( 'speaker', () => promoteParticipant( participant.identity ) )} data-busy={ busy( 'speaker' ) } className={ participant.handRaised ? 'bm-promote-highlighted' : '' }>
                                            { glyph( 'speaker', 'arrowUp' ) }
                                        </span>
                                    </Tooltip>
                                }
                                { participant.canPublish &&
                                    <Tooltip content={_x('Demote to Viewer', 'Group Video Chat', 'bp-better-messages')}>
                                        <span onClick={() => run( 'speaker', () => demoteParticipant( participant.identity ) )} data-busy={ busy( 'speaker' ) }>
                                            { glyph( 'speaker', 'arrowDown' ) }
                                        </span>
                                    </Tooltip>
                                }
                            </> }
                        </> }
                    </span>
                }

                { participant.reconnecting &&
                    <span className="bm-call-reconnecting" role="status">{ _x('Reconnecting...', 'Call Screen', 'bp-better-messages') }</span>
                }

                { optimizingShown && <CameraOptimizingNotice state={ optimizing } avatar={ participant.avatar } /> }

                { paused &&
                    <span className="bm-call-paused" part="video-paused">
                        <Tooltip content={ _x('Your connection cannot carry this video right now. The sound goes on and the video comes back by itself.', 'Call Screen', 'bp-better-messages') }>
                            <span className="bm-call-paused-notice">
                                <Icon name="wifiWeak" size={ 16 } />
                                <span>{ _x('Paused: weak connection', 'Call Screen', 'bp-better-messages') }</span>
                            </span>
                        </Tooltip>
                    </span>
                }

                { ( connectionState === 'connected' && ! participant.reconnecting && ! participant.audio && ! participant.screenAudio && ! ( callMode === 'broadcast' && ! participant.canPublish && ! participant.canAdmin ) ) && <span className="bm-caller-status">
                    <Tooltip content={_x('Microphone Disabled', 'Group Video Chat', 'bp-better-messages')}>
                        <span className="bm-mic-disabled">
                            <Icon name="micOff" size={ 14 } />
                        </span>
                    </Tooltip>
                </span> }

                { ( connectionState === 'connected' && participant.handRaised ) && <span className="bm-hand-raised-status">
                    <Tooltip content={ adminMode && unique_key !== 'me' ? _x('Lower Hand', 'Group Video Chat', 'bp-better-messages') : _x('Hand Raised', 'Group Video Chat', 'bp-better-messages') }>
                        <span className="bm-hand-raised" onClick={ adminMode && unique_key !== 'me' ? () => run( 'hand', () => lowerHand( participant.identity ) ) : undefined } data-busy={ busy( 'hand' ) } style={ adminMode && unique_key !== 'me' ? { cursor: 'pointer' } : undefined }>
                            { glyph( 'hand', 'raisehand' ) }
                        </span>
                    </Tooltip>
                </span> }

                { ( connectionState === 'connected' && callMode === 'broadcast' && ! participant.canPublish && ! participant.canAdmin ) &&
                    <span className="bm-viewer-badge">
                        <Tooltip content={_x('Viewer', 'Group Video Chat', 'bp-better-messages')}>
                            <span>{_x('Viewer', 'Group Video Chat', 'bp-better-messages')}</span>
                        </Tooltip>
                    </span>
                }

                { ( ( adminMode === true && unique_key !== 'me') || ! participant.video ) &&
                    <div className="bm-group-call-input-video-inner-info">
                    <span className="bm-caller-info" style={callerInfoStyle}>
                        <span className="bm-info-name">
                            <span className="bm-caller-name"><UserName user_id={user_id}/></span>
                        </span>
                    </span>
                    </div>
                }

                <div className={"bm-media-container" + ( !! participant.screen ? " bm-screen-shared" : "" )}>
                    { ( !! participant.screen ) && <video ref={setScreenElement} datatype="screen" autoPlay={true} playsInline={true}></video> }

                    { ( !! participant.video && !! participant.screen ) &&
                        <Resizable className="bm-small-video" resizeDirection="none">
                            <video ref={setVideoElement} datatype="camera" autoPlay playsInline muted={unique_key === 'me'}/>
                        </Resizable>
                    }

                    { ( !! participant.video && ! participant.screen ) &&
                        <video ref={setVideoElement} className={selfPictureClass} datatype="camera" autoPlay={true} playsInline={true}></video>
                    }
                    { sound }
                </div>
            </div>
        </Tooltip>
        </Piece>
    </div>
})
