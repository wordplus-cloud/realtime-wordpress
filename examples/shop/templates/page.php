<?php
// The shop page: the SDK scripts with the user settings (window.wordplusRealtimeConfig), the shop data, and the
// page the API demo of every guide shares (assets/shop.js, from examples/shop of @wordplus/realtime on the WordPress
// scripts: wordpress.js).
defined( 'ABSPATH' ) || exit;
?>
<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>API demo</title>
	<link rel="stylesheet" href="<?php echo esc_url( example_shop_asset( 'shop.css' ) ); ?>">
	<script type="application/json" id="shop"><?php echo wp_json_encode( $shop, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES ); ?></script>
	<?php wp_print_scripts( array( 'wordplus-realtime-call-screen', 'wordplus-realtime-stream-screen' ) ); ?>
	<script type="module" src="<?php echo esc_url( example_shop_asset( 'shop.js' ) ); ?>"></script>
</head>
<body>
	<header class="shop-bar">
		<strong>API demo</strong>
		<form class="shop-me" method="post" action="<?php echo esc_url( home_url( example_shop_base() . '/logout' ) ); ?>">
			<img class="avatar" src="<?php echo esc_url( $me['avatar'] ); ?>" alt="" width="24" height="24"> <?php echo esc_html( $me['name'] ); ?>
			<button class="quiet" type="submit">Sign out</button>
		</form>
	</header>
	<main class="shop-main" id="shop-root"></main>
</body>
</html>
