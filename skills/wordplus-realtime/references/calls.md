# Calls between two people

A call rings on every page the other person has open, and runs straight between the two browsers once answered:

1. **Direct:** the two browsers connect to each other, which is the best picture and sound, at no cost.
2. **Relayed:** when a network allows no direct connection, the media goes through the WordPlus Cloud TURN servers, over UDP or over TLS on port 443.
3. **A room:** when neither works, the call moves to a room on the WordPlus Cloud media servers, on its own and without hanging up.

Either side may [add people](#adding-people) once it is connected, and it goes on as a group call. On every path the media is encrypted end to end: in a room too, with a key only your site gives out.

The [call screen](call-screen.md) does all of this with two HTML elements. This page is for building your own interface.

## Who may call whom

Your plugin owns the calls it names, by pattern, and decides each time someone places or answers one:

```php
add_action( 'plugins_loaded', function () {
	// support:{customer}: a customer calls the agent on their own call, and the agent answers it.
	wordplus_realtime()->calls( 'support:{customer}', function ( $user_id, $with, array $p ) {
		$agent = my_support_agent_id();

		if ( $user_id === $agent ) {
			return (int) $p['customer'] === $with;
		}

		return $with === $agent && (int) $p['customer'] === $user_id;
	} );
} );
```

- **`$user_id`** places or answers the call: the signed-in user, or the id of a visitor ([visitors](#visitors)).
- **`$with`** is the other person: the one being called when `$user_id` places the call, the caller when `$user_id` answers.
- **`$p`** holds the pattern parts, and the fourth argument is the call name, such as `support:42`, which your plugin chooses. Names follow the room rules: up to 200 of `A-Z a-z 0-9 _ - = @ , . ; :`.
- **The answer** is `false`, `true`, or an array whose `info` is what the other side sees of `$user_id`. By default that is their display name and picture: `array( 'name' => …, 'avatar' => … )`.
- **Both sides ask.** The page of the caller asks when placing the call, and that of the callee when answering, so your rule decides for both.
- **The fifth argument says which side asks:** `$side['role']` is `caller` or `callee`. A rule that says yes to every callee and checks only callers lets people answer calls they may not place, such as members who call and visitors who answer: `function ( $user_id, $with, array $p, $call, array $side ) { return 'callee' === $side['role'] || my_is_member( $user_id ); }`.
- **The rule with the most characters of its own wins,** as for rooms. Group calls have rules of their own ([group calls](group-calls.md)).

The site needs a plan that includes calls. Without it a call ends at once, and a page line is refused with `not_included`.

## The browser side

Load the calls script on the pages that place or answer calls:

```php
wp_enqueue_script( 'my-support', plugins_url( 'support.js', __FILE__ ), array( wordplus_realtime()->calls_script() ), '1.0.0', true );
```

```js
// The rooms and calls of the page, shared with the call screen and every other plugin on the page. Null without the settings of the site.
const page = window.wordplusRealtimeCalls && wordplusRealtimeCalls.page();

if ( page ) {
	const { rt, calls } = page;
	// …
}
```

`page()` makes the page calls once, on the page rooms (`wordplusRealtimeClient.page()`), from `window.wordplusRealtimeConfig`. Use it rather than `wordplusRealtimeCalls.calls( rt, config )`, so a page holds one line and a call rings once.

## Placing a call

```js
let call;

try {
	call = await calls.start( 'support:42', { to: 34, type: 'video' } );   // type: 'video' or 'audio'
} catch ( e ) {
	console.warn( e.code );   // forbidden: your rule said no, no_user, auth_failed …
}

call.on( 'state', ( state ) => showState( state ) );   // ringing, connecting, connected, reconnecting, ended
call.on( 'remote', ( remote ) => {
	if ( remote.camera ) remote.camera.attach( document.querySelector( '#their-video' ) );
	if ( remote.microphone ) remote.microphone.attach( document.querySelector( '#their-audio' ) );
} );
call.on( 'ended', ( reason ) => showEnded( reason ) );

const media = await navigator.mediaDevices.getUserMedia( { audio: true, video: true } );
call.setTrack( 'microphone', media.getAudioTracks()[ 0 ] );
call.setTrack( 'camera', media.getVideoTracks()[ 0 ] );
```

Starting the call makes it ring on every page of user 34 that holds their line. It rings for 45 seconds, then ends with `no_answer`.

## Ringing and answering

Every page that loads the calls script for a signed-in user holds that user line, so their calls ring there:

```js
calls.on( 'incoming', ( incoming ) => {
	// incoming.call: the call name, incoming.from: the caller id, incoming.info: what your rule gave for them,
	// incoming.type: 'video' or 'audio'.
	showRing( incoming );

	incoming.on( 'over', ( reason ) => hideRing() );   // answered_elsewhere, rejected, busy, cancelled, no_answer
} );

// The person answers:
const call = await incoming.accept();   // the call, connecting, rejects with `forbidden` when your rule says no
// Or turns it down:
await incoming.decline();               // the caller hears `rejected`, and with decline( 'busy' ) they hear `busy`
```

- **A call rings on every page of the person** at once, on every device. It stops everywhere as soon as they answer or decline on one, with `over`.
- **A page opened while a call rings** rings too.
- **`calls.incoming()`** lists the calls ringing now.
- **A page that should not ring** passes `ring: false` in its settings, or calls `calls.stopRinging()`.

![The browser of Ben calling Ann, and the page of Ann with the ring: Ben is calling you (video), with Decline and Accept](https://docs.wordplus.cloud/img/wordpress/calls-ringing.webp)

## The call

| Member | |
|---|---|
| `id` | this attempt at the call, made by the caller page |
| `name`, `type`, `role` | the call name, `video` or `audio`, and `caller` or `callee` |
| `peer` | `{ user, info }`: the other person |
| `state` | `ringing` (the caller, until answered), `connecting`, `connected`, `reconnecting`, `ended` |
| `path` | `direct`, `relay` or `room`: what carries it now |
| `remote` | the tracks of the other side, `camera`, `microphone`, `screen` and `screenAudio`, each with `attach( element )` and `detach()`, `media` (what they have switched on) and `quality` (`excellent`, `good`, `poor`, `lost`) |
| `endReason` | why it ended |
| `setTrack( source, track )` | what this page sends from `camera`, `microphone`, `screen_share` or `screen_share_audio`. `null` stops sending it |
| `add( user )` | rings `user` into the call, which becomes a group call ([adding people](#adding-people)) |
| `end()` | hangs up, or calls it off while it still rings (`cancelled`) |

Events: `state`, `path`, `remote`, `reacquire` (the other side stopped hearing this page microphone or camera: open the device again), `autoplay_blocked` (the browser needs a click before it plays the sound), `group` (someone was added, and the call goes on as this group call), and `ended`.

**Mute** by sending `null` for the microphone and the track again to unmute. **Turn the camera off** the same way, and stop the track so the camera light goes off. **Share a screen** with `getDisplayMedia()`, sending its video as `screen_share` and its sound as `screen_share_audio`. The sources of each side reach the other as they are, so a screen share arrives as `remote.screen` beside the camera.

![The video call, connected on both sides: Ben sees Ann and Ann sees Ben, each with their own picture in the corner](https://docs.wordplus.cloud/img/wordpress/calls-connected.webp)

## Adding people

Once a call is connected, either side may ring someone else into it. The call becomes a group call: both pages go on in a room of their own on the WordPlus Cloud media servers, without hanging up, and the person is rung on every page they have open.

```js
// Both sides: the call goes on as this group call.
call.on( 'group', ( group ) => showGroupCall( group ) );

let invite;

try {
	invite = await call.add( 43 );   // rings user 43 into it
} catch ( e ) {
	console.warn( e.code );   // forbidden: your rule said no, not_connected, already_in, ringing, full …
}

invite.on( 'state', ( state ) => showRing( invite.to, state ) );   // answered, rejected, busy, no_answer or cancelled
invite.cancel();                                                    // calls it off while it rings
```

![The call window of Ann with Add person open, listing Cara, and the page of Cara ringing: Ann is adding you to a video call](https://docs.wordplus.cloud/img/wordpress/calls-add-person.webp)

- **Your rule decides,** as for any call: `$user_id` calling the person (`$with`) about the call name, then the person taking a call from them. A customer your rule lets call only the agent can add nobody else.
- **`group` comes on both sides,** connecting, and already sending what the page sent to the call. The call then ends with `group`. Send from then on with `group.setTrack()`, and leave with `group.leave()`. It is a [group call](group-calls.md#a-call-that-became-a-group-call) in every other way.
- **The person rung in** gets `incoming` as for a call, with `incoming.group` set to the call id. `accept()` answers with the group call.
- **Everyone in it may add more** with `group.add( user )`, and hears who is rung in with the group call `invite` event.
- **It stays encrypted end to end,** with the key your site gives only to the people in the call: the two who started it, and those one of them rang in once they answer.

![The group call that the call of Ben became, in the windows of Ben and Cara: each sees the other two, the title names them, and a lock says it is encrypted end to end](https://docs.wordplus.cloud/img/wordpress/calls-group.webp)

## Why a call ended

| Reason | |
|---|---|
| `hangup` | a side hung up |
| `cancelled` | the caller hung up before an answer |
| `rejected`, `busy` | the callee declined, or said they were busy |
| `no_answer` | nobody answered within 45 seconds |
| `page_closed` | a side closed its page |
| `peer_lost` | the connection of one side did not come back within 45 seconds |
| `room_lost` | the room it moved to gave up |
| `group` | someone was added: it goes on as the group call `group` gave |
| `group_failed`, `encryption_unsupported` | someone was added, and this page could not take its place in the room, or its browser cannot encrypt the media of a room |
| `not_included`, `forbidden`, `bad_token`, `expired` | the server refused to start it: the plan does not include calls, or the token was not one it takes ([errors](errors.md)) |
| `no_call`, `call_ended` | answered after the caller had given up |
| `signaling_unavailable` | the page connection was down when it started |

## What WordPlus Cloud sees

- **Your site decides** every call: the server takes only tokens your site signed, for the people and the call it named, with a key derived from its secret.
- **The negotiation of the two browsers is sealed** with a key your site derives from its own WordPress salt, which WordPlus Cloud never sees. The servers relay and store it encrypted, so they cannot read the call addresses or codecs.
- **The media** is encrypted end to end by WebRTC on a direct or relayed path. In a room, every frame is encrypted in the browser before it leaves, with a key your site derives from its own master key and gives only to the people in the call. The media servers forward what they cannot read.

## Visitors

A visitor calls, and is called, once your plugin gives them an id: a negative number, which cannot be the id of a WordPress user.

```php
add_filter( 'wordplus_realtime_visitor_id', function ( $id ) {
	$guest = my_plugin_guest_id();   // your own, kept in a cookie
	return $guest ? -1 * $guest : $id;
} );
```

## How it works

- **Lines:** each page holds its user line on the shared connection, with a token the site signs (`POST /wp-json/wordplus/v1/realtime/calls` with `{ line: true }`).
- **Placing:** the caller page asks the site for its token (`{ call, id, role: 'caller', to, type }`). Its first join makes the call and rings the lines of the callee.
- **Answering:** the callee page asks for its own (`{ call, id, role: 'callee', from, type }`) and joins. The server lets in only the person the caller rang, for the call it rang about.
- **Adding:** the page asks the site for a token for the ring (`{ call, id, role: 'caller', to, type, group, pair, member }`, `group` being the call id). The server makes the call a group call the first time, tells both pages to take their places in its room, and rings the lines of the person. Their answer is a token for that ring (`role: 'callee'`, with `group`, `pair` and `ring`).
- **Who is in a call** is for the site to say, with proofs made with its master key, which WordPlus Cloud never sees. Every grant for a call names its two people (`pair`) and carries the user proof of being in it (`member`). Ringing someone in needs that proof, and gives the proof the person was rung (`ring`), which the server hands them with the ring and their answer needs. The server carries the proofs and cannot make one, so the tokens of a call and the key of its rooms go only to its two people and those they, or anyone they rang in, rang in.
- **The engine** is the one-to-one call engine Better Messages runs: it picks the best video codec both sides handle in hardware, restarts ICE on a network change, tries TURN twice before the room, and keeps the call through a reconnect of up to 45 seconds.
