import type {CallId, CallTransport} from "./transport.js";
import {
    AliveAck,
    FailedAck,
    IceAck,
    JoinAck,
    PulseAck,
    PulseBody,
    randomId,
    SealedSignal,
    ServerMessage,
    SignalAck,
    SignalBody,
    SyncAck
} from "./types.js";

const ACK_TIMEOUT = 8000;

// How long a signal waits for the socket to come back. It used to count
// every second the socket was down as one of its five attempts, so a signal
// made during an outage of more than four seconds was dropped for good — and
// an ICE restart offer lost that way left its side with an offer nobody would
// answer, from which no restart makes another. The relay gives a side whose
// socket has gone this long to return, and a signal waits for it as long.
const SIGNAL_OFFLINE_WAIT = 45000;

// A callee that accepted and then could not join tells the relay, which ends
// the call at the caller as well: the caller stops ringing and waits once the
// acceptance arrives, and it waited on a join that was never coming until it
// hung up. The relay takes a leave from a participant that has not joined,
// so a throwaway session does.
export function leaveUnjoined( transport: CallTransport, callId: CallId, reason: string ): void {
    try {
        transport.send( { op: 'leave', call_id: callId, session: randomId( 16 ), reason } );
    } catch (e) {}
}

export class P2PSignaling {
    readonly session: string = randomId( 16 );
    private queue: Promise<unknown> = Promise.resolve();
    private closed = false;
    private readonly stopListening: () => void;

    constructor(
        readonly transport: CallTransport,
        readonly callId: CallId,
        private readonly onMessage: ( message: ServerMessage ) => void
    ) {
        this.stopListening = transport.listen( callId, this.session, ( message ) => {
            if( this.closed ) return;
            this.onMessage( message as unknown as ServerMessage );
        } );
    }

    get connected(): boolean {
        return this.transport.connected;
    }

    get isClosed(): boolean {
        return this.closed;
    }

    // `offlineWait` is how long the request may sit out a socket that is down
    // before the seconds start counting as attempts.
    private request<T extends { ok: boolean }>( payload: Record<string, unknown>, attempts = 3, offlineWait = 0 ): Promise<T> {
        return new Promise<T>( ( resolve, reject ) => {
            let waited = 0;

            const attempt = ( n: number ) => {
                if( this.closed ){
                    reject( new Error( 'closed' ) );
                    return;
                }

                if( ! this.connected ){
                    if( waited < offlineWait ){
                        waited += 1000;
                        window.setTimeout( () => attempt( n ), 1000 );
                    } else if( n < attempts ){
                        window.setTimeout( () => attempt( n + 1 ), 1000 );
                    } else {
                        reject( new Error( 'socket_disconnected' ) );
                    }

                    return;
                }

                let settled = false;

                const timer = window.setTimeout( () => {
                    if( settled ) return;
                    settled = true;

                    if( n < attempts ){
                        attempt( n + 1 );
                    } else {
                        reject( new Error( 'ack_timeout' ) );
                    }
                }, ACK_TIMEOUT );

                this.transport.send( { ...payload, call_id: this.callId, session: this.session }, ( response: T ) => {
                    if( settled ) return;
                    settled = true;
                    window.clearTimeout( timer );
                    resolve( response );
                } );
            };

            attempt( 1 );
        } );
    }

    join( params: { epoch: number; last_id: string | null; resume?: boolean; fresh?: boolean } ): Promise<JoinAck> {
        return this.request<JoinAck>( { op: 'join', ...params } );
    }

    signal( generation: number, body: SignalBody | SealedSignal ): Promise<SignalAck> {
        const nonce = randomId( 16 );
        const task = () => this.request<SignalAck>( { op: 'signal', generation, nonce, body }, 5, SIGNAL_OFFLINE_WAIT );
        const next = this.queue.then( task, task );

        this.queue = next.catch( () => undefined );

        return next;
    }

    sync( lastId: string | null ): Promise<SyncAck> {
        return this.request<SyncAck>( { op: 'sync', last_id: lastId } );
    }

    // Asked for on the way into an ICE restart, which must not wait on it:
    // one attempt, and the restart races it against a short clock and goes
    // on with the credentials it has.
    iceServers(): Promise<IceAck> {
        return this.request<IceAck>( { op: 'ice_servers' }, 1 );
    }

    alive(): Promise<AliveAck> {
        return this.request<AliveAck>( { op: 'alive' }, 1 );
    }

    // This side's counters, every couple of seconds while the direct path
    // runs; the reply carries the other side's and, when the relay has
    // judged the path dead, the room. One attempt: the next pulse is two
    // seconds away.
    pulse( pulse: PulseBody ): Promise<PulseAck> {
        return this.request<PulseAck>( { op: 'pulse', pulse }, 1 );
    }

    // What this side is running the call on, for the call record. Best
    // effort: a call is not worth failing over its own bookkeeping.
    report( report: unknown ): Promise<{ ok: boolean }> {
        return this.request<{ ok: boolean }>( { op: 'report', report }, 1 );
    }

    // What this side saw, for the call's readable trace. A report only exists
    // for a call that got far enough to have one, and the calls worth reading
    // about are the ones that did not: this goes out while it is happening.
    // Nothing waits on it, but a batch that a hiccup swallows is the account
    // of the very seconds worth reading, so it is tried three times and the
    // session puts a batch that still failed back in front of the next one.
    trace( lines: string[] ): Promise<{ ok: boolean }> {
        return this.request<{ ok: boolean }>( { op: 'trace', lines }, 3 );
    }

    // Waits out an outage like a signal: the relay learning of it is what
    // moves the other side, and a side that gave up while its socket was
    // down used to leave the other one on a dead direct path.
    failed( reason: string ): Promise<FailedAck> {
        return this.request<FailedAck>( { op: 'failed', reason }, 3, SIGNAL_OFFLINE_WAIT );
    }

    leave( reason: string ): Promise<{ ok: boolean }> {
        return this.request<{ ok: boolean }>( { op: 'leave', reason }, 2 );
    }

    close(): void {
        this.closed = true;
        this.stopListening();
    }
}
