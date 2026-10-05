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
// Measured 2026-10-02 on the whole suite (1230 tests). The modules that hold
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
      // Raised from 80/72/74/82 after the column-schema extraction, then again
      // by the run-lifecycle extraction (ADR-0014), then on branches and
      // functions by the export-source spec extraction (ADR-0015), then to
      // 81.2/73.5/76.4/83.3 as the suite grew past 1280 tests; the measured
      // numbers are now 83.73/76.58/79.59/85.55. The microsite legal-copy
      // guards live in src/tests (excluded here), so that suite is neutral to
      // these numbers — the headroom above the previous floors was already
      // there and is now locked in rather than left as slack.
      //
      // Statements and lines were left alone for ADR-0015 even though the new
      // module is 100% covered: exporter.ts shrank 675 -> 381 lines, so its
      // still-untested download entry points (exportCSV, writeXlsxFile,
      // exportXLSX) weigh more heavily against a smaller denominator. Same
      // uncovered code, tighter ratio — not a regression to paper over, and not
      // a reason to lower a floor.
      thresholds: {
        statements: 83.4,
        branches: 76.3,
        functions: 79.2,
        lines: 85.2,
      },
    },
  },
});
