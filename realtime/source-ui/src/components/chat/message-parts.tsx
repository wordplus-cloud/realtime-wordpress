import React, { type HTMLAttributes, type ReactNode } from "react";
import Icon, { type IconName } from "../../primitives/icon.tsx";
import Tooltip from "../../primitives/tooltip.tsx";
import Btn from "../../inc/helpers/btn.tsx";
import { __, _x } from "../../inc/globals.ts";

// The message list, Better Messages' (its thread-column.tsx): the day separator, the unread divider, a system line, a
// sender's stack, a message's body and its text bubble, the meta line with its time and ticks, the hover actions,
// the pinned typing line and the empty conversation. Views only, in its markup to the class: whoever draws them
// formats the times, decides what each message holds and what each action does. Better Messages keeps its message
// store, its files, voice, locations, encryption and moderation, and draws them in these; an app's Chat
// (src/sdk/chat.tsx) fills them from a room.
//
// Styles: styles/chat/_messages.scss.

// ─── DAY SEPARATOR, UNREAD DIVIDER ─────────────────────────────────────

export interface DaySeparatorProps {
    /** "Today", "Yesterday", "March 4". */
    label: string;
    /** The full date, in its tooltip. */
    title?: string;
}

export function DaySeparator( { label, title }: DaySeparatorProps ) {
    return (
        <div className="bm-day-sep">
            <Tooltip label={ title ?? "" }>
                <span className="bm-day-pill">{ label }</span>
            </Tooltip>
        </div>
    );
}

export function UnreadDivider() {
    return (
        <div className="bm-unread-divider">
            <span className="bm-unread-divider__line" />
            <span className="bm-unread-divider__label">{ _x( "New messages", "Unread divider", "bp-better-messages" ) }</span>
            <span className="bm-unread-divider__line" />
        </div>
    );
}

// ─── SYSTEM LINE, DELETED MESSAGE ──────────────────────────────────────

export type SystemTone = "neutral" | "accent" | "success" | "warn" | "danger";

export interface SystemRowProps {
    /** What kind of event (`user_joined`, `call_missed` …), for styles that tell them apart. */
    type?: string;
    tone?: SystemTone;
    icon?: IconName;
    /** When it happened, in full, in its tooltip. */
    title?: string;
    children: ReactNode;
}

/** An event in the conversation (someone joined, a call ended), centred as a pill. */
export function SystemRow( { type, tone = "neutral", icon = "bolt", title, children }: SystemRowProps ) {
    return (
        <div className="bm-system-row" data-system-type={ type ?? undefined }>
            <Tooltip label={ title ?? "" }>
                <div className="bm-system-row__pill" data-tone={ tone }>
                    <Icon name={ icon } size={ 11 } />
                    <span className="bm-system-row__text">{ children }</span>
                </div>
            </Tooltip>
        </div>
    );
}

export interface DeletedBubbleProps {
    isMe: boolean;
    /** What is gone: "This message was deleted" by default. */
    label?: string;
    time: string;
    timeTitle?: string;
}

/**
 * A message that is gone, in its place. Its time ends the last line of the label, as a text bubble's does: the spacer
 * keeps the room there, drawn from data-time in CSS so the label reads as itself alone, and the time is pinned over it.
 */
export function DeletedBubble( { isMe, label, time, timeTitle }: DeletedBubbleProps ) {
    return (
        <div className="bm-msg-deleted" data-is-me={ isMe ? 1 : 0 }>
            <span className="bm-msg-deleted__label">
                { label ?? __( "This message was deleted", "bp-better-messages" ) }
                <span className="bm-msg-deleted__spacer" data-time={ time } aria-hidden="true" />
            </span>
            <Tooltip label={ timeTitle ?? "" }>
                <span className="bm-msg-deleted__time">{ time }</span>
            </Tooltip>
        </div>
    );
}

// ─── A SENDER'S STACK ──────────────────────────────────────────────────

export type MessageSide = "left" | "right";
export type BubbleFill = "filled" | "outline" | "none" | string;

export interface MessageStackProps {
    isMe: boolean;
    side: MessageSide;
    /** The bubbles' look: Better Messages' design option (`none` draws no bubbles). */
    bubble?: BubbleFill;
    blocked?: boolean;
    /** The sender's avatar, where the stack shows one. */
    avatar?: ReactNode;
    /** The sender's name, as the host writes it. */
    name?: ReactNode;
    /** One time for the whole stack, where the site puts it there. */
    time?: { label: string; title?: string } | null;
    children: ReactNode;
}

/** Consecutive messages from one sender: their avatar, their name and the messages. */
export function MessageStack( { isMe, side, bubble, blocked, avatar, name, time, children }: MessageStackProps ) {
    return (
        <div className="bm-msg-stack" data-is-me={ isMe ? 1 : undefined } data-side={ side } data-bubble={ bubble } data-blocked={ blocked ? 1 : undefined }>
            { avatar && <div className="bm-msg-stack__avatar">{ avatar }</div> }
            <div className="bm-msg-stack__bubbles">
                <div className="bm-msg-stack__info">
                    { name }
                    { time && (
                        <Tooltip label={ time.title ?? "" }>
                            <span className="bm-msg-stack__time">{ time.label }</span>
                        </Tooltip>
                    ) }
                </div>
                { children }
            </div>
        </div>
    );
}

// ─── A MESSAGE ─────────────────────────────────────────────────────────

export interface MessageBodyProps extends HTMLAttributes<HTMLDivElement> {
    isMe: boolean;
    /** Its class: Better Messages' filterable `bm-msg-body bm-message` by default. */
    className?: string;
    /** "Forwarded from …", above it. */
    forwarded?: ReactNode;
    /** After the message's main column: the reactions, an action strip without bubbles. */
    after?: ReactNode;
    /** The message's main column: its attachments, its text bubble, its meta below, its actions. */
    children?: ReactNode;
}

/** One message: its main column, which the hover actions centre on, and what follows it. */
export function MessageBody( { isMe, className = "bm-msg-body bm-message", forwarded, after, children, ...attributes }: MessageBodyProps ) {
    return (
        <div className={ className } data-is-me={ isMe ? 1 : 0 } { ...attributes }>
            { forwarded }
            <div className="bm-msg-main">{ children }</div>
            { after }
        </div>
    );
}

export interface MessageTextProps {
    /** The text, the reply it quotes, its meta: what the bubble's text block holds. */
    children?: ReactNode;
    /** Inside the bubble, after the text block: the reactions' pills. */
    after?: ReactNode;
}

/** A message's text bubble. */
export function MessageText( { children, after }: MessageTextProps ) {
    return (
        <div className="bm-msg-bubble bm-message-content">
            <div className="bm-msg-bubble__text bm-message-content-text">{ children }</div>
            { after }
        </div>
    );
}

/** An answer still on its way (an AI's), in place of its text. */
export function AiWaiting() {
    return (
        <span className="bm-ai-waiting" aria-label={ _x( "typing", "Typing indicator (private conversation)", "bp-better-messages" ) }>
            <span className="bm-ai-waiting__dot" />
        </span>
    );
}

// ─── THE META LINE (time, edited, pinned, ticks) ───────────────────────

export type DeliveryState = "failed" | "queued" | "sending" | "sent" | "delivered" | "seen";

export interface StatusTickProps {
    status: DeliveryState;
    /** In its tooltip and for screen readers: the state's own words by default. */
    label?: string;
    interactive?: boolean;
    /** Opens who saw it, where the site offers that. */
    onClick?: () => void;
}

const tickLabel = ( status: DeliveryState ): string => {
    switch ( status ) {
        case "failed": return _x( "Not sent", "Message Delivery Status Tooltip", "bp-better-messages" );
        case "queued": return _x( "Waiting to send", "Message Delivery Status Tooltip", "bp-better-messages" );
        case "sending": return _x( "Sending...", "Message Delivery Status Tooltip", "bp-better-messages" );
        case "seen": return _x( "Seen", "Message Delivery Status Tooltip", "bp-better-messages" );
        case "delivered": return _x( "Delivered", "Message Delivery Status Tooltip", "bp-better-messages" );
        default: return _x( "Sent", "Message Delivery Status Tooltip", "bp-better-messages" );
    }
};

/**
 * A message's delivery tick: queued, sending, sent, delivered, seen, or failed. Every state takes the same box, so
 * the meta never moves when one replaces another.
 */
export function StatusTick( { status, label, interactive = true, onClick }: StatusTickProps ) {
    const words = label ?? tickLabel( status );
    const icon = status === "failed" ? <Icon name="alert" size={ 12 } />
        : status === "queued" ? <Icon name="clock" size={ 12 } />
        : status === "sending" ? <span className="bm-status-spinner" />
        // Seen doubles down on weight as well as colour: on an own bubble painted near the accent, colour alone
        // can't carry the step from delivered.
        : status === "seen" ? <Icon name="checks" size={ 12 } strokeWidth={ 3.2 } className="bm-status-read" />
        : status === "delivered" ? <Icon name="checks" size={ 12 } />
        : <Icon name="check2" size={ 12 } />;
    return (
        <Tooltip label={ words } disabled={ ! interactive }>
            <span className="bm-msg-status" data-status={ status } data-detailed={ onClick ? 1 : undefined } onClick={ onClick }>{ icon }</span>
        </Tooltip>
    );
}

export interface MetaPiecesProps {
    /** The message's time, and in full for its tooltip; none where the stack carries it. */
    time?: { label: string; title?: string } | null;
    /** When it was edited, in its tooltip; none if it wasn't. */
    edited?: { title: string } | null;
    pinned?: boolean;
    /** The favorite's mark, the host's. */
    favorite?: ReactNode;
    /** The delivery tick, for the sender's own message. */
    status?: ReactNode;
    /** First in the line: a translation's toggle, the host's. */
    translation?: ReactNode;
    interactive: boolean;
}

/** What the meta line says, in its order. */
export function MetaPieces( { time, edited, pinned, favorite, status, translation, interactive }: MetaPiecesProps ) {
    return (
        <>
            { translation }
            { edited && (
                <Tooltip label={ edited.title } disabled={ ! interactive }>
                    <span className="bm-msg-meta__edited">
                        <Icon name="edit" size={ 10 } />
                    </span>
                </Tooltip>
            ) }
            { pinned && (
                <Tooltip label={ __( "Message is pinned", "bp-better-messages" ) } disabled={ ! interactive }>
                    <span className="bm-msg-meta__pinned">
                        <Icon name="pin" size={ 10 } />
                    </span>
                </Tooltip>
            ) }
            { favorite }
            { time && (
                <Tooltip label={ time.title ?? "" } disabled={ ! interactive }>
                    <span className="bm-msg-meta__time">{ time.label }</span>
                </Tooltip>
            ) }
            { status && <span className="bm-msg-meta__status">{ status }</span> }
        </>
    );
}

export type MetaVariant = "inline" | "below" | "row";

export interface MessageMetaProps {
    /**
     * Where it goes: `inline` at the end of the text (an invisible copy reserves its room on the last line, the
     * visible one pinned to the corner), `below` the content of a message without text, or `row` at the end of the
     * reactions' row.
     */
    variant?: MetaVariant;
    /** The pieces, drawn once, or twice inline: `interactive` false for the copy that only holds the room. */
    pieces: ( interactive: boolean ) => ReactNode;
}

/** A message's meta line. */
export function MessageMeta( { variant = "inline", pieces }: MessageMetaProps ) {
    if ( variant !== "inline" ) {
        return <span className="bm-msg-meta" data-variant={ variant }>{ pieces( true ) }</span>;
    }
    return (
        <>
            <span className="bm-msg-meta" data-variant="spacer" aria-hidden="true">{ pieces( false ) }</span>
            <span className="bm-msg-meta" data-variant="overlay">{ pieces( true ) }</span>
        </>
    );
}

// ─── HOVER ACTIONS ─────────────────────────────────────────────────────

export interface HoverButtonProps {
    icon: IconName;
    label: string;
    active?: boolean;
    /** A button with a look of its own (`favorite`, `cancel`). */
    modifier?: string;
    onClick?: ( e: React.MouseEvent ) => void;
}

export function HoverButton( { icon, label, active, modifier, onClick }: HoverButtonProps ) {
    return (
        <Tooltip label={ label }>
            <Btn
                className={ "bm-hover-actions__btn"
                    + ( modifier ? " bm-hover-actions__btn--" + modifier : "" )
                    + ( active ? " is-active" : "" ) }
                onClick={ onClick }
                aria-label={ label }
            >
                <Icon name={ icon } size={ 14 } />
            </Btn>
        </Tooltip>
    );
}

/** The strip a message shows under the pointer: its HoverButtons. */
export function HoverActions( { children }: { children: ReactNode } ) {
    return <span className="bm-hover-actions">{ children }</span>;
}

// ─── THE PINNED TYPING LINE, THE EMPTY CONVERSATION ────────────────────

/** Who is writing, under the last message: a small avatar beside a small bubble. */
export function TypingPinned( { avatar, children }: { avatar?: ReactNode; children: ReactNode } ) {
    return (
        <div className="bm-typing-pinned">
            { avatar }
            <span className="bm-typing-pinned__bubble">{ children }</span>
        </div>
    );
}

/** A conversation with no messages yet. */
export function EmptyThread() {
    return (
        <div className="bm-empty-thread">
            <div className="bm-empty-thread__disc">
                <Icon name="thread" size={ 28 } strokeWidth={ 1.5 } />
            </div>
            <div className="bm-empty-thread__text">
                <div className="bm-empty-thread__title">{ _x( "Say hi", "Empty conversation", "bp-better-messages" ) }</div>
                <div className="bm-empty-thread__sub">
                    { _x( "No messages here yet — start the conversation from the composer below", "Empty conversation", "bp-better-messages" ) }
                </div>
            </div>
        </div>
    );
}
