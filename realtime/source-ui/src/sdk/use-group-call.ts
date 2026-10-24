import { useEffect, useMemo, useRef, useState } from "react";
import type { CallConnectionState, CallContextInterface, CallParticipant } from "../components/calls/context.ts";
import { callInfoDefaults } from "../components/calls/context.ts";
import { _x } from "../inc/globals.ts";
import { configureUi, host, setUiUsers } from "../host.ts";
import { useLocalMedia } from "./local-media.ts";
import { useFullScreen } from "./fullscreen.ts";
import { remoteTrack } from "./tracks.ts";
import { blankParticipant } from "./use-private-call.ts";
import { infoOf, type SdkCallPermissions, type SdkGroupCall, type SdkModerationAct, type SdkPerson } from "./types.ts";
import type { CallModeration } from "../components/calls/context.ts";

const notModerated = () => Object.assign( new Error( 'not_moderated' ), { code: 'not_moderated' } );
const noModeration = () => Promise.reject( notModerated() );

/**
 * Better Messages' moderator controls a host of an SDK group call gets on the others' tiles, and what each asks of the
 * app's calls route (group.moderate()), which asks the call's rule again: remove, make a listener, let speak, and mute a
 * microphone, which only its owner turns on again. No others: the cloud pins, locks and mutes no room for everyone.
 */
const ACTS: Record<string, SdkModerationAct> = { remove_participant: 'remove', mute_participant: 'listen', unmute_participant: 'speak', mute_mic: 'mute' };
const MODERATION = Object.keys( ACTS );

/** Whether this page hosts the call: its rule's `admin`, on a call whose client takes a host's acts. */
const hosts = ( group: SdkGroupCall, can: SdkCallPermissions | undefined ) => !! can?.admin && typeof group.moderate === 'function';

/**
 * A group call made with the SDK (`calls.group()`, a call that became one, or a ring into one accepted), as the group
 * video grid and the group audio roster read it: everyone in its room with their pictures and sound and who speaks,
 * this page's own tile, its camera, microphone and screen, and leaving. `close` is called once it is over.
 */
export function useGroupCall(
    group: SdkGroupCall,
    type: 'audio' | 'video',
    close: ( notice: string | null ) => void,
    adding: Pick<CallContextInterface, 'people' | 'addPerson'> = {},
): CallContextInterface {
    const wrapper = useRef<HTMLDivElement | null>( null );
    const media = useLocalMedia( ( source, track ) => group.setTrack( source, track ) );
    const full = useFullScreen( wrapper );

    const [ people, setPeople ] = useState<SdkPerson[]>( () => group.people() );
    // This page's own user, for the name and picture on their own tile (an SDK review, 2026-10-14: it had neither).
    const [ self, setSelf ] = useState<SdkPerson | null>( () => group.self ?? null );
    const [ state, setState ] = useState<SdkGroupCall[ 'state' ]>( group.state );
    const [ statusMessage, setStatusMessage ] = useState( '' );
    // Whether this page may send: someone who only listens (the rule's `publish: false`) has no camera, microphone or
    // tile of their own until the app server lets them speak (`permit`), and none again if it takes that back.
    const [ canPublish, setCanPublish ] = useState( () => group.can?.publish !== false );
    const [ admin, setAdmin ] = useState( () => hosts( group, group.can ) );
    const startedAt = useRef( Date.now() );
    const callDurationRef = useRef( 0 );
    const zero = useRef( 0 );

    useEffect( () => {
        const refresh = () => {
            setPeople( [ ...group.people() ] );
            setSelf( group.self ?? null );
        };
        const onState = ( next: SdkGroupCall[ 'state' ] ) => {
            setState( next );
            if ( next === 'connected' ) setSelf( group.self ?? null );
            setStatusMessage( next === 'connecting' || next === 'reconnecting' ? _x( 'Connecting...', 'Call Screen', 'bp-better-messages' ) : '' );
        };
        const onWaiting = () => setStatusMessage( _x( 'Waiting for a free place in the call...', 'Call Screen', 'bp-better-messages' ) );
        const onError = ( error: { code?: string } ) => host().showError( error?.code ?? error );
        const onPermissions = ( can: SdkCallPermissions ) => {
            setCanPublish( can?.publish !== false );
            setAdmin( hosts( group, can ) );
        };
        const onEnded = ( reason: string ) => {
            media.stopAll();
            // Taken out by the app server (remove()): said, as the window just went before (an SDK review, 2026-10-14).
            close( reason === 'removed' ? _x( 'You were removed from this call', 'Call Screen', 'bp-better-messages' )
                : reason === 'encryption_unsupported' ? _x( 'This call could not be connected', 'Call Screen', 'bp-better-messages' ) : null );
        };

        group.on( 'person', refresh );
        group.on( 'person_left', refresh );
        group.on( 'speakers', refresh );
        group.on( 'state', onState );
        group.on( 'waiting', onWaiting );
        group.on( 'error', onError );
        group.on( 'ended', onEnded );
        group.on( 'permissions', onPermissions );
        onState( group.state );
        refresh();

        // A listener starts with nothing on: what they may not send, they never ask the browser for.
        if ( group.can?.publish !== false ) {
            // On a video call, the camera asked for with the microphone, so the browser asks once.
            void ( type === 'video' ? media.enableMicAndCamera() : media.enableMic() );
        }

        const tick = window.setInterval( () => {
            callDurationRef.current = Date.now() - startedAt.current;
        }, 250 );

        return () => {
            window.clearInterval( tick );
            group.off( 'person', refresh );
            group.off( 'person_left', refresh );
            group.off( 'speakers', refresh );
            group.off( 'state', onState );
            group.off( 'waiting', onWaiting );
            group.off( 'error', onError );
            group.off( 'ended', onEnded );
            group.off( 'permissions', onPermissions );
        };
    }, [ group ] );

    // The grids name each tile from the host's users: everyone's name and picture as the site's tokens gave them.
    // Their own name on their tile: the grids read it as the current user's, which the SDK screens learn here.
    useEffect( () => {
        if ( ! self || self.user === null ) return;
        const user = self.user;
        const info = infoOf( self.info );
        setUiUsers( [ [ user, { name: info.name ?? '', avatar: info.avatar } ] ] );
        configureUi( { currentUserId: () => user } );
    }, [ self ] );

    useEffect( () => {
        setUiUsers( people.filter( ( person ) => person.user !== null ).map( ( person ) => {
            const info = infoOf( person.info );
            return [ person.user as number, { name: info.name ?? '', avatar: info.avatar } ];
        } ) );
    }, [ people ] );

    const participants = useMemo( () => {
        const map = new Map<string, CallParticipant>();
        if ( canPublish ) {
            const own = infoOf( self?.info );
            const me = blankParticipant( 'me', own.name ?? '', own.avatar ?? '' );
            me.video = media.camera;
            me.audio = media.microphone;
            me.screen = media.screen;
            me.quality = 'good';
            map.set( 'me', me );
        }

        for ( const person of people ) {
            const info = infoOf( person.info );
            const key = person.user !== null ? 'user_' + person.user : person.identity;
            const tile = blankParticipant( person.identity, info.name ?? '', info.avatar ?? '' );
            tile.video = remoteTrack( person.camera );
            tile.audio = remoteTrack( person.microphone );
            tile.screen = remoteTrack( person.screen );
            tile.screenAudio = remoteTrack( person.screenAudio );
            tile.isSpeaking = person.speaking;
            tile.audioLevel = person.speaking ? 0.4 : 0;
            tile.micMuted = ! person.microphone;
            tile.canPublish = person.publish !== false;
            tile.videoPaused = !! person.cameraPaused;
            tile.screenPaused = !! person.screenPaused;
            tile.quality = 'good';
            map.set( key, tile );
        }

        return map;
    }, [ people, self, canPublish, media.camera, media.microphone, media.screen ] );

    const participantsRef = useRef( participants );
    participantsRef.current = participants;

    const connectionState: CallConnectionState = state === 'connected' ? 'connected' : state === 'reconnecting' ? 'reconnecting' : state === 'ended' ? 'disconnected' : 'connecting';

    // A tile names its person by their identity (the video grid) or their key, user_<id> (the audio roster).
    const moderate = async ( request: CallModeration ) => {
        const act = ACTS[ request.act ];
        const person = people.find( ( p ) => p.identity === request.identity || ( p.user !== null && 'user_' + p.user === request.identity ) );
        if ( ! act || ! person || person.user === null || ! group.moderate ) throw notModerated();
        return group.moderate( act, person.user );
    };

    const endCall = async () => {
        group.leave();
        media.stopAll();
        close( null );
    };

    return {
        wrapper,
        thread: { thread_id: 0, participants: [] },
        callInfo: { ...callInfoDefaults, type },
        adminMode: admin,
        canPublish,
        statusMessage,
        participants,
        participantsRef,
        action: 'call_in_progress',
        errorMessages: [],
        callDurationRef,
        bytesReceivedRef: zero,
        bytesSentRef: zero,
        connectionState,
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
        moderate: admin ? moderate : noModeration,
        moderation: MODERATION,
        ...adding,
        iconsReverted: false,
    } as CallContextInterface;
}
