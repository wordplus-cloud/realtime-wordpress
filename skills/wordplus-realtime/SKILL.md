---
name: wordplus-realtime
description: Adds realtime features to a WordPress plugin, theme or site with the WordPlus realtime SDK (the Composer package wordplus/realtime, on WordPlus Cloud) - live updates pushed from PHP, rooms with presence ("who is online", "who is reading"), live counts and 5 minutes of history, typing indicators, chat and other browser-to-browser events kept by the plugin from webhooks, sending to a user, video and audio calls between two people that ring in the browser, group calls, the ready-made screens of Better Messages (call screen, who is in a room, chat), and the users of the site and encryption, which come with it. Use when code calls wordplus_realtime(), wordplusRealtimeClient, wordplusRealtimeCalls, <wordplus-call> or <wordplus-chat>, or when a WordPress task asks for live updates, presence, websockets, chat, video calls or group calls.
---

# The WordPlus realtime SDK

`wordplus/realtime` gives any WordPress code realtime features on a site with a WordPlus Cloud subscription. Its PHP part declares rooms and calls by pattern and decides who may use them, sends to rooms and users, and hears webhooks. Its browser part, loaded by the PHP part, joins rooms, sends events, rings, and runs the calls. The servers belong to WordPlus Cloud: nothing to host.

## Pick the feature

| The task asks for | Use | Reference |
|---|---|---|
| Updates pushed from the server (the status of an order, a new comment) | a room, and `to( $room )->emit()` from PHP | [rooms](references/rooms.md), [sending](references/sending.md) |
| A notice for one user, wherever they are on the site | `to_user( $id )->emit()`, and `rt.on( event )` | [sending](references/sending.md#to-users) |
| Who is on a page, in a queue | a room with `presence` | [presence](references/presence.md) |
| Who is online across the site | `rt.online.watch( ids )` | [presence](references/presence.md#who-is-online-across-the-site) |
| How many are looking, for anyone | a `public` room with `count` | [rooms](references/rooms.md), [presence](references/presence.md#counting) |
| Typing, cursors, chat, anything between browsers | a room `emit` option, and `room.emit()` in the browser | [events](references/events.md) |
| A chat that keeps its conversation | `emit` and `webhook` on the room, `on( 'message' )` saving it, a REST route paging it, `<wordplus-chat>` with `load` | [events](references/events.md#keeping-the-conversation) |
| A video or audio call between two people, with a ring | `calls()` and the call screen `<wordplus-call>` | [calls](references/calls.md), [call screen](references/call-screen.md) |
| A meeting, class or staff room | `group_calls()`, and `<wordplus-room>` | [group calls](references/group-calls.md) |
| A live show, class or launch: one presenting, everyone watching, with a chat | `streams()`, and `calls.stream( name )` in the page | [live streams](references/streams.md) |
| Adding someone to a call ("bring in a colleague"), so it goes on as a group call | the `people` option of `calls()` for Add person on the call screen, or `call.add( user )` | [calls](references/calls.md#adding-people), [call screen](references/call-screen.md#whom-it-offers-to-add) |
| End-to-end encrypted group calls | the `encrypt` option of `group_calls()`, and the rooms that come from a call always are | [group calls](references/group-calls.md#encrypted-end-to-end) |
| A custom call interface | `wordplusRealtimeCalls.page().calls` | [calls](references/calls.md), [JavaScript reference](references/javascript-reference.md) |
| The names and avatars of users in the browser | `rt.users( ids )`, the directory every plugin on the site shares | [encryption](references/encryption.md) |
| Data for one user or one group alone, beyond what rooms seal | `wordplus_realtime()->keys()`: `seal_json()` with the label of a user or of a kind of your own | [encryption](references/encryption.md), [PHP reference](references/php-reference.md) |

Prefer the ready-made screens (`call_screen()` or `ui()` and HTML elements) unless the task asks for a custom interface: they handle devices, ringing, states, screen sharing, the room fallback, presence lists and the chat.

## Workflow

1. **Install:** `composer require wordplus/realtime` in the plugin, then `require __DIR__ . '/vendor/autoload.php';` in its main file. Without Composer, require the package `realtime.php`.
2. **Declare rooms and calls by pattern,** in `plugins_loaded`, with a rule that decides who may use each. Start the patterns with something unique to the plugin (`myplugin-order:{id}`).
3. **Load the browser part** in `wp_enqueue_scripts`: depend on `wordplus_realtime()->script()` for rooms or `calls_script()` for calls, or call `call_screen()` (or `ui()`) for the ready-made screens.
4. **Write the browser code** against `wordplusRealtimeClient.page()`, which is `null` on a site without credentials: check for it and do nothing then.
5. **Send from PHP** where the data changes. Let browsers send only what a room `emit` allows, and keep what matters from the webhook.
6. **Offer Connect** on the plugin settings page when `wordplus_realtime()->available()` is false: `wordplus_realtime()->connect()->url( $return_to )`.
7. **Verify** with the checks below.

## Templates

### Live updates

```php
add_action( 'plugins_loaded', function () {
	wordplus_realtime()->room( 'myplugin-order:{id}', function ( $user_id, array $p ) {
		return $user_id > 0 && myplugin_order_owner( (int) $p['id'] ) === $user_id;
	}, array( 'history' => 20 ) );
} );

// Where the order changes, skipping the tab that made the change:
wordplus_realtime()->to( 'myplugin-order:' . $order_id )->except( wordplus_realtime()->tab() )->emit( 'status', array( 'status' => $status ) );

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_script( 'myplugin-live', plugins_url( 'live.js', __FILE__ ), array( wordplus_realtime()->script() ), '1.0.0', true );
	wp_add_inline_script( 'myplugin-live', 'window.mypluginLive = ' . wp_json_encode( array( 'order' => myplugin_current_order_id() ) ) . ';', 'before' );
} );
```

```js
const rt = wordplusRealtimeClient.page();
if ( rt && window.mypluginLive ) {
	const order = rt.join( 'myplugin-order:' + window.mypluginLive.order );
	order.on( 'status', ( data ) => updateStatus( data.status ) );
	order.on( 'error', ( e ) => console.warn( 'myplugin realtime:', e.code ) );
}
```

### Presence and typing

```php
wordplus_realtime()->room( 'myplugin-room:{id}', function ( $user_id, array $p ) {
	return $user_id > 0 ? array( 'info' => array( 'name' => get_userdata( $user_id )->display_name ) ) : false;
}, array( 'presence' => true, 'emit' => array( 'typing' ) ) );
```

```js
const room = wordplusRealtimeClient.page().join( 'myplugin-room:' + roomId );
room.on( 'joined', () => drawMembers( [ ...room.members ] ) );
room.on( 'join', ( m ) => addMember( m ) );
room.on( 'leave', ( m ) => removeMember( m.id ) );
room.on( 'typing', ( data, meta ) => showTyping( meta.from ) );
room.volatile.emit( 'typing', { on: true } );   // at most every couple of seconds
```

### Calls with the call screen

```php
add_action( 'plugins_loaded', function () {
	wordplus_realtime()->calls( 'myplugin-call:{a}:{b}', function ( $user_id, $with ) {
		return myplugin_may_talk( $user_id, $with );
	} );
	wordplus_realtime()->group_calls( 'myplugin-team', function ( $user_id ) {
		return user_can( $user_id, 'edit_posts' );
	} );
} );

// Every page a person may be called on, so their calls ring there.
add_action( 'wp_enqueue_scripts', function () {
	if ( is_user_logged_in() ) {
		wordplus_realtime()->call_screen();
	}
} );
```

```php
printf( '<wordplus-call to="%d" call="%s" type="video" name="%s">%s</wordplus-call>',
	$other_user_id, esc_attr( 'myplugin-call:' . min( $me, $other_user_id ) . ':' . max( $me, $other_user_id ) ), esc_attr( $other_name ), esc_html__( 'Video call', 'myplugin' ) );
echo '<wordplus-room room="myplugin-team" type="video" title="Team">' . esc_html__( 'Join the team call', 'myplugin' ) . '</wordplus-room>';
```

### Calls with your own interface

```js
const page = window.wordplusRealtimeCalls && wordplusRealtimeCalls.page();
if ( page ) {
	page.calls.on( 'incoming', ( incoming ) => showRing( incoming ) );   // incoming.accept() → Call, incoming.decline()
	const call = await page.calls.start( 'myplugin-call:12:34', { to: 34, type: 'video' } );
	call.on( 'remote', ( r ) => r.camera && r.camera.attach( videoEl ) );
	call.setTrack( 'microphone', micTrack );
}
```

## Rules

- **Call `wordplus_realtime()` from `plugins_loaded` on,** never at file load: every bundled copy registers first, and the newest answers.
- **The site decides everything.** A room, a call and a group call need a rule that says yes. No pattern matching a name means no (`no_rule`, `forbidden`). Never sign tokens in the browser, and never print the site secret.
- **Public rooms are public:** anyone may join them and they are not sealed. Put private data only in rooms with a rule.
- **The names kept for a room itself are reserved:** `joined`, `join`, `leave`, `count`, `error`.
- **Names:** up to 200 of `A-Z a-z 0-9 _ - = @ , . ; :`, for rooms, calls and group calls. `{part}` in a pattern matches anything but `:` and `.`.
- **History is 5 minutes,** for pages that reconnect. Keep anything the plugin needs longer (the messages of a chat) in the WordPress database, from the webhook (`on()`), by `event_id`.
- **Users are integer ids.** A visitor joins presence rooms and takes part in calls only with a negative id your plugin gives through `wordplus_realtime_visitor_id`.
- **A call rings only on pages holding the callee line:** pages that load the calls script or the call screen for that signed-in user. Load the call screen on every page where a person should be reachable.
- **Use `wordplusRealtimeClient.page()` and `wordplusRealtimeCalls.page()`,** so every plugin and the screens share one tab on the connection and a call rings once.
- **Send `X-Realtime-Tab: rt.tab`** with the request that triggers an emit, and `except( wordplus_realtime()->tab() )`, when the acting tab already shows the change.
- **Only the pages of the site connect** (`wrong_origin` otherwise): a headless front end on another domain is not supported.
- **Sealing is already done.** What your server and pages send to a room, member `info`, what goes to a user, and the people of calls go sealed with keys only the site and its users hold, and listeners get them opened. Do not encrypt them again, and never send the master key (`wordplus_realtime_master_key`) or a key entry anywhere but to the user the keys route would give it to.
- **When someone loses access:** `in( $room )->kick( $user )`, or `keys()->rotate_room( $room )` and `rotate_user( $user_id )`, so what follows is sealed from them.
- **Names and avatars come from `rt.users( ids )`,** not from data you send, so they stay sealed and the same in every plugin. Add a field with the `wordplus_realtime_profile` filter.
- **Limits:** 1 MB an event, 1,000 rooms an emit, 50 events a second from a page, 100,000 presence members, 32 people in a video group call and 50 in an audio one ([limits](references/limits.md)).

## Verify

- `wordplus_realtime()->available()` is true, or the plugin shows Connect.
- `wp eval 'var_export( wordplus_realtime()->to_user( 1 )->emit( "ping" ) );'` prints the ids array. The code of a `WP_Error` says why not ([errors](references/errors.md)).
- In the browser console, `wordplusRealtimeClient.page()` is set and a joined room fires `joined`, not `error`.
- For calls, two signed-in browsers (or one with a private window): place a call, see it ring, answer, see and hear each other, hang up.
- The package `examples/live-comments` and `examples/video-support` are complete plugins to compare against.

## References

[Getting started](references/getting-started.md) · [Rooms](references/rooms.md) · [Presence](references/presence.md) · [Sending from your server](references/sending.md) · [Events from the page](references/events.md) · [Calls](references/calls.md) · [Group calls](references/group-calls.md) · [Call screen](references/call-screen.md) · [Live streams](references/streams.md) · [Encryption and the site users](references/encryption.md) · [PHP reference](references/php-reference.md) · [JavaScript reference](references/javascript-reference.md) · [Errors](references/errors.md) · [Limits](references/limits.md) · [Other servers](references/self-hosted.md) · [The example](references/example.md)
