# A grid's Referensi facts are two: it can be filtered by one, and a Referensi identifies a row

`page-context.ts` answers two questions that `isOutputTaxPage()` used to answer at once:

- **`hasReferenceFilter()`** — does this grid get Cindieh's Referensi filter (the toolbar box and the column-filter input in the grid header)? True on both e-Faktur PPN grids, Keluaran and Masukan.
- **`referenceIsIdentity()`** — does a Referensi identify ONE row here, so it can key a match? True on PPN Keluaran only: a PPN Masukan Referensi is whatever the SELLER filed, so it repeats across purchases from different sellers and is often empty (ADR-0006).

Rationale:

1. The two questions disagree on PPN Masukan, and one predicate answering both withheld a working feature there. The filter is a **lookup** — type a prefix, get the rows that start with it — and "three purchases share this reference" is a real answer to a lookup. Matching, by contrast, needs the reference to pick out the one record the comparison is about, which Masukan cannot give.
2. Nothing about the Comparer decision changes. Its tab stays gated on `referenceIsIdentity()`, and README.md keeps documenting why. What changes is Pengecekan's hand-back (double-click a result row to search the grid), which is now gated on `hasReferenceFilter()` — the grid genuinely has a filter to search into — so it works on PPN Masukan instead of silently doing nothing. The same fact gates both injection paths in `ui-filters.ts` and the two call sites in `main.ts`, so the filter and the hand-back cannot drift apart.
3. Keeping the names apart keeps the future honest. Widening the filter to another grid is a decision about a lookup (Retur is keyed by `NO RETUR`, so it has no Referensi column to filter); admitting a grid to the Comparer is a decision about matching. A third question the panel already answers — which of the two PPN grids this is, for its labels (`currentGridLabel`, `counterparty`) — stays on the grid-name predicates, where it belongs.

Status: accepted. The answers now live on one row per grid (`page-context.PANEL_GRIDS`, ADR-0028); which question each predicate asks is unchanged — only the fifth hand-written list of grids is gone.
