import {useEffect, useState} from "react";
import {sharedEmoji, type EmojiImage} from "./shared.ts";

// One emoji in the site's set where it has one (window.wordplusEmoji, the WordPlus SDK's), as the chat draws its emoji:
// a reaction on its button and rising over the picture. The device's own until the set's index has loaded, and where
// the site draws the device's own.
export function EmojiGlyph( props : { emoji : string } ){
    const emoji = sharedEmoji();
    const [ ready, setReady ] = useState( false );

    useEffect( () => {
        if( ! emoji || ready ) return;
        let current = true;
        void emoji.ready().then( ( ok ) => {
            if( current && ok ) setReady( true );
        } );
        return () => {
            current = false;
        };
    }, [ emoji, ready ] );

    const image = emoji && ready ? emoji.split( props.emoji ).find( ( part ) : part is EmojiImage => typeof part !== 'string' ) : undefined;

    return image
        ? <img className="estream-emoji-image" src={ image.src } alt={ props.emoji } draggable={ false } />
        : <>{ props.emoji }</>;
}
