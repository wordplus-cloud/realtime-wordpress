<?php
/**
 * The WordPlus realtime connector's loader (@wordplus/realtime-client), in every copy of the connector a
 * plugin ships: the WordPlus SDK's (its realtime/ folder, included from its start.php), in every plugin
 * carrying the SDK, the realtime SDK's package (wordplus/realtime), and any a plugin keeps of its own.
 *
 * Copyright (c) 2026 WordPlus. MIT License, as the connector's scripts beside it.
 *
 * Every copy adds its version. From the newest copy on the site holding each, the same on every page
 * whichever plugins' scripts a page loads:
 * - wordplus_realtime_worker_url(): the connector's SharedWorker (realtime-worker.js), so a browser's tabs
 *   all reach one SharedWorker, and so one connection. Each product hands the URL to its scripts as
 *   `worker`.
 * - wordplus_realtime_script(): the handle of the page script every product shares (realtime.min.js,
 *   `window.wordplusRealtimeClient`), registered once. A product's script that starts the connector
 *   depends on it rather than bundling the package.
 * - wordplus_realtime_calls_script(), wordplus_realtime_call_screen_script(),
 *   wordplus_realtime_stream_screen_script(), wordplus_realtime_rooms_url() and
 *   wordplus_realtime_rooms_worker_url(): the realtime SDK's calls (realtime-calls.min.js,
 *   `window.wordplusRealtimeCalls`), its drop-in call screen (@wordplus/realtime-ui's realtime-ui.min.js), its live
 *   stream elements (realtime-ui-streams.min.js), the mesh's
 *   room client they load when a room is needed (realtime-rooms.min.js), and its worker for an encrypted
 *   room (realtime-rooms-e2ee.worker.js), from the newest copy that carries them, since a copy may leave
 *   them out.
 *
 * Each file is looked for under its name, then under the names copies made before the first release used
 * (wordplus-realtime-worker.js, wordplus-realtime.min.js, wordplus-realtime.js, wordplus-realtime-calls.min.js
 * and the rest; wordplus_realtime_newest_of()), so such a copy still counts.
 *
 * Nothing here may change in a way an older copy's registration would break: the global's shape and
 * the functions are the contract every plugin is built against, and only ever added to. The version is
 * the package's, which its tests check.
 */
defined( 'ABSPATH' ) || exit;

if ( ! isset( $GLOBALS['wordplus_realtime_copies'] ) || ! is_array( $GLOBALS['wordplus_realtime_copies'] ) ) {
	$GLOBALS['wordplus_realtime_copies'] = array();
}

$GLOBALS['wordplus_realtime_copies'][ __FILE__ ] = '1.0.16';

if ( ! function_exists( 'wordplus_realtime_newest' ) ) {
	/**
	 * The newest copy on the site that holds `$script` beside its loader: its loader file and version, or
	 * null when none does. Between copies of one version, the same one on every page.
	 *
	 * @param string $script A file of the copy, such as realtime-worker.js.
	 * @return array{0: string, 1: string}|null
	 */
	function wordplus_realtime_newest( $script ) {
		$newest  = null;
		$version = '0';

		foreach ( (array) $GLOBALS['wordplus_realtime_copies'] as $file => $copy_version ) {
			$file         = (string) $file;
			$copy_version = (string) $copy_version;

			if ( ! is_readable( dirname( $file ) . '/' . $script ) ) {
				continue;
			}

			$order = version_compare( $copy_version, $version );

			if ( null === $newest || $order > 0 || ( 0 === $order && strcmp( $file, $newest ) < 0 ) ) {
				$newest  = $file;
				$version = $copy_version;
			}
		}

		return null === $newest ? null : array( $newest, $version );
	}
}

if ( ! function_exists( 'wordplus_realtime_newest_of' ) ) {
	/**
	 * The newest copy on the site that holds a file under any of `$names`, its name first and then its
	 * older ones: its loader file, its version and the name it holds, or null when none does. Between a
	 * copy holding the name and one of the same version holding an older name, the name.
	 *
	 * @param string[] $names The file's name, then its older names.
	 * @return array{0: string, 1: string, 2: string}|null
	 */
	function wordplus_realtime_newest_of( $names ) {
		$found = null;

		foreach ( (array) $names as $name ) {
			$newest = wordplus_realtime_newest( (string) $name );

			if ( null !== $newest && ( null === $found || version_compare( $newest[1], $found[1] ) > 0 ) ) {
				$found = array( $newest[0], $newest[1], (string) $name );
			}
		}

		return $found;
	}
}

if ( ! function_exists( 'wordplus_realtime_worker_url' ) ) {
	/**
	 * The connector's SharedWorker script of the newest copy on the site, with its version, or an
	 * empty string when no copy's worker is there.
	 *
	 * @return string
	 */
	function wordplus_realtime_worker_url() {
		$newest = wordplus_realtime_newest_of( array( 'realtime-worker.js', 'wordplus-realtime-worker.js' ) );

		return null === $newest ? '' : add_query_arg( 'ver', $newest[1], plugins_url( $newest[2], $newest[0] ) );
	}
}

if ( ! function_exists( 'wordplus_realtime_script' ) ) {
	/**
	 * The page script every product shares, the newest copy's, registered once as `wordplus-realtime`: the
	 * handle a product's script depends on to read `window.wordplusRealtimeClient`. An empty string when
	 * no copy has it.
	 *
	 * @return string
	 */
	function wordplus_realtime_script() {
		if ( wp_script_is( 'wordplus-realtime', 'registered' ) ) {
			return 'wordplus-realtime';
		}

		// Named .min.js, so the optimisation plugins that minify a page's scripts leave it alone. A copy from
		// before the first release holds wordplus-realtime.min.js or wordplus-realtime.js, and still counts.
		$newest = wordplus_realtime_newest_of( array( 'realtime.min.js', 'wordplus-realtime.min.js', 'wordplus-realtime.js' ) );

		if ( null === $newest ) {
			return '';
		}

		wp_register_script( 'wordplus-realtime', plugins_url( $newest[2], $newest[0] ), array(), $newest[1], true );

		return 'wordplus-realtime';
	}
}

if ( ! function_exists( 'wordplus_realtime_calls_script' ) ) {
	/**
	 * The realtime SDK's calls, the newest copy's that carries them, registered once as
	 * `wordplus-realtime-calls` after the page script, whose `channels()` they ride: `window.wordplusRealtimeCalls`.
	 * An empty string when no copy carries them, or none has the page script.
	 *
	 * @return string
	 */
	function wordplus_realtime_calls_script() {
		if ( wp_script_is( 'wordplus-realtime-calls', 'registered' ) ) {
			return 'wordplus-realtime-calls';
		}

		$newest = wordplus_realtime_newest_of( array( 'realtime-calls.min.js', 'wordplus-realtime-calls.min.js' ) );
		$page   = null === $newest ? '' : wordplus_realtime_script();

		if ( '' === $page ) {
			return '';
		}

		wp_register_script( 'wordplus-realtime-calls', plugins_url( $newest[2], $newest[0] ), array( $page ), $newest[1], true );

		return 'wordplus-realtime-calls';
	}
}

if ( ! function_exists( 'wordplus_realtime_call_screen_script' ) ) {
	/**
	 * The realtime SDK's drop-in call screen, the newest copy's that carries it, registered once as
	 * `wordplus-realtime-call-screen` after the calls script it runs on. An empty string when no copy
	 * carries it, or the calls.
	 *
	 * Since protocol 3 the screen is @wordplus/realtime-ui's elements (realtime-ui.min.js): Better Messages'
	 * call screens, on the same elements and the same `window.wordplusRealtimeCalls.page()`. A copy from
	 * before carries the old screen under its own names, which still count; a copy carrying both gives the
	 * new one.
	 *
	 * @return string
	 */
	function wordplus_realtime_call_screen_script() {
		if ( wp_script_is( 'wordplus-realtime-call-screen', 'registered' ) ) {
			return 'wordplus-realtime-call-screen';
		}

		$newest = wordplus_realtime_newest_of( array( 'realtime-ui.min.js', 'realtime-call-screen.min.js', 'wordplus-realtime-call-screen.min.js' ) );
		$calls  = null === $newest ? '' : wordplus_realtime_calls_script();

		if ( '' === $calls ) {
			return '';
		}

		wp_register_script( 'wordplus-realtime-call-screen', plugins_url( $newest[2], $newest[0] ), array( $calls ), $newest[1], true );

		return 'wordplus-realtime-call-screen';
	}
}

if ( ! function_exists( 'wordplus_realtime_stream_screen_script' ) ) {
	/**
	 * The realtime SDK's live stream elements (@wordplus/realtime-ui's realtime-ui-streams.min.js:
	 * `<live-stream>` and `<stream-studio>`, Easy Stream's player, chat and studio), the newest copy's
	 * that carries them, registered once as `wordplus-realtime-stream-screen` after the calls script they run
	 * on. An empty string when no copy carries them, or the calls.
	 *
	 * @return string
	 */
	function wordplus_realtime_stream_screen_script() {
		if ( wp_script_is( 'wordplus-realtime-stream-screen', 'registered' ) ) {
			return 'wordplus-realtime-stream-screen';
		}

		$newest = wordplus_realtime_newest_of( array( 'realtime-ui-streams.min.js' ) );
		$calls  = null === $newest ? '' : wordplus_realtime_calls_script();

		if ( '' === $calls ) {
			return '';
		}

		wp_register_script( 'wordplus-realtime-stream-screen', plugins_url( $newest[2], $newest[0] ), array( $calls ), $newest[1], true );

		return 'wordplus-realtime-stream-screen';
	}
}

if ( ! function_exists( 'wordplus_realtime_rooms_url' ) ) {
	/**
	 * The mesh's room client (realtime-rooms.min.js), the newest copy's that carries it, with its version:
	 * the calls load it when a page first needs a room. An empty string when no copy carries it.
	 *
	 * @return string
	 */
	function wordplus_realtime_rooms_url() {
		$newest = wordplus_realtime_newest_of( array( 'realtime-rooms.min.js', 'wordplus-realtime-rooms.min.js' ) );

		return null === $newest ? '' : add_query_arg( 'ver', $newest[1], plugins_url( $newest[2], $newest[0] ) );
	}
}

if ( ! function_exists( 'wordplus_realtime_rooms_worker_url' ) ) {
	/**
	 * The room client's encryption worker (realtime-rooms-e2ee.worker.js), the newest copy's that carries it, with
	 * its version: a page starts it for a room whose media is encrypted end to end. An empty string when no copy
	 * carries it.
	 *
	 * @return string
	 */
	function wordplus_realtime_rooms_worker_url() {
		$newest = wordplus_realtime_newest_of( array( 'realtime-rooms-e2ee.worker.js' ) );

		return null === $newest ? '' : add_query_arg( 'ver', $newest[1], plugins_url( $newest[2], $newest[0] ) );
	}
}
