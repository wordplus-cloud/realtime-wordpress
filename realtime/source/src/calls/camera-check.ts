/**
 * A camera's codec chosen by measuring it, before the camera goes into a room, with a progress indicator on the camera
 * button while it runs, as other buttons have.
 *
 * Why: a browser's word for what it encodes (navigator.mediaCapabilities) says whether a hardware encoder is there, not
 * whether it works. Chrome trusts no Windows hardware encoder's own rate control for H.264 (Chromium's
 * media_foundation_video_encode_accelerator_win.cc: no software rate control on AMD and ARM, a flag elsewhere), so
 * libwebrtc's frame dropper takes whole frames off a camera whose encoder overshoots its target, every layer at once,
 * naming no reason: 13 of 34 Windows senders in hardware H.264 froze for their viewers in a day of calls, none of 15
 * Macs; user_9's camera sent 4 of 15 frames a second for 40 minutes (otherworldcommunity.com_8_video, 2026-10-23), and
 * 720p at 14-15 in VP9 at 13 ms a frame once it moved. And a software codec costs a CPU that may not have it.
 *
 * How: the camera's own picture (a clone of its track) goes through the browser's real WebRTC sender, in a loopback of
 * two peer connections inside the page, in the codec to be tried, at the room's top layer: the encoder, its rate
 * control and libwebrtc's frame dropper are the ones a room's camera runs. Over CAMERA_CHECK_WINDOW_MS after a warm-up,
 * its stats tell the frames its source gave against those it encoded and sent, the ms a frame took, how long the
 * browser said the CPU held it back, and whether the encoder is the hardware (judgeEncoder()).
 *
 * Where: a machine a camera rule names (cameraRuleOrder(): the node's rules, or DEFAULT_CAMERA_RULES where it sends no
 * `rules` key, Windows and Linux, where the frozen hardware H.264 senders were; `rules: []` names none). Every other
 * machine's camera (a Mac, an iPhone or iPad, Android) starts as today at once, no spinner: a Mac's first hardware
 * session in a browser gives its first frame 2.0-2.3 s late and few for 2 s more (the mesh lab, 2026-10-23), so its
 * check would end unsure every day for nothing. The in-call watch and moves (camera-adapt.ts) run on every machine.
 *
 * The order (room-publish.ts, cameraCodecOrder()): a rule's of the node's policy (by default VP9 first on Windows and
 * Linux), else the policy's (hardware H.264 first); VP9 before VP8 always, VP8 last and never measured
 * (VP8 only once VP9 failed too). A hardware H.264 or H.265 that drops frames is remembered as
 * `drops`, a software codec the CPU can't carry as `cpu`, a codec that does well as `pass` (one record a codec,
 * CameraCodecRecord), and the next is tried. A browser holds its records a month (a CPU's failure a week), until its
 * major version changes, so later calls skip the measuring.
 *
 * VP9 in software is tried at the camera's lines up to VP9_TOP_HEIGHT, 1080 first (1.0.41), where every other codec in
 * software is tried at 720. Its CPU unable there, it goes out at CAMERA_STEP_DOWN_HEIGHT, 720, where the same
 * measurement says 720 fits (fitsLower()), and a call steps it down to 720 the same way (camera-adapt.ts,
 * stepDownCamera()). Its record holds the lines it was found at.
 *
 * Bounded: the policy's tune.checkMs (4 s) in all; past it, or where the loopback can't run or says too little (a
 * camera giving few frames, a check that never connected, an encoder that didn't keep up with its camera before the
 * window had to start), the codec goes out as the policy has it, unmeasured, as before. An encoder still starting is
 * never taken for one that drops frames. Every threshold is the node's to change (room-publish.ts, cameraTune()).
 */
import {backupFor, cameraCodecOrder, cameraCodecRecord, cameraCodecRecords, cameraFinding, cameraRuleOrder, cameraRules, cameraTune, choiceHeight, encodesInHardware, hardwareFromCaps,
    knownAdapter, rememberAdapter, rememberCameraCodec, roomCallChoice, rulesNeedGpu, uncheckedBrowser, CAMERA_STEP_DOWN_HEIGHT, CAMERA_TUNE_DEFAULTS, CAMERA_TUNE_RANGES,
    VP9_TOP_HEIGHT, cameraMaxHeight, cameraPublish,
    type CameraChoice, type CameraCodec, type CameraCodecCaps, type CameraCodecOptions, type CameraCodecResult, type CameraTune} from "./room-publish.js";
import {isHardwareEncoder} from "./encoder-watch.js";

/** How long the loopback may take to connect (its first frame may take longer: as long as a measuring still fits). */
export const CAMERA_CHECK_CONNECT_MS = 1500;
/** After the first frame is encoded, how long at least before the measuring starts (the encoder's first frames run slow). */
export const CAMERA_CHECK_WARMUP_MS = 400;
/**
 * The stretch over which an encoder must keep up with its camera before the measuring starts: send at least the
 * policy's passSent (80%) of the frames the camera gave over it. A hardware encoder's first session in a browser starts
 * late and slow (Chrome's VideoToolbox on a Mac: its first frame at 2.0-2.3 s, then 5 and 2 of 15 a second; the mesh
 * lab, 2026-10-23); measured then, it would read as one that takes frames off.
 */
export const CAMERA_CHECK_KEEPUP_MS = 500;
/** How long the encoder is measured. */
export const CAMERA_CHECK_WINDOW_MS = 1200;
/**
 * The whole check, every codec tried, without a policy's tune.checkMs (a check that throws or runs over about 3 s
 * starts the camera as before it): a measurement ends by it whatever it reached, and past it the next codec goes
 * out unmeasured.
 */
export const CAMERA_CHECK_BUDGET_MS = CAMERA_TUNE_DEFAULTS.checkMs;
/** Time left under which no further codec is measured. */
const MEASURE_MIN_MS = CAMERA_CHECK_WARMUP_MS + CAMERA_CHECK_WINDOW_MS + 300;

/** The share of the camera's frames an encoder must send (at 30 a second at most), without a policy's tune.passSent. */
export const CHECK_MIN_SENT_SHARE = CAMERA_TUNE_DEFAULTS.passSent;
/** The share of the time the browser may say the CPU held it back, without tune.passCpu. */
export const CHECK_MAX_CPU_SHARE = CAMERA_TUNE_DEFAULTS.passCpu;
/** The share of a frame's interval its encoding may take, without tune.passEncode. */
export const CHECK_MAX_FRAME_SHARE = CAMERA_TUNE_DEFAULTS.passEncode;
/** The frames the camera must give over the window for a verdict: fewer (a dim room, a camera starting) say too little. */
export const CHECK_MIN_FRAMES = 6;
/** The share of the time limited by bandwidth over which the loopback said too little (its estimate not risen yet). */
const CHECK_MAX_BANDWIDTH_SHARE = 0.5;

/** What a loopback's stats said over its window: the counts between two readings. */
export interface EncoderSample {
    /** frames the camera gave */
    captured: number;
    /** frames encoded */
    encoded: number;
    /** frames sent */
    sent: number;
    /** the window, ms */
    elapsedMs: number;
    /** seconds spent encoding (totalEncodeTime) */
    encodeSeconds: number;
    /** seconds the browser said the CPU held the encoder back (qualityLimitationDurations.cpu) */
    cpuSeconds: number;
    /** seconds it said bandwidth did */
    bandwidthSeconds: number;
    /** the frames a second the camera gives (media-source framesPerSecond; 0 not said) */
    captureFps: number;
    /** the browser's name for the encoder (encoderImplementation) */
    implementation: string;
    /** whether it encodes in hardware (powerEfficientEncoder, or the name) */
    hardware: boolean;
    /**
     * whether the browser said which encoder it is (an encoderImplementation, or a powerEfficientEncoder): WebKit and
     * Firefox say neither, and `hardware` false then means nothing. Missing: said.
     */
    known?: boolean;
    /** the window's second half alone: an encoder that keeps up there and not over the whole is still starting */
    late?: EncoderSample;
    /** the lines of the picture it encoded at the end (outbound-rtp frameHeight, the top layer's): the CPU may have shrunk it */
    frameHeight?: number;
}

/** What a check found of one codec: its result (null: too little to tell), and the numbers it was found by. */
export interface CameraCheckVerdict {
    codec: CameraCodec;
    result: CameraCodecResult | null;
    msPerFrame: number | null;
    sentShare: number | null;
    cpuShare: number | null;
    implementation: string;
    hardware: boolean;
    /**
     * why, in a word: "ok", "drops", "software" (the hardware wasn't used), "cpu", "slow", "few-frames", "bandwidth",
     * "slow-start" (an encoder still starting: its first frame, or keeping up with its camera, too late to measure, or
     * rising through the window), "failed", "timeout", "ended"
     */
    why: string;
    /** the lines the camera was measured at (measureCameraEncoder()), and the frames a second it was judged against */
    height?: number;
    fps?: number;
    /** the lines it encoded at the end (EncoderSample.frameHeight) */
    frameHeight?: number;
}

/**
 * The verdict on one codec from its loopback's numbers. wantHardware: the codec was to go out in hardware (H.264,
 * H.265), whose failure is its frames taken off (`drops`); otherwise a software codec, whose failure is the CPU's (`cpu`).
 *
 * - too little to tell (null): under CHECK_MIN_FRAMES frames from the camera, nothing encoded, or held back by
 *   bandwidth most of the window (the loopback's estimate still rising); and a hardware codec whose encoder the browser
 *   doesn't name (`known` false: WebKit, Firefox), which is never taken for software;
 * - hardware: `drops` where the browser didn't encode it in hardware after all (a fallback to software), or sent under
 *   CHECK_MIN_SENT_SHARE of the camera's frames;
 * - software: `cpu` where the CPU held it back over CHECK_MAX_CPU_SHARE of the window, a picture took over
 *   CHECK_MAX_FRAME_SHARE of its interval, or it sent under CHECK_MIN_SENT_SHARE;
 * - `pass` otherwise.
 * Sending under CHECK_MIN_SENT_SHARE over the window while keeping up in its second half (`late`) is an encoder still
 * starting: too little to tell ("slow-start"), never drops nor cpu. The time a picture takes is the encoding time over
 * the pictures the camera gave, no more: an SVC encoding (VP9, AV1) counts each spatial layer's frame as encoded (Chrome's
 * VP9 L3T3 about 31 a second from a 15 fps camera), which spread a picture's time over two or three. The three shares
 * are the policy's tune's where given (passSent, passCpu, passEncode).
 */
export function judgeEncoder( codec: CameraCodec, wantHardware: boolean, s: EncoderSample, tune: Pick<CameraTune, 'passSent' | 'passCpu' | 'passEncode'> = CAMERA_TUNE_DEFAULTS ): CameraCheckVerdict {
    const base = { codec, implementation: s.implementation, hardware: s.hardware };
    const seconds = Math.max( s.elapsedMs, 1 ) / 1000;
    const none = ( why: string ): CameraCheckVerdict => ( { ...base, result: null, msPerFrame: null, sentShare: null, cpuShare: null, why } );
    if( s.captured < CHECK_MIN_FRAMES || s.encoded <= 0 ) return none( 'few-frames' );
    if( s.bandwidthSeconds / seconds > CHECK_MAX_BANDWIDTH_SHARE ) return none( 'bandwidth' );

    const sentShare = sentShareOf( s );
    // the encoding time of a picture the camera gave: an SVC encoding's layer frames are no more pictures
    const msPerFrame = s.encodeSeconds * 1000 / Math.max( 1, Math.min( s.encoded, s.captured ) );
    const cpuShare = Math.min( 1, s.cpuSeconds / seconds );
    const fps = Math.min( 30, s.captureFps > 0 ? s.captureFps : s.captured / seconds );
    const numbers = { msPerFrame, sentShare, cpuShare, ...( fps > 0 ? { fps } : {} ), ...( s.frameHeight ? { frameHeight: s.frameHeight } : {} ) };
    const verdict = ( result: CameraCodecResult, why: string ): CameraCheckVerdict => ( { ...base, ...numbers, result, why } );
    // short of frames over the window but keeping up over its second half: still starting, not failing
    const starting = !! s.late && s.late.captured > 0 && sentShareOf( s.late ) >= tune.passSent;

    if( wantHardware ){
        // a browser that names no encoder: whether it was the hardware can't be told
        if( s.known === false ) return none( 'unknown-encoder' );
        if( ! s.hardware ) return verdict( 'drops', 'software' );
        if( sentShare < tune.passSent ) return starting ? none( 'slow-start' ) : verdict( 'drops', 'drops' );
        return verdict( 'pass', 'ok' );
    }
    if( cpuShare > tune.passCpu ) return verdict( 'cpu', 'cpu' );
    if( fps > 0 && msPerFrame > tune.passEncode * 1000 / fps ) return verdict( 'cpu', 'slow' );
    if( sentShare < tune.passSent ) return starting ? none( 'slow-start' ) : verdict( 'cpu', 'drops' );
    return verdict( 'pass', 'ok' );
}

// The share of the camera's frames a sample sent: an encoding sends 30 a second at most (the room's maxFramerate), so a
// camera giving 60 isn't the encoder's to keep.
function sentShareOf( s: Pick<EncoderSample, 'captured' | 'sent' | 'elapsedMs'> ): number {
    const given = s.elapsedMs > 0 ? Math.min( s.captured, s.elapsedMs / 1000 * 30 ) : s.captured;
    return given > 0 ? Math.min( 1, s.sent / given ) : 0;
}

/**
 * Whether an encoder keeps up with its camera over a stretch (the check's warm-up, CAMERA_CHECK_KEEPUP_MS): the camera
 * gave two frames or more, and it sent at least passSent of them.
 */
export function keepsUp( s: Pick<EncoderSample, 'captured' | 'sent' | 'elapsedMs'>, passSent: number ): boolean {
    return s.captured >= 2 && sentShareOf( s ) >= passSent;
}

/**
 * The share of its frame interval a picture inferred at a lower height (fitsLower()) may take: it goes out unmeasured,
 * so it needs room to spare that a measured one doesn't.
 */
export const CHECK_INFER_HEADROOM = 0.8;

/**
 * Whether a software codec its CPU couldn't carry at the height it was measured at would carry `to` lines
 * (CAMERA_STEP_DOWN_HEIGHT), told from the same measurement rather than a second one, which the check's budget has no
 * room for, with 1080p tried first: the encoding time of a picture scales with
 * its pixels, a layered one's too (VP9's three at 720 lines are 0.44 of those at 1080), so the time a picture took,
 * scaled from the lines it was encoded at to `to`, has to fit CHECK_INFER_HEADROOM of passEncode of its interval. From
 * the lines it encoded at the end, which the CPU may already have shrunk: an encoder held back to `to` lines or under
 * doesn't fit them. Only a `cpu` verdict with its time and frame rate.
 */
export function fitsLower( verdict: CameraCheckVerdict, to: number, tune: Pick<CameraTune, 'passEncode'> = CAMERA_TUNE_DEFAULTS ): boolean {
    if( verdict.result !== 'cpu' || verdict.msPerFrame === null || ! verdict.fps ) return false;
    const at = verdict.frameHeight || verdict.height || 0;
    if( at <= to ) return false;
    return verdict.msPerFrame * ( to / at ) ** 2 <= tune.passEncode * CHECK_INFER_HEADROOM * 1000 / verdict.fps;
}

type StatsLike = { forEach( fn: ( s: any ) => void ): void };

/** The counts a loopback's sender stats hold now: what two of them make an EncoderSample from. */
export interface EncoderCountsNow {
    at: number;
    captured: number;
    encoded: number;
    sent: number;
    encodeSeconds: number;
    cpuSeconds: number;
    bandwidthSeconds: number;
    captureFps: number;
    implementation: string;
    hardware: boolean;
    /** the browser named its encoder (encoderImplementation) or said whether it is power efficient */
    known: boolean;
    /** the lines of the picture it encodes now (frameHeight, the tallest of its outbound streams); 0 not said */
    frameHeight: number;
}

/** The sender's counts from its stats (an RTCStatsReport): its outbound-rtp's, summed, and its media-source's frames. */
export function encoderCounts( report: StatsLike ): EncoderCountsNow {
    const out: EncoderCountsNow = { at: 0, captured: 0, encoded: 0, sent: 0, encodeSeconds: 0, cpuSeconds: 0, bandwidthSeconds: 0, captureFps: 0, implementation: '', hardware: false, known: false, frameHeight: 0 };
    report.forEach( ( s ) => {
        if( s?.type === 'outbound-rtp' && ( ! s.kind || s.kind === 'video' ) ){
            out.at = Math.max( out.at, Number( s.timestamp ) || 0 );
            out.frameHeight = Math.max( out.frameHeight, Number( s.frameHeight ) || 0 );
            out.encoded += Number( s.framesEncoded ) || 0;
            out.sent += Number( s.framesSent ) || 0;
            out.encodeSeconds += Number( s.totalEncodeTime ) || 0;
            out.cpuSeconds = Math.max( out.cpuSeconds, Number( s.qualityLimitationDurations?.cpu ) || 0 );
            out.bandwidthSeconds = Math.max( out.bandwidthSeconds, Number( s.qualityLimitationDurations?.bandwidth ) || 0 );
            const name = String( s.encoderImplementation ?? '' );
            if( name ) out.implementation = name;
            if( name || typeof s.powerEfficientEncoder === 'boolean' ) out.known = true;
            if( s.powerEfficientEncoder === true || ( name && isHardwareEncoder( name ) ) ) out.hardware = true;
        } else if( s?.type === 'media-source' && ( ! s.kind || s.kind === 'video' ) ){
            out.captured = Math.max( out.captured, Number( s.frames ) || 0 );
            out.captureFps = Math.max( out.captureFps, Number( s.framesPerSecond ) || 0 );
        }
    } );
    return out;
}

/** What two readings make: the window's counts. */
export function sampleBetween( a: EncoderCountsNow, b: EncoderCountsNow ): EncoderSample {
    return {
        captured: Math.max( 0, b.captured - a.captured ),
        encoded: Math.max( 0, b.encoded - a.encoded ),
        sent: Math.max( 0, b.sent - a.sent ),
        elapsedMs: Math.max( 0, b.at - a.at ),
        encodeSeconds: Math.max( 0, b.encodeSeconds - a.encodeSeconds ),
        cpuSeconds: Math.max( 0, b.cpuSeconds - a.cpuSeconds ),
        bandwidthSeconds: Math.max( 0, b.bandwidthSeconds - a.bandwidthSeconds ),
        captureFps: b.captureFps,
        implementation: b.implementation,
        hardware: b.hardware,
        known: b.known,
        ...( b.frameHeight ? { frameHeight: b.frameHeight } : {} )
    };
}

/** What measureCameraEncoder() needs of the room: the camera's height, and whether its H.264 is the mesh's Baseline. */
export interface MeasureOptions {
    /** the camera's height, for the top layer's bitrate (cameraPublish); 720 when not given */
    height?: number;
    /** the most lines it is measured at (VP9_TOP_HEIGHT for VP9 in software); cameraMaxHeight() of the codec when not given */
    maxHeight?: number;
    /** the room is on the mesh, which takes Chromium's Baseline H.264 (CHROMIUM_H264_ENCODE): asked of it as a room is */
    mesh?: boolean;
    /** when (ms since the epoch) the measuring must have ended: past it, too little to tell ("timeout") */
    until?: number;
    /** the verdict's shares (the policy's tune); the defaults when not given */
    tune?: Pick<CameraTune, 'passSent' | 'passCpu' | 'passEncode'>;
    /** true once the camera is let go of: the measuring stops at once ("ended"), as when its track ends */
    stop?: () => boolean;
}

const sleep = ( ms: number ) => new Promise<void>( ( resolve ) => setTimeout( resolve, ms ) );

/** How often a measurement looks whether its camera was let go of. */
export const CAMERA_CHECK_POLL_MS = 100;

/** Why a measurement gave up before its verdict: its deadline passed, or its camera was let go of. */
class GaveUp extends Error {}

// Each video payload of an SDP asked to start at bitrate and keep at least most of it, so the loopback's estimate
// doesn't spend the window rising from libwebrtc's 300 kbit/s: the encoder is measured at the room's top layer.
function startingAt( sdp: string, kbps: number ): string {
    const lines = sdp.split( '\r\n' );
    const params = `x-google-start-bitrate=${kbps};x-google-min-bitrate=${Math.round( kbps * 0.8 )};x-google-max-bitrate=${Math.round( kbps * 1.5 )}`;
    const video: string[] = [];
    let inVideo = false;
    const fmtp = new Set<string>();
    for( const line of lines ){
        if( line.startsWith( 'm=' ) ) inVideo = line.startsWith( 'm=video' );
        const rtpmap = inVideo && /^a=rtpmap:(\d+) (h264|h265|vp8|vp9|av1)\//i.exec( line );
        if( rtpmap ) video.push( rtpmap[1] );
        const has = /^a=fmtp:(\d+) /.exec( line );
        if( has ) fmtp.add( has[1] );
    }
    const out: string[] = [];
    for( const line of lines ){
        const has = /^a=fmtp:(\d+) (.*)$/.exec( line );
        if( has && video.includes( has[1] ) ){
            out.push( `a=fmtp:${has[1]} ${has[2]};${params}` );
            continue;
        }
        out.push( line );
        const rtpmap = /^a=rtpmap:(\d+) /.exec( line );
        if( rtpmap && video.includes( rtpmap[1] ) && ! fmtp.has( rtpmap[1] ) ) out.push( `a=fmtp:${rtpmap[1]} ${params}` );
    }
    return out.join( '\r\n' );
}

// The receiver's codecs for codec, in the profile a room asks: H.264 Baseline on the mesh (Chromium encodes it in
// hardware), Constrained Baseline elsewhere; VP9 profile 0.
function preferred( codec: CameraCodec, mesh: boolean ): RTCRtpCodec[] {
    const all = ( typeof RTCRtpReceiver !== 'undefined' && RTCRtpReceiver.getCapabilities?.( 'video' )?.codecs ) || [];
    const ours = all.filter( ( c ) => c.mimeType.toLowerCase() === 'video/' + codec );
    if( codec === 'h264' ){
        const profile = ( c: RTCRtpCodec ) => /profile-level-id=([0-9a-f]{4})/i.exec( c.sdpFmtpLine ?? '' )?.[1]?.toLowerCase() ?? '';
        const mode1 = ours.filter( ( c ) => /packetization-mode=1/.test( c.sdpFmtpLine ?? '' ) );
        const want = mode1.filter( ( c ) => profile( c ) === ( mesh ? '4200' : '42e0' ) );
        return want.length ? want : mode1.length ? mode1 : ours;
    }
    if( codec === 'vp9' ){
        const zero = ours.filter( ( c ) => ! /profile-id=[1-9]/.test( c.sdpFmtpLine ?? '' ) );
        return zero.length ? zero : ours;
    }
    return ours;
}

/**
 * Measures codec on this device: the camera's picture (a clone of track, stopped after) through a loopback of two peer
 * connections in the page, at the room's top layer for codec (VP9 and AV1 as their one SVC stream), for
 * CAMERA_CHECK_WINDOW_MS after CAMERA_CHECK_WARMUP_MS; the verdict as judgeEncoder() gives it. Too little to tell
 * (result null, why "failed") where the browser can't run it or it didn't connect within CAMERA_CHECK_CONNECT_MS.
 *
 * Every wait in it ends by `until` ("timeout"), and every CAMERA_CHECK_POLL_MS it looks whether the camera was let go
 * of (its track ended, or `stop`): then it gives up at once ("ended"). Either way the clone is stopped and both peer
 * connections closed, so nothing holds the camera after the person turned it off or round.
 */
export async function measureCameraEncoder( track: MediaStreamTrack, codec: CameraCodec, wantHardware: boolean, options: MeasureOptions = {} ): Promise<CameraCheckVerdict> {
    const failed = ( why = 'failed' ): CameraCheckVerdict => ( { codec, result: null, msPerFrame: null, sentShare: null, cpuShare: null, implementation: '', hardware: false, why } );
    const gone = () => track.readyState === 'ended' || !! options.stop?.();
    if( typeof RTCPeerConnection === 'undefined' ) return failed();
    if( gone() ) return failed( 'ended' );
    const codecs = preferred( codec, !! options.mesh );
    if( ! codecs.length ) return failed( 'unsupported' );
    const until = options.until ?? Date.now() + CAMERA_TUNE_RANGES.checkMs[1];
    // a step of the measuring, within until, given up at once when the camera is let go of
    const step = <T>( work: Promise<T> ): Promise<T> => new Promise<T>( ( resolve, reject ) => {
        let done = false;
        const finish = ( end: () => void ) => {
            if( done ) return;
            done = true;
            clearInterval( poll );
            clearTimeout( timer );
            end();
        };
        const poll = setInterval( () => { if( gone() ) finish( () => reject( new GaveUp( 'ended' ) ) ); }, CAMERA_CHECK_POLL_MS );
        const timer = setTimeout( () => finish( () => reject( new GaveUp( gone() ? 'ended' : 'timeout' ) ) ), Math.max( 0, until - Date.now() ) );
        work.then( ( value ) => finish( () => resolve( value ) ), ( e ) => finish( () => reject( e ) ) );
    } );

    // the picture the room would send in codec: a software codec's from cameraMaxHeight() lines at most (VP9 from
    // `maxHeight`, VP9_TOP_HEIGHT), as fitCameraTrack() brings the camera down before it goes out
    let captured = 0;
    try {
        captured = track.getSettings().height ?? 0;
    } catch {}
    const height = Math.min( options.height ?? ( captured || 720 ), options.maxHeight ?? cameraMaxHeight( codec, wantHardware ) );
    const publish = cameraPublish( codec, Math.max( height, 720 ), null );
    const top = publish?.top ?? { maxBitrate: 1_500_000, maxFramerate: 30 };
    let clone: MediaStreamTrack | null = null;
    let a: RTCPeerConnection | null = null, b: RTCPeerConnection | null = null;
    try {
        const pa = a = new RTCPeerConnection(), pb = b = new RTCPeerConnection();
        clone = track.clone();
        pa.onicecandidate = ( e ) => { if( e.candidate ) pb.addIceCandidate( e.candidate ).catch( () => {} ); };
        pb.onicecandidate = ( e ) => { if( e.candidate ) pa.addIceCandidate( e.candidate ).catch( () => {} ); };
        const encoding: RTCRtpEncodingParameters & { scalabilityMode?: string } = { maxBitrate: top.maxBitrate, maxFramerate: top.maxFramerate };
        if( captured > height ) encoding.scaleResolutionDownBy = captured / height;
        if( publish?.scalabilityMode ) encoding.scalabilityMode = publish.scalabilityMode;
        const transceiver = pa.addTransceiver( clone, { direction: 'sendonly', sendEncodings: [ encoding ] } );
        try {
            transceiver.setCodecPreferences( codecs );
        } catch {
            return failed( 'unsupported' );
        }
        const kbps = Math.round( top.maxBitrate / 1000 );
        const offer = await step( pa.createOffer() );
        await step( pa.setLocalDescription( offer ) );
        await step( pb.setRemoteDescription( { type: 'offer', sdp: startingAt( offer.sdp ?? '', kbps ) } ) );
        const answer = await step( pb.createAnswer() );
        await step( pb.setLocalDescription( answer ) );
        await step( pa.setRemoteDescription( { type: 'answer', sdp: startingAt( answer.sdp ?? '', kbps ) } ) );

        const sender = transceiver.sender;
        const counts = async () => encoderCounts( await step( sender.getStats() ) as unknown as StatsLike );
        const connectBy = Math.min( Date.now() + CAMERA_CHECK_CONNECT_MS, until );
        // the latest the window may start and still end by until
        const lastStart = until - CAMERA_CHECK_WINDOW_MS - CAMERA_CHECK_POLL_MS;
        // connected and encoding: the first frame out of the encoder, waited for as long as a measuring still fits after
        // it (a hardware encoder's first session in a browser gives it late)
        let firstAt = 0;
        for( ;; ){
            // looked at each time round too: a wait as long as step()'s own look ends before it
            if( gone() ) return failed( 'ended' );
            if( pa.connectionState === 'failed' || pa.connectionState === 'closed' ) return failed();
            const connected = pa.connectionState === 'connected';
            if( ! connected && Date.now() > connectBy ) return failed( Date.now() > until ? 'timeout' : 'failed' );
            if( connected && ( await counts() ).encoded > 0 ){
                firstAt = Date.now();
                break;
            }
            if( Date.now() + CAMERA_CHECK_WARMUP_MS > lastStart ) return failed( 'slow-start' );
            await step( sleep( CAMERA_CHECK_POLL_MS ) );
        }
        // the warm-up: CAMERA_CHECK_WARMUP_MS at least, and until the encoder keeps up with its camera (sent passSent of
        // what it gave over the last CAMERA_CHECK_KEEPUP_MS). Not by the latest start: an encoder still starting, too
        // little to tell, never one that drops frames
        const passSent = options.tune?.passSent ?? CAMERA_TUNE_DEFAULTS.passSent;
        const readings: { at: number, counts: EncoderCountsNow }[] = [];
        const warmed = async (): Promise<EncoderCountsNow | null> => {
            for( ;; ){
                if( gone() ) throw new GaveUp( 'ended' );
                const now = Date.now(), c = await counts();
                readings.push( { at: now, counts: c } );
                // the latest reading a whole stretch back
                let from: { at: number, counts: EncoderCountsNow } | undefined;
                for( const r of readings ) if( now - r.at >= CAMERA_CHECK_KEEPUP_MS ) from = r;
                if( from && now - firstAt >= CAMERA_CHECK_WARMUP_MS && keepsUp( sampleBetween( from.counts, c ), passSent ) ) return c;
                if( Date.now() + CAMERA_CHECK_POLL_MS > lastStart ) return null;
                await step( sleep( CAMERA_CHECK_POLL_MS ) );
            }
        };
        const first = await warmed();
        if( ! first ) return failed( 'slow-start' );
        // the window, read at its middle too: an encoder rising through it is still starting (judgeEncoder, `late`)
        await step( sleep( CAMERA_CHECK_WINDOW_MS / 2 ) );
        const middle = await counts();
        await step( sleep( CAMERA_CHECK_WINDOW_MS / 2 ) );
        const last = await counts();
        if( gone() ) return failed( 'ended' );
        return { ...judgeEncoder( codec, wantHardware, { ...sampleBetween( first, last ), late: sampleBetween( middle, last ) }, options.tune ), height };
    } catch( e ) {
        return failed( e instanceof GaveUp ? e.message : 'failed' );
    } finally {
        try { clone?.stop(); } catch {}
        try { a?.close(); } catch {}
        try { b?.close(); } catch {}
    }
}

let gpuName: Promise<string | undefined> | null = null;

/** The graphics adapter, as WebGPU names it ("amd rdna-3"), within 300 ms; undefined where the browser doesn't say. */
export function graphicsAdapter(): Promise<string | undefined> {
    gpuName ??= ( async () => {
        try {
            const gpu = ( globalThis.navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string, architecture?: string } } | null> } } | undefined )?.gpu;
            if( ! gpu ) return undefined;
            const adapter = await Promise.race( [ gpu.requestAdapter(), sleep( 300 ).then( () => null ) ] );
            const name = [ adapter?.info?.vendor, adapter?.info?.architecture ].filter( Boolean ).join( ' ' ).trim();
            return name || undefined;
        } catch {
            return undefined;
        }
    } )().then( ( name ) => {
        // for the policy's rules read without waiting (room-publish.ts, cameraRuleOrder())
        rememberAdapter( name );
        return name;
    } );
    return gpuName;
}

/** What checkedCameraChoice() takes besides the codec rule's options. */
export interface CameraCheckOptions extends CameraCodecOptions {
    /** the camera's height (cameraPublish's layers); 720 when not given */
    height?: number;
    /** the whole check's budget; the policy's tune.checkMs when not given */
    budgetMs?: number;
    /** how a codec is measured (tests give their own); measureCameraEncoder() */
    measure?: ( track: MediaStreamTrack, codec: CameraCodec, wantHardware: boolean, options: MeasureOptions ) => Promise<CameraCheckVerdict>;
    /**
     * The camera is out in the call already (a direct call's handed to the room, a reconnect publishing it again): nothing
     * is measured, what this browser remembers decides.
     */
    live?: boolean;
    /** true once the camera is let go of (turned off, turned round): the check stops at once */
    stop?: () => boolean;
    /**
     * A camera move's pick (nextCameraChoice()): measured on any machine, where a camera turned on is checked only on one
     * a camera rule names.
     */
    move?: boolean;
}

/**
 * One codec as the mesh hears of it (MeshCameraReport): measured this time (cached false), or read from this browser's
 * records (cached true, with when it was found).
 */
export interface CameraTest {
    codec: CameraCodec;
    hardware: boolean;
    /** "error": the check said too little (see CameraCheckVerdict.why) */
    result: CameraCodecResult | 'error';
    msPerFrame: number | null;
    sentShare: number | null;
    cpuShare: number | null;
    cached: boolean;
    at: number;
    /** the lines it was found at, where said (a codec in software, CameraCodecRecord.height) */
    height?: number;
}

/** A camera moved to another codec during a call (camera-adapt.ts), as the mesh hears of it. */
export interface CameraSwitch {
    from: CameraCodec;
    to: CameraCodec;
    /** its hardware encoder took frames off; the CPU held its software encoder back (the encoder's own word for it) */
    why: 'drops' | 'cpu';
    at: number;
}

/**
 * A camera's codec, checked: the choice; each codec it measured (`checked`); how it was decided (`source`: "check" a
 * codec was measured now, "memory" a record decided it, "default" the policy's order as it stands); how long the check
 * took; and every codec it measured or read (`tests`), for the mesh (MeshCameraReport).
 */
export type CheckedCameraChoice = CameraChoice & {
    checked: CameraCheckVerdict[];
    source: 'check' | 'memory' | 'default';
    checkMs: number;
    tests: CameraTest[];
};

/**
 * What a camera reports to the mesh with the client's next reading (rtc-client's Room.reportMeshCamera, signal field
 * 1003, so the server can decide further from what every call reports): the codec it goes out
 * in, how that was decided, the check's ms, every codec tried or read, and this call's last MESH_CAMERA_SWITCHES moves.
 */
export interface MeshCameraReport {
    codec: CameraCodec;
    source: 'check' | 'memory' | 'default' | 'switch';
    checkMs: number;
    tests: CameraTest[];
    switches: CameraSwitch[];
}

/** The moves a report carries, the last of the call. */
export const MESH_CAMERA_SWITCHES = 4;

const round = ( n: number | null, places = 3 ) => n === null || ! Number.isFinite( n ) ? null : Math.round( n * 10 ** places ) / 10 ** places;

/**
 * The report for choice (MeshCameraReport), with the call's switches (the last MESH_CAMERA_SWITCHES) and `source`
 * "switch" when the last move made the codec it goes out in. Numbers rounded; under 2 KB as JSON (a report never holds
 * more than the five codecs' tests and four moves).
 */
export function meshCameraReport( choice: Pick<CheckedCameraChoice, 'codec' | 'source' | 'checkMs' | 'tests'>, switches: readonly CameraSwitch[] = [] ): MeshCameraReport {
    const last = switches.slice( -MESH_CAMERA_SWITCHES );
    return {
        codec: choice.codec,
        source: last.length && last[ last.length - 1 ].to === choice.codec ? 'switch' : choice.source,
        checkMs: Math.round( choice.checkMs ),
        // a check remembered as unsure goes as "error", the node's word for one that said too little (it drops a result
        // it doesn't know: pass, drops, cpu, error)
        tests: choice.tests.slice( 0, 5 ).map( ( t ) => ( { ...t, result: t.result === 'unsure' ? 'error' : t.result,
            msPerFrame: round( t.msPerFrame, 1 ), sentShare: round( t.sentShare, 2 ), cpuShare: round( t.cpuShare, 2 ) } ) ),
        switches: last.map( ( s ) => ( { ...s } ) )
    };
}

/**
 * Hands report to the room's client for its next reading (rtc-client 1.0.16's Room.reportMeshCamera); a client
 * without it, or no room, is left alone.
 */
export function reportMeshCamera( room: unknown, report: MeshCameraReport ): void {
    try {
        ( room as { reportMeshCamera?: ( info: MeshCameraReport ) => void } | null )?.reportMeshCamera?.( report );
    } catch {}
}

let running = 0;
const listeners = new Set<( running: boolean ) => void>();

/** Whether a camera check is running on this page now: what a camera control's busy spinner shows. */
export function cameraCheckRunning(): boolean {
    return running > 0;
}

/** Calls listener whenever a camera check starts or ends (true while one runs); the answer stops it. */
export function onCameraCheck( listener: ( running: boolean ) => void ): () => void {
    listeners.add( listener );
    return () => void listeners.delete( listener );
}

const announce = () => listeners.forEach( ( listener ) => {
    try { listener( running > 0 ); } catch {}
} );

/**
 * The camera's codec as it went out before the camera check, exactly: the policy's list or the built-in one, less the
 * dropped-frames list older releases kept (room-publish.ts, legacyCamera()). What every camera the check doesn't measure
 * goes out in, and where a check gives up: the same answer whichever gives up first, the check or its product's limit
 * on it.
 */
export function todaysCameraChoice( caps: CameraCodecCaps | null, agent: string, options: CameraCodecOptions = {} ): CameraChoice {
    return roomCallChoice( caps, agent, { ...options, call: false, avoid: undefined } );
}

/**
 * The camera's codec on this device, measured (the module's comment): the codecs in cameraCodecOrder(), each that needs
 * it measured unless a record says it passed, the first that passes taken. A hardware H.264 or H.265 needs it (its
 * frames may be taken off), and VP9 or AV1 in software (the CPU may not carry it); VP8 never. Records each verdict
 * (CameraCodecRecord). Past the budget, or where a check says too little, the codec goes out as the order has it,
 * unmeasured; where that is a codec a rule puts first in software (by default VP9 on Windows and Linux), today's choice
 * instead (todaysCameraChoice()), never VP8 for it. VP9 in software is measured at up to VP9_TOP_HEIGHT and goes out at
 * the lines it passed at, or at CAMERA_STEP_DOWN_HEIGHT where it only fits there (CameraChoice.height). The budget, the
 * verdict's shares and how long records hold are the policy's tune's (cameraTune()).
 *
 * Today's choice, nothing measured and nothing read or written: no track (an audio call), a camera let go of, WebKit or
 * Firefox (uncheckedBrowser()), an encrypted room, every room whose node didn't say `check`: true (an older mesh, a
 * self-hosted box, stock LiveKit: nothing there could turn the check off), and every machine no camera rule names (by
 * default all but Windows and Linux; the node widens it with rules of its own, `rules: []`
 * names none), unless the pick is a move's (`move`, nextCameraChoice()). A camera already out in the call (`live`) is
 * measured never: what this browser remembers decides. A camera let go of during the check (`stop`, or its track
 * ended) ends it at once, with today's choice and nothing written. A check that couldn't tell is remembered a day
 * (`unsure`), and the cameras of that day go out as today without measuring.
 */
export async function checkedCameraChoice( track: MediaStreamTrack | null | undefined, caps: CameraCodecCaps | null, agent: string,
    given: CameraCheckOptions = {} ): Promise<CheckedCameraChoice> {
    const started = Date.now();
    const today = (): CheckedCameraChoice => ( { ...todaysCameraChoice( caps, agent, given ), checked: [], source: 'default', checkMs: Date.now() - started, tests: [] } );
    const gone = () => ! track || track.readyState === 'ended' || !! given.stop?.();
    // on only where the node turned it on (its codec policy's "check": true): today's choice otherwise, no record read
    if( gone() || given.encrypted || uncheckedBrowser( agent ) || given.policy?.check !== true ) return today();

    // a call's camera, whose order this is (room-publish.ts, CameraCodecOptions.call)
    const options: CameraCheckOptions = { ...given, call: true };
    const tune = cameraTune( options.policy );
    const hardware = hardwareFromCaps( caps );
    // every codec this browser holds a record of, as the mesh hears of them (cached: read, not measured now)
    const tests: CameraTest[] = [];
    const records = cameraCodecRecords();
    for( const codec of Object.keys( records ) as CameraCodec[] ){
        const record = cameraCodecRecord( codec, agent, Date.now(), tune );
        if( ! record ) continue;
        tests.push( { codec, hardware: encodesInHardware( codec, agent, hardware, options ), result: record.result, msPerFrame: record.msPerFrame,
            sentShare: record.sentShare, cpuShare: record.cpuShare, cached: true, at: record.at, ...( typeof record.height === 'number' ? { height: record.height } : {} ) } );
    }
    const unchecked = (): CheckedCameraChoice => ( { ...today(), source: tests.length ? 'memory' : 'default', tests } );
    // a camera already out: what's remembered decides (a rule's first in software only once it passed), nothing measured
    if( options.live ) return { ...roomCallChoice( caps, agent, options ), checked: [], source: tests.length ? 'memory' : 'default', checkMs: Date.now() - started, tests };

    // a rule naming a graphics maker waits for the adapter's name (300 ms at most, once a page); only then is it asked
    if( options.gpu === undefined && rulesNeedGpu( cameraRules( options.policy ) ) ) options.gpu = ( await graphicsAdapter() ) ?? null;
    if( gone() ) return today();
    // a camera turned on is measured only on a machine a camera rule names (cameraRuleOrder(): by default Windows and
    // Linux, where hardware H.264 was seen freezing; the node's rules where it sends them, none for `rules: []`): every
    // other starts as today at once, no spinner. A Mac's first hardware session in a browser starts 2 s late and slow,
    // so its check ends unsure every day for nothing (the mesh lab, 2026-10-23). A move's pick (`move`) measures on
    // any machine.
    if( ! options.move && cameraRuleOrder( agent, options ) === null ) return today();
    const order = cameraCodecOrder( agent, hardware, options );
    // a rule's first codec in software (by default VP9 on Windows and Linux) is never taken unmeasured
    const ruleFirst = cameraRuleOrder( agent, options ) !== null && order[0] !== 'vp8' && ! encodesInHardware( order[0], agent, hardware, options );
    const checked: CameraCheckVerdict[] = [];
    const choice = ( codec: CameraCodec, source: CheckedCameraChoice['source'], height?: number ): CheckedCameraChoice => {
        const encoded = encodesInHardware( codec, agent, hardware, options );
        return {
            codec,
            hardware: encoded,
            backup: options.encrypted ? null : backupFor( codec, options.policy ),
            height: height ?? choiceHeight( codec, encoded, agent, options ),
            checked,
            source: checked.length ? 'check' : source,
            checkMs: Date.now() - started,
            tests
        };
    };
    const measure = options.measure ?? measureCameraEncoder;
    const deadline = started + ( options.budgetMs ?? tune.checkMs );
    // the lines this camera gives, which VP9 in software is tried at up to VP9_TOP_HEIGHT
    let lines = options.height ?? 0;
    try {
        lines ||= track!.getSettings().height ?? 0;
    } catch {}

    running++;
    announce();
    try {
        for( const [ i, codec ] of order.entries() ){
            const inHardware = encodesInHardware( codec, agent, hardware, options );
            const needs = codec !== 'vp8' && ( inHardware ? codec === 'h264' || codec === 'h265' : true );
            if( ! needs ) return choice( codec, tests.length ? 'memory' : 'default' );
            // VP9 in software, tried at the camera's lines up to VP9_TOP_HEIGHT (1080p first)
            const layered = codec === 'vp9' && ! inHardware;
            const top = layered ? Math.min( VP9_TOP_HEIGHT, lines || CAMERA_STEP_DOWN_HEIGHT ) : 0;
            // the newest finding decides: a pass since no dropped frames, or a check that couldn't tell (a day of today's
            // choice). VP9's pass at fewer lines than this camera gives (another camera's) is measured again at these;
            // VP9 too heavy only above CAMERA_STEP_DOWN_HEIGHT goes out at that, one heavier is never in the order
            // (heavySoftwareCodecs())
            const finding = cameraFinding( codec, agent, Date.now(), tune );
            const found = finding?.result;
            const passedLower = layered && found === 'pass' && ( finding?.height ?? CAMERA_STEP_DOWN_HEIGHT ) < top;
            if( found === 'pass' && ! passedLower ) return choice( codec, 'memory' );
            if( found === 'cpu' && layered && ( finding?.height ?? CAMERA_STEP_DOWN_HEIGHT ) > CAMERA_STEP_DOWN_HEIGHT ) return choice( codec, 'memory', CAMERA_STEP_DOWN_HEIGHT );
            if( found === 'unsure' ) return { ...unchecked(), source: 'memory' };
            // the rule's first in software, unmeasured or measured too little: today's choice, the same whoever gives up
            const onlyMeasured = i === 0 && ruleFirst;
            if( deadline - Date.now() < MEASURE_MIN_MS ){
                // out of time: anything else goes as the order has it (VP9 passed at fewer lines: at those)
                return onlyMeasured && ! passedLower ? unchecked() : choice( codec, passedLower ? 'memory' : 'default' );
            }
            const verdict = await measure( track!, codec, inHardware, { height: options.height, ...( layered ? { maxHeight: VP9_TOP_HEIGHT } : {} ),
                mesh: options.h265, until: deadline, tune, stop: given.stop } );
            // let go of meanwhile: nothing more is measured, nothing written
            if( gone() ) return unchecked();
            const at = verdict.height ?? CAMERA_STEP_DOWN_HEIGHT;
            checked.push( verdict );
            tests.push( { codec, hardware: inHardware, result: verdict.result ?? 'error', msPerFrame: verdict.msPerFrame, sentShare: verdict.sentShare,
                cpuShare: verdict.cpuShare, cached: false, at: Date.now(), ...( layered && verdict.height ? { height: verdict.height } : {} ) } );
            // the graphics adapter only where the page already asked for it (a rule naming a maker)
            const gpu = knownAdapter();
            const numbers = { msPerFrame: verdict.msPerFrame, sentShare: verdict.sentShare, cpuShare: verdict.cpuShare, ...( gpu ? { gpu } : {} ) };
            if( verdict.result === null ){
                // couldn't tell: remembered a day, so the next cameras don't wait for it again (VP9 passed at fewer
                // lines: that pass stays, and it goes out at those)
                if( passedLower ) return choice( codec, 'check' );
                rememberCameraCodec( codec, { result: 'unsure', msPerFrame: null, sentShare: null, cpuShare: null, ...( gpu ? { gpu } : {} ) }, agent );
                return onlyMeasured ? { ...unchecked(), checked, source: 'check' } : choice( codec, 'default' );
            }
            // VP9 its CPU can't carry at its lines, but would at CAMERA_STEP_DOWN_HEIGHT (passed there before, or by the
            // same measurement, fitsLower()): remembered too heavy at its lines, and out at CAMERA_STEP_DOWN_HEIGHT
            if( layered && verdict.result === 'cpu' && at > CAMERA_STEP_DOWN_HEIGHT && ( passedLower || fitsLower( verdict, CAMERA_STEP_DOWN_HEIGHT, tune ) ) ){
                rememberCameraCodec( codec, { result: 'cpu', ...numbers, height: at }, agent );
                return choice( codec, 'check', CAMERA_STEP_DOWN_HEIGHT );
            }
            // a pass holds for the lines it was measured at, VP9 too heavy for 720 as well is ruled out (its height 720)
            rememberCameraCodec( codec, { result: verdict.result, ...numbers,
                ...( layered ? { height: verdict.result === 'cpu' ? CAMERA_STEP_DOWN_HEIGHT : at } : {} ) }, agent );
            if( verdict.result === 'pass' ) return choice( codec, 'check', layered ? at : undefined );
        }
        return choice( 'vp8', 'default' );
    } catch {
        return unchecked();
    } finally {
        running--;
        announce();
    }
}
