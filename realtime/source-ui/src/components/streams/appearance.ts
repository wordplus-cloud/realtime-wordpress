import type {CSSProperties} from "react";

// How a stream looks, as a site configures it (the WordPress plugin's Appearance tab, which checks each
// value: WordPlus_Stream_Settings::clean_appearance). Every part is optional; what is left out keeps the
// stylesheet's look. The player checks again what reaches a style or an attribute.
export interface Appearance {
    // `auto` follows the visitor's system.
    theme? : 'light' | 'dark' | 'auto';
    // Buttons and highlights, and the Live badge, `#rrggbb`.
    accent? : string;
    live? : string;
    // Whether the Live badge shows over the picture while live (by default it does).
    liveBadge? : boolean;
    // Corners, in pixels.
    radius? : number;
    // The page's own font, or the device's.
    font? : 'theme' | 'system';
    // The player's shape: `auto` (the default) takes the picture's own, wide, standard or upright as from a phone, while
    // one picture fills the stage (several share a wide one); the others keep one shape whatever arrives.
    shape? : 'auto' | Shape;
    // Whether the player shows the stream's title, its time on air, and names on the video.
    title? : boolean;
    clock? : boolean;
    names? : boolean;
    // Whether viewers see how many are watching; hosts always do.
    viewers? : boolean;
    // A logo over the picture: an image's address, its corner and opacity in per cent, and its size and place as shares
    // of the picture, so it covers the same part of it in a player of any size: `logoWidth` in per cent of the
    // picture's width, its distance from the corner's side in per cent of the width (`logoInsetX`) and from its top or
    // bottom in per cent of the height (`logoInsetY`), each null or none for the player's own. The pixels of before
    // (`logoSize`, `logoX`, `logoY`) count as those of a picture LOGO_REFERENCE wide, where the shares are missing.
    logo? : string;
    logoPosition? : 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    logoWidth? : number;
    logoInsetX? : number | null;
    logoInsetY? : number | null;
    logoOpacity? : number;
    logoSize? : number;
    logoX? : number | null;
    logoY? : number | null;
    // The image before a stream starts.
    cover? : string;
    // Chat beside the stream when there is room, or always below it; its height; what it shows.
    chat? : 'side' | 'below';
    chatHeight? : number;
    avatars? : boolean;
    times? : boolean;
    emoji? : boolean;
    // The reactions viewers may send, each one emoji in the site's order, at most REACTIONS_MAX (none: no reactions; the
    // protocol's five without the setting), and whether they rise over the picture.
    reactions? : string[];
    floating? : boolean;
}

// The player's shapes: wide, standard, upright.
export type Shape = '16:9' | '4:3' | '9:16';

// The shape a picture this size fits best: upright below square, standard up to about 3:2, wide above.
export function shapeOf( width : number, height : number ) : Shape {
    const ratio = width / height;
    if( ratio < 0.9 ) return '9:16';
    if( ratio < 1.5 ) return '4:3';
    return '16:9';
}

const HEX = /^#[0-9a-f]{6}$/i;

// Black or white, whichever reads better on the colour (WCAG's relative luminance).
export function contrastText( hex : string ) : string {
    const channel = ( i : number ) => {
        const c = parseInt( hex.slice( i, i + 2 ), 16 ) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow( ( c + 0.055 ) / 1.055, 2.4 );
    };
    const luminance = 0.2126 * channel( 1 ) + 0.7152 * channel( 3 ) + 0.0722 * channel( 5 );

    // White wins down to a luminance of about 0.18, where both contrast equally.
    return luminance > 0.179 ? '#111111' : '#ffffff';
}

// An image's address the player may put in a style or an attribute: http or https, nothing that ends
// either. Null otherwise.
export function safeImage( url : unknown ) : string | null {
    if( typeof url !== 'string' || ! /^https?:\/\//i.test( url ) || /[\s"'()<>\\]/.test( url ) ) return null;
    return url;
}

const clamp = ( n : number, min : number, max : number ) => Math.min( max, Math.max( min, Math.round( n ) ) );

// The classes on the theme root (.estream-theme), which the stylesheet keys the theme and layout to; and
// `wp-exclude-emoji`, which keeps WordPress from swapping the emoji inside for pictures of its own (with
// the WordPlus SDK's emoji guard, which the plugin loads before the player). `picture` is the shape of the picture as
// it arrives (the player's videoShape), which an `auto` shape takes.
export function themeClass( appearance : Appearance = {}, picture : Shape = '16:9' ) : string {
    const theme = appearance.theme === 'dark' || appearance.theme === 'auto' ? appearance.theme : 'light';
    const classes = [ 'estream-theme', 'wp-exclude-emoji', 'estream-theme--' + theme ];
    const shape = appearance.shape === '16:9' || appearance.shape === '4:3' || appearance.shape === '9:16' ? appearance.shape : picture;

    if( appearance.chat === 'below' ) classes.push( 'estream-theme--chat-below' );
    if( appearance.font === 'system' ) classes.push( 'estream-theme--system-font' );
    if( shape === '4:3' ) classes.push( 'estream-theme--standard' );
    if( shape === '9:16' ) classes.push( 'estream-theme--upright' );
    if( appearance.times === true ) classes.push( 'estream-theme--times' );
    if( appearance.avatars === false ) classes.push( 'estream-theme--no-avatars' );

    return classes.join( ' ' );
}

// The custom properties the colours, the corners and the chat's height set.
export function themeStyle( appearance : Appearance = {} ) : CSSProperties {
    const style : Record<string, string> = {};

    if( typeof appearance.accent === 'string' && HEX.test( appearance.accent ) ){
        style[ '--estream-accent' ] = appearance.accent;
        style[ '--estream-accent-text' ] = contrastText( appearance.accent );
    }

    if( typeof appearance.live === 'string' && HEX.test( appearance.live ) ){
        style[ '--estream-live' ] = appearance.live;
    }

    if( typeof appearance.radius === 'number' && Number.isFinite( appearance.radius ) ){
        style[ '--estream-radius' ] = clamp( appearance.radius, 0, 24 ) + 'px';
    }

    if( typeof appearance.chatHeight === 'number' && Number.isFinite( appearance.chatHeight ) ){
        style[ '--estream-chat-height' ] = clamp( appearance.chatHeight, 320, 900 ) + 'px';
    }

    return style as CSSProperties;
}

// How far a logo may sit from its corner's sides, in per cent of the picture's width or height: its middle is nearer
// that corner than any other.
export const LOGO_INSET_MAX = 50;

// How wide a logo may be, in per cent of the picture's width, and how wide it is unless the site says.
export const LOGO_WIDTH = { min: 2, max: 40, standard: 12 } as const;

// The picture the logo's pixels of before count in: as wide and as tall as a player that size.
export const LOGO_REFERENCE = { width: 800, height: 450 } as const;

// How far the pixels of before could set a logo from its corner's sides.
export const LOGO_OFFSET_MAX = 400;

// A share in per cent, to a tenth.
const tenth = ( value : number ) => Math.round( value * 10 ) / 10;

// The logo over the picture, where it goes and how it shows; null without one. `width`, `x` and `y` in per cent of the
// picture: its width, and its distance from the corner's side and from its top or bottom, null where the player keeps
// its own (14 pixels, and under the Live badge in the top left corner). Its opacity from 1 per cent, so a site can have
// it all but gone.
export function logoOf( appearance : Appearance = {} ) : { src : string, position : string, width : number, opacity : number, x : number | null, y : number | null } | null {
    const src = safeImage( appearance.logo );
    if( ! src ) return null;

    const positions = [ 'top-left', 'top-right', 'bottom-left', 'bottom-right' ];
    const number = ( value : unknown ) : value is number => typeof value === 'number' && Number.isFinite( value );
    // The share, else the pixels of before as their share of the reference picture.
    const share = ( value : unknown, pixels : unknown, across : number ) => number( value ) ? value : number( pixels ) ? pixels / across * 100 : null;
    const within = ( value : number, min : number, max : number ) => tenth( Math.min( max, Math.max( min, value ) ) );
    const inset = ( value : number | null ) => value === null ? null : within( value, 0, LOGO_INSET_MAX );
    const width = share( appearance.logoWidth, appearance.logoSize, LOGO_REFERENCE.width );

    return {
        src,
        position: positions.includes( appearance.logoPosition ?? '' ) ? appearance.logoPosition! : 'top-right',
        width: within( width ?? LOGO_WIDTH.standard, LOGO_WIDTH.min, LOGO_WIDTH.max ),
        opacity: clamp( number( appearance.logoOpacity ) ? appearance.logoOpacity : 80, 1, 100 ) / 100,
        x: inset( share( appearance.logoInsetX, appearance.logoX, LOGO_REFERENCE.width ) ),
        y: inset( share( appearance.logoInsetY, appearance.logoY, LOGO_REFERENCE.height ) )
    };
}
