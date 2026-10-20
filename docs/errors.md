# Errors

Every refusal has a short code. The page hands it on as `code` (`e.code` of a rejected promise, `{ code }` of an `error` event, the `endReason` of a call). PHP returns it as the code of a `WP_Error`.

## The connection

`rt.on( 'error', ( e ) => … )`: the realtime server refused the page connection.

| Code | Why | What to do |
|---|---|---|
| `not_licensed` | the server does not know the site key | the site credentials are wrong or revoked: activate a WordPlus plugin licence again, or connect again |
| `not_included` | the site plan does not include realtime | upgrade the plan in the WordPlus Cloud account |
| `wrong_origin` | the page is not on the licensed address of the site (with or without `www.`) | serve the page from the site address. A headless front end on another domain is not supported |
| `over_capacity` | a staging copy has its 25 people online | expected on a staging copy |
| `try_later` | a server still starting | the page tries again by itself |
| `bad_request` | the handshake was malformed | |

## Rooms

The `error` event of a room, and its `error` property (`room.state` is `failed`):

| Code | Why |
|---|---|
| `forbidden` | the room rule said no, or the user was kicked out of it |
| `no_rule` | no pattern of a plugin matches the room |
| `bad_room` | not a room name WordPlus Cloud takes |
| `expired`, `bad_token` | the token ran out, or was not signed by the site (a secret replaced more than a day ago, say) |
| `too_many` | the connection holds 1,000 rooms, or one token asked for more than 100 |
| `full` | a presence room has its 100,000 members |
| `not_connected` | the site has no credentials |
| `auth_failed` | the site auth route did not answer, or answered an HTTP error |
| `no_auth` | the page has no auth route |
| `timeout`, `server` | the server did not answer, or failed |

A room that kicks the user out says so with `kicked`. An event the page had no key for, even after asking the site keys route, comes as `error` with `unopened` (`{ code, event, label }`): on the room, or on `rt` for what your server sent the user.

A page back after the 5 minutes a room keeps its events, or after more came than it keeps, gets what the room still had, then `error` with `gap` on the room, which stays joined. Some events are lost to it, so it loads what it shows again from your plugin ([keeping the conversation](events.md#keeping-the-conversation)).

## Events from the page

`emitWithAck()` rejecting:

| Code | Why |
|---|---|
| `not_allowed` | the room rule does not list the event in `emit`, or the user answer is `readOnly` |
| `forbidden` | the tab is not in the room |
| `bad_event` | a name the server does not take, or one kept for the room itself (`joined`, `join`, `leave`, `count`, `error`) |
| `rate_limited` | over 50 a second from the connection |
| `too_large` | over 1 MB |
| `timeout` | no ack in time (`room.timeout( ms )`) |

`history()` rejects with `no_history` for a room that keeps none, and `rt.users()` and `rt.online` with `no_identity` for a page whose user the site did not vouch for.

## Sending

`to()->emit()`, `to_user()->emit()`, `batch()`, `in()` and `online()` return a `WP_Error`:

| Code | Why |
|---|---|
| `not_connected` | the site has no credentials |
| `missing_signature`, `stale_signature`, `unknown_site`, `bad_signature` | the request signature was not taken: a site clock off by more than 5 minutes is `stale_signature` |
| `not_included` | the plan does not include realtime |
| `bad_request`, `bad_room` | no event, or a room name the server does not take |
| `reserved` | an event named as one kept for the room itself (`joined`, `join`, `leave`, `count`, `error`) |
| `too_many`, `too_large` | over 1,000 rooms or users, or 100 events, or data over 1 MB |
| `http_<status>`, or a WordPress error code | the server could not be reached |

The webhook route answers the realtime server `401` (`missing_signature`, `stale_signature`, `bad_signature`) for a request it did not sign, and `500` (`handler_failed`) when a handler threw, so the server sends it again later.

## Calls

From `calls.start()`, `incoming.accept()`, `calls.group()`, `call.add()` and `group.add()` (rejected with `code`), from the calls route (`denied`), and as the `endReason` of a call when the server refused to start it:

| Code | Why |
|---|---|
| `forbidden` | your `calls()` or `group_calls()` rule said no, or no pattern matches the call. For a ring into a group call, the one ringing is not in the call, or the one answering was not rung |
| `no_user` | nobody to call as: a visitor without an id ([calls](calls.md#visitors)) |
| `not_included` | the plan does not include calls |
| `bad_request` | a call or group call name the server does not take, or calling yourself |
| `bad_token`, `expired` | the token was not for the site, or ran out |
| `no_call`, `call_ended` | answered after the caller gave up |
| `answered_elsewhere` | answered on another device |
| `not_connected` | the site has no credentials. From `add()`, the call is not up yet |
| `already_in` | the person added is in the group call already |
| `ringing` | someone else in the call rings that person in now. The group call `invite` event has their ring |
| `full` | the group call has as many people as one holds ([limits](limits.md)) |
| `not_a_call` | `group.add()` in a group call your plugin named: only the group call of a call rings people in |
| `encryption_unsupported` | the group call is encrypted end to end and this browser cannot encrypt each frame |
| `no_encryption_worker` | the media client encryption worker is not there, or did not load |
| `auth_failed`, `no_auth` | the site calls route did not answer, or the page has none |
| `no_media` | the server has no media servers set up |
| `no_rooms_script`, `rooms_script_failed`, `rooms_script_broken` | the media client script is not there, or did not load |
| `signaling_unavailable` | the page connection was down |

`decline()` rejects with `answered` when the call was already answered on another device. The `error` event of a group call says `publish_failed` for a track it could not send, and `encryption_failed` for a frame it could not encrypt or decrypt.

How a call ended is in [calls](calls.md#why-a-call-ended).
