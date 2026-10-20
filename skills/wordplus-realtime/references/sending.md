# Sending from your server

Your server sends events to rooms and to users, asks about rooms and who is online, and hears what happens in rooms by webhook.

```php
$sent = wordplus_realtime()->to( 'order:42' )->emit( 'updated', array( 'status' => 'paid' ) );

if ( is_wp_error( $sent ) ) {
	error_log( 'realtime: ' . $sent->get_error_code() );   // not_connected, not_included, bad_room …
}
```

## To rooms

`to( $rooms )->emit( $event, $data = null, $options = array() )`

- **`$rooms`:** the name of one room, or up to 1,000.
- **`$event`:** its name. `joined`, `join`, `leave`, `count` and `error` are kept for the rooms themselves and refused.
- **`$data`:** anything JSON can carry, up to 1 MB.
- **`$options['seal']`:** `false` sends the data plain. By default the data of a sealed room goes sealed with its key, each such room getting its own copy, and those of the others plain ([encryption](encryption.md)).
- **Kept:** in each room whose rule keeps `history`, for 5 minutes. The answer is the kept event ids by room, or a `WP_Error` whose code is the server reason ([errors](errors.md)).

## Not back to the tab that made the change

`except( $tab )` skips the tab whose action made the event. The page sends its tab name with its request, and `tab()` reads it:

```js
const rt = wordplusRealtimeClient.page();
fetch( '/wp-json/my-shop/v1/orders/42/pay', { method: 'POST', headers: { 'X-Realtime-Tab': rt.tab, 'X-WP-Nonce': nonce } } );
```

```php
wordplus_realtime()->to( 'order:42' )->except( wordplus_realtime()->tab() )->emit( 'updated', $data );
```

## To users

`to_user( $users )->emit( $event, $data )` reaches every connection the users have open, whatever rooms they are in: a notice, a badge. The data of a user goes sealed with their own key, which only they hold. On the page, `rt.on( 'notice', ( data ) => … )`.

```php
wordplus_realtime()->to_user( 42 )->emit( 'notice', array( 'text' => 'Your order shipped' ) );
wordplus_realtime()->to( 'order:42' )->to_user( array( 34, 43 ) )->emit( 'updated', $data );   // both at once
```

## Several at once

`batch( $events )` sends several emits, each an array of `rooms`, `users`, `event`, `data`, `except` and `seal`, and answers the ids of each or `WP_Error`. An emit to many sealed rooms goes in requests of 100.

## Asking about a room

```php
$room = wordplus_realtime()->in( 'board:1' );

$room->count();                              // how many are in it
$room->members();                            // of a presence room: array( 'count' => 2, 'list' => array( array( 'id' => '7', 'info' => array( 'name' => 'Ann' ) ), … ) )
$room->history( array( 'limit' => 50 ) );    // array( 'events' => …, 'more' => false ), oldest first, the data of each event opened
$room->forget( $id );                        // erases one event of its history, or all of it without an id
$room->kick( 43 );                           // out now, back only if your rule lets them in again, and the room key moves on
```

Each answers a `WP_Error` when the server refuses. `wordplus_realtime()->online()` asks who is online: `has( $user )`, `count()`, `list( $cursor )`, `states( $users )` ([presence](presence.md#who-is-online-across-the-site)).

## The rooms in use

```php
$page = wordplus_realtime()->list_rooms( array( 'prefix' => 'board:' ) );   // array( 'count' => 2, 'rooms' => array( array( 'name' => 'board:1', 'count' => 3, 'connections' => 3 ), … ) )
```

A page has 100 rooms, or `limit` up to 1,000. While there are more, send `next` back as `cursor`.

## A user

```php
$user = wordplus_realtime()->for_user( 42 );

$user->get();                                              // array( 'id' => '42', 'online' => true, 'connections' => 2 )
$user->disconnect();                                       // out of everything at once
$replies = $user->ask( 'cart', array( 'why' => 'checkout' ) );   // array( array( 'data' => …, 'at' => … ) )
```

- **`disconnect()`** takes the user out of every room, call and live stream at once, on every connection. Their pages ask the site again, and the tokens signed for them before are refused, so your rules decide whether they come back. Call it when you log a user out of every device, change their password, or block them: they are out within a second, not when their token runs out. Their pages hear `signed_out`.
- **`ask()`** sends an event to the open pages of the user and waits for their replies: the first, or with `'all' => true` every one within `'timeout'` (10 seconds by default, a minute at most). A page answers with `rt.answer( 'cart', ( data ) => reply )`. The question and the replies are sealed with the key of the user.

## What the site uses

```php
$usage = wordplus_realtime()->usage();   // array( 'connections' => array( 'now' => 312, 'limit' => null ), 'credits' => … )
```

The credits are those of your account, a credit a minute: `plan` left this month, `bought`, `borrowed`, the monthly `allowance`, and `admit`, whether new viewers and people above the unmetered floor get in.

## Webhooks

WordPlus Cloud tells your site what happens in rooms, at the route the package registers, `/?rest_route=/wordplus/v1/realtime/webhook`, which WordPlus Cloud knows for every site with its credentials: nothing to set.

```php
add_action( 'plugins_loaded', function () {
	// The rule of a room says which events of the pages come here too
	wordplus_realtime()->room( 'chat:{a}:{b}', $is_one_of, array( 'history' => 50, 'emit' => array( 'message', 'typing' ), 'webhook' => array( 'message' ) ) );

	wordplus_realtime()->on( 'message', function ( array $e ) {
		my_chat_save( $e['event_id'], $e['room'], $e['from'], $e['data']['text'], $e['at'] );   // a repeat has the same event_id
	} );
	wordplus_realtime()->on( 'user.offline', function ( array $e ) {
		update_user_meta( (int) $e['user'], 'my_away', 1 );
	} );
} );
```

| Event | |
|---|---|
| a page event name | `id`, `at`, `room`, `event`, `data`, `from`, `event_id`, for the events a room rule names in `webhook`. `event_id` is the id the pages saw (`meta.id`), what your plugin keeps it by |
| `room.occupied`, `room.vacated` | `id`, `at`, `room`: the first one in, the last one out |
| `member.joined`, `member.left` | `id`, `at`, `room`, `user`, in a presence room |
| `user.online`, `user.offline` | `id`, `at`, `user` |
| `webhook.test` | `id`, `at`: sent once when the site asks for it, below |
| `*` | every one of them |

- **Signed** with a key of its own derived from the site secret, and checked before a handler sees it. Sealed data comes opened.
- **Batched,** and sent **at least once:** each event has its id, so a repeat can be dropped. A request that fails, or a handler that throws, is tried again, later each time, for 24 hours.

```php
$deliveries = wordplus_realtime()->webhooks()->deliveries();   // the last 100 tries, the newest first, each with its status and whether it is resendable
wordplus_realtime()->webhooks()->resend( $deliveries[0]['id'] );
wordplus_realtime()->webhooks()->test();                        // one webhook.test event, now
```

## How it is signed

Every request is signed as the site, with a key derived from its secret: an HMAC-SHA256 over the timestamp, the method, the path and the body SHA-256, accepted within 5 minutes of its timestamp. The site clock must be right within those 5 minutes, or the server answers `stale_signature`. You never handle the secret yourself.

## Where it goes

To `https://rest.wordplus.cloud/` by default. The filter `wordplus_realtime_api_server` names another server ([self-hosted](self-hosted.md)).
