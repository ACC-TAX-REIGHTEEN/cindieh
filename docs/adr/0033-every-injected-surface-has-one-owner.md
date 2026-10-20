# Every injected surface has one owner

Cindieh puts six things into the portal's DOM: the floating badge, the export toolbar, the panel
overlay, the toolbar's Referensi box, the grid's Referensi column input and the No. Faktur filter.
They were painted from four different modules and taken away from a fifth place — a hand-written id
list in `main.ts`:

```ts
const TEARDOWN_ELEMENT_IDS = [
  "ch-comparer-overlay",
  "ch-comparer-modal",
  "ch-multi-invoice-toggle",
  "ch-multi-invoice-filter",
  "ch-toolbar-filter-reference",
] as const;
```

That list was a second description of the DOM, owned by nobody, and it had already drifted twice:

1. **The toolbar filter's container leaked.** The list named `ch-toolbar-filter-reference` — the
   INPUT — but the input lives inside `ch-toolbar-filter-container`, which the list did not name.
   A master-switch teardown therefore removed the input and left the container behind, and the
   next injection put a second container next to the first. The teardown's own comment admitted the
   shape was special ("the grid filter is handled separately"), and the special case was handled
   by a second `closest(".ch-grid-filter-container")` line that only covered the GRID filter, not
   the TOOLBAR one.
2. **The panel could leave the page inert.** An open panel marks everything behind it `inert`, and
   the teardown removed the overlay without closing it — so the background stayed inert. The user
   was left with a portal that looked normal and answered to nothing. `ui-panel.ts` already had the
   fix (`closePanel()` hands the background back); the teardown just did not call it.

Both are the same defect: the removal of a thing lives somewhere other than the code that built
the thing, so it drifts.

`src/content/page-surfaces.ts` is that code moved. A surface is a small record:

```ts
export interface PageSurface {
  readonly name: string;
  paint(): void;          // put it on the page (safe to call again)
  remove(): void;         // take it off (safe to call when it was never there)
  readonly repaintedOnRender: boolean;  // can the portal's re-render take it away?
}
```

The registry holds the six of them and the page's lifecycle has exactly three doors:
`paintPageSurfaces()` (the page state changed), `repaintPageSurfaces()` (the portal re-rendered
and may have taken a surface with it) and `removePageSurfaces()` (the page is being left). Each
surface keeps its own guard — the badge and the toolbar ask whether this page is supported, the
filters ask whether this grid takes a Referensi filter — so the caller no longer needs to know
which grids have which column.

Rationale:

1. **The owner knows what it built.** The toolbar filter removes the container it created; the
   grid filter gives the portal its own filter back; the panel closes before it goes. A new
   surface cannot leak, because there is no second list to forget to update.
2. **`repaintedOnRender` is a fact about the DOM, not a guess.** The toolbar and the three filters
   live inside the portal's own markup, so a re-render can take them away and they have to be put
   back. The panel and the badge live in `<body>`, which Angular does not re-render — and
   repainting the panel would throw away the text the Wajib Pajak pasted into it. The flag says
   which is which, so a re-render cannot rebuild the panel by accident.
3. **The dependency runs one way.** `page-surfaces.ts` imports the owner modules; the owners
   import only the `PageSurface` TYPE, so there is no cycle. The toolbar no longer reaches across
   into `ui-comparer.ts` to bring the panel up — the panel is a surface of its own.
4. **The panel's removal is a CLOSE, not a delete.** `removeComparerPanel()` calls `closePanel()`
   first, which is what hands the background back from `inert`. Removing the element is not the
   same as undoing what opening it did.

Consequences: `main.ts` loses `TEARDOWN_ELEMENT_IDS`, the `GRID_FILTER_INJECT_DELAY_MS` timer and
the four injection calls it made; the grid filter's one retry now lives in its own owner (the
table is often not rendered when the page state is applied), and `removePageSurfaces()` cancels
the pending injection loops BEFORE it removes anything — an injector still waiting for the portal
to render its anchor would otherwise put a surface back into the page being left.
`page-surfaces.unit.test.ts` holds the registry's contract from the outside: nothing of Cindieh's
survives a teardown, painting again does not stack a second copy, the grid's cell gets the
portal's own filter back, the page gets its `inert` state back, and a re-render leaves the
pasted text alone.

Status: accepted.
