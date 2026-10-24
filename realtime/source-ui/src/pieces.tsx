// The screens' named pieces: an app replaces one piece of a screen with its own
// and keeps the rest, which still updates with the package. Each piece gets the props ours gets, and ours as it would
// draw it (`children`), so an app's piece may wrap ours, change around it, or leave it out.
//
//     <CallScreen rt={ rt } components={ {
//         RingCard: ( { name, onAnswer, onReject } ) => <MyRing name={ name } answer={ onAnswer } reject={ onReject } />,
//         VideoTile: ( { children } ) => <div className="my-frame">{ children }</div>,
//         controls: ( buttons ) => [ ...buttons.slice( 0, -1 ), <CallControl key="raise" icon="hand" label="Raise hand" onClick={ raise } />, buttons.at( -1 ) ],
//     } } />
//
// Pieces with no part of theirs drawn by ours (Avatar, Name) take the props alone. The controls are a list: `controls`
// gets ours, in the dock's order, with the call, and answers the buttons to show; hanging up stays at the end whatever
// it answers, and whatever doesn't fit folds into More. The elements name the same pieces for `::part()` and fill
// some from `<template slot>` (elements.tsx, templates.tsx).
import React, { createContext, useContext, type ComponentType, type ReactElement, type ReactNode } from "react";
import type { UserAvatarProps, UserNameProps } from "./host.ts";
import type { CallAction, CallContextInterface, CallParticipant, CallTrack } from "./components/calls/context.ts";
import type { ChatMessage } from "./sdk/use-chat.ts";

/** Ours, as the screen would draw it: an app's piece may wrap it, or draw something else. */
export interface Drawn {
    children?: ReactNode;
}

/** A call ringing for the user, as the ring shows it. */
export interface RingCardProps {
    user_id: number | string;
    /** The caller's name, as the call carries it. */
    name?: string;
    type: "audio" | "video";
    onAnswer: () => void;
    onReject: () => void;
}

/** What a call says of itself: ringing out or in, connecting, the time it has run, or what went wrong. */
export interface CallStatusProps {
    layout: "private" | "group-video" | "group-audio";
    action: CallAction | null;
    /** What the call says now ("Connecting...", a reconnect), empty while nothing. */
    text: string;
    /** How long the call has been on, in milliseconds. */
    duration: number;
}

/** The other side of a call between two: their camera or screen, or their picture while there is none. */
export interface VideoTileProps {
    /** Null until they are in the call. */
    participant: CallParticipant | null;
    action: CallAction | null;
}

/** The user's own camera, in its corner. */
export interface SelfViewProps {
    track: CallTrack;
}

/** One person in a group call's grid. */
export interface GridTileProps {
    participant: CallParticipant;
    layout: "group-video" | "group-audio";
}

/** Someone in a presence room, as the online list's row shows them. */
export interface OnlineRowProps {
    member: { id: string; name: string; avatar?: string; info: Record<string, unknown> };
    /** Whether it is the page's own user. */
    mine: boolean;
    /** What the list offers to do with them (call buttons), already drawn. */
    actions: ReactNode;
}

/** A message in the chat, as it holds it (use-chat.ts). */
export type ChatMessageView = ChatMessage;

export interface MessageProps {
    message: ChatMessageView;
    /** Whether the page's own user sent it. */
    mine: boolean;
    sender: { id: string; name: string; avatar?: string };
    /** Reacts to it with a reaction's key, where the chat offers reactions on it. */
    react?: ( key: string ) => void;
}

/** Where the user writes. */
export interface ComposerProps {
    /** Sends a message: the chat shows it at once, and again as sent. */
    send: ( text: string ) => Promise<void>;
    /** Says the user is typing, as the composer says it while one types: at most every few seconds. */
    typing: () => void;
    disabled: boolean;
    placeholder: string;
    /** 0 for none. */
    maxLength: number;
}

/** The top bar of a chat between two (Chat's `to`): the other person, and their calls where the chat has its `call`. */
export interface ChatHeaderProps {
    person: { id: string; name: string; avatar?: string };
    online: boolean;
    /** Calls them, the call showing in the chat: none where the chat has no `call`. */
    call?: ( type: "audio" | "video" ) => void;
    /** Whether a call is on the screen now, where a call button does nothing. */
    calling: boolean;
}

export interface Pieces {
    RingCard?: ComponentType<RingCardProps & Drawn>;
    CallStatus?: ComponentType<CallStatusProps & Drawn>;
    VideoTile?: ComponentType<VideoTileProps & Drawn>;
    SelfView?: ComponentType<SelfViewProps & Drawn>;
    GridTile?: ComponentType<GridTileProps & Drawn>;
    OnlineRow?: ComponentType<OnlineRowProps & Drawn>;
    Message?: ComponentType<MessageProps & Drawn>;
    Composer?: ComponentType<ComposerProps & Drawn>;
    EmptyConversation?: ComponentType<Drawn>;
    ChatHeader?: ComponentType<ChatHeaderProps & Drawn>;
    /** A user's picture on the call screens, over configureUi()'s. */
    Avatar?: ComponentType<UserAvatarProps>;
    /** A user's name on the call screens, over configureUi()'s. */
    Name?: ComponentType<UserNameProps>;
    /** The call's buttons: ours, in the dock's order, and the call; the buttons to show (`CallControl` for one's own). */
    controls?: ( buttons: ReactElement[], call: CallContextInterface ) => ReactNode;
}

/** The pieces that draw something of ours, which `Piece` places. */
type Drawing = {
    [ K in keyof Pieces ]-?: NonNullable<Pieces[ K ]> extends ComponentType<infer P> ? ( P extends Drawn ? ( "children" extends keyof P ? K : never ) : never ) : never
}[ keyof Pieces ];

const PiecesContext = createContext<Pieces>( {} );

/** The pieces for what is drawn inside: these over any given further out. */
export function PiecesProvider( { pieces, children }: { pieces: Pieces | undefined; children: ReactNode } ) {
    const outer = useContext( PiecesContext );
    if ( ! pieces ) return <>{ children }</>;
    return <PiecesContext.Provider value={ { ...outer, ...pieces } }>{ children }</PiecesContext.Provider>;
}

/** The pieces in force here. */
export function usePieces(): Pieces {
    return useContext( PiecesContext );
}

/**
 * A named piece: the app's, given ours as its children, or ours. `always` is what the screen needs whatever the piece
 * draws, such as the other side's sound, which ours carries inside it: drawn after the app's piece in its place.
 */
export function Piece<K extends Drawing>( { name, props, always, children }: {
    name: K;
    props: Omit<React.ComponentProps<NonNullable<Pieces[ K ]>>, "children">;
    always?: ReactNode;
    children?: ReactNode;
} ) {
    const Own = useContext( PiecesContext )[ name ] as ComponentType<Record<string, unknown>> | undefined;
    if ( ! Own ) return <>{ children }</>;
    return <><Own { ...( props as Record<string, unknown> ) }>{ children }</Own>{ always }</>;
}
