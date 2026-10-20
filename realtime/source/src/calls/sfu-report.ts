import { browserLabel, platformLabel } from "./platform.js";
import { randomId } from "./types.js";
import type { CallId, CallTransport } from "./transport.js";

// A livekit-client Room, as far as this reads it: its two peer connections'
// stats. The package doesn't depend on livekit-client for one type.
export interface ReportableRoom {
    engine?: { pcManager?: { publisher?: { getStats(): Promise<RTCStatsReport> }, subscriber?: { getStats(): Promise<RTCStatsReport> } } };
}

/**
 * What a one-to-one call that runs over LiveKit was between.
 *
 * A direct call reports this from its own peer connection, which is how the
 * record can be read afterwards as "this went straight there" or "this went
 * through the relay". A call that never took the direct path — a browser that
 * asked for `transport: sfu`, or one that gave up and handed off — had no such
 * report at all, so exactly the calls most worth looking at said nothing about
 * themselves. The server accepts the same `report` op from a participant of an
 * SFU-mode record without a joined session, and this sends it.
 *
 * The leg described is the one this side actually has: client to SFU. Both of
 * LiveKit's peer connections are read and the first selected pair wins, since
 * they run over the same transport.
 */

const REPORT_INTERVAL = 15_000;

interface Pair {
    local: string;
    remote: string;
    protocol: string;
}

function pairFrom( report: RTCStatsReport | undefined ): Pair | null {
    if( ! report ) return null;

    const byId = new Map<string, any>();

    report.forEach( ( entry: any ) => {
        if( entry && entry.id ) byId.set( entry.id, entry );
    } );

    let pair: Pair | null = null;

    report.forEach( ( entry: any ) => {
        if( pair ) return;
        if( entry.type !== 'candidate-pair' ) return;
        if( entry.state !== 'succeeded' ) return;
        if( ! entry.selected && ! entry.nominated ) return;

        const local = byId.get( entry.localCandidateId );
        const remote = byId.get( entry.remoteCandidateId );

        pair = {
            local: local ? String( local.candidateType ?? '' ) : '',
            remote: remote ? String( remote.candidateType ?? '' ) : '',
            protocol: local ? String( local.relayProtocol ?? local.protocol ?? '' ) : ''
        };
    } );

    return pair;
}

export class SfuReporter {
    private readonly session = randomId( 16 );
    private sent = '';
    private sentAt = 0;
    private closed = false;

    constructor( private readonly transport: CallTransport, private readonly callId: CallId ) {}

    close(): void {
        this.closed = true;
    }

    // `carried` is what the direct path had moved before the hand-off, so
    // the room leg's counters say what the whole call carried rather than
    // starting the call over at zero.
    async report( room: ReportableRoom | null, bytesSent: number, bytesReceived: number, final = false, carried: { sent: number, recv: number } = { sent: 0, recv: 0 } ): Promise<void> {
        if( this.closed && ! final ) return;
        if( ! room || ! this.callId ) return;
        if( ! this.transport.connected ) return;

        const manager = room.engine?.pcManager;

        if( ! manager ) return;

        let pair: Pair | null = null;

        try {
            pair = pairFrom( await manager.publisher?.getStats() );

            if( ! pair ) pair = pairFrom( await manager.subscriber?.getStats() );
        } catch (e) {
            return;
        }

        if( ! pair ) return;

        const report = {
            browser: browserLabel(),
            platform: platformLabel(),
            client: 'web',
            // Which leg this is. Without it the relay filed this over the
            // direct path's report, and a call that fell over kept only the
            // room's account of itself.
            leg: 'sfu',
            path: ( pair.local === 'relay' || pair.remote === 'relay' ) ? 'relay' : 'direct',
            candidate: pair,
            restarts: 0,
            bytes: { sent: Math.round( bytesSent + carried.sent ), recv: Math.round( bytesReceived + carried.recv ) }
        };

        const signature = JSON.stringify( { ...report, bytes: null } );
        const now = Date.now();

        if( ! final && signature === this.sent && now - this.sentAt < REPORT_INTERVAL ) return;

        this.sent = signature;
        this.sentAt = now;

        try {
            this.transport.send( {
                op: 'report',
                call_id: this.callId,
                session: this.session,
                report
            } );
        } catch (e) {}
    }
}
