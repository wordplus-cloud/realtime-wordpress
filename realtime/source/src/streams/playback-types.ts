// What playbackStats() and sendingDetail() answer (playback.ts and sending.ts measure them): plain data, with nothing
// of the RTC client's in it, so a public type can carry it without importing @wordplus/rtc-client.

export type LayerQuality = 'high' | 'medium' | 'low';

// A layer of a picture as its sender sends it (simulcast): 0 for a size the sender doesn't say (an encoder over WHIP).
export interface PictureLayer {
    quality : LayerQuality;
    width : number;
    height : number;
}

export interface VideoIn {
    codec : string | null;
    width : number;
    height : number;
    fps : number;
    kbps : number;
    // The sender's layer arriving, by its height; null where the sender's layers say no sizes.
    layer : LayerQuality | null;
    layers : PictureLayer[];
    lossPct : number;
    jitterMs : number;
    // How long frames wait to play, on average over the last second (the jitter buffer, with the media server's
    // playout delay).
    bufferMs : number;
    dropped : number;
    freezes : number;
    frozenMs : number;
    nacks : number;
    plis : number;
    decoder : string | null;
    hardware : boolean | null;
}

export interface AudioIn {
    codec : string | null;
    kbps : number;
    lossPct : number;
    jitterMs : number;
    bufferMs : number;
    // The share of the sound the browser made up for what didn't come, over the last second.
    concealedPct : number;
}

export interface TransportIn {
    // `udp` or `tcp`, and whether through a relay (TURN), over which protocol.
    protocol : string | null;
    relayed : boolean | null;
    relayProtocol : string | null;
    rttMs : number | null;
}

export interface MediaServer {
    // The address joined (the seat's), and the node and region that answered, where it says.
    url : string | null;
    node : string | null;
    region : string | null;
    version : string | null;
}

// What a sender's picture or sound is held back by: the browser's quality limitation, or none.
export type SendLimit = 'bandwidth' | 'cpu' | 'other' | null;

// One layer of a picture as it goes out (simulcast): its size and rate, what the encoder makes it with, and what the
// media server says of it (loss and round trip, from its receiver reports).
export interface LayerOut {
    rid : string | null;
    // Off while no viewer's player needs it: the media server turned it off (dynacast).
    active : boolean;
    width : number;
    height : number;
    fps : number;
    kbps : number;
    // What the browser's bandwidth estimate aims this layer at.
    targetKbps : number | null;
    // Sent again for what was lost.
    resentKbps : number;
    limited : SendLimit;
    encoder : string | null;
    hardware : boolean | null;
    lossPct : number;
    rttMs : number | null;
    nacks : number;
    plis : number;
    firs : number;
}

export interface VideoOut {
    source : 'camera' | 'screen';
    codec : string | null;
    // The picture the camera or screen gives the encoder.
    capture : { width : number, height : number, fps : number } | null;
    // The largest first.
    layers : LayerOut[];
    kbps : number;
    // How long the encoder was held back by each reason since the picture began going out.
    limitedMs : { bandwidth : number, cpu : number, other : number };
}

export interface AudioOut {
    codec : string | null;
    kbps : number;
    lossPct : number;
    jitterMs : number;
    rttMs : number | null;
    // The microphone's level, 0 to 1.
    level : number | null;
    muted : boolean;
}

export interface TransportOut extends TransportIn {
    // What the browser estimates it can send.
    availableKbps : number | null;
}

// What a host sends (sending.ts measures it): every picture and the sound, and the way out.
export interface SendingStats {
    at : number;
    video : VideoOut[];
    audio : AudioOut | null;
    transport : TransportOut | null;
}

export type PlaybackEventKind = 'joining' | 'joined' | 'first-frame' | 'stalled' | 'resumed' | 'reconnecting' | 'reconnected'
    | 'rejoined' | 'offline' | 'online' | 'quality' | 'error' | 'left' | 'published' | 'unpublished'
    // The picture too much for the connection (its share lost, or `paused` by the media server), then turned off here
    // and tried again (EasyStreamState's tooSlow).
    | 'too-slow' | 'picture-off' | 'picture-retry';

export interface PlaybackEvent {
    at : number;
    kind : PlaybackEventKind;
    detail? : string;
}

export interface PlaybackSession {
    // From the first join to the first frame; null until one came.
    startupMs : number | null;
    watchedMs : number;
    stalls : number;
    stalledMs : number;
    reconnects : number;
    rejoins : number;
    errors : number;
}

export interface PlaybackStats {
    at : number;
    server : MediaServer | null;
    video : VideoIn | null;
    audio : AudioIn | null;
    transport : TransportIn | null;
    session : PlaybackSession;
    events : PlaybackEvent[];
}
