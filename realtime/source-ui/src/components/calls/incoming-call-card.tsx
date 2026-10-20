import React, { useEffect } from "react";
import UserAvatar from "../users/user-avatar.tsx";
import UserName from "../users/user-name.tsx";
import Tooltip from "../helpers/tooltip.tsx";
import Icon from "../../primitives/icon.tsx";
import { _x } from "../../inc/globals.ts";
import { rememberBeforeRing } from "./focus-return.ts";

/**
 * A call ringing for the user: who calls, audio or video, and Answer and Reject. Better Messages' on-site call toast
 * (its inc/toasts/incoming-call.tsx), moved with its markup: Better Messages puts it in the WordPlus SDK's toast stack,
 * an app on @wordplus/realtime in the package's own ring (elements).
 */
export default function IncomingCallCard( { user_id, name, type, fromThread, onAnswer, onReject }: {
    user_id: number | string,
    /** The caller's name when the host's user store has none yet. */
    name?: string,
    type: 'audio' | 'video',
    fromThread?: unknown,
    onAnswer: () => void,
    onReject: () => void,
} ) {
    // Where the user was as it rang, such as a chat composer, for the call to give the focus back to as it closes.
    useEffect( () => rememberBeforeRing(), [] );

    return <div className={"bm-toast-site-call-container"}>
        <div className={"bm-toast-site-call-avatar"}>
            <UserAvatar user_id={user_id} size={40} link={false} fromThread={fromThread} />
        </div>
        <div className={"bm-toast-site-call-info"}>
            <div className={"bm-toast-site-call-title"}>
                <UserName user_id={user_id} fallback={name} link={false} fromThread={fromThread} />
            </div>
            <div className={"bm-toast-site-call-content"}>
                <div className="bm-toast-site-call-text">
                    { type === 'video' && <>{ _x( 'Incoming Video Call', 'Private Call - On Site Message', 'bp-better-messages' ) }</> }
                    { type === 'audio' && <>{ _x( 'Incoming Audio Call', 'Private Call - On Site Message', 'bp-better-messages' ) }</> }
                </div>

                <Tooltip content={ _x( 'Answer', 'Private Call Screen', 'bp-better-messages' ) } zIndex={100003}>
                    <div className="bm-toast-site-call-action-answer" onClick={ onAnswer }>
                        <Icon name="phone" size={ 17 } />
                    </div>
                </Tooltip>
                <Tooltip content={ _x( 'Reject', 'Private Call Screen', 'bp-better-messages' ) } zIndex={100003}>
                    <div className="bm-toast-site-call-action-reject" onClick={ onReject }>
                        <Icon name="phone" size={ 17 } />
                    </div>
                </Tooltip>
            </div>
        </div>
    </div>;
}
