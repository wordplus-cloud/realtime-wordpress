import de from "../languages/de.json";
import es from "../languages/es.json";
import fr from "../languages/fr.json";
import it from "../languages/it.json";
import nl from "../languages/nl.json";
import pl from "../languages/pl.json";
import hr from "../languages/hr.json";
import he from "../languages/he.json";
import inApps from "../languages/in-apps.json";

// Better Messages' words an app's screens show otherwise, each key to the one in its place: a group call of Better
// Messages lives in a chat, an app's has none, so its leave button reads Leave call, not Exit Chat (an SDK review,
// 2026-10-15). scripts/languages.mjs keeps the words put in their place translated, as the screens' own.
const IN_APPS: Record<string, string> = inApps;

/** A string's key as WordPress keys it: `context\u0004text`, or the text alone. */
const keyOf = ( text: string, context?: string ) => ( context === undefined ? text : context + '\u0004' + text );

/** The text and context an app's screens show for these. */
function wordsOf( text: string, context?: string ): [ string, string | undefined ] {
    const instead = IN_APPS[ keyOf( text, context ) ];
    if ( instead === undefined ) return [ text, context ];
    const at = instead.indexOf( '\u0004' );
    return at < 0 ? [ instead, undefined ] : [ instead.slice( at + 1 ), instead.slice( 0, at ) ];
}

// The screens' own translations, for pages that aren't Better Messages' (scripts/languages.mjs keeps them): keyed as
// WordPress keys a string, `context\u0004text` or the text alone, the singular for a string with a number in it, whose
// translation is then its forms in the language's order.
type Table = Record<string, string | string[]>;

const LANGUAGES: Record<string, Table> = { de, es, fr, it, nl, pl, hr, he };

// The words of views with languages of their own, by their text domain: the live streams' (`wordplus-live-stream`) are
// registered by the views themselves (components/streams/languages.ts), so a script without them, as the elements'
// realtime-ui.min.js, carries none of their words.
const DOMAINS: Record<string, Record<string, Table>> = {};

/** Adds a text domain's languages, each language's table keyed as LANGUAGES' are. */
export function addLanguages( domain: string, tables: Record<string, Table> ): void {
    DOMAINS[ domain ] = { ...DOMAINS[ domain ], ...tables };
}

/** Which of a language's forms a number takes, as its WordPress translations' Plural-Forms say. */
const FORMS: Record<string, ( n: number ) => number> = {
    fr: ( n ) => ( n > 1 ? 1 : 0 ),
    pl: ( n ) => ( n === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 && ( n % 100 < 10 || n % 100 >= 20 ) ? 1 : 2 ),
    hr: ( n ) => ( n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && ( n % 100 < 10 || n % 100 >= 20 ) ? 1 : 2 ),
};
const twoForms = ( n: number ) => ( n === 1 ? 0 : 1 );

const RTL = new Set( [ 'he', 'ar', 'fa', 'ur' ] );

/** The two letters of a language tag (`de-DE`, `pt_BR`). */
const languageOf = ( lang: string ) => lang.trim().slice( 0, 2 ).toLowerCase();

/**
 * A host's translate() and translatePlural() for a page in `lang`: the app's own strings first, then the package's,
 * those of the string's text domain where it has its own (addLanguages()) before the shared ones, else the English.
 * The app's are keyed as the package's are, a string with a number given its forms.
 */
export function translator( lang: string, own: Table = {} ) {
    const language = languageOf( lang );
    const table = LANGUAGES[ language ] ?? {};
    const form = FORMS[ language ] ?? twoForms;
    // A domain's table read at each call, so views registered after the host was made are translated too.
    const found = ( key: string, text: string, domain?: string ) =>
        own[ key ] ?? own[ text ] ?? ( domain === undefined ? undefined : DOMAINS[ domain ]?.[ language ]?.[ key ] ) ?? table[ key ];

    return {
        translate: ( text: string, context?: string, domain?: string ): string => {
            // The app's own string for the words as written first, then the words an app's screens show.
            const [ shown, shownContext ] = wordsOf( text, context );
            const value = own[ keyOf( text, context ) ] ?? own[ text ] ?? found( keyOf( shown, shownContext ), shown, domain );
            return typeof value === 'string' ? value : Array.isArray( value ) ? value[ 0 ] : shown;
        },
        translatePlural: ( single: string, plural: string, count: number, context?: string, domain?: string ): string => {
            const value = found( keyOf( single, context ), single, domain );
            if ( Array.isArray( value ) && value.length > 0 ) return value[ Math.min( form( count ), value.length - 1 ) ];
            return count === 1 ? single : plural;
        },
    };
}

/** Which way a page in `lang` reads. */
export function direction( lang: string ): 'ltr' | 'rtl' {
    return RTL.has( languageOf( lang ) ) ? 'rtl' : 'ltr';
}
