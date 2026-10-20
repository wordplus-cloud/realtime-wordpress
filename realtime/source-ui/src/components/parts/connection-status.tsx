import React, { useState, useRef, useEffect } from "react";
import {_x} from "../../inc/globals.ts";
import Tooltip from "../helpers/tooltip.tsx";
import Icon from "../../primitives/icon.tsx";

interface GroupVideoGridItemInterface{
    state : string,
    quality: string
}

/**
 * The call's connection: its state and quality as an icon with words for screen readers, bright for a moment after it
 * changes and faded again once it holds.
 */
const ConnectionStatus: React.FC<GroupVideoGridItemInterface> = ({ state, quality }) => {
    const [lastState, setLastState] = useState<string>('');
    const [stateJustChanged, setStateJustChanged] = useState<boolean>(false);
    const removeOpacityTimeout = useRef<number | null>(null);
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (state !== lastState) {
            setStateJustChanged( true )
            ref.current?.classList.add('bm-opacity');

            removeOpacityTimeout.current = window.setTimeout(() => {
                setStateJustChanged( false );
            }, 3000);

            setLastState(state);
        }

        return () => {
            if ( removeOpacityTimeout.current) {
                window.clearTimeout(removeOpacityTimeout.current);
            }
        };
    }, [state]);

    let loadingIcon =  <Icon name="wifi" size={ 13 } />
    if( state === 'reconnecting' || state === 'connecting' || state === 'signalReconnecting' ){
        loadingIcon = <Icon name="spinner" size={ 13 } className="bm-svg-animate" />
    } else if ( state === 'disconnected' ){
        loadingIcon = <Icon name="x" size={ 13 } />
    }

    if( state === 'signalReconnecting' ) state = 'reconnecting';

    if( state === 'connected' && quality !== 'unknown' ){
        state = state + ' (' + quality + ')';
    }

    let spanClass = "bm-connection-quality bm-state-" + state + " bm-quality-" + quality;

    if( stateJustChanged ) {
        spanClass += ' bm-opacity';
    }

    return (
        <div className="bm-connection-control">
            <Tooltip content={ _x('Connection Status (Quality)', 'Group Call Screen', 'bp-better-messages') }>
                <span ref={ref} className={spanClass}>
                    {loadingIcon}
                    <span>{state}</span>
                </span>
            </Tooltip>
        </div>
    );
}

export default ConnectionStatus;
