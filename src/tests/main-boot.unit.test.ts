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
const EXPORT_FORMAT_KEY = "cindiehExportFormat";
const ONE_CLICK_EXPORT_KEY = "cindiehOneClickExport";
const DEBUG_KEY = "cindieh:debug";
const MIRROR_MARKER_KEY = "cindieh:debug:ext";
const ENABLED_KEY = "cindiehEnabled";
const DELAY_PRESET_KEY = "cindiehDelayPreset";
const PACING_STORAGE_KEY = "cindieh:pacing";
const RESET_REQUEST_KEY = "cindiehResetRequest";
const NOTIFY_ON_COMPLETE_KEY = "cindiehNotifyOnComplete";
const COMPLETION_STORAGE_KEY = "cindiehLastCompletion";
const SHOW_PANEL_REQUEST_KEY = "cindiehShowPanelRequest";

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

async function bootMain(
  options: {
    href?: string;
    pageStorage?: ReturnType<typeof makePageStorage>;
    /** Every storage read refuses, for the guarded paths' fallback behaviour. */
    rejectReads?: boolean;
  } = {},
) {
  const { doc } = stubFakeDom();
  const page = options.pageStorage ?? makePageStorage();
  const location = { href: options.href ?? SPT_URL, origin: PORTAL_ORIGIN };
  const { win, messages, fire, listenerCount } = makeBootWindow(location);

  const stored = options.rejectReads ? null : deferred<Record<string, unknown>>();
  const onChanged: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void> = [];
  // Every `storage.local.set` the content world makes. The completion hand-off
  // is a write, so this is the only place a test can observe it from boot.
  const extensionWrites: Record<string, unknown>[] = [];

  vi.stubGlobal("window", win);
  vi.stubGlobal("location", location);
  vi.stubGlobal("localStorage", page.storage);
  vi.stubGlobal("MutationObserver", FakeMutationObserver);
  vi.stubGlobal("browser", {
    storage: {
      // loadExportModePreference() and the debug read share this promise: the
      // test can hold both back until it decides the gate should open. Under
      // rejectReads every read refuses instead, which is what the guarded
      // fallbacks (readPreferences, loadExportModePreference) exist for.
      local: {
        get: vi.fn(() =>
          stored ? stored.promise : Promise.reject(new Error("storage refused")),
        ),
        set: vi.fn(async (payload: Record<string, unknown>) => {
          extensionWrites.push(payload);
        }),
      },
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
    extensionWrites,
    /** Fire a document-level listener (main.ts registers its keyup seam there). */
    fireDoc(type: string, event?: unknown): void {
      for (const fn of [...(doc.listeners.get(type) ?? [])]) fn(event);
    },
    /** Resolve the held-back storage read with the given stored keys. */
    async resolveStored(keys: Record<string, unknown> = {}): Promise<void> {
      stored?.resolve(keys);
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

// ── The Referensi filter's page fact ──────────────────

// The filter is a LOOKUP, so a grid only needs a Referensi column to get it —
// which PPN Masukan has. The injection used to be gated on "is this the
// Keluaran grid", which withheld the filter from a grid that can use it and
// left Pengecekan's hand-back dead there. ui-filters' own cases stub the page
// fact away, so only booting the real main.ts can see which one it asks.

describe("main boot — the Referensi filter on both PPN grids", () => {
  type Env = Awaited<ReturnType<typeof bootMain>>;

  /** Boot on `href` with the switch on, plus a portal reset button to anchor to. */
  async function bootWithAnchor(href: string): Promise<Env> {
    const env = await bootMain({ href });
    const btn = env.doc.createElement("button");
    btn.setAttribute("ptooltip", "Setel Ulang Filter");
    env.doc.body.appendChild(btn);
    env.doc.buttons.push(btn as unknown as FakeEl);
    env.fire("load");
    await env.resolveStored({ [ENABLED_KEY]: true });
    return env;
  }

  it.each([
    ["PPN Keluaran", OUTPUT_TAX_URL],
    ["PPN Masukan", INPUT_TAX_URL],
  ])("injects the toolbar search box on %s", async (_grid, href) => {
    const env = await bootWithAnchor(href);

    const input = env.doc.getElementById("ch-toolbar-filter-reference");
    expect(input).not.toBeNull();
    expect(input?.placeholder).toBe("Cari Referensi...");
  });

  it("leaves a grid with no Referensi column to search (a Retur grid)", async () => {
    const env = await bootWithAnchor(`${PORTAL_ORIGIN}/e-invoice-portal/output-return`);

    expect(env.doc.getElementById("ch-toolbar-filter-reference")).toBeNull();
  });
});

// ── Completion notifications ──────────────────────────

// The toast is raised by the background from a storage record, and the record
// is only ever written from here. These tests are the half a seam suite cannot
// see: a failed or partial run must publish too, not just a clean one.

describe("main boot — completion notifications", () => {
  type Env = Awaited<ReturnType<typeof bootMain>>;

  /**
   * Open a run the dispatcher will accept messages for. `clearScraperCache`
   * (the popup's "Bersihkan cache") is the shortest way to a real run id from
   * boot: it posts RESET_SCRAPER, which is what assigns and pages the run.
   */
  async function bootWithRun(): Promise<{ env: Env; runId: number }> {
    const env = await bootMain();
    env.fire("load");
    await env.resolveStored({ [NOTIFY_ON_COMPLETE_KEY]: true });
    env.emitStorageChange({ [RESET_REQUEST_KEY]: { newValue: 1 } });
    const { getActiveRunId } = await import("../content/bridge");
    return { env, runId: getActiveRunId() };
  }

  /** Frame a FROM_PAGE message the guard accepts, for the run bootWithRun opened. */
  function fromPage(env: Env, data: Record<string, unknown>): void {
    env.fire("message", {
      source: env.win,
      origin: PORTAL_ORIGIN,
      data: { ...data, direction: "FROM_PAGE", token: env.token() },
    });
  }

  function publishedRecord(env: Env): { kind?: string; detail?: string } | undefined {
    const write = env.extensionWrites.find((w) => COMPLETION_STORAGE_KEY in w);
    return write?.[COMPLETION_STORAGE_KEY] as { kind?: string; detail?: string } | undefined;
  }

  it("announces a hard failure instead of leaving the user with only a panel message", async () => {
    const { env, runId } = await bootWithRun();

    fromPage(env, { type: "SCRAPE_ERROR", message: "Sesi Coretax habis", runId });

    const record = publishedRecord(env);
    expect(record?.kind).toBe("error");
    expect(record?.detail).toContain("Sesi Coretax habis");
  });

  it("announces a rejected partial run, whose early return used to notify nothing", async () => {
    const { env, runId } = await bootWithRun();

    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: [],
      total: 10,
      pages: 1,
      elapsed: "4.2s",
      partial: true,
      failureCount: 2,
      kind: "pdf",
      runId,
    });

    const record = publishedRecord(env);
    expect(record?.kind).toBe("error");
    expect(record?.detail).toContain("2 proses gagal");
  });

  it("names a batch sweep's lost masa in the notification, not just its row count", async () => {
    const { env, runId } = await bootWithRun();
    const run = (await import("../content/run-lifecycle")).runLifecycle;
    run.begin("scrape");

    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: [{ RecordId: 1 }, { RecordId: 2 }],
      fields: ["RecordId"],
      total: 2,
      pages: 2,
      elapsed: "9s",
      source: "OUTPUT_TAX",
      truncated: true,
      periods: {
        counts: [
          { period: "TD.00701", rows: 2 },
          { period: "TD.00702", rows: 0, error: "504 Gateway Timeout" },
        ],
        totalRows: 2,
        emptyPeriods: [],
        failedPeriods: ["TD.00702"],
      },
      runId,
    });
    await flush();

    // The panel carries this and the user is not looking at it: "2 data diproses,
    // tanpa kegagalan" would be a lie about a sweep that lost a month.
    const record = publishedRecord(env);
    expect(record?.detail).toContain("1 masa gagal diambil");
    expect(record?.detail).toContain("belum lengkap");
  });

  it("stays silent when the user never opted in", async () => {
    const env = await bootMain();
    env.fire("load");
    // Only the notify switch is left at its default: off.
    await env.resolveStored({ [ENABLED_KEY]: true });
    env.emitStorageChange({ [RESET_REQUEST_KEY]: { newValue: 1 } });
    const { getActiveRunId } = await import("../content/bridge");

    fromPage(env, { type: "SCRAPE_ERROR", message: "Sesi habis", runId: getActiveRunId() });

    expect(publishedRecord(env)).toBeUndefined();
  });

  it("re-opens the panel when the notification click asks it to", async () => {
    const env = await bootMain();
    env.fire("load");
    await env.resolveStored({ [ENABLED_KEY]: true });
    const container = env.doc.getElementById("ch-floating-info-container")!;
    expect(container.classList.contains("ch-panel-open")).toBe(false);

    env.emitStorageChange({ [SHOW_PANEL_REQUEST_KEY]: { newValue: Date.now() } });

    // The background focused the tab; this is how the reason for the toast gets
    // onto the screen even if the user had collapsed the bar.
    expect(container.classList.contains("ch-panel-open")).toBe(true);
  });
});

// ── A large result crossing the bridge ──────────────────────────────

// The seam suite proves the chunker and the reassembler agree. These prove the
// CONTENT SCRIPT actually reassembles: the receiver is a handler in a world
// entry, and the only way to know it was wired in is to send a chunked result
// through the guarded message path and read the Run back.

describe("main boot — a chunked scrape result", () => {
  type Env = Awaited<ReturnType<typeof bootMain>>;

  /**
   * Boot with a live Run. Both halves are needed: every page message is gated
   * on the CURRENT run id, and the popup's cache clear is what assigns one;
   * and a completion is only accepted while a Run is in flight, which is what
   * begin() is for. Between them they are what a scrape in progress looks like
   * from the isolated world.
   */
  async function bootRunning(): Promise<{ env: Env; runId: number; run: import("../content/run-lifecycle").RunLifecycle }> {
    const env = await bootMain();
    env.fire("load");
    await env.resolveStored({ [ENABLED_KEY]: true, [NOTIFY_ON_COMPLETE_KEY]: true });
    env.emitStorageChange({ [RESET_REQUEST_KEY]: { newValue: 1 } });
    const { getActiveRunId } = await import("../content/bridge");
    const run = (await import("../content/run-lifecycle")).runLifecycle;
    run.begin("scrape");
    return { env, runId: getActiveRunId(), run };
  }

  function fromPage(env: Env, data: Record<string, unknown>): void {
    env.fire("message", {
      source: env.win,
      origin: PORTAL_ORIGIN,
      data: { ...data, direction: "FROM_PAGE", token: env.token() },
    });
  }

  const rows = (count: number): Record<string, unknown>[] =>
    Array.from({ length: count }, (_, i) => ({ RecordId: i }));

  it("keeps a stopped sweep's rows, and says how much of the year survived", async () => {
    const { env, runId, run } = await bootRunning();

    // The stop retires the run id, so the report that follows it arrives under
    // the retired one — the single case main.ts must still accept, or ten of
    // twelve months would be dropped on the floor.
    env.fireDoc("ch:scrape-stop");
    expect(run.isRunning()).toBe(false);
    expect(env.doc.getElementById("ch-f-status")!.textContent).toContain("Proses dihentikan");

    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: rows(2),
      fields: ["RecordId"],
      total: 2,
      cancelled: true,
      filenameHint: "2026",
      source: "OUTPUT_TAX",
      periods: {
        counts: [{ period: "TD.00701", rows: 2 }],
        totalRows: 2,
        planned: 12,
        emptyPeriods: [],
        failedPeriods: [],
      },
      runId,
    });

    // The panel replaces its own cancellation line with what survived, and the
    // rows stay exportable on purpose.
    expect(env.doc.getElementById("ch-f-status")!.textContent).toContain("1 dari 12 masa pajak selesai");
    expect(env.doc.getElementById("ch-f-status")!.textContent).toContain("sebagian");
    const result = run.result();
    expect(result?.data).toHaveLength(2);
    expect(result?.partialSweep).toBe(true);
  });

  it("keeps a stopped sweep whose rows arrived as chunks", async () => {
    // The case the salvage exists for: a large taxpayer's sweep, where ten
    // months are tens of thousands of rows and therefore arrive as chunks
    // (ADR-0017). The stop must survive the two mechanisms together.
    const { env, runId, run } = await bootRunning();
    env.fireDoc("ch:scrape-stop");

    fromPage(env, { type: "SCRAPE_DATA_CHUNK", index: 0, chunks: 2, rows: rows(3), runId });
    fromPage(env, { type: "SCRAPE_DATA_CHUNK", index: 1, chunks: 2, rows: rows(2), runId });
    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: [],
      dataChunks: 2,
      fields: ["RecordId"],
      total: 5,
      cancelled: true,
      filenameHint: "2026",
      source: "OUTPUT_TAX",
      periods: {
        counts: [{ period: "TD.00701", rows: 5 }],
        totalRows: 5,
        planned: 12,
        emptyPeriods: [],
        failedPeriods: [],
      },
      runId,
    });

    expect(run.result()?.data).toHaveLength(5);
    expect(run.result()?.partialSweep).toBe(true);
    expect(env.doc.getElementById("ch-f-status")!.textContent).toContain("1 dari 12 masa pajak selesai");
  });

  it("ignores a cancelled completion that belongs to some other run", async () => {
    const { env, runId, run } = await bootRunning();
    env.fireDoc("ch:scrape-stop");

    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: rows(2),
      fields: ["RecordId"],
      total: 2,
      cancelled: true,
      source: "OUTPUT_TAX",
      // The id the stop retired is runId; this is a different one, even though
      // it is the id the bridge has moved on to.
      runId: runId + 1,
    });

    expect(run.result()).toBeNull();
    expect(env.doc.getElementById("ch-f-status")!.textContent).toContain("Proses dihentikan");
  });

  it("hands the Run every row the chunks carried", async () => {
    const { env, runId, run } = await bootRunning();

    fromPage(env, { type: "SCRAPE_DATA_CHUNK", index: 0, chunks: 3, rows: rows(3), runId });
    fromPage(env, { type: "SCRAPE_DATA_CHUNK", index: 1, chunks: 3, rows: rows(3), runId });
    fromPage(env, { type: "SCRAPE_DATA_CHUNK", index: 2, chunks: 3, rows: rows(1), runId });
    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: [],
      dataChunks: 3,
      fields: ["RecordId"],
      total: 7,
      pages: 2,
      elapsed: "2s",
      source: "OUTPUT_TAX",
      runId,
    });

    // The completion arrives with no rows of its own, so anything here came
    // back out of the transfer.
    expect(run.result()?.data).toHaveLength(7);
  });

  it("assembles out of arrival order, by index", async () => {
    const { env, runId, run } = await bootRunning();

    // The portal does not reorder postMessage, but the index is the contract
    // and the rows have to come out in it regardless.
    for (const index of [1, 0]) {
      fromPage(env, {
        type: "SCRAPE_DATA_CHUNK",
        index,
        chunks: 2,
        rows: [{ RecordId: index }],
        runId,
      });
    }
    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: [],
      dataChunks: 2,
      fields: ["RecordId"],
      total: 2,
      pages: 1,
      elapsed: "1s",
      source: "OUTPUT_TAX",
      runId,
    });

    expect(run.result()?.data?.map((r) => r.RecordId)).toEqual([0, 1]);
  });

  it("reports an incomplete transfer instead of exporting what did arrive", async () => {
    const { env, runId, run } = await bootRunning();

    // Two chunks are promised; only one turns up.
    fromPage(env, { type: "SCRAPE_DATA_CHUNK", index: 0, chunks: 2, rows: rows(2), runId });
    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: [],
      dataChunks: 2,
      total: 4,
      pages: 1,
      elapsed: "1s",
      source: "OUTPUT_TAX",
      runId,
    });

    // A short grid and a lost chunk look identical once exported, which is the
    // one thing the truncated-export notice exists to rule out. So the Run
    // keeps nothing at all.
    expect(run.result()).toBeNull();
    expect(run.isRunning()).toBe(true);
  });

  it("announces an incomplete transfer, so a quiet panel is not the only sign", async () => {
    const { env, runId } = await bootRunning();

    fromPage(env, { type: "SCRAPE_DATA_CHUNK", index: 0, chunks: 2, rows: rows(2), runId });
    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: [],
      dataChunks: 2,
      total: 4,
      pages: 1,
      elapsed: "1s",
      source: "OUTPUT_TAX",
      runId,
    });
    await flush();

    const write = env.extensionWrites.find((w) => COMPLETION_STORAGE_KEY in w);
    const record = write?.[COMPLETION_STORAGE_KEY] as { kind?: string; detail?: string } | undefined;
    expect(record?.kind).toBe("error");
    expect(record?.detail).toContain("Transfer hasil tidak lengkap");
  });

  it("still settles an inline result exactly as before", async () => {
    // The chunked path must not have become the only path.
    const { env, runId, run } = await bootRunning();

    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: rows(3),
      fields: ["RecordId"],
      total: 3,
      pages: 1,
      elapsed: "1s",
      source: "OUTPUT_TAX",
      runId,
    });

    expect(run.result()?.data).toHaveLength(3);
  });

  it("does not carry one run's chunks into the next", async () => {
    const { env, runId, run } = await bootRunning();

    // A transfer that never completed leaves chunks behind; the next run's
    // first chunk must not be able to answer for the one that just ended.
    fromPage(env, { type: "SCRAPE_DATA_CHUNK", index: 0, chunks: 2, rows: rows(9), runId });
    run.stop({ keepRows: false });
    run.begin("scrape");

    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: [],
      dataChunks: 2,
      total: 2,
      pages: 1,
      elapsed: "1s",
      source: "OUTPUT_TAX",
      runId,
    });

    expect(run.result()).toBeNull();
  });
});

// ── Resuming a stopped sweep ──────────────────────────

// The merge lives in the content script: the kept half is here, the fetched half
// arrives as a completion, and the union is what settles, what the panel reports
// and what the next export names (ADR-0023). Nothing but this harness drives the
// two halves through the real handler.

describe("main boot — resuming a stopped sweep", () => {
  type Env = Awaited<ReturnType<typeof bootMain>>;
  type RunLifecycle = import("../content/run-lifecycle").RunLifecycle;

  /** Boot on the Keluaran grid, switched on, with a live Run. */
  async function bootRunningOnGrid(): Promise<{ env: Env; runId: number; run: RunLifecycle }> {
    const env = await bootMain({ href: OUTPUT_TAX_URL });
    env.fire("load");
    await env.resolveStored({ [ENABLED_KEY]: true });
    // The popup's cache clear is what assigns a run id and pins the run's page.
    env.emitStorageChange({ [RESET_REQUEST_KEY]: { newValue: 1 } });
    const { getActiveRunId } = await import("../content/bridge");
    const run = (await import("../content/run-lifecycle")).runLifecycle;
    run.begin("scrape");
    return { env, runId: getActiveRunId(), run };
  }

  function fromPage(env: Env, data: Record<string, unknown>): void {
    env.fire("message", {
      source: env.win,
      origin: PORTAL_ORIGIN,
      data: { ...data, direction: "FROM_PAGE", token: env.token() },
    });
  }

  /**
   * The ten masa a first pass finished. The counts deliberately add up to more
   * rows than the kept data carries — a failed masa whose partial rows were
   * counted can hand the resumed retry the same rows again — because that is the
   * one case where the union's two halves disagree: they were counted by two
   * independent accumulators, and the union dedupes them (ADR-0016). The panel
   * must therefore name the FILE's rows, not the sum of the counts.
   */
  const tenMasa = {
    counts: Array.from({ length: 10 }, (_, i) => ({
      period: `TD.007${String(i + 1).padStart(2, "0")}`,
      rows: 1,
    })),
    totalRows: 10,
    planned: 12,
    emptyPeriods: [],
    failedPeriods: [],
  };

  const status = (env: Env): string => env.doc.getElementById("ch-f-status")?.textContent ?? "";

  it("merges the resumed masa into the kept half, and the year stops being partial", async () => {
    const { env, run, runId } = await bootRunningOnGrid();

    // 1. The stop: ten masa kept, and the panel says which.
    env.fireDoc("ch:scrape-stop");
    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: [{ RecordId: 1 }, { RecordId: 2 }],
      fields: ["RecordId"],
      total: 2,
      cancelled: true,
      filenameHint: "2026",
      source: "OUTPUT_TAX",
      periods: tenMasa,
      runId,
    });
    expect(run.result()?.partialSweep).toBe(true);
    expect(status(env)).toContain("10 dari 12 masa pajak selesai");
    expect(status(env)).toContain("2 masa yang belum selesai");

    // 2. The resume, driven the way its menu entry drives it: the same kept
    //    rows, and only the two masa still missing on the wire.
    vi.stubGlobal("confirm", vi.fn(() => true));
    env.fireDoc("ch:export-batch");

    const posted = env.messages.filter((m) => m.data.type === "START_SCRAPE").at(-1)!.data;
    expect(posted.sweepPeriods).toEqual(["TD.00711", "TD.00712"]);
    expect(posted.sweepYear).toBe("2026");

    const { getActiveRunId } = await import("../content/bridge");
    const resumedRunId = getActiveRunId();
    expect(resumedRunId).not.toBe(runId);

    // 3. The two masa come back, under the id the resume's own message opened.
    fromPage(env, {
      type: "SCRAPE_COMPLETE",
      data: [{ RecordId: 3 }, { RecordId: 4 }, { RecordId: 5 }],
      fields: ["RecordId"],
      total: 3,
      filenameHint: "2026",
      source: "OUTPUT_TAX",
      periods: {
        counts: [
          { period: "TD.00711", rows: 2 },
          { period: "TD.00712", rows: 1 },
        ],
        totalRows: 3,
        planned: 2,
        emptyPeriods: [],
        failedPeriods: [],
      },
      runId: resumedRunId,
    });

    // ONE year's worth of rows and one whole-year report: the kept months were
    // not fetched again, and nothing about the result still says `sebagian`.
    expect(run.result()?.data).toHaveLength(5);
    expect(run.result()?.sweep?.planned).toBe(12);
    expect(run.result()?.partialSweep).toBeUndefined();
    expect(status(env)).toContain("12 masa pajak");
    // 5 rows: the union of the kept two and the fetched three — the counts above
    // add up to 13, which is exactly what must NOT be reported.
    expect(status(env)).toContain("5 baris");
    expect(status(env)).not.toContain("13 baris");

    // 4. The resumed Run still owed the export the menu entry requested up
    //    front, so the union is written out without a second click, through the
    //    same decision tree the buttons use. The SheetJS chunk cannot load in
    //    this harness (ADR-0013), so the attempt necessarily settles as the
    //    export-failure notice — that notice IS the proof the follow-up ran, and
    //    waiting for it keeps the refusal inside the test instead of leaving a
    //    stray rejection to fire after the page globals are torn down.
    await vi.waitFor(() =>
      expect(status(env)).toContain("Gagal membuat berkas Excel"),
    );
  });
});

// ── The in-page event seam ────────────────────────────

// Everything the toolbar, the panel and the keyboard ask for arrives here as a
// document event, and main.ts is the only listener. The guards around each of
// them are wiring a seam suite cannot see: whether a live Run is stopped rather
// than restarted, whether an export event carries the intent its format
// implies, and whether a declined confirmation leaves a Run behind. The
// reference search has its own describe above; this one covers the rest.

describe("main boot — the in-page event seam", () => {
  type Env = Awaited<ReturnType<typeof bootMain>>;

  /** main.ts's debounce for a DOM mutation that does not change the URL. */
  const DEBOUNCE_DELAY_MS = 300;

  /**
   * Seed the portal's own Upload button. On an e-faktur page the toolbar
   * anchors to that button (ui.ts's findEfakturAnchor), so a bare fake page has
   * nowhere to put it and the toolbar tests would assert against nothing.
   */
  function addPortalUploadAnchor(env: Env): void {
    const wrap = env.doc.createElement("div");
    const button = env.doc.createElement("button");
    button.className = "p-button";
    const icon = env.doc.createElement("i");
    icon.className = "pi pi-upload";
    button.appendChild(icon);
    wrap.appendChild(button);
    env.doc.body.appendChild(wrap);
  }

  /** Boot on a supported page with the extension switched on. */
  async function bootEnabled(href = OUTPUT_TAX_URL): Promise<Env> {
    const env = await bootMain({ href });
    addPortalUploadAnchor(env);
    env.fire("load");
    await env.resolveStored({ [ENABLED_KEY]: true });
    return env;
  }

  /** A live Run: every page message is gated on the current run id. */
  async function bootRunning(): Promise<{ env: Env; runId: number }> {
    const env = await bootEnabled();
    env.emitStorageChange({ [RESET_REQUEST_KEY]: { newValue: 1 } });
    const run = (await import("../content/run-lifecycle")).runLifecycle;
    run.begin("scrape");
    const { getActiveRunId } = await import("../content/bridge");
    return { env, runId: getActiveRunId() };
  }

  const countPosted = (env: Env, type: string): number =>
    env.messages.filter((m) => m.data.type === type).length;

  const lastPosted = (env: Env, type: string): Record<string, unknown> | undefined =>
    [...env.messages].reverse().find((m) => m.data.type === type)?.data;

  const status = (env: Env): string =>
    env.doc.getElementById("ch-f-status")?.textContent ?? "";

  /** Frame a FROM_PAGE message the guard accepts. */
  function fromPage(env: Env, data: Record<string, unknown>): void {
    env.fire("message", {
      source: env.win,
      origin: PORTAL_ORIGIN,
      data: { ...data, direction: "FROM_PAGE", token: env.token() },
    });
  }

  it("starts a scrape from the toolbar toggle, and stops it from the same button", async () => {
    const env = await bootEnabled();
    const run = (await import("../content/run-lifecycle")).runLifecycle;

    env.fireDoc("ch:scrape-toggle");

    expect(lastPosted(env, "START_SCRAPE")).toMatchObject({
      direction: "FROM_CONTENT",
      token: env.token(),
    });
    expect(run.isRunning()).toBe(true);

    env.fireDoc("ch:scrape-toggle");

    expect(lastPosted(env, "STOP_SCRAPE")).toBeDefined();
    expect(run.isRunning()).toBe(false);
    // Stopping is not silent: the aborted run's data must not look reusable.
    expect(status(env)).toContain("Proses dihentikan");
  });

  it("drops the rows on a toolbar stop and keeps them on an export click", async () => {
    // The ONE thing the two controls disagree about, asserted where their flags
    // are chosen (ADR-0027): a stop from the toolbar salvages nothing, while the
    // export click's stop must leave the rows a following export can still use —
    // otherwise the click that was meant to export would have destroyed its own
    // input.
    const env = await bootEnabled();
    const run = (await import("../content/run-lifecycle")).runLifecycle;
    const settle = (): import("../content/scraper-types").ScrapeComplete => ({
      type: "SCRAPE_COMPLETE",
      data: [{ RecordId: "1" }],
      fields: ["RecordId"],
      total: 1,
      pages: 1,
      elapsed: "1s",
      source: "OUTPUT_TAX",
    });

    run.begin("scrape");
    run.complete(settle());
    run.begin("bulk-pdf");

    env.fireDoc("ch:scrape-toggle");

    expect(run.result()).toBeNull();

    run.begin("bulk-pdf");
    run.complete(settle());
    run.begin("bulk-pdf");

    env.fireDoc("ch:export-xlsx");

    expect(run.result()?.data).toEqual([{ RecordId: "1" }]);
  });

  it("gives each export event the intent its format implies", async () => {
    const env = await bootEnabled();
    const run = (await import("../content/run-lifecycle")).runLifecycle;

    env.fireDoc("ch:export-xlsx");
    expect(lastPosted(env, "START_SCRAPE")).toMatchObject({ skipPdf: true });

    run.stop({ keepRows: false });
    env.fireDoc("ch:export-csv");
    expect(lastPosted(env, "START_SCRAPE")).toMatchObject({ skipPdf: true });

    run.stop({ keepRows: false });
    env.fireDoc("ch:export-pdf");
    // The PDF request is the one that must NOT be told to skip its own PDFs.
    expect(lastPosted(env, "START_SCRAPE")).not.toHaveProperty("skipPdf");
  });

  it("starts no Run when the year-wide export's confirmation is declined", async () => {
    const env = await bootEnabled();
    vi.stubGlobal("confirm", vi.fn(() => false));

    env.fireDoc("ch:export-batch");

    // A declined confirmation must leave nothing for a completion to settle.
    expect(countPosted(env, "START_SCRAPE")).toBe(0);
    const run = (await import("../content/run-lifecycle")).runLifecycle;
    expect(run.isRunning()).toBe(false);
  });

  it("starts a scrape from the auto-start event, and never restarts a live run", async () => {
    const env = await bootEnabled();

    env.fireDoc("ch:scrape-start");
    expect(countPosted(env, "START_SCRAPE")).toBe(1);

    env.fireDoc("ch:scrape-start");
    expect(countPosted(env, "START_SCRAPE")).toBe(1);
  });

  it("opens the comparer panel from the toolbar event, taking focus with it", async () => {
    const env = await bootEnabled();
    const overlay = env.doc.getElementById("ch-comparer-overlay");
    expect(overlay?.style.display).not.toBe("flex");

    env.fireDoc("ch:compare-open");

    expect(overlay?.style.display).toBe("flex");
    expect(overlay?.classList.contains("ch-hidden")).toBe(false);
    // Focus follows into the panel — onto whatever it offers to type into — or
    // Escape would reach the portal instead of the dialog.
    expect(overlay?.contains(env.doc.activeElement as FakeEl)).toBe(true);
  });

  it("lands PPN Masukan's toolbar entry in Pengecekan, not in a Komparator", async () => {
    const env = await bootMain({ href: INPUT_TAX_URL });
    // PPN Masukan's toolbar anchors on the portal's own credit-invoice button
    // (ui.ts's findEfakturAnchor picks by page), so a bare fake page has nowhere
    // to put it.
    const anchor = env.doc.createElement("button");
    anchor.id = "CreditInvoiceButtonButton";
    env.doc.body.appendChild(anchor);
    env.fire("load");
    await env.resolveStored({ [ENABLED_KEY]: true });

    // The toolbar itself arrived — this is not a general injection failure...
    expect(env.doc.getElementById("ch-scrape-btn")).not.toBeNull();
    // ...and its entry point is named for the check, not for a comparer this
    // grid cannot serve (a PPN Masukan Referensi is the seller's). The element
    // is `ch-panel-btn` for that reason: it opens the PANEL, whose tab is
    // decided per grid.
    const btn = env.doc.getElementById("ch-panel-btn");
    // The name comes from the grid's own row, through the one function that
    // spells it, rather than from a second copy of the sentence here.
    const { panelEntryLabel } = await import("../content/page-context");
    expect(btn?.getAttribute("aria-label")).toBe(panelEntryLabel(INPUT_TAX_URL));

    for (const fn of btn?.listeners.click ?? []) fn({ stopPropagation: () => {} });

    expect(env.doc.getElementById("ch-comparer-overlay")?.style.display).toBe("flex");
    // The tab this grid cannot serve is HIDDEN rather than offered and refused.
    expect(env.doc.getElementById("ch-tab-compare")?.classList.contains("ch-hidden")).toBe(true);
    expect(env.doc.getElementById("ch-tab-checker")?.classList.contains("ch-hidden")).toBe(false);
    expect(env.doc.getElementById("ch-comparer-view-checker")?.classList.contains("ch-hidden")).toBe(false);
    expect(env.doc.getElementById("ch-comparer-view-compare")?.classList.contains("ch-hidden")).toBe(true);
  });

  it("takes a tab's waiting line back when a stop retires the request behind it", async () => {
    const env = await bootEnabled();
    env.fireDoc("ch:compare-open");
    const textarea = env.doc.getElementById("ch-comparer-textarea") as FakeEl;
    textarea.value = "000123\t000456\t1.234,56789\t0";
    // Daily mode is on by default, so the day list is part of a valid check.
    (env.doc.getElementById("ch-comparer-daily-dates") as FakeEl).value = "1";
    const click = (id: string): void => {
      for (const fn of env.doc.getElementById(id)?.listeners.click ?? []) fn();
    };

    click("ch-comparer-check-btn");
    const status = env.doc.getElementById("ch-comparer-status");
    expect(status?.textContent).toContain("Mohon tunggu");

    env.fireDoc("ch:scrape-stop");

    // The request the line was waiting on is gone, so the promise is replaced by
    // the one-line reason it will not arrive — while the badge keeps the stop's
    // own account, which is the primary one (ADR-0026).
    expect(status?.textContent).toContain("Permintaan dibatalkan");
    expect(env.doc.getElementById("ch-f-status")?.textContent).toContain("Proses dihentikan");
    // And the paste survives, because running it again is one click.
    expect(textarea.value).not.toBe("");
  });

  it("takes the Pengecekan tab's waiting line back on the same stop", async () => {
    const env = await bootEnabled();
    const click = (id: string): void => {
      for (const fn of env.doc.getElementById(id)?.listeners.click ?? []) fn();
    };

    click("ch-checker-check-btn");
    const status = env.doc.getElementById("ch-checker-status");
    expect(status?.textContent).toContain("Mohon tunggu");

    env.fireDoc("ch:scrape-stop");

    expect(status?.textContent).toContain("Permintaan dibatalkan");
    // The badge still owns the stop's account on this tab too.
    expect(env.doc.getElementById("ch-f-status")?.textContent).toContain("Proses dihentikan");
  });

  it("ignores a search event that carries no reference", async () => {
    const env = await bootEnabled();

    env.fireDoc("ch:search-reference", { detail: {} });
    env.fireDoc("ch:search-reference", {});

    expect(countPosted(env, "SET_SERVER_FILTER")).toBe(0);
  });

  it("counts the multi-invoice paste locally, without touching the server filter", async () => {
    const env = await bootEnabled();
    const textarea = env.doc.createElement("textarea");
    textarea.id = "ch-multi-invoice-textarea";
    textarea.value = "INV-1, INV-2";
    const hint = env.doc.createElement("div");
    hint.id = "ch-multi-invoice-count";
    env.doc.body.appendChild(textarea);
    env.doc.body.appendChild(hint);
    const preventDefault = vi.fn();

    env.fireDoc("keyup", { key: "Enter", shiftKey: false, target: textarea, preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(hint.textContent).toContain("2 nomor siap");
    // The count is local: no filter is sent, and Download PDF is the trigger.
    expect(countPosted(env, "SET_SERVER_FILTER")).toBe(0);

    // Shift+Enter is a newline, not a submit...
    const shifted = vi.fn();
    env.fireDoc("keyup", { key: "Enter", shiftKey: true, target: textarea, preventDefault: shifted });
    expect(shifted).not.toHaveBeenCalled();

    // ...and an event with no target at all must not throw.
    expect(() => env.fireDoc("keyup", { key: "Enter" })).not.toThrow();
  });

  it("paints a progress message into the panel", async () => {
    const { env, runId } = await bootRunning();

    fromPage(env, {
      type: "SCRAPE_PROGRESS",
      total: 1200,
      page: 2,
      elapsed: "3s",
      status: "Mengambil halaman 2",
      runId,
    });

    expect(status(env)).toBe("Mengambil halaman 2");
  });

  it("resends a requested scrape once, repeating the intent it was asked with", async () => {
    const env = await bootEnabled();
    env.fireDoc("ch:export-xlsx");
    const { getActiveRunId } = await import("../content/bridge");
    const runId = getActiveRunId();
    const before = env.messages.length;

    // The scraper booted AFTER the request, so its readiness is the only reason
    // the first START_SCRAPE could have been lost.
    fromPage(env, { type: "INJECTED_READY", runId });
    const resent = env.messages.slice(before).filter((m) => m.data.type === "START_SCRAPE");
    expect(resent).toHaveLength(1);
    expect(resent[0].data).toMatchObject({ skipPdf: true });

    // At most once per injection, or a repeated ready would restart the scrape.
    fromPage(env, { type: "INJECTED_READY", runId });
    expect(env.messages.slice(before).filter((m) => m.data.type === "START_SCRAPE")).toHaveLength(1);
  });

  it("keeps a broken PDF payload from ending the message loop", async () => {
    const { env, runId } = await bootRunning();

    // base64ToBlob throws on an empty payload; the handler must swallow it,
    // because an exception here would end the dispatch of the messages behind it.
    expect(() =>
      fromPage(env, {
        type: "DOWNLOAD_PDF_ITEM",
        base64: "",
        item: {},
        source: "OUTPUT_TAX",
        runId,
      }),
    ).not.toThrow();

    fromPage(env, { type: "REFERENCE_SEARCH_NOT_FOUND", value: "EE-0300", runId });
    expect(status(env)).toContain("EE-0300");
  });

  it("re-injects a removed toolbar on a mutation, and leaves a live one alone", async () => {
    const env = await bootEnabled();
    const live = env.doc.getElementById("ch-export-dropdown-btn");
    expect(live).not.toBeNull();

    // A mutation with no URL change goes through the debounced injection path...
    env.navigate(OUTPUT_TAX_URL);
    vi.advanceTimersByTime(DEBOUNCE_DELAY_MS);

    // ...and a toolbar that is already there is not rebuilt.
    expect(env.doc.getElementById("ch-export-dropdown-btn")).toBe(live);

    const ui = await import("../content/ui");
    ui.removeExportButton();
    env.navigate(OUTPUT_TAX_URL);
    vi.advanceTimersByTime(DEBOUNCE_DELAY_MS);

    // A removed one is rebuilt, which is what keeps the toolbar from
    // disappearing for good after the portal re-renders its header.
    const rebuilt = env.doc.getElementById("ch-export-dropdown-btn");
    expect(rebuilt).not.toBeNull();
    expect(rebuilt).not.toBe(live);
  });

  it("applies a format and one-click change to the toolbar in place", async () => {
    const env = await bootEnabled();
    const caretBtn = env.doc.getElementById("ch-export-dropdown-caret");
    const exportBtn = env.doc.getElementById("ch-export-dropdown-btn");
    expect(caretBtn?.classList.contains("ch-hidden")).toBe(true);

    env.emitStorageChange({
      [EXPORT_FORMAT_KEY]: { newValue: "csv" },
      [ONE_CLICK_EXPORT_KEY]: { newValue: true },
    });

    // The check mark moves, and the caret splits off — without rebuilding the
    // dropdown, which would fight Angular for the same node.
    expect(env.doc.getElementById("ch-export-csv-item")?.getAttribute("aria-current")).toBe("true");
    expect(env.doc.getElementById("ch-export-xlsx-item")?.getAttribute("aria-current")).toBeNull();
    expect(caretBtn?.classList.contains("ch-hidden")).toBe(false);
    expect(caretBtn?.children.some((c) => c.className.includes("pi-chevron-down"))).toBe(true);
    expect(exportBtn?.querySelector(".pi-chevron-down")).toBeNull();
    expect(exportBtn?.title).toContain("CSV");
  });

  it("starts the scrape from the keyboard shortcut, through the wiring main owns", async () => {
    const env = await bootEnabled();
    const preventDefault = vi.fn();

    env.fireDoc("keydown", {
      key: "E",
      ctrlKey: true,
      shiftKey: true,
      metaKey: false,
      preventDefault,
    });

    // Ctrl+Shift+E belongs to shortcuts.ts; what this pins is main.ts's own half
    // — the live `isRunning`/`isEnabled` reads and the listener it keeps.
    expect(preventDefault).toHaveBeenCalled();
    expect(countPosted(env, "START_SCRAPE")).toBe(1);
    const run = (await import("../content/run-lifecycle")).runLifecycle;
    expect(run.isRunning()).toBe(true);
  });

  it("settles the run when the stop shortcut is pressed", async () => {
    const env = await bootEnabled();
    const run = (await import("../content/run-lifecycle")).runLifecycle;

    env.fireDoc("ch:export-xlsx");
    expect(run.isRunning()).toBe(true);

    env.fireDoc("keydown", {
      key: "S",
      ctrlKey: true,
      shiftKey: true,
      metaKey: false,
      preventDefault: vi.fn(),
    });

    // Both halves of a stop: the page world is told to abort, and this world's
    // own Run is settled. The second half is the one that has nowhere else to
    // come from — a cancelled run emits no completion — so without it the panel
    // stayed on "Berhenti" and the next Ctrl+Shift+E was refused.
    expect(countPosted(env, "STOP_SCRAPE")).toBe(1);
    expect(run.isRunning()).toBe(false);
    expect(status(env)).toContain("Proses dihentikan");
  });

  it("falls back to the documented defaults when storage refuses the read", async () => {
    const env = await bootMain({ rejectReads: true });

    env.fire("load");
    await flush();

    // Both guarded reads catch: the default is ON, so the page still gets its
    // toolbar instead of being stranded half-painted.
    expect(env.doc.getElementById("ch-floating-info-container")).not.toBeNull();
    expect(env.script()).not.toBeNull();

    // And the failed export-mode read does not break the click path afterwards.
    env.fireDoc("ch:export-xlsx");
    expect(countPosted(env, "START_SCRAPE")).toBe(1);
  });
});
