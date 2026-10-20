import { useLayoutEffect, useRef, RefObject } from "react";

// FLIP reordering for a list whose children are placed by normal flow.
//
// This is what motion's `layout` prop did for the group-call grid, which is
// the one thing a plain CSS transition cannot express: when active speakers
// float to the top, the tiles change position because their ORDER changed,
// and there is no animatable property to transition between the two layouts.
//
// The technique is the standard one. After React has committed the new order
// but before the browser paints, measure each child, compare against where it
// was last commit, and if it moved, start it off translated back to the old
// position and let it travel to the new one. The transform is purely visual,
// so layout, hit-testing and scrolling all see the final positions the whole
// time.
//
// Children are matched by `data-key`, not by index — index would pair a tile
// with whichever tile now sits where it used to, and every join or leave would
// animate the entire grid.
//
// Entering children have no previous rect and are skipped, which leaves their
// own mount animation alone. Callers that also animate `transform` on the same
// element must confine that to the first render of a child, for the same
// reason group-audio-grid-item drops .bm-call-tile-entering once it has
// played: this runs on every commit, and two animations driving transform at
// once produce exactly the jitter it is here to avoid.
export default function useFlipReorder(
    containerRef: RefObject<HTMLElement | null>,
    duration = 300,
): void {
    const previous = useRef<Map<string, DOMRect>>( new Map() );
    const lastOrder = useRef<string | null>( null );
    const running = useRef<WeakMap<HTMLElement, Animation>>( new WeakMap() );

    useLayoutEffect( () => {
        const container = containerRef.current;
        if ( ! container ) return;

        const children = Array.from( container.children ) as HTMLElement[];

        // Only a genuine re-sort is animated, and only for tiles whose size did
        // not change.
        //
        // The grid re-computes every tile's dimensions from the container on
        // window resize AND on a one-second interval (group-audio-grid.tsx), so
        // for the first seconds of a call the tiles move and resize repeatedly
        // while the layout settles. Animating those reads as the tile drifting
        // around the screen — and a translate-only FLIP is simply wrong for
        // them, because the element is already the new size and would merely
        // slide in from wherever the old one used to be. The same applies to a
        // join or leave, which reflows the whole grid.
        //
        // What is left is the case this exists for: the same set of tiles, the
        // same sizes, in a different order because someone started talking.
        const order = children.map( ( child ) => child.dataset.key || "" ).join( "|" );
        const reordered = lastOrder.current !== null && order !== lastOrder.current;
        lastOrder.current = order;

        // Honour the OS setting: still measure and record, so a later re-enable
        // starts from truthful positions, but never move anything.
        const still = typeof window.matchMedia === "function"
            && window.matchMedia( "(prefers-reduced-motion: reduce)" ).matches;

        // Pass one reads, pass two writes. Interleaving getBoundingClientRect
        // with element.animate() makes the browser flush layout once per child,
        // and this effect runs on every commit — which in a call is every time
        // anyone's audio level changes.
        const measured: Array<{ el: HTMLElement, key: string, rect: DOMRect }> = [];

        for ( const child of children ) {
            const key = child.dataset.key;
            if ( ! key ) continue;
            measured.push( { el: child, key, rect: child.getBoundingClientRect() } );
        }

        if ( reordered && ! still ) {
            for ( const { el, key, rect } of measured ) {
                const before = previous.current.get( key );
                if ( ! before ) continue;

                // A tile that changed size did not simply change places.
                if ( Math.abs( before.width - rect.width ) > 1
                    || Math.abs( before.height - rect.height ) > 1 ) continue;

                const dx = before.left - rect.left;
                const dy = before.top - rect.top;

                // Sub-pixel drift from a reflow is not a reorder.
                if ( Math.abs( dx ) < 1 && Math.abs( dy ) < 1 ) continue;

                if ( typeof el.animate !== "function" ) continue;

                // A re-sort landing while the last one is still travelling would
                // otherwise leave two animations fighting over transform, and the
                // tile would jitter between the two answers.
                const inFlight = running.current.get( el );
                if ( inFlight ) inFlight.cancel();

                // Web Animations rather than a class toggle: it needs no extra
                // paint to prime the "from" state, and it cleans its own styles
                // up, so a tile removed mid-flight cannot leave a transform
                // behind.
                const animation = el.animate(
                    [
                        { transform: `translate(${ dx }px, ${ dy }px)` },
                        { transform: "none" },
                    ],
                    { duration, easing: "linear" },
                );

                running.current.set( el, animation );
                animation.finished
                    .then( () => { if ( running.current.get( el ) === animation ) running.current.delete( el ); } )
                    .catch( () => { /* cancelled by the next re-sort */ } );
            }
        }

        const next = new Map<string, DOMRect>();
        for ( const { key, rect } of measured ) next.set( key, rect );
        previous.current = next;
    } );
}
