import React, { useContext, useEffect, useRef, useState } from "react";
import {__, _x} from "../../inc/globals.ts";
import { moderates } from "./moderation.ts";
import DeviceSwitch from "./device-switch.tsx";
import {
    screenShareSupport,
    useCameras,
    useConfigAvailable,
    useMicrophones,
    useSpeakers
} from "../../inc/calls/permissions.ts";
import {CallContext, CallContextInterface} from "./context.ts";
import ConnectionStatus from "../parts/connection-status.tsx";
import Tooltip from "../helpers/tooltip.tsx";
import GroupVideoGrid from "./group-video-grid.tsx";
import useHeld, { PAUSED_NOTICE_MS } from "../../inc/hooks/held.ts";
import { host } from "../../host.ts";
import Icon, { IconName } from "../../primitives/icon.tsx";
import CallDock from "./call-dock.tsx";
import { AddPersonButton, AddPersonPanel } from "./add-person.tsx";
import usePendingActions from "../../inc/calls/pending.ts";
import { Piece } from "../../pieces.tsx";

/**
 * A group video call, from the CallContext: its tiles (GroupVideoGrid) and its dock. The dock holds the user's own
 * controls (camera, microphone, sharing the screen, full screen, raised hand, the settings with the devices, leaving),
 * Show Chat / Hide Chat where the call has a chat beside it, Add Person where the call can add people, and a
 * moderator's controls for the room (mute everyone, lock it, lower every hand, participatory or broadcast), each
 * spinning while its request is out.
 */
export default function GroupVideoCallLayout() {
    const {
        thread,
        statusMessage,
        participants,
        action,
        errorMessages,
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
        myCameraTrackRef,
        myMicrophoneTrack,
        myMicrophoneTrackRef,
        myScreenVideoTrack,
        myScreenVideoTrackRef,
        enableCamera,
        disableCamera,
        enableMic,
        disableMic,
        enableShareScreen,
        disableShareScreen,
        enableFullScreen,
        disableFullScreen,
        fullScreenAvailable,
        fullScreenEnabled,
        setFullScreenEnabled,
        connectionState,
        canPublish,
        adminMode,
        callInfo,
        roomLocked,
        setRoomLocked,
        roomMuted,
        setRoomMuted,
        raiseHand,
        lowerAllHands,
        myHandRaised,
        myMicMuted,
        callMode,
        setCallMode,
        moderate,
        moderation,
        chatShown,
        chatToggle,
        callDurationRef
    } = useContext<CallContextInterface>( CallContext );

    const [ configOpen, setConfigOpen ] = useState( false );
    const [ addOpen, setAddOpen ] = useState( false );

    // The room's controls show a spinner while their request is out (see
    // pending.ts); each flips its own state once the request succeeds.
    const [ isPending, run ] = usePendingActions();
    const busy = ( key: string ) => isPending( key ) ? 1 : undefined;
    const glyph = ( key: string, name: IconName ) => isPending( key )
        ? <Icon name="spinner" size={ 20 } className="bm-svg-animate" />
        : <Icon name={ name } size={ 20 } />;
    const controlsRef = useRef<HTMLDivElement>(null);

    const configAvailable = useConfigAvailable();
    const cameraDevices = useCameras();
    const microphoneDevices = useMicrophones();
    const speakerDevices = useSpeakers();

    const localParticipant = participants.has('me') ? participants.get('me') : null;
    // Someone who only listens has no tile of their own, and sends nothing to measure: connected, they read as good.
    const quality = localParticipant ? localParticipant.quality : connectionState === 'connected' ? 'good' : 'connecting';

    // Every picture this page gets, paused by the media server for its download: the call says so once, beside the
    // tiles that each say it (group-video-grid-item.tsx). Sound is never paused for it.
    const received: boolean[] = [];
    participants.forEach( ( participant, key ) => {
        if( key === 'me' || participant.reconnecting ) return;
        if( participant.video ) received.push( !! participant.videoPaused );
        if( participant.screen ) received.push( !! participant.screenPaused );
    } );
    const allPaused = useHeld( connectionState === 'connected' && received.length > 0 && received.every( Boolean ), PAUSED_NOTICE_MS );
    const status = statusMessage || ( allPaused ? _x('Your connection is weak: videos are paused, sound continues.', 'Group Video Chat', 'bp-better-messages') : '' );

    useEffect(() => {
        if( ! canPublish ){
            if( myCameraTrackRef.current ){
                disableCamera();
            }

            if( myMicrophoneTrackRef.current ){
                disableMic();
            }

            if( myScreenVideoTrackRef.current ) {
                disableShareScreen();
            }
        }
    }, [ canPublish ])

    useEffect(() => {
        if( myMicMuted && myMicrophoneTrackRef.current ){
            disableMic();
        }
    }, [ myMicMuted ])

    return (<div className="bm-group-call-container bm-call-container" style={{display: "block"}}>
        <GroupVideoGrid />

        <Piece name="CallStatus" props={ { layout: 'group-video', action, text: status, duration: callDurationRef?.current ?? 0 } }>
            { status && <div className="bm-group-call-status" role="status" part="call-status">{ status }</div> }
        </Piece>

            <div ref={controlsRef} className="bm-group-call-controls-v2" part="call-controls">
                { configOpen === true &&
                    <div className="bm-call-settings">
                        <DeviceSwitch label={_x('Camera', 'Media Inputs', 'bp-better-messages')} devices={cameraDevices} selectedDevice={activeCameraDevice} setSelectedDevice={setSelectedCameraDevice} />
                        <DeviceSwitch label={_x('Microphone', 'Media Inputs', 'bp-better-messages')} devices={microphoneDevices} selectedDevice={selectedMicrophoneDevice} setSelectedDevice={setSelectedMicrophoneDevice} />
                        <DeviceSwitch label={_x('Speaker', 'Media Inputs', 'bp-better-messages')} devices={speakerDevices} selectedDevice={selectedSpeakerDevice} setSelectedDevice={setSelectedSpeakerDevice} />
                    </div>
                }
                { addOpen && <AddPersonPanel close={ () => setAddOpen( false ) } /> }
                <ConnectionStatus state={connectionState} quality={quality}></ConnectionStatus>

                <CallDock className="bm-group-call-controls-buttons" pinned={ 1 }>
                    {/* Show / hide the conversation beside the call. First,
                        so it is the last to fold into More, and in the dock
                        so nothing on the stage can sit under it. Not in full
                        screen, which the chat is outside of, and not in the
                        single-column layout, whose handle on the call's edge
                        does this (_call-surface.scss). */}
                    { ( chatToggle && ! fullScreenEnabled ) &&
                        <Tooltip content={ chatShown ? _x('Hide Chat', 'Call Controls', 'bp-better-messages') : _x('Show Chat', 'Call Controls', 'bp-better-messages') }>
                            <span onClick={ () => chatToggle( ( shown: boolean ) => ! shown ) } className="bm-toggle-chat" data-active={ chatShown ? 1 : undefined }>
                                <Icon name="thread" size={ 20 } />
                            </span>
                        </Tooltip>
                    }
                    { connectionState === 'connected' &&
                        <>
                            { configAvailable &&
                                <Tooltip content={_x('Configure', 'Group Video Chat', 'bp-better-messages')}>
                                    <span onClick={() => { setConfigOpen(!configOpen) }} className="bm-configure-call">
                                        <Icon name="settings" size={ 20 } />
                                    </span>
                                </Tooltip>
                            }

                            <AddPersonButton open={ addOpen } setOpen={ setAddOpen } />

                            { canPublish && <>
                                { myCameraTrack &&
                                    <Tooltip content={_x('Disable Camera', 'Group Video Chat', 'bp-better-messages')}>
                                    <span onClick={disableCamera} className="bm-disable-video">
                                        {! iconsReverted && <Icon name="videoOff" size={ 20 } />}
                                        { iconsReverted && <Icon name="video" size={ 20 } />}
                                    </span>
                                    </Tooltip>}

                                { ! myCameraTrack &&
                                    <Tooltip content={_x('Enable Camera', 'Group Video Chat', 'bp-better-messages')}>
                                        <span onClick={enableCamera} className="bm-enable-video">
                                            { ! iconsReverted && <Icon name="video" size={ 20 } />}
                                            { iconsReverted && <Icon name="videoOff" size={ 20 } />}
                                        </span>
                                    </Tooltip>}
                            </>}

                            { ( canPublish && ! myMicMuted ) &&
                                <>
                                    { myMicrophoneTrack &&
                                        <Tooltip content={_x('Disable Microphone', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={disableMic} className="bm-disable-mic">
                                                { ! iconsReverted && <Icon name="micOff" size={ 20 } />}
                                                { iconsReverted && <Icon name="mic" size={ 20 } />}
                                            </span>
                                        </Tooltip>
                                    }
                                    {! myMicrophoneTrack &&
                                        <Tooltip content={_x('Enable Microphone', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={enableMic} className="bm-enable-mic">
                                                { ! iconsReverted && <Icon name="mic" size={ 20 } />}
                                                { iconsReverted && <Icon name="micOff" size={ 20 } />}
                                            </span>
                                        </Tooltip>
                                    }
                                </>
                            }

                            { fullScreenAvailable &&
                                <>
                                    { ! fullScreenEnabled &&
                                        <Tooltip content={_x('Switch to Full Screen Mode', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={ enableFullScreen } className="bm-fs-enable">
                                                <Icon name="maximize" size={ 20 } />
                                            </span>
                                        </Tooltip>
                                    }
                                    { fullScreenEnabled &&
                                        <Tooltip content={_x('Exit Full Screen Mode', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={ disableFullScreen } className="bm-fs-disable">
                                                <Icon name="minimize" size={ 20 } />
                                            </span>
                                        </Tooltip>
                                    }
                                </>
                            }

                            { ( canPublish && screenShareSupport ) &&
                                <>
                                    { ! myScreenVideoTrack &&
                                        <Tooltip content={_x('Share Screen', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={enableShareScreen} className="bm-switch-share-screen">
                                                <Icon name="screenShare" size={ 20 } />
                                            </span>
                                        </Tooltip>
                                    }

                                    { myScreenVideoTrack &&
                                        <Tooltip content={_x('Stop Screen Sharing', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={disableShareScreen} className="bm-switch-share-screen" data-active="1">
                                                <Icon name="screenShareOff" size={ 20 } />
                                            </span>
                                        </Tooltip>
                                    }
                                </>
                            }

                            { ( callMode === 'broadcast' && ! canPublish && ! adminMode ) && <>
                                { ! myHandRaised &&
                                    <Tooltip content={_x('Raise Hand', 'Group Video Chat', 'bp-better-messages')}>
                                        <span onClick={() => run( 'own-hand', raiseHand )} data-busy={ busy( 'own-hand' ) } className="bm-raise-hand">
                                            { glyph( 'own-hand', 'raisehand' ) }
                                        </span>
                                    </Tooltip>
                                }
                                { myHandRaised &&
                                    <Tooltip content={_x('Lower Hand', 'Group Video Chat', 'bp-better-messages')}>
                                        <span onClick={() => run( 'own-hand', raiseHand )} data-busy={ busy( 'own-hand' ) } className="bm-lower-hand bm-hand-active">
                                            { glyph( 'own-hand', 'raisehand' ) }
                                        </span>
                                    </Tooltip>
                                }
                            </> }

                            { adminMode &&
                                <>
                                    {/* One button on the state the room is
                                        actually in, the way the lock beneath
                                        it is drawn. Muting everyone is a rule
                                        the room keeps — a transient the join
                                        route reports back as `roomMuted` — so
                                        a moderator who walks into a room
                                        somebody else muted is offered the way
                                        out of it, which drawing the pair from
                                        a local flag never managed. */}
                                    { ! roomMuted && moderates( moderation, 'mute_all' ) &&
                                        <Tooltip content={_x('Mute All', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={() => run( 'room-mute', async () => {
                                                try {
                                                    await moderate({ act: 'mute_all', type: callInfo.type });
                                                    setRoomMuted(true);
                                                } catch (e) { host().showError(e); }
                                            } )} data-busy={ busy( 'room-mute' ) } className="bm-mute-all">
                                                { glyph( 'room-mute', 'micOff' ) }
                                            </span>
                                        </Tooltip>
                                    }
                                    { roomMuted && moderates( moderation, 'unmute_all' ) &&
                                        <Tooltip content={_x('Unmute All', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={() => run( 'room-mute', async () => {
                                                try {
                                                    await moderate({ act: 'unmute_all', type: callInfo.type });
                                                    setRoomMuted(false);
                                                } catch (e) { host().showError(e); }
                                            } )} data-busy={ busy( 'room-mute' ) } className="bm-unmute-all">
                                                { glyph( 'room-mute', 'mic' ) }
                                            </span>
                                        </Tooltip>
                                    }

                                    { ! roomLocked && moderates( moderation, 'lock_room' ) &&
                                        <Tooltip content={_x('Lock Room', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={() => run( 'room-lock', async () => {
                                                try {
                                                    await moderate({ act: 'lock_room', type: callInfo.type });
                                                    setRoomLocked(true);
                                                } catch (e) { host().showError(e); }
                                            } )} data-busy={ busy( 'room-lock' ) } className="bm-lock-room">
                                                { glyph( 'room-lock', 'lockOpen' ) }
                                            </span>
                                        </Tooltip>
                                    }
                                    { roomLocked && moderates( moderation, 'unlock_room' ) &&
                                        <Tooltip content={_x('Unlock Room', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={() => run( 'room-lock', async () => {
                                                try {
                                                    await moderate({ act: 'unlock_room', type: callInfo.type });
                                                    setRoomLocked(false);
                                                } catch (e) { host().showError(e); }
                                            } )} data-busy={ busy( 'room-lock' ) } className="bm-unlock-room">
                                                { glyph( 'room-lock', 'lock' ) }
                                            </span>
                                        </Tooltip>
                                    }

                                    { callMode === 'broadcast' && Array.from(participants.values()).some(p => p.handRaised) &&
                                        <Tooltip content={_x('Lower All Hands', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={() => run( 'hands', lowerAllHands )} data-busy={ busy( 'hands' ) } className="bm-lower-all-hands">
                                                { glyph( 'hands', 'raisehand' ) }
                                            </span>
                                        </Tooltip>
                                    }

                                    { callMode === 'participatory' &&
                                        <Tooltip content={_x('Switch to Broadcast Mode', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={() => run( 'mode', () => setCallMode('broadcast') )} data-busy={ busy( 'mode' ) } className="bm-set-broadcast-mode">
                                                { glyph( 'mode', 'megaphone' ) }
                                            </span>
                                        </Tooltip>
                                    }
                                    { callMode === 'broadcast' &&
                                        <Tooltip content={_x('Switch to Participatory Mode', 'Group Video Chat', 'bp-better-messages')}>
                                            <span onClick={() => run( 'mode', () => setCallMode('participatory') )} data-busy={ busy( 'mode' ) } className="bm-set-participatory-mode">
                                                { glyph( 'mode', 'users' ) }
                                            </span>
                                        </Tooltip>
                                    }
                                </>
                            }
                        </>
                    }
                    <Tooltip content={_x('Exit Chat', 'Group Video Chat', 'bp-better-messages')}>
                        <span onClick={ () => endCall() } className="bm-exit-room">
                            <Icon name="logout" size={ 20 } />
                        </span>
                    </Tooltip>
                </CallDock>
            </div>
        </div>
    )
}
