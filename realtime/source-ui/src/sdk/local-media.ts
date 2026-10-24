import { useEffect, useRef, useState } from "react";
import useStateRef from "../inc/hooks/state-ref.ts";
import { updateMediaPermissions } from "../inc/calls/permissions.ts";
import { getPermissionFailure } from "../inc/device-error.ts";
import { _x } from "../inc/globals.ts";
import { host } from "../host.ts";
import { localTrack } from "./tracks.ts";
import type { SdkMediaSource } from "./types.ts";

export type LocalTrack = ReturnType<typeof localTrack>;

// the size and frames a camera is opened at (useLocalMedia's constraints)
export const CAMERA_SIZE = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } as const;

/**
 * What this page sends in a call made with the SDK: its camera, microphone and screen, opened on the devices the call
 * screen's switches pick, each handed to the call (`send`) as it opens and taken back as it closes. Better Messages'
 * call container does the same with LiveKit's tracks; the SDK's calls take the browser's.
 */
export function useLocalMedia( send: ( source: SdkMediaSource, track: MediaStreamTrack | null ) => void | Promise<void> ) {
    const [ camera, setCamera, cameraRef ] = useStateRef<LocalTrack | null>( null );
    const [ microphone, setMicrophone, microphoneRef ] = useStateRef<LocalTrack | null>( null );
    const [ screen, setScreen, screenRef ] = useStateRef<LocalTrack | null>( null );
    const screenAudio = useRef<MediaStreamTrack | null>( null );

    const [ activeCameraDevice, setActiveCameraDevice ] = useState( '' );
    const [ selectedCameraDevice, setSelectedCameraDevice ] = useState( '' );
    const [ selectedMicrophoneDevice, setSelectedMicrophoneDevice ] = useState( '' );
    const [ selectedSpeakerDevice, setSelectedSpeakerDevice ] = useState( '' );
    const [ switchingCamera, setSwitchingCamera ] = useState( false );
    const facing = useRef<'user' | 'environment'>( 'user' );
    const opening = useRef( { camera: false, microphone: false, screen: false } );
    const ended = useRef( false );

    const failed = ( error: unknown, kind: 'camera' | 'microphone' ) => {
        host().showError( getPermissionFailure( error, kind === 'camera'
            ? _x( 'Camera', 'Media Inputs', 'bp-better-messages' )
            : _x( 'Microphone', 'Media Inputs', 'bp-better-messages' ) ) );
    };

    // What the browser is asked for: the device picked in the switches, else the camera facing the user and the default
    // microphone; a camera at up to 1080p and 30 frames, as Better Messages' call opens one (tracks.ts, LiveKit's
    // h1080), which the call's encoder lowers where it can't keep up (realtime-client's fitCameraTrack). Asked for no
    // size, Chrome opens 640x480, and the SDK's calls went out at 480p (the review after the move to the mesh,
    // 2026-10-21).
    const constraints = ( kind: 'camera' | 'microphone' ): MediaTrackConstraints | true => {
        const device = kind === 'camera' ? selectedCameraDevice : selectedMicrophoneDevice;
        if ( kind === 'microphone' ) return device ? { deviceId: { exact: device } } : true;
        return { ...( device ? { deviceId: { exact: device } } : { facingMode: facing.current } ), ...CAMERA_SIZE };
    };

    const open = async ( kind: 'camera' | 'microphone' ): Promise<MediaStreamTrack> => {
        const stream = await navigator.mediaDevices.getUserMedia( kind === 'camera'
            ? { video: constraints( 'camera' ) }
            : { audio: constraints( 'microphone' ) } );
        return stream.getTracks()[ 0 ];
    };

    // A track opened, handed to the call, unless the call ended meanwhile.
    const takeCamera = async ( track: MediaStreamTrack ) => {
        if ( ended.current ) return void track.stop();
        setActiveCameraDevice( track.getSettings().deviceId ?? '' );
        setCamera( localTrack( track ) );
        await send( 'camera', track );
    };

    const takeMicrophone = async ( track: MediaStreamTrack ) => {
        if ( ended.current ) return void track.stop();
        setMicrophone( localTrack( track ) );
        await send( 'microphone', track );
    };

    const enableCamera = async () => {
        if ( cameraRef.current || opening.current.camera || ended.current ) return;
        opening.current.camera = true;
        try {
            await takeCamera( await open( 'camera' ) );
        } catch ( error ) {
            failed( error, 'camera' );
        } finally {
            opening.current.camera = false;
            void updateMediaPermissions();
        }
    };

    const disableCamera = async () => {
        const current = cameraRef.current;
        if ( ! current ) return;
        current.track.stop();
        setCamera( null );
        await send( 'camera', null );
    };

    const enableMic = async () => {
        if ( microphoneRef.current || opening.current.microphone || ended.current ) return;
        opening.current.microphone = true;
        try {
            await takeMicrophone( await open( 'microphone' ) );
        } catch ( error ) {
            failed( error, 'microphone' );
        } finally {
            opening.current.microphone = false;
            void updateMediaPermissions();
        }
    };

    /**
     * The microphone and the camera together, as a video call starts: one request, so the browser asks once for both.
     * Refused, it says so once and asks no more: the call's switches ask for either again. When it can't be met
     * otherwise (no camera, say), each is asked for alone, and says what went wrong with it.
     */
    const enableMicAndCamera = async () => {
        const busy = opening.current.microphone || opening.current.camera;
        if ( busy || microphoneRef.current || cameraRef.current || ended.current ) {
            await Promise.all( [ enableMic(), enableCamera() ] );
            return;
        }
        opening.current.microphone = opening.current.camera = true;
        let stream: MediaStream | null = null;
        let refused = false;
        try {
            stream = await navigator.mediaDevices.getUserMedia( { audio: constraints( 'microphone' ), video: constraints( 'camera' ) } );
        } catch ( error ) {
            const name = ( error as { name?: string } | null )?.name;
            refused = name === 'NotAllowedError' || name === 'PermissionDeniedError';
            if ( refused ) host().showError( getPermissionFailure( error ) );
        } finally {
            opening.current.microphone = opening.current.camera = false;
            void updateMediaPermissions();
        }
        if ( refused ) return;
        if ( ! stream ) {
            await enableMic();
            await enableCamera();
            return;
        }
        // A track the stream came without is asked for alone.
        const [ microphone ] = stream.getAudioTracks();
        const [ camera ] = stream.getVideoTracks();
        await ( microphone ? takeMicrophone( microphone ).catch( ( error ) => failed( error, 'microphone' ) ) : enableMic() );
        await ( camera ? takeCamera( camera ).catch( ( error ) => failed( error, 'camera' ) ) : enableCamera() );
    };

    const disableMic = async () => {
        const current = microphoneRef.current;
        if ( ! current ) return;
        current.track.stop();
        setMicrophone( null );
        await send( 'microphone', null );
    };

    const disableShareScreen = async () => {
        const current = screenRef.current;
        if ( current ) {
            current.track.stop();
            setScreen( null );
            await send( 'screen_share', null );
        }
        if ( screenAudio.current ) {
            screenAudio.current.stop();
            screenAudio.current = null;
            await send( 'screen_share_audio', null );
        }
    };

    const enableShareScreen = async () => {
        if ( screenRef.current || opening.current.screen || ended.current ) return;
        opening.current.screen = true;
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia( { video: true, audio: true } );
            const video = stream.getVideoTracks()[ 0 ];
            const audio = stream.getAudioTracks()[ 0 ] ?? null;
            if ( ended.current ) return void stream.getTracks().forEach( ( track ) => track.stop() );
            // The browser's own "Stop sharing" ends it too.
            video.addEventListener( 'ended', () => void disableShareScreen() );
            setScreen( localTrack( video ) );
            await send( 'screen_share', video );
            if ( audio ) {
                screenAudio.current = audio;
                await send( 'screen_share_audio', audio );
            }
        } catch {
            // Picking nothing is not an error.
        } finally {
            opening.current.screen = false;
        }
    };

    const switchCamera = async () => {
        setSwitchingCamera( true );
        facing.current = facing.current === 'user' ? 'environment' : 'user';
        setSelectedCameraDevice( '' );
        setActiveCameraDevice( '' );
        try {
            await disableCamera();
            await enableCamera();
        } finally {
            setSwitchingCamera( false );
        }
    };

    // A device picked in the call screen's switches: opened in place of the one before, while that one is on.
    const reopen = async ( kind: 'camera' | 'microphone' ) => {
        if ( kind === 'camera' && cameraRef.current ) {
            await disableCamera();
            await enableCamera();
        }
        if ( kind === 'microphone' && microphoneRef.current ) {
            await disableMic();
            await enableMic();
        }
    };

    const firstCamera = useRef( true );
    useEffect( () => {
        if ( firstCamera.current ) return void ( firstCamera.current = false );
        void reopen( 'camera' );
    }, [ selectedCameraDevice ] );

    const firstMicrophone = useRef( true );
    useEffect( () => {
        if ( firstMicrophone.current ) return void ( firstMicrophone.current = false );
        void reopen( 'microphone' );
    }, [ selectedMicrophoneDevice ] );

    /** Stops everything this page sends, for good: the call is over. */
    const stopAll = () => {
        ended.current = true;
        for ( const held of [ cameraRef.current, microphoneRef.current, screenRef.current ] ) held?.track.stop();
        screenAudio.current?.stop();
    };

    // Mounted again after React's Strict Mode rehearses an unmount (a Next.js or Vite app in development): the call is
    // still on, and what was opening before the rehearsal is handed to the call once it opens.
    useEffect( () => {
        ended.current = false;
        return () => stopAll();
    }, [] );

    return {
        camera, cameraRef, microphone, microphoneRef, screen, screenRef,
        activeCameraDevice, setActiveCameraDevice, selectedCameraDevice, setSelectedCameraDevice,
        selectedMicrophoneDevice, setSelectedMicrophoneDevice, selectedSpeakerDevice, setSelectedSpeakerDevice,
        switchingCamera, switchCamera, enableCamera, disableCamera, enableMic, disableMic, enableMicAndCamera, enableShareScreen,
        disableShareScreen, stopAll,
    };
}
