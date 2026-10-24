import React, { useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { createPortal } from "react-dom";
import CallScreen, { type CallLayout } from "../components/calls/call-screen.tsx";
import IncomingCallCard from "../components/calls/incoming-call-card.tsx";
import type { CallContextInterface } from "../components/calls/context.ts";
import { usePrivateCall } from "./use-private-call.ts";
import { useGroupCall } from "./use-group-call.ts";
import { infoOf, type SdkCall, type SdkGroupCall } from "./types.ts";
import type { CallsController, Showing } from "./controller.ts";
import { Piece } from "../pieces.tsx";

/**
 * What draws a call on the screen: ours (the kit's CallScreen), or an app's own copy of it (`npx @wordplus/realtime-ui
 * add call-screen`), given the call as usePrivateCall and useGroupCall run it, and the layout.
 */
export type CallView = ComponentType<{ call: CallContextInterface; layout: CallLayout | null }>;

/**
 * The call screen of a page on @wordplus/realtime: Better Messages' screens on the SDK's calls. The rings in a column
 * at the top corner, the call on the screen in its window, and a word when a call couldn't start or ended for a
 * reason worth saying. `view` draws the call in place of ours.
 *
 * The window is drawn into a holder of its own, which moves as a whole between its place here and the page's spots for
 * the call (`controller.spot()`, CallSpot, `<call-spot>`). The call screen in it stays mounted as it moves, so the call
 * goes on with its camera, its microphone as the user left it, and its time.
 */
export default function CallsApp( { controller, view = CallScreen }: { controller: CallsController, view?: CallView } ) {
    const shown = useSyncExternalStore( controller.subscribe, controller.snapshot, controller.snapshot );
    const close = ( notice: string | null ) => controller.closed( notice );
    const home = useRef<HTMLDivElement>( null );
    const [ holder ] = useState( () => typeof document === 'undefined' ? null : document.createElement( 'div' ) );

    useLayoutEffect( () => {
        if ( ! holder || ! home.current ) return;
        const place = () => moveHolder( holder, home.current!, controller.snapshot().spot );
        place();
        const stop = controller.onPlace( place );
        return () => {
            stop();
            holder.remove();
        };
    }, [ controller, holder ] );

    return <>
        { shown.rings.length > 0 && <div className="realtime-call-rings">
            { shown.rings.map( ( ring ) => {
                const info = infoOf( ring.info );
                const props = { user_id: ring.from, name: info.name, type: ring.type,
                    onAnswer: () => void controller.answer( ring ), onReject: () => controller.decline( ring ) };
                return <div key={ ring.id } className="realtime-call-ring bm-toast-site-call" data-call={ ring.call } part="ring-card">
                    <Piece name="RingCard" props={ props }><IncomingCallCard { ...props } /></Piece>
                </div>;
            } ) }
        </div> }

        <div ref={ home } className="realtime-call-home" style={ { display: "contents" } } />
        { shown.showing && holder && createPortal( <CallWindow showing={ shown.showing } close={ close } view={ view }
                                                               chat={ shown.chat === null ? null : { shown: shown.chat, toggle: controller.showChat } } />, holder ) }

        { shown.notice && <div className="realtime-call-notice" role="status">{ shown.notice }</div> }
    </>;
}

/**
 * Puts the window's holder in `spot`, or back home. One step either way, so its pictures play on: `moveBefore()` keeps
 * everything of a moving element where the browser has it, and `appendChild()` moves it before the browser would pause
 * a video taken out of the page.
 */
function moveHolder( holder: HTMLDivElement, home: HTMLElement, spot: HTMLElement | null ): void {
    const to = spot ?? home;
    holder.className = "realtime-calls realtime-call-holder";
    holder.dir = home.closest( "[dir]" )?.getAttribute( "dir" ) ?? "";
    if ( spot ) holder.setAttribute( "data-place", "spot" );
    else holder.removeAttribute( "data-place" );
    if ( holder.parentNode === to ) return;
    const move = ( to as HTMLElement & { moveBefore?: ( node: Node, child: Node | null ) => void } ).moveBefore;
    if ( move && holder.isConnected && to.isConnected ) {
        try {
            move.call( to, holder, null );
            return;
        } catch {
            // Across documents, or a browser that refuses this move: appendChild below.
        }
    }
    to.appendChild( holder );
}

/** The chat beside the call, where it is in a chat's spot: whether it shows, and Show Chat / Hide Chat in the controls. */
type BesideChat = { shown: boolean; toggle: CallsController[ 'showChat' ] } | null;

function CallWindow( { showing, close, view, chat }: { showing: Showing, close: ( notice: string | null ) => void, view: CallView, chat: BesideChat } ) {
    // A key per call, so a call that becomes a group call starts its screen afresh.
    // `.bm-call-surface` carries the stage's colours, as Better Messages' call surface does.
    return <div className="realtime-call-window bm-call-surface" part="call-window" data-layout={ showing.kind === 'call' ? 'private' : showing.type }>
        { showing.kind === 'call'
            ? <PrivateWindow key={ showing.call.id } call={ showing.call } peer={ showing.peer } close={ close } view={ view } chat={ chat } adding={ { people: showing.people, addPerson: showing.add } } />
            : <GroupWindow key="group" group={ showing.group } type={ showing.type } close={ close } view={ view } chat={ chat } adding={ { people: showing.people, addPerson: showing.add } } /> }
    </div>;
}

/** The call as its screen gets it: with the chat beside it, as a Better Messages conversation gives its call its own. */
function withChat( context: CallContextInterface, chat: BesideChat ): CallContextInterface {
    return chat === null ? context : { ...context, chatShown: chat.shown, chatToggle: chat.toggle };
}

function PrivateWindow( { call, peer, close, adding, view: View, chat }: { call: SdkCall, peer: { name: string; avatar?: string }, close: ( notice: string | null ) => void, adding: Parameters<typeof usePrivateCall>[ 3 ], view: CallView, chat: BesideChat } ) {
    const context = usePrivateCall( call, peer, close, adding );
    return <View call={ withChat( context, chat ) } layout="private" />;
}

function GroupWindow( { group, type, close, adding, view: View, chat }: { group: SdkGroupCall, type: 'audio' | 'video', close: ( notice: string | null ) => void, adding: Parameters<typeof useGroupCall>[ 3 ], view: CallView, chat: BesideChat } ) {
    const context = useGroupCall( group, type, close, adding );
    return <View call={ withChat( context, chat ) } layout={ type === 'video' ? 'group-video' : 'group-audio' } />;
}
