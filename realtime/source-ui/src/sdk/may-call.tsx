import { useEffect, useState, type ReactNode } from "react";
import type { CallUser, SdkCalls } from "./types.ts";

/** How long an answer is kept: a list drawn again asks no more until then. */
const KEEP = 5 * 60_000;

const answers = new WeakMap<SdkCalls, Map<string, { at: number; may: Promise<boolean | null> }>>();
const waiting = new WeakMap<SdkCalls, Array<{ call: string; to: CallUser; resolve: ( may: boolean | null ) => void }>>();

/**
 * Whether the page's user may call `to` about `call`, as the app's rules answer (`calls.may()`): the people a list draws
 * at once are asked in one request, and each answer is kept a while. `null` where the app can't say, as an SDK without
 * `may` or a failed request, which is asked again next time.
 */
export function mayCall( calls: SdkCalls, call: string, to: CallUser ): Promise<boolean | null> {
    if ( typeof calls.may !== "function" ) return Promise.resolve( null );
    let kept = answers.get( calls );
    if ( ! kept ) answers.set( calls, ( kept = new Map() ) );
    const key = call + "\n" + String( to );
    const hit = kept.get( key );
    if ( hit && Date.now() - hit.at < KEEP ) return hit.may;

    const may = new Promise<boolean | null>( ( resolve ) => {
        let queue = waiting.get( calls );
        if ( ! queue ) {
            waiting.set( calls, ( queue = [] ) );
            setTimeout( () => {
                const asks = waiting.get( calls ) ?? [];
                waiting.delete( calls );
                calls.may!( asks.map( ( a ) => ( { call: a.call, to: a.to } ) ) ).then(
                    ( list ) => asks.forEach( ( a, i ) => a.resolve( list[ i ] ?? null ) ),
                    () => asks.forEach( ( a ) => a.resolve( null ) ),
                );
            }, 0 );
        }
        queue.push( { call, to, resolve } );
    } );
    kept.set( key, { at: Date.now(), may } );
    void may.then( ( answer ) => {
        if ( answer === null ) kept!.delete( key );
    } );
    return may;
}

/**
 * The call buttons for `to`, once the app says the page's user may call them about `call`: nothing while it answers, or
 * where it says no. Where the app can't say, the buttons show, and placing the call still asks the rule.
 */
export function MayCall( { calls, call, to, children }: { calls: SdkCalls; call: string; to: CallUser; children: ReactNode } ) {
    const asks = typeof calls.may === "function";
    const key = call + "\n" + String( to );
    const [ answer, setAnswer ] = useState<{ key: string; may: boolean | null } | null>( null );

    useEffect( () => {
        if ( ! asks ) return;
        let live = true;
        mayCall( calls, call, to ).then( ( may ) => live && setAnswer( { key, may } ) );
        return () => {
            live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ calls, key, asks ] );

    if ( ! asks ) return <>{ children }</>;
    if ( answer?.key !== key || answer.may === false ) return null;
    return <>{ children }</>;
}
