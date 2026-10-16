// ============================================================
// SHORTCUTS.TS — Keyboard shortcuts for the portal page
//
// The manifest declares no `commands` block, so these three are the whole
// shortcut surface: Ctrl+Shift+E to fetch the grid (the same scrape the toolbar
// button runs), Ctrl+Shift+S to stop the running one, and Ctrl+Shift+B to open
// the Bandingkan/Pengecekan panel.
// They live in the content script rather than the manifest because they have
// to consult live page state — whether the current URL is an export page, and
// whether a run is in flight — and a manifest command can do neither.
//
// The keybindings are DECLARED as data below rather than written into the
// handler as literals. The handler reads this table, and README.md and the
// microsite both describe what it says, so a combination cannot change here
// without the documentation changing with it.
//
// Every binding dispatches a document event instead of calling a module: the
// toolbar and the panel already own the behaviour behind those events, so the
// key and the button cannot drift apart. That matters most for Stop — a
// cancelled run emits no completion, so if the key posted STOP_SCRAPE on its own
// the isolated world would be left believing a Run was still in flight.
// ============================================================

import { isPanelPage, isSupportedExportPage } from "./page-context";

/**
 * The event main.ts's stop path answers, shared with the toolbar's own stop.
 * `ch:scrape-start` is its counterpart, so the family reads together.
 */
const STOP_EVENT = "ch:scrape-stop";

/**
 * One keybinding. `combo` is written the way a user would write it down;
 * `keys` are the `KeyboardEvent.key` values that answer to it, in both cases,
 * because `e.key` is layout- and case-dependent on a shifted keystroke.
 */
export interface Shortcut {
  /** Stable id, used in log lines and as the table's own key. */
  readonly id: "export" | "stop" | "panel";
  /** The combination as it should be written in documentation. */
  readonly combo: string;
  /** `KeyboardEvent.key` values that trigger it, upper and lower case. */
  readonly keys: readonly string[];
  /** What it does, in the user's terms. Documentation only. */
  readonly description: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: "export",
    combo: "Ctrl+Shift+E",
    keys: ["E", "e"],
    // The key fetches grid data; it does not open the export menu and it never
    // stops anything. The menu is a toolbar surface with four destinations
    // (XLSX, CSV, PDF, the year sweep) and a keystroke cannot pick one, so the
    // key keeps the one action every supported page has — the same scrape the
    // toolbar's scrape button runs, which on a withholding page is the bulk PDF
    // download.
    description:
      "Mulai ambil data dari grid (scrape), sama seperti tombol scrape di toolbar. Hanya bekerja di halaman portal yang didukung, dan diabaikan ketika sedang berjalan.",
  },
  {
    id: "stop",
    combo: "Ctrl+Shift+S",
    keys: ["S", "s"],
    description:
      "Batalkan proses yang sedang berjalan, sama seperti tombol Berhenti di toolbar.",
  },
  {
    // The panel already closes with Escape and by clicking outside, so this
    // key only OPENS it — mirroring the toolbar button's one-way behaviour
    // rather than building a second toggle beside the Escape close.
    id: "panel",
    combo: "Ctrl+Shift+B",
    keys: ["B", "b"],
    description:
      "Buka panel Bandingkan / Pengecekan Keakuratan Nilai. Hanya bekerja di halaman e-Faktur PPN: Keluaran, Masukan, dan kedua Retur.",
  },
];

const SHORTCUT_BY_ID = new Map(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

/**
 * Install the shortcut handler and return a function that removes it.
 *
 * The unregister is not optional bookkeeping. `document` outlives everything
 * this extension puts on the page, so a listener left behind by a
 * master-switch teardown would keep answering Ctrl+Shift+E on a page whose
 * controls have all been removed — the "half-removed is worse than none" state
 * teardownInjectedUi() is written to avoid. Calling the returned function twice
 * is safe, so a teardown that runs twice cannot throw.
 */
export function registerShortcuts(
  isRunning: () => boolean,
  isEnabled: () => boolean = () => true,
): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || !e.shiftKey) return;

    // A shortcut for a switched-off extension is not a shortcut. Checked here
    // rather than by the caller, so no future caller can forget.
    if (!isEnabled()) return;

    if (SHORTCUT_BY_ID.get("export")!.keys.includes(e.key)) {
      if (!isSupportedExportPage()) return;
      if (isRunning()) return;
      e.preventDefault();
      document.dispatchEvent(new CustomEvent("ch:scrape-toggle"));
      return;
    }

    if (SHORTCUT_BY_ID.get("stop")!.keys.includes(e.key)) {
      if (!isSupportedExportPage()) return;
      if (!isRunning()) return;
      e.preventDefault();
      document.dispatchEvent(new CustomEvent(STOP_EVENT));
    }

    if (SHORTCUT_BY_ID.get("panel")!.keys.includes(e.key)) {
      // The panel's two tabs live on the four e-Faktur PPN grids — the check on
      // all four, the Komparator where a Referensi identifies a row — exactly
      // where ui-panel.ts makes them available. `isPanelPage` asks that same
      // question (either tab's gate), from one source, so the key and the
      // toolbar button can never disagree about the page it works on.
      if (!isPanelPage()) return;
      e.preventDefault();
      document.dispatchEvent(new CustomEvent("ch:compare-open"));
    }
  };

  document.addEventListener("keydown", onKeyDown);

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    document.removeEventListener("keydown", onKeyDown);
  };
}