// Live streams: Easy Stream's player, studio, chat and stage, moved here whole on
// 2026-10-13 (step 4), on the stream engine of @wordplus/realtime-client/streams, which their host gives them
// (EasyStreamProvider). Their look is Easy Stream's: the `estream-` classes, the --estream-* properties, and the
// appearance settings as props (appearance.ts). Their words are i18n.ts's, in the `wordplus-stream` text domain.
export {EasyStreamApp, AllInOne, type EasyStreamAppProps} from "./app.tsx";
export {EasyStreamParts, PART_NAMES, VIDEO_PARTS, type EasyStreamPartsProps, type Part, type PartName, type PartOptions} from "./parts.tsx";
export {themeClass, themeStyle, contrastText, logoOf, safeImage, shapeOf, type Appearance, type Shape} from "./appearance.ts";
export {EasyStreamProvider, useClient, useStream} from "./context.tsx";
export {Stage, mainTrack, qualityChoices, shownQuality, type TileInfo} from "./stage.tsx";
export {reactionIcon, offeredReactions, REACTIONS_MAX} from "./reactions.ts";
export {EmojiGlyph} from "./emoji-glyph.tsx";
export {StatsPanel} from "./stats.tsx";
export {ShortcutList} from "./shortcuts.tsx";
export {Chat, BetterMessagesRoom} from "./chat.tsx";
export {Info, type InfoShows} from "./info.tsx";
export {ViewerControls, InviteDialog} from "./controls.tsx";
export {Studio, StudioBody, StudioBar, StudioStatus, Guests, useStudio, MicLevel, Summary, deviceName, deviceOf, sendingHealth, sentText, sendsHere, type StudioControls} from "./studio.tsx";
export {StudioPage, type StudioPageOptions} from "./studio-page.tsx";
export {RoomButton, RoomBanner, RoomStage, type RoomControls} from "./better-messages.tsx";
export {usePlayer, PlayerProvider, WithAppearance, useNow, useShortcuts, pageUrl, type StreamTexts} from "./player.tsx";
export {ConfirmProvider, useConfirm, DialogBox} from "./dialog.tsx";
export {VideoTrack, AudioTracks} from "./media.tsx";
export {Screen, screenFor} from "./screens.tsx";
export {Icon} from "./icons.tsx";
export {HostNote} from "./host-note.tsx";
export {MenuButton, MenuChoice, MenuHeading, MenuItem} from "./menu.tsx";
export {EmojiField} from "./emoji-field.tsx";
export {CopyField} from "./studio.tsx";
export {count, dateTime, clock, until, pageLocale, relative, timeOfDay} from "./format.ts";
export {googleCalendarUrl, icsFile, downloadIcs} from "./calendar.ts";
export {readPref, writePref, isBoolean, isNumber, oneOf} from "./prefs.ts";
export {sharedTooltips, sharedEmoji, sharedMenus, sharedPickers} from "./shared.ts";
export {useTooltips} from "./tooltip.ts";
export {errorText, reactionName} from "./words.ts";
