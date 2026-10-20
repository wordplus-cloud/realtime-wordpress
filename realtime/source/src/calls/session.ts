import {P2PPeer} from "./peer.js";
import {RemoteMediaTrack} from "./remote-track.js";
import {P2PSignaling} from "./signaling.js";
import {isSealedSignal, SignalCipher} from "./cipher.js";
import {forgetBroken, markBroken, probeCodecCaps} from "./codecs.js";
import {browserLabel, platformLabel} from "./platform.js";
import type {CallId, CallTransport} from "./transport.js";
import {callUserOf, type CallUser} from "./users.js";
import {
    compareStreamIds,
    IceServer,
    MediaState,
    P2PConnection,
    P2PQuality,
    P2PSource,
    P2PStats,
    ServerMessage,
    SfuHandoff,
    SignalBody,
    SignalEnvelope,
    AliveAck,
    PulseAck,
    ViewHint,
    CodecCaps,
    CodecDirection
} from "./types.js";

export interface P2PParticipantView {
    identity: string;
    user_id: CallUser;
    video: RemoteMediaTrack | null;
    audio: RemoteMediaTrack | null;
    screen: RemoteMediaTrack | null;
    screenAudio: RemoteMediaTrack | null;
    quality: P2PQuality;
    mediaState: MediaState;
    mediaStateKnown: boolean;
}

export interface P2PSessionOptions {
    // How the session reaches the relay (transport.ts).
    transport: CallTransport;
    callId: CallId;
    // The conversation a Better Messages call belongs to; the SDK's calls have none.
    threadId?: number;
    type: 'audio' | 'video';
    signalKey?: string;
}

type SessionEvents = {
    participant: ( view: P2PParticipantView ) => void;
    peerJoined: ( userId: CallUser ) => void;
    peerLost: ( userId: CallUser ) => void;
    connection: ( state: P2PConnection ) => void;
    stats: ( stats: P2PStats ) => void;
    fallback: ( sfu: SfuHandoff ) => void;
    ended: ( reason: string ) => void;
    playbackBlocked: () => void;
    // The other side's microphone or camera has stopped sending while the
    // path is fine; and the other side saying so about this side's, which
    // the container answers by opening the device again.
    peerSilent: ( source: 'microphone' | 'camera' ) => void;
    reacquire: ( source: 'microphone' | 'camera' ) => void;
};

type EventName = keyof SessionEvents;

const VISIBLE_DEFAULT: MediaState = { camera: false, microphone: false, screen_share: false, screen_share_audio: false };

// Layout changes (a chip resized, the stage swapped, a tab hidden) come in
// bursts; the other side hears about the settled state.
const VIEW_SETTLE_MS = 300;
const VIEW_SETTLE_MAX = 1200;
// How often the byte counters in a call's report are refreshed while nothing
// else about it changes.
const REPORT_BYTES_MS = 15000;

const VIDEO_SOURCES: Array<'camera' | 'screen_share'> = [ 'camera', 'screen_share' ];

// A connected call sends nothing for as long as it runs, and the server lets
// a call's keys expire thirty minutes after its last message, so a joined
// session checks in this often. bm_p2p_keepalive_ms shortens it for tests.
const KEEPALIVE_MS = 60000;

// Often enough that a call which dies at four seconds has already said why,
// rare enough that a whole call is a handful of requests.
const TRACE_FLUSH_MS = 2000;
const TRACE_MAX_LINES = 200;

// This side's counters to the relay every couple of seconds while the
// direct path runs, and the other side's back; every so many of them the
// media state goes out again, because a state signal the relay refused was
// never sent again, and a stale "microphone on" is what the watchdog reads.
const STATE_RESEND_TICKS = 8;

// How long before the TURN credentials run out they are renewed. A life
// shorter than four times this (the tests set one in seconds) is renewed a
// quarter of the way from its end instead.
const RENEW_MARGIN = 10 * 60000;

// The bounds on when the next renewal is due. The relay says when the
// credentials run out as a time by its own clock, and nothing in its reply
// says what its clock reads, so the life left is measured against this
// device's clock as the reply arrives. A clock hours fast read every
// credential as run out and renewed every second, each renewal on a relayed
// call an ICE restart; one about twenty-five days slow asked for a timer
// longer than a browser can count, which fires at once. Credentials from an
// `ice_servers` reply — a renewal's, or a restart's — are renewed no sooner
// than a minute after they arrive; the join's keep the second they always
// had, so a clock that is only wrong costs one early renewal there. Nothing
// is due later than a timer can hold.
const RENEW_JOIN_DELAY = 1000;
const RENEW_MIN_DELAY = 60000;
const TIMER_MAX = 2 ** 31 - 1;

// How long a restart waits for fresh credentials before going on with the
// ones it has. Asking used to inherit the socket's full retry budget,
// twenty-four seconds inside a restart that was supposed to be the quick way
// out. Kept here rather than in the peer, because what arrives after it is not
// handed over, and the renewal must go on counting from the credentials that
// were.
const ICE_SERVERS_BUDGET = 2000;

// Whether a room token will still be taken a moment from now, by the expiry
// it carries. The standby token comes with the join, and fresh with every
// `ice_servers` since, which the TURN renewal asks for every few hours. It was
// minted for an hour and never renewed: a direct call that ran longer and then
// failed connected with it, the room refused it, and the call ended instead of
// moving. One that is about to run out is left for the fresh token in the
// answer to `failed`.
function roomTokenUsable( token: string ): boolean {
    try {
        const payload = token.split( '.' )[1] ?? '';
        const claims = JSON.parse( atob( payload.replace( /-/g, '+' ).replace( /_/g, '/' ) ) );

        return typeof claims.exp !== 'number' || claims.exp * 1000 - Date.now() > 60000;
    } catch (e) {
        return false;
    }
}

function keepaliveMs(): number {
    try {
        const value = Number( window.localStorage.getItem( 'bm_p2p_keepalive_ms' ) );

        if( Number.isFinite( value ) && value >= 3000 ) return value;
    } catch (e) {}

    return KEEPALIVE_MS;
}

function iceTransportPolicy(): RTCIceTransportPolicy {
    try {
        return window.localStorage.getItem( 'bm_p2p_ice_policy' ) === 'relay' ? 'relay' : 'all';
    } catch (e) {
        return 'all';
    }
}

function forcedFailure(): boolean {
    try {
        return window.localStorage.getItem( 'bm_p2p_force_fail' ) === '1';
    } catch (e) {
        return false;
    }
}

// Test switch: this side never moves to LiveKit, so the other side can be
// left alone in the room it was handed to.
function ignoreFallback(): boolean {
    try {
        return window.localStorage.getItem( 'bm_p2p_ignore_fallback' ) === '1';
    } catch (e) {
        return false;
    }
}

export class P2PCallSession {
    readonly callId: CallId;
    readonly threadId: number;
    private readonly transport: CallTransport;
    readonly type: 'audio' | 'video';
    private readonly signaling: P2PSignaling;
    private readonly listeners = new Map<EventName, Set<( ...args: any[] ) => void>>();
    private readonly localTracks = new Map<P2PSource, MediaStreamTrack>();
    private readonly blockedElements = new Set<HTMLMediaElement>();
    private peer: P2PPeer | null = null;
    private role: 'polite' | 'impolite' = 'polite';
    private generation = -1;
    private iceServers: IceServer[] = [];
    private epoch = 0;
    private lastId: string | null = null;
    private pendingSignals: SignalEnvelope[] = [];
    private remoteState: MediaState = { ...VISIBLE_DEFAULT };
    private remoteStateKnown = false;
    private quality: P2PQuality = 'unknown';
    private stateTimer: number | null = null;
    private aliveTimer: number | null = null;
    private viewTimer: number | null = null;
    private sentView: ViewHint | null = null;
    private viewPendingSince = 0;
    private remoteWanted: ViewHint | null = null;
    private handedOff = false;
    private readonly signalKey: string;
    private cipher: SignalCipher | null = null;
    private sentReport: string | null = null;
    private sentReportAt = 0;
    private readonly knownCodecs: P2PStats['codecs'] = { videoSend: null, videoRecv: null, audioSend: null, audioRecv: null };
    private readonly bytesSeen = { sent: 0, recv: 0 };
    private caps: CodecCaps = { families: {}, switch: false };
    private peerCaps: CodecCaps | null = null;
    private outbound: Promise<void> = Promise.resolve();
    private inbound: Promise<void> = Promise.resolve();
    // This side's account of the call, on its way to the call's trace. The
    // report at the end only exists for a call that got that far; a call that
    // never connects is the one worth reading, so these go while it happens.
    private traceLines: string[] = [];
    private traceTimer: number | null = null;
    // Each line carries the seconds since this session began: a batch lands
    // on the relay with one timestamp, and without this its lines read as
    // simultaneous.
    private readonly traceStart = Date.now();
    private traceDropped = 0;
    private pulseTicks = 0;
    // The room token the join handed over up front, so a hand-off needs no
    // round trip and no answer.
    private standby: SfuHandoff | null = null;
    // Whether this side is joined on the socket it has now, and whether the
    // relay has said the other side's socket is gone: while either says a
    // restart could not reach the other side, the peer holds its escalation.
    private joinedSocket = false;
    private peerLost = false;
    // When the TURN credentials run out, and the renewal due before then.
    private iceExpiresAt = 0;
    private renewTimer: number | null = null;
    private ended = false;
    private started = false;
    private stopReconnectListener: ( () => void ) | null = null;
    private pageHideListener: ( () => void ) | null = null;
    peerUserId: CallUser | null = null;
    peerPresent = false;
    stats: P2PStats = { bytesSent: 0, bytesReceived: 0, rtt: null, packetLoss: 0, quality: 'unknown', candidatePair: null, restarts: 0, codecs: { videoSend: null, videoRecv: null, audioSend: null, audioRecv: null }, impl: { enc: null, dec: null }, counters: { inAudio: 0, inVideo: 0, outAudio: 0, outVideo: 0, remoteAudio: 0, remoteVideo: 0, remoteAt: 0 } };

    constructor( options: P2PSessionOptions ) {
        this.transport = options.transport;
        this.callId = options.callId;
        this.threadId = options.threadId ?? 0;
        this.type = options.type;
        this.signalKey = options.signalKey ?? '';
        this.signaling = new P2PSignaling( options.transport, options.callId, ( message ) => this.onServerMessage( message ) );
    }

    on<K extends EventName>( event: K, listener: SessionEvents[K] ): () => void {
        if( ! this.listeners.has( event ) ){
            this.listeners.set( event, new Set() );
        }

        this.listeners.get( event )!.add( listener );

        return () => this.listeners.get( event )?.delete( listener );
    }

    private emit<K extends EventName>( event: K, ...args: Parameters<SessionEvents[K]> ): void {
        const set = this.listeners.get( event );

        if( ! set ) return;

        for( const listener of Array.from( set ) ){
            try {
                listener( ...args );
            } catch (e) {
                console.error( e );
            }
        }
    }

    get peerIdentity(): string {
        return 'user_' + String( this.peerUserId ?? 0 );
    }

    get isConnected(): boolean {
        return !! this.peer && this.peer.isConnected;
    }

    // A call handed off to LiveKit is hung up through the LiveKit room, which
    // the realtime server does not see. The container calls this when such a
    // call ends, so the server closes the record out instead of letting it
    // sit until it expires.
    leaveAfterHandoff( reason: string ): void {
        this.sfuTrace( 'room: leaving (' + reason + ')' );
        this.flushTrace();

        try {
            this.transport.send( { op: 'leave', call_id: this.callId, session: this.signaling.session, reason } );
        } catch (e) {}

        this.signaling.close();
    }

    async start(): Promise<boolean> {
        if( this.started || this.ended ) return false;

        this.started = true;

        // A socket that has just come back is not joined until the rejoin
        // says so, and an offer sent on it before then is refused.
        this.stopReconnectListener = this.transport.onReconnect( () => {
            this.joinedSocket = false;
            this.reviewHold();

            if( this.transport.available && this.signaling.connected ){
                void this.resume();
            }
        } );

        this.pageHideListener = () => {
            this.beaconLeave();
            this.end( 'page_closed' );
        };

        window.addEventListener( 'pagehide', this.pageHideListener );

        // Every signal is sealed with the key WordPress handed both sides;
        // the relay only ever carries and stores ciphertext.
        this.cipher = await SignalCipher.create( this.signalKey );

        // What this side can encode and decode, and whether it can switch a
        // sender's codec after negotiation; told to the other side at join.
        // Nothing an earlier call learnt about an earlier peer narrows it.
        forgetBroken();

        this.caps = await probeCodecCaps();

        if( this.ended ) return false;

        return this.join( false );
    }

    private async join( resume: boolean ): Promise<boolean> {
        if( this.ended ) return false;

        let ack;

        try {
            ack = await this.signaling.join( { epoch: this.epoch, last_id: this.lastId, resume } );
        } catch (e) {
            if( resume ) return false;

            this.finish( 'signaling_unavailable' );
            return false;
        }

        if( this.ended ) return false;

        if( ! ack.ok ){
            if( resume && ack.error === 'call_ended' ){
                this.finish( ack.reason ?? 'ended' );
                return false;
            }

            // A rejoin the server refuses for good — the call is gone, this
            // person is not in it, or another device took it while this
            // socket was away — is the end of the call here too. Left
            // standing, the session kept a call on screen that the server no
            // longer had it in, and asked to rejoin every minute for as long
            // as it stayed open.
            if( resume && ( ack.error === 'answered_elsewhere' || ack.error === 'no_call' || ack.error === 'not_participant' ) ){
                this.finish( ack.error );
                return false;
            }

            if( ! resume ){
                this.finish( ack.error ?? 'join_failed' );
            }

            return false;
        }

        if( ack.mode === 'sfu' && ack.sfu ){
            this.handoff( ack.sfu, 'the join says the call is on the room' );
            return true;
        }

        // The peer this join finds, which a rejoin keeps unless the
        // generation has moved on.
        const kept = this.peer;

        this.role = ack.role ?? 'polite';
        this.standby = ack.sfu ?? null;
        this.peerUserId = ( ack.peer ? callUserOf( ack.peer.user_id ) : null ) ?? this.peerUserId;
        this.joinedSocket = true;
        this.peerLost = !! ( ack.peer && ack.peer.gone );

        const renewed = this.takeIceServers( ack.ice_servers ?? [], ack.ice_expires_at, RENEW_JOIN_DELAY );

        // The line that says what this side was told to expect. An impolite
        // side whose peer is present owes an offer; a polite one waits to be
        // offered to. A call where nothing happens next is one of those two
        // being wrong, and without this there is no way to tell which.
        this.trace(
            ( resume ? 'rejoin' : 'join' ) +
            ' role=' + this.role +
            ' gen=' + this.generation +
            ' peer=' + this.peerUserId +
            ' peer_present=' + !! ( ack.peer && ack.peer.present ) +
            ' replay=' + ( Array.isArray( ack.replay ) ? ack.replay.length : 0 ) +
            ' room_token=' + ( this.standby ? 'held' : 'none' )
        );

        if( typeof ack.generation === 'number' && ack.generation !== this.generation && this.peer ){
            this.generation = ack.generation;
            this.rebuildPeer();
        } else if( typeof ack.generation === 'number' ){
            this.generation = ack.generation;
        }

        if( ack.peer && ack.peer.present ){
            this.markPeerPresent();
        }

        this.sendCaps();

        for( const envelope of ack.replay ?? [] ){
            this.onSignal( envelope );
        }

        // Joined again with the other side there lifts a hold, which starts
        // the restarts over from here; a peer that was not holding is
        // restarted as it always was.
        const wasHeld = !! this.peer && this.peer.held;

        this.reviewHold();

        // A rejoin that keeps the peer hands it the credentials the join
        // brought, the way a renewal does, since the renewal now counts from
        // theirs. It used to keep them to itself: the peer went on with the
        // old ones, the renewal was put off to hours after they ran out, and
        // TURN refused the relay's refresh when they did, which left a
        // relayed call to the restarts to recover.
        if( resume && renewed && this.peer && this.peer === kept ){
            this.peer.renewRelay( this.iceServers );
        }

        if( resume && ! wasHeld && this.peer && this.role === 'impolite' && ! this.peer.isConnected ){
            void this.peer.restart();
        }

        this.startKeepalive();

        return true;
    }

    private startKeepalive(): void {
        if( this.aliveTimer !== null || this.ended ) return;

        this.aliveTimer = window.setInterval( () => {
            void this.keepalive();
        }, keepaliveMs() );
    }

    private stopKeepalive(): void {
        if( this.aliveTimer !== null ){
            window.clearInterval( this.aliveTimer );
            this.aliveTimer = null;
        }
    }

    // This side's counters to the relay while the direct path runs, and the
    // relay's reading back: the other side's latest pulse for the peer's own
    // verdict on a silence, and the room when the relay has judged the path
    // dead from both sides' counters at once. Sent from the stats pass that
    // read the counters, not on a clock of its own: two clocks of two seconds
    // drift, and a pulse that fired before the pass carried the last sample
    // again, which the relay read as this side taking nothing in while the
    // other kept sending — the first of the two strikes that move a call to
    // the room, three times in a forty-second call measured on 21 Sep 2026 —
    // and a stats pass late by two ticks would have handed a working call
    // over. Every STATE_RESEND_TICKS the media state goes out again.
    private async pulse(): Promise<void> {
        const peer = this.peer;

        if( this.ended || ! peer || ! peer.isConnected || ! this.signaling.connected ) return;

        this.pulseTicks++;

        if( this.pulseTicks % STATE_RESEND_TICKS === 0 ){
            this.sendState();
        }

        let ack: PulseAck;

        try {
            ack = await this.signaling.pulse( peer.pulseBody() );
        } catch (e) {
            return;
        }

        if( this.ended || this.peer !== peer ) return;

        if( ! ack.ok ){
            if( ack.error === 'not_joined' ) void this.resume();

            return;
        }

        peer.setPeerPulse( ack.peer ?? null );

        if( ack.sfu && ! ignoreFallback() ){
            this.handoff( ack.sfu, 'the relay judged the direct path dead from both sides\' counters' );
        }
    }

    // The reply is also how a session learns that the server lost it (join
    // again) or that the call ended while its socket was away.
    private async keepalive(): Promise<void> {
        if( this.ended || ! this.signaling.connected ) return;

        let ack: AliveAck;

        try {
            ack = await this.signaling.alive();
        } catch (e) {
            return;
        }

        if( this.ended ) return;

        if( ack.ok ){
            // The call moved to the room while this side could not be told
            // — its socket blinked as the fallback went out — and the alive
            // carries the token now, so it follows instead of sitting on a
            // dead direct path until its own watchdog gives up.
            if( ack.mode === 'sfu' && ack.sfu && ! ignoreFallback() ){
                this.handoff( ack.sfu, 'the alive says the call is on the room' );
            }

            return;
        }

        if( ack.error === 'call_ended' ){
            this.finish( ack.reason ?? 'ended' );
        } else if( ack.error === 'not_joined' ){
            void this.resume();
        }
    }

    private async resume(): Promise<void> {
        if( this.ended || ! this.started ) return;

        await this.join( true );
    }

    private markPeerPresent(): void {
        if( this.peerPresent ) return;

        this.peerPresent = true;

        if( this.peerUserId !== null ){
            this.emit( 'peerJoined', this.peerUserId );
        }
    }

    private onServerMessage( message: ServerMessage ): void {
        // After the handoff the browsers talk to LiveKit, but the server still
        // owns the call: when it ends the call (the other side left, or its
        // socket never came back) this is the only way the LiveKit call here
        // learns of it.
        if( this.handedOff ){
            if( message.op === 'ended' ){
                this.signaling.close();
                this.emit( 'ended', message.reason ?? 'ended' );
            }

            return;
        }

        if( this.ended ) return;

        switch( message.op ){
            case 'ready':
                this.onReady( message );
                break;

            case 'signal':
                // Relayed live, not replayed: the other side is reachable.
                if( this.peerLost ){
                    this.peerLost = false;
                    this.reviewHold();
                }

                if( message.id && message.body ){
                    this.onSignal( {
                        id: message.id,
                        from: callUserOf( message.from ) ?? 0,
                        from_epoch: Number( message.from_epoch ?? 0 ),
                        generation: Number( message.generation ),
                        body: message.body
                    } );
                }
                break;

            case 'peer_lost':
                // The relay saw the other side's realtime socket go, which is not
                // its media going: a socket that moves to another server, or
                // drops and comes straight back, leaves the call's own
                // connection up, and "The other side lost connection" flashed
                // over a call that carried on. The screen shows the loss when
                // that connection is down; its own states and stats set `lost`
                // when it goes down later.
                if( ! this.peer || ! this.peer.isConnected ){
                    this.quality = 'lost';
                }
                this.peerLost = true;
                this.reviewHold();
                this.publishParticipant();

                if( message.peer ){
                    this.emit( 'peerLost', callUserOf( message.peer.user_id ) ?? 0 );
                }
                break;

            case 'peer_back': {
                const wasHeld = !! this.peer && this.peer.held;

                this.peerLost = false;
                this.reviewHold();

                // A `lost` the connection no longer backs goes now, rather than
                // at the next stats tick up to two seconds on.
                if( this.peer && this.peer.isConnected && this.quality === 'lost' ){
                    const measured = this.peer.stats.quality;

                    this.quality = measured === 'unknown' || measured === 'lost' ? 'excellent' : measured;
                    this.publishParticipant();
                }

                if( ! wasHeld && this.peer && this.role === 'impolite' && ! this.peer.isConnected ){
                    void this.peer.restart();
                }
                break;
            }

            case 'fallback':
                if( message.sfu && ! ignoreFallback() ){
                    this.handoff( message.sfu, 'fallback from the relay' );
                } else if( message.sfu ){
                    this.trace( 'fallback from the relay ignored by switch' );
                }
                break;

            case 'ended':
                this.finish( message.reason ?? 'ended' );
                break;
        }
    }

    private onReady( message: ServerMessage ): void {
        const generation = Number( message.generation ?? 0 );

        if( message.peer ){
            this.peerUserId = callUserOf( message.peer.user_id );
        }

        this.markPeerPresent();
        this.peerLost = false;

        if( this.peer && generation <= this.generation ){
            this.reviewHold();
            return;
        }

        this.generation = generation;
        this.rebuildPeer();
    }

    private rebuildPeer(): void {
        if( this.peer ){
            this.peer.close();
            this.peer = null;
        }

        this.remoteState = { ...VISIBLE_DEFAULT };
        this.remoteStateKnown = false;

        const peer = new P2PPeer( {
            polite: this.role === 'polite',
            iceServers: this.iceServers,
            iceTransportPolicy: iceTransportPolicy(),
            send: ( body ) => this.sendSignal( peer, body ),
            onTrack: () => this.publishParticipant(),
            onConnection: ( state ) => this.onPeerConnection( peer, state ),
            onStats: ( stats ) => this.onPeerStats( peer, stats ),
            onFailed: ( reason ) => this.onPeerFailed( peer, reason ),
            refreshIceServers: () => this.refreshIceServers(),
            onPlaybackBlocked: ( element ) => this.onPlaybackBlocked( element ),
            onViewChange: () => this.scheduleView(),
            onCodecBroken: ( family, direction ) => { void this.onCodecBroken( family, direction ); },
            onPeerSilent: ( source ) => this.onPeerSilent( source ),
            onTrace: ( line ) => this.trace( line ),
            caps: this.caps
        } );

        this.peer = peer;
        this.sentView = null;
        this.pulseTicks = 0;

        if( this.peerCaps ){
            peer.setPeerCaps( this.peerCaps );
        }

        for( const [ source, track ] of this.localTracks.entries() ){
            void peer.setLocalTrack( source, track );
        }

        if( this.remoteWanted ){
            peer.setWanted( this.remoteWanted );
        }

        this.sendState();
        this.sendCaps();

        // Handed straight back in, and marked as a replay: these were opened
        // and had their ids taken when they first arrived, and going through
        // the front door again would have every one of them dropped as a
        // duplicate of itself.
        const pending = this.pendingSignals;

        this.pendingSignals = [];

        for( const envelope of pending ){
            this.handleSignal( envelope, true );
        }

        if( forcedFailure() ){
            window.setTimeout( () => this.onPeerFailed( peer, 'forced' ), 500 );
        }

        this.reviewHold();
        this.publishParticipant();
    }

    // A codec the peer connection caught carrying nothing has been written
    // off on this device. The abilities are read again — the probe answers
    // without the families that have failed here — and go out at once, so a
    // peer that can move a live sender moves it; the peer connection then
    // offers the call again without it, which is what moves a peer that
    // cannot. Either way the picture comes back on this call, not the next.
    private async onCodecBroken( family: string, direction: CodecDirection ): Promise<void> {
        if( this.ended || ! markBroken( family, direction ) ) return;

        this.trace( 'wrote off ' + family.replace( 'video/', '' ) + ':' + direction + ' on this device' );

        const caps = await probeCodecCaps();

        if( this.ended ) return;

        this.caps = caps;

        this.sendCaps();

        this.peer?.setOwnCaps( caps );
    }

    // The codec abilities go out right after every join, before there is a
    // peer to speak of: the other side needs them when it answers.
    /**
     * One line of this side's account, batched to the call's trace.
     *
     * Best effort in every direction: nothing waits on it, a failure is
     * swallowed, and it must never carry SDP, addresses or names — the trace
     * is readable precisely because it does not.
     */
    private trace( line: string ): void {
        if( this.ended && ! this.handedOff ) return;

        this.queueTrace( line );
    }

    // A line about the room leg of a call that was handed off. The session
    // is over here, its signaling is not, and the call's account carries on
    // — the room used to be a blank in every trace, from the hand-off to the
    // end.
    sfuTrace( line: string ): void {
        if( ! this.handedOff || this.signaling.isClosed ) return;

        this.queueTrace( line );
    }

    private queueTrace( line: string ): void {
        const stamped = '+' + ( ( Date.now() - this.traceStart ) / 1000 ).toFixed( 3 ) + ' ' + line;

        if( this.traceLines.length < TRACE_MAX_LINES ){
            this.traceLines.push( stamped );
        } else {
            this.traceDropped++;
        }

        if( this.traceTimer !== null ) return;

        this.traceTimer = window.setTimeout( () => {
            this.traceTimer = null;
            this.flushTrace();
        }, TRACE_FLUSH_MS );
    }

    private flushTrace(): void {
        if( this.traceDropped > 0 ){
            this.traceLines.push( '+' + ( ( Date.now() - this.traceStart ) / 1000 ).toFixed( 3 ) + ' trace: ' + this.traceDropped + ' lines were dropped here, the queue was full' );
            this.traceDropped = 0;
        }

        if( this.traceLines.length === 0 ) return;

        const lines = this.traceLines;

        this.traceLines = [];

        // A batch the relay never took goes back in front of whatever has
        // been written since, so the order holds; one attempt used to lose
        // it for good, and it was the account of the seconds worth reading.
        this.signaling.trace( lines ).then( ( ack ) => {
            if( ! ack.ok ) this.requeueTrace( lines );
        } ).catch( () => this.requeueTrace( lines ) );
    }

    private requeueTrace( lines: string[] ): void {
        if( this.signaling.isClosed ) return;

        const merged = lines.concat( this.traceLines );
        const overflow = Math.max( 0, merged.length - TRACE_MAX_LINES );

        this.traceDropped += overflow;
        this.traceLines = merged.slice( overflow );
    }

    private sendCaps(): void {
        if( this.ended ) return;

        const generation = this.generation;
        const cipher = this.cipher;
        // h264Baseline is this page's own (types.ts): the other side's ranking doesn't read it, and an app's parser
        // isn't handed what it doesn't know
        const { h264Baseline: _own, ...caps } = this.caps;
        const body: SignalBody = { kind: 'caps', caps };

        this.outbound = this.outbound.then( async () => {
            const wire = cipher ? await cipher.seal( body ) : body;

            if( this.ended ) return;

            this.signaling.signal( generation, wire ).catch( () => undefined );
        } ).catch( () => undefined );
    }

    private sendSignal( peer: P2PPeer, body: SignalBody ): void {
        if( this.ended || this.peer !== peer ) return;

        const generation = this.generation;
        const cipher = this.cipher;

        // Sealing is asynchronous; the chain keeps the signals in the order
        // they were produced, which negotiation depends on.
        this.outbound = this.outbound.then( async () => {
            const wire = cipher ? await cipher.seal( body ) : body;

            if( this.ended || this.peer !== peer ) return;

            this.signaling.signal( generation, wire ).then( ( ack ) => {
                // Queued means the peer was not there to take it. That is the
                // difference between an offer that was delivered and one that
                // is sitting in Redis waiting to be asked for.
                this.trace(
                    ( body.kind ?? 'signal' ) + ' sent gen=' + generation +
                    ( ack.ok ? ( ( ack as any ).queued ? ' -> queued' : ' -> delivered' ) : ' -> refused ' + ( ack.error ?? '?' ) )
                );

                if( ! ack.ok && ack.error === 'stale_generation' && typeof ack.generation === 'number' && ack.generation > this.generation && this.peer === peer ){
                    this.generation = ack.generation;
                    this.rebuildPeer();
                }
            } ).catch( ( e ) => {
                this.trace( ( body.kind ?? 'signal' ) + ' sent gen=' + generation + ' -> failed ' + ( e && e.message ? e.message : 'error' ) );
            } );
        } ).catch( () => undefined );
    }

    private onSignal( envelope: SignalEnvelope ): void {
        if( this.ended || ! envelope.body ) return;

        const body = envelope.body;

        this.inbound = this.inbound.then( async () => {
            if( this.ended ) return;

            if( isSealedSignal( body ) ){
                const opened = this.cipher ? await this.cipher.open( body ) : null;

                if( ! opened ){
                    console.warn( 'p2p signal could not be opened' );
                    return;
                }

                this.handleSignal( { ...envelope, body: opened } );
                return;
            }

            this.handleSignal( envelope );
        } ).catch( () => undefined );
    }

    // `replayed` is a signal this side parked itself (for a peer or a
    // generation it did not have yet) and is handing back in: its id has
    // already been taken, so the duplicate check would refuse it.
    private handleSignal( envelope: SignalEnvelope, replayed = false ): void {
        if( this.ended || ! envelope.body || isSealedSignal( envelope.body ) ) return;

        if( ! replayed ){
            if( this.lastId && compareStreamIds( envelope.id, this.lastId ) <= 0 ){
                return;
            }

            this.lastId = envelope.id;
        }

        if( envelope.generation < this.generation ){
            return;
        }

        if( ! this.peer || envelope.generation > this.generation ){
            this.pendingSignals.push( envelope );
            return;
        }

        if( envelope.body.kind === 'state' ){
            this.remoteState = { ...VISIBLE_DEFAULT, ...envelope.body.state };
            this.remoteStateKnown = true;
            this.updateExpectInbound();
            this.publishParticipant();
            this.scheduleView();
            return;
        }

        if( envelope.body.kind === 'view' ){
            this.remoteWanted = { ...envelope.body.view };
            this.peer.setWanted( this.remoteWanted );
            return;
        }

        if( envelope.body.kind === 'caps' ){
            this.peerCaps = envelope.body.caps;

            // The flags, not only the families. Which codecs a peer has says
            // nothing about why the ranking chose between them, and a call
            // between two browsers had no record of either side's abilities at
            // all — only the app logged this, so "why did these two pick
            // H264?" could not be answered for a pair that has no app in it.
            // e/d are encode and decode, h hardware, s smooth, f fast.
            this.trace( 'peer caps: ' + Object.keys( this.peerCaps.families )
                .filter( ( family ) => {
                    const score = this.peerCaps!.families[ family ];

                    return !! score && ( score.enc.ok || score.dec.ok );
                } )
                .map( ( family ) => {
                    const score = this.peerCaps!.families[ family ]!;
                    const flags = ( half: { ok: boolean, hw: boolean, smooth: boolean, fast: boolean } ) =>
                        ! half.ok ? '-' : ( half.hw ? 'h' : '' ) + ( half.smooth ? 's' : '' ) + ( half.fast ? 'f' : '' );

                    return family.replace( 'video/', '' ) + ' e:' + flags( score.enc ) + ' d:' + flags( score.dec );
                } )
                .join( ' ' ) );

            this.peer.setPeerCaps( this.peerCaps );
            return;
        }

        if( envelope.body.kind === 'reacquire' ){
            this.trace( 'the other side says this side\'s ' + envelope.body.source + ' sends nothing, opening it again' );
            this.emit( 'reacquire', envelope.body.source );
            return;
        }

        void this.peer.handleSignal( envelope.body );
    }

    // Media is expected from the other side when it has a source on that we
    // have not asked it to stop sending; the stall watchdog must not count a
    // pause we asked for.
    private updateExpectInbound(): void {
        if( ! this.peer ) return;

        // The video sources by name as well as the whole: a picture that
        // never comes is watched per source, because audio keeps the whole
        // moving and hides it.
        const video = new Set<P2PSource>();

        const expected = ( Object.keys( this.remoteState ) as P2PSource[] ).some( ( source ) => {
            if( ! this.remoteState[ source ] ) return false;
            if( source !== 'camera' && source !== 'screen_share' ) return true;

            const wanted = this.sentView ? this.sentView[ source ] : undefined;

            if( wanted === undefined || wanted > 0 ){
                video.add( source );

                return true;
            }

            return false;
        } );

        this.peer.setExpectInbound( expected );
        this.peer.setExpectedVideo( video );
    }

    // How big each of the other side's video sources is shown here, as the
    // VIEW_STEPS height of its largest visible box; a source they have off
    // is left out, so a stale wish from a hidden tab cannot hold it back.
    private currentView(): ViewHint | null {
        if( ! this.peer || ! this.remoteStateKnown ) return null;

        const view: ViewHint = {};

        for( const source of VIDEO_SOURCES ){
            if( ! this.remoteState[ source ] ) continue;

            const track = this.peer.remoteTrack( source );

            view[ source ] = track ? track.wantedHeight() : 0;
        }

        return view;
    }

    // A size that is still moving is not worth telling the other side about:
    // a window being dragged would otherwise reconfigure its encoder several
    // times a second. The send waits for the size to stand still, and is
    // made anyway once it has been moving for VIEW_SETTLE_MAX, so something
    // that never settles is still followed.
    private scheduleView(): void {
        if( this.ended ) return;

        const now = Date.now();

        if( this.viewTimer === null ){
            this.viewPendingSince = now;
        } else {
            if( now - this.viewPendingSince >= VIEW_SETTLE_MAX ) return;

            window.clearTimeout( this.viewTimer );
        }

        this.viewTimer = window.setTimeout( () => {
            this.viewTimer = null;
            this.sendView();
        }, VIEW_SETTLE_MS );
    }

    private sendView(): void {
        if( this.ended || ! this.peer || ! this.peer.isConnected ) return;

        const view = this.currentView();

        if( ! view ) return;

        const same = this.sentView !== null && VIDEO_SOURCES.every( ( source ) => this.sentView![ source ] === view[ source ] );

        if( same ) return;

        this.sentView = view;
        this.updateExpectInbound();

        // What was actually asked for, not just that something was. This hint
        // is the whole of the other side's bitrate ceiling — a camera told 180
        // sends 200 kbps and one told 1080 sends megabits — and the trace said
        // only "view sent", which cannot tell a healthy call from a peer
        // pinned to the smallest rung for its whole duration.
        this.trace( 'view sent ' + VIDEO_SOURCES.map( ( source ) => source + '=' + view[ source ] ).join( ' ' ) );

        this.sendSignal( this.peer, { kind: 'view', view } );
    }

    private onPeerConnection( peer: P2PPeer, state: P2PConnection ): void {
        if( this.peer !== peer || this.ended ) return;

        this.trace( 'connection ' + state );

        if( state === 'connected' ){
            this.quality = peer.stats.quality === 'unknown' || peer.stats.quality === 'lost' ? 'excellent' : peer.stats.quality;
            // A rebuilt or restarted connection starts from full size on the
            // other side; it is told again how this side shows it.
            this.sentView = null;
            this.scheduleView();
        } else if( state === 'reconnecting' ){
            this.quality = 'lost';
        }

        this.publishParticipant();
        this.emit( 'connection', state );
    }

    private onPeerStats( peer: P2PPeer, stats: P2PStats ): void {
        if( this.peer !== peer ) return;

        this.stats = stats;

        // This side's socket going is noticed on this clock, two seconds at
        // most after it went.
        this.reviewHold();

        void this.pulse();

        if( peer.isConnected && stats.quality !== this.quality && stats.quality !== 'unknown' ){
            this.quality = stats.quality;
            this.publishParticipant();
        }

        this.sendReport( peer, stats );

        this.emit( 'stats', stats );
    }

    // The call record carries what each side ran the call on: its browser and
    // platform, the codec each direction settled on, and whether the media
    // went straight there or through the relay. Sent when the picture is
    // whole and again whenever it changes, and never retried: it is
    // bookkeeping, and a call must not turn on it.
    private sendReport( peer: P2PPeer, stats: P2PStats, force = false ): void {
        if( this.ended && ! force ) return;

        const pair = stats.candidatePair;

        if( ! pair ) return;

        // The codecs are remembered once seen, and the byte counts only ever
        // climb: an ICE restart starts the browser's stream counters over, and
        // the report that followed one said the call had carried nothing and
        // named no codec — over a record that a moment earlier had both.
        const codecs = this.knownCodecs;

        for( const key of Object.keys( codecs ) as Array<keyof typeof codecs> ){
            if( stats.codecs[ key ] ) codecs[ key ] = stats.codecs[ key ];
        }

        this.bytesSeen.sent = Math.max( this.bytesSeen.sent, stats.bytesSent );
        this.bytesSeen.recv = Math.max( this.bytesSeen.recv, stats.bytesReceived );

        const report = {
            browser: browserLabel(),
            platform: platformLabel(),
            // Which kind of client this is. The apps run the same protocol
            // with a native engine and report `ios` / `android` here, so a
            // record says what it was between without guessing at the
            // browser name.
            client: 'web',
            path: ( pair.local === 'relay' || pair.remote === 'relay' ) ? 'relay' : 'direct',
            // The pair `path` summarises: a relayed leg over TLS on 443 and
            // one over plain UDP read the same otherwise.
            candidate: { local: pair.local ?? '', remote: pair.remote ?? '', protocol: pair.protocol ?? '' },
            restarts: stats.restarts,
            video: { send: codecs.videoSend ?? '', recv: codecs.videoRecv ?? '' },
            audio: { send: codecs.audioSend ?? '', recv: codecs.audioRecv ?? '' },
            // Which encoder and decoder ran it, so a record says whether the
            // call cost the CPU rather than only which codec it agreed on.
            // Empty where the browser will not say — Safari never does, and
            // Chrome only once capture permission has been granted.
            impl: { enc: stats.impl.enc ?? '', dec: stats.impl.dec ?? '' },
            // How much this side actually moved, so a record can be read as
            // "the call carried something" rather than "the call was set up".
            bytes: { sent: Math.round( this.bytesSeen.sent ), recv: Math.round( this.bytesSeen.recv ) }
        };

        const signature = JSON.stringify( { ...report, bytes: null } );
        const now = Date.now();

        // The description is sent the moment it changes; the counters only
        // climb, so they go at a walking pace and once more at the end.
        if( ! force && signature === this.sentReport && now - this.sentReportAt < REPORT_BYTES_MS ) return;

        this.sentReport = signature;
        this.sentReportAt = now;

        this.signaling.report( report ).catch( () => undefined );
    }

    private onPeerFailed( peer: P2PPeer, reason: string ): void {
        if( this.peer !== peer || this.ended ) return;

        this.trace( 'direct path given up: ' + reason );

        // The relay is told either way: it flips the call and tells the
        // other side. With the room token already in hand from the join this
        // side moves at once and hears the answer later; the answer used to
        // be waited on for three tries of eight seconds, and when they ran
        // out the call ended with no room at all. Without a token it waits
        // for the one in the answer, as it always did.
        const standby = this.standby && roomTokenUsable( this.standby.token ) ? this.standby : null;

        if( this.standby && ! standby ){
            this.trace( 'the room token held from the join has run out, waiting for a fresh one' );
        }

        const pending = this.signaling.failed( reason );

        if( standby && ! ignoreFallback() ){
            pending.then( ( ack ) => {
                this.sfuTrace( 'failed acked: ' + ( ack.ok ? 'mode=' + ( ack.mode ?? '?' ) : 'refused' ) );
            } ).catch( ( e ) => {
                this.sfuTrace( 'failed not acked: ' + ( e && e.message ? e.message : 'error' ) );
            } );

            this.handoff( standby, reason + ', with the room token held from the join' );
            return;
        }

        pending.then( ( ack ) => {
            if( this.ended ) return;

            if( ack.ok && ack.sfu && ! ignoreFallback() ){
                this.handoff( ack.sfu, reason + ', with the room token from the answer' );
            } else {
                this.trace( 'failed acked without a room' + ( ignoreFallback() ? ' (the fallback is ignored by switch)' : '' ) + ', ending' );
                this.finish( 'connection_failed' );
            }
        } ).catch( ( e ) => {
            if( this.ended ) return;

            this.trace( 'failed not acked (' + ( e && e.message ? e.message : 'error' ) + '), ending' );
            this.finish( 'connection_failed' );
        } );
    }

    // The other side's capture of this kind has stopped while the path is
    // fine: it is told, so it can open the device again, and the container
    // is told, so the person here knows why it went quiet.
    private onPeerSilent( source: 'microphone' | 'camera' ): void {
        if( this.ended || ! this.peer ) return;

        this.trace( 'telling the other side its ' + source + ' sends nothing' );
        this.sendSignal( this.peer, { kind: 'reacquire', source } );
        this.emit( 'peerSilent', source );
    }

    // Fresh credentials from the relay, or null. The room token comes fresh
    // with them, so the one held for a hand-off is never older than they are.
    private async fetchIceServers(): Promise<{ servers: IceServer[]; expiresAt: number | undefined } | null> {
        try {
            const ack = await this.signaling.iceServers();

            if( ack.ok && ack.sfu ){
                this.standby = ack.sfu;
            }

            if( ack.ok && ack.ice_servers && ack.ice_servers.length > 0 ){
                return { servers: ack.ice_servers, expiresAt: ack.ice_expires_at };
            }
        } catch (e) {}

        return null;
    }

    // Credentials this side goes on with, and when they run out: taken only
    // together with handing them to the peer — the peer built from them, the
    // restart that asked for them, a renewal or a rejoin — because the next
    // renewal counts from their expiry, and a peer left on older ones loses
    // its relay when those run out, hours before the renewal comes round.
    // Says whether the expiry moved. `soonest` is how soon the renewal after
    // them may come (RENEW_JOIN_DELAY or RENEW_MIN_DELAY).
    private takeIceServers( servers: IceServer[], expiresAt: number | undefined, soonest: number ): boolean {
        this.iceServers = servers;

        return this.setIceExpiry( expiresAt, soonest );
    }

    // Asked for by every restart, which goes on with what it has after
    // ICE_SERVERS_BUDGET: an empty answer means nothing fresh came in time.
    // A reply later than that is left, and the renewal keeps counting from
    // the credentials the restart went with.
    private refreshIceServers(): Promise<IceServer[]> {
        return new Promise( ( resolve ) => {
            let settled = false;

            const budget = window.setTimeout( () => {
                settled = true;
                resolve( [] );
            }, ICE_SERVERS_BUDGET );

            void this.fetchIceServers().then( ( fresh ) => {
                if( settled ) return;

                settled = true;
                window.clearTimeout( budget );

                if( ! fresh || this.ended ){
                    resolve( [] );
                    return;
                }

                this.takeIceServers( fresh.servers, fresh.expiresAt, RENEW_MIN_DELAY );
                resolve( fresh.servers );
            } );
        } );
    }

    // Whether a restart could reach the other side now: this side joined on
    // the socket it has, and the relay not having said the other side's is
    // gone. The peer holds its escalation while either is not so.
    private reviewHold(): void {
        const peer = this.peer;

        if( ! peer || this.ended ) return;

        if( ! this.signaling.connected ){
            this.joinedSocket = false;
        }

        if( ! this.joinedSocket ){
            peer.setSignalingHeld( true, 'this side\'s realtime connection is down' );
        } else if( this.peerLost ){
            peer.setSignalingHeld( true, 'the relay says the other side\'s connection is down' );
        } else {
            peer.setSignalingHeld( false, 'both sides can be reached' );
        }
    }

    // Says whether the expiry moved; the renewal is scheduled from it either
    // way, since it is called as credentials arrive.
    private setIceExpiry( expiresAt: number | undefined, soonest: number ): boolean {
        if( ! expiresAt || ! Number.isFinite( expiresAt ) ) return false;

        const moved = expiresAt * 1000 !== this.iceExpiresAt;

        this.iceExpiresAt = expiresAt * 1000;
        this.scheduleRenewal( soonest );

        return moved;
    }

    // The TURN credentials, and the room token with them, are renewed a
    // little before they run out, for as long as the call runs: not sooner
    // than `soonest`, not later than TIMER_MAX.
    private scheduleRenewal( soonest: number ): void {
        if( this.renewTimer !== null ){
            window.clearTimeout( this.renewTimer );
            this.renewTimer = null;
        }

        if( this.ended || this.iceExpiresAt === 0 ) return;

        const left = this.iceExpiresAt - Date.now();
        const margin = Math.min( RENEW_MARGIN, Math.max( 5000, left / 4 ) );

        this.renewTimer = window.setTimeout( () => {
            this.renewTimer = null;
            void this.renewRelay();
        }, Math.min( TIMER_MAX, Math.max( soonest, left - margin ) ) );
    }

    private async renewRelay(): Promise<void> {
        if( this.ended || ! this.peer ) return;

        const fresh = await this.fetchIceServers();

        if( this.ended || ! this.peer ) return;

        if( ! fresh ){
            this.trace( 'the relay credentials could not be renewed, asking again in a minute' );

            this.renewTimer = window.setTimeout( () => {
                this.renewTimer = null;
                void this.renewRelay();
            }, RENEW_MIN_DELAY );

            return;
        }

        this.takeIceServers( fresh.servers, fresh.expiresAt, RENEW_MIN_DELAY );
        this.peer.renewRelay( fresh.servers );
    }

    private onPlaybackBlocked( element: HTMLMediaElement ): void {
        this.blockedElements.add( element );
        this.emit( 'playbackBlocked' );
    }

    async resumePlayback(): Promise<void> {
        const elements = Array.from( this.blockedElements );

        this.blockedElements.clear();

        for( const element of elements ){
            try {
                await element.play();
            } catch (e) {}
        }
    }

    setLocalTrack( source: P2PSource, track: MediaStreamTrack | null ): void {
        if( this.ended ) return;

        if( track ){
            this.localTracks.set( source, track );
        } else {
            this.localTracks.delete( source );
        }

        if( this.peer ){
            void this.peer.setLocalTrack( source, track );
        }

        this.sendState();
    }

    private localState(): MediaState {
        const has = ( source: P2PSource ) => {
            const track = this.localTracks.get( source );
            return !! track && track.readyState === 'live';
        };

        return {
            camera: has( 'camera' ),
            microphone: has( 'microphone' ),
            screen_share: has( 'screen_share' ),
            screen_share_audio: has( 'screen_share_audio' )
        };
    }

    private sendState(): void {
        if( this.stateTimer !== null ){
            window.clearTimeout( this.stateTimer );
        }

        this.stateTimer = window.setTimeout( () => {
            this.stateTimer = null;

            if( this.ended || ! this.peer ) return;

            this.sendSignal( this.peer, { kind: 'state', state: this.localState() } );
        }, 50 );
    }

    participant(): P2PParticipantView | null {
        if( this.peerUserId === null ) return null;

        const track = ( source: P2PSource ) => {
            if( ! this.peer || ! this.remoteStateKnown ) return null;
            if( ! this.remoteState[ source ] ) return null;

            return this.peer.remoteTrack( source );
        };

        return {
            identity: this.peerIdentity,
            user_id: this.peerUserId,
            video: track( 'camera' ),
            audio: track( 'microphone' ),
            screen: track( 'screen_share' ),
            screenAudio: track( 'screen_share_audio' ),
            quality: this.quality,
            mediaState: { ...this.remoteState },
            mediaStateKnown: this.remoteStateKnown
        };
    }

    private publishParticipant(): void {
        const view = this.participant();

        if( view ){
            this.emit( 'participant', view );
        }
    }

    private handoff( sfu: SfuHandoff, why: string = 'told by the relay' ): void {
        if( this.ended ) return;

        // Written and flushed before the teardown, which used to swallow the
        // last two seconds of the direct path — the very seconds that said
        // why it was being left.
        this.trace( 'handing off to the room: ' + why );
        this.flushTrace();

        this.handedOff = true;
        this.teardown( true );
        this.emit( 'fallback', sfu );
    }

    private finish( reason: string ): void {
        if( this.ended ) return;

        // Before the teardown, which sets `ended` and closes the socket this
        // goes out on. For a call that never connected this last flush is the
        // whole of its account, and the reason is the most useful line in it.
        this.trace( 'ended: ' + reason );
        this.flushTrace();

        this.teardown();
        this.emit( 'ended', reason );
    }

    private teardown( keepListening: boolean = false ): void {
        this.ended = true;

        if( this.stopReconnectListener ){
            this.stopReconnectListener();
            this.stopReconnectListener = null;
        }

        if( this.pageHideListener ){
            window.removeEventListener( 'pagehide', this.pageHideListener );
            this.pageHideListener = null;
        }

        if( this.stateTimer !== null ){
            window.clearTimeout( this.stateTimer );
            this.stateTimer = null;
        }

        if( this.viewTimer !== null ){
            window.clearTimeout( this.viewTimer );
            this.viewTimer = null;
        }

        if( this.renewTimer !== null ){
            window.clearTimeout( this.renewTimer );
            this.renewTimer = null;
        }

        this.stopKeepalive();

        if( this.peer ){
            this.peer.close();
            this.peer = null;
        }

        if( ! keepListening ){
            this.signaling.close();
        }
    }

    // The transport knows where its leave goes and what proves it is this
    // side's (transport.ts).
    private beaconLeave(): void {
        if( this.ended || ! this.transport.beacon ) return;

        try {
            this.transport.beacon( this.callId, this.signaling.session );
        } catch (e) {}
    }

    end( reason: string ): void {
        if( this.ended ) return;

        // The last numbers before the record closes: whatever this side had
        // moved by the time it hung up.
        if( this.peer ){
            this.sendReport( this.peer, this.peer.stats, true );
        }

        // And the last lines. The trace goes out in two-second batches, so
        // hanging up threw away whatever this side had noticed in its final
        // seconds — which, for a call hung up because the picture had
        // stopped, was the watchdog saying so.
        this.trace( 'ended: ' + reason );
        this.flushTrace();

        this.signaling.leave( reason ).catch( () => undefined );
        this.teardown();
    }
}
