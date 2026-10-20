// The WordPlus SDK's parts the screens draw with, shared by every WordPlus plugin on a page: their types, from the
// SDK's tooltips/src/types.ts, and how a screen reaches them. No global is declared for them here: Better Messages
// declares its own from the SDK's copy, and two declarations would clash.

/** Where the floater goes: above (flipping below when there is no room), or beside (flipping across). */
export type TooltipSide = 'auto' | 'top' | 'bottom' | 'right' | 'left';

/**
 * What a tooltip shows: text, a node the plugin built, or a function that draws into the floater and answers
 * its cleanup, called when the tooltip goes.
 */
export type TooltipContent = string | Node | ( ( el: HTMLElement ) => void | ( () => void ) );

export interface TooltipOptions {
    side?: TooltipSide;
    gap?: number;
    delay?: number;
    className?: string;
    rich?: boolean;
    attributes?: Record<string, string>;
    style?: Record<string, string>;
}

/** window.wordplusTooltips. */
export interface Tooltips {
    readonly canHover: boolean;
    show( anchor: Element, content: TooltipContent, options?: TooltipOptions ): void;
    hide( anchor?: Element | null ): void;
    place(): void;
}

let own: Tooltips | undefined;

/** A floater for a page without the SDK's: the elements script sets the package's own (inc/floater.ts). */
export function setOwnTooltips( tooltips: Tooltips | undefined ): void {
    own = tooltips;
}

/** The SDK's tooltips, once on the page, else the floater set for a page without them. */
export function sharedTooltips(): Tooltips | undefined {
    return typeof window === 'undefined' ? undefined : ( window as unknown as { wordplusTooltips?: Tooltips } ).wordplusTooltips ?? own;
}
