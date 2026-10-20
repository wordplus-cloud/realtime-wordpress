/**
 * The keys that open what a site sends through the realtime server (the PHP package's keys(), its
 * class-realtime-keys.php): the server carries every sealed value without being able to read or change it,
 * and the browser opens it here. Every plugin on a page shares one keyring (keyring()), so what one site's
 * plugin seals another's code opens.
 *
 * - **A sealed value** is `{label}:1.{base64url( nonce + ciphertext )}`: XChaCha20-Poly1305 with a 24-byte
 *   nonce and the label as associated data. A value changed on the way doesn't open.
 * - **A key** comes as the site hands it out, `{label}:{64 hex characters}`, named by its label:
 *   `d:{day}` the day's (the users' directory), `u:{id}:{generation}` a user's own, `ch:{channel}:{generation}`
 *   a channel's, or a plugin's own kind (Better Messages uses `c:{thread}:{generation}`).
 * - **Keys come from the site only:** the page's settings, the keys route, a channel's grant, or a key sealed
 *   with one held already. Never from what the realtime server sends: a key it planted would open what the
 *   browser seals next.
 *
 * No DOM and nothing done on import: a page, a SharedWorker and an app each run it, each setting how it asks
 * for a key it misses (setResolver(): the site's route from a page, a tab from a worker).
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

/** The page's keyring, shared by every copy of this package on it. */
export const KEYRING_GLOBAL = 'wordplusRealtimeKeyring';

const LABEL = '[a-z][a-z0-9]{0,15}:[A-Za-z0-9_\\-=@,.;:]{1,240}';
const SEALED = new RegExp('^(' + LABEL + '):1\\.([A-Za-z0-9_-]+)$');
const ENTRY = new RegExp('^(' + LABEL + '):([0-9a-f]{64})$');
const LABEL_ONLY = new RegExp('^' + LABEL + '$');
const NONCE = 24;
const TAG = 16;
/** A label asked for in vain isn't asked for again for this long. */
const REFUSED_MS = 60_000;
/** How deep missing() and the walks look into a payload. */
const DEPTH = 8;

/** Where a key came from: what a listener tells apart, so a key doesn't go back where it came from. */
export type KeySource = 'page' | 'site' | 'worker' | 'event' | (string & {});
/** Asks for keys the keyring doesn't hold and adds those it gets; resolves either way. */
export type KeyResolver = (labels: string[]) => Promise<void>;
export type KeysListener = (entries: string[], source: KeySource) => void;

export function validLabel(label: unknown): label is string {
    return typeof label === 'string' && label.length <= 256 && LABEL_ONLY.test(label);
}

/** The label of the key that opens a sealed value, or null when it is none. */
export function labelOf(value: unknown): string | null {
    if (typeof value !== 'string' || value.length < 60) return null;
    const match = SEALED.exec(value);
    return match ? match[1] : null;
}

export function isSealed(value: unknown): value is string {
    return labelOf(value) !== null;
}

export class Keyring {
    /** What a newer copy of the package checks before it uses a keyring an older one made. */
    readonly version = 1;
    private readonly keys = new Map<string, Uint8Array>();
    private readonly listeners = new Set<KeysListener>();
    private resolver: KeyResolver | null = null;
    private readonly inFlight = new Map<string, Promise<void>>();
    private readonly refused = new Map<string, number>();
    private batch: { labels: Set<string>; promise: Promise<void> } | null = null;

    /**
     * Keys as the site hands them out, one or a list. Returns those the keyring didn't hold, after telling the
     * listeners about them.
     */
    add(entries: unknown, source: KeySource = 'site'): string[] {
        const added: string[] = [];
        for (const entry of Array.isArray(entries) ? entries : [entries]) {
            if (typeof entry !== 'string') continue;
            const match = ENTRY.exec(entry);
            if (!match || (this.keys.has(match[1]) && toHex(this.keys.get(match[1])!) === match[2])) continue;
            this.keys.set(match[1], fromHex(match[2]));
            this.refused.delete(match[1]);
            added.push(entry);
        }
        if (added.length > 0) {
            for (const listener of this.listeners) {
                try {
                    listener(added, source);
                } catch {
                    /* one listener must not stop the others */
                }
            }
        }
        return added;
    }

    has(label: string): boolean {
        return this.keys.has(label);
    }

    /** Every key held, as entries: what a worker is handed when a tab connects to it. */
    entries(): string[] {
        return [...this.keys].map(([label, key]) => label + ':' + toHex(key));
    }

    onAdded(listener: KeysListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * A sealed value opened, or null when no key held opens it. Anything not sealed comes back as it is: a site
     * that doesn't seal, a REST answer's plain text.
     */
    open(value: string): string | null {
        const match = typeof value === 'string' ? SEALED.exec(value) : null;
        if (!match) return value;
        const key = this.keys.get(match[1]);
        if (!key) return null;
        try {
            const bytes = fromBase64url(match[2]);
            if (bytes.length < NONCE + TAG) return null;
            return utf8Decode(xchacha20poly1305(key, bytes.subarray(0, NONCE), utf8Encode(match[1])).decrypt(bytes.subarray(NONCE)));
        } catch {
            return null;
        }
    }

    /** A sealed value's JSON, parsed; a value not sealed comes back as it is, and one that doesn't open as undefined. */
    openJson(value: unknown): unknown {
        if (!isSealed(value)) return value;
        const plain = this.open(value);
        if (plain === null) return undefined;
        try {
            return JSON.parse(plain);
        } catch {
            return undefined;
        }
    }

    /** A value sealed with a label's key, or null when the keyring doesn't hold it. */
    seal(value: string, label: string): string | null {
        const key = this.keys.get(label);
        if (!key) return null;
        try {
            const nonce = randomBytes(NONCE);
            const sealed = xchacha20poly1305(key, nonce, utf8Encode(label)).encrypt(utf8Encode(String(value)));
            const bytes = new Uint8Array(NONCE + sealed.length);
            bytes.set(nonce);
            bytes.set(sealed, NONCE);
            return label + ':1.' + toBase64url(bytes);
        } catch {
            return null;
        }
    }

    sealJson(data: unknown, label: string): string | null {
        return this.seal(JSON.stringify(data === undefined ? null : data), label);
    }

    /**
     * The newest key held of one thing, by its label up to the generation (`c:12:`, `u:5:`, `ch:private-a:`):
     * what to seal with. Null when none is held.
     */
    newest(prefix: string): string | null {
        let best = 0;
        for (const label of this.keys.keys()) {
            if (!label.startsWith(prefix)) continue;
            const rest = label.slice(prefix.length);
            if (/^\d{1,9}$/.test(rest) && Number(rest) > best) best = Number(rest);
        }
        return best > 0 ? prefix + best : null;
    }

    /** Today's day key (UTC), or the newest held when the keyring has none for today. */
    dayLabel(now: number = Date.now()): string | null {
        const today = 'd:' + Math.floor(now / 86_400_000);
        if (this.keys.has(today)) return today;
        let best = -1;
        for (const label of this.keys.keys()) {
            if (/^d:\d{1,9}$/.test(label) && Number(label.slice(2)) > best) best = Number(label.slice(2));
        }
        return best >= 0 ? 'd:' + best : null;
    }

    /** The labels of the sealed values in a payload whose keys the keyring doesn't hold. */
    missing(value: unknown): string[] {
        const missing = new Set<string>();
        const visit = (item: unknown): void => {
            const label = labelOf(item);
            if (label && !this.keys.has(label)) missing.add(label);
        };
        visit(value);
        walk(value, 0, visit);
        return [...missing];
    }

    /** How a context asks for keys it misses: the site's route from a page, a tab from a worker. */
    setResolver(resolver: KeyResolver | null): void {
        this.resolver = resolver;
    }

    hasResolver(): boolean {
        return this.resolver !== null;
    }

    /**
     * Makes sure the keyring holds these keys, asking the resolver once for those it doesn't. Labels asked for in
     * the same moment go in one request, one already asked for waits for that request, and one asked for in vain
     * isn't asked for again for a minute. Resolves either way: a value whose key never comes stays sealed.
     */
    ensure(labels: Iterable<string>): Promise<void> {
        const now = Date.now();
        const waits: Promise<void>[] = [];

        for (const label of labels) {
            if (this.keys.has(label) || !validLabel(label)) continue;
            const pending = this.inFlight.get(label);
            if (pending) {
                waits.push(pending);
                continue;
            }
            if ((this.refused.get(label) ?? 0) > now || !this.resolver) continue;

            if (!this.batch) {
                const batch: { labels: Set<string>; promise: Promise<void> } = { labels: new Set(), promise: Promise.resolve() };
                batch.promise = Promise.resolve().then(async () => {
                    if (this.batch === batch) this.batch = null;
                    const asked = [...batch.labels];
                    try {
                        await this.resolver?.(asked);
                    } catch {
                        /* the values stay sealed */
                    }
                    for (const one of asked) {
                        this.inFlight.delete(one);
                        if (!this.keys.has(one)) this.refused.set(one, Date.now() + REFUSED_MS);
                    }
                });
                this.batch = batch;
            }
            this.batch.labels.add(label);
            this.inFlight.set(label, this.batch.promise);
            waits.push(this.batch.promise);
        }

        return waits.length === 0 ? Promise.resolve() : Promise.all(waits).then(() => undefined);
    }

    /** Forgets every key: another user signing in, a local database reset. */
    clear(): void {
        this.keys.clear();
        this.refused.clear();
    }
}

/**
 * The page's keyring, one for every plugin and every copy of this package on it: the first copy makes it, and the
 * others take it while it is one they know (its `version`). In a worker, the worker's.
 */
export function keyring(): Keyring {
    const scope = globalThis as Record<string, unknown>;
    const held = scope[KEYRING_GLOBAL] as Keyring | undefined;
    if (held && typeof held === 'object' && Number((held as { version?: unknown }).version) >= 1) return held;
    const made = new Keyring();
    scope[KEYRING_GLOBAL] = made;
    return made;
}

/** Calls `visit` with every value in a payload, `DEPTH` levels deep. */
export function walk(value: unknown, depth: number, visit: (item: unknown, key: string) => void): void {
    if (depth > DEPTH || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        for (const item of value) {
            visit(item, '');
            walk(item, depth + 1, visit);
        }
        return;
    }
    for (const key of Object.keys(value as Record<string, unknown>)) {
        const item = (value as Record<string, unknown>)[key];
        visit(item, key);
        walk(item, depth + 1, visit);
    }
}

function randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    const crypto = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
    if (!crypto?.getRandomValues) throw new Error('no_random');
    crypto.getRandomValues(bytes);
    return bytes;
}

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
    let out = '';
    for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15];
    return out;
}

function fromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64url(bytes: Uint8Array): string {
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < bytes.length) {
        const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
        out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '');
    }
    return out;
}

function fromBase64url(text: string): Uint8Array {
    if (text.length % 4 === 1) throw new Error('bad_base64');
    const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
    let bits = 0;
    let value = 0;
    let at = 0;
    for (const char of text) {
        const n = B64.indexOf(char);
        if (n < 0) throw new Error('bad_base64');
        value = (value << 6) | n;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes[at++] = (value >> bits) & 255;
        }
    }
    return bytes.subarray(0, at);
}

function utf8Encode(text: string): Uint8Array {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    const out: number[] = [];
    for (const char of text) {
        const c = char.codePointAt(0)!;
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
}

function utf8Decode(bytes: Uint8Array): string {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; ) {
        const b = bytes[i];
        const size = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
        let c = size === 1 ? b : b & (0xff >> (size + 1));
        for (let j = 1; j < size; j++) c = (c << 6) | (bytes[i + j] & 63);
        out += String.fromCodePoint(c);
        i += size;
    }
    return out;
}
