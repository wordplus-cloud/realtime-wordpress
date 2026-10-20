import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { ActivityIndicator, Avatar } from "../components/presence/presence.tsx";
import { DaySeparator, EmptyThread, MessageBody, MessageMeta, MessageStack, MessageText, MetaPieces, StatusTick, TypingPinned } from "../components/chat/message-parts.tsx";
import { ComposerRow } from "../components/chat/composer-row.tsx";
import { ReactionPicker, ReactionPill, ReactionPills, decodeReaction } from "../components/chat/reactions.tsx";
import Btn from "../inc/helpers/btn.tsx";
import Icon from "../primitives/icon.tsx";
import { host } from "../host.ts";
import { __, _x } from "../inc/globals.ts";
import { plainName } from "../inc/names.ts";
import type { SdkRooms } from "./rooms.ts";
import { grouped, useChat, type ChatEvents, type ChatLoader, type SentMessage } from "./use-chat.ts";
import { routeLoader } from "./route-loader.ts";
import { Piece, PiecesProvider, type Pieces } from "../pieces.tsx";

export type { StoredMessage, ChatPage, ChatLoader, SentMessage } from "./use-chat.ts";

// Better Messages' conversation on one of an app's rooms, drawn from useChat (use-chat.ts), which runs it: its message
// list (days, a sender's stacks, bubbles with their time and ticks, reactions), who is typing, the older messages paged
// back as the reader scrolls up, and its composer. Text only in the first version; attachments come with storage.

export interface ChatProps {
    rt: SdkRooms | null | undefined;
    /** A room of the app's whose rule lets its members emit `message` (and `typing`, `reaction`, `read`). */
    room: string;
    /** The events' names, where the app's are others. */
    events?: ChatEvents;
    /** The reactions to pick from, as emoji or 2.0's hex keys; none for a conversation without them. */
    reactions?: string[];
    /** The longest message, in characters: none by default. */
    maxLength?: number;
    /** What the empty composer says. */
    placeholder?: string;
    /** The language the times and days are written in: the page's by default. */
    locale?: string;
    /**
     * The conversation the app's server keeps: the newest page for `null`, else the page before the message given, the
     * oldest the chat shows. Each message carries the id of the room event that brought it (its webhook's `event_id`).
     */
    load?: ChatLoader;
    /**
     * The app's route for the messages it kept, asked with the page's cookies, `?before=<id>` for the page before a
     * message, as `<chat-room messages>` asks it: `load` when the app asks another way.
     */
    messages?: string;
    /** Called as the room takes a message of the page user: for the page to tell its own server (useChat's `onSent`). */
    onSent?: ( message: SentMessage ) => void;
    /** The app's own pieces in place of ours: `Message`, `Composer`, `EmptyConversation` (pieces.tsx). */
    components?: Pieces;
}

/** The reactions a conversation offers when the app names none. */
export const DEFAULT_REACTIONS = [ "1f44d", "2764", "1f602", "1f62e", "1f622", "1f64f" ];

export function Chat( { components, messages, load, ...props }: ChatProps ) {
    const fromRoute = useMemo( () => routeLoader( messages ), [ messages ] );
    return <PiecesProvider pieces={ components }><Conversation { ...props } load={ load ?? fromRoute } /></PiecesProvider>;
}

function Conversation( { rt, room, events, reactions = DEFAULT_REACTIONS, maxLength = 0, placeholder, locale, load, onSent }: Omit<ChatProps, "components"> ) {
    const chat = useChat( { rt, room, events, maxLength, load, onSent } );
    const { me, messages, history, writers, person } = chat;
    const lang = locale ?? ( ( typeof document !== "undefined" && document.documentElement.lang ) || undefined );

    const [ text, setText ] = useState( "" );
    const [ scrolledUp, setScrolledUp ] = useState( false );
    const listRef = useRef<HTMLDivElement | null>( null );
    const hostRef = useRef<HTMLDivElement | null>( null );
    const editableRef = useRef<HTMLDivElement | null>( null );
    const joined = chat.state === "joined";
    const removed = chat.state === "failed" && chat.error === "kicked";

    // Paged back as the reader nears the top: the list is column-reverse, so its scrollTop is 0 at the bottom.
    const onScroll = () => {
        const list = listRef.current;
        if ( ! list ) return;
        setScrolledUp( list.scrollTop < -80 );
        if ( list.scrollHeight + list.scrollTop - list.clientHeight <= 120 ) chat.older();
    };

    // The newest message from someone else, once on screen: read, for their ticks.
    useEffect( () => {
        if ( scrolledUp || ( typeof document !== "undefined" && document.visibilityState === "hidden" ) ) return;
        chat.markRead();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ messages, scrolledUp, me, joined ] );

    // A message, from our composer or an app's own (the `Composer` piece), with the newest in view.
    const sendText = async ( value: string ) => {
        listRef.current?.scrollTo( { top: 0 } );
        await chat.send( value );
    };

    // What our composer holds, sent, and the composer emptied.
    const send = async () => {
        const words = text.trim();
        if ( ! words || ! joined || ( maxLength > 0 && words.length > maxLength ) ) return;
        setText( "" );
        if ( editableRef.current ) editableRef.current.textContent = "";
        await sendText( words );
    };

    const onInput = ( e: FormEvent<HTMLDivElement> ) => {
        const value = e.currentTarget.innerText.replace( /\n$/, "" );
        setText( value );
        if ( value.trim() ) chat.typing();
    };
    const onKeyDown = ( e: KeyboardEvent<HTMLDivElement> ) => {
        if ( e.key === "Enter" && ! e.shiftKey && ! e.nativeEvent.isComposing ) {
            e.preventDefault();
            void send();
        }
    };
    // Plain text only: what is pasted goes in as text, never as markup.
    const onPaste = ( e: ClipboardEvent<HTMLDivElement> ) => {
        e.preventDefault();
        document.execCommand( "insertText", false, e.clipboardData.getData( "text/plain" ) );
    };

    const time = useMemo( () => new Intl.DateTimeFormat( lang, { hour: "2-digit", minute: "2-digit" } ), [ lang ] );
    const full = useMemo( () => new Intl.DateTimeFormat( lang, { dateStyle: "medium", timeStyle: "medium" } ), [ lang ] );
    const dayLabel = ( at: number ) => {
        const date = new Date( at );
        const today = new Date();
        const yesterday = new Date( today.getFullYear(), today.getMonth(), today.getDate() - 1 );
        if ( date.toDateString() === today.toDateString() ) return _x( "Today", "Messages stack date (today)", "bp-better-messages" );
        if ( date.toDateString() === yesterday.toDateString() ) return _x( "Yesterday", "Messages stack date (yesterday)", "bp-better-messages" );
        return new Intl.DateTimeFormat( lang, { month: "long", day: "numeric", ...( date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {} ) } ).format( date );
    };

    // The newest message in view when one arrives at the bottom.
    useLayoutEffect( () => {
        const list = listRef.current;
        if ( list && list.scrollTop > -80 ) list.scrollTop = 0;
    }, [ messages.length ] );

    const days = grouped( messages );
    const lead = writers[ 0 ];

    return (
        <div className="realtime-chat">
            <div className="bm-msg-list-wrap">
                <div ref={ listRef } className="bm-msg-list" onScroll={ onScroll } data-typing={ writers.length > 0 ? "list" : undefined }>
                    { [ ...days ].reverse().map( ( day ) => (
                        <div key={ day.day } className="bm-msg-day">
                            <DaySeparator label={ dayLabel( day.at ) } title={ new Intl.DateTimeFormat( lang, { dateStyle: "full" } ).format( new Date( day.at ) ) } />
                            { day.stacks.map( ( stack ) => {
                                const isMe = stack.from === me;
                                const sender = person( stack.from );
                                return (
                                    <MessageStack key={ stack.messages[ 0 ].key } isMe={ isMe } side={ isMe ? "right" : "left" } bubble="filled"
                                                  avatar={ ! isMe && <Avatar user={ sender } size={ 32 } title="" presenceRing="rgba(var(--bm-color-chat-bg), 1)" /> }
                                                  name={ <span className="bm-name">{ plainName( sender.name ) }</span> }>
                                        { stack.messages.map( ( m ) => {
                                            const status = isMe ? chat.statusOf( m ) : undefined;
                                            const pills = Object.entries( m.reactions ).filter( ( [ , users ] ) => users.length > 0 );
                                            const meta = ( variant: "inline" | "row" ) => (
                                                <MessageMeta variant={ variant } pieces={ ( interactive ) => (
                                                    <MetaPieces interactive={ interactive }
                                                                time={ { label: time.format( m.at ), title: full.format( m.at ) } }
                                                                status={ status && <StatusTick status={ status } interactive={ interactive } /> } />
                                                ) } />
                                            );
                                            return (
                                                <Piece key={ m.key } name="Message"
                                                       props={ { message: m, mine: isMe, sender,
                                                                 react: isMe || ! reactions.length ? undefined : ( key: string ) => void chat.react( m, key ) } }>
                                                <MessageBody isMe={ isMe } data-has-text={ 1 } data-message-id={ m.id ?? undefined } part="message"
                                                             data-outbox={ m.status === "failed" || m.status === "sending" ? m.status : undefined }>
                                                    <MessageText after={ pills.length > 0 && (
                                                        <ReactionPills meta={ meta( "row" ) }>
                                                            { pills.map( ( [ key, users ] ) => (
                                                                <ReactionPill key={ key } emoji={ decodeReaction( key ) } count={ users.length } mine={ !! me && users.includes( me ) }
                                                                              onClick={ isMe || ! reactions.length ? undefined : () => void chat.react( m, key ) } />
                                                            ) ) }
                                                        </ReactionPills>
                                                    ) }>
                                                        <span className="bm-chat-text">{ m.text }</span>
                                                        { pills.length === 0 && meta( "inline" ) }
                                                    </MessageText>
                                                    { ! isMe && m.id && reactions.length > 0 && (
                                                        <ReactionPicker keys={ reactions }
                                                                        mine={ me ? Object.entries( m.reactions ).find( ( [ , users ] ) => users.includes( me ) )?.[ 0 ] : undefined }
                                                                        onPick={ ( key ) => void chat.react( m, key ) } />
                                                    ) }
                                                </MessageBody>
                                                </Piece>
                                            );
                                        } ) }
                                    </MessageStack>
                                );
                            } ) }
                        </div>
                    ) ) }
                    { messages.length === 0 && ! history.loading && writers.length === 0 && <Piece name="EmptyConversation" props={ {} }><EmptyThread /></Piece> }
                    { messages.length > 0 && (
                        <div className="bm-history-start"
                             data-visible={ history.loading || ! history.more ? 1 : undefined }
                             data-loading={ history.loading ? 1 : undefined }>
                            { history.loading
                                ? _x( "Loading...", "Label at the start of messages list in conversation while loading", "bp-better-messages" )
                                : ! history.more
                                    ? _x( "Start of conversation", "Label at the start of messages list in conversation", "bp-better-messages" )
                                    : " " }
                        </div>
                    ) }
                </div>

                { lead && (
                    <TypingPinned avatar={ <Avatar user={ person( lead ) } size={ 18 } title="" presenceRing="rgba(var(--bm-color-bg-elevated), 1)" /> }>
                        <ActivityIndicator compact entries={ writers.map( ( id ) => ( { activity: "typing" as const, name: person( id ).name ? host().nameHtml( person( id ).name ) : null } ) ) } />
                    </TypingPinned>
                ) }

                { scrolledUp && (
                    <Btn className="bm-scroll-pill" aria-label={ _x( "Scroll to latest", "Conversation", "bp-better-messages" ) }
                         onClick={ () => listRef.current?.scrollTo( { top: 0, behavior: "smooth" } ) }>
                        <Icon name="chevronD" size={ 18 } />
                    </Btn>
                ) }
            </div>

            { /* Taken out of the room by the app server: said in place of the composer, whose placeholder and Send arrow
                 read as usable when only switched off (an SDK review, 2026-10-14). */ }
            { removed &&
                <div className="bm-chat-removed" role="status">{ __( "Removed from conversation", "bp-better-messages" ) }</div> }

            { ! removed && <div className="bm-composer" part="composer">
                <Piece name="Composer" props={ { send: sendText, typing: chat.typing, disabled: ! joined, maxLength,
                                                 placeholder: placeholder ?? _x( "Write your message", "Reply area placeholder", "bp-better-messages" ) } }>
                <ComposerRow
                    hostRef={ hostRef }
                    editableRef={ editableRef }
                    onInput={ onInput }
                    onKeyDown={ onKeyDown }
                    onPaste={ onPaste }
                    placeholder={ placeholder ?? _x( "Write your message", "Reply area placeholder", "bp-better-messages" ) }
                    disabled={ ! joined }
                    maxLength={ maxLength }
                    charCount={ text.length }
                    limited={ maxLength > 0 }
                    onSend={ () => void send() }
                    canSend={ text.trim().length > 0 && joined }
                    hasContent={ text.trim().length > 0 }
                    canRecordVoice={ false }
                    canRecordVideo={ false }
                />
                </Piece>
            </div> }
        </div>
    );
}
