import { useEffect, useMemo, useRef, useState } from "react";
import type { DeliveryState } from "../components/chat/message-parts.tsx";
import { personOf, useProfiles, useRoom, useTyping, type SdkEventMeta, type SdkHistoryEvent, type SdkRooms } from "./rooms.ts";

// A conversation on one of an app's rooms, without its look: the engine under the chat (chat.tsx), and under an app's
// own copy of it (`npx @wordplus/realtime-ui add chat`), so a fix here reaches both. What travels, by the room's events
// (the app's server lists them in the room's `emit`):
//   message   { text }          emitted with an ack; the app's server keeps it, from its webhook
//   typing    { on }            volatile, while writing and when stopping
//   reaction  { id, key }       the user's reaction to a message, one each, an empty key taking it back; kept as messages are
//   read      { id }            volatile, the newest message the user has seen, for the sender's ticks
// A room that doesn't allow one of them simply goes without it.
//
// The conversation is the app's, not the cloud's, which only delivers its events as they happen: the app's server saves
// each message and reaction its webhook brings, and `load` pages back through them. The room's own history, 5 minutes
// long, only fills in what the app's server hasn't saved yet and what a page that reconnects missed. Without `load`, the
// room's history is all there is.

/** A message the app's server kept from its webhook: its room event's id, who sent it, what, when, and its reactions. */
export interface StoredMessage {
    id: string;
    from: string | number;
    text: string;
    at: number;
    /** By reaction key, who picked it. */
    reactions?: Record<string, Array<string | number>>;
}

/** A page of the app's messages, oldest first, and whether there are older ones. */
export interface ChatPage {
    messages: StoredMessage[];
    more: boolean;
}

export type ChatLoader = ( before: { id: string; at: number } | null ) => Promise<ChatPage>;

/** A message of the page user the room took: its event id (the webhook's `event_id`), its room, what and when. */
export interface SentMessage {
    id: string;
    room: string;
    text: string;
    at: number;
}

/** The events' names, where the app's are others. */
export interface ChatEvents {
    message?: string;
    typing?: string;
    reaction?: string;
    read?: string;
}

/** A message as the chat holds it. */
export interface ChatMessage {
    /** Stable while it is sent, then its id. */
    key: string;
    /** Null while it is being sent. */
    id: string | null;
    from: string;
    text: string;
    at: number;
    status?: DeliveryState;
    /** By reaction key, who picked it. */
    reactions: Record<string, string[]>;
}

export interface UseChatOptions {
    rt: SdkRooms | null | undefined;
    /** A room of the app's whose rule lets its members emit `message` (and `typing`, `reaction`, `read`). */
    room: string;
    events?: ChatEvents;
    /** The longest message, in characters: none by default. */
    maxLength?: number;
    /**
     * The conversation the app's server keeps: the newest page for `null`, else the page before the message given, the
     * oldest the chat shows. Each message carries the id of the room event that brought it (its webhook's `event_id`).
     */
    load?: ChatLoader;
    /**
     * Called as the room takes a message of the page user, with its id: for the page to tell its own server, which may
     * keep it and tell the other person (`realtime.toUser( … ).emit( … )`), as a webhook does where one reaches the server.
     */
    onSent?: ( message: SentMessage ) => void;
}

/** Someone in the conversation, as the screens draw them (`user_id` for the avatar, the same as `id`). */
export interface ChatPerson {
    id: string;
    user_id: string;
    name: string;
    avatar?: string;
}

export interface ChatState {
    /** The page's own user's id, null before it is known. */
    me: string | null;
    /** `joining`, `joined`, `failed` …: the room's state. */
    state: string;
    /** Why the room failed: `kicked` when the app server took the user out of it (`in( room ).kick( user )`). */
    error: string | null;
    /** Oldest first. */
    messages: ChatMessage[];
    /** Whether a page of history is on its way, and whether there is an older one. */
    history: { loading: boolean; more: boolean };
    /** Who is typing now, by id, never the page's own user. */
    writers: string[];
    person( id: string ): ChatPerson;
    /** A message of the user's: sending, sent, seen by the other side, or failed. */
    statusOf( message: ChatMessage ): DeliveryState | undefined;
    /** Sends a message: shown at once, then as sent or failed. */
    send( text: string ): Promise<void>;
    /** Says the user is typing, at most every two seconds. */
    typing(): void;
    /** Says the user stopped typing. */
    stopTyping(): void;
    /** Reacts to a message with a reaction's key, or takes the reaction back when it is the user's already. */
    react( message: ChatMessage, key: string ): Promise<void>;
    /** Pages back once more, while there are older messages and none is on its way. */
    older(): void;
    /** Tells the others the user has seen the newest message from them, once each. */
    markRead(): void;
}

const textOf = ( data: unknown ) => {
    const text = ( data as { text?: unknown } | null )?.text;
    return typeof text === "string" ? text : "";
};

/** A message the app kept, as the chat holds it. */
export const fromStored = ( m: StoredMessage ): ChatMessage => ( {
    key: m.id, id: m.id, from: String( m.from ), text: m.text, at: m.at,
    reactions: Object.fromEntries( Object.entries( m.reactions ?? {} ).map( ( [ k, users ] ) => [ k, users.map( String ) ] ) ),
} );

/** Messages in the order they were sent, each once; one still sending stays where it is, at the end. */
export function ordered( list: ChatMessage[] ): ChatMessage[] {
    const seen = new Set<string>();
    const once = list.filter( ( m ) => ! m.id || ( seen.has( m.id ) ? false : ( seen.add( m.id ), true ) ) );
    return once.map( ( m, i ) => [ m, i ] as const )
        .sort( ( [ a, i ], [ b, j ] ) => ( a.id && b.id ? a.at - b.at || i - j : i - j ) )
        .map( ( [ m ] ) => m );
}

/** Messages and what happened to them, from the room's events in order. */
export function applyEvent( list: ChatMessage[], name: string, data: unknown, meta: SdkEventMeta, names: Required<ChatEvents> ): ChatMessage[] {
    const from = String( meta.from ?? ( data as { from?: unknown } | null )?.from ?? "" );
    if ( name === names.message ) {
        if ( meta.id && list.some( ( m ) => m.id === meta.id ) ) return list;
        // In time order: a page that reconnects hears what it missed after what it has.
        return ordered( [ ...list, { key: meta.id ?? `e${ list.length }-${ meta.at ?? 0 }`, id: meta.id ?? null, from, text: textOf( data ), at: meta.at ?? Date.now(), reactions: {} } ] );
    }
    if ( name === names.reaction ) {
        const { id, key } = ( data ?? {} ) as { id?: string; key?: string };
        if ( ! id || ! from ) return list;
        return list.map( ( m ) => {
            if ( m.id !== id ) return m;
            const reactions: Record<string, string[]> = {};
            for ( const [ k, users ] of Object.entries( m.reactions ) ) {
                const kept = users.filter( ( u ) => u !== from );
                if ( kept.length ) reactions[ k ] = kept;
            }
            if ( key ) reactions[ key ] = [ ...( reactions[ key ] ?? [] ), from ];
            return { ...m, reactions };
        } );
    }
    return list;
}

/** The days, newest last, and in each the stacks of consecutive messages from one sender. */
export function grouped( list: ChatMessage[] ) {
    const days: Array<{ day: string; at: number; stacks: Array<{ from: string; messages: ChatMessage[] }> }> = [];
    for ( const m of list ) {
        const day = new Date( m.at ).toDateString();
        let current = days[ days.length - 1 ];
        if ( ! current || current.day !== day ) days.push( ( current = { day, at: m.at, stacks: [] } ) );
        const stack = current.stacks[ current.stacks.length - 1 ];
        if ( stack && stack.from === m.from ) stack.messages.push( m );
        else current.stacks.push( { from: m.from, messages: [ m ] } );
    }
    return days;
}

/** A conversation on `room`, joined while the screen using it is on, with what it does. */
export function useChat( { rt, room, events, maxLength = 0, load, onSent }: UseChatOptions ): ChatState {
    const names: Required<ChatEvents> = { message: "message", typing: "typing", reaction: "reaction", read: "read", ...events };
    const view = useRoom( rt, room );
    const me = rt?.user ?? null;

    const [ messages, setMessages ] = useState<ChatMessage[]>( [] );
    const [ seenUpTo, setSeenUpTo ] = useState<string | null>( null );
    const [ history, setHistory ] = useState<{ loading: boolean; more: boolean }>( { loading: true, more: false } );
    const typingSent = useRef( 0 );
    const readSent = useRef<string | null>( null );
    // The page's onSent as it gives it now, an inline function being another one at every render.
    const sentTo = useRef( onSent );
    sentTo.current = onSent;
    const writers = useTyping( rt, view.room, names.typing );
    // The app's loader as the page gives it now: an inline function is another one at every render.
    const loadRef = useRef( load );
    loadRef.current = load;

    const people = useMemo( () => [ ...new Set( [ ...messages.map( ( m ) => m.from ), ...writers ] ) ].filter( Boolean ), [ messages, writers ] );
    const profiles = useProfiles( rt, people );
    const info = ( id: string ) => view.members.find( ( m ) => m.id === id )?.info ?? {};
    const person = ( id: string ): ChatPerson => ( { id, ...personOf( id, info( id ), profiles ) } );

    /** History events before the messages there are: replayed in order, the newer ones kept. */
    const replay = ( older: SdkHistoryEvent[], list: ChatMessage[] ) => {
        let earlier: ChatMessage[] = [];
        for ( const e of older ) earlier = applyEvent( earlier, e.event, e.data, { from: e.from, id: e.id, at: e.at }, names );
        const known = new Set( earlier.map( ( m ) => m.id ) );
        return [ ...earlier, ...list.filter( ( m ) => ! m.id || ! known.has( m.id ) ) ];
    };

    // The conversation as the app's server keeps it, then the room's events as they come.
    useEffect( () => {
        const live = view.room;
        if ( ! live ) return;
        let alive = true;
        const on = ( name: string ) => ( data: unknown, meta: SdkEventMeta = {} ) => {
            if ( name === names.read ) {
                if ( meta.from && meta.from !== me && typeof ( data as { id?: unknown } )?.id === "string" ) setSeenUpTo( ( data as { id: string } ).id );
                return;
            }
            setMessages( ( list ) => applyEvent( list, name, data, meta, names ) );
        };
        const listeners = [ names.message, names.reaction, names.read ].map( ( name ) => [ name, on( name ) ] as const );
        for ( const [ name, fn ] of listeners ) live.on( name, fn );

        // At every join, a reconnect's too: the app's newest page, and beside it the room's recent history, which holds
        // what the app's server hasn't saved yet and the reactions since. Without the app's page, the room's history alone.
        const first = () => {
            setHistory( { loading: true, more: false } );
            const loader = loadRef.current;
            const kept = loader ? loader( null ).catch( () => null ) : Promise.resolve( null );
            const recent = live.history( { limit: 50 } ).catch( () => null );
            void Promise.all( [ kept, recent ] ).then( ( [ page, room ] ) => {
                if ( ! alive ) return;
                if ( ! page ) {
                    if ( room ) setMessages( ( list ) => replay( room.events, list ) );
                    setHistory( { loading: false, more: room?.more ?? false } );
                    return;
                }
                setMessages( ( list ) => {
                    let base = page.messages.map( fromStored );
                    // A message older than the app's page is on one of its older pages, and comes with it.
                    const oldest = page.more ? base[ 0 ]?.at : undefined;
                    for ( const e of room?.events ?? [] ) {
                        if ( e.event === names.message && oldest !== undefined && ( e.at ?? 0 ) < oldest ) continue;
                        base = applyEvent( base, e.event, e.data, { from: e.from, id: e.id, at: e.at }, names );
                    }
                    return ordered( [ ...base, ...list ] );
                } );
                setHistory( { loading: false, more: page.more } );
            } );
        };
        if ( live.state === "joined" ) first();
        else live.on( "joined", first );

        return () => {
            alive = false;
            for ( const [ name, fn ] of listeners ) live.off( name, fn );
            live.off( "joined", first );
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ view.room, me ] );

    const older = () => {
        if ( history.loading || ! history.more || ! view.room ) return;
        const oldest = messages.find( ( m ) => m.id );
        if ( ! oldest?.id ) return;
        setHistory( { loading: true, more: true } );
        // The app's page before the oldest message shown, or without the app, the room's.
        const loader = loadRef.current;
        const page = loader
            ? loader( { id: oldest.id, at: oldest.at } ).then( ( p ) => ( { add: ( list: ChatMessage[] ) => ordered( [ ...p.messages.map( fromStored ), ...list ] ), more: p.more } ) )
            : view.room.history( { before: oldest.id, limit: 50 } ).then( ( p ) => ( { add: ( list: ChatMessage[] ) => replay( p.events, list ), more: p.more } ) );
        page.then( ( { add, more } ) => {
            setMessages( add );
            setHistory( { loading: false, more } );
        }, () => setHistory( { loading: false, more: false } ) );
    };

    const markRead = () => {
        const newest = [ ...messages ].reverse().find( ( m ) => m.id && m.from !== me );
        if ( ! newest?.id || ! view.room || readSent.current === newest.id ) return;
        readSent.current = newest.id;
        view.room.volatile.emit( names.read, { id: newest.id } );
    };

    // A message of the user's ticks seen once the other side read it, or anything after it.
    const statusOf = ( m: ChatMessage ): DeliveryState | undefined => {
        if ( m.status === "sending" || m.status === "failed" ) return m.status;
        if ( ! m.id ) return "sending";
        const index = messages.findIndex( ( x ) => x.key === m.key );
        const seenAt = seenUpTo ? messages.findIndex( ( x ) => x.id === seenUpTo ) : -1;
        return seenAt >= index ? "seen" : "sent";
    };

    const send = async ( value: string ) => {
        const words = value.trim();
        if ( ! words || ! view.room || ( maxLength > 0 && words.length > maxLength ) ) return;
        const key = `local-${ Date.now() }-${ Math.random().toString( 36 ).slice( 2 ) }`;
        setMessages( ( list ) => [ ...list, { key, id: null, from: me ?? "", text: words, at: Date.now(), status: "sending", reactions: {} } ] );
        stopTyping();
        let sent: { id: string; at: number };
        try {
            sent = await view.room.emitWithAck( names.message, { text: words } );
        } catch {
            setMessages( ( list ) => list.map( ( m ) => ( m.key === key ? { ...m, status: "failed" } : m ) ) );
            return;
        }
        const { id, at } = sent;
        setMessages( ( list ) => list.some( ( m ) => m.id === id )
            ? list.filter( ( m ) => m.key !== key )
            : list.map( ( m ) => ( m.key === key ? { ...m, id, at, status: undefined } : m ) ) );
        // Sent: the page hears it, and what it does is its own, never the message's failure.
        try {
            sentTo.current?.( { id, room, text: words, at } );
        } catch ( error ) {
            console.error( error );
        }
    };

    const typing = () => {
        if ( ! view.room || Date.now() - typingSent.current <= 2000 ) return;
        typingSent.current = Date.now();
        view.room.volatile.emit( names.typing, { on: true } );
    };

    function stopTyping() {
        typingSent.current = 0;
        view.room?.volatile.emit( names.typing, { on: false } );
    }

    const react = async ( m: ChatMessage, key: string ) => {
        if ( ! m.id || ! view.room || ! me ) return;
        const mine = Object.entries( m.reactions ).find( ( [ , users ] ) => users.includes( me ) )?.[ 0 ];
        const next = mine === key ? "" : key;
        try {
            await view.room.emitWithAck( names.reaction, { id: m.id, key: next } );
            setMessages( ( list ) => applyEvent( list, names.reaction, { id: m.id, key: next }, { from: me }, names ) );
        } catch {
            // A room without reactions: nothing changes.
        }
    };

    return { me, state: view.state, error: view.error ?? null, messages, history, writers, person, statusOf, send, typing, stopTyping, react, older, markRead };
}
