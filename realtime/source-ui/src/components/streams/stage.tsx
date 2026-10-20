import {createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode} from "react";
import {CHOSEN_MAX_SIDE, type Corner, type LayerQuality, type Layout, type PictureLayer, type Tile, type VideoChoice} from "@wordplus/realtime-client/streams";
import {__, _nx, _x, sprintf} from "./i18n.ts";
import {useClient, useStream} from "./context.tsx";
import {clock, count} from "./format.ts";
import {Icon, type IconName} from "./icons.tsx";
import {writePref} from "./prefs.ts";
import {AudioTracks, VideoTrack} from "./media.tsx";
import {MenuButton, MenuChoice, MenuHeading, MenuItem} from "./menu.tsx";
import {usePlayer, useNow} from "./player.tsx";
import {screenFor} from "./screens.tsx";
import {logoOf, safeImage} from "./appearance.ts";
import {StatsPanel} from "./stats.tsx";
import {offeredReactions, reactionIcon} from "./reactions.ts";
import {EmojiGlyph} from "./emoji-glyph.tsx";

// The controls hide this long after the pointer stops.
const IDLE_MS = 3000;

// A button's name with its key, for its tooltip: "Mute (m)".
const withKey = ( label : string, key : string ) => sprintf( _x( '%1$s (%2$s)', 'a button\'s name, then its keyboard key', 'wordplus-stream' ), label, key );

function Initials( props : { name : string } ){
    const letters = props.name.split( /\s+/ ).filter( Boolean ).slice( 0, 2 ).map( ( w ) => w[0]?.toUpperCase() ).join( '' );
    return <div className="estream-initials" aria-hidden="true">{ letters || '?' }</div>;
}

// Someone on stage without a picture (the camera off, or a microphone alone): their avatar, or their initials where
// they have none or it doesn't load, and their name under it.
function Person( props : { name : string, avatar? : string | null } ){
    const [ broken, setBroken ] = useState( false );
    const src = broken ? null : safeImage( props.avatar );

    return (
        <div className="estream-person">
            { src
                ? <img className="estream-person__avatar" src={ src } alt="" draggable={ false } onError={ () => setBroken( true ) } />
                : <Initials name={ props.name } /> }
            <span className="estream-person__name">{ props.name }</span>
        </div>
    );
}

// What a tile says over its picture, who it is (`named`) and that their microphone is off, drawn by a frame of its own
// in its own look (a Better Messages conversation's, better-messages.tsx).
export type TileInfo = ( tile : Tile, named : boolean ) => ReactNode;

const TileInfoContext = createContext<TileInfo | null>( null );

function TileView( props : { tile : Tile, main? : boolean, primary? : boolean, named : boolean, alone? : boolean, corner? : boolean } ){
    const { tile } = props;
    const { facing } = useStream();
    const info = useContext( TileInfoContext );
    const track = props.main && tile.screen ? tile.screen : tile.camera;
    // Without a picture the person shows with their name, so the name over the picture would say it twice.
    const named = props.named && track !== null;
    // The speaker's ring tells people apart: one alone on the stage, or with their camera in the corner, needs none.
    const ringed = tile.speaking && ! props.alone && ! props.corner;

    // A screen and an encoder's picture are shown whole: what they hold reaches to their edges. So is a
    // camera alone on the stage, which may be a phone's upright picture; cameras side by side fill their tiles.
    return (
        <div className={ 'estream-tile' + ( ringed ? ' estream-tile--speaking' : '' ) }>
            { track
                ? <VideoTrack track={ track } primary={ props.primary } fills={ props.alone } mirrored={ tile.local && track === tile.camera && facing === 'user' } fit={ track === tile.screen || tile.encoder || props.alone ? 'contain' : 'cover' } />
                : <Person name={ tile.name } avatar={ tile.avatar } /> }
            { info ? info( tile, named ) : ( named || tile.micMuted ) && (
                <div className="estream-tile__name">
                    { tile.micMuted && <span className="estream-tile__muted" role="img" aria-label={ __( 'Microphone off', 'wordplus-stream' ) }><Icon name="mic-off" /></span> }
                    { named && <span>{ tile.name }</span> }
                </div>
            ) }
        </div>
    );
}

// How far an arrow key moves the camera over the screen, as a share of the room the stage leaves it; with Shift, less.
const CORNER_STEP = 0.05;
const CORNER_FINE_STEP = 0.01;

// The camera of the one sharing a screen, over it: in its bottom corner until the host moves it (the layout's
// `corner`, which the cloud gives everyone), with the pointer or, once it has the focus, the arrow keys, and Home
// for the corner again. While it moves only here, then for everyone as it is let go.
function CornerCamera( props : { tile : Tile, side : 'left' | 'right' } ){
    const { layout, you } = useStream();
    const client = useClient();
    const movable = you?.role === 'host' && typeof client.setCorner === 'function';
    const [ moving, setMoving ] = useState<Corner | null>( null );
    const box = useRef<HTMLDivElement>( null );
    const grab = useRef<{ dx : number, dy : number, at : Corner | null } | null>( null );
    const at = moving ?? layout.corner ?? null;

    // Where the pointer puts it, as shares of the room the stage leaves it.
    const pointedAt = ( x : number, y : number ) : Corner | null => {
        const el = box.current;
        const stage = el?.parentElement;
        if( ! el || ! stage || ! grab.current ) return null;
        const s = stage.getBoundingClientRect();
        const own = el.getBoundingClientRect();
        const share = ( n : number, room : number ) => room > 0 ? Math.min( 1, Math.max( 0, n / room ) ) : 0;
        return { x: share( x - grab.current.dx - s.left, s.width - own.width ), y: share( y - grab.current.dy - s.top, s.height - own.height ) };
    };

    const place = ( corner : Corner | null ) => {
        setMoving( null );
        void client.setCorner( corner );
    };

    const handlers = movable ? {
        tabIndex: 0,
        role: 'group',
        'aria-label': __( 'Camera over the shared screen. Drag it, or move it with the arrow keys.', 'wordplus-stream' ),
        onPointerDown: ( e : ReactPointerEvent<HTMLDivElement> ) => {
            // The main button, or a finger
            if( e.button > 0 ) return;
            e.stopPropagation();
            e.preventDefault();
            const own = e.currentTarget.getBoundingClientRect();
            grab.current = { dx: e.clientX - own.left, dy: e.clientY - own.top, at: null };
            e.currentTarget.setPointerCapture?.( e.pointerId );
            e.currentTarget.focus( { preventScroll: true } );
        },
        onPointerMove: ( e : ReactPointerEvent<HTMLDivElement> ) => {
            if( ! grab.current ) return;
            const next = pointedAt( e.clientX, e.clientY );
            if( next ){
                grab.current.at = next;
                setMoving( next );
            }
        },
        onPointerUp: ( e : ReactPointerEvent<HTMLDivElement> ) => {
            if( ! grab.current ) return;
            e.stopPropagation();
            const moved = grab.current.at;
            grab.current = null;
            if( moved ) place( moved );
        },
        onPointerCancel: () => {
            grab.current = null;
            setMoving( null );
        },
        // Not full screen, as a double click elsewhere on the picture is.
        onDoubleClick: ( e : ReactMouseEvent ) => e.stopPropagation(),
        onKeyDown: ( e : ReactKeyboardEvent<HTMLDivElement> ) => {
            if( e.key === 'Home' ){
                e.preventDefault();
                place( null );
                return;
            }
            const by = { ArrowLeft: [ -1, 0 ], ArrowRight: [ 1, 0 ], ArrowUp: [ 0, -1 ], ArrowDown: [ 0, 1 ] }[ e.key as string ] as [ number, number ] | undefined;
            if( ! by ) return;
            e.preventDefault();
            e.stopPropagation();
            const step = e.shiftKey ? CORNER_FINE_STEP : CORNER_STEP;
            const from = at ?? { x: props.side === 'left' ? 0 : 1, y: 1 };
            place( { x: Math.min( 1, Math.max( 0, from.x + by[0] * step ) ), y: Math.min( 1, Math.max( 0, from.y + by[1] * step ) ) } );
        }
    } : {};

    // Anywhere in the stage, its left from 0 to all the room the stage leaves it, and its top the same: its own size
    // taken back off by the translation, which goes by its size.
    const style : CSSProperties | undefined = at ? {
        left: at.x * 100 + '%', top: at.y * 100 + '%', right: 'auto', bottom: 'auto', transform: 'translate(' + -at.x * 100 + '%, ' + -at.y * 100 + '%)'
    } : undefined;

    return (
        <div
            ref={ box }
            className={ 'estream-tiles__corner estream-tiles__corner--' + props.side + ( movable ? ' estream-tiles__corner--movable' : '' ) + ( moving ? ' estream-tiles__corner--moving' : '' ) }
            style={ style }
            { ...handlers }
        >
            <TileView tile={ { ...props.tile, screen: null } } named={ false } corner />
        </div>
    );
}

// A tile's key: its identity, or for one's own tile the same key throughout. Before going live it is the preview's,
// the person's identity, and from then the room's, the identity of their place in it (the person's and the tab's), on
// the same picture: keyed by identity, React made its <video> again, and the picture blinked as the host went live.
const tileKey = ( tile : Tile ) => tile.local ? 'local' : tile.identity;

// The picture, as the host laid it out: one person alone in the spotlight; otherwise a screen share across
// the stage with its sharer's camera in the corner, or large with the cameras beside it when others are on
// stage too; the one speaking large, as the last one who spoke while nobody does; or everyone in a grid.
// Names show once there is more than one person to tell apart.
function Tiles( props : { tiles : Tile[] } ){
    const { appearance } = usePlayer();
    const { layout } = useStream();
    const lastSpeaker = useRef<string | null>( null );
    const sharing = props.tiles.find( ( t ) => t.screen );
    const named = props.tiles.length > 1 && appearance.names !== false;

    const spotlit = layout.mode === 'spotlight' ? props.tiles.find( ( t ) => t.identity === layout.identity ) : undefined;
    if( spotlit ){
        return (
            <div className="estream-tiles estream-tiles--n1">
                <TileView tile={ spotlit } main primary named={ false } alone />
            </div>
        );
    }

    const speaking = props.tiles.find( ( t ) => t.speaking );
    if( speaking ) lastSpeaker.current = speaking.identity;

    if( ! sharing && layout.mode === 'speaker' && props.tiles.length > 1 ){
        const main = props.tiles.find( ( t ) => t.identity === lastSpeaker.current ) ?? props.tiles[0]!;
        return (
            <div className="estream-tiles estream-tiles--share estream-tiles--speaker">
                <div className="estream-tiles__main"><TileView tile={ main } primary named={ named } /></div>
                <div className="estream-tiles__strip">
                    { props.tiles.filter( ( t ) => t !== main ).map( ( t ) => <TileView key={ tileKey( t ) } tile={ t } named={ named } /> ) }
                </div>
            </div>
        );
    }

    if( sharing ){
        const others = props.tiles.filter( ( t ) => t !== sharing || t.camera );
        // A screen shared with no camera beside it fills the stage, with no empty strip at its side. With the sharer's
        // own camera alone, the screen fills it still and the camera sits in its bottom corner over it, as a stream
        // of a screen and a face is laid out, on the left where the site's logo takes the right.
        if( others.length === 0 || ( others.length === 1 && others[0] === sharing ) ){
            const side = logoOf( appearance )?.position === 'bottom-right' ? 'left' : 'right';
            return (
                <div className="estream-tiles estream-tiles--n1">
                    <TileView tile={ sharing } main primary named={ false } alone />
                    { others.length > 0 && <CornerCamera tile={ sharing } side={ side } /> }
                </div>
            );
        }
        return (
            <div className="estream-tiles estream-tiles--share">
                <div className="estream-tiles__main"><TileView tile={ sharing } main primary named={ false } /></div>
                <div className="estream-tiles__strip">
                    { others.map( ( t ) => <TileView key={ tileKey( t ) } tile={ t.screen ? { ...t, screen: null } : t } named={ appearance.names !== false } /> ) }
                </div>
            </div>
        );
    }

    return (
        <div className={ 'estream-tiles estream-tiles--n' + Math.min( props.tiles.length, 4 ) }>
            { props.tiles.map( ( t, i ) => <TileView key={ tileKey( t ) } tile={ t } primary={ i === 0 } named={ named } alone={ props.tiles.length === 1 } /> ) }
        </div>
    );
}

// The reactions rising over the picture: only those the site offers, so an emoji it didn't choose never shows, whoever
// sent it.
function Floating(){
    const { reactions } = useStream();
    const { appearance } = usePlayer();
    const offered = offeredReactions( appearance );

    return (
        <div className="estream-floating" aria-hidden="true">
            { reactions.filter( ( r ) => offered.includes( reactionIcon( r.kind ) ) ).map( ( r ) => (
                <span key={ r.id } className="estream-floating__item" style={ {
                    left: ( ( r.id * 37 ) % 60 + 30 ) + '%',
                    animationDelay: Math.max( 0, r.at - Date.now() ) + 'ms',
                    '--estream-drift': ( ( r.id * 53 ) % 41 - 20 ) + 'px'
                } as CSSProperties }>
                    <EmojiGlyph emoji={ reactionIcon( r.kind ) } />
                </span>
            ) ) }
        </div>
    );
}

// How long it has been on air.
function OnAir( props : { since : number } ){
    const now = useNow( 1000 );
    return <span className="estream-bar__time" aria-label={ __( 'Time on air', 'wordplus-stream' ) }>{ clock( now - props.since ) }</span>;
}

// An icon alone, named by `label`; its tooltip says the label, or `tip` (with its key).
export function IconButton( props : { icon : IconName, label : string, tip? : string, onClick : () => void, pressed? : boolean } ){
    return (
        <button
            type="button"
            className="estream-icon-button"
            aria-label={ props.label }
            aria-pressed={ props.pressed }
            data-estream-tip={ props.tip ?? props.label }
            onClick={ props.onClick }
        >
            <Icon name={ props.icon } />
        </button>
    );
}

function Volume(){
    const player = usePlayer();
    const client = useClient();
    const state = useStream();
    const silent = player.muted || player.volume === 0;
    const level = silent ? 0 : player.volume;

    return (
        <div className="estream-volume">
            <IconButton
                icon={ silent ? 'volume-off' : player.volume < 0.5 ? 'volume-low' : 'volume' }
                label={ silent ? __( 'Unmute', 'wordplus-stream' ) : __( 'Mute', 'wordplus-stream' ) }
                tip={ withKey( silent ? __( 'Unmute', 'wordplus-stream' ) : __( 'Mute', 'wordplus-stream' ), 'm' ) }
                onClick={ () => {
                    // A click is what a browser that blocked sound waits for.
                    if( state.audioBlocked ) void client.startAudio();
                    player.setMuted( ! silent );
                } }
            />
            { player.volumeSettable && (
                <input
                    type="range"
                    className="estream-volume__slider"
                    min={ 0 }
                    max={ 1 }
                    step={ 0.05 }
                    value={ level }
                    aria-label={ __( 'Volume', 'wordplus-stream' ) }
                    aria-valuetext={ Math.round( level * 100 ) + '%' }
                    style={ { '--estream-level': level * 100 + '%' } as CSSProperties }
                    onChange={ ( e ) => player.setVolume( Number( e.target.value ) ) }
                />
            ) }
        </div>
    );
}

// The picture the stage shows largest, as Tiles lays it out: the one in the spotlight, a shared screen, else the first
// camera. Its layers are those the quality menu offers.
export function mainTrack( tiles : Tile[], layout : Layout ) : Tile['camera'] {
    const remote = tiles.filter( ( t ) => ! t.local );
    const spotlit = layout.mode === 'spotlight' ? remote.find( ( t ) => t.identity === layout.identity ) : undefined;
    if( spotlit ) return spotlit.camera ?? spotlit.screen;
    return remote.find( ( t ) => t.screen )?.screen ?? remote.find( ( t ) => t.camera )?.camera ?? null;
}

const heightName = ( height : number ) => sprintf( _x( '%dp', 'a picture\'s height, as in 720p', 'wordplus-stream' ), height );

function qualityWord( quality : LayerQuality ) : string {
    if( quality === 'high' ) return _x( 'High', 'picture quality', 'wordplus-stream' );
    if( quality === 'medium' ) return _x( 'Medium', 'picture quality', 'wordplus-stream' );
    return _x( 'Low', 'picture quality', 'wordplus-stream' );
}

// The pictures a viewer may choose beside Auto: each layer the sender sends by its height (720p, 540p, 360p), the
// smallest saving data; by a word where the sender doesn't say its sizes (an encoder over WHIP), or before the layers
// are known. None above 720p by its short side (the protocol's CHOSEN_MAX_SIDE, which the engine holds a choice to):
// Full HD comes on Auto alone. Asked as a menu opens, as the sender sends them then.
export function qualityChoices( client : ReturnType<typeof useClient>, state : ReturnType<typeof useStream> ) : { quality : LayerQuality, label : string, saves : boolean }[] {
    const all = client.pictureLayers?.( mainTrack( state.tiles, state.layout ) ) ?? [];
    const choosable = all.filter( ( l : PictureLayer ) => l.height === 0 || Math.min( l.width, l.height ) <= CHOSEN_MAX_SIDE );
    const layers = choosable.length > 0 ? choosable : all;
    const sized = layers.length > 0 && layers.every( ( l ) => l.height > 0 );
    const offered : LayerQuality[] = layers.length > 0 ? layers.map( ( l ) => l.quality ) : [ 'high', 'medium', 'low' ];
    const smallest = offered[ offered.length - 1 ];

    return offered.map( ( quality ) => ( {
        quality,
        label: sized ? heightName( layers.find( ( l ) => l.quality === quality )!.height ) : qualityWord( quality ),
        saves: quality === smallest && offered.length > 1
    } ) );
}

// The choice a menu marks: the viewer's, or where it was a layer no longer offered (Full HD, chosen before it was
// left out), the largest offered, which the engine sends instead.
export function shownQuality( quality : VideoChoice, choices : { quality : LayerQuality }[] ) : VideoChoice {
    return quality === 'auto' || choices.some( ( c ) => c.quality === quality ) ? quality : choices[ 0 ]?.quality ?? quality;
}

// Auto, then the pictures to choose (qualityChoices), then the statistics. `quality`: whether a picture arrives to
// choose for; a host whose picture is this window's own has the statistics alone.
function Settings( props : { quality : boolean } ){
    const client = useClient();
    const state = useStream();
    const { quality } = state;
    const { height, statsOpen, toggleStats } = usePlayer();
    const choose = ( q : VideoChoice, close : () => void ) => {
        client.setQuality( q );
        writePref( 'quality', q );
        close();
    };

    return (
        <MenuButton icon="sliders" label={ __( 'Settings', 'wordplus-stream' ) } className="estream-bar__settings">
            { ( close ) => {
                const choices = props.quality ? qualityChoices( client, state ) : [];
                const shown = shownQuality( quality, choices );
                return (
                    <>
                        { props.quality && (
                            <>
                                <MenuHeading>{ __( 'Quality', 'wordplus-stream' ) }</MenuHeading>
                                <MenuChoice
                                    checked={ quality === 'auto' }
                                    onSelect={ () => choose( 'auto', close ) }
                                    hint={ quality === 'auto' && height > 0 ? heightName( height ) : undefined }
                                    note={ __( 'Follows the size of the player and your connection', 'wordplus-stream' ) }
                                >
                                    { _x( 'Auto', 'picture quality', 'wordplus-stream' ) }
                                </MenuChoice>
                            </>
                        ) }
                        { choices.map( ( c ) => (
                            <MenuChoice
                                key={ c.quality }
                                checked={ shown === c.quality }
                                onSelect={ () => choose( c.quality, close ) }
                                hint={ c.saves ? __( 'Saves data', 'wordplus-stream' ) : undefined }
                            >
                                { c.label }
                            </MenuChoice>
                        ) ) }
                        <MenuItem icon="stats" onSelect={ () => { close(); toggleStats(); } }>
                            { statsOpen ? _x( 'Hide statistics', 'of the player', 'wordplus-stream' ) : __( 'Statistics', 'wordplus-stream' ) }
                        </MenuItem>
                    </>
                );
            } }
        </MenuButton>
    );
}

// The controls along the bottom of the picture.
function Bar( props : { shown : boolean } ){
    const player = usePlayer();
    const state = useStream();
    const live = state.stream?.state === 'live';
    const remote = state.tiles.some( ( t ) => ! t.local );
    // This window sends into the stream: its statistics say how it goes out.
    const sending = state.media === 'live' && state.tiles.some( ( t ) => t.local );

    return (
        <div className={ 'estream-bar' + ( props.shown ? '' : ' estream-bar--hidden' ) }>
            { remote && <Volume /> }
            { live && state.stream?.started_at && player.appearance.clock !== false ? <OnAir since={ state.stream.started_at } /> : null }
            <span className="estream-bar__spacer" />
            { ( remote || sending ) && <Settings quality={ remote } /> }
            { player.chatToggles && (
                <IconButton
                    icon={ player.chatHidden ? 'chat' : 'chat-off' }
                    label={ player.chatHidden ? __( 'Show chat', 'wordplus-stream' ) : __( 'Hide chat', 'wordplus-stream' ) }
                    tip={ withKey( player.chatHidden ? __( 'Show chat', 'wordplus-stream' ) : __( 'Hide chat', 'wordplus-stream' ), 'c' ) }
                    onClick={ player.toggleChat }
                />
            ) }
            { player.canPip && (
                <IconButton
                    icon="pip"
                    label={ player.pip ? __( 'Exit picture-in-picture', 'wordplus-stream' ) : __( 'Picture-in-picture', 'wordplus-stream' ) }
                    tip={ withKey( player.pip ? __( 'Exit picture-in-picture', 'wordplus-stream' ) : __( 'Picture-in-picture', 'wordplus-stream' ), 'p' ) }
                    onClick={ player.togglePip }
                />
            ) }
            { player.canFullscreen && (
                <IconButton
                    icon={ player.fullscreen ? 'fullscreen-exit' : 'fullscreen' }
                    label={ player.fullscreen ? __( 'Exit full screen', 'wordplus-stream' ) : __( 'Full screen', 'wordplus-stream' ) }
                    tip={ withKey( player.fullscreen ? __( 'Exit full screen', 'wordplus-stream' ) : __( 'Full screen', 'wordplus-stream' ), 'f' ) }
                    onClick={ player.toggleFullscreen }
                />
            ) }
        </div>
    );
}

// Along the top: the Live badge, with the time on air where there is no bar along the bottom to show it (`bare`), and
// in full screen the title and the count the page around it showed.
function Top( props : { shown : boolean, bare? : boolean } ){
    const state = useStream();
    const player = usePlayer();
    const live = state.stream?.state === 'live';
    const counted = player.appearance.viewers !== false || state.you?.role === 'host';
    const weak = state.connection === 'poor' || state.connection === 'lost';
    const since = live && props.bare && player.appearance.clock !== false ? state.stream?.started_at ?? null : null;

    const preview = ! live && state.tiles.some( ( t ) => t.local || t.encoder );

    return (
        <div className="estream-top">
            { live && player.appearance.liveBadge !== false && <span className="estream-badge estream-badge--live">{ _x( 'Live', 'a stream on air', 'wordplus-stream' ) }</span> }
            { since !== null && <span className="estream-badge estream-top__time"><OnAir since={ since } /></span> }
            { preview && <span className="estream-badge estream-badge--preview">{ _x( 'Preview', 'a host\'s own picture before going live', 'wordplus-stream' ) }</span> }
            { live && player.fullscreen && counted && (
                <span className="estream-badge estream-top__count">
                    <Icon name="eye" />
                    { sprintf( _nx( '%s watching', '%s watching', state.viewers, 'how many people watch', 'wordplus-stream' ), count( state.viewers ) ) }
                </span>
            ) }
            { player.fullscreen && player.title && player.appearance.title !== false && <span className={ 'estream-top__title' + ( props.shown ? '' : ' estream-top__title--hidden' ) }>{ player.title }</span> }
            <span className="estream-bar__spacer" />
            { weak && state.tiles.length > 0 && (
                <span className="estream-badge estream-top__weak" role="status">
                    <Icon name="signal" />
                    { __( 'Weak connection', 'wordplus-stream' ) }
                </span>
            ) }
        </div>
    );
}

// For a few seconds after the host muted a guest's microphone, the guest is told.
const MUTED_SHOWN_MS = 6000;

function MutedByHost( props : { at : number | null } ){
    const recent = props.at !== null && Date.now() - props.at < MUTED_SHOWN_MS;
    const now = useNow( 1000, recent );
    if( props.at === null || now - props.at >= MUTED_SHOWN_MS ) return null;

    return (
        <div className="estream-reconnecting" role="status">
            <Icon name="mic-off" />
            { __( 'The host muted your microphone', 'wordplus-stream' ) }
        </div>
    );
}

// What the viewer sees: the stream with its controls, or a screen saying why there is nothing to see. `studio`: the
// host's own view in a studio, whose screens say what to do next. `bare`: without the controls along the bottom, for a
// frame that has its own (a Better Messages conversation's stage, better-messages.tsx). `screen`: a screen of the
// frame's own in place of the moment's. `tileInfo`: what each tile says over its picture, in the frame's look.
export function Stage( props : { scheduled? : number | null, studio? : boolean, bare? : boolean, screen? : ReactNode, tileInfo? : TileInfo } ){
    const state = useStream();
    const client = useClient();
    const player = usePlayer();
    const moment = screenFor( state, props.scheduled !== undefined ? props.scheduled : player.scheduled, props.studio );
    const screen = moment !== null && props.screen ? props.screen : moment;
    const picture = screen === null;
    const logo = logoOf( player.appearance );
    // The cover behind the screen before the start and after the end.
    const cover = ! picture && state.status === 'ready' && state.stream?.state !== 'live' && ! state.encoder ? safeImage( player.cover ) : null;

    // The controls show while the pointer moves, while anything in them has focus, and on a tap; they
    // hide once it rests.
    const [ awake, setAwake ] = useState( true );
    const [ focused, setFocused ] = useState( false );
    const timer = useRef<ReturnType<typeof setTimeout> | null>( null );

    const wake = useCallback( () => {
        setAwake( true );
        if( timer.current ) clearTimeout( timer.current );
        timer.current = setTimeout( () => setAwake( false ), IDLE_MS );
    }, [] );

    useEffect( () => {
        wake();
        return () => { if( timer.current ) clearTimeout( timer.current ); };
    }, [ wake ] );

    const shown = ! picture || awake || focused;

    const onPointerUp = ( event : ReactPointerEvent ) => {
        if( event.pointerType === 'mouse' || ( event.target as HTMLElement ).closest( 'button, input, [role="menu"]' ) ) return;
        // A tap on the picture shows the controls, or hides them when they show.
        if( shown && ! focused ){
            if( timer.current ) clearTimeout( timer.current );
            setAwake( false );
        } else {
            wake();
        }
    };

    // A touch on the picture while the controls rest lands under them, since they take no pointer then, and waking
    // them put a button where the finger was: the click that ended the touch pressed it, play, mute or full screen
    // (Better Messages ticket 10500 sweep). So a click on the bar is a press of its own only when its touch began on it.
    const touchBegan = useRef<{ at : number, onBar : boolean } | null>( null );
    const onBar = ( target : EventTarget | null ) => target instanceof Element && target.closest( '.estream-bar' ) !== null;
    const onPointerDown = ( event : ReactPointerEvent ) => {
        if( event.pointerType !== 'mouse' ) touchBegan.current = { at: Date.now(), onBar: onBar( event.target ) };
    };
    const onClickCapture = ( event : ReactMouseEvent ) => {
        const began = touchBegan.current;
        touchBegan.current = null;
        if( ! began || began.onBar || Date.now() - began.at > 1000 || ! onBar( event.target ) ) return;
        event.stopPropagation();
        event.preventDefault();
    };

    return (
        <div
            className={ 'estream-stage' + ( picture ? ' estream-stage--picture' : '' ) + ( shown ? '' : ' estream-stage--idle' ) }
            tabIndex={ picture ? 0 : undefined }
            role="region"
            aria-label={ __( 'Live stream player', 'wordplus-stream' ) }
            onPointerMove={ ( e ) => { if( e.pointerType === 'mouse' ) wake(); } }
            onPointerLeave={ ( e ) => { if( e.pointerType === 'mouse' ) setAwake( false ); } }
            onPointerDown={ onPointerDown }
            onPointerUp={ onPointerUp }
            onClickCapture={ onClickCapture }
            onDoubleClick={ ( e ) => {
                if( picture && player.canFullscreen && ! ( e.target as HTMLElement ).closest( '.estream-bar, .estream-top' ) ) player.toggleFullscreen();
            } }
            onFocus={ () => setFocused( true ) }
            onBlur={ ( e ) => { if( ! e.currentTarget.contains( e.relatedTarget as Node | null ) ) setFocused( false ); } }
        >
            { cover && <div className="estream-cover" style={ { backgroundImage: 'url("' + cover + '")' } } aria-hidden="true" /> }
            { picture ? <TileInfoContext.Provider value={ props.tileInfo ?? null }><Tiles tiles={ state.tiles } /></TileInfoContext.Provider> : screen }
            <AudioTracks tiles={ state.tiles } />
            { player.appearance.floating !== false && <Floating /> }
            { logo && (
                <img
                    className={ 'estream-logo estream-logo--' + logo.position }
                    src={ logo.src }
                    alt=""
                    style={ { width: logo.width, opacity: logo.opacity } }
                    draggable={ false }
                />
            ) }
            <Top shown={ shown } bare={ props.bare } />
            { picture && ! props.bare && <Bar shown={ shown } /> }
            { player.countdown !== null && (
                <div className="estream-going" role="status" aria-live="assertive">
                    <span key={ player.countdown } className="estream-going__number">{ player.countdown }</span>
                    <span className="estream-going__label">{ __( 'Going live', 'wordplus-stream' ) }</span>
                </div>
            ) }
            <MutedByHost at={ state.mutedByHost } />
            { state.offline ? (
                <div className="estream-reconnecting" role="status"><Icon name="signal" />{ __( 'You are offline', 'wordplus-stream' ) }</div>
            ) : state.media === 'reconnecting' && (
                <div className="estream-reconnecting" role="status"><span className="estream-spinner estream-spinner--small" />{ __( 'Reconnecting…', 'wordplus-stream' ) }</div>
            ) }
            { picture && state.stalled && state.media === 'live' && ! state.offline && (
                <div className="estream-buffering" role="status">
                    <span className="estream-spinner" />
                    <span className="estream-buffering__text">{ _x( 'The picture stopped. Waiting for it.', 'a stalled video, for screen readers', 'wordplus-stream' ) }</span>
                </div>
            ) }
            { picture && <StatsPanel /> }
            { state.audioBlocked && state.tiles.some( ( t ) => t.audio.length > 0 ) && (
                <button type="button" className="estream-unmute" onClick={ () => { void client.startAudio(); player.setMuted( false ); } }>
                    <Icon name="volume-off" />
                    { __( 'Turn sound on', 'wordplus-stream' ) }
                </button>
            ) }
        </div>
    );
}
