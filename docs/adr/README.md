# Architecture Decision Records

ADRs are numbered in `docs/adr/` (one per decision). Each file states its own decision and `Status`; this table is a summary only — update it when adding or changing an ADR.

| # | Decision | Status |
|---|----------|--------|
| 0001 | [PDF download emission is one module with split item sourcing](0001-pdf-download-emission-module.md) | Accepted |
| 0002 | [Cross-world messaging is a guard-then-dispatch seam per world](0002-message-dispatch-seam.md) | Accepted |
| 0003 | [Comparer session state lives in comparer-logic; ui-comparer is the panel's view](0003-comparer-session.md) | Accepted |
| 0004 | [Export goes through one decision tree; parsing lives in tax-date](0004-export-tree-and-tax-date.md) | Accepted |
| 0005 | [Deferred refactors: two context interfaces](0005-deferred-refactors.md) | Accepted — all completed |
| 0006 | [Comparer matching uses primary Reference only; refLain is reserved for internal tracking](0006-comparer-reference-matching.md) | Accepted |
| 0007 | [Bridge token exposure in postMessage payload and script URL is an accepted risk](0007-bridge-token-exposure-accepted-risks.md) | Accepted |
| 0008 | [Scraper injection is one-time per page; the script element stays as the marker](0008-scraper-injection-one-time-per-page.md) | Accepted |
| 0009 | [TypeScript 7 is the compiler; tooling consumes TypeScript 6 via the compatibility alias](0009-typescript-7-native-with-typescript6-api-alias.md) | Accepted |
| 0010 | [Scrape operations own cancellation and result identity](0010-scrape-run-isolation.md) | Accepted |
| 0011 | [Reference search asks for a prefix match first and widens only on an empty result](0011-reference-search-prefix-first.md) | Superseded by 0012 (prefix-first remains) |
| 0012 | [An empty reference prefix search stops with a not-found notice instead of widening](0012-reference-search-stops-on-empty-prefix.md) | Accepted |
| 0013 | [SheetJS is loaded as a separate chunk, not bundled into the content script](0013-sheetjs-as-a-lazy-chunk.md) | Accepted |
| 0014 | [Run state lives in run-lifecycle; the bridge keeps run identity](0014-run-lifecycle-owns-run-state.md) | Accepted |
