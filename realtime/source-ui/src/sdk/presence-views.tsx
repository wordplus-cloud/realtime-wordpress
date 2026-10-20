import React, { type ReactNode } from "react";
import { ActivityIndicator, Avatar } from "../components/presence/presence.tsx";
import { OnlineCount as Count, OnlineList as List, PersonRow } from "../components/presence/online-list.tsx";
import { host } from "../host.ts";
import { _x } from "../inc/globals.ts";
import { plainName } from "../inc/names.ts";
import { personOf, useProfiles, useRoom, useTyping, type RoomMember, type SdkRooms } from "./rooms.ts";
import { Piece, PiecesProvider, type Pieces } from "../pieces.tsx";

// Presence on the SDK's rooms: Better Messages' online column, typing line and count, fed by a presence room of the
// app's. Each takes the page's `rt` (connect()'s Realtime, or a WordPress page's room client) and the room's name, and
// joins the room while it is on the screen.

export interface RoomPerson extends RoomMember {
    name: string;
    avatar?: string;
}

export interface RoomOnlineProps {
    rt: SdkRooms | null | undefined;
    /** A presence room of the app's (`presence: true` in its server's rule). */
    room: string;
    /** The title before the count: "Online" by default. */
    title?: ReactNode;
    /** What may be done with a member, at the end of their row: a call button. Not for the page's own user. */
    actions?: ( member: RoomPerson ) => ReactNode;
    onClose?: () => void;
    /** What it says with nobody in it. */
    empty?: ReactNode;
    /** The app's own row in place of ours (`OnlineRow`), or its avatar (pieces.tsx). */
    components?: Pieces;
}

/** Who is in a presence room now, each with their picture, their name, their role when the room gives one. */
export function RoomOnline( { components, ...props }: RoomOnlineProps ) {
    return <PiecesProvider pieces={ components }><OnlineRows { ...props } /></PiecesProvider>;
}

function OnlineRows( { rt, room, title, actions, onClose, empty }: Omit<RoomOnlineProps, "components"> ) {
    const view = useRoom( rt, room );
    const profiles = useProfiles( rt, view.members.map( ( m ) => m.id ) );
    const me = rt?.user ?? null;

    return (
        <List count={ view.members.length } title={ title } onClose={ onClose } empty={ empty }>
            { view.members.map( ( member ) => {
                const person = personOf( member.id, member.info, profiles );
                const mine = member.id === me;
                const role = typeof member.info.role === "string" ? member.info.role : "";
                const offered = ! mine && actions
                    ? <span className="bm-conv-admin__member-actions">{ actions( { ...member, name: person.name, avatar: person.avatar } ) }</span>
                    : null;
                return (
                    <Piece key={ member.id } name="OnlineRow"
                           props={ { member: { id: member.id, name: person.name, avatar: person.avatar, info: member.info }, mine, actions: offered } }>
                        <PersonRow
                            avatar={ <Avatar user={ person } size={ 32 } presence="online" title="" /> }
                            name={ plainName( person.name ) }
                            sub={ mine ? _x( "You", "Conversation admin", "bp-better-messages" ) : role }
                            actions={ offered }
                        />
                    </Piece>
                );
            } ) }
        </List>
    );
}

export interface RoomTypingProps {
    rt: SdkRooms | null | undefined;
    room: string;
    /** The event the room's typing goes by: `typing` by default, `{ on: true }` and `{ on: false }`. */
    event?: string;
    compact?: boolean;
}

/** Who is typing in a room now, by name, as Better Messages says it; nothing while nobody is. */
export function RoomTyping( { rt, room, event = "typing", compact }: RoomTypingProps ) {
    const view = useRoom( rt, room );
    const writers = useTyping( rt, view.room, event );
    const profiles = useProfiles( rt, writers );
    if ( writers.length === 0 ) return null;

    const info = ( id: string ) => view.members.find( ( m ) => m.id === id )?.info ?? {};
    const entries = writers.map( ( id ) => {
        const name = personOf( id, info( id ), profiles ).name;
        return { name: name ? host().nameHtml( name ) : null, activity: "typing" as const };
    } );
    return <ActivityIndicator entries={ entries } compact={ compact } />;
}

export interface RoomCountProps {
    rt: SdkRooms | null | undefined;
    room: string;
    className?: string;
}

/** How many are in a room now: its live count, or its members. */
export function RoomCount( { rt, room, className }: RoomCountProps ) {
    const view = useRoom( rt, room );
    return <Count count={ view.count ?? view.members.length } className={ className } />;
}
