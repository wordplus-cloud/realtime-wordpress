// A scheduled stream for a visitor's calendar: Google Calendar's page for a new event, or an .ics file
// that Apple Calendar, Outlook and the rest open. The event is an hour long; the stream's length isn't
// known before it ends.

const HOUR = 3600 * 1000;

const stamp = ( at : number ) => new Date( at ).toISOString().replace( /[-:]/g, '' ).replace( /\.\d{3}/, '' );

// RFC 5545's escapes for text, and its lines folded at 75 octets (here characters, which keeps within).
const text = ( s : string ) => s.replace( /\\/g, '\\\\' ).replace( /;/g, '\\;' ).replace( /,/g, '\\,' ).replace( /\r?\n/g, '\\n' );
const fold = ( line : string ) => line.match( /.{1,73}/g )?.join( '\r\n ' ) ?? line;

export function icsFile( event : { title : string, start : number, url : string, uid : string }, now : number = Date.now() ) : string {
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Easy Stream//Live stream//EN',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        'UID:' + event.uid,
        'DTSTAMP:' + stamp( now ),
        'DTSTART:' + stamp( event.start ),
        'DTEND:' + stamp( event.start + HOUR ),
        'SUMMARY:' + text( event.title ),
        'DESCRIPTION:' + text( event.url ),
        'URL:' + event.url,
        'END:VEVENT',
        'END:VCALENDAR',
        ''
    ].map( fold ).join( '\r\n' );
}

export function googleCalendarUrl( event : { title : string, start : number, url : string } ) : string {
    const params = new URLSearchParams( {
        action: 'TEMPLATE',
        text: event.title,
        dates: stamp( event.start ) + '/' + stamp( event.start + HOUR ),
        details: event.url
    } );
    return 'https://calendar.google.com/calendar/render?' + params.toString();
}

// Saves the .ics: the browser's download of a file made here.
export function downloadIcs( name : string, content : string ){
    const url = URL.createObjectURL( new Blob( [ content ], { type: 'text/calendar;charset=utf-8' } ) );
    const link = document.createElement( 'a' );
    link.href = url;
    link.download = name;
    document.body.appendChild( link );
    link.click();
    link.remove();
    setTimeout( () => URL.revokeObjectURL( url ), 1000 );
}
