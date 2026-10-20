# JavaScript reference

Three scripts, each loaded only by the pages that need it:

| Global | Script | Loaded by |
|---|---|---|
| `wordplusRealtimeClient` | the page script, which every WordPlus plugin shares | `wordplus_realtime()->script()` |
| `wordplusRealtimeCalls` | calls and group calls | `wordplus_realtime()->calls_script()` |
| `wordplusRealtimeUi` | The Better Messages screens: the call screen, who is in a room, the chat | `wordplus_realtime()->call_screen()` or `ui()` |

The page settings are `window.wordplusRealtimeConfig`, unset on a site without its credentials.

## `wordplusRealtimeClient.page()` → `Rooms`

The page rooms, made once from `wordplusRealtimeConfig` and shared by the code of every plugin and the screens. `null` on a site without credentials. `wordplusRealtimeClient.rooms( config )` makes rooms of your own, which `page()` is the one to share.

| Member | |
|---|---|
| `join( name )` | → `Room`, the same one again for the same name ([rooms](rooms.md#joining-in-the-browser)) |
| `room( name )`, `leave( name )` | a room this tab joined, or `undefined`. Leaving it (the other tabs of the browser keep theirs) |
| `online` | who is online across the site ([presence](presence.md#who-is-online-across-the-site)) |
| `users( ids )` | → `Promise<{ [id]: { user_id, name, avatar, url, … } }>`: the site users from its directory, opened. Rejects with `no_identity` on a page whose user the site does not know ([encryption](encryption.md#the-site-users)) |
| `user` | the user the site vouched for on this page, or `null` |
| `on( event, fn )`, `once`, `off( event?, fn? )` | what your server sends this user (`to_user()->emit()`), `fn( data, { at } )`, and those of the connection itself: `connected`, `disconnected`, `moved` (to another server without a drop), `error` (`{ code }`: the connection refused) |
| `tab` | this tab name, for the `except` of an emit (send it as `X-Realtime-Tab`) |
| `connected` | |
| `close()` | leaves every room. The other tabs of the browser keep the connection |

## `Room`

| Member | |
|---|---|
| `name`, `state`, `error` | `joining`, `joined`, `failed`, `left`. Why it failed ([errors](errors.md#rooms)) |
| `ready` | a promise, resolved once joined |
| `on( event, fn )`, `once`, `off`, `onAny( fn )`, `offAny` | an event, `fn( data, meta )` with meta `{ from, id, at, replayed? }`, or those of the room itself: `joined` (the members), `join` (`{ id, info }`), `leave` (`{ id }`), `count` (n), `error` (`{ code }`), `kicked` |
| `emit( event, data )` | to the others in the room, as its rule allows ([events](events.md)) |
| `emitWithAck( event, data )` | → `Promise<{ id, at }>` once WordPlus Cloud took it |
| `volatile`, `timeout( ms )` | an emitter that drops rather than queues, or whose acks wait at most `ms` |
| `history( { before, after, limit } )` | → `Promise<{ events, more }>`, oldest first. 50 by default, 100 at most |
| `members`, `count` | the members of a presence room by id, their `info`. How many are in a room that counts |
| `membersPage( cursor?, limit? )` | → `Promise<{ list, next }>`: the members past the first 1,000 listed |
| `leave()` | |

## `Online`

| Member | |
|---|---|
| `watch( ids )`, `unwatch( ids )` | up to 1,000 users a connection |
| `has( id )`, `lastSeen( id )` | the status of a watched user. When they were last seen, in ms, or `null` while online |
| `count` | how many are online across the site, once something listens to `count` |
| `on( 'change' \| 'count', fn )`, `off` | `{ id, online, at? }` for a watched user. The count |
| `list( { cursor, limit } )` | → `Promise<{ ids, next }>`: a page of who is online, `next` `'0'` after the last |

## `wordplusRealtimeClient.keyring()` → `Keyring`

The page keys, shared by every plugin on it ([encryption](encryption.md)). The rooms open what they carry with it by themselves.

| Member | |
|---|---|
| `open( value )` | → the text a sealed value holds, `null` when no key held opens it. Anything not sealed as it is |
| `openJson( value )` | → its data parsed. `undefined` when it does not open |
| `seal( text, label )`, `sealJson( data, label )` | → sealed with a key held, or `null` |
| `missing( value )` | → the labels of the sealed values in a payload whose keys the page lacks |
| `ensure( labels )` | → `Promise`: asks the site for those keys, once for those asked together |
| `has( label )`, `newest( prefix )`, `dayLabel()` | a key held. The newest held of one thing (`ch:order:42:`), the key of today |
| `onAdded( fn )` | `fn( entries, source )` for each key the page gets. Returns a function that stops it |

`wordplusRealtimeClient.labelOf( value )` names the key a sealed value needs.

## `wordplusRealtimeCalls`

| Member | |
|---|---|
| `page()` | → `{ rt, calls }`: the page rooms and calls, made once from `wordplusRealtimeConfig`. `null` without it |
| `calls( rt, options )` | → `Calls` on rooms of your own. `page()` is the one to share |
| `supportsP2P()` | whether this browser can hold a direct call |

### `Calls`

| Member | |
|---|---|
| `start( name, { to, type } )` | → `Promise<Call>`: rings `to`. Rejects with `code` |
| `group( name, { type } )` | → `Promise<GroupCall>`: joins a group call. Rejects with `code` |
| `stream( name, { video }? )` | → `Promise<Stream>`: joins a live stream as your rule says, or rejects with `code` ([live streams](streams.md), and every member of `Stream` [for apps](https://docs.wordplus.cloud/apps/browser/)) |
| `people( name )` | → `Promise<{ id, name, avatar }[]>`: whom the user may add to calls named `name`, as your plugin `people` lists them |
| `incoming()` | → the `Incoming` ringing now |
| `stopRinging()` | this page holds the user line no more |
| `on( event, fn )`, `off( event, fn? )` | `incoming` (`Incoming`), `error` (`{ code, what }`) |

Options (in `wordplusRealtimeConfig`, or to `calls()`): `calls` (the calls route, `{ endpoint, headers }`), `rooms` (the script of the media client), `roomsWorker` (its encryption worker, beside it by default), `streams` (the script of live streams, beside the rooms script by default), `api` (the server for the leave of a closing page), `ring` (`false`: hold no line).

### `Incoming`

| Member | |
|---|---|
| `id`, `call`, `from`, `info`, `type` | the attempt, the call name, the caller id, what the site said about them, `video` or `audio` |
| `group` | for a ring into a group call, the call id. `null` for a call between two people |
| `state`, `reason` | `ringing`, `answered`, `declined` or `over`, and why it is over |
| `accept()` | → `Promise<Call>`, or `Promise<GroupCall>` for a ring into a group call |
| `decline( reason? )` | `declined` (default) or `busy` |
| `on( 'over', fn )` | it stopped ringing: `fn( reason )` |

### `Call`

| Member | |
|---|---|
| `id`, `name`, `type`, `role`, `peer` | the attempt, the call name, `video` or `audio`, `caller` or `callee`, `{ user, info }` |
| `state` | `ringing`, `connecting`, `connected`, `reconnecting`, `ended` |
| `path` | `direct`, `relay`, `room`, or `null` before it connects |
| `remote` | `{ camera, microphone, screen, screenAudio, media, quality }` |
| `endReason` | why it ended ([calls](calls.md#why-a-call-ended)) |
| `setTrack( source, track )` | `camera`, `microphone`, `screen_share`, `screen_share_audio`. `null` stops |
| `add( user )` | → `Promise<Invite>`: rings `user` in, and the call becomes a group call ([adding people](calls.md#adding-people)) |
| `end()` | hangs up, or `cancelled` while ringing |
| `on( event, fn )`, `off( event, fn? )` | `state`, `path`, `remote`, `waiting`, `reacquire`, `autoplay_blocked`, `group` (`GroupCall`: it goes on as one), `ended` |

### `GroupCall`

| Member | |
|---|---|
| `state` | `connecting`, `waiting`, `connected`, `reconnecting`, `ended` |
| `people()` | → `Person[]`: everyone else |
| `setTrack( source, track )` | → `Promise`: what this page sends |
| `leave()` | |
| `encrypted` | whether its media is encrypted end to end |
| `group` | for the group call of a call, the call id. `null` for one your plugin names |
| `add( user )` | → `Promise<Invite>`: rings `user` into the group call of a call. `not_a_call` in any other |
| `invites()` | → `Invite[]`: the rings into it this page heard of |
| `livekit` | the room of the media client itself |
| `on( event, fn )`, `off( event, fn? )` | `state`, `waiting` (`{ until, reason }`), `person`, `person_left`, `speakers`, `invite` (`Invite`), `error` (`{ code }`), `ended` |

A `Person` is `{ identity, user, info, camera, microphone, screen, screenAudio, speaking }`.

### `Invite`

A ring into a group call.

| Member | |
|---|---|
| `id`, `group`, `from`, `to` | the ring, the call id, who rang and whom |
| `state` | `ringing`, `answered`, `rejected`, `busy`, `no_answer` or `cancelled` |
| `cancel()` | → `Promise`: calls it off while it rings, from the page that rang |
| `on( 'state', fn )`, `off( 'state', fn? )` | each change: `fn( state )` |

### Remote tracks

Every track another person sends has `mediaStreamTrack`, `attach( element )`, which plays it in an `<audio>` or `<video>` element, and `detach( element? )`.

## `wordplusRealtimeUi`

| Member | |
|---|---|
| `place( call, to, type, { name, avatar } )` | what `<call-button>` does |
| `join( name, type, title )` | what `<room-button>` does |
| `start( { lang, strings, add } )` | starts the screens now, which they do by themselves once the page has loaded, with the settings `call_screen()` gave |
| `own( pattern, ( owned ) => … )` | a screen of your plugin for the calls whose names match `pattern` (`support:{a}:{b}`): their rings (`owned.kind` `ring`, `owned.incoming`), the calls `<call-button>` places (`call`) and the group calls `<room-button>` joins (`group`) come to you instead of the shared screen ([your own screen](call-screen.md#your-own-screen-for-the-calls-of-your-plugin)). Answers a function that hands them back |
| `setViews( { CallView, components, OnlineList, Chat, … } )` | the screens drawn with your own views and pieces (an elements script of your own, [customizing the screens](https://docs.wordplus.cloud/apps/customizing/)) |
