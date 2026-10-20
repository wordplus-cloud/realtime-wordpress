import React from "react";
import parse from "html-react-parser";
import Icon from "../../primitives/icon.tsx";
import Tooltip from "../../primitives/tooltip.tsx";
import { host } from "../../host.ts";
import { applyFilters, sprintf, _nx, _x } from "../../inc/globals.ts";
import { plainName } from "../../inc/names.ts";

// Presence, Better Messages' (its primitives/presence.tsx): the avatar with its status dot, the group avatar and the
// overlapped stack, the typing and activity line, the presence label and who read a message. Views only: whoever
// draws them says who is online (`presence`) and passes the people. Better Messages keeps its live roster, its thread
// avatars and its admin-defined statuses, and feeds these.
//
// A person is anything with an id, and a name and picture when known: Better Messages' user record fits as it is.
// Names are drawn through the host (nameHtml, plainName), so a name a user typed never becomes an element.
//
// Styles: styles/presence/_presence.scss.

export type Presence = "online" | "busy" | "away" | "offline";

export interface PresenceUser {
    user_id  : number | string;
    name?    : string;
    avatar?  : string;
    is_bot?  : number;
}

export interface PresenceDotProps {
    presence : Presence | null | undefined;
    size?    : number;
    ringColor? : string;
    // A user status's own colour (Better Messages' admin-defined statuses): the dot wears it while the user is not
    // offline.
    color?   : string;
}

export function PresenceDot( { presence, size = 10, ringColor = "rgba(var(--bm-color-surface), 1)", color }: PresenceDotProps ) {
    const p = presence || "offline";
    return (
        <span
            className="bm-presence-dot"
            aria-label={ `presence-${p}` }
            data-presence={ p }
            style={{
                width: size,
                height: size,
                boxShadow: `0 0 0 2px ${ringColor}`,
                ...( color && p !== "offline" ? { background: color } : {} ),
            }}
        />
    );
}

export type AvatarShape = "circle" | "rounded" | "square";

export interface AvatarProps {
    user        : PresenceUser | null | undefined;
    size?       : number;
    shape?      : AvatarShape;
    presence?   : Presence | null;
    presenceColor? : string;
    presenceRing? : string;
    title?      : string;
    dotSize?    : number;
}

// Avatars take their radius from the design token (--bm-radius-avatar, which a site's avatar shape remaps): the shape
// prop is an explicit override for one spot only, so every surface agrees on the shape by default.
export const SHAPE_RADIUS: Record<AvatarShape, string> = {
    circle:  "var(--bm-radius-circle)",
    rounded: "var(--bm-radius-md)",
    square:  "var(--bm-radius-xs)",
};

/** The picture for a user who has none of their own: the host's (Better Messages ships one). */
export function defaultAvatarSrc(): string {
    return host().defaultAvatar();
}

// A user record can reach a surface before its picture has: every avatar falls back to the default picture rather
// than to an empty <img>.
export function avatarSrc( user: { avatar?: string } | null | undefined ): string {
    return ( user && user.avatar ) || defaultAvatarSrc();
}

// Keys for avatar lists. The id alone is not unique (unresolved people all carry 0), and React orphans duplicates
// instead of removing them; the index tells them apart, as these lists are short, capped and keep their order.
export function avatarKey( user: { user_id?: number | string }, index: number ): string {
    return String( user.user_id ?? "x" ) + "-" + index;
}

// Integrations append classes and attributes to every avatar (Better Messages' better_messages_avatar_class and
// better_messages_avatar_attributes). The class filter runs with 2.0's default class string, so callbacks written for
// it keep working, but only the classes an integration ADDED are applied.
const V2_AVATAR_CLASS_BASE = "avatar bbpm-avatar";

function avatarFilterExtras( user: PresenceUser ): { extraClass: string; attributes: Record<string, unknown> } {
    const filtered = String( applyFilters( "avatar_class", V2_AVATAR_CLASS_BASE, user ) );
    const extraClass = filtered === V2_AVATAR_CLASS_BASE
        ? ""
        : filtered.split( /\s+/ ).filter( c => c && c !== "avatar" && c !== "bbpm-avatar" ).join( " " );
    const attributes = applyFilters( "avatar_attributes", {}, user ) as Record<string, unknown>;
    return { extraClass, attributes };
}

export function Avatar( { user, size = 36, shape, presence, presenceColor, presenceRing, dotSize, title }: AvatarProps ) {
    if ( ! user ) return null;
    const dot = dotSize != null ? dotSize : Math.max( 6, Math.round( size * 0.28 ) );
    const radius = shape ? SHAPE_RADIUS[ shape ] : undefined;
    const ring = presenceRing ?? "rgba(var(--bm-color-surface), 1)";
    const src = avatarSrc( user );
    // The user's name on hover, in the shared tooltip: the floater renders the name as markup (a site's badges), the
    // aria-label takes it flattened. An explicit `title` is the caller's own wording; "" opts out where the name is
    // already beside the avatar.
    const ownTitle = title !== undefined;
    const tooltipLabel: React.ReactNode = ownTitle
        ? title
        : ( user.name ? <span className="bm-uname">{ parse( host().nameHtml( user.name ) ) }</span> : "" );
    const tooltipAria = ownTitle ? title : plainName( user.name );
    const { extraClass, attributes } = avatarFilterExtras( user );
    const body = (
        <span className={ "bm-avatar-wrap" + ( extraClass ? " " + extraClass : "" ) }
              { ...attributes }>
            { src
                ? <img className="bm-avatar bm-avatar-img avatar"
                       src={ src } alt={ plainName( user.name ) }
                       width={ size } height={ size }
                       style={{
                           width: size,
                           height: size,
                           borderRadius: radius,
                       }} />
                // No picture and no default: the blank of the avatar's shape.
                : <span className="bm-avatar bm-avatar-img bm-avatar-blank" role="img" aria-label={ plainName( user.name ) }
                        style={{ width: size, height: size, borderRadius: radius }} /> }
            { presence && presence !== "offline" && (
                <span className="bm-presence-dot-wrap">
                    <PresenceDot presence={ presence } size={ dot } ringColor={ ring } color={ presenceColor } />
                </span>
            ) }
        </span>
    );
    // The shared floater rather than a native title=, so the label looks like every other one; Tooltip hands the
    // child back untouched for an empty label.
    if ( ! tooltipAria ) return body;
    return <Tooltip label={ tooltipLabel } ariaLabel={ tooltipAria }>{ body }</Tooltip>;
}

export interface GroupAvatarProps {
    users : ( PresenceUser | null | undefined )[];
    size? : number;
    shape? : AvatarShape;
}

export function GroupAvatar( { users, size = 36, shape }: GroupAvatarProps ) {
    const list = users.filter( ( u ): u is PresenceUser => !! u ).slice( 0, 4 );
    if ( list.length === 0 ) return null;
    const gap = Math.max( 1, Math.round( size * 0.04 ) );
    const cols = list.length === 1 ? 1 : 2;
    const rows = list.length <= 2 ? 1 : 2;
    const radius = shape ? SHAPE_RADIUS[ shape ] : undefined;
    return (
        <span className="bm-group-avatar" style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows:    `repeat(${rows}, 1fr)`,
            gap,
            width: size,
            height: size,
            borderRadius: radius,
        }}>
            { list.map( ( u, i ) => {
                // Three faces in four cells left a quarter of the circle empty, which reads as a picture that failed
                // to load: the first takes the whole leading column and the other two stack beside it.
                const style = list.length === 3 && i === 0 ? { gridRow: "span 2" } : undefined;
                const src = avatarSrc( u );
                return src
                    ? <img key={ avatarKey( u, i ) } src={ src } alt="" className="bm-group-avatar__tile" style={ style } />
                    : <span key={ avatarKey( u, i ) } className="bm-group-avatar__tile bm-avatar-blank" style={ style } />;
            } ) }
        </span>
    );
}

export interface AvatarStackProps {
    users : ( PresenceUser | null | undefined )[];
    size? : number;
    max?  : number;
    shape? : AvatarShape;
}

export function AvatarStack( { users, size = 28, max = 3, shape }: AvatarStackProps ) {
    const valid = users.filter( ( u ): u is PresenceUser => !! u );
    const list = valid.slice( 0, max );
    const more = valid.length - list.length;
    const radius = shape ? SHAPE_RADIUS[ shape ] : undefined;
    return (
        <span className="bm-avatar-stack">
            { list.map( ( u, i ) => (
                <span key={ avatarKey( u, i ) } className="bm-avatar-stack__item" style={{
                    marginLeft: i === 0 ? 0 : -size * 0.35,
                    borderRadius: radius,
                }}>
                    <Avatar user={ u } size={ size } shape={ shape } />
                </span>
            ) ) }
            { more > 0 && (
                <span className="bm-avatar-stack__more" style={{
                    marginLeft: -size * 0.35,
                    width: size,
                    height: size,
                    borderRadius: radius,
                    fontSize: size * 0.32,
                }}>+{ more }</span>
            ) }
        </span>
    );
}

export interface TypingDotsProps {
    small? : boolean;
}

export function TypingDots( { small }: TypingDotsProps ) {
    return (
        <span className="bm-typing-dots" data-small={ small ? 1 : undefined }>
            { [ 0, 1, 2 ].map( i => (
                <span key={ i } className="bm-typing-dots__dot"
                      style={{ animationDelay: `${i * 0.15}s` }}/>
            ) ) }
        </span>
    );
}

export type Activity = "typing" | "recording" | "uploading";

export interface ActivityEntry {
    /** The person's name as markup (host().nameHtml()), or none for "typing" alone. */
    name?    : string | null;
    activity : Activity;
}

export interface ActivityIndicatorProps {
    entries?  : ActivityEntry[];
    activity? : Activity;
    /** Names as markup (host().nameHtml()). */
    names?    : string[];
    compact?  : boolean;
}

// One set of writers, grouped by activity: every activity present gets its own chunk ("Anna, Bob typing, Carol
// recording"), up to two names are spelled out and more become a count, and the icon is the one activity's, or the
// typing dots once activities mix. The strings are Better Messages', so every language it is translated into reads
// them as before.
export function ActivityIndicator( { entries, activity = "typing", names = [], compact }: ActivityIndicatorProps ) {
    const list: ActivityEntry[] = entries && entries.length > 0
        ? entries
        : ( names.length > 0 ? names.map( name => ( { name, activity } ) ) : [ { activity } ] );

    const order: Activity[] = [ "typing", "recording", "uploading" ];
    const groups = order
        .map( a => {
            const members = list.filter( e => e.activity === a );
            return {
                activity: a,
                count: members.length,
                named: members.map( e => ( e.name ?? "" ).trim() ).filter( Boolean ),
            };
        } )
        .filter( g => g.count > 0 );

    const chunk = ( g: { activity: Activity; count: number; named: string[] } ): string => {
        const who = g.named.length > 0 && g.named.length <= 2 ? g.named.join( ", " ) : String( g.count );
        if ( g.activity === "recording" ) {
            return g.named.length > 0 || g.count > 1
                ? sprintf( _x( "%s recording", "Activity indicator (Username recording)", "bp-better-messages" ), who )
                : _x( "recording", "Activity indicator (private conversation)", "bp-better-messages" );
        }
        if ( g.activity === "uploading" ) {
            return g.named.length > 0 || g.count > 1
                ? sprintf( _x( "%s sending file", "Activity indicator (Username sending file)", "bp-better-messages" ), who )
                : _x( "sending file", "Activity indicator (private conversation)", "bp-better-messages" );
        }
        return g.named.length > 0 || g.count > 1
            ? sprintf( _nx( "%s typing", "%s typing", g.count, "Typing indicator", "bp-better-messages" ), who )
            : _x( "typing", "Typing indicator (private conversation)", "bp-better-messages" );
    };

    const label = groups.map( chunk ).join( ", " );
    const iconActivity: Activity = groups.length === 1 ? groups[ 0 ].activity : "typing";

    let icon;
    if ( iconActivity === "recording" ) {
        icon = (
            <span className="bm-activity__rec">
                <span className="bm-activity__rec-dot" />
                <Icon name="mic" size={ 12 } />
            </span>
        );
    } else if ( iconActivity === "uploading" ) {
        icon = <Icon name="paperclip" size={ 12 } />;
    } else {
        icon = <TypingDots small={ compact } />;
    }

    return (
        <span className="bm-activity" data-compact={ compact ? 1 : undefined }>
            { icon }
            { /* Parsed, not printed: the names in it are markup (a site's badges), from the host's nameHtml(); the
                 strings themselves hold none. .bm-uname sizes a badge against this line. */ }
            <span className="bm-uname">{ parse( label ) }</span>
        </span>
    );
}

export interface PresenceLabelProps {
    presence : Presence | null | undefined;
    detail?  : string | null;
    size?    : number;
    // A user status's own words and colour (Better Messages' admin-defined statuses): in place of "Online", and the
    // label tinted, while online.
    label?   : string | null;
    color?   : string | null;
}

function presenceLabelText( p: Presence ): string {
    switch ( p ) {
        case "online":  return _x( "Online", "User online status", "bp-better-messages" );
        case "away":    return _x( "Away", "User presence label", "bp-better-messages" );
        case "busy":    return _x( "Do not disturb", "User presence label", "bp-better-messages" );
        default:        return _x( "Offline", "User presence label", "bp-better-messages" );
    }
}

export function PresenceLabel( { presence, detail, size = 11.5, label, color }: PresenceLabelProps ) {
    const p = presence || "offline";
    if ( p === "offline" && detail ) {
        return (
            <span className="bm-presence-label" data-presence="offline"
                  style={{ fontSize: size }}>{ detail }</span>
        );
    }
    // "Offline" is a claim a roster makes: where the page can't know who is online, it would be said about everyone
    // for ever, so the label says nothing instead.
    if ( p === "offline" && ! host().presenceKnown() ) return null;
    const showDetail = !! detail && p !== "away";
    return (
        <span className="bm-presence-label" data-presence={ p }
              style={{ fontSize: size, ...( color && p !== "offline" ? { color } : {} ) }}>
            <span>{ ( p !== "offline" && label ) ? label : presenceLabelText( p ) }</span>
            { showDetail && (
                <>
                    <span className="bm-presence-label__dot" />
                    <span className="bm-presence-label__detail">{ detail }</span>
                </>
            ) }
        </span>
    );
}

export interface ReadByProps {
    users : ( PresenceUser | null | undefined )[];
    size? : number;
}

export function ReadBy( { users, size = 14 }: ReadByProps ) {
    const valid = users.filter( ( u ): u is PresenceUser => !! u );
    if ( valid.length === 0 ) return null;
    return (
        <span className="bm-read-by">
            { valid.slice( 0, 3 ).map( ( u, i ) => {
                const style = { marginLeft: i === 0 ? 0 : -size * 0.4, width: size, height: size };
                const src = avatarSrc( u );
                return src
                    ? <img key={ avatarKey( u, i ) } src={ src } alt={ plainName( u.name ) }
                           width={ size } height={ size } className="bm-read-by__avatar" style={ style }/>
                    : <span key={ avatarKey( u, i ) } role="img" aria-label={ plainName( u.name ) }
                            className="bm-read-by__avatar bm-avatar-blank" style={ style }/>;
            } ) }
        </span>
    );
}
