// The package's build:
//
// - dist/index.js and dist/calls.js: the screens as ES modules for an app's bundler (React and the libraries they use
//   stay imports, so the app's own copies serve them), the two entries over shared chunks;
// - dist/types: their declarations;
// - dist/calls.css, dist/presence.css and dist/chat.css: the call screens', presence's and chat's stylesheets, compiled
//   for apps;
// - dist/realtime-ui.min.js: the elements (src/elements.tsx), one script with React, the styles and the languages
//   inside, for any page: @wordplus/realtime's rt.callScreen() loads it;
// - dist/THIRD-PARTY-NOTICES.txt: every package that script bundles, with its licence in full. Every copy of the script
//   carries it beside it. A bundled package without a licence file stops the build.
//
// The stylesheets carry Better Messages' design tokens (styles/_tokens.scss, a copy of its assets/css/_tokens.scss),
// but only those the screens read, and those they read in turn: the whole file is its design customiser's colour
// matrices too, 220 KB that no screen of this package uses.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as sass from 'sass';

const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );
const pkg = JSON.parse( readFileSync( join( root, 'package.json' ), 'utf8' ) );
const external = [ ...Object.keys( pkg.peerDependencies ), ...Object.keys( pkg.dependencies ), 'react/jsx-runtime', 'react-dom/client' ];

rmSync( join( root, 'dist' ), { recursive: true, force: true } );
mkdirSync( join( root, 'dist' ), { recursive: true } );

// The stylesheets first: the elements' script carries its own as text.
const compile = ( file ) => sass.compile( join( root, file ), { style: 'expanded', silenceDeprecations: [ 'import', 'global-builtin', 'color-functions' ] } ).css;
const screens = [ 'styles/calls/_call-stage.scss', 'styles/calls/_incoming-call.scss', 'styles/calls/_add-person.scss' ].map( compile ).join( '\n' );
const presence = [ 'styles/presence/_presence.scss', 'styles/presence/_online-list.scss' ].map( compile ).join( '\n' );
// The chat's stylesheets use the tokens' mixins (bm-zone-surface), which Better Messages' stylesheet has in scope
// from its own _tokens.scss before it imports them: here they get the package's copy's mixins first, and nothing
// else of it (a mixin writes nothing until it is included).
const tokenMixins = mixinsOf( readFileSync( join( root, 'styles/_tokens.scss' ), 'utf8' ) );
const withMixins = ( file ) => sass.compileString( tokenMixins + `\n@import "${ file.replace( /^styles\//, '' ).replace( /\/_/, '/' ).replace( /\.scss$/, '' ) }";`, {
    loadPaths: [ join( root, 'styles' ) ], style: 'expanded', silenceDeprecations: [ 'import', 'global-builtin', 'color-functions' ],
} ).css;
const chat = [ 'styles/chat/_messages.scss', 'styles/chat/_reactions.scss', 'styles/chat/_composer.scss', 'styles/chat/_chat.scss' ].map( withMixins ).join( '\n' );
const chrome = compile( 'styles/_elements.scss' );
const tokens = compile( 'styles/_tokens.scss' );

// What the screens' markup sets inline (an avatar's radius) reads tokens too.
const sources = ( dir ) => readdirSync( dir ).flatMap( ( name ) => statSync( join( dir, name ) ).isDirectory() ? sources( join( dir, name ) ) : [ join( dir, name ) ] );
const markup = sources( join( root, 'src' ) ).map( ( file ) => readFileSync( file, 'utf8' ) ).join( '\n' );

// An app's calls.css carries the window, the rings and the tooltip floater too (the elements' chrome), which the
// React CallScreen draws in the page itself.
writeFileSync( join( root, 'dist/calls.css' ), usedTokens( tokens, screens + chrome + markup ) + '\n' + screens + '\n' + chrome );
writeFileSync( join( root, 'dist/presence.css' ), usedTokens( tokens, presence + markup ) + '\n' + presence );
writeFileSync( join( root, 'dist/chat.css' ), usedTokens( tokens, chat + markup ) + '\n' + chat );
// The live streams' stylesheet, Easy Stream's own: its --estream-* properties on its theme
// root, none of Better Messages' tokens. Easy Stream's WordPress build compiles the same source itself.
const streamsCss = compile( 'styles/streams/_streams.scss' );
writeFileSync( join( root, 'dist/streams.css' ), streamsCss );

// In a shadow root there is no :root, and no body to read a theme from: the tokens go on the host.
const elementsCss = hostOf( usedTokens( tokens, screens + presence + chat + chrome + markup ) ) + '\n' + screens + '\n' + presence + '\n' + chat + '\n' + chrome;

// The entries over shared chunks, so the host, the pieces and the device registry are one each however many entries a
// page imports: the root, which Better Messages' free build uses too, the call screens, which it never does, the React
// components on the SDK (react), the fakes for tests (testing), and the elements as an ES module (elements), what an
// app's own elements script is built from with its copies of the views given to setViews() (`npx @wordplus/realtime-ui
// add`, wordplus-ui.elements.tsx): its copies import the root and /calls, and must meet the same host and pieces.
await build( {
    entryPoints: {
        index: join( root, 'src/index.ts' ), calls: join( root, 'src/calls.ts' ), react: join( root, 'src/react.tsx' ),
        testing: join( root, 'src/testing.ts' ), elements: join( root, 'src/elements.tsx' ),
        streams: join( root, 'src/streams.ts' ),
    },
    outdir: join( root, 'dist' ),
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2021',
    jsx: 'automatic',
    external,
    sourcemap: true,
    plugins: [ elementsCssPlugin(), protocolPlugin() ],
    logLevel: 'warning',
} );

const elements = await build( {
    entryPoints: [ join( root, 'src/elements.tsx' ) ],
    outfile: join( root, 'dist/realtime-ui.min.js' ),
    metafile: true,
    bundle: true,
    format: 'iife',
    globalName: 'wordplusRealtimeUi',
    platform: 'browser',
    target: 'es2021',
    jsx: 'automatic',
    minify: true,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [ elementsCssPlugin() ],
    logLevel: 'warning',
} );

// The elements' script is what any page loads for a call (rt.callScreen()): the live streams' views and their languages
// stay out of it, which took it from 774 KB to 964 KB once (their words were in the shared languages, 9dbc364).
const streamInputs = Object.keys( elements.metafile.inputs ).filter( ( input ) => /src\/(components\/streams|languages\/streams|inc\/stream-languages|stream-elements)/.test( input ) );
if ( streamInputs.length ) throw new Error( `realtime-ui.min.js takes in the live streams' ${ streamInputs.join( ', ' ) }. Nothing more was built.` );

// The live streams' elements (src/stream-elements.tsx), a script of their own that @wordplus/realtime's
// rt.streamScreen() loads: React, the views, their stylesheet and their languages inside. The stream's engine is the
// page's own, under its calls, never a copy in here.
const streamElements = await build( {
    entryPoints: [ join( root, 'src/stream-elements.tsx' ) ],
    outfile: join( root, 'dist/realtime-ui-streams.min.js' ),
    metafile: true,
    bundle: true,
    format: 'iife',
    globalName: 'wordplusRealtimeStreams',
    platform: 'browser',
    target: 'es2021',
    jsx: 'automatic',
    minify: true,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [ elementsCssPlugin(), protocolPlugin(), streamLanguagesPlugin() ],
    logLevel: 'warning',
} );
const engineInputs = Object.keys( streamElements.metafile.inputs ).filter( ( input ) => /realtime-client\/(src|dist)\/streams\/client\.|rtc-client|livekit/.test( input ) );
if ( engineInputs.length ) throw new Error( `realtime-ui-streams.min.js takes in the stream's engine: ${ engineInputs.join( ', ' ) }. Nothing more was built.` );

// What each script may weigh at most, minified: what any page loads for a call, and what a page with a stream adds. A
// change that grows one past it stops the build, to be looked at before the limit is raised. The streams' was 650,000
// until the player's statistics, quality by layer and offline notice came with their words in the eight languages
// (661 KB, 171 KB gzipped), and 700,000 until the host could drag the sharer's camera over a shared screen (3.6 KB more,
// 702.6 KB in all), and 720,000 until OBS's steps said where its Keyframe Interval is and the studio said when its key
// frames come far apart, in the eight languages (13.1 KB more, 727 KB in all), and 740,000 until those steps named
// Max B-frames and said the numbers are a starting point to try, and the studio said when OBS sends too few frames a
// second (15.5 KB more, 742.5 KB in all), and 760,000 until the engine watched for a hardware encoder dropping the
// camera's frames, and the studio set up a host's preview before their site is connected and said when OBS stopped
// sending, in the eight languages (760.7 KB in all). The one for calls was 800,000 until a call could show in the page
// (<call-spot>) and in its chat (<chat-room to call>), with the chat's bar for the other person (10 KB more, 805 KB in
// all).
const BUDGETS = { 'realtime-ui.min.js': 820_000, 'realtime-ui-streams.min.js': 780_000 };
for ( const [ file, most ] of Object.entries( BUDGETS ) ) {
    const size = statSync( join( root, 'dist', file ) ).size;
    if ( size > most ) throw new Error( `dist/${ file } is ${ size } bytes, over its ${ most }. Nothing more was built.` );
}

/**
 * The views take four constants of the stream's protocol from @wordplus/realtime-client/streams (CHAT_MAX, REACTIONS,
 * REACTION_EMOJI, CHOSEN_MAX_SIDE), whose entry is the engine too: in every build, that entry is its protocol module
 * alone, from the package's own copy of the client (vendor/realtime-client, scripts/client.mjs), so neither the stream
 * elements' script nor dist/streams.js carries the engine or imports a package that isn't published.
 */
function protocolPlugin() {
    return {
        name: 'protocol-only',
        setup( b ) {
            b.onResolve( { filter: /^@wordplus\/realtime-client\/streams$/ }, () => ( { path: join( root, 'vendor/realtime-client/streams/protocol.js' ) } ) );
        },
    };
}

function streamLanguagesPlugin() {
    return {
        name: 'stream-languages',
        setup( b ) {
            // The shared languages are Better Messages' screens' words, which no stream view asks for: the views' words
            // are in their own domain (src/languages/streams/). Empty tables in their place keep 87 KB out.
            b.onLoad( { filter: /src\/languages\/[a-z]{2}\.json$/ }, () => ( { contents: '{}', loader: 'json' } ) );
        },
    };
}

/** The stylesheets as the text `virtual:elements-css` and `virtual:streams-css` import. */
function elementsCssPlugin() {
    return {
        name: 'elements-css',
        setup( b ) {
            b.onResolve( { filter: /^virtual:(elements|streams)-css$/ }, ( args ) => ( { path: args.path.slice( 'virtual:'.length ), namespace: 'virtual' } ) );
            b.onLoad( { filter: /.*/, namespace: 'virtual' }, ( args ) => ( { contents: args.path === 'streams-css' ? streamsCss : elementsCss, loader: 'text' } ) );
        },
    };
}

// The notices: the packages the two scripts bundle, as esbuild read them, each with its licence in full, with plain
// line ends whatever its package wrote, so each copy of the notices is the same file.
const bundled = new Map();
for ( const input of [ ...Object.keys( elements.metafile.inputs ), ...Object.keys( streamElements.metafile.inputs ) ] ) {
    const at = input.lastIndexOf( 'node_modules/' );
    if ( at < 0 ) continue;
    const parts = input.slice( at + 'node_modules/'.length ).split( '/' );
    const name = parts[ 0 ].startsWith( '@' ) ? parts[ 0 ] + '/' + parts[ 1 ] : parts[ 0 ];
    const dir = join( process.cwd(), input.slice( 0, at ), 'node_modules', name );
    if ( ! bundled.has( dir ) ) bundled.set( dir, JSON.parse( readFileSync( join( dir, 'package.json' ), 'utf8' ) ) );
}
// A package that ships no licence file of its own but names another's: react-property's README gives React's licence,
// as its code is taken from React's.
const LICENCE_OF = { 'react-property': 'react' };
const licenceOf = ( dir, name ) => {
    if ( LICENCE_OF[ name ] ) {
        const from = join( dir, '..', LICENCE_OF[ name ] );
        return `(${ name } carries ${ LICENCE_OF[ name ] }'s licence, as its README says.)\n\n` + licenceOf( from, LICENCE_OF[ name ] );
    }
    const file = readdirSync( dir ).find( ( f ) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test( f ) );
    if ( ! file ) throw new Error( `${ name } is bundled but has no licence file in ${ dir }. Nothing more was built.` );
    return readFileSync( join( dir, file ), 'utf8' ).replace( /\r\n?/g, '\n' ).trim();
};
const rule = '='.repeat( 80 );
const packages = [ ...bundled.entries() ].sort( ( a, b ) => a[ 1 ].name.localeCompare( b[ 1 ].name ) );
const named = ( p ) => `${ p.name } ${ p.version } (${ typeof p.license === 'string' ? p.license : 'see its licence' })`;
writeFileSync( join( root, 'dist/THIRD-PARTY-NOTICES.txt' ), [
    `Third-party software in realtime-ui.min.js and realtime-ui-streams.min.js, @wordplus/realtime-ui ${ pkg.version }`,
    '',
    ...packages.map( ( [ , p ] ) => `- ${ named( p ) }` ),
    '',
    ...packages.flatMap( ( [ dir, p ] ) => [ rule, named( p ), rule, '', licenceOf( dir, p.name ), '' ] ),
].join( '\n' ) );

execFileSync( join( root, 'node_modules/.bin/tsc' ), [ '-p', join( root, 'tsconfig.json' ) ], { stdio: 'inherit' } );

console.log( 'built dist/index.js, dist/calls.js, dist/react.js, dist/testing.js, dist/types, dist/calls.css, dist/realtime-ui.min.js, dist/realtime-ui-streams.min.js, dist/THIRD-PARTY-NOTICES.txt' );

// The views an app copies, on the declarations just written (scripts/views.mjs).
await import( './views.mjs' );

/** The token rules with only the custom properties `css` reads, and those they read; empty rules dropped. */
function usedTokens( compiled, css ) {
    const reads = ( text ) => [ ...text.matchAll( /var\(\s*(--[a-z0-9-]+)/gi ) ].map( ( m ) => m[ 1 ] );
    const values = new Map();

    for ( const [ , name, value ] of compiled.matchAll( /^\s+(--[a-z0-9-]+):\s*(.*);$/gm ) ) {
        values.set( name, ( values.get( name ) ?? '' ) + ' ' + value );
    }

    const used = new Set();
    const queue = reads( css );

    while ( queue.length ) {
        const name = queue.pop();
        if ( used.has( name ) ) continue;
        used.add( name );
        queue.push( ...reads( values.get( name ) ?? '' ) );
    }

    let kept = compiled.split( '\n' ).filter( ( line ) => {
        const declared = line.match( /^\s+(--[a-z0-9-]+):/ );
        return ! declared || used.has( declared[ 1 ] );
    } ).join( '\n' );

    for ( let before = ''; before !== kept; ) {
        before = kept;
        kept = kept.replace( /^[ \t]*[^\n{};]+\{\s*\}\n?/gm, '' );
    }

    return kept.trim();
}

/**
 * A stylesheet source's top-level variables and `@mixin` blocks (brackets matched), in order: what its mixins need,
 * without the rules they sit among.
 */
function mixinsOf( source ) {
    const out = [];
    for ( const match of source.matchAll( /^(@mixin\b|\$[a-z0-9_-]+\s*:)/gm ) ) {
        const variable = match[ 1 ].startsWith( '$' );
        let depth = 0;
        let i = variable ? match.index : source.indexOf( '{', match.index );
        for ( ; i < source.length; i++ ) {
            const c = source[ i ];
            if ( c === '{' || c === '(' ) depth++;
            else if ( ( c === '}' || c === ')' ) && --depth === 0 && ! variable ) break;
            else if ( variable && c === ';' && depth === 0 ) break;
        }
        out.push( source.slice( match.index, i + 1 ) );
    }
    return out.join( '\n' );
}

/**
 * Token rules for a shadow root: Better Messages' `:root`, and its dark theme's `body` selectors, on the host, whose
 * `data-scheme` says the page's own light or dark (src/elements.tsx, schemeOf()).
 */
function hostOf( css ) {
    return css
        .replace( /:root\b/g, ':host' )
        .replace( /body:not\(\.bm-messages-light\)/g, ':host(:not([data-scheme="light"]))' )
        .replace( /body\.bm-messages-dark/g, ':host([data-scheme="dark"])' );
}
