import { _x } from "../inc/globals.ts";
import { setUiUsers } from "../host.ts";
import type { CallPerson } from "../components/calls/context.ts";
import { infoOf, type CallUser, type SdkCall, type SdkCalls, type SdkGroupCall, type SdkIncoming } from "./types.ts";

const controllers = new WeakMap<SdkCalls, CallsController>();

/** What a refusal of the calls route means, for the console. */
const REFUSED: Record<string, string> = {
    forbidden: 'your calls() or groupCalls() rule answered no for this user and this call, or your server took them out of it a moment ago',
    no_user: 'nobody is signed in on this page, or the user id is one calls do not take',
    auth_failed: 'your calls route did not answer with a token: is it added on your server?',
    no_auth: 'the page has no calls route in its settings',
    bad_request: 'the call name or the person called is not one calls take',
};

/**
 * The page's one controller for its calls: the elements and a React CallScreen on the same page share it, so a call
 * rings once and shows once.
 */
export function controllerFor( calls: SdkCalls, options: { add?: boolean } = {} ): CallsController {
    let controller = controllers.get( calls );
    if ( ! controller ) controllers.set( calls, ( controller = new CallsController( calls, options ) ) );
    else if ( options.add !== undefined ) controller.setAdd( options.add );
    return controller;
}

/** What is on the screen: a call between two people, or a group call, and how it adds people. */
export type Showing =
    | { kind: 'call'; call: SdkCall; peer: { name: string; avatar?: string }; people?: () => Promise<CallPerson[]>; add?: ( person: CallPerson ) => Promise<void> }
    | { kind: 'group'; group: SdkGroupCall; name: string; type: 'audio' | 'video'; title: string; people?: () => Promise<CallPerson[]>; add?: ( person: CallPerson ) => Promise<void> };

export interface CallsView {
    rings: SdkIncoming[];
    showing: Showing | null;
    notice: string | null;
    /** The spot in the page the call on the screen shows in (`spot()`), or null for the window in the corner. */
    spot: HTMLElement | null;
    /**
     * Whether the chat beside the call shows, where its spot is a chat's (`spot()` with `chat`): the call's Show Chat and
     * Hide Chat (`showChat()`). Null for any other place.
     */
    chat: boolean | null;
}

/** The name of the call on the screen: a call's, or the group call's. */
export function showingName( showing: Showing | null ): string | null {
    return showing === null ? null : showing.kind === 'call' ? showing.call.name : showing.name;
}

/**
 * A call a plugin's own screen takes in place of ours (`own()`): one ringing for the user, one the page placed, or a
 * group call it joined. The plugin answers, shows and ends it on the SDK's own objects.
 */
export type OwnedCall =
    | { kind: 'ring'; incoming: SdkIncoming }
    | { kind: 'call'; call: SdkCall }
    | { kind: 'group'; group: SdkGroupCall };

/** A call's name pattern as the server's rules write it (`support:{a}:{b}`): each `{name}` one part between colons. */
export function namePattern( pattern: string ): RegExp {
    const source = pattern.split( /(\{[^}]+\})/ ).map( ( part ) => /^\{[^}]+\}$/.test( part ) ? '[^:]+' : part.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) ).join( '' );
    return new RegExp( '^' + source + '$' );
}

/**
 * The page's calls as the screens show them, with the SDK's call screen's behaviour: every call ringing here gets a
 * ring, one call is on the screen at a time and a call ringing during it is answered busy, a call that becomes a group
 * call goes on in its room, and a call that can't start says why for a moment. Add Person is offered where the app
 * lists whom a user may add (`add`).
 */
export class CallsController {
    private view: CallsView = { rings: [], showing: null, notice: null, spot: null, chat: null };
    private readonly listeners = new Set<() => void>();
    private readonly placers = new Set<() => void>();
    /** The page's spots for calls (spot()), each ranked by how closely it names them: 2 a name, 1 a pattern, 0 every call. */
    private spots: Array<{ pattern: RegExp; element: HTMLElement; rank: number; chat: boolean }> = [];
    private noticeTimer: ReturnType<typeof setTimeout> | null = null;
    private owners: Array<{ pattern: RegExp; take: ( call: OwnedCall ) => void }> = [];

    /**
     * Hands the calls whose names match `pattern` (`support:{a}:{b}`) to a plugin's own screen, in place of ours: their
     * rings, the calls the page places, the group calls it joins. Better Messages' calls are its own and never come
     * here. Answers a function that takes the claim back.
     */
    own( pattern: string | RegExp, take: ( call: OwnedCall ) => void ): () => void {
        const owner = { pattern: typeof pattern === 'string' ? namePattern( pattern ) : pattern, take };
        this.owners.push( owner );
        return () => void ( this.owners = this.owners.filter( ( o ) => o !== owner ) );
    }

    /**
     * Shows the calls whose names match `pattern` (`match:{a}:{b}`, a call's name, or every call for null) in `element`,
     * in place of the window in the corner: a call moves in when it starts or once the element is on the page, and back
     * to the window when the element goes, going on throughout. The spot that names a call most closely wins: its name,
     * then a pattern, then a spot for every call, and the latest of those alike, so a page's spot for its own call wins
     * over a layout's spot for every call whichever came first. `chat`: the spot sits beside a chat, which the call's
     * controls show and hide (`view.chat`). Answers a function that takes it back.
     */
    spot( pattern: string | RegExp | null, element: HTMLElement, options: { chat?: boolean } = {} ): () => void {
        const rank = pattern === null ? 0 : typeof pattern === 'string' && ! /\{[^}]+\}/.test( pattern ) ? 2 : 1;
        const spot = { pattern: pattern === null ? /^/ : typeof pattern === 'string' ? namePattern( pattern ) : pattern, element, rank, chat: !! options.chat };
        this.spots.push( spot );
        this.respot();
        return () => {
            this.spots = this.spots.filter( ( s ) => s !== spot );
            this.respot();
        };
    }

    /**
     * Hears where the call goes, as soon as it changes, before the page goes on: the screen moves its window then, so a
     * spot leaving the page hands the call back before the spot is taken out.
     */
    onPlace = ( placer: () => void ) => {
        this.placers.add( placer );
        return () => void this.placers.delete( placer );
    };

    /**
     * Shows or hides the chat beside the call, where the call is in a chat's spot: a value, or a function of the one it
     * has, as React's setState takes it.
     */
    showChat = ( shown: boolean | ( ( shown: boolean ) => boolean ) ) => {
        if ( this.view.chat === null ) return;
        const next = typeof shown === 'function' ? shown( this.view.chat ) : shown;
        if ( next !== this.view.chat ) this.set( { chat: next } );
    };

    private spotOf( showing: Showing | null ) {
        const name = showingName( showing );
        if ( name === null ) return null;
        let best: ( typeof this.spots )[ number ] | null = null;
        for ( const spot of this.spots ) if ( spot.pattern.test( name ) && ( ! best || spot.rank >= best.rank ) ) best = spot;
        return best;
    }

    private respot(): void {
        if ( ( this.spotOf( this.view.showing )?.element ?? null ) !== this.view.spot ) this.set( {} );
    }

    private ownerOf( name: string ) {
        return this.owners.find( ( owner ) => owner.pattern.test( name ) );
    }

    constructor( readonly calls: SdkCalls, private options: { add?: boolean } = {} ) {
        calls.on( 'incoming', ( incoming: SdkIncoming ) => this.ring( incoming ) );
    }

    /** Whether to offer Add Person, from the next call on. */
    setAdd( add: boolean | undefined ): void {
        this.options = { ...this.options, add };
    }

    subscribe = ( listener: () => void ) => {
        this.listeners.add( listener );
        return () => void this.listeners.delete( listener );
    };

    snapshot = () => this.view;

    get busy(): boolean {
        return this.view.showing !== null;
    }

    /** Calls `to` about `name`: what `<call-button>` does. */
    async place( name: string, to: CallUser, type: 'audio' | 'video', peer: { name: string; avatar?: string } ): Promise<void> {
        const owner = this.ownerOf( name );
        if ( this.busy && ! owner ) return;
        setUiUsers( [ [ to, peer ] ] );
        try {
            const call = await this.calls.start( name, { to, type } );
            if ( owner ) return owner.take( { kind: 'call', call } );
            this.showCall( call, peer );
        } catch ( error ) {
            this.refused( error );
        }
    }

    /** Joins the group call `name`: what `<room-button>` does. */
    async join( name: string, type: 'audio' | 'video', title: string ): Promise<void> {
        const owner = this.ownerOf( name );
        if ( this.busy && ! owner ) return;
        try {
            const group = await this.calls.group( name, { type } );
            if ( owner ) return owner.take( { kind: 'group', group } );
            this.set( { showing: { kind: 'group', group, name, type, title, ...this.adding( name, group ) } } );
        } catch ( error ) {
            this.refused( error );
        }
    }

    async answer( incoming: SdkIncoming ): Promise<void> {
        this.dropRing( incoming );
        const info = infoOf( incoming.info );
        try {
            const answered = await incoming.accept();
            if ( incoming.group ) {
                const group = answered as SdkGroupCall;
                this.set( { showing: { kind: 'group', group, name: incoming.call, type: incoming.type, title: '', ...this.adding( incoming.call, group ) } } );
            } else {
                this.showCall( answered as SdkCall, { name: info.name ?? '', avatar: info.avatar } );
            }
        } catch ( error ) {
            this.refused( error );
        }
    }

    decline( incoming: SdkIncoming ): void {
        this.dropRing( incoming );
        void incoming.decline().catch( () => {} );
    }

    /** The call on the screen is over: `notice`, if any, says why for a moment. */
    closed( notice: string | null ): void {
        this.set( { showing: null } );
        if ( notice ) this.say( notice );
    }

    private showCall( call: SdkCall, peer: { name: string; avatar?: string } ): void {
        // Someone was added: the call goes on as a group call in its room, on the same screen.
        call.on( 'group', ( group: SdkGroupCall ) => {
            this.set( { showing: { kind: 'group', group, name: call.name, type: call.type, title: '', ...this.adding( call.name, group ) } } );
        } );
        this.set( { showing: { kind: 'call', call, peer, ...this.adding( call.name, call ) } } );
    }

    /** Add Person, where the app lists whom a user may add: those it lists, rung into the call. */
    private adding( name: string, target: { add?( user: CallUser ): Promise<unknown> } ) {
        if ( ! this.options.add || ! target.add ) return {};
        return {
            people: () => this.calls.people( name ),
            add: async ( person: CallPerson ) => {
                setUiUsers( [ [ person.id, { name: person.name, avatar: person.avatar } ] ] );
                await target.add!( person.id );
            },
        };
    }

    private ring( incoming: SdkIncoming ): void {
        // A plugin's own screen rings for its own calls.
        const owner = this.ownerOf( incoming.call );
        if ( owner ) {
            owner.take( { kind: 'ring', incoming } );
            return;
        }
        // Already in a call: the caller hears this user is busy.
        if ( this.busy ) {
            void incoming.decline( 'busy' ).catch( () => {} );
            return;
        }
        const info = infoOf( incoming.info );
        setUiUsers( [ [ incoming.from, { name: info.name ?? '', avatar: info.avatar } ] ] );
        incoming.on( 'over', () => this.dropRing( incoming ) );
        this.set( { rings: [ ...this.view.rings, incoming ] } );
    }

    private dropRing( incoming: SdkIncoming ): void {
        this.set( { rings: this.view.rings.filter( ( ring ) => ring !== incoming ) } );
    }

    private refused( error: unknown ): void {
        const code = ( error as { code?: string } | null )?.code;
        // For the developer, who otherwise sees a notice for the user alone and no reason (an SDK review, 2026-10-14).
        console.warn( 'wordplus-realtime: a call did not start (' + ( code ?? 'error' ) + ')' + ( REFUSED[ code ?? '' ] ? ': ' + REFUSED[ code ?? '' ] : '' ), error );
        this.say( code === 'forbidden'
            ? _x( 'You cannot make this call', 'Call Screen', 'bp-better-messages' )
            : _x( 'This call could not be connected', 'Call Screen', 'bp-better-messages' ) );
    }

    private say( notice: string ): void {
        if ( this.noticeTimer ) clearTimeout( this.noticeTimer );
        this.set( { notice } );
        this.noticeTimer = setTimeout( () => this.set( { notice: null } ), 4000 );
    }

    private set( change: Partial<CallsView> ): void {
        const view = { ...this.view, ...change };
        const spot = this.spotOf( view.showing );
        // A chat's spot shows its chat beside the call as the call comes in, and then as the user leaves it.
        view.chat = spot?.chat ? ( spot.element === this.view.spot && view.chat !== null ? view.chat : true ) : null;
        view.spot = spot?.element ?? null;
        this.view = view;
        this.placers.forEach( ( place ) => place() );
        this.listeners.forEach( ( listener ) => listener() );
    }
}
