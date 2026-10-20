<?php
// The demo frame around the API demo (WORDPLUS_DEMO=1), as the demo sites run it (wordpress.docs.wordplus.cloud
// and the others): a shop for each visitor, for 24 hours, signed in as Ann. Windows that are Ben or Cara (/as/<token>,
// the token then sent as a bearer, so each window of one browser is its own person), and what the page draws around
// the shop: the stacks, the guide, the source, "Try this". The example itself is the same with or without it.

defined( 'ABSPATH' ) || exit;

const EXAMPLE_SHOP_DEMO_DAY = 86400;
/** New shops an address opens in an hour. Past them it gets the newest of them again. */
const EXAMPLE_SHOP_DEMO_SHOPS_AN_HOUR = 6;

/** The demos, in the order the top bar lists them, and where the source of each is. */
const EXAMPLE_SHOP_DEMO_STACKS = array(
	array( 'wordpress', 'WordPress', 'realtime-wordpress', 'examples/shop' ),
	array( 'nextjs', 'Next.js', 'realtime-js', 'examples/nextjs' ),
	array( 'laravel', 'Laravel', 'realtime-php', 'examples/laravel' ),
	array( 'django', 'Django', 'realtime-python', 'examples/django' ),
	array( 'fastapi', 'FastAPI', 'realtime-python', 'examples/fastapi' ),
	array( 'express', 'Express', 'realtime-js', 'examples/express' ),
	array( 'php', 'PHP', 'realtime-php', 'examples/php' ),
	array( 'flask', 'Flask', 'realtime-python', 'examples/flask' ),
	array( 'mobile', 'Mobile apps', 'realtime-js', 'examples/react-native' ),
);

function example_shop_demo() {
	return '1' === getenv( 'WORDPLUS_DEMO' );
}

/** The token of a person: their user id and its signature, with a key from the salt of the site itself. */
function example_shop_demo_sign( $id ) {
	$mac = hash_hmac( 'sha256', 'example-shop window|' . (int) $id, wp_salt( 'auth' ), true );

	return (int) $id . '.' . rtrim( strtr( base64_encode( $mac ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- a token is base64url
}

/** The user a token names, if its signature is right and they are one of the people of a shop. */
function example_shop_demo_user_of( $token ) {
	$id = (int) explode( '.', (string) $token )[0];

	return null !== example_shop_person( $id ) && hash_equals( example_shop_demo_sign( $id ), (string) $token ) ? $id : null;
}

// On a demo, a window is the person its token names: /as/<token> opens it, and its requests carry the token as a bearer.
add_filter( 'determine_current_user', function ( $user ) {
	if ( ! example_shop_demo() ) {
		return $user;
	}

	$auth = isset( $_SERVER['HTTP_AUTHORIZATION'] ) ? (string) wp_unslash( $_SERVER['HTTP_AUTHORIZATION'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- checked below

	if ( 0 === strpos( $auth, 'Bearer ' ) ) {
		$bearer = example_shop_demo_user_of( substr( $auth, 7 ) );

		return null === $bearer ? $user : $bearer;
	}

	$path = (string) wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '', PHP_URL_PATH ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- checked below

	if ( 1 === preg_match( '#/as/([\w.-]+)$#', $path, $m ) ) {
		$window = example_shop_demo_user_of( $m[1] );

		return null === $window ? $user : $window;
	}

	return $user;
}, 30 );

// One browser holds several of the shop people then, each window its own: each gets a connection of their own.
add_filter( 'wordplus_realtime_config', function ( $config ) {
	return example_shop_demo() ? array( 'perUser' => true ) + $config : $config;
} );

// The REST requests of a window carry its bearer, not the sign-in of the browser, so the WordPress cookie nonce is not theirs.
add_filter( 'rest_authentication_errors', function ( $result ) {
	if ( example_shop_demo() && isset( $_SERVER['HTTP_AUTHORIZATION'] ) && null !== example_shop_demo_user_of( substr( (string) wp_unslash( $_SERVER['HTTP_AUTHORIZATION'] ), 7 ) ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- checked here
		return true;
	}

	return $result;
}, 200 );

/**
 * The shop for a new visitor, its number: a new one, or once their address has opened its few this hour, the newest of
 * them again, so nobody is ever turned away and nobody can open thousands.
 */
function example_shop_demo_open() {
	// The visitor address as the proxy in front saw it: the last of X-Forwarded-For, the one it added. The ones before
	// it are whatever the visitor sent.
	$forwarded = explode( ',', isset( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ? (string) wp_unslash( $_SERVER['HTTP_X_FORWARDED_FOR'] ) : '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- an address, used as a key
	$address   = trim( end( $forwarded ) );
	$address   = '' !== $address ? $address : ( isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : 'local' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized

	example_shop_demo_sweep();

	$opened = get_option( 'example_shop_opened', array() );
	$opened = is_array( $opened ) ? $opened : array();

	foreach ( $opened as $key => $list ) {
		$opened[ $key ] = array_values( array_filter( (array) $list, function ( $o ) {
			return is_array( $o ) && time() - (int) $o['at'] < 3600 && null !== example_shop( (int) $o['s'] );
		} ) );

		if ( array() === $opened[ $key ] ) {
			unset( $opened[ $key ] );
		}
	}

	$recent = isset( $opened[ $address ] ) ? $opened[ $address ] : array();

	if ( count( $recent ) >= EXAMPLE_SHOP_DEMO_SHOPS_AN_HOUR ) {
		$number = (int) $recent[ count( $recent ) - 1 ]['s'];
	} else {
		do {
			$number = random_int( 100000, 999999 );
		} while ( null !== example_shop( $number ) || example_shop_taken( $number ) );

		example_shop_open( $number );
		$recent[] = array(
			's'  => $number,
			'at' => time(),
		);
	}

	$opened[ $address ] = $recent;
	update_option( 'example_shop_opened', $opened, false );

	return $number;
}

/** Shops end after a day: their option and their people go. */
function example_shop_demo_sweep() {
	global $wpdb;

	$names = $wpdb->get_col( $wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( 'example_shop_' ) . '%' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery

	foreach ( $names as $name ) {
		if ( 1 !== preg_match( '/^example_shop_(\d+)$/', $name, $m ) ) {
			continue;
		}

		$s    = (int) $m[1];
		$shop = example_shop( $s );

		if ( null !== $shop && time() - (int) $shop['opened'] <= EXAMPLE_SHOP_DEMO_DAY ) {
			continue;
		}

		delete_option( $name );

		foreach ( EXAMPLE_SHOP_PEOPLE as $p ) {
			$id = $s * 100 + $p['id'];
			$wpdb->delete( $wpdb->usermeta, array( 'user_id' => $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->delete( $wpdb->users, array( 'ID' => $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			clean_user_cache( $id );
		}
	}
}

/** What a person page draws around the shop. */
function example_shop_demo_frame( array $me ) {
	$sites = getenv( 'WORDPLUS_DEMO_SITES' ) ?: 'https://{case}.docs.wordplus.cloud';
	$open  = array();

	foreach ( example_shop_people( $me['shop'] ) as $p ) {
		if ( $p['id'] !== $me['id'] ) {
			$open[] = array( 'id' => $p['id'], 'name' => $p['name'], 'url' => home_url( '/as/' . example_shop_demo_sign( $p['id'] ) ) );
		}
	}

	return array(
		'stack'  => 'wordpress',
		'name'   => 'WordPress',
		'guide'  => 'https://docs.wordplus.cloud/wordpress/getting-started/',
		'source' => 'https://github.com/wordplus-cloud/realtime-wordpress/tree/main/examples/shop',
		'sites'  => array_map( function ( $s ) use ( $sites ) {
			return array( 'stack' => $s[0], 'name' => $s[1], 'url' => str_replace( '{case}', $s[0], $sites ) );
		}, EXAMPLE_SHOP_DEMO_STACKS ),
		// This window person, which the page sends with every request. And the others, each a window of their own.
		'token'  => example_shop_demo_sign( $me['id'] ),
		'open'   => $open,
		'ends'   => ( (int) example_shop( $me['shop'] )['opened'] + EXAMPLE_SHOP_DEMO_DAY ) * 1000,
		'limits' => example_shop_demo_limits(),
		'code'   => example_shop_demo_code(),
	);
}

/**
 * How long a call and a meeting may last, in seconds, which the page keeps to: 10 and 15 minutes, as the demo runs on
 * WordPlus Cloud for anyone. WORDPLUS_DEMO_LIMITS ("call,meeting") shortens them, for the demo check.
 */
function example_shop_demo_limits() {
	$limits = array_map( 'intval', explode( ',', getenv( 'WORDPLUS_DEMO_LIMITS' ) ?: '600,900' ) );

	return array( 'call' => $limits[0], 'meeting' => isset( $limits[1] ) ? $limits[1] : 900 );
}

/**
 * The code under each card, "See the code": the parts of this example marked `#region demo: <card>`, which the build
 * of the demo sites cuts from its source into WORDPLUS_DEMO_CODE, by stack.
 */
function example_shop_demo_code() {
	$path = getenv( 'WORDPLUS_DEMO_CODE' );
	if ( ! $path ) {
		return null;
	}
	$code = json_decode( (string) file_get_contents( $path ), true );

	return isset( $code['wordpress'] ) ? $code['wordpress'] : null;
}
