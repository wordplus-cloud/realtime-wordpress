# The call screen

The Better Messages call screens on any page, with no JavaScript to write: a call button, a group call button, the ring for incoming calls, and the call window with the usual controls. With them come the other ready-made parts of Better Messages: who is in a room ([presence](presence.md#ready-made)) and the chat ([events](events.md#ready-made-the-chat)).

Optional, as every ready-made part: [from your own code](#from-your-own-code) and [your own screen](#your-own-screen-for-the-calls-of-your-plugin) below place, answer and draw calls with no element.

```php
add_action( 'wp_enqueue_scripts', function () {
	if ( is_user_logged_in() ) {
		wordplus_realtime()->call_screen();
	}
} );
```

```html
<call-button to="34" call="support:34:42" type="video" name="Ann" avatar="https://…/ann.jpg">Call Ann</call-button>
<room-button room="staff:daily" type="video" title="Staff meeting">Join the staff meeting</room-button>
<online-list room="shop" call="support:{pair}" type="video"></online-list>   <!-- a call button on the row of every member -->
```

`{pair}` in `call` is filled in with the page user and the one called, in order, on either element: `support:{pair}` is `support:34:42` whichever of the two calls.

Who may call whom is still for your plugin to decide, in its `calls()` and `group_calls()` rules ([calls](calls.md), [group calls](group-calls.md)). The screen shows the refusal it gets.

![Ben has pressed a video call button: his browser shows the call window calling Ann, over his own camera, and the browser of Ann rings, with buttons to answer and decline](https://docs.wordplus.cloud/img/apps/calls-ringing.webp)

## Where to load it

`call_screen()` enqueues the screen and everything it runs on (`realtime-ui.min.js` after the calls script), and returns `false` on a site without credentials. Call it while scripts are enqueued (`wp_enqueue_scripts`):

- **On the pages with the buttons,** so they work.
- **On every page a person may be called on.** A call rings only on pages that load the screen (or your own calls code). The calls of a support agent ring on any page of the site they have open, when every page loads it.
- **`ui()`** loads the same parts on a page that should not ring: its buttons, who is in a room and the chat work, and the page holds no line, so the user calls ring only on their other pages. `call_screen( array( 'ring' => false ) )` is the same.

The media client for group calls loads only when one is joined.

## `<call-button>`

A button that places a call between two people.

| Attribute | |
|---|---|
| `to` | the user id to call |
| `call` | the call name, which your `calls()` rule owns |
| `type` | `video` (default) or `audio` |
| `name`, `avatar` | how the window shows the person called |

## `<room-button>`

A button that joins a group call.

| Attribute | |
|---|---|
| `room` | the group call name, which your `group_calls()` rule owns |
| `type` | `video` (default) or `audio` |
| `title` | the window title |

## The ring and the call window

- **The ring:** when the page user is called, the Better Messages ring says who calls, with Accept and Decline, and a ring tone plays (where the browser allows sound before a click). It goes as soon as the call stops ringing anywhere: answered or declined on another tab or device, called off, or unanswered. A ring into a group call says who is adding the user.
- **The call window:** the picture and sound of the other side, the camera of the page, the status, a timer, and mute, camera, screen share and hang up. A group call grid with the speakers marked. A lock says when its media is encrypted end to end.
- **Add person,** once a call is up, when your plugin lists people the user may add (below). The window goes on as the group call the call became.

It opens the camera and the microphone when the call starts, and stops them when it ends, so the camera light goes off with the call.

![Ann has answered: each browser shows the other person camera, their own in a corner, and the call controls. The cameras are illustrations](https://docs.wordplus.cloud/img/apps/calls-connected.webp)

### Whom it offers to add

The screen offers no one until your plugin lists people, with `people` where it declares its calls:

```php
wordplus_realtime()->calls( 'support:{a}:{b}', $rule, array(
	'people' => function ( $user_id, $call ) {
		return get_users( array( 'role' => 'editor', 'fields' => 'ID' ) );   // the shop staff
	},
) );
```

It answers user ids. The window lists each with their name and picture, leaving out anyone your rule would not let the user call about `$call`, the user themselves, and anyone already in the call. It asks once a call is up, so a page that never calls never asks.

![Ann, Ben and Cara in one group call from three browsers, with the call screen grid: each sees the other two and their own camera, then the call controls. The cameras are illustrations](https://docs.wordplus.cloud/img/apps/rooms-meeting.webp)

## Its words

The screens carry their own words in English, German, Spanish, French, Italian, Dutch, Polish, Croatian and Hebrew, and show them in the site language (`determine_locale()`). The filter `wordplus_realtime_screen_strings` changes any of them by its English text, a plural as a list of its forms:

```php
add_filter( 'wordplus_realtime_screen_strings', function ( $strings ) {
	$strings['Add Person'] = __( 'Invite', 'my-plugin' );
	return $strings;
} );
```

## Their names

The elements have plain names, so the pages of a site name nothing but the site. The filter `wordplus_realtime_element_prefix` puts a name of the site before each, for markup all its own, or where another plugin has an element of the same name:

```php
add_filter( 'wordplus_realtime_element_prefix', function () {
	return 'shop';
} );
```

The elements are then `<shop-call-button>`, `<shop-room-button>`, `<shop-chat-room>` and the rest. A plugin writes each name through `wordplus_realtime()->element_name( 'call-button' )`, so its markup follows whatever the site sets, as `stream_element()` does for `<live-stream>`. One prefix a site: lowercase letters and digits, starting with a letter, with hyphens between them.

## Its look

The look of Better Messages, drawn in shadow roots, so the styles of a theme do not reach in. Its colours and corners are the Better Messages custom properties, set on the page, such as `--bm-color-accent: 37, 99, 235` (red, green and blue). Right-to-left pages mirror it.

## From your own code

The screen is also `window.wordplusRealtimeUi`:

```js
wordplusRealtimeUi.place( 'support:34:42', 34, 'video', { name: 'Ann' } );   // what <call-button> does
wordplusRealtimeUi.join( 'staff:daily', 'video', 'Staff meeting' );          // what <room-button> does
```

It starts by itself once the page has loaded. It uses the page rooms and calls (`wordplusRealtimeCalls.page()`), so your own code on the same page shares its line and its calls.

## Your own screen for the calls of your plugin

The screen is shared by every plugin on the site. Your plugin can take the calls it declares onto a screen of its own, and leave the rest on the shared one:

```js
wordplusRealtimeUi.own( 'support:{a}:{b}', ( owned ) => {
    if ( owned.kind === 'ring' ) showMyRing( owned.incoming );     // incoming.accept(), incoming.decline()
    if ( owned.kind === 'call' ) showMyCall( owned.call );          // the call <call-button> placed
    if ( owned.kind === 'group' ) showMyMeeting( owned.group );     // the group call <room-button> joined
} );
```

- **The pattern** is that of your rule, as `calls()` or `group_calls()` declares it: each `{name}` is one part between colons.
- **What you get** are the objects of the calls script itself, the ones `wordplusRealtimeCalls` gives your own code ([JavaScript reference](javascript-reference.md)): answer, show and end them as your screen does.
- **Its rings and calls never reach the shared screen,** nor does it answer them busy while it shows another call.
- **The Better Messages calls** are always its own, on its own screen.
- **`own()` answers a function** that hands the calls back to the shared screen.

Short of a screen of your own, the shared one takes your pieces too: its colours and words ([its look](#its-look)), and the pieces it draws, by `::part()` and `<template slot>` ([customizing the screens](https://docs.wordplus.cloud/apps/customizing/#on-any-page-the-elements)).
