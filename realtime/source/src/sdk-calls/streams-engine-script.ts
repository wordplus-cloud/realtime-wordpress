/**
 * The classic calls script's way to Easy Stream's engine: realtime-streams.min.js (window.wordplusRealtimeStreams),
 * loaded from `script` on a page's first stream, as the rooms script is loaded for a first group call. build-worker.mjs
 * puts this file in streams-engine.ts's place in realtime-calls.min.js, which can't split a module off.
 */
import type { StreamsEngine } from './streams-engine.js';

let loading: Promise<StreamsEngine> | null = null;

const ready = (): StreamsEngine | undefined => (globalThis as any).wordplusRealtimeStreams;

export function streamsEngine(script?: string): Promise<StreamsEngine> {
    const engine = ready();
    if (engine?.EasyStreamClient) return Promise.resolve(engine);
    if (loading) return loading;
    if (!script || typeof document === 'undefined') return Promise.reject(Object.assign(new Error('no_streams_script'), { code: 'no_streams_script' }));

    loading = new Promise<StreamsEngine>((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = script;
        tag.async = true;
        tag.onload = () => {
            const loaded = ready();
            if (loaded?.EasyStreamClient) resolve(loaded);
            else reject(Object.assign(new Error('streams_script_broken'), { code: 'streams_script_broken' }));
        };
        tag.onerror = () => {
            loading = null;
            reject(Object.assign(new Error('streams_script_failed'), { code: 'streams_script_failed' }));
        };
        document.head.appendChild(tag);
    });
    return loading;
}
