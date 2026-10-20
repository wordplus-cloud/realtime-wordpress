import {useId} from "react";
import {__, _x} from "./i18n.ts";
import {DialogBox} from "./dialog.tsx";
import {usePlayer} from "./player.tsx";

// The player's keys, listed where a viewer asks for them (?): a dialog over the picture, as the player's other dialogs,
// which keeps the focus while open and gives it back as it closes. Only the keys this player answers here: no chat key
// without a chat to hide, no full screen or picture-in-picture where the browser has none.

export function ShortcutList(){
    const player = usePlayer();
    const labelId = useId();
    if( ! player.keysOpen ) return null;

    const close = () => player.setKeysOpen( false );
    const keys : [ string, string ][] = [
        [ 'M', _x( 'Mute or unmute', 'a keyboard shortcut', 'wordplus-stream' ) ],
        ...( player.volumeSettable ? [ [ '↑ ↓', _x( 'Volume up or down, on the picture', 'a keyboard shortcut', 'wordplus-stream' ) ] as [ string, string ] ] : [] ),
        ...( player.canFullscreen ? [ [ 'F', __( 'Full screen', 'wordplus-stream' ) ] as [ string, string ] ] : [] ),
        ...( player.chatToggles ? [ [ 'C', _x( 'Show or hide the chat', 'a keyboard shortcut', 'wordplus-stream' ) ] as [ string, string ] ] : [] ),
        ...( player.canPip ? [ [ 'P', __( 'Picture-in-picture', 'wordplus-stream' ) ] as [ string, string ] ] : [] ),
        [ 'I', __( 'Statistics', 'wordplus-stream' ) ],
        [ 'Esc', _x( 'Close a menu or a dialog', 'a keyboard shortcut', 'wordplus-stream' ) ],
        [ '?', _x( 'These keys', 'a keyboard shortcut: the list of them', 'wordplus-stream' ) ]
    ];

    return (
        <DialogBox
            labelId={ labelId }
            title={ _x( 'Keyboard shortcuts', 'of the player', 'wordplus-stream' ) }
            onCancel={ close }
            actions={ <button type="button" className="estream-button estream-button--primary" onClick={ close }>{ _x( 'Close', 'the statistics', 'wordplus-stream' ) }</button> }
        >
            <dl className="estream-keys">
                { keys.map( ( [ key, what ] ) => (
                    <div key={ key } className="estream-keys__row">
                        <dt><kbd>{ key }</kbd></dt>
                        <dd>{ what }</dd>
                    </div>
                ) ) }
            </dl>
        </DialogBox>
    );
}
