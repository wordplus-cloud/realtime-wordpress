import type {SealedSignal, SignalBody} from "./types.js";

// The two browsers of a direct call seal every signal they exchange with a
// key WordPress hands them in the callCreate and joinCall replies; the
// realtime server relays and stores the sealed bodies without ever holding
// the key. AES-GCM under SHA-256 of that key, one random nonce per signal.

const LABEL = 'better-messages-p2p-signal\0';

function toBase64( bytes: Uint8Array ): string {
    let binary = '';

    for( let i = 0; i < bytes.length; i++ ){
        binary += String.fromCharCode( bytes[ i ] );
    }

    return btoa( binary );
}

function fromBase64( value: string ): Uint8Array<ArrayBuffer> {
    const binary = atob( value );
    const bytes = new Uint8Array( binary.length );

    for( let i = 0; i < binary.length; i++ ){
        bytes[ i ] = binary.charCodeAt( i );
    }

    return bytes;
}

export function isSealedSignal( body: unknown ): body is SealedSignal {
    return !! body && typeof body === 'object' && ( body as SealedSignal ).sealed === 1
        && typeof ( body as SealedSignal ).iv === 'string' && typeof ( body as SealedSignal ).data === 'string';
}

export class SignalCipher {
    private constructor( private readonly key: CryptoKey ) {}

    static async create( secret: string ): Promise<SignalCipher | null> {
        if( ! secret || typeof crypto === 'undefined' || ! crypto.subtle ) return null;

        try {
            const digest = await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( LABEL + secret ) );
            const key = await crypto.subtle.importKey( 'raw', digest, { name: 'AES-GCM' }, false, [ 'encrypt', 'decrypt' ] );

            return new SignalCipher( key );
        } catch (e) {
            return null;
        }
    }

    async seal( body: SignalBody ): Promise<SealedSignal> {
        const iv = crypto.getRandomValues( new Uint8Array( 12 ) );
        const plain = new TextEncoder().encode( JSON.stringify( body ) );
        const data = await crypto.subtle.encrypt( { name: 'AES-GCM', iv }, this.key, plain );

        return { sealed: 1, iv: toBase64( iv ), data: toBase64( new Uint8Array( data ) ) };
    }

    async open( body: SealedSignal ): Promise<SignalBody | null> {
        try {
            const plain = await crypto.subtle.decrypt( { name: 'AES-GCM', iv: fromBase64( body.iv ) }, this.key, fromBase64( body.data ) );
            const parsed = JSON.parse( new TextDecoder().decode( plain ) ) as SignalBody;

            return parsed && typeof parsed === 'object' && 'kind' in parsed ? parsed : null;
        } catch (e) {
            return null;
        }
    }
}
