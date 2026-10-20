// Easy Stream protocol, version 1: what a site signs, what the cloud answers, and
// what travels over the chat socket. Types and limits only, so the browser client and the backend
// helpers share them without pulling in each other's code.

export const GRANT_AUDIENCE = 'easy-stream';
export const GRANT_KEY_LABEL = 'easy-stream grant v1';
export const GRANT_MAX_LIFETIME_S = 7 * 24 * 3600;

export const STREAM_ID = /^[A-Za-z0-9-]{1,64}$/;
export const USER_ID = /^[\w.@-]{1,64}$/;

export const JOIN_PATH = '/easy-stream/v1/join';
// Where an encoder (OBS) posts its offer over WHIP, with the stream's ingest key as its bearer token, and
// the identity it has in the stream's room.
export const WHIP_PATH = '/easy-stream/v1/whip';
export const INGEST_IDENTITY = 'ingest';
// A site's live streams, once (`?site=`), with how many watch each: a Live now list's, and a page's that follows a stream
// without watching it.
export const LIVE_PATH = '/easy-stream/v1/live';
// A site's server turns a stream's reactions off or on, with a host's grant for it: `{ grant, on }`.
export const REACTIONS_PATH = '/easy-stream/v1/reactions';
export const CHAT_MAX = 500;
export const SLOW_MAX_S = 300;
// A reaction is one emoji, which a site chooses for its streams: these where it chooses none. The cloud takes any one
// emoji, and the names players sent before (REACTION_EMOJI's) as their emoji. A player offers the site's and shows no
// other.
export const REACTIONS = [ '❤️', '👏', '😂', '😮', '🔥' ] as const;
export const REACTION_EMOJI : Readonly<Record<string, string>> = { heart: '❤️', clap: '👏', laugh: '😂', wow: '😮', fire: '🔥' };
// The largest picture a viewer may choose, by its short side: Full HD comes only on auto, to a player that needs it.
export const CHOSEN_MAX_SIDE = 720;

export type Role = 'host' | 'guest' | 'viewer';
export type Source = 'camera' | 'microphone' | 'screen';
export type Quality = '720p' | '1080p';
export type ChatRight = 'write' | 'read';
export type Reaction = string;

// The claims a site signs. The order here is the order signers write them in, so the same claims
// give the same token in every language (vectors/grants.json).
export interface GrantClaims {
    iss : string;
    aud? : typeof GRANT_AUDIENCE;
    str : string;
    role : Role;
    sub? : string;
    name? : string;
    avatar? : string;
    chat? : ChatRight;
    mod? : boolean;
    src? : Source[];
    // The site's own cap on the picture this person sends. Without it, the site's plan sets the best (the join's
    // `you.quality`); the WordPress plugin sends none, its hosts choosing in the studio.
    q? : Quality;
    // false: the stream takes no guests. This person neither raises a hand nor comes on stage, and a
    // host invites nobody.
    stage? : boolean;
    // The stream's chat rules, which every grant for it carries as `stage`:
    // - `offline`: the chat while the stream isn't live, before it starts and after it ends ('open' or 'closed';
    //   without it, open before the start and closed after the end); its moderators always write;
    // - `links`: false takes links only from its moderators;
    // - `fresh`: a host's going live empties the chat;
    // - `people`: who sees who is here ('mods', the default, or 'all').
    offline? : 'open' | 'closed';
    links? : boolean;
    fresh? : boolean;
    people? : 'all' | 'mods';
    // false: the stream takes no reactions, as its site has it set. The stream's own state, which the site changes the
    // moment its setting does (REACTIONS_PATH), rules once there is one.
    reactions? : boolean;
    // true: the site hears this person's watch at its webhook, as they start and stop watching the stream live
    // (stream.joined and stream.left). Only for someone signed in (`sub`). An app hears them without it.
    track? : boolean;
    org? : string[];
    iat? : number;
    exp : number;
}

export const CLAIM_ORDER = [ 'iss', 'aud', 'str', 'role', 'sub', 'name', 'avatar', 'chat', 'mod', 'src', 'q', 'stage', 'offline', 'links', 'fresh', 'people', 'reactions', 'track', 'org', 'iat', 'exp' ] as const;

export type StreamPhase = 'idle' | 'live' | 'ended';

export interface StreamState {
    id : string;
    state : StreamPhase;
    started_at : number | null;
    ended_at : number | null;
}

// A stream in a site's live list (LIVE_PATH): `{ ok: true, live: LiveStream[] }`.
export interface LiveStream {
    id : string;
    started_at : number;
    viewers : number;
}

export interface You {
    identity : string;
    role : Role;
    name : string;
    chat : ChatRight;
    mod : boolean;
    // Whether this person may come on stage (or for a host, invite): the grant's `stage`. Absent from
    // a cloud that predates it, which means yes.
    stage? : boolean;
    src? : Source[];
    // The best picture this person may send: 1080p, on every plan that streams, or 720p where the grant's `q`
    // caps it. Only the join says it, not the socket's hello.
    quality? : Quality;
    // The chat's rules for this person, from the socket's hello; absent from a cloud before them. `offline`: the chat
    // while the stream isn't live ('open', 'closed', or null: open before the start, closed after the end; always
    // 'open' for a moderator). `links`: whether their links are taken. `people`: whether they may see who is here.
    offline? : 'open' | 'closed' | null;
    links? : boolean;
    people? : boolean;
}

// Someone signed in and watching or on the stream (`people`). `timeoutUntil`: for moderators, until when they may not write.
export interface Person {
    identity : string;
    name : string;
    avatar : string | null;
    role : Role;
    timeoutUntil? : number;
}

// Someone banned from the stream (`bans`), by who they were when banned; `name` '' and `at` null for one banned
// before names were kept.
export interface Banned {
    identity : string;
    name : string;
    avatar : string | null;
    at : number | null;
}

export interface MediaSeat {
    url : string;
    token : string;
}

export interface JoinReply {
    ok : true;
    stream : StreamState;
    you : You;
    media : MediaSeat;
    // The most viewers the stream's room takes (the beta's 50); absent from a cloud before it.
    audience? : number;
    // `url`: the socket's origin, the join's own when absent. `multi`: the socket can carry every stream of the
    // browser, each a `watch`; absent from a cloud before it.
    chat : { url? : string, path : string, namespace : string, token : string, multi? : boolean };
    // For a host, what the site has left to stream with, as WordPlus Cloud last said; null while it hasn't. Absent from
    // a cloud before 2026-10-12, and for anyone else.
    usage? : Usage | null;
}

// What the site's account has left to stream with, in WordPlus Cloud's credits (a credit is a minute of a stream's
// viewer above the site's unmetered ones; one balance an account, its plan's each UTC month, then bought credits, then
// up to a month's allowance borrowed), from the join (a host's) and the check.
export interface Usage {
    // As WordPlus Cloud last said; null where it said nothing: the plan's credits left this month × 60 (0 while
    // borrowing), the bought credits, and how far into next month's allowance the account has borrowed × 60 (0, null
    // or absent when it hasn't), and that allowance, the most it may borrow, × 60.
    included_left_seconds : number | null;
    credits_left : number | null;
    borrowed_seconds? : number | null;
    allowance_seconds? : number | null;
    // Whether its streams take new viewers above the unmetered ones: false once a month's allowance is borrowed too,
    // until more are bought.
    admit : boolean;
    // The viewers at once the site's streams take unmetered, taking no credits and always let in (50 a WordPress
    // site); null where the cloud says none, absent from a cloud before 2026-10-13.
    unmetered_viewers? : number | null;
    // Where the account buys credits.
    buy_url : string | null;
    // When WordPlus Cloud said it, ms.
    at : number;
}

// The check a site's admin and a host's studio ask (`POST`, `{grant}`): whether the cloud takes the site's grants,
// and what it has left.
export const CHECK_PATH = '/easy-stream/v1/check';

// `no_hours`: a viewer, while the site's streams take no new ones (its account's credits spent, a month's allowance
// borrowed too; the code kept from when they were hours).
export type JoinError = 'bad_request' | 'bad_grant' | 'expired' | 'not_licensed' | 'not_included' | 'wrong_origin' | 'banned' | 'rate' | 'no_hours' | 'server';

export interface JoinFailure {
    ok : false;
    error : JoinError;
    retry_after? : number;
}

export interface ChatMessage {
    id : string;
    from : { id : string, name : string, avatar : string | null, role : Role };
    text : string;
    at : number;
}

export interface Hand {
    identity : string;
    name : string;
    at : number;
}

// What everyone sees on stage, as the host chose: everyone in a grid, the one speaking large, or one
// person (or OBS's picture, `ingest`) alone. `corner`: where the camera of the one sharing a screen sits over
// it, as the host dragged it, its left and top as shares of the room the stage leaves it (0 to 1); none is the
// bottom corner.
export interface Layout {
    mode : 'grid' | 'speaker' | 'spotlight';
    identity : string | null;
    corner? : Corner;
}

export interface Corner {
    x : number;
    y : number;
}

export const LAYOUTS = [ 'grid', 'speaker', 'spotlight' ] as const;

// A timeout lasts from a minute to a day.
export const TIMEOUT_MIN_S = 60;
export const TIMEOUT_MAX_S = 24 * 3600;

export interface Hello {
    stream : StreamState;
    you : You;
    viewers : number;
    // The most watching at once since the stream went live, at least `viewers`; 0 while it isn't live. Absent from a
    // cloud before 2026-10-12.
    peak? : number;
    slow : number;
    history : ChatMessage[];
    hands : Hand[];
    // Absent from a cloud that predates them: none pinned, the grid, not timed out.
    pinned? : ChatMessage | null;
    layout? : Layout;
    // Until when this person may not write in the chat, in ms.
    timeout? : number | null;
    // Whether the stream takes reactions now; `reacting { on }` says when that changes. Absent from a cloud before it:
    // it does.
    reactions? : boolean;
}

export type Ack<T extends object = {}> = ( { ok : true } & T ) | { ok : false, error : string };

// The answer to a host's `ingest`: the stream's key for streaming from OBS, and the WHIP endpoint's path
// on the cloud's origin.
export interface IngestReply {
    key : string;
    path : string;
}

// The answer to a `watch` on a socket of several streams: the watch, which the stream's requests name (`w`), the
// stream's key, which its events carry last, and its hello.
export interface Watched {
    w : string;
    key : string;
    hello : Hello;
}

// Server to client events on the chat socket. Each carries last whom it is for: the stream's key, the key and
// `/mods`, or the key, `/` and an identity (a socket of one stream may leave it be).
export interface ServerEvents {
    hello : ( hello : Hello ) => void;
    state : ( state : StreamState ) => void;
    chat : ( message : ChatMessage ) => void;
    chat_deleted : ( p : { id : string } ) => void;
    reactions : ( counts : Partial<Record<Reaction, number>> ) => void;
    // The audience, and the stream's peak since it went live (absent from a cloud before 2026-10-12).
    viewers : ( p : { n : number, peak? : number } ) => void;
    slow : ( p : { seconds : number } ) => void;
    hands : ( hands : Hand[] ) => void;
    invited : () => void;
    unstaged : () => void;
    banned : () => void;
    pinned : ( p : { message : ChatMessage | null } ) => void;
    layout : ( layout : Layout ) => void;
    // To a guest whose microphone the host muted.
    muted : () => void;
    // To someone timed out of the chat.
    timeout : ( p : { until : number } ) => void;
}
