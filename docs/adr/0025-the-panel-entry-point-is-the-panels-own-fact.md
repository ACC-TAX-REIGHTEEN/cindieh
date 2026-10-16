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

Consequences: the element keeps its `ch-compare-btn` id and its `getCompareBtnEl()`/`setCompareBtnEl()` pair, so the identifiers carry the Komparator's old name for one element whose label now varies by page. Both halves are pinned by tests: the label per grid in `ui-export-dropdown.unit.test.ts`, and the tab a PPN Masukan click actually opens in `main-boot.unit.test.ts`. A grid admitted to `isCheckerPage()` (or to the Comparer) inherits the entry point without further work; a button that promised the other tab would have to be a deliberate change to this decision.

Status: accepted.
