import { createContext, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

// What a call screen is drawn from, and what it does: the contract between the screens and whoever runs the call.
// Better Messages' call container provides it from its own engine and LiveKit's room; an app's from the SDK's calls
// (calls/sdk.tsx). Moved from Better Messages' call-container.tsx with its names, so its screens read it as before.

/** A picture or a sound a screen shows: attached to a <video> or an <audio>, and taken off again. LiveKit's tracks are one. */
export interface CallTrack {
    attach( element: HTMLMediaElement ): HTMLMediaElement;
    detach( element: HTMLMediaElement ): HTMLMediaElement;
    readonly attachedElements: HTMLMediaElement[];
}

/** How big a published picture is, once its sender said: what a grid divides its room by before anything is drawn. */
export interface CallPublication {
    dimensions?: { width: number; height: number } | null;
}

/** A connection's quality, as LiveKit names it. */
export type CallConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

/** Where the call's room connection is, as LiveKit names it. */
export type CallConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'signalReconnecting';

/** Someone in the call, `me` the local user (keyed so in `participants`). */
export interface CallParticipant {
    identity       : string,
    name           : string,
    avatar         : string,
    link           : string,
    audioLevel     : number,
    isSpeaking     : boolean,
    isPinned       : boolean,
    quality        : CallConnectionQuality,
    video          : CallTrack | null | undefined,
    videoPub       : CallPublication | null | undefined,
    audio          : CallTrack | null | undefined,
    audioPub       : CallPublication | null | undefined,
    screen         : CallTrack | null | undefined,
    screenPub      : CallPublication | null | undefined,
    screenAudio    : CallTrack | null | undefined,
    screenAudioPub : CallPublication | null | undefined,
    canPublish     : boolean,
    canAdmin       : boolean,
    handRaised     : boolean,
    micMuted       : boolean,
    // away for a moment: the tile stays, marked as reconnecting, without its media
    reconnecting?  : boolean,
    // their camera or screen as the media server paused it for this page, whose download can't carry it now (the
    // room's stream state "paused"): its last frame stays, and the tile says why
    videoPaused?   : boolean,
    screenPaused?  : boolean,
}

export type CallAction = 'outgoing_call' | 'incoming_call' | 'call_in_progress' | 'connecting';

export interface CallInfo {
    thread_id: number,
    message_id: number,
    token: string,
    user_ids: number[],
    type: 'audio' | 'video',
    caller_id?: number,
    encryption_key: string,
    signal_key?: string,
    mode?: 'p2p' | 'sfu',
    // the call server the realtime cloud named for this call (a host name), where its room is joined
    // instead of video_server's: the cloud moves sites onto its call mesh with it
    server?: string
}

/** The conversation a call is in: whose face the private call shows, its first participant. */
export interface CallThread {
    thread_id: number,
    participants: number[],
}

/** What a moderator asks of a group call: `mute_all`, `lock_room`, `pin_participant`, … with whom, and the call's type. */
export interface CallModeration {
    act: string,
    identity?: string,
    type?: 'audio' | 'video',
}

export interface CallContextInterface {
    wrapper: MutableRefObject<HTMLDivElement | null>,
    thread: CallThread,
    callInfo: CallInfo,
    adminMode: boolean,
    canPublish: boolean,
    statusMessage: string,
    participants: Map<string, CallParticipant>,
    participantsRef: MutableRefObject<Map<string, CallParticipant>>,
    action: CallAction | null,
    errorMessages: string[],
    callDurationRef: MutableRefObject<number>,
    bytesReceivedRef: MutableRefObject<number>,
    bytesSentRef: MutableRefObject<number>,
    connectionState: CallConnectionState,
    endCall: ( action?: 'abort' | 'reject' | 'rejected' ) => Promise<void>
    answerCall: () => Promise<boolean>,
    activeCameraDevice: string,
    setActiveCameraDevice: Dispatch<SetStateAction<string>>,
    selectedCameraDevice: string,
    setSelectedCameraDevice: Dispatch<SetStateAction<string>>,
    selectedMicrophoneDevice: string,
    setSelectedMicrophoneDevice: Dispatch<SetStateAction<string>>,
    selectedSpeakerDevice: string,
    setSelectedSpeakerDevice: Dispatch<SetStateAction<string>>,

    fullScreenEnabled: boolean,
    setFullScreenEnabled: Dispatch<SetStateAction<boolean>>,

    myCameraTrack: CallTrack | null,
    myCameraTrackRef: MutableRefObject<CallTrack | null>,
    myMicrophoneTrack: CallTrack | null,
    myMicrophoneTrackRef: MutableRefObject<CallTrack | null>,

    myScreenVideoTrack: CallTrack | null,
    myScreenVideoTrackRef: MutableRefObject<CallTrack | null>,

    switchingCamera: boolean,
    switchCamera: () => Promise<void>,
    enableCamera: () => Promise<void>,
    disableCamera: () => Promise<void>,

    enableMic: () => Promise<void>,
    disableMic: () => Promise<void>,

    enableFullScreen: () => void,
    disableFullScreen: () => void,

    enableShareScreen: () => Promise<void>,
    disableShareScreen: () => Promise<void>,

    roomLocked: boolean,
    setRoomLocked: Dispatch<SetStateAction<boolean>>,
    roomMuted: boolean,
    setRoomMuted: Dispatch<SetStateAction<boolean>>,

    raiseHand: () => Promise<void>,
    // These three may say whether the request went through: false keeps a tile's control from waiting for a change
    // that won't come (see inc/calls/pending.ts).
    lowerHand: (identity: string) => Promise<boolean | void>,
    lowerAllHands: () => Promise<void>,
    myHandRaised: boolean,
    myMicMuted: boolean,

    callMode: 'participatory' | 'broadcast',
    setCallMode: (mode: 'participatory' | 'broadcast') => Promise<void>,
    promoteParticipant: (identity: string) => Promise<boolean | void>,
    demoteParticipant: (identity: string) => Promise<boolean | void>,

    /**
     * Asks the call's server to moderate: resolves with its answer, rejects with what went wrong (the screens show
     * it). Better Messages posts it to its `groupCallAdmin` route.
     */
    moderate: ( request: CallModeration ) => Promise<unknown>,

    /**
     * The acts of `moderate` this call takes, where it takes only some (`remove_participant`, `mute_mic`, …): every one
     * where it lists none, as Better Messages' calls do. The screens draw no control for any other.
     */
    moderation?: readonly string[],

    /**
     * Whom the user may bring into the call, when whoever runs it can add people: the screens then offer Add Person,
     * and the call goes on as a group call. Better Messages provides none, and its screens draw no such button.
     */
    people?: () => Promise<CallPerson[]>,
    addPerson?: ( person: CallPerson ) => Promise<void>,

    iconsReverted: boolean,
    fullScreenAvailable?: boolean,

    // The conversation beside the call, for the dock's Show Chat / Hide Chat. No toggle where the call has no chat
    // beside it to show, as for an app's call screen.
    chatShown?: boolean,
    chatToggle?: Dispatch<SetStateAction<boolean>> | null
}

/** Someone the user may add to a call. */
export interface CallPerson {
    id: number | string,
    name: string,
    avatar?: string,
}

export const callInfoDefaults: CallInfo = {
    thread_id: undefined as unknown as number,
    message_id: undefined as unknown as number,
    token: undefined as unknown as string,
    user_ids: undefined as unknown as number[],
    type: undefined as unknown as 'audio',
    caller_id: undefined,
    encryption_key: undefined as unknown as string,
    signal_key: undefined,
    mode: undefined,
    server: undefined
};

// The defaults a screen drawn outside a call sees: nothing is in it, and nothing it would call is there.
const missing = null as never;

export const CallContext = createContext<CallContextInterface>({
    wrapper: missing,
    thread: missing,
    callInfo: callInfoDefaults,
    adminMode: false,
    canPublish: false,
    statusMessage: '',
    participants: new Map(),
    participantsRef: missing,
    action: null,
    errorMessages: [],
    connectionState: 'disconnected',
    callDurationRef: missing,
    bytesReceivedRef: missing,
    bytesSentRef: missing,
    endCall: missing,
    answerCall: missing,
    activeCameraDevice: '',
    setActiveCameraDevice: missing,
    selectedCameraDevice: '',
    setSelectedCameraDevice: missing,
    selectedMicrophoneDevice: '',
    setSelectedMicrophoneDevice: missing,
    selectedSpeakerDevice: '',
    setSelectedSpeakerDevice: missing,
    myCameraTrack: null,
    myCameraTrackRef: missing,
    myMicrophoneTrack: null,
    myMicrophoneTrackRef: missing,
    myScreenVideoTrack: null,
    myScreenVideoTrackRef: missing,
    enableCamera: missing,
    switchCamera: missing,
    switchingCamera: false,
    disableCamera: missing,

    fullScreenEnabled: missing,
    setFullScreenEnabled: missing,

    enableMic: missing,
    disableMic: missing,

    enableFullScreen: missing,
    disableFullScreen: missing,

    enableShareScreen: missing,
    disableShareScreen: missing,

    roomLocked: false,
    setRoomLocked: missing,
    roomMuted: false,
    setRoomMuted: missing,

    raiseHand: missing,
    lowerHand: missing,
    lowerAllHands: missing,
    myHandRaised: false,
    myMicMuted: false,

    callMode: 'participatory',
    setCallMode: missing,
    promoteParticipant: missing,
    demoteParticipant: missing,
    moderate: missing,

    iconsReverted: missing,
    fullScreenAvailable: missing,

    chatShown: true,
    chatToggle: null
});
