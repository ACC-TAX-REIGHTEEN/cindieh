# A Run owns the requests it records; a stop retires all of them, and the rows survive

Three paths end a Run early, and they must not disagree about what the Run was carrying:

| stop path | rows | pending export | pending compare / check | requested No. Faktur |
|---|---|---|---|---|
| toolbar stop / `Ctrl+Shift+S` (`stopRun` → `runLifecycle.stop({ keepRows: false })`) | dropped | dropped | dropped | dropped |
| a stopped year-wide sweep (`complete(cancelled)` → `salvage()`, ADR-0020) | **kept** | dropped | dropped | dropped |
| the export click that doubles as a stop (`handleExportAction` → `stopRun(deps, { keepRows: true })`) | **kept** | dropped | dropped | dropped |

The middle column is the ONLY thing that differs, and since ADR-0027 it is an argument every stop control passes rather than the name of the function it happened to call.

The rule: **a request is spent exactly once, by the Run that recorded it.** A stop ends that Run, so every request it carried dies with it — the comparison and the check included, not only the export the click happened to name. Rows are not requests: they describe the grid, so the two paths that keep them do so because a later export can still use them, never because a request was waiting on them.

What changed: `run-lifecycle.cancelExport()` used to keep a pending comparison or check "which outlives the run that was carrying it", on the theory that the user's intent should not be lost with the data fetch. That theory failed on evidence:

1. **The next completion may be narrower than the comparison needs.** `begin("targeted")` keeps the previous rows and its completion carries only the rows that matched the No. Faktur filter; `complete()` then makes those the reusable result. A comparison spent on them answers "Tidak ditemukan" for every pasted row the filter left out, and a check reports a silently smaller grid — the same class of false-negative the comparer's statuses and ADR-0020's whole-year rule exist to prevent.
2. **It was a stop that did something later anyway.** ADR-0020 accepted "nothing may run automatically on a request that was interrupted"; a kept request runs automatically on a request the user interrupted.
3. **The project already says so.** `run-lifecycle.ts` states the invariant in its own header ("a pending request is spent exactly once and abandoned with its Run"), and `CONTEXT.md` under **Pending export** already promised that "a stop, a navigation, or a result rejected as incomplete leaves nothing behind for a later Run to fulfil against". The export-click path was the one place the code contradicted the two documents; the code moved.

Rename: `cancelExport()` → `stopKeepingRows()`. It is `abort()` minus the row drop, and nothing else, so it is named for its one distinguishing behaviour rather than for the button that reaches it.

**Amended by ADR-0027.** Both names are gone: `abort()` and `stopKeepingRows()` were one behaviour with a row decision carried in the function name, so they collapsed into `stop({ keepRows })`, and the sequence around them (post `STOP_SCRAPE`, settle, report) became `main-actions.stopRun`. The rule above is unchanged — this ADR is what it is for — and it is now enforced by there being exactly one door out of a Run.

## Consequences

- **The rename is deliberate churn.** `cancelExport()` now lies: it drops a comparison and a check as well. Its one caller (`main-actions.handleExportAction`) and the two test suites are the whole blast radius.
- **What a user loses and how they are told.** Someone who pastes rows, clicks Periksa, then stops the run with an export click gets no comparison and no queued revival of it. They are told the process stopped (`SCRAPE_CANCELLED_MESSAGE`, on the in-page badge, from both the toolbar stop and the export click), and re-running is one click because the pasted rows stay in the textarea. A tab-level line naming the dropped request is deliberately NOT added here: it would put a new dep on `ActionDeps` and a new export on each tab to restate what the stop line already says.
- **The two tabs' "Mohon tunggu, sedang melakukan scraping…" line was not cleared by a stop.** This was pre-existing and identical on all three paths: the tabs write that line when they queue their request and only `runPending*` rewrites it. It is fixed — and this ADR is what said where: the retirement now announces itself, and the tab that queued the request takes the line back (ADR-0026), which today means replacing it with one short reason rather than leaving it blank.
- Rows keep surviving a stop, so the "a stopped sweep's file is `…-sebagian`" rule (ADR-0020) is untouched: `partialSweep` still travels with the rows.
- `reset()` (navigation, "Bersihkan cache") is unchanged, and still the only path that forgets silently — a request a tab was waiting on is still retired by it, so it announces that too (ADR-0026).

Status: accepted.
