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
// Measured 2026-10-06 on the whole suite (1454 tests). The modules that hold
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
      // defaults, and now to 87.7/81.3/83.7/89.3 once the Pengecekan tab
      // became its own view module with its own render suite. The measured
      // numbers are 88.03/81.71/84.10/89.72.
      //
      // The cushion is deliberately ~0.3-0.4 points, the same gap the floors
      // have always kept: enough that ordinary churn cannot redden the build,
      // small enough that shipping new logic without tests does. The microsite
      // legal-copy guards live in src/tests (excluded here), so that suite is
      // neutral to these numbers.
      //
      // Statements and lines were left alone for ADR-0015 even though the new
      // module is 100% covered: exporter.ts shrank 675 -> 381 lines, so its
      // still-untested download entry points (exportCSV, writeXlsxFile,
      // exportXLSX) weigh more heavily against a smaller denominator. Same
      // uncovered code, tighter ratio — not a regression to paper over, and not
      // a reason to lower a floor.
      thresholds: {
        statements: 87.7,
        branches: 81.3,
        functions: 83.7,
        lines: 89.3,
      },
    },
  },
});
