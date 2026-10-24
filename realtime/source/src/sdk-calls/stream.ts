/**
 * A live stream on the app's calls: `calls.stream( name )` asks the app's route
 * for Easy Stream's grant, as `group()` asks for a group call's, joins, and the stream's chat rides the page's one
 * connection, as its rooms do. Easy Stream's engine (`../streams`) runs it; this is the SDK's shape of it, the same object
 * for every role. What a role may not do rejects with the cloud's code (`not_host`, `read_only`, `no_stage` …).
 *
 * The app's users are named by their ids, as its grants name them (`sub`); the cloud's own names for them (`u:<id>`, a
 * place in the room `u:<id>.<8 hex>`) stay inside.
 */
import { Listeners, type Listener } from '../channel.js';
import type { ChatMessage, Hand, Layout, Reaction, Role, StreamState as StreamInfo, You } from '../streams/protocol.js';
import type { LayerQuality, PictureLayer, PlaybackStats } from '../streams/playback-types.js';
import { choosableLayers } from '../streams/playback.js';

export type { LayerQuality, PictureLayer, PlaybackStats };

export type StreamState = 'idle' | 'live' | 'ended';

export type StreamEvent = 'state' | 'viewers' | 'tiles' | 'message' | 'hands' | 'invited' | 'stage' | 'waiting' | 'error' | 'change';

/** A hand raised to come on stage, as its hosts see it: the user by the app's id, their name, and since when (ms). */
export interface StreamHand {
    user: string;
    name: string;
    at: number;
}

// The engine's own types name the room client's (@wordplus/rtc-client), which an app needn't have: these are what the
// SDK hands out, which the engine's state and tracks are, so an app's types never reach the room client's.

/** A picture or a sound on the stage: the room client's track. */
export interface StreamTrack {
    readonly mediaStreamTrack: MediaStreamTrack;
    attach(element?: HTMLMediaElement): HTMLMediaElement;
    detach(element?: HTMLMediaElement): unknown;
}

/** Someone on the stage, or OBS's picture (`encoder`). */
export interface StreamTile {
    identity: string;
    name: string;
    avatar?: string | null;
    role: Role;
    local: boolean;
    camera: StreamTrack | null;
    screen: StreamTrack | null;
    audio: StreamTrack[];
    micMuted: boolean;
    speaking: boolean;
    encoder: boolean;
}

/** The stream as a screen of one's own draws it: Easy Stream's state, the parts an app reads. */
export interface StreamSnapshot {
    // `unconnected`: a host's page set up without the cloud (the engine's offlineHost), which an app's streams never are.
    status: 'joining' | 'ready' | 'error' | 'unconnected';
    error: string | null;
    stream: StreamInfo | null;
    you: You | null;
    viewers: number;
    audience: number | null;
    chat: ChatMessage[];
    pinned: ChatMessage | null;
    slow: number;
    timeoutUntil: number | null;
    hands: Hand[];
    handRaised: boolean;
    invited: boolean;
    onStage: boolean;
    media: 'off' | 'connecting' | 'waiting' | 'live' | 'reconnecting';
    waitUntil: number | null;
    tiles: StreamTile[];
    layout: Layout;
    audioBlocked: boolean;
    devices: { camera: boolean; microphone: boolean };
    screenSharing: boolean;
    canShareScreen: boolean;
    reactionsOn: boolean;
    encoder: { url: string; key: string } | null;
}

type Answer = Promise<{ ok: boolean; error?: string }>;

/** The engine as this file uses it (../streams/client.ts, EasyStreamClient). @internal */
export interface StreamEngine {
    getState(): StreamSnapshot;
    subscribe(listener: () => void): () => void;
    stop(): void;
    wantVideo(): void;
    startAudio(): Promise<void>;
    react(kind: Reaction): void;
    raiseHand(up: boolean): Answer;
    acceptStage(): Answer;
    leaveStage(): Promise<unknown>;
    sendChat(text: string): Answer;
    deleteMessage(id: string): Answer;
    pin(id: string): Answer;
    unpin(): Answer;
    timeOut(identity: string, seconds: number): Answer;
    setSlow(seconds: number): Answer;
    clearChat(): Answer;
    startPreview(devices?: { camera?: boolean; microphone?: boolean }): Promise<unknown>;
    setCamera(on: boolean): Promise<unknown>;
    setMicrophone(on: boolean): Promise<unknown>;
    setScreenShare(on: boolean): Promise<boolean>;
    goLive(): Answer;
    end(): Answer;
    invite(identity: string): Answer;
    unstage(identity: string): Answer;
    setLayout(mode: Layout['mode'], identity?: string): Answer;
    useEncoder(renew?: boolean): Answer;
    kick(identity: string): Answer;
    ban(identity: string): Answer;
    playbackStats(): PlaybackStats;
    // The room client's track of a picture, which StreamTrack is the SDK's shape of.
    pictureLayers(track: unknown): PictureLayer[];
    setQuality(quality: 'auto' | LayerQuality): void;
}

const refused = (code: string) => Object.assign(new Error(code), { code });
const userOf = (user: string | number) => 'u:' + String(user);

/** The cloud's answer to an action: done, or a refusal with its code. */
async function done<T extends { ok: boolean; error?: string }>(answer: T | Promise<T>): Promise<void> {
    const a = await answer;
    if (!a.ok) throw refused((a as { error?: string }).error ?? 'failed');
}

/** The tile the stream shows large: the one in the spotlight, a shared screen, OBS's picture, the one speaking, the host. */
function mainTile(tiles: StreamTile[], layout: Layout): StreamTile | undefined {
    const pictured = tiles.filter((t) => t.camera || t.screen);
    if (layout.mode === 'spotlight' && layout.identity) {
        const spot = pictured.find((t) => t.identity === layout.identity || t.identity.startsWith(layout.identity + '.'));
        if (spot) return spot;
    }
    return pictured.find((t) => t.screen)
        ?? pictured.find((t) => t.encoder)
        ?? (layout.mode === 'speaker' ? pictured.find((t) => t.speaking) : undefined)
        ?? pictured.find((t) => t.role === 'host')
        ?? pictured[0];
}

export class Stream {
    private readonly listeners = new Listeners();
    private last: StreamSnapshot;
    private readonly unsubscribe: () => void;

    /**
     * Easy Stream's engine under the stream, which @wordplus/realtime-ui's stream views (its StreamView and the
     * `<live-stream>` element) draw as Easy Stream does. @internal
     */
    readonly engine: StreamEngine;

    /** @internal */
    constructor(readonly name: string, engine: StreamEngine) {
        this.engine = engine;
        this.last = engine.getState();
        this.unsubscribe = engine.subscribe(() => this.changed());
    }

    /** `host`, `guest` or `viewer`, as the app's grant made this user. */
    get role(): Role | null {
        return this.last.you?.role ?? null;
    }

    /** `idle` before it starts, `live`, `ended`. */
    get state(): StreamState {
        return this.last.stream?.state ?? 'idle';
    }

    /** How many watch now. */
    get viewers(): number {
        return this.last.viewers;
    }

    /** Everyone on the stage, with their pictures and sound (`camera`, `screen`, `audio`: the room client's tracks). */
    get tiles(): StreamTile[] {
        return this.last.tiles;
    }

    /** The chat's last messages, oldest first. */
    get messages(): ChatMessage[] {
        return this.last.chat;
    }

    /** Whether this page waits for a place: the stream is full, and the join goes on by itself. */
    get waiting(): boolean {
        return this.last.media === 'waiting';
    }

    /** The hands raised to come on stage, the oldest first: its hosts see them, a viewer none but their own (`handRaised`). */
    get hands(): StreamHand[] {
        return this.last.hands.map((hand) => ({ user: hand.identity.replace(/^u:/, ''), name: hand.name, at: hand.at }));
    }

    /** Whether this page is on stage as a guest, sending its camera and microphone. */
    get onStage(): boolean {
        return this.last.onStage;
    }

    /** The stream as it is now, for a screen of one's own; `subscribe` hears every change (React's useSyncExternalStore). */
    snapshot = (): StreamSnapshot => this.last;

    subscribe = (fn: () => void): (() => void) => this.engine.subscribe(fn);

    /**
     * `state` (StreamState), `viewers` (n), `tiles` (StreamTile[]), `message` (ChatMessage, each one new), `hands`
     * (StreamHand[], for its hosts), `invited` (a host asks this user on stage: `joinStage()`), `stage` (whether this page
     * is on stage now), `waiting` ({ until }: full), `error` ({ code }), `change` (any of it).
     */
    on(event: StreamEvent, fn: Listener): this {
        this.listeners.on(event, fn);
        return this;
    }

    off(event?: StreamEvent, fn?: Listener): this {
        this.listeners.off(event, fn);
        return this;
    }

    /**
     * Shows the stream in `video`: the stage's main picture, as it changes, and its sound. Answers a function that
     * stops showing it there.
     */
    watch(video: HTMLVideoElement): () => void {
        let shown: StreamTrack | null = null;
        const sounds = new Map<StreamTrack, HTMLMediaElement>();

        const draw = () => {
            const state = this.engine.getState();
            const main = mainTile(state.tiles, state.layout);
            const track = main ? (main.screen ?? main.camera) : null;
            if (shown !== track) {
                shown?.detach(video);
                track?.attach(video);
                shown = track;
            }
            const playing = new Set(state.tiles.flatMap((t) => t.audio));
            for (const [t, el] of sounds) if (!playing.has(t)) { t.detach(el); sounds.delete(t); }
            for (const t of playing) if (!sounds.has(t)) sounds.set(t, t.attach());
        };

        this.engine.wantVideo();
        draw();
        const off = this.engine.subscribe(draw);
        return () => {
            off();
            shown?.detach(video);
            for (const [t, el] of sounds) t.detach(el);
            sounds.clear();
            shown = null;
        };
    }

    /**
     * The stream's sound, where the browser held it back until a click (`snapshot().audioBlocked`): call it from one,
     * such as a "Turn the sound on" button.
     */
    startAudio(): Promise<void> {
        return this.engine.startAudio();
    }

    /**
     * How the stream plays here, to debug it: the picture and the sound that arrive, the media server and the way they
     * come, and the session so far (how long the picture took to start, stalls, reconnects), with the last things that
     * happened. Measured in this browser once a second while the picture comes, and sent nowhere.
     */
    stats(): PlaybackStats {
        return this.engine.playbackStats();
    }

    /**
     * The layers of the main picture a viewer may choose, the best first, each `high`, `medium` or `low` with its size:
     * what `setQuality()` chooses from. None above 720p, which comes only on `auto`, to a player big enough for it. None
     * before the picture arrives, and for a host's own.
     */
    qualities(): PictureLayer[] {
        const state = this.engine.getState();
        const main = mainTile(state.tiles, state.layout);
        return choosableLayers(this.engine.pictureLayers(main ? (main.screen ?? main.camera) : null));
    }

    /**
     * The picture's quality: one of the layers `qualities()` gives whatever the player's size, or `auto`, the default, by
     * its size. A layer above 720p chosen still gives 720p.
     */
    setQuality(quality: 'auto' | LayerQuality): void {
        this.engine.setQuality(quality);
    }

    /**
     * A reaction everyone watching sees float up: any one emoji. The player offers ❤️ 👏 😂 😮 🔥 unless the page offers
     * its own.
     */
    react(kind: Reaction): void {
        this.engine.react(kind);
    }

    /** Asks to come on stage, or no longer. */
    hand(up: boolean): Promise<void> {
        return done(this.engine.raiseHand(up));
    }

    /** Comes on stage when invited (`invited`), with the camera and microphone. */
    joinStage(): Promise<void> {
        return done(this.engine.acceptStage());
    }

    async leaveStage(): Promise<void> {
        await this.engine.leaveStage();
    }

    /** The chat: writing, and for its moderators, keeping it. */
    readonly chat = {
        send: (text: string): Promise<void> => done(this.engine.sendChat(text)),
        delete: (id: string): Promise<void> => done(this.engine.deleteMessage(id)),
        pin: (id: string): Promise<void> => done(this.engine.pin(id)),
        unpin: (): Promise<void> => done(this.engine.unpin()),
        timeout: (user: string | number, seconds: number): Promise<void> => done(this.engine.timeOut(userOf(user), seconds)),
        slow: (seconds: number): Promise<void> => done(this.engine.setSlow(seconds)),
        clear: (): Promise<void> => done(this.engine.clearChat()),
    };

    // A host's and a guest's: what this page sends.

    /** The camera and microphone, shown here before going live. */
    async preview(devices: { camera?: boolean; microphone?: boolean } = { camera: true, microphone: true }): Promise<void> {
        await this.engine.startPreview(devices);
    }

    async setCamera(on: boolean): Promise<void> {
        await this.engine.setCamera(on);
    }

    async setMicrophone(on: boolean): Promise<void> {
        await this.engine.setMicrophone(on);
    }

    /** Shares a screen in place of the camera, or stops; whether it is shared now. */
    setScreenShare(on: boolean): Promise<boolean> {
        return this.engine.setScreenShare(on);
    }

    // A host's.

    goLive(): Promise<void> {
        return done(this.engine.goLive());
    }

    end(): Promise<void> {
        return done(this.engine.end());
    }

    /** Asks someone who raised a hand, or anyone watching, on stage; `unstage` takes them off. */
    invite(user: string | number): Promise<void> {
        return done(this.engine.invite(userOf(user)));
    }

    unstage(user: string | number): Promise<void> {
        return done(this.engine.unstage(userOf(user)));
    }

    /** How the stage shows: everyone in a grid, the one speaking large, or one person in the spotlight. */
    layout(mode: Layout['mode'], user?: string | number): Promise<void> {
        return done(this.engine.setLayout(mode, user === undefined ? undefined : userOf(user)));
    }

    /** Where OBS streams to, over WHIP, and its key; `renew` makes a new key, which cuts off one using the old. */
    async ingest(renew = false): Promise<{ url: string; key: string }> {
        await done(this.engine.useEncoder(renew));
        const encoder = this.engine.getState().encoder;
        if (!encoder) throw refused('no_encoder');
        return { url: encoder.url, key: encoder.key };
    }

    // A moderator's.

    kick(user: string | number): Promise<void> {
        return done(this.engine.kick(userOf(user)));
    }

    ban(user: string | number): Promise<void> {
        return done(this.engine.ban(userOf(user)));
    }

    /** Leaves the stream: its picture, what this page sends, and its chat. */
    leave(): void {
        this.unsubscribe();
        this.engine.stop();
        this.listeners.off();
    }

    private changed(): void {
        const was = this.last;
        const now = this.engine.getState();
        this.last = now;

        if ((now.stream?.state ?? 'idle') !== (was.stream?.state ?? 'idle')) this.listeners.fire('state', [now.stream?.state ?? 'idle'], false);
        if (now.viewers !== was.viewers) this.listeners.fire('viewers', [now.viewers], false);
        if (now.tiles !== was.tiles) this.listeners.fire('tiles', [now.tiles], false);
        if (now.chat !== was.chat) {
            const seen = new Set(was.chat.map((m) => m.id));
            for (const m of now.chat) if (!seen.has(m.id)) this.listeners.fire('message', [m], false);
        }
        if (now.hands !== was.hands) this.listeners.fire('hands', [this.hands], false);
        if (now.invited && !was.invited) this.listeners.fire('invited', [], false);
        if (now.onStage !== was.onStage) this.listeners.fire('stage', [now.onStage], false);
        if (now.media === 'waiting' && was.media !== 'waiting') this.listeners.fire('waiting', [{ until: now.waitUntil }], false);
        if (now.status === 'error' && now.error && now.error !== was.error) this.listeners.fire('error', [{ code: now.error }], false);
        this.listeners.fire('change', [now], false);
    }
}
