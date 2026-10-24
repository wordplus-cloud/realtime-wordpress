/**
 * A camera moved to another codec during a room call, when the one it went out in fails there: everyone sees a
 * placeholder on its tile ("Optimizing quality") so the move looks smooth and understandable, nothing else in the call
 * breaks, and a call moves its camera only a few times at most.
 *
 * What finds it is the camera's encoder watch (encoder-watch.ts), on the 5-s readings it takes anyway: a hardware
 * H.264 or H.265 taking the camera's frames off over 30 s (onDrops), or VP9 or AV1 in software that the encoder's own
 * stats say the CPU held back half of 20 s or more (onCpuHeld). Never one reading, never the machine's CPU pressure.
 * Not at all unless the node turned both on (`check` and `adapt` true; missing is off): no loopback in a call otherwise.
 *
 * What a product does then (Better Messages' call container):
 * 1. asks CameraSwitchGuard whether a move may happen now (allow());
 * 2. picks the next codec with camera-check.ts's checkedCameraChoice(), avoiding every codec that failed in this call
 *    (guard.failed) and those this browser remembers failing: hardware H.264 giving way to VP9 (measured, or from its
 *    record), VP8 only once VP9 failed too;
 * 3. moves the camera with switchCameraCodec(): "optimizing" to everyone on CAMERA_STATE_TOPIC, the camera taken out
 *    and published again in the new codec, "ready" after; back in its old codec if the new one doesn't take within
 *    CAMERA_REPUBLISH_TIMEOUT_MS, so nothing loses the camera;
 * 4. tells the mesh (camera-check.ts, reportMeshCamera()).
 * Everyone else shows "Optimizing video quality..." over that person's tile (CameraOptimizing, then the tile's own wait
 * for the new picture's first frame), for CAMERA_OPTIMIZING_MAX_MS at most.
 *
 * Before any of that, a camera in VP9 held back above CAMERA_STEP_DOWN_HEIGHT (one that went out at 1080, 1.0.41) steps
 * down to it first, in the room as it is (stepDownCamera()): no move, nothing announced, the guard not asked. Only VP9
 * still held back there moves.
 *
 * Screens and microphones are never moved: only a camera's sender is watched, and only a camera republished.
 */
import {cameraPublish, cameraTune, droppedCameraCodecs, fitCameraTrack, heavySoftwareCodecs, CAMERA_STEP_DOWN_HEIGHT, CAMERA_TUNE_DEFAULTS, type CameraCodec, type CameraCodecCaps,
    type CodecPolicy} from "./room-publish.js";
import {checkedCameraChoice, type CameraCheckOptions, type CameraSwitch, type CheckedCameraChoice} from "./camera-check.js";

// Each number below is the node's to change (its codec policy's tune, room-publish.ts cameraTune()), so the server can
// reconfigure it without a client update; these are its defaults.
/** At most this many moves a call (tune.switchesMax, 0 none): in practice one, a second only when the codec moved to fails as well. */
export const CAMERA_SWITCHES_MAX = CAMERA_TUNE_DEFAULTS.switchesMax;
/** At least this long between two moves (tune.switchGapS). */
export const CAMERA_SWITCH_GAP_MS = CAMERA_TUNE_DEFAULTS.switchGapS * 1000;
/** None in a camera's first this long: its encoder warming up says nothing of how it carries the call (tune.warmupS). */
export const CAMERA_SWITCH_WARMUP_MS = CAMERA_TUNE_DEFAULTS.warmupS * 1000;
/** How long the camera's new publication may take; past it, it goes out again in the codec it had (tune.republishTimeoutS). */
export const CAMERA_REPUBLISH_TIMEOUT_MS = CAMERA_TUNE_DEFAULTS.republishTimeoutS * 1000;
/** The longest a tile says "Optimizing video quality...", whatever was heard after (tune.failsafeS). */
export const CAMERA_OPTIMIZING_MAX_MS = CAMERA_TUNE_DEFAULTS.failsafeS * 1000;

/** The data channel topic of a camera's move: {"state":"optimizing"} before it, {"state":"ready"} after. */
export const CAMERA_STATE_TOPIC = 'wp-camera';
export type CameraState = 'optimizing' | 'ready';

/** A camera move's message, as it goes on CAMERA_STATE_TOPIC (UTF-8 JSON). */
export function encodeCameraState( state: CameraState ): Uint8Array {
    return new TextEncoder().encode( JSON.stringify( { state } ) );
}

/** A message on CAMERA_STATE_TOPIC, read; null for anything else. */
export function decodeCameraState( payload: Uint8Array | ArrayBuffer | null | undefined ): CameraState | null {
    if( ! payload ) return null;
    try {
        const parsed = JSON.parse( new TextDecoder().decode( payload instanceof Uint8Array ? payload : new Uint8Array( payload ) ) ) as { state?: unknown };
        return parsed?.state === 'optimizing' || parsed?.state === 'ready' ? parsed.state : null;
    } catch {
        return null;
    }
}

/** Why a move may not happen now, when it may not. */
export type CameraSwitchRefusal = 'off' | 'warming' | 'gap' | 'cap' | 'failed';

/**
 * The rules a call's camera moves keep: CAMERA_SWITCHES_MAX a call, CAMERA_SWITCH_GAP_MS apart,
 * none in a camera's first CAMERA_SWITCH_WARMUP_MS, never back to a codec that failed in this call; none at all unless
 * the node's codec policy says "adapt": true and "check": true (missing is off: a node that can't turn moves off
 * never has them), nor where its tune.switchesMax is 0. The three numbers are the policy's tune's where it gives them
 * (switchesMax, switchGapS, warmupS). Past the cap the camera stays as it is (the product reports it).
 */
export class CameraSwitchGuard {
    /** This call's moves, oldest first. */
    readonly switches: CameraSwitch[] = [];
    /** The codecs that failed in this call. */
    readonly failed = new Set<CameraCodec>();
    private cameraSince = 0;

    constructor( private readonly now: () => number = Date.now ) {}

    /** The camera started (or started again after being turned off): its warm-up runs from now. */
    cameraStarted(): void {
        this.cameraSince = this.now();
    }

    /** codec failed in this call (its encoder watch said so): no move goes back to it. */
    fail( codec: CameraCodec ): void {
        this.failed.add( codec );
    }

    /** Whether a move away from now may happen now, by the policy's switch and the rules: null if it may, else why not. */
    refuses( policy?: CodecPolicy | null ): CameraSwitchRefusal | null {
        const at = this.now();
        const tune = cameraTune( policy, at );
        if( policy?.adapt !== true || policy?.check !== true || tune.switchesMax === 0 ) return 'off';
        if( this.switches.length >= tune.switchesMax ) return 'cap';
        if( ! this.cameraSince || at - this.cameraSince < tune.warmupS * 1000 ) return 'warming';
        const last = this.switches[ this.switches.length - 1 ];
        if( last && at - last.at < tune.switchGapS * 1000 ) return 'gap';
        return null;
    }

    /** Whether a move to codec may happen: not to a codec that failed in this call. */
    allowsTo( codec: CameraCodec ): boolean {
        return ! this.failed.has( codec );
    }

    /** A move made (or tried): counted, and its time starts the gap. */
    moved( from: CameraCodec, to: CameraCodec, why: CameraSwitch['why'] ): CameraSwitch {
        const move = { from, to, why, at: this.now() };
        this.switches.push( move );
        return move;
    }
}

/**
 * Whether a camera its CPU held back (onCpuHeld) steps down rather than moving: VP9 in software at more than
 * CAMERA_STEP_DOWN_HEIGHT lines (`lines`, the watch's). A camera at that height or under, or in any other codec, moves.
 */
export function stepsDown( codec: CameraCodec, lines: number ): boolean {
    return codec === 'vp9' && lines > CAMERA_STEP_DOWN_HEIGHT;
}

/**
 * A camera in VP9 its CPU can't carry above CAMERA_STEP_DOWN_HEIGHT during a call, brought down to it in the room as it
 * is (the step down to 720 seamless, with no placeholder): the capture scaled (fitCameraTrack(), the
 * preview with it) and its one layered encoding given the top bitrate of that height (cameraPublish()), so its viewers
 * only see a smaller picture. The layers stay declared at the sizes it went out at, as when Chrome shrinks a camera for
 * its CPU on its own. Answers the lines it has then; null where it couldn't be brought down, which a product moves to
 * another codec instead.
 */
export async function stepDownCamera( track: MediaStreamTrack, sender: RTCRtpSender | null | undefined, codec: CameraCodec,
    to: number = CAMERA_STEP_DOWN_HEIGHT ): Promise<number | null> {
    const lines = await fitCameraTrack( track, codec, false, to );
    if( ! lines || lines > to ) return null;
    const top = cameraPublish( codec, Math.max( lines, CAMERA_STEP_DOWN_HEIGHT ) )?.top;
    try {
        const params = sender?.getParameters();
        // VP9 goes out as one encoding of three spatial layers: its bitrate is the top layer's
        if( sender && top && params?.encodings?.length === 1 ){
            params.encodings[0].maxBitrate = top.maxBitrate;
            await sender.setParameters( params );
        }
    } catch {
        // its bitrate stays: the smaller picture takes what it needs of it
    }
    return lines;
}

/**
 * The codec a camera moves to once `from` failed in this call: checkedCameraChoice() without `from`, without whatever
 * else failed in this call (guard.failed) and what this browser remembers failing (as long as the policy's tune keeps
 * it), measuring what it hasn't measured (VP9 before VP8 always), on any machine, a camera rule naming it or not (`move`).
 * Null where nothing better comes out (the same codec, or one the guard won't take), and where the node didn't turn the
 * check on: no loopback during a call then, no move.
 */
export async function nextCameraChoice( from: CameraCodec, track: MediaStreamTrack | null | undefined, caps: CameraCodecCaps | null, agent: string,
    options: CameraCheckOptions, guard: CameraSwitchGuard ): Promise<CheckedCameraChoice | null> {
    guard.fail( from );
    if( options.policy?.check !== true ) return null;
    const tune = cameraTune( options.policy ), now = Date.now();
    const avoid = [ ...new Set<CameraCodec>( [ ...droppedCameraCodecs( now, agent, tune ), ...heavySoftwareCodecs( agent, now, tune ), ...guard.failed ] ) ];
    const choice = await checkedCameraChoice( track, caps, agent, { ...options, avoid, move: true } );
    if( choice.codec === from || ! guard.allowsTo( choice.codec ) ) return null;
    return choice;
}

/** What switchCameraCodec() does the move with: the product's room. */
export interface CameraSwitchSteps {
    /** sends a message on CAMERA_STATE_TOPIC to everyone (reliable); its failure doesn't stop the move */
    announce( state: CameraState ): Promise<unknown>;
    /** takes the camera out of the room and publishes the same track again in codec; resolves once published */
    republish( codec: CameraCodec ): Promise<unknown>;
    /** how long the new publication may take; CAMERA_REPUBLISH_TIMEOUT_MS (the policy's tune.republishTimeoutS) */
    timeoutMs?: number;
}

/** How long a camera's "optimizing" or "ready" may take to go out before the move goes on without it. */
export const CAMERA_ANNOUNCE_TIMEOUT_MS = 1_000;

const within = <T>( work: Promise<T>, ms: number ) => new Promise<T>( ( resolve, reject ) => {
    const timer = setTimeout( () => reject( new Error( 'timeout' ) ), ms );
    work.then( ( v ) => { clearTimeout( timer ); resolve( v ); }, ( e ) => { clearTimeout( timer ); reject( e ); } );
} );

/**
 * Moves the camera from one codec to another: "optimizing" to everyone, the camera published again in `to` within the
 * timeout, else again in `from` (so the camera is never lost), and "ready" after either way, each message given
 * CAMERA_ANNOUNCE_TIMEOUT_MS at most. Answers the codec the camera goes out in now, and whether the move took. An
 * attempt that runs over isn't stopped here: the product's republish drops a stale one, and looks once the move is over
 * that the camera is out (Better Messages' call container).
 */
export async function switchCameraCodec( from: CameraCodec, to: CameraCodec, steps: CameraSwitchSteps ): Promise<{ codec: CameraCodec, moved: boolean }> {
    const timeout = steps.timeoutMs ?? CAMERA_REPUBLISH_TIMEOUT_MS;
    const announce = ( state: CameraState ) => within( Promise.resolve().then( () => steps.announce( state ) ), CAMERA_ANNOUNCE_TIMEOUT_MS ).catch( () => null );
    await announce( 'optimizing' );
    try {
        await within( Promise.resolve().then( () => steps.republish( to ) ), timeout );
        return { codec: to, moved: true };
    } catch {
        try {
            await within( Promise.resolve().then( () => steps.republish( from ) ), timeout );
        } catch {}
        return { codec: from, moved: false };
    } finally {
        await announce( 'ready' );
    }
}

/**
 * Who in a call is moving their camera now, from the messages on CAMERA_STATE_TOPIC: "optimizing" marks them,
 * "ready" or CAMERA_OPTIMIZING_MAX_MS ends it (onChange each time). The tile then waits for the new picture's first
 * frame itself, within the same CAMERA_OPTIMIZING_MAX_MS. maxMs: that time, or what gives it at each "optimizing" (the
 * room's policy's tune.failsafeS, which the room has only once joined).
 */
export class CameraOptimizing {
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor( private readonly onChange: ( identity: string, optimizing: boolean ) => void,
        private readonly maxMs: number | ( () => number ) = CAMERA_OPTIMIZING_MAX_MS ) {}

    /** A message on CAMERA_STATE_TOPIC from identity. */
    message( identity: string, payload: Uint8Array | ArrayBuffer | null | undefined ): void {
        const state = decodeCameraState( payload );
        if( state === 'optimizing' ){
            this.end( identity, false );
            const maxMs = typeof this.maxMs === 'function' ? this.maxMs() : this.maxMs;
            this.timers.set( identity, setTimeout( () => this.end( identity, true ), maxMs ) );
            this.onChange( identity, true );
        } else if( state === 'ready' ){
            this.end( identity, true );
        }
    }

    /** identity left the call: nothing of theirs stays marked. */
    left( identity: string ): void {
        this.end( identity, true );
    }

    /** Whether identity is marked now. */
    has( identity: string ): boolean {
        return this.timers.has( identity );
    }

    /** The call ended: every timer stopped, nobody told. */
    clear(): void {
        this.timers.forEach( ( timer ) => clearTimeout( timer ) );
        this.timers.clear();
    }

    private end( identity: string, tell: boolean ): void {
        const timer = this.timers.get( identity );
        if( ! timer ) return;
        clearTimeout( timer );
        this.timers.delete( identity );
        if( tell ) this.onChange( identity, false );
    }
}
