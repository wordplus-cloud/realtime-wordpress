import {useId, useState, type ReactNode, type RefObject} from "react";
import {__, _x, sprintf} from "./i18n.ts";
import {Chat} from "./chat.tsx";
import {count, dateTime, relative, timeOfDay} from "./format.ts";
import {Icon} from "./icons.tsx";
import {useNow} from "./player.tsx";
import {Stage} from "./stage.tsx";
import {CopyField, Guests, StudioBar, StudioBody, StudioStatus, useStudio} from "./studio.tsx";

// The studio as a page of its own, where a host goes live with room for everything at once (the WordPress
// plugin's Easy Stream → Studio): the picture large with the controls under it, and beside it the chat, the
// guests and the stream's details in tabs. Its parts are the studio card's (studio.tsx), laid out for a window.

export interface StudioPageOptions {
    // Back to the studio's list of streams.
    back? : string;
    // The page viewers watch the stream on; '' when none shows it yet.
    page? : string;
    // The stream's settings, for those who may change them.
    settings? : string;
    // Makes the stream a page of its own (POST, with `nonce`): for a stream no page shows yet.
    createPage? : string;
    nonce? : string;
}

type Tab = 'chat' | 'guests' | 'stream';

// The stream's page made for it, its address answered.
async function makePage( url : string, nonce? : string ) : Promise<string> {
    const res = await fetch( url, { method: 'POST', credentials: 'same-origin', headers: nonce ? { 'X-WP-Nonce': nonce } : {} } );
    const body = await res.json().catch( () => null ) as { url? : unknown, message? : unknown } | null;
    if( ! res.ok || typeof body?.url !== 'string' ) throw new Error( typeof body?.message === 'string' ? body.message : '' );
    return body.url;
}

// The stream's details: where viewers watch it and its link to share, when it is planned, its settings.
function StreamTab( props : { options : StudioPageOptions, page : string, onPage : ( url : string ) => void, scheduled? : number | null } ){
    const [ making, setMaking ] = useState( false );
    const [ failed, setFailed ] = useState( '' );
    const { options } = props;

    const create = async () => {
        if( ! options.createPage ) return;
        setMaking( true );
        setFailed( '' );
        try {
            props.onPage( await makePage( options.createPage, options.nonce ) );
        } catch ( e ) {
            setFailed( ( e as Error ).message || __( 'The page could not be made.', 'wordplus-stream' ) );
        } finally {
            setMaking( false );
        }
    };

    return (
        <div className="estream-studio-page__details">
            <section>
                <h2 className="estream-studio-page__heading">{ __( 'Where viewers watch', 'wordplus-stream' ) }</h2>
                { props.page ? (
                    <>
                        <CopyField label={ __( 'Link to share', 'wordplus-stream' ) } value={ props.page } />
                        <a className="estream-button estream-button--quiet" href={ props.page } target="_blank" rel="noopener noreferrer">
                            <Icon name="external" />
                            { __( 'Open the page', 'wordplus-stream' ) }
                        </a>
                    </>
                ) : (
                    <>
                        <p className="estream-studio-page__note">{ __( 'No page shows this stream yet, so nobody can watch it.', 'wordplus-stream' ) }</p>
                        { options.createPage && (
                            <button type="button" className="estream-button estream-button--primary" disabled={ making } onClick={ () => void create() }>
                                { making ? __( 'Making the page…', 'wordplus-stream' ) : __( 'Create a page for this stream', 'wordplus-stream' ) }
                            </button>
                        ) }
                        { failed && <p className="estream-controls__error" role="alert">{ failed }</p> }
                    </>
                ) }
            </section>

            { props.scheduled ? (
                <section>
                    <h2 className="estream-studio-page__heading">{ __( 'Planned', 'wordplus-stream' ) }</h2>
                    <p className="estream-studio-page__note">{ dateTime( props.scheduled ) }</p>
                </section>
            ) : null }

            <section>
                <h2 className="estream-studio-page__heading">{ __( 'Streaming from OBS', 'wordplus-stream' ) }</h2>
                <p className="estream-studio-page__note">{ __( 'Choose "Stream from OBS" under the picture for the server and key to enter in OBS.', 'wordplus-stream' ) }</p>
            </section>

            { options.settings && (
                <a className="estream-button estream-button--quiet" href={ options.settings }>
                    <Icon name="settings" />
                    { __( 'Stream settings', 'wordplus-stream' ) }
                </a>
            ) }
        </div>
    );
}

export function StudioPage( props : { options : StudioPageOptions, chat : boolean, guests : boolean, root : RefObject<HTMLElement | null>, children? : ReactNode } ){
    const studio = useStudio();
    const { state, player, live, ended, sending, error } = studio;
    const [ tab, setTab ] = useState<Tab>( props.chat ? 'chat' : 'stream' );
    const [ page, setPage ] = useState( props.options.page ?? '' );
    const now = useNow( 30000 );
    const id = useId();
    const asking = state.hands.length;
    const stream = state.stream;

    const tabs : Array<{ key : Tab, label : string, badge? : number }> = [
        ...( props.chat ? [ { key: 'chat' as Tab, label: __( 'Chat', 'wordplus-stream' ) } ] : [] ),
        ...( props.guests ? [ { key: 'guests' as Tab, label: __( 'Guests', 'wordplus-stream' ), badge: asking } ] : [] ),
        { key: 'stream', label: _x( 'Stream', 'the tab with the stream\'s details', 'wordplus-stream' ) }
    ];

    const when = live && stream?.started_at ? sprintf( _x( 'Live since %s', 'a time of day', 'wordplus-stream' ), timeOfDay( stream.started_at ) )
        : ended && stream?.ended_at ? sprintf( _x( 'Ended %s', 'a time, as "5 minutes ago"', 'wordplus-stream' ), relative( stream.ended_at, now ) )
            : player.scheduled && player.scheduled > now ? sprintf( _x( 'Starts %s', 'a date and time', 'wordplus-stream' ), dateTime( player.scheduled ) )
                : __( 'Not live', 'wordplus-stream' );

    return (
        <div className="estream-studio-page">
            <header className="estream-studio-page__head">
                { props.options.back && (
                    <a className="estream-studio-page__back" href={ props.options.back } aria-label={ __( 'Back to your streams', 'wordplus-stream' ) } data-estream-tip={ __( 'Back to your streams', 'wordplus-stream' ) }>
                        <Icon name="arrow-left" />
                    </a>
                ) }
                <div className="estream-studio-page__name">
                    <h1 className="estream-studio-page__title">{ player.title || __( 'Studio', 'wordplus-stream' ) }</h1>
                    { when && <p className="estream-studio-page__when">{ when }</p> }
                </div>
                <span className="estream-studio-page__spacer" />
                { page && (
                    <a className="estream-button estream-button--quiet" href={ page } target="_blank" rel="noopener noreferrer">
                        <Icon name="external" />
                        { __( 'View page', 'wordplus-stream' ) }
                    </a>
                ) }
            </header>

            <div className="estream-studio-page__body">
                <main className="estream-studio-page__main">
                    <div ref={ props.root as RefObject<HTMLDivElement | null> } className={ 'estream-studio-page__picture' + ( player.fullscreen ? ' estream-studio-page__picture--full' : '' ) }>
                        <Stage studio />
                    </div>
                    {/* Right under the picture, which nothing here moves: while live, what matters at a glance, where the
                        host's eyes are; the bar with Go live; then what the moment needs (setting up, OBS), as long as
                        it is, scrolling the column under the picture where it doesn't fit. */}
                    <div className="estream-studio-page__controls">
                        { live && (
                            <div className="estream-studio-page__stats" role="group" aria-label={ __( 'Statistics', 'wordplus-stream' ) }>
                                <StudioStatus stats={ sending } tally />
                            </div>
                        ) }
                        <StudioBar studio={ studio } />
                        { error && <p className="estream-controls__error" role="alert">{ error }</p> }
                        <StudioBody studio={ studio } />
                    </div>
                </main>

                <aside className="estream-studio-page__side">
                    <div className="estream-studio-page__tabs" role="tablist" aria-label={ __( 'Studio', 'wordplus-stream' ) }>
                        { tabs.map( ( t ) => (
                            <button
                                key={ t.key }
                                type="button"
                                role="tab"
                                id={ id + t.key }
                                aria-selected={ tab === t.key }
                                aria-controls={ id + 'panel' }
                                className={ 'estream-studio-page__tab' + ( tab === t.key ? ' estream-studio-page__tab--on' : '' ) }
                                onClick={ () => setTab( t.key ) }
                            >
                                { t.label }
                                { t.badge ? <span className="estream-studio-page__badge">{ count( t.badge ) }</span> : null }
                            </button>
                        ) ) }
                    </div>
                    <div className={ 'estream-studio-page__panel estream-studio-page__panel--' + tab } role="tabpanel" id={ id + 'panel' } aria-labelledby={ id + tab }>
                        { tab === 'chat' && <Chat /> }
                        { tab === 'guests' && (
                            <Guests empty={ (
                                <p className="estream-studio-page__note">
                                    { live
                                        ? __( 'Nobody has asked to join the stage yet. Viewers who are logged in ask from the page of the stream, and you invite them here.', 'wordplus-stream' )
                                        : __( 'Once you are live, viewers can ask to join you on stage, and you invite them here.', 'wordplus-stream' ) }
                                </p>
                            ) } />
                        ) }
                        { tab === 'stream' && <StreamTab options={ props.options } page={ page } onPage={ setPage } scheduled={ player.scheduled } /> }
                    </div>
                </aside>
            </div>
            { props.children }
        </div>
    );
}
