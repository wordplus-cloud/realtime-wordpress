import { useCallback, useEffect, useRef, useState } from "react";

// Which call controls are waiting on the server.
//
// A moderator's control on a tile (pin, block broadcast, mute, kick, promote)
// is a groupCallAdmin request, and what it changes reaches the tile through
// the participant's LiveKit metadata, not through the request's answer. The
// answer can come first — for a microphone, which the other side's own client
// turns off, well before — and a control that stopped waiting there showed
// its old state for that gap, which reads as a click that did nothing. So
// such a control waits until the tile has changed: `settled` is what the
// tile shows of those states, and any change to it ends every wait it holds.
// A failed request ends its own at once.
//
// The dock's controls (mute all, lock the room, the call mode) flip their
// state themselves once the request succeeds, so a hook given no `settled`
// waits for the request alone.
//
// The cap is for an answer that never shows on the tile — the state was
// already what the request asked for, or a kicked participant stayed — so a
// control can't spin for good. It ends a wait, it never starts one.

const CONFIRM_CAP_MS = 5000;

export type RunPending = ( key: string, request: () => Promise<unknown> ) => void;

export default function usePendingActions( settled?: unknown ): [ ( key: string ) => boolean, RunPending ] {
    const [ pending, setPending ] = useState<Record<string, true>>( {} );

    // Synchronous twins of the state: a second click lands before React has
    // rendered the first one's spinner, and must still be turned away.
    const busy    = useRef( new Set<string>() );
    const waiting = useRef( new Map<string, ReturnType<typeof setTimeout>>() );
    const mounted = useRef( true );

    const settledRef = useRef( settled );
    settledRef.current = settled;
    const confirms = settled !== undefined;

    const done = useCallback( ( key: string ) => {
        const timer = waiting.current.get( key );
        if ( timer ) clearTimeout( timer );
        waiting.current.delete( key );
        busy.current.delete( key );
        if ( ! mounted.current ) return;
        setPending( ( current ) => {
            if ( ! current[ key ] ) return current;
            const next = { ...current };
            delete next[ key ];
            return next;
        } );
    }, [] );

    const run = useCallback<RunPending>( ( key, request ) => {
        if ( busy.current.has( key ) ) return;
        busy.current.add( key );
        setPending( ( current ) => ( { ...current, [ key ]: true } ) );

        const before = settledRef.current;

        void ( async () => {
            let ok = false;
            try {
                ok = ( await request() ) !== false;
            } catch ( e ) {
                ok = false;
            }

            // Still unchanged: wait for the tile. Changed already (the
            // metadata beat the answer): nothing left to wait for.
            if ( ok && confirms && Object.is( settledRef.current, before ) && mounted.current ) {
                waiting.current.set( key, setTimeout( () => done( key ), CONFIRM_CAP_MS ) );
                return;
            }

            done( key );
        } )();
    }, [ confirms, done ] );

    useEffect( () => {
        Array.from( waiting.current.keys() ).forEach( done );
    }, [ settled, done ] );

    useEffect( () => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            waiting.current.forEach( ( timer ) => clearTimeout( timer ) );
            waiting.current.clear();
        };
    }, [] );

    const isPending = useCallback( ( key: string ) => !! pending[ key ], [ pending ] );

    return [ isPending, run ];
}
