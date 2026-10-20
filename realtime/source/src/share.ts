/**
 * A namespace that several attaches share: tabs of one product, each with
 * its own channel, on one socket of one connection. Socket.IO carries a namespace once on a connection, so
 * without this a second tab's attach of a namespace already there opens a second connection.
 *
 * A product says `share` with a key; attaches of one namespace and one key share. What they share must be
 * the same for each of them: the handshake (the first attach's, while it stays, then the next's), and what
 * the server sends on the socket, which every one of them hears. A product that needs each tab told apart
 * does it on the socket itself (Easy Stream: a `watch` per stream, its events carrying the stream).
 *
 * - **Connecting:** an attach that joins a socket that is up hears `connect` at once (`opened`), so it can
 *   do what it does on a connect; one that joins a socket the server refused hears that.
 * - **Moves:** each one's `ready` runs on the move's new socket, and each hears `moved` with what its own
 *   `ready` gave. One that joined after the readies were asked hears a reconnect instead (`dropped`, then
 *   `opened`), so it does again on the new socket what it does on a connect.
 * - **Leaving:** the socket leaves with the last of them. One that leaves while others stay sends its farewell
 *   on it, if it named one (Channel.farewell), so the server lets go of what that tab joined there:
 *   closed, its page hidden, or its tab gone (remote.ts).
 */
import type { Link, Listener, MemberSpec, PendingSocket, Sink } from './channel.js';

/** How a shared namespace gets its one link on a connection: the hub's attach. */
export type LinkMaker = (spec: MemberSpec, sink: Sink) => Link;

interface Sharer {
    readonly spec: MemberSpec;
    readonly sink: Sink;
    /** Told the socket is up since it last connected, so a join's own telling doesn't tell it twice. */
    open: boolean;
    /** What it sends on the socket when it leaves and others stay. */
    parting: { event: string, args: unknown[] } | null;
}

export class SharedNamespace {
    private readonly sharers: Sharer[] = [];
    private readonly link: Link;
    private connected = false;
    private sid: string | undefined;
    private refusal: { error: Error, active: boolean } | null = null;
    /** A move's readies under way: the new socket, and each sharer's `ready`. */
    private preparing: { next: PendingSocket, values: Map<Sharer, Promise<unknown>> } | null = null;
    private closed = false;

    constructor(make: LinkMaker, first: MemberSpec, private readonly onEmpty: () => void) {
        const spec: MemberSpec = {
            namespace: first.namespace,
            // The handshake of the first sharer still here: what they share is the same for each.
            auth: () => (this.sharers[0]?.spec ?? first).auth(),
            rides: first.rides,
            ready: true,
            share: first.share,
        };
        this.link = make(spec, this.sink());
    }

    /** A sharer's attach: its own link, on the one socket. */
    join(spec: MemberSpec, sink: Sink): Link {
        const sharer: Sharer = { spec, sink, open: false, parting: null };
        this.sharers.push(sharer);

        // Joining a socket that is up, or one the server refused: told at once, as at a connect.
        queueMicrotask(() => {
            if (!this.sharers.includes(sharer) || sharer.open) return;
            if (this.connected) {
                sharer.open = true;
                sink.opened(this.sid);
            } else if (this.refusal) {
                sink.refused(this.refusal.error, this.refusal.active);
            }
        });

        // A move's readies under way: this one's on the new socket too.
        if (this.preparing) this.preparing.values.set(sharer, sink.prepare(this.preparing.next));

        const shared = this;
        return {
            get id() {
                return shared.link.id;
            },
            emit: (event: string, args: unknown[], reply?: Listener) => this.link.emit(event, args, reply),
            connect: () => this.link.connect(),
            update: () => this.link.update(),
            close: () => this.leave(sharer),
            farewell: (event: string | null, args: unknown[]) => {
                sharer.parting = event ? { event, args } : null;
            },
        };
    }

    private leave(sharer: Sharer): void {
        const i = this.sharers.indexOf(sharer);
        if (i < 0) return;
        this.sharers.splice(i, 1);
        this.preparing?.values.delete(sharer);

        if (this.sharers.length === 0) {
            if (this.closed) return;
            this.closed = true;
            this.link.close();
            this.onEmpty();
        } else if (sharer.parting && this.connected) {
            // The socket stays with the others: what this one joined on it goes.
            this.link.emit(sharer.parting.event, sharer.parting.args);
        }
    }

    /** What the hub tells the one link, told to each sharer. */
    private sink(): Sink {
        const each = (fn: (sink: Sink) => void) => {
            for (const sharer of [...this.sharers]) fn(sharer.sink);
        };

        return {
            deliver: (event, args) => each((s) => s.deliver(event, args)),
            opened: (sid) => {
                this.connected = true;
                this.sid = sid;
                this.refusal = null;
                for (const sharer of [...this.sharers]) {
                    sharer.open = true;
                    sharer.sink.opened(sid);
                }
            },
            dropped: (reason) => {
                this.connected = false;
                for (const sharer of this.sharers) sharer.open = false;
                each((s) => s.dropped(reason));
            },
            refused: (error, active) => {
                this.connected = false;
                this.refusal = { error, active };
                for (const sharer of this.sharers) sharer.open = false;
                each((s) => s.refused(error, active));
            },
            prepare: (next) => this.prepare(next),
            moved: (values) => {
                const given = values instanceof Map ? values as Map<Sharer, unknown> : new Map<Sharer, unknown>();
                for (const sharer of [...this.sharers]) {
                    if (given.has(sharer)) {
                        sharer.sink.moved(given.get(sharer));
                    } else {
                        // Joined after the readies were asked: a reconnect, so it does again what it does on a connect.
                        sharer.sink.dropped('transport close');
                        sharer.open = true;
                        sharer.sink.opened(this.link.id);
                    }
                }
            },
        };
    }

    /** Every sharer's `ready` on the move's new socket (one without a ready answers at once), those that join meanwhile too. */
    private async prepare(next: PendingSocket): Promise<Map<Sharer, unknown>> {
        const values = new Map<Sharer, Promise<unknown>>();
        for (const sharer of this.sharers) values.set(sharer, sharer.sink.prepare(next));
        this.preparing = { next, values };

        try {
            for (;;) {
                const batch = [...values.entries()];
                await Promise.all(batch.map(([, value]) => value));
                if ([...values.keys()].every((sharer) => batch.some(([s]) => s === sharer))) break;
            }
            const given = new Map<Sharer, unknown>();
            for (const [sharer, value] of values) given.set(sharer, await value);
            return given;
        } finally {
            if (this.preparing?.next === next) this.preparing = null;
        }
    }
}
