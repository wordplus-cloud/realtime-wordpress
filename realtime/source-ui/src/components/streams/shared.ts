// What every WordPlus plugin on the page shares, from the WordPlus SDK's scripts, which the WordPress plugin loads
// before the player: the tooltips' floater (window.wordplusTooltips) and the menus' placement (window.wordplusMenus),
// taken only where the browser has popovers, which put them in the top layer, over the player in full screen too;
// the emoji picker (window.wordplusPickers), where the page has its configuration; and the emoji drawn in the site's
// set (window.wordplusEmoji). Elsewhere (an older browser, or a page without the SDK, as the script-tag embed off
// WordPress) the player draws its own, and emoji are the device's.

export interface SharedTooltips {
    watch( root : Document | Element, options : {
        attribute? : string;
        focus? : boolean;
        className? : string;
    } ) : () => void;
}

export interface SharedMenus {
    open( menu : HTMLElement, options : {
        anchor? : Element | null;
        x? : number;
        y? : number;
        origin? : 'top' | 'bottom';
        lift? : boolean;
        dismiss? : boolean;
        onClose? : () => void;
    } ) : { place() : void, close() : void };
}

export interface SharedPickers {
    // Resolves to the function that closes it, once the picker is drawn: the first open loads it.
    open( options : {
        anchor : HTMLElement;
        emoji? : boolean;
        gifs? : boolean;
        dark? : boolean;
        // Custom properties on the picker while this one is open: `--wplus-picker-accent`, as `r, g, b`.
        style? : Record<string, string>;
        onInsert? : ( emoji : string ) => void;
        onClose? : () => void;
    } ) : Promise<() => void>;
}

// The emoji in a text drawn from the site's set (window.wordplusEmoji): the device's own where the site chose none.
export interface EmojiImage {
    emoji : string;
    src : string;
}

export interface SharedEmoji {
    set : string;
    // Whether a text has emoji, loading nothing.
    has( text : string ) : boolean;
    // Loads the set's index once: false for the device's own, or while it can't be loaded.
    ready() : Promise<boolean>;
    // The text with its emoji apart, as the set's images; the text whole before ready().
    split( text : string ) : Array<string | EmojiImage>;
}

const popovers = () => typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

const page = () => ( typeof window === 'undefined' ? {} : window ) as {
    wordplusTooltips? : SharedTooltips,
    wordplusMenus? : SharedMenus,
    wordplusPickers? : SharedPickers,
    wordplusPickersConfig? : unknown,
    wordplusEmoji? : SharedEmoji
};

export const sharedTooltips = () : SharedTooltips | null => popovers() ? page().wordplusTooltips ?? null : null;

export const sharedMenus = () : SharedMenus | null => popovers() ? page().wordplusMenus ?? null : null;

export const sharedPickers = () : SharedPickers | null => page().wordplusPickersConfig ? page().wordplusPickers ?? null : null;

export const sharedEmoji = () : SharedEmoji | null => {
    const emoji = page().wordplusEmoji;
    return emoji && emoji.set !== 'native' ? emoji : null;
};
