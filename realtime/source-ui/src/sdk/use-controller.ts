import { createContext, useContext, useEffect, useState } from "react";
import { controllerFor, type CallsController } from "./controller.ts";
import type { SdkCalls } from "./types.ts";

/** What the call screen asks of the page's `rt`: its calls (`rt.calls()`). */
export interface CallsSource {
    calls(): Promise<SdkCalls>;
}

const pending = new WeakMap<CallsSource, Promise<CallsController>>();

/** The page's calls controller, once its calls are loaded. */
export function useController( rt: CallsSource | null | undefined, add?: boolean ): CallsController | null {
    const [ controller, setController ] = useState<CallsController | null>( null );

    useEffect( () => {
        if ( ! rt ) return;
        let live = true;
        let made = pending.get( rt );
        if ( ! made ) pending.set( rt, ( made = rt.calls().then( ( calls ) => controllerFor( calls, { add } ) ) ) );
        made.then( ( c ) => {
            if ( add !== undefined ) c.setAdd( add );
            if ( live ) setController( c );
        }, () => {} );
        return () => {
            live = false;
        };
    }, [ rt, add ] );

    return controller;
}

/**
 * The page's controller as the elements hold it, for the views they draw: theirs is given the rooms alone (`rt`), with
 * no calls of its own to load.
 */
export const PageCalls = createContext<CallsController | null>( null );

/** The page's controller for a view that may hold a call, from the elements, or from its `rt` where it has calls. */
export function usePageCalls( rt: unknown ): CallsController | null {
    const page = useContext( PageCalls );
    const own = useController( page === null && hasCalls( rt ) ? rt : null );
    return page ?? own;
}

function hasCalls( rt: unknown ): rt is CallsSource {
    return typeof ( rt as Partial<CallsSource> | null )?.calls === "function";
}
