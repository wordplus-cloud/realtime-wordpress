<?php
defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/class-realtime-rooms.php';
require_once __DIR__ . '/class-realtime-server.php';

if ( ! class_exists( 'WordPlus_Realtime' ) ) {
	/**
	 * The realtime SDK's PHP part, the same as every other
	 * package of the SDK: the rooms a plugin owns, declared once by pattern with what they are; what the site's server
	 * sends them and its users; who is online; the calls and group calls a plugin owns; and the site's routes its
	 * browsers ask (auth, calls, keys) and the realtime server's webhook.
	 *
	 *     add_action( 'plugins_loaded', function () {
	 *         wordplus_realtime()->room( 'order:{id}', function ( $user_id, array $p ) {
	 *             return $user_id > 0 && my_shop_order_owner( (int) $p['id'] ) === $user_id;
	 *         }, array( 'history' => 20 ) );
	 *         wordplus_realtime()->room( 'chat:{a}:{b}', function ( $user_id, array $p ) {
	 *             return in_array( (string) $user_id, array( $p['a'], $p['b'] ), true );
	 *         }, array( 'presence' => true, 'history' => 50, 'emit' => array( 'message', 'typing' ), 'webhook' => array( 'message' ) ) );
	 *         wordplus_realtime()->calls( 'support:{a}:{b}', function ( $user_id, $with, array $p ) {
	 *             return my_shop_may_call( $user_id, $with );
	 *         } );
	 *         wordplus_realtime()->on( 'message', function ( array $e ) { my_shop_save_message( $e ); } );
	 *     } );
	 *
	 *     wordplus_realtime()->to( 'order:42' )->except( wordplus_realtime()->tab() )->emit( 'updated', array( 'status' => 'paid' ) );
	 *     wordplus_realtime()->to_user( 42 )->emit( 'notice', array( 'text' => 'Your order shipped' ) );
	 *     wp_enqueue_script( 'my-shop', $url, array( wordplus_realtime()->script() ) );
	 *
	 * A user is the site's (user()): a WordPress user's id, a visitor's negative id a plugin gives (as Better Messages
	 * does for its guests), or 0 for nobody.
	 *
	 * The site's credentials are WordPlus Cloud's: its key and secret, kept by whichever WordPlus plugin activated it, or
	 * by Connect (connect()), in `wordplus_cloud_license`. The secret itself signs nothing: tokens, emits and webhooks each
	 * have a key derived from it, as every WordPlus plugin derives its own.
	 */
	final class WordPlus_Realtime {
		const OPTION = 'wordplus_cloud_license';

		/** WordPlus Cloud's names: the browsers' connections, and the site's own requests. */
		const SERVER     = 'https://ws.wordplus.cloud/';
		const API_SERVER = 'https://rest.wordplus.cloud/';
		const PATH       = '/websocket';

		/** The keys derived from the site's secret, and the tokens' audience, as the realtime server checks them. */
		const TOKEN_LABEL   = 'wordplus-realtime channels v1';
		const PUBLISH_LABEL = 'wordplus-realtime publish v1';
		const WEBHOOK_LABEL = 'wordplus-realtime webhook v1';
		const AUDIENCE      = 'wordplus-realtime';

		/** A token lives 6 hours unless a filter says otherwise, at most a day; the browser renews it before. */
		const TOKEN_TTL = 21600;
		const MAX_TTL   = 86400;

		/** Rooms one token names, as the server takes them. */
		const MAX_ROOMS = 100;

		/** The cloud keeps at most this many events a room, for at most 5 minutes (in days, as rules give it): history is for a page that reconnects. */
		const MAX_HISTORY      = 1000;
		const MAX_HISTORY_DAYS = 5 / 1440;

		/** Events in one batch request, and a webhook's signature's window in seconds. */
		const BATCH          = 100;
		const WEBHOOK_WINDOW = 300;

		const ROUTE_NAMESPACE = 'wordplus/v1';
		const ROUTE           = '/realtime/auth';
		const CALLS_ROUTE     = '/realtime/calls';
		const WEBHOOK_ROUTE   = '/realtime/webhook';

		/**
		 * Calls: their key, derived from the site's secret apart from the rooms', the tokens' audiences, and how long one
		 * lives (the browser renews it before). The signals' key is derived from WordPress's own salt, which WordPlus Cloud
		 * never sees, so the two browsers' negotiation is sealed from the realtime server.
		 */
		const CALLS_LABEL    = 'wordplus-realtime calls v1';
		const CALL_AUDIENCE  = 'wordplus-realtime call';
		const LINE_AUDIENCE  = 'wordplus-realtime line';
		const ROOM_AUDIENCE  = 'wordplus-realtime room';
		const CALL_TTL       = 21600;
		const CALL_KEY_LABEL = 'wordplus-realtime call key v1';

		/** A live stream's grant: Easy Stream's key label and audience, its claims in this order (Easy Stream's protocol). */
		const GRANT_KEY_LABEL = 'easy-stream grant v1';
		const GRANT_AUDIENCE  = 'easy-stream';
		const CLAIM_ORDER     = array( 'iss', 'aud', 'str', 'role', 'sub', 'name', 'avatar', 'chat', 'mod', 'src', 'q', 'stage', 'offline', 'links', 'fresh', 'people', 'reactions', 'org', 'iat', 'exp' );
		/** A stream's grant lives ten minutes, as Easy Stream's do; the page asks for another as one runs out. */
		const STREAM_TTL = 600;
		/** A live stream's name: a room's without an underscore, as the cloud takes it in a grant's `str`. */
		const STREAM_NAME = '/^[A-Za-z0-9\-=@,.;:]{1,128}$/';

		/** A user's identity for the realtime server: who the socket is, and their entry in the site's directory. */
		const IDENTITY_AUDIENCE = 'wordplus-realtime identity';

		/** The handle script() answers on a site without credentials: no source, so its dependents still load. */
		const OFF_HANDLE = 'wordplus-realtime-off';

		/** @var string */
		private $version;

		/** @var WordPlus_Realtime_Patterns the rooms plugins own: each pattern's options and rule */
		private $rules;

		/** @var WordPlus_Realtime_Patterns the calls between two people plugins own: each pattern's rule and people */
		private $call_rules;

		/** @var WordPlus_Realtime_Patterns the group calls plugins own: each pattern's rule and whether it encrypts */
		private $group_rules;

		/** @var WordPlus_Realtime_Patterns the live streams plugins own: each pattern's rule and settings */
		private $stream_rules;

		/** @var array<string, callable[]> what the realtime server's webhook hands to, by type */
		private $handlers = array();

		/** @var array{token: string, exp: int, rooms: string[]}|false|null the public rooms' grant, made once a page */
		private $public_grant = null;

		/** @var bool */
		private $config_added = false;

		/** @var bool */
		private $screen_added = false;

		/** @var bool */
		private $stream_screen_added = false;

		/** @var WordPlus_Realtime_Connect|null */
		private $connect = null;

		/** @var WordPlus_Realtime_Keys|null */
		private $keys = null;

		public function __construct( $version ) {
			$this->version     = (string) $version;
			$this->rules       = new WordPlus_Realtime_Patterns();
			$this->call_rules  = new WordPlus_Realtime_Patterns();
			$this->group_rules = new WordPlus_Realtime_Patterns();
			$this->stream_rules = new WordPlus_Realtime_Patterns();
		}

		/** This copy's version, the newest of the site's. */
		public function version() {
			return $this->version;
		}

		/**
		 * Rooms a plugin owns, by pattern (`order:{id}`), who may join, and what they are. `$rule( $user_id, $params, $room )`
		 * answers false, true, or an array for that user: `info` (what the room's members see of them, for a presence room;
		 * their name and picture by default), and `emit` or `readOnly` to narrow what they may send. A public room may have
		 * no rule: anyone joins, signed in or not. The rule with the most characters of its own decides.
		 *
		 * `$options`:
		 * - `presence`: its members are listed, with their info, and `join` and `leave` go out.
		 * - `count`: a live count of the people in it (presence has one).
		 * - `history`: events kept 5 minutes for a page that reconnects, a number of them, or `array( 'last' => …, 'days' => … )`
		 *   for less (`days` in days: 0.002 is about 3 minutes). The plugin keeps its own records, from the webhook.
		 * - `emit`: the events browsers may send to it, names or '*'.
		 * - `webhook`: which of those the site's server gets too (on()).
		 * - `public`: anyone, no user needed.
		 * - `seal`: sealed with the room's key (true but for a public room).
		 *
		 * @param string        $pattern
		 * @param callable|null $rule
		 * @param array         $options
		 * @return $this
		 */
		public function room( $pattern, $rule = null, array $options = array() ) {
			if ( ( null === $rule && empty( $options['public'] ) ) || ( null !== $rule && ! is_callable( $rule ) ) || ( ! empty( $options['presence'] ) && ! empty( $options['public'] ) ) ) {
				self::warn( 'room ' . wp_json_encode( $pattern ) . ' needs a rule, or `public`, and a public room has no members to list' );

				return $this;
			}

			if ( ! $this->rules->add( (string) $pattern, array( 'options' => self::normalized( $options ), 'rule' => $rule ) ) ) {
				self::warn( 'not a pattern: ' . wp_json_encode( $pattern ) . ' (letters, digits, _ - = @ , . ; : and {part}s)' );
			}

			$this->public_grant = null;

			return $this;
		}

		/**
		 * Calls between two people a plugin owns, by pattern (`support:{a}:{b}`): `$rule( $user_id, $with, $params, $call,
		 * $side )` answers false, true, or an array: `info`, what the other side's screen shows of the user (their name and
		 * picture by default). `$with` is the other person: the one being called when `$user_id` places it, the caller when
		 * they answer, and `$side['role']` says which (`caller` or `callee`), so a rule may let someone answer calls they
		 * may not place.
		 *
		 * A call becomes a group call when either of its people adds someone, which the rule decides as for any call: the
		 * user calling the person about the call's name, then the person taking a call from them. Its room's media is
		 * encrypted end to end with a key only this site gives out, to the people in the call, as proofs made with the
		 * master key show.
		 *
		 * `$options['people']`: a callable `( $user_id, $call )` answering the ids the call screen offers to add (each still
		 * asked of the rule). Without it, the screen offers no one.
		 *
		 * @param string   $pattern
		 * @param callable $rule
		 * @param array    $options `people`
		 * @return $this
		 */
		public function calls( $pattern, $rule, array $options = array() ) {
			if ( ! is_callable( $rule ) || ! $this->call_rules->add( (string) $pattern, array( 'rule' => $rule, 'people' => isset( $options['people'] ) && is_callable( $options['people'] ) ? $options['people'] : null ) ) ) {
				self::warn( 'calls ' . wp_json_encode( $pattern ) . ' needs a pattern and a rule' );
			}

			return $this;
		}

		/**
		 * Group calls a plugin owns, by pattern (`meeting:{id}`): `$rule( $user_id, $params, $name )` answers false, true,
		 * or an array: `info`, and `publish` and `subscribe` (true unless said), `admin` and `hidden` (false unless said).
		 * `$options['encrypt']` encrypts their rooms end to end, with a key only this site gives out to everyone the rule
		 * lets in.
		 *
		 * @param string   $pattern
		 * @param callable $rule
		 * @param array    $options `encrypt`
		 * @return $this
		 */
		public function group_calls( $pattern, $rule, array $options = array() ) {
			if ( ! is_callable( $rule ) || ! $this->group_rules->add( (string) $pattern, array( 'rule' => $rule, 'encrypt' => ! empty( $options['encrypt'] ) ) ) ) {
				self::warn( 'group_calls ' . wp_json_encode( $pattern ) . ' needs a pattern and a rule' );
			}

			return $this;
		}

		/**
		 * Live streams a plugin owns, by pattern (`show:{id}`), on a site whose plan streams: `$rule( $user_id, $params,
		 * $name )` answers false, a role (`host`, `guest`, `viewer`) or the role with more: `info` (`name`, an https
		 * `avatar`; the user's display name and picture by default), `chat` (`write` or `read`), `mod`, `src` (what a host
		 * or guest may send) and `quality` (`720p` or `1080p`). `$user_id` is 0 for a visitor who isn't signed in, who may
		 * only be a viewer. `$settings` are the stream's own: `stage`, `reactions`, `people` (`mods` or `all`) and `chat`
		 * (`offline` open or closed, `links`, `fresh`), each a value or a callable of the name's parts. A page asks with
		 * `calls.stream( name )`.
		 *
		 * @param string   $pattern
		 * @param callable $rule
		 * @param array    $settings
		 * @return $this
		 */
		public function streams( $pattern, $rule, array $settings = array() ) {
			if ( ! is_callable( $rule ) || ! $this->stream_rules->add( (string) $pattern, array( 'rule' => $rule, 'settings' => $settings ) ) ) {
				self::warn( 'streams ' . wp_json_encode( $pattern ) . ' needs a pattern and a rule' );
			}

			return $this;
		}

		/**
		 * What the realtime server tells the site by webhook, opened: the name of a browser's event a room's rule sends
		 * here (`webhook`), `room.occupied`, `room.vacated`, `member.joined`, `member.left`, `user.online`, `user.offline`,
		 * what people used (`call.ended`, `group.joined`, `group.left`, `stream.joined`, `stream.left`, with `seconds`
		 * once over), or '*' for all. `$handler( $event )` gets `id`, `at`, `room`, and for an event `event`, `data`,
		 * `from` and `event_id`, the id the pages saw.
		 *
		 * @param string   $type
		 * @param callable $handler
		 * @return $this
		 */
		public function on( $type, $handler ) {
			if ( is_callable( $handler ) ) {
				$this->handlers[ (string) $type ][] = $handler;
			}

			return $this;
		}

		/**
		 * An emit to rooms: `->to( 'order:42' )->except( $tab )->emit( 'updated', $data )`.
		 *
		 * @param string|string[] $rooms
		 * @return WordPlus_Realtime_Emitter
		 */
		public function to( $rooms ) {
			$emitter = new WordPlus_Realtime_Emitter( $this );

			return $emitter->to( $rooms );
		}

		/**
		 * An emit to users, every connection they have open: `->to_user( 42 )->emit( 'notice', $data )`.
		 *
		 * @param int|string|array $users
		 * @return WordPlus_Realtime_Emitter
		 */
		public function to_user( $users ) {
			$emitter = new WordPlus_Realtime_Emitter( $this );

			return $emitter->to_user( $users );
		}

		/**
		 * A room as the realtime server holds it: count(), members(), history(), forget(), kick().
		 *
		 * @param string $room
		 * @return WordPlus_Realtime_Room
		 */
		public function in( $room ) {
			return new WordPlus_Realtime_Room( $this, (string) $room );
		}

		/** Who is online across the site: has(), count(), list(), states(). */
		public function online() {
			return new WordPlus_Realtime_Online( $this );
		}

		/**
		 * The rooms someone is in now, by name: those starting with `prefix`, a page at a time (`cursor` from `next`,
		 * `limit` up to 1,000).
		 *
		 * @param array $page `prefix`, `cursor`, `limit`
		 * @return array{count: int, rooms: array<int, array{name: string, count: int, connections: int}>, next?: string}|WP_Error
		 */
		public function list_rooms( array $page = array() ) {
			$query  = http_build_query( array_filter( $page, static function ( $value ) {
				return null !== $value;
			} ) );
			$answer = $this->request( 'GET', '/wordplus/realtime/rooms' . ( '' === $query ? '' : '?' . $query ) );

			if ( is_wp_error( $answer ) ) {
				return $answer;
			}

			$out = array( 'count' => (int) ( isset( $answer['count'] ) ? $answer['count'] : 0 ), 'rooms' => array_values( isset( $answer['rooms'] ) ? (array) $answer['rooms'] : array() ) );

			if ( ! empty( $answer['next'] ) ) {
				$out['next'] = (string) $answer['next'];
			}

			return $out;
		}

		/**
		 * A user as the realtime server knows them: get(), disconnect(), ask(). (user() is who the request is from.)
		 *
		 * @param int|string $id
		 * @return WordPlus_Realtime_User
		 */
		public function for_user( $id ) {
			return new WordPlus_Realtime_User( $this, $id );
		}

		/**
		 * What the site uses now: its connections, and the credits of its account as WordPlus Cloud last said, a credit
		 * a minute.
		 *
		 * @return array{connections: array, credits: array|null}|WP_Error
		 */
		public function usage() {
			$answer = $this->request( 'GET', '/wordplus/realtime/usage' );

			if ( is_wp_error( $answer ) ) {
				return $answer;
			}

			return array( 'connections' => isset( $answer['connections'] ) ? (array) $answer['connections'] : array(), 'credits' => isset( $answer['credits'] ) ? $answer['credits'] : null );
		}

		/** The webhook of the site: deliveries(), resend(), test(). */
		public function webhooks() {
			return new WordPlus_Realtime_Webhooks( $this );
		}

		/** @return array|WP_Error the group calls of the site going on now, from the media server */
		public function list_calls() {
			$calls = WordPlus_Realtime_Answer::field( $this->request( 'GET', '/wordplus/realtime/calls' ), 'calls', array() );

			return is_wp_error( $calls ) ? $calls : array_values( (array) $calls );
		}

		/**
		 * A group call as the media server holds it: get(), mute(), remove(), end().
		 *
		 * @param string $name
		 * @return WordPlus_Realtime_Call
		 */
		public function call( $name ) {
			return new WordPlus_Realtime_Call( $this, $name );
		}

		/** @return array|WP_Error the live streams of the site that are live now */
		public function list_streams() {
			$streams = WordPlus_Realtime_Answer::field( $this->request( 'GET', '/wordplus/realtime/streams' ), 'streams', array() );

			return is_wp_error( $streams ) ? $streams : array_values( (array) $streams );
		}

		/**
		 * A live stream: its state, who is in it, its chat, and what its moderators do.
		 *
		 * @param string $name
		 * @return WordPlus_Realtime_Stream
		 */
		public function stream( $name ) {
			return new WordPlus_Realtime_Stream( $this, $name );
		}

		/**
		 * Data for the pages of a user: sealed with their key when the site seals and the user id is a number, as an
		 * emit to them is.
		 *
		 * @param string $user
		 * @param mixed  $data
		 * @param bool   $seal
		 * @return mixed
		 */
		public function sealed_for( $user, $data, $seal = true ) {
			if ( ! $seal || ! $this->keys()->sealing() || 1 !== preg_match( '/^-?\d{1,19}$/', (string) $user ) ) {
				return $data;
			}

			$sealed = $this->keys()->seal_json( $data, $this->keys()->user_label( (int) $user ) );

			return null === $sealed ? $data : $sealed;
		}

		/**
		 * The tab that asked, from the X-Realtime-Tab header its page sends: what an emit skips (except()), so the tab
		 * that made a change doesn't get it back. '' when the request named none.
		 *
		 * @return string
		 */
		public function tab() {
			$tab = isset( $_SERVER['HTTP_X_REALTIME_TAB'] ) ? (string) wp_unslash( $_SERVER['HTTP_X_REALTIME_TAB'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- checked here

			return 1 === preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $tab ) ? $tab : '';
		}

		/**
		 * Several events at once, each as an emit takes them: `rooms`, `users`, `event`, `data`, `except`, `seal`. For each,
		 * the kept events' ids by room, or a WP_Error.
		 *
		 * @param array[] $events
		 * @return array<int, array<string, string>|WP_Error>
		 */
		public function batch( array $events ) {
			$out = array();

			foreach ( $events as $event ) {
				$out[] = is_array( $event ) ? $this->emit_event( $event ) : new WP_Error( 'bad_request', 'An event is an array.' );
			}

			return $out;
		}

		/**
		 * Who the site knows on this request: the signed-in user's id, or for a visitor the negative id a plugin gives
		 * them (`wordplus_realtime_visitor_id`, as Better Messages does for its guests), or 0 for nobody.
		 *
		 * @return int
		 */
		public function user() {
			$user = (int) get_current_user_id();

			if ( $user > 0 ) {
				return $user;
			}

			$visitor = (int) apply_filters( 'wordplus_realtime_visitor_id', 0 );

			return $visitor < 0 ? $visitor : 0;
		}

		/** Who takes part in calls on this page: user(). */
		public function call_user() {
			return $this->user();
		}

		/**
		 * What the auth route answers for the rooms asked, for a user: one token for those allowed, the keys of the sealed
		 * ones among them, and why each other was refused (`forbidden`, `bad_room`, `no_rule`, `too_many`,
		 * `not_connected`).
		 *
		 * @param array $rooms
		 * @param int   $user_id the site's user (user())
		 * @return array{token?: string, exp?: int, keys?: string[], denied: object}
		 */
		public function authorize( array $rooms, $user_id ) {
			$user_id = (int) $user_id;
			$denied  = array();
			$allowed = array();
			$asked   = array_values( array_unique( array_map( 'strval', array_filter( $rooms, 'is_scalar' ) ) ) );

			foreach ( $asked as $i => $room ) {
				if ( $i >= self::MAX_ROOMS ) {
					$denied[ $room ] = 'too_many';
					continue;
				}

				if ( ! WordPlus_Realtime_Patterns::valid_name( $room ) ) {
					$denied[ $room ] = 'bad_room';
					continue;
				}

				$found = $this->rules->match( $room );

				if ( null === $found ) {
					$denied[ $room ] = 'no_rule';
					continue;
				}

				$answer  = $this->answer_for( $found, $room, $user_id );
				$options = $found['value']['options'];

				if ( null === $answer || ( $options['presence'] && 0 === $user_id ) ) {
					$denied[ $room ] = 'forbidden';
					continue;
				}

				$allowed[] = array(
					'room'     => $room,
					'options'  => $options,
					'emit'     => isset( $answer['emit'] ) ? $answer['emit'] : $options['emit'],
					'readOnly' => ! empty( $answer['readOnly'] ),
					'info'     => isset( $answer['info'] ) ? $answer['info'] : null,
					'given'    => array_key_exists( 'info', $answer ),
				);
			}

			if ( array() === $allowed ) {
				return array( 'denied' => (object) $denied );
			}

			$credentials = $this->credentials();

			if ( null === $credentials ) {
				foreach ( $allowed as $a ) {
					$denied[ $a['room'] ] = 'not_connected';
				}

				return array( 'denied' => (object) $denied );
			}

			$now    = time();
			$exp    = $now + max( 60, min( self::MAX_TTL, (int) apply_filters( 'wordplus_realtime_token_ttl', self::TOKEN_TTL ) ) );
			$claims = array( 'iss' => $credentials['key'], 'aud' => self::AUDIENCE, 'iat' => $now, 'exp' => $exp );

			if ( 0 !== $user_id ) {
				$claims['sub'] = (string) $user_id;
			}

			$r          = array();
			$infos      = array();
			$plain_info = null;
			$has_plain  = false;
			$keys       = array();
			$sealing    = $this->keys()->sealing();

			foreach ( $allowed as $a ) {
				$r[ $a['room'] ] = (object) self::short( array( 'emit' => $a['emit'] ) + $a['options'], $a['readOnly'] );
				$label           = $sealing && $a['options']['seal'] ? $this->keys()->room_label( $a['room'] ) : '';

				if ( '' !== $label ) {
					$keys[] = $this->keys()->entry( $label );
				}

				if ( ! $a['options']['presence'] ) {
					continue;
				}

				$info   = $a['given'] ? $a['info'] : $this->default_info( $user_id );
				$sealed = '' === $label ? null : $this->keys()->seal_json( $info, $label );

				if ( null !== $sealed ) {
					$infos[ $a['room'] ] = $sealed;
				} else {
					$plain_info = $info;
					$has_plain  = true;
				}
			}

			$claims['r'] = (object) $r;

			if ( array() !== $infos ) {
				$claims['infos'] = (object) $infos;
			}

			if ( $has_plain ) {
				$claims['info'] = $plain_info;
			}

			$grant = array(
				'token'  => self::jwt( $claims, hash_hmac( 'sha256', self::TOKEN_LABEL, $credentials['secret'], true ) ),
				'exp'    => $exp,
				'denied' => (object) $denied,
			);

			if ( array() !== $keys ) {
				$grant['keys'] = $keys;
			}

			return $grant;
		}

		/**
		 * The grant for the site's public rooms with no rule, which every page may carry, cached or not: their patterns,
		 * no user, signed for 6 hours. Empty when the site has none or no credentials.
		 *
		 * @return array<int, array{token: string, exp: int, rooms: string[]}>
		 */
		public function public_grants() {
			if ( is_array( $this->public_grant ) && $this->public_grant['exp'] - time() < 3600 ) {
				$this->public_grant = null;
			}

			if ( null === $this->public_grant ) {
				$credentials = $this->credentials();
				$open        = array_values( array_filter( $this->rules->entries(), static function ( $entry ) {
					return $entry[1]['options']['public'] && null === $entry[1]['rule'];
				} ) );

				if ( null === $credentials || array() === $open ) {
					$this->public_grant = false;
				} else {
					$now = time();
					$exp = $now + self::TOKEN_TTL;
					$r   = array();

					foreach ( $open as $entry ) {
						$r[ $entry[0] ] = (object) self::short( $entry[1]['options'], false );
					}

					$this->public_grant = array(
						'token' => self::jwt( array( 'iss' => $credentials['key'], 'aud' => self::AUDIENCE, 'iat' => $now, 'exp' => $exp, 'r' => (object) $r ), hash_hmac( 'sha256', self::TOKEN_LABEL, $credentials['secret'], true ) ),
						'exp'   => $exp,
						'rooms' => array_map( static function ( $entry ) {
							return $entry[0];
						}, $open ),
					);
				}
			}

			return false === $this->public_grant ? array() : array( $this->public_grant );
		}

		/**
		 * What the calls route answers, for a user: the page's line (`line`), its side of a call (`call`, `id`, `role`, `to`
		 * or `from`, `type`, and `group`, `pair` and `member` or `ring` for a ring into the group call it became), a place in
		 * a group call (`room`, `type`), the people the user may add to a call (`people`, the call's name), or whether the
		 * user may call each of some people (`may`: up to 100 `array( 'call' => …, 'to' => … )`, each asked of its rule as
		 * the caller), or a host's act in a group call (`moderate`: its name, `act` and `user`). A token and when it runs out,
		 * the call's key for its signals, the key its rooms encrypt their media with (`media_key`), the call's pair and the
		 * user's proof of being in it, the proof a person rung in was rung, the people, `may` (true or false for each, in the
		 * order asked), `done` for a host's act, or `denied` with why: `no_user`, `bad_request`, `forbidden`, `server`,
		 * `not_connected`.
		 *
		 * Who is in a call is in proofs made with the master key, which WordPlus Cloud never sees: the realtime server
		 * carries them from page to page and can't make one, and the site keeps nothing.
		 *
		 * @param array $request
		 * @param int   $user_id
		 * @return array
		 */
		public function authorize_call( array $request, $user_id ) {
			$user_id = (int) $user_id;

			if ( ! $this->available() ) {
				return array( 'denied' => 'not_connected' );
			}

			// A live stream's grant (streams()), which a visitor who isn't signed in may get too, as a viewer.
			if ( array_key_exists( 'stream', $request ) ) {
				return $this->authorize_stream( $request['stream'], $user_id );
			}

			if ( 0 === $user_id ) {
				return array( 'denied' => 'no_user' );
			}

			if ( ! empty( $request['line'] ) ) {
				return $this->sign_calls( array( 'aud' => self::LINE_AUDIENCE, 'sub' => $user_id ) );
			}

			if ( array_key_exists( 'people', $request ) ) {
				return WordPlus_Realtime_Patterns::valid_name( $request['people'] ) ? array( 'people' => $this->call_people( $request['people'], $user_id ) ) : array( 'denied' => 'bad_request' );
			}

			if ( array_key_exists( 'may', $request ) ) {
				return $this->may_call( $request['may'], $user_id );
			}

			if ( array_key_exists( 'moderate', $request ) ) {
				return $this->moderate_call( $request['moderate'], isset( $request['act'] ) ? $request['act'] : null, isset( $request['user'] ) ? $request['user'] : null, $user_id );
			}

			$type = isset( $request['type'] ) && 'audio' === $request['type'] ? 'audio' : 'video';

			if ( array_key_exists( 'room', $request ) ) {
				$room = $request['room'];

				if ( ! WordPlus_Realtime_Patterns::valid_name( $room ) ) {
					return array( 'denied' => 'bad_request' );
				}

				$found  = $this->group_rules->match( $room );
				$answer = null === $found ? null : $this->call_answer( call_user_func( $found['value']['rule'], $user_id, $found['params'], $room ), $user_id );

				if ( null === $answer ) {
					return array( 'denied' => 'forbidden' );
				}

				$signed = $this->sign_calls( array(
					'aud'       => self::ROOM_AUDIENCE,
					'room'      => $room,
					'sub'       => $user_id,
					'type'      => $type,
					'info'      => $this->sealed_call_info( $answer['info'] ),
					'publish'   => ! isset( $answer['publish'] ) || (bool) $answer['publish'],
					'subscribe' => ! isset( $answer['subscribe'] ) || (bool) $answer['subscribe'],
					'admin'     => ! empty( $answer['admin'] ),
					'hidden'    => ! empty( $answer['hidden'] ),
				) );

				// Encrypted end to end when its rule says so: everyone it lets in gets the room's key.
				if ( isset( $signed['token'] ) && $found['value']['encrypt'] ) {
					$signed['media_key'] = $this->keys()->media( 'room|' . $room );
				}

				return $signed;
			}

			$call  = isset( $request['call'] ) ? $request['call'] : null;
			$id    = isset( $request['id'] ) ? $request['id'] : null;
			$role  = isset( $request['role'] ) ? $request['role'] : null;
			$group = isset( $request['group'] ) ? $request['group'] : null;

			if ( ! WordPlus_Realtime_Patterns::valid_name( $call ) || ! self::valid_attempt( $id ) || ! in_array( $role, array( 'caller', 'callee' ), true ) ) {
				return array( 'denied' => 'bad_request' );
			}

			if ( null !== $group && ( ! self::valid_attempt( $group ) || $group === $id ) ) {
				return array( 'denied' => 'bad_request' );
			}

			$with = (int) ( 'caller' === $role ? ( isset( $request['to'] ) ? $request['to'] : 0 ) : ( isset( $request['from'] ) ? $request['from'] : 0 ) );

			if ( 0 === $with || $with === $user_id ) {
				return array( 'denied' => 'bad_request' );
			}

			$answer = $this->ask_caller( $user_id, $call, $with, $role );

			if ( null === $answer ) {
				return array( 'denied' => 'forbidden' );
			}

			// The call's two people, whose key its rooms encrypt with: this request's for the call itself; for a ring into
			// the group call it became, the pair its proofs name, the ringer's proof that they are in it, or the proof the
			// person was rung. The site made each proof with its master key, which the realtime server never sees, so the
			// server can carry them but can't make one for anyone else.
			if ( null === $group ) {
				$first = $id;
				$pair  = 'caller' === $role ? array( $user_id, $with ) : array( $with, $user_id );
			} else {
				$first = $group;
				$pair  = self::pair_of( isset( $request['pair'] ) ? $request['pair'] : null );

				if ( null === $pair ) {
					return array( 'denied' => 'bad_request' );
				}

				$proof = 'caller' === $role ? ( isset( $request['member'] ) ? $request['member'] : '' ) : ( isset( $request['ring'] ) ? $request['ring'] : '' );

				if ( ! is_string( $proof ) || ! hash_equals( $this->call_proof( 'caller' === $role ? 'member' : 'rung', $call, $first, $pair, $user_id ), $proof ) ) {
					return array( 'denied' => 'forbidden' );
				}
			}

			$claims = array(
				'aud'  => self::CALL_AUDIENCE,
				'call' => $call,
				'id'   => $id,
				'sub'  => $user_id,
				'role' => $role,
				'type' => $type,
				'info' => $this->sealed_call_info( $answer['info'] ),
			);

			if ( 'caller' === $role ) {
				$claims['to'] = $with;
			}

			if ( null !== $group ) {
				$claims['group'] = $group;
			}

			$signed = $this->sign_calls( $claims );

			if ( isset( $signed['token'] ) ) {
				$signed['key'] = self::call_key( $id, 'caller' === $role ? $user_id : $with, 'caller' === $role ? $with : $user_id );
				// The key the call's rooms encrypt their media with, the room it moves to when no direct path works and the
				// group call it becomes, made for its two people; their pair, and this user's proof of being in it.
				$signed['media_key'] = $this->keys()->media( 'call|' . $call . '|' . $first . '|' . $pair[0] . '|' . $pair[1] );
				$signed['pair']      = $pair;
				$signed['member']    = $this->call_proof( 'member', $call, $first, $pair, $user_id );

				// Ringing someone in: the proof they were rung, which the realtime server hands them with the ring.
				if ( null !== $group && 'caller' === $role ) {
					$signed['ring'] = $this->call_proof( 'rung', $call, $first, $pair, $with );
				}
			}

			return $signed;
		}

		/**
		 * The key the two browsers of a call seal their negotiation with: the same for its caller and its callee, and made
		 * from this site's own salt, which WordPlus Cloud doesn't know.
		 *
		 * @param string $id     the attempt
		 * @param int    $caller
		 * @param int    $callee
		 * @return string
		 */
		public static function call_key( $id, $caller, $callee ) {
			return hash_hmac( 'sha256', self::CALL_KEY_LABEL . '|' . $id . '|' . (int) $caller . '|' . (int) $callee, wp_salt( 'auth' ) );
		}

		/**
		 * Whether a user may join a room, as the auth route decides it: what the keys route asks before it gives a room's
		 * key.
		 *
		 * @param string $room
		 * @param int    $user_id the site's user
		 * @return bool
		 */
		public function may_join( $room, $user_id ) {
			if ( ! WordPlus_Realtime_Patterns::valid_name( $room ) ) {
				return false;
			}

			$found = $this->rules->match( $room );

			if ( null === $found ) {
				return false;
			}

			return null !== $this->answer_for( $found, $room, (int) $user_id ) && ( ! $found['value']['options']['presence'] || 0 !== (int) $user_id );
		}

		/**
		 * A room's options as its rule gave them, with their defaults and the cloud's limits; null for a room no rule owns.
		 *
		 * @param string $room
		 * @return array{presence: bool, count: bool, public: bool, seal: bool, history: array{last: int, days: float}|null, emit: string[]|string, webhook: string[]|string}|null
		 */
		public function room_options( $room ) {
			$found = WordPlus_Realtime_Patterns::valid_name( $room ) ? $this->rules->match( $room ) : null;

			return null === $found ? null : $found['value']['options'];
		}

		/**
		 * Who a user is for the realtime server, and their entry in the site's directory (keys()->profile()), signed as a
		 * room token is: their online status, what the site's server sends them, and the directory. Null for nobody, a user
		 * cut off from the keys, a profile without a name, or a site without credentials. `wordplus_realtime_hidden` true
		 * keeps the user out of who is online (a "hide my status" setting).
		 *
		 * @param int $user_id the site's user (user())
		 * @return array{token: string, exp: int}|null
		 */
		public function identity( $user_id ) {
			$user_id     = (int) $user_id;
			$credentials = $this->credentials();

			if ( 0 === $user_id || null === $credentials || ! $this->keys()->user_has_keys( $user_id ) ) {
				return null;
			}

			$profile = $this->keys()->profile( $user_id );

			if ( null === $profile ) {
				return null;
			}

			$now    = time();
			$exp    = $now + max( 60, min( self::MAX_TTL, (int) apply_filters( 'wordplus_realtime_token_ttl', self::TOKEN_TTL ) ) );
			$claims = array(
				'iss' => $credentials['key'],
				'aud' => self::IDENTITY_AUDIENCE,
				'iat' => $now,
				'exp' => $exp,
				'sub' => (string) $user_id,
				'pd'  => $profile['pd'],
				'pdh' => $profile['pdh'],
			);

			if ( true === apply_filters( 'wordplus_realtime_hidden', false, $user_id ) ) {
				$claims['hid'] = true;
			}

			return array( 'token' => self::jwt( $claims, hash_hmac( 'sha256', self::TOKEN_LABEL, $credentials['secret'], true ) ), 'exp' => $exp );
		}

		/**
		 * What an emit sends: each sealed room's own copy, the others together, each user's own copy sealed with their key;
		 * the kept events' ids by room, or a WP_Error with the realtime server's reason. to() and to_user() call it.
		 *
		 * @param array $event `rooms`, `users`, `event`, `data`, `except`, `seal`
		 * @return array<string, string>|WP_Error
		 */
		public function emit_event( array $event ) {
			$name = isset( $event['event'] ) ? $event['event'] : null;

			if ( ! is_string( $name ) || '' === $name ) {
				return new WP_Error( 'bad_request', 'An emit names its event.' );
			}

			$rooms   = array_values( array_unique( array_map( 'strval', isset( $event['rooms'] ) ? (array) $event['rooms'] : array() ) ) );
			$users   = array();
			$data    = isset( $event['data'] ) ? $event['data'] : null;
			$except  = empty( $event['except'] ) ? array() : array( 'except' => (string) $event['except'] );
			$sealing = ( ! array_key_exists( 'seal', $event ) || false !== $event['seal'] ) && $this->keys()->sealing();

			foreach ( isset( $event['users'] ) ? (array) $event['users'] : array() as $user ) {
				if ( ( is_int( $user ) || is_string( $user ) ) && '' !== (string) $user && '0' !== (string) $user ) {
					$users[ (string) $user ] = true;
				}
			}

			$out           = array();
			$plain         = array();
			$plain_history = array();

			foreach ( $rooms as $room ) {
				if ( ! WordPlus_Realtime_Patterns::valid_name( $room ) ) {
					return new WP_Error( 'bad_room', 'Not a room: ' . $room );
				}

				$options = $this->room_options( $room );
				$history = null !== $options && null !== $options['history'] ? array( $room => array( $options['history']['last'], $options['history']['days'] ) ) : null;
				$label   = $sealing && null !== $options && $options['seal'] ? $this->keys()->room_label( $room ) : '';
				$sealed  = '' === $label ? null : $this->keys()->seal_json( $data, $label );

				if ( null !== $sealed ) {
					$out[] = array( 'rooms' => array( $room ), 'event' => $name, 'data' => $sealed ) + ( null === $history ? array() : array( 'history' => (object) $history ) ) + $except;
				} else {
					$plain[]       = $room;
					$plain_history = $plain_history + ( null === $history ? array() : $history );
				}
			}

			if ( array() !== $plain ) {
				$out[] = array( 'rooms' => $plain, 'event' => $name, 'data' => $data ) + ( array() === $plain_history ? array() : array( 'history' => (object) $plain_history ) ) + $except;
			}

			$plain_users = array();

			foreach ( array_keys( $users ) as $user ) {
				$label  = $sealing && 1 === preg_match( '/^-?\d{1,19}$/', (string) $user ) ? $this->keys()->user_label( (int) $user ) : '';
				$sealed = '' === $label ? null : $this->keys()->seal_json( $data, $label );

				if ( null !== $sealed ) {
					$out[] = array( 'users' => array( (string) $user ), 'event' => $name, 'data' => $sealed ) + $except;
				} else {
					$plain_users[] = (string) $user;
				}
			}

			if ( array() !== $plain_users ) {
				$out[] = array( 'users' => $plain_users, 'event' => $name, 'data' => $data ) + $except;
			}

			if ( array() === $out ) {
				return array();
			}

			if ( 1 === count( $out ) ) {
				$answer = $this->signed( 'POST', '/wordplus/realtime/emit', $out[0] );

				return is_wp_error( $answer ) ? $answer : ( isset( $answer['ids'] ) ? (array) $answer['ids'] : array() );
			}

			$ids = array();

			foreach ( array_chunk( $out, self::BATCH ) as $batch ) {
				$answer = $this->signed( 'POST', '/wordplus/realtime/emit/batch', array( 'events' => $batch ) );

				if ( is_wp_error( $answer ) ) {
					return $answer;
				}

				foreach ( isset( $answer['ids'] ) ? (array) $answer['ids'] : array() as $kept ) {
					$ids = $ids + (array) $kept;
				}
			}

			return $ids;
		}

		/**
		 * A request to the realtime server, signed as the site: what the room and online queries ask.
		 *
		 * @param string     $method
		 * @param string     $path
		 * @param array|null $body
		 * @return array|WP_Error
		 */
		public function request( $method, $path, $body = null ) {
			return $this->signed( $method, ltrim( (string) $path, '/' ), $body );
		}

		/**
		 * An event's data as the site's server sees it: opened when the site sealed it, its binary parts strings of their
		 * bytes.
		 *
		 * @param mixed $data
		 * @return mixed
		 */
		public function opened( $data ) {
			if ( ! is_string( $data ) ) {
				return self::unpack_binary( $data );
			}

			$plain = $this->keys()->open( $data );

			if ( null === $plain ) {
				return $data;
			}

			$decoded = json_decode( $plain, true );

			return null === $decoded && 'null' !== $plain ? $data : self::unpack_binary( $decoded );
		}

		/**
		 * The binary parts of data as the pages carry them in JSON, `{"$b": base64}`, as the other server packages open
		 * them.
		 *
		 * @param mixed $value
		 * @param int   $depth
		 * @return mixed
		 */
		private static function unpack_binary( $value, $depth = 0 ) {
			if ( $depth > 16 || ! is_array( $value ) ) {
				return $value;
			}

			if ( 1 === count( $value ) && isset( $value['$b'] ) && is_string( $value['$b'] ) ) {
				$base64 = strtr( $value['$b'], '-_', '+/' );
				$bytes = base64_decode( str_pad( $base64, (int) ( 4 * ceil( strlen( $base64 ) / 4 ) ), '=' ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- the bytes a page sent

				return false === $bytes ? $value : $bytes;
			}

			foreach ( $value as $key => $item ) {
				$value[ $key ] = self::unpack_binary( $item, $depth + 1 );
			}

			return $value;
		}

		/**
		 * The site's key and the secret to sign with now: the one before until the new one is in use (`effective_at`), as
		 * every WordPlus plugin signs. Null when the site has no credentials: none of WordPlus Cloud's plugins activated
		 * it, and it hasn't connected (connect()).
		 *
		 * @return array{key: string, secret: string}|null
		 */
		public function credentials() {
			$activation = $this->activation();

			if ( null === $activation ) {
				return null;
			}

			$effective = isset( $activation['effective_at'] ) ? (int) $activation['effective_at'] : 0;
			$previous  = isset( $activation['previous_secret'] ) ? (string) $activation['previous_secret'] : '';

			return array(
				'key'    => (string) $activation['site_key'],
				'secret' => $effective > time() && '' !== $previous ? $previous : (string) $activation['secret'],
			);
		}

		/** Whether the site has its credentials, so its rooms work. */
		public function available() {
			return null !== $this->credentials();
		}

		public function site_key() {
			$credentials = $this->credentials();

			return null === $credentials ? '' : $credentials['key'];
		}

		/** Where the browsers connect: WordPlus Cloud, or a self-hosted server a filter names. */
		public function server() {
			return trailingslashit( (string) apply_filters( 'wordplus_realtime_server', self::SERVER ) );
		}

		/** Where the site's own requests go. */
		public function api_server() {
			return trailingslashit( (string) apply_filters( 'wordplus_realtime_api_server', self::API_SERVER ) );
		}

		/**
		 * The page script every WordPlus product shares, with the settings `wordplusRealtimeClient.page()` takes in
		 * `window.wordplusRealtimeConfig`: the handle a plugin's script depends on. On a site without credentials it is an
		 * empty handle, registered with no source, since WordPress drops a script that names a dependency it doesn't know:
		 * the plugin's script still loads, and finds `window.wordplusRealtimeConfig` unset.
		 *
		 * @return string
		 */
		public function script() {
			$handle = $this->available() && function_exists( 'wordplus_realtime_script' ) ? wordplus_realtime_script() : '';

			if ( '' === $handle ) {
				if ( ! wp_script_is( self::OFF_HANDLE, 'registered' ) ) {
					wp_register_script( self::OFF_HANDLE, false, array(), $this->version, true );
				}

				return self::OFF_HANDLE;
			}

			if ( ! $this->config_added ) {
				wp_add_inline_script( $handle, 'window.wordplusRealtimeConfig = ' . wp_json_encode( $this->config() ) . ';', 'before' );
				$this->config_added = true;
			}

			return $handle;
		}

		/**
		 * The calls script, `window.wordplusRealtimeCalls`, after the page script and its settings: the handle a plugin's
		 * call code depends on (`wordplusRealtimeCalls.page().calls`). The same empty handle as script() answers on a site
		 * without credentials or without a copy that carries the calls.
		 *
		 * @return string
		 */
		public function calls_script() {
			$page   = $this->script();
			$handle = self::OFF_HANDLE !== $page && function_exists( 'wordplus_realtime_calls_script' ) ? wordplus_realtime_calls_script() : '';

			return '' === $handle ? self::OFF_HANDLE : $handle;
		}

		/**
		 * The call screen on this page, Better Messages' call screens (@wordplus/realtime-ui): `<call-button>` and
		 * `<room-button>` work, and the page's user's calls ring here, with the page's other elements (`<online-list>`,
		 * `<chat-room>` and the rest). Call it while scripts are enqueued (`wp_enqueue_scripts`) on the pages that place
		 * or answer calls; a site that wants calls to ring everywhere calls it on every page. With `ring` false the buttons
		 * work and nothing rings on the page. False on a site without credentials or without a copy that carries the screen.
		 *
		 * @param array $args `ring` (true)
		 * @return bool
		 */
		public function call_screen( array $args = array() ) {
			$calls  = $this->calls_script();
			$handle = self::OFF_HANDLE !== $calls && function_exists( 'wordplus_realtime_call_screen_script' ) ? wordplus_realtime_call_screen_script() : '';

			if ( '' === $handle ) {
				return false;
			}

			if ( ! $this->screen_added ) {
				$settings = 'window.wordplusRealtimeConfig.screen = ' . wp_json_encode( $this->screen() ) . ';';

				// The page holds no line, so nothing rings on it (the calls' `ring`).
				if ( isset( $args['ring'] ) && ! $args['ring'] ) {
					$settings .= ' window.wordplusRealtimeConfig.ring = false;';
				}

				wp_add_inline_script( $handle, 'if ( window.wordplusRealtimeConfig ) { ' . $settings . ' }', 'before' );
				$this->screen_added = true;
			}

			wp_enqueue_script( $handle );

			return true;
		}

		/**
		 * Better Messages' elements on a page without calls ringing: `<online-list>`, `<chat-room>`,
		 * `<typing-line>`, `<online-count>`. call_screen() with `ring` false.
		 *
		 * @return bool
		 */
		public function ui() {
			return $this->call_screen( array( 'ring' => false ) );
		}

		/**
		 * The live streams on this page, Easy Stream's player, chat and studio (@wordplus/realtime-ui's stream
		 * elements): `<live-stream name="show:42">`, the stream in one piece with the studio for its host, or one of
		 * its parts in each element (`view="player"`, `chat`, `details`, `studio`), on the page's calls, as the plugin's
		 * streams() rule makes the user its host or a viewer. Call it while scripts are enqueued on the pages that show a
		 * stream. It leaves calls ringing as they are: a page that should not hold the line calls ui() as well. False on
		 * a site without credentials or without a copy that carries them.
		 *
		 * @return bool
		 */
		public function stream_screen() {
			$calls  = $this->calls_script();
			$handle = self::OFF_HANDLE !== $calls && function_exists( 'wordplus_realtime_stream_screen_script' ) ? wordplus_realtime_stream_screen_script() : '';

			if ( '' === $handle ) {
				return false;
			}

			// The page's language and the site's own words, as the call screen has them, where it hasn't given them.
			if ( ! $this->stream_screen_added ) {
				wp_add_inline_script( $handle, 'if ( window.wordplusRealtimeConfig && ! window.wordplusRealtimeConfig.screen ) { window.wordplusRealtimeConfig.screen = ' . wp_json_encode( $this->screen() ) . '; }', 'before' );
				$this->stream_screen_added = true;
			}

			wp_enqueue_script( $handle );

			return true;
		}

		/**
		 * A live stream element for the page, escaped: `<live-stream>` with `name` and its attributes (`view`, `title`,
		 * `cover`, `url`, `login-url`, `studio-url`, `chat`, `height`, `sticky`), or `<stream-studio>` for `view` studio,
		 * each after the site's prefix (element_prefix()). Enqueue stream_screen() on the page too.
		 *
		 * @param string $name       The stream, as the plugin's streams() rule names it (`show:42`).
		 * @param array  $attributes The element's attributes, by name; true for one without a value.
		 * @return string
		 */
		public function stream_element( $name, array $attributes = array() ) {
			$studio = isset( $attributes['view'] ) && 'studio' === $attributes['view'];
			$tag    = $this->element_name( $studio ? 'stream-studio' : 'live-stream' );
			$html   = '<' . $tag . ' name="' . esc_attr( $name ) . '"';

			foreach ( $attributes as $attribute => $value ) {
				if ( $studio && 'view' === $attribute ) {
					continue;
				}
				if ( ! preg_match( '/^[a-z][a-z-]*$/', (string) $attribute ) || false === $value || null === $value ) {
					continue;
				}
				$html .= true === $value ? ' ' . $attribute : ' ' . $attribute . '="' . esc_attr( (string) $value ) . '"';
			}

			return $html . '></' . $tag . '>';
		}

		/**
		 * The site's prefix for the elements' names, which goes before each (`shop` makes `<shop-chat-room>`), from the
		 * `wordplus_realtime_element_prefix` filter: lowercase letters and digits, starting with a letter, hyphens between
		 * them. '' for their own names, and for a prefix that would not make valid ones.
		 *
		 * @return string
		 */
		public function element_prefix() {
			$prefix = (string) apply_filters( 'wordplus_realtime_element_prefix', '' );

			return preg_match( '/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/', $prefix ) ? $prefix : '';
		}

		/**
		 * An element's name on this site: `chat-room`, or `shop-chat-room` after the site's prefix.
		 *
		 * @param string $tag The element's own name (`call-button`, `chat-room`, `live-stream`).
		 * @return string
		 */
		public function element_name( $tag ) {
			$prefix = $this->element_prefix();

			return '' === $prefix ? $tag : $prefix . '-' . $tag;
		}

		/**
		 * The screens' settings: the page's language (the screens carry their own words in de, es, fr, it nl, pl, hr and
		 * he), the site's own words over them by the English text (`wordplus_realtime_screen_strings`), Add Person where
		 * some plugin lists whom a user may add to its calls, and the site's prefix for the elements' names, which the
		 * scripts read as they load.
		 *
		 * @return array{lang: string, strings: object, add: bool, prefix?: string}
		 */
		public function screen() {
			$add = false;

			foreach ( $this->call_rules->entries() as $entry ) {
				$add = $add || null !== $entry[1]['people'];
			}

			$screen = array(
				'lang'    => strtolower( substr( (string) determine_locale(), 0, 2 ) ),
				'strings' => (object) apply_filters( 'wordplus_realtime_screen_strings', array() ),
				'add'     => $add,
			);
			$prefix = $this->element_prefix();

			if ( '' !== $prefix ) {
				$screen['prefix'] = $prefix;
			}

			return $screen;
		}

		/**
		 * What `wordplusRealtimeClient.page()` and the calls take: where to connect, the connector's worker, the site, its
		 * auth and calls routes, the relay's address for the site's requests, the mesh's room client, the public rooms'
		 * grant, and the keys: the route, and for a signed-in user the keys they start with and their identity. A visitor's
		 * page carries neither, as it is the same for every visitor and may be cached; the browser asks the keys route.
		 *
		 * The page shares the connection every WordPlus plugin rides (the connector's one worker): on WordPress a browser's
		 * tabs are one user's, so one connection is theirs.
		 *
		 * @return array
		 */
		public function config() {
			$headers  = array( 'X-WP-Nonce' => wp_create_nonce( 'wp_rest' ) );
			$user     = (int) get_current_user_id();
			$keys     = array(
				'endpoint' => rest_url( self::ROUTE_NAMESPACE . WordPlus_Realtime_Keys::ROUTE ),
				'headers'  => $headers,
				'entries'  => $user > 0 ? $this->keys()->user_entries( $user ) : array(),
			);
			$identity = $user > 0 ? $this->identity( $user ) : null;

			if ( null !== $identity ) {
				$keys['identity'] = $identity;
			}

			$config = array(
				'server'      => untrailingslashit( $this->server() ),
				'path'        => self::PATH,
				'worker'      => function_exists( 'wordplus_realtime_worker_url' ) ? wordplus_realtime_worker_url() : '',
				'site'        => $this->site_key(),
				'auth'        => array(
					'endpoint' => rest_url( self::ROUTE_NAMESPACE . self::ROUTE ),
					'headers'  => $headers,
				),
				'calls'       => array(
					'endpoint' => rest_url( self::ROUTE_NAMESPACE . self::CALLS_ROUTE ),
					'headers'  => $headers,
				),
				'api'         => untrailingslashit( $this->api_server() ),
				'rooms'       => function_exists( 'wordplus_realtime_rooms_url' ) ? wordplus_realtime_rooms_url() : '',
				// The room client's encryption worker, for a room encrypted end to end.
				'roomsWorker' => function_exists( 'wordplus_realtime_rooms_worker_url' ) ? wordplus_realtime_rooms_worker_url() : '',
				'keys'        => $keys,
			);
			$grants = $this->public_grants();

			if ( array() !== $grants ) {
				$config['grants'] = $grants;
			}

			/**
			 * The page's settings, for a site whose browser may hold several users: `'perUser' => true` gives each user a
			 * connection of their own, as a demo's windows that are other people need.
			 *
			 * @param array $config  The settings.
			 * @param int   $user_id The page's user, 0 for a visitor.
			 */
			return (array) apply_filters( 'wordplus_realtime_config', $config, $user );
		}

		/**
		 * The site's routes: POST wordplus/v1/realtime/auth { rooms }, /calls, and /keys { labels }, which anyone may ask,
		 * each room's, call's or key's owner deciding; and /webhook, the realtime server's, which it signs.
		 */
		public function register_routes() {
			register_rest_route( self::ROUTE_NAMESPACE, self::ROUTE, array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_auth' ),
				'permission_callback' => '__return_true',
			) );

			register_rest_route( self::ROUTE_NAMESPACE, self::CALLS_ROUTE, array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_calls' ),
				'permission_callback' => '__return_true',
			) );

			register_rest_route( self::ROUTE_NAMESPACE, WordPlus_Realtime_Keys::ROUTE, array(
				'methods'             => 'POST',
				'callback'            => array( $this->keys(), 'rest_keys' ),
				'permission_callback' => '__return_true',
			) );

			// Signed by the realtime server with the site's webhook key, which rest_webhook() checks.
			register_rest_route( self::ROUTE_NAMESPACE, self::WEBHOOK_ROUTE, array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'rest_webhook' ),
				'permission_callback' => '__return_true',
			) );
		}

		/**
		 * @param WP_REST_Request $request
		 * @return array|WP_Error
		 */
		public function rest_auth( $request ) {
			if ( ! $this->available() ) {
				return new WP_Error( 'not_connected', 'The site is not connected to WordPlus Cloud.', array( 'status' => 503 ) );
			}

			$rooms = $request->get_param( 'rooms' );

			if ( ! is_array( $rooms ) ) {
				return new WP_Error( 'bad_request', 'rooms must be a list of room names.', array( 'status' => 400 ) );
			}

			return $this->authorize( $rooms, $this->user() );
		}

		/**
		 * A refusal is an answer like any other, `{ denied }`, which the browser hands on as the call's or room's `code`:
		 * as the auth route's, it isn't an HTTP error, which every browser would log as one.
		 *
		 * @param WP_REST_Request $request
		 * @return array
		 */
		public function rest_calls( $request ) {
			$params = $request->get_json_params();

			return $this->authorize_call( is_array( $params ) ? $params : array(), $this->call_user() );
		}

		/**
		 * The realtime server's webhook: checked against the site's webhook key (the secret in use, or the one before while
		 * a new one comes in), its events opened and handed to the handlers on() set. 204 once every handler is done, 401
		 * for a request the realtime server didn't sign, 500 when a handler threw (the server sends the batch again later).
		 *
		 * @param WP_REST_Request $request
		 * @return WP_REST_Response|WP_Error
		 */
		public function rest_webhook( $request ) {
			$path = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- signed as it came
			$done = $this->webhook( (string) $request->get_body(), array(
				'site'      => (string) $request->get_header( 'x_wordplus_site' ),
				'timestamp' => (string) $request->get_header( 'x_wordplus_timestamp' ),
				'signature' => (string) $request->get_header( 'x_wordplus_signature' ),
			), $path );

			return true === $done ? new WP_REST_Response( null, 204 ) : $done;
		}

		/**
		 * A webhook as it came: true once its events were handed out, or the WP_Error to answer.
		 *
		 * @param string $raw     the body as sent
		 * @param array  $headers `site`, `timestamp`, `signature`
		 * @param string $path    the path with its query, as requested
		 * @return true|WP_Error
		 */
		public function webhook( $raw, array $headers, $path ) {
			$activation = $this->activation();
			$timestamp  = isset( $headers['timestamp'] ) ? (string) $headers['timestamp'] : '';
			$signature  = isset( $headers['signature'] ) ? (string) $headers['signature'] : '';

			if ( null === $activation || ( isset( $headers['site'] ) ? (string) $headers['site'] : '' ) !== (string) $activation['site_key'] || '' === $signature || 1 !== preg_match( '/^\d{1,12}$/', $timestamp ) ) {
				return new WP_Error( 'missing_signature', 'Not the realtime server.', array( 'status' => 401 ) );
			}

			if ( abs( time() - (int) $timestamp ) > self::WEBHOOK_WINDOW ) {
				return new WP_Error( 'stale_signature', 'The signature is out of date.', array( 'status' => 401 ) );
			}

			$signed = false;

			foreach ( array( 'secret', 'previous_secret' ) as $which ) {
				if ( empty( $activation[ $which ] ) ) {
					continue;
				}

				$key    = hash_hmac( 'sha256', self::WEBHOOK_LABEL, (string) $activation[ $which ], true );
				$signed = $signed || hash_equals( hash_hmac( 'sha256', $timestamp . "\nPOST\n" . $path . "\n" . hash( 'sha256', $raw ), $key ), $signature );
			}

			if ( ! $signed ) {
				return new WP_Error( 'bad_signature', 'The signature does not match.', array( 'status' => 401 ) );
			}

			$decoded = json_decode( $raw, true );

			if ( ! is_array( $decoded ) || ! isset( $decoded['events'] ) || ! is_array( $decoded['events'] ) ) {
				return new WP_Error( 'bad_request', 'No events.', array( 'status' => 400 ) );
			}

			try {
				foreach ( $decoded['events'] as $e ) {
					if ( ! is_array( $e ) ) {
						continue;
					}

					$emit  = isset( $e['type'] ) && 'emit' === $e['type'];
					$event = $emit ? array( 'data' => $this->opened( isset( $e['data'] ) ? $e['data'] : null ) ) + $e : $e;
					$type  = (string) ( $emit ? ( isset( $e['event'] ) ? $e['event'] : '' ) : ( isset( $e['type'] ) ? $e['type'] : '' ) );
					$named = isset( $this->handlers[ $type ] ) ? $this->handlers[ $type ] : array();
					$all   = isset( $this->handlers['*'] ) ? $this->handlers['*'] : array();

					foreach ( array_merge( $named, $all ) as $handler ) {
						call_user_func( $handler, $event );
					}
				}
			} catch ( \Throwable $error ) {
				self::warn( 'a webhook handler failed: ' . $error->getMessage() );

				return new WP_Error( 'handler_failed', 'A handler failed.', array( 'status' => 500 ) );
			}

			return true;
		}

		/** Connecting the site to WordPlus Cloud, for a site no WordPlus plugin activated. */
		public function connect() {
			if ( null === $this->connect ) {
				$this->connect = new WordPlus_Realtime_Connect( $this );
			}

			return $this->connect;
		}

		/** The keys that seal what the site sends through the realtime server, shared by every plugin on it. */
		public function keys() {
			if ( null === $this->keys ) {
				$this->keys = new WordPlus_Realtime_Keys( $this );
			}

			return $this->keys;
		}

		/** The option that holds the credentials: the site's, or on a network the network's when the site has none. */
		public function stored() {
			$data = get_option( self::OPTION, null );

			if ( ! is_array( $data ) && is_multisite() ) {
				$data = get_site_option( self::OPTION, null );
			}

			return is_array( $data ) ? $data : array();
		}

		/** A name the server takes for a room, a call or a group call. */
		public static function valid_room( $room ) {
			return WordPlus_Realtime_Patterns::valid_name( $room );
		}

		/** @return array|null the site's activation with its key and secret, by its own address or its network's */
		private function activation() {
			$data = $this->stored();

			foreach ( $this->addresses() as $url ) {
				$activation = isset( $data['activations'][ $url ] ) && is_array( $data['activations'][ $url ] ) ? $data['activations'][ $url ] : array();

				if ( ! empty( $activation['site_key'] ) && ! empty( $activation['secret'] ) ) {
					return $activation;
				}
			}

			return null;
		}

		/** The addresses an activation of this site may be kept under: its own, and a subdirectory network's main site's. */
		private function addresses() {
			$addresses = array( site_url() );

			if ( is_multisite() ) {
				$addresses[] = get_site_url( get_main_site_id() );
			}

			return array_values( array_unique( $addresses ) );
		}

		/**
		 * A room rule's answer for a user: null for no, else what they bring and may do.
		 *
		 * @param array  $found the pattern matched, its value and params
		 * @param string $room
		 * @param int    $user_id
		 * @return array|null
		 */
		private function answer_for( array $found, $room, $user_id ) {
			$rule = $found['value']['rule'];

			if ( null === $rule ) {
				return $found['value']['options']['public'] ? array() : null;
			}

			$answer = call_user_func( $rule, (int) $user_id, $found['params'], $room );

			if ( false === $answer || null === $answer ) {
				return null;
			}

			if ( ! is_array( $answer ) ) {
				return array();
			}

			$out = array();

			if ( array_key_exists( 'info', $answer ) ) {
				$out['info'] = $answer['info'];
			}

			if ( isset( $answer['emit'] ) && ( '*' === $answer['emit'] || is_array( $answer['emit'] ) ) ) {
				$out['emit'] = '*' === $answer['emit'] ? '*' : array_values( array_map( 'strval', $answer['emit'] ) );
			}

			if ( ! empty( $answer['readOnly'] ) ) {
				$out['readOnly'] = true;
			}

			return $out;
		}

		/** A call rule's answer for a user about `$name` with `$with`, as the caller or the callee (`$role`): null for no. */
		private function ask_caller( $user_id, $name, $with, $role ) {
			$found = $this->call_rules->match( $name );

			return null === $found ? null : $this->call_answer( call_user_func( $found['value']['rule'], (int) $user_id, (int) $with, $found['params'], $name, array( 'role' => $role ) ), $user_id );
		}

		/**
		 * A calls or group calls rule's answer, with the user's name and picture as `info` unless it said; null for no.
		 *
		 * @param mixed $answer
		 * @param int   $user_id
		 * @return array|null
		 */
		private function call_answer( $answer, $user_id ) {
			if ( false === $answer || null === $answer ) {
				return null;
			}

			$out = is_array( $answer ) ? $answer : array();

			if ( ! array_key_exists( 'info', $out ) ) {
				$out['info'] = $this->default_call_info( $user_id );
			}

			return $out;
		}

		/**
		 * A proof this site gives about a call, by its first attempt's id and its two people: `member`, that a user is in
		 * it; `rung`, that someone in it rang a user in. Made with the master key (keys()->proof()).
		 *
		 * @return string
		 */
		private function call_proof( $kind, $call, $first, array $pair, $user_id ) {
			return $this->keys()->proof( $kind . '|' . $call . '|' . $first . '|' . $pair[0] . '|' . $pair[1] . '|' . (int) $user_id );
		}

		/**
		 * What a host does to someone else in the group call `$name`, from its call screen: the call's rule asked again for
		 * the user, who must be its host (`admin`), then the act through WordPlus Cloud: `mute` their microphone, `speak`
		 * or `listen` (permit()'s `publish`), `remove`. `array( 'done' => … )`, whether it changed anything.
		 *
		 * @param mixed $name
		 * @param mixed $act
		 * @param mixed $target
		 * @param int   $user_id
		 * @return array
		 */
		private function moderate_call( $name, $act, $target, $user_id ) {
			$other = is_int( $target ) || ( is_string( $target ) && ctype_digit( $target ) ) ? (int) $target : 0;

			if ( ! WordPlus_Realtime_Patterns::valid_name( $name ) || ! in_array( $act, array( 'mute', 'speak', 'listen', 'remove' ), true ) || $other <= 0 || $other === $user_id ) {
				return array( 'denied' => 'bad_request' );
			}

			$found  = $this->group_rules->match( $name );
			$answer = null === $found ? null : call_user_func( $found['value']['rule'], $user_id, $found['params'], $name );

			if ( ! is_array( $answer ) || empty( $answer['admin'] ) ) {
				return array( 'denied' => 'forbidden' );
			}

			$call = $this->call( $name );

			if ( 'mute' === $act ) {
				$done = $call->mute( $other, 'microphone' );
			} elseif ( 'remove' === $act ) {
				$done = $call->remove( $other );
			} else {
				$done = $call->permit( $other, array( 'publish' => 'speak' === $act ) );
			}

			return is_wp_error( $done ) ? array( 'denied' => 'server' ) : array( 'done' => (bool) $done );
		}

		/**
		 * Whether a user may call each person asked about (`array( array( 'call' => …, 'to' => … ) )`), in the order asked:
		 * the rule of each call, asked as for its caller, as placing it asks. A list of people asks it before offering its
		 * call buttons. At most 100.
		 *
		 * @param mixed $asks
		 * @param int   $user_id
		 * @return array
		 */
		private function may_call( $asks, $user_id ) {
			if ( ! is_array( $asks ) || array_values( $asks ) !== $asks || count( $asks ) > 100 ) {
				return array( 'denied' => 'bad_request' );
			}

			$may = array();

			foreach ( $asks as $ask ) {
				$call  = is_array( $ask ) && isset( $ask['call'] ) ? $ask['call'] : null;
				$other = is_array( $ask ) && isset( $ask['to'] ) && ( is_int( $ask['to'] ) || ( is_string( $ask['to'] ) && ctype_digit( $ask['to'] ) ) ) ? (int) $ask['to'] : 0;
				// The rule alone, with no info to make for a call no one places yet.
				$found  = WordPlus_Realtime_Patterns::valid_name( $call ) && $other > 0 && $other !== $user_id ? $this->call_rules->match( $call ) : null;
				$answer = null === $found ? null : call_user_func( $found['value']['rule'], $user_id, $other, $found['params'], $call, array( 'role' => 'caller' ) );
				$may[]  = null !== $answer && false !== $answer;
			}

			return array( 'may' => $may );
		}

		/**
		 * Who a user may add to a call named `$call`: those its rule's `people` names whom the user may also call about it,
		 * with their names and pictures for the call screen. At most 100.
		 *
		 * @return array<int, array{id: int, name: string, avatar: string}>
		 */
		private function call_people( $call, $user_id ) {
			$found  = $this->call_rules->match( $call );
			$people = null === $found ? null : $found['value']['people'];

			if ( null === $people ) {
				return array();
			}

			$listed = array();

			foreach ( (array) call_user_func( $people, $user_id, $call ) as $id ) {
				$id = (int) $id;

				if ( 0 === $id || $id === $user_id || isset( $listed[ $id ] ) || null === $this->ask_caller( $user_id, $call, $id, 'caller' ) ) {
					continue;
				}

				$info = $this->default_call_info( $id );

				if ( null !== $info ) {
					$listed[ $id ] = array( 'id' => $id, 'name' => $info['name'], 'avatar' => isset( $info['avatar'] ) ? $info['avatar'] : '' );
				}

				if ( count( $listed ) >= 100 ) {
					break;
				}
			}

			return array_values( $listed );
		}

		/** A signed-in member's info by default: their display name and picture. */
		private function default_info( $user_id ) {
			return $this->default_call_info( $user_id );
		}

		/** What the others see of a signed-in user by default: their name and picture. */
		private function default_call_info( $user_id ) {
			if ( $user_id <= 0 || ! function_exists( 'get_userdata' ) ) {
				return null;
			}

			$user = get_userdata( $user_id );

			if ( ! $user || ! isset( $user->display_name ) ) {
				return null;
			}

			$info = array( 'name' => (string) $user->display_name );

			if ( function_exists( 'get_avatar_url' ) ) {
				$avatar = get_avatar_url( $user_id, array( 'size' => 128 ) );

				if ( is_string( $avatar ) && '' !== $avatar ) {
					$info['avatar'] = $avatar;
				}
			}

			return $info;
		}

		/**
		 * Easy Stream's grant for a live stream, as its rule answers for this user: their role, name and picture, chat
		 * and what they may send, with the stream's settings. Denied `bad_request` for a name that isn't a stream's,
		 * `forbidden` where the rule says no, `no_user` where it gives a visitor more than a viewer's place.
		 *
		 * @param mixed $name
		 * @param int   $user_id
		 * @return array{token?: string, exp?: int, denied?: string}
		 */
		private function authorize_stream( $name, $user_id ) {
			if ( ! is_string( $name ) || 1 !== preg_match( self::STREAM_NAME, $name ) ) {
				return array( 'denied' => 'bad_request' );
			}

			$found = $this->stream_rules->match( $name );

			if ( null === $found ) {
				return array( 'denied' => 'forbidden' );
			}

			$answer = call_user_func( $found['value']['rule'], $user_id, $found['params'], $name );

			if ( is_string( $answer ) ) {
				$answer = array( 'role' => $answer );
			}

			if ( ! is_array( $answer ) || ! in_array( $answer['role'] ?? null, array( 'host', 'guest', 'viewer' ), true ) ) {
				return array( 'denied' => 'forbidden' );
			}

			if ( 0 === $user_id && 'viewer' !== $answer['role'] ) {
				return array( 'denied' => 'no_user' );
			}

			$credentials = $this->credentials();

			if ( null === $credentials ) {
				return array( 'denied' => 'not_connected' );
			}

			$info   = $answer['info'] ?? $this->default_call_info( $user_id );
			$named  = is_array( $info ) && isset( $info['name'] ) && is_string( $info['name'] ) && '' !== $info['name'] ? mb_substr( $info['name'], 0, 64 ) : null;
			$avatar = is_array( $info ) && isset( $info['avatar'] ) && is_string( $info['avatar'] ) && strlen( $info['avatar'] ) <= 512 && 0 === strpos( $info['avatar'], 'https://' ) ? $info['avatar'] : null;

			$params   = $found['params'];
			$settings = $found['value']['settings'];
			$setting  = static function ( $value ) use ( $params ) {
				return is_callable( $value ) ? call_user_func( $value, $params ) : $value;
			};
			$chat     = $setting( $settings['chat'] ?? null );
			$chat     = is_array( $chat ) ? $chat : array();

			$now = time();
			$exp = $now + self::STREAM_TTL;

			$claims = array(
				'iss'       => $credentials['key'],
				'aud'       => self::GRANT_AUDIENCE,
				'str'       => $name,
				'role'      => $answer['role'],
				'sub'       => $user_id > 0 ? (string) $user_id : null,
				'name'      => $named,
				'avatar'    => $avatar,
				'chat'      => $answer['chat'] ?? null,
				'mod'       => $answer['mod'] ?? null,
				'src'       => $answer['src'] ?? null,
				'q'         => $answer['quality'] ?? null,
				'stage'     => $setting( $settings['stage'] ?? null ),
				'offline'   => $chat['offline'] ?? null,
				'links'     => $chat['links'] ?? null,
				'fresh'     => $chat['fresh'] ?? null,
				'people'    => $setting( $settings['people'] ?? null ),
				'reactions' => $setting( $settings['reactions'] ?? null ),
				'iat'       => $now,
				'exp'       => $exp,
			);

			return array(
				'token' => self::stream_grant( $claims, hash_hmac( 'sha256', self::GRANT_KEY_LABEL, $credentials['secret'], true ) ),
				'exp'   => $exp,
			);
		}

		/**
		 * Easy Stream's grant: an HS256 JWT of the claims in the protocol's order (CLAIM_ORDER), none left null, encoded
		 * as the other languages encode it, so every language signs the same claims to the same token
		 * (spec/stream-grants.json, Easy Stream's own vectors).
		 *
		 * @param array  $claims
		 * @param string $key
		 * @return string
		 */
		public static function stream_grant( array $claims, $key ) {
			$ordered = array();

			foreach ( self::CLAIM_ORDER as $name ) {
				if ( isset( $claims[ $name ] ) ) {
					$ordered[ $name ] = $claims[ $name ];
				}
			}

			$input = self::base64url( '{"alg":"HS256","typ":"JWT"}' ) . '.' . self::base64url( (string) wp_json_encode( $ordered, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );

			return $input . '.' . self::base64url( hash_hmac( 'sha256', $input, $key, true ) );
		}

		/**
		 * A calls token: a call's, a line's or a group call's, by its claims, signed with the calls key.
		 *
		 * @return array{token?: string, exp?: int, denied?: string}
		 */
		private function sign_calls( array $claims ) {
			$credentials = $this->credentials();

			if ( null === $credentials ) {
				return array( 'denied' => 'not_connected' );
			}

			$ttl    = (int) apply_filters( 'wordplus_realtime_call_token_ttl', self::CALL_TTL );
			$now    = time();
			$exp    = $now + max( 60, min( self::CALL_TTL, $ttl ) );
			$claims = array_merge( array( 'iss' => $credentials['key'], 'iat' => $now, 'exp' => $exp ), $claims );

			return array(
				'token' => self::jwt( $claims, hash_hmac( 'sha256', self::CALLS_LABEL, $credentials['secret'], true ) ),
				'exp'   => $exp,
			);
		}

		/** What the others' screens show of a user in a call or a group call, sealed with the day's key: everyone the site knows opens it. */
		private function sealed_call_info( $info ) {
			if ( null === $info || ! $this->keys()->sealing() ) {
				return $info;
			}

			$sealed = $this->keys()->seal_json( $info, $this->keys()->day_label() );

			return null === $sealed ? $info : $sealed;
		}

		/**
		 * A request to the realtime server, signed as the site signs WordPlus Cloud's API: an HMAC-SHA256 over
		 * "{timestamp}\n{METHOD}\n{path with query}\n{sha256 of the body}", with the publish key derived from its secret.
		 *
		 * @return array|WP_Error the server's answer
		 */
		private function signed( $method, $path, $body = null ) {
			$credentials = $this->credentials();

			if ( null === $credentials ) {
				return new WP_Error( 'not_connected', 'The site is not connected to WordPlus Cloud.' );
			}

			$url    = $this->api_server() . ltrim( (string) $path, '/' );
			$json   = null === $body ? '' : (string) wp_json_encode( $body );
			$signed = (string) wp_parse_url( $url, PHP_URL_PATH );
			$query  = wp_parse_url( $url, PHP_URL_QUERY );

			if ( is_string( $query ) && '' !== $query ) {
				$signed .= '?' . $query;
			}

			$timestamp = (string) time();
			$key       = hash_hmac( 'sha256', self::PUBLISH_LABEL, $credentials['secret'], true );
			$request   = array(
				'method'  => $method,
				'timeout' => 5,
				'headers' => array(
					'Content-Type'         => 'application/json',
					'X-WordPlus-Site'      => $credentials['key'],
					'X-WordPlus-Timestamp' => $timestamp,
					'X-WordPlus-Signature' => hash_hmac( 'sha256', $timestamp . "\n" . $method . "\n" . $signed . "\n" . hash( 'sha256', $json ), $key ),
				),
			);

			if ( null !== $body ) {
				$request['body'] = $json;
			}

			$response = 'GET' === $method ? wp_remote_get( $url, $request ) : wp_remote_post( $url, $request );

			if ( is_wp_error( $response ) ) {
				return $response;
			}

			$status  = (int) wp_remote_retrieve_response_code( $response );
			$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );

			if ( 200 !== $status || ! is_array( $decoded ) || empty( $decoded['ok'] ) ) {
				$code = is_array( $decoded ) && ! empty( $decoded['error'] ) ? (string) $decoded['error'] : 'http_' . $status;

				return new WP_Error( $code, 'The realtime server refused the request: ' . $code, array( 'status' => $status ) );
			}

			return $decoded;
		}

		/**
		 * A room's options as its rule gave them, with their defaults and the cloud's limits.
		 *
		 * @return array{presence: bool, count: bool, public: bool, seal: bool, history: array{last: int, days: float}|null, emit: string[]|string, webhook: string[]|string}
		 */
		private static function normalized( array $options ) {
			$history = null;
			$given   = isset( $options['history'] ) ? $options['history'] : null;

			if ( is_int( $given ) && $given > 0 ) {
				$history = array( 'last' => min( $given, self::MAX_HISTORY ), 'days' => self::MAX_HISTORY_DAYS );
			} elseif ( is_array( $given ) && isset( $given['last'] ) && (int) $given['last'] > 0 ) {
				$days    = isset( $given['days'] ) && is_numeric( $given['days'] ) && (float) $given['days'] > 0 ? min( (float) $given['days'], self::MAX_HISTORY_DAYS ) : self::MAX_HISTORY_DAYS;
				$history = array( 'last' => min( (int) $given['last'], self::MAX_HISTORY ), 'days' => $days );
			}

			$names = static function ( $list ) {
				return '*' === $list ? '*' : ( is_array( $list ) ? array_values( array_map( 'strval', $list ) ) : array() );
			};

			return array(
				'presence' => ! empty( $options['presence'] ),
				'count'    => ! empty( $options['count'] ) || ! empty( $options['presence'] ),
				'public'   => ! empty( $options['public'] ),
				'seal'     => (bool) ( isset( $options['seal'] ) ? $options['seal'] : empty( $options['public'] ) ),
				'history'  => $history,
				'emit'     => $names( isset( $options['emit'] ) ? $options['emit'] : array() ),
				'webhook'  => $names( isset( $options['webhook'] ) ? $options['webhook'] : array() ),
			);
		}

		/** A room's options as a token carries them: `p`, `c`, `h`, `e`, `w`, `ro`, only those set. */
		private static function short( array $options, $read_only ) {
			$out = array();

			if ( $options['presence'] ) {
				$out['p'] = 1;
			}

			if ( $options['count'] && ! $options['presence'] ) {
				$out['c'] = 1;
			}

			if ( null !== $options['history'] ) {
				$out['h'] = array( $options['history']['last'], $options['history']['days'] );
			}

			if ( '*' === $options['emit'] || array() !== $options['emit'] ) {
				$out['e'] = $options['emit'];
			}

			if ( '*' === $options['webhook'] || array() !== $options['webhook'] ) {
				$out['w'] = $options['webhook'];
			}

			if ( $read_only ) {
				$out['ro'] = 1;
			}

			return $out;
		}

		/**
		 * A call's two people as a page names them: two different users' ids, or null.
		 *
		 * @param mixed $pair
		 * @return array{0: int, 1: int}|null
		 */
		private static function pair_of( $pair ) {
			if ( ! is_array( $pair ) || 2 !== count( $pair ) ) {
				return null;
			}

			$pair = array_map( 'intval', array_values( $pair ) );

			return 0 !== $pair[0] && 0 !== $pair[1] && $pair[0] !== $pair[1] ? $pair : null;
		}

		/** @param mixed $id an attempt at a call, as the page names it */
		private static function valid_attempt( $id ) {
			return is_string( $id ) && 1 === preg_match( '/^[A-Za-z0-9_-]{8,64}$/', $id );
		}

		private static function warn( $message ) {
			if ( function_exists( '_doing_it_wrong' ) ) {
				_doing_it_wrong( 'wordplus_realtime', esc_html( 'wordplus-realtime: ' . $message ), '1.0.0' );
			} else {
				error_log( 'wordplus-realtime: ' . $message ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- outside WordPress only
			}
		}

		private static function jwt( array $claims, $key ) {
			$input = self::base64url( '{"alg":"HS256","typ":"JWT"}' ) . '.' . self::base64url( (string) wp_json_encode( $claims ) );

			return $input . '.' . self::base64url( hash_hmac( 'sha256', $input, $key, true ) );
		}

		private static function base64url( $data ) {
			return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- a JWT is base64url
		}
	}
}
