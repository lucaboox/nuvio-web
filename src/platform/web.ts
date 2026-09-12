/**
 * What a browser can do, assembled from the pieces that already did it.
 *
 * Nothing new is implemented here. The web client's existing modules are the
 * implementation; this file only states which of them answer which capability,
 * so the UI can stop importing them by name and ask for the ability instead.
 *
 * `downloads` and `debrid` are absent, which is the whole point of them being
 * optional. See `types.ts` for why neither is a matter of trying harder.
 *
 * `fileSave` is the one that goes the other way: the browser has a download
 * manager of its own, and this is the capability that says so.
 */

import {
  copyStreamUrl,
  externalPlayerLabel,
  externalPlayerOptions,
  isExternalPlayerAvailable,
  launchExternalPlayer,
} from "../lib/externalPlayer.ts";
import { authVault } from "../lib/authVault.ts";
import { saveToDevice } from "../lib/fileDownload.ts";
import { deleteValue, getValue, setValue } from "../lib/idb.ts";
import { webRequest } from "../lib/webRequest.ts";
import type { Platform } from "./types.ts";

export const webPlatform: Platform = {
  auth: authVault,
  fileSave: { save: saveToDevice },
  externalPlayer: {
    options: externalPlayerOptions,
    label: externalPlayerLabel,
    isAvailable: isExternalPlayerAvailable,
    launch: launchExternalPlayer,
    copyUrl: copyStreamUrl,
  },
  request: webRequest,
  // IndexedDB rather than localStorage: it stores structured values without a
  // JSON round trip, and it is reachable from a Worker, which is where the
  // session is kept.
  storage: {
    get: getValue,
    set: setValue,
    remove: deleteValue,
  },
};
