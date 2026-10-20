<?php
// How the example stands in for signing in: pick one of the shop people. A real site has the sign-in of WordPress itself.
defined( 'ABSPATH' ) || exit;
?>
<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Sign in · API demo</title>
	<link rel="stylesheet" href="<?php echo esc_url( example_shop_asset( 'shop.css' ) ); ?>">
</head>
<body>
	<main class="sign-in">
		<h1>API demo</h1>
		<p class="muted">Sign in as Ann, Ben or Cara. Use another browser, or a private window, for a second person.</p>
		<form method="post" action="<?php echo esc_url( home_url( example_shop_base() . '/login' ) ); ?>">
			<?php wp_nonce_field( 'example-shop-sign-in' ); ?>
			<?php foreach ( example_shop_people( 0 ) as $person ) : ?>
				<button name="as" value="<?php echo (int) $person['id']; ?>"><img class="avatar" src="<?php echo esc_url( $person['avatar'] ); ?>" alt="" width="28" height="28"> <?php echo esc_html( $person['name'] ); ?> <small><?php echo esc_html( $person['role'] ); ?></small></button>
			<?php endforeach; ?>
		</form>
	</main>
</body>
</html>
