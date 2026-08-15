# Deferred refactors: two context interfaces

All three refactors surfaced during the architecture review have been completed:

1. **Completed:** Merging `ScraperContext` (scraper-actions) and `InterceptContext` (scraper-intercept) into a single unified context interface. `ScraperContext` now owns all 18 members (7 orchestration + 11 request-capture). `InterceptContext` is removed; `scraper-intercept.ts` imports and re-uses `ScraperContext` directly. `scraper.ts` builds one `ctx` object that satisfies the full interface, replacing the separate `interceptCtx`/`buildInterceptContext` construction.
2. **Completed:** Replacing `ContentState`'s getter/setter facade with the object API. Runtime consumers now use the exported `contentState` object directly, and singleton reset goes through `resetContentState(..., { preserveExportMode: true })`.
3. **Completed:** Removing the `ui.ts` re-export facade. Consumers now import directly from `page-context`, `ui-badge`, `ui-filters`, and `ui-comparer`; `ui.ts` only owns export-button injection/removal.

Status: accepted; fully completed.
