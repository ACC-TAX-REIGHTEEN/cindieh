# SheetJS is loaded as a separate chunk, not bundled into the content script

`exporter.ts` must never `import "xlsx"` as a value. The library is reached only through `loadXLSX()`, which performs a runtime `import()` of `content/xlsx.js` — a standalone ESM bundle built in its own esbuild pass and declared as a web-accessible resource.

## Why

SheetJS is ~330KB minified: 81% of the content script's payload. `content/main.js` is a content script injected into **every** `coretaxdjp.pajak.go.id` page at `document_idle`, so inlining the library meant parsing that payload on page loads where the user never exports a spreadsheet. The CSV path never needed it — `buildCSV` is hand-rolled — so nothing on the page-load path requires the library.

Measured by stubbing `xlsx` in the build:

| Bundle | Before | After |
|---|---|---|
| `content/main.js` (with xlsx) | 407.9 KB | 78.5 KB |
| SheetJS share | 329.4 KB (80.8%) | 0 |
| `content/xlsx.js` | — | loaded on first XLSX export |

## Why not esbuild `splitting`

Code splitting requires `format: "esm"`. MV3 declares no module type for `content_scripts`, so the content script must stay a classic IIFE bundle. The five entries therefore need two build passes with different formats (`format: "iife"` for the four entries, `"esm"` for the chunk), and the cross-pass `import()` uses a **non-literal specifier** — `browserAPI.runtime.getURL(XLSX_CHUNK_PATH)` — which is exactly what makes esbuild leave the call in place instead of inlining the library. That call is silenced with `logOverride["unsupported-dynamic-import"]` so it does not read as a build defect.

The background service worker was considered and rejected: it would need a content→background messaging channel (ADR-0002 deliberately closed the runtime channel), and it would structured-clone every scraped row across the boundary — a 10k-row grid is copied whole into the worker, where the current in-process path never duplicates it. The chunk costs one cached fetch on the first export of a session and nothing thereafter.

## Consequences

- The workbook builders take the loaded module as a **parameter**: `buildAoaWorkbook(xlsx, rows, …)`, `downloadWorkbookFile(xlsx, …)`, `writeXlsxFile(xlsx, …)`. This matches the project's inject-dependencies convention, keeps them pure, and lets tests pass a plain `import * as XLSX from "xlsx"`. The lazy entry points — `downloadXLSXFile`, `exportXLSX` — are the async wrappers the UI calls.
- **Nothing may import `xlsx-runtime.ts`.** One import puts the library back in the page-load bundle and silently undoes the split.
- `import type { WorkBook } from "xlsx"` stays in `exporter.ts`. A type-only import is erased at compile time and costs nothing; it is not a violation of this rule.
- A failed chunk load clears the cache so the next export retries instead of replaying the rejection, and the failure reaches the panel (`EXPORT_XLSX_FAILED_MESSAGE`) rather than dying in a `void`-ed handler.
- `content/xlsx.js` must stay listed in `web_accessible_resources` or the runtime `import()` fails.

Status: accepted.