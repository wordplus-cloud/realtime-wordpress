# Encryption and the site users

What your plugin sends through WordPlus Cloud is sealed on the way: the realtime servers carry it without being able to read it or change it. You do not write any encryption code. The site holds the keys, gives each user the ones they may have, and the browser part opens everything before your listener sees it.

## What is sealed

| What | Sealed with | Who can open it |
|---|---|---|
| Events your server sends to a room, and pages send to it | the room key | whoever the room rule lets in |
| The history of a room | the room key, as it was sent | the same |
| The `info` of a presence member | the room key | the same |
| What your server sends a user (`to_user()`) | the key of the user | that user |
| What the people in a call or a group call see of each other (`info`) | the day key | everyone the site knows |
| The site users in the directory (name, avatar, profile link) | the day key | everyone the site knows |
| The media of a call in a room: when it leaves the direct path, and when it becomes a group call | the call media key | the two people in the call, and those rung into it, as the proofs of the site show |
| The media of a group call, when its rule says `encrypt` | the group call media key | whoever the group call rule lets in |

**Public rooms are not sealed,** nor a room whose rule says `'seal' => false`. Anyone may join a public room, so nothing secret belongs there anyway.

**The media of a call** is encrypted end to end on every path. Between two browsers WebRTC does it. In a room on the media servers, each browser encrypts every frame before it leaves, with a key derived from the site master key that only the calls route gives out, with the call token ([calls](calls.md#what-wordplus-cloud-sees), [group calls](group-calls.md#encrypted-end-to-end)).

The realtime servers see user ids, which key a value needs, and the sealed values. They never hold a key.

![What the site publishes for order 42 next to the sealed value our servers carry, and the page of Ben reading Paid](https://docs.wordplus.cloud/img/wordpress/encryption-sealed.webp)

## How it works

- **One master key on the site.** The package makes it the first time it is needed and keeps it in the option `wordplus_realtime_master_key`. It never leaves WordPress: not to WordPlus Cloud, not to a browser.
- **Every other key is derived from it,** so every plugin on the site, whichever copy of the package it carries, has the same keys. What one plugin seals, the code of another plugin opens.
- **The browser gets only the keys its user may have:**
  - a signed-in user page carries their own key and the day keys.
  - a room key comes with the room token, from your room rule.
  - anything else, the page asks the site for (`POST /wp-json/wordplus/v1/realtime/keys`), and the site checks again.
- **Keys never come from the realtime servers.** A key a server handed out could open what the browser seals next, so the browser takes keys from the site only.
- **XChaCha20-Poly1305:** a value changed on the way does not open. PHP seals with sodium, which every WordPress site has (WordPress carries a copy for a PHP without the extension).

## Who gets which key

| Key | Label | Given to |
|---|---|---|
| The day key | `d:{day}` | everyone the site knows: a signed-in user, or a visitor a plugin names (`wordplus_realtime_visitor_id`) |
| The key of a user | `u:{id}:{generation}` | that user |
| The key of a room | `ch:{room}:{generation}` | whoever the room rule lets in |
| A kind for one plugin | `{kind}:{…}` | whoever the callback of that plugin says |

A user the site cut off gets none (the filter `wordplus_realtime_user_has_keys`).

### When someone loses access

```php
// A customer no longer belongs to the order: out of its room now, and what it carries from then on is sealed from them.
wordplus_realtime()->in( 'order:42' )->kick( $customer_id );

// Or only the key, when they are not in it: it moves on.
wordplus_realtime()->keys()->rotate_room( 'order:42' );

// The access of a user is revoked: their own key moves on.
wordplus_realtime()->keys()->rotate_user( $user_id );
```

Those still let in get the new key from the site when its first event comes. Nothing else changes in your code.

## The site users

Every plugin on the site shares one directory of its users on WordPlus Cloud: the name, avatar and profile link of each user, sealed with the day key. Read it in the browser:

```js
const users = await wordplusRealtimeClient.page().users( [ 7, 12 ] );
// { 7: { user_id: 7, name: 'Ann', avatar: 'https://…', url: 'https://…/author/ann/' }, 12: { … } }
```

- **A signed-in user is in it** from their page on: the page tells the server who they are, as the site signed it, and their entry is kept for a day after they were last seen.
- **Only a page whose user the site knows may read it.** A visitor page asks the site first. One the site does not know gets `no_identity`.
- **Add to an entry** with the filter `wordplus_realtime_profile`. Every text is sealed, however deep in arrays. Numbers and true/false stay as they are, so put nothing private in them.

```php
add_filter( 'wordplus_realtime_profile', function ( $profile, $user_id ) {
	$profile['badge'] = my_shop_badge( $user_id );   // text: sealed

	return $profile;
}, 10, 2 );
```

![The users of the site in the browser of Ben, from the directory every plugin shares: Ann, Ben and Cara](https://docs.wordplus.cloud/img/wordpress/encryption-directory.webp)

## Sealing your own data

The keys are yours to use for anything else your plugin sends through WordPlus Cloud:

```php
$keys   = wordplus_realtime()->keys();
$sealed = $keys->seal_json( $order, $keys->user_label( $customer_id ) );   // only the customer opens it
$again  = json_decode( $keys->open( $sealed ), true );                      // the site opens anything it sealed
```

```js
const ring = wordplusRealtimeClient.keyring();
await ring.ensure( ring.missing( sealed ) );   // asks the site for a key the page lacks
const order = ring.openJson( sealed );          // undefined when no key it holds opens it
```

A plugin with things of its own to seal, conversations or tickets, registers a kind and decides who may have its keys:

```php
wordplus_realtime()->keys()->kind( 'ticket', function ( $rest, $user_id ) {
	return my_desk_may_read( (int) $rest, $user_id );   // the key ticket:42 for those who may read ticket 42
} );
```

## Turning it off

`add_filter( 'wordplus_realtime_seal', '__return_false' )` sends everything in plain, for a site that has to look at what goes by. `emit( $event, $data, array( 'seal' => false ) )` does it for one event, and a room `'seal' => false` for one room. The browser opens what is sealed and passes on what is not, so both work with the same code.

## The Pusher-compatible API

Plugins built for Pusher keep working as they are, and send what they send: sealing is what this SDK adds.
