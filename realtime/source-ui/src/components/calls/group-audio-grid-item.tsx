import React, {memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import {CallContext, CallContextInterface, CallParticipant} from "./context.ts";
import {getSpeakerHighlightStyles} from "../../inc/functions.ts";
import {_x} from "../../inc/globals.ts";
import { host } from "../../host.ts";
import Tooltip from "../helpers/tooltip.tsx";
import UserName from "../users/user-name.tsx";
import UserAvatar from "../users/user-avatar.tsx";
import Icon, { IconName } from "../../primitives/icon.tsx";
import { cssRatio, useMediaRatio } from "../../inc/calls/ratio.ts";
import { moderates, useModerationActs } from "./moderation.ts";
import usePendingActions from "../../inc/calls/pending.ts";
import { Piece } from "../../pieces.tsx";

// How long the entrance keyframe in styles/calls/_call-stage.scss runs for.
const TILE_ENTER_MS = 300;

/**
 * One person in a group audio call's roster: their picture with the ring of whoever speaks, their name, microphone and
 * raised hand, "Reconnecting..." while they are briefly away, and a moderator's controls for them (remove, let them
 * broadcast, make them a speaker), each spinning until the row shows what it asked for.
 */
export default memo(function GroupAudioGridItem({ unique_key, participant } : {
    unique_key: string,
    participant: CallParticipant
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
        moderation
    } = useContext<CallContextInterface>( CallContext );

    const [ audioElement, setAudioElement ] = useState<HTMLAudioElement | null>(null);
    const [ screenElement, setScreenElement ] = useState<HTMLVideoElement | null>(null);

    // The scale-and-fade entrance cannot live on the tile's base class.
    // The grid re-sorts as people speak, React moves the reordered nodes with
    // insertBefore, and moving a node RESTARTS any CSS animation on it — so a
    // permanent animation-name meant every tile collapsed to scale(0) and grew
    // back on every re-sort. Carrying the keyframe on a class that is dropped
    // once it has played leaves later moves with no animation to restart.
    const [ entering, setEntering ] = useState( true );

    useEffect(() => {
        const timer = window.setTimeout( () => setEntering( false ), TILE_ENTER_MS );
        return () => window.clearTimeout( timer );
    }, []);

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
        if ( !! audioElement && !! participant && !! participant.audio && ! participant.audio.attachedElements.includes(audioElement) ) {
            participant.audio.attach(audioElement);
        }
    }, [ audioElement, participant ]);

    useEffect(() => {
        if ( !! screenElement && !! participant && !!participant.screen && !participant.screen.attachedElements.includes(screenElement)) {
            participant.screen.attach(screenElement);

            if (unique_key !== 'me' && !!participant.screenAudio && !participant.screenAudio.attachedElements.includes(screenElement)) {
                participant.screenAudio.attach(screenElement);
            }
        }
    }, [ screenElement, participant ]);

    // A roster row is a row until somebody shares, and then their row is the
    // stage: it takes the height the roster is not using, and the picture
    // inside it takes the shape the share actually has. A phone's share is
    // taller than it is wide, so that shape cannot be assumed — it is read
    // off the playing element and handed to the stylesheet.
    const screenRatio = cssRatio( useMediaRatio( screenElement ) );

    let className = "bm-group-call-input-audio";
    let innerClass = "bm-group-call-input-audio-inner";

    if( !! participant.screen ) className += " bm-group-call-input-audio-screen";
    if( unique_key === 'me' ) className += " bm-group-call-input-mine";
    if( entering ) className += " bm-call-tile-entering";

    let style : React.CSSProperties = {}
    let innerStyle : React.CSSProperties = {};

    if( !! participant.screen && screenRatio ){
        ( style as Record<string, string> )['--bm-screen-ratio'] = screenRatio;
    }

    const accentColor = host().accentColor();

    const speakerHighlight = useMemo(() => {
        return getSpeakerHighlightStyles( participant.isSpeaking, participant.audioLevel, accentColor );
    }, [ accentColor, participant.audioLevel, participant.isSpeaking ]);

    if( speakerHighlight ){
        innerClass += " bm-active-speaker";
        innerStyle['boxShadow'] = speakerHighlight.boxShadow;
        innerStyle['background'] = speakerHighlight.background;
    }

    let user_id : number | string = host().currentUserId();

    if( unique_key.startsWith('user_') ){
        // A user of the app: their id of digits as a number, as Better Messages has it, any other id as it is.
        const id = unique_key.substring(5);
        user_id = /^[1-9][0-9]*$/.test( id ) ? Number( id ) : id;
    }

    const { kickUser, muteUser, unmuteUser } = useModerationActs( moderate, 'audio' );

    // A control waits from the click until the row shows what it asked for
    // (see pending.ts), one key per slot.
    const [ isPending, run ] = usePendingActions(
        [ participant.canPublish, participant.micMuted, participant.handRaised ].join( '|' )
    );
    const busy = ( key: string ) => isPending( key ) ? 1 : undefined;
    const glyph = ( key: string, name: IconName ) => isPending( key )
        ? <Icon name="spinner" size={ 14 } className="bm-svg-animate" />
        : <Icon name={ name } size={ 14 } />;

    // Their sound, in the row's media, and after an app's own tile in its place (pieces.tsx).
    const sound = ( !! participant.audio && unique_key !== 'me') &&
        <audio ref={setAudioElement} autoPlay playsInline muted={false} style={{display: 'none'}}/>;

    return <div ref={itemRef} data-key={unique_key} className={className} style={style} part="grid-tile">
        <Piece name="GridTile" props={ { participant, layout: 'group-audio' } } always={ sound }>
        <div className={innerClass} style={innerStyle}>
            { participant.reconnecting &&
                <span className="bm-call-reconnecting" role="status">{ _x('Reconnecting...', 'Call Screen', 'bp-better-messages') }</span>
            }
            {( !! participant.screen ) &&
                <div className="bm-group-call-input-audio-screen-wrapper">
                    <video ref={setScreenElement} datatype="screen" autoPlay={true} playsInline={true} muted={unique_key === 'me'}></video>
                </div>
            }

            <div className="bm-group-call-input-audio-inner-info">
                        <span className="bm-caller-info">
                            <span className="bm-info-avatar">
                                <UserAvatar user_id={user_id} size={45}/>
                            </span>
                            <span className="bm-info-name"><span className="bm-caller-name">
                                <UserName user_id={user_id}/>
                            </span>
                            </span>
                            <span className="bm-caller-actions">
                                {( adminMode && unique_key !== 'me') &&
                                    <span className="bm-admin-controls">
                                    { moderates( moderation, 'remove_participant' ) && <Tooltip content={_x('Kick User', 'Group Audio Chat', 'bp-better-messages')}>
                                        <span onClick={() => run( 'kick', () => kickUser(unique_key) )} data-busy={ busy( 'kick' ) }>
                                            { glyph( 'kick', 'userX' ) }</span>
                                    </Tooltip> }

                                    { callMode !== 'broadcast' && <>
                                        { participant.canPublish && moderates( moderation, 'mute_participant' ) &&
                                            <Tooltip
                                                content={_x('Block Broadcast', 'Group Audio Chat', 'bp-better-messages')}>
                                                <span onClick={() => run( 'broadcast', () => muteUser(unique_key) )} data-busy={ busy( 'broadcast' ) } style={{position: "relative"}}>
                                                    { glyph( 'broadcast', 'megaphoneOff' ) }
                                                </span>
                                            </Tooltip>
                                        }
                                        { ! participant.canPublish && moderates( moderation, 'unmute_participant' ) &&
                                            <Tooltip
                                                content={_x('Allow Broadcast', 'Group Audio Chat', 'bp-better-messages')}>
                                                <span
                                                    onClick={() => run( 'broadcast', () => unmuteUser(unique_key) )} data-busy={ busy( 'broadcast' ) }>
                                                    { glyph( 'broadcast', 'megaphone' ) }
                                                </span>
                                            </Tooltip>
                                        }
                                    </> }

                                    { ( callMode === 'broadcast' && ! participant.canAdmin ) && <>
                                        { ! participant.canPublish &&
                                            <Tooltip content={_x('Promote to Speaker', 'Group Audio Chat', 'bp-better-messages')}>
                                                <span onClick={() => run( 'speaker', () => promoteParticipant( participant.identity ) )} data-busy={ busy( 'speaker' ) } className={ participant.handRaised ? 'bm-promote-highlighted' : '' }>
                                                    { glyph( 'speaker', 'arrowUp' ) }
                                                </span>
                                            </Tooltip>
                                        }
                                        { participant.canPublish &&
                                            <Tooltip content={_x('Demote to Viewer', 'Group Audio Chat', 'bp-better-messages')}>
                                                <span onClick={() => run( 'speaker', () => demoteParticipant( participant.identity ) )} data-busy={ busy( 'speaker' ) }>
                                                    { glyph( 'speaker', 'arrowDown' ) }
                                                </span>
                                            </Tooltip>
                                        }
                                    </> }
                                    </span>
                                }

                                { ! ( callMode === 'broadcast' && ! participant.canPublish && ! participant.canAdmin ) &&
                                <span className="bm-mic-status">
                                    { ! participant.audio && ! participant.reconnecting &&
                                        <Tooltip
                                            content={_x('Microphone Disabled', 'Group Audio Chat', 'bp-better-messages')}>
                                            <span className="bm-mic-disabled">
                                                <Icon name="micOff" size={ 14 } />
                                            </span>
                                        </Tooltip>
                                    }
                                    { participant.audio &&
                                        <Tooltip
                                            content={_x('Microphone Enabled', 'Group Audio Chat', 'bp-better-messages')}>
                                            <span className="bm-mic-enabled">
                                                <Icon name="mic" size={ 14 } />
                                            </span>
                                        </Tooltip>
                                    }
                                </span>
                                }

                                { participant.handRaised &&
                                    <Tooltip content={ adminMode && unique_key !== 'me' ? _x('Lower Hand', 'Group Audio Chat', 'bp-better-messages') : _x('Hand Raised', 'Group Audio Chat', 'bp-better-messages') }>
                                        <span className="bm-hand-raised" onClick={ adminMode && unique_key !== 'me' ? () => run( 'hand', () => lowerHand( participant.identity ) ) : undefined } data-busy={ busy( 'hand' ) } style={ adminMode && unique_key !== 'me' ? { cursor: 'pointer' } : undefined }>
                                            { glyph( 'hand', 'raisehand' ) }
                                        </span>
                                    </Tooltip>
                                }

                                { ( callMode === 'broadcast' && ! participant.canPublish && ! participant.canAdmin ) &&
                                    <span className="bm-viewer-badge">
                                        {_x('Listener', 'Group Audio Chat', 'bp-better-messages')}
                                    </span>
                                }
                            </span>
                        </span>
            </div>

            <div className={"bm-media-container" + ( ! ! participant.screen ? " bm-screen-shared" : "") } style={{display: "none"}}>
                { sound }
            </div>
        </div>
        </Piece>
    </div>
})
