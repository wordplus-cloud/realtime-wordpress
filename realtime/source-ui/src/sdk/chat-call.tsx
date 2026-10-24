import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { callName } from "./call-name.ts";
import type { CallsView } from "./controller.ts";
import { usePageCalls } from "./use-controller.ts";
import { personOf, useOnline, useProfiles, type SdkRooms } from "./rooms.ts";
import type { ChatPerson } from "./use-chat.ts";

// A chat's own call (Chat's `call`), shown in the chat while it is on, as a Better Messages conversation holds its call:
// beside the messages where the chat is wide, over them where it is narrow, the call's controls showing and hiding
// them. The CallScreen on the page rings for it and runs it, and the chat is the place it shows, a spot of the page's
// calls (controller.spot()) that names the call itself, so it wins over the page's other spots for it.

/** Narrower than this, the call takes the whole chat as it comes in, and Show Chat puts the messages under it. */
const NARROW = 600;

const noCalls = () => () => {};
const noView = (): CallsView | null => null;

export interface ChatCall {
    /** The call's name, or null for a chat without one. */
    name: string | null;
    /** Calls the other person (`to`), once the page's calls are ready: none for a chat without its call. */
    place?: ( type: "audio" | "video", peer: { name: string; avatar?: string } ) => void;
    /** Where the call shows in the chat. */
    spot: RefObject<HTMLDivElement | null>;
    /** The chat's body, measured for its width as a call comes in. */
    body: RefObject<HTMLDivElement | null>;
    /** Whether the call is in the chat now. */
    here: boolean;
    /** Whether the chat is too narrow for the call beside the messages: it goes over them. */
    narrow: boolean;
    /** Whether the messages show beside the call, while it is here. */
    chatShown: boolean;
    /** Whether a call is on the screen, in the chat or anywhere else. */
    busy: boolean;
}

/** The chat's call, from Chat's `call`: true names it as the room, a template takes `{pair}` with `to`. */
export function useChatCall( rt: SdkRooms | null | undefined, room: string, call: boolean | string | undefined, to: string | null ): ChatCall {
    const me = rt?.user ?? null;
    const name = call === true ? room : typeof call === "string" && call !== "" ? callName( call, me, to ?? "" ) : null;
    const controller = usePageCalls( name === null ? null : rt );
    const spot = useRef<HTMLDivElement | null>( null );
    const body = useRef<HTMLDivElement | null>( null );

    useLayoutEffect( () => {
        if ( ! controller || name === null || ! spot.current ) return;
        return controller.spot( name, spot.current, { chat: true } );
    }, [ controller, name ] );

    const view = useSyncExternalStore( controller?.subscribe ?? noCalls, controller?.snapshot ?? noView, noView );
    const here = view !== null && view.spot !== null && view.spot === spot.current;

    // How wide the chat is, as it changes: the call beside the messages, or over them.
    const [ narrow, setNarrow ] = useState( false );
    useLayoutEffect( () => {
        const element = body.current;
        if ( name === null || ! element ) return;
        const measure = () => setNarrow( element.clientWidth < NARROW );
        measure();
        if ( typeof ResizeObserver === "undefined" ) return;
        const watch = new ResizeObserver( measure );
        watch.observe( element );
        return () => watch.disconnect();
    }, [ name ] );

    // Too narrow for the call beside the messages: it takes the chat as it comes in, as in Better Messages on a phone.
    useLayoutEffect( () => {
        if ( here && controller && ( body.current?.clientWidth ?? NARROW ) < NARROW ) controller.showChat( false );
    }, [ here, controller ] );

    const place = name === null || ! controller || to === null
        ? undefined
        : ( type: "audio" | "video", peer: { name: string; avatar?: string } ) => void controller.place( name, to, type, peer );

    return { name, place, spot, body, here, narrow, chatShown: ! here || view?.chat !== false, busy: !! view?.showing };
}

/** The other person of a chat between two, as its top bar shows them. */
export interface ChatPeer {
    id: string;
    user_id: string;
    name: string;
    avatar?: string;
    online: boolean;
}

/**
 * The other person of a chat between two, for its top bar: their name and picture, and whether they are online. What
 * the page gives first, then what the chat knows of them, then the directory, which has a person for a day after they
 * were last online.
 */
export function useChatPeer( rt: SdkRooms | null | undefined, to: string | null, known: ( id: string ) => ChatPerson, given: { name?: string; avatar?: string } = {} ): ChatPeer | null {
    const profiles = useProfiles( rt, to === null || given.name ? [] : [ to ] );
    const online = useOnline( rt, to === null ? [] : [ to ] );
    if ( to === null ) return null;
    const seen = known( to );
    const fetched = personOf( to, {}, profiles );
    return {
        id: to, user_id: to,
        name: given.name || seen.name || fetched.name,
        avatar: given.avatar || seen.avatar || fetched.avatar,
        online: !! online[ to ],
    };
}

/** How long a call started as the chat opens waits for the other person's name, for its window, before it goes without. */
const NAME_WAIT = 1500;

/**
 * Calls the other person once, as the chat opens (Chat's `startCall`): for a page that a call button elsewhere opens,
 * such as a list's Video, which links to the chat rather than calling where it is. Once the page's calls are ready and
 * the other person's name is known, or a moment after without it. Once a chat: a page that keeps it open while its
 * address changes calls no more.
 */
export function useStartCall( call: ChatCall, type: "audio" | "video" | undefined, peer: ChatPeer | null ): void {
    const started = useRef( false );
    // What the call takes as it goes: these as the latest render has them.
    const latest = useRef( { call, peer } );
    latest.current = { call, peer };
    const ready = !! type && !! call.place && peer !== null;
    const named = !! peer?.name;

    useEffect( () => {
        if ( started.current || ! ready ) return;
        const go = () => {
            const { call: now, peer: them } = latest.current;
            if ( started.current || ! now.place || ! them ) return;
            started.current = true;
            now.place( type!, { name: them.name, avatar: them.avatar } );
        };
        if ( named ) return go();
        const timer = setTimeout( go, NAME_WAIT );
        return () => clearTimeout( timer );
    }, [ ready, named, type ] );
}
