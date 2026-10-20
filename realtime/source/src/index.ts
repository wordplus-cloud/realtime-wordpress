/**
 * The WordPlus realtime client: how every product's browser code connects to
 * the realtime server and follows it from node to node.
 *
 * Version 2's shared connection: `realtime()` (the page's connector, the
 * newest copy's), `Connector` (the connections of one context), and
 * `RemoteConnector` (a port to the connector's SharedWorker, as Better
 * Messages' own worker uses it). Version 1's movers stay for a product that
 * keeps a socket of its own.
 */
export { realtime, register, compareVersions, sharedWorkerAvoided, REGISTRY, WORKER_NAME, HOLD_KEY, type RealtimeOptions, type RealtimeClient, type Registry, type Copy } from './registry.js';
export {
    rooms, Rooms, Room, Online, RealtimeError, ROOMS_NAMESPACE, patternMatches, packBinary, unpackBinary,
    type RoomsOptions, type RoomsEvent, type RoomState, type RoomEmitter, type Grant, type PublicGrant, type Member, type EventMeta,
    type Identity, type KeysOptions, type UserProfile,
} from './rooms.js';
export { Keyring, keyring, labelOf, isSealed, validLabel, KEYRING_GLOBAL, type KeySource, type KeyResolver, type KeysListener } from './keys.js';
export { Connector, clusterOf, SAME_CLUSTER, VERSION, type ConnectorApi, type ConnectorOptions, type Target } from './connector.js';
export { RemoteConnector, serve, PORT_PROTOCOL, HELLO_TIMEOUT_MS, PING_INTERVAL_MS, CHECK_TIMEOUT_MS, type PortLike, type LocksLike, type RemoteOptions } from './remote.js';
export { Channel, specOf, type AttachOptions, type PendingSocket, type TimedEmitter, type Link, type Sink, type MemberSpec, type Listener } from './channel.js';
export { Hub, Connection, SHARED_PROTOCOL, type HubOptions, type HubManager, type ManagerFactory } from './hub.js';
export { idbNodeStore } from './idb-store.js';
export { RealtimeConnection, PROTOCOL, STORE_KEY, MOVE_CONNECT_MS, MOVE_READY_MS, type RealtimeConnectionOptions } from './connection.js';
export { firstConnect, watchDirect, pendingReplies } from './direct-socket.js';
export { WatchSet, WATCH_BATCH_MS, WATCH_LINGER_MS, WATCH_LIMIT, type WatchChange, type WatchRequest, type WatchSetOptions } from './watch.js';
export {
    NodeCacheKeeper, localNodeStore, migrateTarget, migrateSpread, sameServer, hostOf, connectTimeout, pointAt, urlOf, listedNodes, aim, managerUrl,
    NODE_URL, PAUSE_MS, SERVER_CONNECT_TIMEOUT_MS, NODE_CONNECT_TIMEOUT_MS, FIRST_READ_WAIT_MS,
    type CachedNode, type NodeCache, type NodeStore, type MigrateRequest, type Aimable,
} from './node-cache.js';
