// Boot tests for background.ts — the service-worker context.
//
// It is tiny: apply the popup's debug switch, log that the worker is up, and log
// installs. Two things are worth pinning, and both are claims its own comment
// makes: the switch can only be applied asynchronously, so the cold-start line is
// emitted before the switch is known (that is why it may be missing in a release
// build), and an install event afterwards does log — which is the line a
// developer actually goes looking for when the switch seems dead.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPLETION_STORAGE_KEY,
  SHOW_PANEL_REQUEST_KEY,
  buildCompletionRecord,
} from "../content/completion-notice";

const DEBUG_KEY = "cindieh:debug";
const WORKER_URL = "chrome-extension://abcdefghijklmnop/background/background.js";
const ICON_URL = "chrome-extension://abcdefghijklmnop/icons/icon128.png";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => void;

function makeFakeBrowser(
  store: Map<string, unknown>,
  options: { readThrows?: boolean; heldRead?: { promise: Promise<Record<string, unknown>> } } = {},
) {
  const onInstalled: Array<() => void> = [];
  const onChanged: StorageChangeListener[] = [];
  const onNotificationClicked: Array<(id: string) => void> = [];
  const notifications = {
    // Typed so the assertions can read the (id, options) the worker passed.
    create: vi.fn(
      async (
        id: string,
        options: { type: string; iconUrl: string; title: string; message: string },
      ) => `${id}:${options.type}`,
    ),
    onClicked: {
      addListener: (fn: (id: string) => void) => {
        onNotificationClicked.push(fn);
      },
    },
  };
  const tabs = {
    query: vi.fn(async () => [] as Array<{ id?: number; windowId?: number; active?: boolean }>),
    update: vi.fn(async () => undefined),
  };
  const windows = { update: vi.fn(async () => undefined) };
  const storageSet = vi.fn(async () => undefined);
  return {
    onInstalled,
    onChanged,
    onNotificationClicked,
    notifications,
    tabs,
    windows,
    storageSet,
    api: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => {
            if (options.readThrows) throw new Error("storage disabled");
            // A held read models real storage latency, which is what the
            // documented cold-start race depends on.
            if (options.heldRead) return options.heldRead.promise;
            return store.has(key) ? { [key]: store.get(key) } : {};
          }),
          set: storageSet,
        },
        onChanged: {
          addListener: (fn: StorageChangeListener) => {
            onChanged.push(fn);
          },
        },
      },
      notifications,
      tabs,
      windows,
      runtime: {
        onInstalled: {
          addListener: (fn: () => void) => {
            onInstalled.push(fn);
          },
        },
        getURL: (assetPath: string) => `chrome-extension://abcdefghijklmnop/${assetPath}`,
      },
    },
  };
}

async function bootBackground(
  options: { store?: Map<string, unknown>; readThrows?: boolean; holdRead?: boolean } = {},
) {
  const store = options.store ?? new Map<string, unknown>();
  const held = deferred<Record<string, unknown>>();
  const fake = makeFakeBrowser(store, { ...options, heldRead: options.holdRead ? held : undefined });
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

  vi.stubGlobal("browser", fake.api);
  // A service worker has this location and no page storage at all.
  vi.stubGlobal("location", { href: WORKER_URL });
  vi.stubGlobal("localStorage", undefined);

  vi.resetModules();
  await import("../background/background");

  const debug = await import("../content/debug");
  const settle = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };

  return {
    store,
    onInstalled: fake.onInstalled,
    onChanged: fake.onChanged,
    onNotificationClicked: fake.onNotificationClicked,
    notifications: fake.notifications,
    tabs: fake.tabs,
    windows: fake.windows,
    storageSet: fake.storageSet,
    log,
    debug,
    settle,
    /** Fire a storage change as the browser would when a key is written. */
    emitChange(key: string, newValue: unknown, areaName = "local"): void {
      for (const fn of fake.onChanged) fn({ [key]: { newValue } }, areaName);
    },
    /** Click a notification by id, as the browser reports it. */
    emitNotificationClick(notificationId: string): void {
      for (const fn of fake.onNotificationClicked) fn(notificationId);
    },
    /** Release a held read (see holdRead) with the stored keys to apply. */
    async resolveRead(keys: Record<string, unknown> = {}): Promise<void> {
      held.resolve(keys);
      await settle();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("background boot", () => {
  it("registers one install listener", async () => {
    const env = await bootBackground();

    expect(env.onInstalled).toHaveLength(1);
  });

  it("emits the cold-start line while the switch is still unknown", async () => {
    // Documented race, pinned with a held read: the startup line runs before
    // the stored switch is known, so a switch that is really ON still misses it.
    const env = await bootBackground({ holdRead: true });

    expect(env.debug.isDebugEnabled()).toBe(false);
    expect(env.log).not.toHaveBeenCalled();

    await env.resolveRead({ [DEBUG_KEY]: true });

    expect(env.debug.isDebugEnabled()).toBe(true);
    // The line was already emitted (and dropped) — it is not replayed.
    expect(env.log).not.toHaveBeenCalled();

    env.onInstalled[0]();
    expect(env.log).toHaveBeenCalledTimes(1);
  });

  it("logs the install event once the switch has been applied", async () => {
    const env = await bootBackground({ store: new Map([[DEBUG_KEY, true]]) });
    await env.settle();
    env.log.mockClear();

    env.onInstalled[0]();

    expect(env.log).toHaveBeenCalledTimes(1);
    expect(env.log.mock.calls[0][0]).toBe("[Cindieh]");
  });

  it("stays silent with no switch stored", async () => {
    const env = await bootBackground();
    await env.settle();

    env.onInstalled[0]();

    expect(env.debug.isDebugEnabled()).toBe(false);
    expect(env.log).not.toHaveBeenCalled();
  });

  it("survives an unreadable preference and still listens for installs", async () => {
    const env = await bootBackground({ readThrows: true });
    await env.settle();

    expect(env.onInstalled).toHaveLength(1);
    expect(env.debug.isDebugEnabled()).toBe(false);
    env.onInstalled[0]();
    expect(env.log).not.toHaveBeenCalled();
  });
});

describe("background — completion notifications", () => {
  it("registers one storage listener", async () => {
    const env = await bootBackground();

    expect(env.onChanged).toHaveLength(1);
  });

  it("announces a fresh completion with the extension icon", async () => {
    const env = await bootBackground();

    env.emitChange(
      COMPLETION_STORAGE_KEY,
      buildCompletionRecord("scrape", "120 data diproses, tanpa kegagalan."),
    );
    await env.settle();

    expect(env.notifications.create).toHaveBeenCalledOnce();
    const [, options] = env.notifications.create.mock.calls[0];
    expect(options.title).toBe("Ekspor data selesai");
    expect(options.message).toBe("120 data diproses, tanpa kegagalan.");
    expect(options.iconUrl).toBe(ICON_URL);
  });

  it("labels a bulk PDF completion as a download", async () => {
    const env = await bootBackground();

    env.emitChange(COMPLETION_STORAGE_KEY, buildCompletionRecord("pdf", "8 data diproses."));
    await env.settle();

    const [, options] = env.notifications.create.mock.calls[0];
    expect(options.title).toBe("Unduhan PDF selesai");
  });

  it("drops a record left over from an earlier session", async () => {
    const env = await bootBackground();
    const stale = buildCompletionRecord("scrape", "lama.", Date.now() - 5 * 60_000);

    env.emitChange(COMPLETION_STORAGE_KEY, stale);
    await env.settle();

    // The tab that wrote it is long gone; announcing it now would be a toast
    // for something the user never watched finish.
    expect(env.notifications.create).not.toHaveBeenCalled();
  });

  it("ignores another storage area and unrecognizable payloads", async () => {
    const env = await bootBackground();

    env.emitChange(COMPLETION_STORAGE_KEY, buildCompletionRecord("scrape", "x"), "sync");
    env.emitChange(COMPLETION_STORAGE_KEY, { kind: "nonsense", id: 1, at: Date.now() });
    env.emitChange(COMPLETION_STORAGE_KEY, null);
    await env.settle();

    expect(env.notifications.create).not.toHaveBeenCalled();
  });

  it("contains a rejected create instead of leaking an unhandled rejection", async () => {
    const env = await bootBackground();
    env.notifications.create.mockRejectedValueOnce(new Error("permission revoked"));

    env.emitChange(COMPLETION_STORAGE_KEY, buildCompletionRecord("scrape", "x"));

    await expect(env.settle()).resolves.toBeUndefined();
  });
});

describe("background — a clicked completion toast", () => {
  const PORTAL_URL = "https://coretaxdjp.pajak.go.id/*";

  it("registers one notification-click listener", async () => {
    const env = await bootBackground();

    expect(env.onNotificationClicked).toHaveLength(1);
  });

  it("brings the portal tab forward and asks its panel to open", async () => {
    const env = await bootBackground();
    env.tabs.query.mockResolvedValue([{ id: 7, windowId: 3, active: false }]);

    env.emitNotificationClick("cindieh-completion-123");
    await env.settle();

    expect(env.tabs.query).toHaveBeenCalledWith({ url: PORTAL_URL });
    expect(env.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(env.windows.update).toHaveBeenCalledWith(3, { focused: true });
    // Focusing the window is not enough: the panel is where the reason the toast
    // fired is written, and the user may have collapsed it.
    expect(env.storageSet).toHaveBeenCalledWith({ [SHOW_PANEL_REQUEST_KEY]: expect.any(Number) });
  });

  it("reaches a background-window tab without stealing focus from the wrong one", async () => {
    const env = await bootBackground();
    env.tabs.query.mockResolvedValue([
      { id: 1, windowId: 5, active: false },
      { id: 2, windowId: 6, active: true },
    ]);

    env.emitNotificationClick("cindieh-completion-9");
    await env.settle();

    expect(env.tabs.update).toHaveBeenCalledTimes(1);
    expect(env.tabs.update).toHaveBeenCalledWith(2, { active: true });
    expect(env.windows.update).toHaveBeenCalledWith(6, { focused: true });
  });

  it("ignores a notification that is not one of ours", async () => {
    const env = await bootBackground();

    env.emitNotificationClick("some-other-extension");
    await env.settle();

    expect(env.tabs.query).not.toHaveBeenCalled();
    expect(env.storageSet).not.toHaveBeenCalled();
  });

  it("still asks for the panel when the tab lookup fails", async () => {
    const env = await bootBackground();
    env.tabs.query.mockRejectedValueOnce(new Error("tabs unavailable"));

    env.emitNotificationClick("cindieh-completion-4");

    await expect(env.settle()).resolves.toBeUndefined();
    expect(env.storageSet).toHaveBeenCalledWith({ [SHOW_PANEL_REQUEST_KEY]: expect.any(Number) });
  });
});
