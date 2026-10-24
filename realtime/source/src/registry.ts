/**
 * The page's connector, shared by every WordPlus product on it (version 2 of
 * the connection). Each product bundles a copy of this package; each copy
 * registers in `globalThis.wordplusRealtime`, and the newest runs the page's
 * connector:
 * - in the connector's SharedWorker, when the browser has them and the page
 *   was given the worker's URL (`worker`, the site's: PHP's
 *   `wordplus_realtime_worker_url()`), so the browser holds one connection
 *   however many tabs it has;
 * - else in the page, one connection per tab.
 *
 * The pick is made at the first attach once the page's scripts have run
 * (DOMContentLoaded, or at once after it). A copy that registers after the
 * connector started serves from the next page load. The registry is plain
 * data with two functions, `ready` and `attach`, so a script with no build
 * can use it, as Easy Stream's live list does:
 *
 *     window.wordplusRealtime && window.wordplusRealtime.attach(
 *         { server: 'https://cloud.better-messages.com', path: '/websocket' },
 *         { namespace: '/live-stream-live', auth: () => ( { site } ), rides: true } );
 *
 * Both functions are the first copy's, and what they do never changes, so
 * they are a contract between copies, as `ConnectorApi`, `MemberSpec` and
 * `Sink` are.
 */
import { type AttachOptions, Channel, specOf } from './channel.js';
import { STORE_KEY } from './connection.js';
import { Connector, type ConnectorApi, type Target, VERSION } from './connector.js';
import { localNodeStore } from './node-cache.js';
import { type LocksLike, RemoteConnector } from './remote.js';

/** The registry's name on the page. */
export const REGISTRY = 'wordplusRealtime';

/** The connector's SharedWorker's name: with its URL, which worker a page joins. */
export const WORKER_NAME = 'wordplus-realtime';

export interface RealtimeOptions extends Target {
    /** The connector's SharedWorker script, the site's. Without it, the page runs its connections itself. */
    worker?: string | null;
    /**
     * The page's user, for an app whose browser may hold several (rooms()'s `perUser`): the worker is then that user's
     * (WORKER_NAME and the user), so each user has a connection of their own and their tabs share it, as one browser
     * is one user in Better Messages. Without it, the browser's one worker, which Better Messages' messenger rides.
     */
    user?: string | null;
}

export interface RealtimeClient {
    /** The product's namespace on the shared connection. */
    attach(options: AttachOptions): Channel;
}

export interface CopyStart {
    worker?: string | null;
    user?: string | null;
}

/** A product's copy of this package, as it registers. */
export interface Copy {
    version: string;
    start(config: CopyStart): ConnectorApi;
}

export interface Registry {
    copies: Copy[];
    /** The worker's URL, the first a product gave. */
    worker?: string | null;
    /** Whose worker it is, the first user a product gave (RealtimeOptions' `user`). */
    user?: string | null;
    connector?: ConnectorApi;
    /** The connector, once it runs: at once, or when the page's scripts have run. */
    ready(fn: (connector: ConnectorApi) => void): void;
    /** A namespace as a channel, whose methods are the attaching copy's. */
    attach(target: Target, options: AttachOptions): Channel;
}

/**
 * The product's way in: registers this copy, and returns the product's view
 * of the page's connector for its realtime server.
 */
export function realtime(options: RealtimeOptions): RealtimeClient {
    const registry = register(options.worker, globalThis, options.user);
    const target: Target = { server: options.server, path: options.path };
    return { attach: (attach) => registry.attach(target, attach) };
}

/** This copy in the page's registry, which this copy makes if it is the first. */
export function register(worker?: string | null, scope: Record<string, any> = globalThis, user?: string | null): Registry {
    const registry: Registry = scope[REGISTRY] ?? (scope[REGISTRY] = makeRegistry(scope));
    if (!registry.copies.some((copy) => copy.version === VERSION)) registry.copies.push({ version: VERSION, start: (config) => startConnector(config, scope) });
    if (worker && !registry.worker) registry.worker = worker;
    if (user && !registry.user) registry.user = user;
    return registry;
}

/** The connector's SharedWorker's name for a page: the browser's one, or its user's own (RealtimeOptions' `user`). */
export function workerName(user?: string | null): string {
    return user ? `${WORKER_NAME}|u:${user}` : WORKER_NAME;
}

function makeRegistry(scope: Record<string, any>): Registry {
    const waiting: Array<(connector: ConnectorApi) => void> = [];
    let starting = false;

    const registry: Registry = {
        copies: [],
        ready(fn) {
            if (registry.connector) {
                fn(registry.connector);
                return;
            }
            waiting.push(fn);
            if (starting) return;
            starting = true;

            const doc = scope.document as Document | undefined;
            if (doc && doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
            else start();
        },
        attach(target, options) {
            const channel = new Channel(options);
            registry.ready((connector) => channel.bind(connector.link(target, specOf(options), channel)));
            return channel;
        },
    };

    function start() {
        if (registry.connector) return;
        const newest = [...registry.copies].sort((a, b) => compareVersions(b.version, a.version))[0];
        registry.connector = newest.start({ worker: registry.worker, user: registry.user });
        for (const fn of waiting.splice(0)) fn(registry.connector);
    }

    return registry;
}

/** Where a page notes that the connector's SharedWorker never answered, so the browser's next pages don't wait for it again. */
export const HOLD_KEY = 'wordplus-realtime-worker-hold';
export const HOLD_MS = 30 * 60_000;

/**
 * Whether this page keeps off the connector's SharedWorker and runs its connection itself:
 * - asked to (`?noSharedWorker` in its address);
 * - a phone or a tablet, whose browsers freeze or end a SharedWorker with its page;
 * - or a worker that never answered lately (HOLD_KEY).
 *
 * Every product's page keeps this rule, whichever product gave the worker's URL first.
 */
export function sharedWorkerAvoided(scope: Record<string, any> = globalThis): boolean {
    try {
        if (new URLSearchParams(scope.location?.search ?? '').has('noSharedWorker')) return true;
    } catch { /* no address to read */ }

    const ua = String(scope.navigator?.userAgent ?? '');
    if (/Android|iP(hone|ad|od)/.test(ua) || (/Macintosh|Linux/.test(ua) && Number(scope.navigator?.maxTouchPoints ?? 0) > 1)) return true;

    try {
        return Number(scope.localStorage?.getItem(HOLD_KEY) ?? 0) > Date.now();
    } catch {
        return false;
    }
}

/** This copy's connector: in the SharedWorker, else in the page. */
function startConnector(config: CopyStart, scope: Record<string, any>): ConnectorApi {
    const inPage = () => new Connector({ store: () => localNodeStore(STORE_KEY), doc: scope.document ?? null });

    const SharedWorkerCtor = scope.SharedWorker as typeof SharedWorker | undefined;
    if (!config.worker || typeof SharedWorkerCtor !== 'function' || sharedWorkerAvoided(scope)) return inPage();

    let worker: SharedWorker;
    try {
        worker = new SharedWorkerCtor(config.worker, { name: workerName(config.user) });
    } catch {
        return inPage();
    }

    const remote = new RemoteConnector(worker.port, {
        locks: (scope.navigator?.locks as LocksLike | undefined) ?? null,
        // A worker that failed or never answered: this page in its own, and the browser's next pages too for a while.
        fallback: () => {
            try {
                scope.localStorage?.setItem(HOLD_KEY, String(Date.now() + HOLD_MS));
            } catch { /* no storage: only this page */ }
            return inPage();
        },
    });
    // A script that fails to load, or a page's CSP that blocks it.
    worker.addEventListener?.('error', () => remote.fail());

    // A page put in the back-forward cache leaves the worker's connections, and comes back to them.
    scope.addEventListener?.('pagehide', () => remote.suspend());
    scope.addEventListener?.('pageshow', (event: PageTransitionEvent) => {
        if (event.persisted) remote.resume();
    });

    return remote;
}

/** Compares two versions, number by number: 2.10.0 is after 2.9.1. */
export function compareVersions(a: string, b: string): number {
    const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
    const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
}
