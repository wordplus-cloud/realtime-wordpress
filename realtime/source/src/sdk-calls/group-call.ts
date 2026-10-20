/**
 * A room on the mesh: a group call, a call between two people that became one, or the room a call between two people
 * moves to when neither the direct path nor TURN carries it. The page gets its place from the server with the site's
 * token, then joins with the mesh's room client, which walks busy nodes, waits for a place and moves when a node goes.
 *
 * **End to end encrypted** when the site gives a key: a call's rooms always, a group call's when its plugin says so
 * (the PHP package's `calls()`, `encrypt`). Every frame is encrypted in the browser with the key everyone in the room
 * shares, which only the site gives out, so the mesh forwards what it can't read, as a direct call's media is.
 */
import { Listeners, type Listener } from '../channel.js';
import type { Keyring } from '../keys.js';
import type { Invite } from './invite.js';
import { encryptionWorker, kitSource, liveKitSource, type LiveKit, type MediaSource, MESH_JOIN_BUDGET_MS } from './media.js';
import { probeCodecCaps } from '../calls/codecs.js';
import { callUserOf, type CallUser } from '../calls/users.js';
import { cameraPublish, fitCameraTrack, hardwareFromCaps, roomCallChoice, roomPixelDensity, screenCodecFor, screenPublish, SCREEN_CONTENT_HINT, SCREEN_DEGRADATION, SCREEN_ENCODING, type CallLayer, type CameraChoice, type CameraCodecCaps, type CodecPolicy } from '../calls/room-publish.js';

/** A track another person sends: show it with `attach( element )`, stop with `detach()`. */
export interface RemoteTrack {
    readonly mediaStreamTrack: MediaStreamTrack;
    attach(element: HTMLMediaElement): HTMLMediaElement;
    detach(element?: HTMLMediaElement): HTMLMediaElement[];
}

/** Another person in a room, as the room shows them. */
export interface Person {
    /** The room's name for them: `user_<id>`. */
    identity: string;
    /** Their user id on the site: a number for an id of digits (a visitor's negative one too), else the id of text the site gave. */
    user: CallUser | null;
    /** What the site's token said about them: their name, their picture … opened (the site seals it with the day's key). */
    info: unknown;
    camera: RemoteTrack | null;
    microphone: RemoteTrack | null;
    screen: RemoteTrack | null;
    screenAudio: RemoteTrack | null;
    speaking: boolean;
    /** Whether they may send their camera, microphone and screen: the site's rule, or what its server changed since. */
    publish: boolean;
    /**
     * Their camera or screen as the media server paused it for this page, whose download can't carry it now: the
     * picture stays on its last frame until it comes again, by itself, and a screen should say why.
     */
    cameraPaused: boolean;
    screenPaused: boolean;
}

/** What this page may do in the room, as the media server holds it now. */
export interface RoomPermissions {
    /** Send its camera, microphone and screen. */
    publish: boolean;
    /** Get those of the others. */
    subscribe: boolean;
    /** Host the call, as its rule's `admin` said: `moderate()` mutes, lets speak and removes the others. */
    admin?: boolean;
}

/**
 * What a host does to someone else in a group call (`moderate()`): `mute` turns their microphone off, which they may
 * turn on again, `speak` lets a listener send, `listen` makes a speaker a listener, `remove` takes them out.
 */
export type ModerationAct = 'mute' | 'speak' | 'listen' | 'remove';

export type GroupCallState = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'ended';

/** Where a room is, as the server's `room` answer and a hand-off name it. */
export interface GroupCallPlace {
    server: string;
    token: string;
    iceServers?: RTCIceServer[];
}

/** A group call made from a call between two people: who may be rung into it, and the rings so far. */
export interface GroupLink {
    /** The group call's id: the call's it was made from. */
    id: string;
    add(user: CallUser): Promise<Invite>;
    invites(): Invite[];
}

export interface RoomExtras {
    /** The key everyone in the room encrypts their media with, which only the site gives out, and the worker that does it. */
    encryption?: { key: string; worker: Worker };
    group?: GroupLink;
    /** A named group call's moderation, through the site's calls route (Calls.group()). */
    moderate?: (act: ModerationAct, user: CallUser) => Promise<boolean>;
}

const refused = (code: string) => Object.assign(new Error(code), { code });

/**
 * Why the room let this page go, as `ended` says it: `removed` when the site's server took them out (remove(), the media
 * server's PARTICIPANT_REMOVED), `closed` when it ended the call for everyone (end(), ROOM_DELETED), else the media
 * server's own reason after `disconnected:`. The call screen says the first two to the user (an SDK review, 2026-10-14:
 * a removed person saw the window go, with no word why).
 */
function disconnectedBy(reason: unknown): string {
    if (reason === 4) return 'removed';
    if (reason === 5) return 'closed';
    return 'disconnected' + (reason !== undefined ? ':' + String(reason) : '');
}

/**
 * What a place's token lets this page do, before the room says so itself as it connects: its media grant, which the
 * realtime server writes from the site's rule and its `permit` since. Null for a token it can't read.
 */
function grantedBy(token: string): RoomPermissions | null {
    try {
        const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const video = claims?.video;
        return video && typeof video === 'object' ? { publish: video.canPublish !== false, subscribe: video.canSubscribe !== false, ...(video.roomAdmin === true ? { admin: true } : {}) } : null;
    } catch {
        return null;
    }
}

/**
 * A room, its encryption worker started first when the site gave a key: refused with `encryption_unsupported` in a
 * browser that can't encrypt each frame, since it could neither send to the others nor see what they send.
 */
export async function openRoom(
    lib: LiveKit,
    options: Record<string, unknown>,
    keys: Keyring | null,
    extras: { key?: string | null; worker?: string; rooms?: string; group?: GroupLink; moderate?: RoomExtras['moderate'] } = {},
): Promise<GroupCall> {
    if (!extras.key) return new GroupCall(lib, options, keys, { group: extras.group, moderate: extras.moderate });
    if (!lib.ExternalE2EEKeyProvider || !lib.isE2EESupported?.()) throw refused('encryption_unsupported');
    const worker = await encryptionWorker(extras.worker, extras.rooms);
    return new GroupCall(lib, options, keys, { encryption: { key: extras.key, worker }, group: extras.group, moderate: extras.moderate });
}

const userOf = (identity: string): CallUser | null => (identity.startsWith('user_') ? callUserOf(identity.slice('user_'.length)) : null);

const infoOf = (metadata: unknown): unknown => {
    if (typeof metadata !== 'string' || metadata === '') return null;
    try {
        return JSON.parse(metadata);
    } catch {
        return null;
    }
};

type RoomEventName = 'state' | 'waiting' | 'person' | 'person_left' | 'speakers' | 'invite' | 'permissions' | 'error' | 'ended';

/**
 * A room the page is in. Events: `state` (GroupCallState), `waiting` ({ until, reason }: the mesh is finding a place),
 * `person` (Person: someone arrived, or what they send or may send changed), `person_left` (Person), `speakers`
 * (Person[]), `invite` (Invite: someone is rung into this group call), `permissions` (RoomPermissions: the site's server
 * changed what this page may do), `error` ({ code }: `publish_failed`, `encryption_failed`), and `ended` (the reason).
 */
export class GroupCall {
    state: GroupCallState = 'connecting';
    /** The room client's own GroupCall, for what the kit doesn't wrap. */
    readonly livekit: any;
    /** Whether everyone's media in it is encrypted end to end, with a key only the site gives out. */
    readonly encrypted: boolean;
    /** The group call's id, for a call between two people that became one; null for any other room. */
    readonly group: string | null;
    private readonly listeners = new Listeners();
    private readonly published = new Map<MediaSource, any>();
    private readonly wanted = new Map<MediaSource, MediaStreamTrack>();
    // What the place's token said this page may do, until the room says it (can).
    private granted: RoomPermissions | null = null;
    private readonly encryption: { key: string; worker: Worker; provider: { setKey(key: string): Promise<void> } } | null = null;
    private readonly link: GroupLink | null;
    private readonly moderator: RoomExtras['moderate'] | null;
    private ended = false;

    /**
     * @param keys the page's keyring, which opens what the site said about each person; a person whose key it has to ask
     *             the site for comes again as `person` once it has it.
     * @param extras the key and worker of an encrypted room (openRoom() starts the worker), and a group call's link.
     */
    constructor(private readonly lib: LiveKit, options: Record<string, unknown> = {}, private readonly keys: Keyring | null = null, extras: RoomExtras = {}) {
        if (extras.encryption && lib.ExternalE2EEKeyProvider) {
            const provider = new lib.ExternalE2EEKeyProvider();
            this.encryption = { ...extras.encryption, provider };
            options = { ...options, encryption: { keyProvider: provider, worker: extras.encryption.worker } };
        }
        this.encrypted = this.encryption !== null;
        this.link = extras.group ?? null;
        this.moderator = extras.moderate ?? null;
        this.group = this.link?.id ?? null;
        // Two connections, a publisher and a subscriber, as Better Messages' call client asks: the mesh's mediasoup
        // engine doesn't serve one connection both ways (/rtc/v1), so asking for it costs a refused try on every join.
        // Tiles ask layers at the screen's pixel density up to 1.5, as Better Messages' (room-publish.ts).
        this.livekit = new lib.Room({
            adaptiveStream: { pixelDensity: roomPixelDensity((globalThis as { devicePixelRatio?: number }).devicePixelRatio) },
            dynacast: true,
            singlePeerConnection: false,
            ...options,
        });
        const E = lib.RoomEvent;
        // Nothing after the room ended: the room client still says who left as it disconnects.
        const changed = (participant: any) => !this.ended && this.listeners.fire('person', [this.person(participant)], false);

        this.livekit.on(E.ParticipantConnected, changed);
        this.livekit.on(E.ParticipantMetadataChanged, (_old: unknown, participant: any) => participant && !participant.isLocal && changed(participant));
        this.livekit.on(E.TrackSubscribed, (_track: any, _publication: any, participant: any) => changed(participant));
        this.livekit.on(E.TrackUnsubscribed, (_track: any, _publication: any, participant: any) => changed(participant));
        // Once a track is gone, as the person sends it no more (a camera turned off), so it is not still among theirs, which
        // the unsubscribe before it may say (an SDK review, 2026-10-14: a camera turned off left a dark tile, no name on it).
        if (E.TrackUnpublished) this.livekit.on(E.TrackUnpublished, (_publication: any, participant: any) => participant && !participant.isLocal && changed(participant));
        this.livekit.on(E.TrackMuted, (_publication: any, participant: any) => participant && !participant.isLocal && changed(participant));
        this.livekit.on(E.TrackUnmuted, (_publication: any, participant: any) => participant && !participant.isLocal && changed(participant));
        // The media server paused someone's camera or screen for this page's download, or sends it again (cameraPaused).
        if (E.TrackStreamStateChanged) this.livekit.on(E.TrackStreamStateChanged, (_publication: any, _state: unknown, participant: any) => participant && !participant.isLocal && changed(participant));
        this.livekit.on(E.ParticipantDisconnected, (participant: any) => !this.ended && this.listeners.fire('person_left', [this.person(participant)], false));
        // The site's server changed what someone may do (its `permit`): this page's, or another person's.
        this.livekit.on(E.ParticipantPermissionsChanged, (_previous: unknown, participant: any) => {
            if (this.ended || !participant) return;
            if (!participant.isLocal) return changed(participant);
            const can = this.can;
            // The media server took down what it sent: nothing of it is sent again on a reconnect, nor kept for later.
            if (!can.publish) {
                this.published.clear();
                this.wanted.clear();
            }
            this.listeners.fire('permissions', [can], false);
            // Let speak: what the page set while it could not send goes out now, with no second try of its own.
            if (can.publish) void this.publishWanted();
        });
        this.livekit.on(E.ActiveSpeakersChanged, (speakers: any[]) =>
            !this.ended && this.listeners.fire('speakers', [speakers.filter((p) => !p.isLocal).map((p) => this.person(p))], false));
        this.livekit.on(E.Reconnecting, () => this.setState('reconnecting'));
        this.livekit.on(E.Reconnected, () => this.setState('connected'));
        this.livekit.on(E.Disconnected, (reason: unknown) => this.finish(disconnectedBy(reason)));
        if (E.EncryptionError) this.livekit.on(E.EncryptionError, (error: unknown) => this.listeners.fire('error', [{ code: 'encryption_failed', error }], false));
    }

    on(event: RoomEventName, fn: Listener): this {
        this.listeners.on(event, fn);
        return this;
    }

    off(event: RoomEventName, fn?: Listener): this {
        this.listeners.off(event, fn);
        return this;
    }

    /** Joins the room at its place. */
    async connect(place: GroupCallPlace): Promise<void> {
        // What the page may do is known at once, from the place's token: a listener is never taken for a speaker while
        // the room connects.
        this.granted = grantedBy(place.token);
        const before = this.can;
        this.setState('connecting');
        this.server = place.server;
        if (this.encryption) {
            // Before the connect, so nothing this page sends ever leaves it unencrypted.
            await this.encryption.provider.setKey(this.encryption.key);
            await this.livekit.setE2EEEnabled(true);
        }
        await this.livekit.connect(place.server, place.token, {
            autoSubscribe: true,
            ...(place.iceServers?.length ? { rtcConfig: { iceServers: place.iceServers } } : {}),
            // The mesh's client: how long a join waits for a place, and what it waits on.
            meshJoinBudgetMs: MESH_JOIN_BUDGET_MS,
            onMeshWait: (wait: { until: number; reason: string }) => {
                this.setState('waiting');
                this.listeners.fire('waiting', [wait], false);
            },
        });
        if (this.ended) {
            this.livekit.disconnect();
            return;
        }
        this.setState('connected');
        // The room has the last word: the site's server may have changed it since the token was signed.
        const now = this.can;
        if (now.publish !== before.publish || now.subscribe !== before.subscribe) this.listeners.fire('permissions', [now], false);
        await this.publishWanted();
        for (const participant of this.livekit.remoteParticipants.values()) this.listeners.fire('person', [this.person(participant)], false);
    }

    /** What this page may do in the room now: the site's rule, or what its server changed since (`permissions`). */
    get can(): RoomPermissions {
        const permissions = this.livekit.localParticipant?.permissions;
        // Hosting is the token's alone: the room's own permissions don't carry it.
        const admin = this.granted?.admin ? { admin: true } : {};
        if (permissions) return { publish: permissions.canPublish ?? true, subscribe: permissions.canSubscribe ?? true, ...admin };
        return this.granted ?? { publish: true, subscribe: true };
    }

    /**
     * What a host does to someone else in the call (`ModerationAct`), through the site's calls route, which asks the
     * call's rule again and takes it from a host alone (its `admin`). Whether it changed anything. Rejects with its
     * `code`: `forbidden` for a page that isn't the host, `not_moderated` for a room that isn't a named group call.
     */
    async moderate(act: ModerationAct, user: CallUser): Promise<boolean> {
        if (!this.moderator) throw refused('not_moderated');
        return this.moderator(act, user);
    }

    /** Sends what the page set and the room doesn't have yet, while this page may send. */
    private async publishWanted(): Promise<void> {
        if (!this.can.publish || this.ended) return;
        for (const [source, track] of this.wanted) if (!this.published.has(source)) await this.publish(source, track);
    }

    /** This page's own user in the room, as the others see them: their info as the site gave it. Null until connected. */
    get self(): Person | null {
        const local = this.livekit.localParticipant;
        return local?.identity ? this.person(local) : null;
    }

    /** Everyone else in the room. */
    people(): Person[] {
        return [...this.livekit.remoteParticipants.values()].map((p: any) => this.person(p));
    }

    /** What this page sends from a source: a track, or null to stop sending it. Kept for a room still connecting. */
    async setTrack(source: MediaSource, track: MediaStreamTrack | null): Promise<void> {
        if (track) this.wanted.set(source, track);
        else this.wanted.delete(source);
        if (this.state !== 'connected' && this.state !== 'reconnecting') return;

        const current = this.published.get(source);
        if (current) {
            this.published.delete(source);
            await this.livekit.localParticipant.unpublishTrack(current.track, false).catch(() => {});
        }
        // A listener keeps it for when the site's server lets them speak (publishWanted), never a refused try.
        if (track && this.can.publish) await this.publish(source, track);
    }

    leave(): void {
        this.finish('left');
    }

    /**
     * Rings `user` into this group call, a call between two people that became one: they arrive as a `person` once they
     * answer. Rejects with its `code`: `not_a_call` for any other room, or the site's or the server's refusal.
     */
    add(user: CallUser): Promise<Invite> {
        if (!this.link) return Promise.reject(refused('not_a_call'));
        if (this.ended) return Promise.reject(refused('ended'));
        return this.link.add(user);
    }

    /** The rings into this group call this page heard of, still ringing or ended. */
    invites(): Invite[] {
        return this.link?.invites() ?? [];
    }

    /** @internal Someone is rung into this group call. */
    invited(invite: Invite): void {
        if (!this.ended) this.listeners.fire('invite', [invite], false);
    }

    private async publish(source: MediaSource, track: MediaStreamTrack): Promise<void> {
        try {
            const options = { source: liveKitSource(this.lib, source), name: source, ...(await this.publishOptions(source, track)) };
            const publication = await this.livekit.localParticipant.publishTrack(track, options);
            this.published.set(source, publication);
        } catch (error) {
            this.listeners.fire('error', [{ code: 'publish_failed', source, error }], false);
        }
    }

    /**
     * How a source goes out, as Better Messages' group calls send it (room-publish.ts): a camera in the first codec of
     * the server's policy this browser sends (rtc-client 1.0.8's meshCodecPolicy), by default H.264 where this device
     * encodes it in hardware and VP8 otherwise, with VP8 behind any other for a receiver that decodes none of it, in
     * three layers at 30 frames (one SVC stream of three in VP9 or AV1); a screen in VP8 by default, whole and at half
     * its size. A camera encoded in software is scaled to 720 lines first (fitCameraTrack), the track the app handed in
     * included.
     */
    private async publishOptions(source: MediaSource, track: MediaStreamTrack): Promise<Record<string, unknown>> {
        let settings: MediaTrackSettings = {};
        try {
            settings = track.getSettings();
        } catch {
            /* a track without settings: the library's own layers */
        }
        if (source === 'camera') {
            const { codec, hardware, backup } = await this.cameraChoice();
            const camera = cameraPublish(codec, await fitCameraTrack(track, codec, hardware), backup);
            return {
                videoCodec: codec,
                ...(camera ? { simulcast: true, videoEncoding: camera.top, videoSimulcastLayers: camera.layers.map((layer) => this.preset(layer)) } : {}),
                ...(camera?.scalabilityMode ? { scalabilityMode: camera.scalabilityMode } : {}),
                // VP8 (or the policy's H.264) behind any other codec, for a receiver that decodes none of it
                ...(backup ? { backupCodec: { codec: backup, ...(camera?.backup ? { encoding: camera.backup } : {}) } } : {}),
            };
        }
        if (source === 'screen_share') {
            const codec = screenCodecFor(globalThis.navigator?.userAgent ?? '', hardwareFromCaps(await this.capabilities()), this.codecOptions());
            const screen = screenPublish(settings.width ?? 0, settings.height ?? 0, codec);
            // smooth where it can be, sharp where it can't (SCREEN_CONTENT_HINT: marked detail, Chrome dropped two
            // frames in three of a busy screen)
            try {
                track.contentHint = SCREEN_CONTENT_HINT;
            } catch {
                // a track that takes no hint goes as it is
            }
            // one picture unless the rule gives a second (screenPublish: VP8 simulcast held a screen to 5 frames)
            return {
                videoCodec: codec,
                screenShareEncoding: SCREEN_ENCODING,
                degradationPreference: SCREEN_DEGRADATION,
                ...(screen.simulcast && screen.layer
                    ? { simulcast: true, screenShareSimulcastLayers: [this.preset(screen.layer)] }
                    : { simulcast: false }),
            };
        }
        return {};
    }

    private caps: Promise<CameraCodecCaps | null> | null = null;
    private choice: Promise<CameraChoice> | null = null;
    // the server the room is on, which says whether it forwards H.265 (the mesh's)
    private server: string | null = null;

    /** What this browser encodes, asked once a call. */
    private capabilities(): Promise<CameraCodecCaps | null> {
        this.caps ??= probeCodecCaps().catch(() => null);
        return this.caps;
    }

    /** The room as the codec rules see it: encrypted, on the mesh, and the server's codec policy once joined. */
    private codecOptions(): { encrypted: boolean; h265: boolean; policy: CodecPolicy | null } {
        const h265 = !!this.server && !!this.lib.isMeshServer?.(this.server);
        return { encrypted: this.encrypted, h265, policy: (this.livekit as { meshCodecPolicy?: CodecPolicy } | null)?.meshCodecPolicy ?? null };
    }

    /**
     * The camera's codec on this device, asked once the room is joined (room-publish.ts): the server's policy, VP8 in
     * an encrypted room, where the room client sends no backup codec, H.265 only on the mesh.
     */
    private cameraChoice(): Promise<CameraChoice> {
        this.choice ??= this.capabilities().then((caps) => roomCallChoice(caps, globalThis.navigator?.userAgent ?? '', this.codecOptions()));
        return this.choice;
    }

    private preset(layer: CallLayer): unknown {
        const Preset = this.lib.VideoPreset;
        return Preset
            ? new Preset(layer.width, layer.height, layer.bitrate, layer.fps)
            : { width: layer.width, height: layer.height, encoding: { maxBitrate: layer.bitrate, maxFramerate: layer.fps } };
    }

    private person(participant: any): Person {
        const tracks: Partial<Record<MediaSource, RemoteTrack>> = {};
        const paused: Partial<Record<MediaSource, boolean>> = {};
        for (const publication of participant.trackPublications?.values?.() ?? []) {
            const source = kitSource(this.lib, publication.source);
            if (source && publication.track && !publication.isMuted) {
                tracks[source] = publication.track;
                // A remote track's stream state, "paused" while the media server holds it back from this page's download.
                paused[source] = publication.track.streamState === 'paused';
            }
        }
        return {
            identity: participant.identity,
            user: userOf(participant.identity),
            info: this.open(infoOf(participant.metadata), participant),
            camera: tracks.camera ?? null,
            microphone: tracks.microphone ?? null,
            screen: tracks.screen_share ?? null,
            screenAudio: tracks.screen_share_audio ?? null,
            speaking: !!participant.isSpeaking,
            publish: participant.permissions?.canPublish ?? true,
            cameraPaused: !!paused.camera,
            screenPaused: !!paused.screen_share,
        };
    }

    /** A person's info opened; null until its key comes, when they come again as `person`. */
    private open(info: unknown, participant: any): unknown {
        if (!this.keys) return info;
        const missing = this.keys.missing(info);
        if (missing.length > 0) {
            void this.keys.ensure(missing).then(() => {
                if (!this.ended && this.keys!.missing(info).length === 0 && this.livekit.remoteParticipants.get(participant.identity) === participant) {
                    this.listeners.fire('person', [this.person(participant)], false);
                }
            });
            return null;
        }
        const opened = this.keys.openJson(info);
        return opened === undefined ? null : opened;
    }

    private setState(state: GroupCallState): void {
        if (this.ended || this.state === state) return;
        this.state = state;
        this.listeners.fire('state', [state], false);
    }

    private finish(reason: string): void {
        if (this.ended) return;
        this.ended = true;
        this.state = 'ended';
        try {
            // The page's tracks stay as they are: they are the page's, and a call moving from the room it fell back to
            // into its group call's sends them on there.
            this.livekit.disconnect(false);
        } catch {
            /* already gone */
        }
        // The encryption worker is the room's alone.
        if (this.encryption) setTimeout(() => this.encryption!.worker.terminate(), 1000);
        this.listeners.fire('state', ['ended'], false);
        this.listeners.fire('ended', [reason], false);
    }
}
