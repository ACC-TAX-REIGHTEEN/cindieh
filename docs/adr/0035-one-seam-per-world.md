# One seam per world, and an import graph with no cycles

The MAIN world's context interface — the object every run, capture and sweep is driven through —
lived in `scraper-actions.ts`, next to the flows that use it. That was fine while the context was
only used there. It stopped being fine the moment modules were extracted BELOW it, because a module
underneath can only reach the interface by importing its parent:

| Module | Needed from the parent | Edge |
|---|---|---|
| `period-sweep.ts` | the `ScraperContext` type | `scraper-actions` → `period-sweep` → `scraper-actions` |
| `scraper-xhr.ts` | `abortError()` | `scraper-actions` → `scraper-xhr` → `scraper-actions` |
| `scraper-intercept.ts` | the capture half of the context | `scraper-actions` → `scraper-intercept` → `scraper-actions` |

The first is a type-only cycle, the second a real one: `abortError` is a VALUE, so
`scraper-actions.ts` and `scraper-xhr.ts` initialise each other. Whichever of the two esbuild
happens to place first reads a binding the other has not initialised yet, and the failure is an
`undefined` at the moment a request is cancelled — not at import time, so no test that does not
cancel catches it.

The isolated world had one of its own: `result-columns.ts` (the schema) imported
`formatResultNumber` / `formatResultDifference` from `comparer-export.ts` (the file's builders),
and `comparer-export.ts` imported the schema back to write its columns. The two modules declared
each other's cells.

Rationale:

1. **A cycle is invisible until the one path that trips it.** The type checker accepts a cycle
   happily, and every suite that imports the modules in one direction passes. A cycle is only a
   bug in the order the bundler happens to emit, which is why the two above survived a long time.
2. **A cycle makes the ownership a fiction.** The claim "the sweep owns the retry" and the claim
   "the capture owns the abort" both assume the module below can be read on its own. A module
   that imports its parent to get a type is not independent, and the next change inside the
   parent becomes a change inside it too.
3. **The seam belongs BELOW its users.** `src/content/scraper-context.ts` now holds the MAIN
   world's ONE context — `CaptureContext` (what the request capture needs) and
   `OrchestrationContext` (what a run needs), with `ScraperContext` their union — plus
   `abortError()`. It imports nothing of theirs, so every edge points one way: the users import
   the seam, never the reverse. ADR-0005's merge (ONE context per world) is preserved: the halves
   are NAMED, not split into two objects, and `scraper.ts` still builds a single one.
4. **The same rule fixes the isolated world.** The two number formatters moved from
   `comparer-export.ts` to `result-columns.ts`, because the schema that DECLARES the two kinds
   they render (`SheetCellFormat`: amount, difference) is the thing that owns them, and the file's
   builders read the schema (ADR-0030). The schema no longer reaches back into the file's
   builders for its own cells.
5. **A test double pays only for the half it drives.** `CaptureContext` and
   `OrchestrationContext` are separate types, so a capture test stubs the capture and a sweep test
   stubs the run — neither declares the other's members to satisfy a type.

The guard is `src/tests/content-imports.unit.test.ts`. It reads `src/content/*.ts` from disk and
asserts the graph's shape, because nothing else in the suite can see it:

1. no cycle among the RUNTIME imports (a value cycle breaks module initialisation);
2. the MAIN world's closure — everything `scraper.ts` reaches — is a DAG even counting
   type-only edges;
3. nothing in the MAIN world touches a browser API: the MAIN world is a page script, and the two
   worlds talk through `postMessage`, not through imports;
4. the three modules under `scraper-actions.ts` take the seam from BELOW, never from their
   parent; and
5. no isolated-world module (the panel, the run, the storage bridge) is reachable from the MAIN
   world.

The check reads the source rather than a module-graph tool so it lives in the same suite as
everything else and needs no new dependency. It is proven to fail: planting one value import
back into `scraper-context.ts` makes it report
`scraper-actions.ts -> scraper-xhr.ts -> scraper-context.ts -> scraper-actions.ts`.

Consequences: `scraper-actions.ts` keeps the flows and loses the interface; `scraper-intercept.ts`
and `scraper-xhr.ts` import the seam instead of the parent; the MAIN world's context is still ONE
object, built in `scraper.ts`, but it is now declared where nothing has to reach up for it. Two
dead members of the isolated world's `ActionDeps` went with the change (`isBatchPage`, which was
a second name for the answer `isEfakturPage` already gives, and `triggerSearch`), because a
dependency bag that carries one answer twice is a place where two features can disagree about it.
Behaviour is unchanged: every existing case passes without being edited.

Status: accepted.
