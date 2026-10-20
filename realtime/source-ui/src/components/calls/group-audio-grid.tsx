import React, {useContext, useEffect, useRef} from "react";
import {CallContext, CallContextInterface} from "./context.ts";
import useStateRef from "../../inc/hooks/state-ref.ts";
import GroupAudioGridItem from "./group-audio-grid-item.tsx";
import useFlipReorder from "../../utils/use-flip-reorder.ts";


/**
 * A group audio call's roster: a row for each person in the CallContext, the loudest first, fitted to the call's area
 * and sliding into their new places as the order changes.
 */
export default function GroupAudioGrid() {
    const audioGridEl = useRef<HTMLDivElement>(null);
    const lastHeight = useRef(0)
    const lastWidth = useRef(0)

    const [itemPositions, setItemPositions] = useStateRef<string[]>([])

    const {
        wrapper,
        participants,
        participantsRef,
        callMode
    } = useContext<CallContextInterface>(CallContext);

    const callModeRef = useRef(callMode);
    useEffect(() => { callModeRef.current = callMode; }, [callMode]);

    const checkSizeChangeInterval = useRef<number | undefined>(undefined);

    useEffect(() => {
        window.addEventListener('resize', updateGrid);
        checkSizeChangeInterval.current = window.setInterval(checkSizeChange, 1000);

        return () => {
            window.removeEventListener('resize', updateGrid);
            window.clearInterval(checkSizeChangeInterval.current);
        }
    }, []);

    const controlsOf = () => audioGridEl.current!.parentElement!.querySelector<HTMLElement>('.bm-group-call-controls-v2')!;

    const checkSizeChange = () => {
        const containerWidth = wrapper.current!.getBoundingClientRect().width;
        const containerHeight = wrapper.current!.getBoundingClientRect().height;
        const controlsHeight = controlsOf().getBoundingClientRect().height;

        let resultHeight = containerHeight - controlsHeight - 4;

        if (lastHeight.current !== resultHeight || lastWidth.current !== containerWidth) {
            updateGrid();
        }
    }

    const lastList = useRef<string[]>([]);

    const isListener = (key: string) => {
        const p = participantsRef.current.get(key);
        return p && callModeRef.current === 'broadcast' && !p.canPublish && !p.canAdmin;
    };

    const updateGrid = () => {
        const containerWidth = wrapper.current!.getBoundingClientRect().width;
        const containerHeight = wrapper.current!.getBoundingClientRect().height;
        const controls = controlsOf();

        const controlsStyle = window.getComputedStyle(controls);
        const controlsHeight = controls.getBoundingClientRect().height;
        const controlsBottom = parseInt(controlsStyle.getPropertyValue('bottom'));

        let resultHeight = containerHeight - controlsHeight - controlsBottom - 4;
        let resultWidth = containerWidth;

        lastHeight.current = resultHeight;
        lastWidth.current = resultWidth;

        const numSquares = participantsRef.current.size;

        if (numSquares === 0) return;

        const sortedUsers: Array<[string, number]> = [];

        participantsRef.current.forEach((participant, key) => {
            let soundLevel: number = participant.audioLevel;

            if (!participant.audio) {
                soundLevel = 0;
            } else {
                soundLevel = 1;
            }

            if (!!participant.screen) {
                soundLevel = 999;
            }

            sortedUsers.push([key, soundLevel]);
        });

        sortedUsers.sort(function (a, b) {
            return b[1] - a[1];
        });

        const topList : string[] = [];
        const lowList : string[] = [];

        for (const [userId, soundLevel] of sortedUsers) {
            if (soundLevel > 0) {
                topList.push(userId);
            } else {
                lowList.push(userId);
            }
        }

        const currentList = [ ...topList ];

        lastList.current.forEach((userId) => {
            if ( ! topList.includes(userId) && lowList.includes(userId) ) {
                currentList.push(userId);
            }
        });

        lowList.forEach((userId) => {
            if ( ! currentList.includes(userId) ) {
                currentList.push(userId);
            }
        });

        lastList.current = currentList;

        // In broadcast mode, sort listeners to the bottom
        if( callModeRef.current === 'broadcast' ) {
            const speakers = currentList.filter(key => !isListener(key));
            const listeners = currentList.filter(key => isListener(key));
            setItemPositions([ ...speakers, ...listeners ]);
        } else {
            setItemPositions(currentList);
        }
    }

    useEffect(() => {
        updateGrid();
    }, [participants]);

    const items = [...itemPositions].map((unique_key) => {
        const participant = participants.get(unique_key);
        if (!participant) return null;

        return (<GroupAudioGridItem key={unique_key} unique_key={unique_key} participant={participant}/>)
    });

    // Tiles are reordered as people speak, so their positions change without
    // any property to transition. useFlipReorder animates the move itself.
    //
    // A participant who leaves now vanishes on the spot rather than fading:
    // the fade meant keeping their tile — and the LiveKit participant object
    // behind it — alive for a third of a second after they had gone, which is
    // not a trade worth making inside call code for a closing animation.
    useFlipReorder( audioGridEl );

    return <div ref={audioGridEl} className="bm-group-call-audios-grid">
        {items}
    </div>
}
