/**
 * Direct connections: the realtime server's `migrate` sends a client to one
 * of its WebSocket nodes, and the client keeps that node and two fallbacks to
 * connect to directly next time, rather than through the load balancer.
 *
 * The list comes over the socket itself: `migrate` carries it with the node to
 * move to first, and a node sends `nodes` to every client that connects to it
 * directly, and again whenever the ready nodes change. Each node comes with how
 * long to keep it, so a burst node, which may be gone within the hour, leaves
 * the cache sooner than a base node. A client whose kept nodes have all failed
 * or expired connects through the realtime server itself again.
 *
 * The node a `direct` offer names is kept at once, with one other node of the
 * offer's behind it, so the next page load connects to it even if this one
 * closes before it moves. A move to it from a live connection to the realtime
 * server that fails, with the realtime server answering after it, pauses
 * direct connections for an hour: the client can reach the realtime server
 * but not the nodes (a proxy, a filter, a site's CSP). It takes no offer and
 * leaves the cache unused meanwhile. The pause is kept with the nodes, so
 * every page load and tab honours it.
 *
 * A node that fails a connect is passed over, and leaves the cache only once
 * the socket connects somewhere: offline, every connect fails, the nodes'
 * included, and the cache has to outlast that.
 *
 * Shared by every mover: a socket that moves by reconnecting (direct-socket.ts)
 * and a connection that opens its new socket before it closes the old one
 * (connection.ts), whatever product they carry. Taken from Better Messages,
 * whose SharedWorker keeps the same cache in its IndexedDB.
 */
import type { Socket } from 'socket.io-client';

/** A node the client keeps, until `until` (milliseconds since the epoch). */
export interface CachedNode {
    url: string;
    until: number;
}

/**
 * The nodes, for the realtime server they came from, best first, and until
 * when direct connections are paused (milliseconds since the epoch).
 */
export interface NodeCache {
    server: string;
    nodes: CachedNode[];
    pausedUntil?: number;
}

/**
 * Where the cache and its pause are kept. The SharedWorker keeps them in its
 * IndexedDB settings (`realtimeNodes`), which only it writes. A tab's own
 * socket keeps them in localStorage (`localNodeStore`), which the page's other
 * tabs write too: a store that can be read at once (`readNow`) is read again
 * before every decision.
 */
export interface NodeStore {
    read(): Promise<unknown>;
    write(cache: NodeCache | null): Promise<void>;
    /** What is stored now. Throws when it can't be read, and the copy in memory stands. */
    readNow?(): unknown;
}

/**
 * The server's `migrate` event: move to `target` (the realtime server itself
 * if none) at a random moment within `spread` ms, and keep `nodes`.
 */
export interface MigrateRequest {
    target?: unknown;
    spread?: unknown;
    reason?: unknown;
    nodes?: unknown;
}

/** A node as the server lists it: https, a host, no path. */
export const NODE_URL = /^https:\/\/[^/\s]+$/;

/** A node is kept at least a minute and at most a day, whatever the server says. */
const MIN_TTL = 60;
const MAX_TTL = 86400;

/** How long a client the nodes failed takes no direct offer and leaves its cache unused. */
export const PAUSE_MS = 3600000;

/**
 * How long a connect waits: less at a cached node than at the realtime
 * server. A node the client can't reach fails at once when its name doesn't
 * resolve or it refuses the connection. It waits out the timeout when its
 * address swallows packets, and when a site's CSP blocks it in WebKit or
 * Firefox, whose WebSocket throws where engine.io-client doesn't listen yet (a
 * tab's own socket hears that from the page instead, direct-socket.ts). Not
 * much less, since a phone waking up on a slow network can take seconds. A
 * move to an offered node, which pauses direct connections should it fail,
 * waits as long as a connect to the realtime server: a slow network is not a
 * blocked one.
 */
export const SERVER_CONNECT_TIMEOUT_MS = 7000;
export const NODE_CONNECT_TIMEOUT_MS = 5000;

/**
 * How long a first connect waits for a store that can't be read at once (the
 * connector's SharedWorker, whose IndexedDB opens after its first attach) to
 * give the cache, before it goes to the realtime server itself.
 */
export const FIRST_READ_WAIT_MS = 300;

/**
 * Where `migrate` sends the client: its node, or the realtime server itself
 * when it names none. A `direct` offer is for a socket on the realtime server
 * itself, and must name another https node, or it gives null and the socket
 * stays where it is. Taken anyway, an offer naming an http node, the realtime
 * server, or the node the socket was already on moved the socket to where it
 * was, to be offered the same again every few seconds.
 */
export function migrateTarget(request: MigrateRequest | undefined, server: string, current: string): string | null {
    const node = typeof request?.target === 'string' && NODE_URL.test(request.target) ? request.target : null;
    if (request?.reason !== 'direct') return node ?? server;
    return node && !sameServer(node, server) && sameServer(current, server) ? node : null;
}

/** The window a move is spread over, at most two minutes. */
export function migrateSpread(request: MigrateRequest | undefined): number {
    return Math.min(Math.max(Number(request?.spread) || 0, 0), 120000);
}

export function sameServer(a: string, b: string): boolean {
    const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
    return host(a) === host(b);
}

/** The host of an absolute URL, a WebSocket's with its path and query included, in lower case; '' for anything else. */
export function hostOf(url: string): string {
    const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/i.exec(url);
    return match ? match[1].toLowerCase() : '';
}

/** How long a connect to `url` waits: a node's timeout, or the realtime server's own. */
export function connectTimeout(url: string, server: string): number {
    return sameServer(url, server) ? SERVER_CONNECT_TIMEOUT_MS : NODE_CONNECT_TIMEOUT_MS;
}

/**
 * Where a socket connects: its manager's URL, which its reconnects use too,
 * and how long a connect waits, by default a node's timeout or the realtime
 * server's own.
 */
export function pointAt(socket: Socket, url: string, server: string, timeout = connectTimeout(url, server)): void {
    aim(socket.io, url, server, timeout);
}

export function urlOf(socket: Socket): string {
    return managerUrl(socket.io);
}

/** What `pointAt` and `urlOf` need of a manager: its URL and its connect timeout. */
export interface Aimable {
    timeout(value: number): unknown;
}

/** `pointAt` for a manager, which every namespace of a shared connection goes through (hub.ts). */
export function aim(manager: Aimable, url: string, server: string, timeout = connectTimeout(url, server)): void {
    (manager as unknown as { uri: string }).uri = url;
    manager.timeout(timeout);
}

export function managerUrl(manager: Aimable): string {
    return (manager as unknown as { uri: string }).uri;
}

/** The valid nodes of a list the server sent (`[{url, ttl}]`), each with its expiry, three at most. */
export function listedNodes(list: unknown, now = Date.now()): CachedNode[] {
    if (!Array.isArray(list)) return [];
    const out: CachedNode[] = [];
    for (const item of list) {
        const url = (item as { url?: unknown } | null)?.url;
        if (typeof url !== 'string' || !NODE_URL.test(url) || out.some((n) => sameServer(n.url, url))) continue;
        const ttl = Math.min(Math.max(Number((item as { ttl?: unknown }).ttl) || MAX_TTL, MIN_TTL), MAX_TTL);
        out.push({ url, until: now + ttl * 1000 });
    }
    return out.slice(0, 3);
}

/**
 * The store of a tab's own socket: localStorage, under `key`. A page has it
 * before its database, which the apps open only after their socket, it is
 * shared by the page's other tabs, and it lasts where the database fell back
 * to memory. Blocked, or full, it leaves the cache to the page's memory.
 */
export function localNodeStore(key: string): NodeStore {
    let usable = true;
    const storage = (): Storage => {
        if (!usable) throw new Error('localStorage failed a write');
        return globalThis.localStorage;
    };
    const readNow = (): unknown => {
        const raw = storage().getItem(key);
        if (raw === null) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    };
    return {
        readNow,
        read: async () => readNow(),
        write: async (cache) => {
            try {
                if (cache) storage().setItem(key, JSON.stringify(cache));
                else storage().removeItem(key);
            } catch {
                // What it still holds is older than memory from here on.
                usable = false;
            }
        },
    };
}

export class NodeCacheKeeper {
    private store: NodeStore | null = null;
    private cache: NodeCache | null = null;

    /** How many times the cache was saved: a read that began before the latest save is older than memory. */
    private saves = 0;

    /**
     * The socket's attempts since it last connected, or since the realtime
     * server failed as well: the nodes that failed, and a move to an offered
     * node (`moving`), with whether that move failed. Neither is stored.
     */
    private failedNodes: string[] = [];
    private moveTarget: string | null = null;
    private moveFailed = false;

    /** The read under way, which a first connect waits on for a moment. */
    loading: Promise<void> = Promise.resolve();

    setStore(store: NodeStore): void {
        this.store = store;
        this.load();
    }

    /** Read the cache again, as when the storage behind the store opens. */
    load(): void {
        const store = this.store;
        if (!store) return;

        if (store.readNow) {
            this.sync();
            this.loading = Promise.resolve();
            return;
        }

        const saves = this.saves;
        this.loading = store.read().then((value) => {
            // Saved since the read began: what memory holds is newer.
            if (this.saves === saves) this.cache = NodeCacheKeeper.valid(value);
        }).catch(() => {});
    }

    /** Once the reads under way have landed, one started meanwhile included. */
    async ready(): Promise<void> {
        let loading: Promise<void>;
        do {
            loading = this.loading;
            await loading;
        } while (loading !== this.loading);
    }

    /**
     * Whether direct connections are paused for this realtime server: no
     * `direct` offer is taken, and the socket connects through the realtime
     * server itself, cached nodes or not. A drain still moves the socket.
     */
    paused(server: string): boolean {
        this.sync();
        return this.pausedNow(server);
    }

    /** Cached nodes not yet expired for this realtime server, best first: none while paused. */
    fresh(server: string): string[] {
        this.sync();
        if (this.pausedNow(server)) return [];
        return this.freshNodes(server).map((n) => n.url);
    }

    /**
     * Where a new socket connects first: the first cached node, else, and
     * while paused, the realtime server itself. Its attempts start afresh.
     */
    first(server: string): string {
        this.newRound();
        return this.fresh(server)[0] ?? server;
    }

    /**
     * A `direct` offer's node, kept at once and first, for as long as the
     * offer lists it: the next page load connects to it directly even if this
     * one closes before it moves. One other node of the offer's goes behind
     * it, so a node that is down by then, or fails the move, is followed by a
     * ready node rather than by the realtime server and a pause. One only: a
     * client that can reach the realtime server but no node fails two before
     * it pauses, not three. The rest come with the list (`nodes`) of the
     * first node the client reaches.
     */
    offered(target: string, server: string, list?: unknown): void {
        this.sync();
        const listed = listedNodes(list);
        const first = listed.find((n) => sameServer(n.url, target)) ?? { url: target, until: Date.now() + MAX_TTL * 1000 };
        const spare = listed.filter((n) => !sameServer(n.url, target)).slice(0, 1);
        const others = this.freshNodes(server).filter((n) => ![first, ...spare].some((k) => sameServer(k.url, n.url)));
        this.keep(server, [first, ...spare, ...others].slice(0, 3));
    }

    /**
     * After a move to `target`, or before a drain's: it goes first, with the
     * others `migrate` listed. A move back to the realtime server itself,
     * which the server asks for when a site stops connecting directly, clears
     * the cache.
     */
    remember(target: string, server: string, list?: unknown): void {
        this.sync();
        if (sameServer(target, server)) {
            if (this.cache) this.save(null);
            return;
        }

        const listed = listedNodes(list);
        const first = listed.find((n) => sameServer(n.url, target)) ?? { url: target, until: Date.now() + MAX_TTL * 1000 };
        // A server that lists nothing leaves the fresh cached nodes as the fallbacks.
        const others = (listed.length > 0 ? listed : this.freshNodes(server)).filter((n) => !sameServer(n.url, target));
        this.keep(server, [first, ...others].slice(0, 3));
    }

    /**
     * A node's own list (`nodes`), sent at every direct connection and when
     * the ready nodes change: it replaces the cache, so nodes that are gone
     * leave it and new ones enter it. An empty list clears it, and the next
     * connection goes through the realtime server itself.
     */
    update(server: string, list: unknown): void {
        this.sync();
        const nodes = listedNodes(list);
        if (nodes.length > 0) this.keep(server, nodes);
        else this.save(null);
    }

    /**
     * A socket on the realtime server is moving to the node a `direct` offer
     * named. If that node fails and the realtime server answers, the client
     * can reach the one and not the other, and direct connections pause.
     */
    moving(target: string): void {
        this.moveTarget = target;
        this.moveFailed = false;
    }

    /**
     * A connect to `url` failed. Returns where to try next: the next cached
     * node that has not failed yet, or, once none is left or while paused, the
     * realtime server itself. The failed node leaves the cache only once the
     * socket connects somewhere (`reached`). The realtime server failing too
     * says nothing about the nodes: the client is offline, or the server is
     * down. The attempts start again from the first cached node, and the
     * cache outlasts it.
     */
    failed(url: string, server: string): string {
        this.sync();
        if (sameServer(url, server)) {
            this.newRound();
            return this.fresh(server)[0] ?? server;
        }

        if (!this.failedNodes.some((u) => sameServer(u, url))) this.failedNodes.push(url);
        if (this.moveTarget !== null && sameServer(url, this.moveTarget)) this.moveFailed = true;
        if (this.pausedNow(server)) return server;
        return this.freshNodes(server).find((n) => !this.failedNodes.some((u) => sameServer(u, n.url)))?.url ?? server;
    }

    /** The nodes that failed a connect since the socket last connected anywhere. */
    failures(): string[] {
        return [...this.failedNodes];
    }

    /**
     * A socket connected to `url`, so the client is online, and the nodes that
     * failed it meanwhile leave the cache. At a node, direct connections work
     * for this client, and a pause ends. At the realtime server itself after
     * a move to an offered node failed, the client can reach the server but
     * not the nodes, so direct connections pause. A cached node failing first
     * is no such sign: a phone between networks fails its nodes and reaches
     * the realtime server moments later, and the realtime server's next offer
     * is a node it saw ready moments ago.
     */
    reached(url: string, server: string): void {
        this.sync();
        const failed = this.failedNodes;
        const moveFailed = this.moveFailed;
        this.newRound();

        if (sameServer(url, server)) {
            if (moveFailed) this.pause(server);
            else this.drop(server, failed);
            return;
        }

        const cache = this.cache;
        if (!cache || cache.server !== server) return;
        const nodes = cache.nodes.filter((n) => !failed.some((u) => sameServer(u, n.url)));
        if (cache.pausedUntil || nodes.length < cache.nodes.length) this.save(nodes.length > 0 ? { server, nodes } : null);
    }

    /**
     * No direct offer taken, and the cache left unused, for an hour. The nodes
     * kept go too: a client that can't reach one likely can't reach the
     * others, and each would be tried and fail once the pause is over.
     */
    pause(server: string): void {
        this.newRound();
        this.save({ server, nodes: [], pausedUntil: Date.now() + PAUSE_MS });
    }

    /** A store read at once (localStorage) may have been written by another tab or page load since. */
    private sync(): void {
        const store = this.store;
        if (!store?.readNow) return;
        try {
            this.cache = NodeCacheKeeper.valid(store.readNow());
        } catch {
            // Unreadable: the copy in memory is all there is.
        }
    }

    private newRound(): void {
        this.failedNodes = [];
        this.moveTarget = null;
        this.moveFailed = false;
    }

    private pausedNow(server: string): boolean {
        const cache = this.cache;
        return !!cache && cache.server === server && (cache.pausedUntil ?? 0) > Date.now();
    }

    private freshNodes(server: string): CachedNode[] {
        const cache = this.cache;
        if (!cache || cache.server !== server) return [];
        const now = Date.now();
        return cache.nodes.filter((n) => n.until > now);
    }

    /** The nodes that failed while the client could connect leave the cache. */
    private drop(server: string, urls: string[]): void {
        const cache = this.cache;
        if (urls.length === 0 || !cache || cache.server !== server) return;
        const nodes = cache.nodes.filter((n) => !urls.some((u) => sameServer(u, n.url)));
        if (nodes.length < cache.nodes.length) this.keep(server, nodes);
    }

    /** The nodes for this realtime server, with its pause while that holds; with neither, no cache. */
    private keep(server: string, nodes: CachedNode[]): void {
        const pausedUntil = this.pausedNow(server) ? this.cache?.pausedUntil : undefined;
        if (pausedUntil) this.save({ server, nodes, pausedUntil });
        else this.save(nodes.length > 0 ? { server, nodes } : null);
    }

    private save(cache: NodeCache | null): void {
        this.cache = cache;
        this.saves++;
        this.store?.write(cache).catch(() => {});
    }

    /** A cache as stored; anything else, an older format included, is no cache. */
    private static valid(value: unknown): NodeCache | null {
        if (!value || typeof value !== 'object') return null;
        const cache = value as Partial<NodeCache>;
        if (typeof cache.server !== 'string' || !Array.isArray(cache.nodes)) return null;
        const now = Date.now();
        const latest = now + MAX_TTL * 1000;
        const nodes = cache.nodes
            .filter((n): n is CachedNode => !!n && typeof n === 'object' && typeof n.url === 'string' && NODE_URL.test(n.url) && typeof n.until === 'number')
            .map((n) => ({ url: n.url, until: Math.min(n.until, latest) }));
        // A pause runs an hour at most from now, whatever the clock did since it was stored.
        const pausedUntil = typeof cache.pausedUntil === 'number' && cache.pausedUntil > now ? Math.min(cache.pausedUntil, now + PAUSE_MS) : 0;
        if (pausedUntil) return { server: cache.server, nodes, pausedUntil };
        return nodes.length > 0 ? { server: cache.server, nodes } : null;
    }
}
