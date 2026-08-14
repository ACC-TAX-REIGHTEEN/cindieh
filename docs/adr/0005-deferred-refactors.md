# Deferred refactors: two context interfaces

Three known refactors were surfaced during the architecture review. Two have since been completed; the remaining one is still deferred because it touches a wide blast radius for modest leverage:

1. **Deferred:** Merging `ScraperContext` (scraper-actions) and `InterceptContext` (scraper-intercept) - two context interfaces describing overlapping slices of the same closure state. Merging touches every scrape/download call site.
2. **Completed:** Replacing `ContentState`'s getter/setter facade with the object API. Runtime consumers now use the exported `contentState` object directly, and singleton reset goes through `resetContentState(..., { preserveExportMode: true })`.
3. **Completed:** Removing the `ui.ts` re-export facade. Consumers now import directly from `page-context`, `ui-badge`, `ui-filters`, and `ui-comparer`; `ui.ts` only owns export-button injection/removal.

A future architecture review should treat the remaining context-interface merge as known rather than newly discovered; the gain is testability/navigability but the cost is a large mechanical diff.

Status: accepted; partially completed.
