import {forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent} from "react";
import type {SharedEmoji} from "./shared.ts";

// The chat's field where the site draws emoji in a set (the WordPlus SDK's renderer), as Better Messages' composer is:
// one line that shows every emoji as the set's image, whether picked, typed, dropped in by the phone's keyboard or
// pasted, and gives the text back with each image as its emoji, which is what is sent. WordPress's emoji script stays
// out of it (wp-exclude-emoji on the theme root, and the SDK's guard); one of its pictures that gets in anyway counts
// as its emoji too. An emoji the set doesn't have stays the device's.

export interface EmojiFieldHandle {
    // An emoji at the caret, as the picker gives it.
    insert( emoji : string ) : void;
    focus() : void;
}

interface EmojiFieldProps {
    value : string;
    onChange : ( text : string ) => void;
    onSubmit : () => void;
    placeholder : string;
    maxLength : number;
    emoji : SharedEmoji;
}

// The field's text: each emoji image its alt (ours, or WordPress's <img class="emoji">), on one line.
export function fieldText( root : Node ) : string {
    let text = '';

    root.childNodes.forEach( ( node ) => {
        if( node.nodeType === 3 ) text += ( node as Text ).data;
        else if( node.nodeName === 'IMG' ) text += ( node as HTMLImageElement ).alt;
        else if( node.nodeName !== 'BR' ) text += fieldText( node );
    } );

    return text.replace( /[\r\n]+/g, ' ' );
}

function emojiImage( emoji : string, src : string ) : HTMLImageElement {
    const img = document.createElement( 'img' );
    img.className = 'estream-emoji-image';
    img.src = src;
    img.alt = emoji;
    img.draggable = false;
    return img;
}

// The text as the field shows it: its emoji the set's images once the set's index has loaded, the rest text.
function draw( root : HTMLElement, text : string, emoji : SharedEmoji, ready : boolean ){
    if( text === '' ){
        root.replaceChildren();
        return;
    }

    const parts = ready && emoji.has( text ) ? emoji.split( text ) : [ text ];
    root.replaceChildren( ...parts.map( ( part ) => typeof part === 'string' ? document.createTextNode( part ) : emojiImage( part.emoji, part.src ) ) );
}

// Where the caret is, in the field's text, or null when it isn't in the field.
function caretAt( root : HTMLElement ) : number | null {
    const selection = root.ownerDocument.getSelection();
    if( ! selection || selection.rangeCount === 0 ) return null;

    const range = selection.getRangeAt( 0 );
    if( ! root.contains( range.endContainer ) ) return null;

    const before = root.ownerDocument.createRange();
    before.selectNodeContents( root );
    before.setEnd( range.endContainer, range.endOffset );

    return fieldText( before.cloneContents() ).length;
}

// The caret put back at a place in the field's text: in a text there, or after an image it would fall inside.
function placeCaret( root : HTMLElement, at : number ){
    const selection = root.ownerDocument.getSelection();
    if( ! selection ) return;

    const range = root.ownerDocument.createRange();
    let left = at;
    let placed = false;

    for( const node of Array.from( root.childNodes ) ){
        const length = node.nodeType === 3 ? ( node as Text ).data.length : node.nodeName === 'IMG' ? ( node as HTMLImageElement ).alt.length : fieldText( node ).length;

        if( left <= length ){
            if( node.nodeType === 3 ) range.setStart( node, left );
            else if( left === 0 ) range.setStartBefore( node );
            else range.setStartAfter( node );
            placed = true;
            break;
        }

        left -= length;
    }

    if( ! placed ){
        range.selectNodeContents( root );
        range.collapse( false );
    } else {
        range.collapse( true );
    }

    selection.removeAllRanges();
    selection.addRange( range );
}

// Whether a text in the field still has an emoji as characters, which the set may draw.
function hasLooseEmoji( root : HTMLElement, emoji : SharedEmoji ) : boolean {
    return Array.from( root.childNodes ).some( ( node ) => node.nodeType === 3 && emoji.has( ( node as Text ).data ) );
}

export const EmojiField = forwardRef<EmojiFieldHandle, EmojiFieldProps>( function EmojiField( props, ref ){
    const box = useRef<HTMLDivElement>( null );
    // The text the field last gave, to tell a change of the value from outside (cleared once sent) from its own.
    const last = useRef( props.value );
    const composing = useRef( false );
    // Where the caret was last in the field: the picker's emoji goes there.
    const saved = useRef<number | null>( null );
    const ready = useRef( false );
    const latest = useRef( props );
    latest.current = props;

    // The text as it is now: kept to the limit, its emoji drawn, the caret where it was.
    const sync = () => {
        const root = box.current;
        if( ! root || composing.current ) return;

        const { emoji, maxLength, onChange } = latest.current;
        const text = fieldText( root );

        if( text.length > maxLength ){
            const at = Math.min( caretAt( root ) ?? last.current.length, last.current.length );
            draw( root, last.current, emoji, ready.current );
            placeCaret( root, at );
            return;
        }

        if( ready.current && hasLooseEmoji( root, emoji ) ){
            const at = caretAt( root );
            draw( root, text, emoji, true );
            if( at !== null ) placeCaret( root, at );
        } else if( text === '' && root.childNodes.length > 0 ){
            // A browser leaves a <br> behind: the placeholder shows only in an empty field.
            root.replaceChildren();
        }

        // The set's index, the first time an emoji comes; the field draws it once it has loaded.
        if( ! ready.current && emoji.has( text ) ){
            void emoji.ready().then( ( ok ) => {
                if( ! ok || ready.current ) return;
                ready.current = true;
                sync();
            } );
        }

        if( text !== last.current ){
            last.current = text;
            onChange( text );
        }
    };

    // A value from outside (the field cleared once its message is sent).
    useLayoutEffect( () => {
        const root = box.current;
        if( ! root || props.value === last.current ) return;
        last.current = props.value;
        saved.current = null;
        draw( root, props.value, props.emoji, ready.current );
        if( root.ownerDocument.activeElement === root ) placeCaret( root, props.value.length );
    }, [ props.value, props.emoji ] );

    // A field shown again with text in it (as when the player goes full screen) draws it at once.
    useEffect( () => {
        const root = box.current;
        if( root && props.value ) draw( root, props.value, props.emoji, ready.current );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [] );

    // Where the caret is in the field, as it moves: the picker's emoji goes there, though the picker has the focus
    // by then and the page's selection is elsewhere.
    useEffect( () => {
        const root = box.current;
        if( ! root ) return;
        const doc = root.ownerDocument;
        const follow = () => {
            if( doc.activeElement !== root ) return;
            const at = caretAt( root );
            if( at !== null ) saved.current = at;
        };
        doc.addEventListener( 'selectionchange', follow );
        return () => doc.removeEventListener( 'selectionchange', follow );
    }, [] );

    // Text at the caret, in place of what is selected: where the caret is when the field has the focus (a paste), or
    // where it was when it lost it (the picker took it).
    const insertText = ( text : string ) => {
        const root = box.current;
        if( ! root ) return;

        const current = fieldText( root );
        const doc = root.ownerDocument;
        const selection = doc.getSelection();
        let from = saved.current ?? current.length;
        let to = from;

        if( doc.activeElement === root && selection && selection.rangeCount > 0 && root.contains( selection.getRangeAt( 0 ).startContainer ) ){
            const range = selection.getRangeAt( 0 );
            const start = doc.createRange();
            start.selectNodeContents( root );
            start.setEnd( range.startContainer, range.startOffset );
            from = fieldText( start.cloneContents() ).length;
            to = caretAt( root ) ?? from;
        }

        const next = current.slice( 0, from ) + text + current.slice( to );
        if( next.length > latest.current.maxLength ) return;

        root.focus();
        draw( root, next, latest.current.emoji, ready.current );
        placeCaret( root, from + text.length );
        saved.current = null;
        sync();
    };

    useImperativeHandle( ref, () => ( {
        insert: ( emoji : string ) => insertText( emoji ),
        focus: () => box.current?.focus()
    } ) );

    const onKeyDown = ( e : KeyboardEvent<HTMLDivElement> ) => {
        if( e.key === 'Enter' && ! e.nativeEvent.isComposing ){
            e.preventDefault();
            latest.current.onSubmit();
        }
    };

    // Text only, on one line, wherever it is copied from.
    const onPaste = ( e : ClipboardEvent<HTMLDivElement> ) => {
        e.preventDefault();
        const text = e.clipboardData.getData( 'text/plain' ).replace( /\s*[\r\n]+\s*/g, ' ' );
        if( text ) insertText( text );
    };

    // What is copied or cut is the text, each image as its emoji.
    const onCopy = ( e : ClipboardEvent<HTMLDivElement>, cut : boolean ) => {
        const selection = box.current?.ownerDocument.getSelection();
        if( ! selection || selection.rangeCount === 0 || selection.isCollapsed || ! box.current!.contains( selection.getRangeAt( 0 ).commonAncestorContainer ) ) return;

        e.preventDefault();
        e.clipboardData.setData( 'text/plain', fieldText( selection.getRangeAt( 0 ).cloneContents() ) );
        if( cut ) insertText( '' );
    };

    return (
        <div
            ref={ box }
            className="estream-input estream-chat__editable"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="false"
            aria-label={ props.placeholder }
            data-placeholder={ props.placeholder }
            spellCheck
            onInput={ sync }
            onKeyDown={ onKeyDown }
            onPaste={ onPaste }
            onCopy={ ( e ) => onCopy( e, false ) }
            onCut={ ( e ) => onCopy( e, true ) }
            onDrop={ ( e ) => e.preventDefault() }
            onCompositionStart={ () => { composing.current = true; } }
            onCompositionEnd={ () => { composing.current = false; sync(); } }
        />
    );
} );
