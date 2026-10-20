import { decode } from "html-entities";

// A display name in its two forms. A name may be markup by the time it reaches a screen (a WordPress site hangs badges
// off it), and it is also whatever its owner typed, so a screen never prints one raw:
//
//   - plainName: anything that cannot hold markup (aria-labels, alt text, a sprintf'd label);
//   - host().nameHtml(): anything that renders it, through the host's allowlist (Better Messages' keeps a site's
//     badges); by default the plain name, escaped.

/**
 * A display name as plain text: tags out, entities decoded, then tag-shaped runs out again, so a name that arrived
 * escaped can't become markup once decoded, and "Ben <3" keeps its name. As Better Messages' plainUserName().
 */
export function plainName( name: string | null | undefined ): string {
    const stripped = ( name ?? "" ).replace( /<[^>]*>/g, " " );
    const once = stripped.indexOf( "&" ) === -1 ? stripped : decode( stripped );
    return once.replace( /<\/?[a-zA-Z][^>]*>/g, " " ).replace( /\s+/g, " " ).trim();
}

/** Plain text as markup that shows it as it is. */
export function escapeHtml( text: string ): string {
    return text.replace( /&/g, "&amp;" ).replace( /</g, "&lt;" ).replace( />/g, "&gt;" ).replace( /"/g, "&quot;" ).replace( /'/g, "&#39;" );
}
