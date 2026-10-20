import {useEffect, useRef, useState, type ReactNode} from "react";
import type {AudioOut, MediaStats, PlaybackEvent, PlaybackStats, SendingStats, SendLimit, VideoOut} from "@wordplus/realtime-client/streams";
import {__, _x, sprintf} from "./i18n.ts";
import {useClient, useStream} from "./context.tsx";
import {clock, count} from "./format.ts";
import {Icon} from "./icons.tsx";
import {usePlayer} from "./player.tsx";
import {sentText} from "./studio.tsx";

// The player's statistics, to debug a stream that plays or goes out badly: what arrives and how, read from the engine
// (playbackStats()) once a second while open, over the picture, and for a host what goes out, each picture layer by
// layer and the sound (sendingDetail()). Copy puts all of it, with the browser's name, on the clipboard as JSON, to
// paste into a support request. Nothing is sent anywhere.

const EVERY_MS = 1000;

const ms = ( n : number ) => sprintf( _x( '%s ms', 'a length of time in milliseconds', 'wordplus-stream' ), count( n ) );
const seconds = ( n : number ) => sprintf( _x( '%s s', 'a length of time in seconds', 'wordplus-stream' ), ( Math.round( n / 100 ) / 10 ).toLocaleString() );
const percent = ( n : number ) => sprintf( _x( '%s%%', 'a percentage', 'wordplus-stream' ), n.toLocaleString() );
const kbps = ( n : number ) => sprintf( _x( '%s kbps', 'kilobits a second', 'wordplus-stream' ), count( n ) );
const height = ( n : number ) => sprintf( _x( '%dp', 'a picture\'s height, as in 720p', 'wordplus-stream' ), n );

function eventName( kind : PlaybackEvent['kind'] ) : string {
    switch( kind ){
        case 'joining': return _x( 'Joining', 'a stream\'s video, in the statistics', 'wordplus-stream' );
        case 'joined': return _x( 'Joined', 'a stream\'s video, in the statistics', 'wordplus-stream' );
        case 'first-frame': return _x( 'First picture', 'in the statistics', 'wordplus-stream' );
        case 'stalled': return _x( 'Picture stopped', 'in the statistics', 'wordplus-stream' );
        case 'resumed': return _x( 'Picture back', 'in the statistics', 'wordplus-stream' );
        case 'reconnecting': return __( 'Reconnecting…', 'wordplus-stream' );
        case 'reconnected': return _x( 'Reconnected', 'in the statistics', 'wordplus-stream' );
        case 'rejoined': return _x( 'Joined again', 'a stream\'s video, in the statistics', 'wordplus-stream' );
        case 'offline': return __( 'You are offline', 'wordplus-stream' );
        case 'online': return _x( 'Online again', 'in the statistics', 'wordplus-stream' );
        case 'quality': return _x( 'Quality chosen', 'in the statistics', 'wordplus-stream' );
        case 'error': return _x( 'Error', 'in the statistics', 'wordplus-stream' );
        case 'published': return _x( 'Started sending', 'the camera, microphone or screen, in the statistics', 'wordplus-stream' );
        case 'unpublished': return _x( 'Stopped sending', 'the camera, microphone or screen, in the statistics', 'wordplus-stream' );
        default: return _x( 'Left', 'a stream\'s video, in the statistics', 'wordplus-stream' );
    }
}

// What sends, by the RTC client's name for it.
function sourceName( source : string ) : string {
    switch( source ){
        case 'camera': return __( 'Camera', 'wordplus-stream' );
        case 'microphone': return __( 'Microphone', 'wordplus-stream' );
        case 'screen_share': return _x( 'Screen', 'a shared screen, in the statistics', 'wordplus-stream' );
        default: return source;
    }
}

// What a moment is, as an event says it: a length for the first picture and a picture back, what began or stopped
// going out.
function eventDetail( event : PlaybackEvent ) : string {
    if( ! event.detail ) return '';
    if( event.kind === 'first-frame' || event.kind === 'resumed' ) return seconds( Number( event.detail ) );
    if( event.kind === 'published' || event.kind === 'unpublished' ) return sourceName( event.detail );
    return event.detail;
}

function limitName( limit : SendLimit ) : string {
    switch( limit ){
        case 'cpu': return _x( 'The computer', 'what holds a picture back, in the statistics', 'wordplus-stream' );
        case 'bandwidth': return _x( 'The connection', 'what holds a picture back, in the statistics', 'wordplus-stream' );
        case 'other': return _x( 'Something else', 'what holds a picture back, in the statistics', 'wordplus-stream' );
        default: return '–';
    }
}

const size = ( width : number, height : number ) => width + '×' + height;
const fps = ( n : number ) => sprintf( _x( '%d fps', 'frames a second', 'wordplus-stream' ), n );

type Row = [ string, ReactNode ] | null;

function Section( props : { title : string, rows : Row[] } ){
    const rows = props.rows.filter( ( r ) : r is [ string, ReactNode ] => r !== null );
    if( rows.length === 0 ) return null;

    return (
        <section className="estream-stats__section">
            <h3 className="estream-stats__heading">{ props.title }</h3>
            <dl className="estream-stats__rows">
                { rows.map( ( [ label, value ] ) => (
                    <div key={ label } className="estream-stats__row">
                        <dt>{ label }</dt>
                        <dd>{ value }</dd>
                    </div>
                ) ) }
            </dl>
        </section>
    );
}

// A picture going out: what the camera or screen gives, how it is encoded, each layer the media server may pass on (the
// largest first, those it turned off for want of a viewer who needs them), what holds it back, and what the server
// says of it.
function PictureOut( props : { video : VideoOut } ){
    const { video } = props;
    const on = video.layers.filter( ( l ) => l.active );
    const top = on[ 0 ] ?? video.layers[ 0 ];
    const encoder = video.layers.find( ( l ) => l.encoder );
    const sum = ( pick : ( l : VideoOut['layers'][number] ) => number ) => video.layers.reduce( ( n, l ) => n + pick( l ), 0 );

    return (
        <Section title={ video.source === 'screen' ? _x( 'Sending the screen', 'in the statistics', 'wordplus-stream' ) : _x( 'Sending the camera', 'in the statistics', 'wordplus-stream' ) } rows={ [
            video.capture ? [ _x( 'Captured', 'the picture a camera or screen gives, in the statistics', 'wordplus-stream' ), size( video.capture.width, video.capture.height ) + ' · ' + fps( video.capture.fps ) ] : null,
            video.codec ? [ _x( 'Codec', 'in the statistics', 'wordplus-stream' ), [ video.codec, encoder?.encoder, encoder?.hardware ? _x( 'in hardware', 'a video encoded by the device chip', 'wordplus-stream' ) : null ].filter( Boolean ).join( ', ' ) ] : null,
            [ _x( 'Bitrate', 'in the statistics', 'wordplus-stream' ), kbps( video.kbps ) ],
            ...video.layers.map( ( l ) : Row => [
                sprintf( _x( 'Layer %s', 'a simulcast layer by its height, as 720p, in the statistics', 'wordplus-stream' ), l.height > 0 ? height( l.height ) : ( l.rid ?? '' ) ),
                ! l.active ? _x( 'Off, no viewer needs it', 'a simulcast layer, in the statistics', 'wordplus-stream' )
                    : l.height > 0 ? [ size( l.width, l.height ), fps( l.fps ), kbps( l.kbps ) ].join( ' · ' )
                        : '–'
            ] ),
            top ? [ _x( 'Held back by', 'in the statistics', 'wordplus-stream' ), limitName( top.limited ) ] : null,
            video.limitedMs.cpu + video.limitedMs.bandwidth > 0 ? [
                _x( 'Time held back', 'in the statistics', 'wordplus-stream' ),
                sprintf( _x( 'Computer %1$s, connection %2$s', 'how long the picture was held back by each, in the statistics', 'wordplus-stream' ), seconds( video.limitedMs.cpu ), seconds( video.limitedMs.bandwidth ) )
            ] : null,
            [ _x( 'Packet loss', 'in the statistics', 'wordplus-stream' ), percent( Math.max( 0, ...on.map( ( l ) => l.lossPct ) ) ) ],
            top?.rttMs ? [ _x( 'Round trip', 'in the statistics', 'wordplus-stream' ), ms( top.rttMs ) ] : null,
            [ _x( 'Sent again', 'what was lost and sent once more, in the statistics', 'wordplus-stream' ), kbps( sum( ( l ) => l.resentKbps ) ) ],
            [ _x( 'Repairs asked', 'NACK and PLI requests, in the statistics', 'wordplus-stream' ), sprintf( _x( '%1$s NACK, %2$s PLI, %3$s FIR', 'counts of three kinds of repair requests', 'wordplus-stream' ), count( sum( ( l ) => l.nacks ) ), count( sum( ( l ) => l.plis ) ), count( sum( ( l ) => l.firs ) ) ) ]
        ] } />
    );
}

function SoundOut( props : { audio : AudioOut } ){
    const { audio } = props;
    return (
        <Section title={ _x( 'Sending the sound', 'in the statistics', 'wordplus-stream' ) } rows={ [
            audio.codec ? [ _x( 'Codec', 'in the statistics', 'wordplus-stream' ), audio.codec ] : null,
            [ _x( 'Level', 'how loud the microphone is, in the statistics', 'wordplus-stream' ), audio.muted ? _x( 'Muted', 'the microphone, in the statistics', 'wordplus-stream' ) : percent( Math.round( ( audio.level ?? 0 ) * 100 ) ) ],
            [ _x( 'Bitrate', 'in the statistics', 'wordplus-stream' ), kbps( audio.kbps ) ],
            [ _x( 'Packet loss', 'in the statistics', 'wordplus-stream' ), percent( audio.lossPct ) ],
            [ _x( 'Jitter', 'in the statistics', 'wordplus-stream' ), ms( audio.jitterMs ) ],
            audio.rttMs ? [ _x( 'Round trip', 'in the statistics', 'wordplus-stream' ), ms( audio.rttMs ) ] : null
        ] } />
    );
}

// What the stats say, and for a host what goes out, as last read: in detail, and as the studio says it.
function useReadings( on : boolean ){
    const client = useClient();
    const state = useStream();
    const host = state.you?.role === 'host' || state.onStage;
    const [ stats, setStats ] = useState<PlaybackStats | null>( null );
    const [ sending, setSending ] = useState<MediaStats | null>( null );
    const [ detail, setDetail ] = useState<SendingStats | null>( null );

    useEffect( () => {
        if( ! on ) return;
        let gone = false;
        const look = () => {
            setStats( client.playbackStats?.() ?? null );
            if( ! host ) return;
            void client.sendingStats?.().then( ( s ) => { if( ! gone ) setSending( s ); } ).catch( () => {} );
            void client.sendingDetail?.().then( ( d ) => { if( ! gone ) setDetail( d ); } ).catch( () => {} );
        };
        look();
        const timer = setInterval( look, EVERY_MS );
        return () => {
            gone = true;
            clearInterval( timer );
        };
    }, [ on, client, host ] );

    return { stats, sending, detail };
}

export function StatsPanel(){
    const client = useClient();
    const state = useStream();
    const player = usePlayer();
    const { stats, sending, detail } = useReadings( player.statsOpen );
    const [ copied, setCopied ] = useState( false );
    const panel = useRef<HTMLDivElement>( null );

    // Opened from the menu, the panel takes the focus, and gives it back to the picture as it closes.
    useEffect( () => {
        if( ! player.statsOpen ) return;
        panel.current?.focus();
    }, [ player.statsOpen ] );

    if( ! player.statsOpen ) return null;

    const video = stats?.video ?? null;
    const audio = stats?.audio ?? null;
    // The way in, or for a host who receives nothing the way out: the same connection to the media server.
    const transport = stats?.transport ?? detail?.transport ?? null;
    const upload = detail?.transport?.availableKbps ?? null;
    const session = stats?.session ?? null;
    const server = stats?.server ?? null;

    const copy = () => {
        const all = {
            at: new Date().toISOString(),
            browser: globalThis.navigator?.userAgent ?? '',
            stream: state.stream?.id ?? null,
            role: state.you?.role ?? null,
            media: state.media,
            quality: state.quality,
            connection: state.connection,
            offline: state.offline,
            stalled: state.stalled,
            playback: client.playbackStats?.() ?? null,
            sending,
            sendingDetail: detail
        };
        void globalThis.navigator?.clipboard?.writeText( JSON.stringify( all, null, 2 ) ).then( () => {
            setCopied( true );
            setTimeout( () => setCopied( false ), 2000 );
        } ).catch( () => {} );
    };

    const close = () => {
        player.toggleStats();
        ( player.root.current?.querySelector( '.estream-stage' ) as HTMLElement | null )?.focus();
    };

    const transportText = transport?.protocol
        ? transport.relayed
            ? sprintf( _x( '%1$s, through a relay (%2$s)', 'the network protocol, then the relay protocol', 'wordplus-stream' ), transport.protocol.toUpperCase(), ( transport.relayProtocol ?? '' ).toUpperCase() )
            : transport.protocol.toUpperCase()
        : null;

    // Behind the server: the hold before frames play, and half the round trip.
    const delay = video && video.bufferMs > 0 ? video.bufferMs + Math.round( ( transport?.rttMs ?? 0 ) / 2 ) : null;
    const layers = video?.layers.filter( ( l ) => l.height > 0 ).map( ( l ) => height( l.height ) ).join( ', ' ) ?? '';

    return (
        <div
            ref={ panel }
            className="estream-stats"
            role="region"
            aria-label={ __( 'Statistics', 'wordplus-stream' ) }
            tabIndex={ -1 }
            onKeyDown={ ( e ) => { if( e.key === 'Escape' ){ e.stopPropagation(); close(); } } }
        >
            <div className="estream-stats__head">
                <h2 className="estream-stats__title">{ __( 'Statistics', 'wordplus-stream' ) }</h2>
                <button type="button" className="estream-stats__button" onClick={ copy }>
                    <Icon name={ copied ? 'check' : 'copy' } />
                    { copied ? __( 'Copied', 'wordplus-stream' ) : __( 'Copy', 'wordplus-stream' ) }
                </button>
                <button type="button" className="estream-stats__button estream-stats__close" aria-label={ _x( 'Close', 'the statistics', 'wordplus-stream' ) } onClick={ close }>
                    <Icon name="close" />
                </button>
            </div>
            <div className="estream-stats__body" aria-live="off">
                { /* For a host, what goes out first: what a host debugs. */ }
                { detail?.video.map( ( v ) => <PictureOut key={ v.source } video={ v } /> ) }
                { detail?.audio && <SoundOut audio={ detail.audio } /> }
                { ! detail && sending && (
                    <Section title={ _x( 'Sending', 'what a host sends, in the statistics', 'wordplus-stream' ) } rows={ [
                        [ _x( 'Picture', 'the video, in the statistics', 'wordplus-stream' ), sentText( sending, state ) ]
                    ] } />
                ) }
                <Section title={ _x( 'Picture', 'the video, in the statistics', 'wordplus-stream' ) } rows={ video ? [
                    [ _x( 'Resolution', 'in the statistics', 'wordplus-stream' ), video.width > 0 ? video.width + '×' + video.height : '' ],
                    video.layer && layers ? [ _x( 'Layer', 'a simulcast layer, in the statistics', 'wordplus-stream' ), sprintf( _x( '%1$s, of %2$s sent', 'the layer arriving, then the layers sent', 'wordplus-stream' ), height( video.height ), layers ) ] : null,
                    [ _x( 'Frame rate', 'in the statistics', 'wordplus-stream' ), sprintf( _x( '%d fps', 'frames a second', 'wordplus-stream' ), video.fps ) ],
                    [ _x( 'Bitrate', 'in the statistics', 'wordplus-stream' ), kbps( video.kbps ) ],
                    video.codec ? [ _x( 'Codec', 'in the statistics', 'wordplus-stream' ), [ video.codec, video.decoder, video.hardware ? _x( 'in hardware', 'a video decoded by the device chip', 'wordplus-stream' ) : null ].filter( Boolean ).join( ', ' ) ] : null,
                    [ _x( 'Packet loss', 'in the statistics', 'wordplus-stream' ), percent( video.lossPct ) ],
                    [ _x( 'Jitter', 'in the statistics', 'wordplus-stream' ), ms( video.jitterMs ) ],
                    video.bufferMs > 0 ? [ _x( 'Buffer', 'how long frames wait to play, in the statistics', 'wordplus-stream' ), ms( video.bufferMs ) ] : null,
                    [ _x( 'Dropped frames', 'in the statistics', 'wordplus-stream' ), count( video.dropped ) ],
                    [ _x( 'Freezes', 'in the statistics', 'wordplus-stream' ), sprintf( _x( '%1$s, %2$s in all', 'how many times the picture froze, then for how long', 'wordplus-stream' ), count( video.freezes ), seconds( video.frozenMs ) ) ],
                    [ _x( 'Repairs asked', 'NACK and PLI requests, in the statistics', 'wordplus-stream' ), sprintf( _x( '%1$s NACK, %2$s PLI', 'counts of two kinds of repair requests', 'wordplus-stream' ), count( video.nacks ), count( video.plis ) ) ]
                ] : [] } />
                <Section title={ _x( 'Sound', 'the audio, in the statistics', 'wordplus-stream' ) } rows={ audio ? [
                    audio.codec ? [ _x( 'Codec', 'in the statistics', 'wordplus-stream' ), audio.codec ] : null,
                    [ _x( 'Bitrate', 'in the statistics', 'wordplus-stream' ), kbps( audio.kbps ) ],
                    [ _x( 'Packet loss', 'in the statistics', 'wordplus-stream' ), percent( audio.lossPct ) ],
                    [ _x( 'Jitter', 'in the statistics', 'wordplus-stream' ), ms( audio.jitterMs ) ],
                    [ _x( 'Concealed', 'sound made up for what did not arrive, in the statistics', 'wordplus-stream' ), percent( audio.concealedPct ) ]
                ] : [] } />
                <Section title={ _x( 'Connection', 'in the statistics', 'wordplus-stream' ) } rows={ [
                    server ? [ __( 'Server', 'wordplus-stream' ), [ server.node, server.region ].filter( Boolean ).join( ', ' ) || ( server.url ?? '' ).replace( /^wss?:\/\//, '' ) ] : null,
                    transportText ? [ _x( 'Transport', 'in the statistics', 'wordplus-stream' ), transportText ] : null,
                    transport?.rttMs ? [ _x( 'Round trip', 'in the statistics', 'wordplus-stream' ), ms( transport.rttMs ) ] : null,
                    upload !== null ? [ _x( 'Upload estimate', 'what the browser estimates it can send, in the statistics', 'wordplus-stream' ), kbps( upload ) ] : null,
                    delay !== null ? [ _x( 'Delay after the server', 'the buffer and half the round trip, in the statistics', 'wordplus-stream' ), ms( delay ) ] : null,
                    state.connection !== 'unknown' ? [ _x( 'Rated', 'how the media server rates the connection, in the statistics', 'wordplus-stream' ), state.connection === 'good' ? __( 'Good connection', 'wordplus-stream' ) : __( 'Weak connection', 'wordplus-stream' ) ] : null
                ] } />
                <Section title={ _x( 'Session', 'in the statistics', 'wordplus-stream' ) } rows={ session ? [
                    [ _x( 'Picture in', 'how long the first picture took, in the statistics', 'wordplus-stream' ), session.startupMs !== null ? seconds( session.startupMs ) : '–' ],
                    [ _x( 'Watched', 'how long, in the statistics', 'wordplus-stream' ), clock( session.watchedMs ) ],
                    [ _x( 'Stalls', 'in the statistics', 'wordplus-stream' ), sprintf( _x( '%1$s, %2$s in all', 'how many times the picture froze, then for how long', 'wordplus-stream' ), count( session.stalls ), seconds( session.stalledMs ) ) ],
                    [ _x( 'Reconnects', 'in the statistics', 'wordplus-stream' ), count( session.reconnects ) ],
                    [ _x( 'Joined again', 'a stream\'s video, in the statistics', 'wordplus-stream' ), count( session.rejoins ) ],
                    [ _x( 'Errors', 'in the statistics', 'wordplus-stream' ), count( session.errors ) ]
                ] : [] } />
                { stats && stats.events.length > 0 && (
                    <section className="estream-stats__section">
                        <h3 className="estream-stats__heading">{ _x( 'What happened', 'the last events, in the statistics', 'wordplus-stream' ) }</h3>
                        <ol className="estream-stats__events">
                            { [ ...stats.events ].reverse().slice( 0, 12 ).map( ( event, i ) => (
                                <li key={ event.at + ':' + i }>
                                    <time>{ new Date( event.at ).toLocaleTimeString() }</time>
                                    { ' ' + eventName( event.kind ) }
                                    { event.detail ? ' · ' + eventDetail( event ) : '' }
                                </li>
                            ) ) }
                        </ol>
                    </section>
                ) }
                { ! stats && ! detail && <p className="estream-stats__empty">{ _x( 'Nothing arrives yet', 'in the statistics', 'wordplus-stream' ) }</p> }
            </div>
        </div>
    );
}
