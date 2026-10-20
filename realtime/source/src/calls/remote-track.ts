import type {P2PSource} from "./types.js";
import {ElementViewTracker} from "./view.js";

export class RemoteMediaTrack {
    readonly sid: string;
    readonly attachedElements: HTMLMediaElement[] = [];
    private readonly stream: MediaStream;
    private viewTracker: ElementViewTracker | null = null;

    constructor(
        readonly mediaStreamTrack: MediaStreamTrack,
        readonly source: P2PSource,
        private readonly onPlaybackBlocked: ( element: HTMLMediaElement ) => void,
        private readonly onViewChange: ( () => void ) | null = null
    ) {
        this.sid = 'p2p_' + source + '_' + mediaStreamTrack.id;
        this.stream = new MediaStream( [ mediaStreamTrack ] );
    }

    get kind(): 'audio' | 'video' {
        return this.mediaStreamTrack.kind === 'audio' ? 'audio' : 'video';
    }

    get isMuted(): boolean {
        return this.mediaStreamTrack.muted;
    }

    attach( element: HTMLMediaElement ): HTMLMediaElement {
        if( ! element ) return element;

        if( element.srcObject !== this.stream ){
            element.srcObject = this.stream;
        }

        element.autoplay = true;

        if( element instanceof HTMLVideoElement ){
            element.playsInline = true;
        }

        if( ! this.attachedElements.includes( element ) ){
            this.attachedElements.push( element );
        }

        // The layouts attach and never detach: the boxes a video is shown in
        // are watched from here, so the other side can be told what size to
        // send (a screen share to the pixel, the camera by rung).
        if( this.kind === 'video' && this.onViewChange ){
            if( ! this.viewTracker ){
                this.viewTracker = new ElementViewTracker( this.onViewChange, this.source === 'screen_share' );
            }

            this.viewTracker.observe( element );
        }

        this.play( element );

        return element;
    }

    play( element: HTMLMediaElement ): void {
        const attempt = element.play();

        if( attempt && typeof attempt.catch === 'function' ){
            attempt.catch( ( error: unknown ) => {
                const name = error && typeof error === 'object' && 'name' in error ? String( ( error as { name: string } ).name ) : '';

                if( name === 'NotAllowedError' ){
                    this.onPlaybackBlocked( element );
                }
            } );
        }
    }

    // How big this track is shown, as a height in device pixels (a VIEW_STEPS
    // rung for the camera, the shown size rounded up to a small step for a
    // screen share); 0 when no attached element shows it. Elements the
    // layout has thrown away are dropped on the way.
    wantedHeight(): number {
        if( ! this.viewTracker ) return 0;

        for( const element of this.viewTracker.stale() ){
            this.detach( element );
        }

        return this.viewTracker.wantedHeight();
    }

    detach( element?: HTMLMediaElement ): HTMLMediaElement[] {
        const targets = element ? [ element ] : [ ...this.attachedElements ];

        for( const target of targets ){
            if( target.srcObject === this.stream ){
                target.srcObject = null;
            }

            const index = this.attachedElements.indexOf( target );

            if( index > -1 ){
                this.attachedElements.splice( index, 1 );
            }

            if( this.viewTracker ){
                this.viewTracker.unobserve( target );
            }
        }

        if( ! element && this.viewTracker ){
            this.viewTracker.close();
            this.viewTracker = null;
        }

        return targets;
    }

    stop(): void {
        this.detach();
    }
}
