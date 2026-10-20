// The elements' pieces from the page's own markup: a page without React fills a
// piece with a `<template slot="…">` inside the element that draws it, and the element draws the template in our
// piece's place. The markup is the page's, and so is its look: a `<style>` in the template applies to it, inside the
// element's shadow root, and the page's own stylesheet reaches the pieces through `::part()`.
//
//     <call-screen>
//         <template slot="ring-card">
//             <div class="ring"><b data-field="name"></b> calls (<span data-field="type"></span>)
//                 <button data-action="answer">Pick up</button> <button data-action="reject">Not now</button></div>
//         </template>
//         <template slot="control" data-control="raise" data-label="Raise hand" data-icon="raisehand"></template>
//     </call-screen>
//     <chat-room room="chat:34:42">
//         <template slot="empty-conversation"><p>Ask us anything about your order.</p></template>
//     </chat-room>
//
// In a template: `data-field="…"` takes that value as its text; `data-src="…"` takes it as its `src`; `data-action="…"`
// does that when clicked; `data-ours` is where ours is drawn, as the React pieces get it as their children. A
// `control` template is a button of the page's own in the dock: pressed, the element sends `realtime-control` (its
// `detail.control` the template's `data-control`), which bubbles to the document.
import React, { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import parse from "html-react-parser";
import CallControl from "./components/calls/call-control.tsx";
import type { IconName } from "./primitives/icon.tsx";
import type { CallStatusProps, ChatMessageView, Drawn, MessageProps, OnlineRowProps, Pieces, RingCardProps } from "./pieces.tsx";
import { _x } from "./inc/globals.ts";
import { msToTime } from "./inc/functions.ts";

/** What a template is filled with: its fields' text, its pictures, and what its buttons do. */
interface Filling {
    fields: Record<string, string>;
    actions?: Record<string, () => void>;
    /** The piece's state for its markup, as `data-*` on its holder (`data-mine`, `data-type`). */
    data?: Record<string, string>;
}

/** A piece drawn from a template of the page's, filled again at every render. */
function templated<P extends Drawn>( template: HTMLTemplateElement, part: string, fill: ( props: P ) => Filling ): ComponentType<P> {
    return function TemplatePiece( props: P ) {
        const holder = useRef<HTMLDivElement | null>( null );
        const [ ours, setOurs ] = useState<Element | null>( null );
        const filling = fill( props );

        useLayoutEffect( () => {
            const el = holder.current;
            if ( ! el ) return;
            el.replaceChildren( template.content.cloneNode( true ) );
            setOurs( el.querySelector( "[data-ours]" ) );
        }, [] );

        useLayoutEffect( () => {
            const el = holder.current;
            if ( ! el ) return;
            for ( const node of el.querySelectorAll<HTMLElement>( "[data-field]" ) ) node.textContent = filling.fields[ node.dataset.field! ] ?? "";
            for ( const node of el.querySelectorAll<HTMLElement>( "[data-src]" ) ) {
                const src = filling.fields[ node.dataset.src! ];
                if ( src ) node.setAttribute( "src", src );
                else node.removeAttribute( "src" );
            }
            for ( const node of el.querySelectorAll<HTMLElement>( "[data-action]" ) ) {
                const action = filling.actions?.[ node.dataset.action! ];
                node.onclick = action ? ( e ) => { e.preventDefault(); action(); } : null;
            }
            for ( const [ key, value ] of Object.entries( filling.data ?? {} ) ) el.setAttribute( "data-" + key, value );
        } );

        return <div ref={ holder } className="realtime-template" part={ part } style={ { display: "contents" } }>
            { ours && props.children ? createPortal( props.children as ReactNode, ours ) : null }
        </div>;
    };
}

const time = ( at: number ) => new Intl.DateTimeFormat( undefined, { hour: "2-digit", minute: "2-digit" } ).format( new Date( at ) );

/** The pieces a template may fill, each with what fills it. */
const FILLS: { [ slot: string ]: [ keyof Pieces, ( props: any ) => Filling ] } = {
    "ring-card": [ "RingCard", ( p: RingCardProps ) => ( {
        fields: {
            name: p.name ?? "",
            type: p.type === "video"
                ? _x( "Incoming Video Call", "Private Call - On Site Message", "bp-better-messages" )
                : _x( "Incoming Audio Call", "Private Call - On Site Message", "bp-better-messages" ),
        },
        actions: { answer: p.onAnswer, reject: p.onReject },
        data: { type: p.type },
    } ) ],
    "call-status": [ "CallStatus", ( p: CallStatusProps ) => ( {
        fields: { text: p.text, time: p.duration > 0 ? msToTime( p.duration ) : "" },
        data: { action: p.action ?? "", layout: p.layout },
    } ) ],
    "empty-conversation": [ "EmptyConversation", () => ( { fields: {} } ) ],
    "online-row": [ "OnlineRow", ( p: OnlineRowProps ) => ( {
        fields: { name: p.member.name, avatar: p.member.avatar ?? "", role: typeof p.member.info.role === "string" ? p.member.info.role : "" },
        data: { mine: p.mine ? "1" : "0" },
    } ) ],
    "message": [ "Message", ( p: MessageProps & { message: ChatMessageView } ) => ( {
        fields: { text: p.message.text, name: p.sender.name, avatar: p.sender.avatar ?? "", time: time( p.message.at ), status: p.message.status ?? "" },
        data: { mine: p.mine ? "1" : "0" },
    } ) ],
};

/**
 * The pieces the templates inside `element` fill, read once: a template added later counts from the element's next
 * connection. Empty when it holds none.
 */
export function templatePieces( element: Element ): Pieces {
    const pieces: Record<string, unknown> = {};
    const controls: HTMLTemplateElement[] = [];

    for ( const template of element.querySelectorAll<HTMLTemplateElement>( ":scope > template[slot]" ) ) {
        const slot = template.getAttribute( "slot" )!;
        if ( slot === "control" ) {
            controls.push( template );
            continue;
        }
        const fill = FILLS[ slot ];
        if ( fill ) pieces[ fill[ 0 ] ] = templated( template, slot, fill[ 1 ] );
    }

    if ( controls.length ) {
        pieces.controls = ( buttons: React.ReactElement[] ) => [
            ...buttons,
            ...controls.map( ( template, i ) => {
                const name = template.dataset.control ?? "control-" + i;
                const icon = template.dataset.icon;
                return <CallControl key={ "page-" + name } label={ template.dataset.label ?? name }
                                    icon={ icon ? icon as IconName : parse( template.innerHTML.trim() ) as ReactNode }
                                    className={ "realtime-control-" + name }
                                    onClick={ () => element.dispatchEvent( new CustomEvent( "realtime-control", { bubbles: true, composed: true, detail: { control: name } } ) ) } />;
            } ),
        ];
    }

    return pieces as Pieces;
}
