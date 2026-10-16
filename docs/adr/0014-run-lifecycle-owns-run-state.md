# Run state lives in run-lifecycle; the bridge keeps run identity

`run-lifecycle.ts` owns everything a Run knows in the isolated world: whether it is in flight, what it still owes, and what it last produced. It exposes eleven calls and nothing outside it may read or write that state:

| | |
|---|---|
| `isRunning()` / `begin(start)` | the run in flight; `begin("scrape")` retires the previous rows, `begin("targeted")` and `begin("bulk-pdf")` keep them because both read the captured grid |
| `request(intent)` / `cancelPending(kind)` / `pendingExport()` | what it owes; the panel cancels one intent without disturbing an export of the same grid |
| `noteRequestedInvoices(numbers)` | the No. Faktur numbers to diff at completion, recorded only once a run is really starting |
| `result()` | the last accepted rows, fields and filename hint |
| `complete(result)` | settle the run and report what happens next |
| `abort()` / `stopKeepingRows()` / `reset()` | end it three ways: unusable result, the export click that doubles as a stop (rows kept), and silent forget — what a stop does to the requests the Run carried is ADR-0022 |

`ContentState` is removed. It was ten mutable fields and no behaviour, so the one rule that mattered — a pending request is spent exactly once and abandoned with its Run — was remembered in six places across four modules and enforced nowhere. Its own comments are the record: *"recorded only once the run is really starting, so a declined confirmation leaves nothing behind"*, *"a later run must not be diffed against a stale list"*, *"the aborted run emits no completion, so its request is dropped here"*.

`complete(result)` returns a single value describing both what happened and what happens next:

```
| { kind: "accepted"; followUp: FollowUp[]; shortfall: Shortfall | null }
| { kind: "rejected"; message: string }

Shortfall = { count: number; notice: string | null }
```

`followUp` carries the pending comparison, check or export in the order they fire; the caller executes them. `shortfall` is null when every requested number came back. When it is not, `count` always survives — it is what the completion notification reports — but `notice` is null for a `kind: "pdf"` run, whose pre-download dialog already named those numbers and whose per-file progress has taken the panel. That suppression rule used to sit in `main.ts`'s SCRAPE_COMPLETE handler and now belongs behind the seam.

## Why the interface is eleven calls, not eight

The design predicted eight. Three were added because the existing behaviour is not uniform, and flattening it would have been a silent regression:

- `stopKeepingRows()` — the export click that doubles as a stop keeps the last good rows, so a following export can still use them. That is deliberately unlike `abort()`, and merging them would have dropped reusable data. **Amended by ADR-0022**: this call was named `cancelExport()`, and the second half of its original justification — that it also keeps a pending comparison, "which outlives the run carrying it" — was wrong. A request dies with the Run that recorded it, so this path now drops every request it carried, like the other two stop paths; only the rows survive.
- `cancelPending(kind)` — the panel's "Hapus" must drop a pending comparison without disturbing a pending export of the same grid.
- `pendingExport()` — the readiness resend in `main.ts` must repeat the original request's intent when the first message reached the page before the Scraper did.

`abort()` takes no message: every caller already holds the one it is about to show, and storing it only invites reading it back out of state.

## Why the bridge keeps run identity

The `runId` gate stays in `bridge.ts` (`isCurrentRunMessage`) and `scrape-result.ts` (`currentRunHandlers`). ADR-0010 placed that gate deliberately **after** the token guard and **before** acceptance, and it was never `ContentState`'s to absorb. Run identity is a property of the bridge; run state is a property of the isolated world. Moving the gate into `complete(runId, result)` would also make it a gate the caller can forget to route through — and a message from a dead Run must be rejected *before* it can mutate anything, which an in-method check cannot guarantee.

## Why `exportMode` is not run state

`exportMode` is persisted under `EXPORT_MODE_STORAGE_KEY` and written by the storage listener, not by any run. It was a preference wearing a state field's clothes, and it leaves the module entirely. That is why `resetContentState(state, { preserveExportMode: true })` had to go rather than being ported: once `exportMode` is gone there is nothing left to preserve.

## Why the outcome belongs here but the wording does not

`acceptScrapeResult` and `invalidateScrapeResult` set and cleared `isRunning` and the three result fields **in the same statements**. They are one transition, and splitting them across two owners would duplicate the clear logic this refactor exists to remove.

What stays in `scrape-result.ts` is the missing-invoice **diff** (`findMissingInvoices`), which two callers share, and the **wording**, which is per-caller: `missingInvoicesMessage` belongs to an export Run, `skippedInvoicesMessage` to the pre-download dialog, which happens before any Run exists. Do not move dialog wording inside a Run module — a shared diff with per-caller phrasing is the shape, not a compromise.

## Consequences

- **The interface is longer than the ten fields it replaces, and that is the trade.** Eleven calls, nothing writable from outside. Depth here means a longer interface over a shorter implementation, not a smaller surface.
- `main-actions.ts` keeps `ActionDeps` and its `makeDeps()` harness unchanged; ADR-0004's single export decision tree stays put. `run-lifecycle.ts` has no browser or DOM dependency, so the whole module is testable without a page.
- `lastState` disappears. Its only reader was SCRAPE_COMPLETE's rejected branch, which read back from state a message `acceptScrapeResult` had just computed — making the `lastState?.type === "SCRAPE_ERROR"` guard there always true.
- The `scrape-result.ts → main-actions.ts` type-only import cycle is removed; the module imports the pure report helpers instead.
- `scraper-run.ts` is untouched, and nothing in the PDF download path moves, so this change needs no portal verification.
- A Run spans both worlds — see `CONTEXT.md`. The MAIN half owns cancellation and identity (ADR-0010); the isolated half owns outcome and debts (this ADR).

Status: accepted. Recorded 2026-10-02 before implementation; the module and its migration land together.