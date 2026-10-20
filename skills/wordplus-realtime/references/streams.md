# Live streams

One person presents live to everyone watching: the picture, a chat beside it, reactions, and the count of who watches. The host goes live from the browser or streams from OBS. A live stream runs on the media servers of WordPlus Cloud, for a site whose WordPlus Cloud plan includes live streaming.

## Who is who

Your plugin owns streams by pattern, as it owns rooms and calls. The rule says who each person is in the stream:

```php
wordplus_realtime()->streams( 'class-live:{id}', function ( $user_id, array $p, $name ) {
	$class = (int) $p['id'];

	if ( my_school_teacher_of( $class ) === $user_id ) {
		return 'host';
	}

	return my_school_student_of( $class, $user_id ) ? 'viewer' : false;
}, array( 'reactions' => true ) );
```

- **The answer:** `false`, `'host'` or `'viewer'`, or an array for more:

  | Key | |
  |---|---|
  | `role` | `host` or `viewer` |
  | `info` | `name` and an `https://` `avatar`, as everyone sees them. The display name and picture of the user by default |
  | `chat` | `write` or `read` |
  | `mod` | `true` for someone who keeps the chat without hosting |
  | `src` | what the host may send: `camera`, `microphone`, `screen` |
  | `quality` | the best picture the host sends: `720p` or `1080p` |

- **A visitor who is not signed in** comes with `$user_id` 0, and may only be a viewer.
- **The settings of the stream**, the third argument, each a value or a callable of the parts of the name:
  - `stage`: whether viewers come on stage as guests ([below](#guests-on-stage)), yes unless `false`.
  - `reactions`: whether it takes reactions.
  - `people`: who may see who is watching, `mods` or `all`.
  - `chat`: `array( 'offline' => 'open' | 'closed', 'links' => …, 'fresh' => … )`, for the chat while the stream is not live, whether the links of everyone are taken, and whether going live empties it.

The calls route the package registers answers streams too.

## Drawn ready

Optional, as every ready-made part: [in the browser](#in-the-browser) below draws the stream with no element. This is the ready-made one.

The stream as Easy Stream draws it: the player, the chat beside it, and for its host the studio, with the camera and microphone, the picture before going live, OBS, Go live and End stream. Enqueue it on the pages that show a stream, and put the element where it goes:

```php
add_action( 'wp_enqueue_scripts', function () {
	if ( is_singular( 'class' ) ) {
		wordplus_realtime()->stream_screen();
	}
} );

// In the template of the class:
echo wordplus_realtime()->stream_element( 'class-live:' . get_the_ID(), array( 'title' => get_the_title() ) );
```

- **`stream_element( $name, $attributes )`** writes `<live-stream>`, escaped. Its parts apart, each where the page wants it: `'view' => 'player'`, `'chat'` (with `'height' => 480`), `'details'` or `'studio'`. The parts of one stream share one join.
- **Its attributes:** `title`, `cover`, `url` (the page to share), `login-url` (where a visitor signs in to chat, such as `wp_login_url( get_permalink() )`), `studio-url`, `chat` (`'off'`) and `sticky` (`true`).
- **Its words** follow the language of the site, as the call screen does, with the same `wordplus_realtime_screen_strings` filter for words of your own.
- **Ringing:** `stream_screen()` leaves calls as they are. A page where calls should not ring calls `wordplus_realtime()->ui()` too.
- **Its look** is its own, drawn in the page: every class starts with `estream-`.

## In the browser

The same stream on markup of your own:

```js
const { calls } = wordplusRealtimeCalls.page();

const show = await calls.stream( 'class-live:7' );   // rejects with `forbidden` when your rule says no

show.watch( document.querySelector( '#live video' ) );   // the main picture of the stream, and its sound
show.on( 'state', ( state ) => showState( state ) );     // idle, live, ended
show.on( 'viewers', ( n ) => showCount( n ) );
show.on( 'message', ( m ) => addLine( m.from.name, m.text ) );
await show.chat.send( 'Hello!' );

if ( show.role === 'host' ) {
	await show.preview();    // the camera, shown in the same video
	await show.goLive();
	// …
	await show.end();
}
```

- **The page** needs the calls script (`wordplus_realtime()->calls_script()`), as for calls. The script of the stream loads beside the rooms script the first time a page joins a stream: a page with calls alone never fetches it.
- **Sound** plays from the page, and the `video` stays `muted`. Where the browser holds sound back until a click (`show.snapshot().audioBlocked`), call `show.startAudio()` from one.
- **Everything else** is the same on every platform: reactions, keeping the chat, OBS, a screen of your own and the refusals ([live streams for apps](https://docs.wordplus.cloud/apps/streams/)).

## Guests on stage

A viewer raises a hand, the host invites them, and they come on stage beside the host with their camera and microphone, for everyone watching: a question from the class, an interview, a panel. The ready-made player and studio show all of it. On markup of your own:

```js
// The page of a viewer:
raiseButton.onclick = () => show.hand( true );         // show.hand( false ) takes it down
show.on( 'invited', () => offerToJoin() );
joinButton.onclick = () => show.joinStage();          // on stage, the camera and microphone live
show.on( 'stage', ( on ) => showOnStage( on ) );

// The page of the host:
show.on( 'hands', ( hands ) => drawHands( hands ) );  // [ { user, name, at } ], the oldest first
await show.invite( hands[ 0 ].user );                  // or anyone watching, by their user id
await show.unstage( 34 );                              // off stage, back to watching
await show.layout( 'speaker' );                        // 'grid', 'speaker', or 'spotlight' with a user id
```

A guest sends the camera and microphone, the picture up to 720p. A visitor who is not signed in does not come on stage (`anonymous`), and a stream whose settings say `'stage' => false` takes no hands (`no_stage`).

## From the server

PHP reads a stream and keeps its chat as its moderators do, with no page open. Each change reaches everyone watching at once:

```php
$show = wordplus_realtime()->stream( 'class-live:7' );

wordplus_realtime()->list_streams();             // those live now: array( array( 'name' => …, 'started_at' => …, 'viewers' => … ) )
$show->get();                                    // its state, viewers, peak, slow mode, reactions and pinned message
$show->people();                                 // array( 'watching' => 120, 'people' => array( array( 'user' => '7', 'name' => …, 'role' => 'viewer' ), … ) )
$show->chat( 50 );                               // the last messages, oldest first
$show->say( 'The quiz starts in five minutes', 'Course bot', 'https://example.com/bot.png' );
$show->delete_message( $id );
$show->pin( $id );                               // null unpins
$show->slow( 30 );                               // 0 turns it off
$show->timeout( 7, 600 );                        // untimeout( 7 ) lifts it
$show->kick( 7 );                                // out now, free to come back
$show->ban( 7 );                                 // unban( 7 ) lifts it, bans() lists them
$show->reactions( false );
$show->end();
```

A message from the site shows as a host message, with the name and https picture you give it, so nobody may ban it. A host is never put out or timed out: the call answers a `WP_Error` (`host`).

## What WordPlus Cloud sees

A stream is for everyone watching it, so its picture and chat are not encrypted end to end. They are encrypted on the way, and the media servers of WordPlus Cloud see them, as a stream needs.
