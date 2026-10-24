import {useEffect} from "react";
import {sharedTooltips} from "./shared.ts";
import {WINDOW_ATTRIBUTE} from "./player.tsx";

// Tooltips in place of the browser's (`title`), which shows late, plainly, and never in full screen: any element with
// `data-estream-tip` shows that text over itself, under it where there is no room above, inside the window. A mouse or
// pen shows it at once, as does focus from the keyboard; a touch never. A click, Escape, a scroll or leaving hides it.
// The words are the element's name (aria-label) or its description (aria-description) for screen readers too.
//
// The WordPlus SDK's floater, which every WordPlus plugin on the page shares, where the page has it (shared.ts), styled
// as ours (`estream-tip`); our own otherwise. One for the page, whichever stream trees it has: each installs it
// (useTooltips) and the last one gone removes it. Ours goes into the element shown full screen, or filling the window
// over the page, or the page's body.

const ATTRIBUTE = 'data-estream-tip';
const GAP = 8;
const MARGIN = 8;
const ID = 'estream-tooltip';

let users = 0;
// The SDK's, while it watches the page: the way to stop it.
let stopShared : ( () => void ) | null = null;
let tip : HTMLDivElement | null = null;
let target : HTMLElement | null = null;
// When a pointer last pressed: a focus right after is the click's, not the keyboard's.
let pressedAt = 0;
const PRESS_FOCUS_MS = 500;

const tipOf = ( node : EventTarget | null ) : HTMLElement | null =>
    node && typeof ( node as Element ).closest === 'function' ? ( node as Element ).closest<HTMLElement>( '[' + ATTRIBUTE + ']' ) : null;

function place( el : HTMLElement, box : HTMLDivElement ){
    const at = el.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    const width = document.documentElement.clientWidth || window.innerWidth;

    let top = at.top - size.height - GAP;
    if( top < MARGIN ) top = at.bottom + GAP;
    const left = Math.min( Math.max( MARGIN, at.left + at.width / 2 - size.width / 2 ), Math.max( MARGIN, width - size.width - MARGIN ) );

    box.style.top = Math.round( top ) + 'px';
    box.style.left = Math.round( left ) + 'px';
}

function show( el : HTMLElement ){
    const text = el.getAttribute( ATTRIBUTE );
    if( ! text || ! el.isConnected ) return;

    if( ! tip ){
        tip = document.createElement( 'div' );
        tip.id = ID;
        tip.className = 'estream-tooltip';
        tip.setAttribute( 'role', 'tooltip' );
    }

    const host = document.fullscreenElement ?? el.closest( '[' + WINDOW_ATTRIBUTE + ']' ) ?? document.body;
    if( tip.parentNode !== host ) host.appendChild( tip );

    tip.textContent = text;
    place( el, tip );
    tip.classList.add( 'estream-tooltip--on' );
    target = el;
}

function hide(){
    tip?.classList.remove( 'estream-tooltip--on' );
    target = null;
}

const onOver = ( e : PointerEvent ) => {
    if( e.pointerType === 'touch' ) return;
    const el = tipOf( e.target );
    if( el === target ) return;
    hide();
    if( el ) show( el );
};

// Leaving the window.
const onOut = ( e : PointerEvent ) => {
    if( ! e.relatedTarget ) hide();
};

// Focus from the keyboard (or a menu giving it back), not a click's.
const onFocus = ( e : FocusEvent ) => {
    const el = tipOf( e.target );
    if( ! el || el === target || Date.now() - pressedAt < PRESS_FOCUS_MS ) return;
    hide();
    show( el );
};

const onBlur = ( e : FocusEvent ) => {
    if( target && target.contains( e.target as Node ) ) hide();
};

const onKey = ( e : KeyboardEvent ) => {
    if( e.key === 'Escape' ) hide();
};

const onPress = () => {
    pressedAt = Date.now();
    hide();
};

const LISTENERS : Array<[ string, EventListener ]> = [
    [ 'pointerover', onOver as EventListener ],
    [ 'pointerout', onOut as EventListener ],
    [ 'focusin', onFocus as EventListener ],
    [ 'focusout', onBlur as EventListener ],
    [ 'keydown', onKey as EventListener ],
    [ 'pointerdown', onPress ],
    [ 'scroll', hide ],
    [ 'wheel', hide ],
    [ 'fullscreenchange', hide ]
];

function install(){
    if( users++ > 0 ) return;

    const shared = sharedTooltips();
    if( shared ){
        stopShared = shared.watch( document, { attribute: ATTRIBUTE, focus: true, className: 'estream-tip' } );
        return;
    }

    for( const [ name, listener ] of LISTENERS ) document.addEventListener( name, listener, { capture: true, passive: true } );
    window.addEventListener( 'resize', hide );
}

function uninstall(){
    if( --users > 0 ) return;

    if( stopShared ){
        stopShared();
        stopShared = null;
        return;
    }

    for( const [ name, listener ] of LISTENERS ) document.removeEventListener( name, listener, { capture: true } );
    window.removeEventListener( 'resize', hide );
    hide();
    tip?.remove();
    tip = null;
    pressedAt = 0;
}

// The page's tooltips, while this tree is on it.
export function useTooltips(){
    useEffect( () => {
        install();
        return uninstall;
    }, [] );
}
