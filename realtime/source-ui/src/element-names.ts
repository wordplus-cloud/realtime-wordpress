// The elements' names on a page. Ours are plain words (`<chat-room>`, `<call-button>`, `<live-stream>`), so a page
// names no one but the app. A page may give them a prefix of its own, which goes before each (`shop` makes
// `<shop-chat-room>`), for markup that is all its own, or where another script on the page has a name of ours.
//
// One prefix a page, as the script runs: `data-prefix` on its own tag (`<script src="…/realtime-ui.min.js"
// data-prefix="shop">`, which @wordplus/realtime's callScreen(), ui() and streamScreen() set from `screen.prefix`), else
// the page's config (`window.wordplusRealtimeConfig.screen.prefix`, as a WordPress site's filter sets it). Both the call
// screen's script and the live streams' read it here.

/** An element class of ours: its plain name in `tag`. */
export type OurElement = CustomElementConstructor & { readonly tag: string };

/** What marks a definition of ours, made by any copy of this script on the page. */
const OURS = Symbol.for( "wordplus.realtime-ui.element" );

/** The prefix given, when it makes valid names: lowercase letters and digits, hyphens between them. '' otherwise. */
export function validPrefix( given: unknown ): string {
    if ( typeof given !== "string" || given === "" ) return "";
    if ( /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test( given ) ) return given;
    console.warn( "wordplus-realtime: the elements' prefix " + JSON.stringify( given ) + " is not one: lowercase letters and digits, starting with a letter, hyphens between them (shop, my-shop). The elements keep their own names." );
    return "";
}

/** The page's prefix, from the script's tag or the page's config, as the script runs: '' for none. */
function pagePrefix(): string {
    if ( typeof document === "undefined" ) return "";
    const script = document.currentScript;
    const own = script && "dataset" in script ? ( script as HTMLScriptElement ).dataset.prefix : undefined;
    const config = ( globalThis as Record<string, any> ).wordplusRealtimeConfig?.screen?.prefix;
    return validPrefix( own ?? config );
}

/** The prefix the page gave as this script ran. */
export const loadPrefix: string = pagePrefix();

/** An element's name with the page's prefix: `chat-room`, or `shop-chat-room`. */
export function nameOf( tag: string, prefix: string ): string {
    return prefix ? prefix + "-" + tag : tag;
}

/** Whether the name is free, or defined by a copy of this script. */
export function ours( name: string ): boolean {
    const defined = typeof customElements === "undefined" ? undefined : customElements.get( name );
    return ! defined || OURS in defined;
}

/**
 * Defines the elements under their names for the prefix. A name defined already stays as it is: by another copy of this
 * script, as on a page where two plugins carry it, quietly; by another script, with a word on the console, as the page
 * then shows that script's element where it meant ours.
 */
export function defineElements( elements: readonly OurElement[], prefix: string ): void {
    if ( typeof customElements === "undefined" ) return;
    for ( const element of elements ) {
        const name = nameOf( element.tag, prefix );
        const defined = customElements.get( name );
        if ( defined ) {
            if ( ! ( OURS in defined ) ) {
                console.warn( "wordplus-realtime: <" + name + "> is another script's element on this page, so ours is not drawn there. " + ( prefix
                    ? "Give ours another prefix (data-prefix on the script, or screen.prefix in connect())."
                    : "Give ours a prefix of your own, which goes before each name: data-prefix=\"shop\" on the script, or screen.prefix in connect(), makes it <shop-" + element.tag + ">." ) );
            }
            continue;
        }
        // A class of its own for each name, as a page may hold the plain names and a prefix's.
        const own = class extends ( element as unknown as typeof HTMLElement ) {};
        Object.defineProperty( own, OURS, { value: true } );
        customElements.define( name, own );
    }
}
