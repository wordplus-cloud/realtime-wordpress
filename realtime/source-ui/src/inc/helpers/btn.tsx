import React, { forwardRef, useEffect, useRef } from "react";
import { mergeRefs } from "react-merge-refs";

// Btn — the plugin's only clickable control.
//
// A native <button> cannot be styled reliably inside a WordPress site. Themes
// and plugins target the element by name, and their selectors routinely
// outrank anything we can write: BuddyPress ships
// `.buddypress .buddypress-wrap … button` (0,3,1) and the average theme adds
// `input[type=submit], button` — so our own single-class rule loses and every
// control arrives pre-painted with a foreign border, background, radius and
// padding. Nothing in the messenger may rely on the <button> element.
//
// So Btn renders a <span role="button">. No theme styles bare spans by
// element name, and the class it carries (.bm-btn) restores the box model a
// <button> gave for free. Everything a native button does for us is
// reimplemented here, once:
//
//   • Enter / Space activate it (forwarded through a real .click(), so a
//     single onClick handler serves pointer and keyboard alike)
//   • it is reachable by Tab, and leaves the tab order when disabled
//   • `disabled` reports as aria-disabled, drops the handler, and swallows
//     the click in the capture phase so it cannot reach a clickable ancestor
//     — a native disabled button emits no click at all
//   • autoFocus works (React only honours the attribute on form controls)
//
// Use `as="div"` where the control sits in a block layout and an inline-level
// span would be invalid markup (a row that contains paragraphs, say).

// A pointer press that must not move focus. Btn is focusable (tabIndex 0 is
// what buys it Tab reachability), so pressing one takes the caret out of
// whatever field had it — and on a phone the on-screen keyboard folds away
// with it. Cancelling the mousedown default is what every editor toolbar
// does to keep its caret; it reaches touch too, since browsers focus on the
// compatibility mousedown a tap synthesizes, and leaves Tab and Enter
// untouched so keyboard users still reach and press the control.
//
// Use it as `onMouseDown` on a control (or on a container of controls) whose
// press opens something the focused field has to survive.
export function keepPointerFocus( e: React.MouseEvent ): void {
    e.preventDefault();
}

export interface BtnProps extends React.HTMLAttributes<HTMLElement> {
    disabled?  : boolean;
    as?        : "span" | "div";
    autoFocus? : boolean;
    [ key: `data-${ string }` ] : unknown;
}

const Btn = forwardRef<HTMLElement, BtnProps>( function Btn( {
    as = "span",
    className,
    disabled,
    autoFocus,
    role = "button",
    tabIndex,
    onClick,
    onClickCapture,
    onKeyDown,
    children,
    ...rest
}, ref ) {
    const own = useRef<HTMLElement | null>( null );

    useEffect( () => {
        if ( autoFocus && ! disabled ) own.current?.focus();
    }, [ autoFocus, disabled ] );

    const handleKeyDown = ( e: React.KeyboardEvent<HTMLElement> ) => {
        onKeyDown?.( e );
        if ( disabled || e.defaultPrevented ) return;
        if ( e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar" ) return;
        // Only when the control itself has focus — a keystroke that bubbled up
        // from a field inside it must not press the button.
        if ( e.currentTarget !== e.target ) return;
        e.preventDefault();
        ( e.currentTarget as HTMLElement ).click();
    };

    const handleClickCapture = ( e: React.MouseEvent<HTMLElement> ) => {
        if ( disabled ) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        onClickCapture?.( e );
    };

    const Tag = as as React.ElementType;

    return (
        <Tag
            { ...rest }
            ref={ mergeRefs( [ own, ref ] ) }
            className={ "bm-btn" + ( className ? " " + className : "" ) }
            role={ role }
            tabIndex={ disabled ? -1 : ( tabIndex ?? 0 ) }
            aria-disabled={ disabled ? true : undefined }
            data-disabled={ disabled ? "1" : undefined }
            onClick={ disabled ? undefined : onClick }
            onClickCapture={ handleClickCapture }
            onKeyDown={ handleKeyDown }
        >
            { children }
        </Tag>
    );
} );

export default Btn;
