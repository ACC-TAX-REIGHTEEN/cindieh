# Scrape operations own cancellation and result identity

Status: accepted.

Each scrape or bulk PDF operation owns an AbortController and run identity (`scraper-run.ts`). Stop and SPA reset cancel that owner before another operation starts. Old cleanup cannot clear a newer owner. Cancellation reaches extension XHRs and request-capture timers/subscriptions; action loops also check cancellation after awaits before publishing data or starting more work.

The isolated bridge assigns monotonically increasing run IDs to starts and invalidates the active ID on stop/reset. Scoped progress, completion, error and bulk PDF messages echo the operation ID. Content-side acceptance checks the ID and starting page URL after the existing source/origin/token guard. This also rejects messages already queued before navigation/reset. Native single-PDF downloads and readiness messages remain unscoped. IDs are correlation, not authentication; ADR-0007 still applies.

Pagination failure produces error only, never ordinary completion. Targeted lookup and PDF mixed outcomes are explicitly partial. Content invalidates caches and pending exports/comparisons on errors or partial results; it never treats recovered subsets as complete. Cancelled actions emit no completion, and PDFs already downloaded are not removed.

Tests cover old-run completion/cleanup after replacement, abort propagation, queued message rejection, and partial-result acceptance. This preserves one scraper instance per page (ADR-0008), while each action has its own lifetime.

The isolated world's half of the same Run — its outcome, and the pending work it owes when it ends — is `run-lifecycle.ts`; see ADR-0014. The two halves share no code and are correlated only by the `runId` this ADR assigns. This ADR owns identity and cancellation; that one owns state.
