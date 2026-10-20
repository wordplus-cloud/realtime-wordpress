/**
 * A ring that brings someone into a group call: a call between two people becomes one when either of them rings a third
 * person in (`Call.add()`), and everyone in it may ring more (`GroupCall.add()`). The person is rung on every tab they have
 * open, as for a call, until they answer and arrive in the room, turn it down, it runs out after 45 seconds, or the one
 * who rang calls it off.
 */
import { Listeners, type Listener } from '../channel.js';
import type { CallUser } from '../calls/users.js';

/** How a ring into a group call stands: still ringing, or how it ended. */
export type InviteState = 'ringing' | 'answered' | 'rejected' | 'busy' | 'no_answer' | 'cancelled';

const STATES: InviteState[] = ['ringing', 'answered', 'rejected', 'busy', 'no_answer', 'cancelled'];

export const inviteState = (value: unknown): InviteState | null => (STATES.includes(value as InviteState) ? (value as InviteState) : null);

/** One ring into a group call, as everyone in it hears of it. Event: `state` (InviteState), at each change. */
export class Invite {
    readonly id: string;
    /** The group call it rings into: the id of the call it was made from. */
    readonly group: string;
    /** Who rang, and whom. */
    readonly from: CallUser | null;
    readonly to: CallUser;
    state: InviteState;
    private readonly listeners = new Listeners();
    private canceller: (() => Promise<void>) | null = null;

    constructor(m: { id: string; group: string; from?: CallUser | null; to: CallUser; state?: InviteState }) {
        this.id = m.id;
        this.group = m.group;
        this.from = m.from ?? null;
        this.to = m.to;
        this.state = m.state ?? 'ringing';
    }

    on(event: 'state', fn: Listener): this {
        this.listeners.on(event, fn);
        return this;
    }

    off(event: 'state', fn?: Listener): this {
        this.listeners.off(event, fn);
        return this;
    }

    /** Calls it off while it rings: from the page that rang only. */
    cancel(): Promise<void> {
        if (this.state !== 'ringing') return Promise.resolve();
        if (!this.canceller) return Promise.reject(Object.assign(new Error('forbidden'), { code: 'forbidden' }));
        return this.canceller();
    }

    /** @internal The page that rang can call it off. */
    own(canceller: () => Promise<void>): void {
        this.canceller = canceller;
    }

    /** @internal */
    update(state: InviteState): void {
        // A ring that ended stays ended, whichever word of it arrives last.
        if (this.state === state || this.state !== 'ringing') return;
        this.state = state;
        this.listeners.fire('state', [state], false);
    }
}
