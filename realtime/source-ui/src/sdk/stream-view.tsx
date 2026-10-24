// The SDK's live stream (`calls.stream()`, or @wordplus/realtime's useStream()) in Easy Stream's player, chat and
// studio, for a React app:
//
//     import '@wordplus/realtime-ui/streams.css';
//     import { StreamView } from '@wordplus/realtime-ui/streams';
//
//     const { stream } = useStream( 'show:42' );
//     return stream && <StreamView stream={ stream } title="New mugs" />;
//
// The stream is the app's: the view neither starts nor leaves it. Its host sees the studio in it, to go live.
import { useEffect, useState } from "react";
import type { EasyStreamClient } from "@wordplus/realtime-client/streams";
import { EasyStreamApp, type EasyStreamAppProps } from "../components/streams/app.tsx";
import { configureUi } from "../host.ts";
import { direction, translator } from "../inc/translations.ts";
import type { SdkStream } from "./types.ts";

/** The engine under an SDK stream, for the views that take it: EasyStreamParts, for a stream's parts apart. */
export const streamEngine = ( stream: SdkStream ): EasyStreamClient => stream.engine as EasyStreamClient;

export interface StreamViewProps extends Omit<EasyStreamAppProps, "client" | "manage" | "preview" | "room" | "guests"> {
    stream: SdkStream;
    /** The page's language, two letters: the views' own translations (de es fr it nl pl hr he). The page's by default. */
    lang?: string;
    /** The app's own translations, by the English text, over the package's. */
    strings?: Record<string, string | string[]>;
}

/** The stream in one piece: the player, its chat beside it, and the studio for its host. */
export function StreamView( { stream, lang, strings, ...props }: StreamViewProps ) {
    const language = lang ?? ( typeof document !== "undefined" ? document.documentElement.lang || "en" : "en" );

    // Before the first view draws, and again when the language changes.
    useState( () => configureUi( translator( language, strings ) ) );
    useEffect( () => configureUi( translator( language, strings ) ), [ language, strings ] );

    // Guests on stage as the app's rule allows them: a signed-in viewer asks with a raised hand and the host invites from
    // the studio, wherever the grant's `stage` doesn't say no (the controls hold to it).
    return <div dir={ direction( language ) }>
        <EasyStreamApp { ...props } client={ streamEngine( stream ) } manage={ false } guests />
    </div>;
}
