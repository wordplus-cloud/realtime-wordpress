import type {StreamState} from "@wordplus/realtime-client/streams";

// A stream's schedule: the times it is planned to go live, each a session with its start and its own title, so one
// stream can be a show that goes live again and again, each time named and counted down to (the WordPress plugin's
// sessions). Which one is on air, and which comes next, follows from the stream's state and the time.

// A session: when it is planned to go live, in ms, and its own title, none or '' for the stream's.
export interface StreamSession {
    at : number;
    title? : string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// How long past its start a session stays the next one, for the viewers of a host who is late.
export const SESSION_KEPT_MS = 12 * HOUR;

// A stream that goes live up to this long before a session's start goes live for it.
export const SESSION_EARLY_MS = HOUR;

// How long the viewers of a session that ended are thanked, before the countdown to the next.
export const THANKS_MS = 15 * MINUTE;

export interface Schedule {
    // The session the stream is on air for, or has just ended: null where none was planned then.
    current : StreamSession | null;
    // The session to come: after the one that ended, else the first not yet past.
    next : StreamSession | null;
    // Whether the countdown to `next` shows now, rather than the stream on air or the thanks for the one that ended.
    counting : boolean;
}

// The session a stream that went live at `started` went live for: of those starting up to an hour after it or up to
// 12 hours before it, the nearest.
function sessionAt( planned : StreamSession[], started : number ) : StreamSession | null {
    let found : StreamSession | null = null;

    for( const session of planned ){
        if( session.at - SESSION_EARLY_MS <= started && started < session.at + SESSION_KEPT_MS && ( ! found || Math.abs( session.at - started ) < Math.abs( found.at - started ) ) ){
            found = session;
        }
    }

    return found;
}

// Where the stream is in its schedule at `now`.
export function scheduleOf( sessions : readonly StreamSession[], stream : Pick<StreamState, 'state' | 'started_at' | 'ended_at'> | null, now : number ) : Schedule {
    const planned = sessions.filter( ( s ) => Number.isFinite( s.at ) && s.at > 0 ).sort( ( a, b ) => a.at - b.at );
    const current = stream && stream.state !== 'idle' && stream.started_at ? sessionAt( planned, stream.started_at ) : null;

    if( stream?.state === 'live' ){
        return { current, next: planned.find( ( s ) => s.at > ( current?.at ?? now ) ) ?? null, counting: false };
    }

    // After the end, and after the session it went live for, though that ended before its start (gone live early).
    if( stream?.state === 'ended' ){
        const ended = stream.ended_at ?? now;
        const next = planned.find( ( s ) => s.at > ended && s.at > ( current?.at ?? 0 ) && s.at > now - SESSION_KEPT_MS ) ?? null;
        return { current, next, counting: next !== null && now - ended >= THANKS_MS };
    }

    const next = planned.find( ( s ) => s.at > now - SESSION_KEPT_MS ) ?? null;
    return { current: null, next, counting: next !== null };
}
