<?php
/**
 * wordplus/realtime: the realtime SDK for any plugin, theme or custom code on a site with WordPlus Cloud, its PHP
 * part. Rooms with presence, live counts and history, events from the site and between browsers, who is online, calls
 * between two people and group calls, on the connection a page shares with WordPlus's own plugins, which follows the
 * realtime server from node to node without a drop.
 *
 * Every copy a plugin bundles (Composer's `files`, or a require of this file) registers its version and folder, and
 * wordplus_realtime() answers from the newest copy on the site, loaded once at its first call: use it from
 * plugins_loaded on, as every copy is registered by then. What it offers only grows, so a plugin built against an
 * older copy works beside a newer one.
 *
 * It includes the connector's loader (realtime/), which picks the newest connector on the site by itself, whichever
 * plugin carries it: this package's copies, the WordPlus SDK's, or a plugin's own.
 */

// Composer's autoloader includes this file (`files`), also before WordPress, in a test run or a CLI tool: it then
// registers nothing, and ends nothing.
if ( ! defined( 'ABSPATH' ) ) {
	return;
}

// The connector this copy carries; a copy inside the WordPlus SDK has the SDK's instead, which its start.php includes.
if ( is_readable( __DIR__ . '/realtime/realtime.php' ) ) {
	require_once __DIR__ . '/realtime/realtime.php';
}

if ( ! isset( $GLOBALS['wordplus_realtime_sdk_copies'] ) || ! is_array( $GLOBALS['wordplus_realtime_sdk_copies'] ) ) {
	$GLOBALS['wordplus_realtime_sdk_copies'] = array();
}

$GLOBALS['wordplus_realtime_sdk_copies'][ __DIR__ ] = '1.0.1';

if ( ! function_exists( 'wordplus_realtime' ) ) {
	/**
	 * The site's realtime SDK, from the newest copy of this package on it.
	 *
	 * @return WordPlus_Realtime
	 */
	function wordplus_realtime() {
		if ( empty( $GLOBALS['wordplus_realtime_sdk'] ) ) {
			$newest  = '';
			$version = '0';

			foreach ( (array) $GLOBALS['wordplus_realtime_sdk_copies'] as $dir => $copy_version ) {
				$order = version_compare( (string) $copy_version, $version );

				if ( '' === $newest || $order > 0 || ( 0 === $order && strcmp( (string) $dir, $newest ) < 0 ) ) {
					$newest  = (string) $dir;
					$version = (string) $copy_version;
				}
			}

			require_once $newest . '/src/class-realtime.php';
			require_once $newest . '/src/class-realtime-connect.php';
			require_once $newest . '/src/class-realtime-keys.php';

			$GLOBALS['wordplus_realtime_sdk'] = new WordPlus_Realtime( $version );
		}

		return $GLOBALS['wordplus_realtime_sdk'];
	}

	// The site's auth and calls routes and Connect's return, from the newest copy, once whichever plugins carry the package.
	add_action( 'rest_api_init', static function () {
		wordplus_realtime()->register_routes();
	} );

	add_action( 'admin_post_wordplus_realtime_connect', static function () {
		wordplus_realtime()->connect()->callback();
	} );
}
