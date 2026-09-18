// Unit tests for debug-preference.ts — the extension-storage bridge behind the
// popup's "Log debug" switch.
//
// The contract that matters: the switch covers the contexts that cannot read the
// page-level hooks (content script, background, popup), it stores exactly the key
// the docs name, and it can never overturn a more explicit intent — a `?chdebug`
// URL value or a programmatic enableDebug()/disableDebug() call.
//
// The second contract is the page mirror: the MAIN-world scraper can only read
// the page's own storage, so the switch has to be copied there — and copied back
// out again when it is turned off, without ever deleting a value the developer
// set by hand.
import { afterEach, describe, expect, it, vi } from "vitest";

/** Minimal localStorage double, so the mirror can be exercised without a DOM. */
function makeFakePageStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    storage: {
      getItem: vi.fn((key: string) => (map.has(key) ? (map.get(key) as string) : null)),
      setItem: vi.fn((key: string, value: string) => {
        map.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        map.delete(key);
      }),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Minimal chrome/browser.storage.local double backed by a Map. */
function makeFakeBrowser(store: Map<string, unknown>) {
  return {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {})),
        set: vi.fn(async (payload: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(payload)) store.set(k, v);
        }),
      },
    },
  };
}

/**
 * Load fresh copies of both modules with `browser` stubbed and, optionally, a
 * page URL. browser-shim resolves the global at import time, so the stub has to
 * be in place before the dynamic import.
 */
async function loadModules(options: { store?: Map<string, unknown>; href?: string } = {}) {
  const store = options.store ?? new Map<string, unknown>();
  vi.stubGlobal("browser", makeFakeBrowser(store));
  if (options.href) vi.stubGlobal("location", { href: options.href });
  vi.resetModules();
  const debug = await import("../content/debug");
  const preference = await import("../content/debug-preference");
  return { debug, preference, store };
}

describe("normalizeDebugPreference", () => {
  it("passes booleans through, which is what the popup writes", async () => {
    const { preference } = await loadModules();
    expect(preference.normalizeDebugPreference(true)).toBe(true);
    expect(preference.normalizeDebugPreference(false)).toBe(false);
  });

  it("maps hand-edited strings through the shared on/off words", async () => {
    const { preference } = await loadModules();
    for (const raw of ["1", "true", "ON", " yes "]) {
      expect(preference.normalizeDebugPreference(raw)).toBe(true);
    }
    for (const raw of ["0", "false", "off", "NO"]) {
      expect(preference.normalizeDebugPreference(raw)).toBe(false);
    }
  });

  it("treats anything else as unset", async () => {
    const { preference } = await loadModules();
    for (const raw of [null, undefined, "", "maybe", 1, {}]) {
      expect(preference.normalizeDebugPreference(raw)).toBeNull();
    }
  });
});

describe("readDebugPreference", () => {
  it("reads the stored boolean under the documented key", async () => {
    const { debug, preference, store } = await loadModules();
    store.set(debug.DEBUG_STORAGE_KEY, true);
    expect(await preference.readDebugPreference()).toBe(true);

    store.set(debug.DEBUG_STORAGE_KEY, false);
    expect(await preference.readDebugPreference()).toBe(false);
  });

  it("returns null when the switch was never set", async () => {
    const { preference } = await loadModules();
    expect(await preference.readDebugPreference()).toBeNull();
  });

  it("returns null instead of throwing when storage fails", async () => {
    vi.stubGlobal("browser", {
      storage: { local: { get: vi.fn(async () => { throw new Error("storage disabled"); }) } },
    });
    vi.resetModules();
    const preference = await import("../content/debug-preference");

    expect(await preference.readDebugPreference()).toBeNull();
  });

  it("returns null when there is no extension API at all", async () => {
    vi.stubGlobal("browser", undefined);
    vi.resetModules();
    const preference = await import("../content/debug-preference");

    expect(await preference.readDebugPreference()).toBeNull();
  });
});

describe("writeDebugPreference", () => {
  it("stores the flag as a boolean under the shared key", async () => {
    const { debug, preference, store } = await loadModules();

    await preference.writeDebugPreference(true);

    expect(store.get(debug.DEBUG_STORAGE_KEY)).toBe(true);
  });

  it("never throws when the write fails", async () => {
    vi.stubGlobal("browser", {
      storage: { local: { set: vi.fn(async () => { throw new Error("quota"); }) } },
    });
    vi.resetModules();
    const preference = await import("../content/debug-preference");

    await expect(preference.writeDebugPreference(true)).resolves.toBeUndefined();
  });
});

describe("initDebugFromExtensionStorage", () => {
  it("turns logging on when the switch is on and nothing else decided", async () => {
    const { debug, preference, store } = await loadModules();
    store.set(debug.DEBUG_STORAGE_KEY, true);

    expect(await preference.initDebugFromExtensionStorage()).toBe(true);
    expect(debug.isDebugEnabled()).toBe(true);
  });

  it("keeps logging off when the switch is off (no dev build, no page hook)", async () => {
    const { debug, preference, store } = await loadModules();
    store.set(debug.DEBUG_STORAGE_KEY, false);

    expect(await preference.initDebugFromExtensionStorage()).toBe(true);
    expect(debug.isDebugEnabled()).toBe(false);
  });

  it("does not apply when the switch was never set", async () => {
    const { debug, preference } = await loadModules();

    expect(await preference.initDebugFromExtensionStorage()).toBe(false);
    expect(debug.isDebugEnabled()).toBe(false);
  });

  it("never overturns ?chdebug=1 on the page URL", async () => {
    const store = new Map<string, unknown>();
    vi.stubGlobal("browser", makeFakeBrowser(store));
    vi.stubGlobal("location", { href: "https://x.test/p?chdebug=1" });
    vi.resetModules();
    const debug = await import("../content/debug");
    const preference = await import("../content/debug-preference");
    store.set(debug.DEBUG_STORAGE_KEY, false);

    expect(await preference.initDebugFromExtensionStorage()).toBe(false);
    expect(debug.isDebugEnabled()).toBe(true);
  });

  it("never overturns a programmatic enableDebug()/disableDebug() call", async () => {
    const { debug, preference, store } = await loadModules();
    store.set(debug.DEBUG_STORAGE_KEY, true);
    debug.disableDebug();

    expect(await preference.initDebugFromExtensionStorage()).toBe(false);
    expect(debug.isDebugEnabled()).toBe(false);
  });

  it("covers the background worker, which has no page URL and no page storage", async () => {
    // A service worker sees its own chrome-extension:// location and has no
    // localStorage; only extension storage can reach it.
    const store = new Map<string, unknown>();
    vi.stubGlobal("browser", makeFakeBrowser(store));
    vi.stubGlobal("location", { href: "chrome-extension://abc/background/background.js" });
    vi.resetModules();
    const debug = await import("../content/debug");
    const preference = await import("../content/debug-preference");
    store.set(debug.DEBUG_STORAGE_KEY, true);

    expect(debug.isDebugEnabled()).toBe(false); // resolved at load: no hook applies
    expect(await preference.initDebugFromExtensionStorage()).toBe(true);
    expect(debug.isDebugEnabled()).toBe(true);
  });
});

describe("mirrorDebugToPageWorld", () => {
  it("writes the on flag the scraper's own parser accepts, plus the ownership marker", async () => {
    const { debug, preference } = await loadModules();
    const page = makeFakePageStorage();
    vi.stubGlobal("localStorage", page.storage);

    preference.mirrorDebugToPageWorld(true);

    // Cross-check with the parser debug.ts uses to read that very key.
    expect(page.map.get(debug.DEBUG_STORAGE_KEY)).toBe("1");
    expect(debug.parseDebugFlag(page.storage.getItem(debug.DEBUG_STORAGE_KEY))).toBe(true);
    expect(page.map.get(preference.PAGE_MIRROR_MARKER_KEY)).toBe("1");
  });

  it("removes both keys when the switch goes off", async () => {
    const { debug, preference } = await loadModules();
    const page = makeFakePageStorage();
    vi.stubGlobal("localStorage", page.storage);

    preference.mirrorDebugToPageWorld(true);
    preference.mirrorDebugToPageWorld(false);

    expect(page.map.has(debug.DEBUG_STORAGE_KEY)).toBe(false);
    expect(page.map.has(preference.PAGE_MIRROR_MARKER_KEY)).toBe(false);
  });

  it("treats 'no stored preference' like off, so nothing lingers", async () => {
    const { debug, preference } = await loadModules();
    const page = makeFakePageStorage();
    vi.stubGlobal("localStorage", page.storage);

    preference.mirrorDebugToPageWorld(true);
    preference.mirrorDebugToPageWorld(null);

    expect(page.map.has(debug.DEBUG_STORAGE_KEY)).toBe(false);
  });

  it("never deletes a value the developer set by hand in DevTools", async () => {
    const { debug, preference } = await loadModules();
    // Source 3 without our marker: someone else's opt-in, not ours to clean up.
    const page = makeFakePageStorage({ [debug.DEBUG_STORAGE_KEY]: "1" });
    vi.stubGlobal("localStorage", page.storage);

    preference.mirrorDebugToPageWorld(false);
    preference.mirrorDebugToPageWorld(null);

    expect(page.map.get(debug.DEBUG_STORAGE_KEY)).toBe("1");
    expect(page.storage.removeItem).not.toHaveBeenCalled();
  });

  it("stays silent with no page storage, and when page storage throws", async () => {
    const { debug, preference } = await loadModules();

    // No localStorage at all (background worker, plain node).
    vi.stubGlobal("localStorage", undefined);
    expect(() => preference.mirrorDebugToPageWorld(true)).not.toThrow();

    // Partitioned/blocked storage: reads and writes both throw.
    const hostile = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      removeItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };
    vi.stubGlobal("localStorage", hostile);
    expect(() => preference.mirrorDebugToPageWorld(true)).not.toThrow();
    expect(() => preference.mirrorDebugToPageWorld(false)).not.toThrow();
    void debug;
  });
});

describe("initDebugForPageWorld", () => {
  it("applies the switch here and mirrors it into the page", async () => {
    const { debug, preference, store } = await loadModules();
    const page = makeFakePageStorage();
    vi.stubGlobal("localStorage", page.storage);
    store.set(debug.DEBUG_STORAGE_KEY, true);

    expect(await preference.initDebugForPageWorld()).toBe(true);
    expect(debug.isDebugEnabled()).toBe(true);
    expect(page.map.get(debug.DEBUG_STORAGE_KEY)).toBe("1");
  });

  it("mirrors the stored preference even when ?chdebug already decided this context", async () => {
    const store = new Map<string, unknown>();
    vi.stubGlobal("browser", makeFakeBrowser(store));
    vi.stubGlobal("location", { href: "https://x.test/p?chdebug=1" });
    const page = makeFakePageStorage();
    vi.stubGlobal("localStorage", page.storage);
    vi.resetModules();
    const debug = await import("../content/debug");
    const preference = await import("../content/debug-preference");
    store.set(debug.DEBUG_STORAGE_KEY, false);

    // Locally the URL wins...
    expect(await preference.initDebugForPageWorld()).toBe(false);
    expect(debug.isDebugEnabled()).toBe(true);
    // ...but the mirror carries the stored switch, and the page world applies
    // its own precedence on top of it.
    expect(page.map.has(debug.DEBUG_STORAGE_KEY)).toBe(false);
  });

  it("delivers the switch to a fresh context that can only read page storage", async () => {
    // The MAIN-world scraper: no browser API, no extension storage, no page URL
    // hook — only what the content script left in the page's localStorage.
    const { debug, preference, store } = await loadModules();
    const page = makeFakePageStorage();
    vi.stubGlobal("localStorage", page.storage);
    store.set(debug.DEBUG_STORAGE_KEY, true);
    await preference.initDebugForPageWorld();

    // Fresh module load, as if scraper.js had just been executed in the page.
    vi.stubGlobal("browser", undefined);
    vi.stubGlobal("location", { href: "https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax" });
    vi.resetModules();
    const scraperDebug = await import("../content/debug");

    expect(scraperDebug.isDebugEnabled()).toBe(true);
  });
});

describe("applyDebugPreference", () => {
  it("reports whether it applied, and is the only writer the async path uses", async () => {
    const { debug } = await loadModules();

    expect(debug.applyDebugPreference(true)).toBe(true);
    expect(debug.isDebugEnabled()).toBe(true);

    // A second application still works — unlike ?, this layer has no
    // "already decided" marker of its own.
    expect(debug.applyDebugPreference(false)).toBe(true);
    expect(debug.isDebugEnabled()).toBe(false);
  });

  it("ignores unset values", async () => {
    const { debug } = await loadModules();

    expect(debug.applyDebugPreference(null)).toBe(false);
    expect(debug.applyDebugPreference(undefined)).toBe(false);
    expect(debug.isDebugEnabled()).toBe(false);
  });
});
