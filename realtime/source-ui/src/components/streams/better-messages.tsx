import {useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject} from "react";
import type {MediaStats, VideoChoice} from "@wordplus/realtime-client/streams";
import type {Reaction} from "@wordplus/realtime-client/streams";
import {__, _nx, _x, sprintf} from "./i18n.ts";
import {useClient, useStream} from "./context.tsx";
import {themeClass, themeStyle} from "./appearance.ts";
import {offeredReactions} from "./reactions.ts";
import {EmojiGlyph} from "./emoji-glyph.tsx";
import {count, dateTime} from "./format.ts";
import {usePlayer, useNow, useShortcuts} from "./player.tsx";
import {writePref} from "./prefs.ts";
import {Screen} from "./screens.tsx";
import {sharedTooltips} from "./shared.ts";
import {Icon} from "./icons.tsx";
import {qualityChoices, shownQuality, Stage, type TileInfo} from "./stage.tsx";
import {deviceName, deviceOf, sendingHealth, sentText, Summary, useStudio, type StudioControls} from "./studio.tsx";
import {reactionName} from "./words.ts";
import FoldingDock from "../calls/folding-dock.tsx";

// A stream in a Better Messages conversation, its chat room. Better Messages keeps places in a
// conversation for another plugin to draw into, and lends it the call area as a stage (its thread slots); these parts
// draw there in Better Messages' own markup and classes, so the stream sits in the conversation as a group call does:
// a button among the header's (RoomButton), a banner over the messages while it is live (RoomBanner), and the stream
// itself in the call area beside the chat, its controls in the call's dock (RoomStage). The embed places them
// (embed's better-messages.ts) and says through RoomControls what the conversation lets them do.
//
// The dock is a call's own where it can be: it folds its tail into the call's More sheet as a call's does
// (calls/folding-dock.tsx), and shows and hides the conversation beside it as a call's Show chat / Hide chat does. The
// words are the stream's own.

export interface RoomControls {
    // Opens the stream in the conversation's call area, or, where the conversation has none (a mini chat), the
    // conversation where it has one.
    open() : void;
    // Closes it: while the stream stays live, it doesn't open again by itself.
    leave() : void;
    // Whether its viewers can't close it while it is live (the stream's setting): only its hosts may.
    locked() : boolean;
    // Keeps the conversation on screen while this window sends the stream, as a call does.
    hold( on : boolean ) : void;
    // Whether the stream shows in this conversation now, and when that changes.
    shown() : boolean;
    // The conversation beside the stage: whether it shows, or null where it can't be hidden, and showing or hiding
    // it, as a call's dock does. A change is told to `subscribe`'s listeners too.
    chat() : boolean | null;
    toggleChat() : void;
    subscribe( listener : () => void ) : () => void;
}

// Better Messages' icons, drawn as it draws them (its primitives/icon.tsx: 24 × 24, stroked 1.6 at 18px and heavier
// below), so a button here sits among its own unnoticed. A copy of the few the stage draws, not the whole registry,
// which would weigh on every page with a stream; a test keeps each the same as the registry's (`live`, `volume`,
// `volumeOff`, `stop` and `eye` are the stream's alone).
export const BM_ICONS = {
    live: 'M4.9 19.1C1 15.2 1 8.8 4.9 4.9|M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5|M10 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0|M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5|M19.1 4.9C23 8.8 23 15.1 19.1 19',
    video: 'm16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5|M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
    videoOff: 'M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.494A.5.5 0 0 1 22 7.435v8.13a.5.5 0 0 1-.752.43L16 13.5|M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2|m2 2 20 20',
    mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 11v1a7 7 0 0 1-14 0v-1M12 19v3M8 22h8',
    micOff: 'M12 19v3|M8 22h8|m2 2 20 20|M18.89 13.23A7.12 7.12 0 0 0 19 12v-2|M5 10v2a7 7 0 0 0 12 5|M15 9.34V5a3 3 0 0 0-5.68-1.33|M9 9v3a3 3 0 0 0 5.12 2.12',
    screenShare: 'M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3|M8 21h8|M12 17v4|m17 8 5-5|M17 3h5v5',
    screenShareOff: 'M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3|M8 21h8|M12 17v4|m22 3-5 5|m17 3 5 5',
    settings: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    maximize: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
    minimize: 'M5 14h6v6M19 10h-6V4M14 10l7-7M3 21l7-7',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|m16 17 5-5-5-5|M21 12H9',
    pip: 'M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4|M12 13h8a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z',
    reaction: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM8 14.5s1.5 2.5 4 2.5 4-2.5 4-2.5M9 10h.01M15 10h.01',
    volume: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z|M16 9a5 5 0 0 1 0 6|M19.364 18.364a9 9 0 0 0 0-12.728',
    volumeOff: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z|m22 9-6 6|m16 9 6 6',
    stop: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    x: 'M18 6 6 18M6 6l12 12',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|M12 6v6l4 2',
    eye: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    thread: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
    more: 'M12 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2z'
} as const;

type BmIconName = keyof typeof BM_ICONS;

function BmIcon( props : { name : BmIconName, size? : number } ){
    const size = props.size ?? 20;
    const stroke = Math.max( 1.6, Math.min( 2.9, ( 1.15 * 24 ) / size ) );

    return (
        <svg viewBox="0 0 24 24" width={ size } height={ size } fill="none" stroke="currentColor" strokeWidth={ stroke } strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            { BM_ICONS[ props.name ].split( '|' ).map( ( d, i ) => <path key={ i } d={ d } /> ) }
        </svg>
    );
}

// Better Messages' tooltips on what these parts draw: the WordPlus SDK's floater, in Better Messages' look. A ref for
// the element, which may come and go with the stream's state; `also` is told the element too. The floater finds labels
// below the element it watches, never on it, so it watches the element's place, Better Messages' slot, which is ours.
function useBmTooltips( also? : RefObject<HTMLElement | null> ) : ( element : HTMLElement | null ) => void {
    const stop = useRef<( () => void ) | null>( null );

    useEffect( () => () => {
        stop.current?.();
        stop.current = null;
    }, [] );

    return useCallback( ( element : HTMLElement | null ) => {
        if( also ) ( also as { current : HTMLElement | null } ).current = element;
        stop.current?.();
        stop.current = null;
        const tooltips = sharedTooltips();
        const place = element?.parentElement ?? element;
        if( place && tooltips ) stop.current = tooltips.watch( place, { attribute: 'data-bm-tip', focus: true, className: 'bm-tooltip' } );
    }, [ also ] );
}

function useShown( room : RoomControls ) : boolean {
    return useSyncExternalStore( room.subscribe, room.shown, room.shown );
}

function useChat( room : RoomControls ) : boolean | null {
    return useSyncExternalStore( room.subscribe, room.chat, room.chat );
}

const pressed = ( run : () => void ) => ( event : KeyboardEvent ) => {
    if( event.key !== 'Enter' && event.key !== ' ' ) return;
    event.preventDefault();
    run();
};

// The stream's button among the conversation header's: for whoever may watch it while it is live, and for its hosts
// always, who go live from it. Latched while the stream shows beside the chat.
export function RoomButton( props : { room : RoomControls } ){
    const state = useStream();
    const shown = useShown( props.room );
    const tips = useBmTooltips();

    const live = state.stream?.state === 'live';
    const host = state.you?.role === 'host';
    if( state.status !== 'ready' || ! state.stream || ( ! live && ! host ) ) return null;

    // A window sending the stream keeps it open: ending it is the stage's. A viewer of a stream that stays on screen
    // has nothing to press once it shows.
    const sending = state.sentHere || state.onStage;
    if( shown && ! host && live && props.room.locked() ) return null;
    const label = shown
        ? ( sending ? __( 'You are live in this conversation', 'wordplus-live-stream' ) : __( 'Close the live stream', 'wordplus-live-stream' ) )
        : ( live ? __( 'Watch the live stream', 'wordplus-live-stream' ) : __( 'Go live in this conversation', 'wordplus-live-stream' ) );
    const press = () => {
        if( ! shown ) props.room.open();
        else if( ! sending ) props.room.leave();
    };

    return (
        <span
            ref={ tips }
            role="button"
            tabIndex={ 0 }
            className={ 'bm-btn bm-icon-btn estream-bm-button' + ( live ? ' estream-bm-button--live' : '' ) }
            data-active={ shown ? 1 : undefined }
            aria-label={ label }
            aria-pressed={ shown }
            data-bm-tip={ label }
            onClick={ press }
            onKeyDown={ pressed( press ) }
        >
            <BmIcon name="live" size={ 18 } />
        </span>
    );
}

// Over the messages, as a group call's banner is: the stream while it is live and doesn't show here, with the way to
// it, and the time it starts while it is planned.
export function RoomBanner( props : { room : RoomControls } ){
    const state = useStream();
    const player = usePlayer();
    const shown = useShown( props.room );

    if( state.status !== 'ready' || ! state.stream ) return null;

    const live = state.stream.state === 'live';
    const host = state.you?.role === 'host';
    // The start the player counts down to: before the first session, and after one ended once its viewers are thanked.
    const at = player.scheduled ?? null;
    const planned = ! live && at !== null && at > Date.now();

    if( live && ! shown ){
        const counted = player.appearance.viewers !== false || host;

        return (
            <div className="bm-before-message-list estream-bm-banner">
                <div className="bm-group-call-in-progress estream-bm-banner__live">
                    <span className="bm-group-call-in-progress-info">
                        <span className="estream-bm-banner__badge">{ _x( 'Live', 'a stream on air', 'wordplus-live-stream' ) }</span>
                        <span className="estream-bm-banner__title">{ player.title || __( 'Live stream', 'wordplus-live-stream' ) }</span>
                        { counted && state.viewers > 0 && (
                            <span className="estream-bm-banner__count">
                                { sprintf( _nx( '%s watching', '%s watching', state.viewers, 'how many people watch', 'wordplus-live-stream' ), count( state.viewers ) ) }
                            </span>
                        ) }
                    </span>
                    <span className="bm-group-call-in-progress-join">
                        <span role="button" tabIndex={ 0 } className="bm-btn" onClick={ props.room.open } onKeyDown={ pressed( props.room.open ) }>
                            { __( 'Watch', 'wordplus-live-stream' ) }
                        </span>
                    </span>
                </div>
            </div>
        );
    }

    if( planned && ! shown ){
        return (
            <div className="bm-before-message-list estream-bm-banner">
                <div className="bm-group-call-in-progress estream-bm-banner__planned">
                    <span className="bm-group-call-in-progress-info">
                        <BmIcon name="clock" size={ 16 } />
                        <span className="estream-bm-banner__title">{ sprintf( _x( 'Live stream: starts %s', 'a date and time', 'wordplus-live-stream' ), dateTime( at! ) ) }</span>
                    </span>
                    { host && (
                        <span className="bm-group-call-in-progress-join">
                            <span role="button" tabIndex={ 0 } className="bm-btn" onClick={ props.room.open } onKeyDown={ pressed( props.room.open ) }>
                                { __( 'Set up', 'wordplus-live-stream' ) }
                            </span>
                        </span>
                    ) }
                </div>
            </div>
        );
    }

    return null;
}

// One control in the call's dock, as Better Messages draws its own: a span with the class that gives it its tone
// (bm-enable-video, off; bm-exit-room, danger; bm-answer, go), `data-active` when latched. Written as an element, not
// a component of its own, so the dock sees the span itself and folds it into its More sheet as a call's control,
// labelled by its aria-label.
interface DockButtonProps {
    tone : string;
    icon : BmIconName;
    label : string;
    onClick : () => void;
    active? : boolean;
    disabled? : boolean;
}

function dockButton( props : DockButtonProps ) : ReactElement {
    const run = () => { if( ! props.disabled ) props.onClick(); };

    return (
        <span
            role="button"
            tabIndex={ props.disabled ? -1 : 0 }
            className={ props.tone }
            data-active={ props.active ? 1 : undefined }
            aria-disabled={ props.disabled ? true : undefined }
            aria-pressed={ props.active }
            aria-label={ props.label }
            data-bm-tip={ props.label }
            onClick={ run }
            onKeyDown={ pressed( run ) }
        >
            <BmIcon name={ props.icon } />
        </span>
    );
}

// The dock's More button, once its tail folds: the call's, opening the call's sheet with the folded controls in it.
function moreButton( props : { open : boolean, toggle : () => void, sheet : ReactNode } ) : ReactElement {
    const label = __( 'More', 'wordplus-live-stream' );

    return (
        <span
            role="button"
            tabIndex={ 0 }
            className="bm-call-more"
            data-active={ props.open ? 1 : undefined }
            aria-haspopup="menu"
            aria-expanded={ props.open }
            aria-label={ label }
            data-bm-tip={ label }
            onClick={ props.toggle }
            onKeyDown={ pressed( props.toggle ) }
        >
            <BmIcon name="more" />
            { props.sheet }
        </span>
    );
}

// The conversation beside the stage, shown or hidden as a call's dock does it. Not in full screen, which the
// conversation is outside of, nor where the conversation can't be hidden.
function useChatButton( room : RoomControls ) : ReactElement | null {
    const shown = useChat( room );
    const player = usePlayer();
    if( shown === null || player.fullscreen ) return null;

    const label = shown ? __( 'Hide chat', 'wordplus-live-stream' ) : __( 'Show chat', 'wordplus-live-stream' );
    return dockButton( { tone: 'bm-toggle-chat', icon: 'thread', label, active: shown, onClick: room.toggleChat } );
}

function useSoundButton() : ReactElement {
    const client = useClient();
    const state = useStream();
    const player = usePlayer();
    const off = player.muted || state.audioBlocked;

    return dockButton( {
        tone: off ? 'bm-enable-mic estream-bm-sound' : 'bm-disable-mic estream-bm-sound',
        icon: off ? 'volumeOff' : 'volume',
        label: off ? __( 'Turn sound on', 'wordplus-live-stream' ) : __( 'Mute', 'wordplus-live-stream' ),
        onClick: () => {
            if( state.audioBlocked ) void client.startAudio();
            player.setMuted( ! off );
        }
    } );
}

function useFullscreenButton() : ReactElement | null {
    const player = usePlayer();
    if( ! player.canFullscreen ) return null;

    return player.fullscreen
        ? dockButton( { tone: 'bm-fs-disable', icon: 'minimize', label: __( 'Exit full screen', 'wordplus-live-stream' ), onClick: player.toggleFullscreen } )
        : dockButton( { tone: 'bm-fs-enable', icon: 'maximize', label: __( 'Full screen', 'wordplus-live-stream' ), onClick: player.toggleFullscreen } );
}

function usePipButton() : ReactElement | null {
    const player = usePlayer();
    if( ! player.canPip ) return null;

    const label = player.pip ? __( 'Exit picture-in-picture', 'wordplus-live-stream' ) : __( 'Picture-in-picture', 'wordplus-live-stream' );
    return dockButton( { tone: 'bm-pic-in-pic', icon: 'pip', label, active: player.pip, onClick: player.togglePip } );
}

// What a viewer sets, in the sheet Better Messages' calls open over the dock, as the player's own bar and settings
// have it: the volume, where the device lets a page set it, and the picture's quality.
function WatchSheet( props : { before? : ReactNode } ){
    const client = useClient();
    const state = useStream();
    const player = usePlayer();
    const volumeId = useId();
    const qualityId = useId();
    const level = player.muted ? 0 : player.volume;
    const choices = qualityChoices( client, state );
    const quality = ( q : VideoChoice ) => {
        client.setQuality( q );
        writePref( 'quality', q );
    };

    return (
        <div className="bm-call-settings estream-bm-watch">
            { props.before }
            { player.volumeSettable && (
                <div className="bm-call-setting estream-bm-volume">
                    <label htmlFor={ volumeId }>{ __( 'Volume', 'wordplus-live-stream' ) }</label>
                    <input
                        id={ volumeId }
                        type="range"
                        min={ 0 }
                        max={ 1 }
                        step={ 0.05 }
                        value={ level }
                        aria-valuetext={ Math.round( level * 100 ) + '%' }
                        style={ { '--estream-level': level * 100 + '%' } as CSSProperties }
                        onChange={ ( e ) => {
                            // Moving it is what a browser that blocked sound waits for.
                            if( state.audioBlocked ) void client.startAudio();
                            player.setVolume( Number( e.target.value ) );
                        } }
                    />
                </div>
            ) }
            <div className="bm-call-setting bm-switch-device">
                <label htmlFor={ qualityId }>{ __( 'Quality', 'wordplus-live-stream' ) }</label>
                <div className="bm-switch-device-select-wrap">
                    <select id={ qualityId } value={ shownQuality( state.quality, choices ) } onChange={ ( e ) => quality( e.target.value as VideoChoice ) }>
                        <option value="auto">
                            { player.height > 0
                                ? sprintf( _x( 'Auto (%dp)', 'picture quality, then the height the picture arrives at, as in 720p', 'wordplus-live-stream' ), player.height )
                                : _x( 'Auto', 'picture quality', 'wordplus-live-stream' ) }
                        </option>
                        { choices.map( ( c ) => <option key={ c.quality } value={ c.quality }>{ c.label }</option> ) }
                    </select>
                </div>
            </div>
            <button type="button" className="bm-call-setting estream-bm-stats" aria-pressed={ player.statsOpen } onClick={ player.toggleStats }>
                { player.statsOpen ? _x( 'Hide statistics', 'of the player', 'wordplus-live-stream' ) : __( 'Statistics', 'wordplus-live-stream' ) }
            </button>
        </div>
    );
}

// The reactions the site offers, in a sheet over the dock: each rises over the picture for everyone.
function ReactionSheet( props : { kinds : Reaction[] } ){
    const client = useClient();

    return (
        <div className="bm-call-settings estream-bm-reactions" role="group" aria-label={ __( 'Reactions', 'wordplus-live-stream' ) }>
            { props.kinds.map( ( kind ) => (
                <span
                    key={ kind }
                    role="button"
                    tabIndex={ 0 }
                    className="estream-bm-reaction"
                    aria-label={ reactionName( kind ) }
                    data-bm-tip={ reactionName( kind ) }
                    onClick={ () => client.react( kind ) }
                    onKeyDown={ pressed( () => client.react( kind ) ) }
                >
                    <EmojiGlyph emoji={ kind } />
                </span>
            ) ) }
        </div>
    );
}

// Over each tile, as over a call's: the name at the bottom start once there is more than one to tell apart, and a red
// microphone at the bottom end while it is off.
const bmTileInfo : TileInfo = ( tile, named ) => (
    <>
        { named && (
            <div className="bm-group-call-input-video-inner-info">
                <span className="bm-caller-info"><span className="bm-info-name"><span className="bm-caller-name">{ tile.name }</span></span></span>
            </div>
        ) }
        { tile.micMuted && (
            <span className="bm-caller-status">
                <span className="bm-mic-disabled" role="img" aria-label={ __( 'Microphone off', 'wordplus-live-stream' ) } data-bm-tip={ __( 'Microphone off', 'wordplus-live-stream' ) }>
                    <BmIcon name="micOff" size={ 14 } />
                </span>
            </span>
        ) }
    </>
);

type SheetName = 'settings' | 'reactions';

// The one sheet open over the dock, if any: its button opens it and closes it again.
function useSheet() : [ SheetName | null, ( which : SheetName ) => void ]{
    const [ sheet, setSheet ] = useState<SheetName | null>( null );
    const toggle = useCallback( ( which : SheetName ) => setSheet( ( open ) => open === which ? null : which ), [] );
    return [ sheet, toggle ];
}

function deviceButtons( camera : boolean, microphone : boolean, toggle : ( device : 'camera' | 'microphone' ) => void ) : ReactElement {
    return (
        <>
            { camera
                ? dockButton( { tone: 'bm-disable-video', icon: 'video', label: __( 'Turn camera off', 'wordplus-live-stream' ), onClick: () => toggle( 'camera' ) } )
                : dockButton( { tone: 'bm-enable-video', icon: 'videoOff', label: __( 'Turn camera on', 'wordplus-live-stream' ), onClick: () => toggle( 'camera' ) } ) }
            { microphone
                ? dockButton( { tone: 'bm-disable-mic', icon: 'mic', label: __( 'Turn microphone off', 'wordplus-live-stream' ), onClick: () => toggle( 'microphone' ) } )
                : dockButton( { tone: 'bm-enable-mic', icon: 'micOff', label: __( 'Turn microphone on', 'wordplus-live-stream' ), onClick: () => toggle( 'microphone' ) } ) }
        </>
    );
}

// The devices, in the sheet Better Messages' calls open over the dock, and while live the stream's statistics.
function DeviceSheet( props : { studio : StudioControls } ){
    const { devices, camera, microphone, choose, player } = props.studio;
    const speakers = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
    const field = ( label : string, kind : 'camera' | 'microphone' | 'speaker', list : typeof devices.cameras, value : string, onChange : ( id : string ) => void ) => (
        <div className="bm-call-setting bm-switch-device">
            <label>{ label }</label>
            <div className="bm-switch-device-select-wrap">
                <select value={ value } aria-label={ label } onChange={ ( e ) => onChange( e.target.value ) }>
                    { value === '' && <option value="">{ __( 'Default', 'wordplus-live-stream' ) }</option> }
                    { list.map( ( d, i ) => <option key={ d.id } value={ d.id }>{ deviceName( d, i, kind ) }</option> ) }
                </select>
            </div>
        </div>
    );

    return (
        <div className="bm-call-settings">
            { props.studio.live && <Statistics stats={ props.studio.sending } /> }
            { field( __( 'Camera', 'wordplus-live-stream' ), 'camera', devices.cameras, deviceOf( camera ), ( id ) => choose( 'camera', id ) ) }
            { field( __( 'Microphone', 'wordplus-live-stream' ), 'microphone', devices.microphones, deviceOf( microphone ), ( id ) => choose( 'microphone', id ) ) }
            { speakers && field( __( 'Speakers', 'wordplus-live-stream' ), 'speaker', devices.speakers, player.speaker, player.setSpeaker ) }
        </div>
    );
}

// How many watch, beside where Better Messages' calls show the connection: for everyone where the site shows the
// count, and for the stream's hosts with the most at once since going live beside it, as the cloud keeps it
// (it was only in the tooltip, and only while above the count).
function Watching(){
    const state = useStream();
    const player = usePlayer();
    const host = state.you?.role === 'host';
    const counted = player.appearance.viewers !== false || host;

    if( state.stream?.state !== 'live' || ! counted ) return null;

    const peak = Math.max( state.tally.peak, state.viewers );
    const watching = sprintf( _nx( '%s watching', '%s watching', state.viewers, 'how many people watch', 'wordplus-live-stream' ), count( state.viewers ) );
    const text = host ? watching + ', ' + sprintf( _x( 'peak %s', 'the most watching at once', 'wordplus-live-stream' ), count( peak ) ) : watching;

    return (
        <span className="estream-bm-watching" role="img" aria-label={ text } data-bm-tip={ text }>
            <BmIcon name="eye" size={ 16 } />
            <span>{ count( state.viewers ) }</span>
            { host && (
                <span className="estream-bm-watching__peak">
                    <Icon name="peak" />
                    { count( peak ) }
                </span>
            ) }
        </span>
    );
}

// How the host's picture goes out, as a call's connection: a dot, green or amber, and what it is, which a narrow stage
// keeps to the dot (Better Messages' .bm-connection-quality).
function Sending( props : { stats : MediaStats | null } ){
    const state = useStream();
    const now = useNow( 1000 );
    const health = sendingHealth( props.stats, state, now );
    if( ! health ) return null;

    const word = health.kind === 'good' ? __( 'Good connection', 'wordplus-live-stream' )
        : health.kind === 'cpu' ? __( 'Computer busy', 'wordplus-live-stream' )
        : __( 'Weak connection', 'wordplus-live-stream' );

    return (
        <span className={ 'bm-connection-quality bm-state-connected bm-quality-' + ( health.kind === 'good' ? 'good' : 'poor' ) } role="status" aria-label={ health.text } data-bm-tip={ health.text }>
            <span>{ word }</span>
        </span>
    );
}

// What the host's stream does while live, as the admin studio's numbers say it, one figure a line with its name: what
// goes out (the quality chosen while nobody has it on screen, nothing of a pause: sentText), the peak and the
// reactions; across the settings sheet, as Better Messages' calls keep their statistics there.
function Statistics( props : { stats : MediaStats | null } ){
    const state = useStream();
    const { stats } = props;
    const { tally } = state;

    return (
        <div className="bm-call-setting estream-bm-statistics">
            <label>{ __( 'Statistics', 'wordplus-live-stream' ) }</label>
            <dl className="estream-bm-figures">
                { stats && ( stats.height > 0 || stats.paused ) && (
                    <div>
                        <dt>{ __( 'Video', 'wordplus-live-stream' ) }</dt>
                        <dd>{ sentText( stats, state ) }</dd>
                    </div>
                ) }
                <div>
                    <dt>{ _nx( 'Watching at the peak', 'Watching at the peak', tally.peak, 'the most viewers at once', 'wordplus-live-stream' ) }</dt>
                    <dd>{ count( tally.peak ) }</dd>
                </div>
                <div>
                    <dt>{ _nx( 'Reaction', 'Reactions', tally.reactions, 'reactions during the stream', 'wordplus-live-stream' ) }</dt>
                    <dd>{ count( tally.reactions ) }</dd>
                </div>
            </dl>
        </div>
    );
}

// The stage's frame: the picture, a notice over it, and the dock, in the call's markup, with how many watch (and
// `status`, beside it) where a call shows its connection. The frame is what goes full screen, its dock with it. The
// dock folds its tail into More as a call's does, keeping its last `pinned` controls in the row (leaving and ending).
function StageFrame( props : { studio? : boolean, screen? : ReactNode, notice? : ReactNode, sheet? : ReactNode, status? : ReactNode, pinned? : number, children : ReactNode } ){
    const player = usePlayer();
    const shortcuts = useShortcuts( player );
    const root = useBmTooltips( player.root );

    return (
        <div
            ref={ root }
            className={ themeClass( { ...player.appearance, theme: 'dark' }, player.videoShape ) + ' estream-bm-stage' + ( player.fullscreen ? ' estream-theme--full' : '' ) }
            style={ themeStyle( { ...player.appearance, theme: 'dark' } ) }
            onKeyDown={ shortcuts }
        >
            <div className="bm-group-call-container bm-call-container">
                <div className="estream-bm-stage__picture">
                    <Stage bare studio={ props.studio } screen={ props.screen } tileInfo={ bmTileInfo } />
                </div>
                { props.notice && <div className="bm-group-call-status" role="status">{ props.notice }</div> }
                <div className="bm-group-call-controls-v2">
                    { props.sheet }
                    <div className="bm-connection-control estream-bm-status">
                        { props.status }
                        <Watching />
                    </div>
                    <FoldingDock className="bm-group-call-controls-buttons" pinned={ props.pinned ?? 0 } more={ moreButton }>{ props.children }</FoldingDock>
                </div>
            </div>
        </div>
    );
}

function leaveButton( room : RoomControls ) : ReactElement {
    return dockButton( { tone: 'bm-exit-room', icon: 'logout', label: __( 'Close the live stream', 'wordplus-live-stream' ), onClick: room.leave } );
}

// A viewer's stage: the stream with what the player's bar gives them, its sound and volume, its quality, reactions,
// picture-in-picture and full screen, and closing it unless it stays on screen while live (RoomControls.locked); and on
// stage, where the stream's page brought them, their camera and microphone. The conversation beside it shows and
// hides from the dock first, as from a call's.
function ViewerStage( props : { room : RoomControls } ){
    const client = useClient();
    const state = useStream();
    const player = usePlayer();
    const [ sheet, toggle ] = useSheet();
    const chat = useChatButton( props.room );
    const sound = useSoundButton();
    const pip = usePipButton();
    const fullscreen = useFullscreenButton();
    const live = state.stream?.state === 'live';
    const remote = state.tiles.some( ( t ) => ! t.local );
    const reactions = live && state.reactionsOn ? offeredReactions( player.appearance ) : [];

    if( state.onStage ){
        return (
            <StageFrame pinned={ 1 }>
                { chat }
                { deviceButtons( state.devices.camera, state.devices.microphone, ( device ) => void ( device === 'camera' ? client.setCamera( ! state.devices.camera ) : client.setMicrophone( ! state.devices.microphone ) ) ) }
                { fullscreen }
                { dockButton( { tone: 'bm-exit-room', icon: 'logout', label: __( 'Leave the stage', 'wordplus-live-stream' ), onClick: () => void client.leaveStage() } ) }
            </StageFrame>
        );
    }

    const leaving = ! ( live && props.room.locked() );

    return (
        <StageFrame pinned={ leaving ? 1 : 0 } sheet={ sheet === 'settings' && remote ? <WatchSheet /> : sheet === 'reactions' && reactions.length > 0 ? <ReactionSheet kinds={ reactions } /> : null }>
            { chat }
            { remote && dockButton( { tone: 'bm-configure-call', icon: 'settings', label: __( 'Settings', 'wordplus-live-stream' ), active: sheet === 'settings', onClick: () => toggle( 'settings' ) } ) }
            { remote && sound }
            { reactions.length > 0 && dockButton( { tone: 'estream-bm-react', icon: 'reaction', label: __( 'Reactions', 'wordplus-live-stream' ), active: sheet === 'reactions', onClick: () => toggle( 'reactions' ) } ) }
            { pip }
            { fullscreen }
            { leaving && leaveButton( props.room ) }
        </StageFrame>
    );
}

// A host's stage before going live: what to do, in place of the studio's choices under its picture. `ended`: right
// after a stream this stage took live.
function HostIdle( props : { ended : boolean } ){
    const player = usePlayer();
    // The next session, after one that ended too.
    const at = player.next?.at ?? null;
    const { ended } = props;

    return (
        <Screen icon="broadcast" title={ ended ? __( 'Your stream has ended', 'wordplus-live-stream' ) : __( 'Ready when you are', 'wordplus-live-stream' ) }>
            { ended && <Summary messages={ false } /> }
            { at !== null && at > Date.now() && <span className="estream-screen__sub">{ sprintf( _x( 'Planned for %s', 'a date and time', 'wordplus-live-stream' ), dateTime( at ) ) }</span> }
            <span className="estream-screen__sub">{ __( 'Turn on your camera or microphone below. Only you see the preview until you go live.', 'wordplus-live-stream' ) }</span>
            { player.studioUrl && (
                <span className="estream-screen__sub">
                    <a className="estream-bm-stage__studio" href={ player.studioUrl }>{ __( 'Stream from OBS in the Studio', 'wordplus-live-stream' ) }</a>
                </span>
            ) }
        </Screen>
    );
}

// A host's stage: their preview and going live, sending, and ending; or the stream as everyone sees it while it goes
// out from another window of theirs or from OBS.
function HostStage( props : { room : RoomControls } ){
    const studio = useStudio();
    const { client, state, player, live, ended, summary, previewing, fromEncoder, encoderReady, encoderOver, busy, error, toggle, goLive, cancelCountdown, end, elsewhere, sending } = studio;
    const [ sheet, toggleSheet ] = useSheet();
    const chat = useChatButton( props.room );
    const sound = useSoundButton();
    const pip = usePipButton();
    const fullscreen = useFullscreenButton();
    // This window sends: its camera and microphone, or its screen.
    const sends = ! fromEncoder && ! elsewhere;
    const countingDown = player.countdown !== null;
    const idle = ! live && ! previewing && ! fromEncoder;
    const remote = state.tiles.some( ( t ) => ! t.local );

    const notice = error
        ? error
        : elsewhere ? __( 'You are live from another window', 'wordplus-live-stream' )
        : ! live && previewing ? __( 'Preview: only you can see this', 'wordplus-live-stream' )
        : null;
    const ready = ( previewing && ! fromEncoder ) || ( fromEncoder && encoderReady && ! encoderOver );
    const leaving = ! ( live && ( state.sentHere || previewing ) && sends );

    return (
        <StageFrame
            studio
            screen={ idle ? <HostIdle ended={ ended && summary } /> : undefined }
            notice={ notice }
            status={ live && ! elsewhere ? <Sending stats={ sending } /> : null }
            sheet={ sheet !== 'settings' ? null
                : sends ? <DeviceSheet studio={ studio } />
                : remote ? <WatchSheet before={ live && fromEncoder ? <Statistics stats={ sending } /> : null } />
                : null }
            pinned={ leaving ? 2 : 1 }
        >
            { chat }
            { sends && (
                <>
                    { dockButton( { tone: 'bm-configure-call', icon: 'settings', label: __( 'Settings', 'wordplus-live-stream' ), active: sheet === 'settings', onClick: () => toggleSheet( 'settings' ) } ) }
                    { deviceButtons( state.devices.camera, state.devices.microphone, toggle ) }
                    { /* Before going live too, and only where the browser can share a screen (no phone's can). */ }
                    { state.canShareScreen && dockButton( {
                        tone: 'bm-switch-share-screen',
                        icon: state.screenSharing ? 'screenShareOff' : 'screenShare',
                        label: state.screenSharing ? __( 'Stop sharing', 'wordplus-live-stream' ) : __( 'Share screen', 'wordplus-live-stream' ),
                        active: state.screenSharing,
                        onClick: () => void client.setScreenShare( ! state.screenSharing )
                    } ) }
                </>
            ) }
            { ! sends && remote && (
                <>
                    { dockButton( { tone: 'bm-configure-call', icon: 'settings', label: __( 'Settings', 'wordplus-live-stream' ), active: sheet === 'settings', onClick: () => toggleSheet( 'settings' ) } ) }
                    { sound }
                    { pip }
                </>
            ) }
            { fullscreen }
            { live ? dockButton( {
                tone: 'bm-exit-room estream-bm-end', icon: 'stop', label: __( 'End stream', 'wordplus-live-stream' ), disabled: busy, onClick: () => void end()
            } ) : countingDown ? dockButton( {
                tone: 'bm-exit-room', icon: 'x', label: __( 'Cancel', 'wordplus-live-stream' ), onClick: cancelCountdown
            } ) : dockButton( {
                tone: 'bm-answer estream-bm-go',
                icon: 'live',
                label: ready ? __( 'Go live', 'wordplus-live-stream' )
                    : state.canShareScreen ? __( 'Turn on your camera or microphone, or share your screen, to go live', 'wordplus-live-stream' )
                    : __( 'Turn on your camera or microphone to go live', 'wordplus-live-stream' ),
                disabled: busy || state.status !== 'ready' || ! ready,
                onClick: goLive
            } ) }
            { leaving && leaveButton( props.room ) }
        </StageFrame>
    );
}

// The stream in the conversation's call area: a host's own stage, or a viewer's.
export function RoomStage( props : { room : RoomControls } ){
    const state = useStream();
    const { room } = props;
    // A window that sends keeps the conversation on screen, as a call does.
    const holding = state.sentHere || state.onStage;

    useEffect( () => {
        room.hold( holding );
    }, [ room, holding ] );
    useEffect( () => () => room.hold( false ), [ room ] );

    return state.you?.role === 'host' ? <HostStage room={ room } /> : <ViewerStage room={ room } />;
}
