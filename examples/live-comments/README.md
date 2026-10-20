# Live Comments

The first plugin on the realtime SDK, and a small example of it: a comment appears for everyone reading its post the moment it is approved, and signed-in readers see who else is reading.

- **`live-comments.php`:** a public room for each post (`live-comments:{post}`) and a room of its readers with presence (`live-comments-readers:{post}`), each approved comment emitted to the post room, its script enqueued on the scripts of the SDK, and the connection offered on its row of the Plugins screen when the site has no credentials.
- **`live-comments.js`:** joins both rooms, adds new comments above the comment form, and lists the readers.
- **`composer.json`:** `wordplus/realtime`, which `composer install` puts in `vendor/`.

A comment carries its author and text only, as text. A visitor gets the new comments but is not listed and sees no one, since a presence room lists its members to each other.

## Trying it

Copy the folder into `wp-content/plugins/`, run `composer install` in it, activate Live Comments and connect the site to WordPlus Cloud from its row on the Plugins screen. Open a post in two browsers, signed in as two users, and approve a comment: it appears in both, and each lists the other as reading.
