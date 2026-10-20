<?php
defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'WordPlus_Realtime_Patterns' ) ) {
	/**
	 * Names by pattern (`order:{id}`), as every package of the realtime SDK matches them: `{part}`
	 * matches one or more characters other than `:` and `.`, as few as the rest allows; the pattern with the most
	 * characters of its own wins, and on a tie the one added first. Adding a pattern again replaces it in its place.
	 */
	final class WordPlus_Realtime_Patterns {
		/** @var array<int, array{pattern: string, re: string, parts: string[], literal: int, order: int, value: mixed}> */
		private $list = array();

		/** A room's, a call's or a group call's name: up to 200 of A-Z a-z 0-9 _ - = @ , . ; : */
		public static function valid_name( $name ) {
			return is_string( $name ) && 1 === preg_match( '/^[A-Za-z0-9_\-=@,.;:]{1,200}$/', $name );
		}

		public static function valid_pattern( $pattern ) {
			return is_string( $pattern ) && 1 === preg_match( '/^(?:[A-Za-z0-9_\-=@,.;:]|\{[A-Za-z_][A-Za-z0-9_]{0,31}\}){1,200}$/', $pattern );
		}

		/**
		 * @param string $pattern
		 * @param mixed  $value
		 * @return bool false for a pattern that isn't one
		 */
		public function add( $pattern, $value ) {
			if ( ! self::valid_pattern( $pattern ) ) {
				return false;
			}

			$parts  = array();
			$source = '';

			foreach ( (array) preg_split( '/(\{[^}]+\})/', $pattern, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY ) as $piece ) {
				if ( 0 === strpos( (string) $piece, '{' ) ) {
					$parts[] = substr( (string) $piece, 1, -1 );
					$source .= '([^:.]+?)';
				} else {
					$source .= preg_quote( (string) $piece, '/' );
				}
			}

			$existing = null;

			foreach ( $this->list as $i => $compiled ) {
				if ( $compiled['pattern'] === $pattern ) {
					$existing = $i;
				}
			}

			$compiled = array(
				'pattern' => $pattern,
				're'      => '/^' . $source . '$/',
				'parts'   => $parts,
				'literal' => strlen( (string) preg_replace( '/\{[^}]+\}/', '', $pattern ) ),
				'order'   => null === $existing ? count( $this->list ) : $this->list[ $existing ]['order'],
				'value'   => $value,
			);

			if ( null === $existing ) {
				$this->list[] = $compiled;
			} else {
				$this->list[ $existing ] = $compiled;
			}

			return true;
		}

		/**
		 * The pattern a name falls under: its value and the parts it named, or null for none.
		 *
		 * @param string $name
		 * @return array{pattern: string, value: mixed, params: array<string, string>}|null
		 */
		public function match( $name ) {
			$best   = null;
			$params = array();

			foreach ( $this->list as $compiled ) {
				if ( 1 !== preg_match( $compiled['re'], (string) $name, $m ) ) {
					continue;
				}

				if ( null !== $best && ( $compiled['literal'] < $best['literal'] || ( $compiled['literal'] === $best['literal'] && $compiled['order'] > $best['order'] ) ) ) {
					continue;
				}

				$best   = $compiled;
				$params = array();

				foreach ( $compiled['parts'] as $i => $part ) {
					$params[ $part ] = $m[ $i + 1 ];
				}
			}

			return null === $best ? null : array( 'pattern' => $best['pattern'], 'value' => $best['value'], 'params' => $params );
		}

		/** @return array<int, array{0: string, 1: mixed}> each pattern and its value, in the order added */
		public function entries() {
			return array_map( static function ( $compiled ) {
				return array( $compiled['pattern'], $compiled['value'] );
			}, $this->list );
		}
	}
}

if ( ! class_exists( 'WordPlus_Realtime_Emitter' ) ) {
	/**
	 * An emit from the site's server: `wordplus_realtime()->to( 'order:42' )->except( $tab )->emit( 'updated', $data )`,
	 * to rooms, to users (every connection they have open), or both.
	 */
	final class WordPlus_Realtime_Emitter {
		/** @var WordPlus_Realtime */
		private $realtime;

		/** @var array<string, true> */
		private $rooms = array();

		/** @var array<string, true> */
		private $users = array();

		/** @var string|null */
		private $skip = null;

		public function __construct( WordPlus_Realtime $realtime ) {
			$this->realtime = $realtime;
		}

		/**
		 * @param string|string[] $rooms
		 * @return $this
		 */
		public function to( $rooms ) {
			foreach ( (array) $rooms as $room ) {
				$this->rooms[ (string) $room ] = true;
			}

			return $this;
		}

		/**
		 * @param int|string|array $users
		 * @return $this
		 */
		public function to_user( $users ) {
			foreach ( (array) $users as $user ) {
				if ( null !== $user && '' !== $user && 0 !== $user && '0' !== $user ) {
					$this->users[ (string) $user ] = true;
				}
			}

			return $this;
		}

		/**
		 * The tab whose action made the change, which doesn't get it back: what the page sent as X-Realtime-Tab
		 * (WordPlus_Realtime::tab()).
		 *
		 * @param string|null $tab
		 * @return $this
		 */
		public function except( $tab ) {
			if ( null !== $tab && '' !== $tab ) {
				$this->skip = (string) $tab;
			}

			return $this;
		}

		/**
		 * Sends it: the kept events' ids by room, or a WP_Error with the realtime server's reason.
		 *
		 * @param string $event
		 * @param mixed  $data
		 * @param array  $options `seal` (true)
		 * @return array<string, string>|WP_Error
		 */
		public function emit( $event, $data = null, array $options = array() ) {
			return $this->realtime->emit_event( array(
				'rooms'  => array_map( 'strval', array_keys( $this->rooms ) ),
				'users'  => array_map( 'strval', array_keys( $this->users ) ),
				'event'  => (string) $event,
				'data'   => $data,
				'except' => $this->skip,
			) + $options );
		}
	}
}

if ( ! class_exists( 'WordPlus_Realtime_Room' ) ) {
	/** A room as the realtime server holds it: its count, members and history, and taking someone out of it. */
	final class WordPlus_Realtime_Room {
		/** @var WordPlus_Realtime */
		private $realtime;

		/** @var string */
		public $room;

		public function __construct( WordPlus_Realtime $realtime, $room ) {
			$this->realtime = $realtime;
			$this->room     = (string) $room;
		}

		/** @return int|WP_Error how many are in it */
		public function count() {
			$answer = $this->realtime->request( 'GET', '/wordplus/realtime/rooms/' . rawurlencode( $this->room ) );

			return is_wp_error( $answer ) ? $answer : (int) ( isset( $answer['count'] ) ? $answer['count'] : 0 );
		}

		/** @return array{count: int, list: array<int, array{id: string, info: mixed}>, next?: string}|WP_Error a presence room's members, their info opened */
		public function members() {
			$answer = $this->realtime->request( 'GET', '/wordplus/realtime/rooms/' . rawurlencode( $this->room ) . '?members=1' );

			if ( is_wp_error( $answer ) ) {
				return $answer;
			}

			$members          = isset( $answer['members'] ) && is_array( $answer['members'] ) ? $answer['members'] : array( 'count' => 0, 'list' => array() );
			$members['count'] = (int) ( isset( $members['count'] ) ? $members['count'] : 0 );
			$list             = array();

			foreach ( isset( $members['list'] ) ? (array) $members['list'] : array() as $member ) {
				if ( is_array( $member ) ) {
					$list[] = array( 'id' => (string) ( isset( $member['id'] ) ? $member['id'] : '' ), 'info' => $this->realtime->opened( isset( $member['info'] ) ? $member['info'] : null ) );
				}
			}

			$members['list'] = $list;

			return $members;
		}

		/**
		 * A page of the room's history, oldest first, each event's data opened.
		 *
		 * @param array $ask `before` or `after` (an event's id), `limit` (up to 100), `days`
		 * @return array{events: array<int, array{id: string, at: int, event: string, data: mixed, from?: string}>, more: bool}|WP_Error
		 */
		public function history( array $ask = array() ) {
			$query  = http_build_query( array_filter( $ask, static function ( $value ) {
				return null !== $value;
			} ) );
			$answer = $this->realtime->request( 'GET', '/wordplus/realtime/rooms/' . rawurlencode( $this->room ) . '/history' . ( '' === $query ? '' : '?' . $query ) );

			if ( is_wp_error( $answer ) ) {
				return $answer;
			}

			$events = array();

			foreach ( isset( $answer['events'] ) ? (array) $answer['events'] : array() as $e ) {
				if ( ! is_array( $e ) ) {
					continue;
				}

				$event = array(
					'id'    => (string) ( isset( $e['id'] ) ? $e['id'] : '' ),
					'at'    => (int) ( isset( $e['at'] ) ? $e['at'] : 0 ),
					'event' => (string) ( isset( $e['event'] ) ? $e['event'] : '' ),
					'data'  => $this->realtime->opened( isset( $e['data'] ) ? $e['data'] : null ),
				);

				if ( isset( $e['from'] ) ) {
					$event['from'] = (string) $e['from'];
				}

				$events[] = $event;
			}

			return array( 'events' => $events, 'more' => ! empty( $answer['more'] ) );
		}

		/**
		 * Erases one event of the room's history, or all of it: how many went.
		 *
		 * @param string|null $id
		 * @return int|WP_Error
		 */
		public function forget( $id = null ) {
			$answer = $this->realtime->request( 'DELETE', '/wordplus/realtime/rooms/' . rawurlencode( $this->room ) . '/history' . ( null === $id ? '' : '?id=' . rawurlencode( (string) $id ) ) );

			return is_wp_error( $answer ) ? $answer : (int) ( isset( $answer['deleted'] ) ? $answer['deleted'] : 0 );
		}

		/**
		 * Takes a user out of the room now, refuses them until their token runs out, and moves the room's key on, so a
		 * sealed event after the kick isn't theirs to read.
		 *
		 * @param int|string $user
		 * @return true|WP_Error
		 */
		public function kick( $user ) {
			$answer = $this->realtime->request( 'POST', '/wordplus/realtime/rooms/' . rawurlencode( $this->room ) . '/kick', array( 'user' => (string) $user ) );

			if ( is_wp_error( $answer ) ) {
				return $answer;
			}

			$this->realtime->keys()->rotate_room( $this->room );

			return true;
		}
	}
}

if ( ! class_exists( 'WordPlus_Realtime_Online' ) ) {
	/** Who is online across the site, as the realtime server knows them. */
	final class WordPlus_Realtime_Online {
		/** @var WordPlus_Realtime */
		private $realtime;

		public function __construct( WordPlus_Realtime $realtime ) {
			$this->realtime = $realtime;
		}

		/**
		 * @param array $users
		 * @return array<int, array{id: string, online: bool, at?: int}>|WP_Error each user's state, as asked
		 */
		public function states( array $users ) {
			if ( array() === $users ) {
				return array();
			}

			$answer = $this->realtime->request( 'GET', '/wordplus/realtime/online?ids=' . implode( ',', array_map( static function ( $user ) {
				return rawurlencode( (string) $user );
			}, $users ) ) );

			return is_wp_error( $answer ) ? $answer : array_values( isset( $answer['online'] ) ? (array) $answer['online'] : array() );
		}

		/** @return bool whether a user is online; false when the server can't be asked */
		public function has( $user ) {
			$states = $this->states( array( $user ) );

			return ! is_wp_error( $states ) && ! empty( $states[0]['online'] );
		}

		/** @return int|WP_Error how many are online */
		public function count() {
			$answer = $this->realtime->request( 'GET', '/wordplus/realtime/online?limit=1' );

			return is_wp_error( $answer ) ? $answer : (int) ( isset( $answer['count'] ) ? $answer['count'] : 0 );
		}

		/**
		 * @param string $cursor
		 * @param int    $limit
		 * @return array{ids: string[], next: string}|WP_Error a page of who is online; `next` '0' at the end
		 */
		public function list( $cursor = '0', $limit = 1000 ) {
			$answer = $this->realtime->request( 'GET', '/wordplus/realtime/online?cursor=' . rawurlencode( (string) $cursor ) . '&limit=' . (int) $limit );

			if ( is_wp_error( $answer ) ) {
				return $answer;
			}

			return array( 'ids' => array_values( array_map( 'strval', isset( $answer['ids'] ) ? (array) $answer['ids'] : array() ) ), 'next' => (string) ( isset( $answer['next'] ) ? $answer['next'] : '0' ) );
		}
	}
}
