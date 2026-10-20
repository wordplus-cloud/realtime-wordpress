# Group calls

A group call is a room on the WordPlus Cloud media servers. Everyone in it sends their camera, microphone and screen once, and gets those of everyone else. The servers form a mesh across regions, so the people of a group call may sit on different servers, each joining the one nearest them.

There are two kinds:

- **A group call your plugin names,** such as `class:7`, which people join: this page.
- **A call between two people that became one** when either side [added someone](calls.md#adding-people). It belongs to the call, and its people are the ones who were in it or were rung in: [below](#a-call-that-became-a-group-call).

The `<room-button>` of the [call screen](call-screen.md) joins one with no code. This page is for building your own interface.

## Who may join

```php
wordplus_realtime()->group_calls( 'class:{id}', function ( $user_id, array $p, $name ) {
	$class = (int) $p['id'];

	if ( my_school_teacher_of( $class ) === $user_id ) {
		return array( 'admin' => true );       // the teacher speaks, and hosts: mutes, lets speak, removes
	}

	return my_school_student_of( $class, $user_id ) ? array( 'publish' => false ) : false;   // students watch
} );
```

The array may say what the user does in it:

| Key | Default | |
|---|---|---|
| `info` | name and picture | what the others see of them |
| `publish` | `true` | sends their camera, microphone and screen |
| `subscribe` | `true` | gets those of the others |
| `admin` | `false` | hosts the call: the call screen gives them Mute Microphone, Block and Allow Broadcast (to listening and back to speaking) and Kick User on the tile of each of the others. Each goes to the calls route, which asks your rule again for whoever clicked and acts only for a host. Your own buttons call the same from your PHP ([from the server](#from-the-server)) |
| `hidden` | `false` | is not listed to the others, as for a silent observer |

## Encrypted end to end

Pass `encrypt` with the pattern, and its group call media is encrypted end to end:

```php
wordplus_realtime()->group_calls( 'class:{id}', $rule, array( 'encrypt' => true ) );
```

- **Every frame is encrypted in the browser** before it leaves, and decrypted in the browsers of the people in it. The media servers forward what they cannot read.
- **The key belongs to your site,** derived from its master key ([encryption](encryption.md)). It comes with the group call token, so only someone your rule lets in has it.
- **The browser** needs to encrypt each frame, which every current browser does. One that cannot is refused with `encryption_unsupported` rather than sending in the clear.
- **Each frame costs a little processing,** in each browser, for each picture it sends and gets. It does not change what a group call may hold.

The rooms of a call are always encrypted: the room a call moves to when no direct path works, and the group call a call became.

## Joining in the browser

```js
const { calls } = wordplusRealtimeCalls.page();

const group = await calls.group( 'class:7', { type: 'video' } );   // rejects with `forbidden` when your rule says no

group.on( 'state', ( state ) => showState( state ) );            // connecting, waiting, connected, reconnecting, ended
group.on( 'person', ( person ) => drawPerson( person ) );         // someone arrived, or what they send changed
group.on( 'person_left', ( person ) => removePerson( person.identity ) );
group.on( 'speakers', ( people ) => markSpeaking( people ) );
group.on( 'ended', ( reason ) => showEnded( reason ) );

const media = await navigator.mediaDevices.getUserMedia( { audio: true, video: true } );
await group.setTrack( 'microphone', media.getAudioTracks()[ 0 ] );
await group.setTrack( 'camera', media.getVideoTracks()[ 0 ] );

// Later:
group.leave();
```

- **`calls.group()` resolves at once** with the group call connecting. Tracks set before it connects are sent once it does.
- **`group.people()`** lists everyone else in it now.
- **A person** is `{ identity, user, info, camera, microphone, screen, screenAudio, speaking, publish }`. `user` is their user id on the site, `info` what your rule gave for them, `publish` whether they may send, and each track has `attach( element )` and `detach()`.
- **`group.encrypted`** says whether its media is encrypted end to end.
- **`group.livekit`** is the room of the media server client itself, for what the kit does not wrap: group calls are LiveKit rooms on the WordPlus Cloud servers.
- **`group.on( 'error', … )`** hears `publish_failed` (a track it could not send) and `encryption_failed` (a frame it could not encrypt or decrypt).

![The group call of order 42 in the browser of Ann, made large: Ann, Ben and Cara on video, a lock beside the title as its plugin encrypts it](https://docs.wordplus.cloud/img/wordpress/group-calls-order-room.webp)

## Speakers and listeners

A class, a town hall or an audio room: a few speak and everyone else listens, and a listener raises a hand to be let on. Your rule makes the listeners, a room of the same name carries the hands, and PHP lets someone speak while the call runs:

```php
wordplus_realtime()->group_calls( 'class:{id}', function ( $user_id, array $p ) {
	$class = (int) $p['id'];

	if ( my_school_teacher_of( $class ) === $user_id ) {
		return true;   // speaks, and lets students speak through a request of yours
	}
	if ( ! my_school_student_of( $class, $user_id ) ) {
		return false;
	}

	return array( 'publish' => my_school_may_speak( $class, $user_id ) );   // a listener until let on
} );
wordplus_realtime()->room( 'class:{id}', function ( $user_id, array $p ) {
	return my_school_teacher_of( (int) $p['id'] ) === $user_id || my_school_student_of( (int) $p['id'], $user_id );
}, array( 'emit' => array( 'hand' ) ) );

// In the REST route of the Let speak button, once the teacher is checked:
my_school_set_may_speak( $class, $student, true );   // what the rule reads for every join after
wordplus_realtime()->call( 'class:' . $class )->permit( $student, array( 'publish' => true ) );
```

The page of a student:

```js
const { rt, calls } = wordplusRealtimeCalls.page();
const group = await calls.group( 'class:7', { type: 'audio' } );
const room = rt.join( 'class:7' );

handButton.onclick = () => room.emit( 'hand', { up: true } );
room.on( 'hand', ( { up }, { from } ) => showHand( from, up ) );   // the page of the teacher shows the hands

let microphone = null;
group.on( 'permissions', async ( { publish } ) => {
	if ( publish ) {
		microphone = ( await navigator.mediaDevices.getUserMedia( { audio: true } ) ).getAudioTracks()[ 0 ];
		await group.setTrack( 'microphone', microphone );   // let on: it speaks
	} else {
		microphone?.stop();                                 // back to listening: the light goes off
	}
} );
```

- **`group.can`** is what the page may do now, `{ publish, subscribe }`: what your rule said, then what PHP changed.
- **`permit( $user, array( 'publish' => true ) )`** is theirs at once when they are in the call, and their page hears `permissions`. Back to listening, the media server takes down what they sent. `subscribe` stops or starts what they get of the others.
- **A token signed for them before** follows the change too, so an older one cannot undo it. A token signed after follows your rule, so keep who may speak where the rule reads it.
- **Everyone sees who may speak:** `person.publish`, each person coming again as `person` when it changes.

## A call that became a group call

When either side of a call [adds someone](calls.md#adding-people), both get its group call with the call `group` event. The person rung in gets it from `incoming.accept()`. It is a `GroupCall` as above, encrypted end to end, with what the group call of a call adds:

```js
call.on( 'group', ( group ) => {
	// group.group: the call id

	group.on( 'invite', ( invite ) => {                                 // someone is rung in, by anyone in it
		showRinging( invite.to );
		invite.on( 'state', ( state ) => state !== 'ringing' && hideRinging( invite.to ) );
	} );
} );

const invite = await group.add( 56 );   // rings 56 in too
```

- **`group.add( user )`** rings someone in, as `call.add()` does, and resolves with the ring. Your calls rule decides as for a call. In a group call your plugin named, it rejects with `not_a_call`.
- **A ring** (`Invite`) is `{ id, group, from, to, state }`. `state` is `ringing`, then `answered`, `rejected`, `busy`, `no_answer` (after 45 seconds) or `cancelled`, and its `state` event says each change. `cancel()` calls it off, from the page that rang.
- **`group.invites()`** lists the rings this page heard of.
- **Everyone in it hears every ring** on their line, so each page may show who is being rung in.
- **Leaving** is `group.leave()`. The others go on. The call ends for nobody but the one who left.

## From the server

PHP sees the group calls going on and runs them, with no page open:

```php
wordplus_realtime()->list_calls();                         // array( array( 'name' => 'team:3', 'people' => 4, 'started_at' => … ) )
$call = wordplus_realtime()->call( 'team:3' );
$call->get();                                              // its people: user, joined_at, camera, microphone, screen
$call->mute( 43, 'microphone' );                           // 'camera' or 'screen' too, they may turn it on again
$call->permit( 43, array( 'publish' => false ) );          // a listener now, as above
$call->remove( 43 );                                       // out now, their tokens from before refused
$call->end();                                              // out, everyone
```

`get()` answers who is in the call now. With nobody in it, `people` is 0, `started_at` null and `list` empty, no error. A call that became a group call is named `call:` and its id. A call between two people runs between their browsers, so it is not listed.

## Limits

32 people in a video group call and 50 in an audio one. The type is the one the first person joined with. A group call that comes from a call has the type of that call. The site plan also holds how many people are in group calls, and how many group calls run, at once ([limits](limits.md)).

## Where it runs

A group call your plugin names is `sdk_<site key>_<name>` on the mesh, and the group call of a call `sdk_<site key>_call:<call id>`, apart from the site Better Messages rooms and live streams. The page loads the media client only when it first joins one (`realtime-rooms.min.js`, about 580 KB), so a page that never joins one never loads it, and its encryption worker (`realtime-rooms-e2ee.worker.js`, about 100 KB) only for an encrypted one.
