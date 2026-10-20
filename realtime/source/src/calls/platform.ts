/**
 * What the engine needs to know about the browser: the short labels a call
 * record names it by ("Chrome 152", "macOS 26", never the user agent), and
 * which engine it is, since some codecs fail in one engine and not another.
 *
 * The defaults read the user agent themselves. A product that already parses
 * it (Better Messages, with ua-parser-js) hands its own answers to
 * `setCallPlatform()`, so its records read the same as before.
 */

export interface CallPlatform {
    browserLabel(): string;
    platformLabel(): string;
    isSafari(): boolean;
    isFirefox(): boolean;
}

function agent(): string {
    return typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
}

function major( version: string | undefined ): string {
    return ( version ?? '' ).split( '.' )[0];
}

function labelled( name: string, version: string | undefined ): string {
    const number = major( version );

    return number ? name + ' ' + number : name;
}

const BROWSERS: Array<[ string, RegExp ]> = [
    [ 'Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/ ],
    [ 'Opera', /(?:OPR|OPiOS)\/([\d.]+)/ ],
    [ 'Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/ ],
    [ 'Chrome', /(?:Chrome|CriOS)\/([\d.]+)/ ],
    [ 'Safari', /Version\/([\d.]+).*Safari\// ],
];

function isIOS( ua: string ): boolean {
    return /iPhone|iPad|iPod/.test( ua );
}

export const defaultPlatform: CallPlatform = {
    browserLabel() {
        const ua = agent();

        for( const [ name, pattern ] of BROWSERS ){
            const found = ua.match( pattern );

            if( found ) return labelled( name === 'Safari' && isIOS( ua ) ? 'Mobile Safari' : name, found[1] );
        }

        return 'unknown';
    },

    platformLabel() {
        const ua = agent();
        let found: RegExpMatchArray | null;

        if( ( found = ua.match( /(?:iPhone|iPad|iPod).*? OS (\d+)/ ) ) ) return labelled( 'iOS', found[1] );
        if( ( found = ua.match( /Android (\d+)/ ) ) ) return labelled( 'Android', found[1] );
        if( ( found = ua.match( /Windows NT ([\d.]+)/ ) ) ) return 'Windows' + ( found[1] === '10.0' ? ' 10' : '' );
        if( ( found = ua.match( /Mac OS X (\d+)/ ) ) ) return labelled( 'macOS', found[1] );
        if( /CrOS/.test( ua ) ) return 'Chrome OS';
        if( /Linux/.test( ua ) ) return 'Linux';

        return 'unknown';
    },

    // Every browser on iOS is WebKit underneath.
    isSafari() {
        const ua = agent();

        return isIOS( ua ) || ( /Safari\//.test( ua ) && ! /Chrome\/|Chromium\/|CriOS\/|FxiOS\/|Edg|OPR\/|Android/.test( ua ) );
    },

    isFirefox() {
        return /Firefox\/|FxiOS\//.test( agent() );
    },
};

let platform: CallPlatform = defaultPlatform;

export function setCallPlatform( answers: Partial<CallPlatform> ): void {
    platform = { ...defaultPlatform, ...answers };
}

export const browserLabel = (): string => platform.browserLabel();
export const platformLabel = (): string => platform.platformLabel();
export const isSafari = (): boolean => platform.isSafari();
export const isFirefox = (): boolean => platform.isFirefox();
