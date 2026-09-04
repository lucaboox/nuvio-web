import { ProfileGate } from "./components/ProfileGate";
import { effectiveAddonProfileIndex } from "./lib/account";
import { PinPrompt } from "./components/PinPrompt";
import {
  ArrowDown,
  ArrowLeft,
  Download,
  Dices,
  ArrowUp,
  CalendarDays,
  ChevronRight,
  Eye,
  EyeOff,
  HardDrive,
  Info,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
  Compass,
  Home,
  Library,
  LayoutGrid,
  Link2,
  Lock,
  LogOut,
  Palette,
  Play,
  Puzzle,
  Search,
  Settings,
  Trash2,
  TriangleAlert,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AuthScreen } from "./components/AuthScreen";
import { ContinueWatching } from "./components/ContinueWatching";
import { ContextMenu } from "./components/ContextMenu";
import { CalendarView } from "./components/Calendar";
import { Details } from "./components/Details";
import { Discover } from "./components/Discover";
import { Downloads } from "./components/Downloads";
import { DownloadSettings } from "./components/DownloadSettings";
import { ExternalWatchPrompt } from "./components/ExternalWatchPrompt";
import {
  CollectionFolderView,
  CollectionRow,
} from "./components/Collections";
import { Hero, MediaRow, PosterCard } from "./components/Media";
import { Player } from "./components/Player";
import { LoadingScreen } from "./components/LoadingScreen";
import { PersonPage } from "./components/Person";
import { ProfileSwitcher } from "./components/ProfileSwitcher";
import {
  loadAddons,
  loadAvatarCatalog,
  loadLibrary,
  createProfile,
  loadProfiles,
  addToLibrary,
  loadCollections,
  loadHomeLayout,
  pushHomeLayout,
  loadProgress,
  COLLECTION_KEY_PREFIX,
  type HomeLayout,
  loadSettingsBlob,
  loadProviderCredentials,
  clearProgress,
  loadWatchedItems,
  pushSettingsBlob,
  pushProgress,
  isComplete,
  restoreSession,
  removeFromLibrary,
  saveAddons,
  settingsPlatform,
  setWatched,
  signOut,
  type SettingsBlob,
  type ProviderCredentialRow,
  type SyncPreferenceType,
  withBlobRawValue,
  withBlobStringPayload,
  withBlobTypedValue,
  updateProviderCredential,
} from "./lib/account";
import {
  addonConfigureUrl,
  loadCatalog,
  loadHome,
  loadInstalledAddons,
  loadStreams,
  normalizeManifestUrl,
  resolveMeta,
  searchAddons,
  supports,
  type AddonSearchGroup,
} from "./lib/addons";
import {
  applyUpdate,
  checkForUpdate,
  subscribeUpdate,
  updateReady,
} from "./lib/appUpdate";
import {
  clearRecentSearches,
  forgetSearch,
  readRecentSearches,
  rememberSearch,
} from "./lib/recentSearches";
// The handoff itself is a capability; what is imported by name here is the
// browser-only remainder — device sniffing for a card that only the web build
// shows, and the way back into an installed iOS web app, which a shell that
// never left does not need.
import {
  canReturnToApp,
  isAndroid,
  isAppleMobile,
  isInstalledAppleWebApp,
  isMacOS,
  RETURN_SHORTCUT_NAME,
  RETURN_SHORTCUT_URL,
} from "./lib/externalPlayer";
import { platform } from "./platform/index.ts";
import {
  clearRelayToken,
  collectRelayReport,
  newRelayToken,
  pendingRelayToken,
  relayReturnUrl,
} from "./lib/returnRelay";
import {
  clearExternalHandoff,
  readExternalHandoff,
  rememberExternalHandoff,
  takeExternalReport,
  type ExternalPlayerReport,
} from "./lib/externalHandoff";
import {
  registerCurrentDevice,
  resetDeviceRegistration,
} from "./lib/deviceSession";
import { bingeGroupFor, rememberBingeGroup } from "./lib/bingeCache";
import { pickBingeStream } from "./lib/nextEpisode";
import { syncProgress, syncWatched } from "./lib/watchSync";
import {
  buildContinueWatching,
  buildWatchIndex,
  continueWatchingCandidates,
  watchKey,
  type WatchIndex,
  type ContinueCard,
} from "./lib/progress";
import { useProgressiveList } from "./lib/useProgressiveList";
import { useSwipeBack } from "./lib/useSwipeBack";
import { providerCredential } from "./lib/providerCredentials";
import type { MetadataEnrichmentConfig } from "./lib/metadataEnrichment";
import {
  moveMetaScreenSection,
  withMetaScreenPayload,
  withMetaScreenSection,
  type MetaScreenSectionKey,
} from "./lib/metaScreenSettings";
import { readDebridRules } from "./lib/webSettings";
import { applyDebridStreamSettings } from "./lib/debridStreams";
import {
  readWebSettings,
  type ContinueWatchingSettings,
  type PosterSettings,
  type WebSettings,
} from "./lib/webSettings";
import type {
  AddonRow,
  CatalogSection,
  Collection,
  CollectionFolder,
  ExternalPlayerMode,
  InstalledAddon,
  LibraryItem,
  Meta,
  NavKey,
  Person,
  Profile,
  ProgressRow,
  Session,
  Stream,
  Video,
  WatchedItem,
} from "./types";

/** The path below the deploy's base, with no slashes on either end. */
function currentRoute() {
  const base = import.meta.env.BASE_URL;
  const path = window.location.pathname;
  const rest = path.startsWith(base) ? path.slice(base.length) : path;
  return rest.replace(/^\/+|\/+$/g, "");
}

// Addons is deliberately absent: it is configuration, not a place you browse,
// so it lives behind Settings rather than taking a slot in the tab bar.
const nav: Array<{ key: NavKey; label: string; icon: typeof Home }> = [
  { key: "home", label: "Home", icon: Home },
  { key: "discover", label: "Discover", icon: Compass },
  { key: "library", label: "Library", icon: Library },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  // Present only where the shell can save files. Absence removes the tab
  // rather than showing one that explains itself away.
  ...(platform.downloads
    ? [{ key: "downloads" as NavKey, label: "Downloads", icon: Download }]
    : []),
  { key: "settings", label: "Settings", icon: Settings },
];

type SettingsCategory =
  | "appearance"
  | "home"
  | "details"
  | "playback"
  | "integrations"
  | "addons"
  | "app";

/**
 * Integrations is a hub, not a page.
 *
 * Matching the official clients, where each provider is its own page behind a
 * row with its mark on it. Run together they were one scroll of key fields and
 * forty toggles, with nothing to say where TMDB stopped and MDBList began.
 */
type IntegrationPageKey = "tmdb" | "mdblist" | "connected";

/** Under the deploy's base path, which is /nuvio-web/ on the public instance. */
const publicAsset = (fileName: string) =>
  `${import.meta.env.BASE_URL}${fileName}`;

const INTEGRATION_PAGES: Array<{
  key: IntegrationPageKey;
  label: string;
  description: string;
  /** A file in `public/`, or none where the provider has no mark to use. */
  logo?: string;
}> = [
  {
    key: "tmdb",
    label: "TMDB Enrichment",
    description: "Metadata enrichment controls",
    logo: "rating_tmdb.png",
  },
  {
    key: "mdblist",
    label: "MDBList Ratings",
    description: "External ratings providers",
    logo: "mdblist_logo.svg",
  },
  {
    key: "connected",
    label: "Connected Services",
    description: "Debrid accounts — not available on the web",
  },
];

function IntegrationPageHeader({
  page,
  onBack,
}: {
  page: (typeof INTEGRATION_PAGES)[number];
  onBack(): void;
}) {
  // Kept for desktop, where nothing else offers a way back to the hub. On a
  // phone the panel header's arrow does that job and CSS hides this one —
  // two arrows in the same corner said nothing about which went where.
  return (
    <header className="integration-page-header">
      <button
        type="button"
        className="circle-button"
        onClick={onBack}
        aria-label="Back to integrations"
      >
        <ArrowLeft />
      </button>
      <div>
        <h2>{page.label}</h2>
        <span>{page.description}</span>
      </div>
    </header>
  );
}

const SETTINGS_CATEGORIES: Array<{
  key: SettingsCategory;
  label: string;
  description: string;
  icon: typeof Home;
}> = [
  {
    key: "appearance",
    label: "Appearance",
    description: "Theme, navigation, and poster cards",
    icon: Palette,
  },
  {
    key: "home",
    label: "Home",
    description: "Continue Watching and home presentation",
    icon: Home,
  },
  {
    key: "details",
    label: "Details",
    description: "Detail page layout and episode cards",
    icon: LayoutGrid,
  },
  {
    key: "addons",
    label: "Content & discovery",
    description: "Manage addons and discovery sources",
    icon: Puzzle,
  },
  {
    key: "playback",
    label: "Playback",
    description: "Player, subtitles, sources, and auto-play",
    icon: Play,
  },
  {
    key: "integrations",
    label: "Integrations",
    description: "TMDB, MDBList, and metadata providers",
    icon: Link2,
  },
  {
    key: "app",
    label: "App & account",
    description: "Profile, notifications, updates, and install",
    icon: UserRound,
  },
];

const AMOLED_CACHE_KEY = "nuvio-web-amoled";
const ACCENT_CACHE_KEY = "nuvio-web-accent";
const WEB_DETAIL_SECTION_KEYS = [
  "EPISODES",
  "PRODUCTION",
  "CAST",
  "TRAILERS",
  "DETAILS",
] as const satisfies readonly MetaScreenSectionKey[];

const DETAIL_SECTION_LABELS: Record<
  (typeof WEB_DETAIL_SECTION_KEYS)[number],
  string
> = {
  EPISODES: "Episodes",
  PRODUCTION: "Production",
  CAST: "Cast",
  TRAILERS: "Trailers & extras",
  DETAILS: "Details",
};

// The synced value arrives a round trip after boot. Painting the last known
// theme immediately avoids a flash of the wrong background on every launch.
document.documentElement.dataset.theme =
  localStorage.getItem(AMOLED_CACHE_KEY) === "true" ? "amoled" : "default";
document.documentElement.dataset.nuvioAccent =
  localStorage.getItem(ACCENT_CACHE_KEY) ?? "white";

export function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [addonRows, setAddonRows] = useState<AddonRow[]>([]);
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const addonRowsRef = useRef(addonRows);
  addonRowsRef.current = addonRows;
  const addonsRef = useRef(addons);
  addonsRef.current = addons;
  const addonWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const addonRevision = useRef(0);
  const [sections, setSections] = useState<CatalogSection[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [watchedItems, setWatchedItems] = useState<WatchedItem[]>([]);
  // Read inside playback callbacks, which must see the latest rows to recover
  // the server's progress key rather than rebuilding it.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const [recentMetadata, setRecentMetadata] = useState<Meta[]>([]);
  const [settingsBlob, setSettingsBlob] = useState<SettingsBlob | null>(null);
  // Every settings RPC replaces the complete platform blob. Keep optimistic
  // edits in a ref and serialize writes so two quick controls cannot race and
  // silently restore an older full blob over a newer one.
  const settingsBlobRef = useRef<SettingsBlob | null>(null);
  settingsBlobRef.current = settingsBlob;
  const settingsWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const settingsRevision = useRef(0);
  const [pinTarget, setPinTarget] = useState<Profile | null>(null);
  const [rememberProfile, setRememberProfile] = useState(
    () => localStorage.getItem("nuvio-remember-profile") === "1",
  );
  /** Set when the picker is asked for explicitly, so it beats "use last". */
  const [switchingProfile, setSwitchingProfile] = useState(false);
  /**
   * Read rather than depended on. Toggling the preference must not re-run
   * hydrate — doing so opened the remembered profile the instant the switch
   * was flipped, before anyone had picked anything.
   */
  const rememberProfileRef = useRef(
    localStorage.getItem("nuvio-remember-profile") === "1",
  );
  /** Boot may open a profile by itself once; a later hydrate must not. */
  const autoOpenAttempted = useRef(false);
  /**
   * Both read once, at mount: before this session can write a hand-off of its
   * own, so one that did not cost us the page is not "resumed" on top of
   * itself — and because reading the report rewrites the address bar, which
   * must not happen again on every render.
   */
  const [bootHandoff] = useState(() => readExternalHandoff());
  const [bootReport] = useState(() => takeExternalReport());
  const resumeConsumed = useRef(false);
  /**
   * What was last handed to another player, for as long as we are still owed
   * an answer about it. A report can arrive well after boot — bringing an
   * already-running app to the front does not mount anything — so the title it
   * refers to has to outlive the moment the app started.
   */
  const handedOff = useRef<{ meta: Meta; video?: Video } | null>(null);
  /** Orders the episode switches, so a slow one cannot overtake a later one. */
  const episodeSwitch = useRef(0);
  /**
   * A report waiting for somewhere to put it. Held rather than applied because
   * it can arrive before a profile has been chosen, and saving needs one.
   */
  const [pendingReport, setPendingReport] = useState<ExternalPlayerReport | null>(
    null,
  );
  const [providerCredentials, setProviderCredentials] = useState<
    ProviderCredentialRow[]
  >([]);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const accountHydrationGeneration = useRef(0);
  const profileGeneration = useRef(0);
  const profileLoadGeneration = useRef(0);
  const activeProfileIndexRef = useRef<number | null>(null);
  const hydratedProfileIndexRef = useRef<number | null>(null);
  /**
   * Whether the profile list has finished loading, and why it is empty.
   *
   * An empty list is a real answer — a new account has none until something
   * creates one — and is not the same as still waiting. Told apart, the
   * screen can say which; conflated, both are a spinner that never stops.
   */
  const [profilesSettled, setProfilesSettled] = useState(false);
  const [profilesError, setProfilesError] = useState("");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [homeLayout, setHomeLayout] = useState<HomeLayout | null>(null);
  const homeLayoutRef = useRef(homeLayout);
  homeLayoutRef.current = homeLayout;
  const homeLayoutWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const homeLayoutRevision = useRef(0);
  const [folder, setFolder] = useState<CollectionFolder | null>(null);
  // Raised after a hand-off to another player, which reports nothing back.
  const [externalWatch, setExternalWatch] = useState<{
    meta: Meta;
    video?: Video;
  } | null>(null);
  /**
   * Whether Home opens with the featured carousel.
   *
   * Device-local, like the official client's `heroEnabled` — its sync payload
   * (`SyncHomeCatalogPayload`) carries only the catalog list, `show_catalog_type`
   * and `hide_unreleased_content`, so there is no synced field for this and
   * inventing one would be a setting no other Nuvio client would honour.
   */
  const [heroEnabled, setHeroEnabled] = useState(
    () => localStorage.getItem("nuvio-web-home-hero") !== "off",
  );
  /**
   * The addon the source list opens filtered to. "" is all of them.
   *
   * Device-local like the other picks here. The official client has no such
   * setting — it re-selects whichever addon you last watched *that title* from,
   * per title rather than globally — so there is no synced field to write to
   * and no shared shape to match.
   */
  const [defaultSourceAddon, setDefaultSourceAddon] = useState(
    () => localStorage.getItem("nuvio-web-default-source-addon") ?? "",
  );
  const [externalPlayer, setExternalPlayer] = useState<ExternalPlayerMode>(() => {
    const stored = localStorage.getItem(
      "nuvio-web-external-player",
    ) as ExternalPlayerMode | null;
    return stored && platform.externalPlayer.isAvailable(stored)
      ? stored
      : "internal";
  });
  /**
   * The one thing this app reads from its own address.
   *
   * Not a router: there is a single deep link, /random, so that the picker can
   * be reached without going through the app first. Everything else is state,
   * as before — adding a router to serve one path would be a lot of machinery
   * for one path.
   */
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((next: string) => {
    const base = import.meta.env.BASE_URL;
    window.history.pushState(null, "", `${base}${next}`);
    setRoute(next);
  }, []);
  const [active, setActive] = useState<NavKey>("home");
  // The nav highlight follows `active` immediately; the page body renders from
  // the deferred copy, so a tap paints the new tab first and the heavy list
  // render happens in a later, interruptible pass instead of blocking it.
  const deferredActive = useDeferredValue(active);
  const [selected, setSelected] = useState<Meta | null>(null);
  // The cast member whose page is open, over the details it was opened from.
  // Closing it returns to that title rather than to the grid, which is the only
  // reason it is a separate piece of state rather than a replacement for it.
  const [person, setPerson] = useState<(Person & { tmdbId: number }) | null>(null);
  const [detailLaunch, setDetailLaunch] = useState<{
    video?: Video;
    videoId?: string;
    openSources?: boolean;
    startAtBeginning?: boolean;
  } | null>(null);
  const [titleMenu, setTitleMenu] = useState<{
    item: Meta;
    x: number;
    y: number;
  } | null>(null);
  const [continueMenu, setContinueMenu] = useState<{
    card: ContinueCard;
    x: number;
    y: number;
  } | null>(null);
  const [catalog, setCatalog] = useState<CatalogSection | null>(null);
  // The sub-views are deferred for the same reason as the tab: leaving "See
  // all" rebuilds every home row, and without this the tap registered nothing
  // until that finished.
  const deferredCatalog = useDeferredValue(catalog);
  const deferredFolder = useDeferredValue(folder);

  // Opening a catalog or folder swaps the page content without touching the
  // document scroller, so a view entered from halfway down home opened
  // halfway down. Keyed on the deferred values so it fires with the render
  // that actually swaps the content, not one frame early.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [deferredCatalog, deferredFolder, deferredActive]);
  const [playback, setPlayback] = useState<{
    stream: Stream;
    meta: Meta;
    video?: Video;
    startAtBeginning?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  // Status notices are informational, not decisions to act on, so they clear
  // themselves rather than sitting over the page until dismissed.
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Meta[]>([]);
  const [searchGroups, setSearchGroups] = useState<AddonSearchGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const searchGeneration = useRef(0);
  // Read once at mount rather than on every render: the store is synchronous,
  // and touching it during render would make search history a layout cost.
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches);
  const [searchFocused, setSearchFocused] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(updateReady);
  useEffect(() => subscribeUpdate(() => setHasUpdate(true)), []);
  // Ask once at startup rather than waiting for the browser's own schedule,
  // which can be hours — long enough to keep running a build you replaced.
  useEffect(() => {
    void checkForUpdate({ prompt: true }).then((result) => {
      if (result === "pending") setHasUpdate(true);
    });
  }, []);
  const activateProfile = useCallback((next: Profile | null) => {
    profileGeneration.current += 1;
    profileLoadGeneration.current += 1;
    activeProfileIndexRef.current = next?.profileIndex ?? null;
    hydratedProfileIndexRef.current = null;
    settingsRevision.current += 1;
    settingsBlobRef.current = null;
    setAddonRows([]);
    setAddons([]);
    setSections([]);
    setLibrary([]);
    setProgress([]);
    setWatchedItems([]);
    setRecentMetadata([]);
    setSettingsBlob(null);
    setProviderCredentials([]);
    setCredentialsReady(false);
    setCollections([]);
    setHomeLayout(null);
    setFolder(null);
    setCatalog(null);
    setSelected(null);
    setDetailLaunch(null);
    setTitleMenu(null);
    setContinueMenu(null);
    setQuery("");
    setResults([]);
    setSearchGroups([]);
    searchGeneration.current += 1;
    setSearching(false);
    setPlayback(null);
    setExternalWatch(null);
    setProfile(next);
  }, []);
  useEffect(() => {
    restoreSession()
      .then((value) => {
        setSession(value);
      })
      .finally(() => setBooting(false));
  }, []);
  /**
   * Puts this browser in the account's device list, and keeps it there.
   *
   * Where the official client registers: once when a session is established,
   * and again on returning to the app, which its own fifteen minute interval
   * turns into roughly an hourly heartbeat rather than a call per glance. A
   * device that stops checking in is one that can be told apart from a device
   * still in use, so the list is worth something to revoke from.
   */
  useEffect(() => {
    if (!session) return;
    resetDeviceRegistration();
    void registerCurrentDevice(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") void registerCurrentDevice();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [session]);
  /**
   * Puts back what the hand-off cost us, once its profile is open.
   *
   * Runs after `activateProfile`, which clears both of these — the title page
   * you were on, and the way a position from the other player gets recorded.
   * When that player said what it did, its word is taken and nothing is asked;
   * only a player that came back silent gets the prompt.
   */
  useEffect(() => {
    if (resumeConsumed.current || !bootHandoff || !profile) return;
    if (profile.profileIndex !== bootHandoff.profileIndex) return;
    resumeConsumed.current = true;
    clearExternalHandoff();
    setSelected(bootHandoff.meta);
    const watched = { meta: bootHandoff.meta, video: bootHandoff.video };
    handedOff.current = watched;
    if (bootReport) setPendingReport(bootReport);
    else setExternalWatch(watched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, bootHandoff, bootReport]);
  /**
   * Applies a report once there is a profile to record it against.
   *
   * A report can arrive before the account has finished loading — the relay is
   * asked the moment the app wakes, and a cold start asks it before anyone has
   * been chosen. Saving needs a profile, so it waits for one here rather than
   * being dropped on the floor by the writer.
   */
  useEffect(() => {
    if (!pendingReport || !profile || !handedOff.current) return;
    const report = pendingReport;
    setPendingReport(null);
    applyExternalReport(report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReport, profile]);
  /**
   * Watches for a report that arrives after the app is already up.
   *
   * Reading the address once, at mount, only works when the return is a fresh
   * load. Reopening an app that is merely backgrounded mounts nothing, so a
   * report delivered that way was never looked for — which is every return
   * through the Shortcut, and why nothing was ever recorded.
   */
  useEffect(() => {
    /**
     * Nothing in the address is the normal case on an installed iOS web app,
     * so the relay is asked separately rather than as a fallback nobody
     * reaches. Both answers are logged: "had nothing" is as much of a result
     * as an answer, and distinguishes a relay that was never asked from one
     * that was asked and was empty.
     */
    const pollRelay = () => {
      const token = pendingRelayToken();
      if (!token) return;
      void collectRelayReport(token).then((relayed) => {
        if (!relayed) return;
        clearRelayToken();
        setPendingReport(relayed);
      });
    };
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const report = takeExternalReport();
      if (report) {
        setPendingReport(report);
        return;
      }
      pollRelay();
    };
    // A cold start is a return too, and the quietest kind: nothing becomes
    // visible because it was never hidden, so no event fires and the relay
    // would go unasked.
    pollRelay();
    const onVisible = () => check();
    const onShow = () => check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openProfile = useCallback(
    (next: Profile) => {
      localStorage.setItem("nuvio-active-profile", String(next.profileIndex));
      setSwitchingProfile(false);
      activateProfile(next);
    },
    [activateProfile],
  );

  /** Creates a profile, then reloads so the new one appears in the gate. */
  const addProfile = useCallback(
    async (name: string, avatarColorHex: string) => {
      await createProfile(profiles, name, avatarColorHex);
      await hydrateRef.current?.();
    },
    [profiles],
  );
  const hydrateRef = useRef<(() => Promise<void>) | null>(null);
  const hydrate = useCallback(async () => {
    const hydrationGeneration = ++accountHydrationGeneration.current;
    setProfilesSettled(false);
    setProfilesError("");
    if (!session) {
      setLoading(false);
      return;
    }
    const isCurrent = () =>
      hydrationGeneration === accountHydrationGeneration.current;
    setLoading(true);
    setMessage("");
    try {
      const [rawProfiles, avatars] = await Promise.all([
        loadProfiles(),
        loadAvatarCatalog().catch(() => []),
      ]);
      const avatarUrls = new Map(
        avatars.map((item) => [item.id, item.imageUrl]),
      );
      const nextProfiles = rawProfiles.map((item) => ({
        ...item,
        avatarUrl:
          item.avatarUrl ||
          (item.avatarId ? avatarUrls.get(item.avatarId) : undefined),
      }));
      const stored = Number(localStorage.getItem("nuvio-active-profile") ?? 1);
      const last = nextProfiles.find((item) => item.profileIndex === stored);
      if (!isCurrent()) return;
      setProfiles(nextProfiles);
      // Nothing loads until someone is chosen. Two cases skip the picker: a
      // remembered profile, and coming back from a hand-off to another player
      // — that is a return to something already in progress, not an app open,
      // so being asked who is watching loses the thread. A locked profile is
      // still locked either way, and shows the PIN alone rather than the list.
      const resumeProfile = bootHandoff
        ? nextProfiles.find(
            (item) => item.profileIndex === bootHandoff.profileIndex,
          )
        : undefined;
      const target = resumeProfile ?? (rememberProfileRef.current ? last : undefined);
      if (!autoOpenAttempted.current && target) {
        autoOpenAttempted.current = true;
        if (target.pinEnabled) setPinTarget(target);
        else openProfile(target);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setProfilesError(
        error instanceof Error ? error.message : "Account loading failed",
      );
    } finally {
      if (isCurrent()) {
        setLoading(false);
        // Whatever happened, the wait is over. Without this an account that
        // legitimately has no profiles yet — a brand new one, never opened in
        // any Nuvio client — sat on the spinner for good, because nothing had
        // failed and there was nothing to show.
        setProfilesSettled(true);
      }
    }
  }, [session, activateProfile, openProfile, bootHandoff]);
  hydrateRef.current = hydrate;
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  const loadProfileData = useCallback(async () => {
    if (!profile) return;
    const profileIndex = profile.profileIndex;
    const addonProfileIndex = effectiveAddonProfileIndex(profile);
    const generation = profileGeneration.current;
    const loadGeneration = ++profileLoadGeneration.current;
    // Switching profiles restarts every load, and a stale one finishing after
    // a newer one starts is the classic way a page ends up empty. Each run
    // announces itself so a broken switch can be told apart from a broken
    // fetch: no line means the effect never fired.
    const isCurrent = () =>
      generation === profileGeneration.current &&
      loadGeneration === profileLoadGeneration.current &&
      activeProfileIndexRef.current === profileIndex;
    if (!isCurrent()) return;
    setLoading(true);
    try {
      // Everything the catalogs do not depend on runs on its own and lands
      // when it lands. Gathering all seven into one Promise.all meant the
      // slowest request — usually the watched history — held up the rows.
      const libraryTask = loadLibrary(profileIndex)
        .then((items) => {
          if (isCurrent()) setLibrary(items);
          return items;
        })
        .catch(() => [] as LibraryItem[]);
      // Snapshot once, then deltas — see lib/watchSync.
      const progressTask = syncProgress(profileIndex)
        .then((rows) => {
          if (isCurrent()) setProgress(rows);
          return rows;
        })
        .catch(() => [] as ProgressRow[]);
      const watchedTask = syncWatched(profileIndex)
        .then((items) => {
          if (isCurrent()) setWatchedItems(items);
          return items;
        })
        .catch(() => [] as WatchedItem[]);
      setCredentialsReady(false);
      void loadSettingsBlob(profileIndex)
        .then((blob) => {
          if (!blob || !isCurrent()) return;
          settingsBlobRef.current = blob;
          setSettingsBlob(blob);
        })
        .catch(() => undefined);
      void loadProviderCredentials(profileIndex)
        .then((rows) => {
          if (!isCurrent()) return;
          setProviderCredentials(rows);
          setCredentialsReady(true);
        })
        .catch(() => {
          if (!isCurrent()) return;
          setProviderCredentials([]);
          setCredentialsReady(true);
        });
      void loadCollections(profileIndex)
        .then((items) => isCurrent() && setCollections(items))
        .catch(() => undefined);

      // The critical path: addons and the layout that orders them. The layout
      // is one small request and decides which catalogs are fetched at all, so
      // it is worth waiting for rather than reordering afterwards.
      const [rows, nextLayout] = await Promise.all([
        // A mirroring profile's addons live on profile 1, not under its own id.
        loadAddons(addonProfileIndex),
        loadHomeLayout(profileIndex).catch(() => null),
      ]);
      if (!isCurrent()) {
        return;
      }
      setAddonRows(rows);
      setHomeLayout(nextLayout);
      const installed = await loadInstalledAddons(rows);
      if (!isCurrent()) return;
      setAddons(installed);
      hydratedProfileIndexRef.current = profileIndex;
      // Rows appear as each catalog lands instead of after every addon has
      // answered, which is what left the page blank on a slow connection.
      setSections([]);
      const home = await loadHome(
        installed,
        (section) => {
          if (!isCurrent()) return;
          setSections((current) => [...current, section]);
          // The first row on screen is the end of "loading". Everything after
          // this fills in behind a page you can already use.
          setLoading(false);
        },
        nextLayout,
      );
      if (!isCurrent()) return;
      // No catalog returned anything, so nothing will clear it above.
      setLoading(false);

      // Continue Watching needs all three, so it resolves last — by which
      // point the catalogs are already on screen.
      const [nextLibrary, nextProgress, nextWatched] = await Promise.all([
        libraryTask,
        progressTask,
        watchedTask,
      ]);
      if (!isCurrent()) return;
      const known = new Map<string, Meta>();
      for (const item of [
        ...home.sections.flatMap((section) => section.items),
        ...nextLibrary,
      ])
        known.set(item.id, item);
      const watchedTitles = new Map(
        nextWatched.map((item) => [item.contentId, item.title]),
      );
      // Only titles that could actually yield a card, newest first.
      const unique = continueWatchingCandidates(nextProgress, nextWatched);

      // A title with no metadata is dropped from Continue Watching entirely,
      // so this cap is really a cap on how much of the list is shown. Twenty
      // was hiding rows for anyone with more in flight than that.
      const RESOLVE_LIMIT = 80;
      const RESOLVE_CONCURRENCY = 6;
      const pending = unique.slice(0, RESOLVE_LIMIT);
      const resolved: Meta[] = [];
      // Batched rather than one Promise.all over the whole set: sixty parallel
      // requests to a handful of addon hosts is how you get rate-limited.
      for (let cursor = 0; cursor < pending.length; cursor += RESOLVE_CONCURRENCY) {
        const batch = await Promise.all(
          pending
            .slice(cursor, cursor + RESOLVE_CONCURRENCY)
            .map(async ({ id, type }) => {
              const existing = known.get(id);
              if (existing?.videos.length) return existing;
              const seed: Meta = {
                id,
                type,
                name:
                  watchedTitles.get(id) || existing?.name || "Recently watched",
                genres: [],
                cast: [],
                director: [],
                writer: [],
                trailers: [],
                externalRatings: [],
                videos: [],
                manifestUrl: existing?.manifestUrl || "",
                addonName: existing?.addonName || "",
              };
              return resolveMeta(seed, installed).catch(() => existing ?? seed);
            }),
        );
        if (!isCurrent()) return;
        resolved.push(...batch);
        // Publish each batch so the row fills in rather than appearing whole
        // at the end.
        setRecentMetadata([...resolved]);
      }
      if (home.errors.length && isCurrent())
        setMessage(
          `${home.errors.length} addon request${home.errors.length === 1 ? "" : "s"} could not load in this browser.`,
        );
    } catch (error) {
      if (isCurrent())
        setMessage(
          error instanceof Error ? error.message : "Profile data failed",
        );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [profile]);
  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);
  async function runSearch(term = query) {
    if (!term.trim()) return;
    if (term !== query) setQuery(term);
    setRecentSearches(rememberSearch(term));
    setSearchFocused(false);
    const request = ++searchGeneration.current;
    const generation = profileGeneration.current;
    const profileIndex = activeProfileIndexRef.current;
    setResults([]);
    setSearchGroups([]);
    setSearching(true);
    setActive("discover");
    try {
      const next = await searchAddons(term.trim(), addons);
      if (
        request === searchGeneration.current &&
        generation === profileGeneration.current &&
        profileIndex === activeProfileIndexRef.current
      ) {
        setResults(next.items);
        setSearchGroups(next.groups);
      }
    } finally {
      if (
        request === searchGeneration.current &&
        generation === profileGeneration.current &&
        profileIndex === activeProfileIndexRef.current
      )
        setSearching(false);
    }
  }
  async function updateAddons(
    next: AddonRow[],
    { refreshContent = false }: { refreshContent?: boolean } = {},
  ) {
    if (!profile) return;
    if (hydratedProfileIndexRef.current !== profile.profileIndex) {
      setMessage("Wait for this profile to finish loading before changing addons.");
      return;
    }
    const profileIndex = profile.profileIndex;
    const generation = profileGeneration.current;
    const revision = ++addonRevision.current;
    const previousRows = addonRowsRef.current;
    const previousAddons = addonsRef.current;
    const normalized = next.map((row, sortOrder) => ({ ...row, sortOrder }));
    const existing = new Map(
      previousAddons.map((addon) => [normalizeManifestUrl(addon.url), addon]),
    );
    const optimistic = normalized.map((row) => ({
      ...existing.get(normalizeManifestUrl(row.url)),
      ...row,
    })) as InstalledAddon[];

    // The list moves now. Network persistence and manifest refresh happen
    // behind it; waiting here made every arrow feel as if it had missed.
    addonRowsRef.current = normalized;
    addonsRef.current = optimistic;
    setAddonRows(normalized);
    setAddons(optimistic);

    const write = addonWriteQueue.current
      .catch(() => undefined)
      // Written back to the same list it was read from. Saving under this
      // profile's own id would create a shadow list nothing reads.
      .then(() => saveAddons(effectiveAddonProfileIndex(profile), normalized));
    addonWriteQueue.current = write.catch(() => undefined);
    const installedTask = refreshContent
      ? loadInstalledAddons(normalized)
      : Promise.resolve(optimistic);
    try {
      const [, installed] = await Promise.all([write, installedTask]);
      if (
        generation !== profileGeneration.current ||
        activeProfileIndexRef.current !== profileIndex ||
        revision !== addonRevision.current
      )
        return;
      addonsRef.current = installed;
      setAddons(installed);
      if (refreshContent) {
        const home = await loadHome(installed, undefined, homeLayoutRef.current);
        if (
          generation === profileGeneration.current &&
          activeProfileIndexRef.current === profileIndex &&
          revision === addonRevision.current
        )
          setSections(home.sections);
      }
    } catch (error) {
      if (
        generation !== profileGeneration.current ||
        activeProfileIndexRef.current !== profileIndex ||
        revision !== addonRevision.current
      )
        throw error;
      addonRowsRef.current = previousRows;
      addonsRef.current = previousAddons;
      setAddonRows(previousRows);
      setAddons(previousAddons);
      setMessage(error instanceof Error ? error.message : "Could not sync addons");
      throw error;
    }
  }
  async function addAddon(url: string) {
    const normalized = normalizeManifestUrl(url);
    if (addonRows.some((item) => item.url === normalized))
      throw new Error("That addon is already installed.");
    await updateAddons([
      ...addonRows,
      { url: normalized, enabled: true, sortOrder: addonRows.length },
    ], { refreshContent: true });
  }
  function toggleAddon(index: number) {
    void updateAddons(
      addonRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, enabled: !row.enabled } : row,
      ),
      { refreshContent: true },
    ).catch(() => undefined);
  }
  function moveAddon(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= addonRows.length) return;
    const next = [...addonRows];
    [next[index], next[destination]] = [next[destination], next[index]];
    void updateAddons(next.map((row, sortOrder) => ({ ...row, sortOrder }))).catch(
      () => undefined,
    );
  }
  function removeAddon(index: number) {
    const addon = addons[index];
    if (
      !window.confirm(
        `Remove ${addon?.manifest?.name || addon?.name || "this addon"}?`,
      )
    )
      return;
    void updateAddons(
      addonRows
        .filter((_, rowIndex) => rowIndex !== index)
        .map((row, sortOrder) => ({ ...row, sortOrder })),
      { refreshContent: true },
    ).catch(() => undefined);
  }
  // Read for both shells; applied only where platform.debrid exists.
  const debridRules = useMemo(() => readDebridRules(settingsBlob), [settingsBlob]);
  const webSettings = useMemo(
    () => readWebSettings(settingsBlob),
    [settingsBlob],
  );
  const amoled = webSettings.amoled;
  const metadataEnrichment = useMemo<MetadataEnrichmentConfig>(
    () => ({
      tmdb: {
        enabled: webSettings.integrations.tmdbEnabled,
        apiKey: providerCredential(providerCredentials, "tmdb", "api_key"),
        language: webSettings.integrations.tmdbLanguage,
        useArtwork: webSettings.integrations.tmdbUseArtwork,
        useBasicInfo: webSettings.integrations.tmdbUseBasicInfo,
        useDetails: webSettings.integrations.tmdbUseDetails,
        useReleaseDates: webSettings.integrations.tmdbUseReleaseDates,
        useCredits: webSettings.integrations.tmdbUseCredits,
        useEpisodes: webSettings.integrations.tmdbUseEpisodes,
        useTrailers: webSettings.integrations.tmdbUseTrailers,
      },
      mdbList: {
        enabled: webSettings.integrations.mdbListEnabled,
        apiKey: providerCredential(
          providerCredentials,
          "mdblist",
          "api_key",
        ),
        providers: webSettings.integrations.mdbListProviders,
      },
    }),
    [providerCredentials, webSettings.integrations],
  );

  const updateSettings = useCallback(
    (transform: (current: SettingsBlob) => SettingsBlob) => {
      const current = settingsBlobRef.current;
      if (
        !profile ||
        !current ||
        hydratedProfileIndexRef.current !== profile.profileIndex
      )
        return;
      const next = transform(current);
      const revision = ++settingsRevision.current;
      const profileIndex = profile.profileIndex;
      settingsBlobRef.current = next;
      setSettingsBlob(next);
      const save = settingsWriteQueue.current
        .catch(() => undefined)
        .then(() => pushSettingsBlob(profileIndex, next))
        .then(() => undefined);
      settingsWriteQueue.current = save.catch(() => undefined);
      void save.catch(async (error) => {
        setMessage(
          error instanceof Error ? error.message : "Could not save settings",
        );
        // Only the newest failed edit may refresh. An older failure must not
        // roll back a later optimistic edit which is still queued to save.
        if (
          revision === settingsRevision.current &&
          activeProfileIndexRef.current === profileIndex
        ) {
          const restored = await loadSettingsBlob(profileIndex).catch(() => null);
          if (restored) {
            settingsBlobRef.current = restored;
            setSettingsBlob(restored);
          }
        }
      });
    },
    [profile],
  );

  const updateTypedSetting = useCallback(
    (
      feature: string,
      key: string,
      type: SyncPreferenceType,
      value: string | boolean | number | string[],
    ) => {
      updateSettings((blob) => {
        switch (type) {
          case "boolean":
            return withBlobTypedValue(blob, feature, key, type, Boolean(value));
          case "int":
          case "float":
            return withBlobTypedValue(blob, feature, key, type, Number(value));
          case "string_set":
            return withBlobTypedValue(
              blob,
              feature,
              key,
              type,
              Array.isArray(value) ? value : [],
            );
          default:
            return withBlobTypedValue(blob, feature, key, type, String(value));
        }
      });
    },
    [updateSettings],
  );

  const updatePosterSetting = useCallback(
    (patch: Partial<PosterSettings>) =>
      updateSettings((blob) =>
        withBlobStringPayload(
          blob,
          "poster_card_style_settings_payload",
          patch,
        ),
      ),
    [updateSettings],
  );

  const updateContinueWatchingSetting = useCallback(
    (patch: Record<string, unknown>) =>
      updateSettings((blob) =>
        withBlobStringPayload(
          blob,
          "continue_watching_settings_payload",
          patch,
        ),
      ),
    [updateSettings],
  );

  const updateMetaScreenSetting = useCallback(
    (patch: Record<string, unknown>) =>
      updateSettings((blob) => withMetaScreenPayload(blob, patch)),
    [updateSettings],
  );

  const updateMetaScreenSection = useCallback(
    (key: MetaScreenSectionKey, enabled: boolean) =>
      updateSettings((blob) =>
        withMetaScreenSection(blob, key, { enabled }),
      ),
    [updateSettings],
  );

  const moveDetailSection = useCallback(
    (key: MetaScreenSectionKey, direction: -1 | 1) =>
      updateSettings((blob) =>
        moveMetaScreenSection(
          blob,
          key,
          direction,
          WEB_DETAIL_SECTION_KEYS,
        ),
      ),
    [updateSettings],
  );

  const updateRawSetting = useCallback(
    (feature: string, key: string, value: unknown) =>
      updateSettings((blob) => withBlobRawValue(blob, feature, key, value)),
    [updateSettings],
  );

  const saveProviderCredential = useCallback(
    async (
      // The account's own row name. Debrid rows are namespaced — "debrid:torbox"
      // — so an exhaustive union here would have to be kept in step with a list
      // the shell owns.
      provider: string,
      value: string,
    ) => {
      if (!profile) return;
      if (hydratedProfileIndexRef.current !== profile.profileIndex)
        throw new Error("Wait for this profile to finish loading.");
      const profileIndex = profile.profileIndex;
      const generation = profileGeneration.current;
      const isCurrent = () =>
        generation === profileGeneration.current &&
        activeProfileIndexRef.current === profileIndex;
      try {
        const next = await updateProviderCredential(
          profileIndex,
          provider,
          value,
        );
        if (!isCurrent()) return;
        setProviderCredentials(next);
        setMessage("Integration credential saved.");
      } catch (error) {
        if (!isCurrent()) return;
        setMessage(
          error instanceof Error ? error.message : "Could not save credential",
        );
        throw error;
      }
    },
    [profile],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = amoled ? "amoled" : "default";
    localStorage.setItem(AMOLED_CACHE_KEY, String(amoled));
  }, [amoled]);
  useEffect(() => {
    const root = document.documentElement;
    const accent = webSettings.selectedTheme.toLowerCase();
    root.dataset.nuvioAccent = accent;
    localStorage.setItem(ACCENT_CACHE_KEY, accent);
    root.dataset.navLayout = webSettings.desktopNavigationLayout.toLowerCase();
    root.dataset.navStyle = webSettings.navBarStyle.toLowerCase();
    root.dataset.posterLandscape = String(
      webSettings.poster.catalogLandscapeModeEnabled,
    );
    root.dataset.hidePosterLabels = String(
      webSettings.poster.hideLabelsEnabled,
    );
    root.style.setProperty("--poster-width", `${webSettings.poster.widthDp}px`);
    root.style.setProperty("--poster-height", `${webSettings.poster.heightDp}px`);
    root.style.setProperty(
      "--poster-aspect",
      `${webSettings.poster.widthDp} / ${webSettings.poster.heightDp}`,
    );
    root.style.setProperty(
      "--poster-radius",
      `${webSettings.poster.cornerRadiusDp}px`,
    );
  }, [webSettings]);

  const saveHomeLayout = useCallback(
    async (next: HomeLayout) => {
      if (!profile) return;
      const profileIndex = profile.profileIndex;
      const generation = profileGeneration.current;
      const revision = ++homeLayoutRevision.current;
      homeLayoutRef.current = next;
      setHomeLayout(next);
      const write = homeLayoutWriteQueue.current
        .catch(() => undefined)
        .then(() => pushHomeLayout(profileIndex, next));
      homeLayoutWriteQueue.current = write.then(() => undefined, () => undefined);
      try {
        const saved = await write;
        if (
          generation !== profileGeneration.current ||
          activeProfileIndexRef.current !== profileIndex ||
          revision !== homeLayoutRevision.current
        )
          return;
        homeLayoutRef.current = saved;
        setHomeLayout(saved);
        setMessage("Home layout synced.");
      } catch (error) {
        if (
          generation !== profileGeneration.current ||
          activeProfileIndexRef.current !== profileIndex ||
          revision !== homeLayoutRevision.current
        )
          return;
        const restored = await loadHomeLayout(profileIndex).catch(() => null);
        if (restored) {
          homeLayoutRef.current = restored;
          setHomeLayout(restored);
        }
        setMessage(
          error instanceof Error ? error.message : "Could not sync Home layout",
        );
        throw error;
      }
    },
    [profile],
  );

  /**
   * Catalogs and collections in one list, ordered the way Nuvio stores them.
   *
   * They share a single ordering — collections keyed `collection_<id>`,
   * catalogs `<addon>:<type>:<catalog>` — so rendering all collections before
   * all catalogs ignored it entirely. That is why rows set to the bottom
   * appeared at the top.
   */
  const homeRows = useMemo(() => {
    type Row =
      | { key: string; kind: "catalog"; section: CatalogSection }
      | { key: string; kind: "collection"; collection: Collection };
    const rows: Row[] = [
      ...sections.map((section) => {
        const customTitle = homeLayout?.customTitleOf.get(section.key);
        return {
          key: section.key,
          kind: "catalog",
          section: customTitle ? { ...section, name: customTitle } : section,
        } satisfies Row;
      }),
      ...collections
        .filter(
          (collection) =>
            homeLayout?.enabledOf.get(
              `${COLLECTION_KEY_PREFIX}${collection.id}`,
            ) !== false,
        )
        .map(
          (collection) =>
            ({
              key: `${COLLECTION_KEY_PREFIX}${collection.id}`,
              kind: "collection",
              collection,
            }) satisfies Row,
        ),
    ];
    if (!homeLayout) return rows;
    // Pinned collections are forced above everything, matching the desktop
    // client's `enforce_pinned_collections_at_top`. An unknown key sorts last:
    // it is new to this device rather than deliberately placed.
    const rank = (row: Row) =>
      row.kind === "collection" && row.collection.pinToTop
        ? -1
        : (homeLayout.orderOf.get(row.key) ?? Number.MAX_SAFE_INTEGER);
    return [...rows].sort((a, b) => rank(a) - rank(b));
  }, [collections, homeLayout, sections]);
  const pinnedCollectionKeys = useMemo(
    () =>
      new Set(
        collections
          .filter((collection) => collection.pinToTop)
          .map((collection) => `${COLLECTION_KEY_PREFIX}${collection.id}`),
      ),
    [collections],
  );
  /**
   * The names the source list files streams under, for the default picker.
   *
   * `stream.addonName` is the manifest name, so the setting has to store that
   * rather than an addon id — otherwise the saved default would never match
   * anything and would silently mean "all".
   */
  const addonNames = useMemo(
    () => [
      ...new Set(
        addons
          .filter(
            (addon) =>
              addon.enabled &&
              addon.manifest &&
              // Stream providers only. A metadata or subtitle addon never
              // appears in this list, so offering it as the default meant
              // choosing a filter that could only ever match nothing.
              supports(addon.manifest, "stream"),
          )
          .map((addon) => addon.manifest!.name)
          .filter(Boolean),
      ),
    ],
    [addons],
  );
  const homeLayoutLabels = useMemo(
    () =>
      new Map<string, string>([
        ...sections.map((section) => [section.key, section.name] as const),
        ...collections.map(
          (collection) =>
            [`${COLLECTION_KEY_PREFIX}${collection.id}`, collection.title] as const,
        ),
      ]),
    [collections, sections],
  );

  /**
   * Stores a resume point for whatever is playing.
   *
   * Fire-and-forget: a failed write must never interrupt playback, and the
   * next report a few seconds later supersedes it anyway. The local snapshot
   * is updated so Continue Watching reflects it without a refetch.
   */
  function savePlaybackProgress(
    current: { meta: Meta; video?: Video },
    positionMs: number,
    durationMs: number,
    ended: boolean,
  ) {
    if (!profile) return;
    const profileIndex = profile.profileIndex;
    const generation = profileGeneration.current;
    const identity = {
      contentId: current.meta.id,
      contentType: current.meta.type,
      videoId: current.video?.id || current.meta.id,
      season: current.video?.season,
      episode: current.video?.episode,
    };
    const rows = progressRef.current;
    void pushProgress(
      profileIndex,
      identity,
      positionMs,
      durationMs,
      ended,
      rows,
    )
      .then((stored) => {
        if (
          !stored ||
          generation !== profileGeneration.current ||
          activeProfileIndexRef.current !== profileIndex
        )
          return;
        const complete = isComplete(positionMs, durationMs, ended);
        const key = watchKey(identity.contentId, identity.season, identity.episode);
        setProgress((currentRows) => [
          ...currentRows.filter(
            (row) => watchKey(row.contentId, row.season, row.episode) !== key,
          ),
          {
            contentId: identity.contentId,
            contentType: identity.contentType,
            videoId: identity.videoId,
            season: identity.season,
            episode: identity.episode,
            positionMs: complete && durationMs > 0 ? durationMs : positionMs,
            durationMs,
            lastWatched: Date.now(),
            progressKey: currentRows.find(
              (row) =>
                watchKey(row.contentId, row.season, row.episode) === key,
            )?.progressKey,
          },
        ]);
      })
      .catch(() => undefined);
  }

  /**
   * Reflects a checkpoint the desktop shell has already accepted for sync.
   * This performs no RPC: libmpv's Rust reporter remains the only persistent
   * writer, while React stops showing a stale resume point after Back. The
   * browser/PWA player never calls this path.
   */
  function reflectNativePlaybackProgress(
    current: { meta: Meta; video?: Video },
    positionMs: number,
    durationMs: number,
    ended: boolean,
  ) {
    if (!profile) return;
    const position = Math.max(0, Math.round(positionMs));
    const duration = Math.max(0, Math.round(durationMs));
    const complete = isComplete(position, duration, ended);
    if (!complete && position < 1_000) return;
    const identity = {
      contentId: current.meta.id,
      contentType: current.meta.type,
      videoId: current.video?.id || current.meta.id,
      season: current.video?.season,
      episode: current.video?.episode,
    };
    const key = watchKey(identity.contentId, identity.season, identity.episode);
    setProgress((currentRows) => [
      ...currentRows.filter(
        (row) => watchKey(row.contentId, row.season, row.episode) !== key,
      ),
      {
        contentId: identity.contentId,
        contentType: identity.contentType,
        videoId: identity.videoId,
        season: identity.season,
        episode: identity.episode,
        positionMs: complete && duration > 0 ? duration : position,
        durationMs: duration,
        lastWatched: Date.now(),
        progressKey: currentRows.find(
          (row) => watchKey(row.contentId, row.season, row.episode) === key,
        )?.progressKey,
      },
    ]);
  }

  /**
   * Records what a player said about the title it was handed.
   *
   * Called whenever a report turns up — at boot when the return was a fresh
   * load, and on being brought to the front when it was not.
   */
  function applyExternalReport(report: ExternalPlayerReport) {
    const watched = handedOff.current;
    if (!watched) return;
    clearExternalHandoff();
    clearRelayToken();
    if (report.outcome === "finished") {
      handedOff.current = null;
      setExternalWatch(null);
      void toggleWatched(watched.meta, watched.video, true);
      setMessage("Marked as watched.");
      return;
    }
    // "Stopped" without a position is the Shortcut route's normal case: a
    // player appends where it got to onto the address it was handed, which
    // there is the shortcuts:// one, so it lands beside the text passed on
    // rather than inside it. Knowing playback ended is not knowing where, so
    // it still has to be asked — silently saving nothing is the one outcome
    // this must never produce.
    if (report.positionMs <= 0) {
      setExternalWatch(watched);
      return;
    }
    handedOff.current = null;
    setExternalWatch(null);
    savePlaybackProgress(watched, report.positionMs, report.durationMs, false);
    setMessage("Saved your position.");
  }

  /** Where a title resumes from, shared by the web player and the hand-off. */
  function resumePositionMs(meta: Meta, video?: Video) {
    const row = watchIndex.progress.get(
      watchKey(meta.id, video?.season, video?.episode),
    );
    // A finished title starts over rather than resuming at the credits.
    if (!row || isComplete(row.positionMs, row.durationMs, false)) return 0;
    return row.positionMs;
  }

  /**
   * Hands a stream to a player outside the browser.
   *
   * Every route to an external player goes through here — the default chosen
   * in Settings, and the "External" menu inside the web player. Launching is
   * only half of it: most players report nothing back, so the prompt that
   * records where you stopped is the one chance to keep progress. Outplayer is
   * the exception; it is handed callbacks and answers for itself.
   */
  function handOffToExternalPlayer(
    mode: ExternalPlayerMode,
    url: string,
    meta: Meta,
    video?: Video,
    positionMs?: number,
  ) {
    // Written before the launch, not after: handing off navigates away, and on
    // Android the process may not survive to run another line.
    if (profile && mode !== "copy" && mode !== "m3u") {
      rememberExternalHandoff(profile.profileIndex, meta, video);
      // Also held in memory, for the return that finds the app still running.
      handedOff.current = { meta, video };
    }
    const resumeMs = positionMs ?? resumePositionMs(meta, video);
    // The relay is the only route that carries a position into an installed
    // iOS web app. Anywhere else the app's own address already reaches it.
    const relay = canReturnToApp() ? "" : newRelayToken();
    platform.externalPlayer.launch(mode, url, video?.title || meta.name, {
      positionSeconds: resumeMs / 1000,
      returnUrlFor: relay
        ? (query) =>
            relayReturnUrl(
              relay,
              // Host and path: a project site is installed from /<repo>/, and
              // the relay sends the viewer back to exactly that address.
              `${window.location.host}${import.meta.env.BASE_URL}`,
              query.includes("finished") ? "finished" : "stopped",
            )
        : (query) => `${window.location.origin}${import.meta.env.BASE_URL}${query}`,
    });
    setMessage(
      mode === "copy"
        ? "Stream URL copied. Paste it into VLC or your media player to watch."
        : mode === "m3u"
          ? "Playlist downloaded. Open it with your preferred player."
          : `Opening ${platform.externalPlayer.label(mode)}…`,
    );
    setExternalWatch({ meta, video });
  }

  /**
   * Adds or removes a title, flipping the button before the server answers and
   * restoring it if the write fails.
   */
  async function toggleLibrary(meta: Meta) {
    if (!profile) return;
    const profileIndex = profile.profileIndex;
    const generation = profileGeneration.current;
    const isCurrent = () =>
      generation === profileGeneration.current &&
      activeProfileIndexRef.current === profileIndex;
    const present = library.some(
      (item) => item.id === meta.id && item.type === meta.type,
    );
    const previous = library;
    setLibrary((current) =>
      present
        ? current.filter(
            (item) => !(item.id === meta.id && item.type === meta.type),
          )
        : [...current, { ...meta, addedAt: Date.now() }],
    );
    try {
      if (present)
        await removeFromLibrary(profileIndex, meta.id, meta.type);
      else await addToLibrary(profileIndex, meta);
      if (!isCurrent()) return;
      setMessage(present ? "Removed from your library." : "Added to your library.");
    } catch (error) {
      if (!isCurrent()) return;
      setLibrary(previous);
      setMessage(
        error instanceof Error ? error.message : "Could not update your library",
      );
    }
  }

  /**
   * Carousel items, mirroring the desktop client's selection: round-robin
   * across the hero-source catalogs so the first addon does not own every
   * slot, skipping anything with no artwork, deduped, capped at 8.
   *
   * Which catalogs count as hero sources is a local preference on the other
   * clients, not part of the sync payload, so this uses their default — the
   * first two catalogs in the configured order.
   */
  const heroItems = useMemo(() => {
    // Switched off means no slides, and `Hero` renders nothing without any —
    // so the carousel disappears without Home needing to know why.
    if (!heroEnabled) return [];
    const HERO_SOURCE_LIMIT = 2;
    const HERO_ITEM_LIMIT = 8;
    const sources = homeRows
      .filter((row) => row.kind === "catalog")
      .slice(0, HERO_SOURCE_LIMIT)
      .map((row) => (row.kind === "catalog" ? row.section : null))
      .filter((section): section is CatalogSection => section !== null);
    const seen = new Set<string>();
    const picked: Meta[] = [];
    const deepest = Math.max(0, ...sources.map((section) => section.items.length));
    for (let slot = 0; slot < deepest && picked.length < HERO_ITEM_LIMIT; slot += 1)
      for (const section of sources) {
        const item = section.items[slot];
        if (!item) continue;
        const identity = `${item.type}:${item.id}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (!item.background && !item.banner && !item.poster) continue;
        picked.push(item);
        if (picked.length === HERO_ITEM_LIMIT) break;
      }
    return picked;
  }, [homeRows, heroEnabled]);
  const watchIndex = useMemo(
    () => buildWatchIndex(progress, watchedItems),
    [progress, watchedItems],
  );
  /**
   * Flips the badge before the server answers and rolls back if the push
   * fails, so a hold-to-mark feels immediate on a phone.
   */
  async function toggleWatched(meta: Meta, video: Video | undefined, next: boolean) {
    if (!profile) return;
    const profileIndex = profile.profileIndex;
    const generation = profileGeneration.current;
    const isCurrent = () =>
      generation === profileGeneration.current &&
      activeProfileIndexRef.current === profileIndex;
    const identity = {
      contentId: meta.id,
      contentType: meta.type,
      season: video?.season,
      episode: video?.episode,
    };
    const key = watchKey(meta.id, video?.season, video?.episode);
    const previousWatched = watchedItems;
    const previousProgress = progress;
    setWatchedItems((current) =>
      next
        ? [
            ...current,
            {
              contentId: meta.id,
              contentType: meta.type,
              title: video?.title || meta.name,
              season: video?.season,
              episode: video?.episode,
              watchedAt: Date.now(),
            },
          ]
        : current.filter(
            (item) =>
              watchKey(item.contentId, item.season, item.episode) !== key,
          ),
    );
    // Marking either way clears the resume point server-side, so drop it here
    // too or the bar would linger under a row that was just toggled.
    setProgress((current) =>
      current.filter(
        (row) => watchKey(row.contentId, row.season, row.episode) !== key,
      ),
    );
    try {
      await setWatched(
        profileIndex,
        identity,
        video?.title || meta.name,
        next,
        previousProgress,
      );
    } catch (error) {
      if (!isCurrent()) return;
      setWatchedItems(previousWatched);
      setProgress(previousProgress);
      setMessage(
        error instanceof Error ? error.message : "Could not save watched state",
      );
    }
  }
  /**
   * Sends one episode back to never-started: no resume point, no progress bar,
   * and Continue Watching stops offering it. Its watched mark is left alone —
   * that is what the toggle beside this is for.
   *
   * Optimistic like the toggle above, and restores the row it removed if the
   * server refuses, so the bar cannot vanish from a reset that never landed.
   */
  async function resetProgress(meta: Meta, video: Video | undefined) {
    if (!profile) return;
    const profileIndex = profile.profileIndex;
    const generation = profileGeneration.current;
    const isCurrent = () =>
      generation === profileGeneration.current &&
      activeProfileIndexRef.current === profileIndex;
    const key = watchKey(meta.id, video?.season, video?.episode);
    const previousProgress = progress;
    setProgress((current) =>
      current.filter(
        (row) => watchKey(row.contentId, row.season, row.episode) !== key,
      ),
    );
    try {
      await clearProgress(
        profileIndex,
        {
          contentId: meta.id,
          contentType: meta.type,
          season: video?.season,
          episode: video?.episode,
        },
        previousProgress,
      );
    } catch (error) {
      if (!isCurrent()) return;
      setProgress(previousProgress);
      setMessage(
        error instanceof Error ? error.message : "Could not reset progress",
      );
    }
  }
  const openDetails = useCallback((item: Meta) => {
    setDetailLaunch(null);
    setSelected(item);
  }, []);

  const openContinueSources = useCallback(
    (card: ContinueCard, startAtBeginning: boolean) => {
      // Claimed before anything else, so tapping a second card supersedes the
      // first: without this an overtaken lookup still finished and opened its
      // own episode over the one just asked for.
      const generation = ++episodeSwitch.current;
      const openTitle = () => {
        setLoading(false);
        setDetailLaunch({
          video: card.video,
          videoId: card.video?.id,
          openSources: true,
          startAtBeginning,
        });
        setSelected(
          card.video
            ? { ...card.item, selectedVideoId: card.video.id }
            : card.item,
        );
      };

      // Where the source is already known, continuing should continue rather
      // than ask again. Anything unexpected — no remembered group, that
      // release gone, the lookup failing — falls back to the title page with
      // its sources open, which is what this always did.
      const group = bingeGroupFor(card.item.id);
      const target = card.video;
      if (!group || !target) {
        openTitle();
        return;
      }
      // The same veil and spinner every other wait uses. This used to announce
      // itself in the notice strip, which is where outcomes go — "Added to your
      // library", "Saved your position" — so a wait arrived looking like
      // something that had already happened.
      setLoading(true);
      // Only the run that still owns the screen puts the spinner away; an
      // overtaken one leaves it to whichever replaced it.
      const finish = () => {
        if (generation === episodeSwitch.current) setLoading(false);
      };
      // The full metadata alongside the sources: without it the player has no
      // episode list, so next-up and the episode picker would both be empty.
      void Promise.all([
        loadStreams(card.item.type, target.id, addons),
        resolveMeta(card.item, addons).catch(() => card.item),
      ])
        .then(([streams, meta]) => {
          if (generation !== episodeSwitch.current) return;
          const orderedStreams = platform.debrid
            ? applyDebridStreamSettings(streams, debridRules)
            : streams;
          const chosen = pickBingeStream(orderedStreams, group);
          finish();
          if (!chosen) {
            openTitle();
            return;
          }
          setPlayback({
            stream: chosen,
            meta: { ...meta, selectedVideoId: target.id },
            video: meta.videos.find((entry) => entry.id === target.id) ?? target,
            startAtBeginning,
          });
        })
        .catch(() => {
          if (generation !== episodeSwitch.current) return;
          finish();
          openTitle();
        });
    },
    [addons, debridRules],
  );

  const dismissContinueCard = useCallback(
    (card: ContinueCard) => {
      const dismissKey = `${card.item.id}|${card.video?.season ?? -1}|${card.video?.episode ?? -1}`;
      const dismissed = new Set(webSettings.continueWatching.dismissedNextUpKeys);
      dismissed.add(dismissKey);
      void updateContinueWatchingSetting({ dismissedNextUpKeys: [...dismissed] });
      // A resumable title is not a "next up" row, so also clear its resume
      // point exactly as Nuvio's Remove action does.
      if (!card.nextUp && card.progress)
        void toggleWatched(card.item, card.video, false);
    },
    [updateContinueWatchingSetting, webSettings.continueWatching.dismissedNextUpKeys],
  );

  const continueItems = useMemo(
    () =>
      buildContinueWatching(progress, watchedItems, [
        ...sections.flatMap((section) => section.items),
        ...library,
        ...recentMetadata,
      ], webSettings.continueWatching),
    [
      library,
      progress,
      recentMetadata,
      sections,
      watchedItems,
      webSettings.continueWatching,
    ],
  );
  const updatePrompt = hasUpdate ? (
    <UpdateModal onLater={() => setHasUpdate(false)} />
  ) : null;
  if (booting)
    return (
      <>
        <LoadingScreen label="Restoring Nuvio…" />
        {updatePrompt}
      </>
    );
  if (!session)
    return (
      <>
        <AuthScreen onSession={setSession} />
        {updatePrompt}
      </>
    );
  // Signed in but nobody chosen yet: the picker, and nothing else. A PIN
  // prompt on its own counts as chosen-but-locked, so it takes precedence.
  if (!profile && !pinTarget)
    return (
      <>
        {profiles.length > 0 ? (
          <ProfileGate
            profiles={profiles}
            onCreate={addProfile}
            remember={rememberProfile}
            onRememberChange={(value) => {
              setRememberProfile(value);
              rememberProfileRef.current = value;
              localStorage.setItem(
                "nuvio-remember-profile",
                value ? "1" : "0",
              );
            }}
            onSelect={(next) => {
              if (next.pinEnabled) {
                setPinTarget(next);
                return;
              }
              openProfile(next);
            }}
            onSignOut={async () => {
              await signOut();
              activateProfile(null);
              setSession(null);
            }}
          />
        ) : !profilesSettled ? (
          <LoadingScreen label="Loading profiles…" />
        ) : !profilesError ? (
          /* Settled and genuinely empty: a brand new account. The gate with
             no profiles in it is exactly the create screen, which is what the
             desktop client shows here too. */
          <ProfileGate
            profiles={[]}
            onCreate={addProfile}
            remember={rememberProfile}
            onRememberChange={setRememberProfile}
            onSelect={() => undefined}
            onSignOut={async () => {
              await signOut();
              activateProfile(null);
              setSession(null);
            }}
          />
        ) : (
          /* Settled with nothing to show. Which of the two it is matters:
             one is worth retrying, the other needs a profile making
             elsewhere. Neither is a spinner. */
          <div className="splash profile-empty">
            <h2>{profilesError ? "Couldn't load profiles" : "No profiles yet"}</h2>
            <p>
              {profilesError ||
                "This account has no profiles. Open Nuvio on desktop, Android or TV to create one — it will appear here."}
            </p>
            <div className="profile-empty-actions">
              <button className="primary" onClick={() => void hydrate()}>
                {profilesError ? "Try again" : "Check again"}
              </button>
              <button
                className="secondary"
                onClick={async () => {
                  await signOut();
                  activateProfile(null);
                  setSession(null);
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        )}
        {updatePrompt}
      </>
    );

  // Reached by address rather than by navigation, so it renders instead of the
  // shell rather than on top of it. Signing in still comes first: it is your
  // library being drawn from, so there is nothing to pick without one.
  if (route === "random")
    return (
      <>
        <TitleRoulette
          fullPage
          items={library}
          index={watchIndex}
          addons={addons}
          initialScope="all"
          onClose={() => go("")}
          onOpen={(item) => {
            go("");
            openDetails(item);
          }}
        />
        {updatePrompt}
      </>
    );

  return (
    <div className={`app-shell${playback ? " player-active" : ""}`}>
      <aside className="rail">
        <img src={`${import.meta.env.BASE_URL}Nuvio-icon.png`} alt="Nuvio" />
        {nav.map((item) => (
          <button
            key={item.key}
            className={active === item.key ? "active" : ""}
            title={item.label}
            onClick={() => {
              setActive(item.key);
              setCatalog(null);
              setFolder(null);
            }}
          >
            <item.icon />
          </button>
        ))}
      </aside>
      <header className="topbar">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            runSearch();
          }}
        >
          <Search />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            // Deferred by a frame so a click on the list below lands before
            // the list stops existing.
            onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
            placeholder="Search movies and series…"
          />
          <button className="search-submit" data-busy={searching || undefined}>
            {searching ? "…" : "Search"}
          </button>
          {searchFocused && !query.trim() && recentSearches.length > 0 && (
            <div className="search-history">
              <header>
                <span>Recent</span>
                <button
                  type="button"
                  onClick={() => setRecentSearches(clearRecentSearches())}
                >
                  Clear
                </button>
              </header>
              {recentSearches.map((term) => (
                <div className="search-history-row" key={term}>
                  <button type="button" onClick={() => runSearch(term)}>
                    <Search size={14} />
                    <span>{term}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Forget ${term}`}
                    onClick={() => setRecentSearches(forgetSearch(term))}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </form>
        <ProfileSwitcher
          profiles={profiles}
          active={profile}
          onSwitchProfiles={() => {
            setSwitchingProfile(true);
            activateProfile(null);
          }}
          onSelect={(next) => {
            // A locked profile is verified before it is opened. Unlocking is
            // remembered for the session only, so closing the tab re-locks it —
            // the PIN itself is never kept.
            if (next.pinEnabled) {
              setPinTarget(next);
              return;
            }
            openProfile(next);
          }}
          onSignOut={async () => {
            await signOut();
            activateProfile(null);
            setSession(null);
          }}
        />
      </header>
      {pinTarget && (
        <PinPrompt
          profile={pinTarget}
          // "Switch profiles" rather than "Cancel" when this is the only thing
          // on screen: cancelling into an empty app would be a dead end.
          cancelLabel={profile ? "Cancel" : "Switch profiles"}
          onUnlocked={() => {
            openProfile(pinTarget);
            setPinTarget(null);
          }}
          onCancel={() => {
            setPinTarget(null);
            if (!profile) setSwitchingProfile(true);
          }}
        />
      )}
      <main className="content">
        {message && (
          <div className="notice">
            <span>{message}</span>
            <button
              className="notice-dismiss"
              aria-label="Dismiss"
              onClick={() => setMessage("")}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {(loading ||
          deferredActive !== active ||
          deferredCatalog !== catalog ||
          deferredFolder !== folder) && (
          <LoadingScreen overlay />
        )}
        {deferredFolder ? (
          <CollectionFolderView
            folder={deferredFolder}
            addons={addons}
            index={watchIndex}
            tmdbApiKey={providerCredential(providerCredentials, "tmdb", "api_key")}
            onBack={() => setFolder(null)}
            onOpen={openDetails}
            onMenu={(item, x, y) => setTitleMenu({ item, x, y })}
          />
        ) : deferredCatalog ? (
          <CatalogView
            section={deferredCatalog}
            index={watchIndex}
            onBack={() => setCatalog(null)}
            onOpen={openDetails}
            onMenu={(item, x, y) => setTitleMenu({ item, x, y })}
          />
        ) : deferredActive === "home" ? (
          <HomeView
            heroItems={heroItems}
            rows={homeRows}
            continueItems={continueItems}
            continueSettings={webSettings.continueWatching}
            index={watchIndex}
            onOpen={openDetails}
            onContinue={(card) => openContinueSources(card, false)}
            onMenu={(item, x, y) => setTitleMenu({ item, x, y })}
            onContinueMenu={(card, x, y) => setContinueMenu({ card, x, y })}
            onSeeAll={setCatalog}
            onOpenFolder={setFolder}
          />
        ) : deferredActive === "discover" ? (
          <Discover
            addons={addons}
            index={watchIndex}
            query={query}
            results={results}
            resultGroups={searchGroups}
            searchPending={searching}
            onOpen={openDetails}
            onMenu={(item, x, y) => setTitleMenu({ item, x, y })}
          />
        ) : deferredActive === "library" ? (
          <LibraryView
            items={library}
            index={watchIndex}
            addons={addons}
            onOpen={openDetails}
            onMenu={(item, x, y) => setTitleMenu({ item, x, y })}
          />
        ) : deferredActive === "downloads" && platform.downloads ? (
          <Downloads
            downloads={platform.downloads}
            onPlay={(stream, meta, video) => setPlayback({ stream, meta, video })}
          />
        ) : deferredActive === "calendar" ? (
          <CalendarView
            items={library}
            addons={addons}
            enrichment={metadataEnrichment}
            scope={`${profile?.profileIndex ?? 0}:${addons.map((addon) => `${addon.enabled}:${addon.url}`).join("|")}`}
            onOpen={openDetails}
          />
        ) : deferredActive === "addons" ? (
          <AddonsPage
            onBack={() => setActive("settings")}
            addons={addons}
            rows={addonRows}
            onToggle={toggleAddon}
            onMove={moveAddon}
            onRemove={removeAddon}
            onAdd={addAddon}
            onRefresh={loadProfileData}
          />
        ) : (
          <SettingsPage
            addons={addons}
            addonRows={addonRows}
            onToggleAddon={toggleAddon}
            onMoveAddon={moveAddon}
            onRemoveAddon={removeAddon}
            onAddAddon={addAddon}
            onRefreshAddons={loadProfileData}
            session={session}
            profile={profile}
            settings={webSettings}
            settingsReady={settingsBlob != null}
            homeLayout={homeLayout}
            homeLayoutLabels={homeLayoutLabels}
            pinnedCollectionKeys={pinnedCollectionKeys}
            onHomeLayout={saveHomeLayout}
            addonNames={addonNames}
            defaultSourceAddon={defaultSourceAddon}
            onDefaultSourceAddon={(next) => {
              setDefaultSourceAddon(next);
              if (next) localStorage.setItem("nuvio-web-default-source-addon", next);
              else localStorage.removeItem("nuvio-web-default-source-addon");
            }}
            heroEnabled={heroEnabled}
            onHeroEnabled={(next) => {
              setHeroEnabled(next);
              localStorage.setItem("nuvio-web-home-hero", next ? "on" : "off");
            }}
            onTypedSetting={updateTypedSetting}
            onPosterSetting={updatePosterSetting}
            onContinueWatchingSetting={updateContinueWatchingSetting}
            onMetaScreenSetting={updateMetaScreenSetting}
            onMetaScreenSection={updateMetaScreenSection}
            onMoveMetaScreenSection={moveDetailSection}
            onRawSetting={updateRawSetting}
            providerCredentials={providerCredentials}
            credentialsReady={credentialsReady}
            onProviderCredential={saveProviderCredential}
            externalPlayer={externalPlayer}
            onExternalPlayer={(mode) => {
              setExternalPlayer(mode);
              localStorage.setItem("nuvio-web-external-player", mode);
            }}
            onSignOut={async () => {
              await signOut();
              activateProfile(null);
              setSession(null);
            }}
          />
        )}
      </main>
      {updatePrompt}
      <nav
        className="bottom-nav"
        style={
          {
            "--nav-index": Math.max(
              0,
              nav.findIndex((item) => item.key === active),
            ),
            "--nav-count": nav.length,
          } as CSSProperties
        }
      >
        {nav.map((item) => (
          <button
            key={item.key}
            className={active === item.key ? "active" : ""}
            aria-current={active === item.key ? "page" : undefined}
            onClick={() => {
              setActive(item.key);
              setCatalog(null);
              setFolder(null);
            }}
          >
            <item.icon />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      {externalWatch && (
        <ExternalWatchPrompt
          meta={externalWatch.meta}
          video={externalWatch.video}
          /* Answered here, so there is nothing left to resume on a later open. */
          onDismiss={() => {
            clearExternalHandoff();
            setExternalWatch(null);
          }}
          onFinished={() => {
            const current = externalWatch;
            clearExternalHandoff();
            setExternalWatch(null);
            void toggleWatched(current.meta, current.video, true);
          }}
          onStopped={(positionMs, durationMs) => {
            const current = externalWatch;
            clearExternalHandoff();
            setExternalWatch(null);
            savePlaybackProgress(current, positionMs, durationMs, false);
            setMessage("Saved your position.");
          }}
        />
      )}
      {playback && (
        /* An overlay rather than an early return: unmounting the shell to show
           the player threw away the resolved detail page, so closing it
           rebuilt home from scratch and only then re-opened details. */
        <Player
          {...playback}
          settings={webSettings.player}
          startPositionMs={
            playback.startAtBeginning
              ? 0
              : resumePositionMs(playback.meta, playback.video)
          }
          episodes={playback.meta.videos}
          watchIndex={watchIndex}
          onPlayEpisode={(next) => {
            // The same source, not a fresh choice. A binge group names a
            // release that serves a whole run, so continuing within it keeps
            // the quality, the audio and the host already chosen.
            const bingeGroup = playback.stream.behaviorHints?.bingeGroup;
            const current = playback;
            // Resolving takes seconds. A second request started meanwhile must
            // not be able to land after this one and pull playback back to an
            // episode already left behind.
            const generation = ++episodeSwitch.current;
            setMessage("");
            void loadStreams(current.meta.type, next.id, addons)
              .then((streams) => {
                if (generation !== episodeSwitch.current) return;
                const orderedStreams = platform.debrid
                  ? applyDebridStreamSettings(streams, debridRules)
                  : streams;
                const chosen = pickBingeStream(orderedStreams, bingeGroup);
                if (!chosen) {
                  setMessage(
                    "No playable source was found for that episode. Open it from the title page to choose one.",
                  );
                  return;
                }
                rememberBingeGroup(
                  current.meta.id,
                  chosen.behaviorHints?.bingeGroup,
                );
                setPlayback({
                  stream: chosen,
                  meta: current.meta,
                  video: next,
                  startAtBeginning: true,
                });
              })
              .catch(() => {
                if (generation !== episodeSwitch.current) return;
                setMessage("That episode's sources could not be loaded.");
              });
          }}
          onClose={() => {
            // A pending episode lookup must not reopen playback after Back.
            episodeSwitch.current += 1;
            setLoading(false);
            setPlayback(null);
          }}
          onExternalPlay={(mode, url, positionMs) => {
            // The web player is torn down first. Leaving it mounted keeps it
            // decoding and downloading behind the app that is now playing the
            // same stream, and closing it is what raises the prompt that can
            // record where you stopped.
            const current = playback;
            setPlayback(null);
            handOffToExternalPlayer(
              mode,
              url,
              current.meta,
              current.video,
              positionMs,
            );
          }}
          onProgress={(positionMs, durationMs, ended) =>
            savePlaybackProgress(playback, positionMs, durationMs, ended)
          }
          onNativeProgressSnapshot={(positionMs, durationMs, ended) =>
            reflectNativePlaybackProgress(
              playback,
              positionMs,
              durationMs,
              ended,
            )
          }
        />
      )}
      {titleMenu && (() => {
        const present = library.some(
          (item) => item.id === titleMenu.item.id && item.type === titleMenu.item.type,
        );
        const watched = watchIndex.watched.has(watchKey(titleMenu.item.id));
        return (
          <ContextMenu
            x={titleMenu.x}
            y={titleMenu.y}
            onClose={() => setTitleMenu(null)}
            items={[
              { label: "View details", icon: <Info size={18} />, onSelect: () => openDetails(titleMenu.item) },
              {
                label: present ? "Remove from library" : "Add to library",
                icon: present ? <Trash2 size={18} /> : <Plus size={18} />,
                onSelect: () => void toggleLibrary(titleMenu.item),
              },
              {
                label: watched ? "Mark as unwatched" : "Mark as watched",
                icon: watched ? <EyeOff size={18} /> : <Eye size={18} />,
                onSelect: () => void toggleWatched(titleMenu.item, undefined, !watched),
              },
            ]}
          />
        );
      })()}
      {continueMenu && (
        <ContextMenu
          x={continueMenu.x}
          y={continueMenu.y}
          onClose={() => setContinueMenu(null)}
          items={[
            {
              label: "Go to details",
              icon: <Info size={18} />,
              onSelect: () => openDetails(continueMenu.card.video
                ? { ...continueMenu.card.item, selectedVideoId: continueMenu.card.video.id }
                : continueMenu.card.item),
            },
            { label: "Play manually", icon: <Play size={18} />, onSelect: () => openContinueSources(continueMenu.card, false) },
            { label: "Start from beginning", icon: <RotateCcw size={18} />, onSelect: () => openContinueSources(continueMenu.card, true) },
            { label: "Remove", icon: <Trash2 size={18} />, danger: true, onSelect: () => dismissContinueCard(continueMenu.card) },
          ]}
        />
      )}
      {selected && (
        <Details
          /*
           * A new title is a new page, not the old one with different data.
           *
           * Opening a credit from an actor's page swaps `selected` while this
           * stays mounted — the only route that does — so React reused the
           * instance and everything in it carried across: the cast row stayed
           * scrolled where the previous title left it, and so did the rest of
           * the view's state. Keying by the title remounts instead.
           */
          key={`${selected.type}:${selected.id}`}
          seed={selected}
          addons={addons}
          metadataEnrichment={metadataEnrichment}
          playerSettings={webSettings.player}
          streamBadgeSettings={webSettings.streamBadges}
          debridRules={debridRules}
          metaScreenSettings={webSettings.metaScreen}
          watchIndex={watchIndex}
          initialVideoId={detailLaunch?.videoId}
          initialVideo={detailLaunch?.video}
          openSourcesOnLoad={detailLaunch?.openSources}
          onSetWatched={toggleWatched}
          onResetProgress={resetProgress}
          inLibrary={library.some(
            (item) => item.id === selected.id && item.type === selected.type,
          )}
          onClose={() => {
            setSelected(null);
            setDetailLaunch(null);
          }}
          onLibrary={toggleLibrary}
          defaultSourceAddon={defaultSourceAddon}
          defaultPlayer={externalPlayer}
          onDefaultPlayer={(mode) => {
            localStorage.setItem("nuvio-web-external-player", mode);
            setExternalPlayer(mode);
          }}
          // Absent without TMDB, which is where person ids and the filmography
          // both come from — so the cast cards stay unclickable rather than
          // opening a page that could only apologise.
          onPerson={
            metadataEnrichment.tmdb.enabled && metadataEnrichment.tmdb.apiKey
              ? setPerson
              : undefined
          }
          onPlay={(stream, meta, video, player) => {
            // The picker in the sources panel wins for this launch only.
            const chosen = player ?? externalPlayer;
            const url = stream.url || stream.externalUrl;
            if (chosen !== "internal" && url) {
              // Details stays open: the stream opened elsewhere, so this page
              // is exactly where you want to be when you come back.
              handOffToExternalPlayer(chosen, url, meta, video);
              return;
            }
            rememberBingeGroup(meta.id, stream.behaviorHints?.bingeGroup);
            setPlayback({
              stream,
              meta,
              video,
              startAtBeginning: detailLaunch?.startAtBeginning,
            });
          }}
        />
      )}
      {person && (
          <PersonPage
            seed={person}
            index={watchIndex}
            config={metadataEnrichment.tmdb}
            onBack={() => setPerson(null)}
            onOpen={(item) => {
              // Opening a credit leaves the person behind rather than stacking
              // another layer on top: two overlays deep, "back" stops meaning
              // anything you can predict.
              setPerson(null);
              setSelected(item);
              setDetailLaunch(null);
            }}
          />
      )}
    </div>
  );
}

/**
 * Home renders its rows progressively for the same reason the grids do: a
 * dozen catalog rows of twenty posters each is several hundred cards, and
 * committing them all at once is what delayed the tab switch.
 */
type HomeRow =
  | { key: string; kind: "catalog"; section: CatalogSection }
  | { key: string; kind: "collection"; collection: Collection };

/**
 * Home renders progressively: each row is ~24 poster cards, so committing them
 * all at once is what delayed the tab switch.
 */
function HomeView({
  heroItems,
  rows,
  continueItems,
  continueSettings,
  index,
  onOpen,
  onContinue,
  onSeeAll,
  onOpenFolder,
  onMenu,
  onContinueMenu,
}: {
  heroItems: Meta[];
  rows: HomeRow[];
  continueItems: ReturnType<typeof buildContinueWatching>;
  continueSettings: ContinueWatchingSettings;
  index: WatchIndex;
  onOpen(item: Meta): void;
  /** Separate from `onOpen`: a poster opens a page, this one resumes. */
  onContinue(card: ContinueCard): void;
  onSeeAll(section: CatalogSection): void;
  onOpenFolder(folder: CollectionFolder): void;
  onMenu(item: Meta, x: number, y: number): void;
  onContinueMenu(card: ContinueCard, x: number, y: number): void;
}) {
  const { visible } = useProgressiveList(rows, {
    resetKey: "home",
    first: 3,
    chunk: 2,
  });
  return (
    <>
      <Hero items={heroItems} onOpen={onOpen} onMenu={onMenu} />
      {continueItems.length > 0 && (
        <ContinueWatching
          cards={continueItems}
          settings={continueSettings}
          onOpen={onContinue}
          onMenu={onContinueMenu}
        />
      )}
      {visible.map((row) =>
        row.kind === "collection" ? (
          <CollectionRow
            key={row.key}
            collection={row.collection}
            onOpenFolder={onOpenFolder}
          />
        ) : (
          <MediaRow
            key={row.key}
            section={row.section}
            index={index}
            onOpen={onOpen}
            onMenu={onMenu}
            onSeeAll={() => onSeeAll(row.section)}
          />
        ),
      )}
    </>
  );
}

function LibraryView({
  items,
  index,
  addons,
  onOpen,
  onMenu,
}: {
  items: LibraryItem[];
  index: WatchIndex;
  addons: InstalledAddon[];
  onOpen(item: Meta): void;
  onMenu(item: Meta, x: number, y: number): void;
}) {
  const [tab, setTab] = useState<"all" | "movie" | "series">("all");
  // Opening the picker and rolling are separate now: the modal appears first
  // so the scope can be chosen, and rolls happen inside it.
  const [randomOpen, setRandomOpen] = useState(false);
  const counts = useMemo(() => {
    let movie = 0;
    let series = 0;
    for (const item of items) {
      if (item.type === "series") series += 1;
      else if (item.type === "movie") movie += 1;
    }
    return { all: items.length, movie, series };
  }, [items]);
  const filtered = useMemo(
    () => (tab === "all" ? items : items.filter((item) => item.type === tab)),
    [items, tab],
  );
  const { visible } = useProgressiveList(filtered, { resetKey: tab });
  const tabs = [
    { key: "all", label: "All", count: counts.all },
    { key: "movie", label: "Movies", count: counts.movie },
    { key: "series", label: "Series", count: counts.series },
  ] as const;


  return (
    <section className="grid-page">
      <span className="eyebrow">NUVIO WEB</span>
      <h1>Your library</h1>
      <p>{counts.all} synced titles</p>
      <div className="library-toolbar">
        <div className="segmented">
          {tabs.map((item) => (
            <button
              key={item.key}
              className={tab === item.key ? "active" : undefined}
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              <i>{item.count}</i>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="library-random-button"
          disabled={!items.length}
          onClick={() => setRandomOpen(true)}
        >
          <Dices aria-hidden="true" />
          Random pick
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state">
          <strong>Nothing here yet</strong>
          <span>
            {tab === "all"
              ? "Titles you add to your Nuvio library will appear here."
              : `No ${tab === "movie" ? "movies" : "series"} in your library.`}
          </span>
        </div>
      ) : (
        <div className="poster-grid">
          {visible.map((item) => (
            <PosterCard
              key={`${item.type}:${item.id}`}
              item={item}
              index={index}
              onOpen={onOpen}
              onMenu={onMenu}
            />
          ))}
        </div>
      )}
      {randomOpen && (
        <TitleRoulette
          items={items}
          index={index}
          addons={addons}
          initialScope={tab}
          onClose={() => setRandomOpen(false)}
          onOpen={(item) => {
            setRandomOpen(false);
            onOpen(item);
          }}
        />
      )}
    </section>
  );
}

/**
 * How long a roll takes, and the range the slider offers.
 *
 * A setting rather than a constant because the right length is a matter of
 * taste: long enough to build tension for one person is dead air for another.
 */
const ROLL_MS_DEFAULT = 5000;
const ROLL_MS_MIN = 2000;
const ROLL_MS_MAX = 15000;
/** Cards on the strip. The winner sits far enough in to earn the deceleration. */
const REEL_LENGTH = 44;
const WINNER_AT = 36;

/**
 * Quartic ease-out: fast off the line, and a long crawl into the result.
 *
 * The tick sound is driven off the same curve rather than a timer, so the
 * slowing is the animation's own — the clicks cannot drift out of step with
 * the cards because they are caused by them.
 */
const easeOut = (t: number) => 1 - (1 - t) ** 4;

/** A short click, synthesised so nothing has to be shipped or fetched. */
function tick(context: AudioContext) {
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(1180, now);
  // Exponential ramps because gain is heard logarithmically; a linear one
  // sounds like a thud rather than a click.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.06, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.05);
}

/**
 * The sound of landing on something.
 *
 * A struck chord rather than a single tone: three notes a beat apart so it
 * arrives rather than beeps, over a low body that drops away quickly. The
 * spread is what makes it feel like a reward — struck together it is a doorbell,
 * struck in sequence it is an announcement.
 *
 * Synthesised for the same reason the tick is: no file to ship, nothing to
 * fetch, and it works offline in a shell that cannot reach an audio host.
 */
function fanfare(context: AudioContext) {
  const now = context.currentTime;
  const master = context.createGain();
  master.gain.setValueAtTime(0.9, now);
  master.connect(context.destination);

  // C, G, C — an open fifth and its octave, which reads as bright and settled
  // rather than happy or sad. A major third would sound like a jingle.
  const notes: Array<[number, number, number]> = [
    [523.25, 0, 0.16],
    [783.99, 0.055, 0.13],
    [1046.5, 0.11, 0.1],
  ];
  for (const [frequency, delay, level] of notes) {
    const at = now + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.012);
    // Long tail: the ring is most of the character, and cutting it short makes
    // the whole thing sound cheap.
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.05);
    oscillator.connect(gain).connect(master);
    oscillator.start(at);
    oscillator.stop(at + 1.1);
  }

  // The thump underneath, pitched down as it fades so it lands rather than
  // hums. Without it the chord tinkles and nothing feels like it arrived.
  const body = context.createOscillator();
  const bodyGain = context.createGain();
  body.type = "sine";
  body.frequency.setValueAtTime(146, now);
  body.frequency.exponentialRampToValueAtTime(92, now + 0.3);
  bodyGain.gain.setValueAtTime(0.0001, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.22, now + 0.015);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
  body.connect(bodyGain).connect(master);
  body.start(now);
  body.stop(now + 0.55);
}

type RandomScope = "all" | "movie" | "series";

/**
 * Whether a title has been seen, as far as the index can cheaply answer.
 *
 * A movie is watched when it is marked so or its resume point ran to the end.
 * A series only counts on the title-level mark: episode-by-episode completeness
 * is a different question, and a show being half-watched is exactly the sort of
 * thing someone rolling for something to watch still wants offered.
 */
function isSeen(item: Meta, index: WatchIndex) {
  const key = watchKey(item.id);
  if (index.watched.has(key)) return true;
  const row = index.byContent.get(item.id);
  return !!row && row.durationMs > 0 && row.positionMs / row.durationMs >= 0.9;
}

/**
 * Picks something to watch, the way a case opens.
 *
 * The scope and the watched toggle live in here rather than outside because a
 * roll you did not like is usually a roll with the wrong scope — reaching the
 * controls should not mean closing what you are looking at.
 */
export function TitleRoulette({
  items,
  index,
  addons,
  initialScope,
  showScope = true,
  heading,
  controls,
  fullPage,
  onClose,
  onOpen,
}: {
  items: Meta[];
  index: WatchIndex;
  /** Used to fetch a description the row was stored without. */
  addons: InstalledAddon[];
  initialScope?: RandomScope;
  /**
   * Whether the All/Movies/Series control belongs here. In the library it does;
   * on Discover the catalog and genre have already decided what the pool is,
   * and offering a second filter over the top would be asking the same question
   * twice in two different places.
   */
  showScope?: boolean;
  /** What is being rolled, where it is not the whole library. */
  heading?: string;
  /** Shown in place of the scope control: the filters that decide the pool. */
  controls?: ReactNode;
  /** Standing on its own at /random rather than sitting over a page. */
  fullPage?: boolean;
  onClose(): void;
  onOpen(item: Meta): void;
}) {
  // Opened from a tab, so it starts on that tab's scope — the roll you meant
  // is almost always the one for the shelf you were looking at.
  const [scope, setScope] = useState<RandomScope>(initialScope ?? "all");
  // Remembered like the rest: someone who rolls for something new wants that
  // every time, not once per visit.
  const [includeWatched, setIncludeWatched] = useState(
    () => localStorage.getItem("nuvio-web-roulette-watched") !== "false",
  );
  useEffect(() => {
    localStorage.setItem("nuvio-web-roulette-watched", String(includeWatched));
  }, [includeWatched]);
  const [muted, setMuted] = useState(
    () => localStorage.getItem("nuvio-web-roulette-muted") === "true",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rollMs, setRollMs] = useState(() => {
    const saved = Number(localStorage.getItem("nuvio-web-roulette-ms"));
    return Number.isFinite(saved) && saved >= ROLL_MS_MIN && saved <= ROLL_MS_MAX
      ? saved
      : ROLL_MS_DEFAULT;
  });
  useEffect(() => {
    localStorage.setItem("nuvio-web-roulette-ms", String(rollMs));
  }, [rollMs]);
  // Read through a ref for the same reason as the sound: as a dependency it
  // would restart the roll the moment the slider moved.
  const rollMsRef = useRef(rollMs);
  rollMsRef.current = rollMs;
  const [roll, setRoll] = useState<{
    id: number;
    reel: LibraryItem[];
    winner: LibraryItem;
  } | null>(null);
  const [spinning, setSpinning] = useState(false);
  /**
   * The reveal, a beat after the strip stops.
   *
   * The order matters and was wrong: the card arrived first and the reel blurred
   * underneath it afterwards, which is the scene changing around something
   * already standing in it. The blur and the frame open the moment the strip
   * stops — that is the `finished` class — and the card walks in after.
   */
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!roll || spinning) {
      setRevealed(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setRevealed(true);
      // With the card, not with the landing: the sound is for what you got,
      // and the ticking has only just stopped when the strip settles.
      if (audio.current && !mutedRef.current) fanfare(audio.current);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [roll, spinning]);

  const viewport = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const settingsAnchor = useRef<HTMLDivElement | null>(null);
  /** Whether this context has been woken by playing inside a gesture. */
  const unlocked = useRef(false);
  // Read by the animation loop through a ref: as a dependency it would restart
  // the roll from the beginning every time the sound was toggled.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // A finished reel shows the last pick, which stops being an answer to the
  // question the moment the scope changes. Dropping back to the idle state
  // shows the new pool size instead of a stale winner.
  useEffect(() => {
    setRoll(null);
    setSpinning(false);
  }, [scope, includeWatched, items]);

  const pool = useMemo(
    () =>
      items.filter(
        (item) =>
          (!showScope || scope === "all" || item.type === scope) &&
          (includeWatched || !isSeen(item, index)),
      ),
    [items, index, scope, includeWatched, showScope],
  );

  const startRoll = useCallback(() => {
    if (!pool.length) return;
    const pick = () => pool[Math.floor(Math.random() * pool.length)];
    const winner = pick();
    const reel = Array.from({ length: REEL_LENGTH }, pick);
    reel[WINNER_AT] = winner;
    // Created on the click, because a browser will not let a page make noise
    // before someone has asked it to.
    if (!muted && !audio.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) audio.current = new Ctor();
    }
    void audio.current?.resume?.();
    // iOS needs more than a context made during a gesture: it stays suspended
    // until something is actually played inside one. A single silent sample is
    // the accepted way to unlock it, and it has to happen synchronously here —
    // by the time the reel is moving, the gesture is over and every later tick
    // is scheduled into a context that never woke up.
    if (audio.current && !unlocked.current) {
      unlocked.current = true;
      const silence = audio.current.createBufferSource();
      silence.buffer = audio.current.createBuffer(1, 1, 22050);
      silence.connect(audio.current.destination);
      silence.start(0);
    }
    setRoll({ id: Date.now(), reel, winner });
    setSpinning(true);
  }, [pool, muted]);

  useEffect(() => {
    localStorage.setItem("nuvio-web-roulette-muted", String(muted));
  }, [muted]);

  /**
   * A description for the winner, where the library row has none.
   *
   * Library rows carry whatever was stored when the title was added, and older
   * ones were stored without one. Asking the addons is the same resolve the
   * details page does, so the answer matches what you would see there — and it
   * is fetched only for the one title that won, once it has won.
   */
  const [resolved, setResolved] = useState<Record<string, string>>({});
  useEffect(() => {
    const winner = roll?.winner;
    if (!winner || spinning || winner.description || resolved[winner.id]) return;
    let live = true;
    resolveMeta(winner, addons)
      .then((meta) => {
        if (live && meta.description)
          setResolved((current) => ({ ...current, [winner.id]: meta.description! }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [roll, spinning, addons, resolved]);

  // Drives the strip frame by frame rather than handing it to a CSS
  // transition, because the ticks have to know which card is under the marker
  // and a transition will not say.
  useEffect(() => {
    if (!roll) return;
    const strip = track.current;
    const frame = viewport.current;
    const target = strip?.children.item(WINNER_AT) as HTMLElement | null;
    if (!strip || !frame || !target) return;

    const destination =
      frame.clientWidth / 2 - (target.offsetLeft + target.offsetWidth / 2);
    const first = strip.children.item(0) as HTMLElement | null;
    const second = strip.children.item(1) as HTMLElement | null;
    const measured =
      first && second ? second.offsetLeft - first.offsetLeft : 0;
    // Falling back to the card's own width keeps the ticks coming if the strip
    // is measured before layout settles; a pitch of zero would silence them.
    const pitch = measured > 0 ? measured : target.offsetWidth || 124;

    // The slider governs, including under reduced motion. This is motion asked
    // for by pressing Roll and asked for again by setting a length; second-
    // guessing an explicit choice is what made it look broken before.
    const duration = rollMsRef.current;

    let frameId = 0;
    let lastCard = -1;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - started) / duration, 1);
      const offset = destination * easeOut(t);
      strip.style.transform = `translate3d(${offset}px, 0, 0)`;
      const card = Math.round((frame.clientWidth / 2 - offset) / pitch);
      if (card !== lastCard) {
        lastCard = card;
        if (audio.current && !mutedRef.current) tick(audio.current);
      }
      if (t < 1) frameId = window.requestAnimationFrame(step);
      else setSpinning(false);
    };
    frameId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frameId);
  }, [roll]);

  // A menu closes when you click away from it; without this the only way out
  // is the gear itself, which is not where anyone reaches next.
  useEffect(() => {
    if (!settingsOpen) return;
    const away = (event: MouseEvent) => {
      if (!settingsAnchor.current?.contains(event.target as Node))
        setSettingsOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [settingsOpen]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      // Escape dismisses the menu before the dialog under it.
      if (event.key !== "Escape") return;
      if (settingsOpen) setSettingsOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, settingsOpen]);

  useEffect(() => () => void audio.current?.close(), []);

  const scopes = [
    { key: "all", label: "All" },
    { key: "movie", label: "Movies" },
    { key: "series", label: "Series" },
  ] as const;
  const winner = spinning ? null : roll?.winner;

  return (
    <div
      className={`library-roulette-backdrop${fullPage ? " full-page" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        // A backdrop click dismisses an overlay; on its own page there is
        // nothing behind it to return to, so it does not.
        if (!fullPage && event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className={`library-roulette${spinning ? " spinning" : ""}${
          roll && !spinning ? " finished" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-roulette-title"
      >
        <header>
          <div>
            <small>RANDOM PICK</small>
            <h2 id="library-roulette-title">{heading ?? "What should I watch?"}</h2>
          </div>
          <button
            className="circle-button"
            type="button"
            aria-label={fullPage ? "Go home" : "Close"}
            title={fullPage ? "Go home" : "Close"}
            onClick={onClose}
          >
            {/* On its own page this leaves for home, not the library — the
                label said otherwise and the icon agreed with the label. */}
            {fullPage ? <Home /> : <X />}
          </button>
        </header>

        {/* Left reachable mid-roll on purpose: changing scope is what you want
            after a pick you did not like, and it should not cost a round trip
            through closing the dialog. */}
        <div className="library-roulette-setup">
          {controls}
          {showScope && (
          <div className="segmented">
            {scopes.map((option) => (
              <button
                key={option.key}
                type="button"
                disabled={spinning}
                className={scope === option.key ? "active" : undefined}
                aria-pressed={scope === option.key}
                onClick={() => setScope(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          )}
          {/* Anchored to the gear rather than laid out in the row: these are
              set once and left, and a panel that pushes the reel down every
              time it opens makes the dialog jump for no reason. */}
          <div className="library-roulette-settings-anchor" ref={settingsAnchor}>
            <button
              type="button"
              className="library-roulette-mute"
              aria-expanded={settingsOpen}
              aria-label="Roll settings"
              title="Roll settings"
              onClick={() => setSettingsOpen((value) => !value)}
            >
              <Settings />
            </button>
            {settingsOpen && (
              <div className="library-roulette-settings" role="menu">
                <label className="library-roulette-toggle">
                  <span>
                    Include watched
                    <Eye />
                  </span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={includeWatched}
                      disabled={spinning}
                      onChange={(event) => setIncludeWatched(event.target.checked)}
                    />
                    <i />
                  </span>
                </label>
                <label className="library-roulette-toggle">
                  <span>
                    Sound
                    {muted ? <VolumeX /> : <Volume2 />}
                  </span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={!muted}
                      onChange={(event) => setMuted(!event.target.checked)}
                    />
                    <i />
                      </span>
                    </label>
                <label>
                  <span>
                    Roll length
                    <small>{(rollMs / 1000).toFixed(2)}s</small>
                  </span>
                  <input
                    type="range"
                    min={ROLL_MS_MIN}
                    max={ROLL_MS_MAX}
                    step={250}
                    value={rollMs}
                    onChange={(event) => setRollMs(Number(event.target.value))}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="library-roulette-frame" ref={viewport}>
          <i className="library-roulette-marker" aria-hidden="true" />
          {roll ? (
            <div className="library-roulette-track" ref={track} key={roll.id}>
              {roll.reel.map((item, position) => (
                <figure key={`${item.id}:${position}`}>
                  {item.poster ? (
                    <img src={item.poster} alt="" loading="eager" />
                  ) : (
                    <div className="library-roulette-placeholder">
                      {item.name.slice(0, 1)}
                    </div>
                  )}
                </figure>
              ))}
            </div>
          ) : (
            <div className="library-roulette-idle">
              {pool.length
                ? `${pool.length} title${pool.length === 1 ? "" : "s"} in the running`
                : "Nothing matches those filters"}
            </div>
          )}
          {/* Laid over the reel rather than replacing it: the strip stays
              behind, blurred, so the result is clearly the thing that was
              just landed on and not a different screen. */}
          {revealed && roll && (
            <div className="library-roulette-reveal">
              <figure>
                {roll.winner.poster ? (
                  <img src={roll.winner.poster} alt="" />
                ) : (
                  <div className="library-roulette-placeholder">
                    {roll.winner.name.slice(0, 1)}
                  </div>
                )}
              </figure>
              <div>
                <small>
                  {roll.winner.type === "series" ? "Series" : "Movie"}
                  {roll.winner.releaseInfo ? ` · ${roll.winner.releaseInfo}` : ""}
                </small>
                <strong>{roll.winner.name}</strong>
                {(roll.winner.description || resolved[roll.winner.id]) && (
                  <p>{roll.winner.description || resolved[roll.winner.id]}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="library-roulette-result" aria-live="polite">
          {winner ? (
            <>
              <div>
                <small>{winner.type === "series" ? "Series" : "Movie"}</small>
                <strong>{winner.name}</strong>
              </div>
              <div className="library-roulette-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={startRoll}
                >
                  <Dices /> Roll
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => onOpen(winner)}
                >
                  View details <ChevronRight />
                </button>
              </div>
            </>
          ) : (
            <>
              <span>
                {spinning
                  ? "Rolling…"
                  : pool.length
                    ? "Pick a scope, then roll."
                    : "Try including watched titles, or a wider scope."}
              </span>
              <div className="library-roulette-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={spinning || !pool.length}
                  onClick={startRoll}
                >
                  <Dices /> Roll
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function CatalogView({
  section,
  index,
  onBack,
  onOpen,
  onMenu,
}: {
  section: CatalogSection;
  index: WatchIndex;
  onBack(): void;
  onOpen(item: Meta): void;
  onMenu(item: Meta, x: number, y: number): void;
}) {
  const [items, setItems] = useState<Meta[]>(section.items);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState("");
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setItems(section.items);
    setExhausted(false);
    setError("");
  }, [section]);

  const more = useCallback(async () => {
    if (loadingMore || exhausted) return;
    setLoadingMore(true);
    try {
      const next = await loadCatalog(section, items.length);
      // Addons that ignore `skip` return the same page forever, so anything
      // that adds no new ids ends the run rather than looping.
      const known = new Set(items.map((item) => `${item.type}:${item.id}`));
      const additions = next.filter(
        (item) => !known.has(`${item.type}:${item.id}`),
      );
      if (additions.length === 0) setExhausted(true);
      else setItems((current) => [...current, ...additions]);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load more",
      );
      setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }, [exhausted, items, loadingMore, section]);

  // Infinite scroll rather than a button: the sentinel sits below the grid and
  // fetches the next page as it comes into view.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || exhausted) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) more();
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, exhausted]);

  const { visible } = useProgressiveList(items, { resetKey: section.key });
  return (
    <section className="grid-page">
      <div className="page-head">
        <button
          className="circle-button"
          aria-label="Back"
          title="Back"
          onClick={onBack}
        >
          <ArrowLeft />
        </button>
        <div>
          <span className="eyebrow">{section.addonName}</span>
          <h1>{section.name}</h1>
          <p>
            {section.type === "series" ? "Series" : "Movies"} · {items.length}{" "}
            titles
          </p>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="poster-grid">
        {visible.map((item) => (
          <PosterCard
            key={`${item.type}:${item.id}`}
            item={item}
            index={index}
            onOpen={onOpen}
            onMenu={onMenu}
          />
        ))}
      </div>
      {!exhausted && <div ref={sentinel} className="grid-sentinel" />}
      {loadingMore && (
        <div className="grid-more" role="status">
          <i className="mini-spinner" />
          Loading more…
        </div>
      )}
    </section>
  );
}

function AddonsPage({
  addons,
  rows,
  onBack,
  onToggle,
  onMove,
  onRemove,
  onAdd,
  onRefresh,
}: {
  addons: InstalledAddon[];
  rows: AddonRow[];
  onBack(): void;
  onToggle(index: number): void;
  onMove(index: number, direction: -1 | 1): void;
  onRemove(index: number): void;
  onAdd(url: string): Promise<void>;
  onRefresh(): void;
}) {
  return (
    <section className="settings-page">
      <div className="page-head">
        <button
          className="circle-button"
          aria-label="Back to settings"
          title="Back to settings"
          onClick={onBack}
        >
          <ArrowLeft />
        </button>
        <div>
          <span className="eyebrow">CONTENT</span>
          <h1>Addons</h1>
          <p>
            These are synced with the selected Nuvio profile. Catalog requests
            go straight from this device to each addon.
          </p>
        </div>
      </div>
      <AddonSettings
        addons={addons}
        rows={rows}
        onToggle={onToggle}
        onMove={onMove}
        onRemove={onRemove}
        onAdd={onAdd}
        onRefresh={onRefresh}
      />
    </section>
  );
}

function AddonSettings({
  addons,
  rows,
  onToggle,
  onMove,
  onRemove,
  onAdd,
  onRefresh,
}: Omit<Parameters<typeof AddonsPage>[0], "onBack">) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <form
        className="addon-install"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            await onAdd(url);
            setUrl("");
          } catch (reason) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not install addon",
            );
          }
        }}
      >
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://addon.example/manifest.json"
        />
        <button className="primary">Install</button>
      </form>
      {error && <div className="notice error">{error}</div>}
      <div className="addon-list-heading">
        <h2>Installed addons</h2>
        <button className="secondary" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <div className="addon-card-list">
        {addons.map((addon, index) => {
          const label = addon.manifest?.name || addon.name || "Unavailable addon";
          const enabled = rows[index]?.enabled ?? false;
          // A manifest lists resources either as bare names or as objects.
          const resources = (addon.manifest?.resources ?? []).map((resource) =>
            typeof resource === "string" ? resource : resource.name,
          );
          const types = addon.manifest?.types ?? [];
          const configurable =
            addon.manifest?.behaviorHints?.configurable ||
            addon.manifest?.behaviorHints?.configurationRequired;
          return (
            <article
              className={enabled ? "addon-card" : "addon-card is-disabled"}
              key={`${addon.url}:${index}`}
            >
              <header className="addon-card-head">
                {addon.manifest?.logo ? (
                  <img src={addon.manifest.logo} alt="" />
                ) : (
                  <span className="addon-card-icon">
                    <Puzzle />
                  </span>
                )}
                <div>
                  <strong>{label}</strong>
                  <small>
                    {addon.manifest?.version
                      ? `Version ${addon.manifest.version}`
                      : "Unknown version"}
                  </small>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    aria-label={`Enable ${label}`}
                    checked={enabled}
                    onChange={() => onToggle(index)}
                  />
                  <i />
                </label>
              </header>
              <div className="addon-card-actions">
                <button className="addon-action reorder-action" title="Move up" aria-label="Move addon up" disabled={index === 0} onClick={() => onMove(index, -1)}><ArrowUp /></button>
                <button className="addon-action reorder-action" title="Move down" aria-label="Move addon down" disabled={index === rows.length - 1} onClick={() => onMove(index, 1)}><ArrowDown /></button>
                <button className="addon-action refresh-icon" title="Refresh addon" aria-label={`Refresh ${label}`} onClick={onRefresh}><RefreshCw /></button>
                {configurable && (
                  <button
                    className="addon-action"
                    title="Configure addon"
                    aria-label={`Configure ${label}`}
                    onClick={() => window.open(addonConfigureUrl(addon.url), "_blank", "noopener,noreferrer")}
                  >
                    <Settings />
                  </button>
                )}
                <button className="addon-action danger-icon" title="Remove" aria-label={`Remove ${label}`} onClick={() => {
                  if (window.confirm(`Remove ${label}? Its catalogs and streams will stop appearing.`))
                    onRemove(index);
                }}><Trash2 /></button>
              </div>
              <div className="addon-card-badges">
                <em>{enabled ? "Active" : "Disabled"}</em>
                <em>{resources.length} resource{resources.length === 1 ? "" : "s"}</em>
                <em>{addon.manifest?.catalogs?.length ?? 0} catalog{(addon.manifest?.catalogs?.length ?? 0) === 1 ? "" : "s"}</em>
                {configurable && <em>Configurable</em>}
                {addon.error && <em className="bad">Unreachable</em>}
              </div>
              {/* The description says what the addon is for; the URL said only
                  where it lives, which is not what you pick an addon by. */}
              {addon.manifest?.description && (
                <p className="addon-card-description">{addon.manifest.description}</p>
              )}
              {(types.length > 0 || resources.length > 0) && (
                <small className="addon-card-meta">
                  {types.map((type) => type.charAt(0).toUpperCase() + type.slice(1)).join(" / ")}
                  {types.length > 0 && resources.length > 0 ? " • " : ""}
                  {resources.join(", ")}
                </small>
              )}
              {addon.error && <p className="addon-card-error">{addon.error}</p>}
            </article>
          );
        })}
      </div>
    </>
  );
}
/**
 * Manual update check. The worker only polls on its own schedule, which can be
 * hours; this asks immediately. A found update raises the usual reload prompt
 * rather than restarting the app from under you.
 */
function UpdateModal({ onLater }: { onLater(): void }) {
  const [applying, setApplying] = useState(false);
  return (
    <div className="update-modal-backdrop" role="presentation">
      <section
        className="update-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
      >
        <span className="update-modal-icon">
          <RefreshCw />
        </span>
        <div>
          <h2 id="update-modal-title">Nuvio Web update ready</h2>
          <p>
            Install the latest version now. The page will reload automatically
            when it is ready.
          </p>
        </div>
        <div className="update-modal-actions">
          <button className="secondary" disabled={applying} onClick={onLater}>
            Later
          </button>
          <button
            className="primary"
            disabled={applying}
            onClick={() => {
              setApplying(true);
              void applyUpdate();
            }}
          >
            <RefreshCw size={17} className={applying ? "spin-icon" : ""} />
            {applying ? "Updating…" : "Update now"}
          </button>
        </div>
      </section>
    </div>
  );
}

function UpdateRow() {
  const [state, setState] = useState<"idle" | "checking" | "current" | "pending">(
    updateReady() ? "pending" : "idle",
  );
  return (
    <>
      <div className="theme-row">
        <span>
          <strong>Check for updates</strong>
          <small>
            {state === "checking"
              ? "Checking…"
              : state === "current"
                ? "You are on the latest version."
                : state === "pending"
                  ? "An update is downloaded and ready to install."
                  : `Build ${new Date(__APP_BUILD__).toLocaleString()}`}
          </small>
        </span>
        <button
          className="secondary"
          disabled={state === "checking"}
          onClick={async () => {
            if (state === "pending") {
              await applyUpdate();
              return;
            }
            setState("checking");
            const result = await checkForUpdate({ prompt: false });
            setState(result === "pending" ? "pending" : "current");
          }}
        >
          <RefreshCw size={16} className={state === "checking" ? "spin-icon" : ""} />
          {state === "pending" ? "Update" : state === "checking" ? "Checking…" : "Check"}
        </button>
      </div>
    </>
  );
}

function SettingToggle({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
}) {
  return (
    <div className="theme-row">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <label className="switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <i />
      </label>
    </div>
  );
}

function HomeLayoutSettings({
  layout,
  labels,
  pinnedKeys,
  disabled,
  onChange,
}: {
  layout: HomeLayout | null;
  labels: Map<string, string>;
  /** Collections pinned to the top; Nuvio forbids reordering across these. */
  pinnedKeys?: Set<string>;
  disabled?: boolean;
  onChange(next: HomeLayout): Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  // Matches Nuvio: a move is refused when either end of it is pinned, so a
  // pinned row cannot move and nothing can be moved above one.
  const isPinned = (key?: string) => !!key && !!pinnedKeys?.has(key);

  // A profile that has never saved a layout gets none from the server, and
  // that is not the same as one still loading. Nuvio shows the editor
  // immediately in that case, built from the catalogs it already has — so this
  // does too, rather than spinning on a pull that already finished. Nothing is
  // written until the first edit.
  const effective =
    layout ??
    (labels.size
      ? ({
          items: [...labels.keys()].map((key, order) => ({
            key,
            enabled: true,
            order,
            isCollection: key.startsWith(COLLECTION_KEY_PREFIX),
            customTitle: "",
            // No synced row behind a synthesised item; the shape still has to
            // match so an edit writes the same payload Nuvio expects.
            raw: {} as Record<string, unknown>,
          })),
          orderOf: new Map([...labels.keys()].map((key, index) => [key, index])),
          enabledOf: new Map([...labels.keys()].map((key) => [key, true])),
          customTitleOf: new Map<string, string>(),
          showCatalogType: true,
          hideUnreleasedContent: false,
        } satisfies HomeLayout)
      : null);

  const rebuild = useCallback(
    (
      items: HomeLayout["items"],
      patch: Partial<Pick<HomeLayout, "showCatalogType" | "hideUnreleasedContent">> = {},
    ): HomeLayout => ({
      ...(effective as HomeLayout),
      ...patch,
      items,
      orderOf: new Map(items.map((item, index) => [item.key, index])),
      enabledOf: new Map(items.map((item) => [item.key, item.enabled])),
      customTitleOf: new Map(
        items
          .filter((item) => item.customTitle.trim())
          .map((item) => [item.key, item.customTitle.trim()]),
      ),
    }),
    [effective],
  );

  async function apply(next: HomeLayout) {
    setError(null);
    try {
      await onChange(next);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not sync Home layout",
      );
    }
  }

  if (!effective)
    return <div className="home-layout-loading"><i className="mini-spinner" /> Loading Home layout…</div>;

  return (
    <>
      <SettingToggle
        title="Show catalog type"
        description="Append Movies, Series, or another media type to catalog names."
        checked={effective.showCatalogType}
        disabled={disabled}
        onChange={(showCatalogType) =>
          void apply(rebuild(effective.items, { showCatalogType }))
        }
      />
      <SettingToggle
        title="Hide unreleased content"
        description="Hide catalog titles whose known release date is still in the future."
        checked={effective.hideUnreleasedContent}
        disabled={disabled}
        onChange={(hideUnreleasedContent) =>
          void apply(rebuild(effective.items, { hideUnreleasedContent }))
        }
      />
      {error && <p className="addon-card-error">{error}</p>}
      <details className="home-layout-disclosure">
        <summary>
          <span>
            <strong>Catalogs &amp; collections</strong>
            <small>{effective.items.length} Home sections</small>
          </span>
          <ChevronRight aria-hidden="true" />
        </summary>
        <div className="home-layout-list-web">
          {effective.items.map((item, index) => (
            <div className={item.enabled ? "" : "is-hidden"} key={item.key}>
              <span className="home-layout-copy">
                <strong>
                  {item.customTitle.trim() || labels.get(item.key) || String(item.raw.catalog_id ?? item.raw.collection_id ?? item.key)}
                </strong>
                <small>
                  {item.isCollection ? "Collection" : "Catalog"}
                  {isPinned(item.key) ? " · Pinned to top" : ""}
                </small>
              </span>
              <label className="home-layout-title-input">
                <span>Custom title</span>
                <input
                  key={`${item.key}:${item.customTitle}`}
                  defaultValue={item.customTitle}
                  disabled={disabled}
                  placeholder="Default"
                  onBlur={(event) => {
                    const customTitle = event.currentTarget.value.trim();
                    if (customTitle === item.customTitle) return;
                    const items = effective.items.map((entry, row) =>
                      row === index ? { ...entry, customTitle } : entry,
                    );
                    void apply(rebuild(items));
                  }}
                />
              </label>
              <div className="home-layout-actions">
                <button
                  type="button"
                  className="icon-button reorder-action"
                  title={
                    isPinned(item.key) || isPinned(effective.items[index - 1]?.key)
                      ? "Pinned rows stay at the top"
                      : "Move up"
                  }
                  disabled={
                    disabled ||
                    index === 0 ||
                    isPinned(item.key) ||
                    isPinned(effective.items[index - 1]?.key)
                  }
                  onClick={() => {
                    const items = [...effective.items];
                    [items[index - 1], items[index]] = [items[index], items[index - 1]];
                    void apply(rebuild(items));
                  }}
                ><ArrowUp /></button>
                <button
                  type="button"
                  className="icon-button reorder-action"
                  title={
                    isPinned(item.key) || isPinned(effective.items[index + 1]?.key)
                      ? "Pinned rows stay at the top"
                      : "Move down"
                  }
                  disabled={
                    disabled ||
                    index === effective.items.length - 1 ||
                    isPinned(item.key) ||
                    isPinned(effective.items[index + 1]?.key)
                  }
                  onClick={() => {
                    const items = [...effective.items];
                    [items[index], items[index + 1]] = [items[index + 1], items[index]];
                    void apply(rebuild(items));
                  }}
                ><ArrowDown /></button>
                <label className="switch" title={item.enabled ? "Visible on Home" : "Hidden from Home"}>
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    disabled={disabled}
                    onChange={(event) => {
                      const items = effective.items.map((entry, row) =>
                        row === index ? { ...entry, enabled: event.target.checked } : entry,
                      );
                      void apply(rebuild(items));
                    }}
                  />
                  <i />
                </label>
              </div>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}

const LANGUAGE_OPTIONS = [
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["pl", "Polish"],
  ["tr", "Turkish"],
  ["ru", "Russian"],
  ["uk", "Ukrainian"],
  ["ar", "Arabic"],
  ["he", "Hebrew"],
  ["hi", "Hindi"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
] as const;

function IntegrationCredentialField({
  label,
  description,
  value,
  ready,
  onSave,
}: {
  label: string;
  description: string;
  value: string;
  ready: boolean;
  onSave(value: string): Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value), [value]);
  return (
    <form
      className="credential-row"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
          await onSave(draft);
        } finally {
          setSaving(false);
        }
      }}
    >
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <div className="credential-control">
        <div className="password-field">
          <input
            type={visible ? "text" : "password"}
            value={draft}
            disabled={!ready || saving}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="button"
            aria-label={visible ? "Hide credential" : "Show credential"}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? <EyeOff /> : <Eye />}
          </button>
        </div>
        <button
          className="secondary"
          disabled={!ready || saving || draft === value}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function SettingsPage({
  addons,
  addonRows,
  onToggleAddon,
  onMoveAddon,
  onRemoveAddon,
  onAddAddon,
  onRefreshAddons,
  session,
  profile,
  settings,
  settingsReady,
  homeLayout,
  homeLayoutLabels,
  pinnedCollectionKeys,
  onHomeLayout,
  addonNames,
  defaultSourceAddon,
  onDefaultSourceAddon,
  heroEnabled,
  onHeroEnabled,
  onTypedSetting,
  onPosterSetting,
  onContinueWatchingSetting,
  onMetaScreenSetting,
  onMetaScreenSection,
  onMoveMetaScreenSection,
  onRawSetting,
  providerCredentials,
  credentialsReady,
  onProviderCredential,
  externalPlayer,
  onExternalPlayer,
  onSignOut,
}: {
  addons: InstalledAddon[];
  addonRows: AddonRow[];
  onToggleAddon(index: number): void;
  onMoveAddon(index: number, direction: -1 | 1): void;
  onRemoveAddon(index: number): void;
  onAddAddon(url: string): Promise<void>;
  onRefreshAddons(): void;
  session: Session;
  profile: Profile | null;
  settings: WebSettings;
  settingsReady: boolean;
  homeLayout: HomeLayout | null;
  homeLayoutLabels: Map<string, string>;
  pinnedCollectionKeys: Set<string>;
  onHomeLayout(next: HomeLayout): Promise<void>;
  /** Installed addon names, for the default-source picker. */
  addonNames: string[];
  defaultSourceAddon: string;
  onDefaultSourceAddon(next: string): void;
  /** Device-local, so it is state here rather than part of the synced blob. */
  heroEnabled: boolean;
  onHeroEnabled(next: boolean): void;
  onTypedSetting(
    feature: string,
    key: string,
    type: SyncPreferenceType,
    value: string | boolean | number | string[],
  ): void;
  onPosterSetting(patch: Partial<PosterSettings>): void;
  onContinueWatchingSetting(patch: Record<string, unknown>): void;
  onMetaScreenSetting(patch: Record<string, unknown>): void;
  onMetaScreenSection(key: MetaScreenSectionKey, enabled: boolean): void;
  onMoveMetaScreenSection(key: MetaScreenSectionKey, direction: -1 | 1): void;
  onRawSetting(feature: string, key: string, value: unknown): void;
  providerCredentials: ProviderCredentialRow[];
  credentialsReady: boolean;
  onProviderCredential(provider: string, value: string): Promise<void>;
  externalPlayer: ExternalPlayerMode;
  onExternalPlayer(mode: ExternalPlayerMode): void;
  onSignOut(): void;
}) {
  const [category, setCategory] = useState<SettingsCategory>("appearance");
  // Null is the hub. Leaving Integrations closes whatever page was open, so
  // coming back lands on the list rather than wherever you last were.
  const [integrationPage, setIntegrationPage] =
    useState<IntegrationPageKey | null>(null);
  useEffect(() => {
    if (category !== "integrations") setIntegrationPage(null);
  }, [category]);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  /**
   * One step back, whatever that means from here.
   *
   * An integration page is a level deeper than the category holding it, so
   * back leaves the page first and the panel second. Two back buttons stacked
   * in one corner is the alternative, and neither of them says which is which.
   */
  const goBack = useCallback(() => {
    setIntegrationPage((page) => {
      if (page !== null) return null;
      setMobilePanelOpen(false);
      return page;
    });
  }, []);
  /**
   * Only where the gesture's own animation tells the truth.
   *
   * It slides the panel off and reveals the settings index behind it, which
   * is what closing looks like. Stepping out of an integration page is not
   * that — the panel stays, showing the hub — so the drag showed one thing
   * and the release did another. Off a page, the arrow in the header does it.
   */
  const mobilePanelRef = useSwipeBack<HTMLElement>(
    goBack,
    integrationPage === null,
  );
  /**
   * The page's own gesture, so both levels swipe.
   *
   * The two are mutually exclusive: on a page this one runs and slides the
   * card away to the hub, off a page the panel's runs and closes the panel.
   * Sharing one gesture is what made the drag show the settings index while
   * the release showed integrations.
   */
  const integrationSwipeRef = useSwipeBack<HTMLDivElement>(
    () => setIntegrationPage(null),
    integrationPage !== null,
  );
  const activeCategory = SETTINGS_CATEGORIES.find(
    (item) => item.key === category,
  )!;
  const ActiveCategoryIcon = activeCategory.icon;

  useEffect(() => {
    if (!mobilePanelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") goBack();
    };
    window.addEventListener("keydown", onKeyDown);
    document.body.classList.add("mobile-settings-open");
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("mobile-settings-open");
    };
  }, [goBack, mobilePanelOpen]);

  // Each settings page starts at its own top. Swapping the category only
  // replaces the content — the document on desktop and the panel on mobile
  // both keep whatever offset they had, so opening a short page from halfway
  // down a long one landed below its own heading.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (mobilePanelRef.current) {
      mobilePanelRef.current.scrollTop = 0;
      mobilePanelRef.current
        .querySelector<HTMLElement>(".mobile-settings-panel-content")
        ?.scrollTo({ top: 0 });
    }
  }, [category, mobilePanelOpen]);

  const openMobileCategory = (next: SettingsCategory) => {
    setCategory(next);
    setMobilePanelOpen(true);
  };
  const tmdbKey = providerCredential(providerCredentials, "tmdb", "api_key");
  const mdbListKey = providerCredential(
    providerCredentials,
    "mdblist",
    "api_key",
  );
  const animeSkipClientId = providerCredential(
    providerCredentials,
    "animeskip",
    "client_id",
  );
  const introDbApiKey = providerCredential(
    providerCredentials,
    "introdb",
    "api_key",
  );
  const detailSections = settings.metaScreen.items.filter(
    (item): item is typeof item & {
      key: (typeof WEB_DETAIL_SECTION_KEYS)[number];
    } => WEB_DETAIL_SECTION_KEYS.includes(
      item.key as (typeof WEB_DETAIL_SECTION_KEYS)[number],
    ),
  );
  return (
    <section className="settings-page" data-settings-category={category}>
      <h1>Settings</h1>
      <div className="settings-desktop-layout">
      <nav className="settings-category-nav" aria-label="Settings categories">
        {SETTINGS_CATEGORIES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            title={label}
            aria-label={label}
            className={category === key ? "active" : ""}
            aria-current={category === key ? "page" : undefined}
            onClick={() => setCategory(key)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="mobile-settings-index">
        <section
          className="mobile-settings-group"
          aria-labelledby="settings-account-group"
        >
          <span id="settings-account-group">ACCOUNT</span>
          <div className="mobile-settings-list">
            {SETTINGS_CATEGORIES.filter((item) => item.key === "app").map(
              ({ key, label, description, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => openMobileCategory(key)}
                >
                  <i><Icon /></i>
                  <span><strong>{label}</strong><small>{description}</small></span>
                  <ChevronRight />
                </button>
              ),
            )}
          </div>
        </section>
        <section
          className="mobile-settings-group"
          aria-labelledby="settings-general-group"
        >
          <span id="settings-general-group">GENERAL</span>
          <div className="mobile-settings-list">
            {SETTINGS_CATEGORIES.filter((item) => item.key !== "app").map(
              ({ key, label, description, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => openMobileCategory(key)}
                >
                  <i><Icon /></i>
                  <span><strong>{label}</strong><small>{description}</small></span>
                  <ChevronRight />
                </button>
              ),
            )}
          </div>
        </section>
      </div>
      <section
        ref={mobilePanelRef}
        className={`mobile-settings-panel${mobilePanelOpen ? " is-open" : ""}`}
      >
        <header className="mobile-settings-panel-header">
          <button
            type="button"
            className="circle-button"
            aria-label="Back to settings"
            onClick={goBack}
          >
            <ArrowLeft />
          </button>
          <div>
            <span>SETTINGS</span>
            <h2>{activeCategory.label}</h2>
          </div>
          <ActiveCategoryIcon aria-hidden="true" />
        </header>
        <div className="mobile-settings-panel-content">
      <div
        className="settings-category-card addon-settings-category"
        hidden={category !== "addons"}
      >
        <div className="settings-category-heading">
          <h2>Content & discovery</h2>
          <p>
            Manage the Stremio addons used for catalogs, metadata, subtitles,
            and streams. Browser plugin providers are disabled for now.
          </p>
        </div>
        <div className="content-discovery-tabs" role="tablist" aria-label="Content source type">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="active"
          >
            <Puzzle /> Addons
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            aria-disabled="true"
            className="is-locked"
            disabled
            title="Plugins are unavailable in the web app"
          >
            <Lock /> Plugins <small>Unavailable</small>
          </button>
        </div>
        <div>
          <AddonSettings
            addons={addons}
            rows={addonRows}
            onToggle={onToggleAddon}
            onMove={onMoveAddon}
            onRemove={onRemoveAddon}
            onAdd={onAddAddon}
            onRefresh={onRefreshAddons}
          />
        </div>
      </div>
      <div
        className={`setting-card integrations-card settings-category-card${
          integrationPage ? " has-page" : ""
        }`}
        hidden={category !== "integrations"}
      >
        {/* The hub stays mounted underneath, so a page sliding away reveals it
            rather than an empty panel. Both occupy one grid cell, which also
            means the card is as tall as whichever is showing. */}
        <div className="integration-hub">
            <header>
              <h2>Integrations</h2>
              <span>Credentials sync separately and securely</span>
            </header>
            <p>
              These use Nuvio's provider-credential RPC. They are never copied
              into the profile settings blob.
            </p>
            {INTEGRATION_PAGES.map((page) => (
              <button
                key={page.key}
                type="button"
                className="integration-row"
                onClick={() => setIntegrationPage(page.key)}
              >
                <span className="integration-row-logo">
                  {page.logo ? (
                    <img src={publicAsset(page.logo)} alt="" />
                  ) : (
                    <HardDrive />
                  )}
                </span>
                <span className="integration-row-copy">
                  <strong>{page.label}</strong>
                  <small>{page.description}</small>
                </span>
                <ChevronRight />
              </button>
            ))}
        </div>
        {/* The gesture moves this and nothing else, so the hub stays put and
            is what you see behind it. As a fixed layer it starts at x=0, so
            it reaches the edge zone the gesture arms in without help. */}
        <div
          ref={integrationSwipeRef}
          className="integration-page"
          hidden={integrationPage === null}
        >
        {/* The card the rest of settings is written in. The fixed layer is the
            backdrop behind it, not the surface itself. */}
        <div className="integration-page-card">
        {integrationPage && (
          <IntegrationPageHeader
            page={INTEGRATION_PAGES.find((item) => item.key === integrationPage)!}
            onBack={() => setIntegrationPage(null)}
          />
        )}
        <div hidden={integrationPage !== "tmdb"}>
        <IntegrationCredentialField
          label="TMDB API key"
          description="Used for the TMDB enrichment settings shared with Nuvio."
          value={tmdbKey}
          ready={credentialsReady}
          onSave={(value) => onProviderCredential("tmdb", value)}
        />
        <SettingToggle
          title="TMDB enrichment"
          description="Enable TMDB enrichment when a key is configured."
          checked={settings.integrations.tmdbEnabled}
          disabled={!settingsReady || !tmdbKey}
          onChange={(next) =>
            onTypedSetting(
              "tmdb_settings",
              "tmdb_enabled",
              "boolean",
              next,
            )
          }
        />
        <label className="setting-select-row">
          <span>
            <strong>TMDB language</strong>
            <small>Language requested for localized metadata.</small>
          </span>
          <select
            value={settings.integrations.tmdbLanguage}
            disabled={!settingsReady || !tmdbKey}
            onChange={(event) =>
              onTypedSetting(
                "tmdb_settings",
                "tmdb_language",
                "string",
                event.target.value,
              )
            }
          >
            {LANGUAGE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {[
          ["Artwork and logos", "tmdb_use_artwork", settings.integrations.tmdbUseArtwork],
          ["Titles and descriptions", "tmdb_use_basic_info", settings.integrations.tmdbUseBasicInfo],
          ["Runtime and age details", "tmdb_use_details", settings.integrations.tmdbUseDetails],
          ["Release dates", "tmdb_use_release_dates", settings.integrations.tmdbUseReleaseDates],
          ["Cast and credits", "tmdb_use_credits", settings.integrations.tmdbUseCredits],
          ["Episode metadata", "tmdb_use_episodes", settings.integrations.tmdbUseEpisodes],
          ["Trailers", "tmdb_use_trailers", settings.integrations.tmdbUseTrailers],
        ].map(([label, key, checked]) => (
          <SettingToggle
            key={String(key)}
            title={String(label)}
            description="Uses the matching official TMDB enrichment flag."
            checked={Boolean(checked)}
            disabled={!settingsReady || !settings.integrations.tmdbEnabled || !tmdbKey}
            onChange={(next) =>
              onTypedSetting(
                "tmdb_settings",
                String(key),
                "boolean",
                next,
              )
            }
          />
        ))}
        </div>
        <div hidden={integrationPage !== "mdblist"}>
        <IntegrationCredentialField
          label="MDBList API key"
          description="Adds MDBList rating providers after metadata enrichment."
          value={mdbListKey}
          ready={credentialsReady}
          onSave={(value) => onProviderCredential("mdblist", value)}
        />
        <SettingToggle
          title="MDBList ratings"
          description="Enable the synchronized rating enrichment when a key is configured."
          checked={settings.integrations.mdbListEnabled}
          disabled={!settingsReady || !mdbListKey}
          onChange={(next) =>
            onTypedSetting(
              "mdblist_settings",
              "mdblist_enabled",
              "boolean",
              next,
            )
          }
        />
        {[
          ["IMDb", "imdb", "mdblist_use_imdb"],
          ["TMDB", "tmdb", "mdblist_use_tmdb"],
          ["Rotten Tomatoes", "tomatoes", "mdblist_use_tomatoes"],
          ["Metacritic", "metacritic", "mdblist_use_metacritic"],
          ["Trakt", "trakt", "mdblist_use_trakt"],
          ["Letterboxd", "letterboxd", "mdblist_use_letterboxd"],
          ["Audience score", "audience", "mdblist_use_audience"],
          ["MyAnimeList", "mal", "mdblist_use_mal"],
        ].map(([label, provider, key]) => (
          <SettingToggle
            key={provider}
            title={label}
            description="Include this provider in MDBList rating badges."
            checked={settings.integrations.mdbListProviders.includes(provider)}
            disabled={
              !settingsReady ||
              !settings.integrations.mdbListEnabled ||
              !mdbListKey
            }
            onChange={(next) =>
              onTypedSetting("mdblist_settings", key, "boolean", next)
            }
          />
        ))}
        </div>
        <div hidden={integrationPage !== "connected"}>
          {/* Real controls where the shell can reach these services, and an
              explanation where it cannot. The keys are the account's own and
              sync either way; what differs is whether anything can be done
              with them from here. */}
          {platform.debrid?.services.map((service) => (
            <IntegrationCredentialField
              key={service.id}
              label={`${service.label} API key`}
              description={`Used to resolve cached links through ${service.label}.`}
              value={providerCredential(
                providerCredentials,
                service.credentialProvider,
                service.credentialField,
              )}
              ready={credentialsReady}
              onSave={(value) =>
                onProviderCredential(service.credentialProvider, value)
              }
            />
          ))}
          {!platform.debrid && (
          /* Stated plainly rather than offered and broken. Torbox sends no
              cross-origin headers at all, so a browser cannot reach its API —
              not the account linking, not the library, not link resolving.
              Nothing here can be enabled by trying harder. */
          <div className="integration-unavailable">
            <p>
              Debrid accounts cannot be connected from a browser. Torbox does
              not allow other sites to call its API, and a browser has no way
              around that — so account linking, cloud library browsing and
              link resolving are all out of reach here.
            </p>
            <p>
              Use the Nuvio desktop, Android or TV app for these. Your addons
              already resolve links for playback on the web.
            </p>
          </div>
          )}
        </div>
        </div>
        </div>
      </div>
      <div
        className="setting-card settings-category-card"
        hidden={category !== "appearance"}
      >
        <header>
          <h2>Appearance</h2>
        </header>
        <SettingToggle
          title="AMOLED black"
          description={`Synced with your Nuvio ${settingsPlatform()} settings.`}
          checked={settings.amoled}
          disabled={!settingsReady}
          onChange={(next) =>
            onTypedSetting(
              "theme_settings",
              "amoled_enabled",
              "boolean",
              next,
            )
          }
        />
        <label className="setting-select-row">
          <span>
            <strong>Accent theme</strong>
            <small>Uses the same theme names and stored value as Nuvio.</small>
          </span>
          <select
            value={settings.selectedTheme}
            disabled={!settingsReady}
            onChange={(event) =>
              onTypedSetting(
                "theme_settings",
                "selected_theme",
                "string",
                event.target.value,
              )
            }
          >
            {[
              "WHITE",
              "CRIMSON",
              "OCEAN",
              "VIOLET",
              "EMERALD",
              "AMBER",
              "ROSE",
            ].map((theme) => (
              <option key={theme} value={theme}>
                {theme[0] + theme.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="setting-select-row">
          <span>
            <strong>Desktop navigation</strong>
            <small>Choose a side rail or a compact navigation row.</small>
          </span>
          <select
            value={settings.desktopNavigationLayout}
            disabled={!settingsReady}
            onChange={(event) =>
              onTypedSetting(
                "theme_settings",
                "desktop_navigation_layout",
                "string",
                event.target.value,
              )
            }
          >
            <option value="Sidebar">Sidebar</option>
            <option value="TopBar">Top bar</option>
          </select>
        </label>
        <div className="setting-grid">
          <label>
            <span>Poster width</span>
            <input
              type="number"
              min="88"
              max="260"
              value={settings.poster.widthDp}
              disabled={!settingsReady}
              onChange={(event) =>
                onPosterSetting({ widthDp: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>Poster height</span>
            <input
              type="number"
              min="112"
              max="390"
              value={settings.poster.heightDp}
              disabled={!settingsReady}
              onChange={(event) =>
                onPosterSetting({ heightDp: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>Corner radius</span>
            <input
              type="number"
              min="0"
              max="40"
              value={settings.poster.cornerRadiusDp}
              disabled={!settingsReady}
              onChange={(event) =>
                onPosterSetting({ cornerRadiusDp: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <SettingToggle
          title="Landscape catalog cards"
          description="Use wide artwork proportions in catalog rows and grids."
          checked={settings.poster.catalogLandscapeModeEnabled}
          disabled={!settingsReady}
          onChange={(next) =>
            onPosterSetting({ catalogLandscapeModeEnabled: next })
          }
        />
        <SettingToggle
          title="Hide poster labels"
          description="Hide titles and years below poster cards."
          checked={settings.poster.hideLabelsEnabled}
          disabled={!settingsReady}
          onChange={(next) => onPosterSetting({ hideLabelsEnabled: next })}
        />
      </div>
      <div
        className="setting-card settings-category-card"
        hidden={category !== "home"}
      >
        <header>
          <h2>Home layout</h2>
          <span>Shared with Nuvio</span>
        </header>
        <p>
          Reorder, rename, show, or hide synced catalogs and collections.
        </p>
        <SettingToggle
          title="Show hero section"
          description="The featured carousel at the top of Home. Kept on this device, matching Nuvio — the shared Home layout has no field for it."
          checked={heroEnabled}
          onChange={onHeroEnabled}
        />
        <HomeLayoutSettings
          layout={homeLayout}
          labels={homeLayoutLabels}
          pinnedKeys={pinnedCollectionKeys}
          disabled={!profile}
          onChange={onHomeLayout}
        />
      </div>
      <div
        className="setting-card settings-category-card"
        hidden={category !== "home"}
      >
        <header>
          <h2>Continue watching</h2>
          <span>Shared with Nuvio</span>
        </header>
        <SettingToggle
          title="Show Continue Watching"
          description="Show your synced resume and next-up row on Home."
          checked={settings.continueWatching.isVisible}
          disabled={!settingsReady}
          onChange={(next) =>
            onContinueWatchingSetting({ isVisible: next })
          }
        />
        <label className="setting-select-row">
          <span>
            <strong>Card style</strong>
            <small>Use Nuvio's card, wide, or poster layout.</small>
          </span>
          <select
            value={settings.continueWatching.style}
            disabled={!settingsReady}
            onChange={(event) =>
              onContinueWatchingSetting({ style: event.target.value })
            }
          >
            <option value="Card">Card</option>
            <option value="Wide">Wide</option>
            <option value="Poster">Poster</option>
          </select>
        </label>
        <label className="setting-select-row">
          <span>
            <strong>Sort mode</strong>
            <small>
              Streaming keeps upcoming episodes last; split gives them their
              own row.
            </small>
          </span>
          <select
            value={settings.continueWatching.sortMode}
            disabled={!settingsReady}
            onChange={(event) =>
              onContinueWatchingSetting({ sort_mode: event.target.value })
            }
          >
            <option value="DEFAULT">Default</option>
            <option value="STREAMING_STYLE">Streaming style</option>
            <option value="SPLIT_UPCOMING">Split upcoming</option>
          </select>
        </label>
        <SettingToggle
          title="Continue from furthest episode"
          description="Choose Next Up after the furthest watched episode instead of the most recently watched one."
          checked={settings.continueWatching.upNextFromFurthestEpisode}
          disabled={!settingsReady}
          onChange={(next) =>
            onContinueWatchingSetting({ upNextFromFurthestEpisode: next })
          }
        />
        <SettingToggle
          title="Use episode thumbnails"
          description="Use episode artwork for Card and Wide layouts."
          checked={settings.continueWatching.useEpisodeThumbnails}
          disabled={!settingsReady}
          onChange={(next) =>
            onContinueWatchingSetting({
              use_episode_thumbnails_in_cw: next,
            })
          }
        />
        <SettingToggle
          title="Show unaired Next Up"
          description="Include a future episode when its release date is known."
          checked={settings.continueWatching.showUnairedNextUp}
          disabled={!settingsReady}
          onChange={(next) =>
            onContinueWatchingSetting({ show_unaired_next_up: next })
          }
        />
        <SettingToggle
          title="Blur unaired Next Up artwork"
          description="Blur future episode thumbnails until they are released."
          checked={settings.continueWatching.blurNextUp}
          disabled={
            !settingsReady ||
            !settings.continueWatching.useEpisodeThumbnails
          }
          onChange={(next) =>
            onContinueWatchingSetting({
              blur_continue_watching_next_up: next,
            })
          }
        />
      </div>
      <div
        className="setting-card settings-category-card"
        hidden={category !== "details"}
      >
        <header>
          <h2>Details screens</h2>
          <span>Shared with Nuvio</span>
        </header>
        <label className="setting-select-row">
          <span>
            <strong>Background</strong>
            <small>Choose how artwork continues behind the detail page.</small>
          </span>
          <select
            value={settings.metaScreen.backgroundMode}
            disabled={!settingsReady}
            onChange={(event) =>
              onMetaScreenSetting({ background_mode: event.target.value })
            }
          >
            <option value="normal">Normal</option>
            <option value="cinematic">Cinematic</option>
            <option value="dominant_color">Dominant color</option>
          </select>
        </label>
        <label className="setting-select-row">
          <span>
            <strong>Episode cards</strong>
            <small>List is denser; horizontal keeps larger artwork and summaries.</small>
          </span>
          <select
            value={settings.metaScreen.episodeCardStyle}
            disabled={!settingsReady}
            onChange={(event) =>
              onMetaScreenSetting({ episodeCardStyle: event.target.value })
            }
          >
            <option value="horizontal">Horizontal</option>
            <option value="list">List</option>
          </select>
        </label>
        <SettingToggle
          title="Blur unwatched episodes"
          description="Hide episode thumbnail spoilers until an episode is marked watched."
          checked={settings.metaScreen.blurUnwatchedEpisodes}
          disabled={!settingsReady}
          onChange={(next) =>
            onMetaScreenSetting({ blur_unwatched_episodes: next })
          }
        />
        <div className="detail-section-settings">
          <span className="eyebrow">VISIBLE SECTIONS & ORDER</span>
          {detailSections.map((item, index) => (
            <div className="detail-section-setting" key={item.key}>
              <label>
                <input
                  type="checkbox"
                  checked={item.enabled}
                  disabled={!settingsReady}
                  onChange={(event) =>
                    onMetaScreenSection(item.key, event.target.checked)
                  }
                />
                <span>{DETAIL_SECTION_LABELS[item.key]}</span>
              </label>
              <div className="detail-reorder-buttons">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${DETAIL_SECTION_LABELS[item.key]} up`}
                  disabled={!settingsReady || index === 0}
                  onClick={() => onMoveMetaScreenSection(item.key, -1)}
                >
                  <ArrowUp size={17} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${DETAIL_SECTION_LABELS[item.key]} down`}
                  disabled={!settingsReady || index === detailSections.length - 1}
                  onClick={() => onMoveMetaScreenSection(item.key, 1)}
                >
                  <ArrowDown size={17} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {!platform.player && <div
        className="setting-card web-only-card settings-category-card"
        hidden={category !== "playback"}
      >
        <header>
          <h2>Web-only playback handoff</h2>
          <span>Stored on this browser only</span>
        </header>
        <label className="setting-select-row">
          <span>
            <strong>Default player</strong>
            <small>
              {isAndroid()
                ? "Next Player, VLC, MX Player, mpv, and the Android video player chooser open through Android intents."
                : isAppleMobile()
                  ? "VLC, Outplayer, and Infuse open through Apple URL schemes."
                  : isMacOS()
                    ? "Infuse and IINA open through macOS URL schemes. VLC registers none on a Mac, so copy the link for it."
                    : "mpv opens through the mpv-handler helper, which has to be installed separately. Otherwise copy the link for your player."}
            </small>
          </span>
          <select
            value={externalPlayer}
            onChange={(event) =>
              onExternalPlayer(event.target.value as ExternalPlayerMode)
            }
          >
            <option value="internal">Nuvio web player</option>
            {platform.externalPlayer.options("settings").map((option) => (
              <option key={option.mode} value={option.mode}>
                {/* Which players can say what happened is the difference
                    between progress being recorded and being asked for. */}
                {option.label}
                {option.reportsBack ? " ✓ reports back" : ""}
              </option>
            ))}
          </select>
        </label>
        {/* iOS only, because it is the only platform that cannot be reopened
            by a link. The Shortcut is what carries you back, so it is offered
            wherever it can be installed — including Safari, where someone may
            well be setting up before installing the app itself. */}
        {isAppleMobile() && (
          <>
            <a
              className="shortcut-banner"
              href={RETURN_SHORTCUT_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>
                <strong>Get the &ldquo;{RETURN_SHORTCUT_NAME}&rdquo; Shortcut</strong>
                <small>
                  iOS hands an ordinary link to Safari, which cannot reach this
                  app. Add the Shortcut once and an external player can send you
                  back here with your position.
                </small>
              </span>
              <Download />
            </a>
            {/* Said plainly because it is the one thing about this route that
                someone might object to, and they cannot object to what they
                are not told. */}
            <p className="setting-warning">
              <TriangleAlert aria-hidden="true" />
              <span>
                Outplayer saves your position when you close it, and reaching
                you back here sends the stream URL through a Cloudflare Worker.
                Nothing is logged and nobody can read it — the Worker holds a
                position for a few minutes, hands it back, and forgets it.
              </span>
            </p>
          </>
        )}
        <p>
          The web remux fallback only re-boxes compatible tracks. DTS and
          TrueHD still require an external player; Nuvio Web does not transcode.
        </p>
      </div>}
      <div
        className="setting-card settings-category-card"
        hidden={category !== "playback"}
      >
        <header>
          <h2>Playback</h2>
        </header>
        <label className="setting-select-row">
          <span>
            <strong>Default source addon</strong>
            <small>
              The addon the source list opens filtered to. Kept on this device.
              An addon that returned nothing for a title is skipped, so this can
              never hide the sources that did arrive.
            </small>
          </span>
          <select
            value={defaultSourceAddon}
            onChange={(event) => onDefaultSourceAddon(event.target.value)}
          >
            <option value="">All addons</option>
            {addonNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <SettingToggle
          title="Loading overlay"
          description="Show the buffering spinner while the video is waiting."
          checked={settings.player.showLoadingOverlay}
          disabled={!settingsReady}
          onChange={(next) =>
            onTypedSetting(
              "player_settings",
              "show_loading_overlay",
              "boolean",
              next,
            )
          }
        />
        <SettingToggle
          title="Parental guide"
          description="Show the title's age rating in the player overlay."
          checked={settings.player.showParentalGuide}
          disabled={!settingsReady}
          onChange={(next) =>
            onTypedSetting(
              "player_settings",
              "show_parental_guide",
              "boolean",
              next,
            )
          }
        />
        <label className="setting-select-row">
          <span>
            <strong>Resize mode</strong>
            <small>Fit preserves the whole frame; Zoom/Fill crop it.</small>
          </span>
          <select
            value={settings.player.resizeMode}
            disabled={!settingsReady}
            onChange={(event) =>
              onTypedSetting(
                "player_settings",
                "resize_mode",
                "string",
                event.target.value,
              )
            }
          >
            <option value="Fit">Fit</option>
            <option value="Zoom">Zoom</option>
            <option value="Fill">Fill</option>
            <option value="Stretch">Stretch</option>
          </select>
        </label>
        <label className="setting-select-row">
          <span>
            <strong>Automatic source selection</strong>
            <small>Uses Nuvio's MANUAL, FIRST_STREAM, or REGEX_MATCH value.</small>
          </span>
          <select
            value={settings.player.autoPlayMode}
            disabled={!settingsReady}
            onChange={(event) =>
              onTypedSetting(
                "player_settings",
                "stream_auto_play_mode",
                "string",
                event.target.value,
              )
            }
          >
            <option value="MANUAL">Choose manually</option>
            <option value="FIRST_STREAM">First stream</option>
            <option value="REGEX_MATCH">Regex match</option>
          </select>
        </label>
        {settings.player.autoPlayMode === "REGEX_MATCH" && (
          <label className="setting-text-row">
            <span>
              <strong>Source regex</strong>
              <small>An invalid expression safely falls back to the source list.</small>
            </span>
            <input
              value={settings.player.autoPlayRegex}
              disabled={!settingsReady}
              placeholder="1080p.*WEB-DL"
              onChange={(event) =>
                onTypedSetting(
                  "player_settings",
                  "stream_auto_play_regex",
                  "string",
                  event.target.value,
                )
              }
            />
          </label>
        )}
        <SettingToggle
          title="Reuse last source"
          description="Plays the link an episode was last watched with instead of asking the addon again. The source list is still one tap away."
          checked={settings.player.reuseLastStream}
          disabled={!settingsReady}
          onChange={(next) =>
            onTypedSetting(
              "player_settings",
              "stream_reuse_last_link_enabled",
              "boolean",
              next,
            )
          }
        />
        {settings.player.reuseLastStream && (
          <label className="setting-text-row">
            <span>
              <strong>Reuse for</strong>
              <small>Hours before a remembered link is resolved again. 1 to 720.</small>
            </span>
            <input
              type="number"
              min="1"
              max="720"
              value={settings.player.reuseLastStreamHours}
              disabled={!settingsReady}
              onChange={(event) =>
                onTypedSetting(
                  "player_settings",
                  "stream_reuse_last_link_cache_hours",
                  "int",
                  Number(event.target.value),
                )
              }
            />
          </label>
        )}
        <SettingToggle
          title="Skip intro"
          description="Syncs Nuvio's skip preference. Web skip-segment fetching is not available yet."
          checked={settings.player.skipIntroEnabled}
          disabled={!settingsReady}
          onChange={(next) =>
            onTypedSetting(
              "player_settings",
              "skip_intro_enabled",
              "boolean",
              next,
            )
          }
        />
        <IntegrationCredentialField
          label="AnimeSkip client ID"
          description="Optional provider credential synced through Nuvio's separate credential row."
          value={animeSkipClientId}
          ready={credentialsReady}
          onSave={(value) => onProviderCredential("animeskip", value)}
        />
        <IntegrationCredentialField
          label="IntroDB API key"
          description="Synced for Nuvio clients that support IntroDB; this web build does not submit segments."
          value={introDbApiKey}
          ready={credentialsReady}
          onSave={(value) => onProviderCredential("introdb", value)}
        />
      </div>
      <div
        className="setting-card settings-category-card"
        hidden={category !== "playback"}
      >
        <header>
          <h2>Audio & subtitles</h2>
        </header>
        <label className="setting-select-row">
          <span>
            <strong>Preferred audio</strong>
            <small>Applied to browser and HLS audio tracks when available.</small>
          </span>
          <select
            value={settings.player.preferredAudioLanguage}
            disabled={!settingsReady}
            onChange={(event) =>
              onTypedSetting(
                "player_settings",
                "preferred_audio_language",
                "string",
                event.target.value,
              )
            }
          >
            <option value="device">Device language</option>
            <option value="original">Original language</option>
            {LANGUAGE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="setting-select-row">
          <span>
            <strong>Fallback audio</strong>
            <small>Used when nothing matches the preferred language.</small>
          </span>
          <select
            value={settings.player.secondaryPreferredAudioLanguage}
            disabled={!settingsReady}
            onChange={(event) =>
              onTypedSetting(
                "player_settings",
                "secondary_preferred_audio_language",
                "string",
                event.target.value,
              )
            }
          >
            <option value="">None</option>
            <option value="original">Original language</option>
            {LANGUAGE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="setting-select-row">
          <span>
            <strong>Preferred subtitles</strong>
            <small>Selects matching embedded browser tracks when present.</small>
          </span>
          <select
            value={settings.player.preferredSubtitleLanguage}
            disabled={!settingsReady}
            onChange={(event) =>
              onTypedSetting(
                "player_settings",
                "preferred_subtitle_language",
                "string",
                event.target.value,
              )
            }
          >
            <option value="none">Off</option>
            <option value="forced">Forced only</option>
            <option value="device">Device language</option>
            {LANGUAGE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="setting-select-row">
          <span>
            <strong>Fallback subtitles</strong>
            <small>Used when nothing matches the preferred language.</small>
          </span>
          <select
            value={settings.player.secondaryPreferredSubtitleLanguage}
            disabled={!settingsReady}
            onChange={(event) =>
              onTypedSetting(
                "player_settings",
                "secondary_preferred_subtitle_language",
                "string",
                event.target.value,
              )
            }
          >
            <option value="">None</option>
            <option value="forced">Forced only</option>
            {LANGUAGE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <SettingToggle
          title="Use forced subtitles"
          description="Prefer forced subtitles when the audio already matches the subtitle language; if there is no forced track, show nothing."
          checked={settings.player.subtitleUseForcedSubtitles}
          disabled={!settingsReady}
          onChange={(next) =>
            onTypedSetting(
              "player_settings",
              "subtitle_use_forced_subtitles",
              "boolean",
              next,
            )
          }
        />
        <div className="setting-grid subtitle-grid">
          <label>
            <span>Font size</span>
            <input
              type="number"
              min="6"
              max="40"
              value={settings.player.subtitleFontSizeSp}
              disabled={!settingsReady}
              onChange={(event) =>
                onTypedSetting(
                  "player_settings",
                  "subtitle_font_size_sp",
                  "int",
                  Number(event.target.value),
                )
              }
            />
          </label>
          <label>
            <span>Bottom offset</span>
            <input
              type="number"
              min="0"
              max="100"
              value={settings.player.subtitleBottomOffset}
              disabled={!settingsReady}
              onChange={(event) =>
                onTypedSetting(
                  "player_settings",
                  "subtitle_bottom_offset",
                  "int",
                  Number(event.target.value),
                )
              }
            />
          </label>
          <label>
            <span>Text color (ARGB)</span>
            <input
              value={settings.player.subtitleTextColor}
              disabled={!settingsReady}
              onChange={(event) =>
                onTypedSetting(
                  "player_settings",
                  "subtitle_text_color",
                  "string",
                  event.target.value,
                )
              }
            />
          </label>
          <label>
            <span>Background (ARGB)</span>
            <input
              value={settings.player.subtitleBackgroundColor}
              disabled={!settingsReady}
              onChange={(event) =>
                onTypedSetting(
                  "player_settings",
                  "subtitle_background_color",
                  "string",
                  event.target.value,
                )
              }
            />
          </label>
        </div>
        <SettingToggle
          title="Bold subtitles"
          description="Uses the synchronized subtitle font weight."
          checked={settings.player.subtitleBold}
          disabled={!settingsReady}
          onChange={(next) =>
            onTypedSetting(
              "player_settings",
              "subtitle_bold",
              "boolean",
              next,
            )
          }
        />
        <SettingToggle
          title="Subtitle outline"
          description="Adds a contrast outline around browser-rendered cues."
          checked={settings.player.subtitleOutlineEnabled}
          disabled={!settingsReady}
          onChange={(next) =>
            onTypedSetting(
              "player_settings",
              "subtitle_outline_enabled",
              "boolean",
              next,
            )
          }
        />
      </div>
      <div
        className="setting-card settings-category-card"
        hidden={category !== "playback"}
      >
        <header>
          <h2>Sources</h2>
        </header>
        <SettingToggle
          title="File-size badges"
          description="Show the stream's reported size beside imported badges."
          checked={settings.streamBadges.showFileSizeBadges}
          disabled={!settingsReady}
          onChange={(next) =>
            onTypedSetting(
              "stream_badge_settings",
              "show_file_size_badges",
              "boolean",
              next,
            )
          }
        />
        <label className="setting-select-row">
          <span>
            <strong>Badge placement</strong>
            <small>
              {settings.streamBadges.filters.length} enabled imported badge
              {settings.streamBadges.filters.length === 1 ? "" : "s"} loaded.
            </small>
          </span>
          <select
            value={settings.streamBadges.placement}
            disabled={!settingsReady}
            onChange={(event) =>
              onTypedSetting(
                "stream_badge_settings",
                "stream_badge_placement",
                "string",
                event.target.value,
              )
            }
          >
            <option value="TOP">Above details</option>
            <option value="BOTTOM">Below details</option>
          </select>
        </label>
      </div>
      {/* Only where there is a folder to name. A browser downloads through the
          browser and has nowhere of its own to put anything. */}
      {platform.downloads && (
        <div hidden={category !== "app"}>
          <DownloadSettings downloads={platform.downloads} />
        </div>
      )}
      <div
        className="setting-card settings-category-card"
        hidden={category !== "app"}
      >
        <header>
          <h2>Notifications</h2>
        </header>
        <SettingToggle
          title="Episode release alerts"
          description="Syncs the exact raw notification payload used by Nuvio. Browser delivery still requires notification permission and web push support."
          checked={settings.episodeReleaseAlerts}
          disabled={!settingsReady}
          onChange={(next) =>
            onRawSetting(
              "notifications_settings",
              "episode_release_alerts_enabled",
              next,
            )
          }
        />
      </div>
      <div
        className="setting-card settings-category-card"
        hidden={category !== "app"}
      >
        <header>
          <h2>Account</h2>
        </header>
        <div className="info-row">
          <UserRound />
          <span>
            <strong>{profile?.name}</strong>
            <small>{session.user.email}</small>
          </span>
        </div>
        <div className="info-row">
          <Settings />
          <span>
            <strong>
              {session.backend.selfHosted
                ? "Self-hosted backend"
                : "Official backend"}
            </strong>
            <small>{session.backend.url}</small>
          </span>
        </div>
        <button className="danger" onClick={onSignOut}>
          <LogOut /> Sign out on this device
        </button>
      </div>
      <div
        className="setting-card settings-category-card"
        hidden={category !== "app"}
      >
        <header>
          <h2>App version</h2>
        </header>
        <UpdateRow />
      </div>
      <div
        className="setting-card settings-category-card"
        hidden={category !== "app"}
      >
        <header>
          <h2>Install as an app</h2>
        </header>
        <p>
          On iPhone or iPad, open Safari’s Share menu and choose{" "}
          <b>Add to Home Screen</b>. On desktop Chrome or Edge, use the install
          icon in the address bar.
        </p>
      </div>
        </div>
      </section>
      </div>
    </section>
  );
}
