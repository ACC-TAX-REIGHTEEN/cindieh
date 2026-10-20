// ============================================================
// VITEST.CONFIG.TS — Test discovery defaults + the coverage baseline
// ============================================================
// Test discovery itself stays on vitest's defaults (only `test` is extended, no
// `include` override), so this file exists for the coverage ratchet.
//
// The thresholds are a RATCHET, not a target: they sit a little under the
// measured numbers so ordinary churn cannot fail the suite, while a real
// regression — new logic shipping without tests — does. Raise them as coverage
// improves; never lower them to make a red build green.
//
// Measured 2026-10-20 on the whole suite (2051 tests). The modules that hold
// the baseline down are recorded in AGENTS.md so a low number reads as a known
// gap rather than a mystery.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",

      include: ["src/**/*.ts"],

      exclude: [
        "src/tests/**",
        // Types-only module: it compiles to an empty file, so every metric
        // reads 0% and would only dilute the real numbers.
        "src/content/scraper-types.ts",
        // The SheetJS chunk (ADR-0013). It is a standalone build entry that
        // tests must NOT import — doing so would put the library back in the
        // page-load bundle. Its correctness is proved by importing the BUILT
        // content/xlsx.js, not by unit-testing the source.
        "src/content/xlsx-runtime.ts",
      ],

      reporter: ["text", "html"],

      // Baseline floors. Global, so a new well-tested module may raise the
      // average while an untested one still drags it down.
      //
      // Raised from 80/72/74/82 after the column-schema extraction, again by
      // the run-lifecycle extraction (ADR-0014), again on branches and
      // functions by the export-source spec extraction (ADR-0015), to
      // 81.2/73.5/76.4/83.3 as the suite grew past 1280 tests, to
      // 83.4/76.3/79.2/85.2 after the bulk-PDF failure naming and the checker
      // defaults, to 87.7/81.3/83.7/89.3 once the Pengecekan tab became its own
      // view module with its own render suite, to 91.1/83.9/86.8/92.5 once the
      // three uncovered end-of-chain writers got their own suites — downloader.ts
      // (96.29 statements, was 44), ui-filters.ts (99.54, was 55) and exporter's
      // exportCSV/writeXlsxFile (92.19, was ~76), to 92.4/85.4/88.9/93.8
      // with the in-page event seam in the main boot harness (main.ts 71.82 ->
      // 90.47 statements, 49.25 -> 72.38 branch) — and now to 92.7/85.9/89.1/94.1
      // with the keyboard stop settling its Run through the toolbar's stop path,
      // the failed-masa retry in the year sweep, and the notification naming a
      // sweep's losses, and now to 92.9/86.2/89.3/94.3 with the year-wide export
      // gated onto the four e-Faktur PPN grids behind its scope guard (ADR-0019),
      // and to the same floors with the stop-salvage (ADR-0020), whose own suites
      // paid for it: run-lifecycle, scrape-result, bridge, exporter, the batch
      // sweep and the main boot harness each grew cases — and then raised to
      // 93.2/86.6/90.0/94.5 by the two features that followed, the Referensi
      // filter reaching both PPN grids (ADR-0021), the stop retiring every
      // request a Run carried (ADR-0022) and the resumable stopped sweep
      // (ADR-0023), whose pure arithmetic (sweep.ts) is fully covered and
      // whose union merge is driven end to end by the boot
      // harness — and then to the same floors with the accuracy check reaching
      // the two Retur grids (ADR-0024), whose four page facts, identity table
      // and view wiring each brought their own cases — and now raised to
      // 93.6/87.6/91.1/94.9 by the result columns reaching their file through one
      // schema (ADR-0030) and by a resumable sweep surviving a reload in BOTH of
      // its states: a stop's kept half and a sweep that FINISHED with a masa the
      // portal failed to deliver (ADR-0023 amendment), and now to
      // 94.0/88.4/91.6/95.2 by the page's surfaces having one owner each
      // (ADR-0033) — a registry that is fully covered, and the two leaks it
      // closed (the toolbar filter's container, the panel's inert background).
      // The measured numbers are 94.24/88.82/91.85/95.39, and now
      // 94.47/89.11/92.25/95.47 with the per-item loop (ADR-0034): the MAIN
      // world's four item-at-a-time flows now share one measured stop check,
      // one breaker and one wait, and the module that holds them is covered
      // on its own terms, and now 94.51/89.18/92.35/95.49 with the one seam
      // per world (ADR-0035): the context moved to scraper-context.ts, the
      // graph lost its cycles, and the formatters the schema declares came
      // back to the schema. The functions floor moves with it, and now
      // 94.77/89.40/92.91/95.77 with each panel tab as its own view module
      // (ADR-0036): the Bandingkan tab can finally be mounted on its own, so
      // the shell that hosts it has no tab left in it to test, and now
      // 94.91/89.89/93.21/95.88 once a preference was declared as ONE row
      // (ADR-0037): four copies of the key map became one table, and the popup'
      // nineteen hand-written control blocks became nine rows behind a binder,
      // and now 95.20/90.10/93.54/96.21 with the MAIN world's install wiring
      // taking the page as one injected env (ADR-0038): the adapter is 100%
      // and the wiring it used to be mixed into can finally be driven. The
      // floors stay where they are, because the measurement is flat: the
      // sweep's arithmetic MOVED from scrape-batch.ts into sweep.ts (ADR-0040),
      // which is 100% on its own terms, and the aggregate is unchanged at
      // 95.19/90.12/93.56/96.22 on 2051 tests.
      //
      // The cushion is deliberately ~0.4 points, the same gap the floors have
      // always kept: enough that ordinary churn cannot redden the build, small
      // enough that shipping new logic without tests does. The microsite
      // legal-copy guards live in src/tests (excluded here), so that suite is
      // neutral to these numbers.
      //
      // exporter.exportXLSX — the one entry that awaits the SheetJS chunk — is
      // still uncovered on purpose: importing the real chunk in a test is what
      // ADR-0013 forbids, and the loader seam it stands on (createXlsxChunkLoader)
      // is covered directly. Do not paper the gap over by lowering a floor; move
      // it by testing the seam underneath.
      thresholds: {
        statements: 94.8,
        branches: 89.7,
        functions: 93.1,
        lines: 95.8,
      },
    },
  },
});
