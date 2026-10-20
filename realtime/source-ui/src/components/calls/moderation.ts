import type { CallContextInterface } from "./context.ts";
import { host } from "../../host.ts";

/**
 * What a moderator does to one person from their tile, each a request to the call's server through the context's
 * `moderate`: its answer, or false once its error is shown. A tile runs each through its pending actions
 * (inc/calls/pending.ts), which turn a second click away while the first waits. The audio and video grids' tiles ask
 * the same, each naming its call's type.
 */
/**
 * Whether a call takes the moderator act `act`: every one where it lists none (the context's `moderation`), as Better
 * Messages' calls do. A control for an act the call doesn't take isn't drawn.
 */
export function moderates( moderation: CallContextInterface['moderation'], act: string ): boolean {
    return ! moderation || moderation.includes( act );
}

export function useModerationActs( moderate: CallContextInterface['moderate'], type: 'audio' | 'video' ) {
    const act = async ( name: string, identity: string ) => {
        try{
            return await moderate({ act: name, identity, type });
        } catch (e) {
            host().showError( e )
            return false;
        }
    }

    return {
        kickUser   : ( key: string ) => act( 'remove_participant', key ),
        muteUser   : ( key: string ) => act( 'mute_participant', key ),
        unmuteUser : ( key: string ) => act( 'unmute_participant', key ),
        muteMic    : ( key: string ) => act( 'mute_mic', key ),
        unmuteMic  : ( key: string ) => act( 'unmute_mic', key ),
        pinUser    : ( key: string ) => act( 'pin_participant', key ),
        unpinUser  : ( key: string ) => act( 'unpin_participant', key ),
    };
}
