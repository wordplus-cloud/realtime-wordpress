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
    /**
     * The node's switches, each on only when the node says true, as every WordPlus Mesh from 1.0.53
     * does unless its configuration turns it off: `check` true measures a call's camera before it goes out, on a machine
     * a camera rule names (`rules`; camera-check.ts); `adapt` true, with `check`, moves it to another codec during a
     * call, on any machine (camera-adapt.ts). Missing
     * or false, as from an older mesh, a self-hosted box or stock LiveKit, where no server could turn them off: the
     * camera exactly as before the check (legacyCamera()).
     */
    check?: boolean;
    adapt?: boolean;
    /**
     * Which camera order a browser takes, by its system, browser, graphics maker and kind of device (camera-tune.ts,
     * CameraRule): the first that matches decides, ahead of `camera`. And where the check runs: only a machine a rule
     * names is measured before its camera goes out, every other starts as today. Missing: DEFAULT_CAMERA_RULES (Windows
     * and Linux); an empty list: none, so no machine is checked; a rule of the node's own
     * (`{ os: 'mac', camera: [...] }`) adds those machines.
     */
    rules?: CameraRule[];
    /** The check's, the watch's, the moves' and the records' numbers (camera-tune.ts, CameraTune), each optional. */
    tune?: Partial<CameraTune>;
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
    /**
     * Codecs not to send from this device, whatever the policy says: those whose hardware encoder was seen here dropping
     * most of the camera's frames (encoder-watch.ts, camera-check.ts), and those its CPU couldn't encode in software
     * (camera-check.ts). Missing: what this browser remembers (droppedCameraCodecs(), heavySoftwareCodecs()); for a
     * camera on the old rules (legacyCamera()), the list older releases kept alone (droppedHardwareCodecs()).
     */
    avoid?: readonly CameraCodec[];
    /**
     * A call's camera (Better Messages'), measured before it goes out (camera-check.ts): on the mesh its built-in list
     * tries VP9 before VP8, the policy's rules apply (by default Windows and Linux put VP9 first),
     * and what the checks found is read. Missing, or where the node turned the check off: the old rules exactly
     * (legacyCamera()), as a live stream's camera, the SDK's group calls and every camera off the mesh keep them.
     */
    call?: boolean;
    /** The graphics adapter's name, for a rule naming a maker (camera-tune.ts, gpuMaker()); missing: what the page read. */
    gpu?: string | null;
}

// The camera check's and the in-call adapter's numbers and rules, as the node sends them in its codec policy, so the
// server can reconfigure them without a client update should they work badly: rtc-client's Room.meshCodecPolicy, with
// the join, so a change reaches a browser at its next join and a call keeps what it joined with. Here, in the module
// that imports nothing, since encoder-watch.ts and Easy Stream's build read it too.
// - `rules`: which camera order a browser takes, by its system, browser, graphics maker and kind of device: the first
//   rule whose given fields all match decides; none matching, the policy's `camera` list, else the built-in one. A policy
//   without the key at all has DEFAULT_CAMERA_RULES (Windows desktop Chrome and Edge, VP9 first); an empty list none.
// - `tune`: every number of the check (camera-check.ts), the watch (encoder-watch.ts), the moves (camera-adapt.ts) and
//   the records (below), each optional, CAMERA_TUNE_DEFAULTS where missing, each held to CAMERA_TUNE_RANGES so a bad
//   value can't break a call.

/** The numbers, as cameraTune() gives them. */
export interface CameraTune {
    /** the whole check's budget, ms */
    checkMs: number;
    /** a check's pass: the least share of the camera's frames sent */
    passSent: number;
    /** a check's pass: the most share of the test the CPU held the encoder back */
    passCpu: number;
    /** a check's pass: the most encode time a frame, as a share of the frame interval */
    passEncode: number;
    /** how long a hardware encoder must drop frames in a call before it counts, s */
    dropWatchS: number;
    /** how long VP9 or AV1 must be held back by the CPU (or under CPU pressure) in a call before it counts, s */
    cpuWatchS: number;
    /** the share of that time held back by the CPU that counts */
    cpuShare: number;
    /** camera moves a call at most; 0 never moves */
    switchesMax: number;
    /** the least time between two moves, s */
    switchGapS: number;
    /** no move in a camera's first this long, s */
    warmupS: number;
    /** the longest a tile says "Optimizing video quality...", s */
    failsafeS: number;
    /** how long a moved camera's new publication may take before it goes out in its old codec again, s */
    republishTimeoutS: number;
    /** how long a remembered pass holds, days */
    rememberPassDays: number;
    /** how long a remembered hardware drop holds, days */
    rememberDropsDays: number;
    /** how long a codec remembered too heavy for the CPU holds, days */
    rememberCpuDays: number;
    /** results remembered before this (ms since the epoch) are ignored, so every browser measures again; 0 none */
    forgetBefore: number;
}

/** The numbers where the policy gives none. */
export const CAMERA_TUNE_DEFAULTS: Readonly<CameraTune> = Object.freeze( {
    // room for two codecs measured: VP9 and then the hardware H.264 on Windows, 1.9 s each at most
    checkMs: 4000,
    passSent: 0.8,
    passCpu: 0.5,
    passEncode: 0.6,
    dropWatchS: 30,
    cpuWatchS: 20,
    cpuShare: 0.5,
    switchesMax: 2,
    switchGapS: 120,
    warmupS: 30,
    failsafeS: 10,
    republishTimeoutS: 8,
    rememberPassDays: 30,
    rememberDropsDays: 30,
    rememberCpuDays: 7,
    forgetBefore: 0
} );

/**
 * The least and most each number may be, one outside held to the nearer end: the node's own ranges exactly (WordPlus
 * Mesh's pkg/rtc/codecpolicy.go, CodecTuneRange), so a browser takes what the node would take.
 */
export const CAMERA_TUNE_RANGES: Readonly<Record<keyof CameraTune, readonly [ number, number ]>> = Object.freeze( {
    checkMs: [ 2000, 5000 ],
    passSent: [ 0.3, 1 ],
    passCpu: [ 0, 1 ],
    passEncode: [ 0.1, 1 ],
    dropWatchS: [ 10, 120 ],
    cpuWatchS: [ 10, 120 ],
    cpuShare: [ 0.1, 1 ],
    switchesMax: [ 0, 3 ],
    switchGapS: [ 30, 1800 ],
    warmupS: [ 10, 300 ],
    failsafeS: [ 3, 30 ],
    republishTimeoutS: [ 3, 30 ],
    rememberPassDays: [ 0, 90 ],
    rememberDropsDays: [ 0, 90 ],
    rememberCpuDays: [ 0, 90 ],
    forgetBefore: [ 0, 2 ** 52 ]
} as Record<keyof CameraTune, readonly [ number, number ]> );

/**
 * The numbers for policy: its `tune`'s, each a finite number held to CAMERA_TUNE_RANGES (switchesMax a whole one), the
 * defaults for the rest. `forgetBefore` later than now is taken as none: a clock ahead would have every browser measure
 * at every join.
 */
export function cameraTune( policy?: CodecPolicy | null, now: number = Date.now() ): CameraTune {
    const given = ( policy?.tune && typeof policy.tune === 'object' ? policy.tune : {} ) as Record<string, unknown>;
    const out: CameraTune = { ...CAMERA_TUNE_DEFAULTS };
    for( const key of Object.keys( CAMERA_TUNE_DEFAULTS ) as ( keyof CameraTune )[] ){
        const value = given[ key ];
        if( typeof value !== 'number' || ! Number.isFinite( value ) ) continue;
        const [ min, max ] = CAMERA_TUNE_RANGES[ key ];
        const held = Math.min( max, Math.max( min, value ) );
        out[ key ] = key === 'switchesMax' ? Math.round( held ) : held;
    }
    if( out.forgetBefore > now ) out.forgetBefore = 0;
    return out;
}

const DAY_MS = 24 * 3600 * 1000;

/** The kinds of system, browser, graphics maker and device a rule names. */
export type CameraOs = 'windows' | 'mac' | 'linux' | 'android' | 'ios';
export type CameraBrowser = 'chrome' | 'edge' | 'opera' | 'firefox' | 'safari';
export type CameraGpu = 'amd' | 'intel' | 'nvidia' | 'apple' | 'qualcomm' | 'arm' | 'other' | 'unknown';
export type CameraDevice = 'desktop' | 'phone' | 'tablet';

/** One rule: the browsers it is for (every field given must match) and their camera order, as the policy's `camera`. */
export interface CameraRule {
    os?: CameraOs;
    browser?: CameraBrowser;
    gpu?: CameraGpu;
    device?: CameraDevice;
    camera: string[];
}

/**
 * The rules where the policy has no `rules` key: Windows and Linux (ChromeOS too, cameraEnvironment()), every browser
 * and kind of device, put VP9 first, ahead of a hardware H.264 that may drop frames there (Chrome trusts no Windows
 * encoder's rate control for H.264). These are also the only machines the camera check measures by default
 * (camera-check.ts). A Mac, an iPhone or iPad and Android are named by none: their hardware H.264 goes out first,
 * unmeasured. A week of calls to 2026-10-24 (production traces, viewers' freezes by sender): hardware H.264 frozen
 * 2.1% of the time watched from Windows, 13% of its 91 senders 5% or more, 3.7% from Linux and ChromeOS, 1.5% from a Mac
 * and from iOS, 0.7% from an Android browser, none of its 19 senders 5% or more. So Android stays on hardware H.264
 * first, like a Mac and iOS, in browsers and the app; VP9 goes first only on Windows, Linux and the rest.
 * Firefox sends VP8 wherever it is (codecsOf()).
 */
export const DEFAULT_CAMERA_RULES: readonly CameraRule[] = Object.freeze( [
    { os: 'windows', camera: [ 'vp9', 'h264:hw', 'vp8' ] },
    { os: 'linux', camera: [ 'vp9', 'h264:hw', 'vp8' ] }
] as CameraRule[] );

/** The rules policy gives: its `rules` (none where the key holds anything but a list), else DEFAULT_CAMERA_RULES. */
export function cameraRules( policy?: CodecPolicy | null ): readonly CameraRule[] {
    if( ! policy || ! Object.prototype.hasOwnProperty.call( policy, 'rules' ) ) return DEFAULT_CAMERA_RULES;
    return Array.isArray( policy.rules ) ? policy.rules : [];
}

/** What a rule is matched against: this browser's system, browser, kind of device and graphics maker. */
export interface CameraEnvironment {
    os: CameraOs | null;
    browser: CameraBrowser | null;
    device: CameraDevice;
    gpu: CameraGpu;
}

/**
 * The graphics maker, from WebGPU's adapter info ("amd rdna-3", "nvidia ampere"), by the words the controller reads it
 * by; "unknown" where the page can't tell.
 */
export function gpuMaker( adapter?: string | null ): CameraGpu {
    const name = String( adapter ?? '' ).toLowerCase().trim();
    if( ! name ) return 'unknown';
    if( /\bamd\b|radeon|\bati\b/.test( name ) ) return 'amd';
    if( /nvidia|geforce|quadro/.test( name ) ) return 'nvidia';
    if( /intel/.test( name ) ) return 'intel';
    if( /apple/.test( name ) ) return 'apple';
    if( /qualcomm|adreno/.test( name ) ) return 'qualcomm';
    if( /\bmali\b|\barm\b/.test( name ) ) return 'arm';
    return 'other';
}

/** This browser, from its user agent and its graphics adapter's name (gpuMaker()). */
export function cameraEnvironment( agent: string, adapter?: string | null ): CameraEnvironment {
    const a = String( agent ?? '' );
    const android = /android/i.test( a );
    const os: CameraOs | null = /iphone|ipad|ipod/i.test( a ) ? 'ios'
        : android ? 'android'
        : /windows nt/i.test( a ) ? 'windows'
        : /macintosh|mac os x/i.test( a ) ? 'mac'
        : /linux|cros|x11/i.test( a ) ? 'linux'
        : null;
    const browser: CameraBrowser | null = /edg(e|a|ios)?\//i.test( a ) ? 'edge'
        : /opr\/|opera/i.test( a ) ? 'opera'
        : /firefox\/|fxios\//i.test( a ) ? 'firefox'
        : /chrome\/|crios\/|chromium\//i.test( a ) ? 'chrome'
        : /safari\//i.test( a ) ? 'safari'
        : null;
    const device: CameraDevice = /ipad|tablet/i.test( a ) || ( android && ! /mobile/i.test( a ) ) ? 'tablet'
        : /iphone|ipod|mobile/i.test( a ) ? 'phone'
        : 'desktop';
    return { os, browser, device, gpu: gpuMaker( adapter ) };
}

/** The first of rules whose given fields all match env and that names a camera order; null where none does. */
export function cameraRuleFor( rules: readonly CameraRule[], env: CameraEnvironment ): CameraRule | null {
    for( const rule of rules ){
        if( ! rule || typeof rule !== 'object' || ! Array.isArray( rule.camera ) || ! rule.camera.length ) continue;
        if( rule.os !== undefined && rule.os !== env.os ) continue;
        if( rule.browser !== undefined && rule.browser !== env.browser ) continue;
        if( rule.device !== undefined && rule.device !== env.device ) continue;
        if( rule.gpu !== undefined && rule.gpu !== env.gpu ) continue;
        return rule;
    }
    return null;
}

// The graphics adapter's name once camera-check.ts's graphicsAdapter() has read it, for rules read without waiting (a
// camera started without its check): undefined until then.
let adapterName: string | null | undefined;

/** Keeps the graphics adapter's name the page read (camera-check.ts, graphicsAdapter()). */
export function rememberAdapter( name: string | null | undefined ): void {
    adapterName = name ?? null;
}

/** The graphics adapter's name the page read; undefined while nothing asked (a record names it only then). */
export function knownAdapter(): string | null | undefined {
    return adapterName;
}

/** Whether any of rules names a graphics maker: a check waits for the adapter's name only then. */
export function rulesNeedGpu( rules: readonly CameraRule[] ): boolean {
    return rules.some( ( r ) => !! r && typeof r === 'object' && r.gpu !== undefined );
}

/**
 * Where a browser remembers the codecs whose hardware encoder dropped frames on it (encoder-watch.ts tells why), and
 * how long: a driver update may mend it, so after a month the hardware is tried again.
 */
export const HARDWARE_DROPS_KEY = 'wordplus-rtc:hardware-drops';
export const HARDWARE_DROPS_FOR_MS = 30 * 24 * 3600 * 1000;

/**
 * Where a browser remembers what it found of each camera codec, one record a codec (CameraCodecRecord): a camera check's
 * measurement (camera-check.ts) and what a call caught (encoder-watch.ts). Every measurement is remembered per
 * browser, each kept as long as CAMERA_CODEC_KEEP_MS says, and measured again once the browser's
 * major version changes.
 */
export const CAMERA_CODECS_KEY = 'wordplus-rtc:camera-codecs';

/**
 * What became of a codec here: `pass` it encoded the camera well; `drops` its hardware encoder took the camera's frames
 * off (or the browser fell back to software for it); `cpu` the CPU couldn't encode it in software (held back by the CPU,
 * frames too slow or dropped); `unsure` a check couldn't tell (few frames, an encoder the browser doesn't name, no time),
 * so a day of cameras turned on goes out as today without the check's wait.
 */
export type CameraCodecResult = 'pass' | 'drops' | 'cpu' | 'unsure';

/** One codec's record: the result, the numbers it was found by (null where a call caught it), when, and on what. */
export interface CameraCodecRecord {
    result: CameraCodecResult;
    /** ms its encoder took a frame */
    msPerFrame: number | null;
    /** the share of the camera's frames it sent */
    sentShare: number | null;
    /** the share of the time the browser said the CPU held it back */
    cpuShare: number | null;
    /** when (ms since the epoch) */
    at: number;
    /** the browser and its major version (browserVersion()): "chrome155", "edg155" */
    browserMajor: string;
    /** the graphics adapter, where the browser said ("amd rdna-3", "intel xe") */
    gpu?: string;
    /**
     * The camera's lines it was found at, for a codec in software (1.0.41; vp9Height()): a `pass` holds up to them, a
     * `cpu` above CAMERA_STEP_DOWN_HEIGHT leaves the codec at that height, one at it or under rules the codec out.
     * Missing (1.0.40, which measured software at 720 lines): 720.
     */
    height?: number;
}

/**
 * How long each result holds: a pass a month (a check isn't run again), a hardware encoder's drops a month (a driver
 * update may mend it), a codec too heavy for the CPU a week (the machine may only have been busy then), a check that
 * couldn't tell a day.
 */
export const CAMERA_CODEC_KEEP_MS: Record<CameraCodecResult, number> = {
    pass: HARDWARE_DROPS_FOR_MS,
    drops: HARDWARE_DROPS_FOR_MS,
    cpu: 7 * 24 * 3600 * 1000,
    unsure: 24 * 3600 * 1000
};

const userAgent = () => typeof navigator !== 'undefined' ? navigator.userAgent : '';

/** Every codec's record this browser holds, whatever its age or version; none where storage can't tell. */
export function cameraCodecRecords(): Partial<Record<CameraCodec, CameraCodecRecord>> {
    try {
        const read = JSON.parse( globalThis.localStorage?.getItem( CAMERA_CODECS_KEY ) ?? '{}' );
        return read && typeof read === 'object' ? read as Partial<Record<CameraCodec, CameraCodecRecord>> : {};
    } catch {
        return {};
    }
}

/** How long each result holds by tune (the policy's rememberPassDays, rememberDropsDays, rememberCpuDays; `unsure` a day). */
const keepOf = ( tune: CameraTune ): Record<CameraCodecResult, number> => ( {
    pass: tune.rememberPassDays * DAY_MS,
    drops: tune.rememberDropsDays * DAY_MS,
    cpu: tune.rememberCpuDays * DAY_MS,
    unsure: CAMERA_CODEC_KEEP_MS.unsure
} );

/**
 * Codec's record while it holds: of this browser's major version, within its result's CAMERA_CODEC_KEEP_MS (or what the
 * policy's tune says), and not from before its forgetBefore; null otherwise, which is measured again.
 */
export function cameraCodecRecord( codec: CameraCodec, agent: string = userAgent(), now: number = Date.now(), tune?: CameraTune ): CameraCodecRecord | null {
    const record = cameraCodecRecords()[ codec ];
    if( ! record || typeof record !== 'object' || typeof record.at !== 'number' ) return null;
    const keep = ( tune ? keepOf( tune ) : CAMERA_CODEC_KEEP_MS )[ record.result ];
    if( keep === undefined || now - record.at < 0 || now - record.at >= keep ) return null;
    if( tune && record.at < tune.forgetBefore ) return null;
    if( record.browserMajor !== browserVersion( agent ) ) return null;
    return record;
}

/** Writes codec's record, replacing what was there (a codec that passed and then failed in a call is failed at once); best effort. */
export function rememberCameraCodec( codec: CameraCodec, record: Omit<CameraCodecRecord, 'at' | 'browserMajor'> & Partial<Pick<CameraCodecRecord, 'at' | 'browserMajor'>>,
    agent: string = userAgent() ): void {
    try {
        const storage = globalThis.localStorage;
        if( ! storage ) return;
        const records = cameraCodecRecords();
        records[ codec ] = { ...record, at: record.at ?? Date.now(), browserMajor: record.browserMajor ?? browserVersion( agent ) };
        storage.setItem( CAMERA_CODECS_KEY, JSON.stringify( records ) );
    } catch {}
}

// The list older releases kept (HARDWARE_DROPS_KEY): when each codec was seen dropping, within keep, none from before
// forgetBefore.
function droppedTimes( now: number, keep: number, forgetBefore: number ): Partial<Record<CameraCodec, number>> {
    const times: Partial<Record<CameraCodec, number>> = {};
    try {
        const seen = JSON.parse( globalThis.localStorage?.getItem( HARDWARE_DROPS_KEY ) ?? '{}' ) as Record<string, unknown> | null;
        for( const c of CAMERA_CODECS ){
            const at = seen?.[ c ];
            if( c !== 'vp8' && typeof at === 'number' && now - at >= 0 && now - at < keep && at >= forgetBefore ) times[ c ] = at;
        }
    } catch {}
    return times;
}

function droppedList( now: number, keep: number, forgetBefore: number ): CameraCodec[] {
    return Object.keys( droppedTimes( now, keep, forgetBefore ) ) as CameraCodec[];
}

/**
 * What this browser found of codec last, and when: its record, or the dropped frames the list older releases kept
 * (HARDWARE_DROPS_KEY), whichever is newer, each while it holds by the policy's tune; null where neither does. A pass a
 * check found before a call saw the hardware drop frames is outweighed by that, as a pass found since outweighs it.
 */
export function cameraFinding( codec: CameraCodec, agent: string = userAgent(), now: number = Date.now(), tune: CameraTune = CAMERA_TUNE_DEFAULTS ): { result: CameraCodecResult, at: number, height?: number } | null {
    const record = cameraCodecRecord( codec, agent, now, tune );
    const dropped = droppedTimes( now, tune.rememberDropsDays * DAY_MS, tune.forgetBefore )[ codec ];
    if( dropped !== undefined && ( ! record || dropped > record.at ) ) return { result: 'drops', at: dropped };
    return record ? { result: record.result, at: record.at, ...( typeof record.height === 'number' ? { height: record.height } : {} ) } : null;
}

/** The camera lines software VP9 tries first, measured (camera-check.ts): 1080p first. */
export const VP9_TOP_HEIGHT = 1080;
/**
 * The lines a camera in software VP9 goes out at where its CPU can't carry VP9_TOP_HEIGHT: what the check takes it
 * to (fitsLower()), and what a call steps it down to without leaving the room (camera-adapt.ts, stepDownCamera()).
 */
export const CAMERA_STEP_DOWN_HEIGHT = 720;

// A finding's height: 1.0.40 measured every codec in software at 720 lines and said none.
const heightOf = ( finding: { height?: number } | null | undefined ) => finding?.height ?? CAMERA_STEP_DOWN_HEIGHT;

/**
 * Whether what this browser found of a codec in software leaves it out: too heavy for the CPU at
 * CAMERA_STEP_DOWN_HEIGHT or under. One too heavy above it goes out at CAMERA_STEP_DOWN_HEIGHT instead (vp9Height()).
 */
const tooHeavy = ( finding: { result: CameraCodecResult, height?: number } | null | undefined ) =>
    finding?.result === 'cpu' && heightOf( finding ) <= CAMERA_STEP_DOWN_HEIGHT;

/**
 * The lines a checked call camera in software VP9 goes out at, by what this browser found of VP9 (1.0.41): a pass, the
 * height it passed at (VP9_TOP_HEIGHT at most); too heavy for the CPU above CAMERA_STEP_DOWN_HEIGHT, that; nothing
 * found, or anything else, CAMERA_STEP_DOWN_HEIGHT: VP9 goes out above it only once measured there.
 */
export function vp9Height( agent: string = userAgent(), now: number = Date.now(), tune: CameraTune = CAMERA_TUNE_DEFAULTS ): number {
    const found = cameraFinding( 'vp9', agent, now, tune );
    if( found?.result === 'pass' ) return Math.min( VP9_TOP_HEIGHT, Math.max( CAMERA_STEP_DOWN_HEIGHT, heightOf( found ) ) );
    return CAMERA_STEP_DOWN_HEIGHT;
}

/**
 * The codecs this browser saw its hardware encoder drop frames of during a call (encoder-watch.ts), as releases before
 * the camera check kept them (HARDWARE_DROPS_KEY, HARDWARE_DROPS_FOR_MS): what the old rules avoid, and what the probe
 * leaves out of a direct call's abilities (codecs.ts). A camera check's verdicts are never in it.
 */
export function droppedHardwareCodecs( now: number = Date.now() ): CameraCodec[] {
    return droppedList( now, HARDWARE_DROPS_FOR_MS, 0 );
}

/**
 * What a checked call camera avoids for dropped frames: the codecs whose newest finding (cameraFinding()) is dropped
 * frames, a record's or the list a call kept, each as long as the policy's tune keeps it; none where it can't tell.
 */
export function droppedCameraCodecs( now: number = Date.now(), agent: string = userAgent(), tune: CameraTune = CAMERA_TUNE_DEFAULTS ): CameraCodec[] {
    return CAMERA_CODECS.filter( ( c ) => c !== 'vp8' && cameraFinding( c, agent, now, tune )?.result === 'drops' );
}

/**
 * Remembers that this browser's hardware encoder dropped frames of codec during a call: the list older releases read
 * (HARDWARE_DROPS_KEY), so a product on an older client in the same browser keeps out of it too; and, where `numbers`
 * are given (a checked call camera's watch), its record too. Best effort (private windows, blocked storage).
 */
export function rememberDroppedHardware( codec: CameraCodec, now: number = Date.now(), numbers?: Partial<Pick<CameraCodecRecord, 'msPerFrame' | 'sentShare' | 'cpuShare' | 'gpu'>> | null ): void {
    if( codec === 'vp8' ) return;
    if( numbers ){
        rememberCameraCodec( codec, { result: 'drops', msPerFrame: numbers.msPerFrame ?? null, sentShare: numbers.sentShare ?? null,
            cpuShare: numbers.cpuShare ?? null, ...( numbers.gpu ? { gpu: numbers.gpu } : {} ), at: now } );
    }
    try {
        const storage = globalThis.localStorage;
        if( ! storage ) return;
        let seen: Record<string, number> = {};
        try {
            const read = JSON.parse( storage.getItem( HARDWARE_DROPS_KEY ) ?? '{}' );
            if( read && typeof read === 'object' ) seen = read;
        } catch {}
        seen[ codec ] = now;
        storage.setItem( HARDWARE_DROPS_KEY, JSON.stringify( seen ) );
    } catch {}
}

/**
 * The codecs this browser's CPU couldn't encode a camera in, in software: the newest finding a `cpu` record that holds
 * (a week), found at CAMERA_STEP_DOWN_HEIGHT or under. One found above it isn't: it goes out at that height (vp9Height()).
 */
export function heavySoftwareCodecs( agent: string = userAgent(), now: number = Date.now(), tune?: CameraTune ): CameraCodec[] {
    return CAMERA_CODECS.filter( ( c ) => c !== 'vp8' && tooHeavy( cameraFinding( c, agent, now, tune ) ) );
}

/**
 * Whether a camera check found this browser encodes codec well: the newest finding a `pass` record that holds (a month,
 * this version), no dropped frames seen since; or, for a codec in software, one too heavy for the CPU only above
 * CAMERA_STEP_DOWN_HEIGHT, which goes out at that height.
 */
export function cameraCheckPassed( codec: CameraCodec, agent: string = userAgent(), now: number = Date.now(), tune?: CameraTune ): boolean {
    const found = cameraFinding( codec, agent, now, tune );
    return found?.result === 'pass' || ( found?.result === 'cpu' && ! tooHeavy( found ) );
}

/** The browser and its major version, which a check's verdict holds for: "edg155", "chrome155", "opr137". */
export function browserVersion( agent: string ): string {
    for( const [ name, pattern ] of [ [ 'edg', /edg\/(\d+)/i ], [ 'opr', /opr\/(\d+)/i ], [ 'chrome', /chrome\/(\d+)/i ], [ 'firefox', /firefox\/(\d+)/i ], [ 'safari', /version\/(\d+).*safari/i ] ] as const ){
        const m = pattern.exec( agent );
        if( m ) return name + m[1];
    }
    return 'other';
}

/**
 * A desktop browser on Windows built on Chromium (Chrome, Edge, Opera…): where a camera goes out in VP9, encoded in
 * software, once a check found its CPU able, ahead of the hardware H.264 the policy names first. Chrome trusts no
 * Windows hardware encoder's own rate control for H.264 (no software rate control on AMD and ARM, a flag elsewhere), so
 * libwebrtc takes whole frames off a camera whose encoder overshoots: 13 of 34 Windows senders in hardware H.264 froze
 * for their viewers in a day of calls, none of 15 Macs (2026-10-23); user_9's camera sent 4 of 15 frames for 40
 * minutes, and 720p at 14-15 in VP9 at 13 ms a frame once it moved. Not a phone or tablet, not Firefox.
 */
export function windowsDesktopChromium( agent: string ): boolean {
    return /windows nt/i.test( agent ) && /chrome\/|edg\//i.test( agent ) && ! FIREFOX.test( agent ) && ! /mobile|android|tablet/i.test( agent );
}

const FIREFOX = /firefox\/|fxios\//i;
// WebKit: every browser on an iPhone or iPad, and Safari on a Mac (an iPad's Safari says Macintosh)
const IOS = /iphone|ipad|ipod/i;
const SAFARI = /^((?!chrome|chromium|crios|edg|opr|android|firefox|fxios).)*safari/i;
const isWebKit = ( agent: string ) => IOS.test( agent ) || SAFARI.test( agent );

/**
 * WebKit (every iPhone and iPad browser, Safari on a Mac) or Firefox: a camera check is never run there. WebKit's H.264
 * is VideoToolbox, which takes no frames off, and neither names its encoder in its stats (no encoderImplementation, no
 * powerEfficientEncoder), so a loopback can't tell hardware from software (camera-check.ts).
 */
export function uncheckedBrowser( agent: string ): boolean {
    return isWebKit( agent ) || FIREFOX.test( agent );
}

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
 * The codecs of list this browser sends, in the list's order ("vp9" anyway, "h265:hw" only from hardware), each once,
 * VP8 last where the list hasn't named it; VP8 alone from Firefox and in an encrypted room. A codec in options.avoid is
 * passed over.
 */
function codecsOf( list: readonly string[], agent: string, hardware: CameraHardware, options: CameraCodecOptions ): CameraCodec[] {
    if( options.encrypted || FIREFOX.test( agent ) ) return [ 'vp8' ];
    const avoid = options.avoid ?? [];
    const out: CameraCodec[] = [];
    for( const entry of list ){
        const [ name, condition ] = String( entry ).toLowerCase().trim().split( ':' );
        const codec = CAMERA_CODECS.find( ( c ) => c === name );
        if( ! codec || out.includes( codec ) ) continue;
        if( codec !== 'vp8' && avoid.includes( codec ) ) continue;
        if( ! sends( codec, agent, hardware, options ) ) continue;
        if( condition === 'hw' && codec !== 'vp8' && ! inHardware( codec, agent, hardware, options ) ) continue;
        out.push( codec );
    }
    if( ! out.includes( 'vp8' ) ) out.push( 'vp8' );
    return out;
}

/** The first codec of list this browser sends (codecsOf), VP8 where none is. */
function pickCodec( list: readonly string[], agent: string, hardware: CameraHardware, options: CameraCodecOptions ): CameraCodec {
    return codecsOf( list, agent, hardware, options )[0];
}

const nameOf = ( entry: string ) => String( entry ).toLowerCase().trim().split( ':' )[0];

/**
 * The camera's list: the server's policy as it is, or the built-in one, which for a call's camera on the mesh tries VP9
 * before VP8 (VP8 is reached only once VP9 was tried, a hardware encoder that drops frames giving
 * way to VP9 first), as the mesh's own policy has it since 2026-10-19 (["h264:hw", "vp9", "vp8"]). A server's policy
 * without VP9 is its own choice; a stream's camera, and any off the mesh, keep the built-in list as it was.
 */
const cameraList = ( options: CameraCodecOptions ): readonly string[] => {
    if( options.policy?.camera?.length ) return options.policy.camera;
    const list = [ ...DEFAULT_CAMERA_POLICY ];
    if( legacyCamera( options ) || ! options.h265 || list.some( ( e ) => nameOf( e ) === 'vp9' ) ) return list;
    const at = list.findIndex( ( e ) => nameOf( e ) === 'vp8' );
    list.splice( at < 0 ? list.length : at, 0, 'vp9' );
    return list;
};

/**
 * The camera order a rule gives this browser (cameraRules(), cameraRuleFor()): a call's camera only, not in an encrypted
 * room. The built-in rules (a policy without the key) only where the camera's list has VP9 (on the mesh), so a camera off
 * it, or under a policy without VP9, keeps its list as it was; the node's own rules as they are. Null where none matches.
 */
export function cameraRuleOrder( agent: string, options: CameraCodecOptions = {} ): readonly string[] | null {
    if( legacyCamera( options ) || options.encrypted ) return null;
    const policy = options.policy ?? null;
    const own = !! policy && Object.prototype.hasOwnProperty.call( policy, 'rules' );
    if( ! own && ! cameraList( options ).some( ( e ) => nameOf( e ) === 'vp9' ) ) return null;
    const rule = cameraRuleFor( cameraRules( policy ), cameraEnvironment( agent, options.gpu !== undefined ? options.gpu : adapterName ) );
    return rule ? rule.camera : null;
}

/**
 * A camera on the old rules exactly, as before the camera check: not a checked call's (a stream's, the SDK's group
 * calls'), or one whose node didn't turn the check on (its policy's `check` anything but true: an older mesh, a
 * self-hosted box, stock LiveKit, a node configured off; Better Messages says false for a room client too old to hear
 * the node's switches). The policy's list or the built-in one as they are, no rules, and the dropped-frames list older
 * releases kept as the only thing avoided: no record read.
 */
export function legacyCamera( options: CameraCodecOptions = {} ): boolean {
    return ! options.call || options.policy?.check !== true;
}

/**
 * What this device won't send: the codecs given, or those it remembers (hardware that dropped frames, software too
 * heavy), for as long as the policy's tune keeps them; on the old rules, the old list alone.
 */
const avoidOf = ( agent: string, options: CameraCodecOptions ) => {
    if( options.avoid ) return options.avoid;
    if( legacyCamera( options ) ) return droppedHardwareCodecs();
    const tune = cameraTune( options.policy ), now = Date.now();
    return [ ...droppedCameraCodecs( now, agent, tune ), ...heavySoftwareCodecs( agent, now, tune ) ];
};

/**
 * The camera's codecs on this device, in the order to try them: a rule's (cameraRuleOrder()), else the policy's (the
 * server's, or the built-in), without what it won't send (avoidOf), VP8 last. What a camera check (camera-check.ts)
 * goes through, measuring each that needs it.
 */
export function cameraCodecOrder( agent: string, hardware: CameraHardware, options: CameraCodecOptions = {} ): CameraCodec[] {
    const opts = { ...options, avoid: avoidOf( agent, options ) };
    return codecsOf( cameraRuleOrder( agent, options ) ?? cameraList( options ), agent, hardware, opts );
}

/**
 * The camera's codec on this device: its user agent, the codecs it encodes, the room, and the server's policy. Not a
 * codec whose hardware encoder dropped a camera's frames here (encoder-watch.ts), nor one its CPU couldn't encode
 * (camera-check.ts). Where a rule orders the camera (by default a Windows desktop Chrome or Edge, VP9 first), its first
 * codec, one in software only once a check found this browser able (cameraCheckPassed); unmeasured, or without a rule,
 * the policy's order as before.
 */
export function cameraCodecFor( agent: string, hardware: CameraHardware, options: CameraCodecOptions = {} ): CameraCodec {
    const opts = { ...options, avoid: avoidOf( agent, options ) };
    // the old rules: the list, less the old dropped-frames list
    if( legacyCamera( options ) ) return pickCodec( cameraList( options ), agent, hardware, opts );
    const ruled = cameraRuleOrder( agent, options );
    if( ruled ){
        const first = codecsOf( ruled, agent, hardware, opts )[0];
        if( first === 'vp8' || inHardware( first, agent, hardware, options ) || cameraCheckPassed( first, agent, Date.now(), cameraTune( options.policy ) ) ) return first;
    }
    return pickCodec( cameraList( options ), agent, hardware, opts );
}

/** Whether this device encodes codec in hardware (as cameraCodecFor() reads it): what a camera check measures for drops. */
export function encodesInHardware( codec: CameraCodec, agent: string, hardware: CameraHardware, options: CameraCodecOptions = {} ): boolean {
    return inHardware( codec, agent, hardware, options );
}

/**
 * The screen's codec, as cameraCodecFor() the camera's (the server's policy's screen list; VP8 without one). A camera's
 * dropped frames don't steer it: a screen costs an encoder little but where it moves, and VP8 shares a screen worse.
 */
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
    /**
     * The tallest picture it goes out at, lines (1.0.41; choiceHeight()), which fitCameraTrack() brings the camera down
     * to. Missing: cameraMaxHeight() of its codec, as before.
     */
    height?: number;
}

/**
 * The tallest picture a camera in codec goes out at: cameraMaxHeight(), and for a checked call camera in software VP9
 * what this browser found of it (vp9Height(): VP9_TOP_HEIGHT once measured able there, CAMERA_STEP_DOWN_HEIGHT else).
 */
export function choiceHeight( codec: CameraCodec, hardware: boolean, agent: string, options: CameraCodecOptions = {} ): number {
    if( codec !== 'vp9' || hardware || legacyCamera( options ) || options.encrypted ) return cameraMaxHeight( codec, hardware );
    return vp9Height( agent, Date.now(), cameraTune( options.policy ) );
}

/** roomCallCodec(), with what cameraPublish() and fitCameraTrack() need to know of it. */
export function roomCallChoice( caps: CameraCodecCaps | null, agent: string, options: CameraCodecOptions = {} ): CameraChoice {
    const hardware = hardwareFromCaps( caps );
    const codec = cameraCodecFor( agent, hardware, options );
    const encoded = inHardware( codec, agent, hardware, options );
    return { codec, hardware: encoded, backup: options.encrypted ? null : backupFor( codec, options.policy ), height: choiceHeight( codec, encoded, agent, options ) };
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
 * The one exception is a checked call camera in VP9 that this browser measured able at 1080 (choiceHeight()).
 */
export function cameraMaxHeight( codec: CameraCodec, hardware?: boolean ): number {
    return ( hardware ?? ( codec === 'h264' || codec === 'h265' ) ) ? 1080 : 720;
}

/**
 * Brings a camera down to cameraMaxHeight() for its codec before it is published (or to `maxHeight`, a choice's
 * CameraChoice.height), and answers the height it has then, which is what cameraPublish() takes. The browser scales
 * what the camera gives, keeping its shape and the rest of what it was asked for (the device, the frame rate), and the
 * preview shows the same picture. Best effort: a camera that can't be scaled, or doesn't answer within two seconds,
 * goes out at the size it has, with that size's layers. Never up: a camera smaller than that stays as it is.
 *
 * And a camera opened in a mode of fewer than CAMERA_MIN_FPS frames is tried at smaller sizes (fasterCameraMode).
 */
export async function fitCameraTrack( track: MediaStreamTrack, codec: CameraCodec, hardware?: boolean, maxHeight?: number ): Promise<number> {
    const { width, height } = cameraSize( track );
    const max = maxHeight && maxHeight > 0 ? maxHeight : cameraMaxHeight( codec, hardware );
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
 * out at 15 frames or fewer): smooth without losing details. That is H.264's and VP8's: a screen in VP9 or AV1 is the
 * other way round (SCREEN_CONTENT_HINT_SVC).
 */
export const SCREEN_CONTENT_HINT = 'motion';
export const SCREEN_DEGRADATION = 'maintain-resolution' as const;

/**
 * A shared screen's track in VP9 or AV1 is marked detail (1.0.44): Chrome encodes it in its screen-content mode, which
 * keeps scrolled text sharp, where marked motion it encodes it as camera video, which blurs it. Chromium 156, a 1080-line
 * page scrolled every frame on a 5 Mbit/s budget, one spatial layer: motion at an average quantizer of 208 of 255 and 7
 * frames a second on 4.7 Mbit/s, detail at 152 and 18 frames on 3.5. The screen-content mode sends nothing of a screen
 * in two spatial layers, so such a screen goes out in one (@wordplus/rtc-client 1.0.19 keeps the hint for it).
 */
export const SCREEN_CONTENT_HINT_SVC = 'detail';

/**
 * A screen in VP9 or AV1 goes out in one spatial layer of two frame rates (1.0.45; @wordplus/rtc-client 1.0.20 keeps
 * it, earlier ones send L1T3). Chromium 156, 1080 lines on a 5 Mbit/s budget, marked detail: a page scrolled every
 * frame at an average quantizer of 141 against L1T3's 152, a video with a cut every 2 s at 20 frames a second against 14.
 */
export const SCREEN_SCALABILITY_MODE_SVC = 'L1T2';

export interface ScreenPublish {
    codec: CameraCodec;
    /** Half the screen's size at 15 frames, for a viewer that can't take it whole: in H.264 and H.265 only. */
    layer: CallLayer | null;
    /** Whether it goes out in two pictures (the layer's); false is to be passed too, or livekit-client adds a second. */
    simulcast: boolean;
    /** What its track is marked (MediaStreamTrack.contentHint): SCREEN_CONTENT_HINT_SVC in VP9 or AV1, else SCREEN_CONTENT_HINT. */
    contentHint: typeof SCREEN_CONTENT_HINT | typeof SCREEN_CONTENT_HINT_SVC;
    /** VP9 and AV1 only: SCREEN_SCALABILITY_MODE_SVC, to pass as the publish's scalabilityMode. */
    scalabilityMode?: typeof SCREEN_SCALABILITY_MODE_SVC;
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
 * framerate seems to be bad"). Smaller screens go out whole.
 *
 * In VP9 or AV1 it goes out whole, one spatial layer of two frame rates (SCREEN_SCALABILITY_MODE_SVC), marked detail
 * (SCREEN_CONTENT_HINT_SVC): sharp as it scrolls, where two spatial layers can be had only as camera video, which blurs
 * it, and two pictures not at all (the mesh's worker refuses VP9 and AV1 as simulcast). A viewer that can't take it
 * whole is given half its frames.
 */
export function screenPublish( width: number, height: number, codec: CameraCodec = 'vp8' ): ScreenPublish {
    if( codec === 'vp9' || codec === 'av1' ) return { codec, layer: null, simulcast: false, contentHint: SCREEN_CONTENT_HINT_SVC, scalabilityMode: SCREEN_SCALABILITY_MODE_SVC };
    if( ( codec !== 'h264' && codec !== 'h265' ) || width < 1280 || height < 640 ) return { codec, layer: null, simulcast: false, contentHint: SCREEN_CONTENT_HINT };

    return { codec, layer: { width: Math.round( width / 2 ), height: Math.round( height / 2 ), bitrate: 1_500_000, fps: 15 }, simulcast: true, contentHint: SCREEN_CONTENT_HINT };
}

/**
 * A shared screen sent for a video played on it, the presenter's "Optimize for video" (1.0.45): marked motion, which
 * Chrome encodes as camera video, and keeping its frame rate when the link or the CPU can't give both, so a cut in the
 * video comes out whole at once. In the screen-content mode a VP9 screen of a video with a cut every 2 s went out at 14
 * frames a second, each cut rough for the frames after it; marked motion, at 27. Text blurs as it scrolls, so the
 * presenter turns it on for a video and off again.
 */
export const SCREEN_DEGRADATION_VIDEO = 'maintain-framerate' as const;

export interface ScreenVideoMode {
    contentHint: typeof SCREEN_CONTENT_HINT | typeof SCREEN_CONTENT_HINT_SVC;
    degradationPreference: typeof SCREEN_DEGRADATION | typeof SCREEN_DEGRADATION_VIDEO;
}

/**
 * How a screen shared in `codec` is sent: for a video played on it (forVideo), or as screenPublish marks it. A direct
 * call marks its share detail in every codec (it sends a screen in the codec that keeps text), so it passes 'vp9'.
 */
export function screenVideoMode( codec: CameraCodec, forVideo: boolean ): ScreenVideoMode {
    if( forVideo ) return { contentHint: SCREEN_CONTENT_HINT, degradationPreference: SCREEN_DEGRADATION_VIDEO };

    return { contentHint: codec === 'vp9' || codec === 'av1' ? SCREEN_CONTENT_HINT_SVC : SCREEN_CONTENT_HINT, degradationPreference: SCREEN_DEGRADATION };
}

/** A shared screen's track as the mesh's room client has it (its LocalVideoTrack). */
export interface ScreenShareTrack {
    mediaStreamTrack: MediaStreamTrack;
    setDegradationPreference( preference: RTCDegradationPreference ): Promise<void> | void;
}

/**
 * Puts a screen shared into a room in a mode while it is sent, nothing published again: no key frame, and a VP9 screen
 * in L1T2 settled within 2 s (23 frames a second in detail, 28 for video, 24 back). Its publication's options take the
 * degradation too, as the room client publishes the track with them again after a full reconnect.
 */
export async function applyScreenVideoMode( track: ScreenShareTrack, options: { degradationPreference?: RTCDegradationPreference } | undefined, mode: ScreenVideoMode ): Promise<void> {
    try {
        track.mediaStreamTrack.contentHint = mode.contentHint;
    } catch (e) {}
    if( options ) options.degradationPreference = mode.degradationPreference;
    await track.setDegradationPreference( mode.degradationPreference );
}

/**
 * The pixel density a receiver asks layers by (adaptive stream): the screen's, at most 1.5. At 2 or 3 (a Retina
 * screen, a phone) a tile asked for twice its size or more, the larger layer for every tile in a grid.
 */
export function roomPixelDensity( devicePixelRatio: number | undefined ): number {
    return Math.min( 1.5, Math.max( 1, Number( devicePixelRatio ) || 1 ) );
}
