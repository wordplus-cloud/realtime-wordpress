import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Btn from "../../inc/helpers/btn.tsx";
import { _x } from "../../inc/globals.ts";
import { isMobile } from "../../inc/functions/browser-info.ts";
import { type ClampedPosition, clampToViewport, liveAnchorRect, viewportSize } from "../../primitives/viewport.ts";

// Reactions, Better Messages' (its message-reactions.tsx): the pill row under a message and the picker, a small round
// trigger at the bubble's corner whose strip grows out of it on hover (a tap on a phone). Whoever draws them gives the
// set to pick from, which pick is the user's, what a pick does and how an emoji is drawn: Better Messages keeps its
// admin-curated set, its emoji images, its API and the "who reacted" list; an app's Chat picks from a set of its own
// and emits.
//
// A reaction travels as 2.0 stored it: the emoji's hex code point key ("1f44d", parts joined by "-"), or the emoji.
//
// Styles: styles/chat/_reactions.scss.

export interface ReactionEntry {
    reaction : string;
    users    : Array<number | string>;
}

const HEX_KEY_RE = /^[0-9a-f]{2,6}(-[0-9a-f]{2,6})*$/i;

/** A reaction's emoji, from its key or as it is. */
export function decodeReaction( value: string ): string {
    if ( ! HEX_KEY_RE.test( value ) ) return value;
    try {
        return String.fromCodePoint( ...value.split( "-" ).map( p => parseInt( p, 16 ) ) );
    } catch {
        return value;
    }
}

/** A reaction's key, as 2.0 stores them, from its emoji. */
export function encodeReaction( emoji: string ): string {
    return [ ...emoji ].map( ( c ) => c.codePointAt( 0 )!.toString( 16 ) ).filter( ( h ) => h !== "fe0f" ).join( "-" );
}

/** The pills under a message, and its meta where it rides their row. */
export function ReactionPills( { children, meta }: { children: ReactNode; meta?: ReactNode } ) {
    return (
        <div className="bm-reactions">
            { children }
            { meta }
        </div>
    );
}

export interface ReactionPillProps {
    /** The emoji, as the host draws it. */
    emoji: ReactNode;
    /** How many picked it: shown from two up. */
    count: number;
    mine?: boolean;
    /** Toggles the user's own, or opens who reacted: none for a pill that only shows. */
    onClick?: () => void;
}

export function ReactionPill( { emoji, count, mine, onClick }: ReactionPillProps ) {
    return (
        <Btn
            className="bm-reaction-pill"
            data-reacted-by-me={ mine ? 1 : undefined }
            data-static={ onClick ? undefined : 1 }
            onClick={ onClick }
        >
            <span className="bm-reaction-pill__emoji">{ emoji }</span>
            { count > 1 && <span className="bm-reaction-pill__count">{ count }</span> }
        </Btn>
    );
}

let iconHeight = 32;

// How tall one column of the strip may grow before the set wraps into a second one.
const STRIP_MAX_HEIGHT = 300;
// The scale-fade, matched to _reactions.scss. The exit has to outlive its transition or the strip is unmounted
// mid-fade.
const STRIP_CLOSE_MS = 120;
// How long the strip survives the pointer being on neither it nor the trigger: the frames where the pointer crosses
// the sliver between their rounded corners.
const HOVER_GRACE_MS = 120;

/**
 * The trigger's LAYOUT box in viewport coordinates, its bottom-right corner, which the strip hangs off. The trigger
 * is mid-transform when the strip opens (it scales down as the strip covers it), and its transform keeps its centre,
 * so the corner comes from that centre and the untransformed size: an anchor that moves only when the trigger does.
 */
function triggerCorner( el: HTMLElement | null ): { right: number; bottom: number } | null {
    const r = liveAnchorRect( el );
    if ( ! r || ! el ) return null;
    return {
        right:  r.left + r.width  / 2 + el.offsetWidth  / 2,
        bottom: r.top  + r.height / 2 + el.offsetHeight / 2,
    };
}

export interface ReactionPickerProps {
    /** The set to pick from: keys or emoji, in order. */
    keys: string[];
    /** The user's own reaction, which the trigger fronts. */
    mine?: string;
    onPick: ( key: string ) => void;
    /** How an emoji is drawn, at a size: the emoji as text by default. */
    renderEmoji?: ( key: string, size: number ) => ReactNode;
}

const textEmoji = ( key: string, size: number ) => (
    <span className="bm-reaction-emoji" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, fontSize: Math.round( size * 0.85 ), lineHeight: 1 }}>{ decodeReaction( key ) }</span>
);

/** The reaction picker at a message's corner: its trigger, and the strip of the set it opens. */
export function ReactionPicker( { keys, mine, onPick, renderEmoji = textEmoji }: ReactionPickerProps ) {
    const touch = isMobile();

    const [ isOpen, setIsOpen ] = useState( false );
    // Kept mounted through the closing transition: unmounting on the state flip would cut the fade off at its first
    // frame.
    const [ mounted, setMounted ] = useState( false );
    // Drives the CSS scale-fade, flipped a frame after the strip is placed, so the transition has a frame to run from
    // and no frame paints at the wrong spot.
    const [ entered, setEntered ] = useState( false );
    const [ pos, setPos ] = useState<ClampedPosition | null>( null );

    const triggerRef = useRef<HTMLElement | null>( null );
    const anchorRef  = useRef<HTMLDivElement | null>( null );
    const closeTimer = useRef<number>( 0 );
    const hoverBlocked = useRef( false );
    const unblockRef   = useRef<( () => void ) | null>( null );

    // Set from a pick onwards: the strip holds its place instead of following the trigger. A pick is what moves the
    // trigger (a first reaction adds the pill row, the bubble grows a line), and a strip that followed slid a
    // different emoji under a pointer that had not moved.
    const holdRef = useRef( false );

    const cancelClose = () => {
        if ( ! closeTimer.current ) return;
        clearTimeout( closeTimer.current );
        closeTimer.current = 0;
    };
    const unblockHover = () => {
        hoverBlocked.current = false;
        if ( ! unblockRef.current ) return;
        document.removeEventListener( "pointermove", unblockRef.current, true );
        unblockRef.current = null;
    };
    const openStrip = () => { cancelClose(); holdRef.current = false; setMounted( true ); setIsOpen( true ); };
    const closeStrip = () => { cancelClose(); setIsOpen( false ); };
    const scheduleClose = () => {
        cancelClose();
        closeTimer.current = window.setTimeout( () => setIsOpen( false ), HOVER_GRACE_MS );
    };
    const pinThroughThePick = () => { holdRef.current = true; };
    // Hover opens the strip, except straight after a dismissal: taking the strip away sends a fresh mouseover to the
    // trigger under it, and the strip reopened on a pointer that had not moved. Hover waits for the pointer to move.
    const hoverOpen = () => { if ( ! hoverBlocked.current ) openStrip(); };
    const dismissStrip = () => {
        closeStrip();
        unblockHover();
        hoverBlocked.current = true;
        const onMove = () => unblockHover();
        unblockRef.current = onMove;
        document.addEventListener( "pointermove", onMove, true );
    };

    useEffect( () => () => { cancelClose(); unblockHover(); }, [] );

    // Unmount once the exit transition has played out.
    useEffect( () => {
        if ( isOpen ) return;
        setEntered( false );
        const t = window.setTimeout( () => { setMounted( false ); setPos( null ); }, STRIP_CLOSE_MS );
        return () => clearTimeout( t );
    }, [ isOpen ] );

    // Place the strip, then keep it placed.
    useLayoutEffect( () => {
        if ( ! mounted ) return;

        let raf = 0;
        let sig = "";

        const place = ( corner: { right: number; bottom: number } | null ) => {
            const el = anchorRef.current;
            if ( ! el || ! corner ) return;

            // Columns first, read off the rendered cell, so density and page zoom don't break the math.
            const cells = el.querySelectorAll<HTMLElement>( ".bm-reaction-strip__item" );
            const cell  = cells.length ? cells[ cells.length - 1 ].offsetHeight : 0;
            if ( cell > 0 ) iconHeight = cell;
            const perColumn = Math.max( 1, Math.floor( STRIP_MAX_HEIGHT / iconHeight ) );
            const columns   = Math.max( 1, Math.ceil( keys.length / perColumn ) );
            el.style.setProperty( "--columns", String( columns ) );
            el.setAttribute( "data-columns", String( columns ) );

            // offsetWidth/Height: the inner strip is scaled down for its entrance. The strip's bottom-right corner
            // goes on the trigger's, growing up and to the left, clamped into the viewport.
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            const next = clampToViewport( corner.right - w, corner.bottom - h, w, h );
            setPos( prev => ( prev && prev.left === next.left && prev.top === next.top ) ? prev : next );
        };

        place( triggerCorner( triggerRef.current ) );

        // Per frame: the moves that matter (the list scrolling, the composer resizing the column, the keyboard
        // folding away) don't all arrive as events.
        const follow = () => {
            raf = requestAnimationFrame( follow );
            const el = anchorRef.current;
            if ( ! el ) return;
            if ( holdRef.current ) return;
            const corner = triggerCorner( triggerRef.current );
            const vp     = viewportSize();
            const now = [ corner?.right, corner?.bottom, el.offsetWidth, el.offsetHeight, vp.width, vp.height ].join( "|" );
            if ( now === sig ) return;
            sig = now;
            place( corner );
        };
        raf = requestAnimationFrame( follow );

        return () => cancelAnimationFrame( raf );
    }, [ mounted, keys.length ] );

    // The entrance only once the strip has a position, from the frame after.
    useLayoutEffect( () => {
        if ( ! isOpen || ! pos ) return;
        const raf = requestAnimationFrame( () => setEntered( true ) );
        return () => cancelAnimationFrame( raf );
    }, [ isOpen, !! pos ] );

    // Outside press and Escape, in the capture phase, so a handler that stops propagation can't strand it open.
    useEffect( () => {
        if ( ! isOpen ) return;
        const outside = ( e: PointerEvent ) => {
            const t = ( e.composedPath?.()[ 0 ] ?? e.target ) as Node | null;
            if ( ! t ) return;
            if ( anchorRef.current?.contains( t ) || triggerRef.current?.contains( t ) ) return;
            dismissStrip();
        };
        const escape = ( e: KeyboardEvent ) => { if ( e.key === "Escape" ) dismissStrip(); };
        document.addEventListener( "pointerdown", outside, true );
        document.addEventListener( "keydown", escape, true );
        return () => {
            document.removeEventListener( "pointerdown", outside, true );
            document.removeEventListener( "keydown", escape, true );
        };
    }, [ isOpen ] );

    if ( keys.length === 0 ) return null;

    // The trigger fronts the user's own reaction when they have one, else the last of the set.
    const faceKey = mine && keys.includes( mine ) ? mine : keys[ keys.length - 1 ];
    // The strip goes in the trigger's own root, so a shadow root's styles reach it.
    const root = triggerRef.current?.getRootNode();
    const target = root instanceof ShadowRoot ? root : document.body;

    return (
        <>
            <Btn
                className={ "bm-reaction-trigger" + ( isOpen ? " bm-hidden" : "" ) }
                ref={ triggerRef }
                aria-label={ _x( "React", "Reactions selector trigger", "bp-better-messages" ) }
                aria-expanded={ isOpen }
                onMouseEnter={ touch ? undefined : hoverOpen }
                onMouseLeave={ touch ? undefined : scheduleClose }
                onClick={ touch ? ( () => { isOpen ? closeStrip() : openStrip(); } ) : undefined }
            >
                { renderEmoji( faceKey, 14 ) }
            </Btn>
            { mounted && createPortal(
                <div
                    className="bm-reaction-strip-anchor"
                    ref={ anchorRef }
                    data-open={ entered ? "1" : undefined }
                    style={ { left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : "hidden" } }
                    onMouseEnter={ touch ? undefined : cancelClose }
                    onMouseLeave={ touch ? undefined : scheduleClose }
                >
                    <div className="bm-reaction-strip" role="menu">
                        { keys.map( key => (
                            <Btn
                                key={ "reaction-" + key }
                                role="menuitem"
                                className="bm-reaction-strip__item"
                                data-mine={ key === mine ? 1 : undefined }
                                // A finger never leaves the strip, so a pick closes it on a phone; a pointer walks
                                // off on its own. Pinned first: the pill row the pick adds resizes the bubble.
                                onClick={ () => { pinThroughThePick(); onPick( key ); if ( touch ) closeStrip(); } }
                            >
                                { renderEmoji( key, 20 ) }
                            </Btn>
                        ) ) }
                    </div>
                </div>,
                target,
            ) }
        </>
    );
}
