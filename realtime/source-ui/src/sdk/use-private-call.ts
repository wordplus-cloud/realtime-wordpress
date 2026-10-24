import { useEffect, useMemo, useRef, useState } from "react";
import type { CallAction, CallContextInterface, CallParticipant } from "../components/calls/context.ts";
import { callInfoDefaults } from "../components/calls/context.ts";
import { _x } from "../inc/globals.ts";
import { setUiUsers } from "../host.ts";
import { useLocalMedia } from "./local-media.ts";
import { useFullScreen } from "./fullscreen.ts";
import { remoteTrack } from "./tracks.ts";
import type { SdkCall, SdkRemoteMedia } from "./types.ts";

/** What the private call screen shows of someone, as Better Messages' participants are. */
export function blankParticipant( identity: string, name = '', avatar = '' ): CallParticipant {
    return {
        identity, name, avatar, link: '', audioLevel: 0, isSpeaking: false, isPinned: false, quality: 'unknown',
        video: null, videoPub: null, audio: null, audioPub: null, screen: null, screenPub: null, screenAudio: null,
        screenAudioPub: null, canPublish: true, canAdmin: false, handRaised: false, micMuted: false,
    };
}

const noModeration = () => Promise.reject( Object.assign( new Error( 'not_moderated' ), { code: 'not_moderated' } ) );

/**
 * A call between two people made with the SDK (`calls.start()`, or an incoming call accepted), as the private call
 * screen reads it: ringing out, connecting, then connected with the other side's pictures and sound, this page's
 * camera, microphone and screen, and its end. `close` is called once it is over, with what to say about it, if
 * anything.
 */
export function usePrivateCall(
    call: SdkCall,
    peer: { name: string; avatar?: string },
    close: ( notice: string | null ) => void,
    adding: Pick<CallContextInterface, 'people' | 'addPerson'> = {},
): CallContextInterface {
    const wrapper = useRef<HTMLDivElement | null>( null );
    const media = useLocalMedia( ( source, track ) => call.setTrack( source, track ) );
    const full = useFullScreen( wrapper );
    const peerKey = 'user_' + call.peer.user;

    useEffect( () => {
        setUiUsers( [ [ call.peer.user, { name: peer.name, avatar: peer.avatar } ] ] );
    }, [ call.peer.user, peer.name, peer.avatar ] );

    const actionOf = ( state: SdkCall[ 'state' ] ): CallAction =>
        state === 'ringing' ? 'outgoing_call' : state === 'connecting' ? 'connecting' : 'call_in_progress';

    const [ action, setAction ] = useState<CallAction>( actionOf( call.state ) );
    const [ remote, setRemote ] = useState<SdkRemoteMedia>( call.remote );
    const [ statusMessage, setStatusMessage ] = useState( '' );
    const callDurationRef = useRef( 0 );
    const connectedAt = useRef<number | null>( null );
    const zero = useRef( 0 );

    useEffect( () => {
        const onState = ( state: SdkCall[ 'state' ] ) => {
            if ( state === 'ended' ) return;
            setAction( actionOf( state ) );
            if ( state === 'connected' ) {
                connectedAt.current ??= Date.now();
                setStatusMessage( '' );
            }
            if ( state === 'connecting' ) setStatusMessage( _x( 'Connecting...', 'Call Screen', 'bp-better-messages' ) );
            if ( state === 'reconnecting' ) setStatusMessage( _x( 'Connecting...', 'Call Screen', 'bp-better-messages' ) );
        };
        const onRemote = ( next: SdkRemoteMedia ) => setRemote( { ...next } );
        const onWaiting = () => setStatusMessage( _x( 'Waiting for a free place in the call...', 'Call Screen', 'bp-better-messages' ) );
        const onEnded = ( reason: string ) => {
            media.stopAll();
            // A call that became a group call goes on there: the window that holds it opens the group call.
            if ( reason === 'group' ) return;
            close( noticeFor( reason ) );
        };

        call.on( 'state', onState );
        call.on( 'remote', onRemote );
        call.on( 'waiting', onWaiting );
        call.on( 'ended', onEnded );
        if ( call.state === 'ended' ) onEnded( call.endReason ?? 'hangup' );

        // What a call starts with: the microphone, and the camera on a video call, asked for together so the browser
        // asks once.
        void ( call.type === 'video' ? media.enableMicAndCamera() : media.enableMic() );

        const tick = window.setInterval( () => {
            callDurationRef.current = connectedAt.current === null ? 0 : Date.now() - connectedAt.current;
        }, 250 );

        return () => {
            window.clearInterval( tick );
            call.off( 'state', onState );
            call.off( 'remote', onRemote );
            call.off( 'waiting', onWaiting );
            call.off( 'ended', onEnded );
        };
    }, [ call ] );

    const participants = useMemo( () => {
        const other = blankParticipant( peerKey, peer.name, peer.avatar ?? '' );
        other.video = remoteTrack( remote.camera );
        other.audio = remoteTrack( remote.microphone );
        other.screen = remoteTrack( remote.screen );
        other.screenAudio = remoteTrack( remote.screenAudio );
        other.micMuted = ! remote.media.microphone;
        other.quality = remote.quality;

        return new Map<string, CallParticipant>( [ [ 'me', blankParticipant( 'me' ) ], [ peerKey, other ] ] );
    }, [ remote, peerKey, peer.name, peer.avatar ] );

    const participantsRef = useRef( participants );
    participantsRef.current = participants;

    const endCall = async () => {
        call.end();
        media.stopAll();
        close( null );
    };

    return {
        wrapper,
        thread: { thread_id: 0, participants: [ call.peer.user ] },
        callInfo: { ...callInfoDefaults, type: call.type, user_ids: [ call.peer.user ] },
        adminMode: false,
        canPublish: true,
        statusMessage,
        participants,
        participantsRef,
        action,
        errorMessages: [],
        callDurationRef,
        bytesReceivedRef: zero,
        bytesSentRef: zero,
        connectionState: action === 'call_in_progress' ? 'connected' : 'connecting',
        endCall,
        answerCall: async () => true,
        activeCameraDevice: media.activeCameraDevice,
        setActiveCameraDevice: media.setActiveCameraDevice,
        selectedCameraDevice: media.selectedCameraDevice,
        setSelectedCameraDevice: media.setSelectedCameraDevice,
        selectedMicrophoneDevice: media.selectedMicrophoneDevice,
        setSelectedMicrophoneDevice: media.setSelectedMicrophoneDevice,
        selectedSpeakerDevice: media.selectedSpeakerDevice,
        setSelectedSpeakerDevice: media.setSelectedSpeakerDevice,
        ...full,
        myCameraTrack: media.camera,
        myCameraTrackRef: media.cameraRef,
        myMicrophoneTrack: media.microphone,
        myMicrophoneTrackRef: media.microphoneRef,
        myScreenVideoTrack: media.screen,
        myScreenVideoTrackRef: media.screenRef,
        switchingCamera: media.switchingCamera,
        switchCamera: media.switchCamera,
        enableCamera: media.enableCamera,
        disableCamera: media.disableCamera,
        enableMic: media.enableMic,
        disableMic: media.disableMic,
        enableShareScreen: media.enableShareScreen,
        disableShareScreen: media.disableShareScreen,
        roomLocked: false,
        setRoomLocked: () => {},
        roomMuted: false,
        setRoomMuted: () => {},
        raiseHand: async () => {},
        lowerHand: async () => {},
        lowerAllHands: async () => {},
        myHandRaised: false,
        myMicMuted: false,
        callMode: 'participatory',
        setCallMode: async () => {},
        promoteParticipant: async () => {},
        demoteParticipant: async () => {},
        moderate: noModeration,
        ...adding,
        iconsReverted: false,
    } as CallContextInterface;
}

/** What to say once a call ends, by the reason the relay or the call gave: nothing for a hang-up. */
export function noticeFor( reason: string ): string | null {
    switch ( reason ) {
        case 'rejected':
        case 'declined':
            return _x( 'User rejected your call', 'Private Call Screen', 'bp-better-messages' );
        case 'busy':
            return _x( 'The user is busy in another call', 'Private Call Screen', 'bp-better-messages' );
        case 'no_answer':
            return _x( 'The user did not answer', 'Private Call Screen', 'bp-better-messages' );
        case 'answered_elsewhere':
            return _x( 'This call was answered on another device', 'Private Call Screen', 'bp-better-messages' );
        case 'peer_lost':
        case 'room_lost':
            return _x( 'The other side did not reconnect', 'Call Screen', 'bp-better-messages' );
        // The server refused to start it, or the page's connection was down; or it became a group call whose room
        // this page couldn't join, or this browser can't encrypt a room's media.
        case 'not_started':
        case 'not_included':
        case 'forbidden':
        case 'bad_token':
        case 'expired':
        case 'signaling_unavailable':
        case 'connection_failed':
        case 'group_failed':
        case 'encryption_unsupported':
            return _x( 'This call could not be connected', 'Call Screen', 'bp-better-messages' );
        default:
            return null;
    }
}
