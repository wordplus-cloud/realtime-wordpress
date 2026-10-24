/**
 * The call engine every WordPlus product runs: a call between two people over
 * one direct peer connection, through TURN when no direct path works, handed
 * to a room on the mesh when TURN fails too (README.md). The product hands a
 * session its way to the relay (transport.ts); Better Messages and the
 * realtime SDK each have their own.
 */
export {P2PCallSession} from "./session.js";
export type {P2PParticipantView, P2PSessionOptions} from "./session.js";
export {leaveUnjoined} from "./signaling.js";
export {RemoteMediaTrack} from "./remote-track.js";
export {SfuReporter, type ReportableRoom} from "./sfu-report.js";
export {probeCodecCaps, roomPublishCodec} from "./codecs.js";
export type {RoomCodec} from "./codecs.js";
// How a camera and a screen go out into a room: Better Messages', the SDK's group calls and Easy Stream's
export {cameraCodecFor, screenCodecFor, roomCallCodec, roomCallChoice, hardwareFromCaps, backupFor, cameraPublish, cameraMaxHeight, fitCameraTrack, fasterCameraMode, CAMERA_MIN_FPS, screenPublish, screenVideoMode, applyScreenVideoMode, roomPixelDensity, SCREEN_ENCODING, SCREEN_CONTENT_HINT, SCREEN_CONTENT_HINT_SVC, SCREEN_SCALABILITY_MODE_SVC, SCREEN_DEGRADATION, SCREEN_DEGRADATION_VIDEO, DEFAULT_CAMERA_POLICY, DEFAULT_SCREEN_POLICY} from "./room-publish.js";
export type {CameraCodec, CameraCodecCaps, CameraChoice, CameraHardware, CodecPolicy, CallLayer, CameraPublish, ScreenPublish, ScreenVideoMode, ScreenShareTrack} from "./room-publish.js";
// A camera's hardware encoder that drops frames, remembered so the next camera goes out in software
export {droppedHardwareCodecs, rememberDroppedHardware, HARDWARE_DROPS_KEY} from "./room-publish.js";
export {watchCameraEncoder, dropsFrames, cpuHeld, readingsFor, hardwareReading, readEncoder, layerEncoders} from "./encoder-watch.js";
export type {EncoderReading, EncoderLayer} from "./encoder-watch.js";
// A camera's codec measured before it goes out, and remembered (one record a codec), for the camera control's spinner too
export {cameraCodecOrder, cameraCodecRecord, cameraCodecRecords, cameraFinding, rememberCameraCodec, droppedCameraCodecs, heavySoftwareCodecs, cameraCheckPassed, browserVersion,
    windowsDesktopChromium, legacyCamera, uncheckedBrowser, knownAdapter, CAMERA_CODECS_KEY, CAMERA_CODEC_KEEP_MS} from "./room-publish.js";
export type {CameraCodecRecord, CameraCodecResult} from "./room-publish.js";
// VP9 in software at 1080 lines once measured able there, else 720, and a call's step down to 720 (1.0.41)
export {choiceHeight, vp9Height, VP9_TOP_HEIGHT, CAMERA_STEP_DOWN_HEIGHT} from "./room-publish.js";
export {fitsLower, CHECK_INFER_HEADROOM} from "./camera-check.js";
export {stepDownCamera, stepsDown} from "./camera-adapt.js";
// The node's say over the check and the moves: its codec policy's rules (which camera order a browser takes) and tune
// (every number), each held to a sane range
export {cameraTune, cameraRules, cameraRuleFor, cameraRuleOrder, cameraEnvironment, gpuMaker, CAMERA_TUNE_DEFAULTS, CAMERA_TUNE_RANGES, DEFAULT_CAMERA_RULES} from "./room-publish.js";
export type {CameraTune, CameraRule, CameraEnvironment, CameraOs, CameraBrowser, CameraGpu, CameraDevice} from "./room-publish.js";
export {checkedCameraChoice, todaysCameraChoice, measureCameraEncoder, judgeEncoder, cameraCheckRunning, onCameraCheck, meshCameraReport, reportMeshCamera, graphicsAdapter,
    CAMERA_CHECK_BUDGET_MS, CAMERA_CHECK_POLL_MS, MESH_CAMERA_SWITCHES} from "./camera-check.js";
export type {CameraCheckVerdict, CheckedCameraChoice, CameraTest, CameraSwitch, MeshCameraReport, CameraCheckOptions, EncoderSample} from "./camera-check.js";
// A camera moved to another codec during a call, with everyone told, and nothing lost
export {CameraSwitchGuard, CameraOptimizing, switchCameraCodec, nextCameraChoice, encodeCameraState, decodeCameraState, CAMERA_STATE_TOPIC,
    CAMERA_SWITCHES_MAX, CAMERA_SWITCH_GAP_MS, CAMERA_SWITCH_WARMUP_MS, CAMERA_REPUBLISH_TIMEOUT_MS, CAMERA_OPTIMIZING_MAX_MS, CAMERA_ANNOUNCE_TIMEOUT_MS} from "./camera-adapt.js";
export type {CameraState, CameraSwitchRefusal, CameraSwitchSteps} from "./camera-adapt.js";
export {setCallPlatform, defaultPlatform, type CallPlatform} from "./platform.js";
// Lip sync in a room: each picture with its own sound, as the browser plays them (Better Messages' calls)
export {syncPair, playoutLag, audioOutputDelay, closeAudioOutput, LIP_SYNC} from "./lip-sync.js";
export type {SyncPair, SyncReceiver, LipSyncState} from "./lip-sync.js";
export type {CallId, CallTransport, RelayMessage} from "./transport.js";
export type {P2PSource, P2PQuality, P2PConnection, P2PStats, SfuHandoff, IceServer, MediaState} from "./types.js";

function transportOverride(): 'p2p' | 'sfu' | null {
    try {
        const value = window.localStorage.getItem( 'bm_call_transport' );

        return value === 'p2p' || value === 'sfu' ? value : null;
    } catch (e) {
        return null;
    }
}

/**
 * Direct is how a call between two people runs. There is no setting for it —
 * a room is where the server puts a call the direct path could not carry, not
 * a choice a site makes — so the only questions left are whether this browser
 * can hold a peer connection at all and whether a test has asked for the
 * other path.
 */
export function supportsP2P(): boolean {
    if( typeof RTCPeerConnection === 'undefined' ) return false;

    const override = transportOverride();

    if( override ) return override === 'p2p';

    return true;
}

export function callTransport(): 'p2p' | 'sfu' {
    return supportsP2P() ? 'p2p' : 'sfu';
}
