import {RemoteMediaTrack} from "./remote-track.js";
import {answerOrder, applyCodecPreferences, chooseSendFamily, familyOf, fastDirection, negotiatedCodec, offerOrder} from "./codecs.js";
import {CodecCaps, CodecDirection, IceServer, P2PConnection, P2PCounters, P2PQuality, P2PSource, P2PStats, PeerPulse, PulseBody, SignalBody, VIEW_STEPS, ViewHint} from "./types.js";

// How a direct path that has died is left, and how fast.
//
// The measure of 19 to 21 Sep 2026 was that every failure took the same
// long road: three silences of eight seconds each, a plain ICE restart after
// the first two that changed nothing, and only then the room — 44 to 46
// seconds of dead call, every time, and a hand-off that still had to fetch
// its token. Half of those silences were not a dead path at all but a peer
// whose microphone had stopped, which no restart could mend.
//
// Now a silence is judged at STALL_TIMEOUT by what the other side's own RTCP
// sender reports say it sent meanwhile (`remote-outbound-rtp`, arriving over
// the same transport), backed by the relay's pulse: the peer sent and
// nothing arrived is a dead path, the peer sent nothing is a dead capture.
// A dead capture gets a `reacquire` to the sender and no restart.
//
// The room is for a call that cannot connect directly or through TURN at
// all, and a call handed to it never comes back, so the path is given up on
// only once TURN has had a fair trial: MAX_RESTARTS restarts, each with fresh
// credentials and RESTART_DEADLINE to bring the media back. A dead path is
// restarted over the relay alone, since ICE still thinks the path it has is
// fine; a lost connection first on every candidate, which is what finds a new
// direct path after a move from Wi-Fi to cellular, and then over the relay
// alone. The browser itself says `disconnected` about five seconds after its
// pings go unanswered, so the grace on top is one second. Until 22 Sep 2026
// each road had one attempt of four or five seconds, and a network change of
// ten seconds on one side put a call in the room for good.
//
// None of it runs while a restart could not be negotiated: this side's
// socket down, or the relay having said the other side's is. A deadline that
// runs out then proves nothing about the path, so escalation waits, for up to
// SIGNALING_HOLD_MAX, and starts over with a fresh budget once both sides can
// be reached. A connection that has carried media for HEALTHY_RESET since its
// last trouble has its restarts back, so every incident in a long call gets
// the whole trial.
const MAX_RESTARTS = 2;
const RESTART_DEADLINE = 8000;
const DISCONNECT_GRACE = 1000;
const POLITE_RESTART_DELAY = 1500;
const HEALTHY_RESET = 30000;
const SIGNALING_HOLD_MAX = 60000;
const RENEW_POLITE_DELAY = 10000;
const STATS_INTERVAL = 2000;
const CAMERA_MAX_BITRATE = 4_000_000;
const MICROPHONE_MAX_BITRATE = 64_000;
const SCREEN_AUDIO_MAX_BITRATE = 128_000;
const PRIVATE_HOLD = 2000;
const STALL_TIMEOUT = 4000;
// How long the other side's RTCP is trusted to be current: a sender report
// older than this says nothing about now.
const REMOTE_REPORT_AGE = 5000;
// A pulse the relay hands back was read at the other side's stats tick, up
// to this long before this side first saw it (a pulse interval here, and the
// two trips): a sample counts as taken after a silence began only when it
// was first seen that much later. Seen by this side's clock, not stamped by
// the relay's — a browser whose clock ran a few seconds behind the relay's
// counted the peer's pulses from before the silence as sent during it, and
// sent a stopped microphone to the room as a dead path.
const PULSE_LAG = 2500;
// What the peer must have sent during a silence for the silence to be the
// path's fault rather than its capture's. libwebrtc keeps probing the
// bandwidth with a trickle of padding on a video section that carries no
// picture — about a packet a second on an audio call, measured 21 Sep 2026
// — and one such packet used to be "the peer kept sending", which made a
// stopped microphone read as a dead path. A live microphone is fifty
// packets a second.
const SILENCE_SENT_MIN = 25;
// How many samples of the peer's counts are kept for judging a silence.
const SAMPLE_HISTORY = 8;
// How often the other side is told its capture has stopped.
const SILENT_NOTICE_MIN = 30000;
// A test switch that makes this side read its own inbound as flat while
// everything else stays real, so the dead-path road can be walked on a
// working network: bm_p2p_fault = inbound.
function faultInbound(): boolean {
    try {
        return window.localStorage.getItem( 'bm_p2p_fault' ) === 'inbound';
    } catch (e) {
        return false;
    }
}

// A video source the other side says is on, that this side has asked to be
// sent, and that has decoded nothing for this long is asked for again: the
// sender starts that source's encoder over, which puts a keyframe on the
// wire. Only when that changes nothing does the silence count as a stall and
// take the aggregate watchdog's way out (an ICE restart, then the room).
// Audio keeps the aggregate counters moving, so a dead picture beside a
// working microphone was invisible for the whole call — two calls sat frozen
// from start to finish on 16 Sep 2026 with neither side doing anything.
const VIDEO_STALL_TIMEOUT = 6000;
// How often a sender lets one of its sources be started over, and how long
// the encoding is held off when it is.
const REFRESH_MIN_INTERVAL = 2000;
const REFRESH_HOLD = 500;
// A negotiation that never completes has nothing to notice it: ICE fails
// only once it has checked something, and the stall watchdog only counts on
// a live connection. A path that is going to come up does so inside a few
// seconds; one that has not by CONNECT_RELAY_AT is tried over the relay
// alone, with the restarts a lost connection gets, and one that has not by
// CONNECT_DEADLINE — both of them run out — is given up for the room. It was
// fourteen seconds, which left a relay allocation over TCP on 443 through a
// slow network six to come up in.
const CONNECT_RELAY_AT = 8000;
const CONNECT_DEADLINE = CONNECT_RELAY_AT + MAX_RESTARTS * RESTART_DEADLINE + 2000;

// When a negotiated codec is declared dead, and how fast.
//
// The receiving half is judged on assembled frames, not packets: a frame is
// only counted once it is whole, and a working decoder turns the first one it
// is given into a picture. Three of them with nothing decoded is already
// conclusive, and waiting on packet counts only bought seconds of black.
//
// Some browsers say it outright. Chrome names the decoder it ended up with,
// and when its real one refuses the stream it swaps in a decoder that discards
// every frame — `NullVideoDecoder (fallback from: ...)`. That needs no grace
// at all.
//
// The sending half keeps a longer one: an encoder is entitled to a moment
// before its first frame, and the camera it is fed from starts in its own
// time.
const CODEC_DECODE_GRACE = 1200;
const CODEC_DECODE_FRAMES = 3;
const CODEC_ENCODE_GRACE = 3000;
const CODEC_ENCODE_FRAMES = 20;
// Where the frame count is missing and a live track is standing in for it,
// the clock starts the instant the camera is attached rather than 20 frames
// in, so it has to run much longer before it is allowed to condemn anything:
// an encoder that is merely slow to start must never be written off, and no
// real one takes ten seconds.
const CODEC_ENCODE_SLOW_GRACE = 10_000;
const DEAD_DECODER = /null|fallback/i;
// An encoder that encodes nothing because it has nothing to spend is starved,
// not broken: libwebrtc holds every frame back from an encoder whose target
// has fallen to zero — the path down, or its send queue grown too long — and
// an encoder given a few kbps skips what it cannot afford. A target under
// 30 kbps counts as nothing to spend. Writing a starved encoder's codec off
// renegotiated a working call onto a worse one over what was the path's
// problem (production call 50038, 22 Sep 2026: `45c 0f 0p bandwidth 0k` on a
// relay with 2.7% loss and 400 ms round trips, and H264 dropped). A skipped
// write-off is written to the trace at most this often a codec.
const ENCODER_STARVED_TARGET = 30_000;
const STARVED_NOTE_EVERY = 30_000;

// What an encoder has to spend, by its own report. libwebrtc leaves the
// target out of the report while it is zero, and an encoder cut off by a
// path that went down names no limitation, so a missing target beside a
// reported limitation is the zero it stands for. A missing target from a
// browser that reports no limitation either is unknown — Firefox reports
// neither, and is judged on its frames alone, as before.
function encoderTarget( limit: string, target: number | null ): number | null {
    if( target !== null ) return target;

    return limit === '?' ? null : 0;
}

// Whether an encoder is being starved rather than failing: it has been given
// next to nothing to spend. Its target decides, not the limitation it names.
// `bandwidth` only says libwebrtc once scaled the picture down, and only the
// quality scaler lifts that, which needs encoded frames: an encoder that dies
// after being scaled down once reads `bandwidth` for the rest of the call with
// a healthy target, and was never written off.
function encoderStarved( limit: string, target: number | null ): boolean {
    const spend = encoderTarget( limit, target );

    return spend !== null && spend < ENCODER_STARVED_TARGET;
}

function encoderLimit( limit: string, target: number | null ): string {
    return 'limited by ' + limit + ', target ' + kbps( encoderTarget( limit, target ) );
}

// A stats entry's target bitrate, or null where the browser left it out.
function reportedTarget( entry: any ): number | null {
    const target = Number( entry.targetBitrate );

    return entry.targetBitrate !== undefined && entry.targetBitrate !== null && Number.isFinite( target ) ? target : null;
}

// What the camera is encoded at when the other side shows it smaller than
// full size: the rung is picked by the height they asked for (a VIEW_STEPS
// value). Full size keeps the capture's own frame rate and the camera
// bitrate ceiling.
const CAMERA_RUNGS: Array<{ height: number; maxBitrate: number; maxFramerate: number }> = [
    { height: 180, maxBitrate: 200_000, maxFramerate: 15 },
    { height: 360, maxBitrate: 500_000, maxFramerate: 20 },
    { height: 540, maxBitrate: 1_000_000, maxFramerate: 25 },
    { height: 720, maxBitrate: 2_000_000, maxFramerate: 30 }
];

const FULL_HEIGHT = VIEW_STEPS[ VIEW_STEPS.length - 1 ];
const DEFAULT_TRACK_HEIGHT = 1080;

// A screen share is captured at the screen's own size (up to 4K, 60 frames)
// and sent at exactly the size the other side shows it, so a retina stage
// gets retina text and a phone's stage is not paid for at 4K; until the
// other side has said, 1080 lines. In a chip (360 or below) it keeps up to
// 1080 lines and drops to 5 frames instead, so it is sharp the moment it is
// put back on the stage. The ceilings grow with the picture and are only
// ceilings: the bandwidth estimate sits under them on a weak link, a still
// screen costs a few hundred kbps whatever they are, and the browsers' own
// default for 1080p is 2.5 Mbps, so leaving them out would lower them, not
// lift them.
const SCREEN_DEFAULT_HEIGHT = 1080;
const SCREEN_SMALL_HEIGHT = 360;
const SCREEN_SMALL_FRAMERATE = 5;
const SCREEN_FRAMERATE = 30;
const SCREEN_CEILINGS: Array<{ height: number; maxBitrate: number }> = [
    { height: 540, maxBitrate: 4_000_000 },
    { height: 720, maxBitrate: 6_000_000 },
    { height: 1080, maxBitrate: 10_000_000 },
    { height: 1440, maxBitrate: 14_000_000 },
    { height: Infinity, maxBitrate: 20_000_000 }
];

function screenCeiling( height: number ): number {
    const tier = SCREEN_CEILINGS.find( ( item ) => item.height >= height ) ?? SCREEN_CEILINGS[ SCREEN_CEILINGS.length - 1 ];

    return tier.maxBitrate;
}

interface EncodingShape {
    active: boolean;
    maxBitrate: number;
    scale: number;
    maxFramerate: number | null;
}

function trackHeight( track: MediaStreamTrack | null ): number {
    try {
        const height = track ? track.getSettings().height : undefined;

        if( typeof height === 'number' && height > 0 ) return height;
    } catch (e) {}

    return DEFAULT_TRACK_HEIGHT;
}

function cameraShape( wanted: number | undefined, track: MediaStreamTrack | null ): EncodingShape {
    if( wanted === 0 ){
        return { active: false, maxBitrate: CAMERA_MAX_BITRATE, scale: 1, maxFramerate: null };
    }

    const rung = typeof wanted === 'number' && wanted < FULL_HEIGHT ? CAMERA_RUNGS.find( ( item ) => item.height >= wanted ) : undefined;

    if( ! rung ){
        return { active: true, maxBitrate: CAMERA_MAX_BITRATE, scale: 1, maxFramerate: null };
    }

    return {
        active: true,
        maxBitrate: rung.maxBitrate,
        scale: Math.max( 1, trackHeight( track ) / rung.height ),
        maxFramerate: rung.maxFramerate
    };
}

// `fast`: both ends run the chosen codec smoothly at 60 frames, so the
// capture's own rate goes through; otherwise 30.
function screenShape( wanted: number | undefined, track: MediaStreamTrack | null, fast: boolean ): EncodingShape {
    const full = trackHeight( track );

    if( wanted === 0 ){
        return { active: false, maxBitrate: screenCeiling( full ), scale: 1, maxFramerate: null };
    }

    if( typeof wanted === 'number' && wanted <= SCREEN_SMALL_HEIGHT ){
        const height = Math.min( full, SCREEN_DEFAULT_HEIGHT );

        return { active: true, maxBitrate: screenCeiling( height ), scale: Math.max( 1, full / height ), maxFramerate: SCREEN_SMALL_FRAMERATE };
    }

    const height = Math.min( full, typeof wanted === 'number' ? wanted : SCREEN_DEFAULT_HEIGHT );

    return { active: true, maxBitrate: screenCeiling( height ), scale: Math.max( 1, full / height ), maxFramerate: fast ? null : SCREEN_FRAMERATE };
}

function audioCeiling( source: P2PSource ): number {
    return source === 'screen_share_audio' ? SCREEN_AUDIO_MAX_BITRATE : MICROPHONE_MAX_BITRATE;
}

// Screen audio is music or a video's sound as often as speech, and Opus
// only sends it in stereo when the side receiving it says so in its SDP
// (`stereo` is the receiver's parameter to set): every audio section of a
// description that arrives is marked stereo at the screen audio ceiling
// before it is applied, so this side's encoder sends screen audio in stereo.
//
// Every audio section, not the screen audio one alone. Both carry Opus
// under one payload type, and a payload type shared across a bundle has to
// mean one thing (RFC 8843): marking one section and not the other had
// libwebrtc reporting a "codec collision" at every connect — one it still
// let through, where a stricter build refuses the description. The
// microphone captures mono, so its section reading stereo changes nothing
// it sends, and the bitrate it may use is set on its sender, not here.
function withStereoOpus( sdp: string ): string {
    const params = 'stereo=1;sprop-stereo=1;maxaveragebitrate=' + SCREEN_AUDIO_MAX_BITRATE;

    return sdp.split( /(?=^m=)/m ).map( ( section ) => {
        if( ! /^m=audio/.test( section ) ) return section;

        const opus = /^a=rtpmap:(\d+) opus\/48000\/2[^\r\n]*/mi.exec( section );

        if( ! opus ) return section;

        const fmtp = new RegExp( '^a=fmtp:' + opus[1] + ' ([^\\r\\n]*)', 'm' );

        if( fmtp.test( section ) ){
            return section.replace( fmtp, ( _line, existing: string ) => {
                const kept = existing.split( ';' ).map( ( item ) => item.trim() ).filter( ( item ) => item && ! /^(stereo|sprop-stereo|maxaveragebitrate)=/.test( item ) );

                return 'a=fmtp:' + opus[1] + ' ' + [ ...kept, params ].join( ';' );
            } );
        }

        return section.replace( opus[0], opus[0] + '\r\na=fmtp:' + opus[1] + ' ' + params );
    } ).join( '' );
}

// A description without the attribute lines for payload types its media
// sections do not declare.
//
// Firefox answers a negotiation on the offerer's payload types and then, in
// every offer of its own — an ICE restart, a codec change — renumbers them to
// its own defaults while keeping the `a=rtcp-fb` lines it had for the old
// ones. Chromium's parser (libwebrtc's, so the apps' too) makes a codec out
// of every payload type it sees a feedback or format line for, and refuses
// the whole description over the nameless ones: "Failed to parse codecs
// correctly". Measured 21 Sep 2026 on production: no restart a Firefox side
// made ever landed against Chrome, and the dead-path road's one relay attempt
// went with it (call 37335). A line for a payload type that is not on the
// section's m-line says nothing about any codec, so it goes — on the way out
// from every side, and on the way in from a peer older than this.
function withoutOrphanPayloads( sdp: string ): { sdp: string; dropped: string[] } {
    const dropped: string[] = [];

    const cleaned = sdp.split( /(?=^m=)/m ).map( ( section ) => {
        const media = /^m=\S+ \S+ \S+((?: \d+)+)\s*$/m.exec( section );

        if( ! media ) return section;

        const declared = new Set( media[1].trim().split( /\s+/ ) );

        return section.split( '\n' ).filter( ( line ) => {
            const attribute = /^a=(rtcp-fb|fmtp|rtpmap):(\d+)(?=\s)/.exec( line );

            if( ! attribute || declared.has( attribute[2] ) ) return true;

            dropped.push( attribute[1] + ':' + attribute[2] );

            return false;
        } ).join( '\n' );
    } ).join( '' );

    return { sdp: cleaned, dropped };
}

// The dropped lines for a trace line: each kind and payload type once, so
// thirty feedback lines for three payload types read as three entries.
function describeDropped( dropped: string[] ): string {
    const unique = Array.from( new Set( dropped ) );

    return dropped.length + ' line(s) for payload types it does not declare (' + unique.slice( 0, 8 ).join( ' ' ) + ( unique.length > 8 ? ' …' : '' ) + ')';
}

const PRIVATE_V4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
const PRIVATE_V6 = /^(::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;

interface ParsedCandidate {
    type: string;
    address: string;
    isPrivate: boolean;
}

function parseCandidate( candidate: RTCIceCandidateInit ): ParsedCandidate | null {
    const line = candidate.candidate ?? '';
    const parts = line.replace( /^candidate:/, '' ).split( ' ' );

    if( parts.length < 8 ) return null;

    const address = parts[4];
    const typeIndex = parts.indexOf( 'typ' );
    const type = typeIndex > -1 ? parts[ typeIndex + 1 ] : '';
    const isPrivate = /\.local$/i.test( address ) || PRIVATE_V4.test( address ) || PRIVATE_V6.test( address );

    return { type, address, isPrivate };
}

// WebKit refuses a TURN URL that carries a transport query ("Invalid TURN
// URL query string"). The forms the server hands out say nothing the scheme
// does not: turn: is UDP unless told otherwise and turns: is always TCP
// under TLS, so their query can go. A plain-TCP turn: leg cannot be said
// without it and is dropped; the turns: leg covers TCP.
function withoutTransportQuery( servers: RTCIceServer[] ): RTCIceServer[] {
    const out: RTCIceServer[] = [];

    for( const server of servers ){
        const urls: string[] = [];

        for( const url of Array.isArray( server.urls ) ? server.urls : [ server.urls ] ){
            const match = /^(turns?):([^?]*)\?transport=(udp|tcp)$/i.exec( url );

            if( ! match ){
                urls.push( url );
            } else if( match[1].toLowerCase() === 'turns' || match[3].toLowerCase() === 'udp' ){
                urls.push( match[1] + ':' + match[2] );
            }
        }

        if( urls.length > 0 ){
            out.push( { ...server, urls } );
        }
    }

    return out;
}

function openPeerConnection( config: RTCConfiguration ): RTCPeerConnection {
    try {
        return new RTCPeerConnection( config );
    } catch (e) {
        const servers = withoutTransportQuery( config.iceServers ?? [] );

        if( JSON.stringify( servers ) === JSON.stringify( config.iceServers ?? [] ) ){
            throw e;
        }

        console.warn( 'p2p ice servers were not accepted, retrying without the transport query', e );

        return new RTCPeerConnection( { ...config, iceServers: servers } );
    }
}

export interface PeerOptions {
    polite: boolean;
    iceServers: IceServer[];
    iceTransportPolicy: RTCIceTransportPolicy;
    send: ( body: SignalBody ) => void;
    onTrack: ( source: P2PSource, track: RemoteMediaTrack | null ) => void;
    onConnection: ( state: P2PConnection ) => void;
    onStats: ( stats: P2PStats ) => void;
    onFailed: ( reason: string ) => void;
    refreshIceServers: () => Promise<IceServer[]>;
    onPlaybackBlocked: ( element: HTMLMediaElement ) => void;
    onViewChange: () => void;
    onCodecBroken: ( family: string, direction: CodecDirection ) => void;
    // The other side's capture of this kind has stopped while the path is
    // fine: nothing arrives, and its own RTCP says it sent nothing.
    onPeerSilent: ( source: 'microphone' | 'camera' ) => void;
    // One line for the call's trace: never SDP, addresses or names.
    onTrace?: ( line: string ) => void;
    caps: CodecCaps;
}

// What one of the other side's video streams has delivered, by the counters
// the browser keeps on it.
interface InboundVideo {
    decoded: number;
    received: number;
    packets: number;
    pli: number;
    nack: number;
    // The codec family the stream runs on, for the write-off when frames
    // keep arriving and none comes out.
    family: string | null;
}

// What a sender's video source had put out when it was asked to start over,
// so the frames the capture produces after the restart can be held against
// the frames the encoder turns them into.
interface RefreshWatch {
    at: number;
    encoded: number;
    produced: number | null;
    family: string | null;
}

interface OutboundVideo {
    produced: number | null;
    encoded: number;
    packets: number;
    limit: string;
    // Null where the report left it out, which is not always zero.
    target: number | null;
    family: string | null;
}

// Frames decoded of frames assembled, packets, and the keyframe and
// retransmission requests this side has made of it.
function describeInbound( stream: InboundVideo | undefined ): string {
    if( ! stream ) return 'no stream';

    return stream.decoded + '/' + stream.received + 'f ' + stream.packets + 'p pli' + stream.pli + ' nack' + stream.nack;
}

// How long a sender keeps writing what a restarted source puts out.
const REFRESH_WATCH = 12000;

// Frames the capture produced, frames encoded, packets sent, what the encoder
// says is holding it back (none / bandwidth / cpu / other) and the bitrate it
// is aiming at. A capture that has stopped and an encoder that turns out
// nothing read the same in every count but the first.
function describeOutbound( stream: OutboundVideo | undefined ): string {
    if( ! stream ) return 'no stream';

    return ( stream.produced === null ? '?' : stream.produced ) + 'c ' + stream.encoded + 'f ' + stream.packets + 'p ' + stream.limit + ' ' + kbps( encoderTarget( stream.limit, stream.target ) );
}

function kbps( bps: number | null ): string {
    return bps === null ? '?' : Math.round( bps / 1000 ) + 'k';
}

const SOURCE_KIND: Record<P2PSource, 'audio' | 'video'> = {
    camera: 'video',
    microphone: 'audio',
    screen_share: 'video',
    screen_share_audio: 'audio'
};

const SOURCE_ORDER: P2PSource[] = [ 'camera', 'microphone', 'screen_share', 'screen_share_audio' ];

export class P2PPeer {
    readonly pc: RTCPeerConnection;
    private readonly transceivers = new Map<P2PSource, RTCRtpTransceiver>();
    private readonly sourceOfTransceiver = new Map<RTCRtpTransceiver, P2PSource>();
    private readonly remoteByMid = new Map<string, RemoteMediaTrack>();
    private readonly remoteBySource = new Map<P2PSource, RemoteMediaTrack>();
    private remoteMids: Record<string, P2PSource> = {};
    private pendingCandidates: RTCIceCandidateInit[] = [];
    private heldPrivateCandidates: RTCIceCandidateInit[] = [];
    private privateHoldTimer: number | null = null;
    private readonly localPublicIps = new Set<string>();
    private readonly remotePublicIps = new Set<string>();
    private privateDecision: 'keep' | 'drop' | null = null;
    private signalChain: Promise<void> = Promise.resolve();
    private makingOffer = false;
    private ignoreOffer = false;
    private restartCount = 0;
    private restartsTotal = 0;
    private restartTimer: number | null = null;
    private restartDeadline: number | null = null;
    private statsTimer: number | null = null;
    private previousInbound = new Map<string, { lost: number; received: number }>();
    private closed = false;
    private everConnected = false;
    private inboundPackets = 0;
    private inboundChangedAt = 0;
    private connectedAt = 0;
    private expectInbound = false;
    private connectDeadline: number | null = null;
    private connectRelayTimer: number | null = null;
    // The other side's own counts of what it sent, as a short history: its
    // RTCP sender reports as they arrive here, and its pulses as the relay
    // hands them back. A silence is judged on the samples taken after it
    // began — a count that arrives with a couple of seconds' lag still holds
    // what was sent before the silence, and read against a baseline it says
    // "the peer kept sending" about a microphone that had just stopped.
    private peerPulse: PeerPulse | null = null;
    // `at` is when this side first saw the pulse, by its own clock; `relayAt`
    // is the relay's stamp, which only tells a new pulse from the same one
    // handed back again.
    private peerPulses: Array<PeerPulse & { relayAt: number }> = [];
    private remoteSamples: Array<{ audio: number; video: number; reportAt: number }> = [];
    private silenceNoted = 0;
    // When the connection last had trouble — a restart, a dead path — so its
    // restarts can be given back once it has carried media for HEALTHY_RESET
    // since.
    private troubleAt = 0;
    // Since when escalation has waited for a restart to be negotiable again,
    // and why.
    private heldSince = 0;
    private heldWhy = '';
    private holdTimer: number | null = null;
    // A hold that ran out its SIGNALING_HOLD_MAX is spent until both sides
    // can be reached again: while it is, a side that is still out of reach
    // escalates as though nothing held it.
    private holdSpent = false;
    private readonly connectStartedAt = Date.now();
    private restarting = false;
    private lastOfferAt = 0;
    // The polite side is on the relay alone for an attempt and owes the
    // call's own policy back once it is over (liftRelayOnly).
    private relayOnlyOwed = false;
    private lastSilentNotice = new Map<'microphone' | 'camera', number>();
    private failed = false;
    private readonly refreshWatch = new Map<P2PSource, RefreshWatch>();
    private lastOutbound = new Map<P2PSource, OutboundVideo>();
    // Which of the other side's video sources a picture is expected from:
    // announced on, and not paused by a wish of this side's own.
    private expectedVideo = new Set<P2PSource>();
    // Decoded-frame progress per expected source, and whether the sender has
    // already been asked for a fresh picture in the current silence.
    private readonly videoProgress = new Map<P2PSource, { frames: number; since: number; refreshed: boolean; receivedAtAsk?: number; packetsAtAsk?: number }>();
    private readonly refreshedAt = new Map<P2PSource, number>();
    // What the last stats line said, so the trace holds a whole call: a line
    // on every change of ICE state and one every half minute otherwise.
    private loggedIce: string | null = null;
    private loggedStatsAt = 0;
    private bwe: { out: number | null; in: number | null } = { out: null, in: null };
    private readonly wanted = new Map<P2PSource, number>();
    private readonly shapedFrom = new Map<P2PSource, number>();
    private readonly paramChains = new Map<P2PSource, Promise<void>>();
    private readonly localTracks = new Map<P2PSource, MediaStreamTrack | null>();
    private readonly codecWatch = new Map<string, number>();
    private readonly brokenCodecs = new Set<string>();
    private readonly starvedNotedAt = new Map<string, number>();
    private peerCaps: CodecCaps | null = null;
    private ownCaps: CodecCaps;
    connection: P2PConnection = 'connecting';
    stats: P2PStats = { bytesSent: 0, bytesReceived: 0, rtt: null, packetLoss: 0, quality: 'unknown', candidatePair: null, restarts: 0, codecs: { videoSend: null, videoRecv: null, audioSend: null, audioRecv: null }, impl: { enc: null, dec: null }, counters: { inAudio: 0, inVideo: 0, outAudio: 0, outVideo: 0, remoteAudio: 0, remoteVideo: 0, remoteAt: 0 } };

    constructor( private readonly options: PeerOptions ) {
        this.ownCaps = options.caps;

        this.pc = openPeerConnection( {
            iceServers: options.iceServers,
            iceTransportPolicy: options.iceTransportPolicy,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        } );

        this.pc.onnegotiationneeded = () => { void this.negotiate(); };
        this.pc.onicecandidate = ( event ) => this.onIceCandidate( event );
        this.pc.ontrack = ( event ) => this.onTrack( event );
        this.pc.oniceconnectionstatechange = () => this.onIceStateChange();
        this.pc.onconnectionstatechange = () => this.onConnectionStateChange();

        // The impolite side offers first, with a warm section per source. The
        // polite side makes none of its own: a browser only matches offered
        // sections against transceivers made by addTrack, so a set made here
        // was answered with four fresh recvonly ones and offered back, a
        // second round with eight transceivers a side. It adopts the offered
        // sections instead (adoptOfferedSections) and answers sendrecv.
        if( ! options.polite ){
            for( const source of SOURCE_ORDER ){
                const init: RTCRtpTransceiverInit = { direction: 'sendrecv' };

                if( SOURCE_KIND[ source ] === 'video' ){
                    init.sendEncodings = [ { maxBitrate: source === 'screen_share' ? screenCeiling( SCREEN_DEFAULT_HEIGHT ) : CAMERA_MAX_BITRATE } ];
                } else {
                    init.sendEncodings = [ { maxBitrate: audioCeiling( source ) } ];
                }

                const transceiver = this.pc.addTransceiver( SOURCE_KIND[ source ], init );

                this.transceivers.set( source, transceiver );
                this.sourceOfTransceiver.set( transceiver, source );

                if( SOURCE_KIND[ source ] === 'video' ){
                    applyCodecPreferences( transceiver, offerOrder( this.ownCaps, source ) );
                }
            }
        }

        this.statsTimer = window.setInterval( () => { void this.collectStats(); }, STATS_INTERVAL );

        // A connection that has not come up in CONNECT_RELAY_AT is tried
        // over the relay alone before it is given up on: a path that ICE
        // cannot find in eight seconds is not going to be found, and a relay
        // allocation takes one or two.
        // A hold lets both of these go by: the ladder starts over when it
        // lifts (`releaseHold`).
        this.connectRelayTimer = window.setTimeout( () => {
            this.connectRelayTimer = null;

            if( this.closed || this.everConnected || this.held || this.restarting || this.restartDeadline !== null ) return;

            this.trace( 'no connection after ' + CONNECT_RELAY_AT + 'ms, trying the relay alone' );
            void this.restart( true, 'no connection', true );
        }, CONNECT_RELAY_AT );

        this.armConnectDeadline( CONNECT_DEADLINE );
    }

    private armConnectDeadline( after: number ): void {
        this.clearConnectDeadline();

        this.connectDeadline = window.setTimeout( () => {
            this.connectDeadline = null;

            if( this.closed || this.everConnected || this.held ) return;

            this.fail( 'ice_failed', 'no connection after ' + ( Date.now() - this.connectStartedAt ) + 'ms' );
        }, after );
    }

    get polite(): boolean {
        return this.options.polite;
    }

    private trace( line: string ): void {
        if( this.options.onTrace ){
            try {
                this.options.onTrace( line );
            } catch (e) {}
        }
    }

    // A warning goes to the console as before and to the trace as well: the
    // console is gone with the tab, and the trace is where a bad call is
    // read afterwards.
    private warn( line: string, error?: unknown ): void {
        const detail = error instanceof Error ? error.message : ( typeof error === 'string' ? error : '' );

        console.warn( 'p2p ' + line, error );
        this.trace( 'warn: ' + line + ( detail ? ' (' + detail.slice( 0, 160 ) + ')' : '' ) );
    }

    // The end of the direct path here, once. The reason goes to the trace
    // before the session hears it, because the session's hand-off tears
    // this down and the line would otherwise never be written.
    private fail( reason: string, why: string ): void {
        if( this.closed || this.failed ) return;

        this.failed = true;
        this.trace( 'giving the direct path up: ' + reason + ' (' + why + ')' );
        this.options.onFailed( reason );
    }

    private clearConnectDeadline(): void {
        if( this.connectDeadline !== null ){
            window.clearTimeout( this.connectDeadline );
            this.connectDeadline = null;
        }
    }

    setExpectInbound( expected: boolean ): void {
        if( this.expectInbound !== expected ){
            this.inboundChangedAt = Date.now();
            this.trace( 'expect inbound=' + expected );
        }

        this.expectInbound = expected;
    }

    // The relay's copy of the other side's latest counters, from the reply
    // to this side's pulse: a second witness beside the RTCP sender reports
    // for the question of whether the peer is sending.
    setPeerPulse( pulse: PeerPulse | null ): void {
        this.peerPulse = pulse;

        if( ! pulse ) return;

        const last = this.peerPulses[ this.peerPulses.length - 1 ];

        if( last && last.relayAt === pulse.at ) return;

        this.peerPulses.push( { ...pulse, relayAt: pulse.at, at: Date.now() } );

        if( this.peerPulses.length > SAMPLE_HISTORY ) this.peerPulses.shift();
    }

    // This side's counters for the relay, as the last stats pass read them.
    pulseBody(): PulseBody {
        const counters = this.stats.counters;

        return {
            ice: this.pc.iceConnectionState,
            in: { a: counters.inAudio, v: counters.inVideo },
            out: { a: counters.outAudio, v: counters.outVideo }
        };
    }

    // Which video sources a picture is expected from right now. A source that
    // stops being expected drops its clock, and one that starts being expected
    // starts it from now, so a camera just turned on gets the whole grace
    // before it is asked for again.
    setExpectedVideo( sources: Set<P2PSource> ): void {
        for( const source of Array.from( this.videoProgress.keys() ) ){
            if( ! sources.has( source ) ) this.videoProgress.delete( source );
        }

        this.expectedVideo = new Set( sources );
    }

    get isConnected(): boolean {
        const state = this.pc.iceConnectionState;

        return state === 'connected' || state === 'completed';
    }

    // A track that arrives before this side has a section for it (the polite
    // side, before the offer) is kept and swapped in when the section comes.
    async setLocalTrack( source: P2PSource, track: MediaStreamTrack | null ): Promise<void> {
        if( this.closed ) return;

        this.localTracks.set( source, track );

        // A wish of zero was the other side saying "I am not drawing this" —
        // true until this moment, because nothing was being sent. Kept, it
        // would switch the sender off the instant the track arrived, and the
        // other side would never see a picture to raise the wish for. It
        // goes, and their next wish shapes the sender properly.
        if( track && this.wanted.get( source ) === 0 ){
            this.wanted.delete( source );
        }

        const transceiver = this.transceivers.get( source );

        if( ! transceiver ) return;

        await this.attachLocalTrack( transceiver, source, track );
    }

    private async attachLocalTrack( transceiver: RTCRtpTransceiver, source: P2PSource, track: MediaStreamTrack | null ): Promise<void> {
        try {
            await transceiver.sender.replaceTrack( track );
        } catch (e) {
            if( ! this.closed ) this.warn( 'replaceTrack failed', e );
        }

        // The scale is relative to the track, and a new track may be another
        // size. A screen share that starts before the other side has said how
        // big it shows it is shaped anyway (1080 lines, the detail-first
        // degradation, the screen's codec), so a 4K capture is never encoded
        // whole for the second or two before the wish arrives. A track taken
        // away is shaped too: the encoding goes inactive for the pause, and
        // its coming back is then a change the browser acts on.
        if( SOURCE_KIND[ source ] === 'video' ){
            this.applyWanted( source );
        }
    }

    private nextFreeSource( kind: string ): P2PSource | null {
        for( const source of SOURCE_ORDER ){
            if( SOURCE_KIND[ source ] === kind && ! this.transceivers.has( source ) ) return source;
        }

        return null;
    }

    // The sections a remote offer created become this side's transceivers,
    // matched to sources by the mid map that travels with the offer (by kind
    // and order without one): direction sendrecv so the answer carries this
    // side's media as well, and the local tracks swapped in before it is made.
    private async adoptOfferedSections(): Promise<void> {
        const attach: Promise<void>[] = [];

        for( const transceiver of this.pc.getTransceivers() ){
            if( ! transceiver.mid || this.sourceOfTransceiver.has( transceiver ) ) continue;

            const kind = transceiver.receiver.track ? transceiver.receiver.track.kind : '';
            const mapped = this.remoteMids[ transceiver.mid ];
            const source = mapped && ! this.transceivers.has( mapped ) ? mapped : this.nextFreeSource( kind );

            if( ! source || SOURCE_KIND[ source ] !== kind ) continue;

            this.transceivers.set( source, transceiver );
            this.sourceOfTransceiver.set( transceiver, source );

            try {
                transceiver.direction = 'sendrecv';
            } catch (e) {
                if( ! this.closed ) this.warn( 'could not answer sendrecv', e );
            }

            if( kind === 'video' ){
                applyCodecPreferences( transceiver, answerOrder( this.ownCaps, this.peerCaps, source ) );
            }

            const track = this.localTracks.get( source );

            if( track ){
                attach.push( this.attachLocalTrack( transceiver, source, track ) );
            }
        }

        await Promise.all( attach );
    }

    // The other side says how big it shows each of our video sources (a
    // VIEW_STEPS height, 0 = not at all): encode no bigger than that, and
    // nothing at all for a source nobody is looking at.
    setWanted( view: ViewHint ): void {
        for( const source of [ 'camera', 'screen_share' ] as const ){
            const raw = view[ source ];

            if( typeof raw !== 'number' || ! Number.isFinite( raw ) ) continue;

            const height = Math.max( 0, Math.round( raw ) );

            if( this.wanted.get( source ) === height ) continue;

            this.wanted.set( source, height );
            this.applyWanted( source );
        }
    }

    // What the other side can encode and decode; each video sender picks its
    // codec from that and this side's own abilities.
    setPeerCaps( caps: CodecCaps ): void {
        this.peerCaps = caps;

        for( const source of SOURCE_ORDER ){
            if( SOURCE_KIND[ source ] === 'video' ) this.applyWanted( source );
        }
    }

    // This side's own abilities, narrowed because a codec was caught carrying
    // nothing. Each video section is re-ordered without it and the call is
    // offered again: a sender takes its codec from the order in the
    // description it was given, so this is the only thing that moves a peer
    // that cannot switch a live sender. A peer that can switch has already
    // been told by the caps that went out with this.
    setOwnCaps( caps: CodecCaps ): void {
        if( this.closed ) return;

        this.ownCaps = caps;

        for( const [ source, transceiver ] of this.transceivers ){
            if( SOURCE_KIND[ source ] !== 'video' ) continue;

            applyCodecPreferences( transceiver, this.polite ? answerOrder( this.ownCaps, this.peerCaps, source ) : offerOrder( this.ownCaps, source ) );
        }

        for( const source of SOURCE_ORDER ){
            if( SOURCE_KIND[ source ] === 'video' ) this.applyWanted( source );
        }

        void this.negotiate();
    }

    private get negotiated(): boolean {
        return !! this.pc.currentLocalDescription && !! this.pc.currentRemoteDescription;
    }

    // Chrome refuses setParameters before the first negotiation, so a wish
    // that arrives early is kept and applied once ICE connects. Audio has no
    // wish, only its ceiling, which the adopted sections of the polite side
    // get the same way.
    private applyWanted( source: P2PSource ): void {
        if( this.closed || ! this.negotiated ) return;

        const transceiver = this.transceivers.get( source );

        if( ! transceiver ) return;

        if( SOURCE_KIND[ source ] === 'audio' ){
            this.applyAudioCeiling( transceiver, source );
            return;
        }

        const run = async () => {
            if( this.closed ) return;

            const sender = transceiver.sender;
            const wanted = this.wanted.get( source );
            let params: RTCRtpSendParameters;

            try {
                params = sender.getParameters();
            } catch (e) {
                return;
            }

            if( ! params.encodings || params.encodings.length === 0 ) return;

            const encoding = params.encodings[0];

            // The codec for this direction: for the camera, hardware on both
            // ends when there is one among the negotiated codecs and the best
            // both handle if not; for the screen, the codec that keeps text.
            const negotiated = ( params.codecs || [] ).map( ( codec ) => familyOf( codec ) ).filter( ( family ): family is string => family !== null );
            const family = this.peerCaps && negotiated.length > 0 ? chooseSendFamily( this.ownCaps, this.peerCaps, negotiated, source ) : null;
            const codec = family ? negotiatedCodec( params.codecs || [], family ) : null;
            const fast = !! family && !! this.peerCaps && fastDirection( this.ownCaps, this.peerCaps, family );
            const shape = source === 'screen_share' ? screenShape( wanted, sender.track, fast ) : cameraShape( wanted, sender.track );

            // A source with no track is an inactive encoding, not an idle
            // active one. The pause is then a real allocation change held for
            // as long as the camera is off, and the camera coming back is
            // another one — which is what makes the sender probe for
            // bandwidth again. Measured 16 Sep 2026, phone → Firefox: a
            // camera switched off and on again sent not one packet for
            // thirty seconds and through two encoder restarts, because the
            // estimate had fallen to what audio alone justifies and nothing
            // it did changed its allocation; the one write that changed it
            // brought the picture back at once.
            if( ! sender.track ) shape.active = false;

            // Nothing to say means nothing to write.
            //
            // Several paths reach here inside the first second of a call — a
            // track attaching, caps arriving from either side, negotiation
            // completing — and each used to write whether or not anything had
            // changed. On Android the same omission was the whole of the codec
            // lottery: a write that touches the scale or the frame rate makes
            // libwebrtc rebuild the encoder, seven of them in 750 ms, and the
            // codec the call kept was wherever the rebuilding stopped. The
            // audio path below has always had this guard.
            //
            // The codec belongs in the comparison: switching a live sender's
            // codec is done through this same parameter, and skipping the
            // write because the size matches would strand it on the old one.
            const wantedCodec = codec ? codec.mimeType : null;
            const currentCodec = ( encoding as any ).codec ? ( encoding as any ).codec.mimeType : null;

            if( encoding.active === shape.active
                && encoding.maxBitrate === shape.maxBitrate
                && encoding.scaleResolutionDownBy === shape.scale
                && ( encoding.maxFramerate ?? null ) === ( shape.maxFramerate ?? null )
                && currentCodec === wantedCodec
                && this.shapedFrom.get( source ) === trackHeight( sender.track ) ){
                return;
            }

            encoding.active = shape.active;
            encoding.maxBitrate = shape.maxBitrate;
            encoding.scaleResolutionDownBy = shape.scale;

            // The scale is relative to the capture, so the size it was worked
            // out from is kept: a shared window the other person resizes
            // changes the capture under us, and nothing else would notice.
            this.shapedFrom.set( source, trackHeight( sender.track ) );

            if( shape.maxFramerate ){
                encoding.maxFramerate = shape.maxFramerate;
            } else {
                delete encoding.maxFramerate;
            }

            // Text must stay readable when the link is short: the screen
            // encoder gives up frames before pixels. The camera keeps the
            // browser's own balance.
            if( source === 'screen_share' ){
                params.degradationPreference = 'maintain-resolution';
            }

            if( codec ){
                ( encoding as any ).codec = { mimeType: codec.mimeType, clockRate: codec.clockRate, sdpFmtpLine: codec.sdpFmtpLine, channels: codec.channels };
            }

            try {
                await sender.setParameters( params );
            } catch (e) {
                if( ! this.closed ) this.warn( 'setParameters failed', e );
            }
        };

        const chain = ( this.paramChains.get( source ) ?? Promise.resolve() ).then( run, run );

        this.paramChains.set( source, chain );
    }

    private applyAudioCeiling( transceiver: RTCRtpTransceiver, source: P2PSource ): void {
        const run = async () => {
            if( this.closed ) return;

            let params: RTCRtpSendParameters;

            try {
                params = transceiver.sender.getParameters();
            } catch (e) {
                return;
            }

            if( ! params.encodings || params.encodings.length === 0 ) return;

            const ceiling = audioCeiling( source );

            if( params.encodings[0].maxBitrate === ceiling ) return;

            params.encodings[0].maxBitrate = ceiling;

            try {
                await transceiver.sender.setParameters( params );
            } catch (e) {
                if( ! this.closed ) this.warn( 'audio setParameters failed', e );
            }
        };

        const chain = ( this.paramChains.get( source ) ?? Promise.resolve() ).then( run, run );

        this.paramChains.set( source, chain );
    }

    private midMap(): Record<string, P2PSource> {
        const map: Record<string, P2PSource> = {};

        for( const transceiver of this.pc.getTransceivers() ){
            const source = this.sourceOfTransceiver.get( transceiver );

            if( transceiver.mid && source ){
                map[ transceiver.mid ] = source;
            }
        }

        return map;
    }

    private async negotiate(): Promise<void> {
        if( this.closed ) return;

        if( this.polite && ! this.pc.remoteDescription ){
            return;
        }

        try {
            this.makingOffer = true;
            await this.pc.setLocalDescription();

            if( this.closed ) return;

            if( this.pc.localDescription ){
                this.options.send( { kind: 'sdp', description: this.outgoing( this.pc.localDescription ), mids: this.midMap() } );
            }
        } catch (e) {
            this.warn( 'negotiation failed', e );
        } finally {
            this.makingOffer = false;
        }
    }

    handleSignal( body: SignalBody ): Promise<void> {
        const run = () => this.processSignal( body ).catch( ( e ) => {
            if( ! this.closed ) this.warn( 'signal failed', e );
        } );

        this.signalChain = this.signalChain.then( run, run );

        return this.signalChain;
    }

    private async processSignal( body: SignalBody ): Promise<void> {
        if( this.closed ) return;

        if( body.kind === 'sdp' ){
            const description = body.description;
            const offerCollision = description.type === 'offer' && ( this.makingOffer || this.pc.signalingState !== 'stable' );

            if( description.type === 'offer' ) this.lastOfferAt = Date.now();

            this.ignoreOffer = ! this.polite && offerCollision;

            if( this.ignoreOffer ) return;

            if( body.mids ){
                this.applyRemoteMids( body.mids );
            }

            // Lines for payload types the description does not declare go
            // first, whatever else happens to it: a description that arrived
            // with them is refused whole (withoutOrphanPayloads). Then the
            // stereo screen audio, which must never cost the call: anything
            // the browser will not take is retried as it arrived, less those
            // lines, before the call is given up on.
            const arrived = this.incoming( description );

            try {
                await this.pc.setRemoteDescription( this.withStereoScreenAudio( arrived ) );
            } catch (e) {
                let recovered = false;

                try {
                    await this.pc.setRemoteDescription( arrived );
                    recovered = true;
                    this.warn( 'kept the description as it arrived', e );
                } catch (again) {
                    if( ! this.closed ) this.warn( 'setRemoteDescription failed', again );
                }

                if( ! recovered ) return;
            }

            if( this.closed ) return;

            await this.flushCandidates();

            if( description.type === 'offer' && ! this.closed ){
                await this.adoptOfferedSections();

                if( this.closed ) return;

                try {
                    await this.pc.setLocalDescription();

                    if( this.closed ) return;

                    if( this.pc.localDescription ){
                        this.options.send( { kind: 'sdp', description: this.outgoing( this.pc.localDescription ), mids: this.midMap() } );
                    }
                } catch (e) {
                    this.warn( 'answer failed', e );
                }

                // Adopted sections carry no encoding ceiling of their own; it
                // is set the same way a wish is, now that the answer is in.
                for( const source of SOURCE_ORDER ){
                    this.applyWanted( source );
                }
            }

            return;
        }

        if( body.kind === 'candidate' ){
            const parsed = parseCandidate( body.candidate );

            if( parsed && parsed.type === 'srflx' && parsed.address ){
                this.remotePublicIps.add( parsed.address );
                this.reviewHeldCandidates();
            }

            if( parsed && parsed.type === 'host' && parsed.isPrivate ){
                this.holdPrivateCandidate( body.candidate );
                return;
            }

            await this.addRemoteCandidate( body.candidate );
            return;
        }

        if( body.kind === 'refresh' ){
            this.refreshSource( body.source );
        }
    }

    // The other side has seen nothing from one of this side's video sources
    // for a while and asks for a fresh picture. The encoder is stopped and
    // started again through the encoding's `active` flag, which every browser
    // answers with a keyframe. A source that is off, or that the other side
    // itself asked to be paused, has nothing to start over.
    private refreshSource( source: P2PSource ): void {
        if( this.closed || SOURCE_KIND[ source ] !== 'video' ) return;

        const transceiver = this.transceivers.get( source );
        const track = transceiver ? transceiver.sender.track : null;

        if( ! transceiver || ! track || track.readyState !== 'live' || this.wanted.get( source ) === 0 ) return;

        const now = Date.now();

        if( now - ( this.refreshedAt.get( source ) ?? 0 ) < REFRESH_MIN_INTERVAL ) return;

        this.refreshedAt.set( source, now );

        // What the source had put out so far, so the frames the capture
        // produces from here can be held against the frames that get
        // encoded: an encoder that takes the capture and turns none of it
        // into frames is dead, and it is this end that can see so.
        const before = this.lastOutbound.get( source );

        this.refreshWatch.set( source, { at: now, encoded: before ? before.encoded : 0, produced: before ? before.produced : null, family: before ? before.family : null } );
        this.trace( 'starting the ' + source + ' encoder over, the other side sees no picture' );

        const sender = transceiver.sender;

        const toggle = async ( active: boolean ) => {
            if( this.closed ) return;

            let params: RTCRtpSendParameters;

            try {
                params = sender.getParameters();
            } catch (e) {
                return;
            }

            if( ! params.encodings || params.encodings.length === 0 ) return;

            params.encodings[0].active = active;

            try {
                await sender.setParameters( params );
            } catch (e) {
                if( ! this.closed ) this.warn( 'refresh setParameters failed', e );
            }
        };

        // Held off for a moment, not flipped: off and on in the same breath
        // is no net change to the bandwidth allocation, and it is that change
        // the browser probes on. Measured 16 Sep 2026: the flip restarted
        // nothing, a held change did.
        const run = async () => {
            await toggle( false );
            await new Promise( ( resolve ) => window.setTimeout( resolve, REFRESH_HOLD ) );
            await toggle( true );
        };

        const chain = ( this.paramChains.get( source ) ?? Promise.resolve() ).then( run, run );

        this.paramChains.set( source, chain );
    }

    private async addRemoteCandidate( candidate: RTCIceCandidateInit ): Promise<void> {
        if( this.closed ) return;

        if( ! this.pc.remoteDescription ){
            this.pendingCandidates.push( candidate );
            return;
        }

        try {
            await this.pc.addIceCandidate( candidate );
        } catch (e) {
            if( ! this.ignoreOffer && ! this.closed ){
                this.warn( 'addIceCandidate failed', e );
            }
        }
    }

    private holdPrivateCandidate( candidate: RTCIceCandidateInit ): void {
        if( this.options.iceTransportPolicy === 'relay' || this.privateDecision === 'drop' ){
            return;
        }

        if( this.privateDecision === 'keep' ){
            void this.addRemoteCandidate( candidate );
            return;
        }

        this.heldPrivateCandidates.push( candidate );
        this.reviewHeldCandidates();

        if( this.privateHoldTimer === null ){
            this.privateHoldTimer = window.setTimeout( () => {
                this.privateHoldTimer = null;
                this.decidePrivateCandidates( 'keep' );
            }, PRIVATE_HOLD );
        }
    }

    private reviewHeldCandidates(): void {
        if( this.privateDecision !== null || this.localPublicIps.size === 0 || this.remotePublicIps.size === 0 ) return;

        let shared = false;

        for( const ip of this.remotePublicIps ){
            if( this.localPublicIps.has( ip ) ) shared = true;
        }

        this.decidePrivateCandidates( shared ? 'keep' : 'drop' );
    }

    private decidePrivateCandidates( decision: 'keep' | 'drop' ): void {
        if( this.privateDecision !== null ) return;

        this.privateDecision = decision;

        if( this.privateHoldTimer !== null ){
            window.clearTimeout( this.privateHoldTimer );
            this.privateHoldTimer = null;
        }

        const held = this.heldPrivateCandidates;

        this.heldPrivateCandidates = [];

        if( decision === 'keep' ){
            for( const candidate of held ){
                void this.addRemoteCandidate( candidate );
            }
        }
    }

    private async flushCandidates(): Promise<void> {
        const pending = this.pendingCandidates;

        this.pendingCandidates = [];

        for( const candidate of pending ){
            try {
                await this.pc.addIceCandidate( candidate );
            } catch (e) {
                this.warn( 'queued candidate failed', e );
            }
        }
    }

    private onIceCandidate( event: RTCPeerConnectionIceEvent ): void {
        if( ! event.candidate || ! event.candidate.candidate ) return;

        const parsed = parseCandidate( event.candidate.toJSON() );

        if( parsed && parsed.type === 'srflx' && parsed.address ){
            this.localPublicIps.add( parsed.address );
            this.reviewHeldCandidates();
        }

        this.options.send( { kind: 'candidate', candidate: event.candidate.toJSON() } );
    }

    private withStereoScreenAudio( description: RTCSessionDescriptionInit ): RTCSessionDescriptionInit {
        try {
            if( ! description.sdp ) return description;

            const sdp = withStereoOpus( description.sdp );

            return sdp ? { type: description.type, sdp } : description;
        } catch (e) {
            this.warn( 'could not mark the screen audio stereo', e );

            return description;
        }
    }

    // The local description as it goes on the wire: without any line for a
    // payload type its section does not declare (withoutOrphanPayloads).
    // The description this side keeps is untouched, and the answer that
    // comes back names only the payload types on the m-line anyway.
    private outgoing( description: RTCSessionDescription ): RTCSessionDescriptionInit {
        const json = description.toJSON() as RTCSessionDescriptionInit;

        try {
            const result = withoutOrphanPayloads( json.sdp ?? '' );

            if( result.dropped.length > 0 ){
                this.trace( ( json.type ?? 'description' ) + ' sent without ' + describeDropped( result.dropped ) );
            }

            return { type: json.type, sdp: result.sdp };
        } catch (e) {
            return json;
        }
    }

    // A description as it arrived, less the same lines: a peer older than
    // the fix on the sending side still sends them.
    private incoming( description: RTCSessionDescriptionInit ): RTCSessionDescriptionInit {
        try {
            if( ! description.sdp ) return description;

            const result = withoutOrphanPayloads( description.sdp );

            if( result.dropped.length > 0 ){
                this.trace( ( description.type ?? 'description' ) + ' arrived with ' + describeDropped( result.dropped ) + ', dropped before applying it' );
            }

            return { type: description.type, sdp: result.sdp };
        } catch (e) {
            return description;
        }
    }

    private applyRemoteMids( mids: Record<string, P2PSource> ): void {
        this.remoteMids = mids;

        for( const [ mid, track ] of this.remoteByMid.entries() ){
            const source = mids[ mid ];

            if( source && source !== track.source ){
                this.remoteByMid.delete( mid );
                this.remoteBySource.delete( track.source );
                this.options.onTrack( track.source, null );
                track.detach();

                const renamed = new RemoteMediaTrack( track.mediaStreamTrack, source, this.options.onPlaybackBlocked, this.options.onViewChange );

                this.remoteByMid.set( mid, renamed );
                this.remoteBySource.set( source, renamed );
                this.options.onTrack( source, renamed );
            }
        }
    }

    private guessSource( kind: string ): P2PSource {
        if( kind === 'audio' ){
            return this.remoteBySource.has( 'microphone' ) ? 'screen_share_audio' : 'microphone';
        }

        return this.remoteBySource.has( 'camera' ) ? 'screen_share' : 'camera';
    }

    private onTrack( event: RTCTrackEvent ): void {
        const mid = event.transceiver ? event.transceiver.mid : null;
        const source = ( mid && this.remoteMids[ mid ] ) ? this.remoteMids[ mid ] : this.guessSource( event.track.kind );
        const track = new RemoteMediaTrack( event.track, source, this.options.onPlaybackBlocked, this.options.onViewChange );

        if( mid ){
            this.remoteByMid.set( mid, track );
        }

        const previous = this.remoteBySource.get( source );

        if( previous ){
            previous.detach();
        }

        this.remoteBySource.set( source, track );

        event.track.onended = () => {
            if( this.remoteBySource.get( source ) === track ){
                this.remoteBySource.delete( source );
                if( mid ) this.remoteByMid.delete( mid );
                track.detach();
                this.options.onTrack( source, null );
            }
        };

        this.options.onTrack( source, track );
    }

    remoteTrack( source: P2PSource ): RemoteMediaTrack | null {
        return this.remoteBySource.get( source ) ?? null;
    }

    private setConnection( state: P2PConnection ): void {
        if( this.connection === state ) return;

        this.connection = state;
        this.options.onConnection( state );
    }

    private clearRestartTimers(): void {
        if( this.restartTimer !== null ){
            window.clearTimeout( this.restartTimer );
            this.restartTimer = null;
        }

        if( this.restartDeadline !== null ){
            window.clearTimeout( this.restartDeadline );
            this.restartDeadline = null;
        }
    }

    private onIceStateChange(): void {
        if( this.closed ) return;

        const state = this.pc.iceConnectionState;

        // From the event itself, not the stats tick two seconds later: a
        // state that comes and goes inside one tick used to leave no line.
        this.trace( 'ice ' + state );

        // The restarts are not given back here but once media has flowed for
        // HEALTHY_RESET: a connection that comes up and drops again at once
        // is one that cannot be kept, and it used to be restarted for ever.
        if( state === 'connected' || state === 'completed' ){
            this.everConnected = true;
            this.connectedAt = Date.now();
            this.inboundChangedAt = this.connectedAt;
            this.clearRestartTimers();
            this.clearConnectDeadline();
            this.setConnection( 'connected' );

            for( const source of SOURCE_ORDER ){
                this.applyWanted( source );
            }
        } else if( state === 'disconnected' ){
            this.setConnection( 'reconnecting' );
            this.scheduleRestart( DISCONNECT_GRACE, 'ice disconnected' );
        } else if( state === 'failed' ){
            this.setConnection( 'reconnecting' );
            this.scheduleRestart( 0, 'ice failed' );
        }
    }

    private onConnectionStateChange(): void {
        if( this.closed ) return;

        if( this.pc.connectionState === 'failed' ){
            this.trace( 'connection state failed' );
            this.setConnection( 'reconnecting' );
            this.scheduleRestart( 0, 'connection failed' );
        }
    }

    // A restart the ICE state asked for. The polite side waits a moment
    // longer so the two do not restart into each other. The first of an
    // incident goes out on every candidate, relay ones included, because the
    // usual cause is one side moving to another network, where a new direct
    // path is often there to be found; any after it go over the relay alone.
    // An attempt already in flight is left to its own deadline.
    //
    // The polite side's wait is the other side's to use, and an offer that
    // came in it is this side's attempt, watched rather than restarted over
    // (takeOtherAttempt), the way a dead path's is. It used to restart when
    // the wait ran out whatever had arrived: on a slow path — TURN over TCP on
    // 443 — that abandoned the checks the other side's restart had begun, the
    // other side's next restart did the same to this one's, and the two ran
    // both budgets out between them.
    private scheduleRestart( delay: number, why: string ): void {
        if( this.restartTimer !== null || this.restarting || this.restartDeadline !== null ) return;

        const startedAt = Date.now();
        const wait = this.polite ? delay + POLITE_RESTART_DELAY : delay;

        this.restartTimer = window.setTimeout( () => {
            this.restartTimer = null;

            if( this.polite && this.lastOfferAt >= startedAt && ! this.isConnected && this.takeOtherAttempt( null ) ) return;

            void this.restart( false, why, this.restartCount > 0 );
        }, wait );
    }

    // The other side's restart, arrived while this side was waiting to make
    // its own, taken as this side's attempt: counted, and watched on the same
    // deadline as a restart of its own. A spent budget or a hold is decided
    // the way it always was, by the restart this would otherwise have made.
    private takeOtherAttempt( giveUp: string | null ): boolean {
        if( this.closed || this.failed || this.held || this.restartCount >= MAX_RESTARTS ) return false;

        this.restartCount++;
        this.troubleAt = Date.now();
        this.trace( 'the other side restarted, this side answered and watches it (restart ' + this.restartCount + ' of ' + MAX_RESTARTS + ')' );
        this.watchAttempt( 'the other side\'s restart', giveUp );

        return true;
    }

    // Whether escalation is waiting for a restart to be negotiable again.
    get held(): boolean {
        return this.heldSince > 0;
    }

    // Told by the session on every stats tick and whenever either side's
    // presence changes. While this side's socket is down, or the relay has
    // said the other side's is, no offer can reach the other side: a restart
    // made then counted as a failed attempt, and a network change of ten
    // seconds on one side ran the budget out and put the call in the room for
    // good. Held, nothing escalates; released, the ladder starts over.
    setSignalingHeld( held: boolean, why: string ): void {
        if( this.closed || this.failed ) return;

        if( ! held ){
            // Both sides can be reached: whatever held before is over, and
            // the next time one of them goes gets a hold of its own.
            this.holdSpent = false;

            if( this.heldSince > 0 ) this.releaseHold( why );

            return;
        }

        if( this.heldSince > 0 || this.holdSpent ) return;

        this.heldSince = Date.now();
        this.heldWhy = why;
        this.clearRestartTimers();
        this.trace( 'escalation held: ' + why );

        // Not for ever: a side that stays out of reach this long is not
        // coming back through the relay, and the old road — the room, or the
        // end of the call — is what is left. The hold is spent then, not
        // lifted for a moment: the session asks for it again on every stats
        // tick, and taken again it cancelled the restart the release had
        // just scheduled, so a side whose own socket stayed down sat on
        // "Reconnecting" for as long as the page stayed open, its camera and
        // microphone live.
        this.holdTimer = window.setTimeout( () => {
            this.holdTimer = null;

            if( this.heldSince === 0 ) return;

            this.holdSpent = true;
            this.releaseHold( 'still out of reach after ' + ( SIGNALING_HOLD_MAX / 1000 ) + 's, the hold is spent until both sides can be reached again' );
        }, SIGNALING_HOLD_MAX );
    }

    private releaseHold( why: string ): void {
        const heldFor = Date.now() - this.heldSince;

        this.heldSince = 0;
        this.heldWhy = '';

        if( this.holdTimer !== null ){
            window.clearTimeout( this.holdTimer );
            this.holdTimer = null;
        }

        // What was tried while the other side could not hear it says nothing
        // about the path, so the restarts are all there again.
        this.restartCount = 0;
        this.trace( 'escalation released after ' + ( heldFor / 1000 ).toFixed( 1 ) + 's: ' + why );

        if( this.closed || this.failed ) return;

        if( ! this.everConnected ){
            this.armConnectDeadline( MAX_RESTARTS * RESTART_DEADLINE + 2000 );
        }

        if( ! this.isConnected ){
            this.scheduleRestart( 0, 'the other side can be reached again' );
        }
    }

    // The verdict on a silence: STALL_TIMEOUT with nothing arriving from a
    // peer that has something on. What it means depends on what the peer
    // itself says it did meanwhile — its RTCP sender reports travel over the
    // same transport, and the relay's pulse carries the same counts by
    // another road.
    // The verdict on a silence that began at `since`. Only samples taken
    // after it began count: a sender report says what was sent up to the
    // moment it was sent, and a pulse what was read up to PULSE_LAG before it
    // arrived, so the first sample of each after `since` is the baseline and
    // growth past it is sending during the silence. Two such samples are
    // needed either way; with fewer the verdict waits a tick, up to twice
    // STALL_TIMEOUT, after which a silence nobody can account for is treated
    // as a dead path. Returns whether a verdict was reached.
    private judgeSilence( now: number, since: number, counters: P2PCounters ): boolean {
        const quiet = ( now - since ) / 1000;
        const reports = this.remoteSamples.filter( ( sample ) => sample.reportAt >= since );
        const pulses = this.peerPulses.filter( ( pulse ) => pulse.at - PULSE_LAG >= since );
        const growth = ( first: { a: number; v: number } | undefined, last: { a: number; v: number } | undefined ) => first && last ? ( last.a - first.a ) + ( last.v - first.v ) : 0;
        const byReports = reports.length >= 2 ? growth( { a: reports[0].audio, v: reports[0].video }, { a: reports[ reports.length - 1 ].audio, v: reports[ reports.length - 1 ].video } ) : 0;
        const byPulses = pulses.length >= 2 ? growth( pulses[0].out, pulses[ pulses.length - 1 ].out ) : 0;
        const lastPulse = this.peerPulses[ this.peerPulses.length - 1 ];
        const peerAlive = ( counters.remoteAt > 0 && now - counters.remoteAt <= REMOTE_REPORT_AGE ) || ( !! lastPulse && now - lastPulse.at <= REMOTE_REPORT_AGE );

        if( byReports >= SILENCE_SENT_MIN || byPulses >= SILENCE_SENT_MIN ){
            this.trace( 'no inbound for ' + quiet.toFixed( 1 ) + 's while the peer sent ' + ( byReports >= SILENCE_SENT_MIN ? byReports + ' packets by its own reports' : byPulses + ' packets by the relay\'s pulses' ) + ' during it: the path is dead' );
            this.pathDead( 'nothing arrives while the peer sends' );

            return true;
        }

        if( reports.length >= 2 || pulses.length >= 2 ){
            // The transport is fine — the peer's word keeps coming — and it
            // sent nothing during the silence. That is its capture, and no
            // restart mends a microphone. It is told, and the call goes on.
            const source: 'microphone' | 'camera' = this.expectedVideo.size > 0 && counters.inVideo === 0 ? 'camera' : 'microphone';
            const last = this.lastSilentNotice.get( source ) ?? 0;

            const trickle = Math.max( byReports, byPulses );

            this.trace( 'no inbound for ' + quiet.toFixed( 1 ) + 's and the peer sent ' + ( trickle > 0 ? 'nothing but ' + trickle + ' padding packets' : 'nothing' ) + ' during it (' + ( reports.length >= 2 ? 'by its own reports' : 'by the relay\'s pulses' ) + '): its ' + source + ' stopped, not the path' );

            if( now - last >= SILENT_NOTICE_MIN ){
                this.lastSilentNotice.set( source, now );
                this.options.onPeerSilent( source );
            }

            return true;
        }

        if( ! peerAlive ){
            // Nothing at all, not even RTCP: the transport is gone whatever
            // ICE still thinks, and the browser's own `disconnected` is a
            // few seconds behind this.
            this.trace( 'no inbound for ' + quiet.toFixed( 1 ) + 's and no word from the peer at all: the transport is dead' );
            this.pathDead( 'nothing arrives, not even the peer\'s reports' );

            return true;
        }

        if( now - since >= STALL_TIMEOUT * 2 ){
            this.trace( 'no inbound for ' + quiet.toFixed( 1 ) + 's and the peer\'s word does not settle it (' + reports.length + ' reports, ' + pulses.length + ' pulses since): treating the path as dead' );
            this.pathDead( 'nothing arrives and the silence cannot be accounted for' );

            return true;
        }

        if( this.silenceNoted === 0 ){
            this.silenceNoted = now;
            this.trace( 'no inbound for ' + quiet.toFixed( 1 ) + 's, waiting for the peer\'s word on it (' + reports.length + ' reports, ' + pulses.length + ' pulses since)' );
        }

        return false;
    }

    // A dead path is restarted over the relay alone, with fresh credentials,
    // until the restarts run out, and then it is the room. An attempt in
    // flight is judged by its own deadline. Only the impolite side restarts
    // at once: the polite one switches to the relay and gives the offer a
    // moment to arrive, restarting itself only if none does, so the two do
    // not restart into each other — and an offer that did arrive is this
    // side's attempt too, watched on the same deadline.
    private pathDead( why: string ): void {
        if( this.closed || this.failed ) return;

        if( this.held ){
            this.trace( 'the path looks dead (' + why + '), and no restart can be negotiated now: ' + this.heldWhy );
            return;
        }

        if( this.restarting || this.restartDeadline !== null || this.restartTimer !== null ) return;

        this.troubleAt = Date.now();

        if( this.restartCount >= MAX_RESTARTS ){
            this.fail( 'path_dead', why + ', after ' + this.restartCount + ' restarts over the relay' );
            return;
        }

        if( ! this.polite ){
            void this.restart( true, why, true, 'path_dead' );
            return;
        }

        const startedAt = Date.now();

        void this.useRelayOnly();

        this.restartTimer = window.setTimeout( () => {
            this.restartTimer = null;

            if( this.closed || this.failed || this.held ) return;

            if( this.lastOfferAt >= startedAt ){
                this.restartCount++;
                this.trace( 'the other side restarted over the relay, this side answered (restart ' + this.restartCount + ' of ' + MAX_RESTARTS + ')' );
                this.watchAttempt( 'the other side\'s restart', 'path_dead' );
                return;
            }

            void this.restart( true, why + ', no restart came from the other side', true, 'path_dead' );
        }, POLITE_RESTART_DELAY );
    }

    // The deadline an attempt has to bring the media back. A connection
    // still down is restarted again over the relay alone, and so is one that
    // came back carrying nothing; the restarts running out is the room. On
    // the polite side an offer that arrived meanwhile is the other side's
    // next attempt, begun at its own earlier deadline, and it is watched in
    // turn rather than restarted over.
    private watchAttempt( what: string, giveUp: string | null ): void {
        if( this.restartDeadline !== null ) window.clearTimeout( this.restartDeadline );

        const startedAt = Date.now();
        const inboundThen = this.inboundPackets;

        this.restartDeadline = window.setTimeout( () => {
            this.restartDeadline = null;

            if( this.closed || this.failed || this.held ) return;

            const down = ! this.isConnected;
            const empty = ! down && this.expectInbound && this.inboundPackets === inboundThen;

            if( ! down && ! empty ){
                this.trace( what + ' brought the media back in ' + ( Date.now() - startedAt ) + 'ms' );
                this.liftRelayOnly( what + ' brought the media back' );
                return;
            }

            if( this.polite && this.lastOfferAt >= startedAt && this.takeOtherAttempt( down ? giveUp : 'path_dead' ) ) return;

            if( down ){
                void this.restart( false, what + ' did not connect in ' + RESTART_DEADLINE + 'ms', true, giveUp );
            } else {
                void this.restart( true, what + ' connected and brought nothing in ' + RESTART_DEADLINE + 'ms', true, 'path_dead' );
            }
        }, RESTART_DEADLINE );
    }

    // The call's own ICE policy, back on the polite side once a relay-only
    // attempt of its is over: the attempt brought the media back, or the
    // restarts came back. A restart puts the policy each attempt needs in
    // place itself, but the polite side seldom makes one — it answers the
    // other side's and counts them — so one relay-only attempt left it on the
    // relay alone for the rest of the call, and every later restart the other
    // side made found no direct path on this end to come back to.
    private liftRelayOnly( why: string ): void {
        if( ! this.relayOnlyOwed || this.closed ) return;

        this.relayOnlyOwed = false;

        if( this.options.iceTransportPolicy === 'relay' ) return;

        const next: RTCConfiguration = { ...this.pc.getConfiguration(), iceTransportPolicy: this.options.iceTransportPolicy };

        try {
            this.pc.setConfiguration( next );
        } catch (e) {
            try {
                this.pc.setConfiguration( { ...next, iceServers: withoutTransportQuery( next.iceServers ?? [] ) } );
            } catch (again) {
                this.warn( 'could not go back to the call\'s own ICE policy', again );
                return;
            }
        }

        this.trace( 'back to the call\'s own ICE policy (' + this.options.iceTransportPolicy + '): ' + why );
    }

    // Relay candidates only, with credentials fresh enough to allocate on.
    private async useRelayOnly(): Promise<void> {
        const servers = await this.freshIceServers();

        if( this.closed ) return;

        try {
            const config = this.pc.getConfiguration();

            this.pc.setConfiguration( { ...config, iceServers: servers.length > 0 ? servers : config.iceServers, iceTransportPolicy: 'relay' } );
        } catch (e) {
            try {
                const config = this.pc.getConfiguration();

                this.pc.setConfiguration( { ...config, iceServers: withoutTransportQuery( servers ), iceTransportPolicy: 'relay' } );
            } catch (again) {
                this.warn( 'could not switch to relay only', again );
                return;
            }
        }

        this.relayOnlyOwed = this.polite;
    }

    // Fresh credentials inside a short budget, or none, and the connection
    // goes on with the ones it holds: a restart is the quick way out and must
    // not sit on a slow reply. The session keeps the budget, so the renewal
    // it schedules always counts from credentials this side was handed.
    private async freshIceServers(): Promise<IceServer[]> {
        try {
            return await this.options.refreshIceServers();
        } catch (e) {
            return [];
        }
    }

    // One attempt to bring the media back. `force` restarts a connection ICE
    // still calls connected, which is what a dead path is; `relay` takes it
    // over the relay alone, and otherwise it goes out on every candidate the
    // call was set up with, the relay's among them; `giveUp` is the reason
    // handed on once the restarts have run out. One at a time: two restarts
    // in flight each counted and each armed a deadline, and the second undid
    // the first.
    async restart( force = false, why = 'asked', relay = false, giveUp: string | null = null ): Promise<void> {
        if( this.closed || this.failed || ( this.isConnected && ! force ) || this.restarting ) return;

        if( this.held ){
            this.trace( 'restart (' + why + ') waits: ' + this.heldWhy );
            return;
        }

        this.troubleAt = Date.now();

        if( this.restartCount >= MAX_RESTARTS ){
            this.fail( giveUp ?? ( this.everConnected ? 'ice_lost' : 'ice_failed' ), why + ', ' + this.restartCount + ' restarts did not bring the media back' );
            return;
        }

        this.restarting = true;
        this.restartCount++;
        this.restartsTotal++;

        try {
            const servers = await this.freshIceServers();

            if( this.closed ) return;

            const config = this.pc.getConfiguration();
            // Back to the call's own policy when this one is not over the
            // relay alone: a restart that went relay-only used to leave the
            // connection so for the rest of the call.
            const next: RTCConfiguration = { ...config, iceServers: servers.length > 0 ? servers : config.iceServers, iceTransportPolicy: relay ? 'relay' : this.options.iceTransportPolicy };

            try {
                this.pc.setConfiguration( next );
            } catch (e) {
                try {
                    this.pc.setConfiguration( { ...next, iceServers: withoutTransportQuery( next.iceServers ?? [] ) } );
                } catch (again) {
                    this.warn( 'could not apply ice servers for the restart', again );
                }
            }

            // The polite side on the relay alone owes the call's own policy
            // back once this attempt is over; any other attempt has just put
            // it back.
            this.relayOnlyOwed = this.polite && relay;

            this.trace( 'ice restart #' + this.restartsTotal + ' (' + why + '), ' + this.restartCount + ' of ' + MAX_RESTARTS + ( relay ? ' over the relay alone' : ' on every candidate' ) + ' servers=' + ( servers.length > 0 ? 'fresh' : 'held' ) );

            await this.restartIceNow();
        } finally {
            this.restarting = false;
        }

        if( this.closed ) return;

        this.watchAttempt( 'restart #' + this.restartsTotal, giveUp );
    }

    private async restartIceNow(): Promise<void> {
        if( typeof this.pc.restartIce === 'function' ){
            this.pc.restartIce();
            return;
        }

        try {
            this.makingOffer = true;
            const offer = await this.pc.createOffer( { iceRestart: true } );
            await this.pc.setLocalDescription( offer );

            if( this.pc.localDescription ){
                this.options.send( { kind: 'sdp', description: this.outgoing( this.pc.localDescription ), mids: this.midMap() } );
            }
        } catch (e) {
            this.warn( 'ice restart failed', e );
        } finally {
            this.makingOffer = false;
        }
    }

    // New TURN credentials, before the ones the connection holds run out. An
    // allocation is refreshed with the credentials it was made with, and the
    // TURN server refuses those once they have expired, so a call relayed for
    // longer than their life (six hours by default) lost its relay mid-call.
    // Every later restart takes the new ones. A path that runs through this
    // side's own relay candidate is moved onto fresh allocations now, while
    // the old one still carries it, and that restart is not an attempt: it
    // counts as none. The polite side waits a little, so two relayed sides do
    // not offer into each other, and an offer from the other side meanwhile
    // has renewed this side's allocations already.
    renewRelay( servers: IceServer[] ): void {
        if( this.closed || this.failed || servers.length === 0 ) return;

        try {
            this.pc.setConfiguration( { ...this.pc.getConfiguration(), iceServers: servers } );
        } catch (e) {
            try {
                this.pc.setConfiguration( { ...this.pc.getConfiguration(), iceServers: withoutTransportQuery( servers ) } );
            } catch (again) {
                this.warn( 'could not apply the renewed ice servers', again );
                return;
            }
        }

        const relayed = this.stats.candidatePair?.local === 'relay';

        this.trace( 'relay credentials renewed' + ( relayed ? ', moving this side\'s relay onto fresh allocations' : '' ) );

        if( ! relayed ) return;

        const startedAt = Date.now();

        window.setTimeout( () => {
            if( this.closed || this.failed || this.held || this.restarting || ! this.isConnected ) return;

            if( this.lastOfferAt >= startedAt ){
                this.trace( 'the other side restarted meanwhile, which moved this side\'s relay too' );
                return;
            }

            this.restartsTotal++;
            this.trace( 'ice restart #' + this.restartsTotal + ' (the relay credentials are about to run out), not counted as an attempt' );
            void this.restartIceNow();
        }, this.polite ? RENEW_POLITE_DELAY : 0 );
    }

    // A local capture can change size on its own: a shared window being
    // resized, or a browser switching the shared surface. The scale in the
    // encoding was worked out from the old size, so it is redone when the
    // capture no longer matches.
    private reviewLocalSizes(): void {
        for( const [ source, transceiver ] of this.transceivers.entries() ){
            if( SOURCE_KIND[ source ] !== 'video' ) continue;

            const track = transceiver.sender.track;
            const shaped = this.shapedFrom.get( source );

            if( ! track || shaped === undefined ) continue;

            if( trackHeight( track ) !== shaped ) this.applyWanted( source );
        }
    }

    // A codec that negotiated and then carried nothing. The two sides of it
    // look alike in the statistics and neither shows up anywhere else: a
    // receiver taking packets that no frame ever comes out of, and a sender
    // handing frames to an encoder that emits none. Both mean the call is
    // running on something this device cannot actually do, and both are only
    // visible from the end it is happening at.
    private reviewCodecs( report: RTCStatsReport, byId: Map<string, any> ): void {
        const now = Date.now();

        const watch = ( key: string, dead: boolean, ready: boolean, grace: number ): boolean => {
            if( ! dead ){
                this.codecWatch.delete( key );

                return false;
            }

            if( ! ready ) return false;

            const since = this.codecWatch.get( key );

            if( since === undefined ){
                this.codecWatch.set( key, now );

                return false;
            }

            return now - since > grace;
        };

        // Whether anything is actually arriving for this sender to encode.
        //
        // `media-source.frames` answers that, but only where the browser links
        // the source to the sender: Firefox publishes the source and never
        // points at it from `outbound-rtp`, so the sending half went unwatched
        // on the browser whose encoder is the likeliest of the three to need
        // it — measured 11 Sep 2026, a Firefox without the OpenH264 plugin
        // took 180 camera frames, encoded none of them, and nothing noticed.
        //
        // Guessing the link back from the report does not work: a call always
        // carries a warm screen-share transceiver holding no track, which has
        // no source and never encodes a frame, so lending it the camera's
        // count writes off every codec the moment the camera starts. The
        // transceiver behind each `mid` can be asked directly instead, and it
        // knows what the stats only imply — a live, unmuted track is feeding
        // this m-section, so frames are arriving.
        const feeding = new Map<string, boolean>();

        for( const transceiver of this.pc.getTransceivers() ){
            const track = transceiver.sender.track;

            if( transceiver.mid === null ) continue;

            feeding.set( transceiver.mid, !! track && track.kind === 'video' && track.readyState === 'live' && ! track.muted );
        }

        report.forEach( ( entry: any ) => {
            if( entry.kind !== 'video' ) return;

            const codec = entry.codecId ? byId.get( entry.codecId ) : null;
            const family = codec && typeof codec.mimeType === 'string' ? familyOf( codec ) : null;

            if( ! family ) return;

            if( entry.type === 'inbound-rtp' ){
                const frames = Number( entry.framesReceived ?? 0 );
                const decoded = Number( entry.framesDecoded ?? 0 );
                const gaveUp = typeof entry.decoderImplementation === 'string' && DEAD_DECODER.test( entry.decoderImplementation );

                if( decoded === 0 && frames > 0 && gaveUp ){
                    this.onCodecBroken( family, 'dec' );

                    return;
                }

                // Keyed by family as well as stream, so the clock measures how
                // long *this family* has been failing rather than how long the
                // stream has. A stream's reported codec moves about while a
                // call is settling — Safari wrote off H265 on a call whose
                // answer never contained H265 and which ran H264 both ways at
                // 1080p, because the clock started on one codec and expired on
                // another. Losing H265 that way is not cosmetic: it persists,
                // so one call with an Android peer would quietly cost Safari
                // the best codec it has for every later call.
                if( watch( 'dec:' + entry.id + ':' + family, decoded === 0, frames >= CODEC_DECODE_FRAMES, CODEC_DECODE_GRACE ) ){
                    this.onCodecBroken( family, 'dec' );
                }

                return;
            }

            if( entry.type !== 'outbound-rtp' || entry.active === false ) return;

            const source = entry.mediaSourceId ? byId.get( entry.mediaSourceId ) : null;
            const produced = source ? Number( source.frames ?? NaN ) : NaN;

            // The frame count where the browser gives one, the transceiver's
            // own track where it does not. With neither, nothing vouches that
            // there is anything to encode, so `watch` never starts a clock on
            // this sender and it stays unwatched — which is what a warm
            // screen-share section with no track should get.
            const counted = Number.isFinite( produced );
            const ready = counted ? produced >= CODEC_ENCODE_FRAMES : feeding.get( entry.mid ) === true;

            const encoded = Number( entry.framesEncoded ?? 0 );
            const key = 'enc:' + entry.id + ':' + family;

            if( watch( key, encoded === 0, ready, counted ? CODEC_ENCODE_GRACE : CODEC_ENCODE_SLOW_GRACE ) ){
                const limit = typeof entry.qualityLimitationReason === 'string' ? entry.qualityLimitationReason : '?';
                const target = reportedTarget( entry );

                if( encoderStarved( limit, target ) ){
                    // Judged again from the start, once it has something to
                    // spend and still encodes nothing.
                    this.codecWatch.delete( key );
                    this.noteStarved( family, encoderLimit( limit, target ) );
                } else {
                    this.onCodecBroken( family, 'enc', encoderLimit( limit, target ) );
                }
            }
        } );
    }

    private noteStarved( family: string, why: string ): void {
        const now = Date.now();

        if( now - ( this.starvedNotedAt.get( family ) ?? 0 ) < STARVED_NOTE_EVERY ) return;

        this.starvedNotedAt.set( family, now );
        this.trace( family.replace( 'video/', '' ) + ' encodes nothing, but its encoder is starved (' + why + '): not written off' );
    }

    private onCodecBroken( family: string, direction: CodecDirection, why = '' ): void {
        const key = family + ':' + direction;

        if( this.closed || this.brokenCodecs.has( key ) ) return;

        this.brokenCodecs.add( key );

        this.warn( family + ' negotiated but ' + ( direction === 'dec' ? 'decoded no frame' : 'encoded no frame' ) + ( why ? ' (' + why + ')' : '' ) + ', dropping it' );

        this.options.onCodecBroken( family, direction );
    }

    private async collectStats(): Promise<void> {
        if( this.closed ) return;

        this.reviewLocalSizes();

        try {
            const report = await this.pc.getStats();
            const byId = new Map<string, any>();

            report.forEach( ( entry ) => byId.set( entry.id, entry ) );

            this.reviewCodecs( report, byId );

            let bytesSent = 0;
            let bytesReceived = 0;
            let lost = 0;
            let received = 0;
            let inboundPackets = 0;
            // By kind, for the pulse and the verdict on a silence; and what
            // the other side says it sent, from its RTCP sender reports.
            const counters: P2PCounters = { inAudio: 0, inVideo: 0, outAudio: 0, outVideo: 0, remoteAudio: 0, remoteVideo: 0, remoteAt: 0 };
            let rtt: number | null = null;
            let candidatePair: P2PStats['candidatePair'] = null;
            const codecs: P2PStats['codecs'] = { videoSend: null, videoRecv: null, audioSend: null, audioRecv: null };
            // Taken from the same stream the codec is taken from, so the two
            // always describe the same thing: the video that is moving.
            const impl: P2PStats['impl'] = { enc: null, dec: null };
            // The codec of a stream that is actually carrying something: a
            // section with no media of its own (a camera that is off, the
            // unused screen share) still names a codec, and would otherwise
            // be reported as what the call runs on.
            const codecOf = ( entry: any ): string | null => {
                const moving = Number( entry.framesEncoded ?? entry.framesDecoded ?? entry.packetsSent ?? entry.packetsReceived ?? 0 ) > 0;
                const codec = entry.codecId ? byId.get( entry.codecId ) : null;

                if( ! moving || ! codec || typeof codec.mimeType !== 'string' ) return null;

                return codec.mimeType.split( '/' )[1] ?? null;
            };

            // Packets alone do not make a video section the one carrying the
            // call: an idle screen share sends padding and RTCP and would win
            // the last write. Frames do, so the busiest section is reported.
            let videoSendFrames = 0;
            let videoRecvFrames = 0;

            // Each inbound video stream by the source it carries: a section's
            // mid is the same on both ends, so this side's own map answers.
            const sources = this.midMap();
            const inboundVideo = new Map<P2PSource, InboundVideo>();
            // And what this side's own video senders have put out, so a
            // source the other side was asked to start over can be read from
            // both ends: frames encoded and packets sent.
            const outboundVideo = new Map<P2PSource, OutboundVideo>();
            // The bandwidth estimates on the selected pair: what this side
            // believes it may send, and what it tells the other side it may
            // receive. A picture that stops after a pause and comes back for
            // a moment on a parameter write is what a collapsed estimate
            // looks like, and these are the only numbers that show it.
            let bweOut: number | null = null;
            let bweIn: number | null = null;

            report.forEach( ( entry: any ) => {
                if( entry.type === 'outbound-rtp' ){
                    bytesSent += Number( entry.bytesSent ?? 0 );

                    if( entry.kind === 'video' ){
                        counters.outVideo += Number( entry.packetsSent ?? 0 );

                        const frames = Number( entry.framesEncoded ?? 0 );
                        const codec = frames > videoSendFrames ? codecOf( entry ) : null;

                        if( codec ){
                            videoSendFrames = frames;
                            codecs.videoSend = codec;
                            impl.enc = typeof entry.encoderImplementation === 'string' ? entry.encoderImplementation : null;
                        }

                        const source = sources[ String( entry.mid ?? '' ) ];

                        if( source ){
                            const capture = entry.mediaSourceId ? byId.get( entry.mediaSourceId ) : undefined;
                            const codecEntry = entry.codecId ? byId.get( entry.codecId ) : null;

                            outboundVideo.set( source, {
                                produced: capture && capture.frames !== undefined ? Number( capture.frames ) : null,
                                encoded: frames,
                                packets: Number( entry.packetsSent ?? 0 ),
                                limit: typeof entry.qualityLimitationReason === 'string' ? entry.qualityLimitationReason : '?',
                                target: reportedTarget( entry ),
                                family: codecEntry && typeof codecEntry.mimeType === 'string' ? familyOf( codecEntry ) : null
                            } );
                        }
                    } else if( entry.kind === 'audio' ){
                        counters.outAudio += Number( entry.packetsSent ?? 0 );

                        const codec = codecOf( entry );

                        if( codec ) codecs.audioSend = codec;
                    }
                } else if( entry.type === 'inbound-rtp' ){
                    bytesReceived += Number( entry.bytesReceived ?? 0 );
                    inboundPackets += Number( entry.packetsReceived ?? 0 );

                    if( entry.kind === 'video' ){
                        counters.inVideo += Number( entry.packetsReceived ?? 0 );

                        const frames = Number( entry.framesDecoded ?? 0 );
                        const codec = frames > videoRecvFrames ? codecOf( entry ) : null;

                        if( codec ){
                            videoRecvFrames = frames;
                            codecs.videoRecv = codec;
                            impl.dec = typeof entry.decoderImplementation === 'string' ? entry.decoderImplementation : null;
                        }

                        const source = sources[ String( entry.mid ?? '' ) ] ?? this.sourceOfInboundTrack( entry.trackIdentifier );

                        if( source ){
                            const codecEntry = entry.codecId ? byId.get( entry.codecId ) : null;

                            inboundVideo.set( source, {
                                decoded: frames,
                                received: Number( entry.framesReceived ?? 0 ),
                                packets: Number( entry.packetsReceived ?? 0 ),
                                pli: Number( entry.pliCount ?? 0 ),
                                nack: Number( entry.nackCount ?? 0 ),
                                family: codecEntry && typeof codecEntry.mimeType === 'string' ? familyOf( codecEntry ) : null
                            } );
                        }
                    } else if( entry.kind === 'audio' ){
                        counters.inAudio += Number( entry.packetsReceived ?? 0 );

                        const codec = codecOf( entry );

                        if( codec ) codecs.audioRecv = codec;
                    }

                    const previous = this.previousInbound.get( entry.id ) ?? { lost: 0, received: 0 };
                    const currentLost = Number( entry.packetsLost ?? 0 );
                    const currentReceived = Number( entry.packetsReceived ?? 0 );

                    lost += Math.max( 0, currentLost - previous.lost );
                    received += Math.max( 0, currentReceived - previous.received );

                    this.previousInbound.set( entry.id, { lost: currentLost, received: currentReceived } );
                } else if( entry.type === 'remote-outbound-rtp' ){
                    // The other side's own count of what it sent, carried in
                    // its RTCP sender reports over the same transport; the
                    // timestamp is when the last of those arrived here.
                    const sent = Number( entry.packetsSent ?? 0 );

                    if( entry.kind === 'audio' ){
                        counters.remoteAudio += sent;
                    } else if( entry.kind === 'video' ){
                        counters.remoteVideo += sent;
                    }

                    const at = Number( entry.timestamp ?? 0 );

                    if( at > counters.remoteAt ) counters.remoteAt = at;
                } else if( entry.type === 'candidate-pair' && entry.state === 'succeeded' && ( entry.selected || entry.nominated ) ){
                    if( typeof entry.currentRoundTripTime === 'number' ){
                        rtt = entry.currentRoundTripTime;
                    }

                    const local = byId.get( entry.localCandidateId );
                    const remote = byId.get( entry.remoteCandidateId );

                    if( typeof entry.availableOutgoingBitrate === 'number' ) bweOut = entry.availableOutgoingBitrate;
                    if( typeof entry.availableIncomingBitrate === 'number' ) bweIn = entry.availableIncomingBitrate;

                    candidatePair = {
                        local: local ? local.candidateType ?? null : null,
                        remote: remote ? remote.candidateType ?? null : null,
                        protocol: local ? ( local.relayProtocol ?? local.protocol ?? null ) : null
                    };
                }
            } );

            const now = Date.now();

            // The test switch holds this side's view of its inbound still
            // while the packets really do arrive, so the verdict and the
            // road after it can be walked on a working network.
            if( faultInbound() && this.everConnected ){
                inboundPackets = this.inboundPackets;
            }

            // The other side's sender reports, one sample per report that
            // arrived, for judging a silence on what was sent during it.
            const lastSample = this.remoteSamples[ this.remoteSamples.length - 1 ];

            if( counters.remoteAt > 0 && ( ! lastSample || lastSample.reportAt !== counters.remoteAt ) ){
                this.remoteSamples.push( { audio: counters.remoteAudio, video: counters.remoteVideo, reportAt: counters.remoteAt } );

                if( this.remoteSamples.length > SAMPLE_HISTORY ) this.remoteSamples.shift();
            }

            if( inboundPackets > this.inboundPackets ){
                this.inboundPackets = inboundPackets;
                this.inboundChangedAt = now;
                this.silenceNoted = 0;
            } else if( inboundPackets < this.inboundPackets ){
                // Backwards, which a packet count cannot go: this is the sum
                // over whichever inbound streams exist now, and a renegotiation
                // can give the other side new streams whose counters start
                // again at zero. Held as a high-water mark that was fatal on
                // Android — the sum could never reach the old total again, so
                // the watchdog fired every eight seconds and each restart put
                // the count back down. A drop is a new stream: the new
                // baseline.
                this.inboundPackets = inboundPackets;
                this.inboundChangedAt = now;
                this.silenceNoted = 0;
            } else if( this.isConnected && this.expectInbound && this.connectedAt > 0 && now - Math.max( this.inboundChangedAt, this.connectedAt ) >= STALL_TIMEOUT ){
                // The counters are taken before the verdict so it reads the
                // peer's reports of this very silence; a verdict that could
                // not be reached yet leaves the clock running and is asked
                // again next tick.
                this.stats = { ...this.stats, counters };

                if( this.judgeSilence( now, Math.max( this.inboundChangedAt, this.connectedAt ), counters ) ){
                    this.inboundChangedAt = now;
                    this.silenceNoted = 0;
                }
            }

            // A connection that has been up for HEALTHY_RESET since its last
            // trouble has its restarts back: the next incident, an hour or a
            // day into the call, gets the whole trial rather than what the
            // last one left of it. Up means carrying media, or carrying
            // nothing because nothing is expected: a peer with its camera and
            // microphone off sends nothing, and its call went to the room
            // after two network blips that had each come back.
            if( this.restartCount > 0 && this.isConnected && this.troubleAt > 0 && now - this.troubleAt >= HEALTHY_RESET && ( now - this.inboundChangedAt < STALL_TIMEOUT || ! this.expectInbound ) ){
                this.trace( ( this.expectInbound ? 'media has flowed' : 'the connection has held, with nothing expected from the other side,' ) + ' for ' + ( HEALTHY_RESET / 1000 ) + 's since the last trouble, the restarts are back' );
                this.restartCount = 0;
                this.liftRelayOnly( 'the restarts are back' );
            }

            this.bwe = { out: bweOut, in: bweIn };
            this.lastOutbound = outboundVideo;
            this.reviewVideoSources( now, inboundVideo );

            // A source this side was asked to start over says what it has put
            // out since, tick by tick for a while: the difference between an
            // encoder that came back and one that did not is on this end —
            // and this end now acts on it. A capture that has produced twenty
            // frames since the restart while the encoder turned out none is
            // an encoder that is dead for this family, which is written off
            // and the call offered again without it — unless the encoder
            // says it is starved, which is the path's problem.
            for( const [ source, at ] of this.refreshedAt.entries() ){
                if( now - at > REFRESH_WATCH ) continue;

                const stream = outboundVideo.get( source );

                this.trace( source + ' ' + ( ( now - at ) / 1000 ).toFixed( 1 ) + 's after the restart: ' + describeOutbound( stream ) + ' bwe out=' + kbps( bweOut ) );

                const watch = this.refreshWatch.get( source );

                if( ! watch || ! stream || now - at < CODEC_ENCODE_GRACE ) continue;

                const producedSince = stream.produced !== null && watch.produced !== null ? stream.produced - watch.produced : null;
                const encodedSince = stream.encoded - watch.encoded;

                if( producedSince !== null && producedSince >= CODEC_ENCODE_FRAMES && encodedSince === 0 && stream.family ){
                    const why = encoderLimit( stream.limit, stream.target );

                    this.refreshWatch.delete( source );

                    if( encoderStarved( stream.limit, stream.target ) ){
                        this.trace( 'the ' + source + ' encoder took ' + producedSince + ' frames since the restart and encoded none, starved (' + why + '): ' + stream.family.replace( 'video/', '' ) + ' is not written off' );
                    } else {
                        this.trace( 'the ' + source + ' encoder took ' + producedSince + ' frames since the restart and encoded none (' + why + '): ' + stream.family.replace( 'video/', '' ) + ' is dead here' );
                        this.onCodecBroken( stream.family, 'enc', why );
                    }
                }
            }

            const packetLoss = ( lost + received ) > 0 ? lost / ( lost + received ) : 0;
            let quality: P2PQuality = 'unknown';

            if( ! this.isConnected ){
                quality = this.everConnected ? 'lost' : 'unknown';
            } else if( packetLoss < 0.02 && ( rtt === null || rtt < 0.15 ) ){
                quality = 'excellent';
            } else if( packetLoss < 0.05 && ( rtt === null || rtt < 0.3 ) ){
                quality = 'good';
            } else {
                quality = 'poor';
            }

            this.stats = { bytesSent, bytesReceived, rtt, packetLoss, quality, candidatePair, restarts: this.restartsTotal, codecs, impl, counters };
            this.options.onStats( this.stats );

            // A call that reports nothing moving is a call nobody can see, and
            // until now the only place the browser said so was a statistics
            // sheet nobody opens; the apps have written this line for a while,
            // and it is how their faults were read afterwards. Every change of
            // ICE state, and a line every half minute otherwise, with what each
            // inbound video stream has delivered: frames decoded of frames
            // assembled, packets, and the keyframe and retransmission requests
            // this side has made — the difference between a sender that sends
            // nothing and a receiver that cannot make a picture of it.
            const ice = this.pc.iceConnectionState;

            if( ice !== this.loggedIce || now - this.loggedStatsAt > 30000 ){
                this.loggedIce = ice;
                this.loggedStatsAt = now;

                const video = Array.from( inboundVideo.entries() )
                    .map( ( [ source, item ] ) => source + '=' + describeInbound( item ) )
                    .join( ' ' );
                const sent = Array.from( outboundVideo.entries() )
                    .map( ( [ source, item ] ) => source + '=' + describeOutbound( item ) )
                    .join( ' ' );

                this.trace(
                    'stats ice=' + ice + ' sent=' + bytesSent + ' recv=' + bytesReceived +
                    ' videoSend=' + ( codecs.videoSend ?? 'null' ) + ' videoRecv=' + ( codecs.videoRecv ?? 'null' ) +
                    ' audioSend=' + ( codecs.audioSend ?? 'null' ) + ' audioRecv=' + ( codecs.audioRecv ?? 'null' ) +
                    ' rtt=' + ( rtt === null ? 'null' : ( rtt as number ).toFixed( 3 ) ) + ' loss=' + packetLoss.toFixed( 3 ) +
                    ' bwe out=' + kbps( bweOut ) + ' in=' + kbps( bweIn ) +
                    ( video ? ' in[' + video + ']' : '' ) + ( sent ? ' out[' + sent + ']' : '' )
                );
            }
        } catch (e) {}
    }

    // The remote track a stats entry belongs to when the browser names the
    // track but not the mid.
    private sourceOfInboundTrack( trackId: unknown ): P2PSource | null {
        if( typeof trackId !== 'string' || ! trackId ) return null;

        for( const [ source, track ] of this.remoteBySource.entries() ){
            if( track.mediaStreamTrack.id === trackId ) return source;
        }

        return null;
    }

    // A video source that is expected and decodes nothing. Once it has been
    // quiet for VIDEO_STALL_TIMEOUT the sender is asked for a fresh picture;
    // when that brings nothing for as long again, the silence is a stall and
    // takes the aggregate watchdog's way out. A source that delivers a frame
    // starts over, and one that stops being expected is forgotten
    // (setExpectedVideo), so a camera the other side switched off is never
    // asked for.
    private reviewVideoSources( now: number, inbound: Map<P2PSource, InboundVideo> ): void {
        if( ! this.isConnected || this.connectedAt === 0 ) return;

        for( const source of this.expectedVideo ){
            if( source !== 'camera' && source !== 'screen_share' ) continue;

            const stream = inbound.get( source );
            const frames = stream?.decoded ?? 0;
            const progress = this.videoProgress.get( source );

            if( ! progress ){
                this.videoProgress.set( source, { frames, since: now, refreshed: false } );
                continue;
            }

            // Moving, or a fresh stream counting from zero again: not a silence.
            if( frames !== progress.frames ){
                progress.frames = frames;
                progress.since = now;
                progress.refreshed = false;
                continue;
            }

            const quiet = now - Math.max( progress.since, this.connectedAt );

            // Every tick of a silence is written with what the stream has
            // delivered, because the numbers are the whole diagnosis: packets
            // still climbing with no frame assembled is a receiver that
            // cannot make a picture of what arrives; nothing climbing is a
            // sender that has stopped.
            if( quiet >= STATS_INTERVAL ){
                this.trace( source + ' silent ' + ( quiet / 1000 ).toFixed( 1 ) + 's: ' + describeInbound( stream ) + ' bwe in=' + kbps( this.bwe.in ) );
            }

            if( quiet <= VIDEO_STALL_TIMEOUT ) continue;

            progress.since = now;

            if( ! progress.refreshed ){
                progress.refreshed = true;
                progress.receivedAtAsk = stream ? stream.received : 0;
                progress.packetsAtAsk = stream ? stream.packets : 0;
                this.trace( 'no picture from ' + source + ' for ' + VIDEO_STALL_TIMEOUT + 'ms, asking for a fresh one' );
                this.options.send( { kind: 'refresh', source } );
                continue;
            }

            progress.refreshed = false;

            // What the silence is made of decides what is done about it,
            // because the three kinds need three different answers and an
            // ICE restart, which every one of them used to get, mends none.
            const assembled = stream ? stream.received - ( progress.receivedAtAsk ?? 0 ) : 0;
            const packets = stream ? stream.packets - ( progress.packetsAtAsk ?? 0 ) : 0;

            if( assembled > 0 && stream && stream.family ){
                // Whole frames keep arriving and none comes out: the decoder
                // is what stopped, so the family is written off here and the
                // call offered again without it. The old predicate needed a
                // decoder that had never produced a frame, and one that had
                // decoded hundreds and then froze was left to the room.
                this.trace( 'still no picture from ' + source + ' after asking, while ' + assembled + ' frames arrived whole: the ' + stream.family.replace( 'video/', '' ) + ' decoder is dead here' );
                this.onCodecBroken( stream.family, 'dec' );
                continue;
            }

            if( packets > 0 ){
                // Packets arrive and no frame is ever whole: the path is
                // losing too much to carry a picture.
                this.trace( 'still no picture from ' + source + ' after asking: ' + packets + ' packets arrived and no frame was whole, the path is losing too much' );
                this.pathDead( 'the ' + source + ' arrives too broken to decode' );
                continue;
            }

            // Nothing arrived for this source at all while the connection
            // is up and the sender was asked twice: its capture or encoder
            // is what stopped. The sender's own watch writes off an encoder
            // that takes frames and turns out none; a capture that produces
            // none is told to open the device again.
            this.trace( 'still no picture from ' + source + ' after asking and nothing arrived for it at all: the sender\'s ' + source + ' stopped, not the path' );

            const kind: 'microphone' | 'camera' = 'camera';
            const last = this.lastSilentNotice.get( kind ) ?? 0;

            if( source === 'camera' && now - last >= SILENT_NOTICE_MIN ){
                this.lastSilentNotice.set( kind, now );
                this.options.onPeerSilent( kind );
            }
        }
    }

    close(): void {
        if( this.closed ) return;

        this.closed = true;
        this.clearRestartTimers();
        this.clearConnectDeadline();

        if( this.connectRelayTimer !== null ){
            window.clearTimeout( this.connectRelayTimer );
            this.connectRelayTimer = null;
        }

        if( this.holdTimer !== null ){
            window.clearTimeout( this.holdTimer );
            this.holdTimer = null;
        }

        this.heldSince = 0;
        this.holdSpent = false;

        if( this.privateHoldTimer !== null ){
            window.clearTimeout( this.privateHoldTimer );
            this.privateHoldTimer = null;
        }

        this.heldPrivateCandidates = [];
        this.pendingCandidates = [];

        if( this.statsTimer !== null ){
            window.clearInterval( this.statsTimer );
            this.statsTimer = null;
        }

        for( const track of this.remoteBySource.values() ){
            track.detach();
        }

        this.remoteBySource.clear();
        this.remoteByMid.clear();

        this.pc.onnegotiationneeded = null;
        this.pc.onicecandidate = null;
        this.pc.ontrack = null;
        this.pc.oniceconnectionstatechange = null;
        this.pc.onconnectionstatechange = null;

        try {
            this.pc.close();
        } catch (e) {}

        this.setConnection( 'closed' );
    }
}
