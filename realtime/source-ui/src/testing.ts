// @wordplus/realtime-ui/testing: a call and a room made by hand, what the package's own tests and the tests that come
// with a copied view (`npx @wordplus/realtime-ui add`) draw the screens from, with no call, no server and no test runner
// of theirs: every action is recorded in a plain array, so any runner's expectations read it.
import type { CallContextInterface, CallParticipant, CallTrack } from "./components/calls/context.ts";
import type { SdkEventMeta, SdkHistoryEvent, SdkRoom, SdkRooms } from "./sdk/rooms.ts";

/** A track that remembers where it was attached, as LiveKit's do. */
export function fakeTrack(): CallTrack & { attached: HTMLMediaElement[] } {
    const attached: HTMLMediaElement[] = [];

    return {
        attached,
        get attachedElements() {
            return attached;
        },
        attach( element: HTMLMediaElement ) {
            attached.push( element );
            return element;
        },
        detach( element: HTMLMediaElement ) {
            const at = attached.indexOf( element );
            if ( at >= 0 ) attached.splice( at, 1 );
            return element;
        },
    };
}

/** Someone in a call: `me` for the user, `user_<id>` for the others, as the calls name them. */
export function participant( id: string, extra: Partial<CallParticipant> = {} ): CallParticipant {
    return {
        identity: id, name: "User " + id, avatar: "", link: "", audioLevel: 0, isSpeaking: false, isPinned: false,
        quality: "good", video: null, videoPub: null, audio: null, audioPub: null, screen: null, screenPub: null,
        screenAudio: null, screenAudioPub: null, canPublish: true, canAdmin: false, handRaised: false, micMuted: false,
        ...extra,
    };
}

const ref = <T>( current: T ) => ( { current } );

/**
 * A call's context, connected with the user and Ann (34) in it, every action the screen takes recorded in `calls` (`endCall`,
 * `disableMic`, `endCall "abort"` …), `over` set on top: `action: 'incoming_call'` for a call ringing in, `participants`
 * for a group.
 */
export function fakeCall( over: Partial<CallContextInterface> = {} ): CallContextInterface & { calls: string[] } {
    const calls: string[] = [];
    // A button handed straight to onClick gets the click: only plain values are what a screen passed.
    const plain = ( a: unknown ) => a === null || typeof a !== "object" || Object.getPrototypeOf( a ) === Object.prototype || Array.isArray( a );
    const record = ( name: string ) => async ( ...args: unknown[] ) => {
        calls.push( [ name, ...args.filter( plain ).map( ( a ) => JSON.stringify( a ) ) ].join( " " ) );
        return true as never;
    };
    const participants = over.participants ?? new Map<string, CallParticipant>( [ [ "me", participant( "me" ) ] ] );

    return {
        calls,
        wrapper: ref( null ),
        thread: { thread_id: 7, participants: [ 34 ] },
        callInfo: { thread_id: 7, message_id: 1, token: "t", user_ids: [ 42, 34 ], type: "video", encryption_key: "" },
        adminMode: false,
        canPublish: true,
        statusMessage: "",
        participants,
        participantsRef: ref( participants ),
        action: "call_in_progress",
        errorMessages: [],
        callDurationRef: ref( 65_000 ),
        bytesReceivedRef: ref( 0 ),
        bytesSentRef: ref( 0 ),
        connectionState: "connected",
        endCall: record( "endCall" ),
        answerCall: record( "answerCall" ),
        activeCameraDevice: "",
        setActiveCameraDevice: () => {},
        selectedCameraDevice: "",
        setSelectedCameraDevice: () => {},
        selectedMicrophoneDevice: "",
        setSelectedMicrophoneDevice: () => {},
        selectedSpeakerDevice: "",
        setSelectedSpeakerDevice: () => {},
        fullScreenEnabled: false,
        setFullScreenEnabled: () => {},
        myCameraTrack: null,
        myCameraTrackRef: ref( null ),
        myMicrophoneTrack: null,
        myMicrophoneTrackRef: ref( null ),
        myScreenVideoTrack: null,
        myScreenVideoTrackRef: ref( null ),
        switchingCamera: false,
        switchCamera: record( "switchCamera" ),
        enableCamera: record( "enableCamera" ),
        disableCamera: record( "disableCamera" ),
        enableMic: record( "enableMic" ),
        disableMic: record( "disableMic" ),
        enableFullScreen: () => {},
        disableFullScreen: () => {},
        enableShareScreen: record( "enableShareScreen" ),
        disableShareScreen: record( "disableShareScreen" ),
        roomLocked: false,
        setRoomLocked: () => {},
        roomMuted: false,
        setRoomMuted: () => {},
        raiseHand: record( "raiseHand" ),
        lowerHand: record( "lowerHand" ),
        lowerAllHands: record( "lowerAllHands" ),
        myHandRaised: false,
        myMicMuted: false,
        callMode: "participatory",
        setCallMode: record( "setCallMode" ),
        promoteParticipant: record( "promoteParticipant" ),
        demoteParticipant: record( "demoteParticipant" ),
        moderate: record( "moderate" ),
        iconsReverted: false,
        fullScreenAvailable: false,
        ...over,
    } as CallContextInterface & { calls: string[] };
}

export interface FakeRoomOptions {
    /** Who is in it, by id, with their info. */
    members?: Record<string, Record<string, unknown>>;
    /** What its history answers. */
    history?: { events: SdkHistoryEvent[]; more: boolean };
    /** The ack an emit gets: an id and a time by default. */
    ack?: ( event: string, data: unknown ) => { id: string; at: number } | Promise<{ id: string; at: number }>;
}

export type FakeRoom = SdkRoom & {
    /** What was emitted with an ack or without, in order: `[ event, data ]`. */
    emitted: Array<[ string, unknown ]>;
    /** What was emitted volatile, in order. */
    volatileEmitted: Array<[ string, unknown ]>;
    /** Delivers an event to whoever listens: `fire( 'message', { text }, { from: '42', id: 'm1', at } )`. */
    fire( event: string, data?: unknown, meta?: SdkEventMeta ): void;
};

/** A joined room whose events the test fires by hand. */
export function fakeRoom( name: string, options: FakeRoomOptions = {} ): FakeRoom {
    const handlers = new Map<string, Array<( ...args: any[] ) => void>>();
    const emitted: Array<[ string, unknown ]> = [];
    const volatileEmitted: Array<[ string, unknown ]> = [];
    let acks = 0;
    const room = {
        name,
        state: "joined",
        error: null,
        members: new Map( Object.entries( options.members ?? {} ) ),
        count: null,
        emitted,
        volatileEmitted,
        on: ( event: string, fn: ( ...args: any[] ) => void ) => void handlers.set( event, [ ...( handlers.get( event ) ?? [] ), fn ] ),
        off: ( event?: string, fn?: ( ...args: any[] ) => void ) => void ( event && handlers.set( event, ( handlers.get( event ) ?? [] ).filter( ( f ) => f !== fn ) ) ),
        emit: ( event: string, data: unknown ) => void emitted.push( [ event, data ] ),
        emitWithAck: async ( event: string, data: unknown ) => {
            emitted.push( [ event, data ] );
            return options.ack ? options.ack( event, data ) : { id: "ack-" + ++acks, at: Date.now() };
        },
        volatile: { emit: ( event: string, data: unknown ) => void volatileEmitted.push( [ event, data ] ) },
        history: async () => options.history ?? { events: [], more: false },
        fire: ( event: string, ...args: unknown[] ) => ( handlers.get( event ) ?? [] ).forEach( ( fn ) => fn( ...args ) ),
    };
    return room as unknown as FakeRoom;
}

/**
 * The page's rooms, `user` its own user: `join` hands out the rooms given, and `users` names Ann (34), Ben (42) and
 * Cara (43), or the profiles given.
 */
export function fakeRooms( rooms: Record<string, FakeRoom>, { user = "34", profiles }: { user?: string; profiles?: Record<string, { name: string; avatar?: string }> } = {} ): SdkRooms & { joined: Set<string> } {
    const joined = new Set<string>();
    const known = profiles ?? { 34: { name: "Ann" }, 42: { name: "Ben" }, 43: { name: "Cara" } };
    const rt = {
        tab: "t1",
        user,
        joined,
        online: { watch: () => {}, unwatch: () => {}, has: () => true, lastSeen: () => null, count: null, on: () => {}, off: () => {} },
        join: ( name: string ) => ( joined.add( name ), rooms[ name ] ),
        leave: ( name: string ) => void joined.delete( name ),
        room: ( name: string ) => ( joined.has( name ) ? rooms[ name ] : undefined ),
        users: async ( ids: Array<number | string> ) => Object.fromEntries( ids.map( String ).filter( ( id ) => known[ id ] ).map( ( id ) => [ id, { user_id: Number( id ), ...known[ id ] } ] ) ),
    };
    return rt as unknown as SdkRooms & { joined: Set<string> };
}
