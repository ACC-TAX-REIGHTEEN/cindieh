import { describe, expect, it, vi } from "vitest";
import { createMessageDispatcher } from "../content/postmessage-guard";
import {
  currentRunHandlers,
  failedItemsDetail,
  failedItemsNotice,
  findMissingInvoices,
  incompleteResultMessage,
  MAX_LISTED_FAILED_ITEMS,
  missingInvoicesMessage,
  scrapeErrorMessage,
  skippedInvoicesMessage,
} from "../content/scrape-result";

// This module is the PURE half: the missing-invoice diff, the per-caller report
// wording, and the dispatcher wrapper. Accepting, rejecting and consuming a
// result are state transitions and moved to run-lifecycle.ts (ADR-0014); those
// rules are pinned in run-lifecycle.unit.test.ts.

// ── Naming the files a bulk PDF run could not fetch ────────────────────────
// The point of this report is that a count alone ("4 gagal") is not actionable
// in a 300-file run: the Wajib Pajak would have to re-run the whole thing to
// learn which four were missing. These pin that the names actually arrive, that
// the list is capped so a wholly-failed session cannot flood the panel, and that
// "no names" stays silent rather than inventing an empty headline.

describe("failed download names", () => {
  it("names every failure in the panel line", () => {
    const notice = failedItemsNotice(["SZ-0447/07/26", "SZ-0448/07/26"]);
    expect(notice).toBe(
      "2 file gagal: SZ-0447/07/26, SZ-0448/07/26. Berkas lain tetap tersimpan.",
    );
  });

  it("caps the listed names and says how many were withheld", () => {
    const items = Array.from({ length: 12 }, (_, i) => `BP-${i}`);
    const notice = failedItemsNotice(items);
    expect(notice).toContain(`12 file gagal:`);
    expect(notice).toContain(`(+${12 - MAX_LISTED_FAILED_ITEMS} lainnya)`);
  });

  it("returns null when the producer named nothing", () => {
    // Silence here means "no names available", not "no failures": the panel's
    // completion line still carries the bare failureCount.
    expect(failedItemsNotice(undefined)).toBeNull();
    expect(failedItemsNotice([])).toBeNull();
  });

  it("puts one name per line in the detail block, capped the same way", () => {
    const items = Array.from({ length: 3 }, (_, i) => `BP-${i}`);
    expect(failedItemsDetail(items)).toBe("BP-0\nBP-1\nBP-2");

    const many = Array.from({ length: MAX_LISTED_FAILED_ITEMS + 2 }, (_, i) => `BP-${i}`);
    const detail = failedItemsDetail(many);
    expect(detail.split("\n")).toHaveLength(MAX_LISTED_FAILED_ITEMS + 1);
    expect(detail.endsWith("…dan 2 lainnya")).toBe(true);
  });

  it("renders an empty detail block when there is nothing to name", () => {
    expect(failedItemsDetail(undefined)).toBe("");
    expect(failedItemsDetail([])).toBe("");
  });
});

describe("result warnings and errors", () => {
  it("includes every failed invoice and actionable Indonesian instructions", () => {
    const message = incompleteResultMessage({ failedInvoices: ["001", "002"], failureCount: 2 });
    expect(message).toContain("Faktur gagal: 001, 002.");
    expect(message).toContain("2 proses gagal");
    expect(message).toContain("Periksa sesi Coretax dan filter, lalu jalankan ulang");
    expect(message).not.toContain("PDF sudah tidak tersedia");
  });

  it("distinguishes cancellation and warns that prior PDF downloads remain", () => {
    expect(incompleteResultMessage({ cancelled: true })).toContain("Proses dibatalkan.");
    expect(incompleteResultMessage({ partial: true })).toContain("PDF yang sudah diunduh tetap tersimpan.");
  });

  it("says nothing for a complete result", () => {
    expect(incompleteResultMessage({})).toBeNull();
    expect(incompleteResultMessage({ partial: false, failureCount: 0 })).toBeNull();
  });

  it("preserves the original reason and states the export preference is gone", () => {
    const message = scrapeErrorMessage("Sesi berakhir.");
    expect(message).toContain("Sesi berakhir.");
    expect(message).toContain("jalankan ulang");
    expect(scrapeErrorMessage()).toContain("Proses gagal.");
  });
});

// ── Missing-invoice reporting ────────────────────────────────────────────────
// A No. Faktur number Coretax has no row for is NOT a lookup failure: the request
// succeeds with an empty payload, so the scrape looks complete and the export
// comes back short. These cases pin the diff that makes the gap visible, and the
// two wordings that differ only in the reason they give.

describe("missing-invoice reporting", () => {
  it("reports requested numbers no row carries, once each", () => {
    const rows = [{ TaxInvoiceNumber: "001" }, { TaxInvoiceNumber: "002" }];
    expect(findMissingInvoices(["001", "002", "003", "003"], rows)).toEqual(["003"]);
  });

  it("matches LetterNumber as a fallback and ignores case", () => {
    const letter = [{ LetterNumber: "040-001" }];
    expect(findMissingInvoices(["040-001"], letter)).toEqual([]);
    expect(findMissingInvoices(["040-002"], letter)).toEqual(["040-002"]);
    expect(findMissingInvoices(["abc"], [{ TaxInvoiceNumber: "ABC" }])).toEqual([]);
  });

  it("reports nothing when the request is empty or fully matched", () => {
    expect(findMissingInvoices([], [])).toEqual([]);
    expect(findMissingInvoices([], [{ TaxInvoiceNumber: "001" }])).toEqual([]);
    expect(findMissingInvoices(["001"], [{ TaxInvoiceNumber: "001" }])).toEqual([]);
    expect(missingInvoicesMessage(3, [])).toBeNull();
  });

  it("lists a sample and summarizes the remainder", () => {
    const missing = ["A", "B", "C", "D", "E", "F", "G"];
    expect(missingInvoicesMessage(20, missing)).toBe(
      "7 dari 20 nomor faktur tidak ditemukan di Coretax: A, B, C, D, E (+2 nomor lain).",
    );
  });

  it("phrases the bulk-PDF variant around the data already captured", () => {
    // Same list, different reason: these numbers are absent from the rows on hand,
    // so those files will not be downloaded at all.
    expect(skippedInvoicesMessage(20, ["040-002"])).toBe(
      "1 dari 20 nomor faktur tidak ada di data yang sudah diambil dan akan dilewati: 040-002.",
    );
    expect(skippedInvoicesMessage(20, ["A", "B", "C", "D", "E", "F"])).toContain("(+1 nomor lain)");
    expect(skippedInvoicesMessage(3, [])).toBeNull();
  });
});

describe("currentRunHandlers", () => {
  const types = ["SCRAPE_PROGRESS", "SCRAPE_COMPLETE", "SCRAPE_ERROR", "DOWNLOAD_PDF_ITEM", "INJECTED_READY"];

  it.each(types)("checks run freshness for %s inside the token-guarded dispatcher", (type) => {
    const handler = vi.fn();
    const isCurrent = vi.fn((msg: Record<string, unknown>) => msg.runId === 2);
    const selfWindow = { location: { origin: "https://example.test" } };
    const dispatcher = createMessageDispatcher({
      direction: "FROM_PAGE",
      token: "test-token",
      selfWindow,
      handlers: currentRunHandlers({ [type]: handler }, isCurrent),
    });
    const send = (runId: number, token = "test-token") => dispatcher.handle({
      source: selfWindow,
      origin: selfWindow.location.origin,
      data: { direction: "FROM_PAGE", type, token, runId },
    });
    send(2, "wrong-token");
    expect(isCurrent).not.toHaveBeenCalled();
    send(1);
    expect(handler).not.toHaveBeenCalled();
    send(2);
    expect(handler).toHaveBeenCalledExactlyOnceWith({ type, runId: 2 });
  });

  it.each(["DOWNLOAD_PDF_ITEM", "INJECTED_READY"])("delegates the unscoped %s exception to the bridge", (type) => {
    const handler = vi.fn();
    const isCurrent = vi.fn(() => true);
    currentRunHandlers({ [type]: handler }, isCurrent)[type]({ type });
    expect(isCurrent).toHaveBeenCalledWith({ type });
    expect(handler).toHaveBeenCalledWith({ type });
  });
});