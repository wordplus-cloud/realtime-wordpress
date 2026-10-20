// What a viewer chose in this browser (the volume, the chat hidden, the picture's quality), kept in
// localStorage. A private window, blocked storage or a preview may have none: then nothing is kept and
// the player starts from its defaults.

const PREFIX = 'wordplus-stream:';

export function readPref<T>( key : string, fallback : T, valid : ( value : unknown ) => value is T ) : T {
    try {
        const raw = window.localStorage.getItem( PREFIX + key );
        if( raw === null ) return fallback;
        const value : unknown = JSON.parse( raw );
        return valid( value ) ? value : fallback;
    } catch ( e ) {
        return fallback;
    }
}

export function writePref( key : string, value : unknown ){
    try {
        window.localStorage.setItem( PREFIX + key, JSON.stringify( value ) );
    } catch ( e ) {
        // Not kept: it holds for this page only.
    }
}

export const isNumber = ( v : unknown ) : v is number => typeof v === 'number' && Number.isFinite( v );
export const isBoolean = ( v : unknown ) : v is boolean => typeof v === 'boolean';
export const oneOf = <T extends string>( ...values : T[] ) => ( v : unknown ) : v is T => typeof v === 'string' && ( values as string[] ).includes( v );
