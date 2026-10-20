import React, { CSSProperties, ReactNode } from "react";
import Icon, { IconName } from "./icon.tsx";
import Tooltip from "./tooltip.tsx";
import Btn, { keepPointerFocus } from "../inc/helpers/btn.tsx";

// Icon-only button with tooltip and emphasis variants. Used everywhere the
// surfaces show a single-action chrome button — composer attach/mic/send,
// thread-header phone/video/more, inbox filter/edit, rail nav slots.
//
// emphasis = "accent" — solid accent background (the send button, "New
// message", chat-head bubble).
// emphasis = "danger" — solid recording color (end call, leave thread).
// tone — explicit text color override when neither variant fits.
// Without emphasis the button is a quiet hover-affordance.

export type IconButtonEmphasis = "none" | "accent" | "danger";

export interface IconButtonProps {
    icon       : IconName | "gif";
    label?     : string;
    onClick?   : ( e: React.MouseEvent ) => void;
    emphasis?  : IconButtonEmphasis;
    size?      : number;
    padding?   : number;
    tone?      : string;
    disabled?  : boolean;
    // Pressed/latched state (e.g. a filter toggle) — accent-tinted via the
    // global .bm-icon-btn[data-active="1"] rule.
    active?    : boolean;
    badge?     : ReactNode;
    title?     : string;
    "aria-label"? : string;
    // v2's stable per-action hook, the same attribute the thread header
    // stamps. Integrations hide individual chrome actions through it
    // (FluentCommunity drops Close on phones, where its own nav is the
    // way out), so it has to reach the element that actually renders.
    "data-action-key"? : string;
    // Renders an <a> with the exact same chrome and hover behavior — for
    // chrome actions that are navigations (the wp-admin Bulk Message link).
    href?      : string;
    target?    : string;
    // Extra class for a surface's own positioning hook (the inbox header's
    // leading compose button, the empty state's floating sidebar toggle).
    // The button chrome itself stays .bm-icon-btn's.
    className? : string;
    // Don't take focus from a pointer press — for chrome that acts ON a
    // field the press must not disturb (the composer's paperclip, whose
    // menu the editor has to stay focused behind so a phone keeps its
    // keyboard up). Keyboard focus is unaffected. See keepPointerFocus().
    keepFocus? : boolean;
}

export default function IconButton( {
    icon,
    label,
    onClick,
    emphasis = "none",
    size = 18,
    padding = 8,
    tone,
    disabled,
    active,
    badge,
    title,
    "aria-label": ariaLabel,
    "data-action-key": actionKey,
    href,
    target,
    className,
    keepFocus,
}: IconButtonProps ) {
    // The button chrome lives in CSS (.bm-icon-btn, _icon-button.scss)
    // so a single block restyles every instance — including non-React
    // markup that opts in by carrying the class (the voice recorder
    // controls). Inline style is reserved for per-call overrides.
    const style: CSSProperties = {};
    if ( padding !== 8 ) style.padding = padding;
    if ( tone && emphasis === "none" ) style.color = tone;

    const isSpinner = icon === "spinner";

    const shared = {
        onClick: disabled ? undefined : onClick,
        onMouseDown: keepFocus ? keepPointerFocus : undefined,
        title,
        "aria-label": ariaLabel ?? label,
        "data-emphasis": emphasis,
        "data-action-key": actionKey,
        "data-active": active ? 1 : undefined,
        className: "bm-icon-btn" + ( isSpinner ? " bm-icon-spin" : "" ) + ( className ? " " + className : "" ),
        style,
    } as const;

    const content = (
        <>
            <Icon name={ icon } size={ size } />
            { badge }
        </>
    );

    const button = href ? (
        <a { ...shared } href={ href } target={ target }
           rel={ target === "_blank" ? "noopener noreferrer" : undefined }>
            { content }
        </a>
    ) : (
        <Btn { ...shared } disabled={ disabled }>
            { content }
        </Btn>
    );

    return label ? <Tooltip label={ label }>{ button }</Tooltip> : button;
}
