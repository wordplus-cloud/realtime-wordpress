import {createContext, useContext, useSyncExternalStore, type ReactNode} from "react";
import type {EasyStreamClient, EasyStreamState} from "@wordplus/realtime-client/streams";
import {useTooltips} from "./tooltip.ts";

const Context = createContext<EasyStreamClient | null>( null );

export function EasyStreamProvider( props : { client : EasyStreamClient, children : ReactNode } ){
    // The tooltips of every control in it (data-estream-tip).
    useTooltips();
    return <Context.Provider value={ props.client }>{ props.children }</Context.Provider>;
}

export function useClient() : EasyStreamClient {
    const client = useContext( Context );
    if( ! client ) throw new Error( 'Easy Stream components must be inside <EasyStreamProvider>' );
    return client;
}

// The client's state, re-rendering on every change.
export function useStream() : EasyStreamState {
    const client = useClient();
    return useSyncExternalStore( client.subscribe, client.getState, client.getState );
}
