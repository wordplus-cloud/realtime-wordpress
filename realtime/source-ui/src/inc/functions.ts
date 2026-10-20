// What the call screens take from Better Messages' inc/functions.ts, line for line, and formatSize, so a view copied
// into an app imports none of the package's dependencies itself.
import { filesize } from "filesize";

export function BMHexToRGBA( hex: string, opacity: number ) {
    let c;
    if ( /^#([A-Fa-f0-9]{3}){1,2}$/.test( hex ) ) {
        c = hex.substring( 1 ).split( '' );
        if ( c.length == 3 ) {
            c = [ c[ 0 ], c[ 0 ], c[ 1 ], c[ 1 ], c[ 2 ], c[ 2 ] ];
        }
        let n = Number( '0x' + c.join( '' ) );
        return 'rgba(' + [ ( n >> 16 ) & 255, ( n >> 8 ) & 255, n & 255 ].join( ',' ) + ',' + opacity + ')';
    }
    throw new Error( 'Bad Hex' );
}

export interface SpeakerHighlightResult {
    boxShadow: string;
    background: string;
}

export function getSpeakerHighlightStyles(
    isSpeaking: boolean,
    audioLevel: number,
    color: string
): SpeakerHighlightResult | null {
    if ( ! isSpeaking ) return null;

    let level = audioLevel * 100 * 5;
    if ( level > 90 ) level = 90;
    if ( level < 15 ) level = 15;
    const opacity = level / 100;

    return {
        boxShadow: '0 0 ' + Math.round( 2 + opacity * 4 ) + 'px ' + Math.round( opacity * 2 ) + 'px ' + BMHexToRGBA( color, opacity ),
        background: 'linear-gradient(135deg, ' + BMHexToRGBA( color, opacity * 0.15 ) + ' 0%, ' + BMHexToRGBA( color, opacity * 0.05 ) + ' 100%)'
    };
}

/** A number of bytes as people read it ("1.5 MB"): a call's traffic in its settings. */
export function formatSize( bytes: number ): string {
    return filesize( bytes );
}

export function msToTime( duration: number ) {
    let seconds: string | number = Math.floor( ( duration / 1000 ) % 60 ),
        minutes: string | number = Math.floor( ( duration / ( 1000 * 60 ) ) % 60 ),
        hours: string | number = Math.floor( ( duration / ( 1000 * 60 * 60 ) ) % 24 );

    hours = ( hours < 10 ) ? "0" + hours : hours;
    minutes = ( minutes < 10 ) ? "0" + minutes : minutes;
    seconds = ( seconds < 10 ) ? "0" + seconds : seconds;

    if ( hours !== '00' ) {
        return hours + ":" + minutes + ":" + seconds;
    } else {
        return minutes + ":" + seconds;
    }
}
