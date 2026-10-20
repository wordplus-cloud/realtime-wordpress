import type { TooltipContent, TooltipOptions, Tooltips } from "./shared-parts.ts";

// The package's own tooltip floater, for a page without the WordPlus SDK's (window.wordplusTooltips): the elements
// script sets it, so a call's controls say what they do in any app. Where the SDK's floater is on the page, the screens
// use that one instead. The floater goes in its anchor's own root, so a shadow root's styles (.realtime-tooltip in
// styles/_elements.scss) reach it.
//
// "auto" sits above and flips below when there is no room; "top" and "bottom" force it; "left" and "right" sit beside.
// It keeps 8px inside every edge and sits at whole pixels, so its text stays sharp.

const EDGE = 8;

export function ownTooltips(): Tooltips {
    let box: HTMLDivElement | null = null;
    let anchor: Element | null = null;
    let side: TooltipOptions[ "side" ] = "auto";
    let gap = 6;
    let cleanup: void | ( () => void );
    let timer: ReturnType<typeof setTimeout> | undefined;

    const place = () => {
        if ( ! box || ! anchor ) return;
        if ( ! anchor.isConnected ) return hide();

        const a = anchor.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const width = window.innerWidth;
        const height = window.innerHeight;
        const clamp = ( value: number, max: number ) => Math.max( EDGE, Math.min( value, max - EDGE ) );
        let left: number;
        let top: number;

        if ( side === "left" || side === "right" ) {
            const before = a.left - gap - b.width;
            const after = a.right + gap;
            const fitsAfter = after + b.width <= width - EDGE;
            const fitsBefore = before >= EDGE;
            left = side === "left" ? ( fitsBefore || ! fitsAfter ? before : after ) : ( fitsAfter || ! fitsBefore ? after : before );
            left = clamp( left, width - b.width );
            top = clamp( a.top + a.height / 2 - b.height / 2, height - b.height );
        } else {
            const above = a.top - gap - b.height;
            const below = a.bottom + gap;
            top = side === "bottom" || ( side !== "top" && above < EDGE ) ? below : above;
            top = clamp( top, height - b.height );
            left = clamp( a.left + a.width / 2 - b.width / 2, width - b.width );
        }

        box.style.left = Math.round( left ) + "px";
        box.style.top = Math.round( top ) + "px";
    };

    const hide = ( el?: Element | null ) => {
        if ( el && el !== anchor ) return;
        clearTimeout( timer );
        if ( typeof cleanup === "function" ) cleanup();
        cleanup = undefined;
        box?.remove();
        box = null;
        anchor = null;
        window.removeEventListener( "scroll", place, true );
        window.removeEventListener( "resize", place );
    };

    const show = ( el: Element, content: TooltipContent, options: TooltipOptions = {} ) => {
        hide();
        anchor = el;
        side = options.side ?? "auto";
        gap = options.gap ?? 6;

        const open = () => {
            if ( anchor !== el || ! el.isConnected ) return;

            box = document.createElement( "div" );
            box.className = "realtime-tooltip" + ( options.className ? " " + options.className : "" );
            box.setAttribute( "role", "tooltip" );
            for ( const [ name, value ] of Object.entries( options.attributes ?? {} ) ) box.setAttribute( name, value );
            for ( const [ name, value ] of Object.entries( options.style ?? {} ) ) box.style.setProperty( name, value );

            if ( typeof content === "string" ) box.textContent = content;
            else if ( content instanceof Node ) box.appendChild( content );

            const root = el.getRootNode();
            ( root instanceof ShadowRoot ? root : document.body ).appendChild( box );
            if ( typeof content === "function" ) cleanup = content( box );

            place();
            window.addEventListener( "scroll", place, true );
            window.addEventListener( "resize", place );
        };

        if ( options.delay ) timer = setTimeout( open, options.delay );
        else open();
    };

    return {
        get canHover() {
            return typeof matchMedia === "function" && matchMedia( "(hover: hover)" ).matches;
        },
        show,
        hide,
        place,
    };
}
