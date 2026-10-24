import type {
    AudioCaptureOptions, ConnectionQuality, createLocalScreenTracks, createLocalTracks, DisconnectReason, LocalTrack, LocalVideoTrack, Participant, RemoteVideoTrack,
    Room, RoomConnectOptions, RoomOptions, ScreenShareCaptureOptions, Track, TrackPublication, TrackPublishOptions, VideoCaptureOptions,
    VideoQuality
} from "@wordplus/rtc-client";
// The package itself by its name, never by a path: Easy Stream's WordPress build swaps this
// one specifier for the page's window.wordplusRealtimeClient (its scripts/esbuild-wordplus-realtime.mjs), so a page
// keeps one connector, the newest copy on the site; an app's bundler resolves it to the same package it imports.
import {realtime, type Channel, type RealtimeClient, type RealtimeOptions} from "@wordplus/realtime-client";
import {
    CHECK_PATH, INGEST_IDENTITY, JOIN_PATH, LIVE_PATH, REACTION_EMOJI,
    type Banned, type ChatMessage, type Corner, type Hand, type Hello, type HiddenPictures, type IngestReply, type JoinFailure, type JoinReply, type Layout, type LiveStream,
    type MediaSeat, type Person, type Quality, type Reaction, type Role, type StreamState, type Usage, type Watched, type You
} from "./protocol.js";
import {avatarIn, issuerOf} from "./grant.js";
import {pageMedia, type Media} from "./media.js";
import {chosenLayer, layersOf, PlaybackMonitor, type PictureLayer, type PlaybackStats} from "./playback.js";
import type {SendingStats} from "./playback-types.js";
import {SendingReader} from "./sending.js";
import {backupFor, CHROMIUM_H264_ENCODE, cameraCodecFor, hardwareFromCaps, roomCallChoice, screenCodecFor, screenPublish, SCREEN_CONTENT_HINT, SCREEN_DEGRADATION, type CameraCodec, type CameraCodecCaps, type CodecPolicy} from "../calls/room-publish.js";
import {probeCodecCaps} from "../calls/codecs.js";
import {watchCameraEncoder} from "../calls/encoder-watch.js";

// The browser side of Easy Stream without a UI: trades a grant for seats, keeps
// the chat socket, watches the stream once it is live, and for a host or guest publishes. A UI reads
// getState() and subscribes to changes; nothing here touches the DOM. Easy Stream's engine, moved here whole from
// its @easy-stream/client, which is now a thin layer over it.
//
// @wordplus/rtc-client, the video's part and most of the weight, is fetched only once video is coming: the
// stream is live, or a host is here (media(), the `media` option). Until then a page has the chat alone.
//
// The chat socket is a channel of this package's connector, which every product shares (its protocol's version 2):
// one connection per browser, in the connector's SharedWorker where the page has its URL (`worker`), carrying Better
// Messages and every other WordPlus product beside the chat. It goes straight to a node of the realtime
// server, and when that node drains the whole connection moves to another before it lets the old one go.

export type MediaPhase = 'off' | 'connecting' | 'waiting' | 'live' | 'reconnecting';

// The picture a viewer takes: `auto` is the best the player's size and the connection allow; the others are the
// sender's layer of that quality whatever the player's size, `low` and `medium` saving data.
export type VideoChoice = 'auto' | 'high' | 'medium' | 'low';

// How well this browser's media connection carries, as the media server rates it.
export type ConnectionHealth = 'good' | 'poor' | 'lost' | 'unknown';

// What this page counted since the stream went live (EasyStreamClient.startTally): the messages and reactions, and the
// peak, which is the cloud's where it keeps one (peakOf).
export interface Tally {
    peak : number;
    messages : number;
    reactions : number;
}

// A camera, microphone or speakers, as the browser names it. Names come once the page may use the
// devices: until the first preview they may be empty.
export interface DeviceChoice {
    id : string;
    label : string;
}

export interface Devices {
    cameras : DeviceChoice[];
    microphones : DeviceChoice[];
    speakers : DeviceChoice[];
}

// A picture as it is sent (the host's camera or screen) or as it arrives (OBS's). `limited` says what holds
// a sent picture back below what it could be.
export interface MediaStats {
    width : number;
    height : number;
    fps : number;
    kbps : number;
    limited : 'bandwidth' | 'cpu' | null;
    // Sending nothing, while nobody has the picture on screen: the media server turned every layer off (dynacast),
    // and turns them on again for the first viewer who does.
    paused? : boolean;
    // Sending less than the quality chosen because no viewer's player needs more now: the media server turned the
    // bigger layers off, and turns them on for the first that does (a large window, full screen).
    held? : boolean;
    // OBS's picture: seconds between its key frames, once two have come (KEYFRAME_WINDOW_MS).
    keyframeSeconds? : number;
}

export interface Tile {
    identity : string;
    name : string;
    // Their avatar, as their site gave it in their grant (an https address), or null: what shows without a picture.
    avatar? : string | null;
    role : Role;
    local : boolean;
    camera : Track | null;
    screen : Track | null;
    // Remote audio only; a local microphone is never played back.
    audio : Track[];
    micMuted : boolean;
    speaking : boolean;
    // The host's encoder (OBS over WHIP), whose picture is the broadcast as it was made.
    encoder : boolean;
}

// Where the host's encoder sends over WHIP, and with which key.
export interface EncoderSetup {
    url : string;
    key : string;
}

export interface FloatingReaction {
    id : number;
    kind : Reaction;
    at : number;
}

export interface EasyStreamState {
    // `unconnected`: the cloud doesn't take the site's streams yet, and this page's host (options.offlineHost) sets up
    // the camera, the microphone and a shared screen in the preview, without going live.
    status : 'joining' | 'ready' | 'error' | 'unconnected';
    error : string | null;
    stream : StreamState | null;
    you : You | null;
    chatConnected : boolean;
    viewers : number;
    // The most viewers the stream takes, from the cloud (the beta's 50), or null from a cloud that doesn't say.
    audience : number | null;
    // For a host, what the site's account has left to stream with (credits: the plan's, those bought, those borrowed) and whether new viewers can join, as
    // WordPlus Cloud last said; null while it hasn't, and for anyone else. Asked again every USAGE_EVERY_MS.
    usage : Usage | null;
    slow : number;
    chat : ChatMessage[];
    hands : Hand[];
    handRaised : boolean;
    invited : boolean;
    onStage : boolean;
    media : MediaPhase;
    waitUntil : number | null;
    tiles : Tile[];
    audioBlocked : boolean;
    devices : { camera : boolean, microphone : boolean };
    // The microphone as it hears, for music (setOriginalSound()): no echo cancellation, noise suppression nor gain
    // control, in stereo at 128 kbps. Off, it is tuned for speech, mono at 48.
    originalSound : boolean;
    screenSharing : boolean;
    // Whether this browser can share a screen at all: a phone's can't (no getDisplayMedia).
    canShareScreen : boolean;
    reactions : FloatingReaction[];
    // Once the host chose to stream from OBS.
    encoder : EncoderSetup | null;
    quality : VideoChoice;
    // The picture a host sends, camera and screen: chosen in the studio before going live, up to `topQuality`,
    // the best the site's plan allows (the join's `you.quality`). A guest sends 720p.
    sendQuality : Quality;
    topQuality : Quality;
    connection : ConnectionHealth;
    tally : Tally;
    // Which way the camera looks, on a phone that has two.
    facing : 'user' | 'environment';
    // The message pinned over the chat, and what everyone sees on stage, as moderators and the host chose.
    pinned : ChatMessage | null;
    layout : Layout;
    // Until when you may not write in the chat (a moderator's timeout), in ms.
    timeoutUntil : number | null;
    // Whether the stream takes reactions now: its site turns them off and on, during the stream too.
    reactionsOn : boolean;
    // When the host last muted your microphone on stage.
    mutedByHost : number | null;
    // A host's stream going out from another window of theirs (the admin studio beside the stream's page): this
    // one sees it as viewers do and sends nothing of its own.
    elsewhere : boolean;
    // This window has sent the live stream (its camera, microphone or screen): leaving it takes them off the stream.
    sentHere : boolean;
    // The main picture shows no new frame while it should (playbackStats() says more).
    stalled : boolean;
    // A viewer's connection could not carry the picture: it is off for them, the sound goes on alone, and it is tried
    // again by itself after a while (TOO_SLOW_RETRY_MS) or at once by retryPicture().
    tooSlow : boolean;
    // The browser says it is offline.
    offline : boolean;
}

export type GrantSource = string | ( () => Promise<string> );

export interface EasyStreamOptions {
    // The cloud's origin, such as https://cloud.better-messages.com.
    cloud : string;
    // A grant, or a function that fetches one; a function is asked again when a grant has expired.
    grant : GrantSource;
    // Fetches @wordplus/rtc-client on first need: the live stream plugin's own file (wordplus-stream-media.js), or the SDK's rooms
    // script (loadLiveKit). Without it, the page's window.WordPlusRTC, once a rooms script has put it there.
    media? : () => Promise<Media>;
    // The realtime connector's SharedWorker, the site's (the WordPress plugin's wordplus_realtime_worker_url()).
    // Without it the page holds the connection itself.
    worker? : string | null;
    // Whether the page shows the picture (default true). One that shows only the chat or the stream's details
    // never fetches the video's part nor watches, until something on it wants the picture (wantVideo()).
    video? : boolean;
    // The product the stream is watched or sent from, and its version, which each join of the stream's room tells the
    // media server (@wordplus/rtc-client's meshApp, a join's `rtc_app`), as a call's product does.
    app? : { name : string, version? : string };
    // A host's page on a site whose streams the cloud doesn't take yet (no licence, or one without streaming): the
    // join's refusal (UNCONNECTED) leaves it `unconnected` rather than in error, with the host in it under this name,
    // so the preview opens as it would. Nothing goes live, nor reaches OBS, from it.
    offlineHost? : { name : string };
    // Stand-ins for tests. realtime is the page's shared connector (@wordplus/realtime-client's realtime()).
    fetch? : typeof fetch;
    realtime? : ( options : RealtimeOptions ) => RealtimeClient;
    Room? : new ( options? : RoomOptions ) => Room;
    createLocalTracks? : typeof createLocalTracks;
    // With it, the browser counts as one that can share a screen.
    createLocalScreenTracks? : typeof createLocalScreenTracks;
    random? : () => number;
    // The camera's codec, and the screen's, in place of the media server's policy and what this browser encodes.
    cameraCodec? : () => Promise<CameraCodec>;
    // What this browser encodes, in place of asking it (probeCodecCaps()).
    codecCaps? : () => Promise<CameraCodecCaps | null>;
}

// The codecs a host's camera and screen go out in, and what goes behind the camera (chosenCodecs()).
type StreamCodecs = { camera : CameraCodec, screen : CameraCodec, backup : 'vp8' | 'h264' | null };

// The codec a camera goes out in: the rule Better Messages' and the SDK's group calls take too (calls/room-publish.ts,
// cameraCodecFor()). H.265 where this device encodes it in hardware and the stream is on the mesh (`h265`), H.264
// where it encodes that in hardware, each with VP8 behind it for a viewer that decodes neither; VP8 otherwise. Scored
// against Xiph's KristenAndSara at 720p (VMAF, encoders set as Chrome sets them): VP8 82 at 1.2 Mbit/s and 88 at
// 2.5; H.264 in a Mac's hardware 89 at 0.84 Mbit/s and 94 at 1.76.
export type { CameraCodec };

const PROBES = { h264: 'video/H264;profile-level-id=42e01f;packetization-mode=1', h265: 'video/H265' } as const;

type CodecNavigator = { userAgent? : string, mediaCapabilities? : { encodingInfo? : ( config : any ) => Promise<{ supported : boolean, powerEfficient? : boolean }> } };

export async function cameraCodec(
    nav : CodecNavigator | undefined = globalThis.navigator as CodecNavigator | undefined,
    options : { h265? : boolean } = {}
) : Promise<CameraCodec> {
    const agent = nav?.userAgent ?? '';
    if( /firefox\/|fxios\//i.test( agent ) ) return 'vp8';

    const probe = nav?.mediaCapabilities;
    const hardware = async ( contentType : string ) : Promise<boolean> => {
        if( ! probe || typeof probe.encodingInfo !== 'function' ) return false;
        try {
            const info = await probe.encodingInfo( { type: 'webrtc', video: { contentType, width: 1280, height: 720, framerate: 30, bitrate: 1_800_000 } } );
            return info.supported && !! info.powerEfficient;
        } catch ( e ) {
            return false;
        }
    };
    // WebKit encodes H.264 in hardware whatever its probe says (cameraCodecFor), so isn't asked of it. On the mesh,
    // which takes a desktop Chrome's Baseline, Chromium is asked of that too (CHROMIUM_H264_ENCODE): it encodes the
    // Constrained Baseline PROBES asks of in OpenH264.
    const webkit = /iphone|ipad|ipod/i.test( agent ) || /^((?!chrome|chromium|crios|edg|opr|android|firefox|fxios).)*safari/i.test( agent );
    const [ h264, h265, h264Baseline ] = await Promise.all( [
        webkit ? true : hardware( PROBES.h264 ),
        options.h265 ? hardware( PROBES.h265 ) : false,
        options.h265 && ! webkit ? hardware( CHROMIUM_H264_ENCODE ) : false
    ] );
    return cameraCodecFor( agent, { h264, h265, h264Baseline }, { h265: options.h265 } );
}

type Ack = { ok : true, [ key : string ] : any } | { ok : false, error : string };
type WatchAnswer = ( { ok : true } & Watched ) | { ok : false, error : string };

// On a socket of several streams (openChat): the key every tab of the browser shares it by, the socket's own
// events, which say nothing of whom they are for, and how soon a watch that failed is tried again.
const CHAT_SHARE = 'estream';
const SOCKET_EVENTS = [ 'connect', 'disconnect', 'connect_error' ];
const WATCH_AGAIN_MS = 3000;

// A viewer away from a live stream (setAway) asks the site's live list this often, as often as the cloud counts, and
// looks this often whether the page, out of sight, is seen again.
const LIST_EVERY_MS = 30000;
const LIST_HIDDEN_MS = 5000;
const AWAY_AFTER_MS = 2000;

// A channel of the page's connector 2.3.0 or later, which keeps a farewell; the page may have an older copy's.
const hasFarewell = ( chat : Channel ) => typeof ( chat as Partial<Channel> ).farewell === 'function';

// A shared screen: no bigger than the quality sent, at 30 frames a second, so a video or a demo on it plays
// smoothly (the RTC client's default is 15), with its sound, a tab's video or music. That sound as it plays, with none
// of a microphone's processing, which takes music for noise and echo, and without what this page plays itself, such
// as a guest's voice, which would go out twice (restrictOwnAudio, Chromium's). Not this tab, the studio, which would
// show itself over and over.
function screenCapture( quality : Quality ) : ScreenShareCaptureOptions {
    return {
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true },
        selfBrowserSurface: 'exclude',
        resolution: quality === '1080p' ? { width: 1920, height: 1080, frameRate: 30 } : { width: 1280, height: 720, frameRate: 30 }
    };
}

// How a shared screen goes out, as a group call's does (calls/room-publish.ts): in its codec (chosenCodecs(): the
// hardware's H.264 where there is one, else VP8), its picture marked motion (SCREEN_CONTENT_HINT, set as it is shared) and
// keeping its size when short of bandwidth or CPU (SCREEN_DEGRADATION), so smooth where it can be and sharp where it
// can't. In H.264 or H.265 from 1280 by 640, in three pictures for viewers' different screens and connections, as the
// camera's sizes go (screenLayers()); in VP8 whole only, one picture, as Chrome encodes VP8 simulcast of a screen at a
// few frames a second (screenPublish). Its sound goes in stereo at 128 kbps, where a microphone's speech goes mono at 48.
function screenPublishing( lk : Media, track : LocalTrack, quality : Quality, codec : CameraCodec ) : TrackPublishOptions {
    const top = quality === '1080p' ? 3_000_000 : 2_000_000;
    let settings : MediaTrackSettings = {};
    try {
        settings = track.mediaStreamTrack.getSettings();
    } catch ( e ) {
        // A track that says nothing of its size goes whole.
    }
    const layers = screenPublish( settings.width ?? 0, settings.height ?? 0, codec ).simulcast
        ? screenLayers( settings.width ?? 0, settings.height ?? 0, quality )
        : [];

    return {
        videoCodec: codec,
        screenShareEncoding: { maxBitrate: top, maxFramerate: 30 },
        degradationPreference: SCREEN_DEGRADATION,
        audioPreset: { maxBitrate: 128_000 },
        forceStereo: true,
        ...( layers.length > 0
            ? { simulcast: true, screenShareSimulcastLayers: layers.map( ( l ) => new lk.VideoPreset( l.width, l.height, l.bitrate, l.fps ) ) }
            : { simulcast: false } )
    };
}

// The two pictures under a shared screen's whole one, smallest first, in its shape: 360 lines at 15 frames for a
// phone or a slow connection, and at 30 frames one of 720 lines under a 1080p stream's screen (540 under a 720p
// stream's) for a player of a laptop's size, as the camera's middle layer goes. A screen of fewer than 640 lines goes
// whole only. Before, a screen had one picture half its size under it, and a viewer whose connection could not carry
// the whole one dropped straight to half.
export function screenLayers( width : number, height : number, quality : Quality ) : Array<{ width : number, height : number, bitrate : number, fps : number }> {
    if( width <= 0 || height < 640 ) return [];
    const middle = quality === '1080p' && height > 720 ? 720 : 540;
    const sized = ( lines : number ) => Math.round( lines * width / height / 2 ) * 2;

    return [
        { width: sized( 360 ), height: 360, bitrate: 400_000, fps: 15 },
        { width: sized( middle ), height: middle, bitrate: middle === 720 ? 1_500_000 : 1_000_000, fps: 30 }
    ];
}

// Whether this browser can share a screen: no phone's browser can (no getDisplayMedia).
export function canShareScreen( nav : { mediaDevices? : { getDisplayMedia? : unknown } } | undefined = globalThis.navigator ) : boolean {
    return typeof nav?.mediaDevices?.getDisplayMedia === 'function';
}

// Whether this browser is a phone's or a tablet's, as its user agent says, or an iPad's, which says it is a Mac's but
// has a touch screen.
export function handheld( nav : { userAgent? : string, maxTouchPoints? : number } | undefined = globalThis.navigator ) : boolean {
    const agent = String( nav?.userAgent ?? '' );
    return /Android|iPhone|iPad|iPod|Mobile/i.test( agent ) || ( /Macintosh/.test( agent ) && Number( nav?.maxTouchPoints ) > 1 );
}

const CHAT_KEPT = 200;
const REACTIONS_SHOWN = 40;
const REACTION_LIFE_MS = 4000;
// A media token lives 6 hours; one older than this is renewed before a connect.
const SEAT_FRESH_MS = 5 * 3600 * 1000;
// A full mesh adds a node within minutes, so a viewer waits that long for a place.
const MESH_JOIN_BUDGET_MS = 5 * 60 * 1000;
// When a stream goes live, viewers spread their connects over this much time.
const LIVE_JITTER_MS = 2000;
// A viewer whose video could not be reached tries again after this, twice as long each time, up to the
// most (plus the jitter, so a crowd doesn't come back at once).
const MEDIA_RETRY_MS = 2000;
const MEDIA_RETRY_MAX_MS = 60000;
// A viewer of a full stream tries for a place this often, and one still connecting this long into a full stream is
// told it waits for a place.
const FULL_RETRY_MS = 10000;
const FULL_AFTER_MS = 4000;
// A viewer refused while the site's streams take no new viewers (`no_hours`: its account's credits
// spent) asks again this often (plus the jitter), so a page left open comes in once credits are bought.
const NO_HOURS_RETRY_MS = 60000;
// The join's refusals of a site whose streams the cloud doesn't take: no key yet (the site's own word), a licence it
// doesn't know or take, and a plan without streaming. A host's page (options.offlineHost) is `unconnected` after them.
const UNCONNECTED = new Set( [ 'not_configured', 'not_licensed', 'not_included' ] );
// How often a host's page asks what the site has left (the check), so the studio says when new viewers can't join.
const USAGE_EVERY_MS = 120000;
// A viewer's picture that stopped coming is taken up again by joining the room afresh, as closing the stream and
// opening it again does (rejoinStalled): one still reconnecting this long after it began (the RTC client's own tries
// are quicker), and one whose page came back into sight (a phone drops a hidden page's connections, and the RTC client
// paused its picture meanwhile) and is still reconnecting, or gets nothing over FLOW_SAMPLE_MS, FLOW_CHECK_MS after,
// the time the RTC client takes to ask for its picture again. Also looked at after a reconnect.
const RECONNECT_GIVE_UP_MS = 15000;
const FLOW_CHECK_MS = 3000;
const FLOW_SAMPLE_MS = 3000;
// A picture while its page is hidden (another tab in front, the window minimized), from HIDDEN_AFTER_MS after, as the
// RTC client takes a page as hidden (its BACKGROUND_REACTION_DELAY): its smallest layer, not paused. Paused, as the RTC
// client pauses a hidden page's pictures (adaptive stream's pauseVideoInBackground), a picture came back with the next
// key frame the media server asked its sender for, which for a shared screen it asks at most every 3 s (WordPlus Mesh's
// screen_key_frame_request_delay): with other viewers coming and going, 3.1-3.3 s of a still picture after coming back,
// 1.1 s alone (2026-10-23: a viewer back from another tab waited about 3 s for the stream to play again). Kept at its
// smallest layer, it moves at once and sharpens with the next key frame. Paused as before on phones, in huge streams
// and when the host sends no small layer: on a phone or tablet (handheld()), where the sender's smallest layer is more
// than HIDDEN_LOW_SIDE pixels on its short side or of a size it doesn't say (an encoder over WHIP), and wherever the
// cloud says to pause them: from as many viewers as the number it sets (the server's to change, without a reload, 50 to
// begin with), told in the hello and as `hidden` once that changes, and by a cloud that says nothing (before
// 2026-10-23).
const HIDDEN_AFTER_MS = 5000;
const HIDDEN_LOW_SIDE = 360;
// How long a browser holds what arrives before playing it (RTCRtpReceiver.jitterBufferTarget). Left to itself it holds
// about a frame, 13 ms on a desktop Chrome: a packet the host's upload lost comes back a round trip later, and its frame
// then plays late, a jolt each time (seen at about 1% lost on the way to Frankfurt, on stock LiveKit as on the mesh).
// On stage, where people talk to each other, 150 ms covers a 50 ms round trip
// (WordPlus Mesh's TestJitterBufferUnderLoss: 1% lost over a 50 ms round trip played 50 ± 21 ms between frames, 50 ± 6
// at 150 ms). A viewer holds a second, which a live stream can spare: each lost packet then has time for several tries,
// not one. A viewer in Ukraine of a stream through Canada's node (140 ms away, about 7% lost on the way down at 2.5
// Mbit/s, the host's upload clean) dropped 73 and 112 frames and froze 5-6 times in 30 s at 300 ms, and dropped none
// and never froze at 1000, decoding 29 frames a second of 29.
const VIEWER_JITTER_BUFFER_MS = 1000;
const STAGE_JITTER_BUFFER_MS = 150;
// OBS's key frames counted over this long (keyframeSeconds()): OBS makes one at its interval alone, never when a
// viewer asks, so a viewer coming in, back to the page from another, or to another size of the picture waits for the
// next. OBS's Keyframe Interval left at 0 (auto, and Simple output mode has no other) gave one every 8.2 s at 30 fps.
const KEYFRAME_WINDOW_MS = 30000;
// A picture's pixel density while a viewer chose its quality: a player of any size then reckons more pixels than the
// largest layer has (a 160-pixel thumbnail, 1,600), so the cap alone decides (capQuality).
const CHOSEN_DENSITY = 10;
// A viewer's picture too much for their connection (playback.ts, TOO_SLOW_MS) is turned off, so the sound has the
// connection to itself, and tried again after TOO_SLOW_RETRY_MS, twice as long after each try that fails as well, up to
// TOO_SLOW_RETRY_MAX_MS. A try that plays TOO_SLOW_KEPT_MS starts the waits over. The media server's own way keeps
// sending the picture's smallest layer while the connection cannot carry it, for its feedback: on 780 kbit/s down, a
// layer of 2,250 kbit/s was sent 27 s with 20-45% of the sound made up, and tried again 14 s after with the same. The
// first try comes soon, for a connection that was bad only for a while; each try that fails costs a few seconds of sound.
const TOO_SLOW_RETRY_MS = 10_000;
const TOO_SLOW_RETRY_MAX_MS = 160_000;
const TOO_SLOW_KEPT_MS = 30_000;
// A person's sound is held as long as their picture, less SYNC_SLACK_MS, looked at every SYNC_TICK_MS. The media
// server's playout delay holds pictures only: a stream's room asks 300 ms, which WordPlus Mesh (1.0.7) raises to three
// round trips of a path that repairs, up to 2 s, while sound plays at the client's own hold. On stage that put sound
// 150 ms and more before the lips; in a Better Messages call through Canada's node the picture was held ~370 ms and
// the sound 131 (2026-10-12), sound ~170 ms early, where ITU-R BT.1359 takes 45 ms as noticeable and 90 as the most
// acceptable. Chromium shows a picture 56-73 ms before its sound when neither is held (WordPlus Mesh's TestLipSync),
// so 100 ms less keeps them within what's noticed while sound waits no longer than it must. Never under the client's
// own hold, at most jitterBufferTarget's 4 s; a change under SYNC_STEP_MS isn't made, so sound isn't stretched for
// nothing.
const SYNC_TICK_MS = 2000;
const SYNC_SLACK_MS = 100;
const SYNC_STEP_MS = 20;
const SYNC_MAX_MS = 4000;

type HeldReceiver = RTCRtpReceiver & { jitterBufferTarget? : number | null };

const initialState : EasyStreamState = {
    status: 'joining',
    error: null,
    stream: null,
    you: null,
    chatConnected: false,
    viewers: 0,
    audience: null,
    usage: null,
    slow: 0,
    chat: [],
    hands: [],
    handRaised: false,
    invited: false,
    onStage: false,
    media: 'off',
    waitUntil: null,
    tiles: [],
    audioBlocked: false,
    devices: { camera: false, microphone: false },
    originalSound: false,
    screenSharing: false,
    canShareScreen: false,
    reactions: [],
    encoder: null,
    quality: 'auto',
    sendQuality: '720p',
    topQuality: '720p',
    connection: 'unknown',
    tally: { peak: 0, messages: 0, reactions: 0 },
    facing: 'user',
    pinned: null,
    layout: { mode: 'grid', identity: null },
    timeoutUntil: null,
    reactionsOn: true,
    mutedByHost: null,
    elsewhere: false,
    sentHere: false,
    stalled: false,
    tooSlow: false,
    offline: false
};

// When a stream's state was set: going live sets started_at and clears ended_at, ending sets ended_at,
// so of two states of one stream the later has the larger (an ended stream may go live again).
const stateTime = ( s : StreamState ) => Math.max( s.started_at ?? 0, s.ended_at ?? 0 );

// Chat ids are Redis stream ids, "<ms>-<seq>".
function compareChatIds( a : string, b : string ) : number {
    const [ am = 0, as = 0 ] = a.split( '-' ).map( Number );
    const [ bm = 0, bs = 0 ] = b.split( '-' ).map( Number );
    return am !== bm ? am - bm : as - bs;
}

const GRID : Layout = { mode: 'grid', identity: null };

// A layout as the cloud sends it, or the grid for anything else.
function cleanLayout( layout : unknown ) : Layout {
    const l = layout as Partial<Layout> | null;
    if( ! l || ( l.mode !== 'grid' && l.mode !== 'speaker' && l.mode !== 'spotlight' ) ) return GRID;
    const corner = cleanCorner( l.corner );
    return { mode: l.mode, identity: l.mode === 'spotlight' && typeof l.identity === 'string' ? l.identity : null, ...( corner ? { corner } : {} ) };
}

// Where the sharer's camera sits over a screen (Layout's `corner`): each share from 0 to 1, or none.
function cleanCorner( corner : unknown ) : Corner | null {
    const c = corner as Partial<Corner> | null | undefined;
    const share = ( n : unknown ) : n is number => typeof n === 'number' && n >= 0 && n <= 1;
    return c && share( c.x ) && share( c.y ) ? { x: c.x, y: c.y } : null;
}

// A layout as the host sends it: the identity only with the spotlight, the corner where there is one.
const layoutAsked = ( mode : Layout['mode'], identity : string | null | undefined, corner : Corner | null | undefined ) => ( {
    mode, ...( mode === 'spotlight' ? { identity } : {} ), ...( corner ? { corner } : {} )
} );

// What a hello says beyond the stream, the chat and the hands; a cloud that predates them says none of it.
function helloExtras( hello : Hello ) : Pick<EasyStreamState, 'pinned' | 'layout' | 'timeoutUntil' | 'reactionsOn'> {
    return {
        pinned: hello.pinned ?? null,
        layout: cleanLayout( hello.layout ),
        timeoutUntil: typeof hello.timeout === 'number' && hello.timeout > Date.now() ? hello.timeout : null,
        reactionsOn: hello.reactions !== false
    };
}

// The stream's peak since it went live, as the cloud keeps it, at least those watching now: the same on every page, one
// opened or reloaded during the stream too. A cloud before it says none, and the page then keeps the most it has seen
// itself.
function peakOf( cloud : number | undefined, watching : number, seen : number ) : number {
    return typeof cloud === 'number' ? Math.max( cloud, watching ) : Math.max( seen, watching );
}

function healthOf( quality : ConnectionQuality ) : ConnectionHealth {
    switch( String( quality ) ){
        case 'excellent':
        case 'good':
            return 'good';
        case 'poor':
            return 'poor';
        case 'lost':
            return 'lost';
        default:
            return 'unknown';
    }
}

// The person a place in the room is of. A user has a place in each tab, their identity and 8 hex characters (the
// cloud's mediaIdentity()); a visitor's, a guest's on stage and an encoder's are the identity itself.
export function personOf( identity : string ) : string {
    return /^u:.+\.[0-9a-f]{8}$/.test( identity ) ? identity.slice( 0, identity.lastIndexOf( '.' ) ) : identity;
}

function roleOf( participant : Participant ) : Role {
    try {
        const meta = JSON.parse( participant.metadata || '{}' );
        if( meta.role === 'host' || meta.role === 'guest' ) return meta.role;
    } catch ( e ) {
    }
    return 'viewer';
}

// The avatar the cloud put in a person's place in the room, from their grant.
function avatarOf( participant : Participant ) : string | null {
    try {
        const avatar = JSON.parse( participant.metadata || '{}' ).avatar;
        return typeof avatar === 'string' && avatar.startsWith( 'https://' ) ? avatar : null;
    } catch ( e ) {
        return null;
    }
}

export class EasyStreamClient {
    private state : EasyStreamState = initialState;
    private readonly listeners = new Set<() => void>();
    private readonly fetch : typeof fetch;
    private readonly realtime : ( options : RealtimeOptions ) => RealtimeClient;
    private readonly random : () => number;
    // @wordplus/rtc-client once fetched (media()), and its fetch while under way.
    private lk : Media | null = null;
    private lkLoading : Promise<Media> | null = null;
    private mediaRetries = 0;

    private joined : JoinReply | null = null;
    private joinedAt = 0;
    // The chat's channel on the shared connection, whose socket a move replaces.
    private chat : Channel | null = null;
    // A socket of several streams (openChat), unless a node refused one (`single`); the stream's watch on it,
    // and the round of watching, which a disconnect or a move ends, so a late answer is left be.
    private multi = false;
    private single = false;
    private watching : { w : string, key : string } | null = null;
    private watchRound = 0;
    private room : Room | null = null;
    // The server the room is on, which says whether it forwards H.265 (the mesh's)
    private seatUrl : string | undefined;
    // The room while its connect is under way: @wordplus/rtc-client says a failed join is a disconnect before the connect
    // fails, which is the connect's to answer (connectMedia).
    private joining : Room | null = null;
    // The join of the room under way, which whatever needs the room meanwhile waits for (connectMedia).
    private connectingMedia : Promise<Room | null> | null = null;
    private localTracks : LocalTrack[] = [];
    // OBS's key asked for, found sending into the room (findEncoder()).
    private findingEncoder = false;
    // A shared screen's picture and its sound, while shared (setScreenShare()).
    private screenTracks : LocalTrack[] = [];
    // The camera and microphone chosen (useDevice), for every track opened after.
    private deviceIds : { camera? : string | undefined, microphone? : string | undefined } = {};
    // The quality the host chose (setSendQuality), sent where the plan allows it: Full HD until they choose.
    private wantedQuality : Quality = '1080p';
    private watchTimer : ReturnType<typeof setTimeout> | null = null;
    private reactionTimer : ReturnType<typeof setInterval> | null = null;
    private reactionSeq = 0;
    private stopped = false;
    // Whether the page shows the picture (the `video` option, then wantVideo()).
    private video : boolean;
    // Away from the stream (setAway): what the page asked, and whether the watch has gone for it; `recheck` while the
    // stream, no longer in the site's live list, is watched again to learn how it is.
    private awayWanted = false;
    private away = false;
    private recheck = false;
    private listTimer : ReturnType<typeof setTimeout> | null = null;
    private awayTimer : ReturnType<typeof setTimeout> | null = null;
    // The site that signed the grant, whose live list an away viewer asks.
    private site = '';
    // This person's avatar, as the grant says, for their own preview before they are in the room.
    private avatar : string | null = null;
    // A stopped picture taken up again (rejoinStalled): when it is looked at next, and the page's listener for coming
    // back into sight.
    private stallTimer : ReturnType<typeof setTimeout> | null = null;
    private onSight : ( () => void ) | null = null;
    // The page hidden for HIDDEN_AFTER_MS, its pictures that keep coming at their smallest layer (capQuality): whether
    // it is, the wait for it, and whether the cloud says to keep them (the hello's `hidden`, and the event).
    private hidden = false;
    private hiddenTimer : ReturnType<typeof setTimeout> | null = null;
    private hiddenKept = false;
    private readonly handheld = handheld();
    // A picture turned off as too much for the connection: its next try, the tries that failed in a row, and the wait
    // after a try that tells it played (TOO_SLOW_KEPT_MS).
    private slowTimer : ReturnType<typeof setTimeout> | null = null;
    private slowTries = 0;
    private slowKept : ReturnType<typeof setTimeout> | null = null;
    // Sound follows picture (soundFollowsPicture): its look every SYNC_TICK_MS, whether one is running, and each
    // picture's hold as last read from its receiver's totals.
    private syncTimer : ReturnType<typeof setInterval> | null = null;
    // A viewer refused for want of credits, joining again (join); a host's page asking what the site has left.
    private joinTimer : ReturnType<typeof setTimeout> | null = null;
    private usageTimer : ReturnType<typeof setInterval> | null = null;
    private syncing = false;
    private pictureHolds = new WeakMap<object, { target : number, emitted : number, ms : number }>();
    // How the stream plays here (playbackStats()), and the pixel density adaptive stream sizes pictures by in the room
    // joined, which a viewer's chosen quality raises (capQuality).
    private readonly playback = new PlaybackMonitor( ( stalled ) => this.set( { stalled } ) );
    // What a host sends, in detail (sendingDetail()).
    private readonly sending = new SendingReader();
    private pixelDensity = 1;
    private screenDensity = 1;
    // The page's listener for the browser going offline and online (followNetwork).
    private onNetwork : ( () => void ) | null = null;

    constructor( private readonly options : EasyStreamOptions ){
        this.fetch = options.fetch ?? globalThis.fetch.bind( globalThis );
        this.realtime = options.realtime ?? realtime;
        this.random = options.random ?? Math.random;
        this.video = options.video ?? true;
        this.state = { ...this.state, canShareScreen: Boolean( options.createLocalScreenTracks ) || canShareScreen() };
        this.playback.onTooSlow = () => this.pictureTooSlow();
    }

    // Something on the page shows the picture now (a player added beside a chat): video comes as it would have.
    wantVideo(){
        if( this.video ) return;
        this.video = true;
        if( this.state.stream && this.state.status === 'ready' ) this.onStreamState( this.state.stream, false );
    }

    // Nothing on the page shows the picture any more (the stream closed beside a Better Messages conversation): the
    // video stops coming, and a host's preview goes. What this window sends live, or a guest's on stage, goes on.
    dropVideo(){
        if( ! this.video || this.state.sentHere || this.state.onStage ) return;
        this.video = false;
        this.disconnectMedia();
        this.stopLocalTracks();
    }

    // @wordplus/rtc-client, fetched on first need and kept. A failed fetch is tried again the next time.
    private media() : Promise<Media> {
        if( this.lk ) return Promise.resolve( this.lk );

        if( ! this.lkLoading ){
            this.lkLoading = ( this.options.media ?? pageMedia )().then(
                ( lk ) => ( this.lk = lk ),
                ( e ) => {
                    this.lkLoading = null;
                    throw e;
                }
            );
        }

        return this.lkLoading;
    }

    // For React's useSyncExternalStore.
    getState = () : EasyStreamState => this.state;

    subscribe = ( listener : () => void ) : ( () => void ) => {
        this.listeners.add( listener );
        return () => { this.listeners.delete( listener ); };
    };

    private set( patch : Partial<EasyStreamState> ){
        if( this.stopped ) return;
        this.state = { ...this.state, ...patch };
        for( const listener of this.listeners ) listener();
    }

    // Joins, again too once stopped: someone a moderator put out comes back this way.
    async start(){
        this.stopped = false;
        this.followSight();
        this.followNetwork();
        await this.join();
    }

    // Leaves everything: media, devices and the chat socket.
    stop(){
        this.disconnectMedia();
        this.stopLocalTracks();
        this.stopScreenTracks();
        this.closeChat();
        this.stopList();
        if( this.awayTimer ) clearTimeout( this.awayTimer );
        this.awayTimer = null;
        this.away = false;
        this.recheck = false;
        if( this.watchTimer ) clearTimeout( this.watchTimer );
        if( this.reactionTimer ) clearInterval( this.reactionTimer );
        if( this.joinTimer ) clearTimeout( this.joinTimer );
        if( this.usageTimer ) clearInterval( this.usageTimer );
        this.joinTimer = this.usageTimer = null;
        if( this.onSight ) globalThis.document?.removeEventListener( 'visibilitychange', this.onSight );
        this.onSight = null;
        this.unhide();
        if( this.onNetwork ){
            globalThis.removeEventListener?.( 'online', this.onNetwork );
            globalThis.removeEventListener?.( 'offline', this.onNetwork );
        }
        this.onNetwork = null;
        this.forgetSlow();
        this.stopped = true;
    }

    // How the stream plays in this browser, to debug it (playback.ts): what arrives and how, and the session so far.
    playbackStats() : PlaybackStats {
        return this.playback.snapshot();
    }

    // What this window sends, in detail, to debug it (sending.ts): each picture layer by layer, the sound, and the way
    // out. Null while it sends nothing. Rates come from two reads, so the first read's are 0.
    async sendingDetail() : Promise<SendingStats | null> {
        const room = this.room;
        return room ? this.sending.read( room ) : null;
    }

    // The layers the sender of a picture that arrives sends, the best first: what a viewer may choose from (setQuality).
    // None for a picture of this window's own, or one not arriving.
    pictureLayers( track : Track | null | undefined ) : PictureLayer[] {
        if( ! track ) return [];
        for( const participant of this.room?.remoteParticipants.values() ?? [] ){
            for( const publication of participant.trackPublications.values() ){
                if( publication.track === track ) return layersOf( publication );
            }
        }
        return [];
    }

    // Away from the stream: nothing on the page shows it (a Better Messages conversation whose stream was closed),
    // and a viewer there isn't one of those watching it. While it is live, its watch goes (so it isn't counted), and
    // the site's live list says how many watch, every LIST_EVERY_MS while the page is in sight; one no longer listed is
    // watched again, whose hello says how it is. Before and after it, and for its hosts and guests, who aren't counted,
    // the watch stays, so going live is heard at once. `false`: the page shows it again.
    setAway( away : boolean ){
        if( away === this.awayWanted ) return;
        this.awayWanted = away;
        this.settleAway();
    }

    private wantsAway() : boolean {
        return this.awayWanted && ! this.recheck && ! this.stopped && this.joined !== null && this.state.status === 'ready'
            && this.state.you?.role === 'viewer' && ! this.state.onStage && this.state.stream?.state === 'live';
    }

    // Back at once; away after AWAY_AFTER_MS, which a page opening the stream as it goes live takes to show it.
    private settleAway(){
        if( ! this.wantsAway() ){
            if( this.awayTimer ) clearTimeout( this.awayTimer );
            this.awayTimer = null;
            if( ! this.away ) return;
            this.away = false;
            this.stopList();
            this.openChat();
            return;
        }

        if( this.away || this.awayTimer ) return;
        this.awayTimer = setTimeout( () => {
            this.awayTimer = null;
            if( this.away || ! this.wantsAway() ) return;
            this.away = true;
            this.closeChat();
            // Its own watch, counted until now, goes from the count it shows.
            this.set( { chatConnected: false, viewers: Math.max( 0, this.state.viewers - 1 ) } );
            this.askListIn( LIST_EVERY_MS );
        }, AWAY_AFTER_MS );
    }

    private askListIn( ms : number ){
        this.stopList();
        this.listTimer = setTimeout( () => void this.askList(), ms );
    }

    private stopList(){
        if( this.listTimer ) clearTimeout( this.listTimer );
        this.listTimer = null;
    }

    private async askList(){
        this.listTimer = null;
        if( ! this.away ) return;
        if( typeof document !== 'undefined' && document.hidden ){
            this.askListIn( LIST_HIDDEN_MS );
            return;
        }

        let live : LiveStream[] | null = null;
        try {
            const response = await this.fetch( this.options.cloud.replace( /\/$/, '' ) + LIVE_PATH + '?site=' + encodeURIComponent( this.site ), { credentials: 'omit' } );
            const body = await response.json() as { ok? : boolean, live? : LiveStream[] };
            if( body?.ok && Array.isArray( body.live ) ) live = body.live;
        } catch ( e ) {
            // Asked again in a while.
        }
        if( ! this.away ) return;

        const listed = live?.find( ( s ) => s.id === this.state.stream?.id );
        if( listed ){
            this.set( { viewers: Number( listed.viewers ) || 0 } );
        } else if( live ){
            // Ended, most likely: watched again until its hello.
            this.recheck = true;
            this.settleAway();
            return;
        }
        this.askListIn( LIST_EVERY_MS );
    }

    // Joining

    private async grant( fresh : boolean ) : Promise<string> {
        const source = this.options.grant;
        if( typeof source === 'string' ){
            if( fresh ) throw new Error( 'expired' );
            return source;
        }
        return source();
    }

    private async requestSeats( retried = false ) : Promise<JoinReply> {
        let token : string;
        try {
            token = await this.grant( retried );
        } catch ( e ) {
            throw new Error( e instanceof Error && e.message ? e.message : 'no_grant' );
        }
        this.site = issuerOf( token ) || this.site;
        this.avatar = avatarIn( token );

        const res = await this.fetch( this.options.cloud.replace( /\/$/, '' ) + JOIN_PATH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify( { grant: token } )
        } );

        let body : JoinReply | JoinFailure;
        try {
            body = await res.json();
        } catch ( e ) {
            throw new Error( 'server' );
        }

        if( body.ok ) return body;

        // A grant fetched afresh may succeed where a stale one failed.
        if( body.error === 'expired' && ! retried && typeof this.options.grant === 'function' ) return this.requestSeats( true );

        throw new Error( body.error );
    }

    private async join(){
        if( this.joinTimer ) clearTimeout( this.joinTimer );
        this.joinTimer = null;
        this.set( { status: 'joining', error: null } );

        let reply : JoinReply;
        try {
            reply = await this.requestSeats();
        } catch ( e ) {
            const error = ( e as Error ).message;
            const host = this.options.offlineHost;
            if( host && UNCONNECTED.has( error ) ){
                // The host here, under the page's name for them, to set up the preview: the best quality a host
                // sends, as the cloud would give it, and no chat, stage or socket, which only the cloud has.
                this.set( { status: 'unconnected', error, you: { identity: 'local', role: 'host', name: host.name, chat: 'read', mod: true, stage: false, quality: '1080p' } } );
                this.set( this.sendQualities( this.wantedQuality ) );
                if( this.video ) this.media().catch( () => {} );
                return;
            }
            this.set( { status: 'error', error } );
            // The site's streams take no new viewers now: asked again in a while, so the page comes in once they do.
            if( error === 'no_hours' && ! this.stopped ){
                this.joinTimer = setTimeout( () => { if( ! this.stopped ) void this.join(); }, NO_HOURS_RETRY_MS + this.random() * LIVE_JITTER_MS );
            }
            return;
        }

        this.joined = reply;
        this.joinedAt = Date.now();
        this.set( { stream: reply.stream, you: reply.you, audience: reply.audience ?? null, usage: reply.usage ?? null, ...this.sendQualities( this.wantedQuality ) } );
        if( reply.you.role === 'host' ) this.watchUsage();
        // Video coming (onStreamState): its part fetched now, beside the chat socket, whose hello took about 0.5 s more.
        if( this.video && ( reply.stream.state === 'live' || reply.you.role !== 'viewer' ) ) this.media().catch( () => {} );
        // A camera turned on before the join answered had no one to show it as: it shows now.
        if( this.localTracks.length > 0 ) this.refreshTiles();
        this.openChat();
    }

    // A host's page asks what the site has left every USAGE_EVERY_MS (the check, with the page's grant), so the studio
    // says when new viewers can't join, and when they can again.
    private watchUsage(){
        if( this.usageTimer ) return;
        this.usageTimer = setInterval( () => {
            if( this.stopped || typeof document !== 'undefined' && document.hidden ) return;
            void this.askUsage();
        }, USAGE_EVERY_MS );
    }

    private async askUsage(){
        try {
            const token = await this.grant( false );
            const res = await this.fetch( this.options.cloud.replace( /\/$/, '' ) + CHECK_PATH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify( { grant: token } )
            } );
            const body = await res.json() as { ok? : boolean, usage? : Usage | null };
            if( body?.ok && ! this.stopped ) this.set( { usage: body.usage ?? null } );
        } catch ( e ) {
            // Asked again in a while.
        }
    }

    // The quality a host sends and the best they may, from the join: the socket's hello, which replaces `you`,
    // doesn't carry it. The quality wanted is kept within the best.
    private sendQualities( wanted : Quality ) : Pick<EasyStreamState, 'sendQuality' | 'topQuality'> {
        const you = this.joined?.you ?? ( this.state.status === 'unconnected' ? this.state.you : null );
        const topQuality : Quality = you?.role === 'host' && you.quality === '1080p' ? '1080p' : '720p';
        return { topQuality, sendQuality: topQuality === '1080p' ? wanted : '720p' };
    }

    // New tokens for the same person, for a socket or a room whose token ran out.
    private async renewSeats() : Promise<boolean> {
        try {
            this.joined = await this.requestSeats();
            this.joinedAt = Date.now();
            return true;
        } catch ( e ) {
            this.set( { error: ( e as Error ).message } );
            return false;
        }
    }

    // The chat socket

    // The chat socket is one of two kinds:
    // - one for every stream the browser shows, where the cloud says it can (the join's `chat.multi`): every tab
    //   shares it (the connector's `share`), each watching its stream on it with a `watch`, whose reply is the
    //   hello. Its requests name the watch, and its events say whom they are for, which this tab picks out (forUs);
    // - one for this stream alone, its token in the handshake and its hello sent once it connects.
    private openChat(){
        if( ! this.joined ) return;

        const chat = this.joined.chat;

        this.closeChat();
        this.multi = chat.multi === true && ! this.single;
        const client = this.realtime( {
            // The cloud names the realtime server (ws.wordplus.cloud), which may not be where it joined.
            server: new URL( chat.url ?? this.options.cloud ).origin,
            path: chat.path,
            worker: this.options.worker
        } );

        this.chat = this.multi ? client.attach( {
            namespace: chat.namespace,
            share: CHAT_SHARE,
            auth: () => ( { m: 1 } ),
            // A move's new socket takes over once the stream is watched there, and its hello is merged in (takeOver).
            ready: ( next ) => this.watchOn( next ),
            moved: ( reply ) => this.watched( reply as WatchAnswer, true )
        } ) : client.attach( {
            namespace: chat.namespace,
            // The latest seats' token, at every connect in the page and at the attach in the worker: new seats
            // (renewSeats) come with a new attach.
            auth: () => ( { t: this.joined?.chat.token ?? chat.token } ),
            // A move's new socket takes over once its hello has come, and that hello is merged in (takeOver).
            ready: ( next ) => new Promise<Hello>( ( resolve ) => next.once( 'hello', resolve ) ),
            moved: ( hello ) => this.takeOver( hello as Hello )
        } );
        this.listen( this.chat );
    }

    // Leaves the chat. On a socket of several streams the stream's watch goes first, so the socket stays with the
    // others the browser shows: by the channel's farewell (parted), else said here.
    private closeChat(){
        const chat = this.chat;
        if( ! chat ) return;

        if( this.watching && ! hasFarewell( chat ) ) chat.emit( 'unwatch', { w: this.watching.w } );
        this.watching = null;
        this.watchRound++;
        chat.close();
        this.chat = null;
    }

    // The stream watched on a socket of several: the channel's socket, or a move's new one.
    private watchOn( on : { timeout( ms : number ) : { emitWithAck( event : string, ...args : unknown[] ) : Promise<any> } } ) : Promise<WatchAnswer> {
        return on.timeout( 8000 ).emitWithAck( 'watch', { t: this.joined?.chat.token } )
            .catch( () => ( { ok: false, error: 'timeout' } as WatchAnswer ) );
    }

    // At each connect of a socket of several streams.
    private async watchChat(){
        const chat = this.chat;
        if( ! chat ) return;

        const round = ++this.watchRound;
        const reply = await this.watchOn( chat );

        // Answered on a socket that went since, or after a move watched the stream on its own.
        if( this.chat !== chat || round !== this.watchRound ) return;
        this.watched( reply, false );
    }

    // A watch's answer: the stream's hello, taken in as at a connect, or merged in after a move.
    private watched( reply : WatchAnswer, moved : boolean ){
        if( moved ) this.watchRound++;

        if( ! reply.ok ){
            this.watching = null;
            this.parted();
            this.watchFailed( reply.error );
            return;
        }

        this.watching = { w: reply.w, key: reply.key };
        this.parted();
        if( moved ) this.takeOver( reply.hello );
        else this.greet( reply.hello );
    }

    // What the connector sends on the shared socket should this tab leave it while others stay (its farewell, since
    // 2.3.0): the stream's unwatch, however the tab goes, closed or gone, so its watch isn't counted on.
    private parted(){
        const chat = this.chat;
        if( ! chat || ! hasFarewell( chat ) ) return;
        if( this.watching ) chat.farewell( 'unwatch', { w: this.watching.w } );
        else chat.farewell();
    }

    private watchFailed( error : string ){
        const chat = this.chat;
        if( ! chat ) return;

        if( error === 'banned' ){
            this.set( { status: 'error', error: 'banned' } );
            this.stop();
            return;
        }

        // A chat token that ran out: new seats, then the stream watched again on the same socket.
        if( error === 'bad_token' ){
            void this.renewSeats().then( ( ok ) => { if( ok && this.chat === chat ) void this.watchChat(); } );
            return;
        }

        // Anything else (no answer in time, a socket that was closing): again in a moment, if nothing has since.
        setTimeout( () => {
            if( this.chat === chat && chat.connected && ! this.watching ) void this.watchChat();
        }, WATCH_AGAIN_MS );
    }

    // Whether an event on a socket of several streams is for this tab: for its stream, for its moderators when
    // it is one, or for this person in it.
    private forUs( to : unknown ) : boolean {
        const watching = this.watching;
        if( ! watching || typeof to !== 'string' ) return false;
        if( to === watching.key ) return true;
        if( to === watching.key + '/mods' ) return this.state.you?.mod === true;
        return to === watching.key + '/' + this.state.you?.identity;
    }

    // The stream as a socket found it: its hello.
    private greet( hello : Hello ){
        this.set( {
            status: 'ready',
            chatConnected: true,
            stream: hello.stream,
            you: hello.you,
            viewers: hello.viewers,
            slow: hello.slow,
            chat: hello.history,
            hands: hello.hands,
            ...helloExtras( hello )
        } );
        this.keepHidden( hello.hidden );
        if( this.live() ) this.count( { peak: peakOf( hello.peak, hello.viewers, this.state.tally.peak ) } );
        this.onStreamState( hello.stream, false );
        this.recheck = false;
        this.settleAway();
    }

    // The chat's events. The channel passes on the current socket's only: a move's new socket hears the
    // room before it takes over, and the old one after. On a socket of several streams each event says
    // last whom it is for, and only this tab's are taken.
    private listen( channel : Channel ){
        const on = ( event : string, handler : ( ...args : any[] ) => void ) => {
            channel.on( event, ( ...args : any[] ) => {
                if( this.chat !== channel ) return;
                if( this.multi && ! SOCKET_EVENTS.includes( event ) && ! this.forUs( args.pop() ) ) return;
                handler( ...args );
            } );
        };

        on( 'hello', ( hello : Hello ) => this.greet( hello ) );
        on( 'connect', () => { if( this.multi ) void this.watchChat(); } );

        on( 'state', ( stream : StreamState ) => {
            const wasLive = this.state.stream?.state === 'live';
            this.set( { stream } );
            if( stream.state === 'live' && ! wasLive ) this.startTally();
            this.onStreamState( stream, true );
            this.settleAway();
        } );

        // Once, should the same message come twice around a move.
        on( 'chat', ( message : ChatMessage ) => {
            if( this.state.chat.some( ( m ) => m.id === message.id ) ) return;
            this.set( { chat: [ ...this.state.chat, message ].slice( -CHAT_KEPT ) } );
            if( this.live() ) this.count( { messages: this.state.tally.messages + 1 } );
        } );

        on( 'chat_deleted', ( p : { id : string } ) => {
            this.set( { chat: this.state.chat.filter( ( m ) => m.id !== p.id ) } );
        } );

        on( 'reactions', ( counts : Partial<Record<Reaction, number>> ) => {
            this.addReactions( counts );
            const n = Object.values( counts ).reduce<number>( ( sum, c ) => sum + ( Number( c ) || 0 ), 0 );
            if( this.live() ) this.count( { reactions: this.state.tally.reactions + n } );
        } );
        on( 'hidden', ( p : { pictures : HiddenPictures } ) => this.keepHidden( p?.pictures ) );
        on( 'viewers', ( p : { n : number, peak? : number } ) => {
            this.set( { viewers: p.n } );
            if( this.live() ) this.count( { peak: peakOf( p.peak, p.n, this.state.tally.peak ) } );
        } );
        on( 'slow', ( p : { seconds : number } ) => this.set( { slow: p.seconds } ) );
        on( 'hands', ( hands : Hand[] ) => this.set( { hands } ) );
        on( 'invited', () => this.set( { invited: true, handRaised: false } ) );
        on( 'unstaged', () => { this.backToWatching(); } );
        on( 'pinned', ( p : { message : ChatMessage | null } ) => this.set( { pinned: p.message ?? null } ) );
        on( 'layout', ( layout : Layout ) => this.set( { layout: cleanLayout( layout ) } ) );
        on( 'timeout', ( p : { until : number } ) => this.set( { timeoutUntil: Number( p.until ) || null } ) );
        on( 'reacting', ( p : { on : boolean } ) => this.set( { reactionsOn: p.on !== false } ) );

        // The host muted your microphone on stage: it goes off, and the player says why.
        on( 'muted', () => {
            if( ! this.state.onStage || ! this.state.devices.microphone ) return;
            this.set( { mutedByHost: Date.now() } );
            void this.setMicrophone( false );
        } );

        on( 'banned', () => {
            this.set( { status: 'error', error: 'banned' } );
            this.stop();
        } );

        // Put out by a moderator, free to come back: the player offers to join again.
        on( 'kicked', () => {
            this.set( { status: 'error', error: 'kicked' } );
            this.stop();
        } );

        // A moderator cleared the chat: its messages and the pinned one are gone for everyone.
        on( 'cleared', () => this.set( { chat: [], pinned: null } ) );

        on( 'disconnect', ( reason : string ) => {
            this.set( { chatConnected: false } );
            if( ! this.multi ) return;

            // The stream's watch went with the socket; the next connect watches it again.
            this.watching = null;
            this.watchRound++;
            this.parted();
            // The cloud closes a socket of several streams that watched nothing for a while: one still wanted
            // connects again.
            if( reason === 'io server disconnect' ) channel.connect();
        } );

        on( 'connect_error', ( e : Error ) => {
            if( e.message !== 'bad_token' ) return;

            // A node from before sockets of several streams, met during an update of the cloud: this stream
            // goes on a socket of its own.
            if( this.multi ){
                this.single = true;
                this.openChat();
                return;
            }

            // A chat token that ran out: new seats, then a new connection.
            this.closeChat();
            void this.renewSeats().then( ( ok ) => { if( ok && ! this.away ) this.openChat(); } );
        } );
    }

    // A move's new socket took over (the connector's move). Its hello is the room as it was when that socket
    // joined, and the old socket went on delivering until the switch, so the two are merged: the hello's
    // history, then any message the old socket brought after it (chat ids are Redis stream ids, in order);
    // the later of the two states of the stream (stateTime); the counts and the queue as the hello has
    // them. Nothing was missed, so there is nothing to catch up on.
    private takeOver( hello : Hello ){
        const last = hello.history[ hello.history.length - 1 ]?.id ?? null;
        const later = this.state.chat.filter( ( m ) => last === null || compareChatIds( m.id, last ) > 0 );
        const before = this.state.stream;
        const stream = before && stateTime( before ) > stateTime( hello.stream ) ? before : hello.stream;

        this.set( {
            status: 'ready',
            chatConnected: true,
            stream,
            you: hello.you,
            viewers: hello.viewers,
            slow: hello.slow,
            chat: [ ...hello.history, ...later ].slice( -CHAT_KEPT ),
            hands: hello.hands,
            ...helloExtras( hello )
        } );
        this.keepHidden( hello.hidden );

        if( stream.state !== before?.state ) this.onStreamState( stream, true );
    }

    // A request about the stream, answered; on a socket of several, it names the stream's watch.
    private ack( event : string, payload : object = {} ) : Promise<Ack> {
        const chat = this.chat;
        if( ! chat || ( this.multi && ! this.watching ) ) return Promise.resolve( { ok: false, error: 'offline' } );
        return chat.timeout( 8000 ).emitWithAck( event, this.addressed( payload ) ).catch( () => ( { ok: false, error: 'timeout' } as Ack ) );
    }

    // One that needs no answer.
    private send( event : string, payload : object ){
        if( this.multi && ! this.watching ) return;
        this.chat?.emit( event, this.addressed( payload ) );
    }

    private addressed( payload : object ) : object {
        return this.multi && this.watching ? { ...payload, w: this.watching.w } : payload;
    }

    // What a change of the stream's state means here. `changed`: it changed while we were here, as
    // opposed to how we found it.
    private onStreamState( stream : StreamState, changed : boolean ){
        const you = this.state.you;
        if( ! you ) return;

        if( this.video ){
            // Video is coming: everyone watches a live stream, and a host previews before going live. Fetched
            // now, while the rest of the page settles.
            if( stream.state === 'live' || you.role !== 'viewer' ) this.media().catch( () => {} );

            if( stream.state === 'live' && you.role === 'viewer' && ! this.state.onStage && ! this.room ){
                this.watch( changed ? this.random() * LIVE_JITTER_MS : 0 );
            }

            // A host who comes to a stream already live (a reload, another tab, the stream's page beside the studio)
            // sees it, OBS's picture included, and their camera goes out once they turn it on. Their place in the
            // room is this tab's own, so another window of theirs stays live. A window that was sending it before a
            // reload sends again what it sent: its camera and microphone. So does a window of theirs open as the
            // stream goes live from another one, which waited for the host's picture until a reload while only a
            // window coming to it live joined. The window going live is in the room by then.
            if( stream.state === 'live' && you.role === 'host' && ! this.room ){
                void this.connectMedia( 'publisher' ).then( ( room ) => { if( room ) void this.resume(); } );
            }
        }

        if( stream.state === 'ended' ){
            this.disconnectMedia();
            this.stopLocalTracks();
            this.stopScreenTracks();
            this.forgetSending();
            this.set( { onStage: false, invited: false, handRaised: false, screenSharing: false, sentHere: false } );
        }
    }

    // What this window sends while live, kept for the tab (sessionStorage) so a reload sends it again.
    private sendingKey() : string | null {
        const id = this.state.stream?.id;
        return id ? 'estream-sending:' + id : null;
    }

    private rememberSending(){
        const key = this.sendingKey();
        if( ! key ) return;
        try {
            globalThis.sessionStorage?.setItem( key, JSON.stringify( { camera: this.state.devices.camera, microphone: this.state.devices.microphone } ) );
        } catch ( e ) {
            // Storage off: a reload then starts with everything off.
        }
    }

    private forgetSending(){
        const key = this.sendingKey();
        if( ! key ) return;
        try {
            globalThis.sessionStorage?.removeItem( key );
        } catch ( e ) {
        }
    }

    // What this window sent before a reload (rememberSending()), or null.
    private sentBefore() : { camera? : boolean, microphone? : boolean } | null {
        const key = this.sendingKey();
        try {
            const saved = key ? globalThis.sessionStorage?.getItem( key ) : null;
            return saved ? JSON.parse( saved ) : null;
        } catch ( e ) {
            return null;
        }
    }

    // After a reload while live: the camera and microphone this window sent, on again and sent.
    private async resume(){
        const was = this.sentBefore();
        if( ! was || ( ! was.camera && ! was.microphone ) || ! this.live() || this.localTracks.length > 0 ) return;

        try {
            await this.openDevices( Boolean( was.camera ), Boolean( was.microphone ) );
        } catch ( e ) {
            // No permission any more: the host turns them on again.
            return;
        }
        await this.sendHere();
    }

    // Media

    private watch( delayMs : number ){
        if( this.watchTimer ) clearTimeout( this.watchTimer );
        this.watchTimer = setTimeout( () => {
            this.watchTimer = null;
            if( this.joined && ! this.room && this.state.stream?.state === 'live' ) void this.connectMedia( 'viewer' );
        }, delayMs );
    }

    // Joins the room, the join under way kept for whatever needs the room meanwhile (publisherRoom()).
    private connectMedia( as : 'viewer' | 'publisher', seat? : MediaSeat ) : Promise<Room | null> {
        const joining = this.joinRoom( as, seat );
        this.connectingMedia = joining;
        void joining.then( () => { if( this.connectingMedia === joining ) this.connectingMedia = null; } );
        return joining;
    }

    // The room this window sends in, as the host: the one it is in, the one it is joining, or joined now (a reload, a
    // dropped connection). Null when it can't be.
    private async publisherRoom() : Promise<Room | null> {
        const connected = this.lk?.ConnectionState.Connected;
        if( this.room && ( connected === undefined || this.room.state === connected ) ) return this.room;
        if( this.connectingMedia ){
            const room = await this.connectingMedia;
            if( room && room === this.room ) return room;
        }
        if( this.state.you?.role !== 'host' ) return this.room;
        return this.connectMedia( 'publisher' );
    }

    // Live, whatever this window has on goes out: the room joined again if need be, and every track not published yet
    // published. Answers whether it went.
    private async sendHere() : Promise<boolean> {
        if( ! this.live() || this.state.encoder || ! this.publishing() ) return false;

        const room = await this.publisherRoom();
        if( ! room || ! this.publishing() ) return false;

        await this.publishUnpublished( room );
        this.set( { sentHere: true } );
        this.rememberSending();
        return true;
    }

    private async joinRoom( as : 'viewer' | 'publisher', seat? : MediaSeat ) : Promise<Room | null> {
        if( ! this.joined ) return null;

        if( ! seat ){
            if( Date.now() - this.joinedAt > SEAT_FRESH_MS && ! await this.renewSeats() ) return null;
            seat = this.joined.media;
        }

        let lk : Media;
        try {
            lk = await this.media();
        } catch ( e ) {
            this.mediaFailed( as );
            return null;
        }

        // What changed while it was fetched: the page left, or the stream ended before a viewer got in.
        if( this.stopped || ( as === 'viewer' && this.state.stream?.state !== 'live' ) ) return null;

        this.disconnectMedia();

        // Adaptive stream asks for the layer the player's size needs: the media server sends the smallest at least
        // as tall as the player's height times this, less 10%. A Retina screen taken as 1 got a picture half as
        // sharp as it shows; taken as 2, a small player got 720p (a 440-pixel one, 248 tall). At most 1.5: a player
        // up to about 470 pixels wide gets 360p (a phone's), a larger one 720p, and 1080p from about 950 wide.
        // A shared screen at the screen's own density, up to 2 (capQuality): its text is what is read, and at 1.5 a
        // player beside a chat, 700 to 950 pixels wide, got 720p of a 1080p screen on a Retina screen, which shows
        // 1080p sharply there. At 2 it asks for 1080p from about 710 wide, and a connection that cannot carry it
        // still gets the 720p layer below.
        const density = Math.max( 1, Number( globalThis.devicePixelRatio ) || 1 );
        const pixelDensity = Math.min( 1.5, density );
        this.pixelDensity = pixelDensity;
        this.screenDensity = Math.min( 2, density );
        // Two connections, a publisher and a subscriber, as a call's (sdk-calls/group-call.ts): the mesh's mediasoup
        // engine doesn't serve one connection both ways (/rtc/v1), and its refused try, then the RTC client's check of
        // why, held every join about 0.4 s before the connection that works.
        const room = new ( this.options.Room ?? lk.Room )( { adaptiveStream: { pixelDensity }, dynacast: true, singlePeerConnection: false } );
        this.room = room;
        this.wireRoom( room, lk );
        this.playback.joining();
        // A viewer waiting for a place in a full stream keeps waiting while it tries.
        this.set( { media: this.state.media === 'waiting' && this.state.waitUntil === null ? 'waiting' : 'connecting', waitUntil: null } );

        const options : RoomConnectOptions = {
            autoSubscribe: true,
            meshJoinBudgetMs: MESH_JOIN_BUDGET_MS,
            onMeshWait: ( wait ) => {
                if( this.room === room ) this.set( { media: 'waiting', waitUntil: wait.until } );
            },
            ...( this.options.app ? { meshApp: this.options.app } : {} )
        };

        // A viewer still connecting a few seconds in while as many watch as the stream takes is waiting for a place: the
        // room refuses them until someone leaves, and @wordplus/rtc-client tries again meanwhile, within the join's budget.
        const fullCheck = as === 'viewer' ? setTimeout( () => {
            if( this.room === room && this.state.media === 'connecting' && this.full() ) this.set( { media: 'waiting', waitUntil: null } );
        }, FULL_AFTER_MS ) : null;
        this.seatUrl = seat.url;

        this.joining = room;
        try {
            await room.connect( seat.url, seat.token, options );
        } catch ( e ) {
            if( this.room === room ){
                this.room = null;
                this.mediaFailed( as, true );
            }
            return null;
        } finally {
            if( this.joining === room ) this.joining = null;
            if( fullCheck ) clearTimeout( fullCheck );
        }

        if( this.room !== room ){
            await room.disconnect();
            return null;
        }

        this.mediaRetries = 0;
        this.set( { media: 'live', waitUntil: null, audioBlocked: ! room.canPlaybackAudio, ...( this.state.error === 'media_unreachable' ? { error: null } : {} ) } );
        this.refreshTiles();
        this.followPictures( room );
        this.playback.begin( room, seat.url );
        return room;
    }

    // The video (@wordplus/rtc-client's part, or the room) could not be reached. A viewer tries again later; a
    // host or guest hears it from goLive() or acceptStage().
    // As many watching as the stream takes (`audience`, the beta's 50).
    private full() : boolean {
        return this.state.audience !== null && this.state.viewers >= this.state.audience;
    }

    // A viewer the room refused while the stream is full waits for a place, trying again every few seconds: the media
    // server doesn't say why it refuses one.
    private mediaFailed( as : 'viewer' | 'publisher', refused = false ){
        const full = refused && as === 'viewer' && this.full();
        if( ! full ) this.playback.note( 'error', as === 'viewer' ? 'media_unreachable' : 'publish_failed' );
        this.set( full
            ? { media: 'waiting', waitUntil: null, ...( this.state.error === 'media_unreachable' ? { error: null } : {} ) }
            : { media: 'off', waitUntil: null, error: as === 'viewer' ? 'media_unreachable' : 'publish_failed' } );
        if( as !== 'viewer' ) return;

        const delay = full ? FULL_RETRY_MS : Math.min( MEDIA_RETRY_MAX_MS, MEDIA_RETRY_MS * 2 ** this.mediaRetries++ );
        this.watch( delay + this.random() * LIVE_JITTER_MS );
    }

    private wireRoom( room : Room, { RoomEvent, DisconnectReason } : Media ){
        const refresh = () => { if( this.room === room ) this.refreshTiles(); };

        for( const event of [
            RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed,
            RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished,
            RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.ParticipantMetadataChanged,
            RoomEvent.ParticipantNameChanged
        ] ){
            room.on( event, refresh );
        }

        // Every picture that arrives is capped at the viewer's choice, and everything that arrives is held long enough
        // for what the host's connection lost to be sent again in time. A host's encoder picture keeps coming, and a
        // picture coming while the viewer's connection is too slow for pictures is off as well.
        room.on( RoomEvent.TrackSubscribed, ( track : Track, publication : TrackPublication, participant? : Participant ) => {
            if( this.room !== room ) return;
            this.capQuality( publication );
            this.holdArrivals( track );
            this.keepEncoderOn( publication, participant );
            if( this.state.tooSlow ) this.pictureOff( publication );
            this.findEncoder( publication, participant );
        } );
        // What goes out from here, for the statistics' list of what happened.
        room.on( RoomEvent.LocalTrackPublished, ( publication : TrackPublication ) => {
            if( this.room === room ) this.playback.note( 'published', String( publication?.source ?? '' ) );
        } );
        room.on( RoomEvent.LocalTrackUnpublished, ( publication : TrackPublication ) => {
            if( this.room === room ) this.playback.note( 'unpublished', String( publication?.source ?? '' ) );
        } );
        room.on( RoomEvent.ConnectionQualityChanged, ( quality : ConnectionQuality, participant? : Participant ) => {
            if( this.room === room && participant?.isLocal ) this.set( { connection: healthOf( quality ) } );
        } );

        room.on( RoomEvent.AudioPlaybackStatusChanged, () => {
            if( this.room === room ) this.set( { audioBlocked: ! room.canPlaybackAudio } );
        } );
        room.on( RoomEvent.Reconnecting, () => {
            if( this.room !== room ) return;
            this.playback.note( 'reconnecting' );
            this.set( { media: 'reconnecting' } );
            this.lookAgain( RECONNECT_GIVE_UP_MS );
        } );
        room.on( RoomEvent.Reconnected, () => {
            if( this.room !== room ) return;
            this.playback.note( 'reconnected' );
            this.set( { media: 'live' } );
            this.lookAgain( FLOW_CHECK_MS );
        } );
        room.on( RoomEvent.Disconnected, ( reason? : DisconnectReason ) => {
            if( this.room !== room || this.joining === room ) return;
            this.room = null;
            this.playback.end();
            this.playback.note( 'left', reason === undefined ? undefined : String( DisconnectReason[ reason ] ?? reason ) );
            // A screen still shared stays shared: it goes out again with the rest.
            this.set( { media: 'off', tiles: this.previewTiles(), screenSharing: this.screenTracks.length > 0, connection: 'unknown', elsewhere: false } );

            // Dropped while the stream is still live (not closed by its end): a viewer comes back, and a host sending
            // from here joins again and sends again.
            if( reason !== DisconnectReason.ROOM_DELETED && reason !== DisconnectReason.CLIENT_INITIATED
                && this.state.stream?.state === 'live' && this.state.you?.role === 'viewer' && ! this.state.onStage ){
                this.watch( 1000 + this.random() * LIVE_JITTER_MS );
            }
            if( reason !== DisconnectReason.ROOM_DELETED && reason !== DisconnectReason.CLIENT_INITIATED
                && this.state.stream?.state === 'live' && this.state.you?.role === 'host' && ( this.localTracks.length > 0 || this.screenTracks.length > 0 ) ){
                setTimeout( () => { if( ! this.stopped && ! this.room ) void this.sendHere(); }, 1000 );
            }
        } );
    }

    private disconnectMedia(){
        if( this.watchTimer ){
            clearTimeout( this.watchTimer );
            this.watchTimer = null;
        }
        if( this.stallTimer ){
            clearTimeout( this.stallTimer );
            this.stallTimer = null;
        }
        this.stopFollowing();
        this.playback.end();
        this.forgetSlow();
        const room = this.room;
        this.room = null;
        if( room && room.state !== this.lk?.ConnectionState.Disconnected ) void room.disconnect();
        this.set( { media: 'off', waitUntil: null, tiles: this.previewTiles(), connection: 'unknown', elsewhere: false, stalled: false, tooSlow: false } );
    }

    // A viewer's picture too much for their connection (the playback monitor's onTooSlow): every picture off for them,
    // so the sound has the connection, and tried again after a wait twice as long as the last one that failed. A host
    // and a guest on stage keep theirs.
    private pictureTooSlow(){
        const room = this.room;
        if( ! room || this.state.tooSlow || this.state.you?.role !== 'viewer' || this.state.onStage ) return;
        if( this.slowKept ) clearTimeout( this.slowKept );
        this.slowKept = null;
        const wait = Math.min( TOO_SLOW_RETRY_MAX_MS, TOO_SLOW_RETRY_MS * 2 ** this.slowTries++ );
        this.playback.note( 'picture-off', String( wait ) );
        this.set( { tooSlow: true } );
        for( const participant of room.remoteParticipants.values() ){
            for( const publication of participant.trackPublications.values() ) this.pictureOff( publication );
        }
        if( this.slowTimer ) clearTimeout( this.slowTimer );
        this.slowTimer = setTimeout( () => {
            this.slowTimer = null;
            this.retryPicture();
        }, wait );
    }

    // The picture tried again on a connection that could not carry it: at once (a viewer's Try again, back online), or
    // when its wait is over. One that is too much again within TOO_SLOW_KEPT_MS waits twice as long as before.
    retryPicture(){
        if( this.slowTimer ) clearTimeout( this.slowTimer );
        this.slowTimer = null;
        if( ! this.state.tooSlow ) return;
        this.playback.note( 'picture-retry' );
        this.set( { tooSlow: false } );
        for( const participant of this.room?.remoteParticipants.values() ?? [] ){
            for( const publication of participant.trackPublications.values() ) this.pictureOn( publication );
        }
        if( this.slowKept ) clearTimeout( this.slowKept );
        this.slowKept = setTimeout( () => {
            this.slowKept = null;
            this.slowTries = 0;
        }, TOO_SLOW_KEPT_MS );
    }

    private forgetSlow(){
        if( this.slowTimer ) clearTimeout( this.slowTimer );
        if( this.slowKept ) clearTimeout( this.slowKept );
        this.slowTimer = this.slowKept = null;
        this.slowTries = 0;
    }

    // A picture off for this viewer: the media server sends none of it, and its last frame stays on screen.
    private pictureOff( publication : TrackPublication ){
        const remote = publication as TrackPublication & { setEnabled? : ( enabled : boolean ) => void };
        if( publication.kind === this.lk?.Track.Kind.Video ) remote.setEnabled?.( false );
    }

    // A picture on again, following its element's sight once more as adaptive stream has it: the RTC client keeps a
    // publication enabled by hand on whether or not it is on screen, so where it can, what was asked by hand is let go.
    private pictureOn( publication : TrackPublication ){
        const remote = publication as TrackPublication & { setEnabled? : ( enabled : boolean ) => void, requestedDisabled? : boolean, emitTrackUpdate? : () => void };
        if( publication.kind !== this.lk?.Track.Kind.Video ) return;
        remote.setEnabled?.( true );
        if( remote.requestedDisabled === false && typeof remote.emitTrackUpdate === 'function' ){
            remote.requestedDisabled = undefined;
            remote.emitTrackUpdate();
        }
    }

    // A stopped picture, taken up again: after a minimized browser came back, the page showed reconnecting and the
    // video never played again until the viewer left and joined. A page back in sight looks whether its picture comes
    // (rejoinStalled).
    // And a hidden page's pictures at their smallest layer where they keep coming (HIDDEN_AFTER_MS), back as they were
    // once it is in sight.
    private followSight(){
        const doc = globalThis.document;
        if( ! doc || this.onSight ) return;
        this.onSight = () => {
            if( doc.visibilityState === 'hidden' ){
                this.hideLater();
                return;
            }
            this.unhide();
            if( this.room ) this.lookAgain( FLOW_CHECK_MS );
        };
        doc.addEventListener( 'visibilitychange', this.onSight );
        // A page opened hidden, in a tab behind, is hidden from the start, as the RTC client takes it.
        if( doc.visibilityState === 'hidden' ) this.hide();
    }

    private hideLater(){
        if( this.hidden || this.hiddenTimer ) return;
        this.hiddenTimer = setTimeout( () => {
            this.hiddenTimer = null;
            this.hide();
        }, HIDDEN_AFTER_MS );
    }

    private hide(){
        this.hidden = true;
        this.capAll();
    }

    // The page in sight again, or the client stopped: its pictures as they were.
    private unhide(){
        if( this.hiddenTimer ) clearTimeout( this.hiddenTimer );
        this.hiddenTimer = null;
        if( ! this.hidden ) return;
        this.hidden = false;
        this.capAll();
    }

    // The cloud's word on a hidden page's pictures, in the hello and once it changes: on a hidden page, those it keeps
    // come at their smallest layer again or are paused at once, the RTC client told (capQuality).
    private keepHidden( pictures : HiddenPictures | undefined ){
        const kept = pictures === 'low';
        if( kept === this.hiddenKept ) return;
        this.hiddenKept = kept;
        this.capAll();
    }

    // The browser offline, said at once (the RTC client takes seconds to notice), and once it is back online a viewer's
    // picture taken up again without waiting for the RTC client's next try: one still reconnecting, or with nothing
    // arriving, joins afresh (rejoinStalled), and one whose room went is watched again.
    private followNetwork(){
        if( this.onNetwork || typeof globalThis.addEventListener !== 'function' ) return;
        this.onNetwork = () => {
            const offline = globalThis.navigator?.onLine === false;
            if( offline === this.state.offline ) return;
            this.set( { offline } );
            this.playback.note( offline ? 'offline' : 'online' );
            if( offline ) return;
            // A connection back may carry the picture its last one could not.
            this.retryPicture();
            if( this.room ) this.lookAgain( FLOW_CHECK_MS );
            else if( this.state.you?.role === 'viewer' && ! this.state.onStage && this.video && ! this.away ) this.watch( 0 );
        };
        globalThis.addEventListener( 'online', this.onNetwork );
        globalThis.addEventListener( 'offline', this.onNetwork );
        if( globalThis.navigator?.onLine === false ) this.onNetwork();
    }

    private lookAgain( delayMs : number ){
        if( this.stallTimer ) clearTimeout( this.stallTimer );
        this.stallTimer = setTimeout( () => {
            this.stallTimer = null;
            void this.rejoinStalled();
        }, delayMs );
    }

    // A viewer of a live stream still reconnecting, or connected with nothing coming, joins the room afresh, as closing
    // the stream and opening it again does. A host's and a guest's rooms have their own way back (the Disconnected
    // handler, sendHere()).
    private async rejoinStalled(){
        const room = this.room;
        if( ! room || this.stopped || this.state.you?.role !== 'viewer' || this.state.onStage || this.state.stream?.state !== 'live' ) return;
        if( this.state.media !== 'reconnecting' ){
            if( this.state.media !== 'live' || await this.arriving( room ) ) return;
        }
        if( this.room !== room || this.stopped ) return;
        this.playback.note( 'rejoined', this.state.media );
        this.disconnectMedia();
        this.watch( 0 );
    }

    // Whether anything comes from the room: the bytes of what should be coming grow over FLOW_SAMPLE_MS. With nothing
    // that should, nothing is missing.
    private async arriving( room : Room ) : Promise<boolean> {
        const before = await this.bytesIn( room );
        if( before === null ) return true;
        await new Promise( ( resolve ) => setTimeout( resolve, FLOW_SAMPLE_MS ) );
        if( this.room !== room ) return true;
        const after = await this.bytesIn( room );
        return after === null || after > before;
    }

    // The bytes received on every track that should be coming: subscribed, not muted by its sender, and, for a
    // picture, not paused by the RTC client for being out of sight (adaptive stream). Null with none.
    private async bytesIn( room : Room ) : Promise<number | null> {
        let total : number | null = null;
        for( const participant of room.remoteParticipants.values() ){
            for( const publication of participant.trackPublications.values() ){
                const remote = publication as TrackPublication & { isSubscribed? : boolean, isEnabled? : boolean };
                const track = remote.track as ( Track & { getRTCStatsReport? : () => Promise<RTCStatsReport | undefined> } ) | undefined;
                if( ! track?.getRTCStatsReport || remote.isMuted || remote.isSubscribed === false || remote.isEnabled === false ) continue;

                const report = await track.getRTCStatsReport().catch( () => undefined );
                if( ! report ) continue;
                total ??= 0;
                report.forEach( ( stat : { type? : string, bytesReceived? : number } ) => {
                    if( stat.type === 'inbound-rtp' ) total = ( total ?? 0 ) + ( Number( stat.bytesReceived ) || 0 );
                } );
            }
        }
        return total;
    }

    // The picture, on one track: on `auto` the best the player's size allows (adaptive stream); on a viewer's choice the
    // sender's layer of that quality, whatever the player's size. Adaptive stream asks for the smaller of the player's
    // size and the cap, so for a choice the size it reckons is made larger than any layer (the track's own pixel
    // density, CHOSEN_DENSITY), and the cap is the layer chosen. Auto gives the room's density back, and a shared
    // screen the screen's own, up to 2. While the page is hidden, a picture that keeps coming (hiddenLow()) is capped at
    // its smallest layer, and the RTC client pauses the others (HIDDEN_AFTER_MS).
    private capQuality( publication : TrackPublication ){
        const lk = this.lk;
        const remote = publication as TrackPublication & { setVideoQuality? : ( q : VideoQuality ) => void };
        if( ! lk || publication.kind !== lk.Track.Kind.Video || typeof remote.setVideoQuality !== 'function' ) return;

        const choice = this.state.quality;
        const { VideoQuality } = lk;
        const layers = layersOf( publication );
        const low = this.hiddenLow( layers );
        // A choice above 720p takes the largest layer below it (chosenLayer): Full HD only on auto. Auto caps at the best
        // layer the sender sends: the RTC client sends the player's size only while it is under the cap's layer, and an
        // encoder's two layers over WHIP are low and medium, so a cap at high, a layer not sent, asked for the best
        // layer whatever the player's size.
        const layer = low && this.hidden ? layers[ layers.length - 1 ]!.quality
            : choice === 'auto' ? layers[ 0 ]?.quality ?? 'high' : chosenLayer( choice, layers );
        remote.setVideoQuality( layer === 'low' ? VideoQuality.LOW : layer === 'medium' ? VideoQuality.MEDIUM : VideoQuality.HIGH );

        const track = remote.track as ( Track & {
            adaptiveStreamSettings? : { pixelDensity? : number | 'screen', pauseVideoInBackground? : boolean },
            updateDimensions? : () => void,
            updateVisibility? : () => void
        } ) | undefined;
        const settings = track?.adaptiveStreamSettings;
        const density = choice !== 'auto' ? CHOSEN_DENSITY : publication.source === lk.Track.Source.ScreenShare ? this.screenDensity : this.pixelDensity;
        if( ! track || ! settings ) return;
        const resized = settings.pixelDensity !== density;
        // The RTC client pauses a hidden page's picture unless told not to, and looks again when told otherwise while
        // the page is hidden: the cloud saying to pause them pauses it then.
        const turned = ( settings.pauseVideoInBackground ?? true ) === low;
        if( ! resized && ! turned ) return;
        track.adaptiveStreamSettings = { ...settings, pixelDensity: density, pauseVideoInBackground: ! low };
        if( resized ) track.updateDimensions?.();
        if( turned ) track.updateVisibility?.();
    }

    // Whether a picture keeps coming at its smallest layer while the page is hidden (HIDDEN_AFTER_MS): while the cloud
    // says so, not on a phone or tablet, and only from a sender whose smallest layer is small and of a size it says.
    private hiddenLow( layers : PictureLayer[] ) : boolean {
        const smallest = layers[ layers.length - 1 ];
        return this.hiddenKept && ! this.handheld
            && !! smallest && smallest.height > 0 && Math.min( smallest.width, smallest.height ) <= HIDDEN_LOW_SIDE;
    }

    // A track's jitter buffer at VIEWER_JITTER_BUFFER_MS for a viewer, STAGE_JITTER_BUFFER_MS on stage; a browser
    // without the setting keeps its own.
    private holdArrivals( track : Track ){
        const receiver = ( track as Track & { receiver? : HeldReceiver } ).receiver;
        if( ! receiver || ! ( 'jitterBufferTarget' in receiver ) ) return;

        try {
            receiver.jitterBufferTarget = this.ownHold();
        } catch {}
    }

    // The encoder's picture, kept coming to a host whether or not the page shows it: the studio says what arrives from
    // OBS (its size, frame rate and bitrate, and a picture larger than the stream takes, which holds Go live back), and
    // adaptive stream pauses a picture out of sight. With the player scrolled away from the studio, the media server
    // stopped OBS's picture as it arrived, and the studio said OBS was connected with nothing of it. One picture, to
    // the host alone. Enabled by hand, the publication no longer follows its element's visibility.
    private keepEncoderOn( publication : TrackPublication, participant? : Participant ){
        const remote = publication as TrackPublication & { setEnabled? : ( enabled : boolean ) => void };
        if( participant?.identity !== INGEST_IDENTITY || this.state.you?.role !== 'host' || publication.kind !== this.lk?.Track.Kind.Video ) return;
        remote.setEnabled?.( true );
    }

    // A host's window that finds OBS sending into the room, and sends nothing of its own nor sent before a reload,
    // streams from OBS too: a studio reloaded while live from OBS, or opened on a stream gone live as OBS connected,
    // showed the camera's bar, whose camera would go out over OBS's picture, and none of what arrives from OBS. The
    // key is asked as Stream from OBS asks it (useEncoder()), the same key, for the address and key the studio shows.
    private findEncoder( publication : TrackPublication, participant? : Participant ){
        if( participant?.identity !== INGEST_IDENTITY || this.state.you?.role !== 'host' || publication.kind !== this.lk?.Track.Kind.Video ) return;
        if( this.state.encoder || this.findingEncoder || this.localTracks.length > 0 || this.screenTracks.length > 0 ) return;
        const was = this.sentBefore();
        if( was?.camera || was?.microphone ) return;

        this.findingEncoder = true;
        void this.ack( 'ingest' ).then( ( reply ) => {
            if( reply.ok && ! this.state.encoder && ! this.stopped ) this.set( { encoder: this.encoderOf( reply as unknown as IngestReply ) } );
        } ).finally( () => { this.findingEncoder = false; } );
    }

    // Where OBS sends, and with which key, from the cloud's answer to `ingest`.
    private encoderOf( { key, path } : IngestReply ) : { url : string, key : string } {
        return { url: this.options.cloud.replace( /\/$/, '' ) + path, key };
    }

    private ownHold() : number {
        return this.state.you?.role === 'viewer' && ! this.state.onStage ? VIEWER_JITTER_BUFFER_MS : STAGE_JITTER_BUFFER_MS;
    }

    // Sound follows picture in this room while it is the one joined (SYNC_TICK_MS).
    private followPictures( room : Room ){
        this.stopFollowing();
        this.syncTimer = setInterval( () => {
            if( this.room !== room ){
                this.stopFollowing();
                return;
            }
            if( this.syncing ) return;
            this.syncing = true;
            void this.soundFollowsPicture( room ).finally( () => { this.syncing = false; } );
        }, SYNC_TICK_MS );
    }

    private stopFollowing(){
        if( this.syncTimer ) clearInterval( this.syncTimer );
        this.syncTimer = null;
    }

    // Each person's sound held as long as the longest of their pictures, less SYNC_SLACK_MS, and never less than this
    // client's own hold: a person showing nothing, or a browser that can't tell, has their sound held as before.
    private async soundFollowsPicture( room : Room ){
        const lk = this.lk;
        if( ! lk ) return;

        const own = this.ownHold();
        for( const participant of room.remoteParticipants.values() ){
            let picture = 0;
            const sounds : HeldReceiver[] = [];
            for( const publication of participant.trackPublications.values() ){
                const receiver = ( publication.track as ( Track & { receiver? : HeldReceiver } ) | undefined )?.receiver;
                if( ! receiver || ! ( 'jitterBufferTarget' in receiver ) ) continue;
                if( publication.kind === lk.Track.Kind.Video ) picture = Math.max( picture, await this.pictureHold( receiver ) );
                else if( publication.kind === lk.Track.Kind.Audio ) sounds.push( receiver );
            }
            if( this.room !== room ) return;

            const hold = Math.min( SYNC_MAX_MS, Math.max( own, Math.round( picture - SYNC_SLACK_MS ) ) );
            for( const sound of sounds ){
                if( Math.abs( ( sound.jitterBufferTarget ?? 0 ) - hold ) < SYNC_STEP_MS ) continue;
                try {
                    sound.jitterBufferTarget = hold;
                } catch {}
            }
        }
    }

    // How long a picture's frames were held since it was last looked at, in ms, from its receiver's totals (the
    // target its jitter buffer kept, which counts the media server's playout delay, over the frames it let go). The
    // first look takes the average so far; a picture that let no frame go meanwhile (paused) keeps its last; 0 unknown.
    private async pictureHold( receiver : HeldReceiver ) : Promise<number> {
        const report = await receiver.getStats?.().catch( () => undefined );
        let target = 0, emitted = 0, found = false;
        report?.forEach( ( stat : { type? : string, jitterBufferTargetDelay? : number, jitterBufferEmittedCount? : number } ) => {
            if( stat.type !== 'inbound-rtp' ) return;
            found = true;
            target += Number( stat.jitterBufferTargetDelay ) || 0;
            emitted += Number( stat.jitterBufferEmittedCount ) || 0;
        } );

        const last = this.pictureHolds.get( receiver );
        if( ! found ) return last?.ms ?? 0;
        const frames = emitted - ( last?.emitted ?? 0 );
        const ms = frames > 0 ? ( target - ( last?.target ?? 0 ) ) / frames * 1000 : last?.ms ?? 0;
        this.pictureHolds.set( receiver, { target, emitted, ms } );
        return ms;
    }

    // Who is on stage: everyone publishing in the room (viewers are hidden), the local person
    // included when they publish.
    private refreshTiles(){
        const room = this.room;
        const lk = this.lk;
        if( ! room || ! lk ){
            this.set( { tiles: this.previewTiles() } );
            return;
        }

        const { Track } = lk;
        const speaking = new Set( room.activeSpeakers.map( ( p ) => p.identity ) );
        const tiles : Tile[] = [];
        const you = this.state.you;
        let elsewhere = false;

        const people : Participant[] = [ room.localParticipant, ...room.remoteParticipants.values() ];

        for( const p of people ){
            const camera = p.getTrackPublication( Track.Source.Camera );
            const screen = p.getTrackPublication( Track.Source.ScreenShare );
            const mic = p.getTrackPublication( Track.Source.Microphone );
            const screenAudio = p.getTrackPublication( Track.Source.ScreenShareAudio );
            const role = p.isLocal ? ( you?.role ?? 'viewer' ) : roleOf( p );

            if( role === 'viewer' && ! p.isLocal ) continue;
            // One's own camera and screen as they are open here, published or not yet: going live joins the room
            // before anything is published, and the picture stays on screen throughout, the same track before and
            // after, so pressing Go live never blinks the picture.
            const own = p.isLocal && this.publishing() ? this.previewTiles()[0] : undefined;
            // In the room but not on stage: whoever sends nothing (a host streaming from OBS, or one who hasn't
            // turned anything on yet), and oneself when not publishing.
            if( ( p.trackPublications.size === 0 && ! own ) || ( p.isLocal && ! this.publishing() ) ) continue;

            // A host's own other window, sending: shown here as everyone sees it.
            if( ! p.isLocal && role === 'host' && you?.role === 'host' && personOf( p.identity ) === you.identity ) elsewhere = true;
            // One's own voice and screen sound are never played here, from this window or another: heard back, they
            // echo, and a screen shared with the computer's sound sends them out again, so viewers hear them twice.
            const silent = p.isLocal || ( !! you && personOf( p.identity ) === you.identity );

            tiles.push( {
                identity: p.identity,
                name: p.name || p.identity,
                avatar: avatarOf( p ),
                role,
                local: p.isLocal,
                camera: camera?.track && ! camera.isMuted ? camera.track : ( own?.camera ?? null ),
                screen: screen?.track && ! screen.isMuted ? screen.track : ( own?.screen ?? null ),
                audio: silent ? [] : [ mic?.track, screenAudio?.track ].filter( ( t ) : t is Track => Boolean( t ) ),
                micMuted: own ? own.micMuted && ( ! mic || mic.isMuted ) : ! mic || mic.isMuted,
                speaking: speaking.has( p.identity ),
                encoder: ! p.isLocal && p.identity === INGEST_IDENTITY
            } );
        }

        // The host first, then guests in the order they came.
        tiles.sort( ( a, b ) => ( a.role === 'host' ? 0 : 1 ) - ( b.role === 'host' ? 0 : 1 ) );
        this.set( { tiles, elsewhere } );
    }

    private publishing() : boolean {
        const role = this.state.you?.role;
        return role === 'host' || this.state.onStage;
    }

    // Before going live, the host sees their own camera; with the camera and the microphone both turned off, nothing.
    private previewTiles() : Tile[] {
        const you = this.state.you;
        const lk = this.lk;
        if( ! you || ! lk || ( this.localTracks.length === 0 && this.screenTracks.length === 0 ) ) return [];

        const camera = this.localTracks.find( ( t ) => t.kind === lk.Track.Kind.Video && ! t.isMuted ) ?? null;
        const mic = this.localTracks.find( ( t ) => t.kind === lk.Track.Kind.Audio );
        // A screen shared before going live shows as it will: the main picture, the camera beside it.
        const screen = this.screenTracks.find( ( t ) => t.kind === lk.Track.Kind.Video ) ?? null;
        if( ! camera && ! screen && ( ! mic || mic.isMuted ) ) return [];

        return [ {
            identity: you.identity,
            name: you.name,
            avatar: this.avatar,
            role: you.role,
            local: true,
            camera,
            screen,
            audio: [],
            micMuted: ! mic || mic.isMuted,
            speaking: false,
            encoder: false
        } ];
    }

    private stopLocalTracks(){
        for( const track of this.localTracks ) track.stop();
        this.localTracks = [];
        this.set( { devices: { camera: false, microphone: false }, tiles: this.room ? this.state.tiles : [] } );
    }

    private async openDevices( camera : boolean, microphone : boolean ){
        this.stopLocalTracks();
        if( ! camera && ! microphone ) return;

        const lk = await this.media();
        this.localTracks = await this.makeTracks( lk )( {
            audio: microphone ? this.microphoneOptions() : false,
            video: camera ? this.cameraOptions( lk ) : false
        } );
        this.set( { devices: { camera, microphone } } );
        this.refreshTiles();
    }

    private makeTracks( lk : Media ) : typeof createLocalTracks {
        return this.options.createLocalTracks ?? lk.createLocalTracks;
    }

    // The camera's size: the quality sent.
    private resolution( lk : Media ){
        return ( this.state.sendQuality === '1080p' ? lk.VideoPresets.h1080 : lk.VideoPresets.h720 ).resolution;
    }

    // The chosen camera, or the one facing the way chosen; a device that is gone gives way to another.
    private cameraOptions( lk : Media ) : VideoCaptureOptions {
        return this.deviceIds.camera
            ? { resolution: this.resolution( lk ), deviceId: this.deviceIds.camera }
            : { resolution: this.resolution( lk ), facingMode: this.state.facing };
    }

    // Tuned for speech, or as it hears (originalSound): echo cancellation takes a held note for an echo, noise
    // suppression an instrument for noise, and gain control pumps a song's quiet and loud parts, so for music none of
    // them, in two channels where the microphone has them.
    private microphoneOptions() : AudioCaptureOptions {
        const device = this.deviceIds.microphone ? { deviceId: this.deviceIds.microphone } : {};
        return this.state.originalSound
            ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, voiceIsolation: false, channelCount: 2, ...device }
            : { echoCancellation: true, noiseSuppression: true, ...device };
    }

    // How the microphone goes out: in original sound, in stereo at 128 kbps, as a shared screen's sound goes
    // (screenPublishing()), and without DTX, which sends next to nothing in a quiet passage and clips what starts it.
    // Tuned for speech, the RTC client's own, mono at 48 kbps.
    private microphonePublishing() : TrackPublishOptions {
        return this.state.originalSound ? { audioPreset: { maxBitrate: 128_000 }, forceStereo: true, dtx: false } : {};
    }

    private localTrack( kind : 'audio' | 'video' ) : LocalTrack | undefined {
        const lk = this.lk;
        if( ! lk ) return undefined;
        return this.localTracks.find( ( t ) => t.kind === ( kind === 'audio' ? lk.Track.Kind.Audio : lk.Track.Kind.Video ) );
    }

    // Devices

    // The cameras, microphones and speakers this browser has.
    async listDevices() : Promise<Devices> {
        const none : Devices = { cameras: [], microphones: [], speakers: [] };
        if( typeof navigator === 'undefined' || ! navigator.mediaDevices?.enumerateDevices ) return none;

        let all : MediaDeviceInfo[];
        try {
            all = await navigator.mediaDevices.enumerateDevices();
        } catch ( e ) {
            return none;
        }

        const pick = ( kind : MediaDeviceKind ) => all
            .filter( ( d ) => d.kind === kind && d.deviceId !== '' )
            .map( ( d ) => ( { id: d.deviceId, label: d.label } ) );

        return { cameras: pick( 'videoinput' ), microphones: pick( 'audioinput' ), speakers: pick( 'audiooutput' ) };
    }

    // The camera or microphone to use: the one open now switches to it, and the next one opened is it.
    async useDevice( kind : 'camera' | 'microphone', deviceId : string ) : Promise<boolean> {
        this.deviceIds[ kind ] = deviceId;

        const track = this.localTrack( kind === 'camera' ? 'video' : 'audio' );
        if( ! track ) return true;

        try {
            const switched = await track.setDeviceId( deviceId );
            this.refreshTiles();
            return switched;
        } catch ( e ) {
            return false;
        }
    }

    // Original sound on or off (originalSound). A microphone open now is opened again so, muted if it was, and where it
    // was out it goes out again, as the stereo is fixed as a track is published: viewers miss a moment of it. Answers
    // whether it is on, which a microphone that cannot be opened so leaves as it was.
    async setOriginalSound( on : boolean ) : Promise<boolean> {
        if( on === this.state.originalSound ) return on;
        this.set( { originalSound: on } );

        const track = this.localTrack( 'audio' );
        const lk = this.lk;
        if( ! track || ! lk ) return on;

        let fresh : LocalTrack | undefined;
        try {
            [ fresh ] = await this.makeTracks( lk )( { audio: this.microphoneOptions(), video: false } );
        } catch ( e ) {
            fresh = undefined;
        }
        if( ! fresh ){
            this.set( { originalSound: ! on } );
            return ! on;
        }

        const room = this.room;
        const out = room?.localParticipant.getTrackPublication?.( track.source )?.track === track;
        if( track.isMuted ) await fresh.mute();
        this.localTracks = this.localTracks.map( ( t ) => t === track ? fresh! : t );
        if( out && room ) await room.localParticipant.unpublishTrack( track );
        track.stop();
        if( out && room && this.room === room ) await this.publishUnpublished( room );
        this.refreshTiles();
        return on;
    }

    // A phone's other camera: the back one, or the front again. The picture isn't mirrored from the back.
    async flipCamera() : Promise<void> {
        const facing = this.state.facing === 'user' ? 'environment' : 'user';
        this.deviceIds.camera = undefined;
        this.set( { facing } );

        const track = this.localTrack( 'video' ) as LocalVideoTrack | undefined;
        const lk = this.lk;
        if( ! track || ! lk ) return;

        try {
            await track.restartTrack( { resolution: this.resolution( lk ), facingMode: facing } );
        } catch ( e ) {
            // No camera that way: back to the one there was.
            this.set( { facing: this.state.facing === 'user' ? 'environment' : 'user' } );
        }
        this.refreshTiles();
    }

    // The sound or picture of one's own camera and microphone, for a level meter: null when it's off.
    localMedia( kind : 'audio' | 'video' ) : MediaStreamTrack | null {
        const track = this.localTrack( kind );
        return track && ! track.isMuted ? track.mediaStreamTrack : null;
    }

    // The picture going out: the screen while it is shared, otherwise the camera. Null before going live.
    async sendingStats() : Promise<MediaStats | null> {
        const room = this.room;
        const lk = this.lk;
        if( ! room || ! lk ) return null;

        const me = room.localParticipant;
        const publication = me.getTrackPublication( lk.Track.Source.ScreenShare ) ?? me.getTrackPublication( lk.Track.Source.Camera );
        const track = publication?.track as LocalVideoTrack | undefined;
        if( ! track || publication?.isMuted || typeof track.getSenderStats !== 'function' ) return null;

        // The layers the media server keeps on, smallest to largest: none while nobody has the picture on screen,
        // the smaller ones while no viewer's player needs the largest.
        const encodings = track.sender?.getParameters?.().encodings ?? [];
        const on = encodings.map( ( e ) => e.active !== false );
        if( on.length > 0 && ! on.includes( true ) ){
            return { width: 0, height: 0, fps: 0, kbps: 0, limited: null, paused: true };
        }
        const held = on.includes( true ) && on[ on.length - 1 ] === false;

        // The largest layer going out. One turned off can still report the size it last had, with no frames.
        const off = new Set( encodings.filter( ( e ) => e.active === false && e.rid ).map( ( e ) => e.rid ) );
        const layers = await track.getSenderStats();
        const top = layers.find( ( layer ) => ( layer.frameWidth ?? 0 ) > 0 && ! off.has( layer.rid ) );
        if( ! top ) return null;

        const reason = top.qualityLimitationReason;
        return {
            width: top.frameWidth ?? 0,
            height: top.frameHeight ?? 0,
            fps: Math.round( top.framesPerSecond ?? 0 ),
            kbps: Math.round( track.currentBitrate / 1000 ),
            limited: reason === 'bandwidth' || reason === 'cpu' ? reason : null,
            ...( held ? { held: true } : {} )
        };
    }

    private lastDecoded : { at : number, frames : number } | null = null;
    // OBS's key frames decoded here, for keyframeSeconds(): the track they came on, the count at the last look, and
    // the looks it had grown at, the last KEYFRAME_WINDOW_MS of them.
    private keyframes : { track : unknown, count : number, grew : Array<{ at : number, count : number }> } | null = null;

    // OBS's picture as it arrives here, while streaming from it.
    async encoderStats() : Promise<MediaStats | null> {
        const room = this.room;
        const lk = this.lk;
        if( ! room || ! lk ) return null;

        const track = room.remoteParticipants.get( INGEST_IDENTITY )?.getTrackPublication( lk.Track.Source.Camera )?.track as RemoteVideoTrack | undefined;
        if( ! track || typeof track.getReceiverStats !== 'function' ) return null;

        const stats = await track.getReceiverStats();
        if( ! stats ) return null;

        // Frames per second, from what was decoded since the last look.
        const frames = stats.framesDecoded ?? 0;
        const before = this.lastDecoded;
        this.lastDecoded = { at: stats.timestamp, frames };
        const fps = before && stats.timestamp > before.at ? Math.round( ( frames - before.frames ) * 1000 / ( stats.timestamp - before.at ) ) : 0;

        const keyframes = await this.keyframeSeconds( track );
        return {
            width: stats.frameWidth ?? 0, height: stats.frameHeight ?? 0, fps: Math.max( 0, fps ), kbps: Math.round( track.currentBitrate / 1000 ), limited: null,
            ...( keyframes !== null ? { keyframeSeconds: keyframes } : {} )
        };
    }

    // Seconds between OBS's key frames, from the browser's count of those decoded, at each look: the time between the
    // first and last looks it had grown at, over the key frames between, so a look every few seconds still tells a
    // second apart. Null until it has grown twice.
    private async keyframeSeconds( track : RemoteVideoTrack ) : Promise<number | null> {
        const now : { count : number | null, at : number } = { count: null, at: 0 };
        try {
            ( await track.receiver?.getStats() )?.forEach( ( s : { type? : string, keyFramesDecoded? : number, timestamp? : number } ) => {
                if( s.type !== 'inbound-rtp' || typeof s.keyFramesDecoded !== 'number' ) return;
                now.count = s.keyFramesDecoded;
                now.at = s.timestamp ?? 0;
            } );
        } catch ( e ) {
            return null;
        }
        const { count, at } = now;
        if( count === null ) return null;

        const seen = this.keyframes;
        if( seen?.track !== track ){
            this.keyframes = { track, count, grew: [] };
            return null;
        }
        if( count > seen.count ) seen.grew.push( { at, count } );
        seen.count = count;
        while( seen.grew.length > 2 && at - seen.grew[0]!.at > KEYFRAME_WINDOW_MS ) seen.grew.shift();

        const first = seen.grew[0];
        const last = seen.grew[ seen.grew.length - 1 ];
        if( ! first || ! last || last.count === first.count ) return null;
        return Math.round( ( last.at - first.at ) / ( last.count - first.count ) / 100 ) / 10;
    }

    // How a camera goes out (chosenCodecs()): three layers, so each viewer gets the one their player and connection
    // call for, each at 30 fps (the RTC client's own lower layers run at 20 fps and 160 to 450 kbps, which a viewer
    // sees as stutter and blur). Short of bandwidth or CPU, the picture loses resolution before it loses frames.
    // 360p at 600 kbit/s, a middle layer a viewer between can keep (540p at 1.2 Mbit/s, or 720p in a 1080p stream), and
    // the full size: through Canada a viewer whose estimate sat between 360p's 800 kbit/s and 720p's 2.5 Mbit/s flipped
    // between them. H.264 in hardware carries the same picture on fewer bits (VMAF 92 at 1.27 Mbit/s against VP8's 88
    // at 2.5), so its full size asks for less; VP8 keeps its bitrate (at 1.8 Mbit/s it scored 2.5 lower), and backs
    // any other codec. VP9 and AV1 go as one SVC stream of three sizes, each half the one above (L3T3_KEY), on about 70%
    // and 60% of VP8's bits (calls/room-publish.ts, cameraPublish()), the two lower layers then the VP8 behind's.
    private cameraPublishing( lk : Media, codecs : StreamCodecs ) : TrackPublishOptions {
        const full = this.state.sendQuality === '1080p';
        const tops : Record<CameraCodec, number> = {
            vp8: full ? 4_500_000 : 2_500_000,
            h264: full ? 3_500_000 : 1_800_000,
            // H.265's full size the picture H.264 gives at its own on about 70% of the bits (H265_TOP_1080)
            h265: full ? 2_500_000 : 1_300_000,
            vp9: full ? 3_150_000 : 1_750_000,
            av1: full ? 2_700_000 : 1_500_000
        };
        const codec = codecs.camera;
        const hardware = codec === 'h264' || codec === 'h265';
        return {
            simulcast: true,
            videoCodec: codec,
            degradationPreference: 'maintain-framerate',
            videoEncoding: { maxBitrate: tops[ codec ], maxFramerate: 30 },
            videoSimulcastLayers: [
                new lk.VideoPreset( 640, 360, 600_000, 30 ),
                full ? new lk.VideoPreset( 1280, 720, hardware ? 1_800_000 : 2_500_000, 30 ) : new lk.VideoPreset( 960, 540, 1_200_000, 30 )
            ],
            ...( codec === 'vp9' || codec === 'av1' ? { scalabilityMode: 'L3T3_KEY' as const } : {} ),
            ...( codecs.backup ? { backupCodec: { codec: codecs.backup, encoding: { maxBitrate: tops[ codecs.backup ], maxFramerate: 30 } } } : {} )
        };
    }

    // This browser's codecs for a camera and a screen, asked once the room is joined, as a group call's are
    // (calls/room-publish.ts): the first of the media server's policy this browser sends (the mesh's, rtc-client's
    // meshCodecPolicy), by default H.264 where this device encodes it in hardware and VP8 otherwise, H.265 and
    // Chromium's Baseline only on the mesh, VP8 behind any codec but VP8 for a viewer that decodes none of it.
    private codecChoice : Promise<StreamCodecs> | null = null;

    // The camera sent, watched for a hardware encoder dropping its frames (calls/encoder-watch.ts): once seen, this
    // browser remembers it, and its next camera goes out in software. The watch follows the track's sender (a full
    // reconnect publishes it on a new one) and ends with the next camera's, or some minutes after this one's.
    private cameraWatch : ( () => void ) | null = null;

    private watchCamera( publication : unknown ){
        this.cameraWatch?.();
        const track = ( publication as { track? : { sender? : RTCRtpSender } } | undefined )?.track;
        this.cameraWatch = track?.sender ? watchCameraEncoder( () => track.sender, { onDrops: () => { this.codecChoice = null; } } ) : null;
    }

    private chosenCodecs( room : Room ) : Promise<StreamCodecs> {
        this.codecChoice ??= this.pickCodecs( room ).catch( () => ( { camera: 'vp8', screen: 'vp8', backup: null } ) );
        return this.codecChoice;
    }

    private async pickCodecs( room : Room ) : Promise<StreamCodecs> {
        if( this.options.cameraCodec ){
            const codec = await this.options.cameraCodec();
            return { camera: codec, screen: codec, backup: backupFor( codec ) };
        }
        const agent = globalThis.navigator?.userAgent ?? '';
        const options = {
            h265: !! this.seatUrl && !! this.lk?.isMeshServer?.( this.seatUrl ),
            policy: ( room as unknown as { meshCodecPolicy? : CodecPolicy | null } ).meshCodecPolicy ?? null
        };
        const caps = await ( this.options.codecCaps ?? probeCodecCaps )().catch( () => null );
        const camera = roomCallChoice( caps, agent, options );
        return { camera: camera.codec, screen: screenCodecFor( agent, hardwareFromCaps( caps ), options ), backup: camera.backup };
    }

    // Every open track not out yet, a shared screen's too: a second call publishes nothing twice.
    private async publishUnpublished( room : Room ){
        const codecs = await this.chosenCodecs( room );
        const tracks = [
            ...this.localTracks.map( ( track ) => ( {
                track,
                options: track.kind === this.lk!.Track.Kind.Audio
                    ? { ...this.cameraPublishing( this.lk!, codecs ), ...this.microphonePublishing() }
                    : this.cameraPublishing( this.lk!, codecs )
            } ) ),
            ...this.screenTracks.map( ( track ) => ( { track, options: screenPublishing( this.lk!, track, this.state.sendQuality, codecs.screen ) } ) )
        ];
        for( const { track, options } of tracks ){
            const published = room.localParticipant.getTrackPublication?.( track.source );
            if( published && published.track === track ) continue;
            const publication = await room.localParticipant.publishTrack( track, options );
            if( track.source === this.lk!.Track.Source.Camera ) this.watchCamera( publication );
        }
        this.refreshTiles();
    }

    // Host

    // The camera and microphone, shown only here until the host goes live.
    async startPreview( devices : { camera? : boolean, microphone? : boolean } = {} ){
        await this.openDevices( devices.camera ?? true, devices.microphone ?? true );
    }

    // The quality to send, chosen before going live, within the best the site's plan allows: a camera open in the
    // preview takes its size. Live, the stream keeps the quality it went live with. Answers the quality sent.
    async setSendQuality( quality : Quality ) : Promise<Quality> {
        if( this.live() ) return this.state.sendQuality;

        this.wantedQuality = quality;
        const { sendQuality } = this.sendQualities( quality );
        if( sendQuality === this.state.sendQuality ) return sendQuality;
        this.set( { sendQuality } );

        const track = this.localTrack( 'video' ) as LocalVideoTrack | undefined;
        const lk = this.lk;
        if( track && lk ){
            try {
                await track.restartTrack( this.cameraOptions( lk ) );
            } catch ( e ) {
                // The camera keeps the size it had until it is opened again.
            }
            this.refreshTiles();
        }
        return sendQuality;
    }

    // Publishes, then tells everyone the stream is live. Streaming from OBS, the encoder publishes, so its
    // picture must have come first.
    async goLive() : Promise<Ack> {
        if( this.state.status === 'unconnected' ) return { ok: false, error: this.state.error ?? 'not_configured' };
        if( this.state.you?.role !== 'host' ) return { ok: false, error: 'not_host' };

        if( this.state.encoder ){
            if( ! this.state.tiles.some( ( t ) => t.encoder ) ) return { ok: false, error: 'no_encoder' };
        } else {
            // Nothing on: the camera and microphone. A screen shared alone goes as it is.
            if( this.localTracks.length === 0 && this.screenTracks.length === 0 ) await this.startPreview();

            const room = await this.publisherRoom();
            if( ! room ) return { ok: false, error: this.state.error ?? 'publish_failed' };

            await this.publishUnpublished( room );
        }

        const wasLive = this.live();
        const reply = await this.ack( 'live' );
        if( reply.ok ){
            this.set( { stream: reply.stream, ...( this.state.encoder ? {} : { sentHere: true } ) } );
            if( ! this.state.encoder ) this.rememberSending();
            if( ! wasLive ) this.startTally();
        }
        return reply;
    }

    // Streaming from OBS over WHIP: the stream's key and the address the encoder sends to, and the host in the
    // room to see what it sends. `renew` makes a new key, which cuts off an encoder using the old one.
    async useEncoder( renew : boolean = false ) : Promise<Ack> {
        if( this.state.status === 'unconnected' ) return { ok: false, error: this.state.error ?? 'not_configured' };
        if( this.state.you?.role !== 'host' ) return { ok: false, error: 'not_host' };

        const reply = await this.ack( 'ingest', renew ? { renew: true } : {} );
        if( ! reply.ok ) return reply;

        this.set( { encoder: this.encoderOf( reply as unknown as IngestReply ) } );

        // Before going live, the encoder's picture takes the camera's place.
        if( this.state.stream?.state !== 'live' ) this.stopLocalTracks();

        if( ! this.room && ! await this.connectMedia( 'publisher' ) ) return { ok: false, error: this.state.error ?? 'publish_failed' };
        this.refreshTiles();
        return { ok: true };
    }

    // Back to the camera, before going live.
    leaveEncoder(){
        this.set( { encoder: null } );
        if( this.state.stream?.state !== 'live' ) this.disconnectMedia();
    }

    async end() : Promise<Ack> {
        const reply = await this.ack( 'end' );
        if( reply.ok ){
            this.forgetSending();
            this.set( { stream: reply.stream, sentHere: false } );
            this.disconnectMedia();
            this.stopLocalTracks();
        }
        return reply;
    }

    async setCamera( on : boolean ){
        await this.setDevice( 'camera', on );
    }

    async setMicrophone( on : boolean ){
        await this.setDevice( 'microphone', on );
    }

    private async setDevice( device : 'camera' | 'microphone', on : boolean ){
        const lk = await this.media();
        const kind : Track.Kind = device === 'camera' ? lk.Track.Kind.Video : lk.Track.Kind.Audio;
        const track = this.localTracks.find( ( t ) => t.kind === kind );

        if( track ){
            if( on ) await track.unmute(); else await track.mute();
        } else if( on ){
            // Not opened yet: open it beside what is open, and publish it when live.
            const [ added ] = await this.makeTracks( lk )( device === 'camera'
                ? { video: this.cameraOptions( lk ), audio: false }
                : { audio: this.microphoneOptions(), video: false } );
            if( ! added ) return;
            this.localTracks.push( added );
        }

        const devices = { ...this.state.devices, [ device ]: on };
        this.set( { devices } );

        // Live, it goes out at once, from wherever this window is: in the room, or joined again after a reload.
        if( this.live() && this.publishing() && ! this.state.encoder ){
            if( on ) await this.sendHere(); else if( this.state.sentHere ) this.rememberSending();
        }
        this.refreshTiles();
    }

    // A screen shared: held here like the camera, so a host can share it before going live too, in the preview, and it
    // goes out with the rest on going live; live, or on stage, at once. Its picture
    // is marked as detail (contentHint), so the encoder keeps text sharp before it keeps motion. The browser's own
    // "Stop sharing" ends it as the button does. Answers whether a screen is shared now.
    async setScreenShare( on : boolean ) : Promise<boolean> {
        if( ! on ){
            await this.stopScreen();
            return false;
        }
        if( this.screenTracks.length > 0 ) return true;
        if( ! this.state.canShareScreen || ! this.publishing() || this.state.encoder ) return false;

        const lk = await this.media();
        let tracks : LocalTrack[];
        try {
            tracks = await ( this.options.createLocalScreenTracks ?? lk.createLocalScreenTracks )( screenCapture( this.state.sendQuality ) );
        } catch ( e ) {
            // The browser's picker was closed.
            return false;
        }

        const picture = tracks.find( ( t ) => t.kind === lk.Track.Kind.Video );
        try {
            if( picture ) picture.mediaStreamTrack.contentHint = SCREEN_CONTENT_HINT;
        } catch ( e ) {}
        picture?.mediaStreamTrack.addEventListener?.( 'ended', () => {
            if( this.screenTracks.includes( picture ) ) void this.stopScreen();
        } );
        this.screenTracks = tracks;
        this.set( { screenSharing: true } );

        // Live: out at once, from wherever this window is (in the room, or joined again after a reload).
        if( this.live() || this.state.onStage ){
            const room = this.live() && this.state.you?.role === 'host' ? await this.publisherRoom() : this.room;
            if( room ){
                await this.publishUnpublished( room );
                if( this.live() ) this.set( { sentHere: true } );
            }
        }
        this.refreshTiles();
        return true;
    }

    // The shared screen's capture ended, with the room gone or going (the stream over, the stage left, the page).
    private stopScreenTracks(){
        for( const track of this.screenTracks ) track.stop();
        this.screenTracks = [];
    }

    // The shared screen gone: out of the room if it was in it, and its capture ended.
    private async stopScreen(){
        const tracks = this.screenTracks;
        if( tracks.length === 0 ) return;
        this.screenTracks = [];
        const room = this.room;
        for( const track of tracks ){
            try {
                if( room ) await room.localParticipant.unpublishTrack( track );
            } catch ( e ) {}
            track.stop();
        }
        this.set( { screenSharing: false } );
        this.refreshTiles();
    }

    invite( identity : string ){ return this.ack( 'invite', { identity } ); }
    unstage( identity : string ){ return this.ack( 'unstage', { identity } ); }

    // Viewer and stage

    async raiseHand( up : boolean ) : Promise<Ack> {
        const reply = await this.ack( 'hand', { up } );
        if( reply.ok ) this.set( { handRaised: up } );
        return reply;
    }

    // Accepts the host's invitation: the camera and microphone go live in the room, as a guest.
    async acceptStage() : Promise<Ack> {
        const reply = await this.ack( 'stage' );
        if( ! reply.ok ){
            this.set( { invited: false } );
            return reply;
        }

        this.set( { invited: false, onStage: true } );

        try {
            await this.openDevices( true, true );
        } catch ( e ) {
            // No camera or no permission: back to watching.
            await this.leaveStage();
            return { ok: false, error: 'devices' };
        }

        const room = await this.connectMedia( 'publisher', reply.media as MediaSeat );
        if( ! room ){
            await this.leaveStage();
            return { ok: false, error: 'publish_failed' };
        }

        await this.publishUnpublished( room );
        return { ok: true };
    }

    declineStage(){
        this.set( { invited: false } );
    }

    // Off stage by choice: the cloud takes this guest off everyone's stage first, as the host's taking off does, and
    // then this page comes back as a viewer. Leaving the room alone, the guest's session stayed a publisher there until
    // the media server let it go, and the viewer's join, the same person's, waited minutes for it. A cloud before this
    // refuses (`not_host`), and the page leaves the room alone, as it did.
    async leaveStage(){
        const identity = this.state.you?.identity;
        if( this.state.onStage && identity ) await this.ack( 'unstage', { identity } );
        this.backToWatching();
    }

    // Off stage, back to watching: once, whichever comes first, the cloud's word (`unstaged`) or this page's own.
    private backToWatching(){
        if( ! this.state.onStage ) return;
        this.set( { onStage: false, screenSharing: false } );
        this.disconnectMedia();
        this.stopLocalTracks();
        this.stopScreenTracks();
        if( this.state.stream?.state === 'live' ) this.watch( 0 );
    }

    // Everyone

    // A message refused for a timeout says until when, which the chat then holds to.
    async sendChat( text : string ) : Promise<Ack> {
        const reply = await this.ack( 'chat', { text } );
        if( ! reply.ok && reply.error === 'timeout' && typeof ( reply as { until? : unknown } ).until === 'number' ){
            this.set( { timeoutUntil: ( reply as unknown as { until : number } ).until } );
        }
        return reply;
    }

    deleteMessage( id : string ){ return this.ack( 'delete', { id } ); }
    // `who`: their name and avatar as a message of theirs has them, kept for the list of the banned when they are gone.
    ban( identity : string, who? : { name : string, avatar : string | null } ){ return this.ack( 'ban', who ? { identity, ...who } : { identity } ); }
    setSlow( seconds : number ){ return this.ack( 'slow', { seconds } ); }

    // Moderators: a message pinned over the chat, someone kept from writing for a while and let back, someone put out
    // of the stream for now, the banned and letting one back, and the whole chat cleared.
    pin( id : string ){ return this.ack( 'pin', { id } ); }
    unpin(){ return this.ack( 'unpin' ); }
    timeOut( identity : string, seconds : number ){ return this.ack( 'timeout', { identity, seconds } ); }
    liftTimeout( identity : string ){ return this.ack( 'untimeout', { identity } ); }
    kick( identity : string ){ return this.ack( 'kick', { identity } ); }
    bans(){ return this.ack( 'bans' ) as Promise<Ack & { bans? : Banned[] }>; }
    unban( identity : string ){ return this.ack( 'unban', { identity } ); }
    clearChat(){ return this.ack( 'clear' ); }

    // Who is here: the signed-in people by name, and how many watch; for moderators, or everyone where the stream says.
    people(){ return this.ack( 'people' ) as Promise<Ack & { people? : Person[], watching? : number }>; }

    // The host: what everyone sees on stage, where the camera of the one sharing a screen sits over it, and a guest's
    // microphone off.
    setLayout( mode : Layout['mode'], identity? : string ){ return this.ack( 'layout', layoutAsked( mode, identity, this.state.layout.corner ) ); }

    // The host drags the sharer's camera over the screen: here at once, then for everyone through the cloud, which
    // keeps it with the layout. Its left and top as shares of the room the stage leaves it, 0 to 1; null puts it back in
    // the bottom corner.
    async setCorner( corner : Corner | null ) : Promise<Ack> {
        const share = ( n : number ) => Math.round( Math.min( 1, Math.max( 0, Number( n ) || 0 ) ) * 1000 ) / 1000;
        const at = corner ? { x: share( corner.x ), y: share( corner.y ) } : null;
        const before = this.state.layout;
        this.set( { layout: { mode: before.mode, identity: before.identity, ...( at ? { corner: at } : {} ) } } );
        const ack = await this.ack( 'layout', layoutAsked( before.mode, before.identity, at ) );
        if( ! ack.ok && this.state.layout.corner === ( at ?? undefined ) ) this.set( { layout: before } );
        return ack;
    }
    muteGuest( identity : string ){ return this.ack( 'mute', { identity } ); }

    // Nothing while the stream takes no reactions.
    react( kind : Reaction ){
        if( this.state.reactionsOn ) this.send( 'react', { kind } );
    }

    // The viewer's choice of picture (VideoChoice), on what arrives now and later.
    setQuality( quality : VideoChoice ){
        if( quality !== this.state.quality ) this.playback.note( 'quality', quality );
        this.set( { quality } );
        this.capAll();
    }

    private capAll(){
        for( const participant of this.room?.remoteParticipants.values() ?? [] ){
            for( const publication of participant.trackPublications.values() ) this.capQuality( publication );
        }
    }

    // A browser that blocked sound until the page was clicked.
    async startAudio(){
        await this.room?.startAudio();
        if( this.room ) this.set( { audioBlocked: ! this.room.canPlaybackAudio } );
    }

    private live() : boolean {
        return this.state.stream?.state === 'live';
    }

    // What this page counts of a stream from when it went live: the most watching at once, the messages and
    // the reactions, for the host's summary at its end.
    private startTally(){
        this.set( { tally: { peak: this.state.viewers, messages: 0, reactions: 0 } } );
    }

    private count( patch : Partial<Tally> ){
        this.set( { tally: { ...this.state.tally, ...patch } } );
    }

    // Each reaction is its emoji, the name a cloud of before passes on taken as its emoji.
    private addReactions( counts : Partial<Record<Reaction, number>> ){
        const now = Date.now();
        const added : FloatingReaction[] = [];

        for( const [ sent, n ] of Object.entries( counts ) as [ Reaction, number ][] ){
            const kind = Object.prototype.hasOwnProperty.call( REACTION_EMOJI, sent ) ? REACTION_EMOJI[ sent ]! : sent;
            for( let i = 0; i < Math.min( Number( n ) || 0, 8 ); i++ ) added.push( { id: ++this.reactionSeq, kind, at: now + i * 120 } );
        }

        this.set( { reactions: [ ...this.state.reactions, ...added ].slice( -REACTIONS_SHOWN ) } );

        if( ! this.reactionTimer ){
            this.reactionTimer = setInterval( () => {
                const cut = Date.now() - REACTION_LIFE_MS;
                const kept = this.state.reactions.filter( ( r ) => r.at > cut );
                if( kept.length !== this.state.reactions.length ) this.set( { reactions: kept } );
                if( kept.length === 0 && this.reactionTimer ){
                    clearInterval( this.reactionTimer );
                    this.reactionTimer = null;
                }
            }, 500 );
        }
    }
}
