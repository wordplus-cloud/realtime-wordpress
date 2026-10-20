/**
 * A product's connection to the realtime server that moves make before break:
 * when the server sends `migrate`, it opens a socket to the node named, waits
 * until that socket is ready to take over (connected, and for Easy Stream its
 * `hello`), switches to it, and only then closes the old one. The product
 * never drops to zero sockets and misses nothing, so it needs no catch-up.
 * The handshake says which protocol it speaks (`rt`).
 *
 * - `direct`: the server offers a node to a socket that came in through the
 *   realtime server itself (the load balancer). The node is kept at once with
 *   one other node of the offer's, so the next page load connects to it
 *   directly even if this one closes before it moves. No offer is taken while
 *   direct connections are paused.
 * - `drain`, `drain_retry` and `direct_off`: to the node named, else the
 *   realtime server itself, paused or not.
 *
 * Every socket it makes is the product's to listen on (`attach`), and an event
 * counts only while its socket is the current one (`isCurrent`): a move's new
 * socket hears the room before it takes over, and the old one after.
 *
 * The node cache (node-cache.ts) is the one every product shares on a page: by
 * default localStorage under STORE_KEY, for the realtime server it came from.
 * A node that fails a connect is passed over for the next cached node, then
 * the realtime server itself. A move to an offered node that fails while the
 * old socket is on the realtime server pauses direct connections for an hour,
 * and so does a site's CSP that blocks a node, at once.
 */
import { io as socketIo, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import { pendingReplies, REPLY_WAIT_MS, REPLY_WAITS } from './direct-socket.js';
import {
    type MigrateRequest, NodeCacheKeeper, type NodeStore, SERVER_CONNECT_TIMEOUT_MS, connectTimeout, hostOf, localNodeStore,
    migrateSpread, migrateTarget, pointAt, sameServer, urlOf,
} from './node-cache.js';

/** The connection protocol this client speaks, sent as `rt` in every handshake. */
export const PROTOCOL = 1;

/** Where the node cache is kept by default: one key for every product of the page. */
export const STORE_KEY = 'wordplus-realtime-nodes';

/** How long a move waits for its new socket to connect, then to be ready to take over. */
export const MOVE_CONNECT_MS = 10000;
export const MOVE_READY_MS = 10000;

export interface RealtimeConnectionOptions {
    /** The realtime server's own URL, which its load balancer answers: https://ws.wordplus.cloud. */
    server: string;
    /** The product's namespace, such as /estream; the main one by default. */
    namespace?: string;
    /** The Socket.IO path, such as /websocket. */
    path?: string;
    /** The product's handshake, asked for at every connect, so a renewed token goes with the next. `rt` is added. */
    auth: () => Record<string, unknown>;
    /** Every socket the connection makes, before it connects: the product's listeners go on it here. */
    attach: (socket: Socket, isCurrent: () => boolean) => void;
    /** When a move's new socket may take over, once it has connected: at once by default. Easy Stream waits for its `hello`. */
    ready?: (socket: Socket) => Promise<unknown>;
    /** A move's new socket took over, with what `ready` gave. The old one closes once its replies are in. */
    moved?: (socket: Socket, ready: unknown) => void;
    /** Where the node cache lives: localStorage under STORE_KEY by default; null keeps it in memory. */
    store?: NodeStore | null;
    /** Socket.IO's own options for every socket, such as reconnectionDelayMax. */
    options?: Partial<ManagerOptions & SocketOptions>;
    /** Stand-ins for tests. */
    io?: typeof socketIo;
    random?: () => number;
}

export class RealtimeConnection {
    /** The socket the product sends on, which a move replaces. */
    socket: Socket;

    private readonly nodes = new NodeCacheKeeper();
    private readonly io: typeof socketIo;
    private readonly random: () => number;
    private readonly timers = new Set<ReturnType<typeof setTimeout>>();

    /** A move's new socket, until it takes over; a `migrate` it hears meanwhile waits for that. */
    private moving: Socket | null = null;
    private deferred: MigrateRequest | null = null;
    private failMove: ((error: Error) => void) | null = null;
    private closed = false;
    private stopWatchingCsp: (() => void) | null = null;
    /** A store read at once (localStorage, memory): a direct offer needs no wait for a read. */
    private readonly storeReadsAtOnce: boolean;

    constructor(private readonly options: RealtimeConnectionOptions) {
        this.io = options.io ?? socketIo;
        this.random = options.random ?? Math.random;
        const store = options.store === null ? null : options.store ?? localNodeStore(STORE_KEY);
        this.storeReadsAtOnce = !store || !!store.readNow;
        if (store) this.nodes.setStore(store);

        // The first cached node, unless direct connections are paused, else the realtime server itself.
        const url = this.nodes.first(options.server);
        this.socket = this.open(url, connectTimeout(url, options.server), true);
        this.watchCsp();
    }

    /** Closes the connection and any move under way. */
    close(): void {
        this.closed = true;
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        this.failMove?.(new Error('closed'));
        this.moving?.close();
        this.moving = null;
        this.socket.close();
        this.stopWatchingCsp?.();
    }

    /** The nodes kept for the next connections, best first: none while paused. */
    keptNodes(): string[] {
        return this.nodes.fresh(this.options.server);
    }

    private open(url: string, timeout: number, reconnect: boolean): Socket {
        const { server, namespace = '/', path } = this.options;
        const socket = this.io(url.replace(/\/+$/, '') + (namespace === '/' ? '' : namespace), {
            ...this.options.options,
            ...(path ? { path } : {}),
            auth: (cb: (data: object) => void) => cb({ ...this.options.auth(), rt: PROTOCOL }),
            // A manager of its own: moving one socket must not move another product's.
            forceNew: true,
            autoConnect: false,
            reconnection: reconnect,
            timeout,
        });

        // Its manager's URL, which reconnects use, without the namespace, as the server names nodes.
        pointAt(socket, url, server, timeout);
        this.watch(socket);
        this.options.attach(socket, () => !this.closed && socket === this.socket);
        socket.connect();
        return socket;
    }

    private watch(socket: Socket): void {
        const server = this.options.server;

        socket.on('migrate', (request: MigrateRequest) => this.onMigrate(socket, request));

        socket.on('nodes', (payload: { nodes?: unknown } | undefined) => {
            if (this.closed || (socket !== this.socket && socket !== this.moving)) return;
            this.nodes.update(server, payload?.nodes);
        });

        socket.on('connect', () => {
            if (this.closed || socket !== this.socket) return;
            const url = urlOf(socket);
            this.nodes.reached(url, server);
            // Its reconnects wait as long as any connect to where it is now.
            pointAt(socket, url, server);
        });

        // A connection that failed: the next cached node, then the realtime server. A refusal by the
        // server (the product's own handshake, a token run out) leaves the socket inactive, and is
        // the product's to answer, not a node's failure.
        socket.on('connect_error', () => {
            if (this.closed || socket !== this.socket || !socket.active) return;
            pointAt(socket, this.nodes.failed(urlOf(socket), server), server);
        });
    }

    private onMigrate(socket: Socket, request: MigrateRequest): void {
        if (this.closed) return;

        // The new socket of a move under way: after it takes over.
        if (socket === this.moving) {
            this.deferred = request;
            return;
        }
        if (socket !== this.socket) return;

        // A direct offer is decided on the stored cache: a pause another tab or product stored holds,
        // however slow the store's first read.
        if (request?.reason === 'direct' && !this.storeReadsAtOnce) {
            void this.nodes.ready().then(() => this.startMove(socket, request));
            return;
        }

        this.startMove(socket, request);
    }

    private startMove(socket: Socket, request: MigrateRequest): void {
        const server = this.options.server;
        if (this.closed || socket !== this.socket) return;

        const direct = request?.reason === 'direct';
        if (direct && this.nodes.paused(server)) return;

        // A direct offer it can't use leaves the socket where it is (migrateTarget).
        const target = migrateTarget(request, server, urlOf(socket));
        if (!target) return;

        // Should this socket drop before its move, it reconnects there too, rather than to a node going away.
        pointAt(socket, target, server);
        if (direct) this.nodes.offered(target, server, request?.nodes);
        else this.nodes.remember(target, server, request?.nodes);

        this.later(() => void this.moveTo(socket, target, request), this.random() * migrateSpread(request));
    }

    private async moveTo(from: Socket, target: string, request: MigrateRequest): Promise<void> {
        const server = this.options.server;
        if (this.closed || this.moving || this.socket !== from) return;

        const direct = request?.reason === 'direct';
        // A move to an offered node that fails pauses direct connections, so it waits as long as a
        // connect to the realtime server does: a slow network is not a blocked one.
        const next = this.open(target, direct ? SERVER_CONNECT_TIMEOUT_MS : connectTimeout(target, server), false);
        this.moving = next;
        this.deferred = null;

        // Asked at once, so nothing the new socket hears after its connect is missed.
        const ready = this.options.ready ? this.options.ready(next) : Promise.resolve(undefined);
        ready.catch(() => {});

        let connected = false;
        try {
            await this.connected(next);
            connected = true;
            const value = await this.within(ready, MOVE_READY_MS, 'not ready');

            // Closed, or the old socket replaced, meanwhile.
            if (this.closed || this.socket !== from) throw new Error('stopped during the move');

            this.socket = next;
            this.moving = null;
            next.io.reconnection(true);
            // Its reconnects wait for its node no longer than any connect to a node.
            pointAt(next, target, server);
            this.nodes.remember(target, server, request?.nodes);
            // Its connect came before it took over, so the handlers skipped it.
            this.nodes.reached(target, server);

            this.options.moved?.(next, value);
            this.retire(from);

            const deferred = this.deferred;
            this.deferred = null;
            if (deferred) this.onMigrate(next, deferred);
        } catch {
            if (this.moving === next) this.moving = null;
            this.deferred = null;
            next.close();
            if (this.closed) return;

            // Where the old socket reconnects should it drop: the realtime server, which it reached
            // before, rather than a target it could not; after a drain's target, the drain's next node.
            // A direct offer's node that doesn't connect while the server answers pauses direct
            // connections. One that connected but never got ready is no sign against the node.
            let fallback = server;
            if (!connected && !sameServer(target, server)) {
                if (!direct) fallback = this.nodes.failed(target, server);
                else if (this.socket === from && from.connected) this.nodes.pause(server);
                else this.nodes.failed(target, server);
            }

            if (this.socket === from && from.active) pointAt(from, fallback, server);
        }
    }

    /** Resolves when the socket connects; rejects when it fails, the move is called off, or the time is up. */
    private connected(socket: Socket): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const done = (error?: Error) => {
                clearTimeout(timer);
                this.timers.delete(timer);
                socket.off('connect', onConnect);
                socket.off('connect_error', onError);
                this.failMove = null;
                if (error) reject(error);
                else resolve();
            };
            const onConnect = () => done();
            const onError = (error: Error) => done(error);
            const timer = setTimeout(() => done(new Error('connect timeout')), MOVE_CONNECT_MS);
            this.timers.add(timer);
            this.failMove = done;
            socket.once('connect', onConnect);
            socket.once('connect_error', onError);
        });
    }

    private within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.timers.delete(timer);
                reject(new Error(message));
            }, ms);
            this.timers.add(timer);
            promise.then((value) => {
                clearTimeout(timer);
                this.timers.delete(timer);
                resolve(value);
            }, (error) => {
                clearTimeout(timer);
                this.timers.delete(timer);
                reject(error);
            });
        });
    }

    /** The old socket closes once the replies under way on it are in, three seconds at most. */
    private retire(socket: Socket): void {
        let waits = 0;
        const close = () => {
            if (pendingReplies(socket) > 0 && waits++ < REPLY_WAITS && !this.closed) {
                this.later(close, REPLY_WAIT_MS);
                return;
            }
            socket.close();
        };
        close();
    }

    private later(fn: () => void, ms: number): void {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            fn();
        }, ms);
        this.timers.add(timer);
    }

    /**
     * A site's CSP that leaves the nodes out of connect-src. Chromium fails the
     * WebSocket at once; WebKit and Firefox throw from its constructor, which
     * engine.io-client doesn't hear, and the connect waited out its timeout.
     * The violation tells at once, and it holds for every page of the site:
     * direct connections pause, a move to a blocked node is called off, and a
     * socket connecting to one goes to the realtime server now.
     */
    private watchCsp(): void {
        const doc = (globalThis as { document?: Document }).document;
        if (!doc || typeof doc.addEventListener !== 'function') return;

        const server = this.options.server;
        const onViolation = (violation: SecurityPolicyViolationEvent) => {
            if (this.closed) return;
            if (!/^(connect|default)-src\b/.test(violation.effectiveDirective || violation.violatedDirective || '')) return;

            const blocked = hostOf(violation.blockedURI || '');
            if (!blocked || blocked === hostOf(server)) return;

            const moving = this.moving;
            if (moving && !moving.connected && blocked === hostOf(urlOf(moving))) {
                this.failMove?.(new Error('blocked by the page\'s CSP'));
                return;
            }

            const socket = this.socket;
            if (socket.connected || !socket.active) return;
            // A node this socket is connecting to, or one that failed it moments ago.
            if (blocked !== hostOf(urlOf(socket)) && !this.nodes.failures().some((url) => hostOf(url) === blocked)) return;

            this.nodes.pause(server);
            pointAt(socket, server, server);
            socket.disconnect();
            socket.connect();
        };

        doc.addEventListener('securitypolicyviolation', onViolation);
        this.stopWatchingCsp = () => doc.removeEventListener('securitypolicyviolation', onViolation);
    }
}
