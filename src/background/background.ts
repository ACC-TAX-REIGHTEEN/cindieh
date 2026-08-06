// ============================================================
// BACKGROUND.TS — Background Script
// ============================================================

import { browserAPI } from "../content/browser-shim";
import { debugLog } from "../content/debug";

debugLog("Cindieh: Background script active");

browserAPI.runtime.onInstalled.addListener(() => {
  debugLog("Cindieh: Extension installed/updated");
});
