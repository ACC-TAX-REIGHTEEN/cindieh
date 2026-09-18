// ============================================================
// BACKGROUND.TS — Background Script
// ============================================================

import { browserAPI } from "../content/browser-shim";
import { debugLog } from "../content/debug";
import { initDebugFromExtensionStorage } from "../content/debug-preference";

// Apply the popup's debug switch. The read is async, so a log emitted
// synchronously below may still be suppressed on a cold start.
void initDebugFromExtensionStorage();

debugLog("Cindieh: Background script active");

browserAPI.runtime.onInstalled.addListener(() => {
  debugLog("Cindieh: Extension installed/updated");
});
