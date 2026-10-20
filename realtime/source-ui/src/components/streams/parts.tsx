import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref, type RefObject} from "react";
import {createPortal} from "react-dom";
import {__} from "./i18n.ts";
import type {EasyStreamClient} from "@wordplus/realtime-client/streams";
import {AllInOne} from "./app.tsx";
import {themeClass, themeStyle, type Appearance} from "./appearance.ts";
import {RoomBanner, RoomButton, RoomStage, type RoomControls} from "./better-messages.tsx";
import {Chat} from "./chat.tsx";
import {EasyStreamProvider, useStream} from "./context.tsx";
import {InviteDialog} from "./controls.tsx";
import {ConfirmProvider} from "./dialog.tsx";
import {ShortcutList} from "./shortcuts.tsx";
import {HostNote} from "./host-note.tsx";
import {Info, type InfoShows} from "./info.tsx";
import {PlayerProvider, usePlayer, useShortcuts, WithAppearance, type StreamTexts} from "./player.tsx";
import {Stage} from "./stage.tsx";
import {Studio} from "./studio.tsx";
import {StudioPage, type StudioPageOptions} from "./studio-page.tsx";

// One stream's parts, each where the site put it on the page: the player, the chat, the studio, the stream's
// details, or the stream in one piece (`all`), and the admin's studio page. They are one React tree, rendered
// into their places (portals), so they share one client (one join, one chat watch, one room), the player's
// state (sound, full screen) and the dialogs. The embed groups a page's mount points by stream (embed.tsx).

// `room-button`, `room-banner`, `room-stage`: the stream in a Better Messages conversation, its chat room, in the places
// Better Messages keeps for it: among the header's buttons, over the messages, and in the call area beside the chat
// (better-messages.tsx).
export type PartName = 'all' | 'player' | 'chat' | 'studio' | 'details' | 'studio-page' | 'room-button' | 'room-banner' | 'room-stage';

export const PART_NAMES : readonly PartName[] = [ 'all', 'player', 'chat', 'studio', 'details', 'studio-page', 'room-button', 'room-banner', 'room-stage' ];

// The parts that show the picture: a page without any of them has the chat alone, and never fetches video.
export const VIDEO_PARTS : readonly PartName[] = [ 'all', 'player', 'studio', 'studio-page', 'room-stage' ];

export interface PartOptions {
    // The player: its own shape and what shows over it, apart from the site's appearance.
    appearance? : Pick<Appearance, 'shape' | 'title' | 'clock' | 'names' | 'floating'>;
    // The player: on a phone, the picture kept at the top of the screen while the page scrolls past it, when live.
    sticky? : boolean;
    // The chat: its height in pixels. Without one, as tall as the player beside it, or the site's chat height below it.
    height? : number;
    // The stream's details: which of them show.
    show? : InfoShows;
    // The studio page: where its links go.
    page? : StudioPageOptions;
    // The parts in a Better Messages conversation: what the conversation lets them do.
    room? : RoomControls;
}

export interface Part {
    key : string;
    element : Element;
    name : PartName;
    options? : PartOptions;
}

export interface EasyStreamPartsProps {
    client : EasyStreamClient;
    parts : Part[];
    // Where the dialogs that belong to no part go (a confirmation, the stage's invitation): an element of the page,
    // outside every part. Null for none, as in a settings page's preview.
    dialogs : Element | null;
    title? : string;
    scheduled? : number | null;
    url? : string;
    loginUrl? : string;
    cover? : string;
    preview? : boolean;
    // Whether viewers may ask to come on stage (default false: guests on stage aren't in the first release), and
    // whether the stream has chat (default true).
    guests? : boolean;
    chat? : boolean;
    appearance? : Appearance;
    studioUrl? : string;
    // The stream's Better Messages chat room, where that is its chat: Better Messages' placeholder for it.
    room? : string;
    // The stream's own words in place of the player's.
    texts? : StreamTexts;
    // Start the client on mount and stop it on unmount (default true).
    manage? : boolean;
}

interface Group {
    names : ReadonlySet<PartName>;
    dialogs : Element | null;
    guests : boolean;
    chat : boolean;
    // The player part's place on the page, which a chat beside it matches in height.
    player : HTMLElement | null;
    setPlayer : ( element : HTMLElement | null ) => void;
}

const GroupContext = createContext<Group>( { names: new Set(), dialogs: null, guests: false, chat: true, player: null, setPlayer: () => {} } );

const useGroup = () => useContext( GroupContext );

// A chat beside the player is at least this tall, however small the player.
const CHAT_MIN_PX = 360;
const CHAT_HEIGHT = [ 240, 1200 ];
// Where the picture follows the page down while live (`sticky`): a phone's width.
const NARROW = '(max-width: 600px)';

// A part's own theme root: the site's colours and type, as every part of the stream has them.
function PartRoot( props : { name : PartName | 'dialogs', className? : string, style? : CSSProperties, rootRef? : Ref<HTMLDivElement>, onKeyDown? : ( event : KeyboardEvent ) => void, children : ReactNode } ){
    const { appearance, videoShape } = usePlayer();

    return (
        <div
            ref={ props.rootRef }
            className={ themeClass( appearance, videoShape ) + ' estream-part estream-part--' + props.name + ( props.className ? ' ' + props.className : '' ) }
            style={ { ...themeStyle( appearance ), ...props.style } }
            onKeyDown={ props.onKeyDown }
        >
            { props.children }
        </div>
    );
}

// The way to the studio for a host, unless a part here is a studio (HostNote).
function PartsHostNote(){
    const group = useGroup();
    return <HostNote hidden={ group.names.has( 'studio' ) || group.names.has( 'studio-page' ) } />;
}

// On a phone, once the player has scrolled up out of sight while live, the picture stays at the top of the screen:
// the height its place keeps meanwhile, or 0 while it is in its place.
function useFloating( holder : RefObject<HTMLElement | null>, on : boolean ) : number {
    const [ height, setHeight ] = useState( 0 );

    useEffect( () => {
        const element = holder.current;
        if( ! on || ! element || typeof IntersectionObserver === 'undefined' || typeof window.matchMedia !== 'function' ){
            setHeight( 0 );
            return;
        }

        const narrow = window.matchMedia( NARROW );
        const observer = new IntersectionObserver( ( entries ) => {
            const entry = entries[ entries.length - 1 ];
            const above = entry !== undefined && ! entry.isIntersecting && entry.boundingClientRect.top < 0;
            setHeight( above && narrow.matches ? Math.round( entry.boundingClientRect.height ) : 0 );
        } );
        observer.observe( element );

        return () => {
            observer.disconnect();
            setHeight( 0 );
        };
    }, [ holder, on ] );

    return height;
}

function PlayerPart( props : { options : PartOptions } ){
    const player = usePlayer();
    const state = useStream();
    const group = useGroup();
    const shortcuts = useShortcuts( player );
    const holder = useRef<HTMLDivElement | null>( null );
    const floating = useFloating( holder, Boolean( props.options.sticky ) && state.stream?.state === 'live' && ! player.fullscreen && ! player.preview );
    // In full screen the chat is the player's own, beside the picture.
    const chat = player.hasChat && player.fullscreen && ! player.chatHidden;
    const { setPlayer } = group;

    const place = useCallback( ( element : HTMLDivElement | null ) => {
        holder.current = element;
        setPlayer( element );
    }, [ setPlayer ] );

    return (
        <div ref={ place } className="estream-part-place" style={ floating ? { height: floating + 'px' } : undefined }>
            <PartRoot
                name="player"
                rootRef={ player.root as RefObject<HTMLDivElement | null> }
                className={ ( player.fullscreen ? 'estream-theme--full' : '' ) + ( floating ? ' estream-part--floating' : '' ) }
                onKeyDown={ shortcuts }
            >
                <PartsHostNote />
                <div className="estream-shell">
                    <div className={ 'estream-app estream-app--player' + ( chat ? '' : ' estream-app--no-chat' ) }>
                        <div className="estream-app__main"><Stage studio={ state.you?.role === 'host' && group.names.has( 'studio' ) } /></div>
                        { chat && <aside className="estream-app__side"><Chat /></aside> }
                    </div>
                </div>
            </PartRoot>
        </div>
    );
}

// As tall as the player when it sits beside it (neither over nor under it), at least CHAT_MIN_PX; 0 otherwise, for
// the site's chat height.
function useBesideHeight( box : RefObject<HTMLElement | null>, player : HTMLElement | null, on : boolean ) : number {
    const [ height, setHeight ] = useState( 0 );

    useLayoutEffect( () => {
        const chat = box.current;
        if( ! on || ! chat || ! player ){
            setHeight( 0 );
            return;
        }

        const measure = () => {
            const a = player.getBoundingClientRect();
            const b = chat.getBoundingClientRect();
            const beside = b.left >= a.right - 1 || b.right <= a.left + 1;
            setHeight( beside && a.height > 0 ? Math.max( CHAT_MIN_PX, Math.round( a.height ) ) : 0 );
        };

        measure();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver( measure ) : null;
        observer?.observe( player );
        window.addEventListener( 'resize', measure );

        return () => {
            observer?.disconnect();
            window.removeEventListener( 'resize', measure );
        };
    }, [ box, player, on ] );

    return height;
}

function ChatPart( props : { options : PartOptions } ){
    const group = useGroup();
    const box = useRef<HTMLDivElement | null>( null );
    const asked = props.options.height;
    const fixed = typeof asked === 'number' && asked > 0 ? Math.min( CHAT_HEIGHT[1]!, Math.max( CHAT_HEIGHT[0]!, Math.round( asked ) ) ) : 0;
    const beside = useBesideHeight( box, group.player, fixed === 0 );
    const height = fixed || beside;

    // A stream without chat has none to show.
    if( ! group.chat ) return null;

    return (
        <PartRoot name="chat" rootRef={ box } className={ height ? 'estream-part--sized' : '' } style={ height ? { height: height + 'px' } : undefined }>
            <Chat />
        </PartRoot>
    );
}

// Only a host sees the studio; everyone else nothing at all.
function StudioPart(){
    const state = useStream();
    if( state.you?.role !== 'host' ) return null;

    return <PartRoot name="studio"><Studio /></PartRoot>;
}

function DetailsPart( props : { options : PartOptions } ){
    const group = useGroup();

    return <PartRoot name="details"><Info guests={ group.guests } show={ props.options.show } /></PartRoot>;
}

function StudioPagePart( props : { options : PartOptions } ){
    const state = useStream();
    const player = usePlayer();
    const group = useGroup();
    const shortcuts = useShortcuts( player );

    if( state.status === 'ready' && state.you?.role !== 'host' ){
        return (
            <PartRoot name="studio-page">
                <p className="estream-studio-page__refused">{ __( 'Only the hosts of the stream can go live from here.', 'wordplus-stream' ) }</p>
            </PartRoot>
        );
    }

    return (
        <PartRoot name="studio-page" onKeyDown={ shortcuts }>
            <StudioPage options={ props.options.page ?? {} } chat={ group.chat } guests={ group.guests } root={ player.root } />
        </PartRoot>
    );
}

// The stream in a Better Messages conversation: Better Messages' own markup, in its places, not the stream's theme.
// A stream for others (a members' stream) shows nobody else anything.
function RoomPart( props : { name : 'room-button' | 'room-banner' | 'room-stage', room? : RoomControls } ){
    const state = useStream();
    const group = useGroup();
    const { room } = props;

    if( ! room || ( state.status === 'error' && props.name !== 'room-stage' ) ) return null;

    switch( props.name ){
        case 'room-button':
            return <RoomButton room={ room } />;
        case 'room-banner':
            return <RoomBanner room={ room } />;
        default:
            return <RoomStage room={ room } />;
    }
}

function PartView( props : { part : Part } ){
    const options = props.part.options ?? {};

    switch( props.part.name ){
        case 'player':
            return <WithAppearance appearance={ options.appearance }><PlayerPart options={ options } /></WithAppearance>;
        case 'chat':
            return <ChatPart options={ options } />;
        case 'studio':
            return <StudioPart />;
        case 'details':
            return <DetailsPart options={ options } />;
        case 'studio-page':
            return <StudioPagePart options={ options } />;
        case 'room-button':
        case 'room-banner':
        case 'room-stage':
            return <RoomPart name={ props.part.name } room={ options.room } />;
        default:
            return null;
    }
}

// The dialogs that belong to no part: in the player while it is full screen, where they can be seen; otherwise on
// the page's layer for them, in the stream's colours.
function DialogLayer( props : { children : ReactNode } ){
    const player = usePlayer();
    const group = useGroup();
    const full = player.fullscreen ? player.root.current : null;

    if( full ) return createPortal( props.children, full );
    if( ! group.dialogs ) return null;

    return createPortal( <PartRoot name="dialogs">{ props.children }</PartRoot>, group.dialogs );
}

function Parts( props : EasyStreamPartsProps ){
    const state = useStream();
    const root = useRef<HTMLElement | null>( null );
    const [ player, setPlayer ] = useState<HTMLElement | null>( null );
    const appearance = useMemo( () => props.appearance ?? {}, [ props.appearance ] );
    const guests = props.guests ?? false;
    const chat = props.chat ?? true;
    const apart = props.parts.filter( ( p ) => p.name !== 'all' );
    const together = props.parts.filter( ( p ) => p.name === 'all' );
    const list = apart.map( ( p ) => p.name ).join( ' ' );
    const names = useMemo( () => new Set( list.split( ' ' ) as PartName[] ), [ list ] );

    const group = useMemo<Group>( () => ( { names, dialogs: props.dialogs, guests, chat, player, setPlayer } ), [ names, props.dialogs, guests, chat, player ] );
    // The player's own chat, in its full screen: the light chat alone. A Better Messages room stays where the page put it.
    const playerChat = chat && ! props.room && state.status !== 'error' && names.has( 'player' );

    return (
        <>
            { together.map( ( p ) => createPortal(
                <AllInOne
                    title={ props.title }
                    scheduled={ props.scheduled }
                    url={ props.url }
                    loginUrl={ props.loginUrl }
                    cover={ props.cover }
                    preview={ props.preview }
                    guests={ guests }
                    chat={ chat }
                    appearance={ appearance }
                    studioUrl={ props.studioUrl }
                    room={ props.room }
                    texts={ props.texts }
                    studioHere={ names.has( 'studio' ) || names.has( 'studio-page' ) }
                />,
                p.element,
                p.key
            ) ) }

            { apart.length > 0 && (
                <PlayerProvider
                    root={ root }
                    layout="parts"
                    title={ props.title }
                    scheduled={ props.scheduled }
                    url={ props.url }
                    loginUrl={ props.loginUrl }
                    cover={ props.cover }
                    preview={ props.preview }
                    appearance={ appearance }
                    studioUrl={ props.studioUrl }
                    room={ props.room }
                    texts={ props.texts }
                    chat={ playerChat }
                >
                    <GroupContext.Provider value={ group }>
                        <ConfirmProvider layer={ DialogLayer }>
                            { apart.map( ( p ) => createPortal( <PartView part={ p } />, p.element, p.key ) ) }
                            { /* The stream in one piece on the page asks the invitation itself. */ }
                            { together.length === 0 && <DialogLayer><InviteDialog /><ShortcutList /></DialogLayer> }
                        </ConfirmProvider>
                    </GroupContext.Provider>
                </PlayerProvider>
            ) }
        </>
    );
}

// A stream's parts on a page, sharing one client.
export function EasyStreamParts( props : EasyStreamPartsProps ){
    const { client, manage = true } = props;

    useEffect( () => {
        if( ! manage ) return;
        void client.start();
        return () => client.stop();
    }, [ client, manage ] );

    return (
        <EasyStreamProvider client={ client }>
            <Parts { ...props } />
        </EasyStreamProvider>
    );
}
