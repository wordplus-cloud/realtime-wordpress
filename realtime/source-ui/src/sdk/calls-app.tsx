import React, { useSyncExternalStore, type ComponentType } from "react";
import CallScreen, { type CallLayout } from "../components/calls/call-screen.tsx";
import IncomingCallCard from "../components/calls/incoming-call-card.tsx";
import type { CallContextInterface } from "../components/calls/context.ts";
import { usePrivateCall } from "./use-private-call.ts";
import { useGroupCall } from "./use-group-call.ts";
import { infoOf, type SdkCall, type SdkGroupCall } from "./types.ts";
import type { CallsController, Showing } from "./controller.ts";
import { Piece } from "../pieces.tsx";

/**
 * What draws a call on the screen: ours (the kit's CallScreen), or an app's own copy of it (`npx @wordplus/realtime-ui
 * add call-screen`), given the call as usePrivateCall and useGroupCall run it, and the layout.
 */
export type CallView = ComponentType<{ call: CallContextInterface; layout: CallLayout | null }>;

/**
 * The call screen of a page on @wordplus/realtime: Better Messages' screens on the SDK's calls. The rings in a column
 * at the top corner, the call on the screen in its window, and a word when a call couldn't start or ended for a
 * reason worth saying. `view` draws the call in place of ours.
 */
export default function CallsApp( { controller, view = CallScreen }: { controller: CallsController, view?: CallView } ) {
    const shown = useSyncExternalStore( controller.subscribe, controller.snapshot, controller.snapshot );
    const close = ( notice: string | null ) => controller.closed( notice );

    return <>
        { shown.rings.length > 0 && <div className="realtime-call-rings">
            { shown.rings.map( ( ring ) => {
                const info = infoOf( ring.info );
                const props = { user_id: ring.from, name: info.name, type: ring.type,
                    onAnswer: () => void controller.answer( ring ), onReject: () => controller.decline( ring ) };
                return <div key={ ring.id } className="realtime-call-ring bm-toast-site-call" data-call={ ring.call } part="ring-card">
                    <Piece name="RingCard" props={ props }><IncomingCallCard { ...props } /></Piece>
                </div>;
            } ) }
        </div> }

        { shown.showing && <CallWindow showing={ shown.showing } close={ close } view={ view } /> }

        { shown.notice && <div className="realtime-call-notice" role="status">{ shown.notice }</div> }
    </>;
}

function CallWindow( { showing, close, view }: { showing: Showing, close: ( notice: string | null ) => void, view: CallView } ) {
    // A key per call, so a call that becomes a group call starts its screen afresh.
    // `.bm-call-surface` carries the stage's colours, as Better Messages' call surface does.
    return <div className="realtime-call-window bm-call-surface" part="call-window" data-layout={ showing.kind === 'call' ? 'private' : showing.type }>
        { showing.kind === 'call'
            ? <PrivateWindow key={ showing.call.id } call={ showing.call } peer={ showing.peer } close={ close } view={ view } adding={ { people: showing.people, addPerson: showing.add } } />
            : <GroupWindow key="group" group={ showing.group } type={ showing.type } close={ close } view={ view } adding={ { people: showing.people, addPerson: showing.add } } /> }
    </div>;
}

function PrivateWindow( { call, peer, close, adding, view: View }: { call: SdkCall, peer: { name: string; avatar?: string }, close: ( notice: string | null ) => void, adding: Parameters<typeof usePrivateCall>[ 3 ], view: CallView } ) {
    const context = usePrivateCall( call, peer, close, adding );
    return <View call={ context } layout="private" />;
}

function GroupWindow( { group, type, close, adding, view: View }: { group: SdkGroupCall, type: 'audio' | 'video', close: ( notice: string | null ) => void, adding: Parameters<typeof useGroupCall>[ 3 ], view: CallView } ) {
    const context = useGroupCall( group, type, close, adding );
    return <View call={ context } layout={ type === 'video' ? 'group-video' : 'group-audio' } />;
}
