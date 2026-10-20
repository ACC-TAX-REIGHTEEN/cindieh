// ============================================================
// UI-COMPARER.TS — the panel that hosts BOTH tabs
// ============================================================
// This module is the composition root of the comparison panel. It
// builds the overlay, the header with the two tab buttons, and the
// body that hosts the two tabs — each of which is its own view
// module: the Komparator's is ui-comparer-view.ts and the
// Pengecekan one's is ui-checker.ts. The overlay's own
// behaviour — which tab is showing, opening, closing, Escape — lives
// in ui-panel.ts, and the grid markup both result views render lives
// in result-grid-view.ts.
//
// The split is a seam, not a shuffle: each tab is now buildable and
// testable without the other, and the panel's cross-tab wiring (the
// two filter menus, the Escape key, the click-outside handler) is
// the only place the two are joined.
//
// The root tells the shell which elements are which tab, and what
// each tab can do on this page (ADR-0036) — so the shell reads no id
// and answers no question about the tabs' contents.
// ============================================================

import { checkerView } from "./ui-checker";
import { comparerView } from "./ui-comparer-view";
import {
  bindPanelTab,
  clearPanelTabs,
  closePanel,
  switchTab,
} from "./ui-panel";
import type { PageSurface } from "./page-surfaces";
import type { StatusFilterMenu } from "./result-grid-view";

/**
 * The document-level handler that closes an open status-filter menu when the
 * click lands outside it. Module state so the modal can replace it instead of
 * stacking another one, and so teardown can hand the document back.
 */
let menusOutsideClickHandler: ((e: MouseEvent) => void) | null = null;

/**
 * Drop the panel's document-level click handler. Called by the master-switch
 * teardown, which removes the overlay but cannot unregister anything. Safe to
 * call when no handler is registered, and safe to call twice.
 */
export function removeMenusOutsideClickHandler(): void {
  if (!menusOutsideClickHandler) return;
  document.removeEventListener("click", menusOutsideClickHandler);
  menusOutsideClickHandler = null;
}

/**
 * Inject the panel. Both tabs are built here because both are children of the
 * one overlay; everything each tab owns itself lives in its own module.
 */
export function injectComparerModal(): void {
  if (document.getElementById("ch-comparer-modal")) return;

  const overlay = document.createElement("div");
  overlay.id = "ch-comparer-overlay";
  overlay.className = "ch-comparer-overlay";

  const modal = document.createElement("div");
  modal.id = "ch-comparer-modal";
  modal.className = "ch-comparer-modal";
  // The panel is a modal dialog: it covers the portal, traps nothing the user
  // can act on behind it, and Escape dismisses it. Saying so is what lets a
  // screen reader announce it as one and what tells assistive tech the content
  // behind the overlay is inert — the visible "×" alone communicated neither.
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  // Named after what the two tabs actually do, since the panel has no visible
  // heading to point aria-labelledby at.
  modal.setAttribute("aria-label", "Perbandingan data dan pengecekan akuratan nilai");
  // Focusable so openPanel() can move focus into the panel: Escape is handled
  // on the overlay (see below) and would otherwise never be delivered while
  // focus still sits on the portal's own button.
  modal.tabIndex = -1;

  // Header
  const header = document.createElement("div");
  header.className = "ch-comparer-header";

  const tabsContainer = document.createElement("div");
  tabsContainer.className = "ch-comparer-tabs";

  const tabCompareBtn = document.createElement("button");
  tabCompareBtn.id = "ch-tab-compare";
  tabCompareBtn.type = "button";
  tabCompareBtn.className = "ch-comparer-tab ch-comparer-tab-active";
  tabCompareBtn.textContent = "Bandingkan Data Penjualan";

  const tabCheckerBtn = document.createElement("button");
  tabCheckerBtn.id = "ch-tab-checker";
  tabCheckerBtn.type = "button";
  tabCheckerBtn.className = "ch-comparer-tab";
  tabCheckerBtn.textContent = "Pengecekan Keakuratan Nilai";

  tabsContainer.appendChild(tabCompareBtn);
  tabsContainer.appendChild(tabCheckerBtn);

  const closeBtn = document.createElement("button");
  closeBtn.className = "ch-comparer-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Tutup");

  header.appendChild(tabsContainer);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement("div");
  body.className = "ch-comparer-body";

  // ── The two tabs ─────────────────────────────────────
  // Each tab builds its own markup and hands the root over; the panel
  // only hosts it.
  comparerView.inject();
  checkerView.inject();

  body.appendChild(comparerView.root);
  body.appendChild(checkerView.root);

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ── What the shell knows about each tab ──────────────
  // The shell shows and hides tabs; it does not know what a tab contains.
  // So it is told: where the button and the view are, whether this page can
  // serve the tab (the tab's own gate), and what the tab does when the panel
  // opens on it (the Komparator's paste area).
  bindPanelTab("compare", {
    button: tabCompareBtn,
    view: comparerView.root,
    available: () => comparerView.available(),
    onOpen: () => comparerView.focusInput(),
  });
  bindPanelTab("check", {
    button: tabCheckerBtn,
    view: checkerView.root,
    available: () => checkerView.available(),
  });

  // ── Cross-tab wiring ─────────────────────────────
  // The two tabs are joined exactly here: their filter menus answer the same
  // Escape key and the same click-outside, and nothing below knows which tab a
  // control belongs to.
  const filterMenus = [comparerView.filterMenu, checkerView.filterMenu].filter(
    (menu): menu is StatusFilterMenu => menu !== null,
  );

  tabCompareBtn.addEventListener("click", () => switchTab("compare"));
  tabCheckerBtn.addEventListener("click", () => switchTab("check"));

  closeBtn.addEventListener("click", closePanel);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePanel();
  });
  // Escape closes the panel. The listener lives on the OVERLAY rather than on
  // document, so the master-switch teardown that removes the element also drops
  // the handler with it — a document-level one would outlive the panel and keep
  // swallowing a key the portal may want.
  //
  // One press does the least destructive thing available: dismiss an open
  // filter menu first, and only close the panel when there is none. Closing a
  // 300-row comparison because the user meant to close a dropdown would be a
  // harsh reading of the same gesture.
  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const openMenu = filterMenus.find((menu) => !menu.menu.classList.contains("ch-hidden"));
    if (openMenu) {
      e.stopPropagation();
      openMenu.close();
      return;
    }
    closePanel();
  });

  // Click outside a filter menu closes it. Registered through a tracked
  // handler rather than inline: `document` outlives the panel, so a handler
  // left behind by the master-switch teardown would keep running on every page
  // click and a rebuilt modal would stack a second one beside it.
  removeMenusOutsideClickHandler();
  menusOutsideClickHandler = (e: MouseEvent) => {
    for (const menu of filterMenus) {
      if (!menu.wrap.contains(e.target as Node)) menu.close();
    }
  };
  document.addEventListener("click", menusOutsideClickHandler);
}

/**
 * Take the panel off the page.
 *
 * The panel is CLOSED first, and that is not a detail: an open panel marks
 * everything behind it inert, so removing the overlay without giving that
 * back leaves a portal the user cannot click — a page that looks fine and
 * answers to nothing. Closing it hands the background back and the focus
 * returns to wherever it came from.
 *
 * The shell's bindings go with it: a binding whose elements are no longer on
 * the page would leave the shell showing a tab that is not there.
 */
export function removeComparerPanel(): void {
  closePanel();
  removeMenusOutsideClickHandler();
  clearPanelTabs();
  document.getElementById("ch-comparer-overlay")?.remove();
  document.getElementById("ch-comparer-modal")?.remove();
}

/**
 * The panel as a PAGE SURFACE: the overlay that hosts the Komparator and
 * Pengecekan.
 *
 * It lives in <body>, which Angular does not re-render — so the portal cannot
 * take it away, and repainting it would throw away the text the user pasted
 * into it.
 */
export const panelSurface: PageSurface = {
  name: "panel",
  paint: injectComparerModal,
  remove: removeComparerPanel,
  repaintedOnRender: false,
};
