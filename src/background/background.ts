// ============================================================
// BACKGROUND.TS — Background Script
// ============================================================

import { browserAPI } from "../content/browser-shim";
import { debugLog } from "../content/debug";

debugLog("Better Coretax: Background script active");

browserAPI.runtime.onInstalled.addListener(() => {
  debugLog("Better Coretax: Extension installed/updated");
});
