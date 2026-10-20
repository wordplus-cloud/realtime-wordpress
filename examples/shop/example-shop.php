<?php
/**
 * Plugin Name: API demo
 * Description: The API demo of the guides of the WordPlus realtime SDK, on WordPress: sign in as Ann (support), Ben (a customer) or Cara (the warehouse), then watch the order of Ben move on, chat, see who is in the shop and who is online, call them, and meet in the daily meeting.
 * Version:     1.0.0
 * Requires PHP: 7.4
 * License:     GPL-2.0-or-later
 * Text Domain: example-shop
 */

defined( 'ABSPATH' ) || exit;

// `composer require wordplus/realtime` puts the SDK here.
require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/demo.php';

// WordPlus Cloud unless these say otherwise: a realtime server a developer runs (run.mjs of the demos).
foreach ( array( 'wordplus_realtime_server' => 'WORDPLUS_REALTIME_SERVER', 'wordplus_realtime_api_server' => 'WORDPLUS_REALTIME_API' ) as $example_shop_filter => $example_shop_env ) {
	if ( getenv( $example_shop_env ) ) {
		add_filter( $example_shop_filter, function () use ( $example_shop_env ) {
			return getenv( $example_shop_env );
		} );
	}
}

// The shop people are WordPress users, its order and chat the option of a shop. A real shop has its own tables.
//
// Shop 0 is the one of this example, at /example-shop/: its people are users 34, 42 and 43, made when the plugin is activated. A
// demo (WORDPLUS_DEMO=1, demo.php) opens a shop for each visitor, numbered s, at the site front page: its people are
// users s × 100 + 34, + 42 and + 43, its order s × 10000 + 1042. Every rule finds the shop of a user by arithmetic, so the people of
// one shop never reach another.

const EXAMPLE_SHOP_PEOPLE = array(
	array( 'id' => 34, 'name' => 'Ann', 'role' => 'Support', 'staff' => true, 'slug' => 'ann' ),
	array( 'id' => 42, 'name' => 'Ben', 'role' => 'Customer', 'staff' => false, 'slug' => 'ben' ),
	array( 'id' => 43, 'name' => 'Cara', 'role' => 'Warehouse', 'staff' => true, 'slug' => 'cara' ),
);
const EXAMPLE_SHOP_STATUSES = array( 'placed', 'packed', 'shipped', 'delivered' );

/** Where the shop pages are: the front page on a demo, /example-shop/ on any other site. */
function example_shop_base() {
	return example_shop_demo() ? '' : '/example-shop';
}

/** A file of the plugin built page (npm run build: assets/). */
function example_shop_asset( $file ) {
	return plugins_url( 'assets/' . $file, __FILE__ );
}

function example_shop_of( $user ) {
	return intdiv( (int) $user, 100 );
}

/** A shop as the site keeps it: its order, its chat and when it opened. Null for none. */
function example_shop( $s ) {
	$shop = get_option( 'example_shop_' . (int) $s, null );

	return is_array( $shop ) ? $shop : null;
}

function example_shop_save( $s, array $shop ) {
	update_option( 'example_shop_' . (int) $s, $shop, false );
}

function example_shop_login( $s, array $person ) {
	return $s ? $person['slug'] . '-' . $s : $person['slug'];
}

/** Whether shop `$s`'s ids or sign-in names belong to someone else on the site, who must never become one of its people. */
function example_shop_taken( $s ) {
	foreach ( EXAMPLE_SHOP_PEOPLE as $person ) {
		$by_id    = get_userdata( $s * 100 + $person['id'] );
		$by_login = get_user_by( 'login', example_shop_login( $s, $person ) );

		foreach ( array( $by_id, $by_login ) as $user ) {
			if ( $user && (string) $s !== (string) get_user_meta( $user->ID, 'example_shop', true ) ) {
				return true;
			}
		}
	}

	return false;
}

/**
 * A new shop, numbered `$s`: its people as users of the site, its order, placed, and the first two messages of the chat.
 * what Ann and Ben say next comes by webhook (example_shop_keep()).
 */
function example_shop_open( $s ) {
	global $wpdb;

	foreach ( EXAMPLE_SHOP_PEOPLE as $person ) {
		$id = $s * 100 + $person['id'];

		if ( get_userdata( $id ) ) {
			continue;
		}

		// A user by the id the shop numbers them with, which wp_insert_user() cannot give.
		$login = example_shop_login( $s, $person );
		$wpdb->insert( $wpdb->users, array(
			'ID'              => $id,
			'user_login'      => $login,
			'user_pass'       => wp_hash_password( wp_generate_password( 32 ) ),
			'user_nicename'   => $login,
			'user_email'      => $login . '@shop.example',
			'display_name'    => $person['name'],
			'user_registered' => gmdate( 'Y-m-d H:i:s' ),
		) );
		update_user_meta( $id, $wpdb->get_blog_prefix() . 'capabilities', array( 'subscriber' => true ) );
		update_user_meta( $id, 'example_shop', $s );
		clean_user_cache( $id );
	}

	$now = (int) floor( microtime( true ) * 1000 );
	example_shop_save( $s, array(
		'order'  => array( 'id' => $s * 10000 + 1042, 'number' => 1042, 'customer' => $s * 100 + 42, 'item' => 'Two ceramic mugs', 'status' => 'placed' ),
		'chat'   => array(
			array( 'id' => 'first-1', 'from' => $s * 100 + 42, 'text' => 'Hi! Has my order left yet?', 'at' => $now - 120000, 'reactions' => array() ),
			array( 'id' => 'first-2', 'from' => $s * 100 + 34, 'text' => 'Hi Ben, it is being packed now. I will let you know.', 'at' => $now - 60000, 'reactions' => array() ),
		),
		'opened' => time(),
	) );
}

/** The people of a shop, as the page shows them. */
function example_shop_people( $s ) {
	return array_map( function ( $p ) use ( $s ) {
		return array(
			'id'     => $s * 100 + $p['id'],
			'name'   => $p['name'],
			'role'   => $p['role'],
			'staff'  => $p['staff'],
			'avatar' => example_shop_asset( 'avatars/' . $p['slug'] . '.svg' ),
			'shop'   => $s,
		);
	}, EXAMPLE_SHOP_PEOPLE );
}

/** One of the people of a shop by their user id, or null. */
function example_shop_person( $id ) {
	if ( ! is_numeric( $id ) || (int) $id <= 0 || null === example_shop( example_shop_of( $id ) ) ) {
		return null;
	}

	foreach ( example_shop_people( example_shop_of( $id ) ) as $p ) {
		if ( $p['id'] === (int) $id ) {
			return $p;
		}
	}

	return null;
}

function example_shop_staff( $id ) {
	$p = example_shop_person( $id );

	return null !== $p && $p['staff'];
}

/** Whether they are all people of one shop. */
function example_shop_same( ...$ids ) {
	foreach ( $ids as $id ) {
		if ( null === example_shop_person( $id ) || example_shop_of( $id ) !== example_shop_of( $ids[0] ) ) {
			return false;
		}
	}

	return true;
}

/** An order by its id, or null. */
function example_shop_order( $id ) {
	$shop = example_shop( intdiv( (int) $id, 10000 ) );

	return null !== $shop && $shop['order']['id'] === (int) $id ? $shop['order'] : null;
}

/** The rooms of a shop, by name: those of shop 0 as the guides name them, those of a demo shop with its number. */
function example_shop_rooms( $s ) {
	return array(
		'order'    => 'order:' . ( $s * 10000 + 1042 ),
		'chat'     => 'chat:' . ( $s * 100 + 34 ) . ':' . ( $s * 100 + 42 ),
		'shop'     => $s ? 'shop:' . $s : 'shop',
		'meeting'  => $s ? 'meeting:' . $s : 'meeting:daily',
		'product'  => $s ? 'product:' . $s : 'product:mugs',
		'webhooks' => $s ? 'webhooks:' . $s : 'webhooks',
		'show'     => $s ? 'show:' . $s : 'show:mugs',
	);
}

/** The shop a room belongs to, from its name. Null for none. */
function example_shop_of_room( $room ) {
	$parts = explode( ':', (string) $room );
	$kind  = $parts[0];
	$first = isset( $parts[1] ) ? $parts[1] : null;

	if ( 'order' === $kind ) {
		return intdiv( (int) $first, 10000 );
	}

	if ( 'chat' === $kind ) {
		return example_shop_of( $first );
	}

	if ( ! in_array( $kind, array( 'shop', 'meeting', 'product', 'webhooks', 'show' ), true ) ) {
		return null;
	}

	return null === $first || 'daily' === $first || 'mugs' === $first ? 0 : ( ctype_digit( $first ) ? (int) $first : null );
}

/**
 * The chat as the site keeps it, from the webhook: a message by the id of its room event, once. A reaction as the one
 * key on it, an empty key taking it back. A real plugin keeps them in a table.
 */
function example_shop_keep( array $chat, array $event ) {
	$data = isset( $event['data'] ) && is_array( $event['data'] ) ? $event['data'] : array();
	$from = (int) ( isset( $event['from'] ) ? $event['from'] : 0 );
	$id   = isset( $event['event_id'] ) ? (string) $event['event_id'] : '';

	if ( 'message' === $event['event'] && '' !== $id && ! in_array( $id, array_column( $chat, 'id' ), true ) ) {
		$chat[] = array( 'id' => $id, 'from' => $from, 'text' => (string) ( isset( $data['text'] ) ? $data['text'] : '' ), 'at' => (int) ( isset( $event['at'] ) ? $event['at'] : 0 ), 'reactions' => array() );
	}

	if ( 'reaction' === $event['event'] ) {
		foreach ( $chat as &$message ) {
			if ( $message['id'] !== ( isset( $data['id'] ) ? $data['id'] : null ) ) {
				continue;
			}

			$reactions = array();

			foreach ( (array) $message['reactions'] as $key => $users ) {
				$kept = array_values( array_filter( (array) $users, function ( $user ) use ( $from ) {
					return (int) $user !== $from;
				} ) );

				if ( $kept ) {
					$reactions[ (string) $key ] = $kept;
				}
			}

			if ( isset( $data['key'] ) && is_string( $data['key'] ) && '' !== $data['key'] ) {
				$reactions[ $data['key'] ][] = $from;
			}

			$message['reactions'] = $reactions;
		}
		unset( $message );
	}

	return $chat;
}

/** A page of the chat, oldest first: the newest 50, or the 50 before the message `$before`. */
function example_shop_chat_page( array $chat, $before ) {
	$end   = null !== $before ? array_search( $before, array_column( $chat, 'id' ), true ) : false;
	$up_to = false === $end ? count( $chat ) : $end;
	$start = max( 0, $up_to - 50 );
	$page  = array_map( function ( $m ) {
		$m['reactions'] = (object) $m['reactions'];   // by key, an object even with none
		return $m;
	}, array_slice( $chat, $start, $up_to - $start ) );

	return array( 'messages' => $page, 'more' => $start > 0 );
}

// The rooms, the calls and who may use them, for every request.
add_action( 'plugins_loaded', function () {
	$rt = wordplus_realtime();

	// #region demo: order
	// The room of an order: its customer and the shop staff. The last 20 updates kept, which the page shows as its timeline.
	$rt->room( 'order:{id}', function ( $user, array $p ) {
		$order = example_shop_order( $p['id'] );

		return null !== $order && ( $user === $order['customer'] || ( example_shop_staff( $user ) && example_shop_same( $user, $order['customer'] ) ) );
	}, array( 'history' => 20 ) );
	// #endregion

	// #region demo: chat
	// The chat of Ann and Ben: those two only. They send messages, typing, reactions and read ticks straight to the room. The
	// messages and reactions reach the site by webhook, and it keeps the conversation (example_shop_keep(), the
	// REST route). The room keeps its last events for 5 minutes, for a page that reconnects.
	$rt->room( 'chat:{a}:{b}', function ( $user, array $p ) {
		return in_array( (string) $user, array( $p['a'], $p['b'] ), true ) && example_shop_same( $p['a'], $p['b'] );
	}, array( 'history' => 50, 'emit' => array( 'message', 'typing', 'reaction', 'read' ), 'webhook' => array( 'message', 'reaction' ) ) );
	// #endregion

	// #region demo: presence
	// Who is in the shop: its people, with their name and role.
	$member = function ( $user, $s ) {
		$p = example_shop_person( $user );

		return null !== $p && $p['shop'] === $s ? array( 'info' => array( 'name' => $p['name'], 'role' => $p['role'] ) ) : false;
	};
	$rt->room( 'shop', function ( $user ) use ( $member ) {
		return $member( $user, 0 );
	}, array( 'presence' => true ) );
	$rt->room( 'shop:{s}', function ( $user, array $p ) use ( $member ) {
		return $member( $user, (int) $p['s'] );
	}, array( 'presence' => true ) );
	// #endregion

	// #region demo: product
	// The product page: anyone, signed in or not, and a live count of who is looking.
	$rt->room( 'product:{id}', null, array( 'public' => true, 'count' => true ) );
	// #endregion

	// #region demo: webhooks
	// The webhooks the site got, sent on to the shop people as they come (below), the last 20 kept.
	$rt->room( 'webhooks', function ( $user ) {
		$p = example_shop_person( $user );
		return null !== $p && 0 === $p['shop'];
	}, array( 'history' => 20 ) );
	$rt->room( 'webhooks:{s}', function ( $user, array $p ) {
		$person = example_shop_person( $user );
		return null !== $person && (int) $p['s'] === $person['shop'];
	}, array( 'history' => 20 ) );
	// #endregion

	// #region demo: members
	// Calls between two people, support:34:42: the two it names, one of them staff. Either of them may bring more staff
	// in, and the call goes on as a group call: the one adding calls the staff member about it, who takes the call.
	$rt->calls( 'support:{a}:{b}', function ( $user, $with, array $p ) {
		$pair = array( (int) $p['a'], (int) $p['b'] );

		if ( ! example_shop_same( $user, $with, $pair[0], $pair[1] ) ) {
			return false;
		}

		if ( in_array( $user, $pair, true ) && in_array( $with, $pair, true ) ) {
			return example_shop_staff( $user ) || example_shop_staff( $with );
		}

		return ( in_array( $user, $pair, true ) && example_shop_staff( $with ) ) || ( example_shop_staff( $user ) && in_array( $with, $pair, true ) );
	}, array(
		// Whom the call screen offers to add: the shop staff not in the call.
		'people' => function ( $user, $call ) {
			$in = array_map( 'intval', array_slice( explode( ':', $call ), 1 ) );

			return array_values( array_map( function ( $p ) {
				return $p['id'];
			}, array_filter( example_shop_people( example_shop_of( $user ) ), function ( $p ) use ( $in ) {
				return $p['staff'] && ! in_array( $p['id'], $in, true );
			} ) ) );
		},
	) );
	// #endregion

	// #region demo: show
	// The shop live show, show:mugs: Ann presents it, and everyone else watches and writes in its chat, signed in or
	// not (a visitor is user 0).
	$rt->streams( 'show:{id}', function ( $user, array $p ) {
		$s = example_shop_of_room( 'show:' . $p['id'] );
		if ( null === $s || null === example_shop( $s ) ) {
			return false;
		}
		$person = example_shop_person( $user );

		return null !== $person && $person['shop'] === $s && 'Ann' === $person['name'] ? 'host' : 'viewer';
	}, array( 'reactions' => true ) );
	// #endregion

	// #region demo: meeting
	// The daily meeting: a group call for everyone in the shop.
	$rt->group_calls( 'meeting:{id}', function ( $user, array $p ) {
		$person = example_shop_person( $user );

		return null !== $person && $person['shop'] === ( 'daily' === $p['id'] ? 0 : (int) $p['id'] );
	// #endregion
	} );

	// #region demo: webhooks
	// What WordPlus Cloud tells the site by webhook (the package route, which WordPlus Cloud knows): a message or
	// reaction from a page, someone coming online … each sent on to its shop webhooks room.
	$rt->on( '*', function ( array $event ) use ( $rt ) {
		$room = isset( $event['room'] ) ? $event['room'] : null;
		$s    = null !== $room ? example_shop_of_room( $room ) : example_shop_of( isset( $event['user'] ) ? $event['user'] : 0 );

		if ( null === $s || null === example_shop( $s ) || 0 === strpos( (string) $room, 'webhooks' ) ) {
			return;
		}

		// #region demo: chat
		if ( 'emit' === $event['type'] && example_shop_rooms( $s )['chat'] === $room ) {
			$shop         = example_shop( $s );
			$shop['chat'] = example_shop_keep( $shop['chat'], $event );
			example_shop_save( $s, $shop );
		}
		// #endregion

		$type = 'emit' === $event['type'] ? $event['event'] : $event['type'];
		$who  = isset( $event['user'] ) ? $event['user'] : ( isset( $event['from'] ) ? $event['from'] : null );
		$rt->to( example_shop_rooms( $s )['webhooks'] )->emit( 'webhook', array( 'type' => $type, 'room' => $room, 'user' => $who, 'at' => isset( $event['at'] ) ? $event['at'] : null ) );
	// #endregion
	} );
} );

// The shop people as everyone sees them: their avatars, in WordPress and in the directory of the realtime SDK.
add_filter( 'pre_get_avatar_data', function ( $args, $id_or_email ) {
	$id = is_numeric( $id_or_email ) ? (int) $id_or_email : ( $id_or_email instanceof WP_User ? $id_or_email->ID : 0 );
	$p  = example_shop_person( $id );

	if ( null !== $p ) {
		$args['url'] = $p['avatar'];
	}

	return $args;
}, 10, 2 );

// The example people are users 34, 42 and 43, so it goes on a site of its own, never one with people of its own.
register_activation_hook( __FILE__, function () {
	if ( example_shop_demo() || null !== example_shop( 0 ) ) {
		return;
	}

	if ( example_shop_taken( 0 ) ) {
		wp_die( esc_html__( 'The API demo needs users 34, 42 and 43, and the names ann, ben and cara, and this site has some of them. Install it on a new WordPress site of its own.', 'example-shop' ), '', array( 'back_link' => true ) );
	}

	example_shop_open( 0 );
} );

/** The REST routes the page asks: the order status and what the cloud carried of it, and the chat the site keeps. */
add_action( 'rest_api_init', function () {
	register_rest_route( 'example-shop/v1', '/orders/(?P<id>\d+)/status', array(
		'methods'             => 'POST',
		'permission_callback' => '__return_true',
		'callback'            => 'example_shop_status',
	) );
	register_rest_route( 'example-shop/v1', '/orders/(?P<id>\d+)/wire', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => 'example_shop_wire',
	) );
	register_rest_route( 'example-shop/v1', '/chat/messages', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => 'example_shop_messages',
	) );
} );

// #region demo: order
/**
 * The staff move the order on: saved, then emitted to its room but the tab that made the change, and a notice to its
 * customer alone.
 */
function example_shop_status( WP_REST_Request $request ) {
	$me     = get_current_user_id();
	$order  = example_shop_order( $request['id'] );
	$status = $request->get_param( 'status' );

	if ( null === $order || ! example_shop_staff( $me ) || ! example_shop_same( $me, $order['customer'] ) || ! in_array( $status, EXAMPLE_SHOP_STATUSES, true ) ) {
		return new WP_REST_Response( array( 'ok' => false ), 403 );
	}

	$s                         = intdiv( $order['id'], 10000 );
	$shop                      = example_shop( $s );
	$shop['order']['status']   = $status;
	example_shop_save( $s, $shop );

	$rt = wordplus_realtime();
	$rt->to( 'order:' . $order['id'] )->except( $rt->tab() )->emit( 'updated', array( 'id' => $order['id'], 'status' => $status ) );
	$rt->to_user( $order['customer'] )->emit( 'notice', array( 'text' => 'Your order #' . $order['number'] . ' is ' . $status . '.' ) );

	return array( 'ok' => true );
}
// #endregion

/**
 * What the cloud carries of the order update: its room and event as they are, its data sealed with the room key,
 * which WordPlus Cloud never holds. The page shows it beside the update as it opened it.
 */
function example_shop_wire( WP_REST_Request $request ) {
	$order = example_shop_order( $request['id'] );

	if ( null === $order || ! example_shop_same( get_current_user_id(), $order['customer'] ) ) {
		return new WP_REST_Response( array( 'ok' => false ), 403 );
	}

	$room = 'order:' . $order['id'];
	$keys = wordplus_realtime()->keys();

	return array( 'room' => $room, 'event' => 'updated', 'data' => $keys->seal_json( array( 'id' => $order['id'], 'status' => $order['status'] ), $keys->room_label( $room ) ) );
}

// #region demo: chat
/** The chat the site keeps, for one of its two: the newest page, or `?before=<id>` the page before that message. */
function example_shop_messages( WP_REST_Request $request ) {
	$me = get_current_user_id();

	if ( null === example_shop_person( $me ) || ! in_array( $me % 100, array( 34, 42 ), true ) ) {
		return new WP_REST_Response( array( 'error' => 'not_in_chat' ), 403 );
	}

	$before = $request->get_param( 'before' );

	return example_shop_chat_page( example_shop( example_shop_of( $me ) )['chat'], is_string( $before ) && '' !== $before ? $before : null );
}
// #endregion

// The shop pages: the shop for its signed-in person, the sign-in, and on a demo a window as one of the shop people.
add_action( 'template_redirect', function () {
	$path = (string) wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/', PHP_URL_PATH ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- a path, compared below
	$home = rtrim( (string) wp_parse_url( home_url(), PHP_URL_PATH ), '/' );
	$path = '/' . ltrim( substr( $path, strlen( $home ) ), '/' );
	$base = example_shop_base();

	if ( $base . '/login' === $path || $base . '/login/' === $path ) {
		$page = 'example_shop_sign_in';
	} elseif ( $base . '/logout' === $path ) {
		$page = 'example_shop_sign_out';
	} elseif ( ( '' === $base && ( '/' === $path || 1 === preg_match( '#^/as/[\w.-]+$#', $path ) ) ) || ( '' !== $base && ( $base === $path || $base . '/' === $path ) ) ) {
		$page = 'example_shop_page';
	} else {
		return;
	}

	// WordPress found no post here, so it had marked the request not found.
	status_header( 200 );
	nocache_headers();
	call_user_func( $page );
	exit;
}, 1 );

function example_shop_sign_out() {
	wp_logout();
	wp_safe_redirect( home_url( example_shop_base() . '/login' ), 303 );
}

/** The sign-in: the people of shop 0 to pick from, or on a demo, a shop of their own for a new visitor, and they are its Ann. */
function example_shop_sign_in() {
	if ( example_shop_demo() ) {
		$s = example_shop_demo_open();
		wp_set_auth_cookie( $s * 100 + 34, false, is_ssl() );
		wp_safe_redirect( home_url( '/' ), 303 );
		return;
	}

	if ( 'POST' === ( isset( $_SERVER['REQUEST_METHOD'] ) ? $_SERVER['REQUEST_METHOD'] : '' ) && isset( $_POST['as'] ) && check_admin_referer( 'example-shop-sign-in' ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$p = example_shop_person( (int) $_POST['as'] );

		if ( null !== $p && 0 === $p['shop'] ) {
			wp_set_auth_cookie( $p['id'], false, is_ssl() );
			wp_safe_redirect( home_url( example_shop_base() . '/' ), 303 );
			return;
		}
	}

	include __DIR__ . '/templates/login.php';
}

/** The shop page: the SDK scripts with the user settings, and the shop data. */
function example_shop_page() {
	$me = example_shop_person( get_current_user_id() );

	if ( null === $me ) {
		wp_safe_redirect( home_url( example_shop_base() . '/login' ), 303 );
		return;
	}

	$s     = $me['shop'];
	$order = example_shop( $s )['order'];
	$shop  = array(
		'me'      => $me,
		'people'  => example_shop_people( $s ),
		'order'   => $order,
		'chat'    => array( 'between' => array( $s * 100 + 34, $s * 100 + 42 ) ),
		'product' => array( 'name' => $order['item'], 'picture' => example_shop_asset( 'products/mugs.webp' ) ),
		'routes'  => array(
			'status'   => rest_url( 'example-shop/v1/orders/' . $order['id'] . '/status' ),
			'wire'     => rest_url( 'example-shop/v1/orders/' . $order['id'] . '/wire' ),
			'messages' => rest_url( 'example-shop/v1/chat/messages' ),
		),
		'rooms'   => example_shop_rooms( $s ),
		'events'  => array( 'order' => 'updated', 'chat' => 'message' ),
		'headers' => array( 'X-WP-Nonce' => wp_create_nonce( 'wp_rest' ) ),
	);

	if ( example_shop_demo() ) {
		$shop['demo'] = example_shop_demo_frame( $me );
	}

	// The SDK page script with this user settings, the calls and the Better Messages screens, and the live show.
	wordplus_realtime()->call_screen();
	wordplus_realtime()->stream_screen();

	include __DIR__ . '/templates/page.php';
}

// Unless the site has its credentials, an administrator is offered the connection, on the plugin row.
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
	if ( current_user_can( 'manage_options' ) && ! wordplus_realtime()->available() ) {
		$links[] = sprintf( '<a href="%s">%s</a>', esc_url( wordplus_realtime()->connect()->url( admin_url( 'plugins.php' ) ) ), esc_html__( 'Connect to WordPlus Cloud', 'example-shop' ) );
	}

	return $links;
} );
