// @wordplus/realtime-ui/streams: the live streams' player, studio, chat and stage (src/components/streams/),
// on the engine of @wordplus/realtime-client/streams. Their stylesheet is streams.css.
export * from "./components/streams/index.ts";
export { addStreamLanguages } from "./inc/stream-languages.ts";
// The SDK's stream (`calls.stream()`) in them.
export { StreamView, streamEngine } from "./sdk/stream-view.tsx";
export type { StreamViewProps } from "./sdk/stream-view.tsx";
export type { SdkStream } from "./sdk/types.ts";
