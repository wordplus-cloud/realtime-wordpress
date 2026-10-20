/**
 * The connector's SharedWorker (version 2 of the connection), built on its own to
 * dist/realtime-worker.js with socket.io-client inside. Every tab of
 * the site, and a product's own SharedWorker, uses its connections
 * through a port (remote.ts), so a browser holds one connection to a realtime
 * cluster for every product.
 *
 * Every plugin ships this file with the PHP loader (php/realtime.php),
 * which hands every page the newest copy's URL, so the tabs of a site all
 * reach one worker. The worker lives while a tab that started it does, and a
 * connection while a namespace is on it.
 */
import { Connector } from './connector.js';
import { idbNodeStore } from './idb-store.js';
import { type LocksLike, type PortLike, serve } from './remote.js';

const scope = globalThis as unknown as {
    onconnect: ((event: MessageEvent) => void) | null;
    navigator?: { locks?: LocksLike };
};

const store = idbNodeStore();
const connector = new Connector({ store: () => store });

scope.onconnect = (event: MessageEvent) => {
    for (const port of event.ports) serve(port as unknown as PortLike, connector, scope.navigator?.locks ?? null);
};
