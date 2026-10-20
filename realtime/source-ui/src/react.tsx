// @wordplus/realtime-ui/react: Better Messages' screens for a React app on @wordplus/realtime, each taking the `rt`
// it shows (`useRealtime()`, or connect()'s Realtime). Optional, as the whole package is: an app that draws its own
// screens imports none of it.
//
//     import '@wordplus/realtime-ui/calls.css';
//     import '@wordplus/realtime-ui/presence.css';
//     import '@wordplus/realtime-ui/chat.css';
//     import { CallScreen, CallButton, OnlineList, Typing, Chat } from '@wordplus/realtime-ui/react';
//
//     <CallScreen rt={ rt } lang="de" />                      // the rings and the call window, once on the page
//     <OnlineList rt={ rt } room="shop" actions={ ( m ) => <CallButton rt={ rt } to={ m.id } call={ … } name={ m.name } /> } />
//     <Typing rt={ rt } room="chat:34:42" />
//     <Chat rt={ rt } room="chat:34:42" />                     // the conversation, its history, typing and reactions
import React, { useEffect, useState, type ReactNode } from "react";
import { configureUi, setUiUsers } from "./host.ts";
import { translator, direction } from "./inc/translations.ts";
import { setOwnTooltips } from "./inc/shared-parts.ts";
import { ownTooltips } from "./inc/floater.ts";
import { _x } from "./inc/globals.ts";
import { controllerFor, type CallsController } from "./sdk/controller.ts";
import CallsApp, { type CallView } from "./sdk/calls-app.tsx";
import { callUserOf, type SdkCalls } from "./sdk/types.ts";
import type { SdkRooms } from "./sdk/rooms.ts";
import { callName } from "./sdk/call-name.ts";
import { MayCall } from "./sdk/may-call.tsx";
import { RoomOnline, type RoomOnlineProps, type RoomPerson } from "./sdk/presence-views.tsx";
import { RowAction } from "./components/presence/online-list.tsx";
import { PiecesProvider, type Pieces } from "./pieces.tsx";

export { PiecesProvider, usePieces } from "./pieces.tsx";
export type {
    Pieces, Drawn, RingCardProps, CallStatusProps, VideoTileProps, SelfViewProps, GridTileProps, OnlineRowProps, MessageProps,
    ComposerProps, ChatMessageView,
} from "./pieces.tsx";
export { default as CallControl } from "./components/calls/call-control.tsx";
export type { CallControlProps } from "./components/calls/call-control.tsx";
export type { CallView } from "./sdk/calls-app.tsx";

export { RoomTyping as Typing, RoomCount as OnlineCount } from "./sdk/presence-views.tsx";
export type { RoomTypingProps as TypingProps, RoomCountProps as OnlineCountProps, RoomPerson } from "./sdk/presence-views.tsx";
export { Chat, DEFAULT_REACTIONS } from "./sdk/chat.tsx";
export { routeLoader } from "./sdk/route-loader.ts";
export type { ChatProps, ChatLoader, ChatPage, StoredMessage, SentMessage } from "./sdk/chat.tsx";
// The engines under the views, which an app's own copy of a view runs on (`npx @wordplus/realtime-ui add`).
export { useChat, grouped as groupedByDay } from "./sdk/use-chat.ts";
export type { UseChatOptions, ChatState, ChatMessage, ChatPerson, ChatEvents } from "./sdk/use-chat.ts";
export { useRoom, useOnline, useProfiles, useTyping, personOf } from "./sdk/rooms.ts";
export type { SdkRooms, SdkRoom, RoomMember, RoomView, SdkEventMeta, SdkHistoryEvent, SdkProfile } from "./sdk/rooms.ts";
export { configureUi } from "./host.ts";

/** What the call screen asks of the page's `rt`: its calls (`rt.calls()`). */
export interface CallsSource {
    calls(): Promise<SdkCalls>;
}

const pending = new WeakMap<CallsSource, Promise<CallsController>>();

/** The page's calls controller, once its calls are loaded. */
function useController( rt: CallsSource | null | undefined, add?: boolean ): CallsController | null {
    const [ controller, setController ] = useState<CallsController | null>( null );

    useEffect( () => {
        if ( ! rt ) return;
        let live = true;
        let made = pending.get( rt );
        if ( ! made ) pending.set( rt, ( made = rt.calls().then( ( calls ) => controllerFor( calls, { add } ) ) ) );
        made.then( ( c ) => {
            if ( add !== undefined ) c.setAdd( add );
            if ( live ) setController( c );
        }, () => {} );
        return () => {
            live = false;
        };
    }, [ rt, add ] );

    return controller;
}

export interface CallScreenProps {
    rt: CallsSource | null | undefined;
    /** The page's language, two letters: the screens' own translations (de es fr it nl pl hr he). The page's by default. */
    lang?: string;
    /** The app's own translations, by the English text, over the package's. */
    strings?: Record<string, string | string[]>;
    /** Offer Add Person, where the app lists whom a user may add (the server's `calls()` with `people`). */
    add?: boolean;
    /** The app's own pieces in place of ours: the ring card, a tile, the controls … (pieces.tsx). */
    components?: Pieces;
    /**
     * The app's own call view in place of ours, its copy of it (`npx @wordplus/realtime-ui add call-screen`), drawn on
     * the same calls: `view={ CallView }`.
     */
    view?: CallView;
}

/** The rings and the call window, Better Messages' call screens, on the page's calls. Once on the page, in its layout. */
export function CallScreen( { rt, lang, strings, add, components, view }: CallScreenProps ) {
    const controller = useController( rt, add );
    const language = lang ?? ( typeof document !== "undefined" ? document.documentElement.lang || "en" : "en" );

    // Before the first screen draws, and again when the language changes. The controls' tooltips from the WordPlus
    // SDK's floater where the page has it, else the package's own.
    useState( () => {
        configureUi( translator( language, strings ) );
        setOwnTooltips( ownTooltips() );
    } );
    useEffect( () => configureUi( translator( language, strings ) ), [ language, strings ] );

    if ( ! controller ) return null;
    // Its rings and window are fixed over the page, so it takes no place in the app's layout, a grid's cell included
    // (an SDK review, 2026-10-15), while its look still reaches them through the wrapper.
    return <div className="realtime-calls" dir={ direction( language ) } style={ { display: "contents" } }>
        <PiecesProvider pieces={ components }><CallsApp controller={ controller } view={ view } /></PiecesProvider>
    </div>;
}

/** The look a call button has unless the app gives its own: as the elements' buttons, which an app's CSS reset leaves. */
const BUTTON_CLASS = "realtime-call-button";

export interface CallButtonProps {
    rt: ( CallsSource & { user?: string | null } ) | null | undefined;
    /** Whom to call: their id, a number or the app's own id of text. */
    to: number | string;
    /**
     * The call's name, as the app's server's calls() rule allows it (`support:34:42`), or a template as
     * `<call-button>` takes it: `{pair}` the page's user and `to` in order, `{me}`, `{id}`.
     */
    call: string;
    type?: "audio" | "video";
    /** The other person's name and picture, for the call window. */
    name?: string;
    avatar?: string;
    className?: string;
    children?: ReactNode;
}

/** A button that calls `to` about `call`, on the CallScreen's window. `className` adds to its own look. */
export function CallButton( { rt, to, call, type = "video", name = "", avatar, className, children }: CallButtonProps ) {
    const controller = useController( rt );
    return (
        <button type="button" className={ className ? BUTTON_CLASS + " " + className : BUTTON_CLASS } disabled={ ! controller }
                onClick={ () => void controller?.place( callName( call, rt?.user ?? null, String( to ) ), to, type, { name, avatar } ) }>
            { children }
        </button>
    );
}

export interface GroupCallButtonProps {
    rt: CallsSource | null | undefined;
    /** The group call's name, as the app's server's groupCalls() rule allows it (`meeting:daily`). */
    room: string;
    type?: "audio" | "video";
    title?: string;
    className?: string;
    children?: ReactNode;
}

/** A button that joins the group call `room`, on the CallScreen's window. `className` adds to its own look. */
export function GroupCallButton( { rt, room, type = "video", title, className, children }: GroupCallButtonProps ) {
    const controller = useController( rt );
    return (
        <button type="button" className={ className ? BUTTON_CLASS + " " + className : BUTTON_CLASS } disabled={ ! controller }
                onClick={ () => void controller?.join( room, type, title ?? room ) }>
            { children }
        </button>
    );
}

export interface OnlineListProps extends Omit<RoomOnlineProps, "rt"> {
    rt: ( SdkRooms & Partial<CallsSource> ) | null | undefined;
    /**
     * A call button for each of the others, as `<online-list call>` has them: the call's name, `{pair}` filled in
     * with the page's user and the other, in order (`support:{pair}`). `actions`, when given, is drawn instead.
     */
    call?: string;
    /** Which call buttons: `video` (the default), `audio`, or `audio video`. */
    type?: "audio" | "video" | "audio video";
}

/** Who is in a presence room now, each with their picture, their name, their role, and the call buttons `call` asks for. */
export function OnlineList( { call, type = "video", actions, ...props }: OnlineListProps ) {
    const rt = props.rt;
    const controller = useController( call && rt?.calls ? ( rt as CallsSource ) : null );
    const types = type.split( /\s+/ ).filter( ( t ): t is "audio" | "video" => t === "audio" || t === "video" );
    // Each row's buttons once the app's rules let the page's user call that member (MayCall, may-call.tsx).
    const calls = call && controller && rt
        ? ( member: RoomPerson ) => {
            const to = callUserOf( member.id );
            if ( to === null ) return null;
            const name = callName( call, rt.user, member.id );
            return <MayCall calls={ controller.calls } call={ name } to={ to }>{ types.map( ( kind ) => (
                <RowAction key={ kind }
                           icon={ kind === "audio" ? "phone" : "video" }
                           label={ kind === "audio" ? _x( "Audio Call", "Users List", "bp-better-messages" ) : _x( "Video Call", "Users List", "bp-better-messages" ) }
                           onClick={ () => {
                               const peer = { name: member.name, avatar: member.avatar };
                               setUiUsers( [ [ member.id, peer ] ] );
                               void controller.place( name, to, kind, peer );
                           } } />
            ) ) }</MayCall>;
        }
        : undefined;
    // On its own, filling the place the app gives it, as <online-list> does (presence.css, .realtime-online).
    return <div className="realtime-online"><RoomOnline { ...props } rt={ rt } actions={ actions ?? calls } /></div>;
}

/** A room client and its calls, as @wordplus/realtime's Realtime is both. */
export type Realtime = SdkRooms & CallsSource;
