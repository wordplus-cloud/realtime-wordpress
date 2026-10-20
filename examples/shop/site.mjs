// A WordPress site of its own for the API demo, to try it on this computer: WordPress on SQLite (the WordPress.org SQLite
// Database Integration, as its drop-in, so no database server), the plugin built and installed, the app credentials
// in the option every WordPlus plugin reads, and a router for the built-in PHP server.
//
//   node site.mjs <folder> <address>        such as: node site.mjs ../../.site http://localhost:8080
//   php -S localhost:8080 -t <folder> <folder>/router.php
//
// With WORDPLUS_SITE and WORDPLUS_SECRET (the app key and secret in WordPlus Cloud) in the environment. The shop is
// then at <address>/example-shop/. The demos run.mjs and the example check make their sites with it too. It needs
// php, wp (WP-CLI), composer, npm, curl and unzip.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SQLITE = 'https://downloads.wordpress.org/plugin/sqlite-database-integration.3.1.0.zip';

/**
 * The site in `folder` (made again from nothing), served at `url`. `env` is the environment its commands run in, with
 * the credentials. `config` lines go into wp-config.php as they are.
 */
export function makeSite({ folder, url, env = process.env, config = [], composer = process.env.COMPOSER_BIN ?? 'composer' }) {
    const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env, stdio: ['ignore', 'ignore', 'inherit'] });
    run('npm', ['install', '--no-audit', '--no-fund', '--silent'], here);
    run('npm', ['run', 'build'], here);
    // The package as this checkout has it, mirrored afresh rather than a copy an earlier install left.
    rmSync(join(here, 'vendor'), { recursive: true, force: true });
    run(composer, ['install', '--no-dev', '-n', '--no-progress'], here);

    folder = resolve(folder);
    const wp = (...args) => run('wp', ['--path=' + folder, ...args]);
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(join(folder, 'wp-content', 'plugins'), { recursive: true });
    wp('core', 'download', '--skip-content');

    const zip = join(folder, 'sqlite.zip');
    run('curl', ['-sSfL', '-o', zip, SQLITE]);
    run('unzip', ['-q', zip, '-d', join(folder, 'wp-content', 'plugins')]);
    rmSync(zip);
    const sqlite = join(folder, 'wp-content', 'plugins', 'sqlite-database-integration');
    writeFileSync(join(folder, 'wp-content', 'db.php'), readFileSync(join(sqlite, 'db.copy'), 'utf8')
        .replaceAll('{SQLITE_IMPLEMENTATION_FOLDER_PATH}', sqlite).replaceAll('{SQLITE_PLUGIN}', 'sqlite-database-integration/load.php'));

    // WordPress at the address, whatever host a request names: the realtime server webhook comes to its port.
    execFileSync('wp', ['--path=' + folder, 'config', 'create', '--dbname=wordpress', '--dbuser=sqlite', '--dbpass=sqlite', '--skip-check', '--extra-php'], {
        env,
        stdio: ['pipe', 'ignore', 'inherit'],
        input: [
            "define( 'DB_DIR', __DIR__ . '/wp-content/database/' );",
            "define( 'DB_FILE', 'shop.sqlite' );",
            `define( 'WP_HOME', '${url}' );`,
            `define( 'WP_SITEURL', '${url}' );`,
            ...config,
            '',
        ].join('\n'),
    });
    wp('core', 'install', '--url=' + url, '--title=API demo', '--admin_user=admin', '--admin_password=' + randomBytes(12).toString('hex'), '--admin_email=admin@shop.example', '--skip-email');
    wp('rewrite', 'structure', '/%postname%/');

    cpSync(here, join(folder, 'wp-content', 'plugins', 'example-shop'), { recursive: true, filter: (src) => !src.split('/').includes('node_modules') });
    wp('plugin', 'activate', 'example-shop');
    wp('eval', '$o = get_option( "wordplus_cloud_license" ); $o = is_array( $o ) ? $o : array(); $o["activations"][ site_url() ] = array( "site_key" => getenv( "WORDPLUS_SITE" ), "secret" => getenv( "WORDPLUS_SECRET" ), "effective_at" => 0 ); update_option( "wordplus_cloud_license", $o );');

    // The built-in PHP server: a file as it is, anything else to WordPress.
    writeFileSync(join(folder, 'router.php'), "<?php\n$path = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );\nif ( '/' !== $path && is_file( __DIR__ . $path ) ) {\n\treturn false;\n}\n$_SERVER['SCRIPT_NAME'] = '/index.php';\nrequire __DIR__ . '/index.php';\n");

    return folder;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [folder, url] = process.argv.slice(2);
    if (!folder || !url) {
        console.error('node site.mjs <folder> <address>');
        process.exit(2);
    }
    const made = makeSite({ folder, url });
    const port = new URL(url).port || '80';
    console.log(`The shop: ${url}/example-shop/\nServe it: php -S ${new URL(url).hostname}:${port} -t ${made} ${join(made, 'router.php')}`);
}
