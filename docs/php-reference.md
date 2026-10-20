# PHP reference

Everything is on `wordplus_realtime()`, the newest copy of the package on the site. Call it from `plugins_loaded` on.

## Rooms

| Method | Returns | |
|---|---|---|
| `room( $pattern, $rule = null, $options = array() )` | `$this` | owns the rooms whose names match `$pattern` (`order:{id}`). `$rule( $user_id, $params, $room )` answers `false`, `true`, or `array( 'info' => …, 'emit' => …, 'readOnly' => … )`. `$options`: `presence`, `count`, `history`, `emit`, `webhook`, `public`, `seal` ([rooms](rooms.md), [presence](presence.md)) |
| `on( $type, $handler )` | `$this` | what the realtime server webhook brings: a page event by its name, `room.occupied`, `room.vacated`, `member.joined`, `member.left`, `user.online`, `user.offline`, or `*` ([sending](sending.md#webhooks)) |
| `to( $rooms )->except( $tab )->emit( $event, $data = null, $options = array() )` | ids by room, or `WP_Error` | an event to up to 1,000 rooms, kept where they keep history. `$options['seal']` false sends it plain ([sending](sending.md)) |
| `to_user( $users )->emit( $event, $data = null )` | ids, or `WP_Error` | an event to every connection of the users, sealed with the key of each |
| `batch( $events )` | the ids of each, or `WP_Error` | several emits, each `rooms`, `users`, `event`, `data`, `except`, `seal` |
| `in( $room )` | `WordPlus_Realtime_Room` | `count()`, `members()`, `history( $ask )`, `forget( $id = null )`, `kick( $user )` |
| `online()` | `WordPlus_Realtime_Online` | `has( $user )`, `count()`, `list( $cursor, $limit )`, `states( $users )` |
| `list_rooms( $page = array() )` | array, or `WP_Error` | the rooms someone is in now: `count`, `rooms` (`name`, `count`, `connections`), `next`. `$page`: `prefix`, `cursor`, `limit` ([sending](sending.md#the-rooms-in-use)) |
| `for_user( $id )` | `WordPlus_Realtime_User` | `get()`, `disconnect()`, `ask( $event, $data, $options )`: their state, out of everything at once, and their pages asked ([sending](sending.md#a-user)) |
| `usage()` | array, or `WP_Error` | `connections` (`now`, `limit`) and the `credits` of the account |
| `webhooks()` | `WordPlus_Realtime_Webhooks` | `deliveries()`, `resend( $id )`, `test()` |
| `list_calls()`, `call( $name )` | array, `WordPlus_Realtime_Call` | the group calls going on, and `get()`, `mute( $user, $track )`, `permit( $user, [ 'publish' => true ] )`, `remove( $user )`, `end()` |
| `list_streams()`, `stream( $name )` | array, `WordPlus_Realtime_Stream` | the streams live now, and `get()`, `people()`, `chat( $limit )`, `say( $text, $name, $avatar )`, `delete_message( $id )`, `clear_chat()`, `pin( $id )`, `slow( $seconds )`, `timeout( $user, $seconds )`, `untimeout( $user )`, `kick( $user )`, `ban( $user )`, `unban( $user )`, `bans()`, `reactions( $on )`, `end()` ([live streams](streams.md#from-the-server)) |
| `tab()` | string | the tab that asked, from the page `X-Realtime-Tab` header, for `except()` |
| `authorize( $rooms, $user_id )` | array | what the auth route answers: `token`, `exp`, `keys`, `denied` |
| `public_grants()` | array | the grant of the public rooms with no rule, which every page carries |
| `may_join( $room, $user_id )` | bool | whether the room rule lets the user in, as the auth route asks it |
| `room_options( $room )` | array or `null` | the options of a room, with their defaults and the cloud limits |
| `webhook( $raw, $headers, $path )` | `true` or `WP_Error` | a webhook as it came, checked and handed to the handlers: what the webhook route does |
| `script()` | handle | the page script with its settings in `window.wordplusRealtimeConfig`. An empty handle on a site without credentials |

## Calls

| Method | Returns | |
|---|---|---|
| `calls( $pattern, $rule, $options = array() )` | `$this` | owns the calls between two people whose names match `$pattern`. `$rule( $user_id, $with, $params, $call )` answers `false`, `true`, or `array( 'info' => … )` ([calls](calls.md)). `$options['people']`: a callable `( $user_id, $call )` answering the user ids the call screen offers to add ([the call screen](call-screen.md#whom-it-offers-to-add)) |
| `group_calls( $pattern, $rule, $options = array() )` | `$this` | owns the group calls whose names match `$pattern`. `$rule( $user_id, $params, $name )` answers `false`, `true`, or `array( 'info' => …, 'publish' => …, 'subscribe' => …, 'admin' => …, 'hidden' => … )`. `$options['encrypt']`: true to encrypt their media end to end ([group calls](group-calls.md)) |
| `streams( $pattern, $rule, $settings = array() )` | `$this` | owns the live streams whose names match `$pattern`. `$rule( $user_id, $params, $name )` answers `false`, a role (`host`, `viewer`), or `array( 'role' => …, 'info' => …, 'chat' => …, 'mod' => …, 'src' => …, 'quality' => … )`. `$user_id` 0, a visitor, is a viewer at most. `$settings`: `reactions`, `people`, `chat` (`offline`, `links`, `fresh`), each a value or a callable of the parts of the name ([live streams](streams.md)) |
| `calls_script()` | handle | the calls script, `window.wordplusRealtimeCalls`, after the page script. The empty handle without credentials |
| `call_screen( $args = array() )` | bool | loads [the call screen](call-screen.md) and the other ready-made parts on the page. `$args['ring']` false: nothing rings on it |
| `ui()` | bool | the ready-made parts on a page where nothing rings |
| `screen()` | array | the screen settings: `lang`, `strings`, `add`, and `prefix` when the site sets one |
| `element_prefix()` | string | the site prefix for the element names, from `wordplus_realtime_element_prefix`. Empty for their own |
| `element_name( $tag )` | string | an element name on this site: `chat-room`, or `shop-chat-room` |
| `call_user()` | int | who takes part in calls on this page: `user()` |
| `authorize_call( $request, $user_id )` | array | what the calls route answers: `token`, `exp`, `key`, `pair` and `member` for a call (and `ring` for a ring into it), `media_key` for the rooms of a call and an encrypted group call, `people` for `array( 'people' => $call )`, or `denied` |
| `WordPlus_Realtime::call_key( $id, $caller, $callee )` | string | the key the two pages of a call seal their negotiation with |

## Keys and the site users

[Encryption](encryption.md) explains them. On `wordplus_realtime()->keys()`:

| Method | Returns | |
|---|---|---|
| `seal( $value, $label )`, `seal_json( $data, $label )` | string or `null` | a value sealed with the key of a label: only those who may have that key open it |
| `open( $value )` | string or `null` | what a value this site sealed holds. `null` for anything else or anything changed |
| `WordPlus_Realtime_Keys::label_of( $value )` | string or `null` | the label of the key that opens a sealed value |
| `day_label()`, `user_label( $user_id )`, `room_label( $room )` | string | the day key, the key of a user, the newest key of a sealed room |
| `rotate_user( $user_id )`, `rotate_room( $room )` | | the next key, which someone who lost access never gets |
| `kind( $kind, $may_have, $newest = null )` | `$this` | keys of your own, `{kind}:{…}`: `$may_have( $rest, $user_id, $label )` says who may have one. `$newest( $rest, $label )` names the newest of the same thing |
| `may_have( $label, $user_id )` | bool | whether the user may have a key |
| `media( $what )` | string | the key the media of a room is encrypted with: `call|{call}|{call id}|{caller}|{callee}` for the rooms of a call, `room|{name}` for an encrypted group call. The calls route gives it with the token of a group call, and no other route gives it out |
| `proof( $what )` | string | a proof only the site makes, that a user is in a call or was rung into it ([calls](calls.md#how-it-works)) |
| `entry( $label )` | string | a key as the site hands it to a browser |
| `user_entries( $user_id )` | string[] | the keys a user starts with: their own, and the day keys from yesterday to tomorrow |
| `profile( $user_id )` | array or `null` | the user entry in the site directory, sealed (`pd`, `pdh`) |
| `sealing()` | bool | whether the site seals (`wordplus_realtime_seal`) |

And on `wordplus_realtime()`:

| Method | Returns | |
|---|---|---|
| `user()` | int | who the site knows on this request: the signed-in user, a visitor negative id (`wordplus_realtime_visitor_id`), or 0 |
| `identity( $user_id )` | `array( 'token', 'exp' )` or `null` | who the user is for the realtime server, with their directory entry, signed as the site |

## The site

| Method | Returns | |
|---|---|---|
| `available()` | bool | the site has its credentials |
| `credentials()` | `array( 'key', 'secret' )` or `null` | the site key and the secret to sign with now |
| `site_key()` | string | the site key, or `''` |
| `connect()->url( $return_to )` | URL | The WordPlus Cloud approval, back to `$return_to` with `wordplus_realtime=connected`, `denied` or `failed` |
| `server()`, `api_server()` | URL | where browsers connect, and where the site requests go |
| `config()` | array | what the page gets in `window.wordplusRealtimeConfig` |
| `version()` | string | the version of this copy |

## Routes

| Route | |
|---|---|
| `POST /wp-json/wordplus/v1/realtime/auth` | `{ rooms }` → `{ token, exp, keys?, denied }` |
| `POST /wp-json/wordplus/v1/realtime/calls` | `{ line: true }`, `{ call, id, role, to or from, type }` or `{ room, type }` → `{ token, exp, key? }` or `{ denied }` |
| `POST /wp-json/wordplus/v1/realtime/keys` | `{ labels }` → `{ keys }`, those the user may have. `{ labels: [] }` → the keys they start with and their `identity` |
| `POST /?rest_route=/wordplus/v1/realtime/webhook` | from the realtime server, signed with the site webhook key: `{ events }` → 204 |

Anyone may ask the first three. Your rules decide. A refusal is an answer, not an HTTP error.

## Filters

| Filter | Default | |
|---|---|---|
| `wordplus_realtime_token_ttl` | 21600 | the life of a room token in seconds, at most a day |
| `wordplus_realtime_call_token_ttl` | 21600 | the lifetime of a calls token, at most 6 hours |
| `wordplus_realtime_visitor_id` | 0 | the id of a visitor, a negative number: who joins presence rooms, takes part in calls and gets keys |
| `wordplus_realtime_hidden` | false | `true` keeps a user out of who is online (`$hidden, $user_id`) |
| `wordplus_realtime_seal` | true | whether what the site sends through WordPlus Cloud goes sealed |
| `wordplus_realtime_user_has_keys` | true | `false` keeps every key from a user you cut off (`$has, $user_id`) |
| `wordplus_realtime_profile` | name, avatar, author page | a user entry in the site directory (`$profile, $user_id`). Text is sealed |
| `wordplus_realtime_screen_strings` | none | the screen words by their English text |
| `wordplus_realtime_element_prefix` | none | a name of the site before every element name: `shop` makes `<shop-call-button>` ([the call screen](call-screen.md#their-names)) |
| `wordplus_realtime_config` | the page settings | what `script()` gives the page (`$config, $user_id`). `'perUser' => true` gives each user a connection of their own, for a browser that may hold several |
| `wordplus_realtime_server` | `https://ws.wordplus.cloud/` | where browsers connect |
| `wordplus_realtime_api_server` | `https://rest.wordplus.cloud/` | where the site requests and the leave of a closing page go |
| `wordplus_realtime_account` | `https://www.wordplus.cloud/` | where Connect sends the administrator |
| `wordplus_realtime_account_api` | `https://api.wordplus.cloud/` | where the Connect code is exchanged |

## The option

The credentials live in `wordplus_cloud_license`, which every WordPlus plugin on the site shares: on a network, that of the network when the site has none. The package only reads it, but Connect writes it.

The master key every other key is derived from lives in `wordplus_realtime_master_key`, that of the network on a network. It never leaves the site. Deleting it changes every key, and what was sealed before no longer opens.
