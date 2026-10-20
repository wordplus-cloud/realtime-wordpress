// Where the keyboard goes back to as a call closes (an SDK review, 2026-10-14). The call window takes the focus as it
// opens and gives it back to what had it; a callee answered from the ring, though, whose Answer is gone by then, so the
// focus fell to the top of the page. The ring keeps where the user was as it appeared, such as the composer of a chat,
// for the call to give the focus back to instead.

let beforeRing: HTMLElement | null = null;

/**
 * What has the focus now, inside the shadow roots it sits in: `document.activeElement` names only the outermost host
 * (a `<chat-room>`), and a host without a tabindex takes no focus. Null for none.
 */
export function deepFocus(): HTMLElement | null {
    let element: Element | null = typeof document === "undefined" ? null : document.activeElement;
    while ( element?.shadowRoot?.activeElement ) element = element.shadowRoot.activeElement;
    return element instanceof HTMLElement && element !== document.body ? element : null;
}

/** A ring appeared: where the user was is kept, for the call it may become to give the focus back to. */
export function rememberBeforeRing( from: HTMLElement | null = deepFocus() ): void {
    if ( from ) beforeRing = from;
}

/** Gives the focus back as a call closes: to `before` while it is on the page, else to where the user was as it rang. */
export function focusBack( before: Element | null ): void {
    const target = before instanceof HTMLElement && before.isConnected ? before : beforeRing?.isConnected ? beforeRing : null;
    beforeRing = null;
    target?.focus( { preventScroll: true } );
}
