import { describe, expect, it } from "vitest";
import {
  failedRun,
  settleCompletion,
  type RunReport,
  type SurfaceUpdate,
} from "../content/completion-intake";
import { createRunLifecycle, type RunLifecycle } from "../content/run-lifecycle";
import { sweepOf } from "../content/sweep";
import { addResultChunk, createResultChunkBuffer } from "../content/result-chunks";
import type { ScrapeComplete, ScrapeDataChunkMessage } from "../content/scraper-types";

/** The twelve codes of one year, oldest first. */
const YEAR_PLAN = Array.from({ length: 12 }, (_, i) => `TD.007${String(i + 1).padStart(2, "0")}`);

// The report is the one place a completion's MEANING is decided, so these tests
// assert the rules directly: the order the panel is told to say things in, what
// the transfer's single use costs, what a resume settles, and what each way of
// ending a Run announces. main.ts only paints a report; its harness still
// drives the message wiring.

function completion(overrides: Partial<ScrapeComplete> = {}): ScrapeComplete {
  return {
    type: "SCRAPE_COMPLETE",
    data: [{ RecordId: 1 }],
    fields: ["RecordId"],
    total: 1,
    pages: 1,
    elapsed: "1s",
    source: "OUTPUT_TAX",
    ...overrides,
  };
}

function sweepSummary(counts: { period: string; rows: number; error?: string }[], plan = YEAR_PLAN) {
  return sweepOf(counts, plan);
}

/** A Run already holding a stopped sweep's kept half, as a reload restores it. */
function runWithKeptSweep(): RunLifecycle {
  const run = createRunLifecycle();
  run.restore({
    data: [{ RecordId: 1 }, { RecordId: 2 }],
    fields: ["RecordId"],
    filenameHint: "2026",
    source: "OUTPUT_TAX",
    partialSweep: true,
    sweep: sweepSummary([{ period: "TD.00701", rows: 2 }]),
  });
  return run;
}

function chunk(overrides: Partial<ScrapeDataChunkMessage> = {}): ScrapeDataChunkMessage {
  return { type: "SCRAPE_DATA_CHUNK", index: 0, chunks: 1, rows: [{ RecordId: 1 }], ...overrides };
}

function topics(report: RunReport): string[] {
  return report.updates.map((update) =>
    update.kind === "status" ? `status:${update.topic}` : update.kind,
  );
}

describe("settleCompletion — an accepted run", () => {
  it("turns an inline completion into one completion update and a clean toast", () => {
    const run = createRunLifecycle();
    run.begin("scrape");

    const report = settleCompletion({
      completion: completion({ data: [{ RecordId: 1 }, { RecordId: 2 }], total: 2 }),
      transfer: createResultChunkBuffer(),
      run,
    });

    expect(report.ending).toBe("accepted");
    expect(report.updates).toEqual<SurfaceUpdate[]>([
      {
        kind: "complete",
        total: 2,
        pages: 1,
        elapsed: "1s",
        runKind: undefined,
        failedItems: undefined,
      },
    ]);
    expect(report.notification).toEqual({
      kind: "scrape",
      detail: "2 data diproses, tanpa kegagalan.",
    });
    expect(report.followUp).toEqual([]);
    expect(run.result()?.data).toHaveLength(2);
  });

  it("assembles a chunked result by index and empties the transfer", () => {
    const run = createRunLifecycle();
    run.begin("scrape");
    const transfer = createResultChunkBuffer();
    addResultChunk(transfer, chunk({ index: 0, chunks: 2, rows: [{ RecordId: 1 }] }));
    addResultChunk(transfer, chunk({ index: 1, chunks: 2, rows: [{ RecordId: 2 }] }));

    const report = settleCompletion({
      completion: completion({ data: [], dataChunks: 2, total: 2 }),
      transfer,
      run,
    });

    expect(report.ending).toBe("accepted");
    expect(run.result()?.data?.map((row) => row.RecordId)).toEqual([1, 2]);
    // Single use: the next completion cannot be answered by these chunks.
    expect(transfer.chunks.size).toBe(0);
    expect(transfer.expected).toBeNull();
  });

  it("keeps the whole panel order: completion, shortfall, batch, truncation, failed files", () => {
    const run = createRunLifecycle();
    run.begin("targeted");
    run.noteRequestedInvoices(["001", "002"]);

    const report = settleCompletion({
      completion: completion({
        data: [{ RecordId: 1, TaxInvoiceNumber: "001" }],
        periods: sweepSummary([{ period: "TD.00701", rows: 1 }]),
        truncated: true,
        expectedTotal: 9,
        failedItems: ["FP-1"],
      }),
      transfer: createResultChunkBuffer(),
      run,
    });

    expect(topics(report)).toEqual([
      "complete",
      "status:shortfall",
      "status:batch",
      "status:truncated",
      "status:failed-items",
    ]);
    const shortfall = report.updates[1];
    expect(shortfall.kind === "status" && shortfall.text).toContain("002");
    // A truncated run must not be announced as a clean success, and the file
    // names travel in the panel line (the toast reports counts, not names).
    expect(report.notification?.detail).toContain("hasil mungkin belum lengkap");
    expect(report.notification?.detail).not.toContain("tanpa kegagalan");
    const failedFiles = report.updates[4];
    expect(failedFiles.kind === "status" && failedFiles.text).toContain("FP-1");
  });

  it("names a bulk PDF run as a PDF in the notification", () => {
    const run = createRunLifecycle();
    run.begin("bulk-pdf");

    const report = settleCompletion({
      completion: completion({ kind: "pdf" }),
      transfer: createResultChunkBuffer(),
      run,
    });

    expect(report.notification?.kind).toBe("pdf");
  });

  it("returns the Run's outstanding work in the panel's own order", () => {
    const run = createRunLifecycle();
    run.begin("scrape");
    run.request({ kind: "export", format: "xlsx" });
    run.request({ kind: "check" });
    run.request({ kind: "compare" });

    const report = settleCompletion({
      completion: completion(),
      transfer: createResultChunkBuffer(),
      run,
    });

    expect(report.followUp).toEqual([
      { kind: "compare" },
      { kind: "check" },
      { kind: "export", format: "xlsx" },
    ]);
  });
});

describe("settleCompletion — a lapsed transfer", () => {
  it("reports an incomplete transfer instead of a result, and keeps the Run as it was", () => {
    const run = createRunLifecycle();
    run.begin("scrape");
    const transfer = createResultChunkBuffer();
    addResultChunk(transfer, chunk({ index: 0, chunks: 2 }));

    const report = settleCompletion({
      completion: completion({ data: [], dataChunks: 2, total: 2 }),
      transfer,
      run,
    });

    expect(report.ending).toBe("incomplete");
    expect(report.completion).toBeNull();
    expect(report.updates).toEqual([
      {
        kind: "error",
        text: "Transfer hasil tidak lengkap: 1 bagian data tidak diterima. Coba ekspor kembali.",
      },
    ]);
    expect(report.notification?.kind).toBe("error");
    expect(report.followUp).toEqual([]);
    // The historical contract: this path never settled the Run, and this
    // module does not quietly start doing so.
    expect(run.result()).toBeNull();
    expect(run.isRunning()).toBe(true);
    // Single use applies to a lost transfer too.
    expect(transfer.chunks.size).toBe(0);
  });
});

describe("settleCompletion — a stopped sweep", () => {
  it("salvages the rows a cancelled completion carries and says how much survived", () => {
    const run = createRunLifecycle();
    run.begin("scrape");

    const report = settleCompletion({
      completion: completion({
        data: [{ RecordId: 1 }, { RecordId: 2 }],
        total: 2,
        cancelled: true,
        periods: sweepSummary([{ period: "TD.00701", rows: 2 }]),
      }),
      transfer: createResultChunkBuffer(),
      run,
    });

    expect(report.ending).toBe("salvaged");
    expect(report.updates).toHaveLength(1);
    expect(report.updates[0].kind).toBe("status");
    const line = report.updates[0];
    expect(line.kind === "status" && line.text).toContain("Proses dihentikan");
    expect(line.kind === "status" && line.text).toContain("1 dari 12 masa pajak selesai");
    // A stop is not a completion: no toast may claim it finished.
    expect(report.notification).toBeNull();
    expect(report.followUp).toEqual([]);
    expect(run.result()?.partialSweep).toBe(true);
  });

  it("settles the UNION of a resumed sweep, not this half alone", () => {
    const run = runWithKeptSweep();

    const report = settleCompletion({
      completion: completion({
        data: [{ RecordId: 2 }, { RecordId: 3 }],
        total: 2,
        periods: sweepSummary([
          { period: "TD.00701", rows: 2 },
          { period: "TD.00702", rows: 1 },
        ]),
      }),
      transfer: createResultChunkBuffer(),
      run,
    });

    expect(report.ending).toBe("accepted");
    // Previous rows first, deduplicated: the invoice in both halves appears once.
    expect(report.completion?.data.map((row) => row.RecordId)).toEqual([1, 2, 3]);
    // The panel names what the FILE holds, not the sum of two accumulators.
    expect(report.completion?.total).toBe(3);
    expect(report.completion?.periods?.totalRows).toBe(3);
    expect(report.completion?.periods?.counts.map((count) => count.period)).toEqual([
      "TD.00701",
      "TD.00702",
    ]);
    // A finished resume is a whole year again.
    expect(run.result()?.partialSweep).toBeUndefined();
  });

  it("keeps the kept half when a resumed sweep is stopped again", () => {
    const run = runWithKeptSweep();

    const report = settleCompletion({
      completion: completion({
        data: [{ RecordId: 3 }],
        total: 1,
        cancelled: true,
        periods: sweepSummary([
          { period: "TD.00701", rows: 2 },
          { period: "TD.00702", rows: 1 },
        ]),
      }),
      transfer: createResultChunkBuffer(),
      run,
    });

    expect(report.ending).toBe("salvaged");
    expect(report.completion?.data.map((row) => row.RecordId)).toEqual([1, 2, 3]);
    expect(run.result()?.partialSweep).toBe(true);
  });
});

describe("settleCompletion — a refused result", () => {
  it("rejects a partial run and spends nothing it owed", () => {
    const run = createRunLifecycle();
    run.begin("scrape");
    run.request({ kind: "compare" });

    const report = settleCompletion({
      completion: completion({ partial: true, failureCount: 1 }),
      transfer: createResultChunkBuffer(),
      run,
    });

    expect(report.ending).toBe("rejected");
    expect(report.updates[0].kind).toBe("error");
    expect(report.notification?.kind).toBe("error");
    expect(report.followUp).toEqual([]);
    expect(run.result()).toBeNull();
    expect(run.isRunning()).toBe(false);
  });
});

describe("failedRun", () => {
  it("keeps nothing, drops every request, and announces the failure", () => {
    const run = createRunLifecycle();
    run.begin("scrape");
    run.request({ kind: "export", format: "xlsx" });
    const retired: string[][] = [];
    run.onRetired((kinds) => retired.push([...kinds]));

    const report = failedRun({ message: "HTTP 500", run });

    expect(report.ending).toBe("failed");
    expect(report.notification).toEqual({
      kind: "error",
      detail:
        "HTTP 500 Ekspor dan pemeriksaan otomatis dibatalkan. Periksa sesi Coretax dan filter, lalu jalankan ulang.",
    });
    expect(report.updates).toEqual([{ kind: "error", text: report.notification!.detail }]);
    expect(report.followUp).toEqual([]);
    expect(run.isRunning()).toBe(false);
    expect(run.result()).toBeNull();
    // ADR-0022: the requests die with the Run, and the retirement says so.
    expect(retired).toEqual([["export"]]);
  });

  it("falls back to the documented wording when the producer sent no message", () => {
    const run = createRunLifecycle();
    run.begin("scrape");

    const report = failedRun({ run });

    expect(report.notification?.detail.startsWith("Proses gagal.")).toBe(true);
  });
});
