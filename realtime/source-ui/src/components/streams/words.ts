import {__, _x} from "./i18n.ts";
import {reactionIcon} from "./reactions.ts";

// Words more than one part shows. Every word the UI shows is a literal call to i18n.ts with the text
// domain, so WordPress's tools find it in Easy Stream's built script: on WordPress, wp.i18n with the
// plugin's translations (wp_set_script_translations); in an app, the host's translator. A string with a
// placeholder carries a context saying what it stands for, since the minified build keeps no translator
// comments.

// An error code from the client or the cloud, in words; `otherwise` for a code without its own.
export function errorText( code : string | null, otherwise? : string ) : string {
    switch( code ){
        case null:
        case '':
            return '';
        case 'not_licensed':
        case 'not_configured':
            return __( 'Live streaming is not set up on this site yet', 'wordplus-stream' );
        case 'not_included':
            return __( 'Live streaming is not included in the plan of this site', 'wordplus-stream' );
        case 'forbidden':
            return __( 'You do not have access to this stream', 'wordplus-stream' );
        case 'banned':
            return __( 'You cannot join this stream', 'wordplus-stream' );
        case 'kicked':
            return __( 'A moderator removed you from this stream', 'wordplus-stream' );
        case 'expired':
            return __( 'This page has expired. Reload it to watch', 'wordplus-stream' );
        case 'not_found':
            return __( 'This stream is no longer available', 'wordplus-stream' );
        case 'rate':
            return __( 'Too many people are joining from your network. Try again in a minute', 'wordplus-stream' );
        case 'no_hours':
            return __( 'This stream cannot take more viewers right now', 'wordplus-stream' );
        case 'media_unreachable':
            return __( 'The video could not be reached. Check your connection', 'wordplus-stream' );
        case 'publish_failed':
            return __( 'Going live failed. Check your connection and try again', 'wordplus-stream' );
        case 'devices':
            return __( 'The camera or microphone could not be opened', 'wordplus-stream' );
        case 'no_stage':
            return __( 'This stream does not take guests on stage', 'wordplus-stream' );
        case 'not_invited':
            return __( 'The invitation is no longer open', 'wordplus-stream' );
        case 'no_encoder':
            return __( 'Nothing has come from OBS yet. Start streaming there first', 'wordplus-stream' );
        default:
            return otherwise ?? __( 'The stream could not be loaded', 'wordplus-stream' );
    }
}

// A reaction's name, for those who don't see it: the five offered where a site chose none by their words, any other the
// emoji itself, which screen readers name in the reader's language.
export function reactionName( kind : string ) : string {
    switch( reactionIcon( kind ) ){
        case '❤️':
            return _x( 'Heart', 'a reaction', 'wordplus-stream' );
        case '👏':
            return _x( 'Applause', 'a reaction', 'wordplus-stream' );
        case '😂':
            return _x( 'Laughter', 'a reaction', 'wordplus-stream' );
        case '😮':
            return _x( 'Surprise', 'a reaction', 'wordplus-stream' );
        case '🔥':
            return _x( 'Fire', 'a reaction', 'wordplus-stream' );
        default:
            return kind;
    }
}
