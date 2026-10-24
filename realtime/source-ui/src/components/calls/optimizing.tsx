import React, { useEffect, useRef, useState } from "react";
import { _x } from "../../inc/globals.ts";
import type { CallParticipant } from "./context.ts";

/**
 * "Optimizing video quality..." over someone's picture while their camera moves to another codec during a call, a
 * placeholder everyone sees on the tile so the move looks smooth and understandable. Whoever runs the call marks them
 * (CallParticipant.videoOptimizing: the realtime client's CameraOptimizing, from their "optimizing" to their "ready",
 * 10 s at most); the tile then waits for the new picture's first frame itself, so it never shows a black frame
 * between, within the same 10 s from the start. It lies over their last frame, kept as a still and blurred (their
 * avatar where there was none), fades in and out, and says itself to a screen reader once (role="status").
 */

/**
 * The longest the placeholder stays, from its start, whatever was heard after (the realtime client's
 * CAMERA_OPTIMIZING_MAX_MS), where the call gives no other (CallContextInterface.optimizingMaxMs, the node's).
 */
export const OPTIMIZING_MAX_MS = 10_000;
/** How long it takes to fade out. */
export const OPTIMIZING_FADE_MS = 300;

export interface CameraOptimizingState {
    /** shown now */
    shown: boolean;
    /** fading out */
    leaving: boolean;
    /** their last frame, as a small JPEG data URL; null where none could be taken */
    still: string | null;
}

// Their picture as it stands, small: what the placeholder lies over once the picture itself is taken out of the room.
function stillOf( element: HTMLVideoElement | null ): string | null {
    try {
        if( ! element || ! element.videoWidth || ! element.videoHeight ) return null;
        const canvas = document.createElement( 'canvas' );
        canvas.width = 160;
        canvas.height = Math.max( 1, Math.round( element.videoHeight * 160 / element.videoWidth ) );
        const context = canvas.getContext( '2d' );
        if( ! context ) return null;
        context.drawImage( element, 0, 0, canvas.width, canvas.height );
        return canvas.toDataURL( 'image/jpeg', 0.7 );
    } catch {
        return null;
    }
}

// Calls done once element shows a frame of what it plays now; the answer stops waiting.
function onFirstFrame( element: HTMLVideoElement, done: () => void ): () => void {
    const video = element as HTMLVideoElement & { requestVideoFrameCallback?: ( cb: () => void ) => number, cancelVideoFrameCallback?: ( id: number ) => void };
    if( typeof video.requestVideoFrameCallback === 'function' ){
        const id = video.requestVideoFrameCallback( () => done() );
        return () => video.cancelVideoFrameCallback?.( id );
    }
    if( element.readyState >= 2 ){
        done();
        return () => {};
    }
    element.addEventListener( 'loadeddata', done );
    element.addEventListener( 'playing', done );
    return () => {
        element.removeEventListener( 'loadeddata', done );
        element.removeEventListener( 'playing', done );
    };
}

/**
 * Whether participant's picture shows the placeholder now, in element (their camera's <video>, whatever it is now: a
 * tile draws a new one when their camera comes back), for maxMs at most.
 */
export function useCameraOptimizing( participant: CallParticipant | null | undefined, element: HTMLVideoElement | null, maxMs: number = OPTIMIZING_MAX_MS ): CameraOptimizingState {
    const [ since, setSince ] = useState( 0 );
    const [ still, setStill ] = useState<string | null>( null );
    const [ leaving, setLeaving ] = useState( false );
    const elementRef = useRef( element );
    elementRef.current = element;
    // when it came (0: not shown), as the effects read it without waiting for a render
    const sinceRef = useRef( 0 );
    const optimizing = !! participant?.videoOptimizing;
    const video = participant?.video ?? null;

    // marked: the placeholder comes, over the frame they show now
    useEffect( () => {
        if( ! optimizing ) return;
        setLeaving( false );
        if( sinceRef.current ) return;
        sinceRef.current = Date.now();
        setStill( stillOf( elementRef.current ) );
        setSince( sinceRef.current );
    }, [ optimizing ] );

    // no longer marked: it goes once their camera is back and its first frame drawn, or at maxMs
    useEffect( () => {
        if( ! since || optimizing || leaving ) return;
        let ended = false;
        const end = () => {
            if( ended ) return;
            ended = true;
            setLeaving( true );
        };
        const cap = window.setTimeout( end, Math.max( 0, since + maxMs - Date.now() ) );
        const stop = video && element ? onFirstFrame( element, end ) : () => {};
        return () => {
            window.clearTimeout( cap );
            stop();
        };
    }, [ since, optimizing, leaving, video, element, maxMs ] );

    // marked longer than maxMs (a "ready" never came): it goes anyway
    useEffect( () => {
        if( ! since || ! optimizing ) return;
        const cap = window.setTimeout( () => setLeaving( true ), Math.max( 0, since + maxMs - Date.now() ) );
        return () => window.clearTimeout( cap );
    }, [ since, optimizing, maxMs ] );

    // faded out: gone
    useEffect( () => {
        if( ! leaving ) return;
        const gone = window.setTimeout( () => {
            sinceRef.current = 0;
            setSince( 0 );
            setStill( null );
            setLeaving( false );
        }, OPTIMIZING_FADE_MS );
        return () => window.clearTimeout( gone );
    }, [ leaving ] );

    return { shown: since > 0, leaving, still };
}

/** The placeholder itself, over a tile's picture (main: the whole stage of a call between two). */
export function CameraOptimizingNotice( { state, avatar, main }: { state: CameraOptimizingState, avatar?: string, main?: boolean } ) {
    if( ! state.shown ) return null;
    const backdrop = state.still ?? avatar ?? '';
    return <span className={ 'bm-call-optimizing' + ( main ? ' bm-call-optimizing-main' : '' ) + ( state.leaving ? ' bm-call-optimizing--leaving' : '' ) }
                 part="video-optimizing" role="status" aria-live="polite">
        { backdrop && <span className="bm-call-optimizing-backdrop" aria-hidden="true" style={ { backgroundImage: 'url("' + backdrop.replace( /"/g, '%22' ) + '")' } } /> }
        <span className="bm-call-optimizing-notice">
            <span className="bm-call-optimizing-pulse" aria-hidden="true" />
            <span>{ _x( 'Optimizing video quality...', 'Call Screen', 'bp-better-messages' ) }</span>
        </span>
    </span>;
}
