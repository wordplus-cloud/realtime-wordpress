import {useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode} from "react";
import {__, _n, _nx, _x, sprintf} from "./i18n.ts";
import {CHAT_MAX, type Banned, type ChatMessage, type Person} from "@wordplus/realtime-client/streams";
import {useClient, useStream} from "./context.tsx";
import {useConfirm} from "./dialog.tsx";
import {Icon} from "./icons.tsx";
import {MenuButton, MenuChoice, MenuHeading, MenuItem} from "./menu.tsx";
import {pageUrl, usePlayer, useNow} from "./player.tsx";
import {sharedEmoji, sharedPickers, type SharedEmoji, type SharedPickers} from "./shared.ts";
import {EmojiField, type EmojiFieldHandle} from "./emoji-field.tsx";
import {clock, pageLocale} from "./format.ts";

// The chat beside the stream: messages with who sent them and when, links that open safely, the ones
// that mention you standing out; "New messages" when scrolled up; emoji, the length left near the
// limit, slow mode's wait; who is here; and for moderators, a menu on each message and person, and the chat's
// settings.

const SLOW_CHOICES = [ 0, 5, 10, 30, 60 ];
// How long a moderator mutes someone in the chat: a minute, ten, an hour, a day (the cloud's longest).
const TIMEOUTS = [ 60, 600, 3600, 86400 ];
// How often the list of who is here is asked for again while it shows.
const PEOPLE_EVERY_MS = 10_000;
// The length left shows once a message is this close to the limit.
const COUNT_FROM = 50;
// Following new messages while the reader is this close to the bottom.
const PINNED_PX = 40;

const EMOJI = [
    '😀', '😂', '🤣', '😊', '😍', '🥰', '😎', '🤩', '🤔', '😮', '😢', '😭', '😡', '🥳', '😴', '🙃',
    '👍', '👎', '👏', '🙌', '🙏', '💪', '👋', '🤝', '✌️', '🤞', '👀', '🫶',
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🔥', '✨', '🎉', '🎊', '💯', '✅', '❓', '❗', '⭐', '🚀', '🎵', '☕'
];

// Chat ids are Redis stream ids, "<ms>-<seq>".
function after( a : string, b : string ) : boolean {
    const [ am = 0, as = 0 ] = a.split( '-' ).map( Number );
    const [ bm = 0, bs = 0 ] = b.split( '-' ).map( Number );
    return am !== bm ? am > bm : as > bs;
}

const LINK = /\bhttps?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]}]/gi;

// A piece of text with its emoji as the site's set draws them, once its index has loaded (useEmojiImages).
function withEmoji( text : string, emoji : SharedEmoji | null, key : string ) : ReactNode[] {
    if( ! emoji || ! emoji.has( text ) ) return [ text ];

    return emoji.split( text ).map( ( part, i ) => typeof part === 'string'
        ? part
        : <img key={ key + '-' + i } className="estream-emoji-image" src={ part.src } alt={ part.emoji } draggable={ false } /> );
}

// The site's emoji set, once a text among these has an emoji and the set's index has loaded; null meanwhile, and
// where the site draws the device's own.
function useEmojiImages( texts : string[] ) : SharedEmoji | null {
    const emoji = sharedEmoji();
    const [ ready, setReady ] = useState( false );
    const wanted = emoji !== null && ! ready && texts.some( ( text ) => emoji.has( text ) );

    useEffect( () => {
        if( ! wanted || ! emoji ) return;
        let current = true;
        void emoji.ready().then( ( ok ) => {
            if( current && ok ) setReady( true );
        } );
        return () => {
            current = false;
        };
    }, [ wanted, emoji ] );

    return ready ? emoji : null;
}

// The message's text, its web addresses as links, and its emoji drawn in the site's set where it has one. Only http
// and https become links; the rest stays text.
export function linkify( text : string, emoji : SharedEmoji | null = null ) : ReactNode[] {
    const parts : ReactNode[] = [];
    let at = 0;

    for( const match of text.matchAll( LINK ) ){
        const start = match.index ?? 0;
        let href : string | null = null;
        try {
            const url = new URL( match[0] );
            if( url.protocol === 'http:' || url.protocol === 'https:' ) href = url.href;
        } catch ( e ) {
        }
        if( href === null ) continue;

        if( start > at ) parts.push( ...withEmoji( text.slice( at, start ), emoji, 't' + at ) );
        parts.push( <a key={ start } href={ href } target="_blank" rel="nofollow ugc noopener noreferrer">{ match[0] }</a> );
        at = start + match[0].length;
    }

    if( at < text.length ) parts.push( ...withEmoji( text.slice( at ), emoji, 't' + at ) );
    return parts;
}

const escapeRegExp = ( s : string ) => s.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );

// The login page, coming back to the stream after: WordPress's redirect_to, unless the page set one.
export function backTo( loginUrl : string | undefined, page : string ) : string | undefined {
    if( ! loginUrl ) return undefined;

    try {
        const url = new URL( loginUrl, window.location.href );
        if( ! url.searchParams.has( 'redirect_to' ) ) url.searchParams.set( 'redirect_to', page );
        return url.href;
    } catch ( e ) {
        return loginUrl;
    }
}

// Whether the text names you with an @.
export function mentions( text : string, name : string | undefined ) : boolean {
    if( ! name ) return false;
    return new RegExp( '(^|[^\\p{L}\\p{N}_])@' + escapeRegExp( name ) + '(?![\\p{L}\\p{N}_])', 'iu' ).test( text );
}

// Someone's face: their avatar, or without one, their initials on a colour of their own.
function Avatar( props : { who : { id : string, name : string, avatar : string | null } } ){
    const from = props.who;
    if( from.avatar ) return <img className="estream-message__avatar" src={ from.avatar } alt="" loading="lazy" />;

    let hash = 0;
    for( const c of from.id ) hash = ( hash * 31 + c.charCodeAt( 0 ) ) | 0;
    const letters = from.name.split( /\s+/ ).filter( Boolean ).slice( 0, 2 ).map( ( w ) => w[0]?.toUpperCase() ).join( '' );

    return (
        <span className="estream-message__avatar estream-message__avatar--initials" style={ { background: 'hsl(' + ( Math.abs( hash ) % 360 ) + ' 45% 46%)' } } aria-hidden="true">
            { letters || '?' }
        </span>
    );
}

function time( at : number ) : { short : string, full : string } {
    try {
        return {
            short: new Intl.DateTimeFormat( pageLocale(), { hour: 'numeric', minute: '2-digit' } ).format( at ),
            full: new Intl.DateTimeFormat( pageLocale(), { dateStyle: 'medium', timeStyle: 'medium' } ).format( at )
        };
    } catch ( e ) {
        const d = new Date( at );
        return { short: d.toLocaleTimeString(), full: d.toLocaleString() };
    }
}

function RoleBadge( props : { role : ChatMessage['from']['role'] } ){
    if( props.role === 'host' ) return <span className="estream-role estream-role--host">{ _x( 'Host', 'a role in chat', 'wordplus-stream' ) }</span>;
    if( props.role === 'guest' ) return <span className="estream-role estream-role--guest">{ _x( 'Guest', 'a role in chat', 'wordplus-stream' ) }</span>;
    return null;
}

function Message( props : { message : ChatMessage, canModerate : boolean, self : boolean, mentioned : boolean, pinned : boolean, emoji : SharedEmoji | null } ){
    const client = useClient();
    const confirm = useConfirm();
    const { message } = props;
    const when = time( message.at );
    const canBan = ! props.self && message.from.role !== 'host';

    return (
        <li className={ 'estream-message' + ( message.from.role === 'host' ? ' estream-message--host' : '' ) + ( props.mentioned ? ' estream-message--mention' : '' ) }>
            <Avatar who={ message.from } />
            <div className="estream-message__body">
                <span className="estream-message__name">{ message.from.name }</span>
                <RoleBadge role={ message.from.role } />
                <time className="estream-message__time" dateTime={ new Date( message.at ).toISOString() } data-estream-tip={ when.full }>{ when.short }</time>
                <span className="estream-message__text">{ linkify( message.text, props.emoji ) }</span>
            </div>
            { props.canModerate && (
                <MenuButton icon="more" label={ sprintf( _x( 'Moderate the message of %s', 'a name in chat', 'wordplus-stream' ), message.from.name ) } className="estream-message__actions" placement="down">
                    { ( close ) => (
                        <>
                            <MenuItem icon="pin" onSelect={ () => { close(); void ( props.pinned ? client.unpin() : client.pin( message.id ) ); } }>
                                { props.pinned ? __( 'Unpin message', 'wordplus-stream' ) : __( 'Pin message', 'wordplus-stream' ) }
                            </MenuItem>
                            <MenuItem icon="close" onSelect={ () => { close(); void client.deleteMessage( message.id ); } }>
                                { __( 'Delete message', 'wordplus-stream' ) }
                            </MenuItem>
                            { canBan && <ModerateItems who={ message.from } close={ close } confirm={ confirm } /> }
                        </>
                    ) }
                </MenuButton>
            ) }
        </li>
    );
}

function muteFor( seconds : number ) : string {
    if( seconds === 3600 ) return __( 'Mute for an hour', 'wordplus-stream' );
    if( seconds === 86400 ) return __( 'Mute for a day', 'wordplus-stream' );
    return sprintf( _nx( 'Mute for %d minute', 'Mute for %d minutes', seconds / 60, 'kept from writing in the chat', 'wordplus-stream' ), seconds / 60 );
}

// What a moderator does to someone, from a message of theirs or the list of who is here: mute them in the chat for a
// while or let them write again, put them out of the stream for now, or ban them from it. `done` follows each.
function ModerateItems( props : {
    who : { id : string, name : string, avatar : string | null },
    close : () => void,
    confirm : ReturnType<typeof useConfirm>,
    mutedUntil? : number | null,
    done? : () => void
} ){
    const client = useClient();
    const { who, close } = props;
    const then = ( work : Promise<unknown> ) => { void work.then( () => props.done?.() ); };

    return (
        <>
            { props.mutedUntil ? (
                <MenuItem icon="chat" onSelect={ () => { close(); then( client.liftTimeout( who.id ) ); } }>
                    { __( 'Unmute', 'wordplus-stream' ) }
                </MenuItem>
            ) : TIMEOUTS.map( ( seconds ) => (
                <MenuItem key={ seconds } icon="clock" onSelect={ () => { close(); then( client.timeOut( who.id, seconds ) ); } }>
                    { muteFor( seconds ) }
                </MenuItem>
            ) ) }
            <MenuItem icon="arrow-left" onSelect={ async () => {
                close();
                const yes = await props.confirm( {
                    title: sprintf( _x( 'Remove %s from this stream?', 'a name in chat', 'wordplus-stream' ), who.name ),
                    message: __( 'They leave the stream now. They can join it again.', 'wordplus-stream' ),
                    confirm: __( 'Remove', 'wordplus-stream' )
                } );
                if( yes ) then( client.kick( who.id ) );
            } }>
                { __( 'Remove from the stream', 'wordplus-stream' ) }
            </MenuItem>
            <MenuItem icon="alert" danger onSelect={ async () => {
                close();
                const yes = await props.confirm( {
                    title: sprintf( _x( 'Ban %s from this stream?', 'a name in chat', 'wordplus-stream' ), who.name ),
                    message: __( 'They leave the stream and cannot come back to it or write in its chat, until a moderator lets them back.', 'wordplus-stream' ),
                    confirm: __( 'Ban', 'wordplus-stream' ),
                    danger: true
                } );
                if( yes ) then( client.ban( who.id, { name: who.name, avatar: who.avatar } ) );
            } }>
                { __( 'Ban from this stream', 'wordplus-stream' ) }
            </MenuItem>
        </>
    );
}

// Who is here: the signed-in people watching or on the stream, with their names and avatars, and how many visitors
// besides; for a moderator, a menu on each, and the banned, each with a way back. Asked for again while it shows.
function People(){
    const client = useClient();
    const { you } = useStream();
    const confirm = useConfirm();
    const mod = Boolean( you?.mod );
    const [ people, setPeople ] = useState<Person[] | null>( null );
    const [ watching, setWatching ] = useState( 0 );
    const [ banned, setBanned ] = useState<Banned[]>( [] );
    const [ failed, setFailed ] = useState( false );

    const load = useCallback( async () => {
        const [ here, bans ] = await Promise.all( [ client.people(), mod ? client.bans() : Promise.resolve( null ) ] );
        if( here.ok ){
            setPeople( here.people ?? [] );
            setWatching( here.watching ?? 0 );
            setFailed( false );
        } else {
            setFailed( true );
        }
        if( bans?.ok ) setBanned( bans.bans ?? [] );
    }, [ client, mod ] );

    useEffect( () => {
        void load();
        const every = setInterval( () => void load(), PEOPLE_EVERY_MS );
        return () => clearInterval( every );
    }, [ load ] );

    const signedIn = ( people ?? [] ).filter( ( p ) => p.role === 'viewer' ).length;
    const visitors = Math.max( 0, watching - signedIn );

    return (
        <div className="estream-people">
            <h4 className="estream-people__heading">{ __( 'Who is here', 'wordplus-stream' ) }</h4>
            { people === null ? (
                <p className="estream-chat__note">{ failed ? __( 'Who is here cannot be shown right now', 'wordplus-stream' ) : __( 'Loading…', 'wordplus-stream' ) }</p>
            ) : (
                <ul className="estream-people__list" aria-label={ __( 'Who is here', 'wordplus-stream' ) }>
                    { people.map( ( person ) => (
                        <li key={ person.identity } className="estream-person">
                            <Avatar who={ { id: person.identity, name: person.name, avatar: person.avatar } } />
                            <span className="estream-person__name">{ person.name }</span>
                            <RoleBadge role={ person.role } />
                            { person.timeoutUntil ? <span className="estream-person__muted" data-estream-tip={ __( 'Muted in the chat', 'wordplus-stream' ) }><Icon name="clock" /></span> : null }
                            { mod && person.identity !== you?.identity && person.role !== 'host' && (
                                <MenuButton icon="more" label={ sprintf( _x( 'Moderate %s', 'a name in chat', 'wordplus-stream' ), person.name ) } className="estream-person__actions" placement="down" align="end">
                                    { ( close ) => (
                                        <ModerateItems who={ { id: person.identity, name: person.name, avatar: person.avatar } } mutedUntil={ person.timeoutUntil ?? null } close={ close } confirm={ confirm } done={ () => void load() } />
                                    ) }
                                </MenuButton>
                            ) }
                        </li>
                    ) ) }
                </ul>
            ) }
            { people !== null && visitors > 0 && (
                <p className="estream-people__more">
                    { people.length > 0
                        ? sprintf( _n( 'and %d visitor', 'and %d visitors', visitors, 'wordplus-stream' ), visitors )
                        : sprintf( _n( '%d visitor', '%d visitors', visitors, 'wordplus-stream' ), visitors ) }
                </p>
            ) }
            { mod && banned.length > 0 && (
                <>
                    <h4 className="estream-people__heading">{ __( 'Banned', 'wordplus-stream' ) }</h4>
                    <ul className="estream-people__list" aria-label={ __( 'Banned', 'wordplus-stream' ) }>
                        { banned.map( ( b ) => (
                            <li key={ b.identity } className="estream-person estream-person--banned">
                                <Avatar who={ { id: b.identity, name: b.name || '?', avatar: b.avatar } } />
                                <span className="estream-person__name">{ b.name || __( 'Someone', 'wordplus-stream' ) }</span>
                                <button type="button" className="estream-button estream-button--small" onClick={ () => void client.unban( b.identity ).then( () => load() ) }>
                                    { __( 'Let back', 'wordplus-stream' ) }
                                </button>
                            </li>
                        ) ) }
                    </ul>
                </>
            ) }
        </div>
    );
}

// Why a message wasn't sent.
function sendError( code : string ) : string {
    switch( code ){
        case 'slow':
            return __( 'Wait a moment before sending again', 'wordplus-stream' );
        case 'too_long':
            return __( 'That message is too long', 'wordplus-stream' );
        case 'ended':
            return __( 'The stream has ended', 'wordplus-stream' );
        case 'not_live':
            return __( 'The chat opens when the stream goes live', 'wordplus-stream' );
        case 'links':
            return __( 'Only moderators can post links here', 'wordplus-stream' );
        case 'banned':
            return __( 'You cannot write in this chat', 'wordplus-stream' );
        case 'timeout':
            return __( 'A moderator timed you out for a while', 'wordplus-stream' );
        default:
            return __( 'Something went wrong', 'wordplus-stream' );
    }
}

// The emoji: the picker every WordPlus plugin on the page shares, with search, the ones used lately and skin
// tones; or a few of the most used, where the page has no such picker or it can't load.
function EmojiPicker( props : { onPick : ( emoji : string ) => void } ){
    const [ failed, setFailed ] = useState( false );
    const pickers = failed ? null : sharedPickers();

    return pickers
        ? <SharedEmojiPicker pickers={ pickers } onPick={ props.onPick } onFail={ () => setFailed( true ) } />
        : <OwnEmojiPicker onPick={ props.onPick } />;
}

// Whether the chat is dark where the button is: the dark theme, or the visitor's system's with `auto`.
function darkAt( el : HTMLElement ) : boolean {
    const theme = el.closest( '.estream-theme' );
    if( theme?.classList.contains( 'estream-theme--dark' ) ) return true;
    return Boolean( theme?.classList.contains( 'estream-theme--auto' ) && globalThis.matchMedia?.( '(prefers-color-scheme: dark)' ).matches );
}

// The site's accent where the button is, as the picker takes its colours: `r, g, b`. The theme root's own style
// holds the site's, where the computed one isn't there (a test's DOM).
function accentAt( el : HTMLElement ) : string | null {
    const hex = ( getComputedStyle( el ).getPropertyValue( '--estream-accent' )
        || el.closest<HTMLElement>( '.estream-theme' )?.style.getPropertyValue( '--estream-accent' ) || '' ).trim();
    return /^#[0-9a-f]{6}$/i.test( hex ) ? [ 1, 3, 5 ].map( ( i ) => parseInt( hex.slice( i, i + 2 ), 16 ) ).join( ', ' ) : null;
}

function SharedEmojiPicker( props : { pickers : SharedPickers, onPick : ( emoji : string ) => void, onFail : () => void } ){
    const button = useRef<HTMLButtonElement>( null );
    const close = useRef<( () => void ) | null>( null );
    const mounted = useRef( true );
    const [ open, setOpen ] = useState( false );
    // The picker stays open for several emoji and keeps the function it opened with: the latest goes through here.
    const pick = useRef( props.onPick );
    pick.current = props.onPick;

    useEffect( () => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            close.current?.();
        };
    }, [] );

    const toggle = () => {
        if( close.current ){
            close.current();
            return;
        }
        const anchor = button.current;
        if( open || ! anchor ) return;

        setOpen( true );
        const accent = accentAt( anchor );
        props.pickers.open( {
            anchor,
            emoji: true,
            gifs: false,
            dark: darkAt( anchor ),
            ...( accent ? { style: { '--wplus-picker-accent': accent } } : {} ),
            onInsert: ( emoji ) => pick.current( emoji ),
            onClose: () => {
                close.current = null;
                if( mounted.current ) setOpen( false );
            }
        } ).then( ( done ) => {
            if( mounted.current ) close.current = done;
            else done();
        }, () => {
            if( ! mounted.current ) return;
            setOpen( false );
            props.onFail();
        } );
    };

    const label = __( 'Emoji', 'wordplus-stream' );

    return (
        <span className="estream-emoji">
            <button
                ref={ button }
                type="button"
                className="estream-icon-button"
                aria-label={ label }
                aria-haspopup="dialog"
                aria-expanded={ open }
                data-estream-tip={ open ? undefined : label }
                onClick={ toggle }
            >
                <Icon name="smile" />
            </button>
        </span>
    );
}

function OwnEmojiPicker( props : { onPick : ( emoji : string ) => void } ){
    return (
        <MenuButton icon="smile" label={ __( 'Emoji', 'wordplus-stream' ) } className="estream-emoji" placement="up" align="end">
            { ( close ) => (
                <div className="estream-emoji__grid">
                    { EMOJI.map( ( e ) => (
                        <button key={ e } type="button" role="menuitem" className="estream-emoji__item" onClick={ () => { props.onPick( e ); close(); } }>{ e }</button>
                    ) ) }
                </div>
            ) }
        </MenuButton>
    );
}

// For moderators: the chat's settings.
function ChatSettings(){
    const client = useClient();
    const confirm = useConfirm();
    const { slow } = useStream();

    return (
        <MenuButton icon="sliders" label={ __( 'Chat settings', 'wordplus-stream' ) } placement="down" align="end">
            { ( close ) => (
                <>
                    <MenuHeading>{ __( 'Slow mode', 'wordplus-stream' ) }</MenuHeading>
                    { SLOW_CHOICES.map( ( s ) => (
                        <MenuChoice key={ s } checked={ slow === s } onSelect={ () => { void client.setSlow( s ); close(); } }>
                            { s === 0 ? _x( 'Off', 'slow mode', 'wordplus-stream' ) : sprintf( _nx( 'One message every %d second', 'One message every %d seconds', s, 'slow mode: the wait between messages', 'wordplus-stream' ), s ) }
                        </MenuChoice>
                    ) ) }
                    <MenuItem icon="close" danger onSelect={ async () => {
                        close();
                        const yes = await confirm( {
                            title: __( 'Clear the chat for everyone?', 'wordplus-stream' ),
                            message: __( 'Every message goes, the pinned one too. This cannot be undone.', 'wordplus-stream' ),
                            confirm: __( 'Clear', 'wordplus-stream' ),
                            danger: true
                        } );
                        if( yes ) void client.clearChat();
                    } }>
                        { __( 'Clear the chat', 'wordplus-stream' ) }
                    </MenuItem>
                </>
            ) }
        </MenuButton>
    );
}

// The stream's chat: its Better Messages chat room where that is its chat, the light chat otherwise.
export function Chat( props : { loginUrl? : string } ){
    const player = usePlayer();

    return player.room ? <BetterMessagesRoom markup={ player.room } /> : <LightChat loginUrl={ props.loginUrl } />;
}

// A Better Messages chat room in the chat's place: Better Messages' own placeholder for it, put in an element React
// leaves alone. Better Messages' script mounts the room into any placeholder that lands on the page, and takes it down
// a second after it leaves; one moved in that second keeps its room.
export function BetterMessagesRoom( props : { markup : string } ){
    const box = useRef<HTMLDivElement>( null );

    useEffect( () => {
        const element = box.current;
        if( ! element ) return;
        element.innerHTML = props.markup;
        return () => { element.innerHTML = ''; };
    }, [ props.markup ] );

    return <div className="estream-bm-room" ref={ box } />;
}

// The cloud's own chat, kept light: for the moment, never saved.
function LightChat( props : { loginUrl? : string } ){
    const client = useClient();
    const state = useStream();
    const player = usePlayer();
    const [ text, setText ] = useState( '' );
    const [ error, setError ] = useState( '' );
    const [ sentAt, setSentAt ] = useState( 0 );
    const [ unseen, setUnseen ] = useState( 0 );
    const list = useRef<HTMLOListElement>( null );
    const input = useRef<HTMLInputElement>( null );
    const pinned = useRef( true );
    // The last message read: at the bottom, everything was.
    const seen = useRef<string | null>( null );

    const you = state.you;
    const canModerate = Boolean( you?.mod );
    const ended = state.stream?.state === 'ended';
    const live = state.stream?.state === 'live';
    // The chat while the stream isn't live, as its rules say for this person: open, closed, or from a cloud before
    // the rule, open before the start and closed after the end. A moderator's is always open.
    const offline = you?.offline ?? null;
    const closed = ! live && ( offline === 'closed' || ( offline === null && ended ) );
    const canWrite = you?.chat === 'write' && ! closed;
    // Who is here, beside the chat, for those the stream shows it to.
    const [ showPeople, setShowPeople ] = useState( false );
    const anonymous = Boolean( you?.identity.startsWith( 'a:' ) );
    const loginUrl = backTo( props.loginUrl ?? player.loginUrl, pageUrl( player.url ) );
    const placeholder = __( 'Say something…', 'wordplus-stream' );
    const emoji = useEmojiImages( state.pinned ? [ state.pinned.text, ...state.chat.map( ( m ) => m.text ) ] : state.chat.map( ( m ) => m.text ) );

    // The cloud takes one message a second from everyone but moderators, or one per slow mode's wait: Send
    // waits as long after the last, counting down only a slow mode's wait.
    const gapMs = canModerate ? 0 : Math.max( 1, state.slow ) * 1000;
    const now = useNow( 250, sentAt > 0 && Date.now() - sentAt < gapMs + 250 );
    const waitMs = sentAt > 0 ? Math.max( 0, gapMs - ( now - sentAt ) ) : 0;
    const wait = state.slow > 0 ? Math.ceil( waitMs / 1000 ) : 0;

    const toBottom = () => {
        const el = list.current;
        if( el ) el.scrollTop = el.scrollHeight;
        pinned.current = true;
        seen.current = state.chat[ state.chat.length - 1 ]?.id ?? null;
        setUnseen( 0 );
    };

    // Follow new messages while the reader is at the bottom; leave them be when they scrolled up, and count
    // what came since.
    useLayoutEffect( () => {
        if( pinned.current ){
            toBottom();
        } else {
            const last = seen.current;
            setUnseen( last === null ? state.chat.length : state.chat.filter( ( m ) => after( m.id, last ) ).length );
        }
    }, [ state.chat ] );

    useEffect( () => {
        if( ! error ) return;
        const timer = setTimeout( () => setError( '' ), 5000 );
        return () => clearTimeout( timer );
    }, [ error ] );

    // Sends the field's text: from the form, or Enter in the field that draws emoji in the site's set.
    const send = async () => {
        const message = text.trim();
        if( ! message || waitMs > 0 ) return;

        const reply = await client.sendChat( message );
        if( reply.ok ){
            setText( '' );
            setError( '' );
            setSentAt( Date.now() );
            toBottom();
        } else {
            setError( sendError( reply.error ) );
        }
    };

    const submit = ( event : FormEvent ) => {
        event.preventDefault();
        void send();
    };

    // The site's emoji set, where it has one: the field draws its emoji as the set's images (EmojiField).
    const emojiSet = sharedEmoji();
    const field = useRef<EmojiFieldHandle>( null );

    // An emoji at the caret, read from the field itself, since the shared picker stays open for several. One that
    // would go past the limit isn't half put in.
    const caret = useRef<number | null>( null );
    const insert = ( emoji : string ) => {
        if( field.current ){
            field.current.insert( emoji );
            return;
        }
        const el = input.current;
        const value = el?.value ?? text;
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? value.length;
        const next = value.slice( 0, start ) + emoji + value.slice( end );
        if( next.length > CHAT_MAX ) return;
        caret.current = start + emoji.length;
        setText( next );
    };

    // The caret after the emoji once the field shows it, as the new text puts it at the end; and the focus back in
    // the field, after a menu's closing gave it to its button.
    useLayoutEffect( () => {
        const el = input.current;
        if( caret.current === null || ! el ) return;
        el.focus();
        el.setSelectionRange( caret.current, caret.current );
        caret.current = null;
    }, [ text ] );

    const left = CHAT_MAX - text.length;

    // A moderator's timeout: no writing until it ends, counted down.
    const clockNow = useNow( 1000, state.timeoutUntil !== null );
    const timedOut = state.timeoutUntil !== null && clockNow < state.timeoutUntil;
    const slowly = sprintf( _nx( 'Slow mode: one message every %d second', 'Slow mode: one message every %d seconds', state.slow, 'how long each waits between messages', 'wordplus-stream' ), state.slow );

    return (
        <section className="estream-chat" aria-label={ __( 'Chat', 'wordplus-stream' ) }>
            <header className="estream-chat__header">
                <h3 className="estream-chat__title">{ __( 'Chat', 'wordplus-stream' ) }</h3>
                { state.slow > 0 && (
                    <span className="estream-chat__slow" tabIndex={ 0 } data-estream-tip={ slowly } aria-description={ slowly }>
                        <Icon name="clock" />
                        { sprintf( _x( '%ds', 'slow mode\'s wait, in seconds', 'wordplus-stream' ), state.slow ) }
                    </span>
                ) }
                <span className="estream-chat__spacer" />
                { you?.people && (
                    <button
                        type="button"
                        className="estream-icon-button estream-chat__people"
                        aria-pressed={ showPeople }
                        aria-label={ __( 'Who is here', 'wordplus-stream' ) }
                        data-estream-tip={ showPeople ? __( 'Back to the chat', 'wordplus-stream' ) : __( 'Who is here', 'wordplus-stream' ) }
                        onClick={ () => setShowPeople( ! showPeople ) }
                    >
                        <Icon name="people" />
                    </button>
                ) }
                { canModerate && <ChatSettings /> }
            </header>

            { state.pinned && (
                <div className="estream-chat__pinned" role="note" aria-label={ __( 'Pinned message', 'wordplus-stream' ) }>
                    <Icon name="pin" />
                    <div className="estream-chat__pinned-body">
                        <span className="estream-message__name">{ state.pinned.from.name }</span>
                        <span>{ linkify( state.pinned.text, emoji ) }</span>
                    </div>
                    { canModerate && (
                        <button type="button" className="estream-icon-button" aria-label={ __( 'Unpin message', 'wordplus-stream' ) } data-estream-tip={ __( 'Unpin message', 'wordplus-stream' ) } onClick={ () => void client.unpin() }>
                            <Icon name="close" />
                        </button>
                    ) }
                </div>
            ) }

            { showPeople ? <div className="estream-chat__body"><People /></div> : <div className="estream-chat__body">
                <ol className="estream-chat__list" ref={ list } aria-live="polite" aria-relevant="additions" onScroll={ ( e ) => {
                    const el = e.currentTarget;
                    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < PINNED_PX;
                    pinned.current = atBottom;
                    if( atBottom && unseen > 0 ){
                        seen.current = state.chat[ state.chat.length - 1 ]?.id ?? null;
                        setUnseen( 0 );
                    }
                } }>
                    { state.chat.length === 0 && (
                        <li className="estream-chat__empty">
                            <Icon name="chat" />
                            <span>{ __( 'No messages yet', 'wordplus-stream' ) }</span>
                            { canWrite && <span className="estream-chat__empty-sub">{ __( 'Say hello to get things going', 'wordplus-stream' ) }</span> }
                        </li>
                    ) }
                    { state.chat.map( ( m ) => (
                        <Message
                            key={ m.id }
                            message={ m }
                            canModerate={ canModerate }
                            self={ m.from.id === you?.identity }
                            mentioned={ m.from.id !== you?.identity && mentions( m.text, you?.name ) }
                            pinned={ state.pinned?.id === m.id }
                            emoji={ emoji }
                        />
                    ) ) }
                </ol>

                { unseen > 0 && (
                    <button type="button" className="estream-chat__unseen" onClick={ toBottom }>
                        <Icon name="arrow-down" />
                        { sprintf( _nx( '%d new message', '%d new messages', unseen, 'messages that came while scrolled up', 'wordplus-stream' ), unseen ) }
                    </button>
                ) }
            </div> }

            { ! state.chatConnected && state.status === 'ready' && ! ended && (
                <p className="estream-chat__note">{ __( 'Reconnecting to the chat…', 'wordplus-stream' ) }</p>
            ) }
            { error && <p className="estream-chat__note estream-chat__note--error" role="alert">{ error }</p> }

            { canWrite && timedOut ? (
                <p className="estream-chat__note estream-chat__note--error" role="status">
                    { sprintf( _x( 'A moderator timed you out. You can write again in %s', 'a time left, as 4:32', 'wordplus-stream' ), clock( state.timeoutUntil! - clockNow ) ) }
                </p>
            ) : canWrite ? (
                <form className="estream-chat__form" onSubmit={ submit }>
                    <div className="estream-chat__field">
                        { emojiSet ? (
                            <EmojiField ref={ field } value={ text } onChange={ setText } onSubmit={ () => void send() } placeholder={ placeholder } maxLength={ CHAT_MAX } emoji={ emojiSet } />
                        ) : (
                            <input
                                ref={ input }
                                className="estream-input"
                                value={ text }
                                maxLength={ CHAT_MAX }
                                placeholder={ placeholder }
                                onChange={ ( e ) => setText( e.target.value ) }
                                aria-label={ placeholder }
                            />
                        ) }
                        { player.appearance.emoji !== false && <EmojiPicker onPick={ insert } /> }
                    </div>
                    { left <= COUNT_FROM && <span className={ 'estream-chat__left' + ( left <= 10 ? ' estream-chat__left--low' : '' ) } aria-live="polite">{ left }</span> }
                    <button
                        type="submit"
                        className="estream-button estream-button--primary estream-chat__send"
                        disabled={ ! text.trim() || ! state.chatConnected || waitMs > 0 }
                        aria-label={ __( 'Send', 'wordplus-stream' ) }
                        data-estream-tip={ wait > 0 ? sprintf( _nx( 'You can send again in %d second', 'You can send again in %d seconds', wait, 'slow mode\'s wait', 'wordplus-stream' ), wait ) : __( 'Send', 'wordplus-stream' ) }
                    >
                        { wait > 0 ? <span className="estream-chat__wait">{ wait }</span> : <Icon name="send" /> }
                    </button>
                </form>
            ) : closed && you?.chat === 'write' ? (
                <p className="estream-chat__note">
                    { ended
                        ? player.texts?.chat_after || __( 'The chat closed when the stream ended', 'wordplus-stream' )
                        : player.texts?.chat_before || __( 'The chat opens when the stream goes live', 'wordplus-stream' ) }
                </p>
            ) : you && ! ended ? (
                anonymous && loginUrl ? (
                    <p className="estream-chat__note estream-chat__note--action">
                        <a className="estream-button estream-button--primary" href={ loginUrl }>{ __( 'Log in to chat', 'wordplus-stream' ) }</a>
                    </p>
                ) : (
                    <p className="estream-chat__note">{ __( 'Chat is read-only for you', 'wordplus-stream' ) }</p>
                )
            ) : null }
        </section>
    );
}
