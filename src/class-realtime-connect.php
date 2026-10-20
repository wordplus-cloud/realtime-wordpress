<?php
defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'WordPlus_Realtime_Connect' ) ) {
	/**
	 * Connecting a site to WordPlus Cloud from a plugin that carries no licence key (OAuth's authorization code with
	 * PKCE): an administrator follows url(), approves in the account, and comes
	 * back to admin-post.php?action=wordplus_realtime_connect, where the code is exchanged for the site's key and
	 * secret. They are kept as an activation's are, in `wordplus_cloud_license` under the site's address, so every
	 * WordPlus plugin on the site shares them.
	 */
	final class WordPlus_Realtime_Connect {
		/** The account, where an administrator approves, and its API, where the code is exchanged. */
		const ACCOUNT = 'https://www.wordplus.cloud/';
		const API     = 'https://api.wordplus.cloud/';

		const TRANSIENT = 'wordplus_realtime_connect_';
		const ACTION    = 'wordplus_realtime_connect';

		/** @var WordPlus_Realtime */
		private $realtime;

		public function __construct( WordPlus_Realtime $realtime ) {
			$this->realtime = $realtime;
		}

		public function account() {
			return trailingslashit( (string) apply_filters( 'wordplus_realtime_account', self::ACCOUNT ) );
		}

		public function api() {
			return trailingslashit( (string) apply_filters( 'wordplus_realtime_account_api', self::API ) );
		}

		/**
		 * Where an administrator connects the site: WordPlus Cloud's approval, which sends them back to `$return_to`
		 * (an admin page of the plugin) with `wordplus_realtime` set to connected, denied or failed. The verifier is
		 * kept for 15 minutes under the request's state, for the user who asked.
		 *
		 * @param string $return_to
		 * @return string
		 */
		public function url( $return_to = '' ) {
			$state    = wp_generate_password( 32, false, false );
			$verifier = wp_generate_password( 64, false, false );

			set_transient( self::TRANSIENT . $state, array(
				'verifier' => $verifier,
				'user'     => get_current_user_id(),
				'return'   => '' !== (string) $return_to ? (string) $return_to : admin_url(),
			), 15 * MINUTE_IN_SECONDS );

			return add_query_arg( array(
				'site_url'              => rawurlencode( site_url() ),
				'return_url'            => rawurlencode( admin_url( 'admin-post.php?action=' . self::ACTION ) ),
				'state'                 => $state,
				'code_challenge'        => rtrim( strtr( base64_encode( hash( 'sha256', $verifier, true ) ), '+/', '-_' ), '=' ), // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- PKCE's S256 challenge is base64url
				'code_challenge_method' => 'S256',
				'site_name'             => rawurlencode( (string) get_bloginfo( 'name' ) ),
				'plugin'                => 'wordplus-realtime',
				'plugin_version'        => $this->realtime->version(),
			), $this->account() . 'connect/authorize' );
		}

		/** WordPlus Cloud's return: the code exchanged, for the administrator who started it, then back to their page. */
		public function callback() {
			// phpcs:disable WordPress.Security.NonceVerification.Recommended -- the state, kept for this user, is the request's proof
			$state = isset( $_GET['state'] ) ? sanitize_key( wp_unslash( $_GET['state'] ) ) : '';
			$saved = '' !== $state ? get_transient( self::TRANSIENT . $state ) : false;

			if ( ! is_array( $saved ) || ! current_user_can( 'manage_options' ) || (int) $saved['user'] !== get_current_user_id() ) {
				return $this->back( admin_url(), 'failed' );
			}

			delete_transient( self::TRANSIENT . $state );

			if ( ! empty( $_GET['error'] ) || empty( $_GET['code'] ) ) {
				return $this->back( (string) $saved['return'], 'denied' );
			}

			$result = $this->exchange( sanitize_text_field( wp_unslash( $_GET['code'] ) ), (string) $saved['verifier'] );
			// phpcs:enable

			return $this->back( (string) $saved['return'], is_wp_error( $result ) ? 'failed' : 'connected' );
		}

		/**
		 * The code for the site's credentials (`site`: key, secret, effective_at), kept once they come.
		 *
		 * @return true|WP_Error
		 */
		public function exchange( $code, $verifier ) {
			$response = wp_remote_post( $this->api() . 'api/v1/connect/token', array(
				'timeout' => 15,
				'headers' => array( 'Content-Type' => 'application/json', 'Accept' => 'application/json' ),
				'body'    => wp_json_encode( array( 'code' => (string) $code, 'code_verifier' => (string) $verifier, 'site_url' => site_url() ) ),
			) );

			if ( is_wp_error( $response ) ) {
				return $response;
			}

			$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
			$site = is_array( $body ) && isset( $body['site'] ) && is_array( $body['site'] ) ? $body['site'] : array();

			if ( 200 !== (int) wp_remote_retrieve_response_code( $response ) || empty( $site['key'] ) || empty( $site['secret'] ) ) {
				$error = is_array( $body ) && ! empty( $body['error'] ) ? (string) $body['error'] : 'connect_failed';

				return new WP_Error( $error, 'WordPlus Cloud gave no credentials for the site: ' . $error );
			}

			$this->store( $site );

			return true;
		}

		/**
		 * The site's credentials kept as an activation keeps them (the WordPlus SDK's licence): its key and secret,
		 * the secret before until the new one is in use, under the site's address in the option that already holds
		 * the site's licence, or the site's own.
		 */
		private function store( array $site ) {
			$network = ! is_array( get_option( WordPlus_Realtime::OPTION, null ) ) && is_multisite() && is_array( get_site_option( WordPlus_Realtime::OPTION, null ) );
			$data    = $this->realtime->stored();
			$url     = site_url();

			$existing = isset( $data['activations'][ $url ] ) && is_array( $data['activations'][ $url ] ) ? $data['activations'][ $url ] : array();
			$old      = isset( $existing['secret'] ) ? (string) $existing['secret'] : '';
			$new      = (string) $site['secret'];

			$data['activations'][ $url ] = array_merge( $existing, array(
				'site_key'           => (string) $site['key'],
				'secret'             => $new,
				'effective_at'       => ! empty( $site['effective_at'] ) ? (int) strtotime( (string) $site['effective_at'] ) : time(),
				'previous_secret'    => $old !== $new ? $old : ( isset( $existing['previous_secret'] ) ? (string) $existing['previous_secret'] : '' ),
				'secret_received_at' => time(),
			) );

			if ( $network ) {
				update_site_option( WordPlus_Realtime::OPTION, $data );
			} else {
				update_option( WordPlus_Realtime::OPTION, $data, true );
			}
		}

		private function back( $url, $result ) {
			if ( wp_safe_redirect( add_query_arg( 'wordplus_realtime', $result, $url ) ) ) {
				exit;
			}

			return $result;
		}
	}
}
