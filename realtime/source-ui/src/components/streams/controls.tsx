import {useState} from "react";
import {__} from "./i18n.ts";
import {useClient, useStream} from "./context.tsx";
import {Icon, type IconName} from "./icons.tsx";
import {DialogBox} from "./dialog.tsx";
import {offeredReactions} from "./reactions.ts";
import {EmojiGlyph} from "./emoji-glyph.tsx";
import {usePlayer} from "./player.tsx";
import {errorText, reactionName} from "./words.ts";

// What a viewer does under the picture, and the host's invitation on stage. The host's studio is
// studio.tsx.

function Toggle( props : { on : boolean, label : string, icon? : IconName, onChange : ( on : boolean ) => void, disabled? : boolean } ){
    return (
        <button
            type="button"
            className={ 'estream-button' + ( props.on ? ' estream-button--on' : ' estream-button--off' ) }
            aria-pressed={ props.on }
            disabled={ props.disabled }
            onClick={ () => props.onChange( ! props.on ) }
        >
            { props.icon && <Icon name={ props.icon } /> }
            { props.label }
        </button>
    );
}


// A viewer's controls: reactions, asking to come on stage (when the stream takes guests), and on
// stage, their devices.
export function ViewerControls( props : { guests? : boolean } ){
    const client = useClient();
    const state = useStream();
    const { appearance } = usePlayer();

    if( state.status !== 'ready' || state.stream?.state === 'ended' ) return null;

    const signedIn = state.you?.identity.startsWith( 'u:' );
    const live = state.stream?.state === 'live';
    // The page's word, and the cloud's, which holds to the grant (`stage`).
    const guests = props.guests !== false && state.you?.stage !== false;
    // None while the stream takes none (its setting, which can change during it).
    const reactions = state.reactionsOn ? offeredReactions( appearance ) : [];

    return (
        <>
            { reactions.length > 0 && (
                <div className="estream-reactions" role="group" aria-label={ __( 'Reactions', 'wordplus-stream' ) }>
                    { reactions.map( ( kind ) => (
                        <button key={ kind } type="button" className="estream-reaction" aria-label={ reactionName( kind ) } data-estream-tip={ reactionName( kind ) } onClick={ () => client.react( kind ) }>
                            <EmojiGlyph emoji={ kind } />
                        </button>
                    ) ) }
                </div>
            ) }

            { state.onStage ? (
                <>
                    <Toggle on={ state.devices.camera } icon={ state.devices.camera ? 'camera' : 'camera-off' } label={ __( 'Camera', 'wordplus-stream' ) } onChange={ ( on ) => void client.setCamera( on ) } />
                    <Toggle on={ state.devices.microphone } icon={ state.devices.microphone ? 'mic' : 'mic-off' } label={ __( 'Microphone', 'wordplus-stream' ) } onChange={ ( on ) => void client.setMicrophone( on ) } />
                    <button type="button" className="estream-button estream-button--danger" onClick={ () => void client.leaveStage() }>{ __( 'Leave stage', 'wordplus-stream' ) }</button>
                </>
            ) : signedIn && live && guests ? (
                <button type="button" className={ 'estream-button' + ( state.handRaised ? ' estream-button--on' : '' ) } aria-pressed={ state.handRaised } onClick={ () => void client.raiseHand( ! state.handRaised ) }>
                    <Icon name="hand" />
                    { state.handRaised ? __( 'Lower hand', 'wordplus-stream' ) : __( 'Ask to join on stage', 'wordplus-stream' ) }
                </button>
            ) : null }
        </>
    );
}

export function InviteDialog(){
    const client = useClient();
    const state = useStream();
    const [ error, setError ] = useState( '' );

    if( ! state.invited && ! error ) return null;

    if( error ){
        return (
            <DialogBox
                labelId="estream-invite-title"
                title={ __( 'You could not join the stage', 'wordplus-stream' ) }
                onCancel={ () => setError( '' ) }
                actions={ <button type="button" className="estream-button" onClick={ () => setError( '' ) }>{ __( 'OK', 'wordplus-stream' ) }</button> }
            >
                <p>{ error }</p>
            </DialogBox>
        );
    }

    return (
        <DialogBox
            labelId="estream-invite-title"
            title={ __( 'The host invites you on stage', 'wordplus-stream' ) }
            onCancel={ () => client.declineStage() }
            actions={ (
                <>
                    <button type="button" className="estream-button" onClick={ () => client.declineStage() }>{ __( 'Not now', 'wordplus-stream' ) }</button>
                    <button type="button" className="estream-button estream-button--primary" onClick={ async () => {
                        const reply = await client.acceptStage();
                        if( ! reply.ok ) setError( errorText( reply.error, __( 'Something went wrong', 'wordplus-stream' ) ) );
                    } }>{ __( 'Join stage', 'wordplus-stream' ) }</button>
                </>
            ) }
        >
            <p>{ __( 'Your camera and microphone will be live for everyone watching.', 'wordplus-stream' ) }</p>
        </DialogBox>
    );
}
