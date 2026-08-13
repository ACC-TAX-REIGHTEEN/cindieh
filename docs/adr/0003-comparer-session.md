# Comparer session state lives in comparer-logic, ui-comparer is a thin view

`comparer-logic.ts` owns the `ComparerSession` object (created via `createComparerSession()`) and the comparison orchestration — `runComparison`, `rerunComparison`, and `prepareComparison` (the "Periksa" decision tree). `ui-comparer.ts` only builds DOM, wires events, and renders session state; it holds no module-level session `let`s.

The session factory existed but was dead code (its consumer ignored it and kept 8 module-level `let`s). Do not move comparison flow logic back into the view; the decision tree (daily-date validation ordering, re-run-when-results-exist, scrape-first) is pinned by tests in comparer-logic.

Status: accepted.
