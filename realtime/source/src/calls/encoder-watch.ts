import {rememberCameraCodec, rememberDroppedHardware, CAMERA_TUNE_DEFAULTS, type CameraCodec, type CameraTune} from "./room-publish.js";

/**
 * A camera's hardware encoder that drops frames, found while it sends, so this device's next camera goes out in
 * software (cameraCodecFor()'s avoid, room-publish.ts).
 *
 * Seen 2026-10-21 in a call: a Windows PC's AMD encoder (Media Foundation's AMDh264Encoder) sent its
 * 360p at 3-6 frames a second of the 15 its camera gave, at 690-870 kbit/s over the layer's 600, and its 180p, which
 * OpenH264 encodes, at the same few, each encoding fast and the browser naming nothing that held it back. libwebrtc
 * takes whole frames off the camera when an encoder it doesn't trust overshoots its target (its frame dropper), every
 * layer at once, and says nothing of it (qualityLimitationReason "none"). Another AMD PC in the same call sent 17 of 17:
 * it is a device's, not a maker's, so it is found on the device. The mesh's lab gets the same of a Mac's VideoToolbox
 * under heavy grain (test/msengine TestHardwareEncoderFrames: 3.7 to 8.3 frames of 15, none limiting), where OpenH264
 * lowers the picture's size and keeps its frames (13-15 of 15, "bandwidth"). Zoom's advice on such AMD machines is to
 * turn off hardware acceleration for sending video, which this does for the person.
 *
 * Found over the last HARDWARE_DROP_READINGS readings (30 s), each of them a hardware encoder's (hardwareReading()):
 * - the camera goes out in H.264 or H.265, a layer it sends in hardware;
 * - its source gives at least HARDWARE_DROP_MIN_CAPTURED frames a second;
 * - the browser says nothing limits a layer it sends (no CPU, no bandwidth);
 * - and the hardware takes at most HARDWARE_DROP_MAX_ENCODE_MS a frame, so it isn't a slow machine;
 * when the layer that keeps the most encodes HARDWARE_DROP_SHARE or less of the frames its source gave in all: the whole
 * camera's taken off. A software encoder short of bits drops its own layer's frames alone (the lab's VP8 under heavy
 * grain: 720p at 2 of 15, its 360p and 180p at 15), and a dim room's camera gives fewer frames, which every layer sends.
 * In all, not reading by reading: the lab's VideoToolbox froze every layer at 0.6 frames a second for 10 to 15 s
 * between 20 s at 15 (its 15 s average 13 of 15), where the AMD PC sent 3-6 every second.
 */
export const HARDWARE_DROP_READ_MS = 5_000;
export const HARDWARE_DROP_READINGS = 6;
// the readings of a camera's first 10 s, left out: its encoder starting sends a frame or two of its first 5 s (the lab's
// 0.6 a second of 15, every run), which counted would find a camera that drops a little later on
export const HARDWARE_DROP_WARMUP = 2;
export const HARDWARE_DROP_SHARE = 0.7;
export const HARDWARE_DROP_MIN_CAPTURED = 10;
export const HARDWARE_DROP_MAX_ENCODE_MS = 25;
// a hardware layer the reading counts sends at least HARDWARE_DROP_MIN_SENT of a target of HARDWARE_DROP_MIN_TARGET or
// more: an encoder cut off by a path that went down encodes nothing, sends nothing and reports no target (libwebrtc
// leaves a zero one out), and names no limitation either (the P2P engine's call 50038, peer.ts), so a Wi-Fi gap of 9 s
// in 30 read as a camera's frames taken off (the review after the move to the mesh, 2026-10-21). The AMD PC sent its
// 360p at 690-870 kbit/s over a target of 600.
export const HARDWARE_DROP_MIN_TARGET = 100_000;
export const HARDWARE_DROP_MIN_SENT = 0.25;
// a watch that follows a getter ends once it has given no live camera this long, its caller's stop missed
export const HARDWARE_WATCH_GONE_MS = 10 * 60_000;

/**
 * A camera in software that its CPU can't carry (camera-adapt.ts moves it, only on sustained evidence: a camera that's
 * merely CPU-limited a little, under half the time, stays): over the last CPU_HELD_READINGS
 * readings (20 s), the encoder's own stats said the CPU held it back CPU_HELD_SHARE of the time or more
 * (qualityLimitationDurations.cpu). VP9 and AV1, which go out in software; never a hardware encoder. Not the machine's
 * CPU pressure: that may be the page decoding many tiles, or a hidden page's stale reading, not this encoder.
 */
export const CPU_HELD_READINGS = 4;
export const CPU_HELD_SHARE = 0.5;

/**
 * One layer between two readings: whether it is sent (its encoding active; one dynacast paused isn't), its frames a
 * second, whether in hardware, what limits it, ms a frame, the bits a second its encoder is given (null: none said)
 * and what it sent.
 */
export interface EncoderLayer {
    rid: string;
    active: boolean;
    fps: number;
    hardware: boolean;
    limit: string;
    encodeMs: number | null;
    target: number | null;
    sentBps: number;
}

/**
 * A camera's sender between two readings: its codec, the frames a second its source gives (no more than its encodings
 * send at most), and its layers.
 */
export interface EncoderReading {
    codec: CameraCodec | null;
    captured: number;
    layers: EncoderLayer[];
    /** ms of the reading the browser said the CPU held the encoder back (0 where not said) */
    cpuMs?: number;
    /** ms the reading spans */
    elapsedMs?: number;
}

/**
 * Whether readings, the last `count` of them (CPU_HELD_READINGS, 20 s), are a software camera its CPU can't carry: VP9
 * or AV1 sent with no layer in hardware, held back by the CPU `share` of their time (CPU_HELD_SHARE) or more.
 */
export function cpuHeld( readings: EncoderReading[], count = CPU_HELD_READINGS, share = CPU_HELD_SHARE ): boolean {
    if( readings.length < count ) return false;
    const last = readings.slice( -count );
    if( last.some( ( r ) => ( r.codec !== 'vp9' && r.codec !== 'av1' ) || r.layers.some( ( l ) => l.active && l.hardware ) ) ) return false;
    const held = last.reduce( ( n, r ) => n + ( r.cpuMs ?? 0 ), 0 ), spanned = last.reduce( ( n, r ) => n + ( r.elapsedMs ?? 0 ), 0 );
    return spanned > 0 && held >= spanned * share;
}

/** How many readings readMs apart make `seconds` (the policy's dropWatchS, cpuWatchS): one at least. */
export const readingsFor = ( seconds: number, readMs = HARDWARE_DROP_READ_MS ) => Math.max( 1, Math.round( seconds * 1000 / readMs ) );

/**
 * A reading of a hardware encoder that isn't held back by anything the browser names (above): the frames a second of
 * the layer it sends that keeps the most, and its source's; null for any other.
 */
export function hardwareReading( r: EncoderReading ): { best: number, captured: number } | null {
    if( r.codec !== 'h264' && r.codec !== 'h265' ) return null;
    if( ! ( r.captured >= HARDWARE_DROP_MIN_CAPTURED ) ) return null;
    const sent = r.layers.filter( ( l ) => l.active );
    if( ! sent.some( ( l ) => l.hardware ) ) return null;
    // the path carries what the hardware makes: none is a path gone down, not an encoder
    if( ! sent.some( ( l ) => l.hardware && l.target !== null && l.target >= HARDWARE_DROP_MIN_TARGET
        && l.sentBps >= l.target * HARDWARE_DROP_MIN_SENT ) ) return null;
    if( sent.some( ( l ) => ( l.limit !== 'none' && l.limit !== '' )
        || ( l.hardware && l.encodeMs !== null && l.encodeMs > HARDWARE_DROP_MAX_ENCODE_MS ) ) ) return null;
    return { best: Math.max( 0, ...sent.map( ( l ) => l.fps ) ), captured: r.captured };
}

/**
 * Whether readings, the last `count` of them (HARDWARE_DROP_READINGS, 30 s), are a hardware encoder taking the whole
 * camera's frames off.
 */
export function dropsFrames( readings: EncoderReading[], count = HARDWARE_DROP_READINGS ): boolean {
    if( readings.length < count ) return false;
    const read = readings.slice( -count ).map( hardwareReading );
    if( read.some( ( r ) => r === null ) ) return false;
    const kept = read.reduce( ( n, r ) => n + r!.best, 0 ), given = read.reduce( ( n, r ) => n + r!.captured, 0 );
    return kept <= given * HARDWARE_DROP_SHARE;
}

// Chrome's names for its hardware encoders: VideoToolbox, MediaFoundationVideoEncodeAccelerator (AMDh264Encoder),
// VaapiVideoEncodeAccelerator, V4L2VideoEncodeAccelerator, MediaCodec on Android, ExternalEncoder before
const HARDWARE_NAME = /videotoolbox|accelerator|mediafoundation|mediacodec|externalencoder|vaapi|v4l2|nvenc|amf\b|quick ?sync/i;

/**
 * The encoder each layer runs on: Chrome names a simulcast's "SimulcastEncoderAdapter (OpenH264, VideoToolbox,
 * VideoToolbox)", one encoder a stream in the sender's encodings' order (rids, lowest first), on every layer's stats.
 */
export function layerEncoders( implementation: string, rids: string[] ): Map<string, string> {
    const out = new Map<string, string>();
    const adapter = /^SimulcastEncoderAdapter\s*\((.*)\)$/.exec( implementation.trim() );
    if( ! adapter ){
        for( const rid of rids.length ? rids : [ '' ] ) out.set( rid, implementation );
        return out;
    }
    // split on the commas between names, not inside one's own parentheses ("…Accelerator (Intel® Quick Sync …)")
    const names: string[] = [];
    let depth = 0, from = 0;
    const inner = adapter[1];
    for( let i = 0; i < inner.length; i++ ){
        if( inner[i] === '(' ) depth++;
        else if( inner[i] === ')' ) depth--;
        else if( inner[i] === ',' && depth === 0 ){
            names.push( inner.slice( from, i ).trim() );
            from = i + 1;
        }
    }
    names.push( inner.slice( from ).trim() );
    rids.forEach( ( rid, i ) => out.set( rid, names[i] ?? '' ) );
    return out;
}

// Chrome's software encoder standing in for a hardware one that failed names it: "OpenH264 (fallback from:
// MediaFoundationVideoEncodeAccelerator (AMDh264Encoder))", software all the same
export const isHardwareEncoder = ( name: string ) => HARDWARE_NAME.test( name.split( /\s*\(fallback from:/i )[0] );

/** What a reading keeps of each layer's counts, for the next one. */
export type EncoderCounts = Map<string, { frames: number, encodeTime: number, bytes: number, at: number, cpu?: number }>;

type StatsLike = { forEach( fn: ( s: any ) => void ): void, get( id: string ): any };

/**
 * A camera sender's reading from its stats (RTCStatsReport) against the counts of the one before (null the first time:
 * no reading yet). rids: the sender's encodings', lowest first; maxFps: the most frames a second they send (0: none
 * said), over which its source's frames aren't the encoder's to send: a camera giving 60, sent at 30, keeps them all.
 */
export function readEncoder( before: EncoderCounts | null, report: StatsLike, rids: string[], maxFps = 0 ): { reading: EncoderReading | null, counts: EncoderCounts } {
    const counts: EncoderCounts = new Map();
    const layers: EncoderLayer[] = [];
    let codec: CameraCodec | null = null, captured = 0, cpuMs = 0, elapsedMs = 0;
    report.forEach( ( s ) => {
        if( s?.type !== 'outbound-rtp' || ( s.kind && s.kind !== 'video' ) ) return;
        const rid = String( s.rid ?? '' );
        const frames = Number( s.framesEncoded ) || 0, encodeTime = Number( s.totalEncodeTime ) || 0, at = Number( s.timestamp ) || 0;
        const bytes = Number( s.bytesSent ) || 0, target = Number( s.targetBitrate );
        const cpu = Number( s.qualityLimitationDurations?.cpu ) || 0;
        counts.set( rid, { frames, encodeTime, bytes, at, cpu } );
        const mime = String( report.get( s.codecId )?.mimeType ?? '' ).toLowerCase();
        if( mime.startsWith( 'video/' ) ) codec = mime.slice( 6 ) as CameraCodec;
        captured = Math.max( captured, Number( report.get( s.mediaSourceId )?.framesPerSecond ) || 0 );
        const was = before?.get( rid );
        if( ! was || at <= was.at ) return;
        // the encoder's limitation is the sender's, the same on each layer: the most any layer says
        cpuMs = Math.max( cpuMs, Math.max( 0, cpu - ( was.cpu ?? cpu ) ) * 1000 );
        elapsedMs = Math.max( elapsedMs, at - was.at );
        const encoded = frames - was.frames;
        const name = layerEncoders( String( s.encoderImplementation ?? '' ), rids ).get( rid ) ?? '';
        layers.push( {
            rid,
            // Chrome's outbound-rtp says whether its encoding is on (dynacast turns one nobody watches off)
            active: s.active !== false,
            fps: Math.max( 0, encoded ) * 1000 / ( at - was.at ),
            hardware: s.powerEfficientEncoder === true && ! /^SimulcastEncoderAdapter/.test( String( s.encoderImplementation ?? '' ) ) || isHardwareEncoder( name ),
            limit: String( s.qualityLimitationReason ?? '' ),
            encodeMs: encoded > 0 ? ( encodeTime - was.encodeTime ) * 1000 / encoded : null,
            target: Number.isFinite( target ) && target > 0 ? target : null,
            sentBps: Math.max( 0, bytes - was.bytes ) * 8 * 1000 / ( at - was.at )
        } );
    } );
    if( maxFps > 0 ) captured = Math.min( captured, maxFps );
    return { reading: before && layers.length ? { codec, captured, layers, cpuMs, elapsedMs } : null, counts };
}

// The sender's path is up, as far as the browser says (no transport said: the readings' bytes tell): a reading across a
// path gone down or coming back reads frames the path took, not the encoder.
function pathUp( sender: RTCRtpSender ): boolean {
    const dtls = sender.transport;
    if( ! dtls ) return true;
    const ice = dtls.iceTransport?.state;
    return dtls.state === 'connected' && ( ice === undefined || ice === 'connected' || ice === 'completed' );
}

/**
 * Watches a camera's sender (its primary codec's, not a backup's) while it sends, and once its hardware encoder is seen
 * dropping frames (dropsFrames() over the last HARDWARE_DROP_READINGS readings) remembers the codec for this browser and
 * stops. The camera sending now isn't changed: the next one goes out in software. The answer stops it.
 *
 * sender: the sender, whose track ending stops the watch; or what gives the camera's sender now, which the watch
 * follows until stopped: a full reconnect publishes the camera on a new sender, and a phone's camera put away in the
 * background is opened again on the same one, which the sender alone left unwatched (the review after the move to the
 * mesh, 2026-10-21). A new sender, a camera gone for a while, or a path that went down starts the readings over; a
 * getter that gives no live camera for HARDWARE_WATCH_GONE_MS ends the watch.
 *
 * The CPU watch, for a checked call camera (`records`) or one that may be moved (onCpuHeld, camera-adapt.ts): a camera in
 * VP9 or AV1 its CPU can't carry, by the same readings (cpuHeld(): the encoder's stats say the CPU held it back half of
 * the last 20 s or more), which remembers the codec as too heavy here (`cpu`, a week, where `records`), tells onCpuHeld
 * where given, and stops. A pass remembered for either is replaced at once. Both say the lines the camera was held back
 * at (its track's height, which the encoder may have shrunk on its own): a camera in VP9 held back above 720 is stepped
 * down to 720 (camera-adapt.ts, stepDownCamera()), and its record leaves VP9 at 720 for the next.
 *
 * records: what the watch finds is written to this browser's records too (room-publish.ts, CameraCodecRecord), for a
 * checked call camera, whether or not the node lets it be moved; without, only the drops, to the list older releases
 * kept, as before the camera check.
 *
 * tune: the node's numbers (the policy's, room-publish.ts cameraTune()): how long a hardware encoder drops frames
 * (dropWatchS) and a software one is held back (cpuWatchS) before either counts, and the share of that time held back
 * that does (cpuShare). The built-in ones without.
 */
export function watchCameraEncoder( sender: RTCRtpSender | ( () => RTCRtpSender | null | undefined ),
    options: { readMs?: number, tune?: Pick<CameraTune, 'dropWatchS' | 'cpuWatchS' | 'cpuShare'>, records?: boolean, onDrops?: ( codec: CameraCodec ) => void,
        onCpuHeld?: ( codec: CameraCodec, why: 'cpu', lines: number ) => void } = {} ): () => void {
    const tune = options.tune ?? CAMERA_TUNE_DEFAULTS;
    const readMs = options.readMs ?? HARDWARE_DROP_READ_MS;
    // the readings each verdict is over: 6 and 4 at the built-in 30 s and 20 s
    const dropReadings = readingsFor( tune.dropWatchS ), cpuReadings = readingsFor( tune.cpuWatchS );
    const follows = typeof sender === 'function';
    const current = follows ? sender : () => sender;
    let counts: EncoderCounts | null = null, busy = false, stopped = false, warmup = HARDWARE_DROP_WARMUP;
    let watched: RTCRtpSender | null = null, goneSince = 0;
    const last: EncoderReading[] = [];
    const over = () => {
        counts = null;
        warmup = HARDWARE_DROP_WARMUP;
        last.length = 0;
    };
    const stop = () => {
        stopped = true;
        clearInterval( timer );
    };
    const timer = setInterval( () => {
        if( stopped || busy ) return;
        const now = current() ?? null;
        if( now !== watched ){
            watched = now;
            over();
        }
        const track = now?.track;
        if( ! now || ! track || track.readyState === 'ended' ){
            if( ! follows ) return stop();
            goneSince ||= Date.now();
            if( Date.now() - goneSince >= HARDWARE_WATCH_GONE_MS ) return stop();
            return over();
        }
        goneSince = 0;
        if( ! pathUp( now ) ) return over();
        busy = true;
        now.getStats().then( ( report ) => {
            if( stopped || now !== watched ) return;
            const encodings = now.getParameters?.().encodings ?? [];
            const rids = encodings.map( ( e ) => e.rid ?? '' );
            const maxFps = Math.max( 0, ...encodings.filter( ( e ) => e.active !== false ).map( ( e ) => Number( e.maxFramerate ) || 0 ) );
            // an RTCStatsReport is maplike, which this TypeScript's DOM types leave get() out of
            const read = readEncoder( counts, report as unknown as StatsLike, rids, maxFps );
            counts = read.counts;
            if( ! read.reading ) return;
            if( warmup > 0 ){
                warmup--;
                return;
            }
            last.push( read.reading );
            if( last.length > Math.max( dropReadings, cpuReadings ) ) last.shift();
            const codec = read.reading.codec;
            if( ! codec ) return;
            if( dropsFrames( last, dropReadings ) ){
                const kept = last.slice( -dropReadings ).map( hardwareReading );
                const given = kept.reduce( ( n, r ) => n + ( r?.captured ?? 0 ), 0 );
                rememberDroppedHardware( codec, Date.now(), options.records ? { sentShare: given > 0 ? kept.reduce( ( n, r ) => n + ( r?.best ?? 0 ), 0 ) / given : null } : null );
                stop();
                options.onDrops?.( codec );
                return;
            }
            // the CPU watch: learned where the camera is checked (records), whether or not it may be moved (onCpuHeld)
            if( ( ! options.onCpuHeld && ! options.records ) || ! cpuHeld( last, cpuReadings, tune.cpuShare ) ) return;
            const spannedMs = last.slice( -cpuReadings ).reduce( ( n, r ) => n + ( r.elapsedMs ?? 0 ), 0 );
            const heldMs = last.slice( -cpuReadings ).reduce( ( n, r ) => n + ( r.cpuMs ?? 0 ), 0 );
            let lines = 0;
            try {
                lines = track.getSettings().height ?? 0;
            } catch {}
            if( options.records ) rememberCameraCodec( codec, { result: 'cpu', msPerFrame: null, sentShare: null, cpuShare: spannedMs > 0 ? heldMs / spannedMs : null,
                ...( lines ? { height: lines } : {} ) } );
            stop();
            options.onCpuHeld?.( codec, 'cpu', lines );
        } ).catch( () => {} ).finally( () => {
            busy = false;
        } );
    }, readMs );
    return stop;
}
