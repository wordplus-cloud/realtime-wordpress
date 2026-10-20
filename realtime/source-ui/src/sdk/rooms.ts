import { useEffect, useMemo, useRef, useState } from "react";

// What the screens read of @wordplus/realtime's rooms (its realtime-client's Rooms and Room), by shape, as types.ts
// reads its calls: an app's `Realtime` (`connect()`), and the room client a WordPress page shares
// (`window.wordplusRealtimeCalls.page().rt`), both fit.

type Listener = ( ...args: any[] ) => void;

export interface SdkEventMeta {
    from?: string;
    id?: string;
    at?: number;
    replayed?: boolean;
}

export interface SdkHistoryEvent {
    event: string;
    data: unknown;
    id?: string;
    at?: number;
    from?: string;
}

export interface SdkRoom {
    readonly name: string;
    state: 'joining' | 'joined' | 'failed' | 'left';
    error: string | null;
    readonly members: Map<string, unknown>;
    count: number | null;
    on( event: string, fn: Listener ): unknown;
    off( event?: string, fn?: Listener ): unknown;
    emit( event: string, data?: unknown ): void;
    emitWithAck( event: string, data?: unknown ): Promise<{ id: string; at: number }>;
    readonly volatile: { emit( event: string, data?: unknown ): void };
    history( ask?: { before?: string; after?: string; limit?: number } ): Promise<{ events: SdkHistoryEvent[]; more: boolean }>;
}

export interface SdkOnline {
    watch( ids: Array<number | string> ): unknown;
    unwatch( ids: Array<number | string> ): unknown;
    has( id: number | string ): boolean;
    lastSeen( id: number | string ): number | null;
    readonly count: number | null;
    on( event: 'change' | 'count', fn: Listener ): unknown;
    off( event?: 'change' | 'count', fn?: Listener ): unknown;
}

export interface SdkProfile {
    user_id: number | string;
    name?: string | null;
    avatar?: string | null;
    [ field: string ]: unknown;
}

export interface SdkRooms {
    readonly tab: string;
    /** Who the page's user is, once known: their id. */
    readonly user: string | null;
    readonly online: SdkOnline;
    join( name: string ): SdkRoom;
    leave( name: string ): void;
    room?( name: string ): SdkRoom | undefined;
    users( ids: Array<number | string> ): Promise<Record<string, SdkProfile>>;
}

// A room a screen joined, counted per page, so a room two screens show is left only when both are gone, and a room the
// app had joined itself is never left by a screen.
const holds = new WeakMap<SdkRooms, Map<string, { count: number; ours: boolean }>>();

function hold( rt: SdkRooms, name: string ): SdkRoom {
    let held = holds.get( rt );
    if ( ! held ) holds.set( rt, ( held = new Map() ) );
    const entry = held.get( name );
    if ( entry ) entry.count++;
    else held.set( name, { count: 1, ours: ! rt.room?.( name ) } );
    return rt.join( name );
}

function release( rt: SdkRooms, name: string ): void {
    const held = holds.get( rt );
    const entry = held?.get( name );
    if ( ! held || ! entry ) return;
    if ( --entry.count > 0 ) return;
    held.delete( name );
    if ( entry.ours ) rt.leave( name );
}

export interface RoomMember {
    id: string;
    info: Record<string, unknown>;
}

export interface RoomView {
    room: SdkRoom | null;
    state: SdkRoom[ 'state' ] | 'idle';
    error: string | null;
    members: RoomMember[];
    count: number | null;
}

/** A room while the component shows it: its state, its members (a presence room's) and its count, kept current. */
export function useRoom( rt: SdkRooms | null | undefined, name: string | null | undefined ): RoomView {
    const [ view, setView ] = useState<RoomView>( { room: null, state: 'idle', error: null, members: [], count: null } );

    useEffect( () => {
        if ( ! rt || ! name ) {
            setView( { room: null, state: 'idle', error: null, members: [], count: null } );
            return;
        }
        const room = hold( rt, name );
        const update = () => setView( {
            room,
            state: room.state,
            error: room.error,
            members: [ ...room.members ].map( ( [ id, info ] ) => ( { id, info: info && typeof info === 'object' ? info as Record<string, unknown> : {} } ) ),
            count: room.count,
        } );
        const events = [ 'joined', 'join', 'leave', 'count', 'error', 'kicked' ];
        for ( const event of events ) room.on( event, update );
        update();

        return () => {
            for ( const event of events ) room.off( event, update );
            release( rt, name );
        };
    }, [ rt, name ] );

    return view;
}

/** Whether each of `ids` is online now, kept current. */
export function useOnline( rt: SdkRooms | null | undefined, ids: Array<number | string> ): Record<string, boolean> {
    const key = [ ...new Set( ids.map( String ) ) ].sort().join( '|' );
    const [ online, setOnline ] = useState<Record<string, boolean>>( {} );

    useEffect( () => {
        if ( ! rt || key === '' ) return;
        const watched = key.split( '|' );
        const update = () => setOnline( Object.fromEntries( watched.map( ( id ) => [ id, rt.online.has( id ) ] ) ) );
        rt.online.watch( watched );
        rt.online.on( 'change', update );
        update();
        return () => {
            rt.online.off( 'change', update );
        };
    }, [ rt, key ] );

    return online;
}

/** Names and pictures from the app's directory (rt.users()), for the ids given, as they arrive. */
export function useProfiles( rt: SdkRooms | null | undefined, ids: Array<number | string> ): Record<string, SdkProfile> {
    const key = [ ...new Set( ids.map( String ) ) ].sort().join( '|' );
    const [ profiles, setProfiles ] = useState<Record<string, SdkProfile>>( {} );

    useEffect( () => {
        if ( ! rt || key === '' ) return;
        let live = true;
        rt.users( key.split( '|' ) ).then( ( found ) => live && setProfiles( ( known ) => ( { ...known, ...found } ) ), () => {} );
        return () => {
            live = false;
        };
    }, [ rt, key ] );

    return profiles;
}

/**
 * Who is typing in a room now: the senders of its `event` (`{ on: true }` while typing, `{ on: false }` when they stop,
 * sent volatile), each gone `ttl` ms after their last word unless they say more. The page's own user is left out.
 */
export function useTyping( rt: SdkRooms | null | undefined, room: SdkRoom | null, event = 'typing', ttl = 4000 ): string[] {
    const [ writers, setWriters ] = useState<string[]>( [] );
    const timers = useRef( new Map<string, ReturnType<typeof setTimeout>>() );

    useEffect( () => {
        if ( ! room ) return;
        const all = timers.current;
        const drop = ( id: string ) => {
            clearTimeout( all.get( id ) );
            all.delete( id );
            setWriters( ( list ) => list.filter( ( w ) => w !== id ) );
        };
        const heard = ( data: unknown, meta: SdkEventMeta = {} ) => {
            const id = meta.from;
            if ( ! id || id === rt?.user ) return;
            if ( ! ( data as { on?: boolean } | null )?.on ) return drop( id );
            clearTimeout( all.get( id ) );
            all.set( id, setTimeout( () => drop( id ), ttl ) );
            setWriters( ( list ) => ( list.includes( id ) ? list : [ ...list, id ] ) );
        };
        // A message from someone ends their typing.
        const spoke = ( _data: unknown, meta: SdkEventMeta = {} ) => meta.from && drop( meta.from );
        room.on( event, heard );
        room.on( 'message', spoke );
        return () => {
            room.off( event, heard );
            room.off( 'message', spoke );
            for ( const timer of all.values() ) clearTimeout( timer );
            all.clear();
            setWriters( [] );
        };
    }, [ rt, room, event, ttl ] );

    return writers;
}

/** A member's name and picture: the room's info first, then the directory's. */
export function personOf( id: string, info: Record<string, unknown>, profiles: Record<string, SdkProfile> ) {
    const profile = profiles[ id ];
    const text = ( value: unknown ) => ( typeof value === 'string' && value !== '' ? value : undefined );
    return {
        user_id: id,
        name: text( info.name ) ?? text( profile?.name ) ?? '',
        avatar: text( info.avatar ) ?? text( profile?.avatar ),
    };
}

/** Ids as the memo key a list of them makes. */
export function useIds( ids: Array<number | string> ): string[] {
    const key = ids.map( String ).join( '|' );
    return useMemo( () => ( key === '' ? [] : key.split( '|' ) ), [ key ] );
}
