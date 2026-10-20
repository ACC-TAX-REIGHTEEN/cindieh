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
// The shell knows NOTHING about what a tab contains. It is told, by
// the composition root, where each tab's button and view are, whether
// this page can serve that tab, and what the tab does when the panel
// opens on it (ADR-0036) — so the ids of the two tabs are the tabs'
// business, and the shell's own question is only "which tab is
// showing".
//
// The DOM is still built by the composition root in ui-comparer.ts,
// which is what ui.ts and main.ts call; this module is the
// overlay's behaviour, not its markup.
// ============================================================

import { panelGridFacts } from "./page-context";
import { startScrape } from "./main-actions";
import { showPanel, updatePanelProgress } from "./ui-badge";
import { postToScraper } from "./bridge";

/** The panel's two tabs. */
export type PanelTab = "compare" | "check";

/**
 * What the shell needs to know about one tab.
 *
 * A binding is the whole of what the shell is told: where the tab's
 * button and its view are, whether this page can serve the tab, and
 * what the tab does when the panel opens on it. The tab's own gate
 * travels with it — the Komparator's is "a Referensi identifies a row
 * here" and Pengecekan's is "the check runs here" — because each
 * question is the tab's own, and the shell has no business answering
 * them (ADR-0021, ADR-0024).
 */
export interface PanelTabBinding {
  /** The tab's button in the panel's header. */
  button: HTMLElement;
  /** The tab's view — the shell only shows and hides it. */
  view: HTMLElement;
  /** Whether this page can serve the tab at all. */
  available: () => boolean;
  /** The tab's own work when the panel opens on it. */
  onOpen?: () => void;
}

/**
 * The tabs the shell knows about, by name.
 *
 * The composition root binds them when it builds the panel and
 * unbinds them when it takes the panel down: a binding that outlived
 * its elements would leave the shell showing a tab that is no longer
 * on the page.
 */
const bindings: Partial<Record<PanelTab, PanelTabBinding>> = {};

/** Tell the shell which elements are a tab's, and what that tab can do. */
export function bindPanelTab(tab: PanelTab, binding: PanelTabBinding): void {
  bindings[tab] = binding;
}

/** Forget every bound tab — the panel is being taken down. */
export function clearPanelTabs(): void {
  for (const tab of Object.keys(bindings) as PanelTab[]) delete bindings[tab];
}

/** The bound tabs, in a stable order. */
function boundTabs(): [PanelTab, PanelTabBinding][] {
  return (Object.keys(bindings) as PanelTab[])
    .map((tab) => [tab, bindings[tab]] as [PanelTab, PanelTabBinding])
    .filter((entry): entry is [PanelTab, PanelTabBinding] => entry[1] !== undefined);
}

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

// ── Focus and the background ──────────────────────────

/**
 * What held focus before the panel opened, so closing can hand it back. Nested
 * in a module rather than read off the DOM at close time, because by then the
 * active element is somewhere inside the panel that is about to be hidden.
 */
let previouslyFocused: HTMLElement | null = null;

/**
 * Whether the panel is showing. The overlay is built visible and only ever
 * hidden by closePanel, so its own class list cannot tell "never opened" from
 * "open" — this flag is what distinguishes the two.
 */
let panelOpen = false;

/**
 * The body children parked behind the open panel, in the order we parked them.
 * Only the ones THIS call changed are listed, so a container the portal had
 * already marked inert is left exactly as it was.
 */
let inertedSiblings: HTMLElement[] = [];

/**
 * Park everything but the overlay while the panel is open.
 *
 * `aria-modal` tells assistive tech the content behind the dialog is
 * inert, and that is a claim the DOM has to keep: without this, Tab walks out
 * of the dialog and into the portal underneath it. Restoring is by the list we
 * recorded, so a node Angular replaced in the meantime cannot be left inert.
 */
function setBackgroundInert(inert: boolean): void {
  if (!inert) {
    for (const el of inertedSiblings) el.inert = false;
    inertedSiblings = [];
    return;
  }

  const overlay = document.getElementById("ch-comparer-overlay");
  for (const child of Array.from(document.body.children) as HTMLElement[]) {
    if (child === overlay || child.inert) continue;
    child.inert = true;
    inertedSiblings.push(child);
  }
}

// ── Switch Tabs ───────────────────────────────────────

/**
 * Show one tab and hide the other.
 *
 * The shell's own question, and the only one it asks: which tab is
 * showing. Everything a tab needs to know about itself is in the
 * binding, so this reads no id and knows no tab's contents.
 */
export function switchTab(tab: PanelTab): void {
  for (const [name, binding] of boundTabs()) {
    const active = name === tab;
    binding.button.classList.toggle("ch-comparer-tab-active", active);
    binding.view.classList.toggle("ch-hidden", !active);
  }
}

/**
 * Which tab the panel opens on.
 *
 * A requested tab the page cannot serve falls back to the one it can, so a
 * Ctrl+Shift+B press on PPN Masukan lands in Pengecekan instead of in a
 * Komparator with no grid to match. When NEITHER tab can be served (a URL
 * neither gate knows), the requested tab is honoured as written: every
 * production caller is already gated before it gets here, and an openPanel
 * that silently did nothing would leave a dead shortcut with no way to say why.
 */
function resolveTab(target: PanelTab): PanelTab {
  if (bindings[target]?.available()) return target;
  const other: PanelTab = target === "compare" ? "check" : "compare";
  if (bindings[other]?.available()) return other;
  return target;
}

// ── Open / Close ──────────────────────────────────────

export function openPanel(targetTab: PanelTab = "compare"): void {
  const overlay = document.getElementById("ch-comparer-overlay");
  if (overlay) {
    // Capture the way back only when the panel is really opening: reopening an
    // already-open panel would otherwise remember the panel itself as the
    // place to return to.
    if (!panelOpen) {
      previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;
      panelOpen = true;
    }

    overlay.classList.remove("ch-hidden");
    overlay.style.display = "flex";
    // Move focus into the panel first. Escape is handled on the overlay, so a
    // focus still sitting on the portal's own button would leave the one key a
    // dialog user reaches for doing nothing. The tab's own work below then
    // hands focus to whatever that tab wants it in.
    const modalEl = document.getElementById("ch-comparer-modal");
    if (modalEl) modalEl.focus({ preventScroll: true });
    setBackgroundInert(true);

    // Both tabs are gated per page, and the tab that does not apply is HIDDEN
    // rather than offered and then refused. The gate is the tab's own: the
    // Komparator matches internal records to Coretax by Referensi, and a
    // PPN Masukan Referensi is the seller's — the reason README.md gives for
    // the Komparator staying off PPN Masukan, and off the Retur grids, which
    // have no Referensi at all. Pengecekan runs on the four e-Faktur PPN grids
    // — both invoice grids and both Retur grids, because a retur row carries
    // the same DPP / DPP Nilai Lain / PPN.
    //
    // TWO DIFFERENT facts, not one: each tab answers its own question, and
    // neither is `isOutputTaxPage`, and neither is the filter's own fact
    // (`hasReferenceFilter`) — Pengecekan's hand-back searches the injected
    // Referensi filter, which PPN Masukan has as well.
    for (const [, binding] of boundTabs()) {
      binding.button.classList.toggle("ch-hidden", !binding.available());
    }

    const tab = resolveTab(targetTab);
    switchTab(tab);
    // The tab's own work when the panel opens on it: the Komparator puts the
    // caret in its paste area and offers the clipboard, and the shell does not
    // know that this tab has a paste area at all.
    bindings[tab]?.onOpen?.();
  }
}

export function closePanel(): void {
  const overlay = document.getElementById("ch-comparer-overlay");
  if (overlay) {
    overlay.style.display = "none";
    overlay.classList.add("ch-hidden");
  }
  setBackgroundInert(false);
  panelOpen = false;

  // Hand focus back to whatever had it before, so a keyboard user who opened
  // the panel from the toolbar is not dropped at the top of the portal. A node
  // Angular has since replaced simply takes no focus — focusing a detached
  // element is a no-op — which is why this needs no existence check.
  const returnTo = previouslyFocused;
  previouslyFocused = null;
  if (returnTo) returnTo.focus();
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

// ── What a tab says when its request is retired ───────

/**
 * The one line a tab's status field shows once the request it was waiting on is
 * gone.
 *
 * A retirement can be a stop, a failed scrape, a lost chunk or a reset, so this
 * names the OUTCOME — the request was retired before its result arrived — and
 * does not claim a cause it cannot know. The badge carries the cause
 * (`SCRAPE_CANCELLED_MESSAGE` for a stop, the failure's own message otherwise),
 * which is why this is deliberately the quieter half: a blank line left the tab
 * looking like it had never asked for anything, and repeating the badge's
 * sentence would have been two accounts of one event (ADR-0026).
 */
export const RETIRED_REQUEST_NOTICE =
  "Permintaan dibatalkan sebelum hasilnya tiba. Jalankan lagi untuk mencoba.";

// ── Which grid the panel is talking about ─────────────

/**
 * PPN Keluaran rows carry the BUYER; PPN Masukan rows carry the SELLER. Both
 * tabs report progress, and the grid's own name is the honest thing to name:
 * telling someone on PPN Masukan that Cindieh is fetching "data PPN Keluaran"
 * is simply the wrong grid.
 */
export function currentGridLabel(): string {
  // The grid's own NAME, which is a question of its own: the four e-Faktur PPN
  // grids have four names, and `isOutputTaxPage` answers a different one — a
  // label read off the page gate would tell someone on Retur PPN Masukan that
  // Cindieh is fetching "data PPN Masukan". The names now live in the panel's
  // per-grid table (page-context.PANEL_GRIDS), beside the tab gates and the
  // column facts, so the label a notice prints and the facts the panel applies
  // to that grid are read from one row.
  return panelGridFacts()?.label ?? "grid";
}
