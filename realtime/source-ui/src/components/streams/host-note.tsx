import {__} from "./i18n.ts";
import {useStream} from "./context.tsx";
import {Icon} from "./icons.tsx";
import {usePlayer} from "./player.tsx";

// A host on a page without the studio: where they go live (the WordPress plugin's admin studio). The page gives the
// studio's address to hosts alone, so the note is there from the first paint, not pushing the player down once the
// cloud says who this is; it goes only if the cloud says otherwise. `hidden`: the page has a studio of its own.
export function HostNote( props : { hidden? : boolean } ){
    const state = useStream();
    const player = usePlayer();

    if( props.hidden || ! player.studioUrl || ( state.you && state.you.role !== 'host' ) ) return null;

    const live = state.stream?.state === 'live';
    const label = live ? __( 'Open the studio', 'wordplus-stream' ) : __( 'Go live in the studio', 'wordplus-stream' );

    return (
        <div className="estream-hostnote">
            <Icon name="broadcast" />
            <span className="estream-hostnote__text">{ live ? __( 'You are live.', 'wordplus-stream' ) : __( 'You host this stream.', 'wordplus-stream' ) }</span>
            { player.preview
                ? <span className="estream-button estream-button--small estream-button--primary">{ label }</span>
                : <a className="estream-button estream-button--small estream-button--primary" href={ player.studioUrl }>{ label }</a> }
        </div>
    );
}
