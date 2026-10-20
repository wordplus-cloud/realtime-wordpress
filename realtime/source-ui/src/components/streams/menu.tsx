import {useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode} from "react";
import {Icon, type IconName} from "./icons.tsx";
import {sharedMenus} from "./shared.ts";

// A button that opens a menu above or below it: the player's settings, the studio's devices. It closes on
// a choice, on Escape (focus back on its button), on Tab (focus moving on from its button), and on a click elsewhere;
// the arrow keys move between its items, Home and End to the first and the last, and a letter to the next item
// starting with it.
//
// Where the page has the WordPlus SDK's menus (shared.ts), they place it, as every WordPlus plugin's menu: in the top
// layer, over the player in full screen and out of any box that would cut it off, inside the window, on the side of
// its button with room, with its button as the page moves; and they close it (a press outside, whose click goes
// nowhere, and Escape). Without them (a page without the SDK: an app, the script-tag embed) it places itself the same
// way (placeOwn), in the top layer where the browser has popovers, and otherwise by its own CSS beside its button, on
// the side with room.

// Between the button and its menu: above it, below it.
const GAP_UP = 8;
const GAP_DOWN = 6;
// The clearance from the window's edges.
const EDGE = 8;

// A menu without the SDK's menus, beside its button: on the side asked where it fits or has more room than the other,
// no taller than that side has room for (scrolling the rest), inside the window. Lifted into the top layer, it is
// placed at a fixed point; left where it is, it opens up or down from its button by its CSS.
function placeOwn( list : HTMLElement, anchor : HTMLElement, up : boolean, end : boolean, lifted : boolean ){
    const at = anchor.getBoundingClientRect();
    const doc = document.documentElement;
    const vw = doc.clientWidth || window.innerWidth;
    const vh = doc.clientHeight || window.innerHeight;
    const above = at.top - GAP_UP - EDGE;
    const below = vh - EDGE - at.bottom - GAP_DOWN;

    list.style.maxHeight = '';
    const h = list.offsetHeight;
    if( h > ( up ? above : below ) && ( up ? below : above ) > ( up ? above : below ) ) up = ! up;
    const room = Math.max( 0, up ? above : below );
    if( h > room ) list.style.maxHeight = room + 'px';

    if( lifted ){
        const w = list.offsetWidth;
        const left = end ? at.right - w : at.left;
        list.style.left = Math.round( Math.max( EDGE, Math.min( vw - EDGE - w, left ) ) ) + 'px';
        list.style.top = Math.round( up ? at.top - GAP_UP - list.offsetHeight : at.bottom + GAP_DOWN ) + 'px';
        return;
    }
    list.style.top = up ? 'auto' : 'calc(100% + ' + GAP_DOWN + 'px)';
    list.style.bottom = up ? 'calc(100% + ' + GAP_UP + 'px)' : 'auto';
}

export function MenuButton( props : {
    icon : IconName;
    label : string;
    // Shown beside the icon; without it the button is the icon alone, named by `label`.
    text? : string;
    className? : string;
    // Which way it opens from the button (default up, as from the player's bar).
    placement? : 'up' | 'down';
    align? : 'start' | 'end';
    children : ( close : () => void ) => ReactNode;
} ){
    const [ open, setOpen ] = useState( false );
    const box = useRef<HTMLDivElement>( null );
    const button = useRef<HTMLButtonElement>( null );
    const menu = useRef<HTMLDivElement>( null );
    const id = useId();

    const close = ( refocus = true ) => {
        setOpen( false );
        if( refocus ) button.current?.focus();
    };

    // Handed to the SDK's menus, at the point beside its button where it opens, growing up from above it.
    useLayoutEffect( () => {
        const menus = sharedMenus();
        const list = menu.current;
        const anchor = button.current;
        if( ! open || ! menus || ! list || ! anchor ) return;

        const at = anchor.getBoundingClientRect();
        const up = ( props.placement ?? 'up' ) === 'up';
        const handle = menus.open( list, {
            anchor,
            x: ( props.align ?? 'end' ) === 'end' ? at.right - list.offsetWidth : at.left,
            y: up ? at.top - GAP_UP : at.bottom + GAP_DOWN,
            origin: up ? 'bottom' : 'top',
            lift: true,
            // Escape gives the button its focus back; a press elsewhere leaves it where the press puts it.
            onClose: () => close( list.contains( document.activeElement ) )
        } );
        return () => handle.close();
    }, [ open ] );

    // Without the SDK's menus: placed here (placeOwn), again as the page scrolls or the window changes.
    useLayoutEffect( () => {
        const list = menu.current;
        const anchor = button.current;
        if( ! open || sharedMenus() || ! list || ! anchor ) return;

        let lifted = false;
        if( typeof list.showPopover === 'function' ){
            list.setAttribute( 'popover', 'manual' );
            Object.assign( list.style, { position: 'fixed', inset: 'auto', margin: '0' } );
            try {
                list.showPopover();
                lifted = true;
            } catch {
                // Not in the top layer, then: placed by its CSS beside its button.
                list.removeAttribute( 'popover' );
                Object.assign( list.style, { position: '', inset: '', margin: '' } );
            }
        }

        const place = () => placeOwn( list, anchor, ( props.placement ?? 'up' ) === 'up', ( props.align ?? 'end' ) === 'end', lifted );
        place();
        window.addEventListener( 'scroll', place, true );
        window.addEventListener( 'resize', place );
        return () => {
            window.removeEventListener( 'scroll', place, true );
            window.removeEventListener( 'resize', place );
            if( lifted ){
                try {
                    list.hidePopover();
                } catch {}
            }
        };
    }, [ open ] );

    useEffect( () => {
        if( ! open ) return;

        // The checked item, or the first, takes focus.
        const items = menu.current ? [ ...menu.current.querySelectorAll<HTMLElement>( '[role^="menuitem"]' ) ] : [];
        ( items.find( ( i ) => i.getAttribute( 'aria-checked' ) === 'true' ) ?? items[0] )?.focus();

        // The SDK's menus close it themselves.
        if( sharedMenus() ) return;

        const outside = ( event : PointerEvent ) => {
            if( box.current && ! box.current.contains( event.target as Node ) ) close( false );
        };
        document.addEventListener( 'pointerdown', outside );
        return () => document.removeEventListener( 'pointerdown', outside );
    }, [ open ] );

    const onKeyDown = ( event : KeyboardEvent ) => {
        if( event.key === 'Escape' ){
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
        }

        // Tab leaves the menu as it leaves its button: closed, the focus going on from the button.
        if( event.key === 'Tab' ){
            close();
            return;
        }

        const items = menu.current ? [ ...menu.current.querySelectorAll<HTMLElement>( '[role^="menuitem"]:not([disabled])' ) ] : [];
        const at = items.indexOf( document.activeElement as HTMLElement );
        let next = -1;
        if( event.key === 'ArrowDown' ) next = ( at + 1 ) % items.length;
        else if( event.key === 'ArrowUp' ) next = ( at - 1 + items.length ) % items.length;
        else if( event.key === 'Home' ) next = 0;
        else if( event.key === 'End' ) next = items.length - 1;
        else if( event.key.length === 1 && /\S/.test( event.key ) && ! event.ctrlKey && ! event.metaKey && ! event.altKey ){
            // The next item after this one whose name starts with the letter.
            const letter = event.key.toLocaleLowerCase();
            const order = [ ...items.slice( at + 1 ), ...items.slice( 0, at + 1 ) ];
            const found = order.find( ( item ) => ( item.querySelector( '.estream-menu__label' )?.textContent ?? item.textContent ?? '' ).trim().toLocaleLowerCase().startsWith( letter ) );
            next = found ? items.indexOf( found ) : -1;
        }
        if( next < 0 ) return;
        event.preventDefault();
        items[ next ]?.focus();
    };

    return (
        <div ref={ box } className={ 'estream-menu' + ( props.className ? ' ' + props.className : '' ) }>
            <button
                ref={ button }
                type="button"
                className={ 'estream-menu__button' + ( props.text ? '' : ' estream-icon-button' ) + ( open ? ' estream-menu__button--open' : '' ) }
                aria-haspopup="menu"
                aria-expanded={ open }
                aria-controls={ open ? id : undefined }
                aria-label={ props.text ? undefined : props.label }
                data-estream-tip={ props.text || open ? undefined : props.label }
                onClick={ () => setOpen( ! open ) }
            >
                <Icon name={ props.icon } />
                { props.text && <span>{ props.text }</span> }
            </button>
            { open && (
                <div
                    ref={ menu }
                    id={ id }
                    role="menu"
                    aria-label={ props.label }
                    className={ 'estream-menu__list estream-menu__list--' + ( props.placement ?? 'up' ) + ' estream-menu__list--' + ( props.align ?? 'end' ) }
                    onKeyDown={ onKeyDown }
                >
                    { props.children( () => close() ) }
                </div>
            ) }
        </div>
    );
}

export function MenuHeading( props : { children : ReactNode } ){
    return <div className="estream-menu__heading" role="presentation">{ props.children }</div>;
}

// One of a set of choices, ticked when chosen; `hint` beside its name, `note` under it.
export function MenuChoice( props : { checked : boolean, onSelect : () => void, children : ReactNode, hint? : string, note? : string } ){
    return (
        <button type="button" role="menuitemradio" aria-checked={ props.checked } className="estream-menu__item" onClick={ props.onSelect }>
            <span className="estream-menu__tick">{ props.checked && <Icon name="check" /> }</span>
            <span className="estream-menu__label">
                { props.children }
                { props.note && <span className="estream-menu__note">{ props.note }</span> }
            </span>
            { props.hint && <span className="estream-menu__hint">{ props.hint }</span> }
        </button>
    );
}

export function MenuItem( props : { onSelect : () => void, children : ReactNode, icon? : IconName, danger? : boolean } ){
    return (
        <button type="button" role="menuitem" className={ 'estream-menu__item' + ( props.danger ? ' estream-menu__item--danger' : '' ) } onClick={ props.onSelect }>
            <span className="estream-menu__tick">{ props.icon && <Icon name={ props.icon } /> }</span>
            <span className="estream-menu__label">{ props.children }</span>
        </button>
    );
}
