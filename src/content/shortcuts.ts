// ============================================================
// SHORTCUTS.TS — Keyboard shortcuts for the portal page
//
// The manifest declares no `commands` block, so these two are the whole
// shortcut surface: Ctrl+Shift+E to start an export, Ctrl+Shift+S to stop
// the running one. They live in the content script rather than the manifest
// because they have to consult live page state — whether the current URL is
// an export page, and whether a run is in flight — and a manifest command
// can do neither.
//
// The keybindings are DECLARED as data below rather than written into the
// handler as literals. The handler reads this table, and README.md and the
// microsite both describe what it says, so a combination cannot change here
// without the documentation changing with it.
// ============================================================

import { isSupportedExportPage } from "./page-context";
import { postToScraper } from "./bridge";

/**
 * One keybinding. `combo` is written the way a user would write it down;
 * `keys` are the `KeyboardEvent.key` values that answer to it, in both cases,
 * because `e.key` is layout- and case-dependent on a shifted keystroke.
 */
export interface Shortcut {
  /** Stable id, used in log lines and as the table's own key. */
  readonly id: "export" | "stop";
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
    description:
      "Mulai atau hentikan menu ekspor. Hanya bekerja di halaman portal yang didukung, dan diabaikan ketika sedang berjalan.",
  },
  {
    id: "stop",
    combo: "Ctrl+Shift+S",
    keys: ["S", "s"],
    description: "Batalkan proses yang sedang berjalan.",
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
      postToScraper({ type: "STOP_SCRAPE" });
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