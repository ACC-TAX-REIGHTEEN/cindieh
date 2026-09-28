// ============================================================
// BACKGROUND.TS — Background Script
// ============================================================

import { browserAPI } from "../content/browser-shim";
import { debugLog, debugError } from "../content/debug";
import { initDebugFromExtensionStorage } from "../content/debug-preference";
import {
  COMPLETION_STORAGE_KEY,
  MAX_NOTIFICATION_AGE_MS,
  formatCompletionNotification,
  normalizeCompletionRecord,
  requestShowPanel,
} from "../content/completion-notice";

// Apply the popup's debug switch. The read is async, so a log emitted
// synchronously below may still be suppressed on a cold start.
void initDebugFromExtensionStorage();

debugLog("Cindieh: Background script active");

browserAPI.runtime.onInstalled.addListener(() => {
  debugLog("Cindieh: Extension installed/updated");
});

// ── "Selesai" desktop notifications ───────────────────
// The content script cannot raise a notification itself (the notifications API
// is not exposed to content scripts) and there is no runtime.onMessage channel
// (ADR-0002), so it publishes a completion record to storage.local and this
// listener reacts — the same storage seam the popup uses.
//
// This does NOT check the switch: the content script only publishes a record
// when the user has asked for notifications, so an arriving record is already
// one the user wants announced.
browserAPI.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const change = changes[COMPLETION_STORAGE_KEY];
  if (!change) return;
  announceCompletion(change.newValue);
});

/**
 * Raise one toast for a completion record. Exported so the mapping and the
 * staleness guard are unit-tested without a service worker.
 */
export function announceCompletion(value: unknown, now: number = Date.now()): void {
  const record = normalizeCompletionRecord(value);
  if (!record) return;
  // A record can outlive the tab that wrote it: announcing a leftover from an
  // earlier session would be a notification for something the user never saw.
  if (now - record.at > MAX_NOTIFICATION_AGE_MS) return;

  const { title, message } = formatCompletionNotification(record);
  try {
    void Promise.resolve(
      browserAPI.notifications.create(`cindieh-completion-${record.id}`, {
        type: "basic",
        iconUrl: browserAPI.runtime.getURL("icons/icon128.png"),
        title,
        message,
      }),
    ).catch((err) => {
      debugError("Gagal menampilkan notifikasi selesai", err);
    });
  } catch (err) {
    debugError("Gagal menampilkan notifikasi selesai", err);
  }
}

// ── Clicking a completion toast ───────────────────────

/** Must match the id `announceCompletion` builds, so an unrelated id is ignored. */
const NOTIFICATION_ID_PREFIX = "cindieh-completion-";

/** The manifest's portal match pattern, reused to find the tab to bring back. */
const PORTAL_TAB_URL = "https://coretaxdjp.pajak.go.id/*";

/**
 * A completion toast is most useful when the user is elsewhere, so a click on
 * it takes them back: the portal tab is focused, and the tab is separately asked
 * to open its panel, because a focused window does not by itself put the reason
 * for the notification on screen. Exported for the unit tests; the click
 * listener is the only caller.
 */
export async function focusPortalTab(): Promise<void> {
  try {
    const tabs = await browserAPI.tabs.query({ url: PORTAL_TAB_URL });
    // Prefer the tab the user last looked at; any portal tab beats none.
    const tab = tabs.find((candidate) => candidate.active) ?? tabs[0];
    if (tab?.id !== undefined) {
      await browserAPI.tabs.update(tab.id, { active: true });
      if (tab.windowId !== undefined) {
        await browserAPI.windows.update(tab.windowId, { focused: true });
      }
    }
  } catch (err) {
    debugError("Gagal memfokuskan tab portal", err);
  }
  // Written even when no portal tab matched: an unanswered request costs nothing.
  await requestShowPanel();
}

browserAPI.notifications.onClicked.addListener((notificationId) => {
  if (typeof notificationId !== "string" || !notificationId.startsWith(NOTIFICATION_ID_PREFIX)) {
    return;
  }
  void focusPortalTab();
});
