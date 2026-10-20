// Unit tests for content/preferences.ts — the extension-storage bridge.
//
// The claim worth pinning hardest is the field-to-key mapping. The code reads
// camelCase fields (`exportFormat`) while storage holds prefixed keys
// (`cindiehExportFormat`), so a `Partial<ExtensionPreferences>` passed straight
// to `storage.local.set` would write keys nothing ever reads back: the control
// would look saved and silently do nothing. These tests assert the exact
// payload shape, not just that a write happened.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BULK_CONFIRM_STORAGE_KEY,
  CHECKER_DEFAULTS_STORAGE_KEY,
  COMPARER_DEFAULTS_STORAGE_KEY,
  DELAY_PRESET_STORAGE_KEY,
  ENABLED_STORAGE_KEY,
  EXPORT_FORMAT_STORAGE_KEY,
  FILENAME_PREFIX_STORAGE_KEY,
  NOTIFY_ON_COMPLETE_STORAGE_KEY,
  ONE_CLICK_EXPORT_STORAGE_KEY,
  PREFERENCE_FIELDS,
  PREFERENCE_STORAGE_KEYS,
} from "../shared/extension-preferences";

const EXPORT_MODE_STORAGE_KEY = "cindiehExportMode";

/** Minimal storage.local double: get(key|keys), set(payload), remove(key|keys). */
function makeFakeBrowser(store: Map<string, unknown>, options: { throws?: boolean } = {}) {
  const writes: Record<string, unknown>[] = [];
  const removals: string[][] = [];
  const fail = () => {
    throw new Error("storage disabled");
  };
  return {
    writes,
    removals,
    api: {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            if (options.throws) fail();
            const list = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, unknown> = {};
            for (const key of list) {
              if (store.has(key)) out[key] = store.get(key);
            }
            return out;
          }),
          set: vi.fn(async (payload: Record<string, unknown>) => {
            if (options.throws) fail();
            writes.push(payload);
            for (const [key, value] of Object.entries(payload)) store.set(key, value);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            if (options.throws) fail();
            const list = Array.isArray(keys) ? keys : [keys];
            removals.push(list);
            for (const key of list) store.delete(key);
          }),
        },
      },
    },
  };
}

async function loadPreferencesModule(
  store: Map<string, unknown> = new Map(),
  options: { throws?: boolean } = {},
) {
  const fake = makeFakeBrowser(store, options);
  vi.stubGlobal("browser", fake.api);
  vi.stubGlobal("location", { href: "https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax" });
  vi.stubGlobal("localStorage", undefined);

  vi.resetModules();
  const mod = await import("../content/preferences");
  return { ...fake, mod };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("readPreferences", () => {
  it("returns the documented defaults for an empty store", async () => {
    const { mod } = await loadPreferencesModule();

    const prefs = await mod.readPreferences();

    expect(prefs).toEqual({
      enabled: true,
      exportFormat: "xlsx",
      oneClickExport: false,
      delayPreset: "normal",
      bulkConfirmThreshold: 10,
      comparerDefaults: { tolerance: 0, dailyDates: "", statusFilter: [] },
      checkerDefaults: { benchmark: "DPP", tolerance: 0, statusFilter: [] },
      filenamePrefix: "",
      notifyOnComplete: false,
    });
  });

  it("normalizes every stored value instead of trusting it", async () => {
    const store = new Map<string, unknown>([
      [ENABLED_STORAGE_KEY, "0"],
      [EXPORT_FORMAT_STORAGE_KEY, "csv"],
      [DELAY_PRESET_STORAGE_KEY, "sabar"],
      [BULK_CONFIRM_STORAGE_KEY, "50"],
      [COMPARER_DEFAULTS_STORAGE_KEY, { tolerance: "7", dailyDates: "1,2", statusFilter: ["COCOK", "X"] }],
      [CHECKER_DEFAULTS_STORAGE_KEY, { benchmark: "PPN", tolerance: "3", statusFilter: ["DUA_BERBEDA", "X"] }],
      [FILENAME_PREFIX_STORAGE_KEY, "PT A/B"],
      [NOTIFY_ON_COMPLETE_STORAGE_KEY, true],
      [ONE_CLICK_EXPORT_STORAGE_KEY, "1"],
    ]);
    const { mod } = await loadPreferencesModule(store);

    const prefs = await mod.readPreferences();

    expect(prefs.enabled).toBe(false);
    expect(prefs.exportFormat).toBe("csv");
    expect(prefs.oneClickExport).toBe(true);
    expect(prefs.delayPreset).toBe("sabar");
    expect(prefs.bulkConfirmThreshold).toBe(50);
    expect(prefs.comparerDefaults).toEqual({
      tolerance: 7,
      dailyDates: "1,2",
      statusFilter: ["COCOK"],
    });
    expect(prefs.checkerDefaults).toEqual({
      benchmark: "PPN",
      tolerance: 3,
      statusFilter: ["DUA_BERBEDA"],
    });
    expect(prefs.filenamePrefix).toBe("PT-AB");
    expect(prefs.notifyOnComplete).toBe(true);
  });

  it("commits what it read to the synchronous snapshot", async () => {
    const store = new Map<string, unknown>([[DELAY_PRESET_STORAGE_KEY, "sabar"]]);
    const { mod } = await loadPreferencesModule(store);
    expect(mod.getPreferences().delayPreset).toBe("normal");

    await mod.readPreferences();

    // Action paths read this snapshot synchronously, so a read that did not
    // update it would leave a click following the defaults instead.
    expect(mod.getPreferences().delayPreset).toBe("sabar");
  });

  it("falls back to the defaults and reports when storage is unavailable", async () => {
    const { mod } = await loadPreferencesModule(new Map(), { throws: true });

    await expect(mod.readPreferences()).resolves.toEqual(mod.DEFAULT_PREFERENCES);
  });
});

describe("the one preference table", () => {
  it("covers every preference this module carries, in both directions", async () => {
    // The table is the only place a field is declared (ADR-0037). A field in
    // one and not the other is a value either read by nothing or stored by
    // nothing, and this pair of directions is what catches it.
    const { mod } = await loadPreferencesModule(new Map());

    expect(Object.keys(mod.DEFAULT_PREFERENCES).sort()).toEqual(
      Object.keys(PREFERENCE_FIELDS).sort(),
    );
    for (const [field, spec] of Object.entries(PREFERENCE_FIELDS)) {
      expect(
        mod.DEFAULT_PREFERENCES[field as keyof typeof mod.DEFAULT_PREFERENCES],
        field,
      ).toEqual(spec.defaultValue());
    }
  });

  it("reads an unwritten snapshot as exactly the documented defaults", async () => {
    const { mod } = await loadPreferencesModule(new Map());

    expect(mod.normalizePreferences({})).toEqual(mod.DEFAULT_PREFERENCES);
  });
});

describe("writePreferences", () => {
  it("maps field names onto the prefixed storage keys", async () => {
    const store = new Map<string, unknown>();
    const { mod, writes } = await loadPreferencesModule(store);

    await mod.writePreferences({
      exportFormat: "csv",
      oneClickExport: true,
      bulkConfirmThreshold: 25,
    });

    // The exact payload the browser must receive — this is where a naive
    // `storage.local.set(patch)` would have written `exportFormat` instead.
    expect(writes).toEqual([
      {
        [EXPORT_FORMAT_STORAGE_KEY]: "csv",
        [ONE_CLICK_EXPORT_STORAGE_KEY]: true,
        [BULK_CONFIRM_STORAGE_KEY]: 25,
      },
    ]);
    expect(store.has("exportFormat")).toBe(false);
    expect(store.get(EXPORT_FORMAT_STORAGE_KEY)).toBe("csv");
  });

  it("keeps the snapshot in step with what was written", async () => {
    const { mod } = await loadPreferencesModule();

    await mod.writePreferences({ delayPreset: "hati-hati" });

    expect(mod.getPreferences().delayPreset).toBe("hati-hati");
  });

  it("writes nothing at all for an empty patch", async () => {
    const { mod, writes } = await loadPreferencesModule();

    await mod.writePreferences({});

    expect(writes).toEqual([]);
  });

  it("contains a failed write instead of rejecting", async () => {
    const { mod } = await loadPreferencesModule(new Map(), { throws: true });

    await expect(mod.writePreferences({ enabled: false })).resolves.toBeUndefined();
  });
});

describe("clearPreferences", () => {
  it("removes exactly the managed keys", async () => {
    const store = new Map<string, unknown>([
      [ENABLED_STORAGE_KEY, false],
      [EXPORT_FORMAT_STORAGE_KEY, "csv"],
      ["cindieh:debug", true],
    ]);
    const { mod, removals } = await loadPreferencesModule(store);

    await mod.clearPreferences();

    expect(removals).toEqual([[...PREFERENCE_STORAGE_KEYS]]);
    expect(store.has(ENABLED_STORAGE_KEY)).toBe(false);
    // The debug switch has its own lifecycle and is deliberately left alone.
    expect(store.get("cindieh:debug")).toBe(true);
  });

  it("contains a failed removal", async () => {
    const { mod } = await loadPreferencesModule(new Map(), { throws: true });

    await expect(mod.clearPreferences()).resolves.toBeUndefined();
  });
});

describe("preferencesFromChanges", () => {
  it("maps changed keys to fields and ignores keys it does not manage", async () => {
    const { mod } = await loadPreferencesModule();

    const patch = mod.preferencesFromChanges({
      [DELAY_PRESET_STORAGE_KEY]: { newValue: "sabar" },
      [ONE_CLICK_EXPORT_STORAGE_KEY]: { newValue: "true" },
      "cindieh:debug": { newValue: true },
      [EXPORT_MODE_STORAGE_KEY]: { newValue: "raw" },
    });

    expect(patch).toEqual({ delayPreset: "sabar", oneClickExport: true });
  });

  it("reports a removal as the default rather than as undefined", async () => {
    const { mod } = await loadPreferencesModule();

    // `newValue` is absent when a key is removed; that must read as the default,
    // not as a half-applied preference.
    const patch = mod.preferencesFromChanges({ [ENABLED_STORAGE_KEY]: {} });

    expect(patch).toEqual({ enabled: true });
  });
});

describe("requestScraperReset", () => {
  it("publishes a changed timestamp under the reset key", async () => {
    const { mod, writes } = await loadPreferencesModule();
    const { RESET_SCRAPER_REQUEST_KEY } = mod;

    await mod.requestScraperReset(1234);

    expect(writes).toEqual([{ [RESET_SCRAPER_REQUEST_KEY]: 1234 }]);
  });
});
