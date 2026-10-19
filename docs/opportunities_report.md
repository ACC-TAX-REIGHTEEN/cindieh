# Improvement Opportunities — Cindieh

**Revision:** 2026-10-15 · snapshot `206054a` + the stop-salvage change (ADR-0020) + the Referensi page-fact split (ADR-0021) · supersedes the pass that listed thirteen items
**Measured at this snapshot:** 1.671 tests / 53 files pass · coverage 93.37 / 86.74 / 89.86 / 94.78 (ratchet floors 92.9 / 86.2 / 89.3 / 94.3) · typecheck 0 errors · eslint 0 errors · `build:chrome` + `build:firefox` OK, SheetJS still a separate 503 KB chunk (ADR-0013).

Scoring: **Impact** 1–5, **Effort** 1–5 (5 = largest), **Conf.** = how well the evidence supports the claim.
Priority: **Quick Win** (high impact, low effort) · **Fill-in** (small and bounded) · **Big Bet** · **Deprioritize**.

Every row below was re-read against the code at this snapshot rather than carried over. **Eight of the thirteen items closed since the previous revision** — seven in their own commits, and B3 with the stop-salvage change; the status column names each one. Two rows are re-characterised, one up and one down.

---

## A. New Features

| # | Opportunity | Status | Evidence (file:line at `206054a`) | Impact | Effort | Conf. | Priority |
|---|---|---|---|---|---|---|---|
| 1 | Year-wide (12-masa) export on every e-Faktur PPN grid, not just PPN Keluaran | ✅ **Done** `206054a` | The gate is now `isEfakturPage()` — [main-actions.ts:109](../src/content/main-actions.ts#L109), [ui.ts:650](../src/content/ui.ts#L650) — which is the four grids [page-context.ts:66](../src/content/page-context.ts#L66); the sweep's own scope guard lives in [scrape-batch.ts:297](../src/content/scrape-batch.ts#L297); each grid already names its file from its own prefix [export-source.ts:271-296](../src/content/export-source.ts#L271) | 4 | 3 | High | Closed |
| 2 | Per-masa recap (DPP / DPP NL / PPN / PPNBM totals) as a second sheet in the export | Open | [exporter.ts:387](../src/content/exporter.ts#L387) still writes exactly one sheet (`"Faktur"`); the per-masa counts already exist in BOTH worlds — [scraper-actions.ts:505](../src/content/scraper-actions.ts#L505) builds them, [scrape-batch.ts:326](../src/content/scrape-batch.ts#L326) rolls them up — and the isolated world already receives them at [main.ts:450](../src/content/main.ts#L450), but their only consumers are the panel line ([scrape-result.ts:184](../src/content/scrape-result.ts#L184)) and the toast. The file never carries them | 4 | 3 | Medium | Big Bet |
| 3 | Sweep a chosen month range (year-to-date / N masa) | Open | The plumbing is finished below the UI: [scrape-batch.ts:82-84](../src/content/scrape-batch.ts#L82) normalises 1–12 and [scraper.ts:160](../src/content/scraper.ts#L160) threads it through — but [main-actions.ts:251](../src/content/main-actions.ts#L251) pins `BATCH_MONTHS = 12` and [ui.ts:650-658](../src/content/ui.ts#L650) offers exactly one menu item. **Effort revised 3 → 2** | 3 | 2 | High | Fill-in |
| 4 | Pengecekan on the Retur grids | Open | [ui-panel.ts:168](../src/content/ui-panel.ts#L168) gates the tab on `isVatInvoicePage()` ([page-context.ts:62](../src/content/page-context.ts#L62) = Keluaran + Masukan), while `OUTPUT_RETURN_COLUMNS` / `INPUT_RETURN_COLUMNS` ([export-source.ts:163](../src/content/export-source.ts#L163), [:180](../src/content/export-source.ts#L180)) already declare DPP / DPP Nilai Lain / PPN per row, so the arithmetic has something to read. Two blockers, not one: the tab gate **and** the hand-back (see B8) — a retur row is keyed by `NO RETUR`, not by a reference | 3 | 3 | Medium | Deprioritize |

## B. Enhancements to Existing Features

| # | Opportunity | Status | Evidence (file:line at `206054a`) | Impact | Effort | Conf. | Priority |
|---|---|---|---|---|---|---|---|
| 1 | Compare pasted rows against the grid in O(P+S) instead of O(P×S) | ✅ **Done** `bcb0d80` | [comparer.ts:159-165](../src/content/comparer.ts#L159) builds one `Map` per comparison (first row wins, empty key skipped) and each pasted row is one lookup. The measured cost of the scan it replaced is still recorded in the comment: 180k scraped rows, ~3 s for 2,000 pasted rows that exist and ~14 s when most do not, panel frozen throughout | 4 | 1 | High | Closed |
| 2 | Ctrl+Shift+S never settled the Run in the isolated world | ✅ **Done** `8d5aed9` | Every binding now dispatches a document event instead of posting `STOP_SCRAPE` ([shortcuts.ts:17-21](../src/content/shortcuts.ts#L17)), so the key and the toolbar share one stop path that settles both worlds ([main.ts:552-558](../src/content/main.ts#L552)); pinned by [main-boot.unit.test.ts:1237-1242](../src/tests/main-boot.unit.test.ts#L1237) | 4 | 1 | High | Closed |
| 3 | Keep what a stopped long sweep already collected | ✅ **Done** (ADR-0020) | The stop now reports the masa that finished: `emitStoppedSweep` sends one `cancelled` completion with the rows, the fields and the per-period summary — including `planned`, how many periods were asked for ([scrape-batch.ts:67](../src/content/scrape-batch.ts#L67)) — and `run-lifecycle.complete` settles it as `salvaged`: rows kept, `partialSweep` set, everything the Run owed dropped. The report arrives under the id the stop retired, which `bridge.isStoppedRunMessage` remembers for exactly one message type ([main.ts:342](../src/content/main.ts#L342)). A period the stop cut short is not counted at all, so a stopped span is never reported as an empty month | 4 | 3 | High | Closed |
| 4 | Completion notification ignores empty masa and truncation | ✅ **Done** `2793ede` | `describeCompletion` now takes `failedPeriods`, `emptyPeriods` and `truncated` ([completion-notice.ts:113-143](../src/content/completion-notice.ts#L113)), and the success path supplies them from the sweep's own summary ([main.ts:442-452](../src/content/main.ts#L442)); the "tanpa kegagalan" affirmation is dropped for a failed period or a truncated result | 3 | 2 | High | Closed |
| 5 | Retry a failed masa once before reporting it failed | ✅ **Done** `7ba6614` | `PERIOD_ATTEMPTS = 2` ([scraper-actions.ts:374](../src/content/scraper-actions.ts#L374)) wraps the per-period call in a bounded loop that abandons the retry the moment the run is stopped, after a paced `PERIOD_RETRY_DELAY_MS` | 3 | 2 | High | Closed |
| 6 | Ctrl+Shift+E does not do what its own description and the README say | ✅ **Done** `8b05a3d` | The description is now "Mulai ambil data dari grid (scrape)…" ([shortcuts.ts:59-60](../src/content/shortcuts.ts#L59)); the README's shortcut table and the microsite agree. The three docs disagreed with each other *and* with the handler before this | 3 | 1 | High | Closed |
| 7 | Refuse (or flag) a sweep when the captured request carries no year filter | ✅ **Done** `75f9c87` | `capturedYear()` reads the year from the body keys the retur filename hint already uses ([scrape-batch.ts:253](../src/content/scrape-batch.ts#L253)) and `batchScopeError()` refuses both missing-filter cases ([scrape-batch.ts:297](../src/content/scrape-batch.ts#L297)); the throw happens before the loop is entered ([scraper-actions.ts:415](../src/content/scraper-actions.ts#L415)) | 3 | 1 | High | Closed |
| 8 | Hand a PPN Masukan checker row back to the grid | ✅ **Done** (ADR-0021) | The one predicate is now two page facts: `hasReferenceFilter()` gates both injection paths ([ui-filters.ts:51](../src/content/ui-filters.ts#L51), [:111](../src/content/ui-filters.ts#L111)), the two call sites in `main.ts`, and the checker's hand-back ([ui-checker.ts:462](../src/content/ui-checker.ts#L462)), while `referenceIsIdentity()` keeps the Comparer's tab on PPN Keluaran alone ([ui-panel.ts:170](../src/content/ui-panel.ts#L170)) — so the double-click now works on Masukan without reopening that decision. Both facts are pinned in `page-context.unit.test.ts`, and `main-boot.unit.test.ts` boots both PPN grids and a Retur grid, because ui-filters' own cases stub the fact away and could not see which predicate main.ts asks | 2 | 2 | High | Closed |
| 9 | SPT A2's text columns wear the ISO-date reader | Open (re-characterised **down**) | [export-source.ts:222-228](../src/content/export-source.ts#L222): `Name`, `TIN`, `DocumentNumber`, `TaxBase`, `OtherTaxBase`, `VAT`, `STLG` all read through `isoDate`. Verified this revision: `isoDate` is `formatIsoDateTime`, which reformats only a *string* matching the ISO-datetime prefix and returns everything else unchanged ([tax-date.ts:138-141](../src/content/tax-date.ts#L138)) — so numbers and text are untouched and this is **not a live defect**, only a reader picked for the wrong reason. The residual risk is one value shape: a `DocumentNumber` that arrives as an ISO datetime string is silently rewritten. Impact revised 2 → 1 | 1 | 1 | High | Info |
| 10 | The export click that doubles as a stop kept a queued comparison alive | ✅ **Done** (ADR-0022) | `run-lifecycle.cancelExport()` dropped this Run's export request and invoice list but deliberately kept a pending comparison/check "which outlives the run carrying it", while `abort()` (toolbar stop) and `salvage()` (stopped sweep) dropped everything — so of the three stop paths only this one left a request alive for a later completion. The next completion can be a `begin("targeted")` No. Faktur lookup whose rows are the filtered SUBSET ([run-lifecycle.ts:210](../src/content/run-lifecycle.ts#L210) assigns `completion.data` as the reusable result), which a comparison would read as "Tidak ditemukan" for every row the filter left out. Renamed to `stopKeepingRows()`, and it now drops every request, keeping only the rows | 3 | 1 | High | Closed |

---

## Closed since the previous revision

| Item | Commit | What it actually changed |
|---|---|---|
| A1 | `206054a` | Gate + menu item + refusal copy moved from one grid to four; the filter discovery now needs a name hint **and** a value in the measured format |
| B1 | `bcb0d80` | One `Map` per comparison replaces the per-pasted-row scan |
| B2 | `8d5aed9` | The stop key dispatches the shared stop event, so the isolated Run is settled too |
| B4 | `2793ede` | The toast names a sweep's failed and empty masa, and drops its clean-success wording for a truncated result |
| B5 | `7ba6614` | One retry per masa, abandoned on stop |
| B6 | `8b05a3d` | The Ctrl+Shift+E description matches the scrape it runs |
| B7 | `75f9c87` | A sweep whose request names no tax year is refused before the first request |
| B3 | ADR-0020 | A stopped sweep keeps the rows it collected, reports the masa that finished, and names the file it can still produce as partial |
| B10 | ADR-0022 | The export click that doubles as a stop now retires every request the Run carried, so all three stop paths agree: rows may survive a stop, a request never does |
| B8 | ADR-0021 | The Referensi page fact split in two: the filter (a lookup) reaches PPN Masukan and Pengecekan's hand-back with it, while matching stays on the identity fact |

## What is left, ranked

1. **Measure the three newly gated grids (no code).** `206054a` extended the gate, but PPN Masukan and both Retur grids have never had their filter names read off the portal — they are reached through ADR-0019's guard, which accepts a period/year filter only on a name hint plus a value in the measured `TD.007MM` format and otherwise stops with "belum dikenali". A user hitting that message gets a refusal instead of a wrong export, which is the right failure, but it is still an unverified path on three of the four grids the feature now advertises. `tools/masa-batch-diagnostic.js` on each grid is the whole fix; the result belongs in the ADR and in the portal-verification loop.
2. **A2 — the per-masa recap sheet** (4 / 3). The counts are already computed and already cross the bridge; only the workbook is missing them — and a stopped sweep now makes the case sharper, because the recap is exactly what says which months a file does or does not hold.
3. **A4 — Pengecekan on the Retur grids** (3 / 3). Needs its own key decision before code: a retur row's identity is `NO RETUR` — and the B8 split shows the shape that decision will take (a retur fact for "can this grid be filtered", another for "does a key identify a row"), because the tab's gate and the hand-back are no longer the same question.
4. **A3 — a chosen month range** (3 / 2). Cheap now that the plumbing below the UI exists; the docs must move in the same commit (`microsite-sync`).
5. **B9 — the A2 reader nit** (1 / 1). Only worth doing while in the file.

## Note on B8 (resolved): one predicate was answering two different questions

`isOutputTaxPage()` decided *both* "may this grid take a Referensi filter?" and "is a Referensi a usable identity for matching?". The first is true on PPN Masukan (a lookup works, it just may return more than one row); the second is false there, which is why the comparer's tab stayed hidden and why README.md documents that. ADR-0021 splits them into `hasReferenceFilter()` and `referenceIsIdentity()`, both in `page-context.ts` and both injected into the views that need them — which is what let the hand-back work on Masukan without reopening the comparer decision. The residual lesson for A4 is the shape rather than the fix: when a gate and a feature disagree on the same page, the disagreement is the signal that a fact is missing, not that the feature needs a special case.

## Note on A3: the docs are part of the change

The batch entry's own copy is duplicated in three places that no compiler connects — the menu label, README.md's batch table, and the microsite's feature tab. `microsite-sync.unit.test.ts` guards the page against the code, so a month-range item that changes the entry's shape must land with the page in the same commit, or the suite goes red.

## Re-running these measurements

```
pnpm --config.verify-deps-before-run=false typecheck
pnpm --config.verify-deps-before-run=false test
pnpm --config.verify-deps-before-run=false test:coverage   # per-file numbers + the ratchet
pnpm --config.verify-deps-before-run=false lint
pnpm --config.verify-deps-before-run=false build:chrome
pnpm --config.verify-deps-before-run=false build:firefox
```

Per-file coverage at this snapshot, for the modules this report cites: `scrape-batch.ts` 100 stmts / 91.54 branch, `run-lifecycle.ts` 100/100, `result-columns.ts` 100/100, `export-source.ts` 100/100, `shortcuts.ts` 100/100, `comparer.ts` 96.55/91.91, `checker-logic.ts` 98/98.4, `completion-notice.ts` 98.24/100, `main-actions.ts` 97/94.54, `ui-checker.ts` 97.32/83.33, `exporter.ts` 92.19/85.43 (funcs 76 — `exportXLSX` awaits the real SheetJS chunk, uncovered on purpose per ADR-0013). The known wiring gaps are unchanged: `scraper.ts` 39.39/28.73, `main.ts` 92.15/76.47, `ui-comparer.ts` 89.97/57.3, `ui-panel.ts` 91.46/73.07, `popup.ts` 93.64/61.66, `ui.ts` 90.98/82.
