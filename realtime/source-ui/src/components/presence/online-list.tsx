import React, { type ReactNode } from "react";
import Icon, { type IconName } from "../../primitives/icon.tsx";
import Tooltip from "../../primitives/tooltip.tsx";
import Btn from "../../inc/helpers/btn.tsx";
import { _x } from "../../inc/globals.ts";

// Who is online: Better Messages' chat-room members column (its chat-online-users.tsx), its rows (its member rows in
// conversation-admin.tsx) and the live count on its online-users toggle. Views only: whoever draws them gives the
// people, their rows' contents and what may be done with them. Better Messages keeps its roster, its moderation menu
// and where the column sits; an app passes the people of a presence room.
//
// Styles: styles/presence/_online-list.scss.

export interface OnlineListProps {
    /** How many are listed, for the title. */
    count: number;
    /** The rows: a PersonRow each, or the host's own. */
    children?: ReactNode;
    /** The title before the count: "Online" by default. */
    title?: ReactNode;
    /** A close button in the title, where the list can be closed. */
    onClose?: () => void;
    /** Over what it sits beside, where docking it would leave that too narrow. */
    overlay?: boolean;
    /** What it says with nobody in it: "No users online" by default. */
    empty?: ReactNode;
}

export function OnlineList( { count, children, title, onClose, overlay, empty }: OnlineListProps ) {
    return (
        <div className="bm-chat-online" data-overlay={ overlay ? 1 : undefined }>
            <div className="bm-chat-online__title">
                <span>{ title ?? _x( "Online", "Chat Room Screen", "bp-better-messages" ) } ({ count })</span>
                { onClose && (
                    <Btn className="bm-chat-online__close" onClick={ onClose }
                         aria-label={ _x( "Close", "\"Close\" Button Tooltip", "bp-better-messages" ) }>
                        <Icon name="x" size={ 15 } />
                    </Btn>
                ) }
            </div>
            <div className="bm-chat-online__list">
                { children }
                { count === 0 && (
                    <div className="bm-chat-online__empty">
                        { empty ?? _x( "No users online", "Chat Room Screen", "bp-better-messages" ) }
                    </div>
                ) }
            </div>
        </div>
    );
}

export interface PersonRowProps {
    /** The avatar, with its dot: an Avatar, or the host's own. */
    avatar: ReactNode;
    /** The name, and any badge beside it. */
    name: ReactNode;
    /** The line under the name ("You", a role). */
    sub?: ReactNode;
    /** What may be done with the person, at the end of the row: a call button, a menu. */
    actions?: ReactNode;
    /** Anything placed after the row's contents, such as an open menu. */
    children?: ReactNode;
}

export function PersonRow( { avatar, name, sub, actions, children }: PersonRowProps ) {
    return (
        <div className="bm-conv-admin__member" part="online-row">
            <span className="bm-conv-admin__member-avatar">{ avatar }</span>
            <span className="bm-conv-admin__member-body">
                <span className="bm-conv-admin__member-name">{ name }</span>
                <span className="bm-conv-admin__member-sub">{ sub }</span>
            </span>
            { actions }
            { children }
        </div>
    );
}

export interface RowActionProps {
    icon: IconName;
    /** What it does, in its tooltip and for screen readers. */
    label: string;
    onClick: ( event: React.MouseEvent ) => void;
    className?: string;
}

/** Something to do with a person, at the end of their row (a call): Better Messages' directory row action. */
export function RowAction( { icon, label, onClick, className }: RowActionProps ) {
    return (
        <Tooltip label={ label }>
            <Btn className={ "bm-row-action" + ( className ? " " + className : "" ) } aria-label={ label }
                 onClick={ ( e: React.MouseEvent ) => { e.stopPropagation(); onClick( e ); } }>
                <Icon name={ icon } size={ 16 } />
            </Btn>
        </Tooltip>
    );
}

/** A live count, as Better Messages' online-users toggle wears it: nothing at 0, 99+ past 99. */
export function OnlineCount( { count, className }: { count: number; className?: string } ) {
    if ( count <= 0 ) return null;
    return <span className={ "bm-online-count" + ( className ? " " + className : "" ) }>{ count > 99 ? "99+" : count }</span>;
}
