import React, {cloneElement, JSX, memo} from "react";
import parse from "html-react-parser";
import {stripHtml} from "string-strip-html";
import {isMobile} from "../../inc/functions/browser-info.ts";
import BaseTooltip, {TooltipSide} from "../../primitives/tooltip.tsx";

// Compatibility adapter over the ONE shared tooltip primitive
// (src/main/primitives/tooltip.tsx) — every tooltip in the plugin renders
// through it, so the look, delay, and animation are identical everywhere.
// This wrapper only translates the v2 prop surface (HTML-string content,
// floating-ui placement names, the mobile gate) for the call/message-era
// call sites that still use it. New code imports the primitive directly.

// floating-ui's Placement, spelled out. The package is gone from the
// bundle, and nothing was worth keeping a dependency for a union of
// strings the call sites only ever write as literals.
type Placement =
    | "top"    | "top-start"    | "top-end"
    | "right"  | "right-start"  | "right-end"
    | "bottom" | "bottom-start" | "bottom-end"
    | "left"   | "left-start"   | "left-end";

interface Props {
    content: string,
    placement?: Placement,
    children: JSX.Element,
    disabled?: boolean,
    showOnMobile?: boolean
    longHover?: JSX.Element
    longHoverTimeout?: number
    zIndex?: number
}

function sideFromPlacement( placement: Placement | undefined ): TooltipSide {
    if ( ! placement ) return "top";
    if ( placement.startsWith( "bottom" ) ) return "bottom";
    if ( placement.startsWith( "top" ) ) return "top";
    return "auto";
}

// The icon controls of the call screens are spans and divs with an onClick (a native <button> cannot be styled inside a
// WordPress site, see Btn), so a keyboard and a screen reader could not reach them (an SDK review, 2026-10-14). As
// Btn does for its own: a button role, a place in the Tab order, and Enter and Space pressing it through a real
// click, so one onClick serves pointer and keyboard. What says otherwise itself (a role, a tabIndex) is kept.
function asControl( child: JSX.Element ): Record<string, unknown> {
    const props = ( child.props ?? {} ) as { onClick?: unknown; role?: string; tabIndex?: number; onKeyDown?: ( e: React.KeyboardEvent<HTMLElement> ) => void };
    if ( ( child.type !== "span" && child.type !== "div" ) || typeof props.onClick !== "function" ) return {};
    return {
        role: props.role ?? "button",
        tabIndex: props.tabIndex ?? 0,
        onKeyDown: ( e: React.KeyboardEvent<HTMLElement> ) => {
            props.onKeyDown?.( e );
            if ( e.defaultPrevented || ( e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar" ) ) return;
            // Only the control itself: a key that bubbled up from a field inside it presses nothing.
            if ( e.currentTarget !== e.target ) return;
            e.preventDefault();
            e.currentTarget.click();
        },
    };
}

function Tooltip ({ children, content, placement = "top", disabled = false, showOnMobile = false } : Props) {
    // v2 sites lean on the tooltip for the accessible name of icon-only
    // controls, so keep stamping it (never overriding an explicit one).
    const labelled = cloneElement( children, {
        ...children.props,
        ...( children.props[ "aria-label" ] ? {} : { "aria-label": stripHtml( content ).result } ),
        ...asControl( children ),
    } );

    if ( content === '' || ( showOnMobile === false && isMobile() ) ) {
        return labelled;
    }

    return (
        <BaseTooltip label={ parse( content ) } side={ sideFromPlacement( placement ) } disabled={ disabled }>
            { labelled }
        </BaseTooltip>
    );
}

export default memo(Tooltip);
