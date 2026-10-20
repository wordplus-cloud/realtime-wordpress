import type {ReactNode} from "react";

// The player's and the studio's icons, drawn here: 24 × 24, stroked in the text's colour. Each is a
// decoration: the button it sits in carries the words (aria-label or text).

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const F = { fill: 'currentColor', stroke: 'none' } as const;

const speaker = <path { ...S } d="M11 5 6.5 9H3v6h3.5l4.5 4z" />;
const mic = <><rect { ...S } x="9" y="3" width="6" height="11" rx="3" /><path { ...S } d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>;
const camera = <><rect { ...S } x="2.5" y="6" width="13" height="12" rx="2" /><path { ...S } d="m15.5 10.5 6-3.5v10l-6-3.5" /></>;
const slash = <path { ...S } d="m3 3 18 18" />;

const ICONS = {
    volume: <>{ speaker }<path { ...S } d="M15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12" /></>,
    'volume-low': <>{ speaker }<path { ...S } d="M15.5 9a4 4 0 0 1 0 6" /></>,
    'volume-off': <>{ speaker }<path { ...S } d="m16 9.5 5 5M21 9.5l-5 5" /></>,
    fullscreen: <path { ...S } d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
    'fullscreen-exit': <path { ...S } d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />,
    pip: <><rect { ...S } x="2.5" y="4.5" width="19" height="15" rx="2" /><rect { ...F } x="12" y="11.5" width="7" height="5.5" rx="1" /></>,
    chat: <path { ...S } d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4h0.5A1.5 1.5 0 0 1 4 14.5z" />,
    'chat-off': <><path { ...S } d="M8 4h10.5A1.5 1.5 0 0 1 20 5.5v9c0 .6-.3 1-.8 1.3M15 16h-5l-5 4v-4h0.5A1.5 1.5 0 0 1 4 14.5V5.5" />{ slash }</>,
    sliders: <><path { ...S } d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle { ...S } cx="15" cy="7" r="2" /><circle { ...S } cx="9" cy="17" r="2" /></>,
    share: <path { ...S } d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" />,
    calendar: <><rect { ...S } x="3" y="5" width="18" height="16" rx="2" /><path { ...S } d="M3 10h18M8 3v4M16 3v4" /></>,
    eye: <><path { ...S } d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle { ...S } cx="12" cy="12" r="3" /></>,
    check: <path { ...S } d="m5 12.5 4.5 4.5L19 7" />,
    retry: <path { ...S } d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" />,
    alert: <><circle { ...S } cx="12" cy="12" r="9" /><path { ...S } d="M12 7.5v5.5M12 16.5v.01" /></>,
    clock: <><circle { ...S } cx="12" cy="12" r="9" /><path { ...S } d="M12 7v5l3 2" /></>,
    signal: <path { ...S } d="M5 19v-2M10 19v-5M15 19v-8M20 19V8" />,
    mic,
    'mic-off': <>{ mic }{ slash }</>,
    camera,
    'camera-off': <>{ camera }{ slash }</>,
    screen: <><rect { ...S } x="2.5" y="4" width="19" height="13" rx="2" /><path { ...S } d="M8 21h8M12 17v4" /></>,
    'flip-camera': <><path { ...S } d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><path { ...S } d="M9 12.5a3 3 0 0 1 5.5-1.5M15 13a3 3 0 0 1-5.5 1.5M14.5 9v2h-2M9.5 17v-2h2" /></>,
    hand: <path { ...S } d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 4.5a1.5 1.5 0 0 1 3 0V11M14 6a1.5 1.5 0 0 1 3 0v6M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.5a6 6 0 0 1-4.6-2.2L4 15a1.5 1.5 0 0 1 2.3-2l1.7 1.8" />,
    people: <><circle { ...S } cx="9" cy="8" r="3.5" /><path { ...S } d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>,
    more: <><circle { ...F } cx="5" cy="12" r="1.8" /><circle { ...F } cx="12" cy="12" r="1.8" /><circle { ...F } cx="19" cy="12" r="1.8" /></>,
    close: <path { ...S } d="m6 6 12 12M18 6 6 18" />,
    smile: <><circle { ...S } cx="12" cy="12" r="9" /><path { ...S } d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5v.01M15 9.5v.01" /></>,
    send: <path { ...S } d="M4 12 20 4l-4.5 16-3.5-6.5z" />,
    pin: <path { ...S } d="M9 4h6M10 4v5.5L7 13h10l-3-3.5V4M12 13v7" />,
    broadcast: <><circle { ...F } cx="12" cy="12" r="2.5" /><path { ...S } d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" /></>,
    stop: <rect { ...F } x="6" y="6" width="12" height="12" rx="2" />,
    pause: <><rect { ...F } x="6.5" y="5" width="4" height="14" rx="1" /><rect { ...F } x="13.5" y="5" width="4" height="14" rx="1" /></>,
    link: <path { ...S } d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
    copy: <><rect { ...S } x="8.5" y="8.5" width="11" height="11" rx="2" /><path { ...S } d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>,
    stats: <path { ...S } d="M5 19.5V13M10 19.5V5M15 19.5v-9M20 19.5v-4" />,
    grid: <><rect { ...S } x="3.5" y="4.5" width="7.5" height="6.5" rx="1.5" /><rect { ...S } x="13" y="4.5" width="7.5" height="6.5" rx="1.5" /><rect { ...S } x="3.5" y="13" width="7.5" height="6.5" rx="1.5" /><rect { ...S } x="13" y="13" width="7.5" height="6.5" rx="1.5" /></>,
    spotlight: <><rect { ...S } x="2.5" y="4.5" width="19" height="15" rx="2" /><circle { ...S } cx="12" cy="10.5" r="2.5" /><path { ...S } d="M7.5 19.5a4.5 4.5 0 0 1 9 0" /></>,
    chevron: <path { ...S } d="m9 6 6 6-6 6" />,
    'chevron-down': <path { ...S } d="m6 9 6 6 6-6" />,
    'arrow-down': <path { ...S } d="M12 5v14M6 13l6 6 6-6" />,
    'arrow-left': <path { ...S } d="M19 12H5M11 6l-6 6 6 6" />,
    external: <path { ...S } d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />,
    settings: <><circle { ...S } cx="12" cy="12" r="3" /><path { ...S } d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
    // A line rising to its high: the most watching at once.
    peak: <path { ...S } d="M3 17l5.5-5.5 4 4L21 7M15 7h6v6" />
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon( props : { name : IconName, className? : string } ){
    return (
        <svg className={ 'estream-icon' + ( props.className ? ' ' + props.className : '' ) } viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            { ICONS[ props.name ] }
        </svg>
    );
}
