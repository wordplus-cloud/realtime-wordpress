import type {CodecCaps, CodecDirection, CodecScore, P2PSource} from "./types.js";
import {isFirefox, isSafari} from "./platform.js";
import {CHROMIUM_H264_ENCODE} from "./room-publish.js";

// Which video codec each direction of a direct call uses.
//
// The browsers' own order is a legacy one (Chrome and Firefox offer VP8
// first, a software codec on every device) and the answerer follows the
// offerer, so a call would land on VP8 unless somebody says otherwise. Each
// side asks the Media Capabilities API what it can encode and decode and
// whether that is hardware, tells the other side over the signaling, and
// then picks, for its own sending, the codec that is hardware on both ends
// when there is one and the best-performing one both sides handle when
// there is not. The pick is made after negotiation with the encoding's
// `codec` parameter, so the two directions can differ; the SDP order is
// arranged for the side that cannot switch that way.

export const FAMILIES = [ 'video/H265', 'video/H264', 'video/VP9', 'video/VP8', 'video/AV1' ];

// The level in the H264 string has to carry what `ask` probes with, which is
// 1920x1080 at 30 and again at 60. `42e01f` — the level 3.1 that browsers
// advertise in their SDP — tops out at 1280x720, and a browser that reads the
// level honestly answers "not supported" to both questions. Firefox does: it
// disowned the one family it encodes in hardware, so every call with Firefox
// on either end fell back to VP9 on the CPU. Level 4.2 is the lowest that
// covers 1080p60. Chrome and Safari never caught it because they ignore the
// level and answer for the profile alone.
const PROBE: Record<string, string> = {
    'video/H265': 'video/h265',
    'video/H264': 'video/h264;profile-level-id=42e02a',
    'video/VP9': 'video/vp9;profile-id=0',
    'video/VP8': 'video/vp8',
    'video/AV1': 'video/av1'
};

// Tie-breaker between codecs of equal standing: newer first among hardware
// matches, cheaper first among software ones (VP8 last: it is software
// everywhere and the weakest at 1080p).
const TIE: Record<string, number> = {
    'video/H265': 0.5,
    'video/H264': 0.4,
    'video/VP9': 0.3,
    'video/AV1': 0.2,
    'video/VP8': 0.1
};

// A screen share is mostly text, and hardware encoders are tuned for camera
// pictures: at the same bitrate they smear glyphs that the software codecs
// with screen-content tools keep (measured 8 Sep 2026, 1080p text scrolling
// at 6 Mbps: AV1 q121, VP9 q152, VideoToolbox H264 QP 33 — and at 3 Mbps the
// H264 had quietly dropped to 720p). So for the screen the families rank by
// that, hardware counts only on the decoding end, and encoding smoothly
// still counts so a machine that cannot keep 1080p30 in software falls back.
const SCREEN_CONTENT: Record<string, number> = {
    'video/AV1': 6,
    'video/VP9': 5,
    'video/H265': 3,
    'video/H264': 2,
    'video/VP8': 0
};

interface VideoCodec {
    mimeType: string;
    clockRate: number;
    channels?: number;
    sdpFmtpLine?: string;
}

const UNKNOWN: CodecScore = { ok: true, hw: false, smooth: true, fast: false };
const NONE: CodecScore = { ok: false, hw: false, smooth: false, fast: false };

let probed: Promise<CodecCaps> | null = null;

export function forcedFamilies(): string[] | null {
    try {
        const value = window.localStorage.getItem( 'bm_p2p_codecs' );

        if( ! value ) return null;

        const families = value.split( ',' ).map( ( item ) => 'video/' + item.trim().toUpperCase() ).filter( ( item ) => FAMILIES.includes( item ) );

        return families.length > 0 ? families : null;
    } catch (e) {
        return null;
    }
}

// A codec both sides agreed on can still carry nothing. Chrome on a Mac says
// it decodes H265, negotiates it, then swaps in a decoder that throws every
// frame away: the packets arrive, the picture never does. No capability
// answer gives that away, so a call that finds it drops the family and
// renegotiates — in the failing direction only, because a codec this machine
// cannot decode may still be the right thing to send.
//
// What it learns belongs to the call and dies with it. It used to persist,
// and that was worse than the problem: a write-off earned against one peer's
// broken build applied to every later peer forever. Measured — Chrome carried
// H265:dec from an app call, and Chrome ↔ Safari, hardware H265 at both ends,
// fell to H264 on a software encoder and stayed there. Clearing the entry put
// it straight back to VideoToolbox. Every call now starts from what the
// hardware can do and finds out for itself.
//
// VP8 is never written off. It is the one video codec every WebRTC
// implementation must have, so it is where a downgrade lands when there is
// nothing else left.
const STALE_KEY = 'bm_p2p_broken_codecs';
const BASELINE = 'video/VP8';

let broken: Record<string, CodecDirection[]> = {};

function shortName( family: string ): string {
    return family.slice( 'video/'.length );
}

export function brokenCodecs(): Record<string, CodecDirection[]> {
    return broken;
}

// Called as a call starts. Nothing a previous call learnt about a previous
// peer should narrow what this one may offer.
export function forgetBroken(): void {
    broken = {};

    try {
        window.localStorage.removeItem( STALE_KEY );
    } catch (e) {}
}

// True when the call has just learnt something it did not know; the caller
// acts on it, so a family already written off must answer false.
export function markBroken( family: string, direction: CodecDirection ): boolean {
    if( ! FAMILIES.includes( family ) || family === BASELINE ) return false;

    if( ( broken[ family ] ?? [] ).includes( direction ) ) return false;

    broken[ family ] = [ ...( broken[ family ] ?? [] ), direction ];

    return true;
}

function withoutBroken( caps: CodecCaps ): CodecCaps {
    const current = brokenCodecs();

    if( Object.keys( current ).length === 0 ) return caps;

    const families: CodecCaps['families'] = {};

    for( const family of Object.keys( caps.families ) ){
        const pair = caps.families[ family ];
        const directions = current[ family ] ?? [];

        families[ family ] = {
            enc: directions.includes( 'enc' ) ? NONE : pair.enc,
            dec: directions.includes( 'dec' ) ? NONE : pair.dec
        };
    }

    return { families, switch: caps.switch, engine: caps.engine, ...( caps.h264Baseline === undefined ? {} : { h264Baseline: caps.h264Baseline } ) };
}

// Which engine this page runs in, for the ranking on both ends.
function ownEngine(): CodecCaps['engine'] {
    if( isSafari() ) return 'webkit';
    if( isFirefox() ) return 'gecko';

    return 'chromium';
}

// Whether a family should be held back in a direction because of what runs
// it. Chrome's H265 is hardware on paper and failed in practice on both
// ends — a decoder on Windows and one on Android that decoded a burst after
// each keyframe and then nothing, an encoder on Android that produced no
// frame after a restart — in every camera stall the production traces of 19
// to 21 Sep 2026 held. Firefox has no H265 at all, but its answer to the
// probe is not trusted either. Apple's is, and so is a native app's, so a
// Safari-to-app call keeps it. An engine that did not say what it is is not
// held to anything.
function heldBack( family: string, sender: CodecCaps, receiver: CodecCaps | null ): boolean {
    if( family !== 'video/H265' ) return false;

    const engines = [ sender.engine, receiver ? receiver.engine : undefined ];

    return engines.some( ( engine ) => engine === 'chromium' || engine === 'gecko' );
}

async function ask( kind: 'encodingInfo' | 'decodingInfo', contentType: string, framerate: number, bitrate: number ): Promise<MediaCapabilitiesInfo | null> {
    const capabilities = typeof navigator !== 'undefined' ? navigator.mediaCapabilities : undefined;

    if( ! capabilities || typeof capabilities[ kind ] !== 'function' ) return null;

    try {
        return await capabilities[ kind ]( {
            type: 'webrtc',
            video: { contentType, width: 1920, height: 1080, framerate, bitrate }
        } as any );
    } catch (e) {
        return null;
    }
}

// 1080p30 decides whether a family is usable, hardware and smooth; 1080p60
// only whether it is `fast`. A browser that cannot be asked (no Media
// Capabilities for this direction) is taken as able but not fast, so a
// 60-frame share only happens where a browser vouched for it.
async function score( kind: 'encodingInfo' | 'decodingInfo', family: string ): Promise<CodecScore> {
    const [ base, sixty ] = await Promise.all( [ ask( kind, PROBE[ family ], 30, 2_500_000 ), ask( kind, PROBE[ family ], 60, 5_000_000 ) ] );

    if( ! base ) return UNKNOWN;

    return { ok: !! base.supported, hw: !! base.powerEfficient, smooth: !! base.smooth, fast: !! sixty && !! sixty.supported && !! sixty.smooth };
}

// Whether this browser lets a sender pick its codec after negotiation
// (RTCRtpEncodingParameters.codec): a local negotiation between two throw-
// away connections, then a switch that the parameters must reflect back.
async function canSwitch(): Promise<boolean> {
    if( typeof RTCPeerConnection === 'undefined' ) return false;

    let a: RTCPeerConnection | null = null;
    let b: RTCPeerConnection | null = null;

    try {
        a = new RTCPeerConnection();
        b = new RTCPeerConnection();

        const transceiver = a.addTransceiver( 'video', { direction: 'sendrecv' } );

        b.addTransceiver( 'video', { direction: 'sendrecv' } );

        const offer = await a.createOffer();

        await a.setLocalDescription( offer );
        await b.setRemoteDescription( offer );

        const answer = await b.createAnswer();

        await b.setLocalDescription( answer );
        await a.setRemoteDescription( answer );

        const params = transceiver.sender.getParameters();
        const codec = ( params.codecs || [] ).find( ( item ) => item.mimeType.toLowerCase() !== 'video/rtx' && ! /red|fec/i.test( item.mimeType ) );

        if( ! codec || ! params.encodings || params.encodings.length === 0 ) return false;

        ( params.encodings[0] as any ).codec = { mimeType: codec.mimeType, clockRate: codec.clockRate, sdpFmtpLine: codec.sdpFmtpLine };

        await transceiver.sender.setParameters( params );

        const after = ( transceiver.sender.getParameters().encodings[0] as any ).codec;

        return !! after && after.mimeType === codec.mimeType;
    } catch (e) {
        return false;
    } finally {
        try { a?.close(); } catch (e) {}
        try { b?.close(); } catch (e) {}
    }
}

// What this browser can do with each family, once per page. The probe is
// what the browser claims; what comes back is that minus the families this
// device has been caught failing, so a call after one of those never asks
// for it again and a call that has just learnt it picks the answer up.
//
// Chromium is asked of H.264 Baseline too (h264Baseline), which a room on
// the mesh takes from it: it encodes Baseline in hardware where it has an
// encoder, and the Constrained Baseline PROBE asks of in OpenH264.
export function probeCodecCaps(): Promise<CodecCaps> {
    if( ! probed ){
        probed = ( async () => {
            const families: CodecCaps['families'] = {};
            const engine = ownEngine();

            const [ baseline ] = await Promise.all( [
                engine === 'chromium' ? ask( 'encodingInfo', CHROMIUM_H264_ENCODE, 30, 2_500_000 ) : Promise.resolve( null ),
                ...FAMILIES.map( async ( family ) => {
                    const [ enc, dec ] = await Promise.all( [ score( 'encodingInfo', family ), score( 'decodingInfo', family ) ] );

                    families[ family ] = { enc, dec };
                } )
            ] );

            const caps: CodecCaps = { families, switch: await canSwitch(), engine };

            if( baseline ) caps.h264Baseline = !! baseline.supported && !! baseline.powerEfficient;

            return caps;
        } )();
    }

    return probed.then( withoutBroken );
}

function encodeScore( caps: CodecCaps, family: string ): CodecScore {
    return caps.families[ family ] ? caps.families[ family ].enc : NONE;
}

function decodeScore( caps: CodecCaps, family: string ): CodecScore {
    return caps.families[ family ] ? caps.families[ family ].dec : NONE;
}

// How good one direction would be: hardware on either end counts most, a
// smooth encoder next, then the tie-breaker. Null when the direction is
// not possible.
export function directionScore( sender: CodecCaps, receiver: CodecCaps | null, family: string ): number | null {
    const enc = encodeScore( sender, family );
    const dec = receiver ? decodeScore( receiver, family ) : UNKNOWN;

    if( ! enc.ok || ! dec.ok ) return null;

    // A family held back loses its hardware standing and its tie-breaker:
    // it lands under every software codec that is smooth (VP9 at 3.3, AV1 at
    // 3.2) and stays above VP8 (3.1), so it is still there when nothing
    // better is, and never chosen over something that works.
    if( heldBack( family, sender, receiver ) ){
        return ( enc.smooth ? 2 : 0 ) + ( dec.smooth ? 1 : 0 ) + 0.15;
    }

    return ( enc.hw ? 4 : 0 ) + ( dec.hw ? 4 : 0 ) + ( enc.smooth ? 2 : 0 ) + ( dec.smooth ? 1 : 0 ) + ( TIE[ family ] ?? 0 );
}

// Whether one direction can run a family at 60 frames: smooth at 1080p60
// on the encoding end and on the decoding end, by the browsers' own word.
export function fastDirection( sender: CodecCaps, receiver: CodecCaps | null, family: string ): boolean {
    const enc = encodeScore( sender, family );
    const dec = receiver ? decodeScore( receiver, family ) : NONE;

    return !! enc.fast && !! dec.fast;
}

export function screenDirectionScore( sender: CodecCaps, receiver: CodecCaps | null, family: string ): number | null {
    const enc = encodeScore( sender, family );
    const dec = receiver ? decodeScore( receiver, family ) : UNKNOWN;

    if( ! enc.ok || ! dec.ok ) return null;

    return ( SCREEN_CONTENT[ family ] ?? 0 ) + ( enc.smooth ? 2 : 0 ) + ( dec.smooth ? 1 : 0 ) + ( dec.hw ? 1 : 0 ) + ( TIE[ family ] ?? 0 );
}

type Scorer = ( sender: CodecCaps, receiver: CodecCaps | null, family: string ) => number | null;

function scorerFor( source: P2PSource | undefined ): Scorer {
    return source === 'screen_share' ? screenDirectionScore : directionScore;
}

function ranked( sender: CodecCaps, receiver: CodecCaps | null, score: Scorer = directionScore ): string[] {
    return FAMILIES
        .map( ( family ) => ( { family, value: score( sender, receiver, family ) } ) )
        .filter( ( item ): item is { family: string; value: number } => item.value !== null )
        .sort( ( a, b ) => b.value - a.value )
        .map( ( item ) => item.family );
}

// The order for an offer: this side's sending, the other side unknown yet.
export function offerOrder( own: CodecCaps, source?: P2PSource ): string[] {
    return forcedFamilies() ?? ranked( own, null, scorerFor( source ) );
}

// The order for an answer is what both sides send with until they switch,
// and what a side that cannot switch sends with for good, so it serves the
// offerer's sending when the offerer cannot switch and this side's
// sending otherwise.
export function answerOrder( own: CodecCaps, peer: CodecCaps | null, source?: P2PSource ): string[] {
    const forced = forcedFamilies();

    if( forced ) return forced;

    const score = scorerFor( source );

    if( peer && ! peer.switch ) return ranked( peer, own, score );

    return ranked( own, peer, score );
}

// What a room call should publish with.
//
// A room is not negotiated the way a direct call is: LiveKit forwards one
// codec per publisher, untouched, to everyone subscribed, so the choice is
// this device's alone and has to be something every subscriber can decode.
// All three clients used to ask for VP9 flat, and not one endpoint we ship to
// has a VP9 encoder in hardware — the OnePlus 7T Pro has no VP9 encoder at
// all — so every room call was encoding 1080p on the CPU.
//
// So: the best family this device encodes in *hardware*, ranked by how much
// picture each carries per bit. H265 is not here because LiveKit cannot
// publish it. Where nothing is hardware — a Mac Chrome, whose only hardware
// encoder is the H265 it cannot use here — the old VP9 stands, because that
// is the best of a software-only field rather than a preference for it.
const ROOM_ORDER: { family: string, codec: RoomCodec }[] = [
    { family: 'video/AV1', codec: 'av1' },
    { family: 'video/VP9', codec: 'vp9' },
    { family: 'video/H264', codec: 'h264' },
    { family: 'video/VP8', codec: 'vp8' }
];

export type RoomCodec = 'av1' | 'vp9' | 'h264' | 'vp8';

export function roomPublishCodec( own: CodecCaps, encrypted: boolean ): RoomCodec {
    // Firefox publishes VP8 into a room. LiveKit refuses VP9 and AV1 from it
    // (SVC publishing is broken there), which left H264 as the only family it
    // could call hardware, and a Firefox without the OpenH264 plugin
    // advertises H264, even as a power-efficient encoder (Firefox 155 on a
    // Mac, 23 Sep 2026), and encodes nothing with it: the other side of a
    // room call got the audio and never a picture. VP8 simulcasts from every
    // Firefox, and is LiveKit's own default.
    if( isFirefox() ) return 'vp8';

    // AV1 must never be published into an encrypted room: the web's e2ee
    // worker throws on it.
    const usable = ROOM_ORDER.filter( ( item ) => ! ( encrypted && item.codec === 'av1' ) );

    const hardware = usable.find( ( item ) => {
        const score = own.families[ item.family ];

        return !! score && score.enc.ok && score.enc.hw;
    } );

    return hardware ? hardware.codec : 'vp9';
}

// The family this side should send with, among the negotiated ones.
export function chooseSendFamily( own: CodecCaps, peer: CodecCaps | null, negotiated: string[], source?: P2PSource ): string | null {
    const forced = forcedFamilies();
    const order = forced ?? ranked( own, peer, scorerFor( source ) );
    const available = negotiated.map( ( item ) => item.toLowerCase() );

    for( const family of order ){
        if( available.includes( family.toLowerCase() ) ) return family;
    }

    return null;
}

export function familyOf( codec: { mimeType: string } ): string | null {
    const match = FAMILIES.find( ( family ) => family.toLowerCase() === codec.mimeType.toLowerCase() );

    return match ?? null;
}

// The negotiated codec entry of a family, preferring the packetization mode
// every browser sends H264 with.
export function negotiatedCodec( codecs: VideoCodec[], family: string ): VideoCodec | null {
    const candidates = codecs.filter( ( codec ) => codec.mimeType.toLowerCase() === family.toLowerCase() );

    if( candidates.length === 0 ) return null;

    return candidates.find( ( codec ) => /packetization-mode=1/.test( codec.sdpFmtpLine ?? '' ) ) ?? candidates[0];
}

// Reorders a video transceiver's codecs: every capability of a family in
// ranking order, the families not ranked after them, then the rest (RTX,
// RED, FEC) as they were.
export function applyCodecPreferences( transceiver: RTCRtpTransceiver, families: string[] ): void {
    if( typeof transceiver.setCodecPreferences !== 'function' || typeof RTCRtpReceiver === 'undefined' || typeof RTCRtpReceiver.getCapabilities !== 'function' ) return;

    const capabilities = RTCRtpReceiver.getCapabilities( 'video' );

    if( ! capabilities || capabilities.codecs.length === 0 ) return;

    const broken = brokenCodecs();
    const sameFamily = ( codec: VideoCodec, family: string ) => codec.mimeType.toLowerCase() === family.toLowerCase();

    // A section says what this side can be sent, and the other side sends with
    // the order in it. So a family this device has been caught failing to
    // decode comes out of the list altogether, before it is ordered: leaving
    // it in is an invitation to send exactly what will not arrive, and
    // demoting it is not enough, because the ranking that built `families` may
    // have put it first for this side's own *sending* — which is what the
    // order means when the other side's abilities are not known yet.
    const codecs = ( capabilities.codecs as VideoCodec[] ).filter( ( codec ) => {
        const family = FAMILIES.find( ( item ) => sameFamily( codec, item ) );

        return ! family || ! ( broken[ family ] ?? [] ).includes( 'dec' );
    } );

    const preferred = families.flatMap( ( family ) => codecs.filter( ( codec ) => sameFamily( codec, family ) ) );

    // A family that is merely not preferred still belongs in the section: the
    // other side may have nothing else.
    const others = codecs.filter( ( codec ) => FAMILIES.some( ( family ) => sameFamily( codec, family ) ) && ! preferred.includes( codec ) );
    const rest = codecs.filter( ( codec ) => ! FAMILIES.some( ( family ) => sameFamily( codec, family ) ) );

    if( preferred.length === 0 ) return;

    try {
        transceiver.setCodecPreferences( [ ...preferred, ...others, ...rest ] as any );
    } catch (e) {
        console.warn( 'p2p codec preferences were not accepted', e );
    }
}
