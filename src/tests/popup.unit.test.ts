// Boot tests for popup.ts — the last extension context without coverage of its
// own wiring.
//
// The popup is small but it owns two shared state keys: the export mode the
// content script reads, and the debug switch the whole extension reads. What is
// worth pinning is that the controls reflect stored state on open, that changing
// them persists (never just repaints), and that the debug toggle applies to the
// popup's own logger immediately — otherwise a switch that looks on would do
// nothing until some other context restarted.
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubFakeDom, type FakeEl } from "./__mocks__/fake-dom";

const EXPORT_MODE_KEY = "cindiehExportMode";
const DEBUG_KEY = "cindieh:debug";
const ENABLED_KEY = "cindiehEnabled";
const EXPORT_FORMAT_KEY = "cindiehExportFormat";
const DELAY_PRESET_KEY = "cindiehDelayPreset";
const BULK_CONFIRM_KEY = "cindiehBulkConfirm";
const COMPARER_DEFAULTS_KEY = "cindiehComparerDefaults";
const FILENAME_PREFIX_KEY = "cindiehFilenamePrefix";
const NOTIFY_KEY = "cindiehNotifyOnComplete";
const ONE_CLICK_KEY = "cindiehOneClickExport";
const RESET_REQUEST_KEY = "cindiehResetRequest";

/**
 * Minimal browser double: storage.local (get/set/remove), the permissions API
 * the notification switch needs, tabs.query for the status line, and
 * runtime.getManifest for the version.
 */
function makeFakeBrowser(store: Map<string, unknown>) {
  const writes: Record<string, unknown>[] = [];
  const removals: string[][] = [];
  return {
    writes,
    removals,
    permissionsGranted: false,
    permissionRequests: 0,
    tabUrl: undefined as string | undefined,
    version: "2.1.0",
    api: {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, unknown> = {};
            for (const key of list) if (store.has(key)) out[key] = store.get(key);
            return out;
          }),
          set: vi.fn(async (payload: Record<string, unknown>) => {
            writes.push(payload);
            for (const [k, v] of Object.entries(payload)) store.set(k, v);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys];
            removals.push(list);
            for (const key of list) store.delete(key);
          }),
        },
      },
      runtime: { getManifest: () => ({ version: "2.1.0" }) },
      tabs: { query: vi.fn(async () => [{ url: undefined as string | undefined }]) },
      // Only `request` is exercised: the popup asks without a `contains`
      // pre-check so the click's user gesture survives (see popup.ts).
      permissions: {
        request: vi.fn(async () => false),
      },
    },
  };
}

/** Build every control popup.ts looks up by id. */
function mountControls(doc: ReturnType<typeof stubFakeDom>["doc"]) {
  const make = (id: string, tag = "input") => {
    const el = doc.createElement(tag);
    el.id = id;
    doc.register(el);
    return el as FakeEl & { checked: boolean };
  };
  return {
    enabled: make("extension-enabled"),
    cleaned: make("mode-cleaned"),
    raw: make("mode-raw"),
    formatXlsx: make("format-xlsx"),
    formatCsv: make("format-csv"),
    oneClickExport: make("one-click-export"),
    filenamePrefix: make("filename-prefix"),
    delayPreset: make("delay-preset", "select"),
    bulkConfirm: make("bulk-confirm"),
    comparerTolerance: make("comparer-tolerance"),
    comparerDailyDates: make("comparer-daily-dates"),
    comparerStatus: {
      COCOK: make("comparer-status-COCOK"),
      DPP_BERBEDA: make("comparer-status-DPP_BERBEDA"),
      PPN_BERBEDA: make("comparer-status-PPN_BERBEDA"),
      BERBEDA: make("comparer-status-BERBEDA"),
      TIDAK_DITEMUKAN: make("comparer-status-TIDAK_DITEMUKAN"),
      HANYA_CORETAX: make("comparer-status-HANYA_CORETAX"),
    },
    notify: make("notify-on-complete"),
    debug: make("debug-logs"),
    clearCache: make("clear-cache", "button"),
    reset: make("reset-preferences", "button"),
    portalStatus: make("portal-status", "p"),
    status: make("status-text", "p"),
  };
}

function fire(el: FakeEl, type: string): void {
  for (const fn of [...(el.listeners[type] ?? [])]) fn();
}

async function bootPopup(
  options: {
    store?: Map<string, unknown>;
    storageThrows?: boolean;
    tabUrl?: string;
    permissionGranted?: boolean;
  } = {},
) {
  const { doc } = stubFakeDom();
  const controls = mountControls(doc);
  const store = options.store ?? new Map<string, unknown>();

  const fake = makeFakeBrowser(store);
  fake.api.tabs.query = vi.fn(async () => [{ url: options.tabUrl }]);
  fake.api.permissions.request = vi.fn(async () => options.permissionGranted ?? false);
  if (options.storageThrows) {
    fake.api.storage.local.get = vi.fn(async () => {
      throw new Error("storage disabled");
    });
    fake.api.storage.local.set = vi.fn(async () => {
      throw new Error("quota");
    });
    fake.api.storage.local.remove = vi.fn(async () => {
      throw new Error("quota");
    });
  }

  vi.stubGlobal("browser", fake.api);
  // The popup runs at a chrome-extension:// URL, so no ?chdebug can apply.
  vi.stubGlobal("location", { href: "chrome-extension://abcdefghijklmnop/popup/popup.html" });

  vi.resetModules();
  await import("../popup/popup");

  const debug = await import("../content/debug");
  const read = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  await read();

  return {
    controls,
    store,
    writes: fake.writes,
    removals: fake.removals,
    api: fake.api,
    debug,
    settle: read,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("popup — export mode", () => {
  it("reflects the stored mode and its status text on open", async () => {
    const { controls } = await bootPopup({ store: new Map([[EXPORT_MODE_KEY, "raw"]]) });

    expect(controls.raw.checked).toBe(true);
    expect(controls.cleaned.checked).toBe(false);
    expect(controls.status.textContent).toBe("Format asli aktif");
  });

  it("defaults to the cleaned mode when nothing is stored", async () => {
    const { controls } = await bootPopup();

    expect(controls.cleaned.checked).toBe(true);
    expect(controls.status.textContent).toBe("Format dirapikan aktif");
  });

  it("persists a click instead of only repainting the radio", async () => {
    const { controls, store, writes, settle } = await bootPopup();

    controls.raw.checked = true;
    fire(controls.raw, "change");
    await settle();

    expect(store.get(EXPORT_MODE_KEY)).toBe("raw");
    expect(writes).toEqual([{ [EXPORT_MODE_KEY]: "raw" }]);
    expect(controls.status.textContent).toBe("Format asli aktif");
  });

  it("ignores the deselect half of a radio change", async () => {
    const { controls, writes, settle } = await bootPopup();

    // The browser clears `checked` on the losing radio before firing its
    // `change`; only the newly selected one may write.
    controls.cleaned.checked = false;
    fire(controls.cleaned, "change");
    await settle();

    expect(writes).toEqual([]);
  });
});

describe("popup — debug switch", () => {
  it("shows the stored switch state on open", async () => {
    const on = await bootPopup({ store: new Map([[DEBUG_KEY, true]]) });
    expect(on.controls.debug.checked).toBe(true);

    const off = await bootPopup({ store: new Map([[DEBUG_KEY, false]]) });
    expect(off.controls.debug.checked).toBe(false);
  });

  it("writes a boolean under the shared key and turns this context's logs on", async () => {
    const { controls, debug, writes, settle } = await bootPopup();
    expect(debug.isDebugEnabled()).toBe(false);

    controls.debug.checked = true;
    fire(controls.debug, "change");
    await settle();

    // A boolean, not the string form: that is what every reader normalizes.
    expect(writes).toEqual([{ [DEBUG_KEY]: true }]);
    expect(debug.isDebugEnabled()).toBe(true);
  });

  it("turns them back off when the switch is cleared", async () => {
    const { controls, debug, store, settle } = await bootPopup({ store: new Map([[DEBUG_KEY, true]]) });
    expect(debug.isDebugEnabled()).toBe(true);

    controls.debug.checked = false;
    fire(controls.debug, "change");
    await settle();

    expect(store.get(DEBUG_KEY)).toBe(false);
    expect(debug.isDebugEnabled()).toBe(false);
  });

  it("still opens when storage is unavailable", async () => {
    const { controls, debug, settle } = await bootPopup({ storageThrows: true });

    // Unreadable preference: the radios fall back to the default and the switch
    // to unchecked — the popup stays usable instead of ending up half-rendered,
    // and the failed read must not escape as an unhandled rejection either.
    expect(controls.cleaned.checked).toBe(true);
    expect(controls.debug.checked).toBe(false);
    expect(debug.isDebugEnabled()).toBe(false);

    // A failed write is contained the same way.
    controls.debug.checked = true;
    fire(controls.debug, "change");
    await expect(settle()).resolves.toBeUndefined();
  });
});

describe("popup — master switch", () => {
  it("defaults to on and reflects a stored off state", async () => {
    const on = await bootPopup();
    expect(on.controls.enabled.checked).toBe(true);

    const off = await bootPopup({ store: new Map([[ENABLED_KEY, false]]) });
    expect(off.controls.enabled.checked).toBe(false);
  });

  it("persists the switch and says what it did", async () => {
    const { controls, store, settle } = await bootPopup();

    controls.enabled.checked = false;
    fire(controls.enabled, "change");
    await settle();

    expect(store.get(ENABLED_KEY)).toBe(false);
    expect(controls.status.textContent).toContain("dimatikan");
  });
});

describe("popup — export format default", () => {
  it("reflects the stored format, defaulting to xlsx", async () => {
    const fallback = await bootPopup();
    expect(fallback.controls.formatXlsx.checked).toBe(true);
    expect(fallback.controls.formatCsv.checked).toBe(false);

    const stored = await bootPopup({ store: new Map([[EXPORT_FORMAT_KEY, "csv"]]) });
    expect(stored.controls.formatCsv.checked).toBe(true);
    expect(stored.controls.formatXlsx.checked).toBe(false);
  });

  it("persists under the key the content script reads, and clears the losing radio", async () => {
    const { controls, store, settle } = await bootPopup();

    controls.formatCsv.checked = true;
    fire(controls.formatCsv, "change");
    await settle();

    expect(store.get(EXPORT_FORMAT_KEY)).toBe("csv");
    expect(controls.formatXlsx.checked).toBe(false);
  });

  it("ignores the deselect half of a radio change", async () => {
    const { controls, writes, settle } = await bootPopup();

    controls.formatXlsx.checked = false;
    fire(controls.formatXlsx, "change");
    await settle();

    expect(writes.filter((w) => EXPORT_FORMAT_KEY in w)).toEqual([]);
  });

  it("leaves one-click export off unless it was stored on", async () => {
    // The compact single button is the default shape, so an unwritten key must
    // not switch the portal toolbar into the split one.
    const fallback = await bootPopup();
    expect(fallback.controls.oneClickExport.checked).toBe(false);

    const stored = await bootPopup({ store: new Map([[ONE_CLICK_KEY, true]]) });
    expect(stored.controls.oneClickExport.checked).toBe(true);
  });

  it("persists the one-click switch under its own key", async () => {
    const { controls, store, settle } = await bootPopup();

    controls.oneClickExport.checked = true;
    fire(controls.oneClickExport, "change");
    await settle();

    expect(store.get(ONE_CLICK_KEY)).toBe(true);
    expect(controls.status.textContent).toContain("sekali klik");

    controls.oneClickExport.checked = false;
    fire(controls.oneClickExport, "change");
    await settle();

    expect(store.get(ONE_CLICK_KEY)).toBe(false);
    expect(controls.status.textContent).toContain("membuka menu");
  });
});

describe("popup — filename prefix", () => {
  it("shows the stored prefix", async () => {
    const { controls } = await bootPopup({ store: new Map([[FILENAME_PREFIX_KEY, "PTABC-"]]) });
    expect(controls.filenamePrefix.value).toBe("PTABC-");
  });

  it("writes the sanitized prefix while typing, not on blur", async () => {
    const { controls, store, settle } = await bootPopup();

    controls.filenamePrefix.value = "PT A/B";
    fire(controls.filenamePrefix, "input");
    await settle();

    // Persisted on `input` so closing the popup without blurring keeps it.
    expect(store.get(FILENAME_PREFIX_KEY)).toBe("PT-AB");
  });
});

describe("popup — pacing", () => {
  it("reflects the stored preset, defaulting to normal", async () => {
    const fallback = await bootPopup();
    expect(fallback.controls.delayPreset.value).toBe("normal");

    const stored = await bootPopup({ store: new Map([[DELAY_PRESET_KEY, "sabar"]]) });
    expect(stored.controls.delayPreset.value).toBe("sabar");
  });

  it("persists a slower preset and states the multiplier", async () => {
    const { controls, store, settle } = await bootPopup();

    controls.delayPreset.value = "hati-hati";
    fire(controls.delayPreset, "change");
    await settle();

    expect(store.get(DELAY_PRESET_KEY)).toBe("hati-hati");
    expect(controls.status.textContent).toContain("2");
  });
});

describe("popup — bulk download confirmation", () => {
  it("reflects the stored threshold, defaulting to 10", async () => {
    const fallback = await bootPopup();
    expect(fallback.controls.bulkConfirm.value).toBe("10");

    const stored = await bootPopup({ store: new Map([[BULK_CONFIRM_KEY, 25]]) });
    expect(stored.controls.bulkConfirm.value).toBe("25");
  });

  it("normalizes junk to the documented default and shows what is stored", async () => {
    const { controls, store, settle } = await bootPopup();

    controls.bulkConfirm.value = "abc";
    fire(controls.bulkConfirm, "change");
    await settle();

    expect(store.get(BULK_CONFIRM_KEY)).toBe(10);
    expect(controls.bulkConfirm.value).toBe("10");
  });

  it("accepts 0 as 'never ask'", async () => {
    const { controls, store, settle } = await bootPopup();

    controls.bulkConfirm.value = "0";
    fire(controls.bulkConfirm, "change");
    await settle();

    expect(store.get(BULK_CONFIRM_KEY)).toBe(0);
    expect(controls.status.textContent).toContain("tanpa konfirmasi");
  });
});

describe("popup — comparer defaults", () => {
  it("seeds every control from the stored defaults", async () => {
    const { controls } = await bootPopup({
      store: new Map([
        [COMPARER_DEFAULTS_KEY, { tolerance: 250, dailyDates: "15, 31", statusFilter: ["BERBEDA"] }],
      ]),
    });

    expect(controls.comparerTolerance.value).toBe("250");
    expect(controls.comparerDailyDates.value).toBe("15, 31");
    expect(controls.comparerStatus.BERBEDA.checked).toBe(true);
    expect(controls.comparerStatus.COCOK.checked).toBe(false);
  });

  it("shows an empty tolerance box for the default 0", async () => {
    const { controls } = await bootPopup();
    expect(controls.comparerTolerance.value).toBe("");
  });

  it("writes the three controls as one stored object", async () => {
    const { controls, store, settle } = await bootPopup();

    controls.comparerTolerance.value = "500";
    controls.comparerDailyDates.value = "1,2";
    controls.comparerStatus.COCOK.checked = true;
    controls.comparerStatus.BERBEDA.checked = true;
    fire(controls.comparerStatus.BERBEDA, "change");
    await settle();

    // One value, not three: the panel reads them together when the modal opens.
    expect(store.get(COMPARER_DEFAULTS_KEY)).toEqual({
      tolerance: 500,
      dailyDates: "1,2",
      statusFilter: ["COCOK", "BERBEDA"],
    });
  });

  it("writes 'all statuses' as an empty filter", async () => {
    const { controls, store, settle } = await bootPopup();

    fire(controls.comparerTolerance, "change");
    await settle();

    expect(store.get(COMPARER_DEFAULTS_KEY)).toEqual({
      tolerance: 0,
      dailyDates: "",
      statusFilter: [],
    });
  });
});

describe("popup — notifications", () => {
  it("reflects the stored switch", async () => {
    const on = await bootPopup({ store: new Map([[NOTIFY_KEY, true]]) });
    expect(on.controls.notify.checked).toBe(true);

    const off = await bootPopup();
    expect(off.controls.notify.checked).toBe(false);
  });

  it("rolls back when the optional permission is refused", async () => {
    const { controls, store, api, settle } = await bootPopup({ permissionGranted: false });

    controls.notify.checked = true;
    fire(controls.notify, "change");
    await settle();

    // A switch left on would promise a notification the extension cannot send.
    expect(api.permissions.request).toHaveBeenCalledWith({ permissions: ["notifications"] });
    expect(controls.notify.checked).toBe(false);
    expect(store.has(NOTIFY_KEY)).toBe(false);
    expect(controls.status.textContent).toContain("ditolak");
  });

  it("stores the switch once the permission is in place", async () => {
    const { controls, store, settle } = await bootPopup({ permissionGranted: true });

    controls.notify.checked = true;
    fire(controls.notify, "change");
    await settle();

    expect(store.get(NOTIFY_KEY)).toBe(true);
  });
});

describe("popup — maintenance", () => {
  it("publishes a scraper reset request under the shared key", async () => {
    const { controls, store, settle } = await bootPopup();

    fire(controls.clearCache, "click");
    await settle();

    // The value is a timestamp so two clicks in a row are still a real change.
    expect(typeof store.get(RESET_REQUEST_KEY)).toBe("number");
    expect(controls.status.textContent).toContain("cache");
  });

  it("removes every managed key and repaints the defaults", async () => {
    const store = new Map<string, unknown>([
      [ENABLED_KEY, false],
      [EXPORT_FORMAT_KEY, "csv"],
      [DELAY_PRESET_KEY, "sabar"],
      [BULK_CONFIRM_KEY, 0],
      [FILENAME_PREFIX_KEY, "X-"],
      [NOTIFY_KEY, true],
      [ONE_CLICK_KEY, true],
      [EXPORT_MODE_KEY, "raw"],
    ]);
    const { controls, removals, settle } = await bootPopup({ store });

    fire(controls.reset, "click");
    await settle();

    expect(removals.flat().sort()).toEqual(
      [BULK_CONFIRM_KEY, COMPARER_DEFAULTS_KEY, DELAY_PRESET_KEY, ENABLED_KEY, EXPORT_FORMAT_KEY, FILENAME_PREFIX_KEY, NOTIFY_KEY, ONE_CLICK_KEY].sort(),
    );
    // The opt-in split toolbar goes back to the compact single button with it.
    expect(controls.oneClickExport.checked).toBe(false);
    expect(controls.enabled.checked).toBe(true);
    expect(controls.formatXlsx.checked).toBe(true);
    expect(controls.delayPreset.value).toBe("normal");
    expect(controls.filenamePrefix.value).toBe("");
    // The export MODE is a separate preference with its own key, and a reset of
    // the new settings must not silently change how data is exported.
    expect(store.get(EXPORT_MODE_KEY)).toBe("raw");
  });
});

describe("popup — portal status", () => {
  it("names the portal page and the extension version", async () => {
    const { controls } = await bootPopup({
      tabUrl: "https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax/list",
    });

    expect(controls.portalStatus.textContent).toBe("Terhubung: e-Faktur PPN Keluaran · v2.1.0");
  });

  it("asks the user to open the portal when the tab URL is unavailable", async () => {
    const { controls } = await bootPopup();

    expect(controls.portalStatus.textContent).toContain("Buka portal Coretax");
  });
});
