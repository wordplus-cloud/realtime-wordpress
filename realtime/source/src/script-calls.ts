/**
 * The calls script (dist/realtime-calls.min.js): calls and group calls for any plugin, as
 * `window.wordplusRealtimeCalls`, beside the page script's `window.wordplusRealtimeClient`, whose `rooms()` it
 * rides. The PHP package's `calls_script()` registers it, depending on the page script.
 */
import * as calls from './sdk-calls/index.js';
import { VERSION } from './version.js';

/** The calls on the page, for a plugin's code. */
export const GLOBAL = 'wordplusRealtimeCalls';

( globalThis as Record<string, unknown> )[ GLOBAL ] = { ...calls, VERSION };
