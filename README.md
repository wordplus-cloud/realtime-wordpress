# wordplus/realtime

The realtime SDK for any WordPress plugin, theme or custom code on a site with a WordPlus Cloud subscription:

- **Rooms:** events from your server to browsers and between browsers, with presence, live counts and 5 minutes of history for pages that reconnect; who is online across the site; and sending to a user.
- **Calls between two people:** they ring in the browser and run directly between the two browsers, through TURN when a network needs it, or in a room on WordPlus Cloud's media servers when nothing else works.
- **Group calls:** rooms on WordPlus Cloud's media servers, which span regions.
- **Better Messages' screens, ready-made:** call buttons, the ring and the call window, who is in a room, and the chat, with no JavaScript to write.
- **Encrypted, with WordPress's own users:** what your plugin sends goes sealed with keys only the site and its users hold, so WordPlus Cloud carries it without reading it, and every plugin on the site shares one directory of its users' names and avatars.

Everything rides the one connection a page shares with WordPlus's own plugins, which connects straight to a realtime server and moves to another without a drop when one restarts.

```bash
composer require wordplus/realtime
```

```php
add_action( 'plugins_loaded', function () {
	// Who may follow an order's updates.
	wordplus_realtime()->room( 'order:{id}', function ( $user_id, array $p ) {
		return $user_id > 0 && my_shop_customer_of( (int) $p['id'] ) === $user_id;
	}, array( 'history' => 20 ) );

	// Who may call whom.
	wordplus_realtime()->calls( 'support:{a}:{b}', function ( $user_id, $with ) {
		return my_support_may_call( $user_id, $with );
	} );
} );

wordplus_realtime()->to( 'order:42' )->emit( 'updated', array( 'status' => 'paid' ) );
```

```html
<call-button to="34" call="support:34:42" type="video" name="Ann">Call Ann</call-button>
```

## Docs

1. [Getting started](docs/getting-started.md): installing, the site's credentials, a first room and a first call.
2. [Rooms](docs/rooms.md): names, owning them by pattern, what they keep and allow, joining.
3. [Presence](docs/presence.md): who is in a room, and who is online across the site.
4. [Sending from your server](docs/sending.md): to rooms and users, asking about rooms, webhooks.
5. [Events from the page](docs/events.md): events between browsers, keeping the conversation, the chat.
6. [Calls](docs/calls.md): calls between two people, ringing, and your own call interface.
7. [Group calls](docs/group-calls.md): rooms on the media servers.
8. [The call screen](docs/call-screen.md): Better Messages' screens, ready-made.
9. [Encryption and the site's users](docs/encryption.md): what is sealed, who gets which key, the users' directory.
10. [PHP reference](docs/php-reference.md) and [JavaScript reference](docs/javascript-reference.md).
11. [Errors](docs/errors.md), [limits](docs/limits.md) and [other servers](docs/self-hosted.md).
12. [The example](docs/example.md): the API demo as a plugin, and the demo at wordpress.docs.wordplus.cloud.

The same guide is at [docs.wordplus.cloud](https://docs.wordplus.cloud/wordpress/getting-started/).

## Examples

- [`examples/live-comments`](examples/live-comments): new comments appear for everyone reading the post, and signed-in readers see who else is reading.
- [`examples/video-support`](examples/video-support): customers video-call the shop's support agent, whose every open tab rings, and the staff have a group call of their own. No call code: the call screen does it all.

Each has a `check.mjs` that runs it end to end in real browsers.

## With an AI coding agent

[`skills/wordplus-realtime`](skills/wordplus-realtime/SKILL.md) is an agent skill: a `SKILL.md` with the docs as its references. Copy the folder into your agent's skills (for Claude Code, `~/.claude/skills/` or your project's `.claude/skills/`), and ask it for live updates, presence or calls in your plugin. [`llms.txt`](llms.txt) indexes the docs for any other tool.
