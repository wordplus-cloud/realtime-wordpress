import React, {useContext, useEffect, useRef, useState } from "react";
import {CallContext, CallContextInterface, CallParticipant} from "./context.ts";
import {isMobile} from "../../inc/functions/browser-info.ts";
import { deepFocus, focusBack } from "./focus-return.ts";
import UserAvatar from "../users/user-avatar.tsx";
import {__, _x} from "../../inc/globals.ts";
import DeviceSwitch from "./device-switch.tsx";
import Tooltip from "../helpers/tooltip.tsx";
import {
    pictureInPictureSupport as pictureInPicture,
    screenShareSupport,
    useCameras,
    useConfigAvailable,
    useMicrophones,
    useSpeakers
} from "../../inc/calls/permissions.ts";
import {formatSize, msToTime} from "../../inc/functions.ts";
import useStateRef from "../../inc/hooks/state-ref.ts";
import Resizable from "../helpers/resizable.tsx";
import Icon from "../../primitives/icon.tsx";
import CallDock from "./call-dock.tsx";
import { AddPersonButton, AddPersonPanel } from "./add-person.tsx";
import { cssRatio, useMediaRatio, usePictureDrawn } from "../../inc/calls/ratio.ts";
import useHeld, { PAUSED_NOTICE_MS } from "../../inc/hooks/held.ts";
import { Piece } from "../../pieces.tsx";

/**
 * A call between two people, from the CallContext: ringing out (the other side's picture, Calling..., cancel) or in
 * (Answer and Reject), then their camera or shared screen with the user's own picture in a corner that can be resized,
 * the call's time, and the dock (microphone, camera, turning it, sharing the screen, picture in picture, full screen,
 * the settings with the devices, Show Chat / Hide Chat beside a chat, Add Person, hanging up).
 */
export default function PrivateCallLayout() {
    const {
        thread,
        callInfo,
        statusMessage,
        participants,
        action,
        errorMessages,
        bytesSentRef,
        bytesReceivedRef,
        iconsReverted,
        endCall,
        answerCall,
        activeCameraDevice,
        selectedCameraDevice,
        selectedMicrophoneDevice,
        selectedSpeakerDevice,
        setSelectedCameraDevice,
        setSelectedMicrophoneDevice,
        setSelectedSpeakerDevice,
        myCameraTrack,
        switchingCamera,
        myMicrophoneTrack,
        myMicrophoneTrackRef,
        myScreenVideoTrack,
        switchCamera,
        enableCamera,
        disableCamera,
        enableMic,
        disableMic,
        enableShareScreen,
        disableShareScreen,
        enableFullScreen,
        disableFullScreen,
        callDurationRef,
        fullScreenAvailable,
        fullScreenEnabled,
        setFullScreenEnabled,
        chatShown,
        chatToggle
    } = useContext<CallContextInterface>( CallContext );

    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(id);
    }, []);

    const callDuration = callDurationRef ? callDurationRef.current : 0;
    const bytesSent = bytesSentRef ? bytesSentRef.current : 0;
    const bytesReceived = bytesReceivedRef ? bytesReceivedRef.current : 0;

    const configAvailable = useConfigAvailable();
    const cameraDevices = useCameras();
    const microphoneDevices = useMicrophones();
    const speakerDevices = useSpeakers();

    const [ configOpen, setConfigOpen ] = useState( false );
    const [ addOpen, setAddOpen ] = useState( false );

    const [ myCameraVideo, setMyCameraVideo ] = useStateRef<HTMLVideoElement | null>(null);

    // The own-camera chip is kept invisible until the browser has drawn a
    // frame of the camera, so it fades in at its real proportions instead of
    // jumping from the element's default box to the video's — and on a phone
    // it waits for WebKit to have the frame in hand before the picture takes
    // the chip's size, or the picture comes out a fraction of it (see
    // usePictureDrawn). A picture shown before the browser counted a frame
    // of it is sized once more when it does.
    const selfPicture = usePictureDrawn( myCameraVideo, myCameraTrack );

    const selfPreviewClass = "bm-call-small-video"
        + ( selfPicture ? " bm-call-small-video--ready" : "" )
        + ( selfPicture === 'counted' ? " bm-call-small-video--counted" : "" );
    const [ myScreen, setMyScreen ] = useStateRef<HTMLVideoElement | null>(null);

    const [ primaryVideo, setPrimaryVideo ] = useState<'screen' | 'camera'>('screen');

    const [ otherParticipant, setOtherParticipant ] = useState<CallParticipant | null>(null);

    useEffect(() => {
        let otherParticipant : CallParticipant | null = null;

        if( participants.size > 0 ){
            for (const [key, participant] of participants.entries()) {
                if (key !== 'me') {
                    otherParticipant = participant;
                    break; // Exit the loop after setting the other participant
                }
            }
        }

        setOtherParticipant( otherParticipant );
    }, [ participants ]);

    // The track attached is the one detached. The ref read at cleanup is
    // already empty when a call ends, so the preview never detached its
    // track, and a device switch keeps the element while the track under it
    // changes, so the new camera never reached the preview at all.
    useEffect(() => {
        const track = myCameraTrack;

        if( ! myCameraVideo || ! track ) return;

        if ( ! track.attachedElements.includes(myCameraVideo)) {
            track.attach(myCameraVideo);
        }

        return () => {
            if (track.attachedElements.includes(myCameraVideo)) {
                track.detach(myCameraVideo);
            }
        }
    }, [ myCameraVideo, myCameraTrack ])

    useEffect(() => {
        const track = myScreenVideoTrack;

        if( ! myScreen || ! track ) return;

        if ( ! track.attachedElements.includes(myScreen)) {
            track.attach(myScreen);
        }

        return () => {
            if (track.attachedElements.includes(myScreen)) {
                track.detach(myScreen);
            }
        }
    }, [ myScreen, myScreenVideoTrack ])

    const [ isTapped, setIsTapped ] = useState( false );
    const tappedTimeout = useRef<number | undefined>(undefined);
    const onTapped = () => {
        clearTimeout(tappedTimeout.current);

        setIsTapped( true );

        tappedTimeout.current = window.setTimeout( () => {
            setIsTapped( false );
        }, 5000 )
    }

    // While the controls are hidden on a phone, a touch lands on the picture under them, and showing them at once put
    // a button where the finger was: the click that ended the touch pressed it. A tap meant only to bring the controls
    // back ended the call when it fell on End Call (Better Messages ticket 10500 sweep). So a click on the controls is
    // a press of theirs only when its touch began on them.
    const controlsRef = useRef<HTMLDivElement | null>( null );
    const touchBegan = useRef<{ at: number, onControls: boolean } | null>( null );
    const onTouchStart = ( e: React.TouchEvent ) => {
        touchBegan.current = { at: Date.now(), onControls: !! controlsRef.current?.contains( e.target as Node ) };
        onTapped();
    };
    const onClickCapture = ( e: React.MouseEvent ) => {
        const began = touchBegan.current;
        touchBegan.current = null;
        if ( ! began || began.onControls || Date.now() - began.at > 1000 ) return;
        if ( ! controlsRef.current?.contains( e.target as Node ) ) return;
        e.stopPropagation();
        e.preventDefault();
    };

    const [ videoElement, setVideoElement, videoElementRef ] = useStateRef<HTMLVideoElement | null>(null);
    const [ audioElement, setAudioElement ] = useState<HTMLAudioElement | null>(null);
    const [ screenElement, setScreenElement ] = useStateRef<HTMLVideoElement | null>(null);
    const [ screenAudioElement, setScreenAudioElement ] = useState<HTMLAudioElement | null>(null);

    // What each corner chip is shaped like. The same two elements carry the
    // other side's camera and screen whether they are on the stage or in a
    // chip, so reading them here covers both places they can be shown.
    //
    // Resizable hands the answer to CSS as --bm-chip-ratio, so these are the
    // written form; the group grids take the same reading as a number and do
    // arithmetic with it.
    const myCameraRatio = cssRatio( useMediaRatio( myCameraVideo ) );
    const myScreenRatio = cssRatio( useMediaRatio( myScreen ) );
    const peerCameraRatio = cssRatio( useMediaRatio( videoElement ) );
    const peerScreenRatio = cssRatio( useMediaRatio( screenElement ) );

    useEffect(() => {
        if( !! audioElement && audioElement.setSinkId ){
            audioElement.setSinkId(selectedSpeakerDevice);
        }
    }, [ audioElement, selectedSpeakerDevice ]);

    useEffect(() => {
        if( !! screenAudioElement && screenAudioElement.setSinkId ){
            screenAudioElement.setSinkId(selectedSpeakerDevice);
        }
    }, [ screenAudioElement, selectedSpeakerDevice ]);

    const [ picInPic, setPicInPic ] = useState( false );

    const switchPicInPic = async () => {
        let video = videoElementRef.current;

        if (video) {
            if (video !== document.pictureInPictureElement) {
                await video.requestPictureInPicture();

                setPicInPic( true );
            } else {
                await document.exitPictureInPicture();
                setPicInPic( false );
            }
        }
    }

    const switchVideos = () => {
        setPrimaryVideo( (primaryVideo) => primaryVideo === 'screen' ? 'camera' : 'screen' );
    }

    // These run before the element is there too, and attach nothing to a
    // track then: as 2.0's did, kept as they were when typed.
    useEffect(() => {
        if ( !! otherParticipant && !! otherParticipant.video && ! otherParticipant.video.attachedElements.includes(videoElement!) ) {
            otherParticipant.video.attach(videoElement!);
        }
    }, [ videoElement, otherParticipant ]);

    useEffect(() => {
        if ( !! otherParticipant && !! otherParticipant.audio && ! otherParticipant.audio.attachedElements.includes(audioElement!) ) {
            otherParticipant.audio.attach(audioElement!);
        }
    }, [ audioElement, otherParticipant ]);

    useEffect(() => {
        if ( !! otherParticipant && !! otherParticipant.screen && ! otherParticipant.screen.attachedElements.includes(screenElement!) ) {
            otherParticipant.screen.attach(screenElement!);
        }
    }, [ screenElement, otherParticipant ]);

    useEffect(() => {
        if ( !! otherParticipant && !! otherParticipant.screenAudio && ! otherParticipant.screenAudio.attachedElements.includes(screenAudioElement!) ) {
            otherParticipant.screenAudio.attach(screenAudioElement!);
        }
    }, [ screenAudioElement, otherParticipant ]);

    useEffect(() => {
        if( !! audioElement && audioElement.setSinkId ){
            audioElement.setSinkId(selectedSpeakerDevice);
        }
    }, [ audioElement, selectedSpeakerDevice ]);

    useEffect(() => {
        if( !! screenAudioElement && screenAudioElement.setSinkId ){
            screenAudioElement.setSinkId(selectedSpeakerDevice);
        }
    }, [ screenAudioElement, selectedSpeakerDevice ]);

    const [ justConnected, setJustConnected ] = useState( false );
    const justConnectedTimeout = useRef<number | undefined>(undefined);

    useEffect(() => {
        if( action === 'call_in_progress' ){
            setJustConnected( true );

            clearTimeout(justConnectedTimeout.current);

            justConnectedTimeout.current = window.setTimeout( () => {
                setJustConnected( false );
            }, 15000 );
        }
    }, [action]);

    // The other side's microphone. A direct call reports the peer's media
    // state as it changes, so a muted microphone shows at once; on a LiveKit
    // call the missing track only counts once the first tracks have had
    // time to arrive.
    // A peer away for a moment keeps its place (call-container's participantAway), not its microphone state.
    const peerPresent = !! otherParticipant && otherParticipant.quality !== 'lost' && ! otherParticipant.reconnecting;
    const peerMicOff = action === 'call_in_progress' && peerPresent && ! otherParticipant.audio && ( otherParticipant.micMuted || ! justConnected );
    const peerHasPicture = !! otherParticipant && ( !! otherParticipant.video || !! otherParticipant.screen );
    // Their picture paused by the media server for this page's download (a call on the room; a direct call has no
    // server between them): frozen on its last frame, so the call says why once it has stayed so for a moment.
    const peerPaused = useHeld( action === 'call_in_progress' && peerPresent
        && ( ( !! otherParticipant.video && !! otherParticipant.videoPaused ) || ( !! otherParticipant.screen && !! otherParticipant.screenPaused ) ), PAUSED_NOTICE_MS );

    // A keyboard reaches the call (an SDK review, 2026-10-14): the window is a stop in the Tab order and takes the focus
    // as it opens, so the next Tab is on its controls, which show while it or one of them has the keyboard (call-stage
    // .scss). The focus goes back where it was as it closes.
    const callRef = useRef<HTMLDivElement | null>( null );
    useEffect( () => {
        const before = deepFocus();
        callRef.current?.focus( { preventScroll: true } );
        return () => focusBack( before );
    }, [] );

    // The other side's sound, inside their tile, and after an app's own tile in its place (pieces.tsx).
    const sound = !! otherParticipant && <>
        { ( otherParticipant.audio ) &&
            <audio ref={ setAudioElement } autoPlay playsInline className={'audio1'} muted={false} style={{display: 'none'}} />
        }
        { ( otherParticipant.screenAudio ) &&
            <audio ref={ setScreenAudioElement } autoPlay playsInline className={'audio2'} muted={false} style={{display: 'none'}} />
        }
    </>;

    // A dialog named by the other person, so a screen reader says whom the call is with as it opens.
    return <div ref={ callRef } tabIndex={ 0 } role="dialog" aria-label={ otherParticipant?.name || undefined } onTouchStart={ onTouchStart } onClickCapture={ onClickCapture } className={((isMobile() && isTapped) ? "bm-tapped " : '') + "bm-video-container bm-private-call bm-call-container"}>
        { ( action === 'outgoing_call' || action === 'incoming_call' ) && <>
            { ( !! myCameraTrack && !! myScreenVideoTrack ) &&
                <Resizable className={ selfPreviewClass } resizeDirection={"top-left"} aspectRatio={ myCameraRatio }>
                    <video ref={setMyCameraVideo} datatype={'camera'} autoPlay={true} playsInline muted={true}/>
                </Resizable>
            }

            <div className="bm-main-placeholder">
                { ( !! myCameraTrack && ! myScreenVideoTrack ) &&
                    <div className="bm-placeholder-video">
                        <video ref={setMyCameraVideo} datatype={'camera'} autoPlay={true} playsInline muted={true}/>
                    </div>
                }
                {( !! myScreenVideoTrack ) &&
                    <div className="bm-placeholder-video bm-video-contain">
                        <video ref={setMyScreen} datatype={'screen'} autoPlay={true} playsInline muted={true}/>
                    </div>
                }

                <div className={ "bm-call-animation " } >
                    <UserAvatar user_id={thread.participants[0]} link={false} size={100} fromThread={thread}/>
                </div>

                <Piece name="CallStatus" props={ { layout: 'private', action, text: statusMessage, duration: callDuration } }>
                <div className="bm-placeholder-message" part="call-status">
                    { statusMessage && <span className="bm-placeholder-status">{statusMessage}</span> }

                    { ! statusMessage && <>
                        {action === "incoming_call" && <span className="bm-placeholder-incoming-text">{_x('Incoming Call', 'Private Call Screen', 'bp-better-messages')}</span>}
                        {action === "outgoing_call" && <span className="bm-placeholder-outgoing-text">{_x('Calling...', 'Private Call Screen', 'bp-better-messages')}</span>}
                    </>}
                </div>
                </Piece>

                {errorMessages.length > 0 &&
                    <div className="bm-placeholder-no-access-message">
                        <div className="bm-placeholder-no-access-message-icon">
                            <Icon name="alert" size={ 28 } />
                        </div>
                        <div className="bm-placeholder-no-access-message-text">
                            {errorMessages.map((error, index) => (
                                <p key={"error_" + index} style={{margin: 0}}>{error}</p>
                            ))}
                        </div>
                    </div>
                }
            </div>
        </>}


        { ( action === 'call_in_progress' || action === 'connecting' ) && <>
            <Piece name="VideoTile" props={ { participant: otherParticipant, action } } always={ sound }>
            <div className="bm-main-video" part="video-tile">
                { ( ! otherParticipant || ( ! otherParticipant.video && ! otherParticipant.screen ) ) &&
                    <div className="bm-main-placeholder">
                        <div className="bm-call-animation bm-animation-pause">
                            <UserAvatar user_id={thread.participants[0]} link={false} size={100} fromThread={thread}/>
                        </div>
                        <Piece name="CallStatus" props={ { layout: 'private', action, text: statusMessage, duration: callDuration } }>
                        <div className={"bm-placeholder-message"} part="call-status">
                            {action === 'connecting' &&
                                <span className={"bm-placeholder-status"}>{statusMessage}</span>}
                            {action === 'call_in_progress' &&
                                <span className={"bm-timer"}>{msToTime(callDuration)}</span>}
                        </div>
                        </Piece>

                        { peerMicOff &&
                            <div className="bm-placeholder-no-source-message">
                                <Icon name="micOff" size={ 24 } />

                                <div className="bm-placeholder-participant-no-source-message-text">
                                    { callInfo.type === 'video'
                                        ? _x('The microphone and camera not enabled at the other side', 'Call Screen', 'bp-better-messages')
                                        : _x('The microphone is not enabled at the other side', 'Call Screen', 'bp-better-messages') }
                                </div>
                            </div>}
                    </div>
                }

                { ( peerMicOff && peerHasPicture ) &&
                    <div className="bm-placeholder-participant-muted-message">
                        <Icon name="micOff" size={ 20 } />

                        <div className="bm-placeholder-participant-muted-message-text">
                            {_x('The microphone is not enabled at the other side', 'Call Screen', 'bp-better-messages')}
                        </div>
                    </div>
                }

                { ( ! justConnected && otherParticipant && otherParticipant.quality === 'lost' ) && <>
                    <div className="bm-placeholder-participant-lost-message">
                        <Icon name="wifiOff" size={ 24 } />

                        <div className="bm-placeholder-participant-lost-message-text">
                            {_x('The other side lost connection', 'Call Screen', 'bp-better-messages')}
                        </div>
                    </div>
                </> }

                {( !! otherParticipant ) && <>
                    { ( otherParticipant.video && ! otherParticipant.screen ) &&
                        <video ref={setVideoElement} datatype="camera" autoPlay playsInline className="video1" muted={false}/>
                    }

                    { otherParticipant.screen && <>
                        { ( primaryVideo === 'screen' ) && <video ref={setScreenElement} datatype="screen" autoPlay playsInline className="video2" muted={false}/> }
                        { ( primaryVideo === 'camera' ) && <video ref={setVideoElement} datatype="camera" autoPlay playsInline className="video1" muted={false}/> }
                    </> }

                    { peerPaused &&
                        <div className="bm-call-paused bm-call-paused-main" part="video-paused">
                            <div className="bm-call-paused-notice">
                                <Icon name="wifiWeak" size={ 22 } />
                                <div>
                                    <p>{ _x('Paused: weak connection', 'Call Screen', 'bp-better-messages') }</p>
                                    <p>{ _x('Your connection cannot carry this video right now. The sound goes on and the video comes back by itself.', 'Call Screen', 'bp-better-messages') }</p>
                                </div>
                            </div>
                        </div>
                    }

                    { sound }
                </> }
            </div>
            </Piece>

            { ( !! myCameraTrack ) &&
                <Piece name="SelfView" props={ { track: myCameraTrack } }>
                    <Resizable className={ selfPreviewClass } resizeDirection={"top-left"} aspectRatio={ myCameraRatio } part="self-view">
                        <video ref={setMyCameraVideo} datatype={'camera'} autoPlay playsInline muted={true}/>
                    </Resizable>
                </Piece>
            }

            { ( !! otherParticipant && otherParticipant.video && otherParticipant.screen )  && <>
                { primaryVideo === 'screen' &&
                    <Resizable className={"bm-call-small-video-2"} resizeDirection={"top-right"} aspectRatio={ peerCameraRatio }>
                        <span className="bm-switch-videos" onClick={switchVideos}><Icon name="swapVideos" size={ 14 } /></span>
                        <video ref={ setVideoElement } autoPlay playsInline muted={true} />
                    </Resizable>
                }

                { primaryVideo === 'camera' &&
                    <Resizable className={"bm-call-small-video-2"} resizeDirection={"top-right"} aspectRatio={ peerScreenRatio }>
                        <span className="bm-switch-videos" onClick={switchVideos}><Icon name="swapVideos" size={ 14 } /></span>
                        <video ref={ setScreenElement } autoPlay playsInline muted={true} />
                    </Resizable>
                }
                </>
            }

            { ( myScreenVideoTrack )  &&
                <Resizable className="bm-call-small-video-3" resizeDirection="bottom-left" aspectRatio={ myScreenRatio }>
                    <video ref={ setMyScreen } datatype={'screen'} autoPlay playsInline muted={true} />
                </Resizable>
            }

        </>
        }

        <div className={(( ( action === 'call_in_progress' || action === 'connecting' ) && !isMobile()) ? "bm-show-on-hover " : '') +
            ( ( ( action === 'call_in_progress' || action === 'connecting' ) && isMobile()) ? "show-on-tap " : '') +
            "bm-call-controls"} part="call-controls" ref={ controlsRef }
        >
            {configOpen === true &&
                <>
                    <div className="bm-call-settings">
                        <div className="bm-call-setting">
                            <label>{__('Statistics', 'bp-better-messages')}</label>
                            <div className="bm-call-statistics">
                                <div className="bm-call-traffic">
                                    <span>{__('Downloaded', 'bp-better-messages')}: {formatSize(bytesReceived)}</span>
                                    <span>{__('Uploaded', 'bp-better-messages')}: {formatSize(bytesSent)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bm-call-settings">
                        <DeviceSwitch label={_x('Camera', 'Media Inputs', 'bp-better-messages')}  devices={cameraDevices} selectedDevice={activeCameraDevice} setSelectedDevice={setSelectedCameraDevice}/>
                        <DeviceSwitch label={_x('Microphone', 'Media Inputs', 'bp-better-messages')} devices={microphoneDevices} selectedDevice={selectedMicrophoneDevice} setSelectedDevice={setSelectedMicrophoneDevice}/>
                        <DeviceSwitch label={_x('Speaker', 'Media Inputs', 'bp-better-messages')} devices={speakerDevices} selectedDevice={selectedSpeakerDevice} setSelectedDevice={setSelectedSpeakerDevice}/>
                    </div>
                </>
            }

            { addOpen && <AddPersonPanel close={ () => setAddOpen( false ) } /> }

            <CallDock className="bm-call-buttons" pinned={ 1 }>
                {action === 'incoming_call' &&
                    <Tooltip content={_x('Answer', 'Private Call Screen', 'bp-better-messages')}>
                        <span onTouchStart={answerCall} onClick={answerCall} className="bm-answer">
                            <Icon name="phone" size={ 20 } />
                        </span>
                    </Tooltip>
                }

                {/* Show / hide the conversation — see the group video room.
                    After Answer, which leads a ringing dock. */}
                { ( chatToggle && ! fullScreenEnabled ) &&
                    <Tooltip content={ chatShown ? _x('Hide Chat', 'Call Controls', 'bp-better-messages') : _x('Show Chat', 'Call Controls', 'bp-better-messages') }>
                        <span onClick={ () => chatToggle( ( shown: boolean ) => ! shown ) } className="bm-toggle-chat" data-active={ chatShown ? 1 : undefined }>
                            <Icon name="thread" size={ 20 } />
                        </span>
                    </Tooltip>
                }

                { configAvailable &&
                    <Tooltip content={_x('Configure', 'Private Call Screen', 'bp-better-messages')}>
                        <span onClick={ () => { setConfigOpen(!configOpen) }} className="bm-configure-call">
                            <Icon name="settings" size={ 20 } />
                        </span>
                    </Tooltip>
                }

                { action === 'call_in_progress' && <AddPersonButton open={ addOpen } setOpen={ setAddOpen } /> }

                { ( ! selectedCameraDevice && ( myCameraTrack || switchingCamera ) && isMobile() ) &&
                <Tooltip content={_x('Switch Camera', 'Private Call Screen', 'bp-better-messages')}>
                        <span onClick={switchCamera} className="bm-switch-camera-video">
                            <Icon name="switchCamera" size={ 20 } />
                        </span>
                </Tooltip> }

                { myCameraTrack &&
                    <Tooltip content={_x('Disable Camera', 'Private Call Screen', 'bp-better-messages')}>
                        <span onClick={disableCamera} className="bm-disable-video">
                            { ! iconsReverted && <Icon name="videoOff" size={ 20 } /> }
                            { iconsReverted && <Icon name="video" size={ 20 } /> }
                        </span>
                    </Tooltip>
                }

                {!myCameraTrack &&
                    <Tooltip content={_x('Enable Camera', 'Private Call Screen', 'bp-better-messages')}>
                            <span onClick={enableCamera} className="bm-enable-video">
                                {!iconsReverted && <Icon name="video" size={ 20 } />}
                                {iconsReverted && <Icon name="videoOff" size={ 20 } />}
                            </span>
                    </Tooltip>}

                {myMicrophoneTrack &&
                    <Tooltip content={_x('Disable Microphone', 'Private Call Screen', 'bp-better-messages')}>
                                <span onClick={disableMic} className="bm-disable-mic">
                                    { ! iconsReverted && <Icon name="micOff" size={ 20 } />}
                                    { iconsReverted && <Icon name="mic" size={ 20 } />}
                                </span>
                    </Tooltip>
                }

                { ! myMicrophoneTrack &&
                    <Tooltip content={_x('Enable Microphone', 'Private Call Screen', 'bp-better-messages')}>
                            <span onClick={enableMic} className="bm-enable-mic">
                                {!iconsReverted && <Icon name="mic" size={ 20 } />}
                                {iconsReverted && <Icon name="micOff" size={ 20 } />}
                            </span>
                    </Tooltip>
                }

                { ( action === 'call_in_progress' && pictureInPicture && !! otherParticipant && ( otherParticipant.video || otherParticipant.screen )) &&
                        <>
                            <Tooltip content={_x('Picture In Picture', 'Private Call Screen', 'bp-better-messages')}>
                                <span onClick={switchPicInPic} className="bm-pic-in-pic" data-active={ picInPic ? 1 : undefined }>
                                    { ! picInPic &&
                                        <Icon name="pip" size={ 20 } />
                                    }

                                    { picInPic &&
                                        <Icon name="pip" size={ 20 } />
                                    }
                                </span>
                            </Tooltip>
                        </>
                }

                { screenShareSupport &&
                    <>
                        { ! myScreenVideoTrack &&
                            <Tooltip content={_x('Share Screen', 'Private Call Screen', 'bp-better-messages')}>
                                <span onClick={enableShareScreen} className="bm-switch-share-screen">
                                    <Icon name="screenShare" size={ 20 } />
                                </span>
                            </Tooltip>
                        }

                        { myScreenVideoTrack &&
                            <Tooltip
                                content={_x('Stop Screen Sharing', 'Private Call Screen', 'bp-better-messages')}>
                                <span onClick={disableShareScreen} className="bm-switch-share-screen" data-active="1">
                                    <Icon name="screenShareOff" size={ 20 } />
                                </span>
                            </Tooltip>
                        }
                    </>
                }

                { fullScreenAvailable &&
                        <>
                            { ! fullScreenEnabled &&
                                <Tooltip  content={_x('Switch to Full Screen Mode', 'Private Call Screen', 'bp-better-messages')}>
                                <span onClick={enableFullScreen} className="bm-fs-enable">
                                        <Icon name="maximize" size={ 20 } />
                                </span>
                                </Tooltip>
                            }
                            { fullScreenEnabled &&
                                <Tooltip content={_x('Exit Full Screen Mode', 'Private Call Screen', 'bp-better-messages')}>
                                <span onClick={disableFullScreen} className="bm-fs-disable">
                                    <Icon name="minimize" size={ 20 } />
                                </span>
                                </Tooltip>
                            }
                        </>
                }

                {action === 'outgoing_call' &&
                    <Tooltip content={_x('Cancel', 'Private Call Screen', 'bp-better-messages')}>
                        <span onTouchStart={() => endCall('abort')} onClick={() => endCall('abort')}
                              className="bm-cancel">
                            <Icon name="phone" size={ 20 } />
                        </span>
                    </Tooltip>
                }

                {action === 'incoming_call' &&
                    <Tooltip content={_x('Reject', 'Private Call Screen', 'bp-better-messages')}>
                        <span onTouchStart={() => endCall('reject')} onClick={() => endCall('reject')}
                              className="bm-cancel">
                            <Icon name="phone" size={ 20 } />
                        </span>
                    </Tooltip>
                }

                { ( action === 'call_in_progress' || action === 'connecting' )  &&
                    <Tooltip content={_x('End Call', 'Private Call Screen', 'bp-better-messages')}>
                        <span
                            onTouchStart={() => endCall()}
                            onClick={() => endCall()}
                            className="bm-cancel">
                            <Icon name="phone" size={ 20 } />
                        </span>
                    </Tooltip>
                }
            </CallDock>

        </div>


    </div>
}
