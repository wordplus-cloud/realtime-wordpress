/**
 * A product's namespace on the shared connection (version 2 of the connection):
 * what `attach` hands a product, wherever the connection is, in this page or
 * in the connector's SharedWorker. It is socket-like, so a product written
 * for a socket.io socket takes one with few changes: `on`, `once`, `off`,
 * `onAny`, `emit` with or without a reply, `timeout( ms )`, `emitWithAck`,
 * `connected`, `active`, `connect()` and `close()`, and the events `connect`,
 * `disconnect` and `connect_error`.
 *
 * Its events are the current socket's only. A move opens the namespace on
 * the target node first, and what that socket hears before the switch goes to
 * the product's `ready` alone (`PendingSocket`).
 *
 * A channel is bound to what carries it (a `Link`) once the page's connector
 * runs, which can be a moment after the attach (registry.ts): what it sends
 * meanwhile waits, as a socket.io socket buffers what it sends before it
 * connects.
 *
 * The `Sink` methods are how a connector talks to a channel. A connector may
 * be a newer copy than the channel's (the newest copy on the page runs it),
 * so they are a contract: they are never renamed, and a newer connector
 * checks for any method it adds.
 */

export type Listener = (...args: any[]) => void;

/** A move's new socket, before it takes over: what the product's `ready` emits on and listens to. */
export interface PendingSocket {
    on(event: string, fn: Listener): PendingSocket;
    once(event: string, fn: Listener): PendingSocket;
    off(event: string, fn?: Listener): PendingSocket;
    onAny(fn: Listener): PendingSocket;
    emit(event: string, ...args: unknown[]): PendingSocket;
    emitWithAck(event: string, ...args: unknown[]): Promise<any>;
    timeout(ms: number): TimedEmitter;
}

export interface TimedEmitter {
    /** The reply's callback, last, gets an error first: the timeout's, or null. */
    emit(event: string, ...args: unknown[]): void;
    emitWithAck(event: string, ...args: unknown[]): Promise<any>;
}

export interface AttachOptions {
    /** The product's namespace, such as /estream; Better Messages uses `/`. */
    namespace: string;
    /** The product's handshake. In the page it is asked at every connect; through the worker, at the attach, `connect()` and `update()`. `rt` is added. */
    auth: () => Record<string, unknown>;
    /** When a move's new socket may take over, after it connects: at once by default. Easy Stream waits for its `hello`. */
    ready?: (next: PendingSocket) => Promise<unknown>;
    /** The move switched to its new socket, with what `ready` gave. */
    moved?: (value: unknown) => void;
    /** Rides on a connection another namespace holds, and never opens one (Easy Stream's live list). */
    rides?: boolean;
    /**
     * Shares the namespace's socket with every attach of it that says the same key (share.ts), so tabs of a
     * product ride one connection: what they share, the handshake and what the server sends, must be the same
     * for each. What a tab joined on the socket it leaves with `farewell()`.
     */
    share?: string;
}

/**
 * What carries a channel: its namespace on a connection here (hub.ts), or an
 * attach in the worker (remote.ts). A reply is a plain callback: a channel
 * keeps a reply's timeout itself, so it holds however the reply travels.
 */
export interface Link {
    emit(event: string, args: unknown[], reply?: Listener): void;
    /** Again after a refusal, with the product's handshake as it is now. */
    connect(): void;
    /** The product's handshake changed, for the next connects. */
    update(): void;
    close(): void;
    /**
     * What to send on a shared socket when this link leaves it and others stay (Channel.farewell), or null for
     * nothing. Optional: a link may have none.
     */
    farewell?(event: string | null, args: unknown[]): void;
    /** The current socket's id. */
    readonly id: string | undefined;
}

/** How a connector tells a channel what happened. A contract between copies (above). */
export interface Sink {
    deliver(event: string, args: unknown[]): void;
    opened(id: string | undefined): void;
    dropped(reason: string): void;
    /** The handshake was refused (`active` false: no retry), or the connection failed (`active` true: it retries). */
    refused(error: Error, active: boolean): void;
    /** A move's new socket: runs the product's `ready`, and resolves with what `moved` gets. */
    prepare(next: PendingSocket): Promise<unknown>;
    moved(value: unknown): void;
}

/** What a namespace needs of its product, wherever it is carried. A contract between copies, as `Sink`. */
export interface MemberSpec {
    namespace: string;
    auth: () => Record<string, unknown>;
    rides?: boolean;
    /** The product has a `ready` to run on a move's new socket: through the worker, the move asks for it. */
    ready?: boolean;
    /** Shares the namespace's socket with the attaches that say the same key (AttachOptions.share). */
    share?: string;
}

/** The spec of a product's attach. */
export function specOf(options: AttachOptions): MemberSpec {
    return {
        namespace: options.namespace, auth: options.auth, rides: !!options.rides, ready: !!options.ready,
        ...(typeof options.share === 'string' && options.share ? { share: options.share } : {}),
    };
}

/** The events a channel fires itself. */
const RESERVED = new Set(['connect', 'disconnect', 'connect_error']);

/** The error a reply with a timeout gets when the time is up, as socket.io's. */
export const timedOut = () => new Error('operation has timed out');

/** A list of listeners, each kept once or for good. */
export class Listeners {
    private byEvent = new Map<string, Array<{ fn: Listener, once: boolean }>>();
    private any: Listener[] = [];

    on(event: string, fn: Listener, once = false): void {
        const list = this.byEvent.get(event) ?? [];
        list.push({ fn, once });
        this.byEvent.set(event, list);
    }

    off(event?: string, fn?: Listener): void {
        if (event === undefined) {
            this.byEvent.clear();
            return;
        }
        const list = this.byEvent.get(event);
        if (!list) return;
        const kept = fn ? list.filter((l) => l.fn !== fn) : [];
        if (kept.length > 0) this.byEvent.set(event, kept);
        else this.byEvent.delete(event);
    }

    onAny(fn: Listener): void {
        this.any.push(fn);
    }

    offAny(fn?: Listener): void {
        this.any = fn ? this.any.filter((f) => f !== fn) : [];
    }

    /** `any` listeners hear the server's events, not the reserved ones, as socket.io's `onAny`. */
    fire(event: string, args: unknown[], any = true): void {
        if (any) for (const fn of [...this.any]) fn(event, ...args);
        const list = this.byEvent.get(event);
        if (!list) return;
        for (const l of [...list]) {
            if (l.once) this.off(event, l.fn);
            l.fn(...args);
        }
    }

    count(event: string): number {
        return this.byEvent.get(event)?.length ?? 0;
    }
}

/** A reply's callback with the time it waits, `fn( err, ...reply )`, fired once whichever comes first. */
export function timedReply(fn: Listener, ms: number): { reply: Listener, cancel: () => void } {
    let done = false;
    const timer = setTimeout(() => {
        if (done) return;
        done = true;
        fn(timedOut());
    }, ms);
    return {
        reply: (...args: unknown[]) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            fn(null, ...args);
        },
        cancel: () => {
            done = true;
            clearTimeout(timer);
        },
    };
}

export class Channel implements Sink {
    connected = false;
    /** False once the handshake was refused or the channel was closed: it then tries no more until `connect()`. */
    active = true;

    private readonly listeners = new Listeners();
    private link: Link | null = null;
    /** What the product sent before the channel was bound, sent once it is. */
    private queue: Array<(link: Link) => void> = [];
    private closed = false;
    /** What its link sends when it leaves a shared socket (farewell). */
    private parting: { event: string, args: unknown[] } | null = null;

    constructor(readonly options: AttachOptions) {}

    get namespace(): string {
        return this.options.namespace;
    }

    get id(): string | undefined {
        return this.link?.id;
    }

    /** Whether the channel was closed by the product. */
    get isClosed(): boolean {
        return this.closed;
    }

    on(event: string, fn: Listener): this {
        this.listeners.on(event, fn);
        return this;
    }

    once(event: string, fn: Listener): this {
        this.listeners.on(event, fn, true);
        return this;
    }

    off(event?: string, fn?: Listener): this {
        this.listeners.off(event, fn);
        return this;
    }

    removeAllListeners(event?: string): this {
        this.listeners.off(event);
        return this;
    }

    onAny(fn: Listener): this {
        this.listeners.onAny(fn);
        return this;
    }

    offAny(fn?: Listener): this {
        this.listeners.offAny(fn);
        return this;
    }

    listenerCount(event: string): number {
        return this.listeners.count(event);
    }

    /** As a socket's: a function last is the reply's callback. */
    emit(event: string, ...args: unknown[]): this {
        const fn = typeof args[args.length - 1] === 'function' ? args.pop() as Listener : undefined;
        this.send(event, args, fn);
        return this;
    }

    emitWithAck(event: string, ...args: unknown[]): Promise<any> {
        return new Promise((resolve) => this.send(event, args, (first: unknown) => resolve(first)));
    }

    /**
     * A reply that waits `ms` at most, as a socket's `timeout()`: its callback
     * gets an error first, the timeout's or null.
     */
    timeout(ms: number): TimedEmitter {
        return {
            emit: (event: string, ...args: unknown[]) => {
                const fn = args.pop();
                if (typeof fn !== 'function') throw new Error('timeout().emit needs a callback last');
                this.send(event, args, timedReply(fn as Listener, ms).reply);
            },
            emitWithAck: (event: string, ...args: unknown[]) => new Promise((resolve, reject) => {
                this.send(event, args, timedReply((err: Error | null, first: unknown) => err ? reject(err) : resolve(first), ms).reply);
            }),
        };
    }

    /** Again after a refusal, with the handshake as it is now. */
    connect(): this {
        if (this.closed) return this;
        this.active = true;
        if (this.link) this.link.connect();
        return this;
    }

    /** The handshake changed: the next connects take it. */
    update(): this {
        this.link?.update();
        return this;
    }

    /**
     * On a shared socket (`share`), what this channel sends on it when it leaves while others stay: closed, its
     * page hidden, or its tab gone, which the worker finds out by itself. The product's way of leaving what it
     * joined on the socket, as Easy Stream's `unwatch` of its stream. Called again it replaces it; with no event
     * it is cleared.
     */
    farewell(event?: string, ...args: unknown[]): this {
        this.parting = event ? { event, args } : null;
        this.link?.farewell?.(event ?? null, args);
        return this;
    }

    /** Leaves the connection. The last namespace to leave closes it. */
    close(): this {
        if (this.closed) return this;
        this.closed = true;
        this.active = false;
        this.queue = [];
        const was = this.connected;
        this.connected = false;
        this.link?.close();
        if (was) this.listeners.fire('disconnect', ['io client disconnect'], false);
        return this;
    }

    disconnect(): this {
        return this.close();
    }

    /** Bound to what carries it, by the page's connector. */
    bind(link: Link): void {
        if (this.closed) {
            link.close();
            return;
        }
        this.link = link;
        const queue = this.queue;
        this.queue = [];
        for (const send of queue) send(link);
        if (this.parting) link.farewell?.(this.parting.event, this.parting.args);
    }

    private send(event: string, args: unknown[], reply?: Listener): void {
        if (this.closed) return;
        if (RESERVED.has(event)) throw new Error('"' + event + '" is a reserved event name');

        if (this.link) this.link.emit(event, args, reply);
        else this.queue.push((link) => link.emit(event, args, reply));
    }

    // The Sink: what the connector tells the channel.

    deliver(event: string, args: unknown[]): void {
        if (this.closed) return;
        this.listeners.fire(event, args);
    }

    opened(_id: string | undefined): void {
        if (this.closed) return;
        this.connected = true;
        this.active = true;
        this.listeners.fire('connect', [], false);
    }

    dropped(reason: string): void {
        if (this.closed || !this.connected) return;
        this.connected = false;
        this.listeners.fire('disconnect', [reason], false);
    }

    refused(error: Error, active: boolean): void {
        if (this.closed) return;
        this.active = active;
        this.listeners.fire('connect_error', [error], false);
    }

    prepare(next: PendingSocket): Promise<unknown> {
        if (this.closed || !this.options.ready) return Promise.resolve(undefined);
        return this.options.ready(next);
    }

    moved(value: unknown): void {
        if (this.closed) return;
        this.options.moved?.(value);
    }
}
