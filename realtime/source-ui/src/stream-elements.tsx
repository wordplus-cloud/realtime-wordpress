// @wordplus/realtime-ui's live stream elements: Easy Stream's player, chat and studio on any page, with no code but
// elements, on the page's calls (`calls.stream()`: the app's `streams()` rule makes the page's user a host or a viewer).
//
//     <live-stream name="show:42" title="New mugs"></live-stream>         the stream in one piece: the player, its chat
//                                                                       beside it, the studio for its host
//     <live-stream name="show:42" view="player"></live-stream>            or its parts, each where the page puts it:
//     <live-stream name="show:42" view="chat" height="480"></live-stream> player, chat, details, studio
//     <stream-studio name="show:42"></stream-studio>                      the studio alone, which only a host sees
//
// The elements of one stream share one join, one chat and the player's state, however many there are. The script
// (dist/realtime-ui-streams.min.js, window.wordplusRealtimeStreams) is apart from the call screen's realtime-ui.min.js,
// so a page with calls alone never carries the live streams' views: @wordplus/realtime's rt.streamScreen() loads it. The
// views draw in the page itself, as Easy Stream's do on any site: their classes are all `estream-`, and their
// stylesheet goes into the page's head once. A page's prefix for the elements' names goes before these too
// (element-names.ts): `shop` makes `<shop-live-stream>`.
import { createRoot, type Root } from "react-dom/client";
import type { EasyStreamClient } from "@wordplus/realtime-client/streams";
import { EasyStreamParts, PART_NAMES, VIDEO_PARTS, type Part, type PartName, type PartOptions } from "./components/streams/parts.tsx";
import { errorText } from "./components/streams/words.ts";
import { configureUi } from "./host.ts";
import { direction, translator } from "./inc/translations.ts";
import { defineElements, loadPrefix, validPrefix } from "./element-names.ts";
import type { SdkCalls, SdkStream } from "./sdk/types.ts";
import css from "virtual:streams-css";

export interface StreamElementsSettings {
    /** The page's language, two letters: the views' own translations (de es fr it nl pl hr he). The page's by default. */
    lang?: string;
    /** The app's own translations, by the English text, over the package's. */
    strings?: Record<string, string | string[]>;
    /** The page's prefix for the elements' names, as the call screen's script takes it: `shop` makes `<shop-live-stream>`. */
    prefix?: string;
}

/** The parts an element may be: the stream in one piece (`all`), or one of its parts. */
const PARTS: readonly PartName[] = PART_NAMES.filter( ( name ) => [ "all", "player", "chat", "details", "studio" ].includes( name ) );

let lang = "en";
let started = false;

/** The page's calls, as the SDK shares them (`window.wordplusRealtimeCalls.page()`): null on a page without them. */
function pageCalls(): SdkCalls | null {
    const api = ( globalThis as Record<string, any> ).wordplusRealtimeCalls as { page?: () => { calls: SdkCalls | null } | null } | undefined;
    return api?.page?.()?.calls ?? null;
}

/** The streams' stylesheet, once in the page's head. */
function styled(): void {
    if ( document.getElementById( "realtime-ui-streams" ) ) return;
    const style = document.createElement( "style" );
    style.id = "realtime-ui-streams";
    style.textContent = css;
    document.head.append( style );
}

/**
 * Starts the elements on this page, in its language: each stream they name is joined on the page's calls. False on a
 * page without calls, where they wait for a later start. Started already, it takes the settings given now.
 */
export function start( settings: StreamElementsSettings = {} ): boolean {
    const given = ( ( globalThis as Record<string, any> ).wordplusRealtimeConfig?.screen ?? {} ) as StreamElementsSettings;
    define( settings.prefix ?? given.prefix );
    lang = settings.lang ?? given.lang ?? ( document.documentElement.lang || "en" );
    configureUi( translator( lang, { ...given.strings, ...settings.strings } ) );
    styled();
    if ( ! pageCalls() ) return false;
    started = true;
    for ( const group of groups.values() ) draw( group );
    return true;
}

/** Starts by itself once the page is ready, on a page that has its calls (a WordPress page's calls script). */
export function autoStart(): void {
    if ( typeof document === "undefined" ) return;
    if ( document.readyState === "loading" ) document.addEventListener( "DOMContentLoaded", () => start(), { once: true } );
    else queueMicrotask( () => void start() );
}

// One stream's elements: one join, one React tree drawing each part in its element, and a layer for the dialogs that
// belong to no part.
interface Group {
    name: string;
    elements: Set<StreamElement>;
    stream: SdkStream | null;
    error: string | null;
    joining: boolean;
    holder: HTMLDivElement;
    dialogs: HTMLDivElement;
    root: Root;
}

const groups = new Map<string, Group>();

function groupOf( name: string ): Group {
    let group = groups.get( name );
    if ( group ) return group;
    const holder = document.createElement( "div" );
    holder.className = "realtime-stream";
    const tree = document.createElement( "div" );
    const dialogs = document.createElement( "div" );
    holder.append( tree, dialogs );
    document.body.append( holder );
    group = { name, elements: new Set(), stream: null, error: null, joining: false, holder, dialogs, root: createRoot( tree ) };
    groups.set( name, group );
    return group;
}

/** The first of a group's elements that has the attribute. */
function attribute( group: Group, name: string ): string | undefined {
    for ( const element of group.elements ) {
        const value = element.getAttribute( name );
        if ( value !== null && value !== "" ) return value;
    }
    return undefined;
}

/** Joins the group's stream once, then draws it; draws it again as its elements change. */
function draw( group: Group ): void {
    if ( ! started || group.elements.size === 0 ) return;
    const parts = [ ...group.elements ].map( ( element ) => element.view );
    const video = parts.some( ( part ) => VIDEO_PARTS.includes( part ) );

    if ( ! group.stream && ! group.error ) {
        if ( group.joining ) return;
        const calls = pageCalls();
        if ( ! calls?.stream ) return;
        group.joining = true;
        calls.stream( group.name, { video } ).then( ( stream ) => {
            group.joining = false;
            if ( groups.get( group.name ) !== group ) return stream.leave();
            group.stream = stream;
            draw( group );
        }, ( error: { code?: string } ) => {
            group.joining = false;
            group.error = error?.code ?? "server";
            draw( group );
        } );
        return;
    }

    for ( const element of group.elements ) element.mount.dir = direction( lang );
    group.dialogs.dir = direction( lang );

    if ( group.error ) {
        // No stream to draw: what kept it away, in each element.
        group.root.render( null );
        for ( const element of group.elements ) element.refused( errorText( group.error ) );
        return;
    }

    const client = group.stream!.engine as EasyStreamClient;
    // A part with the picture came after a join without it.
    if ( video ) client.wantVideo();
    const chat = attribute( group, "chat" );
    group.root.render(
        <EasyStreamParts
            client={ client }
            manage={ false }
            parts={ [ ...group.elements ].map( ( element ): Part => ( { key: element.key, element: element.mount, name: element.view, options: element.options() } ) ) }
            dialogs={ group.dialogs }
            title={ attribute( group, "title" ) }
            cover={ attribute( group, "cover" ) }
            url={ attribute( group, "url" ) }
            loginUrl={ attribute( group, "login-url" ) }
            studioUrl={ attribute( group, "studio-url" ) }
            chat={ chat !== "off" && chat !== "false" }
        />,
    );
}

/** Takes an element out of its group; the last to go leaves the stream, a moment later, so a moved element keeps it. */
function release( group: Group, element: StreamElement ): void {
    group.elements.delete( element );
    queueMicrotask( () => {
        if ( group.elements.size > 0 ) return draw( group );
        if ( groups.get( group.name ) !== group ) return;
        groups.delete( group.name );
        group.root.unmount();
        group.holder.remove();
        group.stream?.leave();
    } );
}

let keys = 0;

/** `<live-stream name="show:42" view="player">`: a stream, or one of its parts. */
class StreamElement extends HTMLElement {
    static readonly tag: string = "live-stream";
    static readonly observedAttributes = [ "name", "view", "title", "cover", "url", "login-url", "studio-url", "chat", "height", "sticky" ];
    readonly key = "s" + ++keys;
    /** Where its part draws: React's, so only React empties it. */
    mount = document.createElement( "div" );
    private group: Group | null = null;

    get view(): PartName {
        const view = this.getAttribute( "view" ) as PartName | null;
        return view && PARTS.includes( view ) ? view : "all";
    }

    options(): PartOptions {
        const height = Number( this.getAttribute( "height" ) );
        return {
            ...( Number.isFinite( height ) && height > 0 ? { height } : {} ),
            ...( this.hasAttribute( "sticky" ) ? { sticky: true } : {} ),
        };
    }

    /** What kept the stream away, in place of its views. */
    refused( text: string ): void {
        const note = document.createElement( "p" );
        note.className = "estream-theme estream-part estream-part--refused";
        note.textContent = text;
        this.mount.replaceChildren( note );
    }

    connectedCallback(): void {
        if ( this.mount.parentNode !== this ) this.replaceChildren( this.mount );
        const name = this.getAttribute( "name" );
        if ( ! name ) return;
        this.group = groupOf( name );
        this.group.elements.add( this );
        draw( this.group );
    }

    disconnectedCallback(): void {
        if ( this.group ) release( this.group, this );
        this.group = null;
    }

    attributeChangedCallback( attribute: string, before: string | null, now: string | null ): void {
        if ( ! this.isConnected || before === now ) return;
        if ( attribute === "name" ) {
            // Another stream: a place of its own, the old one left to the old stream's tree to empty.
            this.disconnectedCallback();
            const fresh = document.createElement( "div" );
            this.mount.replaceWith( fresh );
            this.mount = fresh;
            this.connectedCallback();
        } else if ( this.group ) {
            draw( this.group );
        }
    }
}

/** `<stream-studio name="show:42">`: the stream's studio, where its host goes live; nothing for anyone else. */
class StudioElement extends StreamElement {
    static readonly tag = "stream-studio";

    get view(): PartName {
        return "studio";
    }
}

/** The page's prefix for the elements' names (element-names.ts): '' for their own. */
let prefix = loadPrefix;

/**
 * The elements, once on the page whichever copy of the script runs first, under their names for the page's prefix, or
 * for the one given (which the page keeps from then on).
 */
export function define( given?: string ): void {
    if ( given !== undefined ) prefix = validPrefix( given );
    defineElements( [ StreamElement, StudioElement ], prefix );
}

define();
autoStart();
