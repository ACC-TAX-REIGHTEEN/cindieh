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
// Measured 2026-10-14 on the whole suite (1623 tests). The modules that hold
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
      // sweep's losses. The measured numbers are 93.11/86.3/89.51/94.5.
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
        statements: 92.7,
        branches: 85.9,
        functions: 89.1,
        lines: 94.1,
      },
    },
  },
});
