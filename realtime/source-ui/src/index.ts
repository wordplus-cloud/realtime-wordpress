// @wordplus/realtime-ui: Better Messages' screens, for every app on WordPlus Cloud and for Better Messages itself.
// Optional on every platform: an app that draws its own screens never loads these.
//
// This entry is what every screen stands on, and what Better Messages' free build uses too; the call screens are
// `@wordplus/realtime-ui/calls`, which a build without calls never imports.

// What the screens ask of the app they are in.
export { configureUi, host, setUiUsers, uiUser } from "./host.ts";
export type { UiHost, UiUser, UserAvatarProps, UserNameProps, SharedPart } from "./host.ts";
export { __, _x, _n, _nx, sprintf, applyFilters } from "./inc/globals.ts";
export { plainName, escapeHtml } from "./inc/names.ts";

// The screens' named pieces, which an app replaces with its own (pieces.tsx).
export { Piece, PiecesProvider, usePieces } from "./pieces.tsx";
export type {
    Pieces, Drawn, RingCardProps, CallStatusProps, VideoTileProps, SelfViewProps, GridTileProps, OnlineRowProps, MessageProps,
    ComposerProps, ChatMessageView,
} from "./pieces.tsx";

// Presence: the avatar with its dot, the stack, typing, the label, read-by; who is online, a person's row, a live
// count. Views, fed with who is online by whoever draws them.
export {
    PresenceDot, Avatar, GroupAvatar, AvatarStack, TypingDots, ActivityIndicator, PresenceLabel, ReadBy,
    SHAPE_RADIUS, avatarSrc, avatarKey, defaultAvatarSrc,
} from "./components/presence/presence.tsx";
export type {
    Presence, PresenceUser, PresenceDotProps, AvatarShape, AvatarProps, GroupAvatarProps, AvatarStackProps, TypingDotsProps,
    Activity, ActivityEntry, ActivityIndicatorProps, PresenceLabelProps, ReadByProps,
} from "./components/presence/presence.tsx";
export { OnlineList, PersonRow, OnlineCount, RowAction } from "./components/presence/online-list.tsx";
export type { OnlineListProps, PersonRowProps, RowActionProps } from "./components/presence/online-list.tsx";

// Chat: the message list's parts (day separator, unread divider, system line, a sender's stack, a message's body, text
// and meta, delivery ticks, hover actions, typing, the empty conversation), the composer's row, and reactions. Views,
// filled by whoever draws them.
export {
    DaySeparator, UnreadDivider, SystemRow, DeletedBubble, MessageStack, MessageBody, MessageText, AiWaiting, StatusTick,
    MetaPieces, MessageMeta, HoverActions, HoverButton, TypingPinned, EmptyThread,
} from "./components/chat/message-parts.tsx";
export type {
    DaySeparatorProps, SystemRowProps, SystemTone, DeletedBubbleProps, MessageSide, BubbleFill, MessageStackProps,
    MessageBodyProps, MessageTextProps, DeliveryState, StatusTickProps, MetaPiecesProps, MetaVariant, MessageMetaProps,
    HoverButtonProps,
} from "./components/chat/message-parts.tsx";
export { ComposerRow } from "./components/chat/composer-row.tsx";
export type { ComposerRowProps } from "./components/chat/composer-row.tsx";
export { ReactionPills, ReactionPill, ReactionPicker, decodeReaction, encodeReaction } from "./components/chat/reactions.tsx";
export type { ReactionEntry, ReactionPillProps, ReactionPickerProps } from "./components/chat/reactions.tsx";
export {
    VIEWPORT_EDGE, viewportSize, clampToViewport, createFixedProbe, fixedOrigin, liveAnchorRect, availableWidth,
} from "./primitives/viewport.ts";
export type { ViewportSize, ClampedPosition } from "./primitives/viewport.ts";

// A call ringing for the user: here, not in /calls, as a page rings before it loads any call screen.
export { default as IncomingCallCard } from "./components/calls/incoming-call-card.tsx";
// Where the keyboard goes back to as a call closes, which the ring and a call window of one's own share.
export { deepFocus, focusBack, rememberBeforeRing } from "./components/calls/focus-return.ts";
// Why a camera or microphone would not open, in words the reader can act on.
export { getPermissionFailure } from "./inc/device-error.ts";

// What shape a picture is: the call grids', and a camera preview's.
export {
    DEFAULT_TILE_RATIO, TALL_TILE_RATIO, publicationRatio, participantRatio, useMediaRatio, usePictureDrawn, cssRatio,
} from "./inc/calls/ratio.ts";
export type { PictureDrawn } from "./inc/calls/ratio.ts";

// What the screens stand on.
export { default as Icon, iconPathD, isRegistryIcon, ResolvedIcon } from "./primitives/icon.tsx";
export type { IconName, IconSource, ResolvedIconProps } from "./primitives/icon.tsx";
export { default as IconButton } from "./primitives/icon-button.tsx";
export type { IconButtonEmphasis, IconButtonProps } from "./primitives/icon-button.tsx";
export { default as BaseTooltip, tooltipContent } from "./primitives/tooltip.tsx";
export type { TooltipSide, TooltipProps } from "./primitives/tooltip.tsx";
export { default as Tooltip } from "./components/helpers/tooltip.tsx";
export { default as Btn, keepPointerFocus } from "./inc/helpers/btn.tsx";
export type { BtnProps } from "./inc/helpers/btn.tsx";
export { default as Resizable } from "./components/helpers/resizable.tsx";
export { default as ConnectionStatus } from "./components/parts/connection-status.tsx";
export { default as UserAvatar, FallbackAvatar } from "./components/users/user-avatar.tsx";
export { default as UserName, FallbackName } from "./components/users/user-name.tsx";
export { default as useStateRef } from "./inc/hooks/state-ref.ts";
export { default as useHeld, PAUSED_NOTICE_MS } from "./inc/hooks/held.ts";
export { default as useFlipReorder } from "./utils/use-flip-reorder.ts";
export {
    browserLabel, platformLabel, isMobile, isNewSafari, isSafari, isIOS, isWindows, isMac, isAndroid, isFirefox, isOldIOS,
} from "./inc/functions/browser-info.ts";
export { msToTime, formatSize, getSpeakerHighlightStyles, BMHexToRGBA } from "./inc/functions.ts";
export type { SpeakerHighlightResult } from "./inc/functions.ts";
export { sharedTooltips } from "./inc/shared-parts.ts";
export type { Tooltips, TooltipContent, TooltipOptions } from "./inc/shared-parts.ts";
