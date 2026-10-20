import type { ComponentType } from "react";
import { FallbackAvatar } from "./components/users/user-avatar.tsx";
import { FallbackName } from "./components/users/user-name.tsx";
import { sharedTooltips } from "./inc/shared-parts.ts";
import { escapeHtml, plainName } from "./inc/names.ts";

/**
 * What the screens ask of the app they are in, and nothing else: its translations, its users' avatars and names, who
 * is signed in, how it shows an error, and the WordPlus SDK's shared parts. Better Messages hands in its own
 * (WordPress's translations, its user store, its toasts); an app on @wordplus/realtime gets the defaults below, the
 * package's own strings and the people its realtime server names.
 *
 * Set once, before the first screen draws: `configureUi( { translate, Avatar, … } )`. Anything left out keeps its
 * default.
 */
export interface UiHost {
    /**
     * A string the screens show, translated: `text` as written, `context` telling apart two meanings of one text, and
     * `domain` the text domain it is written with (`bp-better-messages` for the call screens, `wordplus-stream` for the live
     * streams), for a host that translates more than one product's words.
     */
    translate( text: string, context?: string, domain?: string ): string;
    /** A string with a number in it, in the form the language takes for `count`, as WordPress's `_nx()`. */
    translatePlural( single: string, plural: string, count: number, context?: string, domain?: string ): string;
    /**
     * A value the app may change before a screen uses it, as WordPress's `apply_filters()`: the screens name their
     * filters without a product prefix (`group_video_call_items`), and a host adds its own.
     */
    applyFilters<T>( name: string, value: T, ...args: unknown[] ): T;
    /** The accent colour, a hex value, for the ring around whoever is speaking. */
    accentColor(): string;
    /** Who is signed in: their id, the one the screens compare participants with. */
    currentUserId(): number | string;
    /** Shows an error a screen's action ran into, as the app shows its errors. */
    showError( error: unknown ): void;
    /** A user's picture, as the app draws it. */
    Avatar: ComponentType<UserAvatarProps>;
    /** A user's name, as the app writes it. */
    Name: ComponentType<UserNameProps>;
    /**
     * A display name as markup the screens may render. Better Messages keeps a site's badges through its allowlist;
     * by default the name is plain text, escaped, so no name a user typed becomes an element.
     */
    nameHtml( name: string ): string;
    /** The picture for a user who has none of their own. */
    defaultAvatar(): string;
    /**
     * Whether the page can know who is online at all. Where it can't, a screen says nothing of a user's presence
     * rather than "Offline" about everyone.
     */
    presenceKnown(): boolean;
    /**
     * Runs `run` once a WordPlus SDK part is on the page (`window.wordplusTooltips`, …): at once when it is. Better
     * Messages loads its own copy when a page has none.
     */
    whenShared( part: SharedPart, run: () => void ): void;
}

export type SharedPart = "toasts" | "tooltips" | "menus";

export interface UserAvatarProps {
    user_id: number | string;
    size: number;
    link?: boolean;
    /** The conversation the avatar is drawn for, which some hosts read a guest's picture from. */
    fromThread?: unknown;
}

export interface UserNameProps {
    user_id: number | string;
    /** What to write while the host knows no name for the user. */
    fallback?: string;
    link?: boolean;
    fromThread?: unknown;
}

/** A user's name and picture, as the defaults draw them. */
export interface UiUser {
    name: string;
    avatar?: string;
}

const users = new Map<string, UiUser>();

/** Names and pictures for the default Avatar and Name, as an app's realtime server gives them. */
export function setUiUsers( list: Iterable<[ number | string, UiUser ]> ): void {
    for ( const [ id, user ] of list ) users.set( String( id ), user );
}

export function uiUser( id: number | string ): UiUser | undefined {
    return users.get( String( id ) );
}

const defaults: UiHost = {
    translate: ( text ) => text,
    translatePlural: ( single, plural, count, context, domain ) => current.translate( count === 1 ? single : plural, context, domain ),
    applyFilters: ( _name, value ) => value,
    accentColor: () => "#21759b",
    currentUserId: () => 0,
    showError: ( error ) => console.error( error ),
    Avatar: FallbackAvatar,
    Name: FallbackName,
    nameHtml: ( name ) => escapeHtml( plainName( name ) ),
    // None: an avatar without a picture draws the blank of its shape.
    defaultAvatar: () => "",
    presenceKnown: () => true,
    whenShared: ( part, run ) => {
        if ( typeof window === "undefined" ) return;
        // Tooltips also from the package's own floater, on a page without the SDK's (the elements script sets it).
        if ( part === "tooltips" ? sharedTooltips() : ( window as unknown as Record<string, unknown> )[ SHARED_GLOBALS[ part ] ] ) run();
    },
};

const SHARED_GLOBALS = {
    toasts   : "wordplusToasts",
    tooltips : "wordplusTooltips",
    menus    : "wordplusMenus",
} as const;

let current: UiHost = defaults;

/** Hands the screens what they ask of the app; what is left out keeps its default. */
export function configureUi( host: Partial<UiHost> ): void {
    current = { ...current, ...host };
}

export function host(): UiHost {
    return current;
}
