# The panel's page facts are one row per grid, and every predicate is a read of it

`page-context.ts` answered each question about an e-Faktur PPN grid with a predicate of its
own, and each predicate carried its own list of the grids. Widening the check to the Retur
grids (ADR-0024) meant editing `isCheckerPage`'s four-way `||`; naming a grid in a progress
line meant adding a branch to `currentGridLabel`; the popup's status line spelled the four
names a third time in `describePortalPage`; and the entry point's label was decided by a
predicate of its own (ADR-0025). Five surfaces described the same four grids, so every
rename or addition was five edits, and any two of them could disagree — which is exactly
what ADR-0021 and ADR-0024 are each the record of.

One table replaces the five lists, and nothing else about the questions changes:

```ts
PANEL_GRIDS: Record<PanelGridId, GridFacts>   // one row per grid
```

A row holds `label` (the grid's name in the panel), `statusLabel` (the popup's fuller
spelling), `counterpartyIsBuyer`, `rowIdentity`, `comparerTab`, `checkerTab` and
`referenceFilter`. `panelGridFacts(url)` resolves a URL to its row through
`getPageExportSource`, so a grid is recognised by the same predicates that name it
everywhere else rather than by a second set of URL patterns.

The **projections** stay: `hasReferenceFilter`, `referenceIsIdentity`, `isCheckerPage`,
`checkerRowIdentity`, `counterpartyIsBuyer`, `isPanelPage`, `panelEntryLabel` and
`currentGridLabel` are each still one readable question with its own doc comment, because
those questions genuinely disagree — PPN Masukan takes a Referensi filter that identifies
nothing, and Retur PPN Keluaran carries the buyer without being the output-tax grid. What
collapses is where the **answers** live: on one row, so the entry point, the two tabs, the
checker's columns, the progress line and the copy that describes them are reads of the same
value and cannot drift apart. A test walks every projection against its row for all four
URLs, so a second definition cannot creep back in. (`panelEntryLabel` is the one projection
that produces WORDS rather than a fact about the grid, and the only reason it needs two
names rather than one: the toolbar entry is called for the tab the row offers. It is
exported beside its per-row half, `panelEntryLabelFor`, so the injection site can ask for a
row it already holds, and the microsite's per-grid table is compared against the same
function rather than against a second copy of the two sentences.)

Two gates are deliberately NOT projections:

- **`isEfakturPage()`** — the year-wide export's gate (ADR-0019). It covers the same four
  grids today, and that is the reason to keep it separate: a grid joining the panel's table
  must not silently join the sweep, which needs a measured filter row of its own before it
  can run.
- **`isVatInvoicePage()`** — the two grids whose rows are the taxpayer's own invoices. It
  keeps its name and meaning; `hasReferenceFilter` happens to equal it today, and a test
  pins that equality rather than an implication in either module.

Rationale:

1. **A grid is one thing; a question is one function.** Collapsing every question into one
   boolean-returning accessor would re-create the original bug in a new shape — the panel
   needs several answers per grid, and they disagree by design. A row per grid gives them
   somewhere safe to disagree.
2. **The copy is part of the fact.** The progress line, the popup's status line and the
   toolbar entry point's label all name the grid. Keeping the names on the row makes a
   rename one edit, and the microsite suite now reads the four grid names it requires the
   page to advertise from the row instead of re-listing them.
3. **Derivation where the wording is regular, a field where it is not.** `statusLabel` is
   carried rather than derived from `label`, because on the Retur grids the two genuinely
   differ ("Retur PPN Keluaran", not "e-Faktur Retur PPN Keluaran"); a derivation rule would
   be a second place for the naming to live, which is what this ADR removes.

Consequences:

- `ui.ts` reads one row to decide whether to inject the panel's entry point, what to name it
  and which icon it carries — three renderings of one decision, and the name comes from
  `panelEntryLabelFor` rather than from a ternary in the injection block.
- The microsite describes those per-grid answers in ONE table (`.grid-claims` inside the
  Pengecekan panel) instead of in prose, so `microsite-sync.unit.test.ts` can hold every row
  to the code: the entry point's name from `panelEntryLabel`, the counterparty column from
  `CHECKER_COUNTERPARTY_COLUMNS`, the identity and date headers from `CHECKER_IDENTITIES`,
  and the side and identity they follow from the row itself. Prose could only have been
  searched for strings; a table can be compared cell by cell, in both directions.
- `currentGridLabel()` and `describePortalPage()` read the row's names; a Retur grid is never
  announced as "PPN Masukan".
- `ui-checker.ts` keeps one dependency per question rather than the whole facts bag, so the
  view does not have to know the table's shape; its composition root hands it the
  projections, which read the row.
- The tab-gating tests, `ui-export-dropdown.unit.test.ts` and `microsite-sync.unit.test.ts`
  derive their four-grid casing from the table, so a rename fails once, in the page or in the
  code, rather than passing in one and going stale in the other.
- Adding a grid to the panel is one URL predicate plus one row; adding it to the sweep or the
  Comparer is still a separate, deliberate decision.

Status: accepted.
