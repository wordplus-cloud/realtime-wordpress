import type { CallTrack } from "../components/calls/context.ts";
import type { SdkRemoteTrack } from "./types.ts";

// The SDK's tracks as the screens attach them: with the elements they are on, as LiveKit's tracks keep them.

const remotes = new WeakMap<SdkRemoteTrack, CallTrack>();

/** Another person's track, the same wrapper each time it is asked for, so a screen sees it is the one it attached. */
export function remoteTrack( track: SdkRemoteTrack | null | undefined ): CallTrack | null {
    if ( ! track ) return null;

    let wrapped = remotes.get( track );

    if ( ! wrapped ) {
        const attached: HTMLMediaElement[] = [];

        wrapped = {
            get attachedElements() {
                return attached;
            },
            attach( element ) {
                // A screen asks before its element is there: there is nothing to attach to yet.
                if ( ! element ) return element;
                if ( ! attached.includes( element ) ) attached.push( element );
                return track.attach( element );
            },
            detach( element ) {
                if ( ! element ) return element;
                track.detach( element );
                const at = attached.indexOf( element );
                if ( at >= 0 ) attached.splice( at, 1 );
                return element;
            },
        };
        remotes.set( track, wrapped );
    }

    return wrapped;
}

/** A track this page sends, shown in its own <video>: muted, as one never hears oneself. */
export function localTrack( track: MediaStreamTrack ): CallTrack & { readonly track: MediaStreamTrack } {
    const attached: HTMLMediaElement[] = [];
    // The stream each element was given, so detaching takes off only what this track put there.
    const streams = new WeakMap<HTMLMediaElement, MediaStream>();

    return {
        track,
        get attachedElements() {
            return attached;
        },
        attach( element ) {
            if ( ! element ) return element;
            const stream = new MediaStream( [ track ] );
            streams.set( element, stream );
            element.muted = true;
            element.srcObject = stream;
            void element.play?.()?.catch?.( () => {} );
            if ( ! attached.includes( element ) ) attached.push( element );
            return element;
        },
        detach( element ) {
            if ( ! element ) return element;
            if ( element.srcObject === streams.get( element ) ) element.srcObject = null;
            streams.delete( element );
            const at = attached.indexOf( element );
            if ( at >= 0 ) attached.splice( at, 1 );
            return element;
        },
    };
}
