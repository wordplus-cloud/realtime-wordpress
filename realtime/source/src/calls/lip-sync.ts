/**
 * Lip sync in a room: each person's picture played with its own sound, as measured where they play, and their holds
 * moved until the two meet (2026-10-19), with the media server's dynamic playout delay in mind.
 *
 * The media server holds pictures, a call's from 150 ms (WordPlus Mesh's playout delay), raised on a path that repairs
 * up to 400 and lowered again, and a shared screen from 300; the client holds sound. A fixed rule between the two (the
 * sound as long as its picture, less 100 ms) left a person's picture anywhere from 60 ms before their voice to 40 ms
 * after, and a browser's own showing of a picture against its sound moved by tens of milliseconds from one call to the
 * next (WordPlus Mesh's TestLipSync, 2026-10-19: Chromium holding neither, its picture 44 to 96 ms early).
 *
 * So each look reads what the browser plays of each: its stats' estimatedPlayoutTimestamp, the sender's time of what
 * plays at the stats' instant, which Chromium gives for a picture and a sound of one stream (the media server pairs a
 * person's camera and microphone, a screen and its sound). Their difference is how far the picture plays behind its
 * sound, within about 20 ms of a flash and its beep timed where they're seen and heard (TestLipSync, Chromium:
 * -23 to +14 ms against the stats). Once LIP_SYNC.samples readings in a row are past LIP_SYNC.tolerance, the late one
 * plays sooner if it was held longer than the call's own, else the early one is held longer: a part of the gap a look,
 * so a reading that misjudged moves little. The browser plays what it was told, which the next readings show, whatever
 * the media server holds meanwhile.
 *
 * The stats tell when a sound leaves for the speaker, not when it's heard: the output's own delay (16 ms in the lab,
 * 150-250 ms on Bluetooth headphones) plays it that much later, so it counts against the sound (audioOutputDelay, which
 * reads the call's speaker; soundDelay). With it the stats were within -20 to +8 ms of the flashes (TestLipSync,
 * 2026-10-19, Chromium on the mesh).
 *
 * WebKit's stats are 40-60 ms off what it plays, so a caller lets the browser sync a WebKit page itself (the pairing
 * does it there: +3 ms held). A browser that gives no reading (Firefox, or tracks of two streams) leaves the pair to
 * the caller's own rule (syncPair answers null).
 */

/** A receiver as a look needs it: its hold, which a browser without the setting lacks, and its stats. */
export interface SyncReceiver {
    jitterBufferTarget?: number | null;
    getStats(): Promise<RTCStatsReport>;
}

/** A person's picture and the sound that goes with it: their camera and microphone, or a screen and its own sound. */
export interface SyncPair {
    picture: SyncReceiver;
    sounds: SyncReceiver[];
}

export const LIP_SYNC = {
    /** A gap this small either way is left alone, ms: a reading's own wander from one look to the next. */
    tolerance: 10,
    /** Readings in a row past the tolerance before the holds move, and the gap they take is their median. */
    samples: 2,
    /** The share of the gap a move takes. */
    gain: 0.7,
    /** The most a move takes, ms. */
    maxStep: 80,
    /** The most a hold is set to, ms: jitterBufferTarget's 4 s. */
    max: 4000,
};

/** Each pair's readings since its holds last moved, by its picture's receiver. */
export type LipSyncState = WeakMap<SyncReceiver, { lags: number[] }>;

/**
 * The sender's time of what a receiver plays now, less now, in ms (estimatedPlayoutTimestamp, at its stats' instant);
 * null when the browser doesn't say.
 */
async function playingBehind( receiver: SyncReceiver ): Promise<number | null> {
    let behind: number | null = null;
    try {
        ( await receiver.getStats() ).forEach( ( stat: { type?: string, estimatedPlayoutTimestamp?: number, timestamp?: number } ) => {
            if( stat.type === 'inbound-rtp' && stat.estimatedPlayoutTimestamp && stat.timestamp ){
                behind = stat.estimatedPlayoutTimestamp - stat.timestamp;
            }
        } );
    } catch (e) {
        return null;
    }
    return behind;
}

/**
 * How far a picture plays behind its sound now, in ms (above 0 behind, below 0 ahead), as the browser's stats tell
 * it; null when they don't.
 */
export async function playoutLag( picture: SyncReceiver, sound: SyncReceiver ): Promise<number | null> {
    const [ p, s ] = await Promise.all( [ playingBehind( picture ), playingBehind( sound ) ] );
    return p === null || s === null ? null : Math.round( s - p );
}

// One context of the page's, kept while a call runs, to read the speaker's own delay by; closeAudioOutput lets it go.
let probe: AudioContext | null = null;
let probeSink = '';

/**
 * The delay of the speaker a call plays on, in ms (AudioContext.outputLatency: its device's, Bluetooth's included);
 * sinkId the call's chosen one, '' the default. 0 where the browser can't tell, or can't open a context yet.
 */
export async function audioOutputDelay( sinkId = '' ): Promise<number> {
    try {
        if( ! probe ){
            if( typeof AudioContext === 'undefined' ) return 0;
            probe = new AudioContext();
            probeSink = '';
        }
        const ctx = probe as AudioContext & { setSinkId?: ( id: string ) => Promise<void> };
        if( sinkId !== probeSink && typeof ctx.setSinkId === 'function' ){
            await ctx.setSinkId( sinkId );
            probeSink = sinkId;
        }
        if( ctx.state !== 'running' ) await Promise.race( [ ctx.resume(), new Promise( ( r ) => setTimeout( r, 200 ) ) ] );
        return ctx.state === 'running' ? Math.round( ( ctx.outputLatency || 0 ) * 1000 ) : 0;
    } catch (e) {
        return 0;
    }
}

/** Lets audioOutputDelay's context go, once no call runs. */
export function closeAudioOutput(): void {
    const ctx = probe;
    probe = null;
    probeSink = '';
    ctx?.close().catch( () => {} );
}

const holdOf = ( receiver: SyncReceiver, base: number ) => Math.max( base, Number( receiver.jitterBufferTarget ) || base );

function setHold( receiver: SyncReceiver, hold: number ): void {
    try {
        receiver.jitterBufferTarget = hold;
    } catch (e) {}
}

/**
 * One look at a pair: its lag read, the sound heard soundDelay ms after the stats say it plays (its output's own delay,
 * audioOutputDelay), and, once LIP_SYNC.samples readings in a row are past LIP_SYNC.tolerance, the holds moved toward
 * meeting, neither under base (the call's own hold) nor over LIP_SYNC.max. The lag read, or null when the browser
 * can't tell or can't hold: the caller's own rule then holds the pair.
 */
export async function syncPair( pair: SyncPair, state: LipSyncState, base: number, soundDelay = 0 ): Promise<number | null> {
    const sounds = pair.sounds.filter( ( sound ) => 'jitterBufferTarget' in sound );
    if( ! ( 'jitterBufferTarget' in pair.picture ) || sounds.length === 0 ) return null;
    const read = await playoutLag( pair.picture, sounds[ 0 ] );
    if( read === null ) return null;
    const lag = read - Math.round( soundDelay );

    const seen = state.get( pair.picture ) ?? { lags: [] };
    state.set( pair.picture, seen );
    if( Math.abs( lag ) <= LIP_SYNC.tolerance ){
        seen.lags = [];
        return lag;
    }
    // a reading the other way starts the count again
    if( seen.lags.length > 0 && Math.sign( seen.lags[ 0 ] ) !== Math.sign( lag ) ) seen.lags = [];
    seen.lags.push( lag );
    if( seen.lags.length < LIP_SYNC.samples ) return lag;

    const sorted = [ ...seen.lags ].sort( ( a, b ) => a - b );
    const gap = sorted[ sorted.length >> 1 ];
    seen.lags = [];
    let move = Math.sign( gap ) * Math.min( LIP_SYNC.maxStep, Math.round( Math.abs( gap ) * LIP_SYNC.gain ) );
    let picture = holdOf( pair.picture, base );
    let sound = Math.max( ...sounds.map( ( s ) => holdOf( s, base ) ) );
    if( move > 0 ){
        // the picture behind: played sooner while it was held longer than the call's own, then the sound held longer
        const sooner = Math.min( move, picture - base );
        picture -= sooner;
        sound = Math.min( LIP_SYNC.max, sound + move - sooner );
    } else {
        move = -move;
        // the picture ahead: the sound played sooner while it was held longer than the call's own, then the picture
        // held longer
        const sooner = Math.min( move, sound - base );
        sound -= sooner;
        picture = Math.min( LIP_SYNC.max, picture + move - sooner );
    }
    setHold( pair.picture, picture );
    for( const s of sounds ) setHold( s, sound );
    return lag;
}
