# One stop door: every stop control settles a Run the same way, and states its own row decision

ADR-0022 wrote the rule down — **a request is spent exactly once, by the Run that recorded it**, so a stop retires every request the Run carried — and enforced it in `run-lifecycle`'s `retirePending()`. What it left in place was three separate *ends* of a Run, each with its own body:

| end of a Run | rows | who reaches it |
|---|---|---|
| `abort()` | dropped | the toolbar stop, `Ctrl+Shift+S`, a `SCRAPE_ERROR`, a completion refused as incomplete |
| `stopKeepingRows()` | kept | the export click that doubles as a stop |
| `salvage()` | kept, replaced by the report's own rows | a stopped year-wide sweep's `SCRAPE_COMPLETE` (ADR-0020) |

All three dropped the requests, so ADR-0022 held. But the row decision lived in the *name* of the function that was called, and the sequence around it — post `STOP_SCRAPE`, settle this world's Run, report the cancellation — was written out twice, in `main.ts` and in `main-actions.ts`, with different flags. A fourth stop control had two existing paths to copy from and no compiler-checked question to answer; `abort()`'s own body carried the resume exception (ADR-0023) that `stopKeepingRows()` did not.

## Decision

**One stop function per world, and the row decision is an argument.**

- `run-lifecycle` exposes a single `stop({ keepRows }: StopOptions)` and nothing else that ends a Run early. `abort()` and `stopKeepingRows()` are removed rather than kept as aliases, so there is no second door to reach for. `salvage()` adopts the report's rows and then calls `stop({ keepRows: true })`; `reset()` calls `stop({ keepRows: false })` before clearing the state; the refusal inside `complete()` calls `stop({ keepRows: false })`.
- The retirement is **not** a parameter. A stop ends the Run the requests belonged to, so every stop retires them all; leaving that out of the signature is what makes a new stop path unable to forget it.
- `main-actions` exports `stopRun(deps, { keepRows })`: post `STOP_SCRAPE`, `runLifecycle.stop(...)`, render `SCRAPE_CANCELLED_MESSAGE`. `main.ts` calls it for the toolbar toggle and the stop key; `handleExportAction` calls it for the export click that doubles as a stop. `keepRows` is required, so the one thing the controls genuinely disagree about is stated at each call site.

## Why the flag is required, not defaulted

A default answers the question the wrong way round. `keepRows: false` defaulted would silently drop the rows an export click needs — the click meant to export would have destroyed its own input. `keepRows: true` defaulted would silently keep the rows a toolbar stop is supposed to discard, and the failure is invisible: nothing looks wrong until a later export writes a file the user did not ask for. Neither default is safe, which is the signature of a decision that belongs to the caller.

## Consequences

- **The interface loses a call and gains a question.** ADR-0014 counted eleven calls; it is ten now, with `stop` covering the two that ended a Run early.
- **A stop is one behaviour with one documented exception.** The resume rule (ADR-0023) is read inside `stop` — a `sweep-resume` keeps the union it was adding to even under `keepRows: false`, because that union belongs to an earlier Run that never failed — so both row decisions inherit it instead of only one of them.
- **The call sites read as decisions.** `stopRun(actionDeps, { keepRows: false })` at a stop button and `stopRun(deps, { keepRows: true })` behind an export click say what happens to the rows without opening `run-lifecycle`.
- **The row decision is testable where it is made.** `main-boot.unit.test.ts` fires the real toolbar toggle and the real export event and asserts the rows after each, which is the layer a fourth control would be added to; `run-lifecycle.unit.test.ts` pins both flags against the same retirement.
- **`reset()` is a stop that keeps nothing**, and says so by calling the same function. Its `Object.assign(state, freshState())` stays as the belt to that braces: it is what makes a reset forget a resumed sweep's union, which `stop` itself deliberately keeps.
- The end-of-chain documentation had to move with it: ADR-0014's interface table, ADR-0022's stop-path table, ADR-0023's resume note and ADR-0026's announcement list all named the two removed calls.

Status: accepted.
