/**
 * The shell this build runs in — and the only file that differs between them.
 *
 * Everything above it imports `platform` from here and never learns which
 * client it got. The desktop shell replaces this one file with its own,
 * supplying its own storage, its own player handoff, and the two capabilities
 * a browser has to go without; nothing else in the UI changes, and nothing
 * else in the UI is allowed to care.
 *
 * If a second file ever has to differ per shell, the capability that forced it
 * is missing from `types.ts` and belongs there instead.
 */

import type { Platform } from "./types.ts";
import { webPlatform } from "./web.ts";

export const platform: Platform = webPlatform;

export type * from "./types.ts";
