import { host } from "../host.ts";

// The screens' strings, written as Better Messages writes them (the text, a context, and its text domain), so its
// extract-translations.js finds them in this package's source and WordPress translates them on its sites. Everywhere
// else the host translates them, from the package's own languages/ by default. The domain goes to the host too: the
// call screens write `bp-better-messages` and the live streams `wordplus-stream`, so a host translating both products'
// words looks each up in its own.

export function __( text: string, domain?: string ): string {
    return host().translate( text, undefined, domain );
}

export function _x( text: string, context: string, domain?: string ): string {
    return host().translate( text, context, domain );
}

export function _n( single: string, plural: string, count: number, domain?: string ): string {
    return host().translatePlural( single, plural, count, undefined, domain );
}

export function _nx( single: string, plural: string, count: number, context: string, domain?: string ): string {
    return host().translatePlural( single, plural, count, context, domain );
}

/** `%s` and `%d` filled in order, and `%1$s`-style placeholders by position, as WordPress's sprintf. */
export function sprintf( format: string, ...args: Array<string | number> ): string {
    let next = 0;

    return format.replace( /%(?:(\d+)\$)?([sd%])/g, ( match, position: string | undefined, type: string ) => {
        if ( type === "%" ) return "%";

        const value = args[ position ? Number( position ) - 1 : next++ ];

        if ( value === undefined ) return match;

        return type === "d" ? String( Math.trunc( Number( value ) ) ) : String( value );
    } );
}

export function applyFilters<T>( name: string, value: T, ...args: unknown[] ): T {
    return host().applyFilters( name, value, ...args );
}
