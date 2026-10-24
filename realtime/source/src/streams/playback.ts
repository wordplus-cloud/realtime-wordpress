import type {Room, Track, TrackPublication} from "@wordplus/rtc-client";

// How the stream plays in this browser, to debug it: what arrives (the main picture, the sound), the way it comes (the
// media server, the transport, the round trip), and the session so far (how long the picture took to start, stalls,
// reconnects, errors, time watched), with the last things that happened. Measured from the browser's own statistics
// (RTCStatsReport) once a second while the room is joined, a quarter of a second until the first frame. Nothing is sent
// anywhere: a player shows it, and a person debugging copies it. What it answers is plain data, in playback-types.ts.

import type {AudioIn, LayerQuality, MediaServer, PictureLayer, PlaybackEvent, PlaybackEventKind, PlaybackSession, PlaybackStats, TransportIn, VideoIn} from "./playback-types.js";
import {CHOSEN_MAX_SIDE} from "./protocol.js";
export type {AudioIn, LayerQuality, MediaServer, PictureLayer, PlaybackEvent, PlaybackEventKind, PlaybackSession, PlaybackStats, TransportIn, VideoIn};

// A picture that shows no new frame this long while it should is stalled: a camera sends 30 a second.
const STALL_MS = 1000;
// A picture too much for this viewer's connection, and only theirs: no new frame for TOO_SLOW_MS while the media server
// holds it back for them (it does so for a download that cannot carry it, nobody else's), or while all of these hold
// over that time: at least TOO_SLOW_LOSS of what was sent of it lost (of TOO_SLOW_PACKETS or more), at least
// TOO_SLOW_SOUND of the sound made up, the media server rating this viewer's connection poor or lost, and not rating its
// sender's so. A connection that carries less than the picture's smallest layer loses most of it, and its sound with it:
// on 780 kbit/s down, a layer of 2,250 kbit/s showed 2 frames in 40 s, 63-77% of it lost, and 20-45% of the sound was
// made up, rated weak from its 8th second. A picture only waiting for its sender's next key frame loses nothing. One whose
// sender's upload loses it comes with the same gaps to every viewer, and its sender is rated poor, within the media
// server's look every few seconds, which TOO_SLOW_MS waits out. Sound played whole gives no reason to take the picture.
const TOO_SLOW_MS = 5000;
const TOO_SLOW_LOSS = 0.2;
const TOO_SLOW_PACKETS = 30;
const TOO_SLOW_SOUND = 0.05;
const SAMPLE_MS = 1000;
const FIRST_FRAME_SAMPLE_MS = 250;
const EVENTS_KEPT = 30;

export type Stat = Record<string, unknown> & { type? : string, id? : string };
export type StatsTrack = Track & { getRTCStatsReport? : () => Promise<RTCStatsReport | undefined> };
type Remote = TrackPublication & { isSubscribed? : boolean, isEnabled? : boolean, trackInfo? : { layers? : Array<{ quality? : number, width? : number, height? : number }> } };
// The main picture of a look: its frames decoded so far, whether it should be coming, what of it arrived and was lost
// since the last look, whether the media server holds it back (its stream state, paused for a download that cannot
// carry it), and how the media server rates its sender's connection (ConnectionQuality: excellent, good, poor, lost).
interface Main { video : VideoIn, frames : number, should : boolean, lost : number, got : number, paused : boolean, sender : string }
// The rest of a look, for the picture's judging: the sound's samples made up and played since the last look, and how the
// media server rates this viewer's connection.
interface Around { concealed : number, samples : number, mine : string }

export const num = ( v : unknown ) : number => Number( v ) || 0;
const QUALITIES : LayerQuality[] = [ 'low', 'medium', 'high' ];

// The layers a picture's sender sends, the best first, each size once.
export function layersOf( publication : TrackPublication | undefined ) : PictureLayer[] {
    const layers = ( publication as Remote | undefined )?.trackInfo?.layers ?? [];
    const out : PictureLayer[] = [];
    for( const layer of layers ){
        const quality = QUALITIES[ num( layer.quality ) ];
        if( ! quality || out.some( ( l ) => l.quality === quality ) ) continue;
        out.push( { quality, width: num( layer.width ), height: num( layer.height ) } );
    }
    return out.sort( ( a, b ) => QUALITIES.indexOf( b.quality ) - QUALITIES.indexOf( a.quality ) );
}

// The layers a viewer may choose of those sent, the best first: none above CHOSEN_MAX_SIDE (the protocol's), so Full
// HD comes only on auto, to a player that needs it (a big window, full screen), never by a choice that holds it there
// whatever the player's size. A layer whose size the sender doesn't say (an encoder over WHIP) stays.
export function choosableLayers( layers : PictureLayer[] ) : PictureLayer[] {
    return layers.filter( ( l ) => l.height === 0 || Math.min( l.width, l.height ) <= CHOSEN_MAX_SIDE );
}

// The layer that goes to a viewer who chose `choice`: that one, or where it is above CHOSEN_MAX_SIDE the largest
// below it. Where every layer is above it, the one chosen.
export function chosenLayer( choice : LayerQuality, layers : PictureLayer[] ) : LayerQuality {
    const asked = layers.find( ( l ) => l.quality === choice );
    const allowed = choosableLayers( layers );
    if( ! asked || allowed.includes( asked ) ) return choice;
    return allowed[ 0 ]?.quality ?? choice;
}

// The layer a picture this tall is, of those its sender sends: the nearest by height.
function layerAt( height : number, layers : PictureLayer[] ) : LayerQuality | null {
    const sized = layers.filter( ( l ) => l.height > 0 );
    if( height <= 0 || sized.length === 0 ) return null;
    return sized.reduce( ( best, l ) => Math.abs( l.height - height ) < Math.abs( best.height - height ) ? l : best ).quality;
}

interface Before {
    at : number;
    bytes : number;
    frames : number;
    lost : number;
    received : number;
    bufferDelay : number;
    emitted : number;
    concealed : number;
    samples : number;
}

export class PlaybackMonitor {
    private events : PlaybackEvent[] = [];
    private session : PlaybackSession = { startupMs: null, watchedMs: 0, stalls: 0, stalledMs: 0, reconnects: 0, rejoins: 0, errors: 0 };
    private room : Room | null = null;
    private server : MediaServer | null = null;
    private timer : ReturnType<typeof setTimeout> | null = null;
    private sampling = false;
    private before = new WeakMap<object, Before>();
    private video : VideoIn | null = null;
    private audio : AudioIn | null = null;
    private transport : TransportIn | null = null;
    // The first join of the session, which startup is counted from; when the room was last joined, for time watched.
    private joiningAt : number | null = null;
    private joinedAt : number | null = null;
    // The main picture's frames decoded as last looked at, its last new frame, and since when it shows none, while it
    // should.
    private lastFrames = -1;
    private progressAt : number | null = null;
    private stalledSince : number | null = null;
    // The main picture showing nothing new while it should, since when, what of it arrived and was lost meanwhile, the
    // sound's samples made up and played meanwhile, and whether it was said too much for the connection (onTooSlow).
    private slow : { since : number, lost : number, got : number, concealed : number, samples : number, said : boolean } | null = null;
    // Told once a picture shows nothing new while it should, too much for the connection (TOO_SLOW_MS).
    onTooSlow : ( () => void ) | null = null;

    constructor( private readonly onStalled : ( stalled : boolean ) => void, private readonly now : () => number = Date.now ){}

    note( kind : PlaybackEventKind, detail? : string ){
        this.events.push( { at: this.now(), kind, ...( detail ? { detail } : {} ) } );
        if( this.events.length > EVENTS_KEPT ) this.events.splice( 0, this.events.length - EVENTS_KEPT );
        if( kind === 'error' ) this.session.errors++;
        if( kind === 'reconnecting' ) this.session.reconnects++;
        if( kind === 'rejoined' ) this.session.rejoins++;
    }

    // Joining a room: the first since the session began starts the clock of how long the picture takes.
    joining(){
        if( this.joiningAt === null && this.session.startupMs === null ) this.joiningAt = this.now();
        this.note( 'joining' );
    }

    // The room joined at `url`: measured until end().
    begin( room : Room, url : string ){
        this.end();
        this.room = room;
        const info = ( room as Room & { engine? : { latestJoinResponse? : { serverInfo? : Record<string, unknown> } } } ).engine?.latestJoinResponse?.serverInfo;
        const text = ( v : unknown ) => typeof v === 'string' && v !== '' ? v : null;
        this.server = { url, node: text( info?.nodeId ), region: text( info?.region ), version: text( info?.version ) };
        this.joinedAt = this.now();
        this.progressAt = null;
        this.lastFrames = -1;
        this.slow = null;
        this.note( 'joined', url );
        this.schedule();
    }

    end(){
        if( this.timer ) clearTimeout( this.timer );
        this.timer = null;
        if( this.joinedAt !== null ) this.session.watchedMs += this.now() - this.joinedAt;
        this.joinedAt = null;
        this.room = null;
        this.resume();
        this.progressAt = null;
        this.slow = null;
    }

    snapshot() : PlaybackStats {
        const watching = this.joinedAt !== null ? this.now() - this.joinedAt : 0;
        const stalling = this.stalledSince !== null ? this.now() - this.stalledSince : 0;
        return {
            at: this.now(),
            server: this.server,
            video: this.video,
            audio: this.audio,
            transport: this.transport,
            session: { ...this.session, watchedMs: this.session.watchedMs + watching, stalledMs: this.session.stalledMs + stalling },
            events: [ ...this.events ]
        };
    }

    private schedule(){
        if( this.timer ) clearTimeout( this.timer );
        const delay = this.session.startupMs === null && this.joiningAt !== null ? FIRST_FRAME_SAMPLE_MS : SAMPLE_MS;
        this.timer = setTimeout( () => {
            this.timer = null;
            const room = this.room;
            if( ! room || this.sampling ) return;
            this.sampling = true;
            void this.sample( room ).catch( () => {} ).finally( () => {
                this.sampling = false;
                if( this.room === room ) this.schedule();
            } );
        }, delay );
    }

    // One look at what arrives: the picture with the most pixels coming is the main one.
    async sample( room : Room ){
        const at = this.now();
        let main : Main | null = null;
        let sound : AudioIn | null = null;
        let transport : TransportIn | null = null;
        const local = ( room as Room & { localParticipant? : { connectionQuality? : unknown } } ).localParticipant;
        const around : Around = { concealed: 0, samples: 0, mine: String( local?.connectionQuality ?? '' ) };

        for( const participant of room.remoteParticipants.values() ){
            const sender = String( ( participant as { connectionQuality? : unknown } ).connectionQuality ?? '' );
            for( const publication of participant.trackPublications.values() ){
                const remote = publication as Remote;
                const track = remote.track as StatsTrack | undefined;
                if( ! track?.getRTCStatsReport || remote.isSubscribed === false ) continue;
                const report = await track.getRTCStatsReport().catch( () => undefined );
                if( ! report || this.room !== room ) continue;

                const stats = new Map<string, Stat>();
                report.forEach( ( s : Stat ) => { if( s.id ) stats.set( s.id, s ); } );
                const inbound = [ ...stats.values() ].find( ( s ) => s.type === 'inbound-rtp' );
                if( ! inbound ) continue;
                transport ??= transportOf( stats );

                const before = this.before.get( track );
                const now = this.read( inbound, at );
                this.before.set( track, now );
                const seconds = before ? ( at - before.at ) / 1000 : 0;
                const delta = ( key : keyof Before ) => before ? now[ key ] - before[ key ] : 0;
                const kbps = seconds > 0 ? Math.max( 0, Math.round( delta( 'bytes' ) * 8 / seconds / 1000 ) ) : 0;
                const lost = delta( 'lost' ), got = delta( 'received' );
                const lossPct = lost > 0 && lost + got > 0 ? Math.round( lost / ( lost + got ) * 1000 ) / 10 : 0;
                const emitted = delta( 'emitted' );
                const bufferMs = emitted > 0 ? Math.round( delta( 'bufferDelay' ) / emitted * 1000 ) : 0;
                const codec = typeof inbound.codecId === 'string' ? stats.get( inbound.codecId ) : undefined;
                const codecName = typeof codec?.mimeType === 'string' ? codec.mimeType.replace( /^(video|audio)\//, '' ) : null;

                if( publication.kind === 'video' ){
                    const width = num( inbound.frameWidth ), height = num( inbound.frameHeight );
                    const layers = layersOf( publication );
                    const fps = num( inbound.framesPerSecond ) || ( seconds > 0 ? Math.round( delta( 'frames' ) / seconds ) : 0 );
                    const video : VideoIn = {
                        codec: codecName, width, height, fps, kbps,
                        layer: layerAt( height, layers ), layers,
                        lossPct, jitterMs: Math.round( num( inbound.jitter ) * 1000 ), bufferMs,
                        dropped: num( inbound.framesDropped ), freezes: num( inbound.freezeCount ), frozenMs: Math.round( num( inbound.totalFreezesDuration ) * 1000 ),
                        nacks: num( inbound.nackCount ), plis: num( inbound.pliCount ),
                        decoder: typeof inbound.decoderImplementation === 'string' ? inbound.decoderImplementation : null,
                        hardware: typeof inbound.powerEfficientDecoder === 'boolean' ? inbound.powerEfficientDecoder : null
                    };
                    // A picture should be coming while its sender sends it and the RTC client hasn't paused it for
                    // being out of sight. Not a shared screen: one where nothing moves may send no frame at all.
                    const should = ! publication.isMuted && remote.isEnabled !== false && String( publication.source ) !== 'screen_share';
                    const paused = ( track as StatsTrack & { streamState? : string } ).streamState === 'paused';
                    if( ! main || width * height > main.video.width * main.video.height ) main = { video, frames: now.frames, should, lost, got, paused, sender };
                } else if( publication.kind === 'audio' ){
                    const samples = delta( 'samples' );
                    around.concealed += delta( 'concealed' );
                    around.samples += samples;
                    sound = {
                        codec: codecName, kbps, lossPct, jitterMs: Math.round( num( inbound.jitter ) * 1000 ), bufferMs,
                        concealedPct: samples > 0 ? Math.round( delta( 'concealed' ) / samples * 1000 ) / 10 : 0
                    };
                }
            }
        }
        if( this.room !== room ) return;

        this.video = main?.video ?? null;
        this.audio = sound;
        this.transport = transport;
        this.follow( main, at, around );
    }

    // The first frame, and the main picture stalling and coming back. Without a picture nothing stalls; before its first
    // frame it is starting.
    private follow( main : Main | null, at : number, around : Around = { concealed: 0, samples: 0, mine: '' } ){
        if( ! main ){
            this.progressAt = null;
            this.slow = null;
            this.resume();
            return;
        }
        this.followSlow( main, at, around );
        if( main.frames === 0 ) return;
        if( this.session.startupMs === null && this.joiningAt !== null ){
            this.session.startupMs = at - this.joiningAt;
            this.joiningAt = null;
            this.note( 'first-frame', String( this.session.startupMs ) );
        }

        const sight = globalThis.document?.visibilityState !== 'hidden';
        const last = this.lastFrames;
        this.lastFrames = main.frames;
        if( main.frames !== last || ! main.should || ! sight ){
            this.progressAt = at;
            this.resume();
            return;
        }
        this.progressAt ??= at;
        if( this.stalledSince === null && at - this.progressAt >= STALL_MS ){
            this.stalledSince = this.progressAt;
            this.note( 'stalled' );
            this.onStalled( true );
        }
    }

    // Whether the main picture is too much for this viewer's connection (TOO_SLOW_MS), before its first frame too: a key
    // frame that never gets through shows none. Said once until it shows something new again or should no longer come.
    private followSlow( main : Main, at : number, around : Around ){
        const sight = globalThis.document?.visibilityState !== 'hidden';
        const moving = main.frames > 0 && main.frames !== this.lastFrames;
        if( moving || ! main.should || ! sight ){
            this.slow = null;
            return;
        }
        const slow = this.slow ??= { since: at, lost: 0, got: 0, concealed: 0, samples: 0, said: false };
        slow.lost += main.lost;
        slow.got += main.got;
        slow.concealed += around.concealed;
        slow.samples += around.samples;
        if( slow.said || at - slow.since < TOO_SLOW_MS ) return;

        const packets = slow.lost + slow.got;
        const weak = ( rating : string ) => rating === 'poor' || rating === 'lost';
        const lossy = packets >= TOO_SLOW_PACKETS && slow.lost / packets >= TOO_SLOW_LOSS
            && slow.samples > 0 && slow.concealed / slow.samples >= TOO_SLOW_SOUND
            && weak( around.mine ) && ! weak( main.sender );
        if( ! lossy && ! main.paused ) return;
        slow.said = true;
        this.note( 'too-slow', main.paused ? 'paused' : Math.round( slow.lost / packets * 100 ) + '%' );
        this.onTooSlow?.();
    }

    private resume(){
        if( this.stalledSince === null ) return;
        const ms = this.now() - this.stalledSince;
        this.stalledSince = null;
        this.session.stalls++;
        this.session.stalledMs += ms;
        this.note( 'resumed', String( ms ) );
        this.onStalled( false );
    }

    private read( inbound : Stat, at : number ) : Before {
        return {
            at,
            bytes: num( inbound.bytesReceived ),
            frames: num( inbound.framesDecoded ),
            lost: num( inbound.packetsLost ),
            received: num( inbound.packetsReceived ),
            bufferDelay: num( inbound.jitterBufferDelay ),
            emitted: num( inbound.jitterBufferEmittedCount ),
            concealed: num( inbound.concealedSamples ),
            samples: num( inbound.totalSamplesReceived )
        };
    }
}

// The candidate pair in use, of a report's.
export function pairOf( stats : Map<string, Stat> ) : Stat | undefined {
    const all = [ ...stats.values() ];
    const selected = all.find( ( s ) => s.type === 'transport' && typeof s.selectedCandidatePairId === 'string' );
    return ( selected ? stats.get( selected.selectedCandidatePairId as string ) : undefined )
        ?? all.find( ( s ) => s.type === 'candidate-pair' && ( s.selected === true || ( s.nominated === true && s.state === 'succeeded' ) ) );
}

// The candidate pair in use: its round trip, and how the local side reaches the server.
export function transportOf( stats : Map<string, Stat> ) : TransportIn | null {
    const pair = pairOf( stats );
    if( ! pair ) return null;
    const local = typeof pair.localCandidateId === 'string' ? stats.get( pair.localCandidateId ) : undefined;
    const rtt = Number( pair.currentRoundTripTime );
    return {
        protocol: typeof local?.protocol === 'string' ? local.protocol : null,
        relayed: typeof local?.candidateType === 'string' ? local.candidateType === 'relay' : null,
        relayProtocol: typeof local?.relayProtocol === 'string' ? local.relayProtocol : null,
        rttMs: Number.isFinite( rtt ) && rtt > 0 ? Math.round( rtt * 1000 ) : null
    };
}
