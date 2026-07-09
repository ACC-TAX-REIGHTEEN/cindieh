import { isSupportedExportPage } from "./page-context";
import { postToScraper } from "./bridge";

export function registerShortcuts(isRunning: () => boolean): void {
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || !e.shiftKey) return;

    if (e.key === "E" || e.key === "e") {
      if (!isSupportedExportPage()) return;
      if (isRunning()) return;
      e.preventDefault();
      document.dispatchEvent(new CustomEvent("ch:scrape-toggle"));
    }

    if (e.key === "S" || e.key === "s") {
      if (!isSupportedExportPage()) return;
      if (!isRunning()) return;
      e.preventDefault();
      postToScraper({ type: "STOP_SCRAPE" });
    }
  });
}
