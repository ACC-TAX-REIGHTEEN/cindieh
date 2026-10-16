# A retirement announces the requests it takes, so no tab keeps promising them

`run-lifecycle.ts` gains one announcement, raised by every path that retires what a Run owed:

```ts
runLifecycle.onRetired((kinds) => { … });   // kinds: "compare" | "check" | "export"
```

- It fires from `stop()` — which every stop control, a failed scrape, the refusal inside `complete()` and `reset()` all go through since ADR-0027 — carrying the kinds in the order the panel runs them, and stays SILENT when there was nothing to take.
- `cancelPending(kind)` does not raise it: a tab dropping the request it queued itself is not a retirement, and nothing was taken from a tab that is still waiting on something else.
- `main.ts` registers the one listener and routes each kind to the tab that queued it — `dropPendingCompare()` in `ui-comparer.ts`, `dropPendingCheck()` in `ui-checker.ts` — which clear the tab's status line only while it IS the "waiting for the grid" notice that tab wrote.

Rationale:

1. **A tab cannot see this for itself.** It writes the line when it queues its comparison or check; the completion that would have replaced that line is exactly what a stop retires. The promise then outlived the request — the gap ADR-0022 registered as belonging to a later change.
2. **The announcement belongs to the life-cycle, not to the stop buttons.** Every stop path already funnelled through the life-cycle, and so do a failed scrape, a refused completion and a reset. Hanging the announcement there is what makes a NEW stop path unable to forget to say so; hanging it at the three call sites would have been three chances to. (ADR-0027 later made that literal: the three paths became one `stop()` call, and the retirement is not a parameter of it.)
3. **The tab clears; the badge explains.** `SCRAPE_CANCELLED_MESSAGE` on the badge already names the stop, which is why the tabs do not restate it — clearing the promise is the whole job (ADR-0022's own reasoning for not adding a tab-level explanation).
4. **The text is the guard.** Each tab remembers the exact notice it wrote and clears only if the line still says that. A summary, an error, or a later comparison's own output is the tab's real result and must survive a stop that arrives afterwards; comparing against the written text means no writer has to remember to unset a flag.
5. **Nothing else moves.** The pasted rows stay (re-running is one click), the results stay, and the rows a stop kept stay (ADR-0022, ADR-0020).

Consequences: `run-lifecycle.ts` keeps no DOM or browser dependency — it calls a callback. One listener is enough because there is one wiring layer, and a second registration replaces the first rather than stacking. The checker's clear is a view method (`CheckerView.dropPending`) with a module-level wrapper for the production singleton, mirroring `runPendingCheck()`. Tests: the announcement itself in `run-lifecycle.unit.test.ts`, each tab's clear (and its refusal to clear real output) in the two tab suites, and the routing on a real stop in `main-boot.unit.test.ts`.

Status: accepted.
