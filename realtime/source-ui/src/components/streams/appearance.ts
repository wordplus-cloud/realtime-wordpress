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
    // A logo over the picture: an image's address, its corner, its width in pixels and opacity in per cent.
    logo? : string;
    logoPosition? : 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    logoSize? : number;
    logoOpacity? : number;
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

// The logo over the picture, where it goes and how it shows; null without one.
export function logoOf( appearance : Appearance = {} ) : { src : string, position : string, width : number, opacity : number } | null {
    const src = safeImage( appearance.logo );
    if( ! src ) return null;

    const positions = [ 'top-left', 'top-right', 'bottom-left', 'bottom-right' ];
    return {
        src,
        position: positions.includes( appearance.logoPosition ?? '' ) ? appearance.logoPosition! : 'top-right',
        width: clamp( typeof appearance.logoSize === 'number' ? appearance.logoSize : 96, 32, 320 ),
        opacity: clamp( typeof appearance.logoOpacity === 'number' ? appearance.logoOpacity : 80, 20, 100 ) / 100
    };
}
