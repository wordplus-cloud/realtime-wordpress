<?php
/**
 * Plugin Name: Live Comments
 * Description: An example of the WordPlus realtime SDK: a comment appears for everyone reading its post the moment it is approved, and signed-in readers see who else is reading.
 * Version:     1.0.0
 * Requires PHP: 7.4
 * License:     GPL-2.0-or-later
 * Text Domain: live-comments
 */

defined( 'ABSPATH' ) || exit;

// `composer require wordplus/realtime` puts the SDK here.
require __DIR__ . '/vendor/autoload.php';

/** The post room, which its new comments go to: public, as anyone may read them. */
function live_comments_room( $post_id ) {
	return 'live-comments:' . (int) $post_id;
}

/** Who reads the post: a presence room, which lists its members to each other. */
function live_comments_readers( $post_id ) {
	return 'live-comments-readers:' . (int) $post_id;
}

add_action( 'plugins_loaded', function () {
	// The comments of a post: anyone may listen, as anyone may read the post. The site alone sends to it.
	wordplus_realtime()->room( 'live-comments:{post}', null, array( 'public' => true ) );

	// Who reads a post: a signed-in user who may read it, under their name.
	wordplus_realtime()->room( 'live-comments-readers:{post}', function ( $user_id, array $p ) {
		$post = get_post( (int) $p['post'] );
		$user = get_userdata( $user_id );

		if ( ! $user || ! $post || ! is_post_publicly_viewable( $post ) || post_password_required( $post ) ) {
			return false;
		}

		return array( 'info' => array( 'name' => $user->display_name ) );
	}, array( 'presence' => true ) );
} );

/** Sends an approved comment to everyone reading its post: its author and text, never anything else. */
function live_comments_send( WP_Comment $comment ) {
	$post = get_post( (int) $comment->comment_post_ID );

	if ( ! $post || ! is_post_publicly_viewable( $post ) || '' !== $post->post_password || ! in_array( $comment->comment_type, array( '', 'comment' ), true ) ) {
		return;
	}

	wordplus_realtime()->to( live_comments_room( $post->ID ) )->emit( 'comment', array(
		'id'     => (int) $comment->comment_ID,
		'author' => get_comment_author( $comment ),
		'text'   => wp_strip_all_tags( $comment->comment_content ),
	) );
}

// A comment approved as it is posted, or later by a moderator.
add_action( 'wp_insert_comment', function ( $id, $comment ) {
	if ( '1' === (string) $comment->comment_approved ) {
		live_comments_send( $comment );
	}
}, 10, 2 );

add_action( 'transition_comment_status', function ( $new_status, $old_status, $comment ) {
	if ( 'approved' === $new_status && 'approved' !== $old_status ) {
		live_comments_send( $comment );
	}
}, 10, 3 );

add_action( 'wp_enqueue_scripts', function () {
	if ( ! is_singular() || post_password_required() ) {
		return;
	}

	// The SDK script, or an empty handle on a site that has not connected: this script loads either way.
	wp_enqueue_script( 'live-comments', plugins_url( 'live-comments.js', __FILE__ ), array( wordplus_realtime()->script() ), '1.0.0', true );
	wp_add_inline_script( 'live-comments', 'window.liveComments = ' . wp_json_encode( array(
		'room'    => live_comments_room( get_the_ID() ),
		// Only a signed-in reader is shown to the others, and sees them.
		'readers' => is_user_logged_in() ? live_comments_readers( get_the_ID() ) : '',
		'reading' => __( 'Reading now:', 'live-comments' ),
		'new'     => __( 'New comments', 'live-comments' ),
	) ) . ';', 'before' );
} );

// Unless the site has its credentials, an administrator is offered the connection, on the plugin row.
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
	if ( current_user_can( 'manage_options' ) && ! wordplus_realtime()->available() ) {
		$links[] = sprintf( '<a href="%s">%s</a>', esc_url( wordplus_realtime()->connect()->url( admin_url( 'plugins.php' ) ) ), esc_html__( 'Connect to WordPlus Cloud', 'live-comments' ) );
	}

	return $links;
} );
