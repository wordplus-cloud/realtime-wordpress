<?php
/**
 * Plugin Name: Video Support
 * Description: An example of the calls of the WordPlus realtime SDK: a signed-in customer calls the shop support agent from any page with the [video_support] shortcode, every open tab of the agent rings, the agent may bring the shop staff into the call, and the staff talk in a room of their own, encrypted end to end. No call code: the drop-in call screen of the SDK does it all.
 * Version:     1.0.0
 * Requires PHP: 7.4
 * License:     GPL-2.0-or-later
 * Text Domain: video-support
 */

defined( 'ABSPATH' ) || exit;

// `composer require wordplus/realtime` puts the SDK here.
require __DIR__ . '/vendor/autoload.php';

/** The agent who takes the calls: the user the setting names, the first administrator by default. */
function video_support_agent() {
	$agent = (int) get_option( 'video_support_agent', 0 );

	if ( $agent > 0 ) {
		return $agent;
	}

	$admins = get_users( array( 'role' => 'administrator', 'orderby' => 'ID', 'number' => 1, 'fields' => 'ID' ) );

	return $admins ? (int) $admins[0] : 0;
}

/** A customer call to support is theirs alone: `support:<their user id>`. */
function video_support_call( $customer_id ) {
	return 'support:' . (int) $customer_id;
}

/** The group call of the staff: everyone who may edit the posts of others. */
const VIDEO_SUPPORT_ROOM = 'support-staff';

/** Whether a user is one of the shop staff. */
function video_support_staff( $user_id ) {
	return $user_id > 0 && user_can( $user_id, 'edit_others_posts' );
}

add_action( 'plugins_loaded', function () {
	// A customer call to support, `support:{customer}`, and who may take part in it.
	wordplus_realtime()->calls( 'support:{customer}', function ( $user_id, $with, array $p ) {
		$agent = video_support_agent();

		// The agent answers a customer call to support, and may bring one of the staff into it.
		if ( $user_id === $agent ) {
			return (int) $p['customer'] === $with || video_support_staff( $with );
		}

		// One of the staff, brought in by the agent.
		if ( $with === $agent && video_support_staff( $user_id ) ) {
			return true;
		}

		// A customer calls the agent, on their own call only.
		return $with === $agent && (int) $p['customer'] === $user_id;
	}, array(
		// Whom the call screen offers the agent to add to a call: the staff.
		'people' => function ( $user_id ) {
			return video_support_agent() === $user_id ? get_users( array( 'capability' => 'edit_others_posts', 'fields' => 'ID' ) ) : array();
		},
	) );

	// The staff group call: the staff, and an administrator runs it. Encrypted end to end too, as the rooms of a call
	// always are.
	wordplus_realtime()->group_calls( VIDEO_SUPPORT_ROOM, function ( $user_id ) {
		return video_support_staff( $user_id ) ? array( 'admin' => user_can( $user_id, 'manage_options' ) ) : false;
	}, array( 'encrypt' => true ) );
} );

// The call screen on every page, so the agent calls ring wherever they are on the site.
add_action( 'wp_enqueue_scripts', function () {
	if ( is_user_logged_in() ) {
		wordplus_realtime()->call_screen();
	}
} );

// [video_support]: a customer button that calls the agent. For the staff, their room.
add_shortcode( 'video_support', function () {
	if ( ! is_user_logged_in() ) {
		return '<p>' . esc_html__( 'Sign in to call support.', 'video-support' ) . '</p>';
	}

	if ( ! wordplus_realtime()->available() ) {
		return '<p>' . esc_html__( 'Calls are not set up on this site yet.', 'video-support' ) . '</p>';
	}

	$me    = get_current_user_id();
	$agent = get_userdata( video_support_agent() );

	if ( user_can( $me, 'edit_others_posts' ) ) {
		$on_duty = $agent && $agent->ID === $me ? '<p>' . esc_html__( 'You are on duty: calls from customers ring on any page of the site you have open.', 'video-support' ) . '</p>' : '';

		// Its name as the site has it: `room-button`, or the site's prefix before it.
		return $on_duty . sprintf(
			'<%1$s room="%2$s" type="video" title="%3$s">%4$s</%1$s>',
			wordplus_realtime()->element_name( 'room-button' ),
			esc_attr( VIDEO_SUPPORT_ROOM ),
			esc_attr__( 'Staff room', 'video-support' ),
			esc_html__( 'Join the staff room', 'video-support' )
		);
	}

	if ( ! $agent ) {
		return '<p>' . esc_html__( 'There is no one to call yet.', 'video-support' ) . '</p>';
	}

	return sprintf(
		'<%1$s to="%2$d" call="%3$s" type="video" name="%4$s" avatar="%5$s">%6$s</%1$s>',
		wordplus_realtime()->element_name( 'call-button' ),
		(int) $agent->ID,
		esc_attr( video_support_call( $me ) ),
		esc_attr( $agent->display_name ),
		esc_url( get_avatar_url( $agent->ID, array( 'size' => 128 ) ) ),
		/* translators: %s: the support agent name. */
		esc_html( sprintf( __( 'Video call %s', 'video-support' ), $agent->display_name ) )
	);
} );

// Unless the site has its credentials, an administrator is offered the connection, on the plugin row.
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
	if ( current_user_can( 'manage_options' ) && ! wordplus_realtime()->available() ) {
		$links[] = sprintf( '<a href="%s">%s</a>', esc_url( wordplus_realtime()->connect()->url( admin_url( 'plugins.php' ) ) ), esc_html__( 'Connect to WordPlus Cloud', 'video-support' ) );
	}

	return $links;
} );
