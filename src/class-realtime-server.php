<?php
/**
 * What the server of the site reads and does beyond sending (docs.wordplus.cloud/api/reference/): a user, the webhook of
 * the site, its group calls and its live streams, each a signed request to the realtime server, a refusal a WP_Error.
 *
 * @package WordPlus\Realtime
 */

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'WordPlus_Realtime_Answer' ) ) {
	/** A field of the answer of the realtime server, or the WP_Error it was. */
	final class WordPlus_Realtime_Answer {
		/**
		 * @param array|WP_Error $answer
		 * @param string         $key
		 * @param mixed          $fallback
		 * @return mixed|WP_Error
		 */
		public static function field( $answer, $key, $fallback ) {
			if ( is_wp_error( $answer ) ) {
				return $answer;
			}

			return isset( $answer[ $key ] ) ? $answer[ $key ] : $fallback;
		}

		/**
		 * What a webhook sent now did: taken (a 2xx), its HTTP status, and why not.
		 *
		 * @param array|WP_Error $answer
		 * @return array{delivered: bool, status: int, error?: string}|WP_Error
		 */
		public static function outcome( $answer ) {
			if ( is_wp_error( $answer ) ) {
				return $answer;
			}

			$out = array( 'delivered' => ! empty( $answer['delivered'] ), 'status' => (int) ( isset( $answer['status'] ) ? $answer['status'] : 0 ) );

			if ( isset( $answer['error'] ) ) {
				$out['error'] = (string) $answer['error'];
			}

			return $out;
		}
	}
}

if ( ! class_exists( 'WordPlus_Realtime_User' ) ) {
	/** A user as the realtime server knows them: their state, taking them out of everything at once, asking their pages. */
	final class WordPlus_Realtime_User {
		/** @var WordPlus_Realtime */
		private $realtime;

		/** @var string */
		public $id;

		/** @var string */
		private $path;

		public function __construct( WordPlus_Realtime $realtime, $id ) {
			$this->realtime = $realtime;
			$this->id       = (string) $id;
			$this->path     = '/wordplus/realtime/users/' . rawurlencode( $this->id );
		}

		/** @return array{id: string, online: bool, at?: int, connections: int}|WP_Error online, or since when they were last seen, and their connections open */
		public function get() {
			return WordPlus_Realtime_Answer::field( $this->realtime->request( 'GET', $this->path ), 'user', array() );
		}

		/**
		 * Takes the user out of everything at once: every room, their identity, their lines, group calls and live streams
		 * (a host stays). Their pages then ask the routes of the site again, and the tokens signed before are refused, so
		 * the rules of the site decide whether they come back.
		 *
		 * @return true|WP_Error
		 */
		public function disconnect() {
			$answer = $this->realtime->request( 'POST', $this->path . '/disconnect' );

			return is_wp_error( $answer ) ? $answer : true;
		}

		/**
		 * Asks the open pages of the user and waits for their replies: the first by default, every reply within `timeout`
		 * (ms, 1,000 to 60,000) with `all`. A page answers with `rt.answer( event, handler )` in the browser. The data is
		 * sealed with the key of the user unless `seal` is false, and the replies are opened.
		 *
		 * @param string $event
		 * @param mixed  $data
		 * @param array  $options `timeout`, `all`, `seal`
		 * @return array<int, array{data: mixed, at: int}>|WP_Error
		 */
		public function ask( $event, $data = null, array $options = array() ) {
			$body = array( 'event' => (string) $event, 'data' => $this->realtime->sealed_for( $this->id, $data, ! isset( $options['seal'] ) || false !== $options['seal'] ) );

			if ( isset( $options['timeout'] ) ) {
				$body['timeout'] = (int) $options['timeout'];
			}
			if ( ! empty( $options['all'] ) ) {
				$body['all'] = true;
			}

			$replies = WordPlus_Realtime_Answer::field( $this->realtime->request( 'POST', $this->path . '/ask', $body ), 'replies', array() );

			if ( is_wp_error( $replies ) ) {
				return $replies;
			}

			$out = array();

			foreach ( (array) $replies as $reply ) {
				if ( is_array( $reply ) ) {
					$out[] = array( 'data' => $this->realtime->opened( isset( $reply['data'] ) ? $reply['data'] : null ), 'at' => (int) ( isset( $reply['at'] ) ? $reply['at'] : 0 ) );
				}
			}

			return $out;
		}
	}
}

if ( ! class_exists( 'WordPlus_Realtime_Webhooks' ) ) {
	/** The webhook of the site as the realtime server sends it. */
	final class WordPlus_Realtime_Webhooks {
		/** @var WordPlus_Realtime */
		private $realtime;

		public function __construct( WordPlus_Realtime $realtime ) {
			$this->realtime = $realtime;
		}

		/** @return array|WP_Error the last 100 tries of the last three days, the newest first */
		public function deliveries() {
			$list = WordPlus_Realtime_Answer::field( $this->realtime->request( 'GET', '/wordplus/realtime/webhooks' ), 'deliveries', array() );

			return is_wp_error( $list ) ? $list : array_values( (array) $list );
		}

		/**
		 * A batch the server of the site did not take, sent again now.
		 *
		 * @param string $id the batch, from its delivery
		 * @return array{delivered: bool, status: int, error?: string}|WP_Error
		 */
		public function resend( $id ) {
			return WordPlus_Realtime_Answer::outcome( $this->realtime->request( 'POST', '/wordplus/realtime/webhooks/' . rawurlencode( (string) $id ) . '/resend' ) );
		}

		/** @return array{delivered: bool, status: int, error?: string}|WP_Error one webhook.test event sent now */
		public function test() {
			return WordPlus_Realtime_Answer::outcome( $this->realtime->request( 'POST', '/wordplus/realtime/webhooks/test' ) );
		}
	}
}

if ( ! class_exists( 'WordPlus_Realtime_Call' ) ) {
	/** A group call as the media server holds it: its people, muting, removing someone, ending it. */
	final class WordPlus_Realtime_Call {
		/** @var WordPlus_Realtime */
		private $realtime;

		/** @var string */
		public $name;

		/** @var string */
		private $path;

		public function __construct( WordPlus_Realtime $realtime, $name ) {
			$this->realtime = $realtime;
			$this->name     = (string) $name;
			$this->path     = '/wordplus/realtime/calls/' . rawurlencode( $this->name );
		}

		/**
		 * @return array|WP_Error its people and what each sends now: `camera`, `microphone`, `screen`. With nobody in it,
		 *                        `people` is 0, `started_at` null and `list` empty.
		 */
		public function get() {
			return WordPlus_Realtime_Answer::field( $this->realtime->request( 'GET', $this->path ), 'call', array() );
		}

		/**
		 * Turns the microphone, camera or screen of someone off. They may turn it on again.
		 *
		 * @param int|string $user
		 * @param string     $track `microphone`, `camera` or `screen`
		 * @return bool|WP_Error whether it was on
		 */
		public function mute( $user, $track ) {
			$muted = WordPlus_Realtime_Answer::field( $this->realtime->request( 'POST', $this->path . '/mute', array( 'user' => (string) $user, 'track' => (string) $track ) ), 'muted', false );

			return is_wp_error( $muted ) ? $muted : (bool) $muted;
		}

		/**
		 * Takes someone out now. The tokens signed for them before do not take them back in.
		 *
		 * @param int|string $user
		 * @return bool|WP_Error whether they were in it
		 */
		public function remove( $user ) {
			$removed = WordPlus_Realtime_Answer::field( $this->realtime->request( 'POST', $this->path . '/remove', array( 'user' => (string) $user ) ), 'removed', false );

			return is_wp_error( $removed ) ? $removed : (bool) $removed;
		}

		/**
		 * Changes what someone may do while it runs: `publish` to make a listener a speaker or a speaker a listener again,
		 * which stops what they send, `subscribe` to stop or start getting the others. At once for them when they are in
		 * it, and their page hears `permissions`. Their tokens signed before follow it too. The rule decides every join
		 * after, so keep it there as well.
		 *
		 * @param int|string $user
		 * @param array      $can  `publish` and `subscribe`, booleans, either or both
		 * @return bool|WP_Error whether they were in it
		 */
		public function permit( $user, array $can ) {
			$body = array( 'user' => (string) $user );
			foreach ( array( 'publish', 'subscribe' ) as $part ) {
				if ( isset( $can[ $part ] ) ) {
					$body[ $part ] = (bool) $can[ $part ];
				}
			}
			$changed = WordPlus_Realtime_Answer::field( $this->realtime->request( 'POST', $this->path . '/permit', $body ), 'changed', false );

			return is_wp_error( $changed ) ? $changed : (bool) $changed;
		}

		/** @return true|WP_Error the call ended for everyone, the tokens signed before refused */
		public function end() {
			$answer = $this->realtime->request( 'POST', $this->path . '/end' );

			return is_wp_error( $answer ) ? $answer : true;
		}
	}
}

if ( ! class_exists( 'WordPlus_Realtime_Stream' ) ) {
	/** A live stream, and what its moderators do, from the server of the site: each change reaches everyone watching at once. */
	final class WordPlus_Realtime_Stream {
		/** @var WordPlus_Realtime */
		private $realtime;

		/** @var string */
		public $name;

		/** @var string */
		private $path;

		public function __construct( WordPlus_Realtime $realtime, $name ) {
			$this->realtime = $realtime;
			$this->name     = (string) $name;
			$this->path     = '/wordplus/realtime/streams/' . rawurlencode( $this->name );
		}

		/** @return array|WP_Error its state, how many watch now, its peak, slow mode, reactions and the pinned message */
		public function get() {
			return WordPlus_Realtime_Answer::field( $this->realtime->request( 'GET', $this->path ), 'stream', array() );
		}

		/** @return array{watching: int, people: array}|WP_Error the signed-in people watching or on it, and how many watch in all */
		public function people() {
			$answer = $this->realtime->request( 'GET', $this->path . '/people' );

			if ( is_wp_error( $answer ) ) {
				return $answer;
			}

			return array( 'watching' => (int) ( isset( $answer['watching'] ) ? $answer['watching'] : 0 ), 'people' => array_values( isset( $answer['people'] ) ? (array) $answer['people'] : array() ) );
		}

		/**
		 * @param int|null $limit up to 200, 50 by default
		 * @return array|WP_Error the last messages of the chat, oldest first
		 */
		public function chat( $limit = null ) {
			$messages = WordPlus_Realtime_Answer::field( $this->realtime->request( 'GET', $this->path . '/chat' . ( null === $limit ? '' : '?limit=' . (int) $limit ) ), 'messages', array() );

			return is_wp_error( $messages ) ? $messages : array_values( (array) $messages );
		}

		/**
		 * A message from the site in the chat, shown as a host message: its name and an https picture of its own.
		 *
		 * @param string      $text
		 * @param string      $name
		 * @param string|null $avatar
		 * @return array|WP_Error the message, as everyone watching got it
		 */
		public function say( $text, $name, $avatar = null ) {
			$body = array( 'text' => (string) $text, 'name' => (string) $name );

			if ( null !== $avatar ) {
				$body['avatar'] = (string) $avatar;
			}

			return WordPlus_Realtime_Answer::field( $this->realtime->request( 'POST', $this->path . '/chat', $body ), 'message', array() );
		}

		/**
		 * @param string $id
		 * @return bool|WP_Error whether the message was there
		 */
		public function delete_message( $id ) {
			$deleted = WordPlus_Realtime_Answer::field( $this->realtime->request( 'DELETE', $this->path . '/chat/' . rawurlencode( (string) $id ) ), 'deleted', false );

			return is_wp_error( $deleted ) ? $deleted : (bool) $deleted;
		}

		/** @return true|WP_Error the chat emptied for everyone, the pinned message too */
		public function clear_chat() {
			return $this->done( $this->realtime->request( 'DELETE', $this->path . '/chat' ) );
		}

		/**
		 * @param string|null $id a message, or null to unpin
		 * @return true|WP_Error
		 */
		public function pin( $id ) {
			return $this->done( $this->realtime->request( 'POST', $this->path . '/pin', array( 'id' => null === $id ? null : (string) $id ) ) );
		}

		/**
		 * @param int $seconds one message every so many seconds, up to 300, for all but the hosts and moderators, 0 for off
		 * @return true|WP_Error
		 */
		public function slow( $seconds ) {
			return $this->done( $this->realtime->request( 'POST', $this->path . '/slow', array( 'seconds' => (int) $seconds ) ) );
		}

		/**
		 * Someone may not write for a while, from 60 seconds to a day, and goes on watching.
		 *
		 * @param int|string $user
		 * @param int        $seconds
		 * @return int|WP_Error when it ends, in milliseconds
		 */
		public function timeout( $user, $seconds ) {
			$until = WordPlus_Realtime_Answer::field( $this->realtime->request( 'POST', $this->path . '/timeout', array( 'user' => (string) $user, 'seconds' => (int) $seconds ) ), 'until', 0 );

			return is_wp_error( $until ) ? $until : (int) $until;
		}

		/**
		 * @param int|string $user
		 * @return bool|WP_Error whether there was a timeout
		 */
		public function untimeout( $user ) {
			return $this->lifted( $this->realtime->request( 'POST', $this->path . '/untimeout', array( 'user' => (string) $user ) ) );
		}

		/**
		 * Out of the stream now, free to come back.
		 *
		 * @param int|string $user
		 * @return true|WP_Error
		 */
		public function kick( $user ) {
			return $this->done( $this->realtime->request( 'POST', $this->path . '/kick', array( 'user' => (string) $user ) ) );
		}

		/**
		 * Out of the stream until a moderator lifts it.
		 *
		 * @param int|string $user
		 * @return true|WP_Error
		 */
		public function ban( $user ) {
			return $this->done( $this->realtime->request( 'POST', $this->path . '/ban', array( 'user' => (string) $user ) ) );
		}

		/**
		 * @param int|string $user
		 * @return bool|WP_Error whether there was a ban
		 */
		public function unban( $user ) {
			return $this->lifted( $this->realtime->request( 'POST', $this->path . '/unban', array( 'user' => (string) $user ) ) );
		}

		/** @return array|WP_Error everyone banned, the latest first */
		public function bans() {
			$bans = WordPlus_Realtime_Answer::field( $this->realtime->request( 'GET', $this->path . '/bans' ), 'bans', array() );

			return is_wp_error( $bans ) ? $bans : array_values( (array) $bans );
		}

		/**
		 * @param bool $on
		 * @return true|WP_Error reactions on or off for everyone watching
		 */
		public function reactions( $on ) {
			return $this->done( $this->realtime->request( 'POST', $this->path . '/reactions', array( 'on' => (bool) $on ) ) );
		}

		/** @return array|WP_Error ended, as End does for its host */
		public function end() {
			return WordPlus_Realtime_Answer::field( $this->realtime->request( 'POST', $this->path . '/end' ), 'stream', array() );
		}

		/**
		 * @param array|WP_Error $answer
		 * @return true|WP_Error
		 */
		private function done( $answer ) {
			return is_wp_error( $answer ) ? $answer : true;
		}

		/**
		 * @param array|WP_Error $answer
		 * @return bool|WP_Error
		 */
		private function lifted( $answer ) {
			$lifted = WordPlus_Realtime_Answer::field( $answer, 'lifted', false );

			return is_wp_error( $lifted ) ? $lifted : (bool) $lifted;
		}
	}
}
