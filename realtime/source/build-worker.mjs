// The two scripts every plugin ships, each one file with socket.io-client bundled in, as a classic script,
// since a SharedWorker of a module needs a newer browser:
//   dist/realtime-worker.js  the connector's SharedWorker (tsc's dist/worker.js)
//   dist/realtime.min.js     the page script every product shares (dist/script.js): the package as
//                                     window.wordplusRealtimeClient
// Run by `npm run build`, after tsc. The page script is named .min.js so the optimisation plugins that
// minify a page's scripts leave it as it is. The worker needs no such name: no page loads it with a tag.
//
// And those the realtime SDK's PHP package carries for calls, apart so a page that places no call loads
// none of them (the call screen is @wordplus/realtime-ui's realtime-ui.min.js, since protocol 3):
//   dist/realtime-calls.min.js        calls and group calls (dist/script-calls.js), window.wordplusRealtimeCalls,
//                                              riding the page script's channels(): no socket.io-client of its own
//   dist/realtime-rooms.min.js        the mesh's room client, WordPlus Mesh's @wordplus/rtc-client as it is
//                                              built (vendor/), window.WordPlusRTC, loaded when a room is needed
//   dist/realtime-rooms-e2ee.worker.js   its worker that encrypts and decrypts every frame of an encrypted room,
//                                              started only for one
//   dist/realtime-streams.min.js      live streams (dist/script-streams.js: Easy Stream's engine),
//                                              window.wordplusRealtimeStreams, loaded on a page's first stream
//
// And dist/THIRD-PARTY-NOTICES.txt: the licence of every package the scripts bundle, as rollup bundled them, and the
// room client's licence and NOTICE. Every copy of the scripts carries it beside them. A bundled package without a
// licence file stops the build.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { minify } from 'terser';

const root = dirname( fileURLToPath( import.meta.url ) );
const { version } = JSON.parse( readFileSync( join( root, 'package.json' ), 'utf8' ) );

/** The third-party packages the scripts bundle, by their folder: the package, and which scripts carry it. */
const bundled = new Map();

/** Notes the packages under node_modules among a bundle's modules, as rollup resolved them. */
function noteBundled( out, modules ){
    for( const id of modules ){
        const path = id.replace( /^\0/, '' ).split( '?' )[ 0 ];
        const at = path.lastIndexOf( '/node_modules/' );
        if( at < 0 ) continue;
        const parts = path.slice( at + '/node_modules/'.length ).split( '/' );
        const name = parts[ 0 ].startsWith( '@' ) ? parts[ 0 ] + '/' + parts[ 1 ] : parts[ 0 ];
        const dir = path.slice( 0, at ) + '/node_modules/' + name;
        if( ! bundled.has( dir ) ) bundled.set( dir, { pkg: JSON.parse( readFileSync( join( dir, 'package.json' ), 'utf8' ) ), scripts: new Set() } );
        bundled.get( dir ).scripts.add( out.replace( /^dist\//, '' ) );
    }
}

/** A package's licence text: its LICENSE, LICENCE or COPYING file. */
function licenceOf( dir, name ){
    const file = readdirSync( dir ).find( ( f ) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test( f ) );
    if( ! file ) throw new Error( `${ name } is bundled but has no licence file in ${ dir }. Nothing more was built.` );
    return readFileSync( join( dir, file ), 'utf8' ).replace( /\r\n?/g, '\n' ).trim();
}

async function bundle( input, out, name, what, includes = 'Includes socket.io-client (MIT).', plugins = [] ){
    const built = await rollup( {
        input: join( root, input ),
        plugins: [ ...plugins, resolve( { browser: true, exportConditions: [ 'browser' ] } ), commonjs() ],
        onwarn: ( warning, warn ) => {
            // socket.io-client's debug calls are compiled out of its browser build, which leaves `this` at its top.
            if( warning.code === 'THIS_IS_UNDEFINED' ) return;
            warn( warning );
        },
    } );
    const { output } = await built.generate( { format: 'iife', name } );
    await built.close();
    noteBundled( out, Object.keys( output[ 0 ].modules ) );

    const { code } = await minify( output[ 0 ].code, { ecma: 2020, compress: true, mangle: true } );
    const banner = '/*! @wordplus/realtime-client ' + version + ': ' + what + '. Copyright (c) 2026 WordPlus, MIT License.' + ( includes ? ' ' + includes : '' ) + ' */\n';
    writeFileSync( join( root, out ), banner + code );
    console.log( out + ': ' + Math.round( ( banner + code ).length / 1024 ) + ' KB' );
}

await bundle( 'dist/worker.js', 'dist/realtime-worker.js', 'wordplusRealtimeWorker', 'the connector\'s SharedWorker' );
await bundle( 'dist/script.js', 'dist/realtime.min.js', 'wordplusRealtimeScript', 'the page script every WordPlus product shares, window.wordplusRealtimeClient', 'Includes socket.io-client and @noble/ciphers (MIT).' );
// A classic script can't split a module off: its stream engine is the streams script, loaded on a page's first stream
// (streams-engine-script.ts in streams-engine.ts's place).
const streamsByScript = { name: 'streams-by-script', resolveId( source, importer ){
    if( importer?.includes( '/dist/sdk-calls/' ) && source === './streams-engine.js' ) return join( root, 'dist/sdk-calls/streams-engine-script.js' );
    return null;
} };
await bundle( 'dist/script-calls.js', 'dist/realtime-calls.min.js', 'wordplusRealtimeCallsScript', 'calls and group calls for any plugin, window.wordplusRealtimeCalls', '', [ streamsByScript ] );

// The streams script: Easy Stream's engine, whose connector is the page script's, so its chat rides the page's one
// connection (the engine keeps `@wordplus/realtime-client` bare for this, as Easy Stream's own build swaps it).
const pageConnector = { name: 'page-connector', resolveId( source ){
    return source === '@wordplus/realtime-client' ? '\0page-connector' : null;
}, load( id ){
    return id === '\0page-connector' ? 'export const realtime = ( ...args ) => globalThis.wordplusRealtimeClient.realtime( ...args );' : null;
} };
await bundle( 'dist/script-streams.js', 'dist/realtime-streams.min.js', 'wordplusRealtimeStreamsScript', 'live streams for the calls script, window.wordplusRealtimeStreams (Easy Stream\'s engine)', '', [ pageConnector ] );

// The mesh's room client as WordPlus Mesh builds it (@wordplus/rtc-client: livekit-client 2.22.2 with
// vendor/rtc-client-2.22.2.patch), already minified, with its licence named: a modified Apache-2.0 client SDK,
// whose NOTICE (upstream's and what we changed) is in the package.
const MESH_CLIENT = 'wordplus-rtc-client-1.0.13';
const MESH = '@wordplus/rtc-client ' + MESH_CLIENT.slice( 'wordplus-rtc-client-'.length );
const umd = execFileSync( 'tar', [ '-xzOf', join( root, 'vendor', MESH_CLIENT + '.tgz' ), 'package/dist/rtc-client.umd.js' ], { maxBuffer: 16 << 20 } ).toString( 'utf8' );
const rooms = '/*! @wordplus/realtime-client ' + version + ': the mesh\'s room client, ' + MESH_CLIENT + ' (WordPlus Mesh), window.WordPlusRTC. A modified client SDK, Apache License 2.0, Copyright 2021 LiveKit, Inc. */\n' + umd;
writeFileSync( join( root, 'dist/realtime-rooms.min.js' ), rooms );
console.log( 'dist/realtime-rooms.min.js: ' + Math.round( rooms.length / 1024 ) + ' KB' );

// Its encryption worker, as the mesh builds it: a classic script, which a page starts as a Worker for an encrypted room.
const e2ee = '/*! @wordplus/realtime-client ' + version + ': the mesh\'s room client\'s encryption worker, ' + MESH_CLIENT + ' (WordPlus Mesh). A modified client SDK, Apache License 2.0, Copyright 2021 LiveKit, Inc. */\n'
    + execFileSync( 'tar', [ '-xzOf', join( root, 'vendor', MESH_CLIENT + '.tgz' ), 'package/dist/rtc-client.e2ee.worker.js' ], { maxBuffer: 16 << 20 } ).toString( 'utf8' );
writeFileSync( join( root, 'dist/realtime-rooms-e2ee.worker.js' ), e2ee );
console.log( 'dist/realtime-rooms-e2ee.worker.js: ' + Math.round( e2ee.length / 1024 ) + ' KB' );

// The notices: what each script bundles, then each package's licence, the room client's NOTICE and licence last, and
// the room client's own notices for what its build bundles, once its package carries them (THIRD-PARTY-NOTICES.*).
// Every text with plain line ends, whatever its package wrote, so each copy of the notices is the same file.
const fromMesh = ( file ) => execFileSync( 'tar', [ '-xzOf', join( root, 'vendor', MESH_CLIENT + '.tgz' ), 'package/' + file ] ).toString( 'utf8' ).replace( /\r\n?/g, '\n' ).trim();
const meshNotices = execFileSync( 'tar', [ '-tzf', join( root, 'vendor', MESH_CLIENT + '.tgz' ) ] ).toString( 'utf8' ).split( '\n' )
    .find( ( f ) => /^package\/THIRD-PARTY-NOTICES(\.(md|txt))?$/i.test( f ) );
if( ! meshNotices ) console.warn( `${ MESH_CLIENT } carries no THIRD-PARTY-NOTICES of what it bundles: the rooms script's notices name the client SDK alone.` );
const rule = '='.repeat( 80 );
const packages = [ ...bundled.entries() ].sort( ( a, b ) => a[ 1 ].pkg.name.localeCompare( b[ 1 ].pkg.name ) );
const named = ( pkg ) => `${ pkg.name } ${ pkg.version } (${ pkg.license })`;
const notices = [
    `Third-party software in the scripts of @wordplus/realtime-client ${ version }`,
    '',
    ...packages.map( ( [ , { pkg, scripts } ] ) => `- ${ named( pkg ) }: in ${ [ ...scripts ].sort().join( ', ' ) }` ),
    `- ${ MESH } (Apache-2.0), a modified livekit-client 2.22.2, and what it bundles: realtime-rooms.min.js, realtime-rooms-e2ee.worker.js`,
    '',
    ...packages.flatMap( ( [ dir, { pkg } ] ) => [ rule, named( pkg ), rule, '', licenceOf( dir, pkg.name ), '' ] ),
    rule, `${ MESH } (Apache-2.0): NOTICE`, rule, '', fromMesh( 'NOTICE' ), '',
    rule, `${ MESH } (Apache-2.0): LICENSE`, rule, '', fromMesh( 'LICENSE' ), '',
    ...( meshNotices ? [ rule, `${ MESH }: what it bundles`, rule, '', fromMesh( meshNotices.slice( 'package/'.length ) ), '' ] : [] ),
].join( '\n' );
writeFileSync( join( root, 'dist/THIRD-PARTY-NOTICES.txt' ), notices );
console.log( 'dist/THIRD-PARTY-NOTICES.txt: ' + packages.map( ( [ , { pkg } ] ) => pkg.name ).join( ', ' ) + ', @wordplus/rtc-client' );
