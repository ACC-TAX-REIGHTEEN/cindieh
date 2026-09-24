// Boot harness for main.ts — the content-script world entry.
//
// scraper-boot.unit.test.ts covers the MAIN world; this covers the isolated
// world that drives it. The parts worth pinning here are the ones a seam suite
// cannot see, because they exist only as wiring:
//
//   1. The async debug gate. main.ts applies the popup's switch and mirrors it
//      into the page's storage, and the MAIN-world scraper resolves its log flag
//      at module load — so scraper.js must not be appended until that read has
//      finished, or the scraper would boot with the wrong flag.
//   2. One-time injection (ADR-0008). The marker element is the guard, including
//      across the await, and a failed load must clear it so injection retries.
//   3. The bridge handshake: the token the scraper reads from its own src is the
//      token every FROM_CONTENT message carries.
//   4. Live reaction to the switch while the page is open, and the safe cleanup
//      that keeps it from outliving the switch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFakeDom, type FakeEl, type FakeListener } from "./__mocks__/fake-dom";

const MARKER_ID = "__ch_scraper_injected__";
const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnop";
const PORTAL_ORIGIN = "https://coretaxdjp.pajak.go.id";
const SPT_URL = `${PORTAL_ORIGIN}/returnsheets-portal/value-added-tax-return`;
const INPUT_TAX_URL = `${PORTAL_ORIGIN}/e-invoice-portal/input-tax`;
const OUTPUT_TAX_URL = `${PORTAL_ORIGIN}/e-invoice-portal/output-tax`;
/** `SEARCH_CLICK_DELAY_MS` in main-actions.ts: the click is deferred, not immediate. */
const SEARCH_CLICK_DELAY_MS = 100;
const EXPORT_MODE_KEY = "cindiehExportMode";
const DEBUG_KEY = "cindieh:debug";
const MIRROR_MARKER_KEY = "cindieh:debug:ext";
const ENABLED_KEY = "cindiehEnabled";
const DELAY_PRESET_KEY = "cindiehDelayPreset";
const PACING_STORAGE_KEY = "cindieh:pacing";

// ── Doubles ───────────────────────────────────────────

interface BootWindow {
  location: { href: string; origin: string };
  postMessage(msg: Record<string, unknown>, origin?: string): void;
  addEventListener(type: string, fn: FakeListener): void;
  removeEventListener(type: string, fn: FakeListener): void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  getComputedStyle(): Record<string, string>;
  scrollY: number;
  scrollX: number;
  innerWidth: number;
  innerHeight: number;
}

/** localStorage double with an operation log, so ordering can be asserted. */
function makePageStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const ops: string[] = [];
  return {
    map,
    ops,
    storage: {
      getItem: vi.fn((key: string) => (map.has(key) ? (map.get(key) as string) : null)),
      setItem: vi.fn((key: string, value: string) => {
        map.set(key, value);
        ops.push(`set:${key}`);
      }),
      removeItem: vi.fn((key: string) => {
        map.delete(key);
        ops.push(`remove:${key}`);
      }),
    },
  };
}

/** The storage.local read main.ts awaits; resolved by the test, not the stub. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** MutationObserver double: main.ts registers one callback, tests fire it. */
class FakeMutationObserver {
  static latest: FakeMutationObserver | null = null;

  readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    FakeMutationObserver.latest = this;
  }

  observe(): void {
    // No-op: the harness drives the callback directly.
  }

  disconnect(): void {
    // No-op.
  }

  trigger(): void {
    this.callback();
  }
}

function makeBootWindow(location: { href: string; origin: string }) {
  const listeners = new Map<string, FakeListener[]>();
  const messages: Array<{ data: Record<string, unknown>; targetOrigin: string | undefined }> = [];

  const win: BootWindow = {
    location,
    postMessage(data, targetOrigin) {
      messages.push({ data: data as Record<string, unknown>, targetOrigin });
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)?.push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx > -1) list.splice(idx, 1);
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    getComputedStyle: () => ({}),
    scrollY: 0,
    scrollX: 0,
    innerWidth: 1280,
    innerHeight: 800,
  };

  const fire = (type: string, event?: unknown): void => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
  };

  return { win, messages, fire, listenerCount: (type: string) => listeners.get(type)?.length ?? 0 };
}

/** Let every pending promise chain settle (the gate spans several awaits). */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

// ── Boot ──────────────────────────────────────────────

async function bootMain(options: { href?: string; pageStorage?: ReturnType<typeof makePageStorage> } = {}) {
  const { doc } = stubFakeDom();
  const page = options.pageStorage ?? makePageStorage();
  const location = { href: options.href ?? SPT_URL, origin: PORTAL_ORIGIN };
  const { win, messages, fire, listenerCount } = makeBootWindow(location);

  const stored = deferred<Record<string, unknown>>();
  const onChanged: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void> = [];

  vi.stubGlobal("window", win);
  vi.stubGlobal("location", location);
  vi.stubGlobal("localStorage", page.storage);
  vi.stubGlobal("MutationObserver", FakeMutationObserver);
  vi.stubGlobal("browser", {
    storage: {
      // loadExportModePreference() and the debug read share this promise: the
      // test can hold both back until it decides the gate should open.
      local: { get: vi.fn(() => stored.promise), set: vi.fn(async () => undefined) },
      onChanged: {
        addListener: (fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => {
          onChanged.push(fn);
        },
      },
    },
    runtime: { getURL: (path: string) => `${EXTENSION_ORIGIN}/${path}` },
  });

  vi.resetModules();
  await import("../content/main");

  /** How the popup's write reaches this tab. */
  const emitStorageChange = (changes: Record<string, { newValue?: unknown }>, area = "local"): void => {
    for (const fn of [...onChanged]) fn(changes, area);
  };

  return {
    doc,
    page,
    location,
    win,
    messages,
    fire,
    listenerCount,
    emitStorageChange,
    /** Fire a document-level listener (main.ts registers its keyup seam there). */
    fireDoc(type: string, event?: unknown): void {
      for (const fn of [...(doc.listeners.get(type) ?? [])]) fn(event);
    },
    /** Resolve the held-back storage read with the given stored keys. */
    async resolveStored(keys: Record<string, unknown> = {}): Promise<void> {
      stored.resolve(keys);
      await flush();
    },
    /** The injected script element, if injection already happened. */
    script(): FakeEl | null {
      return doc.getElementById(MARKER_ID);
    },
    scriptCount(): number {
      return doc.head.children.filter((c) => c.tagName === "script").length;
    },
    /** Fire main.ts's MutationObserver after changing the URL. */
    navigate(href: string): void {
      location.href = href;
      FakeMutationObserver.latest?.trigger();
    },
    /** The token the scraper would read from its own src (bridge handshake). */
    token(): string {
      const src = (this.script() as FakeEl | null)?.src ?? "";
      return decodeURIComponent(new RegExp("[?&]token=([^&]*)").exec(src)?.[1] ?? "");
    },
  };
}

beforeEach(() => {
  // The badge refresh and the delayed grid-filter injection are timers; keep
  // them from firing mid-assertion.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
  FakeMutationObserver.latest = null;
});

// ── The async gate & mirror ordering ──────────────────

// ── Popup preferences ─────────────────────────────────

describe("main boot — popup preferences", () => {
  const badge = (env: Awaited<ReturnType<typeof bootMain>>) =>
    env.doc.getElementById("ch-floating-info-container");

  it("paints nothing at all while the master switch reads as off", async () => {
    const env = await bootMain();

    env.fire("load");
    await env.resolveStored({ [ENABLED_KEY]: false });

    // Not "paints then removes": the first paint waits for the stored value, so
    // a disabled extension never flashes a toolbar into the page.
    expect(badge(env)).toBeNull();
    expect(env.script()).toBeNull();
    // The pacing mirror IS written either way. It is not part of the UI, and
    // writing it now is what lets a later re-enable pace correctly without a
    // reload — the scraper reads it when a run starts.
    expect(env.page.map.get(PACING_STORAGE_KEY)).toBe("normal");
  });

  it("paints on open when the switch is on, then removes it when the popup flips it off", async () => {
    const env = await bootMain();

    env.fire("load");
    await env.resolveStored({ [ENABLED_KEY]: true });
    expect(badge(env)).not.toBeNull();

    env.emitStorageChange({ [ENABLED_KEY]: { newValue: false } });

    expect(badge(env)).toBeNull();
    // The scraper keeps its prototype patches (see AGENTS.md), so it has to be
    // told to drop the captured request instead.
    expect(env.messages.some((m) => m.data.type === "RESET_SCRAPER")).toBe(true);
  });

  it("restores the toolbar when the switch is turned back on, without a reload", async () => {
    const env = await bootMain();

    env.fire("load");
    await env.resolveStored({ [ENABLED_KEY]: false });
    expect(badge(env)).toBeNull();

    env.emitStorageChange({ [ENABLED_KEY]: { newValue: true } });

    expect(badge(env)).not.toBeNull();
  });

  it("mirrors the pacing preset into page storage and follows a later change", async () => {
    const env = await bootMain();

    env.fire("load");
    await env.resolveStored({ [DELAY_PRESET_KEY]: "sabar" });

    // The MAIN world cannot read extension storage; page storage is the channel.
    expect(env.page.map.get(PACING_STORAGE_KEY)).toBe("sabar");

    env.emitStorageChange({ [DELAY_PRESET_KEY]: { newValue: "normal" } });

    expect(env.page.map.get(PACING_STORAGE_KEY)).toBe("normal");
  });

  it("ignores a storage area that is not `local`", async () => {
    const env = await bootMain();

    env.fire("load");
    await env.resolveStored({ [ENABLED_KEY]: true });

    env.emitStorageChange({ [ENABLED_KEY]: { newValue: false } }, "sync");

    // Nothing in this extension reads `sync`; a change there must not act.
    expect(badge(env)).not.toBeNull();
  });
});

describe("main boot — async debug gate", () => {
  it("holds scraper injection until the stored switch has been read", async () => {
    const env = await bootMain();

    env.fire("load");
    await flush();

    // The storage read is still pending: nothing may be injected yet.
    expect(env.script()).toBeNull();

    await env.resolveStored({ [DEBUG_KEY]: true });

    expect(env.script()).not.toBeNull();
  });

  it("writes the page mirror BEFORE the script element exists", async () => {
    const env = await bootMain();
    const appendSpy = vi.spyOn(env.doc.head, "appendChild");

    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: true });

    expect(env.page.ops.indexOf(`set:${DEBUG_KEY}`)).toBeGreaterThan(-1);
    // Ordering is the whole point: a mirror written after the append would only
    // be seen on the next page load, which is exactly what this feature fixes.
    const mirrorWrite = env.page.storage.setItem.mock.invocationCallOrder[0];
    const scriptAppend = appendSpy.mock.invocationCallOrder[0];
    expect(mirrorWrite).toBeLessThan(scriptAppend);
  });

  it("copies an on switch as the debug key plus the ownership marker", async () => {
    const env = await bootMain();

    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: true });

    expect(env.page.map.get(DEBUG_KEY)).toBe("1");
    expect(env.page.map.get(MIRROR_MARKER_KEY)).toBe("1");
  });

  it("cleans a previously mirrored value up when the switch is off", async () => {
    const page = makePageStorage({ [DEBUG_KEY]: "1", [MIRROR_MARKER_KEY]: "1" });
    const env = await bootMain({ pageStorage: page });

    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: false });

    expect(page.map.has(DEBUG_KEY)).toBe(false);
    expect(page.map.has(MIRROR_MARKER_KEY)).toBe(false);
  });

  it("leaves a hand-set page value alone when no switch was ever stored", async () => {
    // No marker: the developer set this in DevTools, so it is not ours to clear.
    const page = makePageStorage({ [DEBUG_KEY]: "1" });
    const env = await bootMain({ pageStorage: page });

    env.fire("load");
    await env.resolveStored({ [EXPORT_MODE_KEY]: "raw" });

    expect(page.map.get(DEBUG_KEY)).toBe("1");
    expect(page.storage.removeItem).not.toHaveBeenCalled();
  });

  it("applies the stored switch to this context's own logger too", async () => {
    const env = await bootMain();
    const debug = await import("../content/debug");

    expect(debug.isDebugEnabled()).toBe(false);

    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: true });

    expect(debug.isDebugEnabled()).toBe(true);
  });
});

// ── Injection shape & one-time marker ─────────────────

describe("main boot — scraper injection", () => {
  it("injects content/scraper.js through runtime.getURL, carrying a token", async () => {
    const env = await bootMain();

    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: false });

    const script = env.script();
    expect(script?.src).toContain(`${EXTENSION_ORIGIN}/content/scraper.js`);
    expect(env.token()).not.toBe("");
  });

  it("keeps one script per page across repeated init (ADR-0008)", async () => {
    const env = await bootMain();
    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: false });

    env.fire("load");
    await flush();

    expect(env.scriptCount()).toBe(1);
  });

  it("keeps one script when two triggers overlap across the await", async () => {
    const env = await bootMain();

    // Both calls pass the marker check before the gate opens: init via `load`,
    // then a supported-page navigation through the observer. The re-check AFTER
    // the await is the load-bearing guard here — deleting just the pre-await
    // check still passes every test in this file, because an injection that
    // already happened is always caught once the gate opens. It is a fast path,
    // not the safety net; this test is what pins the actual one.
    env.fire("load");
    env.navigate(INPUT_TAX_URL);
    await env.resolveStored({ [DEBUG_KEY]: false });

    expect(env.scriptCount()).toBe(1);
  });

  it("drops the element on load failure so injection can be retried", async () => {
    const env = await bootMain();
    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: false });

    const first = env.script() as FakeEl & { onerror?: () => void };
    first.onerror?.();

    // The marker is gone, so the next attempt is allowed through...
    expect(env.doc.getElementById(MARKER_ID)).toBeNull();

    env.fire("load");
    await flush();

    // ...and it appends a fresh element rather than reviving the failed one.
    expect(env.script()).not.toBeNull();
    expect(env.script()).not.toBe(first);
    expect(env.scriptCount()).toBe(1);
  });

  it("sends RESET_SCRAPER on SPA navigation with the token from its own src", async () => {
    const env = await bootMain();
    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: false });

    env.navigate(INPUT_TAX_URL);

    const reset = env.messages.find((m) => m.data.type === "RESET_SCRAPER");
    expect(reset?.data).toMatchObject({ direction: "FROM_CONTENT", token: env.token() });
    expect(env.token()).not.toBe("");
  });
});

// ── Live switch changes ───────────────────────────────

describe("main boot — the switch while the page is open", () => {
  it("writes the mirror as soon as the switch is turned on", async () => {
    const env = await bootMain();
    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: false });

    env.emitStorageChange({ [DEBUG_KEY]: { newValue: true } });

    expect(env.page.map.get(DEBUG_KEY)).toBe("1");
    expect(env.page.map.get(MIRROR_MARKER_KEY)).toBe("1");
  });

  it("removes the mirror as soon as the switch is turned off", async () => {
    const env = await bootMain();
    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: true });
    expect(env.page.map.has(DEBUG_KEY)).toBe(true);

    env.emitStorageChange({ [DEBUG_KEY]: { newValue: false } });

    expect(env.page.map.has(DEBUG_KEY)).toBe(false);
    expect(env.page.map.has(MIRROR_MARKER_KEY)).toBe(false);
  });

  it("ignores changes from a storage area other than local", async () => {
    const env = await bootMain();
    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: false });
    const debug = await import("../content/debug");
    const writes = env.page.storage.setItem.mock.calls.length;

    env.emitStorageChange({ [DEBUG_KEY]: { newValue: true } }, "sync");

    expect(env.page.storage.setItem.mock.calls.length).toBe(writes);
    expect(env.page.map.has(DEBUG_KEY)).toBe(false);
    void debug;
  });

  it("leaves the mirror alone when only the export mode changed", async () => {
    const env = await bootMain();
    env.fire("load");
    await env.resolveStored({ [DEBUG_KEY]: true });
    const writes = env.page.storage.setItem.mock.calls.length;

    env.emitStorageChange({ [EXPORT_MODE_KEY]: { newValue: "raw" } });

    expect(env.page.storage.setItem.mock.calls.length).toBe(writes);
    expect(env.page.storage.removeItem).not.toHaveBeenCalled();
  });
});

// ── Reference search ──────────────────────────────────

// The one half of the measured fix (tools/README.md, 24 Sep 2026) that remains
// after ADR-0012: the search asks for the fast prefix mode, and when the
// scraper reports that the prefix found nothing, the panel says so and the
// search stops — no wide-match retry click.

describe("main boot — reference search", () => {
  /** Open the output-tax page with the extension on, and land a portal Cari button. */
  async function bootOutputTax() {
    const env = await bootMain({ href: OUTPUT_TAX_URL });
    env.fire("load");
    // Stored defaults only: this suite is about the reference search, not about
    // which switch happens to gate the first paint.
    await env.resolveStored({});

    // triggerSearch() finds this through document.querySelectorAll("button").
    const cari = { id: "", textContent: "Cari", querySelector: () => null, click: vi.fn() };
    env.doc.buttons.push(cari as unknown as FakeEl);
    return { env, cari };
  }

  it("sends the fast prefix mode from the grid filter and from the comparer event", async () => {
    const { env } = await bootOutputTax();

    env.fireDoc("keyup", { key: "Enter", target: { id: "ch-grid-filter-reference", value: " ee-0300 " } });
    env.fireDoc("ch:search-reference", { detail: { reference: "ee-0301" } });

    const filters = env.messages.filter((m) => m.data.type === "SET_SERVER_FILTER");
    expect(filters.map((m) => m.data)).toEqual([
      // Trimmed and uppercased: the server's Reference filter is case-sensitive.
      expect.objectContaining({ field: "Reference", value: "EE-0300", matchMode: "startswith" }),
      expect.objectContaining({ field: "Reference", value: "EE-0301", matchMode: "startswith" }),
    ]);
  });

  it("reports not found in the panel and does not search again when the prefix match is empty", async () => {
    const { env, cari } = await bootOutputTax();

    env.fireDoc("keyup", { key: "Enter", target: { id: "ch-grid-filter-reference", value: "EE-0300" } });
    vi.advanceTimersByTime(SEARCH_CLICK_DELAY_MS);
    expect(cari.click).toHaveBeenCalledTimes(1);

    env.fire("message", {
      source: env.win,
      origin: PORTAL_ORIGIN,
      data: {
        type: "REFERENCE_SEARCH_NOT_FOUND",
        value: "EE-0300",
        direction: "FROM_PAGE",
        token: env.token(),
      },
    });

    // The search ends with the miss report: the empty grid already rendered,
    // and nothing asks the portal to run the minutes-long wide match.
    expect(env.doc.getElementById("ch-f-status")!.textContent).toContain('tidak ditemukan');
    vi.advanceTimersByTime(SEARCH_CLICK_DELAY_MS);
    expect(cari.click).toHaveBeenCalledTimes(1);
    expect(env.messages.filter((m) => m.data.type === "SET_SERVER_FILTER")).toHaveLength(1);
  });

  it("ignores a not-found notice with the wrong token", async () => {
    const { env, cari } = await bootOutputTax();

    env.fire("message", {
      source: env.win,
      origin: PORTAL_ORIGIN,
      data: { type: "REFERENCE_SEARCH_NOT_FOUND", value: "EE-0300", direction: "FROM_PAGE", token: "spoofed" },
    });
    vi.advanceTimersByTime(SEARCH_CLICK_DELAY_MS);

    expect(cari.click).not.toHaveBeenCalled();
  });
});
