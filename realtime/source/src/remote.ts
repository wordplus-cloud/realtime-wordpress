/**
 * The connector's port protocol (version 2 of the connection): how a page, or
 * a product's own SharedWorker, uses the connections the connector's
 * SharedWorker holds. `serve` is the worker's side of one port,
 * `RemoteConnector` the other side.
 *
 * The two sides may be different copies of this package (the newest copy on
 * a page picks the worker, and every product bundles its own page side), so
 * the messages only grow: a side ignores an `op` it doesn't know, and a field
 * added later has a default. Every message is plain data, so a reply or a
 * server's question that comes with a callback travels as a number.
 *
 * - The handshake is asked for at the attach, `connect()` and `update()`. A
 *   reconnect the worker makes on its own reuses the last one.
 * - A move's `ready` runs on the client's side: the worker sends `prepare`,
 *   forwards what the move's new socket hears tagged with the move, takes the
 *   client's emits on it, and waits for `ready`. The switch is the worker's,
 *   so a channel hears the current socket alone, as in the page.
 * - A client that goes is noticed by its Web Lock, which it holds while it
 *   lives and names to the worker (`lock`) once it holds it. The worker asks
 *   for it: granted, the client is gone, and its namespaces leave. A page
 *   that hides takes its namespaces off (`suspend`).
 * - A namespace's farewell (`farewell`) stays in the worker with
 *   its link, so it is sent on a shared socket however the client leaves it.
 */
import { type Link, type Listener, Listeners, type MemberSpec, type PendingSocket, type Sink, type TimedEmitter, timedReply } from './channel.js';
import { type ConnectorApi, type Target, VERSION } from './connector.js';

/** The port protocol's own version, for a side that one day needs to know the other's. */
export const PORT_PROTOCOL = 1;

/** How long a client waits for the worker's hello before it runs the connections itself. */
export const HELLO_TIMEOUT_MS = 5000;

/**
 * How often a client asks the worker's hello again once it answered. A worker can end while a client
 * still holds a port to it: a product's own SharedWorker isn't among the connector worker's owners, so
 * the tab that started the connector's worker may close first. The port then takes every message and
 * answers none, and a hello still unanswered a round later hands every namespace to `fallback`.
 */
export const PING_INTERVAL_MS = 20000;

/**
 * How long `check` waits for the worker's hello. A worker in the same browser answers within milliseconds, so this
 * leaves room for a busy one and still moves the namespaces well inside the realtime server's grace for a user
 * whose socket went (10 s), where nobody is told they left.
 */
export const CHECK_TIMEOUT_MS = 1500;

/** A callback in an event's arguments: the server asks, and the product's answer goes back by number. */
const ASK = '__wordplusAsk';

/** As much of a MessagePort as the protocol uses. */
export interface PortLike {
    postMessage(message: unknown): void;
    onmessage: ((event: MessageEvent) => void) | null;
    start?(): void;
    close?(): void;
}

/** As much of the Web Locks API as the protocol uses. */
export interface LocksLike {
    request(name: string, callback: () => Promise<unknown> | unknown): Promise<unknown>;
}

type Message = Record<string, any> & { op: string };

/**
 * The worker's side of one port: a client's attaches, on the worker's
 * connector. Returns the function that ends it, as `bye` does.
 */
export function serve(port: PortLike, connector: ConnectorApi, locks: LocksLike | null = null): () => void {
    const links = new Map<number, { link: Link, auth: Record<string, unknown> }>();
    const moves = new Map<string, { pending: PendingSocket, resolve: (value: unknown) => void, reject: (error: Error) => void }>();
    const asks = new Map<number, Listener>();
    let askIds = 0;
    let moveIds = 0;
    let gone = false;

    const post = (message: Message) => {
        if (gone) return;
        try {
            port.postMessage(message);
        } catch {
            bye();
        }
    };

    // A callback the server sent (it asks the product something) goes as a number.
    const encode = (args: unknown[]) => args.map((arg) => {
        if (typeof arg !== 'function') return arg;
        asks.set(++askIds, arg as Listener);
        return { [ASK]: askIds };
    });

    const bye = () => {
        if (gone) return;
        gone = true;
        for (const { link } of links.values()) link.close();
        links.clear();
        for (const move of moves.values()) move.reject(new Error('gone'));
        moves.clear();
        asks.clear();
        port.onmessage = null;
        port.close?.();
    };

    const attach = (m: Message) => {
        const id = Number(m.id);
        links.get(id)?.link.close();

        const entry = { auth: (m.auth ?? {}) as Record<string, unknown>, link: null as unknown as Link };
        const sink: Sink = {
            deliver: (event, args) => post({ op: 'event', id, event, args: encode(args) }),
            opened: (sid) => post({ op: 'open', id, sid }),
            dropped: (reason) => post({ op: 'drop', id, reason }),
            refused: (error, active) => post({ op: 'refused', id, message: error?.message ?? String(error), data: plain((error as { data?: unknown })?.data), active }),
            prepare: (pending) => {
                if (!m.ready) return Promise.resolve(undefined);
                const move = ++moveIds;
                pending.onAny((event: string, ...args: unknown[]) => post({ op: 'event', id, move, event, args: encode(args) }));
                return new Promise((resolve, reject) => {
                    moves.set(id + ':' + move, { pending, resolve: () => resolve(move), reject });
                    post({ op: 'prepare', id, move });
                });
            },
            moved: (move) => post({ op: 'moved', id, move }),
        };

        const spec: MemberSpec = {
            namespace: String(m.namespace ?? '/'), auth: () => entry.auth, rides: !!m.rides, ready: !!m.ready,
            ...(typeof m.share === 'string' && m.share ? { share: m.share } : {}),
        };
        entry.link = connector.link({ server: String(m.server), path: m.path }, spec, sink);
        links.set(id, entry);
    };

    const handle = (m: Message) => {
        if (gone || !m || typeof m.op !== 'string') return;
        const entry = links.get(Number(m.id));

        switch (m.op) {
            case 'hello':
                post({ op: 'hello', v: PORT_PROTOCOL, version: connector.version });
                break;

            // The client's Web Lock, which it holds while it lives: granted here once its hold ends, when the
            // client is gone.
            case 'lock':
                if (typeof m.name === 'string' && locks) void locks.request(m.name, () => bye()).catch(() => {});
                break;

            case 'attach':
                attach(m);
                break;

            case 'emit': {
                const reply = typeof m.ack === 'number' ? (...args: unknown[]) => post({ op: 'ack', ack: m.ack, args: encode(args) }) : undefined;
                const args = Array.isArray(m.args) ? m.args : [];
                if (typeof m.move === 'number') {
                    const pending = moves.get(m.id + ':' + m.move)?.pending;
                    if (pending) reply ? pending.emit(m.event, ...args, reply) : pending.emit(m.event, ...args);
                } else {
                    entry?.link.emit(m.event, args, reply);
                }
                break;
            }

            case 'reply': {
                const ask = asks.get(m.ask);
                asks.delete(m.ask);
                ask?.(...(Array.isArray(m.args) ? m.args : []));
                break;
            }

            // What the client's link sends on a shared socket when it leaves and others stay (Channel.farewell),
            // whether it detaches or is gone.
            case 'farewell':
                entry?.link.farewell?.(typeof m.event === 'string' && m.event ? m.event : null, Array.isArray(m.args) ? m.args : []);
                break;

            case 'connect':
            case 'update':
                if (!entry) break;
                if (m.auth) entry.auth = m.auth;
                if (m.op === 'connect') entry.link.connect();
                else entry.link.update();
                break;

            case 'ready': {
                const key = m.id + ':' + m.move;
                const move = moves.get(key);
                moves.delete(key);
                if (m.ok) move?.resolve(undefined);
                else move?.reject(new Error('not ready'));
                break;
            }

            case 'detach':
                entry?.link.close();
                links.delete(Number(m.id));
                for (const key of [...moves.keys()]) if (key.startsWith(m.id + ':')) moves.delete(key);
                break;

            case 'bye':
                bye();
                break;
        }
    };

    port.onmessage = (event: MessageEvent) => handle(event.data as Message);
    port.start?.();
    return bye;
}

/** Structured clone takes plain data: anything else, an error's `data` included, goes as JSON would. */
function plain(value: unknown): unknown {
    if (value === undefined) return undefined;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return undefined;
    }
}

export interface RemoteOptions {
    /** The client's Web Lock, which tells the worker when it is gone. */
    locks?: LocksLike | null;
    /** Where the namespaces go should the worker not answer: the page's own connector. */
    fallback?: () => ConnectorApi;
}

/**
 * The client's side of a port to the connector's SharedWorker: a page's, or
 * a product's own worker's, with a MessagePort its tab handed it. A worker
 * that doesn't answer within HELLO_TIMEOUT_MS, fails to load, or stops
 * answering the hello sent every PING_INTERVAL_MS, hands every namespace to
 * `fallback`.
 */
export class RemoteConnector implements ConnectorApi {
    readonly version = VERSION;
    /** The worker's copy, once it answered. */
    hostVersion: string | null = null;

    private readonly links = new Map<number, RemoteLink>();
    private readonly acks = new Map<number, Listener>();
    private ids = 0;
    private ackIds = 0;
    private failed: ConnectorApi | null = null;
    private helloTimer: ReturnType<typeof setTimeout> | null = null;
    private pingTimer: ReturnType<typeof setTimeout> | null = null;
    /** When the next round of the liveness check is due. */
    private pingDue = 0;
    /** A hello went and its answer hasn't come yet. */
    private awaiting = false;
    /** Rounds in a row that ran late and found the hello unanswered. */
    private missed = 0;
    private suspended = false;
    /** The checks waiting for the worker's hello, each settled by the answer or by its own time running out. */
    private readonly checks = new Set<(answered: boolean) => void>();

    constructor(private readonly port: PortLike, private readonly options: RemoteOptions = {}) {
        port.onmessage = (event: MessageEvent) => this.handle(event.data as Message);
        port.start?.();

        if (options.fallback) this.helloTimer = setTimeout(() => this.fail(), HELLO_TIMEOUT_MS);
        this.post({ op: 'hello', v: PORT_PROTOCOL, version: VERSION });

        // Held while this side lives, and named to the worker only once held: named in the hello, the
        // worker's ask for it could come first, be granted at once, and take this side for gone.
        const locks = options.locks;
        if (locks) {
            const lock = 'wordplus-realtime-client:' + Math.random().toString(36).slice(2) + Date.now().toString(36);
            void locks.request(lock, () => {
                this.post({ op: 'lock', name: lock });
                return new Promise(() => {});
            }).catch(() => {});
        }
    }

    link(target: Target, spec: MemberSpec, sink: Sink): Link {
        const link = new RemoteLink(this, ++this.ids, target, spec, sink);
        if (this.failed) link.inner = this.failed.link(target, spec, sink);
        else {
            this.links.set(link.num, link);
            if (!this.suspended) link.attach();
        }
        return link;
    }

    /**
     * Asks the worker's hello now rather than at the next round of the liveness check, for a client with a reason to
     * doubt the worker. A product's own SharedWorker has one when a tab hands it another port to the connector's
     * worker: the worker its port leads to may have ended with the tab that started it, which the rounds find only
     * 20 to 40 s later, everything sent and heard meanwhile lost. Answered within `within`, nothing changes.
     * Unanswered, every namespace goes to `fallback` as after a missed round. Resolves whether the worker answered:
     * false at once for a client that already runs its namespaces elsewhere, true for one with no fallback to go to
     * or hidden in the back-forward cache, which keep their worker whatever it does.
     */
    check(within = CHECK_TIMEOUT_MS): Promise<boolean> {
        if (this.failed) return Promise.resolve(false);
        if (!this.options.fallback || this.suspended) return Promise.resolve(true);

        return new Promise((resolve) => {
            let timer: ReturnType<typeof setTimeout> | null = null;
            const settle = (answered: boolean) => {
                if (timer) clearTimeout(timer);
                this.checks.delete(settle);
                resolve(answered);
            };
            this.checks.add(settle);
            timer = setTimeout(() => {
                settle(false);
                this.fail();
            }, within);
            this.post({ op: 'hello', v: PORT_PROTOCOL, version: VERSION });
        });
    }

    /** The worker failed to load, never answered or stopped answering: every namespace goes to the fallback. */
    fail(): void {
        for (const settle of [...this.checks]) settle(false);
        if (this.failed || !this.options.fallback) return;
        if (this.helloTimer) clearTimeout(this.helloTimer);
        if (this.pingTimer) clearTimeout(this.pingTimer);
        this.pingTimer = null;
        // A worker that is only slow lets this side's namespaces go when it reads this, rather than keep them on its socket.
        try {
            this.port.postMessage({ op: 'bye' });
        } catch { /* a port that is gone */ }
        this.failed = this.options.fallback();
        for (const link of this.links.values()) {
            link.sink.dropped('transport close');
            link.inner = this.failed.link(link.target, link.spec, link.sink);
            if (link.parting) link.inner.farewell?.(link.parting.event, link.parting.args);
        }
        this.links.clear();
        this.port.onmessage = null;
    }

    /** The page hides (pagehide): its namespaces leave the worker's connections until it shows again. */
    suspend(): void {
        if (this.suspended || this.failed) return;
        this.suspended = true;
        for (const link of this.links.values()) {
            this.post({ op: 'detach', id: link.num });
            link.sink.dropped('transport close');
        }
    }

    /** Shown again from the back-forward cache: every namespace attaches again, and catches up as on a reconnect. */
    resume(): void {
        if (!this.suspended) return;
        this.suspended = false;
        this.awaiting = false;
        this.missed = 0;
        for (const link of this.links.values()) link.attach();
    }

    /** The liveness check, once the worker answered: a round every PING_INTERVAL_MS, each sending a hello. */
    private schedulePing(): void {
        if (this.failed || !this.options.fallback) return;
        this.pingDue = Date.now() + PING_INTERVAL_MS;
        this.pingTimer = setTimeout(() => this.ping(), PING_INTERVAL_MS);
    }

    private ping(): void {
        this.pingTimer = null;
        if (this.failed) return;
        if (this.suspended) {
            this.awaiting = false;
            this.missed = 0;
        } else {
            if (this.awaiting) {
                // A round that runs well after it was due (a frozen page, a computer that slept) can run before the
                // answer queued behind it, so it sends again and waits a round more. A second late round in a row
                // can't: a hidden page whose timers are throttled runs every round late, but its messages on time.
                const late = Date.now() - this.pingDue > PING_INTERVAL_MS / 2;
                if (!late || this.missed > 0) return this.fail();
                this.missed++;
            }
            this.awaiting = true;
            this.post({ op: 'hello', v: PORT_PROTOCOL, version: VERSION });
        }
        this.schedulePing();
    }

    post(message: Message): void {
        try {
            this.port.postMessage(message);
        } catch {
            this.fail();
        }
    }

    ack(fn: Listener): number {
        this.acks.set(++this.ackIds, fn);
        return this.ackIds;
    }

    forget(link: RemoteLink): void {
        this.links.delete(link.num);
    }

    private handle(m: Message): void {
        if (!m || typeof m.op !== 'string') return;

        if (m.op === 'hello') {
            this.hostVersion = typeof m.version === 'string' ? m.version : null;
            if (this.helloTimer) clearTimeout(this.helloTimer);
            this.helloTimer = null;
            this.awaiting = false;
            this.missed = 0;
            if (!this.pingTimer) this.schedulePing();
            for (const settle of [...this.checks]) settle(true);
            return;
        }

        if (m.op === 'ack') {
            const fn = this.acks.get(m.ack);
            this.acks.delete(m.ack);
            fn?.(...this.decode(m.args));
            return;
        }

        const link = this.links.get(Number(m.id));
        if (!link) return;

        switch (m.op) {
            case 'event':
                if (typeof m.move === 'number') link.pendings.get(m.move)?.fire(m.event, this.decode(m.args));
                else link.sink.deliver(m.event, this.decode(m.args));
                break;

            case 'open':
                link.sid = typeof m.sid === 'string' ? m.sid : undefined;
                link.sink.opened(link.sid);
                break;

            case 'drop':
                link.sink.dropped(String(m.reason ?? 'transport close'));
                break;

            case 'refused':
                link.sink.refused(Object.assign(new Error(String(m.message ?? 'refused')), m.data === undefined ? {} : { data: m.data }), !!m.active);
                break;

            case 'prepare':
                link.prepare(Number(m.move));
                break;

            case 'moved':
                link.moved(Number(m.move));
                break;
        }
    }

    /** A server's question: a function that sends the product's answer back. */
    private decode(args: unknown): unknown[] {
        if (!Array.isArray(args)) return [];
        return args.map((arg) => {
            const ask = (arg as Record<string, unknown> | null)?.[ASK];
            if (typeof ask !== 'number') return arg;
            return (...reply: unknown[]) => this.post({ op: 'reply', ask, args: reply });
        });
    }
}

class RemoteLink implements Link {
    sid: string | undefined;
    /** The page's own connector's link, once the worker failed. */
    inner: Link | null = null;
    readonly pendings = new Map<number, RemotePending>();
    private readonly values = new Map<number, unknown>();
    private closed = false;
    /** The product's farewell, which every attach takes with it. */
    parting: { event: string, args: unknown[] } | null = null;

    constructor(private readonly conn: RemoteConnector, readonly num: number, readonly target: Target, readonly spec: MemberSpec, readonly sink: Sink) {}

    get id(): string | undefined {
        return this.inner ? this.inner.id : this.sid;
    }

    attach(): void {
        this.conn.post({
            op: 'attach', id: this.num, server: this.target.server, path: this.target.path,
            namespace: this.spec.namespace, auth: this.spec.auth(), rides: !!this.spec.rides, ready: !!this.spec.ready,
            ...(this.spec.share ? { share: this.spec.share } : {}),
        });
        if (this.parting) this.conn.post({ op: 'farewell', id: this.num, event: this.parting.event, args: this.parting.args });
    }

    farewell(event: string | null, args: unknown[]): void {
        this.parting = event ? { event, args } : null;
        if (this.inner) return this.inner.farewell?.(event, args);
        if (this.closed) return;
        this.conn.post({ op: 'farewell', id: this.num, event, args });
    }

    emit(event: string, args: unknown[], reply?: Listener): void {
        if (this.inner) return this.inner.emit(event, args, reply);
        if (this.closed) return;
        this.conn.post({ op: 'emit', id: this.num, event, args, ...(reply ? { ack: this.conn.ack(reply) } : {}) });
    }

    connect(): void {
        if (this.inner) return this.inner.connect();
        this.conn.post({ op: 'connect', id: this.num, auth: this.spec.auth() });
    }

    update(): void {
        if (this.inner) return this.inner.update();
        this.conn.post({ op: 'update', id: this.num, auth: this.spec.auth() });
    }

    close(): void {
        if (this.inner) return this.inner.close();
        if (this.closed) return;
        this.closed = true;
        this.conn.post({ op: 'detach', id: this.num });
        this.conn.forget(this);
        for (const pending of this.pendings.values()) pending.end();
        this.pendings.clear();
    }

    /** A move's new socket in the worker: the product's `ready` runs here, on a stand-in for it. */
    prepare(move: number): void {
        const pending = new RemotePending(this.conn, this.num, move);
        this.pendings.set(move, pending);
        this.sink.prepare(pending).then((value) => {
            this.values.set(move, value);
            this.conn.post({ op: 'ready', id: this.num, move, ok: true });
        }, () => {
            this.pendings.delete(move);
            pending.end();
            this.conn.post({ op: 'ready', id: this.num, move, ok: false });
        });
    }

    moved(move: number): void {
        const value = this.values.get(move);
        this.values.delete(move);
        this.pendings.get(move)?.end();
        this.pendings.delete(move);
        this.sink.moved(value);
    }
}

/** A move's new socket in the worker, as the product's `ready` on this side sees it. */
class RemotePending implements PendingSocket {
    private readonly listeners = new Listeners();
    private done = false;

    constructor(private readonly conn: RemoteConnector, private readonly id: number, private readonly move: number) {}

    on(event: string, fn: Listener): this {
        this.listeners.on(event, fn);
        return this;
    }

    once(event: string, fn: Listener): this {
        this.listeners.on(event, fn, true);
        return this;
    }

    off(event: string, fn?: Listener): this {
        this.listeners.off(event, fn);
        return this;
    }

    onAny(fn: Listener): this {
        this.listeners.onAny(fn);
        return this;
    }

    emit(event: string, ...args: unknown[]): this {
        if (this.done) return this;
        const fn = typeof args[args.length - 1] === 'function' ? args.pop() as Listener : undefined;
        this.conn.post({ op: 'emit', id: this.id, move: this.move, event, args, ...(fn ? { ack: this.conn.ack(fn) } : {}) });
        return this;
    }

    emitWithAck(event: string, ...args: unknown[]): Promise<any> {
        return new Promise((resolve) => this.emit(event, ...args, (first: unknown) => resolve(first)));
    }

    timeout(ms: number): TimedEmitter {
        return {
            emit: (event: string, ...args: unknown[]) => {
                const fn = args.pop() as Listener;
                this.emit(event, ...args, timedReply(fn, ms).reply);
            },
            emitWithAck: (event: string, ...args: unknown[]) => new Promise((resolve, reject) => {
                this.emit(event, ...args, timedReply((err: Error | null, first: unknown) => err ? reject(err) : resolve(first), ms).reply);
            }),
        };
    }

    fire(event: string, args: unknown[]): void {
        if (!this.done) this.listeners.fire(event, args);
    }

    end(): void {
        this.done = true;
        this.listeners.off();
        this.listeners.offAny();
    }
}
