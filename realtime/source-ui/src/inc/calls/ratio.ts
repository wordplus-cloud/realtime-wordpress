import { useEffect, useState } from "react";

// What shape a call picture is.
//
// Until a phone could share its screen, every picture in a call was a
// camera's, and a camera's is 16:9 — so the grids read the camera
// publication and fell back to 1.77 when there was not one yet. A screen is
// not 16:9. A laptop is 16:10, an ultrawide 21:9, and a phone sharing itself
// is about 9:19.5, taller than it is wide. Measuring a screen sharer's tile
// by their camera, or by the constant, is how an iPhone's share arrived as a
// sliver down the middle of a black band.
//
// Two ways to ask, because there are two moments to ask in. Before anything
// is drawn only the publication has an answer, and that is the one the grid
// arithmetic runs on — it has to divide a container up before there is a
// <video> to measure. Once one is playing, `videoWidth`/`videoHeight` are
// the picture actually on the screen: they follow a phone being turned over,
// where the two sides swap, and they are the same question for a camera, a
// screen, a local track and a remote one.

/** What a camera publishes at, and the shape to assume until something says otherwise. */
export const DEFAULT_TILE_RATIO = 16 / 9;

/**
 * Taller than this and a tile is stood beside the others rather than over
 * them. Square is the line: a picture no wider than it is tall cannot be
 * given a container's full width without most of that width going to waste.
 */
export const TALL_TILE_RATIO = 1;

interface Dimensions {
    width: number;
    height: number;
}

interface RatioPublication {
    dimensions?: Dimensions | null;
}

interface RatioParticipant {
    screen?: unknown;
    screenPub?: RatioPublication | null;
    videoPub?: RatioPublication | null;
}

function ratioOf( size?: Dimensions | null ): number | null {
    if( ! size ) return null;

    const { width, height } = size;

    if( ! ( width > 0 ) || ! ( height > 0 ) ) return null;

    return width / height;
}

/** A publication's shape, or null while it has not reported one. */
export function publicationRatio( publication?: RatioPublication | null ): number | null {
    return publication ? ratioOf( publication.dimensions ) : null;
}

/**
 * The shape of the picture a participant's tile draws.
 *
 * A shared screen is what the tile shows — their camera, when there is one
 * as well, goes to the inset chip — so the screen is what the tile is
 * measured by. Null when nothing is published, or when what is published has
 * not reported a size yet: a caller dividing a container up has nothing to go
 * on there and should leave that person out of the reckoning rather than pull
 * the answer towards a shape they may not turn out to have.
 */
export function participantRatio( participant?: RatioParticipant | null ): number | null {
    if( ! participant ) return null;

    if( participant.screen ) return publicationRatio( participant.screenPub );

    return publicationRatio( participant.videoPub );
}

/**
 * The shape of what a video element is playing, once it is playing.
 *
 * `resize` is the event that carries a camera flipped or a phone turned over.
 * A reading is kept until a truthful one replaces it: an element between
 * streams reports 0×0, and letting that through would collapse whatever is
 * sized from it.
 */
export function useMediaRatio( element: HTMLVideoElement | null ): number | null {
    const [ ratio, setRatio ] = useState<number | null>( null );

    useEffect(() => {
        if( ! element ) {
            setRatio( null );
            return;
        }

        const read = () => {
            const next = ratioOf( { width: element.videoWidth, height: element.videoHeight } );

            if( next !== null ) setRatio( next );
        };

        read();

        element.addEventListener( 'loadedmetadata', read );
        element.addEventListener( 'playing', read );
        element.addEventListener( 'resize', read );

        return () => {
            element.removeEventListener( 'loadedmetadata', read );
            element.removeEventListener( 'playing', read );
            element.removeEventListener( 'resize', read );
        };
    }, [ element ]);

    return ratio;
}

// Frames a browser can put on the screen before its not having counted one
// in `getVideoPlaybackQuality()` means it does not count them for a stream.
const PRESENTED_WITHOUT_A_COUNT = 3;

// For a picture that is never presented at all, so the chip still shows.
const DRAWN_AT_THE_LATEST = 3000;

// Whether this browser has counted a frame of a stream it plays. WebKit only
// has since March 2026 (309540@main) and Firefox does not, so the first count
// is what says so.
let countsStreamFrames = false;

/** Nothing of what the element plays drawn yet, a frame drawn, or one drawn and counted. */
export type PictureDrawn = false | 'drawn' | 'counted';

/**
 * Whether the browser has drawn a frame of what the element plays.
 *
 * WebKit on a phone hands the camera's frames over in the sensor's
 * orientation, tagged with how to turn them upright, and its video layer
 * only fits a turned frame to the picture's box when that box changes size.
 * A picture that got its size before the layer had seen a frame shows the
 * sensor's 16:9 frame fitted to the chip's width and then stood upright: a
 * picture about half the chip's width, centred in a black chip, until
 * something happens to resize it. The element's own box fills the chip
 * throughout, only the pixels are wrong.
 *
 * So the own-camera chip lays its picture out at another size until a frame
 * is drawn, and growing into the chip is the resize that fits the frame (see
 * _call-stage.scss). `getVideoPlaybackQuality()` is what knows: WebKit
 * counts the frames its video layer has taken, and one counted is one whose
 * turn the layer has applied.
 *
 * The frames a frame callback reports as presented are not that. WebKit
 * counts there every frame the page is handed, and its layer takes none
 * until the picture is laid out and the layer is built. A chip that takes
 * over a camera already running, as it does from the ringing screen when a
 * call connects, is handed three frames before its layer has one: it grew
 * then, the layer's first frame came after, and an iPhone showed its own
 * picture half the chip's width for the whole call. So once the browser has
 * counted a frame of any stream, a picture is drawn when a frame of its own
 * is counted.
 *
 * Until then, and for good in a browser that does not count them, a picture
 * is believed drawn once a few frames are presented, and one with no frame
 * callbacks at all once the stream has a size. A count that comes after
 * that makes it 'counted', and the chip, which lays a picture out a pixel
 * taller until then, resizes it once more for WebKit to fit the frame by.
 *
 * `source` is what the element plays: a new one, on the same element, has to
 * be drawn again. So does a new stream under the same source. LiveKit re-opens
 * a phone's camera whenever the page comes back from the background, keeps
 * the track object and hands the element a new MediaStream, and the chip,
 * which only knew the object, stayed at its full size for the new stream's
 * first frame, the one WebKit fits wrong. Setting srcObject anew empties the
 * element first, and that is what is counted here.
 */
export function usePictureDrawn( element: HTMLVideoElement | null, source?: unknown ): PictureDrawn {
    const [ drawn, setDrawn ] = useState<{ element: HTMLVideoElement, source: unknown, stream: number, counted: boolean } | null>( null );
    const [ stream, setStream ] = useState( 0 );

    useEffect(() => {
        if( ! element ) return;

        const emptied = () => setStream( ( count ) => count + 1 );

        element.addEventListener( 'emptied', emptied );

        return () => {
            element.removeEventListener( 'emptied', emptied );
        };
    }, [ element ]);

    useEffect(() => {
        if( ! element ) return;

        if( typeof element.requestVideoFrameCallback !== 'function' ) {
            const done = () => setDrawn( { element, source, stream, counted: false } );

            element.addEventListener( 'loadedmetadata', done );
            element.addEventListener( 'playing', done );

            if( element.readyState >= HTMLMediaElement.HAVE_METADATA ) done();

            return () => {
                element.removeEventListener( 'loadedmetadata', done );
                element.removeEventListener( 'playing', done );
            };
        }

        let handle = 0;
        let latest = 0;
        let shown = false;

        const show = () => {
            if( shown ) return;

            shown = true;
            setDrawn( { element, source, stream, counted: false } );
        };

        const check = ( _now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata ) => {
            let counted = 0;

            try {
                counted = element.getVideoPlaybackQuality().totalVideoFrames;
            } catch ( e ) {}

            if( counted > 0 ) {
                countsStreamFrames = true;
                window.clearTimeout( latest );
                setDrawn( { element, source, stream, counted: true } );
                return;
            }

            if( ! countsStreamFrames && metadata.presentedFrames >= PRESENTED_WITHOUT_A_COUNT ) show();

            handle = element.requestVideoFrameCallback( check );
        };

        handle = element.requestVideoFrameCallback( check );

        latest = window.setTimeout( () => {
            show();

            // Still nothing counted, in a browser never seen counting, is a
            // browser that does not.
            if( ! countsStreamFrames ) element.cancelVideoFrameCallback( handle );
        }, DRAWN_AT_THE_LATEST );

        return () => {
            element.cancelVideoFrameCallback( handle );
            window.clearTimeout( latest );
        };
    }, [ element, source, stream ]);

    if( ! element || drawn === null || drawn.element !== element || drawn.source !== source || drawn.stream !== stream ) return false;

    return drawn.counted ? 'counted' : 'drawn';
}

/** A ratio written the way CSS `aspect-ratio` takes it. */
export function cssRatio( ratio: number | null ): string | null {
    return ratio === null ? null : String( ratio );
}
