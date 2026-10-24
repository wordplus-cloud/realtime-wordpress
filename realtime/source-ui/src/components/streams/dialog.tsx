import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from "react";
import {__} from "./i18n.ts";

// The player's own dialogs, in its colours, instead of the browser's confirm(): "End the stream for
// everyone?", "Ban Sam?". A dialog takes focus, keeps it while open (Tab goes round its own buttons and fields), gives
// it back when it closes, and Escape cancels.

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ConfirmOptions {
    title : string;
    message? : string;
    confirm : string;
    cancel? : string;
    danger? : boolean;
}

type Ask = ( options : ConfirmOptions ) => Promise<boolean>;

// Without a provider (a part used on its own), the browser's confirm().
const Context = createContext<Ask>( async ( options ) => window.confirm( options.message ? options.title + '\n\n' + options.message : options.title ) );

export const useConfirm = () : Ask => useContext( Context );

interface Pending extends ConfirmOptions {
    resolve : ( yes : boolean ) => void;
}

export function DialogBox( props : { title : string, children? : ReactNode, actions : ReactNode, onCancel? : () => void, labelId : string } ){
    const box = useRef<HTMLDivElement>( null );

    useEffect( () => {
        const before = document.activeElement as HTMLElement | null;
        // The last button is the one that does it; the first, a way out, takes focus.
        box.current?.querySelector<HTMLElement>( '.estream-dialog__actions button' )?.focus();
        return () => before?.focus?.();
    }, [] );

    return (
        <div className="estream-dialog" role="presentation" onKeyDown={ ( e ) => {
            if( e.key === 'Escape' && props.onCancel ){
                e.stopPropagation();
                props.onCancel();
                return;
            }
            if( e.key !== 'Tab' || ! box.current ) return;
            const items = [ ...box.current.querySelectorAll<HTMLElement>( FOCUSABLE ) ];
            const first = items[0], last = items[ items.length - 1 ];
            if( ! first || ! last ) return;
            if( e.shiftKey && document.activeElement === first ){
                e.preventDefault();
                last.focus();
            } else if( ! e.shiftKey && document.activeElement === last ){
                e.preventDefault();
                first.focus();
            }
        } }>
            <div ref={ box } className="estream-dialog__box" role="dialog" aria-modal="true" aria-labelledby={ props.labelId }>
                <h2 id={ props.labelId }>{ props.title }</h2>
                { props.children }
                <div className="estream-dialog__actions">{ props.actions }</div>
            </div>
        </div>
    );
}

// Where a dialog shows: in place by default, inside the theme root (which goes full screen with it). Parts
// placed apart on a page put theirs on a layer of their own (parts.tsx).
type Layer = ( props : { children : ReactNode } ) => ReactNode;

const InPlace : Layer = ( props ) => props.children;

export function ConfirmProvider( props : { children : ReactNode, layer? : Layer } ){
    const Layer = props.layer ?? InPlace;
    const [ pending, setPending ] = useState<Pending | null>( null );

    const ask = useCallback<Ask>( ( options ) => new Promise<boolean>( ( resolve ) => {
        setPending( ( current ) => {
            current?.resolve( false );
            return { ...options, resolve };
        } );
    } ), [] );

    const answer = ( yes : boolean ) => {
        pending?.resolve( yes );
        setPending( null );
    };

    return (
        <Context.Provider value={ ask }>
            { props.children }
            { pending && <Layer>
                <DialogBox
                    labelId="estream-confirm-title"
                    title={ pending.title }
                    onCancel={ () => answer( false ) }
                    actions={ (
                        <>
                            <button type="button" className="estream-button" onClick={ () => answer( false ) }>{ pending.cancel ?? __( 'Cancel', 'wordplus-live-stream' ) }</button>
                            <button type="button" className={ 'estream-button ' + ( pending.danger ? 'estream-button--danger-solid' : 'estream-button--primary' ) } onClick={ () => answer( true ) }>{ pending.confirm }</button>
                        </>
                    ) }
                >
                    { pending.message && <p>{ pending.message }</p> }
                </DialogBox>
            </Layer> }
        </Context.Provider>
    );
}
