import React, { CSSProperties, ReactNode } from "react";
import parse from "html-react-parser";

// Lucide-style 1.6-stroke icon registry. Single <Icon name="..." /> component
// with the registry typed via keyof so adding a new icon is one place.
//
// Every glyph keeps Lucide's envelope: 2..22 of the 24 grid, 3..21 for
// squares. Header rows put these side by side at one nominal size, so a
// glyph drawn to Feather's 1..23 (the old gear, users, video, camera…)
// stood a fifth taller than its neighbours. tests/specs/header-icon-parity
// measures the registry against that envelope.
//
// Pipe separator (|) in a value renders multiple <path> elements — useful for
// composite icons like settings (gear + center dot) or video (rectangle +
// triangle).
//
// Starter set covers the primary surfaces: Rail, Inbox, ThreadColumn,
// Composer, ContextPanel. Add to the ICONS map as more surfaces need them.

const ICONS = {
    search:     "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z|M16 16l5 5",
    edit:       "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z",
    phone:      "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.94.34 1.86.66 2.74a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.34-1.34a2 2 0 0 1 2.11-.45c.88.32 1.8.54 2.74.66A2 2 0 0 1 22 16.92Z",
    video:      "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5|M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z",
    more:       "M12 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2z",
    smile:      "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM8 14.5s1.5 2.5 4 2.5 4-2.5 4-2.5M9 10h.01M15 10h.01",
    paperclip:  "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
    mic:        "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 11v1a7 7 0 0 1-14 0v-1M12 19v3M8 22h8",
    send:       "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
    sticker:    "M16 2H6a4 4 0 0 0-4 4v12a4 4 0 0 0 4 4h7l9-9V6a4 4 0 0 0-4-4zM13 22v-5a4 4 0 0 1 4-4h5",
    // Bulk Message (v2's FaMailBulk): Lucide's "mails" — stacked envelopes.
    mails:      "M8 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z|m22 7-7.1 3.78a2 2 0 0 1-1.8 0L6 7|M2 8v11a2 2 0 0 0 2 2h14",
    reply:      "M9 14 4 9l5-5M4 9h12a5 5 0 0 1 5 5v6",
    pin:        "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    check2:     "M20 6 9 17l-5-5",
    check:      "M20 6 9 17l-5-5",
    // Double check drawn as two IDENTICAL checks offset horizontally
    // (both diagonals span y7–16.5), the second's leg clipped where it
    // meets the first's diagonal — lucide's check-check crops the second
    // check visibly shorter, which read as mismatched heights at tick size.
    checks:     "M2 12l4.5 4.5L16 7M9.5 13.5l3 3L22 7",
    spinner:    "M12 2a10 10 0 0 1 10 10",
    clock:      "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|M12 6v6l4 2",
    "at-sign":  "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9",
    chevronL:   "m15 18-6-6 6-6",
    chevronR:   "m9 18 6-6-6-6",
    chevronD:   "m6 9 6 6 6-6",
    chevronU:   "m18 15-6-6-6 6",
    x:          "M18 6 6 18M6 6l12 12",
    minus:      "M5 12h14",
    minimize:   "M5 14h6v6M19 10h-6V4M14 10l7-7M3 21l7-7",
    maximize:   "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
    // Minimize-to-mini-chat: v2's window-minimize glyph, a low dash.
    windowMinimize: "M5 19h14",
    settings:   "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    bell:       "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M13.7 21a2 2 0 0 1-3.4 0",
    users:      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M16 3.128a4 4 0 0 1 0 7.744|M22 21v-2a4 4 0 0 0-3-3.87|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    user:       "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    // Site-wide member directory: three figures, so it stays distinct from
    // friends (one) and groups (two). Drawn as `users` with one more figure —
    // a front figure with a full shoulder arc flanked by two partials — so the
    // head size and line mass match its neighbours in the tab strip, inside
    // the same 2..22 envelope as `users`. (v2's own
    // mark here is a Heroicons solid-ish group that reads far heavier than the
    // Feather-family icons around it, so it is deliberately not reused.)
    // Three abreast, so it fills the envelope's width (2..22) and can only be
    // 15.2 tall — but it was drawn 4.4..19.6 shifted 1.4 DOWN the grid, which
    // in a tab strip beside thread / users / book (all centred, 18 tall) read
    // as one icon hanging below the others. Translated up; not rescaled,
    // which would take it past the width envelope.
    community:  "M12 10a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4z|M16.8 19.6v-1.4a4.8 4.8 0 0 0-9.6 0V19.6|M5.8 9.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z|M2 17.2v-1a4 4 0 0 1 3.4-3.95|M18.2 9.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z|M22 17.2v-1a4 4 0 0 0-3.4-3.95",
    globe:      "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
    home:       "M3 9.5 12 2l9 7.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.5z|M9 22v-8h6v8",
    bolt:       "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
    cart:       "m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18|M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25|M18 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4z|M8 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    hash:       "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
    sparkles:   "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1",
    mute:       "M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z|m16.5 14.5 5-5|m16.5 9.5 5 5",
    image:      "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21",
    link:       "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
    unlink:     "m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71|m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71|M8 2v3|M2 8h3|M16 19v3|M19 16h3",
    bold:       "M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8",
    italic:     "M19 4h-9|M14 20H5|M15 4 9 20",
    underline:  "M6 4v6a6 6 0 0 0 12 0V4|M4 20h16",
    strikethrough: "M16 4H9a3 3 0 0 0-2.83 4|M14 12a4 4 0 0 1 0 8H6|M4 12h16",
    listBulleted: "M3 12h.01|M3 18h.01|M3 6h.01|M8 12h13|M8 18h13|M8 6h13",
    listNumbered: "M10 12h11|M10 18h11|M10 6h11|M4 10h2|M4 6h1v4|M6 18H4c0-1 2-2 2-3s-1-1.5-2-1",
    heading1:   "M4 12h8|M4 18V6|M12 18V6|m17 12 3-2v8",
    heading2:   "M4 12h8|M4 18V6|M12 18V6|M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1",
    heading3:   "M4 12h8|M4 18V6|M12 18V6|M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2|M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2",
    textFormat: "M4 20h16|m6 16 6-12 6 12|M8 12h8",
    thread:     "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
    plus:       "M12 5v14M5 12h14",
    filter:     "M22 3H2l8 9.5V19l4 2v-8.5L22 3z",
    incognito:  "M2 14h20M5 14l2-5h10l2 5|M7 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M10 16h4",
    archive:    "M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-18a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z|M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8|M10 12h4",
    camera:     "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z|M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    file:       "M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7zM13 2v7h7",
    mapPin:     "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0|M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    lock:       "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4",
    panelOpen:  "M3 3h18v18H3zM9 3v18|M12 9l3 3-3 3",
    panelClose: "M3 3h18v18H3zM9 3v18|M14 9l-3 3 3 3",
    // Lucide's badge-check: eight scallops on 2..22 around the same check as
    // `shield`. The hand-drawn 12-point badge it replaces spanned 0.1..21.3
    // and sat 1.3 units left of centre.
    verified:   "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z|m9 12 2 2 4-4",
    shield:     "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z|m9 12 2 2 4-4",
    // Image editor toolbar (Cropper.js actions).
    history:    "M3 12a9 9 0 1 0 3-6.7L3 8|M3 3v5h5|M12 7v5l3 2",
    rotate:     "M3 12a9 9 0 1 1 3 6.7|M3 12H8M3 12V7",
    flip:       "M12 3v18|M9 7 4 12l5 5V7zM15 7l5 5-5 5V7z",
    zoomIn:     "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3|M11 8v6M8 11h6",
    zoomOut:    "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3|M8 11h6",
    // 18 tall like its neighbours, but drawn 2..20 — a unit ABOVE the grid's
    // centre, the mirror of what community did below it. Translated down to
    // 3..21, the envelope's own square.
    bot:        "M9 3h6M12 3v3M5 9h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14v3M22 14v3M9 14h.01M15 14h.01M8 19h8",
    star:       "m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
    coin:       "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z|M16.5 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
    ban:        "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2",
    eraser:     "M20 20H7L3 16a2 2 0 0 1 0-2.8L13.2 3a2 2 0 0 1 2.8 0L21 8a2 2 0 0 1 0 2.8L11 20M14 8l5 5",
    trash:      "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6",
    unarchive:  "M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-18a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z|M4 8v11a2 2 0 0 0 2 2h2|M20 8v11a2 2 0 0 1-2 2h-2|m9 15 3-3 3 3|M12 12v9",
    userPlus:   "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M19 8v6|M22 11h-6",
    flag:       "M4 22V4M4 4h13l-2 4 2 4H4",
    copy:       "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z|M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
    download:   "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    // Lucide geometry (x 6..20) — the off-box position IS the optical
    // centering for a right-pointing triangle in a circular button.
    play:       "M6 3l14 9-14 9V3z",
    pause:      "M6 4h4v16H6zM14 4h4v16h-4z",
    book:       "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
    // Voice transcription marker (v2's CgTranscript) — lucide "captions".
    captions:   "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z|M7 15h4M15 15h2M7 11h2M13 11h4",
    shopping:   "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 1 1-8 0",
    reaction:   "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM8 14.5s1.5 2.5 4 2.5 4-2.5 4-2.5M9 10h.01M15 10h.01",
    // A conversation that notifies only about mentions and replies (lucide "at-sign"). An icon, not
    // a typed @: a glyph of text sits on its own baseline, which moved a pixel against the icons
    // beside it wherever the row landed on a fraction of a pixel.
    at:         "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",
    // Someone reacted to your message (lucide "heart"): the reaction picker keeps the smiley.
    heart:      "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
    // Group-call icons (ported from the 2026 redesign design source).
    videoGroup: "M4 4.5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 4v-4H4a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z|M18 8.5l4-2v7l-4-2V8.5z",
    phoneGroup: "M3 13.5a9 9 0 0 1 18 0|M3 13.5v4a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-5H3z|M21 13.5v4a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-5h4z",
    speaker:    "M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14",
    raisehand:  "M7 11V5a2 2 0 1 1 4 0v6M11 11V3a2 2 0 1 1 4 0v8M15 11V5a2 2 0 1 1 4 0v9a8 8 0 0 1-8 8H9a4 4 0 0 1-4-4l-2-5 1.5-1.5L7 13",
    translate:  "m5 8 6 6|m4 14 6-6 2-3|M2 5h12|M7 2h1|m22 22-5-10-5 10|M14 18h6",
    layout:     "M3 3h18v18H3zM3 9h18M9 21V9",
    screen:     "M2 4h20v12H2zM8 20h8M12 16v4",
    // Call chrome (3.0 call screens): slashed and paired variants of the
    // media controls, room moderation, and connection state.
    micOff:         "M12 19v3|M8 22h8|m2 2 20 20|M18.89 13.23A7.12 7.12 0 0 0 19 12v-2|M5 10v2a7 7 0 0 0 12 5|M15 9.34V5a3 3 0 0 0-5.68-1.33|M9 9v3a3 3 0 0 0 5.12 2.12",
    videoOff:       "M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.494A.5.5 0 0 1 22 7.435v8.13a.5.5 0 0 1-.752.43L16 13.5|M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2|m2 2 20 20",
    screenShare:    "M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3|M8 21h8|M12 17v4|m17 8 5-5|M17 3h5v5",
    screenShareOff: "M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3|M8 21h8|M12 17v4|m22 3-5 5|m17 3 5 5",
    pip:            "M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4|M12 13h8a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z",
    switchCamera:   "M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5|M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5|M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z|m18 22-3-3 3-3|m6 2 3 3-3 3",
    // Swapping which of the other side's two pictures is the big one. The
    // image editor's `flip` was standing in for this and read as "mirror it";
    // 2.0 used Font Awesome's circular-arrows `sync-alt`, which is this shape.
    swapVideos:     "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8|M21 3v5h-5|M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16|M8 16H3v5",
    lockOpen:       "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z|M7 11V7a5 5 0 0 1 9.9-1",
    megaphone:      "m3 11 18-5v12L3 14v-3z|M11.6 16.8a3 3 0 1 1-5.8-1.6",
    megaphoneOff:   "M9.26 9.26 3 11v3l14.14 3.14|M21 15.34V6l-7.31 2.03|M11.6 16.8a3 3 0 1 1-5.8-1.6|m2 2 20 20",
    logout:         "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|m16 17 5-5-5-5|M21 12H9",
    arrowUp:        "M12 19V5|m5 12 7-7 7 7",
    arrowDown:      "M12 5v14|m19 12-7 7-7-7",
    wifiOff:        "M12 20h.01|M8.5 16.429a5 5 0 0 1 7 0|M5 12.859a10 10 0 0 1 5.17-2.69|M19 12.859a10 10 0 0 0-2.007-1.523|M2 8.82a15 15 0 0 1 4.177-2.643|M22 8.82a15 15 0 0 0-11.288-3.764|m2 2 20 20",
    pinOff:         "M12 17v5|M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89|m2 2 20 20|M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11",
    userX:          "M2 21a8 8 0 0 1 13.292-6|M10 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z|m17 17 5 5|m22 17-5 5",
    alert:          "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|M12 8v4|M12 16h.01",
    activity:       "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
    wifi:           "M12 20h.01|M2 8.82a15 15 0 0 1 20 0|M5 12.859a10 10 0 0 1 14 0|M8.5 16.429a5 5 0 0 1 7 0",
    speakerOff:    "M11 5 6 9H2v6h4l5 4V5z|m23 9-6 6|m17 9 6 6",
} as const;

export type IconName = keyof typeof ICONS;

// The registry glyph as ONE path, for the few places that cannot render an
// <Icon> and take a bare `d` instead — fslightbox's toolbar buttons, which
// build their own <svg><path> and only accept that (image-lightbox.tsx).
// Multi-path glyphs join into subpaths of a single `d`, which draws
// identically. The caller supplies the stroke: these are stroke artwork on a
// 24 viewBox, not fills.
export function iconPathD( name: IconName ): string {
    const d = ICONS[ name ] as string;
    return d.includes( "|" ) ? d.split( "|" ).join( " " ) : d;
}

// ─── GLYPHS THAT CARRY A DIRECTION ────────────────────────────────────
//
// An RTL document flips the layout but not the artwork: the back chevron
// still pointed left with the inbox now on the right, and both panel
// toggles still drew their sidebar on the left with the panel on the
// right. These are mirrored under [dir="rtl"] by a single rule in
// _rtl.scss, which the class below opts into.
//
// Only glyphs whose meaning IS the direction belong here. A magnifier, a
// play triangle, a volume cone, a fullscreen pair and the chat bubble
// read the same in both directions — mirroring those is the other half
// of the same bug, so they are deliberately absent.
//
// A caller that sets its own `transform` on the svg overrides this (one
// property, not two) — see the call surface's chat toggle, whose hidden
// and stacked states re-state the flip in _call-surface.scss.
const RTL_MIRRORED: ReadonlySet<string> = new Set( [
    "chevronL", "chevronR",
    "reply", "send",
    "panelOpen", "panelClose",
    "logout",
    "screenShare", "screenShareOff",
] );

interface IconProps {
    name: IconName | "gif" | "wifiWeak";
    size?: number;
    strokeWidth?: number;
    className?: string;
    style?: CSSProperties;
}

export default function Icon( { name, size = 18, strokeWidth, className, style }: IconProps ) {
    // The 24-viewBox paths scale their stroke with the render size, so tiny
    // renders come out as sub-pixel hairlines (1.6 @ 12px paints 0.8px).
    // Unless the caller pins a width, hold the RENDERED weight at ~1.15px
    // minimum by thickening the stroke as the size shrinks.
    const sw = strokeWidth ?? Math.max( 1.6, Math.min( 2.9, ( 1.15 * 24 ) / size ) );

    // One bar of signal: lucide's wifi with its two outer arcs faint, as a phone shows a weak network (a video paused
    // for the viewer's download). A registry glyph draws in one ink, and lucide's "wifi-low", its dot and lowest arc
    // alone, read as a stray mark at 14 px (2026-10-19).
    if ( name === "wifiWeak" ) {
        return (
            <svg viewBox="0 0 24 24" width={ size } height={ size }
                 className={ className } style={ style }
                 fill="none" stroke="currentColor" strokeWidth={ sw }
                 strokeLinecap="round" strokeLinejoin="round"
                 aria-hidden="true">
                <path d="M12 20h.01" />
                <path d="M8.5 16.429a5 5 0 0 1 7 0" />
                <path d="M5 12.859a10 10 0 0 1 14 0" opacity="0.3" />
                <path d="M2 8.82a15 15 0 0 1 20 0" opacity="0.3" />
            </svg>
        );
    }

    if ( name === "gif" ) {
        return (
            <svg viewBox="0 0 24 24" width={ size } height={ size }
                 className={ className } style={ style } aria-hidden="true">
                <rect x="2" y="2" width="20" height="20" rx="3" ry="3"
                      fill="none" stroke="currentColor" strokeWidth={ sw } />
                <text x="12" y="16" textAnchor="middle"
                      fontSize="8.5" fontWeight="700" fontFamily="system-ui, sans-serif"
                      fill="currentColor" letterSpacing="0.5">GIF</text>
            </svg>
        );
    }

    // hasOwnProperty, not a truthiness test: a name that lands on something
    // inherited from Object.prototype ("constructor", "toString") reads as a
    // hit and then crashes on .includes.
    const d = Object.prototype.hasOwnProperty.call( ICONS, name ) ? ICONS[ name ] : undefined;
    if ( typeof d !== "string" ) return null;

    const paths = d.includes( "|" ) ? d.split( "|" ) : [ d ];

    const cls = RTL_MIRRORED.has( name )
        ? ( className ? className + " bm-icon-rtl" : "bm-icon-rtl" )
        : className;

    return (
        <svg viewBox="0 0 24 24" width={ size } height={ size }
             className={ cls } style={ style }
             fill="none" stroke="currentColor" strokeWidth={ sw }
             strokeLinecap="round" strokeLinejoin="round"
             aria-hidden="true">
            { paths.map( ( pathD, i ) => (
                <path key={ i } d={ pathD } />
            ) ) }
        </svg>
    );
}

// ─── ICONS THAT DID NOT COME FROM THE REGISTRY ────────────────────────
//
// The JS extension points (better_messages_thread_context_menu,
// better_messages_single_message_context_menu, …) hand back whatever the
// integration wrote. Three shapes are in the wild, and all three have to
// render:
//
//   · a registry name  — our own items ("pin", "mute", …)
//   · an `<svg …>` markup STRING — the shape the hook docs document, and
//     what integrations actually ship
//   · a React node — what 2.0's own thread actions carried, so anything
//     copied from them passes one along
//
// A registry lookup alone silently dropped the last two: `<Icon name="<svg
// …>">` finds nothing and renders null, so the entry appeared with a blank
// where its icon should be. Resolving all three in one place keeps every
// menu surface honest. Registry FIRST — "pin" is a key, not markup.

export type IconSource = IconName | "gif" | ReactNode;

export function isRegistryIcon( icon: unknown ): icon is IconName | "gif" {
    return typeof icon === "string"
        && ( icon === "gif" || Object.prototype.hasOwnProperty.call( ICONS, icon ) );
}

export interface ResolvedIconProps {
    icon    : IconSource;
    size?   : number;
    className? : string;
}

export function ResolvedIcon( { icon, size = 18, className }: ResolvedIconProps ) {
    if ( icon === null || icon === undefined || icon === false || icon === "" ) return null;

    if ( isRegistryIcon( icon ) ) {
        return <Icon name={ icon } size={ size } className={ className } />;
    }

    // The box is ours, the artwork is theirs: integration SVG arrives drawn
    // at whatever size its author picked (the documented example is 24) and
    // would otherwise stand half again as tall as the glyphs beside it.
    // _icon.scss scales whatever lands inside down to this square.
    return (
        <span className={ "bm-icon-custom" + ( className ? " " + className : "" ) }
              style={ { width: size, height: size } } aria-hidden="true">
            { typeof icon === "string" ? parse( icon ) : icon }
        </span>
    );
}
