import type { ChatLoader, ChatPage } from "./use-chat.ts";

/** The app's route for the messages it kept, as a Chat loader: `?before=<id>` for the page before a message. */
export function routeLoader( route: string | null | undefined ): ChatLoader | undefined {
    if ( ! route ) return undefined;
    return async ( before ) => {
        const url = new URL( route, location.href );
        if ( before ) url.searchParams.set( 'before', before.id );
        const response = await fetch( url, { credentials: 'same-origin', headers: { Accept: 'application/json' } } );
        if ( ! response.ok ) throw new Error( `wordplus-realtime: the chat's messages route ${ route } answered ${ response.status }` );
        return ( await response.json() ) as ChatPage;
    };
}
