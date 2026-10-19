# The panel's toolbar entry point asks the panel's fact, and is named for the tab its page can serve

`ui.ts` injects ONE toolbar button into the Bandingkan / Pengecekan panel. Three things about it follow from the page facts, not from either tab:

- **Where** — every page the panel has a tab to offer (`isPanelPage()`): the four e-Faktur PPN grids. It used to be PPN Keluaran's alone.
- **What it says** — the name and the icon follow the tab that page can serve (`referenceIsIdentity()`): **Bandingkan data penjualan** with the list icon on PPN Keluaran, **Pengecekan keakuratan nilai** with the check icon on PPN Masukan and both Retur grids.
- **What it does** — dispatches the same `ch:compare-open` event as `Ctrl+Shift+B`, so `ui-panel.ts` picks the tab from the two facts it already read.

Rationale:

1. **PPN Masukan could run the check and could not see it.** ADR-0024 admitted that grid (and both Retur grids) to Pengecekan, and the keyboard reached it there, but the toolbar is the only discoverable entry — so on PPN Masukan the feature existed and was invisible. The gate that withheld the button asked the comparer's own question ("does a Referensi identify a row here?"), which is a question about MATCHING; an entrance into the overlay asks whether the OVERLAY has anything to offer. `isPanelPage` already described itself as the fact the key and the toolbar button both ask; the code only did it for the key.
2. **The name belongs to the tab.** "Bandingkan" promises a Komparator, and on PPN Masukan a Referensi is the seller's while the Retur grids have none — the tab is hidden there, so that label would describe a click that cannot happen the way it reads. The icon is part of the same promise: a list glyph on a check-only page says "a table of matches".
3. **One event, one decision.** The button does not name a tab. It raises `ch:compare-open` like the shortcut, and `openPanel` applies its own rule (`canCheck && !canCompare` lands in Pengecekan). Computing the tab in the toolbar as well would be a second place for the two to drift, and the fallback exists precisely for a requested tab the page cannot serve.
4. **The Retur grids come along for free**, because the fact is the overlay's. Withholding the button there would be a decision about the panel's entry point — not about the check — and would have to be argued as one.

Consequences: the element is `ch-panel-btn`, reached through `getPanelBtnEl()`/`setPanelBtnEl()` — named for the panel it opens, not for the one tab it serves on PPN Keluaran (ADR-0028 made the same correction to the facts behind its label; the id and the getter had kept the Komparator's old name). Both halves are pinned by tests: the label per grid in `ui-export-dropdown.unit.test.ts`, and the tab a PPN Masukan click actually opens in `main-boot.unit.test.ts`. The click still raises `ch:compare-open`, which is the OVERLAY's open command shared with the keyboard shortcut and predates the second tab. A grid admitted to `isCheckerPage()` (or to the Comparer) inherits the entry point without further work; a button that promised the other tab would have to be a deliberate change to this decision.

Status: accepted. `ui.ts` now reads ONE `panelGridFacts()` row for all three of its renderings — whether to inject the button, its label and its icon (ADR-0028) — and the per-grid label expectations in `ui-export-dropdown.unit.test.ts` are derived from that table's `comparerTab`.
