// ============================================================
// BACKGROUND.TS — Background Script
// ============================================================

import { browserAPI } from "../content/browser-shim";

console.log("Better Coretax: Background script active");

browserAPI.runtime.onInstalled.addListener(() => {
  console.log("Better Coretax: Extension installed/updated");
});
