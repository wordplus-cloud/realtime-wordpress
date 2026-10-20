/**
 * Calls for any plugin or app, on the connection `rooms()` holds:
 *
 *     const rt = wordplusRealtimeClient.rooms(window.wordplusRealtimeConfig);
 *     const calls = wordplusRealtimeCalls.calls(rt, window.wordplusRealtimeConfig);
 *
 *     calls.on('incoming', (incoming) => showRing(incoming));           // incoming.accept() or incoming.decline()
 *     const call = await calls.start('support:34:42', { to: 34, type: 'video' });
 *     call.on('remote', (remote) => remote.camera?.attach(videoElement));
 *     call.setTrack('camera', cameraTrack);
 *
 *     call.on('group', (group) => showGroup(group));                    // someone was added: it goes on as a group call
 *     await call.add(43);                                                // rings 43 into it
 *
 *     const meeting = await calls.group('meeting:daily');               // a group call on the mesh
 *
 * - **The site decides who may call whom:** each call, line and room is a token its auth route signs, the plugin that
 *   owns the call's name answering (the PHP package's `calls()`).
 * - **A call between two people** runs on the call engine Better Messages uses too (../calls): direct between the two browsers, through
 *   TURN when no direct path works, and moved into a room on the mesh when TURN fails too.
 * - **It rings in browsers:** every tab holding the callee's line rings, and stops once one answers or declines.
 * - **It becomes a group call** when either side adds someone: both go on in a room of the call's own on the mesh, and
 *   the person is rung into it. Everyone in it may add more.
 * - **A call's rooms are encrypted end to end,** with a key only the site gives out, so a call stays as private when it
 *   leaves the direct path as it was on it.
 */
import type { Rooms, RoomsOptions } from '../rooms.js';
import { Listeners, type Listener, type PendingSocket } from '../channel.js';
import type { Keyring } from '../keys.js';
import { P2PCallSession, type P2PParticipantView } from '../calls/session.js';
import { SfuReporter } from '../calls/sfu-report.js';
import { randomId, type MediaState, type P2PQuality, type P2PStats, type SfuHandoff } from '../calls/types.js';
import { callUserOf, type CallUser } from '../calls/users.js';
import { CallDispatcher, SdkCallTransport } from './transport.js';
import { openRoom, GroupCall, type GroupLink, type ModerationAct, type Person, type RemoteTrack, type RoomExtras } from './group-call.js';
import { Invite, inviteState } from './invite.js';
import { loadLiveKit, type MediaSource } from './media.js';
import { Stream } from './stream.js';
import { streamsEngine } from './streams-engine.js';
import type { Media } from '../streams/media.js';

const ANSWER_MS = 8000;
/** A token is renewed this long before it runs out. */
const RENEW_BEFORE_S = 600;
/** A call moved to a room gives the other side this long to arrive, or come back, before it ends. */
const ROOM_WAIT_MS = 60_000;
const ROOM_REPORT_MS = 15_000;

export type CallType = 'audio' | 'video';

/** How far into the next second a join waits after its call took it out or ended (afterOut()). */
const OUT_MARGIN_MS = 150;

/** The most people one `may` request asks about: the route refuses more. */
const MAY_AT_ONCE = 100;

/**
 * What the page asks the site's calls route for: its line, its side of a call, a place in a room, who it may add to a
 * call, or whether it may call each of some people (`may`, at most 100, each asked of the rule as its caller). A side
 * of a call with `group` rings someone into the group call it became (its caller's, with the call's `pair` and the
 * ringer's `member` proof), or answers that ring (with the `ring` proof the ring brought).
 */
export type CallRequest =
    | { line: true }
    | { call: string; id: string; role: 'caller'; to: CallUser; type: CallType; group?: string; pair?: [CallUser, CallUser]; member?: string }
    | { call: string; id: string; role: 'callee'; from: CallUser; type: CallType; group?: string; pair?: [CallUser, CallUser]; ring?: string }
    | { room: string; type: CallType }
    | { people: string }
    | { may: Array<{ call: string; to: CallUser }> }
    | { moderate: string; act: ModerationAct; user: CallUser }
    | { stream: string };

/** Someone the page's user may add to a call, as the site lists them. */
export interface CallPerson {
    id: CallUser;
    name: string;
    avatar?: string;
}

/**
 * What the route answers: a token and when it runs out, the call's key for its signals, the key its rooms encrypt
 * their media with (`media_key`, for a call's rooms always, a group call's when its plugin encrypts it), the people the
 * page's user may add, or why it refused. For a call: its two people (`pair`), the user's proof of being in it
 * (`member`), which ringing someone in needs, and for a ring the proof the person was rung (`ring`), which the server
 * hands them with it. The site makes the proofs with its master key, which the server never sees.
 */
export interface CallGrant {
    token?: string;
    exp?: number;
    key?: string;
    media_key?: string;
    pair?: [CallUser, CallUser];
    member?: string;
    ring?: string;
    people?: CallPerson[];
    /** For `may`: whether the user may call each person asked about, in the order asked. */
    may?: boolean[];
    /** For `moderate`: whether the act changed anything. */
    done?: boolean;
    denied?: string;
}

/** A call that is, or may become, a group call: what ringing someone into it needs. */
interface GroupOf {
    id: string;
    name: string;
    type: CallType;
    pair?: [CallUser, CallUser];
    member?: string;
}

export interface CallsOptions {
    /** The site's calls route and its headers (the PHP package's `wordplus/v1/realtime/calls`). By default, beside the rooms' auth route. */
    calls?: { endpoint: string; headers?: Record<string, string> };
    /** Or a function that signs, in the route's place. */
    authorize?: (request: CallRequest) => Promise<CallGrant>;
    /** The rooms script (the mesh's room client), which the PHP package names. */
    rooms?: string;
    /** Its encryption worker; beside the rooms script by default. */
    roomsWorker?: string;
    /** The streams script, which the classic calls script loads on a page's first stream; beside the rooms script by default. */
    streams?: string;
    /** The relay's address for requests, for the leave a closing page sends. */
    api?: string;
    /** Hold the page's line, so its user's calls ring here. Yes by default; a page without a signed-in user has none. */
    ring?: boolean;
}

const nowS = () => Math.floor(Date.now() / 1000);
const refused = (code: string) => Object.assign(new Error(code), { code });

const instances = new WeakMap<Rooms, Calls>();

/** The page's calls, on a site's or app's rooms: one for each. */
export function calls(rt: Rooms, options: CallsOptions = {}): Calls {
    let found = instances.get(rt);
    if (!found) {
        found = new Calls(rt, options);
        instances.set(rt, found);
    }
    return found;
}

export class Calls {
    private readonly ride: ReturnType<Rooms['rideFor']>;
    private readonly dispatcher: CallDispatcher;
    private readonly listeners = new Listeners();
    private readonly socketListeners = new Set<() => void>();
    private readonly ringing = new Map<string, Incoming>();
    private readonly active = new Map<string, Call>();
    /** When a group call this page was in took it out or ended, by its name (afterOut()). */
    private readonly outAt = new Map<string, number>();
    /** The rings into group calls this page heard of, and the rooms of the group calls it is in, by their ids. */
    private readonly invites = new Map<string, Invite>();
    private readonly groups = new Map<string, GroupCall>();
    private line: { user: CallUser | null; token: string; exp: number } | null = null;
    private lineRenewal: ReturnType<typeof setTimeout> | null = null;
    private ringOn: boolean;

    constructor(private readonly rt: Rooms, private readonly options: CallsOptions = {}) {
        this.ride = rt.rideFor((via) => this.holdLine(via));
        this.dispatcher = new CallDispatcher(this.ride.socket);
        this.ringOn = options.ring !== false;

        this.ride.socket.on('line', (m: any) => this.onLine(m));
        // A connect after a drop, and a move to another node: each call joins on the socket the page has now.
        const changed = () => {
            for (const listener of this.socketListeners) listener();
        };
        rt.on('connected', changed);
        rt.on('moved', changed);

        if (this.ringOn && this.ride.socket.connected) void this.holdLine();
    }

    /**
     * `incoming` (Incoming: a call ringing for this page's user), `call` (Call: one this page started or answered),
     * `group` (GroupCall: one it joined, by `group()`, a ring into one answered, or a call of its that became one),
     * `error` ({ code }). `call` and `group` hear the calls a call screen makes too, so a page can keep to its own rules,
     * such as how long a call may last.
     */
    on(event: 'incoming' | 'call' | 'group' | 'error', fn: Listener): this {
        this.listeners.on(event, fn);
        return this;
    }

    off(event: 'incoming' | 'call' | 'group' | 'error', fn?: Listener): this {
        this.listeners.off(event, fn);
        return this;
    }

    /** The calls ringing for this page's user now. */
    incoming(): Incoming[] {
        return [...this.ringing.values()];
    }

    /** Calls `to` (a user id) about `name`, a call the plugin owns: rings their every open tab. Rejects with its `code`. */
    async start(name: string, options: { to: CallUser; type?: CallType }): Promise<Call> {
        const type = options.type ?? 'video';
        const id = randomId(20);
        const request: CallRequest = { call: name, id, role: 'caller', to: options.to, type };
        const grant = await this.authorize(request);

        const call = new Call(this, { id, name, type, role: 'caller', peer: { user: callUserOf(options.to) ?? options.to, info: null } }, request, grant);
        this.active.set(id, call);
        await call.begin();
        this.listeners.fire('call', [call], false);
        return call;
    }

    /**
     * A group call `name` on the mesh, encrypted end to end when its rule says so. Rejects with its `code`.
     */
    async group(name: string, options: { type?: CallType } = {}): Promise<GroupCall> {
        await this.afterOut(name);
        const grant = await this.authorize({ room: name, type: options.type ?? 'video' });
        const place = await this.ask('room', { tab: this.ride.tab, token: grant.token });
        if (!place?.ok) throw refused(place?.error ?? 'server');

        const room = await this.openRoom({}, grant.media_key, undefined, (act, user) => this.moderateVia(name, act, user));
        room.on('ended', (reason: string) => {
            if (reason === 'removed' || reason === 'closed') this.outAt.set(name, Date.now());
        });
        this.connectRoom(room, place, name);
        this.listeners.fire('group', [room], false);
        return room;
    }

    /**
     * The live stream `name`: the app's route signs Easy Stream's grant for it, as the app's
     * `streams()` rule says who is what in it, and the page joins as that host, guest or viewer. Its chat rides the page's
     * connection; its picture comes through the rooms script. Rejects with its `code`. `video: false` for a page that shows
     * only the chat or the stream's details: the picture is fetched once something wants it (`watch()`).
     */
    async stream(name: string, options: { video?: boolean } = {}): Promise<Stream> {
        let first: string | null = (await this.authorize({ stream: name })).token;
        const ride = this.ride.options;
        // The engine is fetched on a page's first stream, so a page with calls alone never carries it.
        const { EasyStreamClient } = await streamsEngine(this.options.streams ?? this.options.rooms?.replace(/realtime-rooms\.min\.js(?=$|\?)/, 'realtime-streams.min.js'));
        const engine = new EasyStreamClient({
            cloud: ride.server,
            // The grant the route just signed, then a new one each time one runs out.
            grant: async () => {
                if (first) {
                    const token = first;
                    first = null;
                    return token;
                }
                return (await this.authorize({ stream: name })).token;
            },
            media: () => loadLiveKit(this.options.rooms) as unknown as Promise<Media>,
            worker: ride.worker ?? null,
            video: options.video,
        });
        await engine.start();

        const joined = engine.getState();
        if (joined.status === 'error') {
            engine.stop();
            throw refused(joined.error ?? 'server');
        }
        return new Stream(name, engine);
    }

    /**
     * Who the page's user may add to calls named `name`, as the site lists them (the PHP package's `calls()`,
     * `people`): none when it lists nobody.
     */
    async people(name: string): Promise<CallPerson[]> {
        let answer: CallGrant;
        try {
            answer = await (this.options.authorize ?? ((r: CallRequest) => this.viaRoute(r)))({ people: name });
        } catch {
            return [];
        }
        return Array.isArray(answer?.people) ? answer.people.filter((p) => callUserOf(p?.id) !== null && typeof p?.name === 'string').map((p) => ({ ...p, id: callUserOf(p.id)! })) : [];
    }

    /**
     * Whether the page's user may call each person about each call, as the site's rules answer for a caller, in the order
     * asked: what a list of people asks before it offers call buttons. `null` where the site gave no answer (a route of
     * the app's own that doesn't know the question, or a failed request): placing the call still asks the rule.
     */
    async may(asks: Array<{ call: string; to: CallUser }>): Promise<Array<boolean | null>> {
        const out: Array<boolean | null> = [];
        for (let i = 0; i < asks.length; i += MAY_AT_ONCE) {
            const part = asks.slice(i, i + MAY_AT_ONCE).map((a) => ({ call: a.call, to: a.to }));
            let answer: CallGrant | null = null;
            try {
                answer = await (this.options.authorize ?? ((r: CallRequest) => this.viaRoute(r)))({ may: part });
            } catch {
                answer = null;
            }
            const may = Array.isArray(answer?.may) && answer.may.length === part.length ? answer.may : null;
            for (let j = 0; j < part.length; j++) out.push(may ? may[j] === true : null);
        }
        return out;
    }

    /** Stops holding this page's line: its user's calls no longer ring here. */
    stopRinging(): void {
        this.ringOn = false;
        if (this.lineRenewal) clearTimeout(this.lineRenewal);
        this.lineRenewal = null;
        if (this.ride.socket.connected) this.ride.socket.emit('unline', { tab: this.ride.tab });
    }

    /** @internal */
    async answer(incoming: Incoming): Promise<Call | GroupCall> {
        if (incoming.group) return this.answerGroup(incoming, incoming.group);

        const request: CallRequest = { call: incoming.call, id: incoming.id, role: 'callee', from: incoming.from, type: incoming.type };
        const grant = await this.authorize(request);
        const call = new Call(this, { id: incoming.id, name: incoming.call, type: incoming.type, role: 'callee', peer: { user: incoming.from, info: incoming.info } }, request, grant);
        this.ringing.delete(incoming.id);
        this.active.set(incoming.id, call);
        await call.begin();
        this.listeners.fire('call', [call], false);
        return call;
    }

    /** A ring into a group call, answered with the proof it brought: the site's token for this ring, then a place in its room. */
    private async answerGroup(incoming: Incoming, group: string): Promise<GroupCall> {
        const request: CallRequest = { call: incoming.call, id: incoming.id, role: 'callee', from: incoming.from, type: incoming.type, group, ...incoming.proofs };
        const grant = await this.authorize(request);
        this.ringing.delete(incoming.id);
        return this.joinGroup({ id: group, name: incoming.call, type: incoming.type, pair: grant.pair ?? incoming.proofs.pair, member: grant.member }, grant.token, grant.media_key);
    }

    /**
     * @internal A place in a group call's room, with the token of the call it was made from or of the ring answered,
     * the call's media already sent to it when it was a call.
     */
    async joinGroup(group: GroupOf, token: string, mediaKey: string | undefined, tracks?: Map<MediaSource, MediaStreamTrack>): Promise<GroupCall> {
        const place = await this.ask('group', { tab: this.ride.tab, token });
        if (!place?.ok) throw refused(place?.error ?? 'server');

        const link: GroupLink = {
            id: group.id,
            add: (user) => this.invite(group, user),
            invites: () => [...this.invites.values()].filter((invite) => invite.group === group.id),
        };
        const room = await this.openRoom({}, mediaKey, link);
        for (const [source, track] of tracks ?? []) await room.setTrack(source, track);

        this.groups.set(group.id, room);
        room.on('ended', () => {
            if (this.groups.get(group.id) !== room) return;
            this.groups.delete(group.id);
            for (const invite of link.invites()) this.invites.delete(invite.id);
        });
        this.connectRoom(room, place, group.name);
        this.listeners.fire('group', [room], false);
        return room;
    }

    /**
     * @internal Rings `user` into a group call, or into the call that becomes one: the site's token for the ring first,
     * given for the proof that this page's user is in the call, and the proof the person was rung, which the server
     * hands them with the ring.
     */
    async invite(group: GroupOf, user: CallUser): Promise<Invite> {
        const id = randomId(20);
        const grant = await this.authorize({ call: group.name, id, role: 'caller', to: user, type: group.type, group: group.id, pair: group.pair, member: group.member });
        const reply = await this.ask('invite', { tab: this.ride.tab, token: grant.token, ring: grant.ring });
        if (!reply?.ok) throw refused(reply?.error ?? 'server');

        // Its `ringing` may have come on the line first.
        let invite = this.invites.get(id);
        if (!invite) {
            invite = new Invite({ id, group: group.id, to: user, state: inviteState(reply.state) ?? 'ringing' });
            this.invites.set(id, invite);
            this.groups.get(group.id)?.invited(invite);
        }
        invite.own(async () => {
            const over = await this.ask('uninvite', { tab: this.ride.tab, token: grant.token });
            if (!over?.ok) throw refused(over?.error ?? 'server');
            const state = inviteState(over.state);
            if (state) invite!.update(state);
        });
        return invite;
    }

    /** @internal */
    async decline(incoming: Incoming, reason: 'declined' | 'busy'): Promise<void> {
        this.ringing.delete(incoming.id);
        const reply = await this.ask('decline', { tab: this.ride.tab, id: incoming.id, reason });
        if (!reply?.ok) throw refused(reply?.error ?? 'server');
    }

    /** @internal What a call needs of the page: its socket, tab, site, the relay's address and the rooms script. */
    transportFor(call: Call): SdkCallTransport {
        return new SdkCallTransport({
            socket: this.ride.socket,
            tab: this.ride.tab,
            dispatcher: this.dispatcher,
            token: () => call.token,
            api: this.options.api,
            site: this.rt.site,
            onSocketChange: (listener) => {
                this.socketListeners.add(listener);
                return () => this.socketListeners.delete(listener);
            },
        });
    }

    /**
     * @internal A room, its encryption worker started when the site gave its key: a call's rooms always, a group call's
     * when its plugin encrypts it.
     */
    async openRoom(options: Record<string, unknown>, mediaKey: string | undefined, group?: GroupLink, moderate?: RoomExtras['moderate']): Promise<GroupCall> {
        const lib = await loadLiveKit(this.options.rooms);
        return openRoom(lib, options, this.ride.keyring, { key: mediaKey, worker: this.options.roomsWorker, rooms: this.options.rooms, group, moderate });
    }

    /**
     * Before joining a group call this page was just taken out of, or that just ended: the realtime server refuses a
     * token signed in the second of that, as from before it (better-messages-server's outs.ts), so the page asks its
     * server once the next second has begun. Someone removed who joins again at once was refused `forbidden`.
     */
    private async afterOut(name: string): Promise<void> {
        const out = this.outAt.get(name);
        if (out === undefined) return;
        this.outAt.delete(name);
        const wait = (Math.floor(out / 1000) + 1) * 1000 + OUT_MARGIN_MS - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }

    /** A host's act in the group call `name`, as the site's calls route answers it: whether it changed anything. */
    private async moderateVia(name: string, act: ModerationAct, user: CallUser): Promise<boolean> {
        const answer = await (this.options.authorize ?? ((r: CallRequest) => this.viaRoute(r)))({ moderate: name, act, user });
        if (answer?.denied) throw refused(answer.denied);
        if (typeof answer?.done !== 'boolean') throw refused('server');
        return answer.done;
    }

    /** Connects a room in the background: one that fails is left, and said so. */
    private connectRoom(room: GroupCall, place: any, name: string): void {
        void room.connect({ server: place.server, token: place.token, iceServers: place.ice_servers }).catch((error: any) => {
            room.leave();
            this.listeners.fire('error', [{ code: 'room_failed', room: name, error }], false);
        });
    }

    /** @internal The page's keyring, which opens what the site said about the people in a call. */
    get keyring(): Keyring {
        return this.ride.keyring;
    }

    /** @internal */
    forget(call: Call): void {
        if (this.active.get(call.id) === call) this.active.delete(call.id);
    }

    /** @internal The site's answer to a request, or a refusal with its code. */
    async authorize(request: CallRequest): Promise<CallGrant & { token: string }> {
        let grant: CallGrant;
        try {
            grant = await (this.options.authorize ?? ((r: CallRequest) => this.viaRoute(r)))(request);
        } catch {
            throw refused('auth_failed');
        }
        if (grant?.denied) throw refused(grant.denied);
        if (typeof grant?.token !== 'string' || !grant.token) throw refused('auth_failed');
        return grant as CallGrant & { token: string };
    }

    private async viaRoute(request: CallRequest): Promise<CallGrant> {
        const route = this.options.calls ?? routeBeside(this.ride.options);
        if (!route) return { denied: 'no_auth' };
        const res = await fetch(route.endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', ...route.headers },
            body: JSON.stringify(request),
        });
        if (res.status === 403 || res.status === 401) return { denied: ((await res.json().catch(() => null)) as any)?.denied ?? 'forbidden' };
        if (!res.ok) throw new Error('calls route ' + res.status);
        return (await res.json()) as CallGrant;
    }

    private ask(event: string, payload: Record<string, unknown>, via?: PendingSocket): Promise<any> {
        return (via ?? this.ride.socket).timeout(ANSWER_MS).emitWithAck(event, payload).catch(() => ({ error: 'timeout' }));
    }

    /** Holds the line on the socket, or a move's new one before it takes over; asks the site for it when it has none. */
    private async holdLine(via?: PendingSocket): Promise<void> {
        if (!this.ringOn) return;

        if (!this.line || this.line.exp - nowS() < 60) {
            try {
                const grant = await this.authorize({ line: true });
                this.line = { user: null, token: grant.token, exp: Number(grant.exp) || nowS() + 3600 };
            } catch (e: any) {
                // A page without a signed-in user (or a visitor id) has no line: nothing rings here.
                this.line = null;
                if (e?.code !== 'no_user') this.listeners.fire('error', [{ code: e?.code ?? 'auth_failed', what: 'line' }], false);
                return;
            }
        }

        const reply = await this.ask('line', { tab: this.ride.tab, token: this.line.token }, via);
        if (!reply?.ok) {
            if (reply?.error === 'expired') this.line = null;
            if (reply?.error !== 'timeout') this.listeners.fire('error', [{ code: reply?.error ?? 'server', what: 'line' }], false);
            return;
        }

        for (const ring of reply.ringing ?? []) this.ring(ring);
        this.scheduleLineRenewal();
    }

    private scheduleLineRenewal(): void {
        if (this.lineRenewal) clearTimeout(this.lineRenewal);
        if (!this.line) return;
        const inS = Math.max(30, this.line.exp - RENEW_BEFORE_S - nowS());
        this.lineRenewal = setTimeout(() => {
            this.line = null;
            if (this.ride.socket.connected) void this.holdLine();
        }, inS * 1000);
    }

    private onLine(m: any): void {
        if (!m || typeof m.id !== 'string') return;
        if (m.op === 'incoming') this.ring(m);
        else if (m.op === 'ring_over') {
            const incoming = this.ringing.get(m.id);
            if (!incoming) return;
            this.ringing.delete(m.id);
            incoming.over(String(m.reason ?? 'ended'));
        } else if (m.op === 'invite') this.heardInvite(m);
    }

    /** Someone rung into a group call this page's user is in, or how that ring ended: the room hears of a new one. */
    private heardInvite(m: any): void {
        const state = inviteState(m.state);
        const to = callUserOf(m.to);
        if (!state || typeof m.group !== 'string' || to === null) return;

        const known = this.invites.get(m.id);
        if (known) {
            known.update(state);
            return;
        }
        const invite = new Invite({ id: m.id, group: m.group, from: callUserOf(m.from), to, state });
        this.invites.set(m.id, invite);
        this.groups.get(m.group)?.invited(invite);
    }

    /**
     * A call ringing: shown once the caller's info opens (the site seals it with the day's key), after asking the site
     * for a key the page lacks. Ringing already, so a `ring_over` meanwhile stops it before it shows.
     */
    private ring(m: any): void {
        if (typeof m?.id !== 'string' || this.ringing.has(m.id) || this.active.has(m.id)) return;
        const keys = this.ride.keyring;
        const opened = () => keys.openJson(m.info) ?? null;
        const missing = keys.missing(m.info);
        const incoming = new Incoming(this, { ...m, info: missing.length === 0 ? opened() : null });
        this.ringing.set(m.id, incoming);
        if (missing.length === 0) {
            this.listeners.fire('incoming', [incoming], false);
            return;
        }
        void keys.ensure(missing).then(() => {
            if (this.ringing.get(m.id) !== incoming || incoming.state !== 'ringing') return;
            incoming.info = opened();
            this.listeners.fire('incoming', [incoming], false);
        });
    }
}

/** The calls route beside the rooms' auth route: `…/realtime/auth` → `…/realtime/calls`. */
function routeBeside(options: RoomsOptions): { endpoint: string; headers?: Record<string, string> } | null {
    const auth = options.auth;
    if (!auth?.endpoint || !/\/auth\/?$/.test(auth.endpoint)) return null;
    return { endpoint: auth.endpoint.replace(/\/auth\/?$/, '/calls'), headers: auth.headers };
}

/**
 * A call ringing for this page's user, or a ring into a group call (`group`: someone in it added them). `over` (the
 * reason) when it stops ringing: answered elsewhere, declined, cancelled …
 */
export class Incoming {
    readonly id: string;
    /** The plugin's name for the call, such as `support-42`. */
    readonly call: string;
    /** Who calls: their user id, and what the site's token said about them, opened. */
    readonly from: CallUser;
    info: unknown;
    readonly type: CallType;
    /** The group call it rings into, by its id; null for a call between two people. */
    readonly group: string | null;
    state: 'ringing' | 'answered' | 'declined' | 'over' = 'ringing';
    reason: string | null = null;
    /** @internal What a ring into a group call brought for the site: the call's pair, and the proof this user was rung. */
    readonly proofs: { pair?: [CallUser, CallUser]; ring?: string };
    private readonly listeners = new Listeners();

    constructor(private readonly owner: Calls, m: any) {
        this.id = m.id;
        this.call = String(m.call ?? '');
        this.from = callUserOf(m.from) ?? 0;
        this.info = m.info ?? null;
        this.type = m.type === 'audio' ? 'audio' : 'video';
        this.group = typeof m.group === 'string' && m.group !== '' ? m.group : null;
        const two = Array.isArray(m.pair) && m.pair.length === 2 ? m.pair.map(callUserOf) : [];
        const pair = two.length === 2 && two.every((u: CallUser | null) => u !== null) ? (two as [CallUser, CallUser]) : undefined;
        this.proofs = { pair, ring: typeof m.ring === 'string' ? m.ring : undefined };
    }

    on(event: 'over', fn: Listener): this {
        this.listeners.on(event, fn);
        return this;
    }

    off(event: 'over', fn?: Listener): this {
        this.listeners.off(event, fn);
        return this;
    }

    /**
     * Answers: the call, connecting, or for a ring into a group call (`group`) the GroupCall. Rejects with its `code`, such as
     * `forbidden` when the plugin said no.
     */
    accept(): Promise<Call | GroupCall> {
        if (this.state !== 'ringing') return Promise.reject(refused(this.reason ?? 'not_ringing'));
        this.state = 'answered';
        // It rings no more, wherever it shows: a ring card stayed when a page answered through the API (an SDK review).
        this.listeners.fire('over', ['answered'], false);
        return this.owner.answer(this);
    }

    /** Turns it down, or says this user is busy: it ends for the caller, and stops ringing on every tab. */
    decline(reason: 'declined' | 'busy' = 'declined'): Promise<void> {
        if (this.state !== 'ringing') return Promise.resolve();
        this.state = 'declined';
        this.listeners.fire('over', [reason], false);
        return this.owner.decline(this, reason);
    }

    /** @internal */
    over(reason: string): void {
        if (this.state !== 'ringing') return;
        this.state = 'over';
        this.reason = reason;
        this.listeners.fire('over', [reason], false);
    }
}

export type CallState = 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended';
/** What carries the call: straight between the browsers, through TURN, or a room on the mesh. */
export type CallPath = 'direct' | 'relay' | 'room';

/** What the other side sends, and what they have on. */
export interface RemoteMedia {
    camera: RemoteTrack | null;
    microphone: RemoteTrack | null;
    screen: RemoteTrack | null;
    screenAudio: RemoteTrack | null;
    /** What they have switched on, whether or not it has arrived yet. */
    media: MediaState;
    quality: P2PQuality;
}

const NOTHING: MediaState = { camera: false, microphone: false, screen_share: false, screen_share_audio: false };

interface CallIdentity {
    id: string;
    name: string;
    type: CallType;
    role: 'caller' | 'callee';
    peer: { user: CallUser; info: unknown };
}

type CallEvent = 'state' | 'path' | 'remote' | 'waiting' | 'reacquire' | 'autoplay_blocked' | 'group' | 'ended';

/**
 * A call between two people. Events: `state` (CallState), `path` (CallPath), `remote` (RemoteMedia), `waiting`
 * ({ until, reason }: the mesh is finding the room a place), `reacquire` (the source the other side stopped hearing:
 * open the device again), `autoplay_blocked` (a click must start the sound), `group` (GroupCall: someone was added, and
 * the call goes on as a group call there, with what this page sends), and `ended` (the reason; `group` after `group`).
 */
export class Call {
    readonly id: string;
    readonly name: string;
    readonly type: CallType;
    readonly role: 'caller' | 'callee';
    /** The other side: their user id, and what the site said about them (the caller's info, for a callee). */
    readonly peer: { user: CallUser; info: unknown };
    state: CallState;
    path: CallPath | null = null;
    endReason: string | null = null;
    remote: RemoteMedia = { camera: null, microphone: null, screen: null, screenAudio: null, media: { ...NOTHING }, quality: 'unknown' };
    /** @internal */
    token: string;
    private readonly listeners = new Listeners();
    private readonly transport: SdkCallTransport;
    private readonly session: P2PCallSession;
    private readonly local = new Map<MediaSource, MediaStreamTrack>();
    /** The key the call's rooms encrypt their media with, from the site; none from an older site's package. */
    private mediaKey: string | undefined;
    /** The call's two people and this user's proof of being in it, from the site: what ringing someone in needs. */
    private proofs: { pair?: [CallUser, CallUser]; member?: string };
    private room: GroupCall | null = null;
    private toGroupOnce: Promise<void> | null = null;
    private reporter: SfuReporter | null = null;
    private reportTimer: ReturnType<typeof setInterval> | null = null;
    private roomWait: ReturnType<typeof setTimeout> | null = null;
    private renewal: ReturnType<typeof setTimeout> | null = null;
    private connectedOnce = false;

    constructor(private readonly owner: Calls, who: CallIdentity, private readonly request: CallRequest, grant: CallGrant & { token: string }) {
        this.id = who.id;
        this.name = who.name;
        this.type = who.type;
        this.role = who.role;
        this.peer = who.peer;
        this.state = who.role === 'caller' ? 'ringing' : 'connecting';
        this.token = grant.token;
        this.mediaKey = grant.media_key;
        this.proofs = { pair: grant.pair, member: grant.member };
        this.transport = owner.transportFor(this);
        this.session = new P2PCallSession({ transport: this.transport, callId: this.id, type: this.type, signalKey: grant.key ?? '' });
        this.scheduleRenewal(Number(grant.exp) || nowS() + 3600);

        this.session.on('peerJoined', () => {
            if (this.state === 'ringing') this.setState('connecting');
        });
        this.session.on('connection', (state) => {
            if (state === 'connected') {
                this.connectedOnce = true;
                this.setState('connected');
            } else if (state === 'reconnecting') this.setState('reconnecting');
            else if (state === 'connecting' && this.state !== 'ringing') this.setState(this.connectedOnce ? 'reconnecting' : 'connecting');
        });
        this.session.on('participant', (view) => this.fromView(view));
        this.session.on('stats', (stats) => this.fromStats(stats));
        this.session.on('fallback', (sfu) => void this.toRoom(sfu));
        // Someone was added: the relay ends the call between two people as `group`, and it goes on in the group's room.
        this.session.on('ended', (reason) => (reason === 'group' ? void this.toGroup() : this.finish(reason)));
        this.session.on('playbackBlocked', () => this.listeners.fire('autoplay_blocked', [], false));
        this.session.on('reacquire', (source) => this.listeners.fire('reacquire', [source], false));
    }

    on(event: CallEvent, fn: Listener): this {
        this.listeners.on(event, fn);
        return this;
    }

    off(event: CallEvent, fn?: Listener): this {
        this.listeners.off(event, fn);
        return this;
    }

    /**
     * Rings `user` into the call, which becomes a group call: both sides get `room` and go on there, and `user` arrives
     * in it once they answer. The site decides as for any call, with this page's user calling `user` about the call's
     * name. Rejects with its `code`: `not_connected` before the call is up, or the site's or the server's refusal.
     */
    add(user: CallUser): Promise<Invite> {
        if (this.state !== 'connected' && this.state !== 'reconnecting') return Promise.reject(refused('not_connected'));
        return this.owner.invite(this.group(), user);
    }

    /** The group call this call is, or becomes. */
    private group(): GroupOf {
        return { id: this.id, name: this.name, type: this.type, ...this.proofs };
    }

    /** What this page sends from a source: a live track, or null to stop sending it. */
    setTrack(source: MediaSource, track: MediaStreamTrack | null): void {
        if (track) this.local.set(source, track);
        else this.local.delete(source);
        this.session.setLocalTrack(source, track);
        void this.room?.setTrack(source, track);
    }

    /** Hangs up, or calls it off while it still rings (`cancelled`). */
    end(): void {
        if (this.state === 'ended') return;
        const reason = this.state === 'ringing' ? 'cancelled' : 'hangup';
        if (this.room) this.session.leaveAfterHandoff(reason);
        else this.session.end(reason);
        this.finish(reason);
    }

    /** @internal Joins the call: as its caller, that makes it ring. */
    async begin(): Promise<void> {
        const started = await this.session.start();
        if (!started) this.finish('not_started');
    }

    private setState(state: CallState): void {
        if (this.state === state || this.state === 'ended') return;
        this.state = state;
        this.listeners.fire('state', [state], false);
    }

    private setPath(path: CallPath): void {
        if (this.path === path) return;
        this.path = path;
        this.listeners.fire('path', [path], false);
    }

    private fromView(view: P2PParticipantView): void {
        if (this.room) return;
        this.remote = {
            camera: view.video,
            microphone: view.audio,
            screen: view.screen,
            screenAudio: view.screenAudio,
            media: { ...view.mediaState },
            quality: view.quality,
        };
        this.listeners.fire('remote', [this.remote], false);
    }

    private fromStats(stats: P2PStats): void {
        if (this.room || !stats.candidatePair) return;
        const pair = stats.candidatePair;
        this.setPath(pair.local === 'relay' || pair.remote === 'relay' ? 'relay' : 'direct');
    }

    /** Neither the direct path nor TURN carried the call: it goes on in a room on the mesh, with what this page sends. */
    private async toRoom(sfu: SfuHandoff): Promise<void> {
        if (this.room || this.state === 'ended') return;
        this.setPath('room');
        this.setState('connecting');

        try {
            // Encrypted end to end with the call's key, as the direct path is.
            const room = await this.owner.openRoom({ adaptiveStream: false }, this.mediaKey);
            // Hung up while the room client loaded.
            if ((this.state as CallState) === 'ended') {
                room.leave();
                return;
            }
            this.room = room;

            room.on('waiting', (wait: unknown) => this.listeners.fire('waiting', [wait], false));
            room.on('state', (state: string) => {
                if (state === 'connected') this.setState('connected');
                else if (state === 'reconnecting' || state === 'waiting') this.setState(state === 'waiting' ? 'connecting' : 'reconnecting');
            });
            room.on('person', (person: Person) => {
                if (person.user !== this.peer.user) return;
                this.clearRoomWait();
                this.fromPerson(person);
            });
            room.on('person_left', (person: Person) => {
                if (person.user === this.peer.user) this.waitInRoom();
            });
            // The room gave up for good: the call can't go on.
            room.on('ended', () => {
                if (this.state === 'ended') return;
                this.session.leaveAfterHandoff('room_lost');
                this.finish('room_lost');
            });

            for (const [source, track] of this.local) await room.setTrack(source, track);
            if (!sfu.server) throw refused('no_server');
            await room.connect({ server: sfu.server, token: sfu.token });

            // What the room leg ran on, for the call's record, as the rooms in Better Messages report theirs.
            this.reporter = new SfuReporter(this.transport, this.id);
            this.reportTimer = setInterval(() => void this.reporter?.report(room.livekit, 0, 0), ROOM_REPORT_MS);
            if (!room.people().some((p) => p.user === this.peer.user)) this.waitInRoom();
        } catch {
            this.end();
        }
    }

    /**
     * Someone was added: the call goes on in the group call's room, encrypted with the call's key, with what this page
     * sends. `room` hands it to the page before the call ends as `group`.
     */
    private toGroup(): Promise<void> {
        this.toGroupOnce ??= (async () => {
            if (this.state === 'ended') return;
            try {
                const room = await this.owner.joinGroup(this.group(), this.token, this.mediaKey, this.local);
                if ((this.state as CallState) === 'ended') {
                    room.leave();
                    return;
                }
                this.setPath('room');
                this.listeners.fire('group', [room], false);
                this.finish('group');
            } catch (error: any) {
                this.finish(error?.code === 'encryption_unsupported' ? 'encryption_unsupported' : 'group_failed');
            }
        })();
        return this.toGroupOnce;
    }

    private fromPerson(person: Person): void {
        this.remote = {
            camera: person.camera,
            microphone: person.microphone,
            screen: person.screen,
            screenAudio: person.screenAudio,
            media: { camera: !!person.camera, microphone: !!person.microphone, screen_share: !!person.screen, screen_share_audio: !!person.screenAudio },
            quality: 'good',
        };
        this.listeners.fire('remote', [this.remote], false);
    }

    /** The other side isn't in the room: on its way after a hand-off, or gone. It gets a minute. */
    private waitInRoom(): void {
        if (this.roomWait || this.state === 'ended') return;
        this.roomWait = setTimeout(() => {
            this.roomWait = null;
            if (this.state === 'ended') return;
            this.session.leaveAfterHandoff('peer_lost');
            this.finish('peer_lost');
        }, ROOM_WAIT_MS);
    }

    private clearRoomWait(): void {
        if (this.roomWait) clearTimeout(this.roomWait);
        this.roomWait = null;
    }

    /** The token asked for again before it runs out, so a join after a long drop still has one. */
    private scheduleRenewal(exp: number): void {
        if (this.renewal) clearTimeout(this.renewal);
        this.renewal = setTimeout(async () => {
            this.renewal = null;
            if (this.state === 'ended') return;
            try {
                const grant = await this.owner.authorize(this.request);
                this.token = grant.token;
                this.mediaKey = grant.media_key ?? this.mediaKey;
                if (grant.member) this.proofs = { pair: grant.pair, member: grant.member };
                this.scheduleRenewal(Number(grant.exp) || nowS() + 3600);
            } catch {
                this.scheduleRenewal(nowS() + RENEW_BEFORE_S + 60);
            }
        }, Math.max(30, exp - RENEW_BEFORE_S - nowS()) * 1000);
    }

    /** The call is over, however it ended: what it held goes, the room with it. */
    private finish(reason: string): void {
        if (this.state === 'ended') return;
        this.endReason = reason;
        this.state = 'ended';
        this.clearRoomWait();
        if (this.renewal) clearTimeout(this.renewal);
        if (this.reportTimer) clearInterval(this.reportTimer);
        this.reporter?.close();
        this.room?.leave();
        this.owner.forget(this);
        this.listeners.fire('state', ['ended'], false);
        this.listeners.fire('ended', [reason], false);
    }
}

export type { MediaSource, Person, RemoteTrack };
