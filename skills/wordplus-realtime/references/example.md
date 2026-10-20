# The WordPress example

A whole shop as a WordPress plugin, in the package `examples/shop`: sign in as Ann (support), Ben (a customer) or Cara (the warehouse), each in a browser of their own, and try everything these pages cover.

![The API demo signed in as Ben: his order 1042, shipped and live, with its timeline. The mugs and how many are looking at them. The daily meeting. His chat with Ann. The people in the shop, with call buttons. And the webhooks the site got](https://docs.wordplus.cloud/img/wordpress/example.webp)

| On the page | What makes it |
|---|---|
| The order of Ben follows as Ann moves it on, and Ben alone gets a notice | the `order:{id}` [room](rooms.md), sent to by its REST route with `except( tab() )`, and `to_user()` ([sending](sending.md)) |
| The chat of Ann and Ben, with typing, reactions and read ticks | `<chat-room>` on the `chat:{a}:{b}` room, which lets pages [send](events.md) them. The site keeps the conversation from the webhook and gives it back from its `chat/messages` route ([keeping the conversation](events.md#keeping-the-conversation)). The name and picture of the other side above it from the [directory](encryption.md#the-site-users) |
| Who is in the shop, with a call button for each | `<online-list>` on the `shop` [presence](presence.md) room, the name and role of each member |
| A call that can bring in more staff | `calls( 'support:{a}:{b}', … )` with `people` ([calls](calls.md)) and the [call screen](call-screen.md) |
| The daily meeting | `<room-button>`, a [group call](group-calls.md) |
| The order timeline, and what the cloud carried of it | the order room history ([rooms](rooms.md)). Its `wire` route seals the update as the site sends it, with the room key ([encryption](encryption.md)) |
| How many are looking at the mugs | the `product:{id}` room, public and counted ([presence](presence.md)) |
| The webhooks the site got | `on( '*' )`, which sends each on to the shop `webhooks` room ([sending](sending.md)) |

**Try it online** at [wordpress.docs.wordplus.cloud](https://wordpress.docs.wordplus.cloud/): this example as a demo, where every visitor gets a shop of their own for a day, and its links open Ben and Cara in windows of their own. Its calls end after 10 minutes and its meetings after 15. Under each card, **See the code** shows the parts of this example that make it, on the server and on the page: the lines between `#region demo: <card>` and `#endregion` in its files.

## Run it

Its people are users 34, 42 and 43 of the site, made when the plugin is activated, so it goes on a WordPress site of its own: it refuses a site that already has users of those ids or names. `site.mjs` makes one on SQLite, which the built-in PHP server serves:

```bash
cd examples/shop
export WORDPLUS_SITE=… WORDPLUS_SECRET=…   # the key and secret of your app, with http://localhost:8080 among its addresses
node site.mjs ../../.site http://localhost:8080
php -S localhost:8080 -t ../../.site ../../.site/router.php
```

Open http://localhost:8080/example-shop/ in two browsers (or a private window), sign in as Ann in one and Ben in the other, and move the order on, chat, and call. On a site of your own instead: `npm install && npm run build` and `composer install` in `examples/shop`, copy the folder into `wp-content/plugins/`, activate API demo, and connect the site to WordPlus Cloud from its row on the Plugins screen.

## Its files

| File | |
|---|---|
| `example-shop.php` | the plugin: the rooms and calls it declares and its webhooks, the shop people as users, its order and chat in an option, its REST routes, and its pages at `/example-shop/` |
| `demo.php` | the demo part alone (`WORDPLUS_DEMO=1`): a shop for each visitor, its windows, a connection for each of them (the `wordplus_realtime_config` filter `perUser`), and the frame around the page |
| `templates/page.php` | the page: the package scripts with the user settings, and the shop data |
| `shop/shop.js` | the page script: the order, the product, the chat, who is in the shop, the webhooks, the meeting and the call screen. The same file runs the shop in the example of every guide |
| `wordpress.js` | what `shop.js` imports from `@wordplus/realtime`, on the scripts of the package (`wordplusRealtimeCalls.page()`). `npm run build` bundles the two into `assets/` |
| `site.mjs` | a WordPress site of its own for the example, to try it |
