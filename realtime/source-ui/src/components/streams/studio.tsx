import {useCallback, useEffect, useId, useRef, useState, type ReactNode} from "react";
import {__, _nx, _x, sprintf} from "./i18n.ts";
import type {DeviceChoice, Devices, EasyStreamClient, EasyStreamState, MediaStats} from "@wordplus/realtime-client/streams";
import type {Quality} from "@wordplus/realtime-client/streams";
import {useClient, useStream} from "./context.tsx";
import {useConfirm} from "./dialog.tsx";
import {clock, count, relative, timeOfDay} from "./format.ts";
import {Icon, type IconName} from "./icons.tsx";
import {MenuButton, MenuChoice, MenuHeading, MenuItem} from "./menu.tsx";
import {usePlayer, useNow} from "./player.tsx";
import {isBoolean, oneOf, readPref, writePref} from "./prefs.ts";
import {errorText} from "./words.ts";

// The host's studio, under the picture: choosing the source (camera or OBS), setting up the devices with
// the microphone's level, going live with a 3-2-1, then one bar of controls and a line of what matters
// while live (time on air, viewers and their peak, how the picture goes out), the guests, and at the end
// a summary.

type Result = { ok : boolean, error? : string } | void;

const STATS_EVERY_MS = 2000;
const SETTLING_MS = 10_000;
// OBS's key frames further apart than this are said (EncoderPanel).
const KEYFRAME_MOST_S = 3;
// OBS's picture arriving at fewer frames a second than this, SLOW_LOOKS looks in a row, is said (useSlowFrames): well
// under the 30 the steps ask for, and under the 24 or 25 some set on purpose.
const SLOW_FPS = 24;
const SLOW_LOOKS = 3;
const isString = ( v : unknown ) : v is string => typeof v === 'string';

// A quality's shorter side: 720p is 1280×720, or 720×1280 standing up.
const QUALITY_SIDE : Record<Quality, number> = { '720p': 720, '1080p': 1080 };
const qualityName = ( quality : Quality ) => sprintf( _x( '%dp', 'a picture\'s height, as in 720p', 'wordplus-live-stream' ), QUALITY_SIDE[ quality ] );
// The biggest 16:9 picture of a quality, lying or standing: 1280×720, 720×1280.
const biggest = ( quality : Quality, landscape : boolean ) => {
    const side = QUALITY_SIDE[ quality ];
    const long = Math.round( side * 16 / 9 );
    return landscape ? long + '×' + side : side + '×' + long;
};

// The devices this browser has, again when one comes or goes, and once devices open (when their names come).
function useDevices( client : EasyStreamClient, opened : boolean ) : Devices {
    const [ devices, setDevices ] = useState<Devices>( { cameras: [], microphones: [], speakers: [] } );

    useEffect( () => {
        let gone = false;
        const load = () => { void client.listDevices?.().then( ( d ) => { if( ! gone ) setDevices( d ); } ); };
        load();
        navigator.mediaDevices?.addEventListener?.( 'devicechange', load );
        return () => {
            gone = true;
            navigator.mediaDevices?.removeEventListener?.( 'devicechange', load );
        };
    }, [ client, opened ] );

    return devices;
}

// The device a track is on now.
export const deviceOf = ( track : MediaStreamTrack | null | undefined ) : string => track?.getSettings?.().deviceId ?? '';

export function deviceName( device : DeviceChoice, i : number, kind : 'camera' | 'microphone' | 'speaker' ) : string {
    if( device.label ) return device.label;
    if( kind === 'camera' ) return sprintf( _x( 'Camera %d', 'an unnamed camera', 'wordplus-live-stream' ), i + 1 );
    if( kind === 'microphone' ) return sprintf( _x( 'Microphone %d', 'an unnamed microphone', 'wordplus-live-stream' ), i + 1 );
    return sprintf( _x( 'Speakers %d', 'unnamed speakers', 'wordplus-live-stream' ), i + 1 );
}

// How loud the microphone is, drawn straight to the element each frame (no render per frame).
export function MicLevel( props : { track : MediaStreamTrack | null, compact? : boolean } ){
    const bar = useRef<HTMLSpanElement>( null );

    useEffect( () => {
        const element = bar.current;
        const AudioContextClass = window.AudioContext ?? ( window as unknown as { webkitAudioContext? : typeof AudioContext } ).webkitAudioContext;
        if( ! element || ! props.track || ! AudioContextClass ) return;

        let context : AudioContext;
        try {
            context = new AudioContextClass();
        } catch ( e ) {
            return;
        }

        const source = context.createMediaStreamSource( new MediaStream( [ props.track ] ) );
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect( analyser );
        const samples = new Float32Array( analyser.fftSize );
        let frame = 0;
        let level = 0;

        const draw = () => {
            analyser.getFloatTimeDomainData( samples );
            let sum = 0;
            for( const s of samples ) sum += s * s;
            // Loudness on a scale people read: quiet speech fills about a third, a raised voice most of it.
            const now = Math.min( 1, Math.sqrt( sum / samples.length ) * 4 );
            level = Math.max( now, level * 0.85 );
            element.style.setProperty( '--estream-level', ( level * 100 ).toFixed( 1 ) + '%' );
            frame = requestAnimationFrame( draw );
        };
        draw();

        return () => {
            cancelAnimationFrame( frame );
            source.disconnect();
            void context.close().catch( () => {} );
            element.style.setProperty( '--estream-level', '0%' );
        };
    }, [ props.track ] );

    return (
        <span className={ 'estream-level' + ( props.compact ? ' estream-level--compact' : '' ) } aria-hidden="true">
            <span ref={ bar } className="estream-level__bar" />
        </span>
    );
}

// The screen kept awake while live: a laptop or phone that sleeps ends the picture.
function useWakeLock( on : boolean ){
    useEffect( () => {
        const wake = ( navigator as Navigator & { wakeLock? : { request : ( type : 'screen' ) => Promise<{ release : () => Promise<void> }> } } ).wakeLock;
        if( ! on || ! wake ) return;

        let lock : { release : () => Promise<void> } | null = null;
        let gone = false;
        const take = () => { wake.request( 'screen' ).then( ( l ) => { if( gone ) void l.release(); else lock = l; } ).catch( () => {} ); };
        // A lock goes when the tab is hidden; it is taken again when it comes back.
        const back = () => { if( document.visibilityState === 'visible' ) take(); };

        take();
        document.addEventListener( 'visibilitychange', back );
        return () => {
            gone = true;
            document.removeEventListener( 'visibilitychange', back );
            void lock?.release().catch( () => {} );
        };
    }, [ on ] );
}

// Whether this window sends the stream while live, or has sent it with everything turned off for now: closing its
// studio takes the host's picture and sound off until they come back. Not for OBS, which goes on without it. A host
// app asks it before moving away from a studio in its own page (a route change, which no beforeunload warns of).
export function sendsHere( state : EasyStreamState ) : boolean {
    return state.stream?.state === 'live' && ( state.devices.camera || state.devices.microphone || state.screenSharing || state.sentHere );
}

// Leaving the page while live takes the host's picture off the stream: the browser asks first.
function useLeaveWarning( on : boolean ){
    useEffect( () => {
        if( ! on ) return;
        const warn = ( event : BeforeUnloadEvent ) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener( 'beforeunload', warn );
        return () => window.removeEventListener( 'beforeunload', warn );
    }, [ on ] );
}

// ⌘/Ctrl+D the microphone, ⌘/Ctrl+E the camera, as in video calls, while they are open.
function useDeviceKeys( on : boolean, toggle : ( device : 'camera' | 'microphone' ) => void ){
    useEffect( () => {
        if( ! on ) return;
        const keys = ( event : KeyboardEvent ) => {
            if( ! ( event.metaKey || event.ctrlKey ) || event.altKey || event.shiftKey ) return;
            const key = event.key.toLowerCase();
            if( key !== 'd' && key !== 'e' ) return;
            event.preventDefault();
            toggle( key === 'd' ? 'microphone' : 'camera' );
        };
        document.addEventListener( 'keydown', keys );
        return () => document.removeEventListener( 'keydown', keys );
    }, [ on, toggle ] );
}

// What a picture's numbers say: 1280×720 · 30 fps · 2.4 Mbps.
// `chosen`: the quality the host chose, when less goes out: 720p of 1080p · 30 fps · 2.4 Mbps.
function statsText( stats : MediaStats, chosen? : string ) : string {
    const sent = sprintf( _x( '%dp', 'a picture\'s height, as in 720p', 'wordplus-live-stream' ), stats.height );
    const parts : string[] = [ chosen ? sprintf( _x( '%1$s of %2$s', 'the quality sent of the quality chosen, as 720p of 1080p', 'wordplus-live-stream' ), sent, chosen ) : sent ];
    if( stats.fps > 0 ) parts.push( sprintf( _x( '%d fps', 'frames per second', 'wordplus-live-stream' ), stats.fps ) );
    if( stats.kbps > 0 ) parts.push( sprintf( _x( '%s Mbps', 'megabits per second', 'wordplus-live-stream' ), ( stats.kbps / 1000 ).toLocaleString( undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 } ) ) );
    return parts.join( ' · ' );
}

// What goes out, as the studio says it: with the quality chosen while less goes out than it (Numbers). While nobody has
// the picture on screen the media server sends none of it (dynacast), which the host isn't told: viewers are what a
// stream costs (WordPlus Cloud's credits, a minute of one viewer each), and a stream said to be paused would raise
// questions. It says the quality chosen then, as when it goes out.
export function sentText( stats : MediaStats, state : EasyStreamState ) : string {
    if( stats.paused ) return qualityName( state.sendQuality );
    return stats.held && ! state.encoder ? statsText( stats, qualityName( state.sendQuality ) ) : statsText( stats );
}

// `read` as the last render gave it: a studio reloaded while live from OBS starts reading the camera's picture and
// learns it streams from OBS a moment later, and kept reading the camera's, so the OBS panel had none of what arrives.
function useStats( read : () => Promise<MediaStats | null>, on : boolean ) : MediaStats | null {
    const [ stats, setStats ] = useState<MediaStats | null>( null );
    const reader = useRef( read );
    reader.current = read;

    useEffect( () => {
        if( ! on ){
            setStats( null );
            return;
        }
        let gone = false;
        const look = () => { void reader.current().then( ( s ) => { if( ! gone ) setStats( s ); } ).catch( () => {} ); };
        look();
        const timer = setInterval( look, STATS_EVERY_MS );
        return () => {
            gone = true;
            clearInterval( timer );
        };
    }, [ on ] );

    return stats;
}

// The frames a second of OBS's picture, once it has come at fewer than SLOW_FPS for SLOW_LOOKS looks in a row, or null:
// one slow look is a moment, as when a viewer's layer changes. No picture starts it again, and a look that has not
// counted frames yet (the first) counts for nothing either way.
function useSlowFrames( stats : MediaStats | null ) : number | null {
    const looks = useRef( 0 );
    const [ slow, setSlow ] = useState<number | null>( null );

    useEffect( () => {
        if( ! stats || stats.height === 0 ){
            looks.current = 0;
            setSlow( null );
            return;
        }
        const fps = stats.fps;
        if( fps === 0 ) return;
        looks.current = fps < SLOW_FPS ? looks.current + 1 : 0;
        setSlow( looks.current >= SLOW_LOOKS ? fps : null );
    }, [ stats ] );

    return slow;
}

// A figure or a state, with `tip` saying more (reached by the keyboard too).
function Chip( props : { icon? : IconName, tone? : 'live' | 'good' | 'warn', children : ReactNode, tip? : string } ){
    return (
        <span className={ 'estream-chip' + ( props.tone ? ' estream-chip--' + props.tone : '' ) } data-estream-tip={ props.tip } aria-description={ props.tip } tabIndex={ props.tip ? 0 : undefined }>
            { props.icon && <Icon name={ props.icon } /> }
            { props.children }
        </span>
    );
}

// How the picture goes out while live, in a word: null before anything is known. The computer first: short of it, the
// browser drops the larger sizes, and the media server then rates the connection poor too, though the network is fine
// (a viewer going full screen asks for Full HD, which the computer has to make). In its first seconds the browser is
// still raising what it sends, as it finds what the connection takes: not a connection holding the picture back.
export function sendingHealth( stats : MediaStats | null, state : EasyStreamState, now : number ) : { kind : 'cpu' | 'weak' | 'good', text : string } | null {
    const weak = state.connection === 'poor' || state.connection === 'lost';
    const settling = now - ( state.stream?.started_at ?? now ) < SETTLING_MS;

    if( stats?.limited === 'cpu' ) return { kind: 'cpu', text: __( 'Your computer is busy: the picture is reduced', 'wordplus-live-stream' ) };
    if( weak ) return { kind: 'weak', text: __( 'Weak connection', 'wordplus-live-stream' ) };
    if( stats?.limited === 'bandwidth' && ! settling ) return { kind: 'weak', text: __( 'Your connection is holding the picture back', 'wordplus-live-stream' ) };
    if( stats ) return { kind: 'good', text: __( 'Good connection', 'wordplus-live-stream' ) };
    return null;
}

// While live: how long, how many, and how the picture goes out, with the way to everything that goes out in detail.
// `tally`: the messages and reactions since going live too, where there is room for them (the studio page).
export function StudioStatus( props : { stats : MediaStats | null, tally? : boolean } ){
    const state = useStream();
    const player = usePlayer();
    const now = useNow( 1000 );
    const started = state.stream?.started_at ?? now;
    const { stats } = props;
    const full = state.audience !== null && state.viewers >= state.audience;
    // The viewers at once the site streams to unmetered, who still join with no credits left; null where unsaid.
    const unmetered = typeof state.usage?.unmetered_viewers === 'number' && state.usage.unmetered_viewers > 0 ? state.usage.unmetered_viewers : null;
    const sent = sendingHealth( stats, state, now );
    const health = sent && <Chip icon={ sent.kind === 'cpu' ? 'alert' : 'signal' } tone={ sent.kind === 'good' ? 'good' : 'warn' }>{ sent.text }</Chip>;

    return (
        <div className="estream-studio__status">
            <Chip tone="live" tip={ __( 'Time on air', 'wordplus-live-stream' ) }>
                { _x( 'Live', 'a stream on air', 'wordplus-live-stream' ) } <span className="estream-chip__number">{ clock( now - started ) }</span>
            </Chip>
            { /* How many watch; "full" while the cloud still caps a stream and it is reached, the rest waiting for a place. No
                 "up to N viewers" otherwise: credits limit streams instead. */ }
            <Chip
                icon="eye"
                tone={ full ? 'warn' : undefined }
                tip={ full && state.audience !== null
                    ? sprintf( _nx( 'The stream is full: it takes %s viewer, and the next ones wait for a place.', 'The stream is full: it takes %s viewers, and the next ones wait for a place.', state.audience, 'the most viewers a stream takes', 'wordplus-live-stream' ), count( state.audience ) )
                    : undefined }
            >
                { sprintf( _nx( '%s watching', '%s watching', state.viewers, 'how many people watch', 'wordplus-live-stream' ), count( state.viewers ) ) }
                { full && <span className="estream-chip__sub">{ _x( 'full', 'a stream with as many viewers as it takes', 'wordplus-live-stream' ) }</span> }
            </Chip>
            { /* The most watching at once since going live, as the cloud keeps it: the same on every page, one opened
                 during the stream too, and always shown. */ }
            <Chip icon="peak" tip={ __( 'The most watching at once since you went live', 'wordplus-live-stream' ) }>
                { sprintf( _x( 'Peak %s', 'the most watching at once', 'wordplus-live-stream' ), count( Math.max( state.tally.peak, state.viewers ) ) ) }
            </Chip>
            { /* The plan's credits, the bought ones and a month's borrowing all used (the cloud's word, asked every two
                 minutes): those watching stay, and nobody new joins above the site's unmetered viewers, with the way to
                 buy more. */ }
            { state.usage && ! state.usage.admit && (
                <Chip icon="alert" tone="warn" tip={ unmetered === null
                    ? __( 'Your credits are used up, and so is what you may borrow. Those watching stay, and nobody new can join until you buy more.', 'wordplus-live-stream' )
                    : sprintf( _nx( 'Your credits are used up, and so is what you may borrow. Up to %s viewer at once still joins, and those above wait until you buy more. Those watching are never cut off.', 'Your credits are used up, and so is what you may borrow. Up to %s viewers at once still join, and those above wait until you buy more. Those watching are never cut off.', unmetered, 'the viewers at once a site streams to with no credits', 'wordplus-live-stream' ), count( unmetered ) ) }>
                    { unmetered === null
                        ? __( 'New viewers cannot join', 'wordplus-live-stream' )
                        : sprintf( _nx( 'Viewers above %s cannot join', 'Viewers above %s cannot join', unmetered, 'the viewers at once a site streams to with no credits', 'wordplus-live-stream' ), count( unmetered ) ) }
                    { state.usage.buy_url && (
                        <a className="estream-chip__link" href={ state.usage.buy_url } target="_blank" rel="noopener noreferrer">{ __( 'Buy credits', 'wordplus-live-stream' ) }</a>
                    ) }
                </Chip>
            ) }
            { props.tally && (
                <>
                    <Chip icon="chat">{ sprintf( _nx( '%s message', '%s messages', state.tally.messages, 'chat messages since going live', 'wordplus-live-stream' ), count( state.tally.messages ) ) }</Chip>
                    <Chip icon="smile">{ sprintf( _nx( '%s reaction', '%s reactions', state.tally.reactions, 'reactions since going live', 'wordplus-live-stream' ), count( state.tally.reactions ) ) }</Chip>
                </>
            ) }
            { health }
            { stats && ( stats.height > 0 || stats.paused ) && <Numbers stats={ stats } /> }
            { /* Everything that goes out, layer by layer, over the picture (stats.tsx), as the player's menu and its i key
                 open it. Not in a settings page's preview, where nothing goes out. */ }
            { ! player.preview && (
                <button type="button" className="estream-chip estream-chip--button" aria-pressed={ player.statsOpen } onClick={ player.toggleStats }>
                    <Icon name="stats" />
                    { player.statsOpen ? _x( 'Hide statistics', 'of the player', 'wordplus-live-stream' ) : __( 'Statistics', 'wordplus-live-stream' ) }
                </button>
            ) }
        </div>
    );
}

// How the picture goes out, and while no viewer's player needs the quality chosen, the smaller one it goes out at
// ("720p of 1080p"), with when the rest comes.
function Numbers( props : { stats : MediaStats } ){
    const state = useStream();
    const { stats } = props;

    // Nobody has the picture on screen: the quality chosen, nothing of a pause (sentText).
    if( stats.paused ) return <span className="estream-studio__numbers">{ sentText( stats, state ) }</span>;
    if( ! stats.held || state.encoder ) return <span className="estream-studio__numbers">{ statsText( stats ) }</span>;

    const chosen = qualityName( state.sendQuality );
    const tip = sprintf( _x( 'Viewers get %s when one watches in a big window or full screen.', 'the quality chosen, as 1080p', 'wordplus-live-stream' ), chosen );
    return (
        <span className="estream-studio__numbers" data-estream-tip={ tip } aria-description={ tip } tabIndex={ 0 }>{ statsText( stats, chosen ) }</span>
    );
}

// A device's button: on or off, and a menu of the others where there are some. The microphone's menu has original
// sound too (`original`, `onOriginal`), so it is there with one microphone as well.
function DeviceButton( props : {
    kind : 'camera' | 'microphone';
    on : boolean;
    devices : DeviceChoice[];
    current : string;
    onToggle : () => void;
    onChoose : ( id : string ) => void;
    level? : MediaStreamTrack | null;
    original? : boolean;
    onOriginal? : ( on : boolean ) => void;
} ){
    const camera = props.kind === 'camera';
    const name = camera ? __( 'Camera', 'wordplus-live-stream' ) : __( 'Microphone', 'wordplus-live-stream' );
    const icon : IconName = camera ? ( props.on ? 'camera' : 'camera-off' ) : ( props.on ? 'mic' : 'mic-off' );
    const tip = camera
        ? ( props.on ? __( 'Turn off the camera (⌘/Ctrl+E)', 'wordplus-live-stream' ) : __( 'Turn on the camera (⌘/Ctrl+E)', 'wordplus-live-stream' ) )
        : ( props.on ? __( 'Mute the microphone (⌘/Ctrl+D)', 'wordplus-live-stream' ) : __( 'Unmute the microphone (⌘/Ctrl+D)', 'wordplus-live-stream' ) );

    return (
        <div className={ 'estream-device' + ( props.on ? '' : ' estream-device--off' ) }>
            <button type="button" className="estream-device__toggle" aria-pressed={ props.on } data-estream-tip={ tip } onClick={ props.onToggle }>
                <Icon name={ icon } />
                <span className="estream-label">{ name }</span>
                { ! camera && props.on && <MicLevel track={ props.level ?? null } compact /> }
            </button>
            { ( props.devices.length > 1 || props.onOriginal ) && (
                <MenuButton icon="chevron-down" label={ camera ? __( 'Choose a camera', 'wordplus-live-stream' ) : __( 'Choose a microphone', 'wordplus-live-stream' ) } className="estream-device__menu" placement="up" align="start">
                    { ( close ) => (
                        <>
                            { props.devices.length > 1 && (
                                <>
                                    <MenuHeading>{ camera ? __( 'Camera', 'wordplus-live-stream' ) : __( 'Microphone', 'wordplus-live-stream' ) }</MenuHeading>
                                    { props.devices.map( ( d, i ) => (
                                        <MenuChoice key={ d.id } checked={ d.id === props.current } onSelect={ () => { props.onChoose( d.id ); close(); } }>
                                            { deviceName( d, i, props.kind ) }
                                        </MenuChoice>
                                    ) ) }
                                </>
                            ) }
                            { props.onOriginal && (
                                <>
                                    <MenuHeading>{ _x( 'Sound', 'how the microphone is sent, in the studio', 'wordplus-live-stream' ) }</MenuHeading>
                                    <MenuChoice checked={ ! props.original } onSelect={ () => { props.onOriginal!( false ); close(); } } note={ __( 'Clear speech, with echo and noise removed', 'wordplus-live-stream' ) }>
                                        { __( 'Speech', 'wordplus-live-stream' ) }
                                    </MenuChoice>
                                    <MenuChoice checked={ Boolean( props.original ) } onSelect={ () => { props.onOriginal!( true ); close(); } } note={ __( 'For music, in stereo. Use headphones.', 'wordplus-live-stream' ) }>
                                        { __( 'Original sound', 'wordplus-live-stream' ) }
                                    </MenuChoice>
                                </>
                            ) }
                        </>
                    ) }
                </MenuButton>
            ) }
        </div>
    );
}

function DeviceSelect( props : { label : string, kind : 'camera' | 'microphone' | 'speaker', devices : DeviceChoice[], value : string, onChange : ( id : string ) => void, children? : ReactNode } ){
    const id = useId();
    if( props.devices.length === 0 ) return null;

    return (
        <div className="estream-setup__row">
            <label htmlFor={ id }>{ props.label }</label>
            <div className="estream-setup__field">
                <select id={ id } className="estream-input" value={ props.devices.some( ( d ) => d.id === props.value ) ? props.value : '' } onChange={ ( e ) => props.onChange( e.target.value ) }>
                    { ! props.devices.some( ( d ) => d.id === props.value ) && <option value="">{ __( 'Chosen by the system', 'wordplus-live-stream' ) }</option> }
                    { props.devices.map( ( d, i ) => <option key={ d.id } value={ d.id }>{ deviceName( d, i, props.kind ) }</option> ) }
                </select>
                { props.children }
            </div>
        </div>
    );
}

// The best quality to send, chosen before going live: HD, or Full HD where the cloud says this host may send it. Each
// viewer gets up to it, as their player and connection need, so it is named as the best, and
// what the host's connection carries at most is said. Where Full HD may not be sent it isn't shown:
// nothing speaks of plans.
function QualityChoice(){
    const client = useClient();
    const state = useStream();
    const id = useId();
    const full = state.topQuality === '1080p';

    const choose = ( quality : Quality ) => {
        writePref( 'send-quality', quality );
        void client.setSendQuality( quality );
    };

    const options : Array<{ value : Quality, name : string, note : string, off : boolean }> = [
        { value: '720p', name: __( 'HD', 'wordplus-live-stream' ), note: __( 'Up to about 4 Mbps of upload', 'wordplus-live-stream' ), off: false },
        ...( full ? [ { value: '1080p' as Quality, name: __( 'Full HD', 'wordplus-live-stream' ), note: __( 'Up to about 8 Mbps of upload', 'wordplus-live-stream' ), off: false } ] : [] )
    ];

    return (
        <div className="estream-setup__row" role="radiogroup" aria-labelledby={ id + 'label' }>
            <span id={ id + 'label' } className="estream-setup__label">{ __( 'Best quality', 'wordplus-live-stream' ) }</span>
            <div className="estream-setup__field estream-quality">
                { options.map( ( o ) => (
                    <label key={ o.value } className={ 'estream-quality__option' + ( o.off ? ' estream-quality__option--off' : '' ) }>
                        <input type="radio" name={ id } value={ o.value } checked={ state.sendQuality === o.value } disabled={ o.off } onChange={ () => choose( o.value ) } />
                        <span>
                            <strong>{ qualityName( o.value ) } · { o.name }</strong>
                            <small>{ o.note }</small>
                        </span>
                    </label>
                ) ) }
            </div>
        </div>
    );
}

// A value to paste into OBS, with a button that copies it; `secret` hides it until asked.
export function CopyField( props : { label : string, value : string, secret? : boolean } ){
    const id = useId();
    const [ shown, setShown ] = useState( ! props.secret );
    const [ copied, setCopied ] = useState( false );

    const copy = async () => {
        try {
            await navigator.clipboard.writeText( props.value );
            setCopied( true );
            setTimeout( () => setCopied( false ), 2000 );
        } catch ( e ) {
            // No clipboard here (a page that isn't https): the field can still be selected and copied.
        }
    };

    return (
        <div className="estream-encoder__field">
            <label htmlFor={ id }>{ props.label }</label>
            <div className="estream-controls__row">
                <input id={ id } className="estream-input" type={ shown ? 'text' : 'password' } readOnly value={ props.value } onFocus={ ( e ) => e.currentTarget.select() } />
                { props.secret && (
                    <button type="button" className="estream-button estream-button--small" onClick={ () => setShown( ! shown ) }>{ shown ? __( 'Hide', 'wordplus-live-stream' ) : __( 'Show', 'wordplus-live-stream' ) }</button>
                ) }
                <button type="button" className="estream-button estream-button--small" onClick={ () => void copy() }>
                    <Icon name={ copied ? 'check' : 'link' } />
                    { copied ? __( 'Copied', 'wordplus-live-stream' ) : __( 'Copy', 'wordplus-live-stream' ) }
                </button>
            </div>
        </div>
    );
}

// Streaming from OBS: the steps, where it sends and with which key, and what arrives from it (`stats`). OBS sends its
// picture in layers where it is told to (Total Layers, OBS 32.1 and newer): the full picture and smaller ones, which
// viewers on slow connections step down to, so Full HD, where the cloud takes it, suits everyone. A single picture is
// the same to every viewer, so without layers the size all of them can take is the safe one. With layers OBS gives
// the smaller copies two thirds and one third of the bitrate set: 4,500 kbps is about 9 Mbit/s up in all. At 3,500
// (about 7) a busy picture, every part of it moving, pulsed visibly at each key frame, a second apart, its detail
// jumping as the key frame took its share of the bits, and 4,500 played it smoothly. What suits a stream depends on
// what it shows, the computer and the connection, so the last step says the numbers are a starting point to try.
// `over`: a bigger picture
// than a stream takes; the words name no plan. OBS makes a key frame at its Keyframe Interval alone, never when a
// viewer asks, and each viewer coming in or back to the page waits for the next one: 1 s keeps that short, and key
// frames further apart than KEYFRAME_MOST_S are said. Simple output mode has no Keyframe Interval (auto there gave
// one every 8.2 s), Advanced has, and its own Max B-frames too, 2 for AMD's encoder where Simple sends none for WHIP.
// A browser skips what it cannot play of B-frames: an AMD stream with 2 arrived at about 22 frames a second, two
// frames apart, and played smoothly at 0. So does an encoder that cannot keep up, and both are said (useSlowFrames).
function EncoderPanel( props : { stats : MediaStats | null, over : boolean, run : ( work : () => Promise<Result> ) => Promise<void> } ){
    const client = useClient();
    const state = useStream();
    const confirm = useConfirm();
    const encoder = state.encoder;
    const receiving = state.tiles.some( ( t ) => t.encoder && t.camera );
    const { stats } = props;
    const keyframes = stats?.keyframeSeconds !== undefined && stats.keyframeSeconds > KEYFRAME_MOST_S ? Math.round( stats.keyframeSeconds ) : null;
    const slow = useSlowFrames( stats );
    if( ! encoder ) return null;

    return (
        <div className="estream-encoder">
            <div className="estream-encoder__head">
                <p className={ 'estream-encoder__status' + ( receiving ? ' estream-encoder__status--on' : '' ) } role="status">
                    { receiving ? __( 'OBS is connected', 'wordplus-live-stream' ) : __( 'Waiting for OBS…', 'wordplus-live-stream' ) }
                </p>
                { stats && stats.height > 0 && <span className="estream-studio__numbers">{ statsText( stats ) }</span> }
            </div>
            <ol className="estream-encoder__steps">
                <li>{ __( 'In OBS, open Settings → Stream and choose WHIP as the service.', 'wordplus-live-stream' ) }</li>
                <li><CopyField label={ __( 'Server', 'wordplus-live-stream' ) } value={ encoder.url } /></li>
                <li><CopyField label={ __( 'Bearer token', 'wordplus-live-stream' ) } value={ encoder.key } secret /></li>
                <li>{ __( 'In the same window, set Total Layers to 3 if your OBS has it (version 32.1 or newer). OBS then also sends smaller copies of the picture, so viewers on slow connections keep watching smoothly.', 'wordplus-live-stream' ) }</li>
                <li>{ state.topQuality === '1080p'
                    ? __( 'In Settings → Video, set Output (Scaled) Resolution to 1920×1080 and 30 FPS. Without layers, 1280×720 lets viewers on slow connections keep up.', 'wordplus-live-stream' )
                    : __( 'For everyone to watch smoothly, set Output (Scaled) Resolution to 1280×720 and 30 FPS in Settings → Video.', 'wordplus-live-stream' ) }</li>
                <li>{ state.topQuality === '1080p'
                    ? __( 'In Settings → Output, choose the Advanced output mode. Under Streaming, keep the video encoder Simple mode had, and set the bitrate to about 4,500 kbps (2,500 kbps without layers), Keyframe Interval to 1 s and Max B-frames to 0. Viewers coming in then get the picture within a second, and it plays smoothly in their browsers. Then press Start Streaming in OBS.', 'wordplus-live-stream' )
                    : __( 'In Settings → Output, choose the Advanced output mode. Under Streaming, keep the video encoder Simple mode had, and set the bitrate to about 2,500 kbps, Keyframe Interval to 1 s and Max B-frames to 0. Viewers coming in then get the picture within a second, and it plays smoothly in their browsers. Then press Start Streaming in OBS.', 'wordplus-live-stream' ) }</li>
                <li>{ __( 'These settings are a starting point. Try them on your own stream and connection: watch it from another device, and change the bitrate, Total Layers or the preset until it plays smoothly.', 'wordplus-live-stream' ) }</li>
            </ol>
            { slow !== null && (
                <p className="estream-controls__error" role="status">
                    { sprintf(
                        _x( 'OBS sends %s frames a second, fewer than it should, and viewers see the picture stutter. In OBS, set Max B-frames to 0 under Settings → Output → Streaming, in the Advanced output mode, since browsers skip B-frames. If it is 0 already, the encoder cannot keep up: choose a faster preset or fewer Total Layers.', 'frames a second arriving from OBS (22)', 'wordplus-live-stream' ),
                        String( slow )
                    ) }
                </p>
            ) }
            { keyframes !== null && (
                <p className="estream-controls__error" role="status">
                    { sprintf(
                        _x( 'OBS sends a keyframe every %s seconds, so viewers wait up to that long for the picture as they come in and when they come back to the page. In OBS, choose the Advanced output mode in Settings → Output and set Keyframe Interval to 1 s under Streaming.', 'seconds between the keyframes OBS sends (8)', 'wordplus-live-stream' ),
                        String( keyframes )
                    ) }
                </p>
            ) }
            { props.over && stats && (
                <p className="estream-controls__error" role="alert">
                    { sprintf(
                        _x( 'OBS sends %1$s, more than the %2$s a stream takes. In OBS, set Settings → Video → Output (Scaled) Resolution to %3$s.', 'the picture OBS sends (2560×1440), the best quality a stream takes (1080p), the size to set (1920×1080)', 'wordplus-live-stream' ),
                        stats.width + '×' + stats.height,
                        qualityName( state.topQuality ),
                        biggest( state.topQuality, stats.width >= stats.height )
                    ) }
                </p>
            ) }
            <div className="estream-controls__row">
                <button type="button" className="estream-button estream-button--small" onClick={ async () => {
                    const yes = await confirm( {
                        title: __( 'Make a new key?', 'wordplus-live-stream' ),
                        message: __( 'OBS stops streaming until it has the new one. Do this if someone who should not have seen the key saw it.', 'wordplus-live-stream' ),
                        confirm: __( 'Make a new key', 'wordplus-live-stream' ),
                        danger: true
                    } );
                    if( yes ) void props.run( () => client.useEncoder( true ) );
                } }>{ __( 'New key', 'wordplus-live-stream' ) }</button>
            </div>
        </div>
    );
}

// Before anything is on: the camera here, or OBS, the way to go live, which the studio's picture points to.
function Sources( props : { busy : boolean, run : ( work : () => Promise<Result> ) => Promise<void>, again : boolean } ){
    const client = useClient();
    const state = useStream();

    return (
        <div className="estream-sources" role="group" aria-labelledby="estream-sources-title">
            <h4 id="estream-sources-title" className="estream-sources__title">
                { props.again ? __( 'Go live again', 'wordplus-live-stream' ) : __( 'How do you want to go live?', 'wordplus-live-stream' ) }
            </h4>
            <button type="button" className="estream-source" disabled={ props.busy } onClick={ () => props.run( () => client.startPreview() ) }>
                <span className="estream-source__icon"><Icon name="camera" /></span>
                <span className="estream-source__text">
                    <strong>{ __( 'Turn on camera and microphone', 'wordplus-live-stream' ) }</strong>
                    <span>{ __( 'Go live from this browser, and share your screen.', 'wordplus-live-stream' ) }</span>
                </span>
            </button>
            { /* The screen alone, the camera beside it later if wanted; only where the browser can share one. A
                closed picker is no error. */ }
            { state.canShareScreen && (
                <button type="button" className="estream-source" disabled={ props.busy } onClick={ () => props.run( async () => { await client.setScreenShare( true ); } ) }>
                    <span className="estream-source__icon"><Icon name="screen" /></span>
                    <span className="estream-source__text">
                        <strong>{ __( 'Share your screen', 'wordplus-live-stream' ) }</strong>
                        <span>{ __( 'Slides, a demo or a video, with its sound. Turn the camera on beside it if you like.', 'wordplus-live-stream' ) }</span>
                    </span>
                </button>
            ) }
            { /* OBS sends to the cloud: none before the site is connected. */ }
            { state.status !== 'unconnected' && (
                <button type="button" className="estream-source" disabled={ props.busy || state.status !== 'ready' } onClick={ () => props.run( () => client.useEncoder() ) }>
                    <span className="estream-source__icon"><Icon name="broadcast" /></span>
                    <span className="estream-source__text">
                        <strong>{ __( 'Stream from OBS', 'wordplus-live-stream' ) }</strong>
                        <span>{ __( 'Or any encoder that sends WHIP: scenes, overlays, several cameras.', 'wordplus-live-stream' ) }</span>
                    </span>
                </button>
            ) }
        </div>
    );
}

// How long the cloud keeps a live stream whose encoder left its room, before it ends it.
const ENCODER_GRACE_MS = 5 * 60 * 1000;

// A live stream's encoder gone from its room (the stream's `encoder_lost_at`): when it stopped, and when the stream
// ends by itself unless it comes back, which takes this away.
export function EncoderLost(){
    const state = useStream();
    const lost = state.stream?.state === 'live' ? state.stream.encoder_lost_at ?? null : null;
    if( ! lost ) return null;

    return (
        <p className="estream-controls__error" role="status">
            { sprintf( _x( 'OBS stopped sending at %1$s. Unless it comes back, the stream ends by itself at %2$s.', 'two times of day', 'wordplus-live-stream' ), timeOfDay( lost ), timeOfDay( lost + ENCODER_GRACE_MS ) ) }
        </p>
    );
}

// The stream this page took live, summed up once it has ended (the studio's picture says that it has). `messages`:
// false where its chat is somewhere else (a Better Messages room), whose messages it doesn't count.
export function Summary( props : { messages? : boolean } ){
    const state = useStream();
    const stream = state.stream;
    const ran = stream?.started_at && stream.ended_at ? stream.ended_at - stream.started_at : 0;
    const { tally } = state;

    const figures : Array<[ string, string ]> = [
        [ clock( ran ), __( 'On air', 'wordplus-live-stream' ) ],
        [ count( tally.peak ), _nx( 'Watching at the peak', 'Watching at the peak', tally.peak, 'the most viewers at once', 'wordplus-live-stream' ) ],
        ...( props.messages === false ? [] : [ [ count( tally.messages ), _nx( 'Message', 'Messages', tally.messages, 'chat messages during the stream', 'wordplus-live-stream' ) ] as [ string, string ] ] ),
        [ count( tally.reactions ), _nx( 'Reaction', 'Reactions', tally.reactions, 'reactions during the stream', 'wordplus-live-stream' ) ]
    ];

    return (
        <div className="estream-summary">
            <h4 className="estream-summary__title">{ __( 'Your last stream', 'wordplus-live-stream' ) }</h4>
            <dl className="estream-summary__figures">
                { figures.map( ( [ value, label ], i ) => (
                    <div key={ i } className="estream-summary__figure">
                        <dt>{ label }</dt>
                        <dd>{ value }</dd>
                    </div>
                ) ) }
            </dl>
        </div>
    );
}

// What everyone sees on stage: the host's choice, for all of them at once.
function LayoutMenu(){
    const client = useClient();
    const { layout, tiles } = useStream();
    const choose = ( mode : 'grid' | 'speaker' | 'spotlight', close : () => void, identity? : string ) => {
        close();
        void client.setLayout( mode, identity );
    };

    return (
        <MenuButton icon={ layout.mode === 'spotlight' ? 'spotlight' : 'grid' } label={ __( 'Layout', 'wordplus-live-stream' ) } className="estream-studio__tool" placement="up" align="start">
            { ( close ) => (
                <>
                    <MenuHeading>{ __( 'What everyone sees', 'wordplus-live-stream' ) }</MenuHeading>
                    <MenuChoice checked={ layout.mode === 'grid' } onSelect={ () => choose( 'grid', close ) }>{ __( 'Everyone in a grid', 'wordplus-live-stream' ) }</MenuChoice>
                    <MenuChoice checked={ layout.mode === 'speaker' } onSelect={ () => choose( 'speaker', close ) }>{ __( 'The one speaking, large', 'wordplus-live-stream' ) }</MenuChoice>
                    <MenuHeading>{ __( 'One person alone', 'wordplus-live-stream' ) }</MenuHeading>
                    { tiles.map( ( t ) => (
                        <MenuChoice key={ t.identity } checked={ layout.mode === 'spotlight' && layout.identity === t.identity } onSelect={ () => choose( 'spotlight', close, t.identity ) }>
                            { t.encoder ? __( 'OBS', 'wordplus-live-stream' ) : t.name }
                        </MenuChoice>
                    ) ) }
                </>
            ) }
        </MenuButton>
    );
}

// Only while live: viewers raise hands only then, so any listed before are left from another time. `empty` shows
// in their place when there are none.
export function Guests( props : { empty? : ReactNode } ){
    const client = useClient();
    const state = useStream();
    const now = useNow( 30000 );
    const guests = state.tiles.filter( ( tile ) => tile.role === 'guest' );

    if( state.stream?.state !== 'live' || ( state.hands.length === 0 && guests.length === 0 ) ) return props.empty ?? null;

    const initials = ( name : string ) => name.split( /\s+/ ).filter( Boolean ).slice( 0, 2 ).map( ( w ) => w[0]?.toUpperCase() ).join( '' ) || '?';

    return (
        <div className="estream-queue">
            { guests.length > 0 && (
                <>
                    <h4 className="estream-queue__title">{ __( 'On stage', 'wordplus-live-stream' ) }</h4>
                    <ul>
                        { guests.map( ( g ) => (
                            <li key={ g.identity }>
                                <span className="estream-queue__face" aria-hidden="true">{ initials( g.name ) }</span>
                                <span className="estream-queue__name">
                                    { g.name }
                                    { g.micMuted && <span className="estream-queue__note"><Icon name="mic-off" />{ __( 'Microphone off', 'wordplus-live-stream' ) }</span> }
                                </span>
                                { ! g.micMuted && (
                                    <button type="button" className="estream-button estream-button--small" onClick={ () => void client.muteGuest( g.identity ) }>
                                        <Icon name="mic-off" />
                                        { __( 'Mute', 'wordplus-live-stream' ) }
                                    </button>
                                ) }
                                <button type="button" className="estream-button estream-button--small" onClick={ () => void client.unstage( g.identity ) }>{ __( 'Remove from stage', 'wordplus-live-stream' ) }</button>
                            </li>
                        ) ) }
                    </ul>
                </>
            ) }
            { state.hands.length > 0 && (
                <>
                    <h4 className="estream-queue__title">
                        { __( 'Asking to join', 'wordplus-live-stream' ) }
                        <span className="estream-queue__count">{ count( state.hands.length ) }</span>
                    </h4>
                    <ul>
                        { state.hands.map( ( h ) => (
                            <li key={ h.identity }>
                                <span className="estream-queue__face" aria-hidden="true">{ initials( h.name ) }</span>
                                <span className="estream-queue__name">
                                    { h.name }
                                    <span className="estream-queue__note">{ sprintf( _x( 'asked %s', 'a time, as "2 minutes ago"', 'wordplus-live-stream' ), relative( h.at, now ) ) }</span>
                                </span>
                                <button type="button" className="estream-button estream-button--small estream-button--primary" onClick={ () => void client.invite( h.identity ) }>{ __( 'Invite', 'wordplus-live-stream' ) }</button>
                            </li>
                        ) ) }
                    </ul>
                </>
            ) }
        </div>
    );
}

export type StudioControls = ReturnType<typeof useStudio>;

// What the studio knows and does, for its card under the picture (Studio) and for the admin studio (screen.tsx).
export function useStudio(){
    const client = useClient();
    const state = useStream();
    const player = usePlayer();
    const confirm = useConfirm();
    const [ busy, setBusy ] = useState( false );
    const [ error, setError ] = useState( '' );
    const [ countdownOn, setCountdownOn ] = useState( () => readPref( 'countdown', true, isBoolean ) );
    const [ summary, setSummary ] = useState( false );
    const counting = useRef<ReturnType<typeof setInterval> | null>( null );

    const live = state.stream?.state === 'live';
    const ended = state.stream?.state === 'ended';
    // A screen shared before going live counts as the camera does: there is something to go live with.
    const previewing = state.devices.camera || state.devices.microphone || state.screenSharing;
    const fromEncoder = state.encoder !== null;
    const encoderReady = state.tiles.some( ( t ) => t.encoder && t.camera );
    // The camera and microphone's buttons: while previewing, and all the time live, both off included.
    const devicesOpen = ( previewing || live ) && ! fromEncoder;
    const devices = useDevices( client, previewing );
    // How the picture goes out while live: the camera's or screen's as sent, or OBS's as it arrives, which shows
    // before going live too.
    const sending = useStats( () => fromEncoder ? client.encoderStats() : client.sendingStats(), live || ( fromEncoder && encoderReady ) );
    // OBS sending a bigger picture than a stream takes (the cloud's top quality): it doesn't go live so.
    const encoderOver = fromEncoder && sending !== null && Math.min( sending.width, sending.height ) > QUALITY_SIDE[ state.topQuality ];
    const microphone = devicesOpen && state.devices.microphone ? client.localMedia?.( 'audio' ) ?? null : null;
    const camera = devicesOpen && state.devices.camera ? client.localMedia?.( 'video' ) ?? null : null;
    const coarse = typeof window !== 'undefined' && Boolean( window.matchMedia?.( '(pointer: coarse)' ).matches );

    // While this page sends the stream (sendsHere): leaving takes it off. Not in a settings page's preview, which is no
    // stream, nor on the stream's page while the host's studio sends it (`elsewhere`).
    const sends = sendsHere( state );
    useWakeLock( live && ! player.preview );
    useLeaveWarning( sends && ! player.preview );

    // The devices, quality and sound chosen here before, for the next preview: Full HD where it may be sent, until
    // another quality is chosen.
    useEffect( () => {
        const cameraId = readPref( 'camera', '', isString );
        const microphoneId = readPref( 'microphone', '', isString );
        if( cameraId ) void client.useDevice?.( 'camera', cameraId );
        if( microphoneId ) void client.useDevice?.( 'microphone', microphoneId );
        void client.setSendQuality?.( readPref( 'send-quality', '1080p', oneOf<Quality>( '720p', '1080p' ) ) );
        if( readPref( 'original-sound', false, isBoolean ) ) void client.setOriginalSound?.( true );
    }, [ client ] );

    // A summary once a stream this page took live has ended.
    const wasLive = useRef( live );
    useEffect( () => {
        if( live ) wasLive.current = true;
        if( ended && wasLive.current ){
            wasLive.current = false;
            setSummary( true );
        }
    }, [ live, ended ] );

    useEffect( () => () => {
        if( counting.current ) clearInterval( counting.current );
    }, [] );

    const run = useCallback( async ( work : () => Promise<Result> ) => {
        setBusy( true );
        setError( '' );
        try {
            const result = await work();
            if( result && ! result.ok ) setError( errorText( result.error ?? '-', __( 'Something went wrong', 'wordplus-live-stream' ) ) );
        } catch ( e ) {
            setError( errorText( 'devices' ) );
        } finally {
            setBusy( false );
        }
    }, [] );

    const toggle = useCallback( ( device : 'camera' | 'microphone' ) => {
        const on = ! state.devices[ device ];
        void run( () => device === 'camera' ? client.setCamera( on ) : client.setMicrophone( on ) );
    }, [ client, run, state.devices ] );

    useDeviceKeys( devicesOpen && ! player.preview, toggle );

    const choose = ( kind : 'camera' | 'microphone', id : string ) => {
        writePref( kind, id );
        void run( async () => ( await client.useDevice( kind, id ) ) ? undefined : { ok: false, error: 'devices' } );
    };

    // Original sound, for music, kept for the next stream; a microphone that cannot be opened so says so.
    const chooseSound = ( on : boolean ) => {
        writePref( 'original-sound', on );
        void run( async () => ( await client.setOriginalSound( on ) ) === on ? undefined : { ok: false, error: 'devices' } );
    };

    const goLive = () => {
        if( ! countdownOn ){
            void run( () => client.goLive() );
            return;
        }

        let n = 3;
        player.setCountdown( n );
        counting.current = setInterval( () => {
            n -= 1;
            if( n > 0 ){
                player.setCountdown( n );
                return;
            }
            if( counting.current ) clearInterval( counting.current );
            counting.current = null;
            player.setCountdown( null );
            void run( () => client.goLive() );
        }, 1000 );
    };

    const cancelCountdown = () => {
        if( counting.current ) clearInterval( counting.current );
        counting.current = null;
        player.setCountdown( null );
    };

    const end = async () => {
        const yes = await confirm( {
            title: __( 'End the stream for everyone?', 'wordplus-live-stream' ),
            message: __( 'Everyone watching sees that it has ended. You can go live again on this page later.', 'wordplus-live-stream' ),
            confirm: __( 'End for everyone', 'wordplus-live-stream' ),
            danger: true
        } );
        if( yes ) void run( () => client.end() );
    };

    // Live from another window of the host's own, the admin studio beside the stream's page: this one shows it as
    // everyone sees it, and can end it.
    const elsewhere = live && state.elsewhere && ! sends;

    return {
        client, state, player, live, ended, previewing, fromEncoder, encoderReady, encoderOver, devicesOpen, devices, sending, microphone, camera, coarse,
        busy, error, countdownOn, setCountdownOn, summary, run, toggle, choose, chooseSound, goLive, cancelCountdown, end, elsewhere
    };
}

// What the studio shows for the moment: the source to choose, the devices to set up, OBS's panel, the end's summary,
// or that it is live from another window.
export function StudioBody( props : { studio : StudioControls } ){
    const { client, state, player, live, ended, previewing, fromEncoder, encoderOver, devices, sending, microphone, camera, coarse, busy, countdownOn,
        setCountdownOn, summary, run, choose, chooseSound, elsewhere } = props.studio;
    let body : ReactNode = null;

    if( elsewhere ){
        body = (
            <p className="estream-studio__elsewhere" role="status">
                <Icon name="broadcast" />
                { __( 'You are live from another window. Your camera and microphone go out from there, and this one shows the stream as everyone sees it.', 'wordplus-live-stream' ) }
            </p>
        );
    } else if( fromEncoder ){
        body = <EncoderPanel stats={ sending } over={ encoderOver } run={ run } />;
    } else if( ! previewing && ! live ){
        body = <Sources busy={ busy } run={ run } again={ ended } />;
    } else if( ! live ){
        body = (
            <div className="estream-setup">
                <p className="estream-controls__hint">{ __( 'Preview: only you can see this', 'wordplus-live-stream' ) }</p>
                <DeviceSelect label={ __( 'Camera', 'wordplus-live-stream' ) } kind="camera" devices={ devices.cameras } value={ deviceOf( camera ) } onChange={ ( id ) => choose( 'camera', id ) }>
                    { coarse && state.devices.camera && (
                        <button type="button" className="estream-button" onClick={ () => void client.flipCamera() } aria-label={ __( 'Switch camera', 'wordplus-live-stream' ) } data-estream-tip={ __( 'Switch camera', 'wordplus-live-stream' ) }><Icon name="flip-camera" /></button>
                    ) }
                </DeviceSelect>
                <DeviceSelect label={ __( 'Microphone', 'wordplus-live-stream' ) } kind="microphone" devices={ devices.microphones } value={ deviceOf( microphone ) } onChange={ ( id ) => choose( 'microphone', id ) }>
                    <MicLevel track={ microphone } />
                </DeviceSelect>
                <div className="estream-setup__row">
                    <span className="estream-setup__label">{ _x( 'Sound', 'how the microphone is sent, in the studio', 'wordplus-live-stream' ) }</span>
                    <div className="estream-setup__field estream-setup__field--stack">
                        <label className="estream-switch">
                            <input type="checkbox" role="switch" checked={ state.originalSound } onChange={ ( e ) => chooseSound( e.target.checked ) } />
                            <span className="estream-switch__track" aria-hidden="true" />
                            { __( 'Original sound, for music', 'wordplus-live-stream' ) }
                        </label>
                        <p className="estream-setup__note">{ __( 'The microphone as it hears, in stereo, with no echo or noise removal. Use headphones, so the speakers do not echo into it.', 'wordplus-live-stream' ) }</p>
                    </div>
                </div>
                { typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype && (
                    <DeviceSelect label={ __( 'Speakers', 'wordplus-live-stream' ) } kind="speaker" devices={ devices.speakers } value={ player.speaker } onChange={ player.setSpeaker } />
                ) }
                <QualityChoice />
                <div className="estream-setup__row">
                    <span className="estream-setup__label">{ __( 'Countdown', 'wordplus-live-stream' ) }</span>
                    <div className="estream-setup__field">
                        <label className="estream-switch">
                            <input type="checkbox" role="switch" checked={ countdownOn } onChange={ ( e ) => { setCountdownOn( e.target.checked ); writePref( 'countdown', e.target.checked ); } } />
                            <span className="estream-switch__track" aria-hidden="true" />
                            { __( 'Count down 3, 2, 1 before going live', 'wordplus-live-stream' ) }
                        </label>
                    </div>
                </div>
            </div>
        );
    }

    // Once a stream this page took live has ended, its figures above what comes next.
    return summary && ended && ! elsewhere ? <><Summary />{ body }</> : body;
}

// One bar of controls: the devices, the screen, the layout, OBS, and going live or ending. Live from another
// window, only what this one may do without sending: the layout, and ending.
export function StudioBar( props : { studio : StudioControls } ){
    const { client, state, player, live, previewing, fromEncoder, encoderReady, encoderOver, devicesOpen, devices, microphone, camera, busy,
        run, toggle, choose, chooseSound, goLive, cancelCountdown, end, elsewhere } = props.studio;
    const countingDown = player.countdown !== null;
    const sends = ! elsewhere;
    // Set up before the site is connected to the cloud: everything but going live and OBS, and the way to connect it.
    const unconnected = state.status === 'unconnected';

    if( ! ( previewing || live || fromEncoder ) ) return null;

    return (
        <div className="estream-studio__bar">
            { devicesOpen && sends && (
                <>
                    <DeviceButton kind="microphone" on={ state.devices.microphone } devices={ devices.microphones } current={ deviceOf( microphone ) } level={ microphone } onToggle={ () => toggle( 'microphone' ) } onChoose={ ( id ) => choose( 'microphone', id ) }
                        original={ state.originalSound } onOriginal={ chooseSound } />
                    <DeviceButton kind="camera" on={ state.devices.camera } devices={ devices.cameras } current={ deviceOf( camera ) } onToggle={ () => toggle( 'camera' ) } onChoose={ ( id ) => choose( 'camera', id ) } />
                </>
            ) }
            { /* Its name as a tip too, for a narrow bar that shows only the icon, the same for sharing and stopping. */ }
            { ( previewing || live ) && ! fromEncoder && sends && state.canShareScreen && (
                <button type="button" className={ 'estream-button' + ( state.screenSharing ? ' estream-button--on' : '' ) } aria-pressed={ state.screenSharing }
                    data-estream-tip={ state.screenSharing ? __( 'Stop sharing', 'wordplus-live-stream' ) : __( 'Share screen', 'wordplus-live-stream' ) } onClick={ () => void client.setScreenShare( ! state.screenSharing ) }>
                    <Icon name="screen" />
                    <span className="estream-label">{ state.screenSharing ? __( 'Stop sharing', 'wordplus-live-stream' ) : __( 'Share screen', 'wordplus-live-stream' ) }</span>
                </button>
            ) }
            { live && state.tiles.length > 1 && <LayoutMenu /> }
            { live && ! fromEncoder && sends && (
                <MenuButton icon="more" label={ __( 'More', 'wordplus-live-stream' ) } className="estream-studio__tool" placement="up" align="start">
                    { ( close ) => (
                        <MenuItem icon="broadcast" onSelect={ () => { close(); void run( () => client.useEncoder() ); } }>
                            { __( 'Stream from OBS', 'wordplus-live-stream' ) }
                        </MenuItem>
                    ) }
                </MenuButton>
            ) }
            { ! live && fromEncoder && (
                // Back to the camera's preview, on again ("its reverting me back to main menu, not to camera screen").
                <button type="button" className="estream-button" disabled={ busy } onClick={ () => {
                    client.leaveEncoder();
                    void run( () => client.startPreview() );
                } }>
                    <Icon name="camera" />
                    { __( 'Use the camera instead', 'wordplus-live-stream' ) }
                </button>
            ) }
            { ! live && devicesOpen && ! unconnected && (
                <button type="button" className="estream-button estream-button--quiet" disabled={ busy || state.status !== 'ready' } onClick={ () => run( () => client.useEncoder() ) }>
                    <Icon name="broadcast" />
                    { __( 'Stream from OBS', 'wordplus-live-stream' ) }
                </button>
            ) }

            { unconnected ? (
                player.connectUrl ? (
                    <a className="estream-button estream-button--primary estream-button--large estream-studio__go" href={ player.connectUrl }>
                        <Icon name="broadcast" />
                        { __( 'Connect to go live', 'wordplus-live-stream' ) }
                    </a>
                ) : (
                    <button type="button" className="estream-button estream-button--primary estream-button--large estream-studio__go" disabled data-estream-tip={ __( 'Going live needs the site connected to WordPlus Cloud.', 'wordplus-live-stream' ) }>
                        <Icon name="broadcast" />
                        { __( 'Go live', 'wordplus-live-stream' ) }
                    </button>
                )
            ) : live ? (
                <button type="button" className="estream-button estream-button--danger-solid estream-studio__go" disabled={ busy } onClick={ () => void end() }>
                    <Icon name="stop" />
                    { __( 'End stream', 'wordplus-live-stream' ) }
                </button>
            ) : countingDown ? (
                <button type="button" className="estream-button estream-studio__go" onClick={ cancelCountdown }>{ __( 'Cancel', 'wordplus-live-stream' ) }</button>
            ) : (
                <button type="button" className="estream-button estream-button--primary estream-button--large estream-studio__go" disabled={ busy || state.status !== 'ready' || ( fromEncoder && ( ! encoderReady || encoderOver ) ) } onClick={ goLive }>
                    <Icon name="broadcast" />
                    { __( 'Go live', 'wordplus-live-stream' ) }
                </button>
            ) }
        </div>
    );
}

// The studio as a card under the picture: what matters while live, the moment's body, the bar, and the guests. A
// host on a page with a studio of the site's (the WordPress plugin's) is offered it, with more room.
export function Studio(){
    const studio = useStudio();
    const { player, live, sending, error } = studio;

    return (
        <section className="estream-studio estream-controls--studio" aria-label={ __( 'Studio', 'wordplus-live-stream' ) }>
            <header className="estream-studio__head">
                <h3 className="estream-studio__title">{ live ? __( 'You are live', 'wordplus-live-stream' ) : __( 'Studio', 'wordplus-live-stream' ) }</h3>
                { live && <StudioStatus stats={ sending } /> }
                { player.studioUrl && ! player.preview && (
                    <a className="estream-studio__open" href={ player.studioUrl }>{ __( 'Open the full studio', 'wordplus-live-stream' ) }</a>
                ) }
            </header>

            <EncoderLost />
            <StudioBody studio={ studio } />
            <StudioBar studio={ studio } />

            { error && <p className="estream-controls__error" role="alert">{ error }</p> }

            <Guests />
        </section>
    );
}
