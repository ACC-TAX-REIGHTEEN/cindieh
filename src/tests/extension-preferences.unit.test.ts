// Unit tests for the preference schema that every context shares.
//
// These normalizers are the only thing standing between a hand-edited storage
// key (or a value written by an older build) and behaviour, so each one is
// pinned at both ends: the documented default for anything unrecognizable, and
// the accepted form for anything valid. The pacing assertions carry an extra
// claim from RATE_LIMITING.md — pacing may only ever get SLOWER.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BULK_CONFIRM_THRESHOLD,
  DEFAULT_COMPARER_DEFAULTS,
  DEFAULT_DELAY_PRESET,
  DEFAULT_ENABLED,
  DEFAULT_EXPORT_FORMAT,
  DEFAULT_FILENAME_PREFIX,
  DEFAULT_ONE_CLICK_EXPORT,
  DELAY_PRESET_MULTIPLIER,
  ONE_CLICK_EXPORT_STORAGE_KEY,
  MAX_BULK_CONFIRM_THRESHOLD,
  MAX_FILENAME_PREFIX_LENGTH,
  NEVER_CONFIRM_THRESHOLD,
  PREFERENCE_STORAGE_KEYS,
  normalizeBulkConfirmThreshold,
  normalizeComparerDefaults,
  normalizeDelayPreset,
  normalizeEnabled,
  normalizeExportFormat,
  normalizeFilenamePrefix,
  normalizeNotifyOnComplete,
  normalizeOneClickExport,
  scaleDelay,
  shouldConfirmBulkDownload,
} from "../shared/extension-preferences";
import {
  PACING_STORAGE_KEY,
  clearPacingInPageWorld,
  mirrorPacingToPageWorld,
  readPacingFromPageWorld,
} from "../content/page-pacing";

// ── Storage keys ──────────────────────────────────────

describe("preference storage keys", () => {
  it("namespaces every key so nothing collides with page storage", () => {
    expect(PREFERENCE_STORAGE_KEYS.every((key) => key.startsWith("cindieh"))).toBe(true);
  });

  it("lists every managed key exactly once", () => {
    expect(new Set(PREFERENCE_STORAGE_KEYS).size).toBe(PREFERENCE_STORAGE_KEYS.length);
  });

  it("includes the opt-in one-click export switch", () => {
    // If this ever drops out of the registry, "Reset preferensi" would leave the
    // split toolbar behind while every control in the popup reads as default.
    expect(PREFERENCE_STORAGE_KEYS).toContain(ONE_CLICK_EXPORT_STORAGE_KEY);
  });
});

// ── Master switch ─────────────────────────────────────

describe("normalizeEnabled", () => {
  it("defaults to on for an unwritten or unrecognizable value", () => {
    expect(DEFAULT_ENABLED).toBe(true);
    expect(normalizeEnabled(undefined)).toBe(true);
    expect(normalizeEnabled(null)).toBe(true);
    expect(normalizeEnabled("maybe")).toBe(true);
    expect(normalizeEnabled({})).toBe(true);
  });

  it("reads the explicit off forms as off", () => {
    expect(normalizeEnabled(false)).toBe(false);
    expect(normalizeEnabled("false")).toBe(false);
    expect(normalizeEnabled("0")).toBe(false);
  });

  it("reads the explicit on forms as on", () => {
    expect(normalizeEnabled(true)).toBe(true);
    expect(normalizeEnabled("true")).toBe(true);
    expect(normalizeEnabled("1")).toBe(true);
  });
});

// ── Export format ─────────────────────────────────────

describe("normalizeExportFormat", () => {
  it("accepts only the two formats, defaulting to xlsx", () => {
    expect(DEFAULT_EXPORT_FORMAT).toBe("xlsx");
    expect(normalizeExportFormat("csv")).toBe("csv");
    expect(normalizeExportFormat("xlsx")).toBe("xlsx");
    expect(normalizeExportFormat("pdf")).toBe("xlsx");
    expect(normalizeExportFormat(undefined)).toBe("xlsx");
  });
});

// ── One-click export ──────────────────────────────────

describe("normalizeOneClickExport", () => {
  it("is OFF for anything but an explicit truthy value", () => {
    // The compact single button is the default shape, so an unwritten key, a
    // refused read, or a hand-edited value must all leave it alone.
    expect(DEFAULT_ONE_CLICK_EXPORT).toBe(false);
    expect(normalizeOneClickExport(undefined)).toBe(false);
    expect(normalizeOneClickExport(null)).toBe(false);
    expect(normalizeOneClickExport(false)).toBe(false);
    expect(normalizeOneClickExport("false")).toBe(false);
    expect(normalizeOneClickExport("0")).toBe(false);
    expect(normalizeOneClickExport("yes")).toBe(false);
    expect(normalizeOneClickExport(1)).toBe(false);
  });

  it("reads the explicit on forms as on", () => {
    expect(normalizeOneClickExport(true)).toBe(true);
    expect(normalizeOneClickExport("true")).toBe(true);
    expect(normalizeOneClickExport("1")).toBe(true);
  });
});

// ── Pacing ────────────────────────────────────────────

describe("normalizeDelayPreset", () => {
  it("accepts the three presets and defaults anything else", () => {
    expect(normalizeDelayPreset("normal")).toBe("normal");
    expect(normalizeDelayPreset("hati-hati")).toBe("hati-hati");
    expect(normalizeDelayPreset("sabar")).toBe("sabar");
    expect(normalizeDelayPreset("instan")).toBe(DEFAULT_DELAY_PRESET);
    expect(normalizeDelayPreset(undefined)).toBe(DEFAULT_DELAY_PRESET);
  });
});

describe("scaleDelay", () => {
  it("never makes a delay shorter than the code's own pacing floor", () => {
    // The whole point of the control: RATE_LIMITING.md forbids going faster, so
    // no input may ever produce a multiplier below 1.
    for (const preset of Object.keys(DELAY_PRESET_MULTIPLIER)) {
      expect(scaleDelay(100, preset as keyof typeof DELAY_PRESET_MULTIPLIER)).toBeGreaterThanOrEqual(100);
    }
    // Including an unrecognized one, which falls back to the default multiplier.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(scaleDelay(100, "turbo" as any)).toBe(100);
  });

  it("scales by the documented multiplier", () => {
    expect(scaleDelay(100, "normal")).toBe(100);
    expect(scaleDelay(100, "hati-hati")).toBe(200);
    expect(scaleDelay(800, "sabar")).toBe(3200);
    expect(scaleDelay(150, "hati-hati")).toBe(300);
  });

  it("rounds a fractional base to whole milliseconds", () => {
    // 3 * 2.5 would be fractional; rounding keeps setTimeout sane.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(Number.isInteger(scaleDelay(55, "hati-hati" as any))).toBe(true);
  });
});

describe("page pacing mirror", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStorage(initial: Record<string, string> = {}) {
    const map = new Map<string, string>(Object.entries(initial));
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    });
    return map;
  }

  it("defaults to normal when nothing was mirrored", () => {
    stubStorage();
    expect(readPacingFromPageWorld()).toBe(DEFAULT_DELAY_PRESET);
  });

  it("round-trips a preset through page storage", () => {
    const map = stubStorage();
    mirrorPacingToPageWorld("sabar");

    expect(map.get(PACING_STORAGE_KEY)).toBe("sabar");
    expect(readPacingFromPageWorld()).toBe("sabar");
  });

  it("clears the mirror back to the default", () => {
    stubStorage();
    mirrorPacingToPageWorld("hati-hati");
    clearPacingInPageWorld();

    expect(readPacingFromPageWorld()).toBe(DEFAULT_DELAY_PRESET);
  });

  it("normalizes junk left in page storage instead of trusting it", () => {
    stubStorage({ [PACING_STORAGE_KEY]: "zeppelin" });
    expect(readPacingFromPageWorld()).toBe(DEFAULT_DELAY_PRESET);
  });

  it("survives storage that throws or is absent", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => mirrorPacingToPageWorld("sabar")).not.toThrow();
    expect(() => clearPacingInPageWorld()).not.toThrow();
    expect(readPacingFromPageWorld()).toBe(DEFAULT_DELAY_PRESET);

    // A service worker has no window storage at all.
    vi.stubGlobal("localStorage", undefined);
    expect(readPacingFromPageWorld()).toBe(DEFAULT_DELAY_PRESET);
    expect(() => mirrorPacingToPageWorld("sabar")).not.toThrow();
  });
});

// ── Bulk confirmation ─────────────────────────────────

describe("normalizeBulkConfirmThreshold", () => {
  it("defaults for anything not a finite number", () => {
    expect(normalizeBulkConfirmThreshold(undefined)).toBe(DEFAULT_BULK_CONFIRM_THRESHOLD);
    expect(normalizeBulkConfirmThreshold("abc")).toBe(DEFAULT_BULK_CONFIRM_THRESHOLD);
    expect(normalizeBulkConfirmThreshold(Number.NaN)).toBe(DEFAULT_BULK_CONFIRM_THRESHOLD);
    expect(normalizeBulkConfirmThreshold(Infinity)).toBe(DEFAULT_BULK_CONFIRM_THRESHOLD);
    expect(normalizeBulkConfirmThreshold({})).toBe(DEFAULT_BULK_CONFIRM_THRESHOLD);
  });

  it("accepts the numeric string an <input> produces", () => {
    expect(normalizeBulkConfirmThreshold("25")).toBe(25);
  });

  it("floors fractions, clamps negatives to 'never', and clamps the top", () => {
    expect(normalizeBulkConfirmThreshold(12.9)).toBe(12);
    expect(normalizeBulkConfirmThreshold(-5)).toBe(NEVER_CONFIRM_THRESHOLD);
    expect(normalizeBulkConfirmThreshold(99_999)).toBe(MAX_BULK_CONFIRM_THRESHOLD);
  });
});

describe("shouldConfirmBulkDownload", () => {
  it("asks only ABOVE the threshold, not at it", () => {
    expect(shouldConfirmBulkDownload(10, 10)).toBe(false);
    expect(shouldConfirmBulkDownload(11, 10)).toBe(true);
  });

  it("never asks when the preference is turned off", () => {
    expect(shouldConfirmBulkDownload(10_000, NEVER_CONFIRM_THRESHOLD)).toBe(false);
  });

  it("normalizes the stored threshold before comparing", () => {
    // A corrupt value must not silently disable the guard.
    expect(shouldConfirmBulkDownload(20, "abc")).toBe(true);
    expect(shouldConfirmBulkDownload(11, "10")).toBe(true);
  });
});

// ── Comparer defaults ─────────────────────────────────

describe("normalizeComparerDefaults", () => {
  it("returns the documented defaults for a missing or non-object value", () => {
    expect(normalizeComparerDefaults(undefined)).toEqual(DEFAULT_COMPARER_DEFAULTS);
    expect(normalizeComparerDefaults("nope")).toEqual(DEFAULT_COMPARER_DEFAULTS);
    expect(normalizeComparerDefaults(null)).toEqual(DEFAULT_COMPARER_DEFAULTS);
  });

  it("clamps the tolerance to a non-negative integer", () => {
    expect(normalizeComparerDefaults({ tolerance: -3 }).tolerance).toBe(0);
    expect(normalizeComparerDefaults({ tolerance: 4.9 }).tolerance).toBe(4);
    expect(normalizeComparerDefaults({ tolerance: "250" }).tolerance).toBe(250);
    expect(normalizeComparerDefaults({ tolerance: Number.NaN }).tolerance).toBe(0);
  });

  it("keeps separators and digits, drops everything else", () => {
    expect(normalizeComparerDefaults({ dailyDates: "15, 31" }).dailyDates).toBe("15, 31");
    // Letters go too: a day-of-month list has no use for them, and keeping them
    // would just hand the panel's parser input it rejects.
    expect(normalizeComparerDefaults({ dailyDates: "15;31<script>" }).dailyDates).toBe("15;31");
  });

  it("keeps only known statuses, in the canonical order", () => {
    const normalized = normalizeComparerDefaults({
      statusFilter: ["BERBEDA", "NOT_A_STATUS", "COCOK", "COCOK"],
    });

    expect(normalized.statusFilter).toEqual(["COCOK", "BERBEDA"]);
  });

  it("treats a non-array status filter as 'all statuses'", () => {
    expect(normalizeComparerDefaults({ statusFilter: "COCOK" }).statusFilter).toEqual([]);
  });
});

// ── Filename prefix ───────────────────────────────────

describe("normalizeFilenamePrefix", () => {
  it("defaults to no prefix", () => {
    expect(DEFAULT_FILENAME_PREFIX).toBe("");
    expect(normalizeFilenamePrefix(undefined)).toBe("");
    expect(normalizeFilenamePrefix(42)).toBe("");
  });

  it("removes path separators and characters a filename cannot carry", () => {
    expect(normalizeFilenamePrefix("PT/ABC:2026?")).toBe("PTABC2026");
    expect(normalizeFilenamePrefix("a\\b<c>d|e\"f*g")).toBe("abcdefg");
  });

  it("collapses whitespace into single dashes", () => {
    expect(normalizeFilenamePrefix("PT  Contoh  Abadi")).toBe("PT-Contoh-Abadi");
  });

  it("trims padding without leaving a dash behind", () => {
    expect(normalizeFilenamePrefix("   PTABC   ")).toBe("PTABC");
  });

  it("keeps a trailing separator the user typed on purpose", () => {
    expect(normalizeFilenamePrefix(" PTABC- ")).toBe("PTABC-");
  });

  it("caps the length", () => {
    expect(normalizeFilenamePrefix("x".repeat(80)).length).toBe(MAX_FILENAME_PREFIX_LENGTH);
  });
});

// ── Notifications ─────────────────────────────────────

describe("normalizeNotifyOnComplete", () => {
  it("is off unless explicitly switched on", () => {
    expect(normalizeNotifyOnComplete(undefined)).toBe(false);
    expect(normalizeNotifyOnComplete(false)).toBe(false);
    expect(normalizeNotifyOnComplete("yes")).toBe(false);
    expect(normalizeNotifyOnComplete(true)).toBe(true);
    expect(normalizeNotifyOnComplete("1")).toBe(true);
  });
});
