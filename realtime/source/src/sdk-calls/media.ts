/**
 * The mesh's room client: WordPlus Mesh's @wordplus/rtc-client, built as a script of its own
 * (`realtime-rooms.min.js`, window.WordPlusRTC) and loaded only when a page first needs a room: a group call,
 * or a call between two people that leaves the direct path. Every page that only places direct calls never loads it.
 */

/** The parts of the room client the kit uses, as loose as the library's own types would make them here. */
export interface LiveKit {
    Room: new (options?: Record<string, unknown>) => any;
    RoomEvent: Record<string, string>;
    Track: { Source: Record<string, string>; Kind: Record<string, string> };
    ConnectionState?: Record<string, string>;
    /** A simulcast layer's size, bitrate and frame rate. */
    VideoPreset?: new (width: number, height: number, maxBitrate: number, maxFramerate?: number) => unknown;
    /** Whether a server is the mesh's, which forwards H.265 (@wordplus/rtc-client 1.0.1 and later). */
    isMeshServer?: (serverUrl: string) => boolean;
    /** End-to-end encryption: the key a room's people share, and whether this browser can encrypt each frame. */
    ExternalE2EEKeyProvider?: new () => { setKey(key: string | ArrayBuffer): Promise<void> };
    isE2EESupported?: () => boolean;
}

let loading: Promise<LiveKit> | null = null;

// The room client's global: WordPlusRTC, or the one a rooms script built before @wordplus/rtc-client 1.0.0 set, when
// the newest copy on a site is still that old.
const roomClient = (): LiveKit | undefined => (globalThis as any).WordPlusRTC ?? (globalThis as any)['Livekit' + 'Client'];

/** The room client, from `url` the first time: the script the PHP package names in the page's settings (`rooms`). */
export function loadLiveKit(url: string | undefined): Promise<LiveKit> {
    const ready = roomClient();
    if (ready?.Room) return Promise.resolve(ready);
    if (loading) return loading;
    if (!url || typeof document === 'undefined') return Promise.reject(Object.assign(new Error('no_rooms_script'), { code: 'no_rooms_script' }));

    loading = new Promise<LiveKit>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => {
            const lib = roomClient();
            if (!lib?.Room) {
                reject(Object.assign(new Error('rooms_script_broken'), { code: 'rooms_script_broken' }));
                return;
            }
            // Its errors only, as Better Messages keeps it: its info and warnings are its own business.
            try {
                (lib as any).setLogLevel?.('error');
            } catch {
                /* an older client */
            }
            resolve(lib);
        };
        script.onerror = () => {
            loading = null;
            reject(Object.assign(new Error('rooms_script_failed'), { code: 'rooms_script_failed' }));
        };
        document.head.appendChild(script);
    });

    return loading;
}

/**
 * The room client's encryption worker, which encrypts and decrypts every frame: `realtime-rooms-e2ee.worker.js` beside the
 * rooms script unless the page names it. A worker starts only from the page's own address, so one served from another
 * (a site whose plugin files come from a CDN) starts from its text instead.
 */
export async function encryptionWorker(url: string | undefined, rooms: string | undefined): Promise<Worker> {
    const from = url || (rooms ? rooms.replace(/realtime-rooms\.min\.js/, 'realtime-rooms-e2ee.worker.js') : '');
    if (!from || from === rooms || typeof Worker === 'undefined') throw Object.assign(new Error('no_encryption_worker'), { code: 'no_encryption_worker' });

    const address = new URL(from, globalThis.location?.href);
    if (address.origin === globalThis.location?.origin) return new Worker(address.href);

    const res = await fetch(address.href, { credentials: 'omit' });
    if (!res.ok) throw Object.assign(new Error('no_encryption_worker'), { code: 'no_encryption_worker' });
    return new Worker(URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' })));
}

/** The kit's names for the sources a person sends, and LiveKit's. */
export type MediaSource = 'camera' | 'microphone' | 'screen_share' | 'screen_share_audio';

export function liveKitSource(lib: LiveKit, source: MediaSource): string {
    const sources = lib.Track.Source;
    return source === 'camera' ? sources.Camera : source === 'microphone' ? sources.Microphone : source === 'screen_share' ? sources.ScreenShare : sources.ScreenShareAudio;
}

export function kitSource(lib: LiveKit, source: string): MediaSource | null {
    const sources = lib.Track.Source;
    if (source === sources.Camera) return 'camera';
    if (source === sources.Microphone) return 'microphone';
    if (source === sources.ScreenShare) return 'screen_share';
    if (source === sources.ScreenShareAudio) return 'screen_share_audio';
    return null;
}

/** How long a join may wait for a place on the mesh: a full mesh adds a server within minutes. */
export const MESH_JOIN_BUDGET_MS = 5 * 60_000;
