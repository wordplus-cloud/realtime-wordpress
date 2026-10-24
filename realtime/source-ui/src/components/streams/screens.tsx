import type {ReactNode} from "react";
import {__, _nx, _x, sprintf} from "./i18n.ts";
import type {EasyStreamState} from "@wordplus/realtime-client/streams";
import {useClient} from "./context.tsx";
import {clock, count, dateTime, until} from "./format.ts";
import {downloadIcs, googleCalendarUrl, icsFile} from "./calendar.ts";
import {Icon, type IconName} from "./icons.tsx";
import {MenuButton, MenuItem} from "./menu.tsx";
import {pageUrl, usePlayer, useNow} from "./player.tsx";
import {errorText} from "./words.ts";

// What the stage shows when there is no picture: each moment of a stream has a screen of its own.

// A countdown is shown for a start this close; further off, only its date.
const COUNTDOWN_MS = 7 * 86400 * 1000;

// Errors a fresh join may get past: the cloud was busy or out of reach. The rest stay as they are
// (no access, no licence, banned) or need the page reloaded (expired).
const RETRYABLE = new Set( [ 'server', 'rate', 'timeout', 'no_grant' ] );
const KNOWN = new Set( [ 'not_licensed', 'not_configured', 'not_included', 'forbidden', 'banned', 'expired', 'not_found', 'bad_grant', 'bad_request', 'wrong_origin' ] );

export function Screen( props : { icon? : IconName, busy? : boolean, title : ReactNode, children? : ReactNode, tone? : 'error' } ){
    return (
        <div className={ 'estream-screen' + ( props.tone ? ' estream-screen--' + props.tone : '' ) }>
            { props.busy ? <span className="estream-spinner" /> : props.icon ? <span className="estream-screen__icon"><Icon name={ props.icon } /></span> : null }
            { /* Said by screen readers as the moment changes (joining, waiting, ended), an error at once. */ }
            <p className="estream-screen__title" role={ props.tone === 'error' ? 'alert' : 'status' }>{ props.title }</p>
            { props.children }
        </div>
    );
}

function Countdown( props : { at : number } ){
    const now = useNow( 1000 );
    const left = until( props.at, now );
    const units = [
        { n: left.days, label: _nx( 'day', 'days', left.days, 'a countdown\'s unit', 'wordplus-live-stream' ) },
        { n: left.hours, label: _nx( 'hour', 'hours', left.hours, 'a countdown\'s unit', 'wordplus-live-stream' ) },
        { n: left.minutes, label: _nx( 'minute', 'minutes', left.minutes, 'a countdown\'s unit', 'wordplus-live-stream' ) },
        { n: left.seconds, label: _nx( 'second', 'seconds', left.seconds, 'a countdown\'s unit', 'wordplus-live-stream' ) }
    ];

    // Days only while there are some.
    const shown = left.days > 0 ? units : units.slice( 1 );

    return (
        <div className="estream-countdown" role="timer" aria-live="off">
            { shown.map( ( u, i ) => (
                <div key={ i } className="estream-countdown__unit">
                    <span className="estream-countdown__number">{ String( u.n ).padStart( 2, '0' ) }</span>
                    <span className="estream-countdown__label">{ u.label }</span>
                </div>
            ) ) }
        </div>
    );
}

function AddToCalendar( props : { start : number } ){
    const { title, url } = usePlayer();
    const page = pageUrl( url );
    const name = title || __( 'Live stream', 'wordplus-live-stream' );
    const event = { title: name, start: props.start, url: page };

    return (
        <MenuButton icon="calendar" label={ __( 'Add to calendar', 'wordplus-live-stream' ) } text={ __( 'Add to calendar', 'wordplus-live-stream' ) } className="estream-screen__menu" placement="down" align="start">
            { ( close ) => (
                <>
                    <MenuItem onSelect={ () => { window.open( googleCalendarUrl( event ), '_blank', 'noopener' ); close(); } }>
                        { __( 'Google Calendar', 'wordplus-live-stream' ) }
                    </MenuItem>
                    <MenuItem onSelect={ () => {
                        downloadIcs( 'live-stream.ics', icsFile( { ...event, uid: 'wordplus-stream-' + props.start + '@' + window.location.hostname } ) );
                        close();
                    } }>
                        { __( 'Apple Calendar, Outlook (.ics)', 'wordplus-live-stream' ) }
                    </MenuItem>
                </>
            ) }
        </MenuButton>
    );
}

function BeforeStart( props : { scheduled? : number | null } ){
    const now = useNow( 30000 );
    const at = props.scheduled ?? null;
    const ahead = at !== null && at > now;

    const texts = usePlayer().texts;

    return (
        <Screen icon={ ahead ? 'clock' : 'broadcast' } title={ texts?.soon || __( 'The stream starts soon', 'wordplus-live-stream' ) }>
            { texts?.soon_note && <span className="estream-screen__sub">{ texts.soon_note }</span> }
            { ahead && at - now < COUNTDOWN_MS && <Countdown at={ at } /> }
            { at !== null && (
                <span className="estream-screen__sub">
                    { ahead ? sprintf( _x( 'Starts %s', 'a date and time', 'wordplus-live-stream' ), dateTime( at ) ) : __( 'Starting any moment now', 'wordplus-live-stream' ) }
                </span>
            ) }
            { ahead && <div className="estream-screen__actions"><AddToCalendar start={ at } /></div> }
        </Screen>
    );
}

// The next session, said under the thanks for the one that ended: its title where it has one, and when.
function NextSession( props : { at : number, title? : string } ){
    return (
        <span className="estream-screen__sub estream-screen__next">
            { props.title
                ? sprintf( _x( 'Next: %1$s, %2$s', 'the next time a stream goes live: its title, then its date and time', 'wordplus-live-stream' ), props.title, dateTime( props.at ) )
                : sprintf( _x( 'Next: %s', 'the next time a stream goes live: its date and time', 'wordplus-live-stream' ), dateTime( props.at ) ) }
        </span>
    );
}

function Ended( props : { state : EasyStreamState } ){
    const stream = props.state.stream!;
    const ran = stream.started_at && stream.ended_at && stream.ended_at > stream.started_at ? stream.ended_at - stream.started_at : 0;
    const { texts, next } = usePlayer();

    return (
        <Screen icon="broadcast" title={ texts?.ended || __( 'This stream has ended', 'wordplus-live-stream' ) }>
            { ran > 0 && <span className="estream-screen__sub">{ sprintf( _x( 'It ran for %s', 'how long a stream lasted, as 1:02:15', 'wordplus-live-stream' ), clock( ran ) ) }</span> }
            <span className="estream-screen__sub">{ texts?.thanks || __( 'Thanks for watching', 'wordplus-live-stream' ) }</span>
            { next && <NextSession at={ next.at } title={ next.title } /> }
        </Screen>
    );
}

// Live with nobody's picture yet: the host stepped away, or their OBS stopped.
function Waiting(){
    const texts = usePlayer().texts;
    return <Screen busy title={ texts?.waiting || __( 'Waiting for the picture of the host…', 'wordplus-live-stream' ) } />;
}

// Past the audience the stream takes, waiting for a place.
function Full( props : { seconds : number } ){
    const texts = usePlayer().texts;

    return (
        <Screen busy title={ texts?.full || __( 'The stream is full. Joining as soon as a place frees up…', 'wordplus-live-stream' ) }>
            { props.seconds > 0 && <span className="estream-screen__sub">{ sprintf( _nx( 'About %s second', 'About %s seconds', props.seconds, 'how long until a place frees up', 'wordplus-live-stream' ), count( props.seconds ) ) }</span> }
        </Screen>
    );
}

// The studio's picture before going live and after a stream: what the host does next, never a viewer's wait or
// thanks. The choices are under the picture (studio.tsx, Sources).
function StudioIdle( props : { state : EasyStreamState, scheduled? : number | null } ){
    const stream = props.state.stream!;
    const at = props.scheduled ?? null;
    const { next } = usePlayer();

    if( stream.state === 'ended' ){
        const ran = stream.started_at && stream.ended_at && stream.ended_at > stream.started_at ? stream.ended_at - stream.started_at : 0;

        return (
            <Screen icon="broadcast" title={ __( 'Your stream has ended', 'wordplus-live-stream' ) }>
                { ran > 0 && <span className="estream-screen__sub">{ sprintf( _x( 'It ran for %s', 'how long a stream lasted, as 1:02:15', 'wordplus-live-stream' ), clock( ran ) ) }</span> }
                { next && <NextSession at={ next.at } title={ next.title } /> }
                <span className="estream-screen__sub">{ __( 'To go live again, turn on your camera or stream from OBS, below.', 'wordplus-live-stream' ) }</span>
            </Screen>
        );
    }

    return (
        <Screen icon="broadcast" title={ __( 'Ready when you are', 'wordplus-live-stream' ) }>
            { at !== null && <span className="estream-screen__sub">{ sprintf( _x( 'Planned for %s', 'a date and time', 'wordplus-live-stream' ), dateTime( at ) ) }</span> }
            <span className="estream-screen__sub">{ __( 'Turn on your camera, or stream from OBS, below. Only you see the preview until you go live.', 'wordplus-live-stream' ) }</span>
        </Screen>
    );
}

// A host's picture on a site whose streams the cloud doesn't take yet (the client's offlineHost): in the studio the
// preview works, and going live waits for the site to be connected, with the way there for those who may.
function Unconnected( props : { studio : boolean } ){
    const { connectUrl } = usePlayer();

    return (
        <Screen icon="broadcast" title={ __( 'Not connected to WordPlus Cloud yet', 'wordplus-live-stream' ) }>
            { props.studio && <span className="estream-screen__sub">{ __( 'Try your camera, microphone and screen below. Only you see the preview.', 'wordplus-live-stream' ) }</span> }
            <span className="estream-screen__sub">{ __( 'Going live needs the site connected to WordPlus Cloud.', 'wordplus-live-stream' ) }</span>
            { connectUrl && (
                <div className="estream-screen__actions">
                    <a className="estream-button estream-button--primary" href={ connectUrl }>{ __( 'Connect to go live', 'wordplus-live-stream' ) }</a>
                </div>
            ) }
        </Screen>
    );
}

function Failed( props : { error : string | null } ){
    const client = useClient();
    const code = props.error ?? '';
    const retry = RETRYABLE.has( code ) || ! KNOWN.has( code );

    return (
        <Screen icon="alert" tone="error" title={ errorText( props.error ) }>
            { code === 'expired' ? (
                <div className="estream-screen__actions">
                    <button type="button" className="estream-button" onClick={ () => window.location.reload() }>
                        <Icon name="retry" />{ __( 'Reload the page', 'wordplus-live-stream' ) }
                    </button>
                </div>
            ) : retry ? (
                <div className="estream-screen__actions">
                    <button type="button" className="estream-button" onClick={ () => void client.start() }>
                        <Icon name="retry" />{ code === 'kicked' ? __( 'Join again', 'wordplus-live-stream' ) : __( 'Try again', 'wordplus-live-stream' ) }
                    </button>
                </div>
            ) : null }
        </Screen>
    );
}

// The screen for the moment, or null when the picture is there to show. `studio`: the host's own view, which says
// what to do next before going live and after a stream.
export function screenFor( state : EasyStreamState, scheduled? : number | null, studio = false ) : ReactNode | null {
    // Refused while the site's streams take no new viewers (its account's credits spent): said as a full stream
    // is, nothing of what the site pays, and the page joins by itself once it can (the client asks every minute).
    if( state.status === 'error' && state.error === 'no_hours' ) return <Full seconds={ 0 } />;
    if( state.status === 'error' ) return <Failed error={ state.error } />;
    // A host setting up before the site is connected: their preview once it is on, what they can do until then.
    if( state.status === 'unconnected' ) return state.tiles.length > 0 ? null : <Unconnected studio={ studio } />;
    if( state.status === 'joining' || ! state.stream ) return <Screen busy title={ __( 'Joining…', 'wordplus-live-stream' ) } />;
    if( state.tiles.length > 0 ) return null;

    const live = state.stream.state === 'live';

    // A host streaming from OBS whose picture hasn't come: before going live, while live, or setting up the
    // next stream after one ended.
    if( state.you?.role === 'host' && state.encoder ) return <Screen busy title={ __( 'Waiting for OBS…', 'wordplus-live-stream' ) } />;

    if( studio && state.you?.role === 'host' && ! live ) return <StudioIdle state={ state } scheduled={ scheduled } />;

    // Ended, its viewers thanked, until the countdown to the next session (`scheduled` then, the player's).
    if( state.stream.state === 'ended' && ( scheduled === undefined || scheduled === null ) ) return <Ended state={ state } />;

    if( state.media === 'waiting' ){
        return <Full seconds={ state.waitUntil ? Math.max( 0, Math.round( ( state.waitUntil - Date.now() ) / 1000 ) ) : 0 } />;
    }

    if( live && state.error === 'media_unreachable' && state.media === 'off' ){
        return (
            <Screen icon="signal" tone="error" title={ errorText( 'media_unreachable' ) }>
                <span className="estream-screen__sub">{ __( 'Trying again…', 'wordplus-live-stream' ) }</span>
            </Screen>
        );
    }

    if( state.media === 'connecting' || ( live && state.you?.role === 'viewer' && state.media !== 'live' ) ){
        return <Screen busy title={ __( 'Connecting…', 'wordplus-live-stream' ) } />;
    }

    // The host's own view, live with nothing going out (everything turned off, or back after a reload): what to do.
    if( live && studio && state.you?.role === 'host' ){
        return (
            <Screen icon="broadcast" title={ __( 'You are live, but nothing is going out', 'wordplus-live-stream' ) }>
                <span className="estream-screen__sub">{ __( 'Turn on your camera or microphone, or share your screen, below. Viewers see that the picture of the host is on its way.', 'wordplus-live-stream' ) }</span>
            </Screen>
        );
    }

    // In the room, live, and nobody sending a picture yet: the host stepped away, or their OBS stopped.
    if( live ) return <Waiting />;

    return <BeforeStart scheduled={ scheduled } />;
}
