# Deferred refactors: two context interfaces, ContentState facade, ui.ts re-export facade

Three known refactors were surfaced during the architecture review and deliberately deferred because each touches a wide blast radius for modest leverage. They are not rejected — revisit when the area around them changes:

1. **Merging `ScraperContext` (scraper-actions) and `InterceptContext` (scraper-intercept)** — two context interfaces describing overlapping slices of the same closure state. Merging touches every scrape/download call site.
2. **Replacing `ContentState`'s getter/setter facade** (11 pairs kept "for backward compatibility") with the object API only. The facade is a shallow seam that also carries the `resetState` export-mode-preservation smell.
3. **Removing the `ui.ts` re-export facade** (~20 pass-through re-exports) so `main.ts` imports resolve directly. Purely navigational.

A future architecture review should treat these as known rather than newly discovered; the gain is testability/navigability but the cost is a large mechanical diff.

Status: accepted.
