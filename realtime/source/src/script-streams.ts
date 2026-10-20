/**
 * The streams script (dist/realtime-streams.min.js): Easy Stream's engine for the classic calls script, as
 * `window.wordplusRealtimeStreams`, loaded on a page's first stream. Its connector is the page script's
 * (`window.wordplusRealtimeClient`): build-worker.mjs points the engine's `@wordplus/realtime-client` there, so the
 * stream's chat rides the page's one connection.
 */
import * as streams from './streams/index.js';

/** Easy Stream's engine on the page. */
export const GLOBAL = 'wordplusRealtimeStreams';

( globalThis as Record<string, unknown> )[ GLOBAL ] = streams;
