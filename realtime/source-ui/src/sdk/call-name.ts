/** A call's name for the page's user and another, from a template: `{pair}` the two ids in order, `{me}`, `{id}`. */
export function callName( template: string, me: string | null, id: string ): string {
    const pair = [ String( me ?? '' ), String( id ) ].sort().join( ':' );
    return template.replace( /\{pair\}/g, pair ).replace( /\{me\}/g, String( me ?? '' ) ).replace( /\{id\}/g, String( id ) );
}
