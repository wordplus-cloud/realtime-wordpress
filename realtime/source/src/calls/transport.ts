/**
 * The one seam between the call engine and the product it runs in: how its
 * requests reach the relay and the relay's events come back. Better Messages
 * hands the session its socket's `p2pCall`; the realtime SDK, the `/channels`
 * connection's `call` request. Everything else about a call is the engine's.
 */

// A Better Messages call is its message's id; the SDK's, the attempt's id.
export type CallId = number | string;

export type RelayMessage = Record<string, unknown>;

export interface CallTransport {
    // Whether this page reaches a realtime server at all. A page without one
    // (a preview in Better Messages) joins nothing.
    readonly available: boolean;
    readonly connected: boolean;
    // An op to the relay. `call_id` and `session` are already in the payload,
    // and the relay's answer goes to `ack`.
    send( payload: RelayMessage, ack?: ( response: any ) => void ): void;
    // The relay's events for one session of one call: tabs sharing a
    // connection all see every one, so the transport hands each session only
    // its own. Answers the function that stops listening.
    listen( callId: CallId, session: string, handler: ( message: RelayMessage ) => void ): () => void;
    // Called each time the connection came back after a drop. Answers the
    // function that stops.
    onReconnect( listener: () => void ): () => void;
    // The leave a closing page sends with `navigator.sendBeacon`, since a
    // leave over the connection races the page's teardown. Optional.
    beacon?( callId: CallId, session: string ): void;
}
