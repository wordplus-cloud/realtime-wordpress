// Where a floating element is allowed to sit.
//
// Every popover, menu and tooltip in 3.0 keeps the same clearance from the
// same edges, and they all measure it the same way — one place to change,
// and no floater quietly using a different rule.
//
// The measure is the LAYOUT viewport (documentElement.clientWidth/Height),
// not window.innerWidth/innerHeight. The window values include the classic
// scrollbar, so a floater clamped against them is placed under it and past
// the visible edge — on a 1400px window with a 15px bar, up to 15px out.
// A position:fixed box is laid out in the layout viewport, so this is also
// the box it is actually being placed in. `100vw` in CSS has the same flaw,
// which is why widths derived from this are written as px.

/** Clearance kept between a floating element and every viewport edge. */
export const VIEWPORT_EDGE = 8;

export interface ViewportSize {
    width  : number;
    height : number;
}

export function viewportSize(): ViewportSize {
    const doc = document.documentElement;
    return {
        width:  doc.clientWidth  || window.innerWidth,
        height: doc.clientHeight || window.innerHeight,
    };
}

export interface ClampedPosition {
    left : number;
    top  : number;
}

/**
 * Pull a box of `w` × `h` back inside the viewport, keeping `edge` clear on
 * every side, and pixel-snap it.
 *
 * The low bound is applied last on purpose: when the box is larger than the
 * space available it stays pinned to the top/left edge rather than being
 * pushed off the opposite one.
 */
export function clampToViewport(
    left : number,
    top  : number,
    w    : number,
    h    : number,
    edge : number = VIEWPORT_EDGE,
): ClampedPosition {
    const { width, height } = viewportSize();
    return {
        left: Math.round( Math.max( edge, Math.min( width  - edge - w, left ) ) ),
        top:  Math.round( Math.max( edge, Math.min( height - edge - h, top  ) ) ),
    };
}

/**
 * A 0×0 `position: fixed` marker at (0, 0), for finding out where fixed
 * positioning actually starts.
 *
 * `top: 0` on a fixed box and `getBoundingClientRect().top === 0` are
 * supposed to describe the same place — that equivalence is the whole appeal
 * of fixed positioning for a floater, which is measured against a trigger's
 * rect and then placed by style. Two ordinary things break it:
 *
 *   - a transform, filter or perspective on <body> or <html> makes that
 *     element the containing block for every fixed descendant, so a floater
 *     portaled to <body> is placed in DOCUMENT space and sits off by the
 *     page's scroll offset. Themes do this to <body> more often than anyone
 *     would like.
 *   - iOS moves the page out from under an open on-screen keyboard, and the
 *     two spaces come apart by however far it moved. Nothing reports this;
 *     the keyboard is not a first-class citizen of any layout API.
 *
 * Neither is predictable, so measure instead: subtract this marker's rect
 * from a target expressed in rect coordinates and the floater lands exactly
 * where the arithmetic meant it to, whatever the browser is doing.
 *
 * A separate marker rather than measuring the floater itself, because a
 * floater's entrance animation IS a transform and getBoundingClientRect()
 * includes it — measuring mid-animation bakes the keyframe's offset into the
 * position it settles at.
 */
export function createFixedProbe(): HTMLElement {
    const probe = document.createElement( "div" );
    probe.setAttribute( "aria-hidden", "true" );
    // visibility, never display:none — a display:none box measures 0,0 and
    // would report every space as agreeing.
    probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none";
    document.body.appendChild( probe );

    return probe;
}

/** Where fixed (0, 0) lands, per the marker. Zero when there is no marker. */
export function fixedOrigin( probe: HTMLElement | null ): ClampedPosition {
    if ( ! probe ) return { left: 0, top: 0 };
    const r = probe.getBoundingClientRect();

    return { left: r.left, top: r.top };
}

/**
 * The box of the element a floater is pinned to, or null when there is
 * nothing left to measure.
 *
 * A trigger can leave the page while the floater it opened is still up — the
 * message hover strip unmounts the moment the pointer crosses from the bubble
 * onto the menu. A detached node measures 0×0, which is not a position to
 * follow: a floater placed against it lands in the top-left corner. Null
 * means "stop following and stay where you are".
 */
export function liveAnchorRect( anchor?: HTMLElement | null ): DOMRect | null {
    if ( ! anchor || ! anchor.isConnected ) return null;
    const r = anchor.getBoundingClientRect();
    return ( r.width > 0 || r.height > 0 ) ? r : null;
}

/** The widest a floating element may be before it has to wrap or scroll. */
export function availableWidth( edge: number = VIEWPORT_EDGE ): number {
    return viewportSize().width - edge * 2;
}
