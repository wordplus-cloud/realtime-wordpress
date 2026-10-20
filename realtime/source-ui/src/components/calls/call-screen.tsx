import React, { type Dispatch, type SetStateAction } from "react";
import { CallContext, type CallContextInterface } from "./context.ts";
import Tooltip from "../helpers/tooltip.tsx";
import Icon from "../../primitives/icon.tsx";
import { _x } from "../../inc/globals.ts";
import PrivateCallLayout from "./private-call.tsx";
import GroupVideoCallLayout from "./group-video-call.tsx";
import GroupAudioCallLayout from "./group-audio-call.tsx";
import { PiecesProvider, type Pieces } from "../../pieces.tsx";

export type CallLayout = 'private' | 'group-video' | 'group-audio';

/**
 * A call on the screen: its layout (a call between two, a group video call, a group audio call) drawn from `call`,
 * which whoever runs the call provides. `chatToggle` (the prop, or the context's), where the call sits beside a chat,
 * draws the chevron that hides and shows it. `components`, the host's own pieces in place of ours (pieces.tsx). Better
 * Messages' call container renders this.
 */
export default function CallScreen( { call, layout, chatToggle, components }: {
    call: CallContextInterface,
    layout: CallLayout | null,
    chatToggle?: Dispatch<SetStateAction<boolean>> | null,
    components?: Pieces,
} ) {
    return <PiecesProvider pieces={ components }><CallLayoutOf call={ call } layout={ layout } chatToggle={ chatToggle } /></PiecesProvider>;
}

function CallLayoutOf( { call, layout, chatToggle: toggleProp }: {
    call: CallContextInterface,
    layout: CallLayout | null,
    chatToggle?: Dispatch<SetStateAction<boolean>> | null,
} ) {
    const chatToggle = toggleProp ?? call.chatToggle ?? null;
    let containerClass = 'bm-call-wrap';

    if( layout === 'group-video' ){
        containerClass += ' bm-call-wrap-group';
    }

    if( layout === 'group-audio' ){
        containerClass += ' bm-group-audio-call-container';
    }

    return <CallContext.Provider value={ call }>
        <div className={containerClass} ref={ call.wrapper }>
            {/* The handle on the call's bottom edge in the single-column
                layout, where the chat stacks under the call. Beside the chat
                the toggle is the dock's Show Chat / Hide Chat instead, and
                Better Messages' _call-surface.scss keeps this one out of that
                layout: at the middle of the call's edge it lay over whatever
                reached it, a tile's moderator row, a roster avatar, the own
                picture. Not in full screen in either: the call is the
                full-screen element, and the chat it would open is outside it. */}
            { ( chatToggle && ! call.fullScreenEnabled ) &&
                <Tooltip content={_x('Toggle Chat Screen', 'Calling Features - Toggle Chat Screen', 'bp-better-messages')}>
                <span onClick={() => {
                    chatToggle((prev: boolean) => !prev);
                }} className={"bm-switch-chat"}>
                    <Icon name="chevronL" size={ 14 } />
                </span>
            </Tooltip> }

            { layout === 'private' && <PrivateCallLayout /> }
            { layout === 'group-video' && <GroupVideoCallLayout /> }
            { layout === 'group-audio' && <GroupAudioCallLayout /> }
        </div>
    </CallContext.Provider>;
}
