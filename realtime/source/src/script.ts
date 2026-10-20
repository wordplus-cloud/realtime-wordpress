/**
 * The page script every WordPlus plugin shares (dist/realtime.min.js): this package as one classic
 * script, which the WordPlus SDK carries in every plugin and registers from the site's newest copy
 * (PHP's `wordplus_realtime_script()`, the handle a product's script depends on). A product's code reads
 * the package from `window.wordplusRealtimeClient` instead of bundling a copy of its own, so a new
 * version reaches every product on the site with the SDK, with no product rebuilt.
 *
 * Loading it registers its copy in the page's registry, as a bundled copy registers when its product
 * starts, so the newest copy on the page runs the connector even beside a product that still bundles
 * an older one.
 */
import * as client from './index.js';
import { register } from './registry.js';
import { rooms, type Rooms, type RoomsOptions } from './rooms.js';

/** The package on the page, for a product's code. */
export const GLOBAL = 'wordplusRealtimeClient';

let shared: Rooms | null = null;

/**
 * The page's rooms, made once from the server package's settings (`window.wordplusRealtimeConfig`, wordplus/realtime's
 * script()): what every plugin's code and the call screen share on a WordPress page, so the page is one tab on the
 * connection and a call rings once. Null on a page without the settings (a site without credentials).
 */
export function page( config?: RoomsOptions ): Rooms | null {
    if ( shared ) return shared;
    const settings = config ?? ( ( globalThis as Record<string, unknown> ).wordplusRealtimeConfig as RoomsOptions | undefined );
    if ( ! settings?.site ) return null;
    shared = rooms( settings );
    return shared;
}

register();
( globalThis as Record<string, unknown> )[ GLOBAL ] = { ...client, page };
