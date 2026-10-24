import {useEffect, useRef, type RefObject} from "react";
import type {EasyStreamClient} from "@wordplus/realtime-client/streams";
import {EasyStreamProvider, chatReached, useStream} from "./context.tsx";
import {Stage} from "./stage.tsx";
import {Chat} from "./chat.tsx";
import {HostNote} from "./host-note.tsx";
import {Info} from "./info.tsx";
import {InviteDialog} from "./controls.tsx";
import {Studio} from "./studio.tsx";
import {PlayerProvider, usePlayer, useShortcuts, type StreamTexts} from "./player.tsx";
import {ConfirmProvider} from "./dialog.tsx";
import {ShortcutList} from "./shortcuts.tsx";
import {themeClass, themeStyle, type Appearance} from "./appearance.ts";
import type {StreamSession} from "./sessions.ts";

export interface EasyStreamAppProps {
    client : EasyStreamClient;
    title? : string;
    scheduled? : number | null;
    // Its sessions, each a planned start and its own title (sessions.ts), in place of `scheduled` alone.
    sessions? : StreamSession[];
    // The stream's page, to share and put in calendars: the page's own address by default.
    url? : string;
    // Where a visitor who may not write logs in to chat.
    loginUrl? : string;
    // The image before the stream starts.
    cover? : string;
    // A still stream for a settings page (the embed's preview): nothing reaches beyond the player.
    preview? : boolean;
    // The site's logo may be dragged into place and sized over the host's own picture before going live, and the page
    // saves where (the logo's `estream-logo-move` and `estream-logo-size`): the WordPress plugin's studio, for those
    // who may change how streams look.
    placeLogo? : boolean;
    // Whether viewers may ask to come on stage (default false: guests on stage aren't in the first release).
    guests? : boolean;
    // Whether the stream has chat (default true).
    chat? : boolean;
    appearance? : Appearance;
    // Where a host goes live with more room: the WordPress plugin's studio, for those who host the stream.
    studioUrl? : string;
    // Where the site is connected to the cloud, for a host whose page is unconnected (the WordPress plugin's Licence page).
    connectUrl? : string;
    // The stream's Better Messages chat room, where that is its chat: Better Messages' placeholder for it.
    room? : string;
    // The stream's own words in place of the player's.
    texts? : StreamTexts;
    // Start the client on mount and stop it on unmount (default true).
    manage? : boolean;
}

interface FrameProps {
    root : RefObject<HTMLDivElement | null>;
    guests : boolean;
    appearance : Appearance;
    studioHere? : boolean;
}

function Frame( props : FrameProps ){
    const state = useStream();
    const player = usePlayer();
    const shortcuts = useShortcuts( player );
    // A host goes live in the studio the page names (the WordPress plugin's, in the admin), shown the way to it over
    // the stream, or in the page's own Studio part, which their picture then shows the host's moments for; only a page
    // that names no studio (another platform's) carries the studio in the stream itself.
    const hosting = state.you?.role === 'host';
    const host = hosting && ! player.studioUrl;
    const hostScreens = host || ( hosting && Boolean( props.studioHere ) );
    const chat = player.hasChat && ! player.chatHidden;

    // The theme root carries the colours, so the dialog has them too, and it is what goes full screen, the
    // dialog with it. The dialog sits outside the shell: a container-query box would confine a fixed
    // overlay to itself.
    return (
        <div
            ref={ props.root }
            className={ themeClass( props.appearance, player.videoShape ) + ( player.fullscreen ? ' estream-theme--full' : '' ) }
            style={ themeStyle( props.appearance ) }
            onKeyDown={ shortcuts }
        >
            <ConfirmProvider>
                <HostNote hidden={ props.studioHere } />
                <div className="estream-shell">
                    <div className={ 'estream-app' + ( host ? ' estream-app--host' : '' ) + ( chat ? '' : ' estream-app--no-chat' ) }>
                        <div className="estream-app__main">
                            <Stage studio={ hostScreens } />
                            <Info guests={ props.guests } />
                            { host && <Studio /> }
                        </div>
                        { chat && <aside className="estream-app__side"><Chat /></aside> }
                    </div>
                </div>
                <InviteDialog />
                <ShortcutList />
            </ConfirmProvider>
        </div>
    );
}

// The stream in one piece, inside an EasyStreamProvider: on its own (EasyStreamApp), or among parts of the same
// stream on a page (parts.tsx).
// `studioHere`: the page has the stream's studio as a part of its own (the Studio block), which a host goes live from.
export function AllInOne( props : Omit<EasyStreamAppProps, 'client' | 'manage'> & { guests : boolean, chat : boolean, appearance : Appearance, studioHere? : boolean } ){
    const state = useStream();
    const root = useRef<HTMLDivElement>( null );

    return (
        <PlayerProvider
            root={ root }
            title={ props.title }
            scheduled={ props.scheduled }
            sessions={ props.sessions }
            url={ props.url }
            loginUrl={ props.loginUrl }
            cover={ props.cover }
            preview={ props.preview }
            placeLogo={ props.placeLogo }
            appearance={ props.appearance }
            studioUrl={ props.studioUrl }
            connectUrl={ props.connectUrl }
            room={ props.room }
            texts={ props.texts }
            chat={ props.chat && chatReached( state ) }
        >
            <Frame root={ root } guests={ props.guests } appearance={ props.appearance } studioHere={ props.studioHere } />
        </PlayerProvider>
    );
}

// The whole thing: the stream, chat beside it, and the studio for a host.
export function EasyStreamApp( props : EasyStreamAppProps ){
    const { client, manage = true } = props;

    useEffect( () => {
        if( ! manage ) return;
        void client.start();
        return () => client.stop();
    }, [ client, manage ] );

    return (
        <EasyStreamProvider client={ client }>
            <AllInOne
                title={ props.title }
                scheduled={ props.scheduled }
                sessions={ props.sessions }
                url={ props.url }
                loginUrl={ props.loginUrl }
                cover={ props.cover }
                preview={ props.preview }
                placeLogo={ props.placeLogo }
                guests={ props.guests ?? false }
                chat={ props.chat ?? true }
                appearance={ props.appearance ?? {} }
                studioUrl={ props.studioUrl }
                connectUrl={ props.connectUrl }
                room={ props.room }
                texts={ props.texts }
            />
        </EasyStreamProvider>
    );
}
