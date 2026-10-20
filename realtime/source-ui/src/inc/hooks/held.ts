import { useEffect, useState } from "react";

/** How long a picture stays paused for the viewer's download before the call screen says so. */
export const PAUSED_NOTICE_MS = 2000;

/**
 * Whether `on` has held for `ms`, false again the moment it goes off: a notice for a state that often ends by itself
 * within a moment (a video the media server paused for the viewer's download, until its guard has tried a smaller
 * picture) waits this long, so it doesn't flash.
 */
export default function useHeld( on: boolean, ms: number ): boolean {
    const [ held, setHeld ] = useState( false );

    useEffect( () => {
        if( ! on ){
            setHeld( false );
            return;
        }

        const timer = window.setTimeout( () => setHeld( true ), ms );
        return () => window.clearTimeout( timer );
    }, [ on, ms ] );

    return on && held;
}
