import React, {
    Fragment,
    ReactElement,
    ReactNode,
    cloneElement,
    isValidElement,
    useContext,
} from "react";
import { _x } from "../../inc/globals.ts";
import Icon from "../../primitives/icon.tsx";
import Tooltip from "../helpers/tooltip.tsx";
import CallControl, { type CallControlProps } from "./call-control.tsx";
import { CallContext } from "./context.ts";
import { usePieces } from "../../pieces.tsx";
import FoldingDock from "./folding-dock.tsx";

// The control dock, kept to ONE row: its tail folds into a "More" sheet
// (folding-dock.tsx, which measures the row and keeps the sheet), whose
// button wears the call's tooltip and icon here. Before the dock folds, the
// app's `controls` piece arranges the call's controls (pieces.tsx).

interface Props {
    // The dock's own class — .bm-call-buttons (1:1) or
    // .bm-group-call-controls-buttons (rooms). Both carry the same dock
    // styling; the class stays with the call site so the stylesheet and the
    // specs keep reading the markup 2.0 emitted.
    className : string;
    // Trailing children that never fold into the sheet. Hang up is the one
    // control that has to stay under the thumb at every width.
    pinned?   : number;
    children  : ReactNode;
}

// The call sites group their conditionals in fragments — `{ adminMode && <>
// …four buttons… </> }` — and React.Children does not look inside a fragment,
// so a dock that counted its children would see one item where there are
// four. Walk through them.
function flattenItems( nodes: ReactNode ): ReactElement[] {
    const out: ReactElement[] = [];

    React.Children.toArray( nodes ).forEach( ( child ) => {
        if ( ! isValidElement( child ) ) return;

        if ( child.type === Fragment ) {
            out.push( ...flattenItems( ( child.props as { children?: ReactNode } ).children ) );
            return;
        }

        // An app's own button (the `controls` piece): drawn here, as ours are written, so it folds as they do.
        if ( child.type === CallControl ) {
            out.push( cloneElement( CallControl( child.props as CallControlProps ), { key: child.key ?? undefined } ) );
            return;
        }

        out.push( child );
    } );

    return out;
}

export default function CallDock( { className, pinned = 0, children }: Props ) {
    // The app's `controls` piece arranges ours (pieces.tsx): it may add, drop or reorder them. Ours pinned at the end
    // (hang up) stay there wherever it puts them.
    const { controls } = usePieces();
    const call = useContext( CallContext );
    const ours = flattenItems( children );
    // Known by their props, which React.Children keeps when it keys an element anew.
    const ourPinned = new Set<unknown>( ( pinned > 0 ? ours.slice( Math.max( 0, ours.length - pinned ) ) : [] ).map( ( el ) => el.props ) );
    const arranged = controls ? flattenItems( controls( ours, call ) ) : ours;
    const isPinned = ( el: ReactElement ) => ourPinned.has( el.props );
    const items = controls ? [ ...arranged.filter( ( el ) => ! isPinned( el ) ), ...arranged.filter( isPinned ) ] : ours;
    const pins = controls ? arranged.filter( isPinned ).length : pinned;

    return (
        <FoldingDock
            className={ className }
            pinned={ pins }
            more={ ( { open, toggle, sheet } ) => (
                <Tooltip content={ _x( 'More', 'Call Controls', 'bp-better-messages' ) }>
                    <span
                        onClick={ toggle }
                        className="bm-call-more"
                        data-active={ open ? 1 : undefined }
                        aria-haspopup="menu"
                        aria-expanded={ open }
                    >
                        <Icon name="more" size={ 20 } />
                        { sheet }
                    </span>
                </Tooltip>
            ) }
        >
            { items }
        </FoldingDock>
    );
}
