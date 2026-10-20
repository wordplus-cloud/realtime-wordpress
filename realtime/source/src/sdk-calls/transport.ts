/**
 * The call engine's way to the relay on the realtime SDK's connection: the
 * `/channels` socket every tab and plugin of the browser shares, whose `call` request carries the call's token, since
 * the socket is the browser's and not one user's. One per call.
 */
import type { Channel } from '../channel.js';
import type { CallId, CallTransport, RelayMessage } from '../calls/transport.js';

/** How long the transport lets a request wait for its answer; the engine keeps its own clock under it. */
const ANSWER_MS = 10_000;

/** Hands each call's session the relay's events for it: every tab on the socket hears all of them. */
export class CallDispatcher {
    private readonly handlers = new Map<string, (message: RelayMessage) => void>();

    constructor(socket: Channel) {
        socket.on('call', (message: RelayMessage) => {
            if (!message || typeof message !== 'object') return;
            this.handlers.get(String(message.call_id) + ':' + String(message.session))?.(message);
        });
    }

    add(callId: CallId, session: string, handler: (message: RelayMessage) => void): () => void {
        const key = String(callId) + ':' + session;
        this.handlers.set(key, handler);
        return () => {
            if (this.handlers.get(key) === handler) this.handlers.delete(key);
        };
    }
}

export interface SdkTransportOptions {
    socket: Channel;
    tab: string;
    dispatcher: CallDispatcher;
    /** The call's token as it is now: renewed while the call runs. */
    token: () => string;
    /** The relay's address for the leave a closing page sends, `https://rest.wordplus.cloud/` by default. */
    api?: string;
    site: string;
    /** Called with each connect after a drop and each move, so the call joins on the socket it has now. */
    onSocketChange: (listener: () => void) => () => void;
}

export class SdkCallTransport implements CallTransport {
    readonly available = true;
    /** The room the relay names for a call that leaves the direct path, kept from its replies (`sfu.server`). */
    server: string | null = null;

    constructor(private readonly options: SdkTransportOptions) {}

    get connected(): boolean {
        return this.options.socket.connected;
    }

    send(payload: RelayMessage, ack?: (response: any) => void): void {
        const request = { tab: this.options.tab, token: this.options.token(), ...payload };
        if (!ack) {
            this.options.socket.emit('call', request);
            return;
        }
        this.options.socket
            .timeout(ANSWER_MS)
            .emitWithAck('call', request)
            .then((reply: any) => ack(this.withServer(reply)))
            // Unanswered: the engine's own clock tries again.
            .catch(() => {});
    }

    listen(callId: CallId, session: string, handler: (message: RelayMessage) => void): () => void {
        return this.options.dispatcher.add(callId, session, (message) => handler(this.withServer(message)));
    }

    onReconnect(listener: () => void): () => void {
        return this.options.onSocketChange(listener);
    }

    beacon(callId: CallId, session: string): void {
        if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
        const api = (this.options.api ?? 'https://rest.wordplus.cloud/').replace(/\/+$/, '');
        const body = JSON.stringify({ site: this.options.site, token: this.options.token(), call_id: callId, session });
        navigator.sendBeacon(api + '/wordplus/realtime/call/leave', new Blob([body], { type: 'text/plain' }));
    }

    /** A room handed over without its server (the relay's `fallback` event) is on the one the replies named. */
    private withServer<T>(message: T): T {
        const sfu = (message as any)?.sfu;
        if (!sfu || typeof sfu !== 'object') return message;
        if (typeof sfu.server === 'string' && sfu.server) this.server = sfu.server;
        else if (this.server) return { ...(message as any), sfu: { ...sfu, server: this.server } };
        return message;
    }
}
