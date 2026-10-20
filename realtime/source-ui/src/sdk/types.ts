// What the screens read of @wordplus/realtime's calls (its realtime-client's sdk-calls), by shape: this package takes
// the page's calls as the SDK made them and imports none of it, so it never carries a second copy of the call engine.

export type SdkCallType = 'audio' | 'video';
export type SdkMediaSource = 'camera' | 'microphone' | 'screen_share' | 'screen_share_audio';
export type SdkQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

/** A track another person sends. */
export interface SdkRemoteTrack {
    readonly mediaStreamTrack: MediaStreamTrack;
    attach( element: HTMLMediaElement ): HTMLMediaElement;
    detach( element?: HTMLMediaElement ): HTMLMediaElement[];
}

export interface SdkMediaState {
    camera: boolean;
    microphone: boolean;
    screen_share: boolean;
    screen_share_audio: boolean;
}

export interface SdkRemoteMedia {
    camera: SdkRemoteTrack | null;
    microphone: SdkRemoteTrack | null;
    screen: SdkRemoteTrack | null;
    screenAudio: SdkRemoteTrack | null;
    media: SdkMediaState;
    quality: SdkQuality;
}

type Listener = ( ...args: any[] ) => void;

/** A user of a call: a number for an id of digits, else the app's own id of text (@wordplus/realtime-client's CallUser). */
export type CallUser = number | string;

/**
 * An id as calls take it, the rule of @wordplus/realtime-client's callUserOf(): an id of digits as a number, any other
 * id of text as it is, else null (at most 64 characters, none a space or a control character). 0 is nobody.
 */
export function callUserOf( raw: unknown ): CallUser | null {
    if ( typeof raw === 'number' ) return Number.isSafeInteger( raw ) && raw !== 0 ? raw : null;
    if ( typeof raw !== 'string' || ! /^[^\s\u0000-\u001f\u007f]{1,64}$/.test( raw ) ) return null;
    if ( /^-?[1-9][0-9]*$/.test( raw ) && Number.isSafeInteger( Number( raw ) ) ) return Number( raw );
    return raw === '0' ? null : raw;
}

export interface SdkInvite {
    /** Whom it rings. */
    readonly to: CallUser;
    state: string;
    on( event: string, fn: Listener ): unknown;
}

/** A call between two people. */
export interface SdkCall {
    readonly id: string;
    readonly name: string;
    readonly type: SdkCallType;
    readonly role: 'caller' | 'callee';
    readonly peer: { user: CallUser; info: unknown };
    state: 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended';
    endReason: string | null;
    remote: SdkRemoteMedia;
    on( event: string, fn: Listener ): unknown;
    off( event: string, fn?: Listener ): unknown;
    add( user: CallUser ): Promise<SdkInvite>;
    setTrack( source: SdkMediaSource, track: MediaStreamTrack | null ): void;
    end(): void;
}

/** Someone in a group call. */
export interface SdkPerson {
    identity: string;
    user: CallUser | null;
    info: unknown;
    camera: SdkRemoteTrack | null;
    microphone: SdkRemoteTrack | null;
    screen: SdkRemoteTrack | null;
    screenAudio: SdkRemoteTrack | null;
    speaking: boolean;
    /** Whether they may send: false for someone who only listens. */
    publish?: boolean;
    /** Their camera or screen paused by the media server for this page's download. A client without them pauses nothing. */
    cameraPaused?: boolean;
    screenPaused?: boolean;
}

/** What this page may do in a group call now, as its rule said or the app server changed since (`permissions`). */
export interface SdkCallPermissions {
    publish: boolean;
    subscribe: boolean;
    /** Host the call (its rule's `admin`): `moderate()` the others. */
    admin?: boolean;
}

/** What a host does to someone else in a group call: `mute` their microphone, `speak`, `listen`, `remove`. */
export type SdkModerationAct = 'mute' | 'speak' | 'listen' | 'remove';

/** A group call on the mesh. */
export interface SdkGroupCall {
    state: 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'ended';
    on( event: string, fn: Listener ): unknown;
    off( event: string, fn?: Listener ): unknown;
    people(): SdkPerson[];
    setTrack( source: SdkMediaSource, track: MediaStreamTrack | null ): Promise<void>;
    leave(): void;
    add?( user: CallUser ): Promise<SdkInvite>;
    /** What this page may do now. A client without it sends as everyone else. */
    readonly can?: SdkCallPermissions;
    /** This page's own user as the others see them, once connected: their info for their own tile. */
    readonly self?: SdkPerson | null;
    /** A host's act on someone else, through the app's calls route: whether it changed anything. */
    moderate?( act: SdkModerationAct, user: CallUser ): Promise<boolean>;
}

/** A call ringing for the page's user. */
export interface SdkIncoming {
    readonly id: string;
    readonly call: string;
    readonly from: CallUser;
    info: unknown;
    readonly type: SdkCallType;
    readonly group: string | null;
    state: string;
    on( event: 'over', fn: Listener ): unknown;
    off( event: 'over', fn?: Listener ): unknown;
    accept(): Promise<SdkCall | SdkGroupCall>;
    decline( reason?: 'declined' | 'busy' ): Promise<void>;
}

export interface SdkPerson2 {
    id: CallUser;
    name: string;
    avatar?: string;
}

/** The page's calls. */
export interface SdkCalls {
    on( event: 'incoming' | 'error', fn: Listener ): unknown;
    off( event: 'incoming' | 'error', fn?: Listener ): unknown;
    start( name: string, options: { to: CallUser; type?: SdkCallType } ): Promise<SdkCall>;
    group( name: string, options?: { type?: SdkCallType } ): Promise<SdkGroupCall>;
    people( name: string ): Promise<SdkPerson2[]>;
    /** Whether the page's user may call each person about each call, in the order asked: null where the app can't say. */
    may?( asks: Array<{ call: string; to: CallUser }> ): Promise<Array<boolean | null>>;
    /** The live stream `name` (`calls.stream()`): where the SDK has live streams. */
    stream?( name: string, options?: { video?: boolean } ): Promise<SdkStream>;
}

/** A live stream as the SDK's `calls.stream()` answers it: Easy Stream's engine under it, which the stream views draw. */
export interface SdkStream {
    readonly name: string;
    readonly engine: unknown;
    leave(): void;
}

/** What the site's token said about a person: their name and picture, as the SDK opened it. */
export interface SdkInfo {
    name?: string;
    avatar?: string;
}

export const infoOf = ( info: unknown ): SdkInfo => ( info && typeof info === 'object' ? info as SdkInfo : {} );
