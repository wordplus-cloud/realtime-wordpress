import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode, type RefObject} from "react";
import type {Appearance, Shape} from "./appearance.ts";
import {useClient, useStream} from "./context.tsx";
import {isBoolean, isNumber, oneOf, readPref, writePref} from "./prefs.ts";
import {scheduleOf, type StreamSession} from "./sessions.ts";

// What the player knows beyond the stream's state: the stream as the page describes it, and what the
// viewer set here (sound, the chat hidden, full screen, picture-in-picture). The UI reads it with
// usePlayer(); without a PlayerProvider (a Stage on its own) it gets still defaults.

export interface StreamMeta {
    title? : string;
    // When the stream is to start, in ms. In the player's context, the start its countdown counts to now: the next
    // session's, and null while the viewers of a session that ended are thanked.
    scheduled? : number | null;
    // The stream's sessions, each a planned start and its own title (sessions.ts): the player says the title of the one
    // on air and counts down to the next. Without them, `scheduled` is the one session.
    sessions? : StreamSession[];
    // The page to share and to come back to: the page's own address by default.
    url? : string;
    // Where a visitor logs in to chat, and comes back here after.
    loginUrl? : string;
    // The image before the stream starts: the stream's own, or the site's.
    cover? : string;
    // A still stream drawn for a settings page: nothing that reaches beyond it (no wake lock, no warning
    // before leaving, no keys on the page).
    preview? : boolean;
    // The site's logo may be dragged into place and sized over the host's own picture before going live, and the page
    // saves where: the WordPress plugin's studio, for those who may change how streams look.
    placeLogo? : boolean;
    appearance : Appearance;
    // Where a host goes live: the WordPress plugin's studio, for those who host the stream.
    studioUrl? : string;
    // Where the site is connected to the cloud (the WordPress plugin's Licence page), for a host whose page is
    // unconnected: the studio offers it where Go live would be.
    connectUrl? : string;
    // The stream's Better Messages chat room, where that is its chat: Better Messages' placeholder for it, which
    // takes the light chat's place and Better Messages mounts the room into.
    room? : string;
    // The stream's own words, each in place of the player's (StreamTexts).
    texts? : StreamTexts;
}

// What viewers read at each moment, a stream's own in place of the player's: before it starts (`soon`, and a line of its
// own under it, `soon_note`), live with nobody's picture yet (`waiting`), past the audience it takes (`full`), after it
// (`ended`, `thanks`), and the light chat while closed before the start and after the end (`chat_before`,
// `chat_after`). Those it doesn't have are the player's.
export interface StreamTexts {
    soon? : string;
    soon_note? : string;
    waiting? : string;
    full? : string;
    ended? : string;
    thanks? : string;
    chat_before? : string;
    chat_after? : string;
}

// How the stream is laid out: `all` in one piece (the player, the chat beside it, the studio for a host), or
// `parts` placed apart on the page, each where the site put it (parts.tsx).
export type PlayerLayout = 'all' | 'parts';

export interface Player extends StreamMeta {
    // The session to come, while one is planned (sessions.ts): said under the thanks of the one that ended, and in a
    // host's studio.
    next : StreamSession | null;
    volume : number;
    muted : boolean;
    // Whether this device lets a page set the volume (iOS doesn't: only muting).
    volumeSettable : boolean;
    setVolume : ( volume : number ) => void;
    setMuted : ( muted : boolean ) => void;
    layout : PlayerLayout;
    // Whether the stream's chat shows with the player: beside it in one piece, and in its full screen.
    hasChat : boolean;
    chatHidden : boolean;
    // Whether the player offers to hide and show its chat: in one piece, laid out in parts where the page has the chat
    // as a part of its own, and in full screen, where the chat is the player's own.
    chatToggles : boolean;
    toggleChat : () => void;
    // What goes full screen: the player's theme root.
    root : RefObject<HTMLElement | null>;
    fullscreen : boolean;
    canFullscreen : boolean;
    toggleFullscreen : () => void;
    pip : boolean;
    canPip : boolean;
    togglePip : () => void;
    // The main picture's <video>, which picture-in-picture and iOS's full screen take.
    setPrimary : ( video : HTMLVideoElement | null ) => void;
    // How tall the main picture arrives, in pixels (0 before it has).
    height : number;
    setHeight : ( height : number ) => void;
    // The shape of the picture alone on the stage as it arrives, which the player takes where its shape is `auto`
    // (themeClass): wide until a picture says otherwise, and kept while none shows (the end, a moment without the host).
    videoShape : Shape;
    setVideoShape : ( shape : Shape ) => void;
    // The statistics over the picture, to debug how the stream plays (stats.tsx): from the settings menu, or i.
    statsOpen : boolean;
    toggleStats : () => void;
    // The list of the player's keys (shortcuts.tsx), from ?.
    keysOpen : boolean;
    setKeysOpen : ( open : boolean ) => void;
    // The speakers the stream's sound plays on, where the browser lets a page choose ('' for the system's).
    speaker : string;
    setSpeaker : ( id : string ) => void;
    // The 3, 2, 1 over the picture before going live.
    countdown : number | null;
    setCountdown : ( n : number | null ) => void;
}

const noop = () => {};

const still : Player = {
    appearance: {},
    next: null,
    volume: 1,
    muted: false,
    volumeSettable: false,
    setVolume: noop,
    setMuted: noop,
    layout: 'all',
    hasChat: false,
    chatHidden: false,
    chatToggles: false,
    toggleChat: noop,
    root: { current: null },
    fullscreen: false,
    canFullscreen: false,
    toggleFullscreen: noop,
    pip: false,
    canPip: false,
    togglePip: noop,
    setPrimary: noop,
    height: 0,
    setHeight: noop,
    videoShape: '16:9',
    setVideoShape: noop,
    statsOpen: false,
    toggleStats: noop,
    keysOpen: false,
    setKeysOpen: noop,
    speaker: '',
    setSpeaker: noop,
    countdown: null,
    setCountdown: noop
};

const Context = createContext<Player>( still );

// The 3, 2, 1 before going live, one for every view of the stream on the page: a Studio part counts down, and the stream
// in one piece beside it, a player of its own, shows it over the picture.
const countdowns = new WeakMap<object, { n : number | null, listeners : Set<() => void> }>();

function useSharedCountdown( client : object ) : [ number | null, ( n : number | null ) => void ]{
    const shared = useMemo( () => {
        let one = countdowns.get( client );
        if( ! one ){
            one = { n: null, listeners: new Set() };
            countdowns.set( client, one );
        }
        return one;
    }, [ client ] );
    const subscribe = useCallback( ( listener : () => void ) => {
        shared.listeners.add( listener );
        return () => { shared.listeners.delete( listener ); };
    }, [ shared ] );
    const n = useSyncExternalStore( subscribe, () => shared.n, () => shared.n );
    const set = useCallback( ( value : number | null ) => {
        shared.n = value;
        for( const listener of shared.listeners ) listener();
    }, [ shared ] );

    return [ n, set ];
}

export const usePlayer = () : Player => useContext( Context );

// A part of the page that looks a little apart from the site's appearance: a Player block of its own shape.
export function WithAppearance( props : { appearance? : Partial<Appearance>, children : ReactNode } ){
    const player = usePlayer();
    const changes = props.appearance;
    const value = useMemo( () => changes && Object.keys( changes ).length > 0 ? { ...player, appearance: { ...player.appearance, ...changes } } : player, [ player, changes ] );

    return <Context.Provider value={ value }>{ props.children }</Context.Provider>;
}

// The stream's page: the one the page gave, or this one without its fragment.
export const pageUrl = ( url? : string ) : string => url ?? window.location.href.replace( /#.*$/, '' );

let volumeWorks : boolean | null = null;

// iOS keeps every element's volume at 1 whatever a page sets.
function canSetVolume() : boolean {
    if( volumeWorks === null ){
        try {
            const probe = document.createElement( 'audio' );
            probe.volume = 0.5;
            volumeWorks = probe.volume === 0.5;
        } catch ( e ) {
            volumeWorks = false;
        }
    }
    return volumeWorks;
}

type Prefixed = Document & { webkitFullscreenElement? : Element | null, webkitFullscreenEnabled? : boolean, webkitExitFullscreen? : () => void };
type PrefixedElement = HTMLElement & { webkitRequestFullscreen? : () => void };
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen? : () => void, webkitSupportsFullscreen? : boolean };

const fullscreenElement = () => document.fullscreenElement ?? ( document as Prefixed ).webkitFullscreenElement ?? null;
const fullscreenEnabled = () => Boolean( document.fullscreenEnabled || ( document as Prefixed ).webkitFullscreenEnabled );

// Where full screen fills the browser's window rather than the screen, where the browser can lift the player over the
// whole page into its top layer (popovers): a desktop's (a pointer that hovers and aims finely), and a browser's that
// cannot put the player itself full screen, an iPhone's, whose own full screen is its video player with the picture
// alone, none of the player's controls or chat. A phone or a tablet that can take the screen with the player does.
const inWindow = () : boolean =>
    typeof window !== 'undefined' && typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype
    && ( ! fullscreenEnabled() || ( typeof window.matchMedia === 'function' && window.matchMedia( '(hover: hover) and (pointer: fine)' ).matches ) );

// What the player lifted over the page carries while it fills the window: its styles' hook, and where the player's own
// tooltip goes then (tooltip.ts).
export const WINDOW_ATTRIBUTE = 'data-estream-window';

const VOLUME_STEP = 0.1;

// `chatBeside`: the stream in parts has its chat on the page with the player, in one block (a ready layout) or a block
// of its own, which the player shows and hides as the stream in one piece does, not only in its full screen.
export function PlayerProvider( props : StreamMeta & { chat : boolean, root : RefObject<HTMLElement | null>, layout? : PlayerLayout, chatBeside? : boolean, children : ReactNode } ){
    const client = useClient();
    const { root } = props;
    const layout = props.layout ?? 'all';

    const [ volume, setVolumeState ] = useState( () => readPref( 'volume', 1, isNumber ) );
    const [ muted, setMutedState ] = useState( () => readPref( 'muted', false, isBoolean ) );
    const [ chatHidden, setChatHidden ] = useState( () => readPref( 'chat-hidden', false, isBoolean ) );
    // Full screen: the screen's (the browser's Fullscreen API), or the window's, on a desktop.
    const [ screenFull, setScreenFull ] = useState( false );
    const [ windowFull, setWindowFull ] = useState( false );
    const fullscreen = screenFull || windowFull;
    const [ pip, setPip ] = useState( false );
    const [ primary, setPrimary ] = useState<HTMLVideoElement | null>( null );
    const [ height, setHeight ] = useState( 0 );
    const [ videoShape, setVideoShape ] = useState<Shape>( '16:9' );
    const [ speaker, setSpeakerState ] = useState( () => readPref( 'speaker', '', ( v ) : v is string => typeof v === 'string' ) );
    const [ countdown, setCountdown ] = useSharedCountdown( client );
    const setSpeaker = useCallback( ( id : string ) => {
        setSpeakerState( id );
        writePref( 'speaker', id );
    }, [] );
    // Drawn again once mounted, when the root's ref is there to go full screen.
    const [ , setMounted ] = useState( false );
    useEffect( () => setMounted( true ), [] );

    // The viewer's choice of picture, from before.
    useEffect( () => {
        const quality = readPref( 'quality', 'auto', oneOf( 'auto', 'high', 'medium', 'low' ) );
        if( quality !== 'auto' ) client.setQuality?.( quality );
    }, [ client ] );

    // The statistics over the picture, open or not (stats.tsx); not kept for the next visit. The list of the player's
    // keys (shortcuts.tsx), from ?.
    const [ statsOpen, setStatsOpen ] = useState( false );
    const toggleStats = useCallback( () => setStatsOpen( ( open ) => ! open ), [] );
    const [ keysOpen, setKeysOpen ] = useState( false );

    const setVolume = useCallback( ( value : number ) => {
        const v = Math.min( 1, Math.max( 0, Math.round( value * 100 ) / 100 ) );
        setVolumeState( v );
        writePref( 'volume', v );
        // Turning it up unmutes; down to nothing mutes.
        setMutedState( v === 0 );
        writePref( 'muted', v === 0 );
    }, [] );

    const setMuted = useCallback( ( m : boolean ) => {
        setMutedState( m );
        writePref( 'muted', m );
        // Unmuting at no volume brings it back to be heard.
        if( ! m && volume === 0 ) setVolume( 0.5 );
    }, [ volume, setVolume ] );

    const toggleChat = useCallback( () => {
        setChatHidden( ( hidden ) => {
            writePref( 'chat-hidden', ! hidden );
            return ! hidden;
        } );
    }, [] );

    useEffect( () => {
        const changed = () => setScreenFull( root.current !== null && fullscreenElement() === root.current );
        document.addEventListener( 'fullscreenchange', changed );
        document.addEventListener( 'webkitfullscreenchange', changed );
        return () => {
            document.removeEventListener( 'fullscreenchange', changed );
            document.removeEventListener( 'webkitfullscreenchange', changed );
        };
    }, [ root ] );

    // Filling the window: the root lifted over the page into the top layer as a popover, which nothing on the page can
    // cover or clip whatever it stacks or transforms, while it stays where it is among the page's elements; the page under
    // it kept from scrolling. Escape leaves it, after a menu or a dialog in it, which take theirs first. Before the
    // browser paints, so the player never shows stretched in its place on the page.
    useLayoutEffect( () => {
        const element = root.current;
        if( ! windowFull || ! element ) return;

        element.setAttribute( 'popover', 'manual' );
        element.setAttribute( WINDOW_ATTRIBUTE, '' );
        try {
            element.showPopover();
        } catch ( e ) {
            // Over the page by its styles alone, then.
        }

        const page = document.documentElement;
        const overflow = page.style.overflow;
        page.style.overflow = 'hidden';

        const escape = ( event : Event ) => {
            if( ( event as globalThis.KeyboardEvent ).key === 'Escape' && ! event.defaultPrevented ) setWindowFull( false );
        };
        document.addEventListener( 'keydown', escape );

        return () => {
            document.removeEventListener( 'keydown', escape );
            page.style.overflow = overflow;
            try {
                element.hidePopover();
            } catch ( e ) {
                // Not in the top layer.
            }
            element.removeAttribute( 'popover' );
            element.removeAttribute( WINDOW_ATTRIBUTE );
        };
    }, [ windowFull, root ] );

    const ios = primary as IosVideo | null;
    const canFullscreen = ( ( fullscreenEnabled() || inWindow() ) && root.current !== null ) || Boolean( ios?.webkitEnterFullscreen && ios.webkitSupportsFullscreen !== false );

    const toggleFullscreen = useCallback( () => {
        const element = root.current as PrefixedElement | null;

        if( windowFull ){
            setWindowFull( false );
            return;
        }

        if( fullscreenElement() ){
            void ( document.exitFullscreen?.() ?? ( document as Prefixed ).webkitExitFullscreen?.() );
            return;
        }

        if( element && inWindow() ){
            setWindowFull( true );
            return;
        }

        if( element && fullscreenEnabled() ){
            const done = element.requestFullscreen ? element.requestFullscreen() : ( element.webkitRequestFullscreen?.(), undefined );
            // A phone turns to the picture's side where it may (Android, in full screen only).
            Promise.resolve( done ).then( () => {
                const orientation = screen.orientation as ScreenOrientation & { lock? : ( o : string ) => Promise<void> };
                if( window.matchMedia?.( '(pointer: coarse)' ).matches ) orientation?.lock?.( 'landscape' ).catch( noop );
            } ).catch( noop );
            return;
        }

        // An iPhone without popovers (before iOS 17): only a <video> goes full screen, the picture alone.
        ( primary as IosVideo | null )?.webkitEnterFullscreen?.();
    }, [ root, primary, windowFull ] );

    const canPip = typeof document !== 'undefined' && Boolean( document.pictureInPictureEnabled ) && primary !== null && ! primary.disablePictureInPicture;

    useEffect( () => {
        if( ! primary ) return;
        const enter = () => setPip( true );
        const leave = () => setPip( false );
        primary.addEventListener( 'enterpictureinpicture', enter );
        primary.addEventListener( 'leavepictureinpicture', leave );
        setPip( document.pictureInPictureElement === primary );
        return () => {
            primary.removeEventListener( 'enterpictureinpicture', enter );
            primary.removeEventListener( 'leavepictureinpicture', leave );
        };
    }, [ primary ] );

    const togglePip = useCallback( () => {
        if( document.pictureInPictureElement ){
            void document.exitPictureInPicture().catch( noop );
        } else if( primary ){
            void primary.requestPictureInPicture().catch( noop );
        }
    }, [ primary ] );

    // Where the stream is in its schedule: the session on air, or the one that just ended, names it, and the countdown
    // counts to the next; looked at again each minute while there is one, as the thanks give way to the countdown and
    // a session long past to the one after.
    const { stream } = useStream();
    const sessions = useMemo( () => props.sessions ?? ( props.scheduled ? [ { at: props.scheduled } ] : [] ), [ props.sessions, props.scheduled ] );
    const now = useNow( 60_000, sessions.length > 0 );
    const schedule = scheduleOf( sessions, stream, now );
    const session = stream?.state === 'live' || ( stream?.state === 'ended' && ! schedule.counting ) ? schedule.current : schedule.next;
    const title = session?.title || props.title;
    const scheduled = schedule.counting && schedule.next ? schedule.next.at : null;
    const next = schedule.next;

    const player = useMemo<Player>( () => ( {
        title,
        scheduled,
        sessions,
        next,
        url: props.url,
        loginUrl: props.loginUrl,
        cover: props.cover,
        preview: props.preview,
        placeLogo: props.placeLogo,
        appearance: props.appearance,
        studioUrl: props.studioUrl,
        connectUrl: props.connectUrl,
        room: props.room,
        texts: props.texts,
        volume,
        muted,
        volumeSettable: canSetVolume(),
        setVolume,
        setMuted,
        layout,
        hasChat: props.chat,
        chatHidden: props.chat && chatHidden,
        chatToggles: props.chat && ( layout === 'all' || fullscreen || Boolean( props.chatBeside ) ),
        toggleChat,
        root,
        fullscreen,
        canFullscreen,
        toggleFullscreen,
        pip,
        canPip,
        togglePip,
        setPrimary,
        height,
        setHeight,
        videoShape,
        setVideoShape,
        statsOpen,
        toggleStats,
        keysOpen,
        setKeysOpen,
        speaker,
        setSpeaker,
        countdown,
        setCountdown
    } ), [ title, scheduled, sessions, next, props.url, props.loginUrl, props.cover, props.preview, props.placeLogo, props.appearance, props.studioUrl, props.connectUrl, props.room, props.texts, props.chat, props.chatBeside, layout, root, volume, muted, setVolume, setMuted,
        chatHidden, toggleChat, fullscreen, canFullscreen, toggleFullscreen, pip, canPip, togglePip, height, videoShape, statsOpen, toggleStats, keysOpen, speaker, setSpeaker, countdown ] );

    return <Context.Provider value={ player }>{ props.children }</Context.Provider>;
}

// The player's keys, anywhere in it but a field being typed in: m mutes, f full screen, c the chat,
// p picture-in-picture, i the statistics, ? the list of them all (shortcuts.tsx); on the picture itself, the up and down
// arrows set the volume.
export function useShortcuts( player : Player ){
    return useCallback( ( event : KeyboardEvent ) => {
        if( event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ) return;

        const target = event.target as HTMLElement;
        if( target.closest( 'input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]' ) ) return;

        const onPicture = target.classList.contains( 'estream-stage' );
        let handled = true;

        switch( event.key.toLowerCase() ){
            case 'm':
                player.setMuted( ! player.muted );
                break;
            case 'f':
                if( player.canFullscreen ) player.toggleFullscreen(); else handled = false;
                break;
            case 'c':
                if( player.chatToggles ) player.toggleChat(); else handled = false;
                break;
            case 'p':
                if( player.canPip ) player.togglePip(); else handled = false;
                break;
            case 'i':
                player.toggleStats();
                break;
            case '?':
                player.setKeysOpen( true );
                break;
            case 'arrowup':
                if( onPicture && player.volumeSettable ) player.setVolume( ( player.muted ? 0 : player.volume ) + VOLUME_STEP ); else handled = false;
                break;
            case 'arrowdown':
                if( onPicture && player.volumeSettable ) player.setVolume( ( player.muted ? 0 : player.volume ) - VOLUME_STEP ); else handled = false;
                break;
            default:
                handled = false;
        }

        if( handled ) event.preventDefault();
    }, [ player ] );
}

// Now, again every `everyMs` while `on`: for clocks.
export function useNow( everyMs : number, on : boolean = true ) : number {
    const [ now, setNow ] = useState( () => Date.now() );

    useEffect( () => {
        if( ! on ) return;
        setNow( Date.now() );
        const timer = setInterval( () => setNow( Date.now() ), everyMs );
        return () => clearInterval( timer );
    }, [ everyMs, on ] );

    return now;
}
