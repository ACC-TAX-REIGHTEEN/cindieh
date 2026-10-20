// ============================================================
// PAGE-SURFACES.TS — the page's injected surfaces, one owner each
// ============================================================
// Everything Cindieh puts into the portal's DOM is a SURFACE: a
// thing with a way to appear and a way to go away. This module is
// the list of them.
//
// It replaces a hand-written id list in main.ts, and that list had
// already leaked: it named the toolbar filter's INPUT but not the
// CONTAINER the input lives in, so a master-switch teardown left
// the container behind — and the next injection stacked a second
// one on top of it. A surface's removal now lives in the same
// module as the code that builds it, so a leak is a bug in the
// owner instead of a missing line in a list somebody else owns.
//
// The dependency runs ONE way: page-surfaces -> the owner modules.
// The owners import only this module's TYPE, so there is no cycle.
//
// A surface knows three things:
//   - whether it belongs on the page at all (its own guard),
//   - how to put itself there (paint), and
//   - how to take itself away (remove).
// The page's lifecycle has three doors, and only three:
// paintPageSurfaces (the page state changed), repaintPageSurfaces
// (the portal re-rendered and may have taken a surface with it) and
// removePageSurfaces (the page is being left).
// ============================================================

import { cancelInjectionLoops } from "./injection-readiness";
import { badgeSurface } from "./ui-badge";
import { toolbarSurface } from "./ui";
import { panelSurface } from "./ui-comparer";
import { gridFilterSurface, multiInvoiceSurface, toolbarFilterSurface } from "./ui-filters";

/**
 * One injected surface.
 *
 * `paint` puts the surface on the page and must be safe to call again —
 * the portal re-renders constantly, and a surface that stacked a second
 * copy of itself would be a bug the user sees. `remove` takes it off and
 * must be safe to call when it was never there.
 *
 * `repaintedOnRender` says whether the PORTAL's own re-render can take
 * this surface away, so it has to be put back after one. A control that
 * lives inside the portal's header or table can; a panel that lives in
 * <body> cannot — and repainting that one would throw away the text the
 * user pasted into it.
 */
export interface PageSurface {
  /** What the surface is called, for the registry's own reporting. */
  readonly name: string;
  /** Put the surface on the page. */
  paint(): void;
  /** Take the surface off the page. */
  remove(): void;
  /** Whether a portal re-render can take this surface away. */
  readonly repaintedOnRender: boolean;
}

/**
 * Every surface Cindieh puts on a page, in the order they are painted.
 *
 * The order is the one the page used to get, and it matters in one
 * place: the No. Faktur filter hangs itself off the toolbar filter's
 * container when that container is already there, so the toolbar filter
 * is painted first.
 */
export const PAGE_SURFACES: readonly PageSurface[] = [
  badgeSurface,
  toolbarSurface,
  panelSurface,
  toolbarFilterSurface,
  gridFilterSurface,
  multiInvoiceSurface,
];

/**
 * Put every surface on the page.
 *
 * Each surface decides for itself whether it belongs here, so this one
 * call is the whole page's paint — the caller does not need to know
 * which grids have a Referensi column or which pages carry an
 * e-Faktur grid.
 */
export function paintPageSurfaces(): void {
  for (const surface of PAGE_SURFACES) surface.paint();
}

/**
 * Put back the surfaces a portal re-render can take away.
 *
 * The panel and the badge live in <body>, which Angular does not
 * re-render, so they are left alone: rebuilding the panel would throw
 * away what the user pasted into it.
 */
export function repaintPageSurfaces(): void {
  for (const surface of PAGE_SURFACES) {
    if (surface.repaintedOnRender) surface.paint();
  }
}

/**
 * Take every surface off the page.
 *
 * The pending injections are cancelled FIRST: an injector that is still
 * waiting for the portal to render its anchor would otherwise put a
 * surface back into the page we are leaving.
 */
export function removePageSurfaces(): void {
  cancelInjectionLoops();
  for (const surface of PAGE_SURFACES) surface.remove();
}
