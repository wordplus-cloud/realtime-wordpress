// Times and numbers in the page's language. Intl speaks it without translations of ours: the page's
// <html lang> (WordPress sets it from the site's language), else the browser's.

export function pageLocale() : string | undefined {
    const lang = typeof document !== 'undefined' ? document.documentElement.lang : '';
    if( ! lang ) return undefined;

    try {
        return Intl.getCanonicalLocales( lang )[0];
    } catch ( e ) {
        return undefined;
    }
}

const pad = ( n : number ) => String( n ).padStart( 2, '0' );

// A length of time as a clock reads it: 4:05, 12:04, 1:02:15.
export function clock( ms : number ) : string {
    const total = Math.max( 0, Math.floor( ms / 1000 ) );
    const h = Math.floor( total / 3600 );
    const m = Math.floor( ( total % 3600 ) / 60 );
    const s = total % 60;
    return h > 0 ? h + ':' + pad( m ) + ':' + pad( s ) : m + ':' + pad( s );
}

// What is left until a time, in whole days, hours, minutes and seconds.
export function until( at : number, now : number ) : { days : number, hours : number, minutes : number, seconds : number } {
    const total = Math.max( 0, Math.ceil( ( at - now ) / 1000 ) );
    return {
        days: Math.floor( total / 86400 ),
        hours: Math.floor( ( total % 86400 ) / 3600 ),
        minutes: Math.floor( ( total % 3600 ) / 60 ),
        seconds: total % 60
    };
}

// "Friday, 10 October 2026 at 18:00", as the page's language writes it.
export function dateTime( at : number ) : string {
    try {
        return new Intl.DateTimeFormat( pageLocale(), { dateStyle: 'full', timeStyle: 'short' } ).format( at );
    } catch ( e ) {
        return new Date( at ).toLocaleString();
    }
}

// "18:04", or "6:04 PM", as the page's language writes a time of day.
export function timeOfDay( at : number ) : string {
    try {
        return new Intl.DateTimeFormat( pageLocale(), { timeStyle: 'short' } ).format( at );
    } catch ( e ) {
        return new Date( at ).toLocaleTimeString();
    }
}

// "12 minutes ago", "in 2 days": the nearest whole unit.
export function relative( at : number, now : number ) : string {
    const seconds = Math.round( ( at - now ) / 1000 );
    const units : Array<[ Intl.RelativeTimeFormatUnit, number ]> = [ [ 'day', 86400 ], [ 'hour', 3600 ], [ 'minute', 60 ] ];

    try {
        const format = new Intl.RelativeTimeFormat( pageLocale(), { numeric: 'auto' } );
        for( const [ unit, size ] of units ){
            if( Math.abs( seconds ) >= size ) return format.format( Math.trunc( seconds / size ), unit );
        }
        return format.format( 0, 'minute' );
    } catch ( e ) {
        return dateTime( at );
    }
}

// 1234 → "1,234"; 12345 → "12K", as the page's language writes them.
export function count( n : number ) : string {
    try {
        return new Intl.NumberFormat( pageLocale(), n >= 10000 ? { notation: 'compact', maximumFractionDigits: 1 } : {} ).format( n );
    } catch ( e ) {
        return String( n );
    }
}
