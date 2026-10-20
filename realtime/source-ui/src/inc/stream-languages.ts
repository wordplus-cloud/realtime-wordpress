import de from "../languages/streams/de.json";
import es from "../languages/streams/es.json";
import fr from "../languages/streams/fr.json";
import it from "../languages/streams/it.json";
import nl from "../languages/streams/nl.json";
import pl from "../languages/streams/pl.json";
import hr from "../languages/streams/hr.json";
import he from "../languages/streams/he.json";
import { addLanguages } from "./translations.ts";

/**
 * Gives the package's translator the live streams' words in the WordPlus languages, in their text domain, `wordplus-stream`.
 * They are kept apart from the shared ones (scripts/languages.mjs keeps both), so only a script with the stream's views
 * carries them: the elements' realtime-ui.min.js stays its size without them. The views' i18n.ts calls it, and Easy
 * Stream's WordPress build replaces that module with wp.i18n, so its scripts carry none of them either.
 */
export function addStreamLanguages(): void {
    addLanguages( "wordplus-stream", { de, es, fr, it, nl, pl, hr, he } );
}
