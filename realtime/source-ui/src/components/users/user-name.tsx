import React from "react";
import { host, uiUser, type UserNameProps } from "../../host.ts";
import { usePieces } from "../../pieces.tsx";

/** A user's name: the app's `Name` piece, or the host's, which Better Messages writes from its user store. */
export default function UserName( props: UserNameProps ) {
    const Name = usePieces().Name ?? host().Name;

    return <Name { ...props } />;
}

/** The name the defaults write, as Better Messages marks it up: the one the app's realtime server gave. */
export function FallbackName( props: UserNameProps ) {
    return <span className="bm-uname">{ uiUser( props.user_id )?.name ?? props.fallback ?? "" }</span>;
}
