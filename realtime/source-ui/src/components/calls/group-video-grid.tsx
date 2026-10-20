import React, { useContext, useEffect, useRef, useState } from "react";
import {CallContext, CallContextInterface} from "./context.ts";
import GroupVideoGridItem from "./group-video-grid-item.tsx";
import useStateRef from "../../inc/hooks/state-ref.ts";
import {isMobile} from "../../inc/functions/browser-info.ts";
import {applyFilters} from "../../inc/globals.ts";
import {DEFAULT_TILE_RATIO, TALL_TILE_RATIO, participantRatio} from "../../inc/calls/ratio.ts";

type GroupVideoPositionItem = { x: number; y: number; width: number; height: number }
type GroupVideoPositions = Map<string, GroupVideoPositionItem>

/**
 * A group video call's tiles, fitted to the call's area: the pinned people, and in broadcast mode the speakers, in a
 * primary block, everyone else in a secondary one, side by side or stacked as the space allows, each tile at the shape
 * of its picture.
 */
export default function GroupVideoGrid() {
    const videoGridEl = useRef<HTMLDivElement>(null);
    const [ videoGridHeight, setVideoGridHeight ] = useState<number | undefined>(undefined);
    const lastHeight = useRef(0)
    const lastWidth  = useRef(0)
    const [primaryVideoPositions, setPrimaryVideoPositions] = useState<GroupVideoPositions>(new Map)
    const [secondaryVideoPositions, setSecondaryVideoPositions] = useState<GroupVideoPositions>(new Map)

    const {
        wrapper,
        participants: rawParticipants,
        participantsRef,
        callMode,
        thread
    } = useContext<CallContextInterface>( CallContext );

    // 2.x group-video-chat.tsx passed the rendered participant map through
    // better_messages_group_video_call_items(items, thread) — integrations
    // hide or decorate tiles with it. The host names it: Better Messages adds
    // its prefix, so the same filter as before.
    const participants = applyFilters(
        'group_video_call_items', rawParticipants, thread,
    ) as typeof rawParticipants;

    const [ primaryRowHeight, setPrimaryRowHeight, primaryRowHeightRef ] = useStateRef<number>(0);
    const [ secondaryRowHeight, setSecondaryRowHeight, secondaryRowHeightRef ] = useStateRef<number>(0);

    // The two blocks are stacked, one over the other, until the primary one
    // is taller than it is wide — see findBestFitPrimaryGrid — and then they
    // stand side by side and each needs a width of its own.
    const [ primaryWidth, setPrimaryWidth ] = useState<number>(0);
    const [ secondaryWidth, setSecondaryWidth, secondaryWidthRef ] = useStateRef<number>(0);
    const [ beside, setBeside ] = useState<boolean>(false);

    const [ primaryItems, setPrimaryItems, primaryItemsRef ] = useStateRef<Set<string>>(new Set);

    const callModeRef = useRef(callMode);
    useEffect(() => { callModeRef.current = callMode; }, [callMode]);

    const checkSizeChangeInterval = useRef<number | undefined>(undefined);

    useEffect(() => {
        window.addEventListener('resize', updateGrid );
        checkSizeChangeInterval.current = window.setInterval( checkSizeChange, 1000 );

        // The stage slides in from nothing — .bm-call-surface animates its
        // width — and the first tile is now drawn at the start of that slide
        // rather than after the site has answered `groupCallStart`. Measured
        // once, against a container still 0 wide, updateGrid gives up and
        // every tile is left without a box to be drawn in until the poll
        // below next comes round. The observer follows the slide instead.
        let observer : ResizeObserver | null = null;

        if( typeof ResizeObserver !== 'undefined' && wrapper.current ){
            observer = new ResizeObserver( () => updateGrid() );
            observer.observe( wrapper.current );
        }

        return () => {
            window.removeEventListener('resize', updateGrid );
            window.clearInterval( checkSizeChangeInterval.current );
            observer?.disconnect();
        }
    }, []);

    const checkSizeChange = () => {
        if( ! wrapper.current || ! videoGridEl.current?.parentElement ) return;

        const controls = videoGridEl.current.parentElement.querySelector<HTMLElement>('.bm-group-call-controls-v2');
        if( ! controls ) return;

        const containerWidth = wrapper.current.getBoundingClientRect().width;
        const containerHeight = wrapper.current.getBoundingClientRect().height;
        const controlsHeight = controls.getBoundingClientRect().height;

        let resultHeight = containerHeight - controlsHeight;

        if (lastHeight.current !== resultHeight || lastWidth.current !== containerWidth) {
            updateGrid();
        }
    }

    const findBestFitPrimaryGrid = (
        containerWidth: number,
        containerHeight: number
    ) : {
        primaryRowHeight: number;
        secondaryRowHeight: number;
        primaryWidth: number;
        secondaryWidth: number;
        beside: boolean;
        positions: GroupVideoPositions
    } => {
        const minSecondaryHeight = 100;
        const minSecondaryWidth = minSecondaryHeight * DEFAULT_TILE_RATIO;

        let minRatio = DEFAULT_TILE_RATIO;
        let maxRatio = DEFAULT_TILE_RATIO;

        const primaryVideoPositions : GroupVideoPositions = new Map();

        if (containerWidth <= 0 || containerHeight <= 0) {
            return {
                primaryRowHeight: 0,
                secondaryRowHeight: 0,
                primaryWidth: 0,
                secondaryWidth: 0,
                beside: false,
                positions: primaryVideoPositions
            }
        }

        const count = primaryItemsRef.current.size;
        const participantsCount = participantsRef.current.size;

        const onlyPrimaryParticipants = count === participantsCount;

        // What the tiles here are shaped like. A shared screen is what its
        // tile draws, so it is the screen that is measured — reading the
        // camera, which is what this did, answered 16:9 for somebody sharing
        // a phone and 16:9 again for somebody sharing with their camera off.
        primaryItemsRef.current.forEach( ( key ) => {
            const ratio = participantRatio( participantsRef.current.get( key ) );

            if( ratio === null ) return;

            if( ratio < minRatio ) minRatio = ratio;
            if( ratio > maxRatio ) maxRatio = ratio;
        });

        // The shape of the block before its size, because the size follows
        // from it: four pinned tiles in two columns want a block half as tall
        // as four in one. `containerWidth / minRatio` answered for a single
        // column however many there turned out to be.
        let columns = Math.ceil( Math.sqrt( count ) );
        let rows = Math.ceil( count / columns );

        if( onlyPrimaryParticipants && count === 2 ){
            rows = 2;
            columns = 1;
        } else if ( isMobile() ){
            rows = primaryItemsRef.current.size;
            columns = 1;
        }

        // Tall enough for the tallest picture in it, drawn at the width one
        // column gives it, once per row.
        let primaryRowHeight = ( containerWidth / columns ) / minRatio * rows;
        let secondaryRowHeight = containerHeight - primaryRowHeight;

        let primaryWidth = containerWidth;
        let secondaryWidth = containerWidth;
        let beside = false;

        if( isMobile() ){
            primaryRowHeight = containerHeight - minSecondaryHeight;
            secondaryRowHeight = minSecondaryHeight;
        }

        if( secondaryRowHeight < minSecondaryHeight ) {
            primaryRowHeight = containerHeight - minSecondaryHeight;
            secondaryRowHeight = minSecondaryHeight;
        }

        // A picture taller than it is wide cannot be handed the container's
        // full width: the tile is then mostly the ground either side of it.
        // Somebody sharing a phone is exactly that — about 9:19.5 — and the
        // stack was the only division this had, so pinning their share drew
        // it as a narrow strip down the middle of a very wide box with the
        // rest of the call squashed into a hundred pixels underneath.
        //
        // A tall block stands beside the others instead. It keeps its own
        // shape, takes only the width that shape needs, and the secondary
        // tiles have the rest as a column — which is a better shape for them
        // than a strip in any case.
        //
        // Only where there is width to divide — wider than it is tall, and
        // wide enough for a tile on each side of the division. A phone holds
        // its container portrait, and there stacking is right for a tall
        // share too.
        if( minRatio < TALL_TILE_RATIO && containerWidth > containerHeight && containerWidth > minSecondaryWidth * 2 ){
            beside = true;

            primaryWidth = Math.min(
                containerWidth - minSecondaryWidth,
                ( containerHeight / rows ) * minRatio * columns
            );

            primaryWidth = Math.max( primaryWidth, minSecondaryWidth );

            secondaryWidth = containerWidth - primaryWidth;
            primaryRowHeight = containerHeight;
            secondaryRowHeight = containerHeight;
        }

        if( onlyPrimaryParticipants ){
            primaryRowHeight = containerHeight;
            secondaryRowHeight = 0;
            primaryWidth = containerWidth;
            secondaryWidth = 0;
            beside = false;
        }

        setPrimaryRowHeight( primaryRowHeight );
        setSecondaryRowHeight( secondaryRowHeight );
        setPrimaryWidth( primaryWidth );
        setSecondaryWidth( secondaryWidth );
        setBeside( beside );

        const itemsPerRow = count / rows;
        let index = 0;
        let row = 0;

        let widthPercent  = 100 / columns; // Width as a percentage
        let heightPercent = 100 / rows; // Height as a percentage

        primaryItemsRef.current.forEach( ( key ) => {
            if( index >= itemsPerRow ) {
                row++;
                index = 0;
            }

            const xPercent = index * widthPercent;
            const yPercent = row * heightPercent;

            primaryVideoPositions.set(key, { x: xPercent, y: yPercent, width: widthPercent, height: heightPercent });

            index++;
        });

        return {
            primaryRowHeight,
            secondaryRowHeight,
            primaryWidth,
            secondaryWidth,
            beside,
            positions: primaryVideoPositions
        }
    };

    const latestSecondaryPositions = useRef<string[]>([]);

    const findBestFitSecondaryLayout = (
        containerWidth: number,
        containerHeight: number
    ): GroupVideoPositions => {
        const secondaryVideoPositions : GroupVideoPositions = new Map();

        if (containerWidth < 0 || containerHeight < 0) {
            return secondaryVideoPositions;
        }

        const count = participantsRef.current.size - primaryItemsRef.current.size;

        if ( count < 1 || ! Number.isInteger( count ) ) {
            return secondaryVideoPositions;
        }

        // Screen-aware, for the same reason the primary block is: a cell has
        // to hold the picture its tile actually draws.
        let maxRatio = DEFAULT_TILE_RATIO;

        participantsRef.current.forEach( ( participant, key ) => {
            if( ! primaryItemsRef.current.has( key ) ) {
                const ratio = participantRatio( participant );

                if( ratio !== null && ratio > maxRatio ) maxRatio = ratio;
            }
        });

        const minVideoHeight = 100;
        const minVideoWidth = minVideoHeight * maxRatio;

        // The arrangement that makes the pictures biggest.
        //
        // Every column count is a candidate. Each one implies a number of rows,
        // and so a cell of `containerWidth / columns` by `containerHeight /
        // rows`; a picture of the call's own aspect letterboxed into that cell
        // — which is what a tile draws — has an area. The largest area wins.
        // One loop, no special cases, and it answers for any number of people
        // in any container.
        //
        // It is why two people stack in a tall container and sit side by side
        // in a wide one, without either being written down. What it replaces
        // was `ceil(sqrt(count))` walked down until the tiles cleared a
        // minimum, and then `if (count === 2) one column` on top of that — at
        // every container shape. That last line is why a phone turned on its
        // side showed two very wide letterboxes with a small avatar in each,
        // and the apps, which copy this file, showed the same. They carry the
        // search now and so does this.
        //
        // The minimum stays as a ceiling on how many tiles may share the
        // container rather than as a shape rule; anything past what fits pages
        // as it did before.
        const mostColumns = Math.max( 1, Math.min( count, Math.floor( containerWidth / minVideoWidth ) ) );
        const mostRows = Math.max( 1, Math.floor( containerHeight / minVideoHeight ) );

        let columns = 1;
        let rows = count;
        let bestArea = -1;

        for ( let tryColumns = 1; tryColumns <= mostColumns; tryColumns++ ) {
            const tryRows = Math.min( Math.ceil( count / tryColumns ), mostRows );

            // The picture inside the cell, letterboxed the way the tile
            // letterboxes it. The cell's own area would answer a different
            // question — which arrangement leaves the least dead space — and
            // pick tall thin cells for wide pictures.
            const drawn = Math.min( containerWidth / tryColumns, ( containerHeight / tryRows ) * maxRatio );
            const area = drawn * ( drawn / maxRatio );

            if ( area > bestArea ) {
                bestArea = area;
                columns = tryColumns;
                rows = tryRows;
            }
        }

        // Still `let`: the branch below, for a strip under a pinned speaker,
        // works the shape out a second way and overwrites them.
        let widthPercent  = 100 / columns; // Width as a percentage
        let heightPercent = 100 / rows; // Height as a percentage

        let participants = new Map(participantsRef.current);

        let index = 0;

        const videosEnabled = new Set<string>();
        const currentlyTalking = new Set<string>();

        participants.forEach( ( participant, key ) => {
            if ( ! primaryItemsRef.current.has(key) ) {
                if( participant.video || participant.screen ) {
                    videosEnabled.add(key);
                }

                if( participant.isSpeaking ) {
                    currentlyTalking.add(key);
                }
            }
        });

        latestSecondaryPositions.current = latestSecondaryPositions.current.filter(key => participantsRef.current.has(key) && !primaryItemsRef.current.has(key));

        const combinedKeys = [
            ...latestSecondaryPositions.current.filter(key => videosEnabled.has(key)),
            ...latestSecondaryPositions.current.filter(key => currentlyTalking.has(key) && !videosEnabled.has(key)),
            ...latestSecondaryPositions.current.filter(key => ! videosEnabled.has(key) && !currentlyTalking.has(key)),
            ...Array.from(participants.keys()).filter(key  => ! latestSecondaryPositions.current.includes(key) && ! primaryItemsRef.current.has(key))
        ];

        latestSecondaryPositions.current = combinedKeys;

        // A strip rather than a grid.
        //
        // Stacked under a primary block, the rest get `minSecondaryHeight`
        // and no more — one tile tall. The search above, asked which
        // arrangement draws the biggest picture in a box that can hold one
        // row, answers "one column": one tile on show and everyone else paged
        // off the side. So a block that can only hold one row is laid out by
        // how many tiles fit across it instead, and pages sideways past that.
        //
        // What decides it is the block's own height. That used to be a
        // comparison against `minRatio * calculatedWidth`, a width times a
        // ratio, which is a width — and one large enough that this branch ran
        // whenever anything was pinned at all. It therefore also ran for the
        // column beside a tall primary, which is not a strip and lost
        // everything past its first tile to `x >= 100%`.
        if( primaryRowHeightRef.current > 0 && containerHeight < minVideoHeight * 2 ){
            const itemWidth = Math.max( 1, containerHeight * maxRatio );
            const possibleColumns = Math.max( 1, Math.ceil( containerWidth / itemWidth ) );

            widthPercent = 100 / possibleColumns;
            heightPercent = 100;

            combinedKeys.forEach((key) => {
                if ( ! primaryItemsRef.current.has(key) ) {
                    secondaryVideoPositions.set(key, { x: index * widthPercent, y: 0, width: widthPercent, height: heightPercent });

                    index++;
                }
            });

            return secondaryVideoPositions;
        }

        const itemsPerPage = columns * rows;

        if( participants.has('me') && ! primaryItemsRef.current.has('me') ) {
            latestSecondaryPositions.current = latestSecondaryPositions.current.filter( ( key ) => key !== 'me' );
            if( count <= itemsPerPage ){
                latestSecondaryPositions.current.push('me');
            } else {
                const lastVisibleIndex = latestSecondaryPositions.current[ itemsPerPage - 1 ];
                const lastParticipant = lastVisibleIndex ? participants.get( lastVisibleIndex ) : null;

                if( lastParticipant && ! lastParticipant.video && ! lastParticipant.screen && ! lastParticipant.isSpeaking ){
                    const before = latestSecondaryPositions.current.slice(0, itemsPerPage - 1);
                    const after = latestSecondaryPositions.current.slice(itemsPerPage - 1);
                    latestSecondaryPositions.current = [ ... before, 'me', ... after ];
                }
            }
        }

        let page = 1;
        let pageRow = 0;

        latestSecondaryPositions.current.map( ( key ) => {
            if( ! primaryItemsRef.current.has( key ) ) {
                let row = Math.floor(index / columns);
                let col = index % columns;

                let xPercent = col * widthPercent;
                let yPercent = row * heightPercent;

                if( page > 1 ){
                    let pageCol = page - 1;
                    xPercent = 100 + ( ( pageCol - 1 ) * widthPercent );
                    pageRow++;
                    yPercent = ( pageRow - 1 ) * heightPercent;

                    if( pageRow >= rows ){
                        pageRow = 0;
                        page++;
                    }
                } else {
                    index++;

                    if( index === itemsPerPage ){
                        page++;
                        index = 0;
                    }
                }

                secondaryVideoPositions.set(key, { x: xPercent, y: yPercent, width: widthPercent, height: heightPercent });
            }
        })

        return secondaryVideoPositions;
    };

    const updateGrid = () => {
        if( ! wrapper.current || ! videoGridEl.current?.parentElement ) return;

        const controls = videoGridEl.current.parentElement.querySelector<HTMLElement>('.bm-group-call-controls-v2');
        if( ! controls ) return;

        const containerWidth = wrapper.current.getBoundingClientRect().width;
        const containerHeight = wrapper.current.getBoundingClientRect().height;

        const controlsStyle = window.getComputedStyle(controls);
        const controlsHeight = controls.getBoundingClientRect().height;
        const controlsBottom = parseInt(controlsStyle.getPropertyValue('bottom')) || 0;

        // No extra slack under the grid: every tile already carries a 4px
        // gutter of its own, and the controls bar's top padding is the gap.
        let resultHeight = containerHeight - controlsHeight - controlsBottom;
        let resultWidth = containerWidth;

        if( resultHeight <= 0 || resultWidth <= 0 ) return;

        setVideoGridHeight(resultHeight);

        lastHeight.current = resultHeight;
        lastWidth.current = resultWidth;

        const numSquares = participantsRef.current.size;

        if (numSquares === 0) return;

        const primaryItemsCount = primaryItemsRef.current.size;

        if( primaryItemsCount > 0 ){
            const primaryVideoGrid = findBestFitPrimaryGrid( resultWidth, resultHeight );

            setPrimaryRowHeight(primaryVideoGrid.primaryRowHeight);
            setSecondaryRowHeight(primaryVideoGrid.secondaryRowHeight);
            setPrimaryWidth(primaryVideoGrid.primaryWidth);
            setSecondaryWidth(primaryVideoGrid.secondaryWidth);
            setBeside(primaryVideoGrid.beside);
            setPrimaryVideoPositions(primaryVideoGrid.positions);
        } else {
            setPrimaryRowHeight(0);
            setSecondaryRowHeight(resultHeight);
            setPrimaryWidth(0);
            setSecondaryWidth(resultWidth);
            setBeside(false);
        }

        // The block's own width, which is the whole container until a tall
        // primary takes a share of it.
        const secondaryVideoPositions = findBestFitSecondaryLayout( secondaryWidthRef.current, secondaryRowHeightRef.current );

        setSecondaryVideoPositions(secondaryVideoPositions)
    }

    useEffect( () => {
        const primary = new Set<string>();

        participants.forEach( ( participant, key ) => {
            if( participant.isPinned ) {
                primary.add(key);
            }

            // In broadcast mode, speakers go to primary view
            if( callModeRef.current === 'broadcast' && ( participant.canPublish || participant.canAdmin ) ) {
                primary.add(key);
            }
        });

        setPrimaryItems(primary);

        updateGrid();
    }, [ participants ] );

    const itemsPrimary = [ ... primaryItems ].map( (item) => {
        const participant = participants.get(item);

        if( ! participant ){
            return null;
        }

        const position = primaryVideoPositions.get(item);
        if( ! position ) return null;

        const width  = position.width;
        const height = position.height;
        const x      = position.x;
        const y      = position.y;

        return (<GroupVideoGridItem key={item} unique_key={item} participant={participant} width={width} height={height} x={x} y={y} />)
    });

    const items = [ ... participants ].map( (item) => {
        const unique_key = item[0];
        const position = secondaryVideoPositions.get(unique_key);
        if( ! position ) return null;

        const width  = position.width;
        const height = position.height;
        const x      = position.x;
        const y      = position.y;

        return (<GroupVideoGridItem key={unique_key} unique_key={unique_key} participant={item[1]} width={width} height={height} x={x} y={y} />)
    });

    // `beside` turns the two blocks from one over the other into one next to
    // the other; the widths are only meaningful then, so they are left off
    // otherwise and each block spans the grid as it always has.
    //
    // As a share of the container rather than the pixels it was worked out
    // in: the grid is padded, so its content box is a few pixels narrower
    // than what the two were measured against, and two exact widths would
    // come to more than there is room for. The two add up to the container,
    // which is what makes their sum the figure to divide by.
    const dividedWidth = primaryWidth + secondaryWidth;

    const shareOfWidth = ( width: number ) => ( beside && dividedWidth > 0 )
        ? ( width / dividedWidth * 100 ) + '%'
        : undefined;

    return <div ref={videoGridEl} className="bm-group-call-videos-grid" data-split={ beside ? 'beside' : 'stacked' } style={{ height: videoGridHeight }}>
        <div className="bm-group-call-videos-grid-primary" style={{ height: primaryRowHeight, width: shareOfWidth( primaryWidth ) }}>
            { itemsPrimary }
        </div>

        <div className="bm-group-call-videos-grid-secondary" style={{ height: secondaryRowHeight, width: shareOfWidth( secondaryWidth ) }}>
            { items }
        </div>
    </div>
}
