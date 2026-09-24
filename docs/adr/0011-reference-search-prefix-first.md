# Reference search asks for a prefix match first and widens only on an empty result

Status: superseded — [ADR-0012](0012-reference-search-stops-on-empty-prefix.md) keeps the prefix-first half and removes the widening. The measurements below are the evidence both decisions rest on.

The Coretax grid server prices the Reference filter by `MatchMode`, not by the length of the value. Measured on the live portal on 24 September 2026 with the same grid parameters (three runs, `tools/README.md`): `contains` took up to 96.9 s for a value that `startswith` answered in 0.149 s, and a *shorter* value could be the slow one (5 characters `contains` = 24.8 s while 6 characters `contains` = 0.21 s in the same run). `equals` was fast but returned zero rows, because a reference a user types is normally a prefix of the stored one (`EE-0300` of `EE-0300/09/26`). The regression users reported as "short values are instant, long values are slow" was therefore a symptom of `contains`, not of value length.

`main.ts` sends `matchMode: "startswith"` on `SET_SERVER_FILTER` for the Reference filter (value still uppercased — the server's Reference filter is case-sensitive). `scraper.ts` stores the mode per field, defaulting to the previous `contains` for strings so other callers are unchanged. When a `startswith` search returns no rows, the scraper flips the Reference filter to `contains` and posts `REFERENCE_FILTER_FALLBACK`; the content script then shows why in the panel and asks the portal's search button to run again. The flip is the one-shot latch — a second empty capture cannot widen again — and a capture is only treated as evidence when its own body asked for `startswith` on `Reference` (a request sent without the filter proves nothing). Widening is skipped while a scrape run owns the page, because that run's own per-invoice lookups may legitimately come back empty.

`REFERENCE_FILTER_FALLBACK` is a run-scoped-less message, like `INJECTED_READY` and `DOWNLOAD_PDF_ITEM` (ADR-0010's list), and `updatePanelStatus` writes the status line without touching progress counters or the buttons' running state.

The decision and its predicate live in `reference-search.ts` as pure functions, tested separately from the boot harnesses. The extension still sends one request per search in the common case; the slow `contains` query is paid for only when the fast mode genuinely cannot answer.

Verified on the live portal on the same day: reference search through the extension is fast again (`tools/README.md`).
