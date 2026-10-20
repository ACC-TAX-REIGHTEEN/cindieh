# Each panel tab is its own view module, and the shell knows no tab

The comparison panel is one overlay with two tabs. `ui-comparer.ts` grew to ~700 lines and was
doing four jobs at once:

1. **the overlay's behaviour** — which tab is showing, opening, closing, the background behind
   the dialog, handing a reference back to the portal's grid;
2. **the Bandingkan tab's view** — its paste area, its controls, its result grid and its export;
3. **the composition** — the overlay's markup, the header's two buttons, the body;
4. **the cross-tab wiring** — one Escape handler, one click-outside handler, two filter menus.

`ui-checker.ts` had already been split out for the same reason (its own `createCheckerView(deps)`
factory plus the singleton the panel mounts). The tab that was NOT split out is the one the shell
was named after, so the module that hosts a tab also happened to be that tab, and the two things a
panel needs to know about a tab — where its elements are and whether the page can serve it — were
answered by the shell itself:

| Question the shell answered | Where the answer lived |
|---|---|
| which element is a tab's view | `document.getElementById("ch-comparer-view-compare")` inside the shell |
| which element is a tab's button | `document.getElementById("ch-tab-compare")` |
| may this page show the tab | `referenceIsIdentity()` / `isCheckerPage()`, imported by the shell |

Every one of those is the TAB's own fact. The shell's only question is which tab is showing.

Decision:

1. **Each tab is one view module with a factory and a singleton.** `ui-comparer-view.ts` exports
   `createComparerView(deps)` and the `comparerView` singleton; `ui-checker.ts` keeps
   `createCheckerView(deps)` and `checkerView`. What the tab cannot own is injected: the Run it
   reads and owes, the scrape it asks for, the reference hand-back, the grid's name — plus, for the
   Komparator, `available()`. The factory is what makes a tab mountable without the overlay, which
   is what its two suites drive it through.

2. **The shell is told, not asked.** `ui-panel.ts` keeps a registry of
   `PanelTabBinding { button, view, available, onOpen? }`, bound by the composition root when the
   panel is built and cleared when it is taken down. `switchTab` toggles the bound elements and
   reads no id; `openPanel` hides the button of every tab the page cannot serve and resolves a
   requested tab to one it can.

3. **The gate travels with the tab.** `available` is the tab's own question, because the tab is what
   the answer is about: the Komparator matches by Referensi, which identifies a row only on PPN
   Keluaran; Pengecekan recomputes amounts, which the four e-Faktur PPN grids all carry (ADR-0021,
   ADR-0024). The shell answers neither, so it cannot answer one of them twice.

4. **What the panel opening on a tab MEANS is the tab's own work.** `onOpen` is how the Komparator
   puts the caret in its paste area and offers the clipboard. The shell does not know that this tab
   has a paste area, and the previous arrangement had the shell reach into it by id.

5. **The composition root is the only place the two tabs are joined.** `ui-comparer.ts` builds the
   overlay, mounts both roots and binds both tabs; the Escape handler that dismisses an open filter
   menu before closing the panel, the click-outside handler and the two menus are joined there and
   nowhere else. Removing the panel closes it first (an open panel marks the background inert),
   drops the document-level handler and clears the bindings, because a binding whose elements are
   gone would leave the shell showing a tab that is not on the page.

Rationale:

- **A seam nobody can mount is not a seam.** The checker tab could be tested on its own; the
  comparer tab could only be tested through `injectComparerModal()`, which meant every case about
  "does this tab start a scrape it cannot report on" also asserted the overlay's markup. The new
  suite mounts `createComparerView` over a private Run and a stub DOM, and never builds a panel.
- **A shell that reads ids has to be edited for every tab.** `PanelTab` is still a closed union of
  two names, and a third tab is one member plus one `bindPanelTab` call — but the ids of a tab's
  elements are now the tab's business, so a rename cannot leave the shell looking for an element
  that no longer exists.
- **The two gates are data, not code paths.** They travelled to the tabs with the rest of each
  tab's behaviour, which is where ADR-0028's per-grid row is read: each gate is a one-line read of
  the row's own fact.

Consequences: `ui-comparer.ts` is the composition root (~230 lines, down from ~700);
`ui-panel.ts` is the overlay's behaviour (~300 lines) and holds the tab registry instead of tab
ids; `ui-comparer-view.ts` (~710 lines) is the Bandingkan tab, and its arithmetic stayed in
`comparer-logic.ts` rather than moving with the view. `runPendingCompare()` and
`dropPendingCompare()` remain the module-level calls `main.ts` makes, so the world entry did not
change. The dependency still runs one way — `ui-comparer` → `ui-comparer-view` → `ui-panel`, and
`ui-comparer` → `ui-checker` → `ui-panel` — so neither tab can reach the other. `ui.ts` and
`main.ts` keep calling the composition root, and no message, preference or page fact changed.

Status: accepted.
