import React, {
    Fragment,
    ReactElement,
    ReactNode,
    cloneElement,
    isValidElement,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { flushSync } from "react-dom";

// A dock kept to ONE row: its tail folds into a "More" sheet.
//
// A call carries up to eleven controls (configure, camera, microphone, full
// screen, screen share, raise hand, and a moderator's mute-all / lock room /
// lower all hands / call mode, then hang up). Eight of them fit across a
// phone or the 350px call column beside the chat, so the rest wrapped onto a
// second row — a dock that changed height as a moderator joined, with the
// leftovers stranded under the right-hand edge.
//
// Instead the tail of the row folds into a "More" sheet: the dock keeps its
// single row at every width, and nothing becomes unreachable the way it would
// under `overflow: hidden` or a horizontal scroller.
//
// WHICH controls fold is the JSX order — the dock collapses from the end of
// the row, so the last thing written is the first thing to go. That puts the
// moderator's extras in the sheet first and leaves camera/microphone inline
// longest, which is the order the call sites already wrote them in. `pinned`
// holds back the trailing buttons that must never fold (hang up).
//
// The fit is MEASURED rather than guessed from a container query: how many
// buttons are on screen depends on permissions, device support and the
// moderator flag, so no width threshold can know the answer. The pass runs in
// a layout effect — React flushes those synchronously before paint, so the
// row converges on its final shape without a frame of the wrapped layout ever
// being painted.
//
// CSS still says `flex-wrap: wrap` (see _call-stage.scss). It is the fallback:
// if this measurement never runs, the dock behaves exactly as it did before
// rather than clipping controls away.
//
// Apart from the call's dock (call-dock.tsx), which draws its More button with
// the call screens' tooltip and icon: whoever draws a dock in a call's place
// draws its own (`more`), and keeps the fold, so a dock beside a call's folds
// as the call's does. The live streams' stage in a Better Messages
// conversation is one.

interface Props {
    // The dock's own class — .bm-call-buttons (1:1) or
    // .bm-group-call-controls-buttons (rooms). Both carry the same dock
    // styling; the class stays with the call site so the stylesheet and the
    // specs keep reading the markup 2.0 emitted.
    className : string;
    // Trailing children that never fold into the sheet. Hang up is the one
    // control that has to stay under the thumb at every width.
    pinned?   : number;
    // The More button, drawn while anything is folded: `sheet` is the open
    // sheet (null while closed), placed inside it, and `toggle` opens and
    // closes it. The button carries the class .bm-call-more, by which a press
    // on it, or in its sheet, is told from a press outside that closes it.
    more      : ( props : { open : boolean; toggle : () => void; sheet : ReactNode } ) => ReactNode;
    children  : ReactNode;
}

// The call sites group their conditionals in fragments — `{ adminMode && <>
// …four buttons… </> }` — and React.Children does not look inside a fragment,
// so a dock that counted its children would see one item where there are
// four. Walk through them.
export function flattenItems( nodes: ReactNode ): ReactElement[] {
    const out: ReactElement[] = [];

    React.Children.toArray( nodes ).forEach( ( child ) => {
        if ( ! isValidElement( child ) ) return;

        if ( child.type === Fragment ) {
            out.push( ...flattenItems( ( child.props as { children?: ReactNode } ).children ) );
            return;
        }

        out.push( child );
    } );

    return out;
}

// One control as the dock can rewrite it: the span 2.0 emits, carrying the
// tone class, the handler and the glyph.
type DockButton = ReactElement<{
    className?    : string;
    children?     : ReactNode;
    role?         : string;
    "aria-label"? : string;
}>;

// An item is a <Tooltip content="Mute All"><span className="bm-mute-all">,
// whose tooltip's copy is the label the sheet spells out and whose span is the
// button itself; or the span alone, labelled by its own aria-label.
function itemParts( el: ReactElement ): { label: string; button: DockButton } {
    const props = el.props as { content?: unknown; children?: ReactNode };

    if ( typeof props.content === "string" && isValidElement( props.children ) ) {
        return { label: props.content, button: props.children as DockButton };
    }

    const own = ( el as DockButton ).props[ "aria-label" ];
    return { label: typeof own === "string" ? own : "", button: el as DockButton };
}

// A signature that changes whenever the row's CONTENTS change — a button
// appearing, disappearing, or swapping its tone class (enable ↔ disable mic,
// which is also a swap of width when the danger pill is involved). Any of
// those invalidates the measurement, so the dock re-opens to full width and
// measures again.
function itemSignature( items: ReactElement[] ): string {
    return items.map( ( el ) => itemParts( el ).button.props.className || "?" ).join( "|" );
}

// Did the row break? Comparing the first and last flex item's offsetTop is
// cheaper and steadier than arithmetic over widths, gaps and padding: it needs
// nothing about the dock's own box, works whatever the buttons measure (the
// hang-up pill is wider than the round toggles), and asks the browser the
// exact question the layout answers. The sheet is absolutely positioned, so it
// is never one of the items being compared.
//
// Only the items that are laid out count. The stylesheet hides some per
// layout (Show Chat in the single-column one, where the call's edge handle
// does it), and a display:none child reads offsetTop 0: first in the row, it
// made every row look broken, and the dock folded every button it had.
function isWrapped( row: HTMLElement ): boolean {
    const kids = ( Array.from( row.children ) as HTMLElement[] )
        .filter( ( kid ) => kid.getClientRects().length > 0 );
    if ( kids.length < 2 ) return false;
    return kids[ kids.length - 1 ].offsetTop > kids[ 0 ].offsetTop;
}

export default function FoldingDock( { className, pinned = 0, more, children }: Props ) {
    const items = flattenItems( children );
    const signature = itemSignature( items );

    const rowRef = useRef<HTMLDivElement>( null );

    const [ folded, setFolded ] = useState( 0 );
    const [ open, setOpen ]     = useState( false );
    // Bumping this asks for a fresh measuring pass. Re-opening the row is
    // `setFolded( 0 )`, and on a row that is ALREADY open that is not a state
    // change at all — React skips the re-render, the effect below never runs,
    // and a dock that had been given room stayed folded however the stage was
    // resized. A value that always changes is what asks for the pass.
    const [ pass, setPass ]     = useState( 0 );

    const head   = pinned > 0 ? items.slice( 0, Math.max( 0, items.length - pinned ) ) : items;
    const tail   = pinned > 0 ? items.slice( Math.max( 0, items.length - pinned ) ) : [];
    const hidden = Math.min( folded, head.length );
    const inline = head.slice( 0, head.length - hidden );
    const sheet  = head.slice( head.length - hidden );

    // Keyed by position in the WHOLE row, so moving a button between the row
    // and the sheet is a move and not a remount.
    const keyed = ( list: ReactElement[], from: number ) =>
        list.map( ( el, i ) => cloneElement( el, { key: `bm-dock-${ from + i }` } ) );

    // Re-open the row whenever its contents change, so the next pass starts
    // from every button inline and can also GIVE BACK a button the row has
    // room for again.
    useLayoutEffect( () => {
        setFolded( 0 );
        setPass( ( n ) => n + 1 );
    }, [ signature ] );

    // …and whenever the space around it changes. The parent is the dock's
    // container (the controls bar, the centred column) and its width does not
    // depend on how wide the dock is, so folding a button can never feed back
    // into another reset.
    //
    // Nor is the parent the whole of it. In a group call the dock shares the
    // bar with the connection badge, whose label grows once the quality is
    // known ("connected" → "connected (excellent)"), and the bar stays the
    // width it was: the dock measured beside the short label, then wrapped
    // beside the long one with nothing to tell it to fold. So the room is the
    // parent less what the siblings beside it take, and the siblings are
    // observed too. Their widths don't depend on the dock's either.
    //
    // flushSync, because this is the one path where the row would be SEEN
    // wrapped. A resize observer fires inside the resizing frame, after the
    // browser has laid the page out and before it paints it; a plain setState
    // here is scheduled and renders after that paint, so every drag past a
    // fold showed the two-row row for a frame. Rendering now puts the
    // measuring effect inside the same frame, and updates a layout effect
    // makes are flushed before the paint as they always are — so the only
    // arrangement that reaches the screen is the folded one.
    useEffect( () => {
        const row = rowRef.current;
        const parent = row?.parentElement;
        // Without one (a page with no layout, as a test's), the stylesheet's wrap is the fallback.
        if ( ! row || ! parent || typeof ResizeObserver === "undefined" ) return;

        // Beside the dock, not above it (the 1:1 dock is a column with the
        // device panel stacked over it) and not lifted out of the flow.
        const beside = () => getComputedStyle( parent ).flexDirection.startsWith( "row" )
            ? ( Array.from( parent.children ) as HTMLElement[] ).filter( ( el ) =>
                el !== row && ! [ "absolute", "fixed" ].includes( getComputedStyle( el ).position ) )
            : [];

        const room = () => beside().reduce(
            ( width, el ) => width - el.getBoundingClientRect().width,
            parent.clientWidth,
        );

        let last = room();
        const ro = new ResizeObserver( () => {
            const width = room();
            if ( width === last ) return;
            // Only a dock given MORE room can hand buttons back, and
            // re-folding from scratch costs a synchronous render per button.
            // Narrowing never needs fewer folds than it already has, so it
            // carries on from where it is — one step, usually.
            const grew = width > last;
            last = width;
            flushSync( () => {
                if ( grew ) setFolded( 0 );
                setPass( ( n ) => n + 1 );
            } );
        } );
        ro.observe( parent );
        beside().forEach( ( el ) => ro.observe( el ) );
        return () => ro.disconnect();
    }, [] );

    // One button per pass, until the row holds. Each pass is a state change
    // made from a layout effect, which React re-renders and re-measures
    // synchronously — so the loop finishes before the browser paints. It ends
    // on its own: once every foldable button is in the sheet the cap returns
    // the value already held and React stops re-rendering.
    //
    // The three things it depends on are the three that can change the row:
    // what is in it, how much of it is folded, and a resize. A live call
    // re-renders this dock on every participant and quality change, and
    // reading offsetTop is a layout flush — there is no reason to spend one
    // because somebody's connection went from good to excellent.
    useLayoutEffect( () => {
        const row = rowRef.current;
        if ( ! row || ! isWrapped( row ) ) return;
        setFolded( ( n ) => Math.min( n + 1, head.length ) );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ signature, folded, pass ] );

    // Nothing left to show: a sheet that emptied out (the window grew, the
    // moderator's buttons went away) must not stay open over the call.
    useEffect( () => {
        if ( hidden === 0 ) setOpen( false );
    }, [ hidden ] );

    useEffect( () => {
        if ( ! open ) return;

        // pointerdown, in capture, is the same dismissal the context menu
        // uses. The sheet lives INSIDE the More button, so one closest()
        // covers the button and its sheet — without that, closing on
        // pointerdown would unmount a sheet row before its own click landed.
        // (A row's click then bubbles to the button and closes the sheet
        // itself, which is the "act, then put it away" the dock wants.)
        const onDown = ( e: PointerEvent ) => {
            const target = e.target;
            if ( target instanceof Element && target.closest( ".bm-call-more" ) ) return;
            setOpen( false );
        };
        const onKey = ( e: KeyboardEvent ) => {
            if ( e.key === "Escape" ) setOpen( false );
        };

        document.addEventListener( "pointerdown", onDown, true );
        document.addEventListener( "keydown", onKey );
        return () => {
            document.removeEventListener( "pointerdown", onDown, true );
            document.removeEventListener( "keydown", onKey );
        };
    }, [ open ] );

    const rows = open
        ? <div className="bm-call-dock-sheet" role="menu">
            { sheet.map( ( el, i ) => {
                const { label, button } = itemParts( el );
                const cls = [ button.props.className, "bm-call-dock-sheet__row" ]
                    .filter( Boolean ).join( " " );

                // The button itself becomes the row: it keeps its handler and
                // its tone class, gains the label, and the stylesheet unrolls
                // the circle into a line. The row says its label, so it wears
                // no tooltip of its own.
                return cloneElement(
                    button,
                    { key: `bm-dock-sheet-${ i }`, className: cls, role: "menuitem", "data-bm-tip": undefined } as Partial<DockButton[ "props" ]>,
                    ...React.Children.toArray( button.props.children ),
                    label
                        ? <span key="bm-dock-label" className="bm-call-dock-sheet__label">{ label }</span>
                        : null,
                );
            } ) }
        </div>
        : null;

    return (
        <div ref={ rowRef } className={ className } data-folded={ hidden > 0 ? hidden : undefined }>
            { keyed( inline, 0 ) }

            { hidden > 0 && more( { open, toggle: () => setOpen( ( v ) => ! v ), sheet: rows } ) }

            { keyed( tail, head.length ) }
        </div>
    );
}
