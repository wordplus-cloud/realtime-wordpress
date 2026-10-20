import {useEffect, useRef} from "react";
import type {Tile} from "@wordplus/realtime-client/streams";
import {usePlayer} from "./player.tsx";
import {shapeOf} from "./appearance.ts";

type AttachableTrack = NonNullable<Tile['camera']>;

// How long after a pause the element is played again: iOS pauses a video as its own full screen closes,
// and a play() made in the same moment can be undone by that close.
const RESUME_AFTER_MS = 100;

// A live picture or sound kept playing. Nothing on the page pauses one, but iOS does: leaving its own full
// screen (webkitEnterFullscreen, the iPhone's), closing picture-in-picture, and while the page is in the
// background. Each is played again as it stops, or as the page comes back. One that is detached (no
// stream) or on a page out of sight is left as it is.
function useKeptPlaying( ref : { current : HTMLMediaElement | null } ){
    useEffect( () => {
        const element = ref.current;
        if( ! element ) return;

        let timer : ReturnType<typeof setTimeout> | null = null;
        const resume = () => {
            if( element.paused && element.srcObject && ! document.hidden ) element.play().catch( () => {} );
        };
        const soon = () => {
            if( timer ) clearTimeout( timer );
            timer = setTimeout( resume, RESUME_AFTER_MS );
        };

        element.addEventListener( 'pause', soon );
        element.addEventListener( 'webkitendfullscreen', soon );
        element.addEventListener( 'leavepictureinpicture', soon );
        document.addEventListener( 'visibilitychange', soon );

        return () => {
            if( timer ) clearTimeout( timer );
            element.removeEventListener( 'pause', soon );
            element.removeEventListener( 'webkitendfullscreen', soon );
            element.removeEventListener( 'leavepictureinpicture', soon );
            document.removeEventListener( 'visibilitychange', soon );
        };
    }, [ ref ] );
}

// A track of the RTC client's in a <video>. Attaching is what lets adaptive stream see the element's size and
// pick the layer to receive. The main picture (`primary`) is the one picture-in-picture and iOS's full
// screen take, and the player reads how tall it arrives. Alone on the stage (`fills`), it gives the stage its shape;
// in a grid with others, the stage is wide.
export function VideoTrack( props : { track : AttachableTrack, mirrored? : boolean, fit? : 'cover' | 'contain', primary? : boolean, fills? : boolean } ){
    const ref = useRef<HTMLVideoElement>( null );
    const { setPrimary, setHeight, setVideoShape } = usePlayer();
    useKeptPlaying( ref );

    useEffect( () => {
        const element = ref.current;
        if( ! element ) return;
        props.track.attach( element );
        return () => { props.track.detach( element ); };
    }, [ props.track ] );

    useEffect( () => {
        const element = ref.current;
        if( ! element || ! props.primary ) return;

        setPrimary( element );
        const size = () => {
            setHeight( element.videoHeight );
            if( element.videoWidth > 0 && element.videoHeight > 0 ) setVideoShape( props.fills ? shapeOf( element.videoWidth, element.videoHeight ) : '16:9' );
        };
        element.addEventListener( 'resize', size );
        element.addEventListener( 'loadedmetadata', size );
        size();

        return () => {
            element.removeEventListener( 'resize', size );
            element.removeEventListener( 'loadedmetadata', size );
            setPrimary( null );
            setHeight( 0 );
        };
    }, [ props.primary, props.fills, setPrimary, setHeight, setVideoShape ] );

    return (
        <video
            ref={ ref }
            className={ 'estream-video' + ( props.mirrored ? ' estream-video--mirrored' : '' ) + ( props.fit === 'contain' ? ' estream-video--contain' : '' ) }
            autoPlay
            playsInline
            muted
        />
    );
}

type SinkAudio = HTMLAudioElement & { setSinkId? : ( id : string ) => Promise<void> };

function AudioTrack( props : { track : AttachableTrack, volume : number, muted : boolean, speaker : string } ){
    const ref = useRef<HTMLAudioElement>( null );
    useKeptPlaying( ref );

    useEffect( () => {
        const element = ref.current;
        if( ! element ) return;
        props.track.attach( element );
        return () => { props.track.detach( element ); };
    }, [ props.track ] );

    useEffect( () => {
        const element = ref.current;
        if( ! element ) return;
        element.volume = props.volume;
        element.muted = props.muted;
    }, [ props.track, props.volume, props.muted ] );

    useEffect( () => {
        const element = ref.current as SinkAudio | null;
        if( element?.setSinkId && props.speaker ) element.setSinkId( props.speaker ).catch( () => {} );
    }, [ props.track, props.speaker ] );

    return <audio ref={ ref } autoPlay />;
}

// Everyone's sound but one's own, at the player's volume, on the chosen speakers.
export function AudioTracks( props : { tiles : Tile[] } ){
    const { volume, muted, speaker } = usePlayer();

    return (
        <div className="estream-audio" aria-hidden="true">
            { props.tiles.flatMap( ( tile ) => tile.audio.map( ( track ) => (
                <AudioTrack key={ tile.identity + ( track.sid ?? track.mediaStreamTrack.id ) } track={ track } volume={ volume } muted={ muted } speaker={ speaker } />
            ) ) ) }
        </div>
    );
}
