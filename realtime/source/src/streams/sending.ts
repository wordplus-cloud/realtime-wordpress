import type {Room, TrackPublication} from "@wordplus/rtc-client";
import type {AudioOut, LayerOut, SendLimit, SendingStats, TransportOut, VideoOut} from "./playback-types.js";
import {num, pairOf, transportOf, type Stat, type StatsTrack} from "./playback.js";

// What a host sends, to debug a stream that goes out badly: each picture (the camera, a shared screen) layer by layer,
// with what the encoder makes it with and what holds it back, the sound with the microphone's level, what the media
// server reports of both (loss and the round trip), and the way out with the bandwidth the browser estimates it has.
// Read from the browser's statistics of each sender (RTCStatsReport) when asked, two reads making the rates. Nothing is
// sent anywhere. What it answers is plain data, in playback-types.ts.

type Local = TrackPublication & { isMuted? : boolean };
type Sender = { getParameters? : () => { encodings? : Array<{ rid? : string, active? : boolean, scaleResolutionDownBy? : number }> } };

interface Before {
    at : number;
    bytes : number;
    resent : number;
}

// Of the same size, the layer the RTC client names larger first: full, half, quarter.
const RIDS = [ 'f', 'h', 'q' ];

const limitOf = ( reason : unknown ) : SendLimit => reason === 'bandwidth' || reason === 'cpu' || reason === 'other' ? reason : null;
const codecOf = ( stats : Map<string, Stat>, id : unknown ) : string | null => {
    const codec = typeof id === 'string' ? stats.get( id ) : undefined;
    return typeof codec?.mimeType === 'string' ? codec.mimeType.replace( /^(video|audio)\//, '' ) : null;
};
const percentOf = ( fraction : unknown ) : number => Math.round( num( fraction ) * 1000 ) / 10;
const msOf = ( seconds : unknown ) : number | null => {
    const s = Number( seconds );
    return Number.isFinite( s ) && s > 0 ? Math.round( s * 1000 ) : null;
};

export class SendingReader {
    private before = new Map<string, Before>();

    constructor( private readonly now : () => number = Date.now ){}

    async read( room : Room ) : Promise<SendingStats | null> {
        const at = this.now();
        const video : VideoOut[] = [];
        let audio : AudioOut | null = null;
        let transport : TransportOut | null = null;
        const seen = new Set<string>();

        for( const publication of room.localParticipant.trackPublications.values() ){
            const local = publication as Local;
            const track = local.track as StatsTrack | undefined;
            if( ! track?.getRTCStatsReport ) continue;
            const report = await track.getRTCStatsReport().catch( () => undefined );
            if( ! report ) continue;

            const stats = new Map<string, Stat>();
            report.forEach( ( s : Stat ) => { if( s.id ) stats.set( s.id, s ); } );
            const outbound = [ ...stats.values() ].filter( ( s ) => s.type === 'outbound-rtp' );
            if( outbound.length === 0 ) continue;
            transport ??= this.transportOut( stats );

            if( publication.kind === 'video' ){
                if( local.isMuted ) continue;
                video.push( this.picture( publication, track, stats, outbound, at, seen ) );
            } else if( publication.kind === 'audio' ){
                audio = this.sound( local, stats, outbound[ 0 ]!, at, seen );
            }
        }

        // What no longer goes out isn't kept.
        for( const key of this.before.keys() ) if( ! seen.has( key ) ) this.before.delete( key );

        if( video.length === 0 && ! audio ) return null;
        // The screen first: while it is shared, it is what the stream shows.
        video.sort( ( a, b ) => ( a.source === 'screen' ? 0 : 1 ) - ( b.source === 'screen' ? 0 : 1 ) );
        return { at, video, audio, transport };
    }

    private picture( publication : TrackPublication, track : StatsTrack, stats : Map<string, Stat>, outbound : Stat[], at : number, seen : Set<string> ) : VideoOut {
        // The layers the media server keeps on, by their name, where the browser's statistics don't say, and how much
        // smaller than what is captured each is.
        const encodings = ( ( track as unknown as { sender? : Sender } ).sender?.getParameters?.().encodings ) ?? [];
        const on = new Map( encodings.filter( ( e ) => e.rid ).map( ( e ) => [ e.rid!, e.active !== false ] ) );
        const scale = new Map( encodings.filter( ( e ) => e.rid && num( e.scaleResolutionDownBy ) >= 1 ).map( ( e ) => [ e.rid!, num( e.scaleResolutionDownBy ) ] ) );

        const first = outbound[ 0 ]!;
        const source = typeof first.mediaSourceId === 'string' ? stats.get( first.mediaSourceId ) : [ ...stats.values() ].find( ( s ) => s.type === 'media-source' );
        const captured = source && num( source.width ) > 0 ? { width: num( source.width ), height: num( source.height ), fps: Math.round( num( source.framesPerSecond ) ) } : null;

        const layers = outbound.map( ( out ) : LayerOut => {
            const rid = typeof out.rid === 'string' ? out.rid : null;
            const remote = typeof out.remoteId === 'string' ? stats.get( out.remoteId ) : undefined;
            const { kbps, resentKbps } = this.rates( track.sid + ':' + ( rid ?? out.ssrc ), out, at, seen );
            const target = num( out.targetBitrate );
            // A layer turned off says no size of its own: the size it goes out at once on, by its scale.
            const down = rid !== null ? scale.get( rid ) : undefined;
            const scaled = num( out.frameHeight ) === 0 && captured && down ? { width: Math.round( captured.width / down ), height: Math.round( captured.height / down ) } : null;
            return {
                rid,
                active: typeof out.active === 'boolean' ? out.active : rid !== null ? on.get( rid ) ?? true : true,
                width: scaled?.width ?? num( out.frameWidth ),
                height: scaled?.height ?? num( out.frameHeight ),
                fps: Math.round( num( out.framesPerSecond ) ),
                kbps,
                targetKbps: target > 0 ? Math.round( target / 1000 ) : null,
                resentKbps,
                limited: limitOf( out.qualityLimitationReason ),
                encoder: typeof out.encoderImplementation === 'string' ? out.encoderImplementation : null,
                hardware: typeof out.powerEfficientEncoder === 'boolean' ? out.powerEfficientEncoder : null,
                lossPct: percentOf( remote?.fractionLost ),
                rttMs: msOf( remote?.roundTripTime ),
                nacks: num( out.nackCount ),
                plis: num( out.pliCount ),
                firs: num( out.firCount )
            };
        } ).sort( ( a, b ) => b.height - a.height || RIDS.indexOf( a.rid ?? '' ) - RIDS.indexOf( b.rid ?? '' ) );

        // The time held back is the encoder's, the same on every layer.
        const durations = ( outbound.find( ( o ) => o.qualityLimitationDurations )?.qualityLimitationDurations ?? {} ) as Record<string, unknown>;

        return {
            source: String( publication.source ) === 'screen_share' ? 'screen' : 'camera',
            codec: codecOf( stats, first.codecId ),
            capture: captured,
            layers,
            kbps: layers.reduce( ( sum, l ) => sum + l.kbps, 0 ),
            limitedMs: { bandwidth: Math.round( num( durations.bandwidth ) * 1000 ), cpu: Math.round( num( durations.cpu ) * 1000 ), other: Math.round( num( durations.other ) * 1000 ) }
        };
    }

    private sound( publication : Local, stats : Map<string, Stat>, out : Stat, at : number, seen : Set<string> ) : AudioOut {
        const remote = typeof out.remoteId === 'string' ? stats.get( out.remoteId ) : undefined;
        const source = typeof out.mediaSourceId === 'string' ? stats.get( out.mediaSourceId ) : [ ...stats.values() ].find( ( s ) => s.type === 'media-source' );
        const level = Number( source?.audioLevel );
        return {
            codec: codecOf( stats, out.codecId ),
            kbps: this.rates( ( publication.trackSid ?? 'audio' ) + ':' + out.ssrc, out, at, seen ).kbps,
            lossPct: percentOf( remote?.fractionLost ),
            jitterMs: Math.round( num( remote?.jitter ) * 1000 ),
            rttMs: msOf( remote?.roundTripTime ),
            level: Number.isFinite( level ) ? Math.round( level * 100 ) / 100 : null,
            muted: publication.isMuted === true
        };
    }

    // Bits a second since the last read, all of them and those sent again.
    private rates( key : string, out : Stat, at : number, seen : Set<string> ) : { kbps : number, resentKbps : number } {
        seen.add( key );
        const now = { at, bytes: num( out.bytesSent ), resent: num( out.retransmittedBytesSent ) };
        const before = this.before.get( key );
        this.before.set( key, now );
        const seconds = before ? ( at - before.at ) / 1000 : 0;
        if( ! before || seconds <= 0 ) return { kbps: 0, resentKbps: 0 };
        const rate = ( bytes : number ) => Math.max( 0, Math.round( bytes * 8 / seconds / 1000 ) );
        return { kbps: rate( now.bytes - before.bytes ), resentKbps: rate( now.resent - before.resent ) };
    }

    private transportOut( stats : Map<string, Stat> ) : TransportOut | null {
        const transport = transportOf( stats );
        if( ! transport ) return null;
        const available = num( pairOf( stats )?.availableOutgoingBitrate );
        return { ...transport, availableKbps: available > 0 ? Math.round( available / 1000 ) : null };
    }
}
