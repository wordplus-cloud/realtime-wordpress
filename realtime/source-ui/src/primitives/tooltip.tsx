import React, { ReactElement, ReactNode, Ref, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { mergeRefs } from "react-merge-refs";
import { isMobile } from "../inc/functions/browser-info.ts";
import { host } from "../host.ts";
import { sharedTooltips, type TooltipContent } from "../inc/shared-parts.ts";

// The messenger's tooltip, drawn by the WordPlus SDK's shared floater (window.wordplusTooltips): one on the
// page for every WordPlus plugin. Wraps any single element child and clones it with hover and focus handlers.
//
// Appears the instant the pointer lands, with no entrance animation: 2.0 behaves the same way, and a tooltip
// that fades in reads as lag on a control the pointer is already over. Consumers can still pass a delay.
//
// Placement: "auto" prefers above and flips below when there is no room; force with "top" or "bottom". The
// floater keeps 8px inside every edge, slides along an edge before it wraps, and sits at whole pixels so its
// text stays sharp.
//
// Skips when label is empty or disabled, returning the child untouched, so consumers can wrap conditionally.
// Also skips on mobile (2.0's showOnMobile=false default): there is no hover on touch, so the floater would
// open on tap and sit over what the tap just opened. The aria-label is still applied.

export type TooltipSide = "auto" | "top" | "bottom";

export interface TooltipProps {
    label    : ReactNode;
    // The accessible name, when `label` is a NODE rather than a string: a tooltip showing a display name
    // renders markup (a site hangs badges off names), and an aria-label is text.
    ariaLabel? : string;
    side?    : TooltipSide;
    delay?   : number;
    children? : ReactElement;
    disabled? : boolean;
    // Anchored mode: point the floater at an element this component does not render. The consumer owns the
    // hover, so `open` is controlled and there is no child.
    anchorEl? : HTMLElement | null;
    open?     : boolean;
}

interface RefAwareElement extends ReactElement {
    ref? : Ref<HTMLElement>;
}

const REACT_19 = parseInt( React.version, 10 ) >= 19;

interface CloneProps {
    ref          : Ref<HTMLElement>;
    onMouseEnter : ( e: React.MouseEvent ) => void;
    onMouseLeave : ( e: React.MouseEvent ) => void;
    onFocus      : ( e: React.FocusEvent ) => void;
    onBlur       : ( e: React.FocusEvent ) => void;
    onClick      : ( e: React.MouseEvent ) => void;
    "aria-label" : string;
}

/** A label as the shared floater draws it: text as it is, markup through a React root of its own. */
export function tooltipContent( label: ReactNode ): TooltipContent {
    if ( typeof label === "string" || typeof label === "number" ) {
        return String( label );
    }

    return ( el ) => {
        // No box of its own: the label or the card lays out as the floater's own content.
        const holder = document.createElement( "span" );
        holder.style.display = "contents";
        el.appendChild( holder );
        const root = createRoot( holder );
        // At once, so the floater is measured with its label in it.
        flushSync( () => root.render( label ) );

        return () => root.unmount();
    };
}

export default function Tooltip( { label, ariaLabel, side = "auto", delay = 0, children, disabled, anchorEl, open: openProp }: TooltipProps ) {
    const wrapRef = useRef<HTMLElement | null>( null );
    // The element the floater shows for, while it does.
    const shown = useRef<Element | null>( null );
    // Passing the prop at all, even as null, puts this instance in anchored mode.
    const anchored = anchorEl !== undefined;
    const active = !! label && ! disabled && ! isMobile();

    const show = ( el: Element | null ) => {
        if ( ! el || ! active ) return;
        shown.current = el;
        host().whenShared( "tooltips", () => sharedTooltips()?.show( el, tooltipContent( label ), { side, delay, className: "bm-tooltip" } ) );
    };

    const hide = () => {
        const el = shown.current;
        shown.current = null;
        if ( el ) sharedTooltips()?.hide( el );
    };

    // Shown from an effect, so after React's commit: a label with markup renders into the floater at once.
    useEffect( () => {
        if ( ! anchored ) return;

        if ( openProp && anchorEl && active ) {
            const el = anchorEl;
            queueMicrotask( () => show( el ) );
        } else {
            hide();
        }
    }, [ anchored, openProp, anchorEl, label, active ] );

    // A label that changes while it shows ("Copy", then "Copied") is drawn again in place.
    useEffect( () => {
        if ( anchored || ! shown.current ) return;

        if ( ! active ) {
            hide();
            return;
        }

        const el = shown.current;
        queueMicrotask( () => show( el ) );
    }, [ label, active ] );

    useEffect( () => () => hide(), [] );

    if ( ! label || disabled ) return children ?? null;

    if ( isMobile() ) {
        if ( ! children ) return null;
        const only = React.Children.only( children ) as RefAwareElement;
        const props = ( only.props ?? {} ) as { "aria-label"? : string };
        const mobileName = ariaLabel ?? ( typeof label === "string" ? label : "" );
        return mobileName && ! props[ "aria-label" ]
            ? React.cloneElement( only as ReactElement<{ "aria-label"? : string }>, { "aria-label": mobileName } )
            : children;
    }

    // Anchored mode draws nothing of its own: the hover is the consumer's, the floater the SDK's.
    if ( anchored ) return null;

    const child = React.Children.only( children ) as RefAwareElement;
    const childProps = ( child.props ?? {} ) as Partial<CloneProps> & { "aria-label"? : string };
    const accessibleName = childProps[ "aria-label" ] ?? ariaLabel ?? ( typeof label === "string" ? label : "" );

    // React 19 keeps an element's ref among its props, and warns when `element.ref` is read; React 18 keeps it beside them.
    const childRef = REACT_19 ? ( childProps as { ref?: Ref<HTMLElement> } ).ref : child.ref;

    const cloneProps: CloneProps = {
        ref: mergeRefs( [ wrapRef, childRef ?? null ] ),
        onMouseEnter: ( e: React.MouseEvent ) => { show( wrapRef.current ); childProps.onMouseEnter?.( e ); },
        onMouseLeave: ( e: React.MouseEvent ) => { hide(); childProps.onMouseLeave?.( e ); },
        onFocus:      ( e: React.FocusEvent ) => { show( wrapRef.current ); childProps.onFocus?.( e ); },
        onBlur:       ( e: React.FocusEvent ) => { hide(); childProps.onBlur?.( e ); },
        onClick:      ( e: React.MouseEvent ) => { hide(); childProps.onClick?.( e ); },
        "aria-label": accessibleName,
    };

    return React.cloneElement( child, cloneProps );
}
