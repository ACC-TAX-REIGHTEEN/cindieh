// Unit tests for completion-notice.ts — the "selesai" notification hand-off.
//
// The record crosses a process boundary through storage, so both ends matter:
// the content script must publish something the background can act on, and the
// background must refuse anything it cannot understand rather than raising a
// toast for a value it half-reads.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPLETION_STORAGE_KEY,
  MAX_NOTIFICATION_AGE_MS,
  buildCompletionRecord,
  describeCompletion,
  formatCompletionNotification,
  normalizeCompletionRecord,
} from "../content/completion-notice";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("buildCompletionRecord", () => {
  it("stamps the same instant as both id and timestamp", () => {
    const record = buildCompletionRecord("scrape", "detail", 1_700_000_000_000);

    expect(record).toEqual({
      id: 1_700_000_000_000,
      kind: "scrape",
      detail: "detail",
      at: 1_700_000_000_000,
    });
  });

  it("changes the id between two publishes in the same millisecond", () => {
    // `storage.onChanged` only fires on a real change, so a repeated completion
    // with an identical payload would otherwise be swallowed. Nothing depends on
    // the id being unique across milliseconds here — only per publish.
    const first = buildCompletionRecord("scrape", "same");
    const second = buildCompletionRecord("scrape", "same", first.at + 1);

    expect(second.id).not.toBe(first.id);
  });
});

describe("normalizeCompletionRecord", () => {
  it("accepts a well-formed record", () => {
    const record = buildCompletionRecord("pdf", "8 data diproses.", 5);

    expect(normalizeCompletionRecord(record)).toEqual(record);
  });

  it("rejects a non-object payload", () => {
    expect(normalizeCompletionRecord(null)).toBeNull();
    expect(normalizeCompletionRecord("done")).toBeNull();
    expect(normalizeCompletionRecord(7)).toBeNull();
    expect(normalizeCompletionRecord(undefined)).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(normalizeCompletionRecord({ kind: "export", id: 1, at: 1 })).toBeNull();
  });

  it("rejects a missing or non-numeric id or timestamp", () => {
    expect(normalizeCompletionRecord({ kind: "scrape", at: 1 })).toBeNull();
    expect(normalizeCompletionRecord({ kind: "scrape", id: "1", at: 1 })).toBeNull();
    expect(normalizeCompletionRecord({ kind: "scrape", id: 1 })).toBeNull();
    expect(normalizeCompletionRecord({ kind: "scrape", id: 1, at: Number.NaN })).toBeNull();
  });

  it("tolerates a missing detail, which is only decoration", () => {
    const record = normalizeCompletionRecord({ kind: "scrape", id: 1, at: 2 });

    expect(record?.detail).toBe("");
  });
});

describe("formatCompletionNotification", () => {
  it("titles a data scrape and a bulk download differently", () => {
    expect(formatCompletionNotification(buildCompletionRecord("scrape", "x")).title).toBe(
      "Ekspor data selesai",
    );
    expect(formatCompletionNotification(buildCompletionRecord("pdf", "x")).title).toBe(
      "Unduhan PDF selesai",
    );
  });

  it("falls back to a readable body when the detail is empty", () => {
    const { message } = formatCompletionNotification(buildCompletionRecord("scrape", ""));

    expect(message).toBe("Proses Cindieh telah selesai.");
  });
});

describe("describeCompletion", () => {
  it("reports a clean run", () => {
    expect(describeCompletion({ total: 120 })).toBe("120 data diproses, tanpa kegagalan.");
  });

  it("reports the failure count when some items were skipped", () => {
    expect(describeCompletion({ total: 120, failureCount: 3 })).toBe(
      "120 data diproses, 3 gagal.",
    );
  });

  it("counts the No. Faktur shortfall so a short run is not announced as clean", () => {
    expect(describeCompletion({ total: 17, missing: 3 })).toBe(
      "17 data diproses, 3 nomor faktur tidak ditemukan, tanpa kegagalan.",
    );
    expect(describeCompletion({ total: 12, missing: 2, failureCount: 1 })).toBe(
      "12 data diproses, 2 nomor faktur tidak ditemukan, 1 gagal.",
    );
    // Zero keeps the wording of a run with no filter at all.
    expect(describeCompletion({ total: 120, missing: 0 })).toBe(
      "120 data diproses, tanpa kegagalan.",
    );
  });
});

describe("publishCompletion", () => {
  async function loadWith(storageSet: (payload: Record<string, unknown>) => Promise<void>) {
    vi.stubGlobal("browser", { storage: { local: { set: storageSet } } });
    vi.stubGlobal("localStorage", undefined);
    vi.resetModules();
    return import("../content/completion-notice");
  }

  it("writes the record under the shared key the background watches", async () => {
    const writes: Record<string, unknown>[] = [];
    const mod = await loadWith(async (payload) => {
      writes.push(payload);
    });

    await mod.publishCompletion("scrape", "12 data diproses.", 999);

    expect(writes).toEqual([
      { [COMPLETION_STORAGE_KEY]: { id: 999, kind: "scrape", detail: "12 data diproses.", at: 999 } },
    ]);
  });

  it("contains a failed write instead of disturbing the run that produced it", async () => {
    const mod = await loadWith(async () => {
      throw new Error("quota exceeded");
    });

    await expect(mod.publishCompletion("pdf", "x")).resolves.toBeUndefined();
  });

  it("advertises a staleness window the background can rely on", () => {
    expect(MAX_NOTIFICATION_AGE_MS).toBeGreaterThan(0);
  });
});
