import {REACTIONS, REACTION_EMOJI, type Reaction} from "@wordplus/realtime-client/streams";
import type {Appearance} from "./appearance.ts";

// A reaction is its emoji, which the site chooses for its streams (Appearance.reactions). A name of before (heart,
// clap…), from a cloud or a site's settings of then, is taken as its emoji.

export const reactionIcon = ( kind : string ) : string => Object.prototype.hasOwnProperty.call( REACTION_EMOJI, kind ) ? REACTION_EMOJI[ kind ]! : kind;

// The most reactions a site offers.
export const REACTIONS_MAX = 12;

// The reactions the site offers, in its order, each once (the protocol's five where it chose none): those a viewer may
// send, and the only ones that rise over the picture, whatever else arrives.
export function offeredReactions( appearance : Appearance ) : Reaction[] {
    if( ! Array.isArray( appearance.reactions ) ) return [ ...REACTIONS ];

    const offered : Reaction[] = [];
    for( const kind of appearance.reactions ){
        if( typeof kind !== 'string' || kind === '' ) continue;
        const emoji = reactionIcon( kind );
        if( ! offered.includes( emoji ) ) offered.push( emoji );
    }
    return offered.slice( 0, REACTIONS_MAX );
}
