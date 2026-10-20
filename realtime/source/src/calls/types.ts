import type {CallUser} from "./users.js";

export type P2PSource = 'camera' | 'microphone' | 'screen_share' | 'screen_share_audio';

export type P2PQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

export type P2PConnection = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface IceServer {
    urls: string[];
    username?: string;
    credential?: string;
}

export interface MediaState {
    camera: boolean;
    microphone: boolean;
    screen_share: boolean;
    screen_share_audio: boolean;
}

// How this side shows the other side's video, as the height of the largest
// box each source is displayed in, in device pixels: the camera rounded up
// to the next rung of VIEW_STEPS, the screen share exact (to the pixel, so
// text is encoded at the size it is read at and scaled only once). 0 = not
// shown at all (no element, hidden tab, scrolled away), so the sender can
// stop encoding it.
export interface ViewHint {
    camera?: number;
    screen_share?: number;
}

export const VIEW_STEPS = [ 180, 360, 540, 720, 1080, 1440, 2160 ];

// What a browser can do with a video codec family, from the Media
// Capabilities API: usable at all, hardware, smooth at 1080p30, and smooth
// at 1080p60 (`fast`), which is what a 60-frame screen share takes on both
// ends.
export interface CodecScore {
    ok: boolean;
    hw: boolean;
    smooth: boolean;
    fast: boolean;
}

export interface CodecCaps {
    families: Record<string, { enc: CodecScore; dec: CodecScore }>;
    switch: boolean;
    // Which engine answered the probe. A codec that a browser vouches for
    // can still fail in it — Chrome's H265 did, on both ends, in every
    // camera stall the trace of 19 to 21 Sep 2026 caught — and the ranking
    // needs to know the engine to hold that against it. Missing on a client
    // older than this field, which is then not held to anything.
    engine?: 'chromium' | 'gecko' | 'webkit' | 'native';
    // Chromium's H.264 Baseline encoder in hardware (room-publish.ts,
    // CHROMIUM_H264_ENCODE), for a room on the mesh, which takes Baseline
    // from it. This page's own: the caps a direct call sends leave it out
    // (session.ts), and the ranking above never reads it.
    h264Baseline?: boolean;
}

// Which half of a family stopped working on this device: the encoder that
// produces no frame from a camera that is running, or the decoder that
// produces none from packets that are arriving.
export type CodecDirection = 'enc' | 'dec';

export type SignalBody =
    | { kind: 'sdp'; description: RTCSessionDescriptionInit; mids: Record<string, P2PSource> }
    | { kind: 'candidate'; candidate: RTCIceCandidateInit }
    | { kind: 'state'; state: MediaState }
    | { kind: 'view'; view: ViewHint }
    | { kind: 'caps'; caps: CodecCaps }
    // The receiver has had no picture from a source it is expecting, and
    // asks the sender to start that source's encoder again so a fresh
    // keyframe goes out. A client that does not know the kind ignores it.
    | { kind: 'refresh'; source: 'camera' | 'screen_share' }
    // The receiver has had nothing at all from one of the sender's sources
    // while the connection itself is fine — the sender's own RTCP reports
    // keep arriving and say it sent nothing — so the sender's capture has
    // stopped, and it is asked to open the device again. A client that does
    // not know the kind ignores it.
    | { kind: 'reacquire'; source: 'microphone' | 'camera' };

// A signal body as it travels: the two browsers seal it (cipher.ts), the
// server only ever sees this shape.
export interface SealedSignal {
    sealed: 1;
    iv: string;
    data: string;
}

export interface SignalEnvelope {
    id: string;
    from: CallUser;
    from_epoch: number;
    generation: number;
    body: SignalBody | SealedSignal | null;
}

export interface SfuHandoff {
    token: string;
    room: string;
    // The room's server, which the realtime SDK's calls are told (the mesh);
    // Better Messages connects where its site's settings say.
    server?: string;
}

export interface JoinAck {
    ok: boolean;
    error?: string;
    reason?: string;
    mode?: 'p2p' | 'sfu';
    role?: 'polite' | 'impolite';
    generation?: number;
    ice_servers?: IceServer[];
    ice_expires_at?: number;
    thread_id?: number;
    type?: 'audio' | 'video';
    peer?: { user_id: CallUser | null; present: boolean; gone: boolean; epoch: number };
    replay?: SignalEnvelope[];
    sfu?: SfuHandoff;
}

export interface SignalAck {
    ok: boolean;
    error?: string;
    id?: string;
    queued?: boolean;
    duplicate?: boolean;
    generation?: number;
}

export interface SyncAck {
    ok: boolean;
    error?: string;
    generation?: number;
    mode?: 'p2p' | 'sfu';
    replay?: SignalEnvelope[];
}

export interface IceAck {
    ok: boolean;
    ice_servers?: IceServer[];
    ice_expires_at?: number;
    // A fresh room token, from a relay that renews it with the credentials.
    sfu?: SfuHandoff;
}

export interface FailedAck {
    ok: boolean;
    mode?: 'p2p' | 'sfu';
    sfu?: SfuHandoff;
}

export interface AliveAck {
    ok: boolean;
    error?: string;
    reason?: string;
    generation?: number;
    mode?: 'p2p' | 'sfu';
    // Carried when the call moved to the room while this side could not be
    // told: the token to follow it with.
    sfu?: SfuHandoff;
}

// This side's cumulative counters, every couple of seconds, for the relay
// and for the other side: audio and video packets taken in and sent out,
// and the ICE state they were read under.
export interface PulseBody {
    ice: string;
    in: { a: number; v: number };
    out: { a: number; v: number };
}

export interface PeerPulse extends PulseBody {
    at: number;
}

export interface PulseAck {
    ok: boolean;
    error?: string;
    mode?: 'p2p' | 'sfu';
    strikes?: number;
    peer?: PeerPulse | null;
    // The relay's own verdict: the direct path is dead, here is the room.
    sfu?: SfuHandoff;
}

export interface ServerMessage {
    op: 'ready' | 'signal' | 'peer_lost' | 'peer_back' | 'fallback' | 'ended';
    call_id: number | string;
    session: string;
    generation?: number;
    peer?: { user_id: CallUser; epoch: number };
    id?: string;
    from?: number;
    from_epoch?: number;
    body?: SignalBody | SealedSignal | null;
    grace_ms?: number;
    sfu?: SfuHandoff;
    reason?: string;
    by?: number | null;
    thread_id?: number;
    type?: 'audio' | 'video';
}

export interface P2PStats {
    bytesSent: number;
    bytesReceived: number;
    rtt: number | null;
    packetLoss: number;
    quality: P2PQuality;
    candidatePair: { local: string | null; remote: string | null; protocol: string | null } | null;
    // How many times ICE had to be restarted to keep this call up.
    restarts: number;
    // What each direction actually runs on, by the codec entry the browser
    // attaches to the stream: the negotiated choice as it stands, not what
    // was asked for. Null until the stream carries something.
    codecs: { videoSend: string | null; videoRecv: string | null; audioSend: string | null; audioRecv: string | null };
    // Which encoder and decoder are running the video, by name. The codec
    // alone does not say whether it costs the CPU, and that is usually what
    // is being asked. Chrome only fills these in once capture permission has
    // been granted, and Safari never does, so null is ordinary.
    impl: { enc: string | null; dec: string | null };
    // The cumulative packet counts this side has taken in and sent out, by
    // kind, and what the other side says it has sent (its RTCP sender
    // reports, `remote-outbound-rtp`) with the time the last of those
    // arrived. The last two are what tell a path that has died from a peer
    // that has stopped sending: both leave the inbound flat, only the first
    // leaves the peer's own count climbing.
    counters: P2PCounters;
}

export interface P2PCounters {
    inAudio: number;
    inVideo: number;
    outAudio: number;
    outVideo: number;
    remoteAudio: number;
    remoteVideo: number;
    remoteAt: number;
}

export function randomId( length = 24 ): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array( length );

    if( typeof crypto !== 'undefined' && crypto.getRandomValues ){
        crypto.getRandomValues( bytes );
    } else {
        for( let i = 0; i < length; i++ ) bytes[ i ] = Math.floor( Math.random() * 256 );
    }

    let out = '';

    for( let i = 0; i < length; i++ ){
        out += alphabet[ bytes[ i ] % alphabet.length ];
    }

    return out;
}

export function compareStreamIds( a: string, b: string ): number {
    const [ aMs, aSeq ] = a.split( '-' ).map( Number );
    const [ bMs, bSeq ] = b.split( '-' ).map( Number );

    if( aMs !== bMs ) return aMs < bMs ? -1 : 1;
    if( aSeq === bSeq ) return 0;

    return aSeq < bSeq ? -1 : 1;
}
