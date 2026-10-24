// @wordplus/realtime-ui's elements: Better Messages' call screens and presence on any page, with no code but elements,
// and the ring for the page's user wherever they are.
//
//     <call-button to="34" call="support:34:42" type="video" name="Ann" avatar="https://…">Call Ann</call-button>
//     <room-button room="meeting:daily" type="video" title="Daily meeting">Join the meeting</room-button>
//     <online-list room="shop" call="support:{pair}" type="video"></online-list>
//     <typing-line room="chat:34:42"></typing-line>
//     <online-count room="shop"></online-count>
//     <chat-room room="chat:34:42" style="height: 520px"></chat-room>
//     <call-spot call="support:{a}:{b}" style="height: 420px"></call-spot>   the call in the page, not in the corner
//
// The script (dist/realtime-ui.min.js, window.wordplusRealtimeUi) carries React inside and draws in a shadow root of
// its own, so neither the page's styles nor its React reach in. @wordplus/realtime's rt.callScreen() loads it the first
// time a page asks for the call screen, and starts it on the page's calls.
import React, { type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { configureUi, setUiUsers } from "./host.ts";
import { controllerFor, showingName, type CallsController, type OwnedCall } from "./sdk/controller.ts";
import CallsApp, { type CallView } from "./sdk/calls-app.tsx";
import { callUserOf, type CallUser, type SdkCalls } from "./sdk/types.ts";
import { callName } from "./sdk/call-name.ts";
import { MayCall } from "./sdk/may-call.tsx";
import { PageCalls } from "./sdk/use-controller.ts";
import { routeLoader } from "./sdk/route-loader.ts";
import type { SdkRooms } from "./sdk/rooms.ts";
import { RoomCount, RoomOnline, RoomTyping, type RoomCountProps, type RoomOnlineProps, type RoomPerson, type RoomTypingProps } from "./sdk/presence-views.tsx";
import { Chat, type ChatLoader, type ChatPage, type ChatProps } from "./sdk/chat.tsx";
import { RowAction } from "./components/presence/online-list.tsx";
import { _x } from "./inc/globals.ts";
import { translator, direction } from "./inc/translations.ts";
import { setOwnTooltips } from "./inc/shared-parts.ts";
import { ownTooltips } from "./inc/floater.ts";
import { PiecesProvider, type Pieces } from "./pieces.tsx";
import { templatePieces } from "./templates.tsx";
import { defineElements, loadPrefix, nameOf, ours, validPrefix } from "./element-names.ts";
// The stylesheet the build makes for a shadow root (tokens on :host): see scripts/build.mjs.
import css from "virtual:elements-css";

export interface ElementsSettings {
    /**
     * The page's language, two letters: the screens' own translations (de es fr it nl pl hr he). The page's `lang`
     * by default.
     */
    lang?: string;
    /**
     * Translations of the app's own, by the English text (or `context\u0004text`), over the package's; for a string
     * with a number in it, its forms in the language's order, keyed by the singular.
     */
    strings?: Record<string, string | string[]>;
    /** Offer Add Person, where the app lists whom a user may add (the server's `calls()` with `people`). */
    add?: boolean;
    /**
     * The page's prefix for the elements' names, which goes before each: `shop` makes `<shop-call-button>` and
     * `<shop-chat-room>`. Read as the script runs, from `data-prefix` on its tag or the page's config; one given only
     * here defines its names from now on, beside those the script defined as it ran.
     */
    prefix?: string;
}

/**
 * The views the elements draw, where an app's own script carries its copies (`npx @wordplus/realtime-ui add`, its
 * wordplus-ui.elements.tsx): its call view, its online list, typing line, count and chat, and pieces for every element.
 */
export interface ElementViews {
    CallView?: CallView;
    OnlineList?: ComponentType<RoomOnlineProps>;
    Typing?: ComponentType<RoomTypingProps>;
    OnlineCount?: ComponentType<RoomCountProps>;
    Chat?: ComponentType<ChatProps>;
    components?: Pieces;
}

let views: ElementViews = {};

/** Draws the app's own views in place of ours, from now on: called by an app's own elements script before it starts. */
export function setViews( given: ElementViews ): void {
    views = { ...views, ...given };
    for ( const element of presence ) element.render();
}

let controller: CallsController | null = null;
let mount: HTMLDivElement | null = null;

/** The page's calls, as the SDK shares them (`window.wordplusRealtimeCalls.page()`): null on a page without them. */
function pageCalls(): SdkCalls | null {
    const api = ( globalThis as Record<string, any> ).wordplusRealtimeCalls as { page?: () => { calls: SdkCalls } | null } | undefined;
    return api?.page?.()?.calls ?? null;
}

/**
 * Starts the screens on this page: the ring for the page's user, and the call window. False on a page without calls.
 * Started already (the script starts itself on a page that has its calls), it takes the settings given now.
 */
export function start( settings: ElementsSettings = {} ): boolean {
    // The language and the tooltips first: the presence elements draw on a page with or without calls.
    const given = ( ( globalThis as Record<string, any> ).wordplusRealtimeConfig?.screen ?? {} ) as ElementsSettings;
    define( settings.prefix ?? given.prefix );
    lang = settings.lang ?? given.lang ?? ( document.documentElement.lang || 'en' );
    configureUi( translator( lang, { ...given.strings, ...settings.strings } ) );
    // The controls' tooltips, from the WordPlus SDK's floater where the page has it, else the package's own.
    if ( ! tooltipsSet ) {
        setOwnTooltips( ownTooltips() );
        tooltipsSet = true;
    }
    for ( const element of presence ) element.render();

    const calls = pageCalls();
    if ( ! controller && ! calls ) return false;

    if ( controller ) {
        controller.setAdd( settings.add ?? given.add );
        if ( mount ) mount.dir = direction( lang );
        return true;
    }

    controller = controllerFor( calls!, { add: settings.add ?? given.add } );
    // The plugins' claims made before the page had its calls (own()).
    for ( const claim of claims ) claim.release = controller.own( claim.pattern, claim.take );

    // The page's own `<call-screen>`, holding the templates of its pieces (templates.tsx), or one of ours: a plain
    // `<div>` where the name is another script's element.
    const tag = nameOf( CallScreenElement.tag, prefix );
    const written = ours( tag ) ? document.querySelector( tag ) : null;
    const holder = written && ! written.shadowRoot ? written : document.body.appendChild( document.createElement( ours( tag ) ? tag : 'div' ) );
    const shadow = holder.attachShadow( { mode: 'open' } );
    styled( shadow );
    schemeOf( holder );
    mount = document.createElement( 'div' );
    mount.className = 'realtime-calls';
    mount.dir = direction( lang );
    shadow.append( mount );
    createRoot( mount ).render( <PiecesProvider pieces={ { ...views.components, ...templatePieces( holder ) } }>
        <CallsApp controller={ controller } view={ views.CallView } />
    </PiecesProvider> );
    // The spots on the page before it had its calls, and the chats that hold their call.
    for ( const spot of spots ) spot.claim();
    for ( const element of presence ) if ( element instanceof ChatElement ) element.render();

    return true;
}

let lang = 'en';
let tooltipsSet = false;
let sheet: CSSStyleSheet | null | undefined;

/** The plugins' claims on calls by name, kept so a claim made before the page had its calls takes hold once it does. */
const claims: Array<{ pattern: string; take: ( call: OwnedCall ) => void; release?: () => void }> = [];

/**
 * A plugin's own screen for the calls it declares (`wordplusRealtimeUi.own( 'support:{a}:{b}', ( call ) => … )`): their
 * rings, the calls `<call-button>` places and the group calls `<room-button>` joins come to `take`, in place of our
 * screen, as the SDK's own objects (`call.kind`: `ring`, `call` or `group`). Better Messages' calls are its own and
 * never come here. Answers a function that takes the claim back.
 */
export function own( pattern: string, take: ( call: OwnedCall ) => void ): () => void {
    const claim: ( typeof claims )[ number ] = { pattern, take };
    claims.push( claim );
    if ( controller ) claim.release = controller.own( pattern, take );
    return () => {
        claim.release?.();
        claims.splice( claims.indexOf( claim ), 1 );
    };
}

/** The elements' stylesheet in a shadow root: one constructed sheet for every root, where the browser has them. */
function styled( root: ShadowRoot ): void {
    if ( sheet === undefined ) {
        try {
            sheet = new CSSStyleSheet();
            sheet.replaceSync( css );
        } catch {
            sheet = null;
        }
    }
    if ( sheet && 'adoptedStyleSheets' in root ) {
        root.adoptedStyleSheets = [ sheet ];
        return;
    }
    const style = document.createElement( 'style' );
    style.textContent = css;
    root.append( style );
}

// Light and dark follow the system unless the page says which: `bm-messages-light` or `bm-messages-dark` on its body, as
// for Better Messages' screens, or a `color-scheme` of one alone (`color-scheme: light` on a page drawn only light). No
// body reaches into a shadow root, so each element carries the answer as `data-scheme`, which its tokens read (the
// build's hostOf()), and takes it again when the page's html or body changes and once the page has its styles.
const schemed = new Set<Element>();
let schemeWatch: MutationObserver | null = null;

function pageScheme( host: Element ): 'light' | 'dark' | null {
    const body = document.body?.classList;
    if ( body?.contains( 'bm-messages-light' ) ) return 'light';
    if ( body?.contains( 'bm-messages-dark' ) ) return 'dark';
    const named = String( getComputedStyle( host ).colorScheme ?? '' ).split( /\s+/ ).filter( ( w ) => w === 'light' || w === 'dark' );
    return named.length === 1 ? named[ 0 ] as 'light' | 'dark' : null;
}

function followScheme( host: Element ): void {
    const scheme = pageScheme( host );
    if ( scheme === null ) host.removeAttribute( 'data-scheme' );
    else if ( host.getAttribute( 'data-scheme' ) !== scheme ) host.setAttribute( 'data-scheme', scheme );
}

/** Keeps `host` in the page's light or dark, or stops when `on` is false. */
function schemeOf( host: Element, on = true ): void {
    if ( ! on ) {
        schemed.delete( host );
        return;
    }
    schemed.add( host );
    followScheme( host );
    if ( schemeWatch || typeof MutationObserver === 'undefined' ) return;
    const again = () => schemed.forEach( followScheme );
    schemeWatch = new MutationObserver( again );
    schemeWatch.observe( document.documentElement, { attributes: true } );
    if ( document.body ) schemeWatch.observe( document.body, { attributes: true } );
    if ( document.readyState !== 'complete' ) addEventListener( 'load', again, { once: true } );
}

/** The page's rooms, as the SDK shares them (`window.wordplusRealtimeCalls.page().rt`): null on a page without them. */
function pageRooms(): SdkRooms | null {
    const api = ( globalThis as Record<string, any> ).wordplusRealtimeCalls as { page?: () => { rt?: SdkRooms } | null } | undefined;
    return api?.page?.()?.rt ?? null;
}

/**
 * Starts by itself once the page is ready, on a page that has its calls (a WordPress page's calls script). On a page
 * ready already, a moment later, so an app's own script that carries this one gives its views (setViews) first.
 */
export function autoStart(): void {
    if ( typeof document === 'undefined' ) return;
    if ( document.readyState === 'loading' ) document.addEventListener( 'DOMContentLoaded', () => start(), { once: true } );
    else queueMicrotask( () => void start() );
}

/** Calls `to` about `call`: what `<call-button>` does. */
export async function place( call: string, to: CallUser, type: 'audio' | 'video', peer: { name: string; avatar?: string } ): Promise<void> {
    if ( ! controller && ! start() ) return;
    await controller!.place( call, to, type, peer );
}

/** Joins the group call `room`: what `<room-button>` does. */
export async function join( room: string, type: 'audio' | 'video', title: string ): Promise<void> {
    if ( ! controller && ! start() ) return;
    await controller!.join( room, type, title );
}

const BUTTON_CSS = `
:host { display: inline-block; }
button {
    font: inherit; color: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(127, 127, 127, 0.35); background: transparent;
}
button:hover { background: rgba(127, 127, 127, 0.12); }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
`;

/** A button of its own, in a shadow root: the page's text in it, the page's look on it through ::part(button). */
function button( element: HTMLElement, onClick: () => void ): void {
    const root = element.attachShadow( { mode: 'open' } );
    const style = document.createElement( 'style' );
    style.textContent = BUTTON_CSS;
    const inner = document.createElement( 'button' );
    inner.type = 'button';
    inner.setAttribute( 'part', 'button' );
    inner.appendChild( document.createElement( 'slot' ) );
    inner.addEventListener( 'click', onClick );
    root.append( style, inner );
}

/**
 * `<call-button>`: a button that places a call. `call` names it, `{pair}` there filled in as `<online-list>` fills
 * it: the page user and `to`, in order (`support:{pair}` is `support:34:42` either way round).
 */
class CallButton extends HTMLElement {
    static readonly tag = 'call-button';

    constructor() {
        super();
        button( this, () => {
            const to = callUserOf( this.getAttribute( 'to' ) );
            const named = this.getAttribute( 'call' ) ?? '';
            const user = pageRooms()?.user ?? null;
            if ( to === null || ! named || ( user === null && /\{(pair|me)\}/.test( named ) ) ) return;
            const call = callName( named, user, String( to ) );
            const type = this.getAttribute( 'type' ) === 'audio' ? 'audio' : 'video';
            const peer = { name: this.getAttribute( 'name' ) ?? '', avatar: this.getAttribute( 'avatar' ) ?? undefined };
            setUiUsers( [ [ to, peer ] ] );
            void place( call, to, type, peer );
        } );
    }
}

/** `<room-button>`: a button that joins a group call. */
class RoomButton extends HTMLElement {
    static readonly tag = 'room-button';

    constructor() {
        super();
        button( this, () => {
            const room = this.getAttribute( 'room' ) ?? '';
            if ( ! room ) return;
            const type = this.getAttribute( 'type' ) === 'audio' ? 'audio' : 'video';
            void join( room, type, this.getAttribute( 'title' ) ?? room );
        } );
    }
}

// The elements on a room (presence, typing, the count, the chat): each draws in a shadow root of its own, on the page's
// rooms, and again when the script starts (the page's language) or its attributes change.
const presence = new Set<RoomElement>();

abstract class RoomElement extends HTMLElement {
    /** The element's own rules for itself (`:host`) and its holder, beside the shared stylesheet. */
    static readonly hostCss: string = '';
    /** Its holder's class beside `realtime-calls`, which the shared stylesheet styles it by. */
    static readonly holderClass: string = '';
    static readonly observedAttributes = [ 'room', 'call', 'type', 'title', 'event', 'reactions', 'placeholder', 'max-length', 'messages', 'to', 'name', 'avatar', 'start-call' ];
    private holder: HTMLDivElement | null = null;
    private root: Root | null = null;
    /** The pieces its templates fill (templates.tsx), read at each connection. */
    protected pieces: Pieces = {};
    private merged: { from: Pieces | undefined; own: Pieces; pieces: Pieces } | null = null;

    /** The app's script's pieces (setViews), and its templates' over them: the same object while neither changes. */
    protected components(): Pieces {
        if ( ! this.merged || this.merged.from !== views.components || this.merged.own !== this.pieces ) {
            this.merged = { from: views.components, own: this.pieces, pieces: { ...views.components, ...this.pieces } };
        }
        return this.merged.pieces;
    }

    connectedCallback(): void {
        this.pieces = templatePieces( this );
        if ( ! this.holder ) {
            const shadow = this.attachShadow( { mode: 'open' } );
            const own = this.constructor as typeof RoomElement;
            styled( shadow );
            if ( own.hostCss ) {
                const style = document.createElement( 'style' );
                style.textContent = own.hostCss;
                shadow.append( style );
            }
            this.holder = document.createElement( 'div' );
            this.holder.className = 'realtime-calls' + ( own.holderClass ? ' ' + own.holderClass : '' );
            this.holder.setAttribute( 'part', 'content' );
            shadow.append( this.holder );
        }
        presence.add( this );
        schemeOf( this );
        this.render();
    }

    disconnectedCallback(): void {
        presence.delete( this );
        schemeOf( this, false );
        this.root?.unmount();
        this.root = null;
    }

    attributeChangedCallback(): void {
        if ( presence.has( this ) ) this.render();
    }

    render(): void {
        if ( ! this.holder ) return;
        const rt = pageRooms();
        this.holder.dir = direction( lang );
        this.root ??= createRoot( this.holder );
        this.root.render( rt && this.getAttribute( 'room' ) ? this.view( rt, this.getAttribute( 'room' )! ) : null );
    }

    protected abstract view( rt: SdkRooms, room: string ): React.ReactElement;
}

export { callName };

/**
 * `<online-list room="shop" call="support:{pair}" type="video audio" title="In the shop">`: who is in a presence
 * room, with a call button for each of the others where `call` names the call (and the page has calls).
 */
class OnlineElement extends RoomElement {
    static readonly tag = 'online-list';
    // It stands on its own, so its list fills the place the page gives it (presence.css, .realtime-online).
    static readonly hostCss = ':host { display: block; }';
    static readonly holderClass = 'realtime-online';

    protected view( rt: SdkRooms, room: string ): React.ReactElement {
        const call = this.getAttribute( 'call' );
        const types = ( this.getAttribute( 'type' ) ?? 'video' ).split( /\s+/ ).filter( ( t ): t is 'audio' | 'video' => t === 'audio' || t === 'video' );
        const calls = call ? pageCalls() : null;
        // Each row's buttons once the app's rules let the page's user call that member (MayCall, may-call.tsx).
        const actions = call && calls
            ? ( member: RoomPerson ) => {
                const to = callUserOf( member.id );
                if ( to === null ) return null;
                const name = callName( call, rt.user, member.id );
                return <MayCall calls={ calls } call={ name } to={ to }>{ types.map( ( type ) => (
                    <RowAction key={ type }
                               icon={ type === 'audio' ? 'phone' : 'video' }
                               label={ type === 'audio' ? _x( 'Audio Call', 'Users List', 'bp-better-messages' ) : _x( 'Video Call', 'Users List', 'bp-better-messages' ) }
                               onClick={ () => {
                                   const peer = { name: member.name, avatar: member.avatar };
                                   setUiUsers( [ [ member.id, peer ] ] );
                                   void place( name, to, type, peer );
                               } } />
                ) ) }</MayCall>;
            }
            : undefined;
        const List = views.OnlineList ?? RoomOnline;
        return <List rt={ rt } room={ room } title={ this.getAttribute( 'title' ) ?? undefined } actions={ actions } components={ this.components() } />;
    }
}

/** `<typing-line room="chat:34:42" event="typing">`: who is typing in a room, by name. */
class TypingElement extends RoomElement {
    static readonly tag = 'typing-line';

    protected view( rt: SdkRooms, room: string ): React.ReactElement {
        const Typing = views.Typing ?? RoomTyping;
        return <Typing rt={ rt } room={ room } event={ this.getAttribute( 'event' ) ?? 'typing' } />;
    }
}

/** `<online-count room="shop">`: how many are in a room, nothing at none. */
class CountElement extends RoomElement {
    static readonly tag = 'online-count';

    protected view( rt: SdkRooms, room: string ): React.ReactElement {
        const Count = views.OnlineCount ?? RoomCount;
        return <Count rt={ rt } room={ room } />;
    }
}

/**
 * `<chat-room room="chat:34:42" messages="/api/chat/messages" reactions="👍 ❤️ 😂" placeholder="…" max-length="2000">`:
 * Better Messages' conversation on a room of the app's, typing, reactions and composer. It fills the height the page
 * gives it. The conversation is the app's: `messages` names its route for the messages it kept (`?before=<id>` for an
 * older page), asked with the page's cookies; or the page gives the element a `load` function of its own (Chat's), for
 * headers of its own. With neither, the room's history, 5 minutes long, is all it shows. In a chat between two, `to` is
 * the other person, on its top bar (`name` and `avatar` theirs, where the page has them), and `call` the call that shows
 * in the chat while it is on: `call` alone the call
 * named as the room, a value another (`date:{pair}`). `start-call="video"` calls them as the chat opens, once.
 */
class ChatElement extends RoomElement {
    static readonly tag = 'chat-room';
    // It fills the height the page gives it, its conversation inside.
    static readonly hostCss = ':host { display: block; height: 480px; } :host > .realtime-calls { height: 100%; }';
    private loader: ChatLoader | undefined;

    get load(): ChatLoader | undefined {
        return this.loader;
    }

    set load( fn: ChatLoader | undefined ) {
        this.loader = typeof fn === 'function' ? fn : undefined;
        this.render();
    }

    connectedCallback(): void {
        // A `load` the page set before the script defined the element sits on the element itself: taken as the property.
        if ( Object.prototype.hasOwnProperty.call( this, 'load' ) ) {
            const fn = ( this as unknown as { load?: ChatLoader } ).load;
            delete ( this as unknown as { load?: ChatLoader } ).load;
            this.loader = typeof fn === 'function' ? fn : undefined;
        }
        super.connectedCallback();
    }

    protected view( rt: SdkRooms, room: string ): React.ReactElement {
        const reactions = this.getAttribute( 'reactions' );
        const maxLength = Number( this.getAttribute( 'max-length' ) ?? 0 );
        // `call` alone, or `call="true"`, is the call named as the room, and any other value names it.
        const call = this.getAttribute( 'call' );
        const start = this.getAttribute( 'start-call' );
        const Conversation = views.Chat ?? Chat;
        return <PageCalls.Provider value={ controller }>
            <Conversation rt={ rt } room={ room }
                     load={ this.loader ?? routeLoader( this.getAttribute( 'messages' ) ) }
                     reactions={ reactions === null ? undefined : reactions.split( /\s+/ ).filter( Boolean ) }
                     placeholder={ this.getAttribute( 'placeholder' ) ?? undefined }
                     maxLength={ Number.isFinite( maxLength ) && maxLength > 0 ? maxLength : 0 }
                     onSent={ ( message ) => this.dispatchEvent( new CustomEvent( 'sent', { detail: message } ) ) }
                     to={ this.getAttribute( 'to' ) ?? undefined }
                     name={ this.getAttribute( 'name' ) ?? undefined }
                     avatar={ this.getAttribute( 'avatar' ) ?? undefined }
                     call={ call === null ? undefined : call === '' || call === 'true' ? true : call }
                     startCall={ start === 'video' || start === 'audio' ? start : undefined }
                     components={ this.components() } />
        </PageCalls.Provider>;
    }
}

export { routeLoader };

/** `<call-screen>`: where the call screen draws, holding the page's templates for its pieces. */
class CallScreenElement extends HTMLElement {
    static readonly tag = 'call-screen';
}

// The call fills the spot, as high as the page makes it, else 360px. The spot's children show while no call is there.
const SPOT_CSS = `
:host { display: block; }
:host([data-empty]) { display: none; }
:host([data-call]) slot { display: none; }
:host(:not([data-call])) .realtime-call-spot { display: none; }
.realtime-call-spot { height: 100%; }
`;

/** The `<call-spot>` elements on the page, which take their calls once the page has them. */
const spots = new Set<CallSpotElement>();

/**
 * `<call-spot call="match:{a}:{b}">`: a place in the page for the calls it names (a call's name, a pattern as the
 * server's rules write them, or every call with no `call`), in place of the window in the corner. A call moves in when
 * it starts, or once the spot is on the page, and back to the window when the spot goes, going on throughout. Its
 * children show while no call is in it, and with none it is hidden until a call comes. `data-call` holds the call's
 * name while one is here.
 */
class CallSpotElement extends HTMLElement {
    static readonly tag = 'call-spot';
    static readonly observedAttributes = [ 'call' ];
    private place: HTMLDivElement | null = null;
    private release: ( () => void ) | null = null;
    private unplace: ( () => void ) | null = null;

    connectedCallback(): void {
        if ( ! this.place ) {
            const shadow = this.attachShadow( { mode: 'open' } );
            styled( shadow );
            const own = document.createElement( 'style' );
            own.textContent = SPOT_CSS;
            this.place = document.createElement( 'div' );
            this.place.className = 'realtime-call-spot';
            shadow.append( own, this.place, document.createElement( 'slot' ) );
        }
        schemeOf( this );
        spots.add( this );
        this.claim();
        this.show();
    }

    disconnectedCallback(): void {
        spots.delete( this );
        schemeOf( this, false );
        this.unclaim();
    }

    attributeChangedCallback(): void {
        if ( ! this.release ) return;
        this.unclaim();
        this.claim();
    }

    /** Takes its calls, once the page has its calls and the spot is on it. */
    claim(): void {
        if ( ! controller || ! this.place || this.release || ! this.isConnected ) return;
        this.unplace = controller.onPlace( () => this.show() );
        this.release = controller.spot( this.getAttribute( 'call' ) || null, this.place );
    }

    private unclaim(): void {
        this.unplace?.();
        this.release?.();
        this.unplace = this.release = null;
        this.show();
    }

    /** Says whether a call is here: `data-call` with its name, else `data-empty` with no children to show. */
    private show(): void {
        const view = this.release && controller ? controller.snapshot() : null;
        const name = view && view.spot === this.place ? showingName( view.showing ) : null;
        for ( const target of [ this, this.place ] ) {
            if ( name ) target?.setAttribute( 'data-call', name );
            else target?.removeAttribute( 'data-call' );
        }
        const content = [ ...this.childNodes ].some( ( node ) => node.nodeType === Node.ELEMENT_NODE || node.textContent?.trim() );
        this.toggleAttribute( 'data-empty', ! name && ! content );
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
    defineElements( [ CallButton, RoomButton, OnlineElement, TypingElement, CountElement, ChatElement, CallScreenElement, CallSpotElement ], prefix );
}

export { configureUi, setUiUsers };

define();
autoStart();
