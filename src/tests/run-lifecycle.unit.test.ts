import { describe, expect, it } from "vitest";
import type { ScrapeComplete } from "../content/scraper-types";
import { createRunLifecycle } from "../content/run-lifecycle";
import { summarisePeriods } from "../content/scrape-batch";

// A Run owns three things: whether it is in flight, what it still owes, and
// what it last produced. These tests assert those as RULES of one interface —
// "a pending request is spent exactly once" is a single property, not one
// assertion per field per call site, which is what it used to be.

function complete(overrides: Partial<ScrapeComplete> = {}): ScrapeComplete {
  return {
    type: "SCRAPE_COMPLETE",
    data: [{ TaxInvoiceNumber: "001" }],
    fields: ["TaxInvoiceNumber"],
    total: 1,
    pages: 1,
    elapsed: "1s",
    source: "OUTPUT_TAX",
    ...overrides,
  };
}

/** A finished, accepted run carrying reusable rows. */
function withResult(run = createRunLifecycle()) {
  run.begin("scrape");
  run.complete(complete({ filenameHint: "2026" }));
  return run;
}

describe("createRunLifecycle", () => {
  it("gives every instance its own state", () => {
    const a = createRunLifecycle();
    const b = createRunLifecycle();
    a.begin("scrape");
    expect(a.isRunning()).toBe(true);
    expect(b.isRunning()).toBe(false);
  });
});

describe("begin", () => {
  it("marks a run in flight", () => {
    const run = createRunLifecycle();
    run.begin("scrape");
    expect(run.isRunning()).toBe(true);
  });

  it("retires the previous rows when a full scrape replaces the grid", () => {
    const run = withResult();
    run.begin("scrape");
    expect(run.result()).toBeNull();
  });

  it.each(["targeted", "bulk-pdf"] as const)(
    "keeps the captured rows for a %s run, which reads them",
    (start) => {
      const run = withResult();
      run.begin(start);
      expect(run.result()?.data).toEqual([{ TaxInvoiceNumber: "001" }]);
    },
  );
});

describe("request", () => {
  it("records each intent and spends all three, in order, on completion", () => {
    const run = createRunLifecycle();
    run.begin("scrape");
    run.request({ kind: "export", format: "xlsx" });
    run.request({ kind: "check" });
    run.request({ kind: "compare" });

    const outcome = run.complete(complete());

    expect(outcome).toEqual({
      kind: "accepted",
      followUp: [{ kind: "compare" }, { kind: "check" }, { kind: "export", format: "xlsx" }],
      shortfall: null,
    });
  });

  it("keeps the requested format", () => {
    for (const format of ["xlsx", "csv", "pdf"] as const) {
      const run = createRunLifecycle();
      run.request({ kind: "export", format });
      const outcome = run.complete(complete());
      expect(outcome.kind === "accepted" && outcome.followUp).toEqual([
        { kind: "export", format },
      ]);
    }
  });

  it("spends a pending intent exactly once — a later run inherits nothing", () => {
    const run = createRunLifecycle();
    run.request({ kind: "export", format: "csv" });
    run.request({ kind: "compare" });
    run.request({ kind: "check" });

    expect(run.complete(complete()).kind).toBe("accepted");

    const second = run.complete(complete());
    expect(second.kind === "accepted" && second.followUp).toEqual([]);
  });
});

describe("noteRequestedInvoices", () => {
  it("reports numbers no returned row carries", () => {
    const run = createRunLifecycle();
    run.begin("targeted");
    run.noteRequestedInvoices(["001", "404"]);

    const outcome = run.complete(complete());

    expect(outcome).toMatchObject({
      kind: "accepted",
      shortfall: {
        count: 1,
        notice: "1 dari 2 nomor faktur tidak ditemukan di Coretax: 404.",
      },
    });
  });

  it("reports nothing when every requested number came back", () => {
    const run = createRunLifecycle();
    run.noteRequestedInvoices(["001"]);
    const outcome = run.complete(complete());
    expect(outcome.kind === "accepted" && outcome.shortfall).toBeNull();
  });

  it("still counts the shortfall for a PDF run, but leaves the panel to the dialog", () => {
    // The count is what the completion notification uses, so it must survive the
    // suppression; only the notice is withheld, because the pre-download dialog
    // already named these numbers and per-file progress has taken the panel.
    const run = createRunLifecycle();
    run.noteRequestedInvoices(["404"]);

    const outcome = run.complete(complete({ kind: "pdf", data: [] }));

    expect(outcome.kind === "accepted" && outcome.shortfall).toEqual({ count: 1, notice: null });
  });

  it("spends the request, so a later run cannot be diffed against it", () => {
    const run = createRunLifecycle();
    run.noteRequestedInvoices(["404"]);
    run.complete(complete({ data: [] }));

    const second = run.complete(complete({ data: [] }));
    expect(second.kind === "accepted" && second.shortfall).toBeNull();
  });
});

describe("complete — a stopped sweep", () => {
  it("keeps the rows it had collected and drops everything the Run owed", () => {
    const run = createRunLifecycle();
    run.begin("scrape");
    run.request({ kind: "export", format: "xlsx" });
    run.request({ kind: "compare" });

    const outcome = run.complete(
      complete({
        cancelled: true,
        data: [{ TaxInvoiceNumber: "001" }, { TaxInvoiceNumber: "002" }],
        total: 2,
        filenameHint: "2026",
      }),
    );

    // Neither accepted nor rejected: the rows are real, the request is not done.
    expect(outcome).toEqual({ kind: "salvaged" });
    expect(run.isRunning()).toBe(false);
    expect(run.result()).toMatchObject({
      filenameHint: "2026",
      source: "OUTPUT_TAX",
      partialSweep: true,
    });
    expect(run.result()?.data).toHaveLength(2);

    // Nothing the interrupted request owed may run on a partial year: an
    // eleven-month comparison would look exactly like a complete one.
    expect(run.pendingExport()).toBeNull();
    const next = run.complete(complete());
    expect(next.kind === "accepted" && next.followUp).toEqual([]);
    // And the flag describes the rows it came with, not the lifecycle: the next
    // Run's export is a whole one.
    expect(run.result()?.partialSweep).toBeUndefined();
  });

  it("keeps nothing when the stop had collected nothing", () => {
    const run = createRunLifecycle();
    run.begin("scrape");

    // A cancellation that carries no rows keeps the older meaning: rejected,
    // with the panel's own explanation (incompleteResultMessage).
    const outcome = run.complete(complete({ cancelled: true, data: [], total: 0 }));

    expect(outcome.kind).toBe("rejected");
    expect(run.result()).toBeNull();
  });

  it("does not carry a stopped sweep's rows into the Run after it", () => {
    const run = createRunLifecycle();
    run.begin("scrape");
    run.complete(complete({ cancelled: true, data: [{ TaxInvoiceNumber: "001" }] }));
    expect(run.result()?.partialSweep).toBe(true);

    run.begin("scrape");

    expect(run.result()).toBeNull();
  });
});

describe("a resumed sweep", () => {
  /** The half a stopped year-wide sweep keeps: rows, the flag and the counts. */
  function keptSweep() {
    const run = createRunLifecycle();
    run.begin("scrape");
    run.complete(
      complete({
        cancelled: true,
        data: [{ TaxInvoiceNumber: "001" }],
        total: 1,
        filenameHint: "2026",
        periods: summarisePeriods([{ period: "TD.00701", rows: 1 }], 12),
      }),
    );
    return run;
  }

  it("starts from the kept rows AND the counts that say what is missing", () => {
    const run = keptSweep();
    expect(run.result()?.sweep?.planned).toBe(12);
    expect(run.result()?.partialSweep).toBe(true);

    run.begin("sweep-resume");

    // Neither is dropped: `pendingPeriods` needs the counts and the merge needs
    // the rows, so a resume that began by forgetting either would be a fresh
    // sweep wearing the name.
    expect(run.result()?.data).toEqual([{ TaxInvoiceNumber: "001" }]);
    expect(run.result()?.sweep?.counts).toEqual([{ period: "TD.00701", rows: 1 }]);
  });

  it("accepts the union it was handed and stops calling the file partial", () => {
    const run = keptSweep();
    run.begin("sweep-resume");

    const outcome = run.complete(
      complete({
        data: [{ TaxInvoiceNumber: "001" }, { TaxInvoiceNumber: "002" }],
        total: 2,
        periods: summarisePeriods(
          [{ period: "TD.00701", rows: 1 }, { period: "TD.00702", rows: 1 }],
          12,
        ),
      }),
    );

    expect(outcome.kind).toBe("accepted");
    // The year is whole now, so the next export is a whole-year file: the flag
    // that names it `-sebagian` travels with the stop, not with the rows.
    expect(run.result()?.partialSweep).toBeUndefined();
    expect(run.result()?.sweep?.counts).toHaveLength(2);
  });

  it("keeps the union when the resume itself dies", () => {
    // Both ways a resume can end badly. It can only ever ADD to what a stop
    // salvaged, so a failed resume must not be worse than no resume at all.
    for (const end of ["abort", "rejected"] as const) {
      const run = keptSweep();
      run.begin("sweep-resume");

      if (end === "abort") {
        run.abort();
      } else {
        // A completion the Run refuses (a truncated or partial one): the
        // rejection path ends the Run exactly as abort does.
        expect(run.complete(complete({ partial: true })).kind).toBe("rejected");
      }

      expect(run.isRunning()).toBe(false);
      expect(run.result()?.data).toEqual([{ TaxInvoiceNumber: "001" }]);
      expect(run.result()?.sweep?.counts).toEqual([{ period: "TD.00701", rows: 1 }]);
      expect(run.result()?.partialSweep).toBe(true);
    }
  });

  it("keeps the union when the export click stops it", () => {
    const run = keptSweep();
    run.begin("sweep-resume");
    run.request({ kind: "export", format: "xlsx" });

    run.stopKeepingRows();

    expect(run.result()?.data).toEqual([{ TaxInvoiceNumber: "001" }]);
    expect(run.result()?.sweep?.planned).toBe(12);
    expect(run.pendingExport()).toBeNull();
  });

  it("a fresh sweep still replaces the kept half", () => {
    const run = keptSweep();
    run.begin("scrape");
    expect(run.result()).toBeNull();

    run.complete(complete({ data: [{ TaxInvoiceNumber: "009" }], total: 1 }));
    // The counts travelled with the rows they described: a fresh run's result
    // carries none, so it cannot be resumed against the old year's masa.
    expect(run.result()?.sweep).toBeUndefined();
    expect(run.result()?.partialSweep).toBeUndefined();
  });

  it("drops the counts when a run replaces the rows without being a sweep", () => {
    // A targeted No. Faktur lookup (and a bulk PDF run's own grid scrape) keeps
    // the rows until its completion arrives and then REPLACES them — with the
    // filtered subset, not with a year. The counts describe rows that are no
    // longer here, so keeping them would let the next year-export offer to
    // "resume" a year whose masa this world does not hold.
    const run = keptSweep();
    run.begin("targeted");

    run.complete(complete({ data: [{ TaxInvoiceNumber: "001" }], total: 1 }));

    expect(run.result()?.sweep).toBeUndefined();
    expect(run.result()?.partialSweep).toBeUndefined();
  });
});

describe("complete — rejection", () => {
  it.each([
    { partial: true },
    { cancelled: true, data: [] },
    { failedInvoices: ["002"] },
    { failureCount: 2 },
  ])("rejects an incomplete result instead of fulfilling it: %j", (flags) => {
    const run = createRunLifecycle();
    run.begin("scrape");
    run.request({ kind: "export", format: "xlsx" });
    run.request({ kind: "compare" });

    const outcome = run.complete(complete(flags));

    expect(outcome.kind).toBe("rejected");
    expect(outcome.kind === "rejected" && outcome.message).toContain(
      "Data tidak disimpan sebagai hasil lengkap",
    );
    // Nothing survives: no reusable rows, no debts, no run in flight.
    expect(run.result()).toBeNull();
    expect(run.isRunning()).toBe(false);

    const next = run.complete(complete());
    expect(next.kind === "accepted" && next.followUp).toEqual([]);
  });
});

describe("result", () => {
  it("exposes the accepted rows, fields and filename hint", () => {
    const run = withResult();
    expect(run.result()).toEqual({
      data: [{ TaxInvoiceNumber: "001" }],
      fields: ["TaxInvoiceNumber"],
      filenameHint: "2026",
      source: "OUTPUT_TAX",
    });
  });

  it("is null before anything is accepted", () => {
    expect(createRunLifecycle().result()).toBeNull();
  });

  it("requires both rows and a schema — a result with only one is not exportable", () => {
    const run = withResult();
    // A PDF completion carries no fields; the grid schema is retained instead.
    run.complete(complete({ fields: [], data: [] }));
    expect(run.result()?.fields).toEqual(["TaxInvoiceNumber"]);
  });

  it("accepts an empty but complete result", () => {
    const run = createRunLifecycle();
    run.complete(complete({ data: [], total: 0 }));
    expect(run.result()?.data).toEqual([]);
  });

  it("treats a completion that carries no rows as nothing reusable", () => {
    const run = createRunLifecycle();
    run.noteRequestedInvoices(["001"]);
    const outcome = run.complete({
      ...complete(),
      data: undefined as unknown as Record<string, unknown>[],
    });
    expect(run.result()).toBeNull();
    // The shortfall diff still runs, against no rows.
    expect(outcome.kind === "accepted" && outcome.shortfall).toEqual({
      count: 1,
      notice: "1 dari 1 nomor faktur tidak ditemukan di Coretax: 001.",
    });
  });
});

describe("cancelPending", () => {
  it.each(["export", "compare", "check"] as const)("drops a pending %s alone", (kind) => {
    const run = createRunLifecycle();
    run.request({ kind: "export", format: "xlsx" });
    run.request({ kind: "compare" });
    run.request({ kind: "check" });

    run.cancelPending(kind);

    const outcome = run.complete(complete());
    const spent = outcome.kind === "accepted" ? outcome.followUp.map((f) => f.kind) : [];
    expect(spent).toHaveLength(2);
    expect(spent).not.toContain(kind);
  });

  it("is a no-op for an intent that was never requested", () => {
    const run = createRunLifecycle();
    run.cancelPending("check");
    const outcome = run.complete(complete());
    expect(outcome.kind === "accepted" && outcome.followUp).toEqual([]);
  });
});

describe("abort", () => {
  it("forgets the debts and the rows a rejected run must not leave behind", () => {
    const run = withResult();
    run.begin("scrape");
    run.request({ kind: "export", format: "pdf" });
    run.request({ kind: "compare" });
    run.request({ kind: "check" });
    run.noteRequestedInvoices(["001"]);

    run.abort();

    expect(run.isRunning()).toBe(false);
    expect(run.result()).toBeNull();
    const next = run.complete(complete());
    expect(next.kind === "accepted" && next.followUp).toEqual([]);
    expect(next.kind === "accepted" && next.shortfall).toBeNull();
  });
});

describe("stopKeepingRows", () => {
  // The export click that doubles as a stop. It is `abort()` minus the row
  // drop and nothing else: a request is spent exactly once, by the Run that
  // recorded it, so a stop retires every request that Run carried (ADR-0022).
  // Pinned deliberately — collapsing it into abort() would drop reusable rows,
  // and keeping a pending comparison would hand it to whatever completion came
  // next.
  it("drops every request and the invoice list, keeping the rows", () => {
    const run = withResult();
    run.begin("bulk-pdf");
    run.request({ kind: "export", format: "pdf" });
    run.request({ kind: "compare" });
    run.request({ kind: "check" });
    run.noteRequestedInvoices(["001"]);

    run.stopKeepingRows();

    expect(run.isRunning()).toBe(false);
    // The rows describe the grid, not the request, so they are still the newest
    // thing on hand and a following export can still use them.
    expect(run.result()?.data).toEqual([{ TaxInvoiceNumber: "001" }]);

    const next = run.complete(complete());
    expect(next.kind === "accepted" && next.followUp).toEqual([]);
    expect(next.kind === "accepted" && next.shortfall).toBeNull();
  });

  it("leaves nothing for a later, narrower completion to spend", () => {
    // The hazard the rule closes: the next completion after a stop can be a
    // No. Faktur lookup, whose rows are only the filtered subset. A comparison
    // spent on those would answer "Tidak ditemukan" for every pasted row
    // outside the filter, and a check run on them would report a silently
    // smaller grid.
    const run = createRunLifecycle();
    run.begin("scrape");
    run.request({ kind: "compare" });
    run.request({ kind: "check" });

    run.stopKeepingRows();

    run.begin("targeted");
    const next = run.complete(complete({ data: [{ TaxInvoiceNumber: "001" }] }));
    expect(next.kind === "accepted" && next.followUp).toEqual([]);
  });
});

describe("reset", () => {
  it("forgets everything, silently and completely", () => {
    const run = withResult();
    run.begin("scrape");
    run.request({ kind: "check" });
    run.noteRequestedInvoices(["001"]);

    run.reset();

    expect(run.isRunning()).toBe(false);
    expect(run.result()).toBeNull();
    const next = run.complete(complete());
    expect(next.kind === "accepted" && next.followUp).toEqual([]);
    expect(next.kind === "accepted" && next.shortfall).toBeNull();
  });
});
