import React, { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import IconButton from "../../primitives/icon-button.tsx";
import { isFirefox, isMobile } from "../../inc/functions/browser-info.ts";
import { __, _nx, _x, sprintf } from "../../inc/globals.ts";

// The composer's row, Better Messages' (its composer.tsx): the attachment button, the editor, the counter, the
// formatting and picker buttons, the camera, and the accent slot that is the microphone with nothing to send and Send
// once there is. A view: whoever draws it owns the editor's content and what each button does. Better Messages keeps
// its editor (mentions, formatting, drafts, emoji images), its recorders, its attachments and its pickers; an app's
// Chat (src/sdk/chat.tsx) types plain text into it.
//
// Styles: styles/chat/_composer.scss.

/** The counter shows from 60% of the length limit. */
const COUNTER_THRESHOLD = 0.6;

export interface ComposerRowProps {
    hostRef        : React.RefObject<HTMLDivElement | null>;
    /** The editable element itself, for a host that reads or sets its content. */
    editableRef?   : React.RefObject<HTMLDivElement | null>;
    onInput        : ( e: React.FormEvent<HTMLDivElement> ) => void;
    onCompositionEnd? : ( e: React.CompositionEvent<HTMLDivElement> ) => void;
    // The native beforeinput, for its inputType: React's onBeforeInput is a polyfill built on other events and does
    // not carry one.
    onBeforeInput? : ( e: InputEvent ) => void;
    placeholder    : string;
    disabled?      : boolean;
    maxLength      : number;
    charCount      : number;
    onKeyDown      : ( e: KeyboardEvent<HTMLDivElement> ) => void;
    onPaste?       : ( e: React.ClipboardEvent<HTMLDivElement> ) => void;
    onSend         : () => void;
    canSend        : boolean;
    hasContent     : boolean;
    sending?       : boolean;
    isEdit?        : boolean;
    limited        : boolean;
    attachCount?   : number;
    canRecordVoice : boolean;
    canRecordVideo : boolean;
    onStartVoice?  : () => void;
    onStartVideo?  : () => void;
    onAttachClick? : ( e: React.MouseEvent ) => void;
    // Absent when no picker is available at all: the button is then not drawn.
    onEmojiClick?  : ( e: React.MouseEvent ) => void;
    pickerLabel?   : string;
    /** A points balance beside the buttons (Better Messages' myCRED and GamiPress), the host's. */
    points?        : ReactNode;
    afterButtonHtml? : string;
    // Present when the formatting bar lives behind a button of its own.
    formatToggle?  : { open: boolean; onToggle: () => void };
}

export function ComposerRow( {
    hostRef,
    editableRef: givenEditableRef,
    onInput,
    onCompositionEnd,
    onBeforeInput,
    placeholder,
    disabled,
    maxLength,
    charCount,
    onKeyDown,
    onPaste,
    onSend,
    canSend,
    hasContent,
    sending,
    isEdit,
    limited,
    attachCount = 0,
    canRecordVoice,
    canRecordVideo,
    onStartVoice,
    onStartVideo,
    onAttachClick,
    onEmojiClick,
    pickerLabel,
    points,
    afterButtonHtml,
    formatToggle,
}: ComposerRowProps ) {
    const ownEditableRef = useRef<HTMLDivElement | null>( null );
    const editableRef = givenEditableRef ?? ownEditableRef;
    const beforeInputRef = useRef( onBeforeInput );
    beforeInputRef.current = onBeforeInput;
    useEffect( () => {
        const el = editableRef.current;
        if ( ! el ) return;
        const listener = ( e: Event ) => beforeInputRef.current?.( e as InputEvent );
        el.addEventListener( "beforeinput", listener );
        return () => el.removeEventListener( "beforeinput", listener );
    }, [] );
    // Integrations key their mobile layout off this body class: while the on-screen keyboard is up, FluentCommunity
    // hides its bottom nav and hands the messenger that space. The teardown matters as much as the handlers:
    // unmounting while focused fires no blur, and the page would stay in the keyboard layout with its nav gone.
    //
    // A blur gives the class up a task later, not in the blur itself. A tap on one of this row's buttons takes the
    // focus at its press, and the browser hit-tests the release at the same point in the same task: dropped there and
    // then, the class brought FluentCommunity's nav back and gave an installed app's composer back its bottom band, so
    // the button had moved off the finger and the click went to whatever was under it. The first tap on Send only
    // folded the keyboard (ticket 10500). The class stays while the focus is in any composer's editor, the next one
    // included.
    const unfocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>( undefined );
    useEffect( () => () => {
        clearTimeout( unfocusTimer.current );
        document.body.classList.remove( "bm-reply-area-focused" );
    }, [] );
    const onEditableFocus = () => {
        clearTimeout( unfocusTimer.current );
        document.body.classList.add( "bm-reply-area-focused" );
    };
    const onEditableBlur = () => {
        clearTimeout( unfocusTimer.current );
        unfocusTimer.current = setTimeout( () => {
            const active = document.activeElement;
            if ( document.hasFocus() && active instanceof HTMLElement && active.classList.contains( "bm-composer__editable" ) ) return;
            document.body.classList.remove( "bm-reply-area-focused" );
        }, 0 );
    };
    // Firefox leaves the caret of a click past a mention inside the chip, where nothing can be typed, and at the end
    // of a field that ends in one every click there lands that way: the caret moves to just after the chip.
    const onEditableClick = () => {
        if ( ! isFirefox() ) return;
        const sel = window.getSelection();
        const node = sel && sel.isCollapsed ? sel.anchorNode : null;
        const chip = ( node instanceof Element ? node : node?.parentElement )?.closest( ".bm-inline-mention" );
        if ( ! sel || ! chip || ! editableRef.current?.contains( chip ) ) return;
        const range = document.createRange();
        range.setStartAfter( chip );
        range.collapse( true );
        sel.removeAllRanges();
        sel.addRange( range );
    };
    const showCounter = limited && charCount / maxLength >= COUNTER_THRESHOLD;
    const counterWarn = limited && charCount > maxLength * 0.9;
    const overLimit = limited && charCount > maxLength;
    const attachLabel = attachCount > 0
        ? sprintf(
            _nx(
                "%s attachment added, click to add more attachments",
                "%s attachments added, click to add more attachments",
                attachCount,
                "\"Add attachment\" button tooltip with added files",
                "bp-better-messages",
            ),
            attachCount,
        )
        : _x( "Add attachment", "\"Add attachment\" button tooltip", "bp-better-messages" );

    return (
        <div className="bm-composer__row" data-edit={ isEdit ? 1 : undefined }>
            { onAttachClick && (
                <div className="bm-composer__attach-wrap">
                    { /* A paperclip, as 2.0's. keepFocus: the press opens a menu about the editor, so it must not take
                         the editor's caret, which on a phone is the on-screen keyboard. */ }
                    <IconButton icon="paperclip" label={ attachLabel } size={ 18 } keepFocus
                                onClick={ onAttachClick } />
                    { attachCount > 0 && (
                        <span className="bm-composer__attach-badge">{ attachCount }</span>
                    ) }
                </div>
            ) }

            { /* 2.0's bm-editor DOM shape: wrapper + div.bm-editor-content. */ }
            <div ref={ hostRef } className="bm-editor bm-composer__editor">
                <div
                    ref={ editableRef }
                    className="bm-editor-content bm-composer__editable notranslate wp-exclude-emoji"
                    { ...( { placeholder } as Record<string, string> ) }
                    contentEditable={ ! disabled }
                    suppressContentEditableWarning
                    data-no-translation={ true }
                    onInput={ onInput }
                    onCompositionEnd={ onCompositionEnd }
                    onKeyDown={ onKeyDown }
                    onPaste={ onPaste }
                    onClick={ onEditableClick }
                    onFocus={ onEditableFocus }
                    onBlur={ onEditableBlur }
                />
            </div>

            { showCounter && (
                <span className="bm-composer__counter" data-warn={ counterWarn ? 1 : undefined }>
                    { charCount }/{ maxLength }
                </span>
            ) }

            { points && (
                <span className="bm-composer__points">{ points }</span>
            ) }

            { /* keepFocus: the bar it opens acts on the editor's selection. */ }
            { formatToggle && (
                <IconButton icon="textFormat" className="bm-composer__format"
                            label={ formatToggle.open
                                ? _x( "Hide formatting", "Composer formatting button tooltip", "bp-better-messages" )
                                : _x( "Formatting", "Composer formatting button tooltip", "bp-better-messages" ) }
                            size={ 18 } keepFocus active={ formatToggle.open }
                            onClick={ formatToggle.onToggle } />
            ) }

            { /* keepFocus on a computer, as 2.0's smile button had it: a picked emoji goes in at the caret. */ }
            { onEmojiClick && (
                <IconButton icon="smile" className="bm-composer__picker" label={ pickerLabel ?? "" }
                            size={ 18 } keepFocus={ ! isMobile() } onClick={ onEmojiClick } />
            ) }

            { /* The camera beside the microphone while nothing is typed: one click records a video message. */ }
            { ! hasContent && ! isEdit && canRecordVideo && (
                <IconButton icon="video" label={ __( "Record Video Message", "bp-better-messages" ) }
                            size={ 18 } onClick={ onStartVideo } />
            ) }

            { /* The accent slot: with nothing to send it is the microphone, once there is text or files it is Send.
                 Over the length limit it stays Send, greyed, and a press still reaches onSend, which says why.
                 keepFocus on a computer, so the next message can be typed at once. */ }
            { ( ! hasContent && ! isEdit && ! sending && canRecordVoice ) ? (
                <IconButton icon="mic"
                            label={ __( "Record Voice Message", "bp-better-messages" ) }
                            emphasis="accent" size={ 18 }
                            onClick={ onStartVoice } />
            ) : (
                <IconButton icon={ sending ? "spinner" : ( isEdit ? "check" : "send" ) }
                            label={ overLimit
                                ? ( isEdit
                                    ? sprintf( _x( "Message is too long. Maximum allowed length is %d characters", "Save button tooltip when over limit", "bp-better-messages" ), maxLength )
                                    : sprintf( _x( "Message is too long. Maximum allowed length is %d characters", "Send button tooltip when over limit", "bp-better-messages" ), maxLength ) )
                                : ( isEdit
                                    ? _x( "Save Message", "\"Edit message\" button tooltip", "bp-better-messages" )
                                    : __( "Send Message", "bp-better-messages" ) ) }
                            emphasis="accent" size={ 18 }
                            className={ overLimit ? "bm-composer__send--over" : undefined }
                            disabled={ ! canSend && ! isEdit && ! overLimit }
                            keepFocus={ ! isMobile() }
                            onClick={ onSend } />
            ) }

            { /* Add-ons put controls next to Send (better_messages_send_button_after in Better Messages). */ }
            { afterButtonHtml ? (
                <span className="bm-composer__after" dangerouslySetInnerHTML={{ __html: afterButtonHtml }} />
            ) : null }
        </div>
    );
}
