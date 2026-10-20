<?php
defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'WordPlus_Realtime_Keys' ) ) {
	/**
	 * The keys that seal what a site sends through the realtime server, so WordPlus Cloud carries it without being able
	 * to read or change it: one master key that never leaves WordPress, and every key a browser gets derived from it,
	 * each opening only what its holder may see on the site already. Every plugin on the site shares them, whichever
	 * copy of this package or of the WordPlus SDK it carries, so what one seals another opens.
	 *
	 * A key is named by its label, `{kind}:{…}`:
	 *
	 * - `d:{day}` the day's key (UTC days since 1970): what everyone the site signed in may see, such as the users'
	 *   names, avatars and profile links in the directory (profile()). Anyone the site knows gets it.
	 * - `u:{id}:{generation}` a user's personal key, for what goes to that user alone. It moves on when the user's
	 *   access is revoked (rotate_user()).
	 * - `ch:{room}:{generation}` a sealed room's key, for its events and its members' info. Whoever the room's rule lets
	 *   in gets it, with the room's token. It moves on when someone loses access (rotate_room()).
	 * - a plugin's own kinds (kind()), such as the conversations of Better Messages (`c:{thread}:{generation}`).
	 *
	 * A sealed value is `{label}:1.{base64url( nonce . ciphertext )}`: XChaCha20-Poly1305 with a random 24-byte nonce
	 * and the label as associated data, under `HMAC-SHA256( master, "wordplus-realtime key v1|" . label )`. The browser
	 * reads the label, finds the key in its keyring or asks the site for it (the keys route), and opens the value; a
	 * value changed on the way doesn't open. PHP has it in sodium, and WordPress carries sodium_compat for a PHP
	 * without the extension.
	 */
	final class WordPlus_Realtime_Keys {
		/** The master key, 64 hex characters, made on first use and kept for the whole network. */
		const MASTER_OPTION = 'wordplus_realtime_master_key';

		/** The generations moved on of rooms and of users WordPress doesn't know (visitors): `ch:{room}` and `u:{id}` => n. */
		const GENERATIONS_OPTION = 'wordplus_realtime_key_generations';

		/** A WordPress user's personal key's generation, in their meta; 1 when unset. */
		const USER_GENERATION = 'wordplus_realtime_key_generation';

		const DERIVE      = 'wordplus-realtime key v1|';
		const FORMAT      = '1';
		const NONCE_BYTES = 24;

		/** A room's media key's derivation, apart from the labels' so no label ever names one; and a call's proofs'. */
		const MEDIA = 'wordplus-realtime media v1|';
		const PROOF = 'wordplus-realtime proof v1|';

		/** A label: its kind, then up to 240 of the characters room names take, and `:`. */
		const LABEL = '[a-z][a-z0-9]{0,15}:[A-Za-z0-9_\-=@,.;:]{1,240}';

		/** The kinds this package owns; a plugin's own take any other name. */
		const RESERVED = array( 'd', 'u', 'ch' );

		/** Labels one request to the keys route may ask for. */
		const MAX_LABELS = 100;

		const ROUTE = '/realtime/keys';

		/** @var WordPlus_Realtime */
		private $realtime;

		/** @var array<string, array{0: callable, 1: callable|null}> a plugin's kind => who may have its keys, and its newest */
		private $kinds = array();

		/** @var string|null */
		private $master = null;

		public function __construct( WordPlus_Realtime $realtime ) {
			$this->realtime = $realtime;
		}

		/**
		 * Keys of a plugin's own, by their kind: `$may_have( $rest, $user_id, $label )` answers whether this user may have
		 * the key `{kind}:{rest}`, as the plugin decides who may see what it seals with it. `$user_id` is the site's user
		 * (WordPlus_Realtime::user()): a WordPress user, a visitor a plugin names (negative), or 0. A kind is 1–16 of
		 * a-z and 0-9, starting with a letter, and not one of this package's (`d`, `u`, `ch`).
		 *
		 * `$newest( $rest, $label )`, for a kind whose keys have generations, answers the label of the newest key of the
		 * same thing: the keys route gives it beside any older one asked for, as the browser seals with the newest it
		 * holds (a conversation in Better Messages, after someone was removed).
		 *
		 * @param string        $kind
		 * @param callable      $may_have
		 * @param callable|null $newest
		 * @return $this
		 */
		public function kind( $kind, $may_have, $newest = null ) {
			if ( is_string( $kind ) && 1 === preg_match( '/^[a-z][a-z0-9]{0,15}$/', $kind ) && ! in_array( $kind, self::RESERVED, true ) && is_callable( $may_have ) ) {
				$this->kinds[ $kind ] = array( $may_have, is_callable( $newest ) ? $newest : null );
			}

			return $this;
		}

		/**
		 * Whether this user may have any key: false for a user a plugin cut off (`wordplus_realtime_user_has_keys`, such
		 * as a user Better Messages revoked), who then gets none, not with the page and not from the keys route.
		 *
		 * @param int $user_id
		 * @return bool
		 */
		public function user_has_keys( $user_id ) {
			return (bool) apply_filters( 'wordplus_realtime_user_has_keys', true, (int) $user_id );
		}

		/** Whether sealing is on: always, but where a site's filter turns it off. */
		public function sealing() {
			return function_exists( 'sodium_crypto_aead_xchacha20poly1305_ietf_encrypt' ) && (bool) apply_filters( 'wordplus_realtime_seal', true );
		}

		/** @param mixed $label */
		public static function valid_label( $label ) {
			return is_string( $label ) && strlen( $label ) <= 256 && 1 === preg_match( '/^' . self::LABEL . '$/', $label );
		}

		/**
		 * A label and its key as a browser keeps them, `{label}:{64 hex characters}`, or '' for a label that isn't one.
		 *
		 * @param string $label
		 * @return string
		 */
		public function entry( $label ) {
			return self::valid_label( $label ) ? $label . ':' . bin2hex( $this->key( $label ) ) : '';
		}

		/**
		 * A value sealed with a label's key, or null for a label that isn't one or a site that can't seal.
		 *
		 * @param string $value
		 * @param string $label
		 * @return string|null
		 */
		public function seal( $value, $label ) {
			if ( ! self::valid_label( $label ) || ! function_exists( 'sodium_crypto_aead_xchacha20poly1305_ietf_encrypt' ) ) {
				return null;
			}

			$nonce = random_bytes( self::NONCE_BYTES );

			try {
				$sealed = sodium_crypto_aead_xchacha20poly1305_ietf_encrypt( (string) $value, $label, $nonce, $this->key( $label ) );
			} catch ( \Throwable $e ) {
				return null;
			}

			return $label . ':' . self::FORMAT . '.' . self::base64url( $nonce . $sealed );
		}

		/**
		 * Data as JSON, sealed: what the browser opens and parses.
		 *
		 * @param mixed  $data
		 * @param string $label
		 * @return string|null
		 */
		public function seal_json( $data, $label ) {
			$json = wp_json_encode( $data );

			return false === $json ? null : $this->seal( $json, $label );
		}

		/**
		 * The plain value of one this site sealed, or null: not a sealed value, another site's, or changed on the way.
		 *
		 * @param mixed $value
		 * @return string|null
		 */
		public function open( $value ) {
			if ( ! is_string( $value ) || 1 !== preg_match( '/^(' . self::LABEL . '):' . self::FORMAT . '\.([A-Za-z0-9_-]+)$/', $value, $matches ) ) {
				return null;
			}

			$bytes = self::unbase64url( $matches[2] );

			if ( false === $bytes || strlen( $bytes ) < self::NONCE_BYTES + 16 || ! function_exists( 'sodium_crypto_aead_xchacha20poly1305_ietf_decrypt' ) ) {
				return null;
			}

			try {
				$plain = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt( substr( $bytes, self::NONCE_BYTES ), $matches[1], substr( $bytes, 0, self::NONCE_BYTES ), $this->key( $matches[1] ) );
			} catch ( \Throwable $e ) {
				return null;
			}

			return false === $plain ? null : (string) $plain;
		}

		/**
		 * The label of the key that opens a sealed value, or null when it isn't one.
		 *
		 * @param mixed $value
		 * @return string|null
		 */
		public static function label_of( $value ) {
			return is_string( $value ) && 1 === preg_match( '/^(' . self::LABEL . '):' . self::FORMAT . '\.[A-Za-z0-9_-]+$/', $value, $matches ) ? $matches[1] : null;
		}

		/** Today, in UTC days since 1970, or the day of a unix time. */
		public function day( $time = null ) {
			return (int) floor( ( null === $time ? time() : (int) $time ) / DAY_IN_SECONDS );
		}

		public function day_label( $day = null ) {
			return 'd:' . ( null === $day ? $this->day() : (int) $day );
		}

		public function user_generation( $user_id ) {
			$user_id = (int) $user_id;

			if ( $user_id > 0 ) {
				return max( 1, (int) get_user_meta( $user_id, self::USER_GENERATION, true ) );
			}

			$generations = $this->generations();

			return max( 1, isset( $generations[ 'u:' . $user_id ] ) ? (int) $generations[ 'u:' . $user_id ] : 1 );
		}

		/** A user's personal key: a WordPress user's, or a visitor's a plugin names (negative). '' for nobody. */
		public function user_label( $user_id ) {
			$user_id = (int) $user_id;

			return 0 === $user_id ? '' : 'u:' . $user_id . ':' . $this->user_generation( $user_id );
		}

		/**
		 * The user's next personal key, which the one they had doesn't open: when their access is revoked. What was sealed
		 * for them before stays sealed with the key they had.
		 *
		 * @param int $user_id
		 */
		public function rotate_user( $user_id ) {
			$user_id = (int) $user_id;

			if ( $user_id > 0 ) {
				update_user_meta( $user_id, self::USER_GENERATION, $this->user_generation( $user_id ) + 1 );
			} elseif ( $user_id < 0 ) {
				$this->move_on( 'u:' . $user_id, $this->user_generation( $user_id ) + 1 );
			}
		}

		public function room_generation( $room ) {
			$generations = $this->generations();

			return max( 1, isset( $generations[ 'ch:' . $room ] ) ? (int) $generations[ 'ch:' . $room ] : 1 );
		}

		/**
		 * A sealed room's key, its newest: a room a plugin owns (WordPlus_Realtime::room()) that seals, as every room but a
		 * public one does unless it said. '' for a room no rule owns, one that doesn't seal, or a name that isn't one.
		 *
		 * @param string $room
		 * @return string
		 */
		public function room_label( $room ) {
			$options = $this->realtime->room_options( $room );

			if ( null === $options || ! $options['seal'] ) {
				return '';
			}

			return 'ch:' . $room . ':' . $this->room_generation( $room );
		}

		/**
		 * A room's next key: when someone lost access to it, so what it carries from now on is sealed from them. Those
		 * still let in get the new key from the site when its first event comes (the keys route asks the room's rule).
		 * WordPlus_Realtime_Room::kick() moves it on.
		 *
		 * @param string $room
		 */
		public function rotate_room( $room ) {
			if ( '' !== $this->room_label( $room ) ) {
				$this->move_on( 'ch:' . $room, $this->room_generation( $room ) + 1 );
			}
		}

		/**
		 * Whether this user may have the key a label names: anyone the site knows a day's key up to tomorrow's; a user
		 * their own personal key, its newest; a room's key whoever its rule lets in; a plugin's kind as it says.
		 *
		 * @param string $label
		 * @param int    $user_id the site's user (WordPlus_Realtime::user())
		 * @return bool
		 */
		public function may_have( $label, $user_id ) {
			$user_id = (int) $user_id;

			if ( ! self::valid_label( $label ) || ! $this->user_has_keys( $user_id ) ) {
				return false;
			}

			list( $kind, $rest ) = explode( ':', $label, 2 );

			if ( 'd' === $kind ) {
				// Any day up to tomorrow's: the directory keeps a profile while its user stays connected, so one sealed
				// days ago may still come round.
				return 0 !== $user_id && 1 === preg_match( '/^\d{1,9}$/', $rest ) && (int) $rest <= $this->day() + 1;
			}

			if ( 'u' === $kind ) {
				return 0 !== $user_id && 1 === preg_match( '/^(-?\d{1,19}):(\d{1,9})$/', $rest, $matches ) && (int) $matches[1] === $user_id && (int) $matches[2] === $this->user_generation( $user_id );
			}

			if ( 'ch' === $kind ) {
				if ( 1 !== preg_match( '/^(.+):(\d{1,9})$/', $rest, $matches ) || '' === $this->room_label( $matches[1] ) ) {
					return false;
				}

				$generation = (int) $matches[2];

				// The room's rule decides, as the auth route asks it, for the site's user: a WordPress user, a visitor a
				// plugin names, or nobody.
				return $generation >= 1 && $generation <= $this->room_generation( $matches[1] ) && $this->realtime->may_join( $matches[1], $user_id );
			}

			return isset( $this->kinds[ $kind ] ) && true === (bool) call_user_func( $this->kinds[ $kind ][0], $rest, $user_id, $label );
		}

		/**
		 * The newest key of what a label's key belongs to: a room's, or a plugin's kind's as it says. '' when the kind
		 * has no generations or the label is the newest already.
		 *
		 * @param string $label
		 * @return string
		 */
		public function newest( $label ) {
			if ( ! self::valid_label( $label ) ) {
				return '';
			}

			list( $kind, $rest ) = explode( ':', $label, 2 );
			$newest              = '';

			if ( 'ch' === $kind && 1 === preg_match( '/^(.+):\d{1,9}$/', $rest, $matches ) ) {
				$newest = $this->room_label( $matches[1] );
			} elseif ( isset( $this->kinds[ $kind ] ) && null !== $this->kinds[ $kind ][1] ) {
				$newest = (string) call_user_func( $this->kinds[ $kind ][1], $rest, $label );
			}

			return self::valid_label( $newest ) && $newest !== $label && 0 === strpos( $newest, $kind . ':' ) ? $newest : '';
		}

		/**
		 * The keys a user starts with: their personal key and the day's keys from yesterday's to tomorrow's, so a page
		 * open across midnight, or in another time zone than the site's clock, opens what comes. None for nobody.
		 *
		 * @param int $user_id
		 * @return string[]
		 */
		public function user_entries( $user_id ) {
			$user_id = (int) $user_id;

			if ( 0 === $user_id || ! $this->user_has_keys( $user_id ) ) {
				return array();
			}

			$today = $this->day();

			return array(
				$this->entry( $this->user_label( $user_id ) ),
				$this->entry( $this->day_label( $today - 1 ) ),
				$this->entry( $this->day_label( $today ) ),
				$this->entry( $this->day_label( $today + 1 ) ),
			);
		}

		/**
		 * What the keys route answers, POST wordplus/v1/realtime/keys { labels }: the keys asked for that this user may
		 * have, each with the newest of the same thing beside it (newest(): what the browser seals with next). With no
		 * labels: the keys the user starts with, which a visitor's page can't carry, being the same for every visitor, and
		 * the user's identity for the realtime server (`identity`, WordPlus_Realtime::identity()), renewed this way too.
		 *
		 * @param WP_REST_Request $request
		 * @return array{keys: string[], identity?: array{token: string, exp: int}}
		 */
		public function rest_keys( $request ) {
			$user   = $this->realtime->user();
			$labels = $request->get_param( 'labels' );

			if ( ! is_array( $labels ) || array() === $labels ) {
				$answer   = array( 'keys' => $this->user_entries( $user ) );
				$identity = array() === $answer['keys'] ? null : $this->realtime->identity( $user );

				if ( null !== $identity ) {
					$answer['identity'] = $identity;
				}

				return $answer;
			}

			$keys = array();

			foreach ( array_slice( array_values( array_unique( array_filter( $labels, 'is_string' ) ) ), 0, self::MAX_LABELS ) as $label ) {
				if ( ! $this->may_have( $label, $user ) ) {
					continue;
				}

				$keys[] = $this->entry( $label );
				$newest = $this->newest( $label );

				if ( '' !== $newest && $this->may_have( $newest, $user ) ) {
					$keys[] = $this->entry( $newest );
				}
			}

			return array( 'keys' => array_values( array_unique( $keys ) ) );
		}

		/**
		 * A user's entry in the directory every plugin on the site shares, as the realtime server keeps it: `pd`, the
		 * profile with every text sealed with the day's key, however deep (`user_id` and numbers stay as they are), and `pdh`, which
		 * spares the server a write when nothing changed: an HMAC of the plain profile and the day's label under a key
		 * derived from the master, so the server can't confirm a name and avatar it guessed, and takes a new entry each
		 * day. A WordPress user's name, avatar
		 * and author page by default; `wordplus_realtime_profile` adds to it or names a visitor (a negative id), whom
		 * WordPress doesn't know. Null for nobody, or for a profile without a name.
		 *
		 * @param int $user_id
		 * @return array{pd: array, pdh: string}|null
		 */
		public function profile( $user_id ) {
			$user_id = (int) $user_id;

			if ( 0 === $user_id ) {
				return null;
			}

			$plain = array( 'user_id' => $user_id );

			if ( $user_id > 0 && function_exists( 'get_userdata' ) ) {
				$user = get_userdata( $user_id );

				if ( $user && isset( $user->display_name ) ) {
					$plain['name']   = (string) $user->display_name;
					$plain['avatar'] = function_exists( 'get_avatar_url' ) ? (string) get_avatar_url( $user_id, array( 'size' => 128 ) ) : '';
					$plain['url']    = function_exists( 'get_author_posts_url' ) ? (string) get_author_posts_url( $user_id ) : '';
				}
			}

			$plain = apply_filters( 'wordplus_realtime_profile', $plain, $user_id );

			if ( ! is_array( $plain ) || ! isset( $plain['name'] ) || ! is_string( $plain['name'] ) || '' === $plain['name'] ) {
				return null;
			}

			$plain['user_id'] = $user_id;
			$label            = $this->day_label();
			$seal             = $this->sealing();
			$sealed           = array();

			foreach ( $plain as $field => $value ) {
				$kept = $this->sealed_value( $value, $label, $seal, 0 );

				if ( null !== $kept || null === $value ) {
					$sealed[ $field ] = $kept;
				}
			}

			// The day's label is in the hash, so a page of a new day has a new one: the server, finding it differs, takes
			// the page's entry, and the entry it keeps stays sealed with a day key a page holds (yesterday's to
			// tomorrow's). With the same hash for weeks, a user who keeps reconnecting kept an entry sealed weeks ago,
			// and every page showing them had to ask the site for that day's key.
			$hashed = (string) wp_json_encode( $plain ) . ( $seal ? '|' . $label : '' );

			return array(
				'pd'  => $sealed,
				'pdh' => hash_hmac( 'md5', $hashed, $this->key( 'profile-hash' ) ),
			);
		}

		/**
		 * A profile's value as the directory keeps it: every text sealed, however deep in arrays (the status Better Messages
		 * keeps is one), numbers, true and false as they are, and null for what JSON can't carry.
		 */
		private function sealed_value( $value, $label, $seal, $depth ) {
			if ( is_string( $value ) ) {
				return $seal && '' !== $value ? $this->seal( $value, $label ) : $value;
			}

			if ( is_int( $value ) || is_float( $value ) || is_bool( $value ) || null === $value ) {
				return $value;
			}

			if ( is_object( $value ) ) {
				$value = get_object_vars( $value );
			}

			if ( ! is_array( $value ) || $depth >= 8 ) {
				return null;
			}

			$sealed = array();

			foreach ( $value as $key => $item ) {
				$sealed[ $key ] = $this->sealed_value( $item, $label, $seal, $depth + 1 );
			}

			return $sealed;
		}

		/**
		 * The key a room's media is encrypted with end to end, base64url, from the master key:
		 * `call|{call}|{call id}|{caller}|{callee}` for a call's rooms, `room|{room}` for a group call's room whose plugin
		 * encrypts it. Only the calls route gives it out, with a token for the room; the keys route never does.
		 *
		 * @param string $what
		 * @return string
		 */
		public function media( $what ) {
			return self::base64url( hash_hmac( 'sha256', self::MEDIA . $what, $this->master(), true ) );
		}

		/**
		 * A proof only this site makes, base64url, from the master key: that a user is in a call, or was rung into it
		 * (`member|…` and `rung|…`, WordPlus_Realtime::authorize_call()). The realtime server carries such a proof from
		 * one page to another, and can't make one.
		 *
		 * @param string $what
		 * @return string
		 */
		public function proof( $what ) {
			return self::base64url( hash_hmac( 'sha256', self::PROOF . $what, $this->master(), true ) );
		}

		/** The key a label names, 32 bytes; also the profile hash's key, under a name no label takes (it has no `:`). */
		private function key( $label ) {
			return hash_hmac( 'sha256', self::DERIVE . $label, $this->master(), true );
		}

		private function master() {
			if ( null !== $this->master ) {
				return $this->master;
			}

			$master = get_site_option( self::MASTER_OPTION, '' );

			if ( ! is_string( $master ) || 1 !== preg_match( '/^[0-9a-f]{64}$/', $master ) ) {
				$master = bin2hex( random_bytes( 32 ) );

				// Two requests making it at once keep the first one's: add_site_option() adds only when it's missing.
				if ( ! add_site_option( self::MASTER_OPTION, $master ) ) {
					$stored = get_site_option( self::MASTER_OPTION, '' );

					if ( is_string( $stored ) && 1 === preg_match( '/^[0-9a-f]{64}$/', $stored ) ) {
						$master = $stored;
					} else {
						update_site_option( self::MASTER_OPTION, $master );
					}
				}
			}

			$this->master = $master;

			return $master;
		}

		/** @return array<string, int> */
		private function generations() {
			$generations = get_site_option( self::GENERATIONS_OPTION, array() );

			return is_array( $generations ) ? $generations : array();
		}

		private function move_on( $key, $generation ) {
			$generations         = $this->generations();
			$generations[ $key ] = (int) $generation;

			update_site_option( self::GENERATIONS_OPTION, $generations );
		}

		private static function base64url( $data ) {
			return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- a sealed value is base64url
		}

		private static function unbase64url( $data ) {
			return base64_decode( strtr( $data, '-_', '+/' ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- a sealed value is base64url
		}
	}
}
