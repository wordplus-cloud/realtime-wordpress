/**
 * Easy Stream's engine (../streams), fetched on a page's first stream: an app's bundler splits it off, so a page with
 * calls alone never carries it. The classic calls script (realtime-calls.min.js) has this file's other version in its
 * place (streams-engine-script.ts, which build-worker.mjs puts there), loading realtime-streams.min.js.
 */
import type { EasyStreamClient } from '../streams/client.js';

export type StreamsEngine = { EasyStreamClient: typeof EasyStreamClient };

export function streamsEngine(_script?: string): Promise<StreamsEngine> {
    return import('../streams/client.js');
}
