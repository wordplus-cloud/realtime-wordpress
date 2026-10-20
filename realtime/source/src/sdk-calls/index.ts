/**
 * Calls and group calls for any plugin or app, on the realtime SDK's connection. Its own script
 * (dist/realtime-calls.min.js, window.wordplusRealtimeCalls), so the page script
 * every site loads stays small; the mesh's room client is a third, loaded only when a group call needs it.
 */
import type { Rooms, RoomsOptions } from '../rooms.js';
import { calls as callsOf, type Calls, type CallsOptions } from './calls.js';

export { calls, Calls, Call, Incoming, type CallsOptions, type CallRequest, type CallGrant, type CallPerson, type CallState, type CallPath, type CallType, type RemoteMedia } from './calls.js';
export { GroupCall, type Person, type RemoteTrack, type RoomPermissions, type ModerationAct, type GroupCallState, type GroupCallPlace } from './group-call.js';
export { callUserOf, type CallUser } from '../calls/users.js';
export { Invite, type InviteState } from './invite.js';
export { Stream, type StreamState, type StreamEvent, type StreamHand, type StreamTile, type StreamTrack, type StreamSnapshot, type PlaybackStats, type PictureLayer, type LayerQuality } from './stream.js';
export { loadLiveKit, type MediaSource, type LiveKit } from './media.js';
export { supportsP2P } from '../calls/index.js';

let shared: { rt: Rooms; calls: Calls } | null = null;

/**
 * The page's rooms and calls, made once from the server package's settings (`window.wordplusRealtimeConfig`) on the
 * page script's rooms (its `page()`, which a plugin's own code shares; `rooms()` from a copy before it): what the call
 * screen and every plugin's code share, so the page holds one line and a call rings once. Null on a page without the
 * settings (a site without credentials).
 */
export function page(config?: RoomsOptions & CallsOptions): { rt: Rooms; calls: Calls } | null {
    if (shared) return shared;
    const settings = config ?? ((globalThis as any).wordplusRealtimeConfig as (RoomsOptions & CallsOptions) | undefined);
    const client = (globalThis as any).wordplusRealtimeClient as { rooms?: (options: RoomsOptions) => Rooms; page?: (options?: RoomsOptions) => Rooms | null } | undefined;
    if (!settings?.site) return null;
    const rt = typeof client?.page === 'function' ? client.page(settings) : typeof client?.rooms === 'function' ? client.rooms(settings) : null;
    if (!rt) return null;
    shared = { rt, calls: callsOf(rt, settings) };
    return shared;
}
