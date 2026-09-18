// Boot tests for background.ts — the service-worker context.
//
// It is tiny: apply the popup's debug switch, log that the worker is up, and log
// installs. Two things are worth pinning, and both are claims its own comment
// makes: the switch can only be applied asynchronously, so the cold-start line is
// emitted before the switch is known (that is why it may be missing in a release
// build), and an install event afterwards does log — which is the line a
// developer actually goes looking for when the switch seems dead.
import { afterEach, describe, expect, it, vi } from "vitest";

const DEBUG_KEY = "cindieh:debug";
const WORKER_URL = "chrome-extension://abcdefghijklmnop/background/background.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeFakeBrowser(
  store: Map<string, unknown>,
  options: { readThrows?: boolean; heldRead?: { promise: Promise<Record<string, unknown>> } } = {},
) {
  const onInstalled: Array<() => void> = [];
  return {
    onInstalled,
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
        },
      },
      runtime: {
        onInstalled: {
          addListener: (fn: () => void) => {
            onInstalled.push(fn);
          },
        },
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
    log,
    debug,
    settle,
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
