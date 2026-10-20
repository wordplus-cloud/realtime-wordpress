import React from "react";
import { host, uiUser, type UserAvatarProps } from "../../host.ts";
import { _x, sprintf } from "../../inc/globals.ts";
import { usePieces } from "../../pieces.tsx";

/** A user's picture: the app's `Avatar` piece, or the host's, which Better Messages draws from its user store. */
export default function UserAvatar( props: UserAvatarProps ) {
    const Avatar = usePieces().Avatar ?? host().Avatar;

    return <Avatar { ...props } />;
}

/**
 * The picture the defaults draw, in Better Messages' markup (`.avatar.bbpm-avatar` around `img.avatar.avatar-{size}`)
 * so its styles fit: the name and picture the app's realtime server gave for the user, a blank of the avatar's shape
 * until it did.
 */
export function FallbackAvatar( props: UserAvatarProps ) {
    const user = uiUser( props.user_id );

    return <span className="avatar bbpm-avatar">
        { user?.avatar
            ? <img src={ user.avatar } className={ "avatar avatar-" + props.size } width={ props.size } height={ props.size }
                   alt={ sprintf( _x( 'Profile picture of %s', 'Messages List - Avatar Alt', 'bp-better-messages' ), user.name ) } />
            : <div className="bm-placeholder-wrapper" style={{ position: "relative", width: props.size, height: props.size, borderRadius: "var(--bm-radius-avatar)", overflow: "hidden" }}>
                <div className="bm-placeholder" />
            </div> }
    </span>;
}
