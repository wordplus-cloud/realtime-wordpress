/**
 * The connector: a browser context's shared connections, one hub per realtime
 * cluster (version 2 of the connection). It runs where the connections are: in the
 * connector's SharedWorker (worker.ts), or in the page where there is none
 * (registry.ts). A product attaches its namespace with `link`, or `attach`
 * for a channel of its own.
 *
 * A product names the realtime server it was given. Names of one cluster
 * share a hub (SAME_CLUSTER): Better Messages, given cloud.better-messages.com,
 * and Easy Stream, given ws.wordplus.cloud, ride one connection. It goes
 * through the name of the first product that attached, and its nodes come in
 * that name's domain, which keeps a site's CSP as it was for that product.
 */
import type { ManagerOptions } from 'socket.io-client';
import { type AttachOptions, Channel, type Link, type MemberSpec, type Sink, specOf } from './channel.js';
import { Hub, type ManagerFactory } from './hub.js';
import { hostOf, type NodeStore } from './node-cache.js';
import { SharedNamespace } from './share.js';
import { VERSION } from './version.js';

export { VERSION };

/**
 * Names of one realtime cluster, the first being its key. Its load balancer
 * routes by path whatever the host. A self-hosted server is a cluster of its
 * own.
 */
export const SAME_CLUSTER: string[][] = [
    ['ws.wordplus.cloud', 'cloud.better-messages.com', 'rest.wordplus.cloud'],
];

export function clusterOf(server: string): string {
    const host = hostOf(server) || server.trim().toLowerCase();
    return SAME_CLUSTER.find((names) => names.includes(host))?.[0] ?? host;
}

/** Where a product connects: its realtime server and Socket.IO path. */
export interface Target {
    server: string;
    path?: string;
}

/**
 * What a page's connector offers, whichever copy runs it: a contract between
 * copies, which only grows.
 */
export interface ConnectorApi {
    readonly version: string;
    link(target: Target, spec: MemberSpec, sink: Sink): Link;
}

export interface ConnectorOptions {
    /** Where each hub keeps its node cache; none keeps it in memory. */
    store?: () => NodeStore | null;
    /** The page, for its CSP violations; none in a worker. */
    doc?: Pick<Document, 'addEventListener' | 'removeEventListener'> | null;
    /** socket.io's options for every connection. WebSocket only by default, as every product had it. */
    options?: Partial<ManagerOptions>;
    /** Stand-ins for tests. */
    manager?: ManagerFactory;
    random?: () => number;
}

export class Connector implements ConnectorApi {
    readonly version = VERSION;
    private readonly hubs = new Map<string, Hub>();
    /** Namespaces several attaches share (share.ts), by cluster, path, namespace and key. */
    private readonly shared = new Map<string, SharedNamespace>();

    constructor(private readonly options: ConnectorOptions = {}) {}

    link(target: Target, spec: MemberSpec, sink: Sink): Link {
        if (!spec.share) return this.hub(target).attach(spec, sink);

        // Attaches of one namespace with one key share its socket: one connection however many tabs.
        const key = keyOf(target) + '|' + spec.namespace + '|' + spec.share;
        let group = this.shared.get(key);
        if (!group) {
            const made: SharedNamespace = new SharedNamespace((s, k) => this.hub(target).attach(s, k), spec, () => {
                if (this.shared.get(key) === made) this.shared.delete(key);
            });
            group = made;
            this.shared.set(key, group);
        }
        return group.join(spec, sink);
    }

    /** A product's namespace as a channel of its own. */
    attach(target: Target, options: AttachOptions): Channel {
        const channel = new Channel(options);
        channel.bind(this.link(target, specOf(options), channel));
        return channel;
    }

    /** Whether a connection to the target's cluster is up, which a namespace that rides may join. */
    holds(target: Target): boolean {
        return this.hubs.get(keyOf(target))?.holds() ?? false;
    }

    /** The hub for the target's cluster, which is made by the first product that names it. */
    hub(target: Target): Hub {
        const key = keyOf(target);
        let hub = this.hubs.get(key);
        if (!hub || hub.isClosed) {
            hub = new Hub({
                server: target.server.replace(/\/+$/, ''),
                path: target.path,
                store: this.options.store?.() ?? null,
                doc: this.options.doc ?? null,
                options: { transports: ['websocket'], ...this.options.options },
                manager: this.options.manager,
                random: this.options.random,
            });
            this.hubs.set(key, hub);
        }
        return hub;
    }

    close(): void {
        for (const hub of this.hubs.values()) hub.close();
        this.hubs.clear();
        this.shared.clear();
    }
}

const keyOf = (target: Target) => clusterOf(target.server) + '|' + (target.path ?? '');
