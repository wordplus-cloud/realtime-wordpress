# Rooms

A room carries events to every page that joined it. Your server sends to it ([sending from your server](sending.md)), and pages may send to it too, as its rule allows ([events from the page](events.md)). A plugin declares the rooms it owns once, by pattern, with what they keep and allow, and decides who may join each.

## Names

- **Up to 200 characters** of `A-Z a-z 0-9 _ - = @ , . ; :`. `order:42` and `chat:34:42` are the usual shape.
- **The rooms of each site are its own.** The `order:42` rooms of two sites never meet.
- **They are separate from the Pusher-compatible API channels.** A Pusher client cannot join them.

## Owning rooms

```php
add_action( 'plugins_loaded', function () {
	// The order of Ben: him, and the shop staff.
	wordplus_realtime()->room( 'order:{id}', function ( $user_id, array $p ) {
		return $user_id > 0 && ( my_shop_customer_of( (int) $p['id'] ) === $user_id || user_can( $user_id, 'manage_woocommerce' ) );
	}, array( 'history' => 20 ) );

	// The chat of Ann and Ben: those two only. They send messages, typing and read ticks.
	wordplus_realtime()->room( 'chat:{a}:{b}', function ( $user_id, array $p ) {
		return in_array( (string) $user_id, array( $p['a'], $p['b'] ), true );
	}, array( 'presence' => true, 'history' => 50, 'emit' => array( 'message', 'typing', 'read' ), 'webhook' => array( 'message' ) ) );

	// The page of the product: anyone, signed in or not, and how many are looking.
	wordplus_realtime()->room( 'product:{id}', null, array( 'public' => true, 'count' => true ) );
} );
```

- **`{name}` matches one or more characters** other than `:` and `.`, as few as the rest of the pattern allows. The rule gets them as `$p['name']`.
- **The rule with the most characters of its own wins.** On a tie, the one declared first. A room no rule matches is refused with `no_rule`.
- **`$user_id`** is the site user: the id of a WordPress user, a visitor negative id a plugin gives (`wordplus_realtime_visitor_id`, as Better Messages does for its guests), or 0 for nobody.
- **The answer** is `false`, `true`, or an array for that user: `info`, what the members of a presence room see of them (their name and picture by default), and `emit` or `readOnly` to narrow what they may send.
- **When it runs:** the page asks for every room it joins in the same moment in one request, and keeps each token until 10 minutes before it expires, across reconnects and moves. Your rule runs when a page first joins and when its token is renewed (6 hours by default, the filter `wordplus_realtime_token_ttl`, at most a day).

## What a room keeps and allows

| Option | Default | |
|---|---|---|
| `presence` | off | Its members are listed with their info. `join` and `leave` tell the others ([presence](presence.md)) |
| `count` | off | A live count of who is in it, at any size, without a list. Presence counts too |
| `history` | none | Events kept for pages that reconnect: a number, up to 1,000, for 5 minutes. Or `array( 'last' => 50, 'days' => 0.002 )` for less (0.002 of a day is about 3 minutes) |
| `emit` | none | Events pages may send to the room: names, or `'*'` for any ([events from the page](events.md)) |
| `webhook` | none | Which of the page events your server gets too ([webhooks](sending.md#webhooks)) |
| `public` | off | Anyone may join, signed in or not. A public room with no rule has its grant in every page, which a cache may keep. Not sealed |
| `seal` | on | Its events, its member info and its history are sealed with the room key ([encryption](encryption.md)) |

The options travel in the room token, signed by the site with the room name, so WordPlus Cloud enforces them and nothing is set in two places.

## Joining in the browser

Your script depends on the SDK handle, and the page gets its settings in `window.wordplusRealtimeConfig`:

```php
wp_enqueue_script( 'my-shop', plugins_url( 'shop.js', __FILE__ ), array( wordplus_realtime()->script() ), '1.0.0', true );
```

```js
const rt = wordplusRealtimeClient.page();   // null on a site without credentials

const order = rt.join( 'order:42' );
order.on( 'updated', ( data, meta ) => refresh( data ) );   // meta: { from, id, at, replayed? }
order.on( 'joined', () => console.log( 'in' ) );
order.on( 'error', ( e ) => console.warn( e.code ) );      // forbidden, no_rule, full, expired …

order.state;   // joining, joined, failed, left
rt.leave( 'order:42' );
```

- **`page()` is the rooms of the page,** the same for the code of every plugin and the call screen. `join()` gives the same room for the same name.
- **Events reach a listener opened:** you never handle sealed values.
- **`meta.from`** is the user who sent it from a page, as the site vouched for them, or nothing for your server. `meta.id` and `meta.at` are the kept event id and time.
- **The events of the room itself** are `joined`, `join`, `leave`, `count` and `error`, and `connected`, `disconnected` and `moved` on `rt`. Nobody can send them.
- **`rt.on( 'error', fn )`** hears the connection refused, with `{ code }`: `not_included`, `not_licensed`, `wrong_origin` … ([errors](errors.md)).

![Ann marks order 42 of Ben as paid in her browser, and the order page of Ben shows Paid at once](https://docs.wordplus.cloud/img/wordpress/channels-order-live.webp)

## History, and nothing lost on a reconnect

A room keeps its events for 5 minutes at most, for recovery. Your plugin keeps its own records, such as the messages of a chat, from the [webhook](events.md#keeping-the-conversation).

- **Kept per room,** as its rule says: every kept event has an id, rising within the room, and the time it was sent. Events over 64 KB are sent but not kept. `volatile` ones are never kept.
- **A reconnect gets what it missed:** a connection back within the history span gets the missed events first, in order, with `meta.replayed`, then the new ones, across the WordPlus Cloud servers and moves.
- **Paging back:** at most 100 a page.

```js
const { events, more } = await order.history( { limit: 50 } );                 // the newest 50, oldest first
const older = await order.history( { before: events[ 0 ].id, limit: 50 } );
```

- **Your server** reads and erases it the same way: `wordplus_realtime()->in( $room )->history()` and `->forget( $id )` ([sending](sending.md#asking-about-a-room)).

## One connection for the whole browser

Every tab and every plugin of a browser rides one connection, the one the WordPlus plugins ride: Better Messages, Easy Stream and the rest. A tab hears only the events of its own rooms. An event a tab sent itself, or one your server sent with `except` naming that tab, does not come back to it.

## Limits

See [limits](limits.md): 1,000 rooms a connection, events of up to 1 MB, and 100,000 members a presence room.
