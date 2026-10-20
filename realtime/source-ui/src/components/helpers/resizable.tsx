import React, { useEffect, useLayoutEffect, useRef } from "react";
import useStateRef from "../../inc/hooks/state-ref.ts";

/**
 * A box the user resizes by dragging one of its corners, keeping the shape of what it holds: the own picture in the
 * corner of a call between two.
 */
export default function Resizable({
                                      children,
                                      className = "",
                                      resizeDirection,
                                      initialWidth = 100,
                                      aspectRatio = null,
                                      part,
                                  }: {
    children: React.ReactNode;
    /** Its name for `::part()` where the elements draw it (pieces.tsx). */
    part?: string;
    resizeDirection:
        | "top-left"
        | "top-right"
        | "bottom-left"
        | "bottom-right"
        | "none";
    className?: string;
    initialWidth?: number;
    // The shape of the media inside, as "1080 / 1920". The box takes its
    // height from this instead of from the picture's own box, so the two
    // cannot disagree; a box the pointer has resized has a height of its
    // own and ignores it. Null until the stream says what shape it is.
    aspectRatio?: string | null;
}) {
    const ref = useRef<HTMLDivElement | null>(null);
    const [startPosition, setStartPosition, startPositionRef] = useStateRef<{
        x: number;
        y: number;
    } | null>(null);
    const [isDragging, setIsDragging, isDraggingRef] = useStateRef(false);
    const [isResizing, setIsResizing, isResizingRef] = useStateRef(false);
    const [startX, setStartX, startXRef] = useStateRef(0);
    const [startY, setStartY, startYRef] = useStateRef(0);

    const [startHeight, setStartHeight, startHeightRef] = useStateRef(0);
    const [startWidth, setStartWidth, startWidthRef] = useStateRef(0);

    const [x, setX, xRef] = useStateRef(0);
    const [y, setY, yRef] = useStateRef(0);

    let styles: React.CSSProperties = {
        transform: `translate(${x}px, ${y}px)`,
    };

    if ( aspectRatio ) {
        ( styles as Record<string, string> )["--bm-chip-ratio"] = aspectRatio;
    }

    // Before the first paint: with a plain effect the box showed at the
    // stylesheet's maximum width for a frame and then snapped to this.
    useLayoutEffect(() => {
        if (ref.current) {
            ref.current.style.width = `${initialWidth}px`;
        }
    }, []);

    useEffect(() => {
        function handleMove(event: MouseEvent | TouchEvent) {
            const clientX = event instanceof MouseEvent ? event.clientX : event.touches[0]?.clientX;
            const clientY = event instanceof MouseEvent ? event.clientY : event.touches[0]?.clientY;

            if ( clientX === undefined || clientY === undefined ) return;

            if (isResizingRef.current && startPositionRef.current && ref.current) {
                const deltaX = clientX - startPositionRef.current.x;
                const deltaY = clientY - startPositionRef.current.y;

                let newWidth = startWidthRef.current;
                if (
                    resizeDirection === "top-left" ||
                    resizeDirection === "bottom-left"
                ) {
                    newWidth = startWidthRef.current - deltaX;
                } else if (
                    resizeDirection === "top-right" ||
                    resizeDirection === "bottom-right"
                ) {
                    newWidth = startWidthRef.current + deltaX;
                }

                let newHeight = startHeightRef.current;
                if (
                    resizeDirection === "top-left" ||
                    resizeDirection === "top-right"
                ) {
                    newHeight = startHeightRef.current - deltaY;
                } else if (
                    resizeDirection === "bottom-left" ||
                    resizeDirection === "bottom-right"
                ) {
                    newHeight = startHeightRef.current + deltaY;
                }

                ref.current.style.width = `${newWidth}px`;
                ref.current.style.height = `${newHeight}px`;
            } else if (isDraggingRef.current && startPositionRef.current) {
                const deltaX = clientX - startPositionRef.current.x;
                const deltaY = clientY - startPositionRef.current.y;
                setX(startXRef.current + deltaX);
                setY(startYRef.current + deltaY);
            }
        }

        function handleEnd() {
            if (isResizingRef.current) {
                setIsResizing(false);
            }
            if (isDraggingRef.current) {
                setIsDragging(false);
            }
        }

        // Add global event listeners
        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", handleEnd);
        window.addEventListener("touchmove", handleMove, { passive: false });
        window.addEventListener("touchend", handleEnd);

        // Cleanup event listeners on unmount
        return () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", handleEnd);
            window.removeEventListener("touchmove", handleMove);
            window.removeEventListener("touchend", handleEnd);
        };
    }, [isDraggingRef, isResizingRef, startPositionRef, startXRef, startYRef]);

    const handleStart = (event: React.MouseEvent | React.TouchEvent, isResize: boolean) => {
        const nativeEvent = event.nativeEvent;

        const clientX = nativeEvent instanceof MouseEvent ? nativeEvent.clientX : nativeEvent.touches[0]?.clientX;
        const clientY = nativeEvent instanceof MouseEvent ? nativeEvent.clientY : nativeEvent.touches[0]?.clientY;

        if ( clientX === undefined || clientY === undefined ) return;

        setStartPosition({ x: clientX, y: clientY });
        setStartX(xRef.current);
        setStartY(yRef.current);
        if (isResize) {
            if ( ref.current ) {
                setStartHeight(ref.current.clientHeight);
                setStartWidth(ref.current.clientWidth);
            }
            setIsResizing(true);
            setIsDragging(false);
        } else {
            setIsDragging(true);
            setIsResizing(false);
        }
    };

    return (
        <div
            ref={ref}
            className={`bm-smart-container ${className || ""}`.trim()}
            style={styles}
            part={part}
        >
            {children}

            {resizeDirection !== "none" && (
                <div
                    onMouseDown={(event) => handleStart(event, true)}
                    onTouchStart={(event) => handleStart(event, true)}
                    className={
                        "bm-resizable-handle bm-resizable-handle-" + resizeDirection
                    }
                />
            )}

            <div
                style={{
                    cursor: isDragging ? "grabbing" : "grab",
                }}
                onMouseDown={(event) => handleStart(event, false)}
                onTouchStart={(event) => handleStart(event, false)}
                className="bm-draggable-handle"
            />
        </div>
    );
}
