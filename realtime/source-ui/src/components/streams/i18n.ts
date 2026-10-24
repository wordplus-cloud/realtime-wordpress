// The live streams' words, written as Easy Stream writes them: the text, a context where it takes a placeholder, and
// its text domain, `wordplus-live-stream`. In an app the host translates them, from the package's languages/streams/ by default,
// which addStreamLanguages() gives the package's translator.
//
// One module on purpose: Easy Stream's WordPress build puts WordPress's own wp.i18n in its
// place (its scripts/esbuild-wp-i18n.mjs), so each call stays a property call WordPress's tools find in its built
// script, and WordPress translates the stream's words on its sites with its language packs. Their languages go with it.
import { addStreamLanguages } from "../../inc/stream-languages.ts";

addStreamLanguages();

export { __, _x, _n, _nx, sprintf } from "../../inc/globals.ts";
