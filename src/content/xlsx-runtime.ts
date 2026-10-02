// ============================================================
// XLSX-RUNTIME.TS — The lazily-loaded SheetJS chunk
// ============================================================
// This file is NOT part of the content script. build.cjs bundles it as its
// own ESM bundle (content/xlsx.js) because a classic content script cannot
// itself be an ES module, so esbuild's `splitting` cannot be used to pull
// SheetJS out of content/main.js. Instead the exporter loads this chunk at
// runtime through a dynamic `import()` of the extension's own URL.
//
// Why it matters: SheetJS is ~330KB minified, about 81% of what the content
// script used to carry. The content script is injected into EVERY
// coretaxdjp.pajak.go.id page at document_idle, so inlining it meant parsing
// that payload on page loads where the user never exports a spreadsheet. The
// CSV path never needed SheetJS at all (buildCSV is hand-rolled), so nothing
// on the page-load path requires the library now.
//
// The chunk is a web-accessible resource, so the browser serves it from its
// own HTTP cache: only the FIRST export in a session pays for the load.
//
// Do not import anything from here — nothing else may import this module, or
// the library lands back in the page-load bundle and the split is undone.

import * as XLSX from "xlsx";

export default XLSX;