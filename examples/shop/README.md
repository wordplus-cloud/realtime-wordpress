# The API demo on WordPress

Sign in as Ann (support), Ben (a customer) or Cara (the warehouse), each in a browser of their own: the order of Ben follows as Ann moves it on and Ben alone gets a notice, Ann and Ben chat with “typing…” and the site keeps the conversation from its webhook, everyone sees who is in the shop and who is online and can call them, a call can bring in more staff, and all three can meet in the daily meeting. `wordplus/realtime` in a plugin, with the Better Messages screens on the scripts of the package. The guide is at [docs.wordplus.cloud/wordpress](https://docs.wordplus.cloud/wordpress/getting-started/).

The shop people are users 34, 42 and 43 of the site, made when the plugin is activated, so it goes on a WordPress site of its own: it refuses a site that has users of those ids or names. The quickest is one this folder makes, on SQLite, served by the built-in PHP server:

```bash
export WORDPLUS_SITE=… WORDPLUS_SECRET=…   # the key and secret of your app, with http://localhost:8080 among its addresses
node site.mjs ../../.site http://localhost:8080
php -S localhost:8080 -t ../../.site ../../.site/router.php
```

Then open http://localhost:8080/example-shop/. On a site of your own instead: `npm install && npm run build` and `composer install` here, copy the folder into `wp-content/plugins/`, activate API demo and connect the site to WordPlus Cloud from its row on the Plugins screen.

| File | |
|---|---|
| `example-shop.php` | the plugin: its rooms and calls and who may use them, the shop people as users, its order and chat in an option, the REST routes the page asks, and its pages at `/example-shop/` |
| `demo.php` | the frame of the demo at wordpress.docs.wordplus.cloud (`WORDPLUS_DEMO=1`): a shop for each visitor, and windows that are the others |
| `templates/page.php` | the page, with the package scripts and the shop data |
| `shop/shop.js` | the page script: the same in every example |
| `wordpress.js` | what `shop.js` imports from `@wordplus/realtime`, on the package scripts (`npm run build` bundles them into `assets/`) |
| `site.mjs` | a WordPress site of its own for the example, to try it |
