// ============================================================
// UI-PANEL.TS — the shell BOTH result views live in
// ============================================================
// The comparison panel is one overlay holding two tabs, and the
// things that belong to the OVERLAY rather than to either tab —
// which tab is showing, opening and closing, Escape, and handing a
// reference back to the portal's grid — used to sit in the same
// module as the Bandingkan view. That made the Pengecekan tab
// depend on the module that hosts it: ui-checker.ts needs to reopen
// the panel and close it, so those calls live here instead and the
// dependency runs one way (ui-comparer → ui-checker → ui-panel).
//
// The DOM is still built by the composition root in ui-comparer.ts,
// which is what ui.ts and main.ts call; this module is the
// overlay's behaviour, not its markup.
// ============================================================

import { isOutputTaxPage, isVatInvoicePage } from "./page-context";
import { startScrape } from "./main-actions";
import { showPanel, updatePanelProgress } from "./ui-badge";
import { postToScraper } from "./bridge";

/** The panel's two tabs. */
export type PanelTab = "compare" | "check";

/**
 * The panel asks for a scrape on its own — "Periksa" with no grid data yet —
 * which is not the export path and does not need a full ActionDeps. Supplying
 * the three calls a bare scrape uses keeps the dependency explicit at the call
 * site instead of reaching for production defaults the panel never touches.
 */
const SCRAPE_DEPS = { showPanel, updatePanelProgress, postToScraper };

/** Fetch the current grid because a check or comparison had nothing to read. */
export function scrapeForPanel(): void {
  startScrape(SCRAPE_DEPS);
}

// ── Switch Tabs ───────────────────────────────────────

export function switchTab(tab: PanelTab): void {
  const tabCompareBtn = document.getElementById("ch-tab-compare");
  const tabCheckerBtn = document.getElementById("ch-tab-checker");
  const viewCompare = document.getElementById("ch-comparer-view-compare");
  const viewChecker = document.getElementById("ch-comparer-view-checker");

  if (tabCompareBtn && tabCheckerBtn && viewCompare && viewChecker) {
    if (tab === "compare") {
      tabCompareBtn.classList.add("ch-comparer-tab-active");
      tabCheckerBtn.classList.remove("ch-comparer-tab-active");
      viewCompare.classList.remove("ch-hidden");
      viewChecker.classList.add("ch-hidden");
    } else {
      tabCheckerBtn.classList.add("ch-comparer-tab-active");
      tabCompareBtn.classList.remove("ch-comparer-tab-active");
      viewChecker.classList.remove("ch-hidden");
      viewCompare.classList.add("ch-hidden");
    }
  }
}

// ── Open / Close ──────────────────────────────────────

export function openPanel(targetTab: PanelTab = "compare"): void {
  const overlay = document.getElementById("ch-comparer-overlay");
  if (overlay) {
    overlay.classList.remove("ch-hidden");
    overlay.style.display = "flex";
    // Move focus into the panel first. Escape is handled on the overlay, so a
    // focus still sitting on the portal's own button would leave the one key a
    // dialog user reaches for doing nothing. The branch below then hands focus
    // to the textarea when there is one to type into.
    const modalEl = document.getElementById("ch-comparer-modal");
    if (modalEl) modalEl.focus({ preventScroll: true });

    // Both tabs are gated per page, and the tab that does not apply is HIDDEN
    // rather than offered and then refused. Pengecekan is a PPN-grid check: on
    // any other page there is nothing for it to read. The Komparator matches
    // internal records to Coretax by Referensi, and a PPN Masukan Referensi is
    // the seller's — the reason README.md gives for the Komparator staying off
    // PPN Masukan (and Retur carries no such grid for it either).
    const canCheck = isVatInvoicePage();
    const canCompare = isOutputTaxPage();
    const tabCompareBtn = document.getElementById("ch-tab-compare");
    const tabCheckerBtn = document.getElementById("ch-tab-checker");
    if (tabCompareBtn) {
      tabCompareBtn.classList.toggle("ch-hidden", !canCompare);
    }
    if (tabCheckerBtn) {
      tabCheckerBtn.classList.toggle("ch-hidden", !canCheck);
    }

    // A requested tab the page cannot serve falls back to the one it can, so a
    // Ctrl+Shift+B press on PPN Masukan lands in Pengecekan instead of in a
    // Komparator with no grid to match. When NEITHER predicate holds (a URL
    // neither predicate knows), the requested tab is honoured as written: every
    // production caller is already gated before it gets here, and an openPanel
    // that silently did nothing would leave a dead shortcut with no way to say
    // why.
    const openCheck = canCheck && (targetTab === "check" || !canCompare);

    if (openCheck) {
      switchTab("check");
    } else {
      switchTab("compare");
      const textarea = document.getElementById("ch-comparer-textarea") as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        navigator.clipboard.readText().then((text) => {
          if (text && !textarea.value) {
            textarea.value = text;
          }
        }).catch(() => {});
      }
    }
  }
}

export function closePanel(): void {
  const overlay = document.getElementById("ch-comparer-overlay");
  if (overlay) {
    overlay.style.display = "none";
    overlay.classList.add("ch-hidden");
  }
}

// ── Hand a reference back to the portal grid ──────────

/**
 * Search for a reference in Coretax itself: fill the injected Referensi filter —
 * toolbar first, grid second — and announce it so main.ts's listener runs the
 * search. The panel closes first, because the grid it would filter is behind it.
 */
export function searchReference(reference: string): void {
  closePanel();

  const input =
    (document.getElementById("ch-toolbar-filter-reference") as HTMLInputElement) ||
    (document.getElementById("ch-grid-filter-reference") as HTMLInputElement);

  if (input) {
    input.value = reference;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  document.dispatchEvent(
    new CustomEvent("ch:search-reference", { detail: { reference } }),
  );
}

// ── Which grid the panel is talking about ─────────────

/**
 * PPN Keluaran rows carry the BUYER; PPN Masukan rows carry the SELLER. Both
 * tabs report progress, and the grid's own name is the honest thing to name:
 * telling someone on PPN Masukan that Cindieh is fetching "data PPN Keluaran"
 * is simply the wrong grid.
 */
export function currentGridLabel(): string {
  return isOutputTaxPage() ? "PPN Keluaran" : "PPN Masukan";
}