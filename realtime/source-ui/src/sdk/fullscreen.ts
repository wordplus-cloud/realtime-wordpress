import { useEffect, useState, type MutableRefObject } from "react";

/** The call's own element full screen, as Better Messages' call container makes its wrapper. */
export function useFullScreen( wrapper: MutableRefObject<HTMLDivElement | null> ) {
    const available = typeof document !== 'undefined' && !! document.fullscreenEnabled;
    const [ enabled, setEnabled ] = useState( false );

    useEffect( () => {
        if ( ! available ) return;
        const changed = () => setEnabled( document.fullscreenElement !== null );
        document.addEventListener( 'fullscreenchange', changed );
        return () => document.removeEventListener( 'fullscreenchange', changed );
    }, [ available ] );

    return {
        fullScreenAvailable: available,
        fullScreenEnabled: enabled,
        setFullScreenEnabled: setEnabled,
        enableFullScreen: () => void wrapper.current?.requestFullscreen?.().catch( () => {} ),
        disableFullScreen: () => {
            if ( document.fullscreenElement ) void document.exitFullscreen().catch( () => {} );
        },
    };
}
