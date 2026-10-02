import { describe, expect, it } from "vitest";
import type { ScrapeComplete } from "../content/scraper-types";
import { createRunLifecycle } from "../content/run-lifecycle";

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

describe("complete — rejection", () => {
  it.each([
    { partial: true },
    { cancelled: true },
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

describe("cancelExport", () => {
  // The export click that doubles as a stop. Pinned deliberately: this path
  // keeps the last good rows so a following export can still use them, and it
  // keeps a pending comparison, which outlives the run carrying it. Collapsing
  // it into abort() would silently drop reusable data.
  it("drops only the export request and the invoice list, keeping the rows", () => {
    const run = withResult();
    run.begin("bulk-pdf");
    run.request({ kind: "export", format: "pdf" });
    run.noteRequestedInvoices(["001"]);

    run.cancelExport();

    expect(run.isRunning()).toBe(false);
    expect(run.result()?.data).toEqual([{ TaxInvoiceNumber: "001" }]);

    const next = run.complete(complete());
    expect(next.kind === "accepted" && next.followUp).toEqual([]);
    expect(next.kind === "accepted" && next.shortfall).toBeNull();
  });

  it("keeps a pending comparison, which is not this run's export request", () => {
    const run = withResult();
    run.request({ kind: "compare" });

    run.cancelExport();

    const next = run.complete(complete());
    expect(next.kind === "accepted" && next.followUp).toEqual([{ kind: "compare" }]);
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