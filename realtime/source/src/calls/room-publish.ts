/**
 * How a camera and a screen go out into a room on the mesh: the codec, the layers, and the pixel density a tile asks
 * layers by. Better Messages' group calls, the SDK's (GroupCall) and Easy Stream's broadcasts take their codec from
 * here, so the three send alike: a modern codec, with a fallback every receiver decodes. Group calls take their layers
 * too. No imports, so a product's unit tests can transpile it alone.
 *
 * The codec: the best this device encodes in hardware, with VP8 behind it for a receiver that decodes none of it, so
 * hardware encodes and decodes wherever it can and no receiver gets what it cannot decode. Each receiver gets the one
 * it decodes in hardware, which its client tells the mesh on its join (@wordplus/rtc-client 1.0.3, mesh_hwdec), and VP8
 * only where it decodes the other in software at best.
 * - H.265 where the device encodes it in hardware and the room is on the mesh, which forwards it since WordPlus Mesh
 *   1.0.19: every Mac, iPhone and iPad (Chrome 154 on a Mac: H.265 power efficient, VP9 and AV1 not), and the
 *   Windows and Android devices whose probe says so. The most picture per bit any of them makes without its CPU.
 *   Not yet (H265_FIRST).
 * - H.264 where the device encodes that in hardware, which nearly every receiver decodes in hardware too. WebKit does,
 *   by VideoToolbox, in every profile, so Safari and every iPhone and iPad browser aren't asked. Chrome on a desktop
 *   encodes Baseline, Main and High in hardware (VideoToolbox on a Mac, Media Foundation on Windows) and Constrained
 *   Baseline, the profile a room took, in OpenH264 on the CPU, and its probe (navigator.mediaCapabilities) answers so
 *   (2026-10-18, Chrome 155: a Mac's camera sent in OpenH264 at 1080p, H.264 picked without hardware to encode it).
 *   The mesh takes its Baseline since WordPlus Mesh 1.0.34, so there Chrome is
 *   asked of Baseline (CHROMIUM_H264_ENCODE); elsewhere of Constrained Baseline, which Android's hardware encodes.
 * - VP8 otherwise; from Firefox (LiveKit takes no VP9 or AV1 from it, and a Firefox without OpenH264 sends no H.264
 *   picture); and in an end-to-end encrypted room, where livekit-client sends no backup codec, so the codec itself has
 *   to be one every browser and app decodes.
 * Not VP9 or AV1 by default: no device we ship to encodes them in hardware in the layers LiveKit publishes them in (one
 * stream, L3T3_KEY). Scored against Xiph's KristenAndSara at 720p (VMAF): VP8 88 at 2.5 Mbit/s, H.264 in a Mac's
 * hardware 92 at 1.27.
 *
 * The media server may ask for others (CodecPolicy, WordPlus Mesh 1.0.33's mesh.codec_policy, 2026-10-18), so codecs
 * can change from the server without a client update, and every browser has to keep working when it asks for VP9 or
 * H.265. Its list is a preference: a codec goes out only where
 * this browser sends it (the probe, and livekit-client's own limits), never from Firefox or into an encrypted room,
 * and VP8 is where any list ends.
 */
export type CameraCodec = 'h265' | 'h264' | 'vp8' | 'vp9' | 'av1';

const CAMERA_CODECS: readonly CameraCodec[] = [ 'h265', 'h264', 'vp8', 'vp9', 'av1' ];

/** What probeCodecCaps() found, as far as the codec needs it. */
export interface CameraCodecCaps {
    families: Record<string, { enc?: { ok?: boolean, hw?: boolean } } | undefined>;
    /** Chromium's answer to CHROMIUM_H264_ENCODE: H.264 Baseline in hardware. Missing: not asked (not Chromium). */
    h264Baseline?: boolean | null;
}

/**
 * The question Chromium answers of its H.264 hardware for the Baseline the mesh takes from it (1.0.34): Baseline,
 * packetization mode 1, level 4.2 (1080p60). Chrome 155 on a desktop answered it power efficient where it encodes in
 * VideoToolbox or Media Foundation (an AMD encoder), and Constrained Baseline not, which it encodes in OpenH264.
 */
export const CHROMIUM_H264_ENCODE = 'video/H264;profile-level-id=42002a;packetization-mode=1';

/**
 * Which codecs this device encodes in hardware (null or missing: not known), and which it encodes at all (`encodes`, the
 * probe's answer; missing: not known).
 */
export interface CameraHardware {
    h264?: boolean | null;
    h265?: boolean | null;
    vp9?: boolean | null;
    av1?: boolean | null;
    /** H.264 Baseline in hardware (CameraCodecCaps.h264Baseline), which counts on the mesh alone. */
    h264Baseline?: boolean | null;
    encodes?: Partial<Record<CameraCodec, boolean | null>>;
    /**
     * The codecs the browser's WebRTC sends at all (RTCRtpSender.getCapabilities), as livekit-client checks them: a
     * codec missing here goes out as VP8 whatever was asked. Missing: not known.
     */
    sendable?: CameraCodec[] | null;
}

/**
 * A media server's codec policy, as WordPlus Mesh 1.0.33 sends it with its join response (mesh.codec_policy;
 * rtc-client's Room.meshCodecPolicy). Each list goes first choice first, "h265:hw" taking H.265 only where this device
 * encodes it in hardware; an unknown name is passed over. Without a list, the built-in one (DEFAULT_CAMERA_POLICY).
 */
export interface CodecPolicy {
    camera?: string[];
    screen?: string[];
    /** Behind a camera in any codec but VP8, for a viewer that decodes none of it: vp8 (the default), or h264. */
    backup?: string;
}

export interface CameraCodecOptions {
    /** The room's media is encrypted end to end: VP8, since livekit-client sends no backup codec there. */
    encrypted?: boolean;
    /**
     * The media server is the mesh (rtc-client's isMeshServer): it forwards H.265 (WordPlus Mesh 1.0.19 and later), and
     * takes a desktop Chrome's H.264 in the Baseline it encodes in hardware (1.0.34).
     */
    h265?: boolean;
    /** The media server's codec policy; null or missing: the built-in one. */
    policy?: CodecPolicy | null;
}

const FIREFOX = /firefox\/|fxios\//i;
// WebKit: every browser on an iPhone or iPad, and Safari on a Mac (an iPad's Safari says Macintosh)
const IOS = /iphone|ipad|ipod/i;
const SAFARI = /^((?!chrome|chromium|crios|edg|opr|android|firefox|fxios).)*safari/i;
const isWebKit = ( agent: string ) => IOS.test( agent ) || SAFARI.test( agent );

/**
 * H.265 goes first on the mesh. Off until the mesh falls back from it as LiveKit does: a receiver without H.265 had
 * the publisher send its VP8 beside it at full size, both ladders at once, 10 Mbit/s from one Mac in a call on
 * calls.wordplus.org (2026-10-14). LiveKit regresses a room of fewer than 5 to the backup alone; WordPlus Mesh's
 * mediasoup tracks never did. Until then H.264 goes first.
 */
export const H265_FIRST = false;

/** The camera's codecs without a server's policy: today's rule, H.264 where it's hardware, else VP8. */
export const DEFAULT_CAMERA_POLICY: readonly string[] = H265_FIRST ? [ 'h265:hw', 'h264:hw', 'vp8' ] : [ 'h264:hw', 'vp8' ];

/**
 * The screen's without a server's policy: H.264 where the device encodes it in hardware, else VP8 in one picture
 * (screenPublish). Chrome on a Mac sharing a 2560×1440 document that scrolls (the mesh lab's
 * TestScreenShareQualityMatrix, 2026-10-18): H.264 in VideoToolbox 30 frames a second at an average quantizer of 16,
 * its CPU spared; VP8 alone 28-30 at 15-20. A shared screen goes out in hardware where it can, smooth without losing
 * its details.
 */
export const DEFAULT_SCREEN_POLICY: readonly string[] = [ 'h264:hw', 'vp8' ];

/**
 * Whether this device encodes codec in hardware: WebKit's H.264 is VideoToolbox's whatever its probe says of power,
 * unless the probe says it isn't there at all (a WebKit built without it, as Playwright's), and on the mesh Chromium's
 * is by its answer for Baseline (CHROMIUM_H264_ENCODE).
 */
function inHardware( codec: CameraCodec, agent: string, hardware: CameraHardware, options: CameraCodecOptions ): boolean {
    if( codec === 'h264' && isWebKit( agent ) && hardware.encodes?.h264 !== false ) return true;
    if( codec === 'h264' && options.h265 && hardware.h264Baseline === true ) return true;
    return codec !== 'vp8' && hardware[ codec ] === true;
}

/**
 * Whether this browser sends codec into the room at all: livekit-client's own limits (supportsAV1: no AV1 from WebKit;
 * nothing but VP8 from Firefox, taken before this), no VP9 from WebKit either, H.265 only to a server that forwards
 * it, nothing the browser's WebRTC doesn't list (sendable). H.264, which every WebRTC implementation must have, unless
 * the probe says it isn't there; the others only where the probe says they are, or the device encodes them in
 * hardware.
 */
function sends( codec: CameraCodec, agent: string, hardware: CameraHardware, options: CameraCodecOptions ): boolean {
    const probed = hardware.encodes?.[ codec ];
    const webkit = isWebKit( agent );
    // what the browser's WebRTC doesn't list, livekit-client sends as VP8 (Playwright's WebKit: VP9 by its probe, not by
    // its sender, TestCodecPolicyMatrix)
    if( codec !== 'vp8' && hardware.sendable && ! hardware.sendable.includes( codec ) ) return false;
    switch( codec ){
        case 'vp8':
            return true;
        case 'h264':
            return inHardware( 'h264', agent, hardware, options ) || probed !== false;
        case 'h265':
            return !! options.h265 && ( inHardware( 'h265', agent, hardware, options ) || probed === true );
        case 'vp9':
            // not from WebKit: livekit-client asks for it from 16 on, and Playwright's WebKit, listing VP9 among its
            // sender's codecs, still sent VP8 (TestCodecPolicyMatrix), at VP9's settings; an Apple device has H.264 and
            // H.265 in hardware for a policy to take instead
            return ! webkit && ( inHardware( 'vp9', agent, hardware, options ) || probed === true );
        case 'av1':
            return ! webkit && ( inHardware( 'av1', agent, hardware, options ) || probed === true );
    }
}

/**
 * The first codec of list this browser sends, as the list asks ("vp9" anyway, "h265:hw" only from hardware), and VP8
 * where none is: from Firefox and in an encrypted room always.
 */
function pickCodec( list: readonly string[], agent: string, hardware: CameraHardware, options: CameraCodecOptions ): CameraCodec {
    if( options.encrypted || FIREFOX.test( agent ) ) return 'vp8';
    for( const entry of list ){
        const [ name, condition ] = String( entry ).toLowerCase().trim().split( ':' );
        const codec = CAMERA_CODECS.find( ( c ) => c === name );
        if( ! codec ) continue;
        if( ! sends( codec, agent, hardware, options ) ) continue;
        if( condition === 'hw' && codec !== 'vp8' && ! inHardware( codec, agent, hardware, options ) ) continue;
        return codec;
    }
    return 'vp8';
}

/** The camera's codec on this device: its user agent, the codecs it encodes, the room, and the server's policy. */
export function cameraCodecFor( agent: string, hardware: CameraHardware, options: CameraCodecOptions = {} ): CameraCodec {
    const list = options.policy?.camera?.length ? options.policy.camera : DEFAULT_CAMERA_POLICY;
    return pickCodec( list, agent, hardware, options );
}

/** The screen's codec, as cameraCodecFor() the camera's (the server's policy's screen list; VP8 without one). */
export function screenCodecFor( agent: string, hardware: CameraHardware, options: CameraCodecOptions = {} ): CameraCodec {
    const list = options.policy?.screen?.length ? options.policy.screen : DEFAULT_SCREEN_POLICY;
    return pickCodec( list, agent, hardware, options );
}

/**
 * What probeCodecCaps() says this device encodes, for cameraCodecFor(), and what its WebRTC sends at all (`sendable`,
 * the browser's RTCRtpSender.getCapabilities, or the list given).
 */
export function hardwareFromCaps( caps: CameraCodecCaps | null, sendable: CameraCodec[] | null = webrtcSendable() ): CameraHardware {
    const enc = ( family: string ) => caps?.families[ family ]?.enc;
    const hw = ( family: string ) => !! ( enc( family )?.ok && enc( family )?.hw );
    const ok = ( family: string ) => {
        const e = enc( family );
        return e && typeof e.ok === 'boolean' ? e.ok : null;
    };
    return {
        h264: hw( 'video/H264' ), h265: hw( 'video/H265' ), vp9: hw( 'video/VP9' ), av1: hw( 'video/AV1' ),
        h264Baseline: caps?.h264Baseline ?? null,
        encodes: { h264: ok( 'video/H264' ), h265: ok( 'video/H265' ), vp9: ok( 'video/VP9' ), av1: ok( 'video/AV1' ) },
        sendable
    };
}

/** The video codecs this browser's WebRTC sends (RTCRtpSender.getCapabilities); null where it can't tell. */
function webrtcSendable(): CameraCodec[] | null {
    try {
        const sender = ( globalThis as { RTCRtpSender?: { getCapabilities?: ( kind: string ) => { codecs: { mimeType: string }[] } | null } } ).RTCRtpSender;
        const codecs = sender?.getCapabilities?.( 'video' )?.codecs;
        if( ! codecs ) return null;
        const names = codecs.map( ( c ) => c.mimeType.toLowerCase().replace( 'video/', '' ) );
        return CAMERA_CODECS.filter( ( c ) => names.includes( c ) );
    } catch {
        return null;
    }
}

/** cameraCodecFor() from probeCodecCaps()'s answer. */
export function roomCallCodec( caps: CameraCodecCaps | null, agent: string, options: CameraCodecOptions = {} ): CameraCodec {
    return cameraCodecFor( agent, hardwareFromCaps( caps ), options );
}

/** A camera's codec as a room sends it: the codec, whether this device encodes it in hardware, and what goes behind it. */
export interface CameraChoice {
    codec: CameraCodec;
    hardware: boolean;
    /** Behind any codec but VP8 (the server's policy's backup, VP8 by default); none in an encrypted room. */
    backup: 'vp8' | 'h264' | null;
}

/** roomCallCodec(), with what cameraPublish() and fitCameraTrack() need to know of it. */
export function roomCallChoice( caps: CameraCodecCaps | null, agent: string, options: CameraCodecOptions = {} ): CameraChoice {
    const hardware = hardwareFromCaps( caps );
    const codec = cameraCodecFor( agent, hardware, options );
    return { codec, hardware: inHardware( codec, agent, hardware, options ), backup: options.encrypted ? null : backupFor( codec, options.policy ) };
}

/** What goes behind codec: nothing behind VP8; H.264 where the policy asks for it and the codec isn't H.264; VP8. */
export function backupFor( codec: CameraCodec, policy?: CodecPolicy | null ): 'vp8' | 'h264' | null {
    if( codec === 'vp8' ) return null;
    return String( policy?.backup ?? '' ).toLowerCase() === 'h264' && codec !== 'h264' ? 'h264' : 'vp8';
}

/** One layer of a camera's simulcast: its size, bitrate and frame rate. */
export type CallLayer = { width: number, height: number, bitrate: number, fps: number };

export interface CameraPublish {
    codec: CameraCodec;
    top: { maxBitrate: number, maxFramerate: number };
    /** The two lower layers, smallest first: the simulcast's, and under VP9 or AV1 the backup's. */
    layers: CallLayer[];
    /**
     * VP9 and AV1: one stream of three spatial layers, each twice the one below as the simulcast's are, and three
     * temporal ones (livekit-client's default for them), which the media server forwards a layer of per viewer.
     */
    scalabilityMode?: 'L3T3_KEY';
    /** Behind any codec but VP8, at its own bitrate, for a viewer that decodes none of it. */
    backup: { maxBitrate: number, maxFramerate: number } | null;
    /** Which codec that is (CameraChoice.backup); null with no backup. */
    backupCodec: 'vp8' | 'h264' | null;
}

/**
 * A group call's camera in three pictures by the height it's captured at, each at 30 frames (the library's own lower
 * ones run at 20, which a tile shows as stutter).
 *
 * From 1080 lines: 270p at 400 kbit/s, 540p at 1.2 Mbit/s and the full size, each twice the one below, as Chrome and
 * mediasoup space them. A tile takes the smallest layer at least 0.9 of its height in device
 * pixels (the media server's pick), and a grid's tiles are mostly 270 to 540 of them: with 180p and 360p under 1080p,
 * every tile taller than 360 took the full size, so a viewer of a four-person call on a laptop downloaded 10.5 Mbit/s
 * where 540p carries the same tiles in 3. Over the grid's layouts (realtime-ui's group-video-grid) and common windows,
 * a viewer of three to sixteen people downloads about half, a phone about the same.
 *
 * From 720 lines: 180p at 200 kbit/s and 360p at 600 kbit/s under the full size, also twice apart. Below 720 lines
 * the library's own stand.
 *
 * H.264 and H.265 in hardware carry the full size on fewer bits; VP8 keeps its 4 and 2 Mbit/s, and goes behind
 * either at those. VP9 and AV1 go as one SVC stream (scalabilityMode), at about 70% and 60% of VP8's.
 *
 * backupCodec: what goes behind it (CameraChoice.backup); VP8 when not given, and nothing behind VP8.
 */
export function cameraPublish( codec: CameraCodec, height: number, backupCodec?: 'vp8' | 'h264' | null ): CameraPublish | null {
    if( height < 720 ) return null;

    const full = height >= 1080;
    const tops: Record<CameraCodec, { maxBitrate: number, maxFramerate: number }> = {
        h265: { maxBitrate: full ? H265_TOP_1080 : H265_TOP_720, maxFramerate: 30 },
        h264: { maxBitrate: full ? 3_500_000 : 1_800_000, maxFramerate: 30 },
        vp8: { maxBitrate: full ? 4_000_000 : 2_000_000, maxFramerate: 30 },
        vp9: { maxBitrate: full ? 2_800_000 : 1_400_000, maxFramerate: 30 },
        av1: { maxBitrate: full ? 2_400_000 : 1_200_000, maxFramerate: 30 }
    };
    const behind = codec === 'vp8' ? null : backupCodec === undefined ? 'vp8' : backupCodec === 'h264' && codec === 'h264' ? 'vp8' : backupCodec;

    return {
        codec,
        top: tops[ codec ],
        layers: full ? [
            { width: 480, height: 270, bitrate: 400_000, fps: 30 },
            { width: 960, height: 540, bitrate: 1_200_000, fps: 30 }
        ] : [
            { width: 320, height: 180, bitrate: 200_000, fps: 30 },
            { width: 640, height: 360, bitrate: 600_000, fps: 30 }
        ],
        ...( codec === 'vp9' || codec === 'av1' ? { scalabilityMode: 'L3T3_KEY' as const } : {} ),
        backup: behind ? tops[ behind ] : null,
        backupCodec: behind
    };
}

/**
 * The tallest picture a camera goes out at in a room, by its codec. VP8 is encoded in software on every computer, and
 * three layers from 1080 lines (1080p, 540p and 270p, 2.7 million pixels a frame) is more than a weaker laptop keeps up
 * with: its encoder, held back by the CPU, drops frames and changes size over and over, and every viewer sees its
 * picture freeze several times in half a minute while the connections carry it without a loss. From 720 lines (720p,
 * 360p and 180p) it is 1.2 million, under half, and its 2 Mbit/s fit an upload the full size's 5.6 don't. A grid's
 * tiles mostly ask for 540 lines or fewer; a large one gets 720p. H.264 and H.265 come out of hardware, at 1080.
 *
 * hardware: whether this device encodes it in hardware (CameraChoice.hardware); not given, H.264 and H.265 are taken
 * to be, VP8, VP9 and AV1 not. Any codec in software goes out from 720 lines: VP9 and AV1 cost a CPU more than VP8.
 */
export function cameraMaxHeight( codec: CameraCodec, hardware?: boolean ): number {
    return ( hardware ?? ( codec === 'h264' || codec === 'h265' ) ) ? 1080 : 720;
}

/**
 * Brings a camera down to cameraMaxHeight() for its codec before it is published, and answers the height it has then,
 * which is what cameraPublish() takes. The browser scales what the camera gives, keeping its shape and the rest of what
 * it was asked for (the device, the frame rate), and the preview shows the same picture. Best effort: a camera that
 * can't be scaled, or doesn't answer within two seconds, goes out at the size it has, with that size's layers.
 *
 * And a camera opened in a mode of fewer than CAMERA_MIN_FPS frames is tried at smaller sizes (fasterCameraMode).
 */
export async function fitCameraTrack( track: MediaStreamTrack, codec: CameraCodec, hardware?: boolean ): Promise<number> {
    const { width, height } = cameraSize( track );
    const max = cameraMaxHeight( codec, hardware );
    if( height > max ){
        let constraints: MediaTrackConstraints | undefined;
        try {
            constraints = { ...track.getConstraints(), height: { ideal: max } };
            if( width ) constraints.width = { ideal: evenOf( width * max / height ) };
            else delete constraints.width;
        } catch {
            // a track that can't say what it was asked: it stays as it is
        }
        if( constraints ) await applyWithin( track, constraints );
    }
    await fasterCameraMode( track );
    return cameraSize( track ).height;
}

const FIT_TIMEOUT_MS = 2000;

/** The nearest even number: a picture of an odd width or height Chrome encodes in software (fasterCameraMode). */
const evenOf = ( n: number ) => 2 * Math.round( n / 2 );

const cameraSize = ( track: MediaStreamTrack ) => {
    try {
        const { width = 0, height = 0 } = track.getSettings();
        return { width, height };
    } catch {
        return { width: 0, height: 0 };
    }
};

/** Asks the camera for constraints, within FIT_TIMEOUT_MS; one it can't take, or that takes longer, changes nothing. */
async function applyWithin( track: MediaStreamTrack, constraints: MediaTrackConstraints ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race( [
            track.applyConstraints( constraints ),
            new Promise<void>( ( resolve ) => { timer = setTimeout( resolve, FIT_TIMEOUT_MS ); } )
        ] );
    } catch {
        // the camera stays as it is
    } finally {
        clearTimeout( timer );
    }
}

/**
 * The fewest frames a second a camera's mode may give in a call before smaller sizes are tried, and those sizes, the
 * largest first, at most CAMERA_FASTER_TRIES of them. Many cameras give 1080p at 15 frames and 720p at 30, and asked
 * for 1080p at 30, Chrome opens the 1080p mode, the size counting for more than the frames (2026-10-19: a call where
 * many cameras gave few frames a second): a jerky picture where a smooth 720p was there.
 */
export const CAMERA_MIN_FPS = 24;
const CAMERA_FASTER_HEIGHTS = [ 720, 540, 480 ];
const CAMERA_FASTER_TRIES = 2;

/**
 * A camera opened in a mode of fewer than CAMERA_MIN_FPS frames (its settings' frameRate, the mode's, not what a dim
 * room leaves of it) is asked for smaller sizes at 30 frames, and kept at the first whose mode gives CAMERA_MIN_FPS or
 * more; none does, it goes back to what it was asked before. A browser that says no frame rate is left as it is.
 */
export async function fasterCameraMode( track: MediaStreamTrack ): Promise<void> {
    const rate = () => {
        try {
            return track.getSettings().frameRate ?? 0;
        } catch {
            return 0;
        }
    };
    const fps = rate();
    if( ! fps || fps >= CAMERA_MIN_FPS ) return;
    const { width, height } = cameraSize( track );
    if( ! height ) return;
    let before: MediaTrackConstraints;
    try {
        before = track.getConstraints();
    } catch {
        return;
    }
    const tries = CAMERA_FASTER_HEIGHTS.filter( ( h ) => h < height ).slice( 0, CAMERA_FASTER_TRIES );
    if( ! tries.length ) return;
    // The shape asked for (16:9 from a product's 1920×1080), where the camera faces the same way, so its layers come
    // out at the ladder's own sizes (640×360, 320×180). Chrome encodes H.264 in hardware only from 360 lines and in
    // even sizes (measured on a Mac, 2026-10-19: 358×360 and 450×360 in VideoToolbox, 641×360, 640×358 and 465×372 in
    // OpenH264): a 5:4 webcam opened at 1280×1024 and 8 frames sent its 372p layer at 465 wide, in software, few
    // frames and software encoding on its lower layers; asked for 1280×720 at 30, its 360p is 640 wide. A phone held
    // upright keeps its own shape.
    const ideal = ( c: ConstrainULong | undefined ) => typeof c === 'number' ? c : c?.ideal ?? c?.exact;
    const askedW = ideal( before.width ), askedH = ideal( before.height );
    const asked = askedW && askedH ? askedW / askedH : 0;
    const aspect = asked && ( asked >= 1 ) === ( width >= height ) ? asked : width && height ? width / height : 0;
    for( const h of tries ){
        const constraints: MediaTrackConstraints = { ...before, height: { ideal: h }, frameRate: { ideal: 30 } };
        if( aspect ) constraints.width = { ideal: evenOf( h * aspect ) };
        else delete constraints.width;
        await applyWithin( track, constraints );
        if( rate() >= CAMERA_MIN_FPS ) return;
    }
    await applyWithin( track, before );
}

// H.265's full size: the picture H.264 gives at its own, on about 70% of the bits. A Mac's VideoToolbox, as Chrome
// encodes a call's camera, against Xiph's KristenAndSara at 720p and 30 frames (VMAF, 2026-10-14): H.264 94.2 at
// 1752 kbit/s and H.265 94.1 at 1259; H.264 88.5 at 841, H.265 89.5 at 631. The lower layers keep their bitrates:
// the VP8 behind H.265 takes the same ones (livekit-client's backup encodings), and needs them.
const H265_TOP_1080 = 2_500_000;
const H265_TOP_720 = 1_300_000;

/** A shared screen in a group call: up to 10 Mbit/s at 30 frames, the library's own is 1080p at 15 and 2.5. */
export const SCREEN_ENCODING = { maxBitrate: 10_000_000, maxFramerate: 30, priority: 'medium' as const };

/**
 * A shared screen's track is marked motion, and its sender keeps its resolution when it must give: smooth wherever the
 * upload and the CPU allow, and sharp where they don't. Marked detail, as it was, Chrome encodes it in its
 * screen-content mode, which spends few bits and drops frames for them: a 1440p screen of moving pictures in H.264 from
 * VideoToolbox went out at 10 frames a second on 3.9 of the 10 Mbit/s it may take, at an average quantizer of 43;
 * marked motion, 24-26 frames at 42, and text as sharp as before (16 in H.264, 2 in VP8 where detail gave 15), on more
 * bits (the mesh lab's TestScreenShareBusyMatrix, 2026-10-18; a Windows PC's share in H.264 from its AMD encoder went
 * out at 15 frames or fewer): smooth without losing details.
 */
export const SCREEN_CONTENT_HINT = 'motion';
export const SCREEN_DEGRADATION = 'maintain-resolution' as const;

export interface ScreenPublish {
    codec: CameraCodec;
    /** Half the screen's size at 15 frames, for a viewer that can't take it whole: in H.264 and H.265 only. */
    layer: CallLayer | null;
    /** Whether it goes out in two pictures (the layer's); false is to be passed too, or livekit-client adds a second. */
    simulcast: boolean;
}

/**
 * A screen in H.264 or H.265 from 1280 by 640 goes out in two pictures: the whole one for everyone who can take it, and
 * one half its size at 15 frames for a connection that can't (Opera behind a VPN froze on a 2560×1428 share it could
 * only take whole), which the media server picks per viewer.
 *
 * In VP8 it goes out whole only, one picture (simulcast false; livekit-client adds a second of its own otherwise): Chrome
 * encodes a screen in VP8 simulcast in its screen-share mode, which held a 2560×1440 document scrolling to 5 frames a
 * second at an average quantizer of 98, the viewer shown the half one at 15, while the same screen whole went out at 28
 * frames and 20 (TestScreenShareQualityMatrix, 2026-10-18; a Windows PC's share, its CPU and upload idle, "not smooth,
 * framerate seems to be bad"). In VP9 or AV1 the library publishes a share as one spatial layer (L1T3), since Chrome
 * drops an SVC share with more to its smallest picture. Smaller screens go out whole.
 */
export function screenPublish( width: number, height: number, codec: CameraCodec = 'vp8' ): ScreenPublish {
    if( ( codec !== 'h264' && codec !== 'h265' ) || width < 1280 || height < 640 ) return { codec, layer: null, simulcast: false };

    return { codec, layer: { width: Math.round( width / 2 ), height: Math.round( height / 2 ), bitrate: 1_500_000, fps: 15 }, simulcast: true };
}

/**
 * The pixel density a receiver asks layers by (adaptive stream): the screen's, at most 1.5. At 2 or 3 (a Retina
 * screen, a phone) a tile asked for twice its size or more, the larger layer for every tile in a grid.
 */
export function roomPixelDensity( devicePixelRatio: number | undefined ): number {
    return Math.min( 1.5, Math.max( 1, Number( devicePixelRatio ) || 1 ) );
}
