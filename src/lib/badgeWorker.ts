import { streamBadgesFor } from "./webSettings";
import type { StreamBadgeSettings } from "./webSettings";
import type { Stream } from "../types";

// Imported regular expressions must never run on the interface thread.
self.onmessage = (event: MessageEvent<{ id: number; stream: Stream; settings: StreamBadgeSettings }>) => {
  const { id, stream, settings } = event.data;
  self.postMessage({ id, badges: streamBadgesFor(stream, settings) });
};
