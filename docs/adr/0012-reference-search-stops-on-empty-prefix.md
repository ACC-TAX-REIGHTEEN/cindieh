# An empty reference prefix search stops with a not-found notice instead of widening to `contains`

Status: Accepted
Date: 2026-09-24
Supersedes: the widening half of [ADR-0011](0011-reference-search-prefix-first.md) (prefix-first remains, widening is removed)

## Context

ADR-0011 made the Reference filter send `startswith` first — measured 0.09–0.30 s — because the portal's `contains` mode can take minutes (up to 96.9 s) on the same data. The same ADR kept a one-shot widening: when the prefix search returned zero rows, the scraper flipped the filter to `contains`, posted `REFERENCE_FILTER_FALLBACK`, and the content script showed a status line ("… Mencari ulang dengan pencocokan lebih luas — proses ini bisa memakan waktu lama.") and clicked the portal's search button again.

Widening found references that merely *contain* the typed value, but the wait it bought is exactly the wait ADR-0011 was measured to avoid — minutes on the same data — and users experienced the retry as a hang.

## Decision

When the prefix match returns zero rows, the search ends there. The scraper posts `REFERENCE_SEARCH_NOT_FOUND` once per search, the panel reports `Referensi "…" tidak ditemukan.`, and nothing re-issues the query: no mode flip, no second click, no `contains` request ever leaves the extension. The portal grid keeps the empty result it already rendered.

The notice is latched per field and re-armed by every new `SET_SERVER_FILTER`, so one search reports at most once — the same one-shot shape the widening flip used to provide. As before (ADR-0011), a notice is not emitted while a scrape run owns the page, and the Reference value stays uppercased because the server's filter is case-sensitive.

## Consequences

- Reference searches are always fast: exactly one grid request, answered in a fraction of a second.
- A reference that exists but is not a prefix of the typed value is now reported as not found instead of being located minutes later. Typing a shorter prefix recovers it — which is also what the prefix mode means.
- `shouldWidenReferenceSearch`, `bodyRequestsFilter`, `REFERENCE_WIDE_MATCH_MODE`, and the `REFERENCE_FILTER_FALLBACK` message no longer exist; RATE_LIMITING.md's request budget drops from "+1 request when empty" to "1 request per search".
