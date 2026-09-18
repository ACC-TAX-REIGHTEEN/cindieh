# AGENTS.md

## Project

**Cindieh** — a Manifest V3 browser extension (Chrome + Firefox) for the Indonesian DJP Coretax tax portal (`coretaxdjp.pajak.go.id`). It replaces slow portal workflows with one-click features: bulk export of grid data to Excel/CSV, bulk PDF downloads, reference-number search, and a comparer that checks internal invoice records (pasted from Excel) against Coretax.

Tech: TypeScript (strict), esbuild bundling, SheetJS (`xlsx`), vanilla DOM/CSS — no UI framework. Commands and scripts live in `package.json`; install deps with `pnpm install`.

**Language split:** user-facing strings (UI text, alerts, panel status) and the README are in **Indonesian**; code comments and this file are in English. Keep user-visible text in Indonesian.

**Architecture decisions** live in `docs/adr/` (numbered, one per decision; see `docs/adr/README.md` for the index). The domain glossary is `CONTEXT.md`. When changing the shape of a module, check both before re-litigating a settled seam.

## Two-worlds architecture

The extension runs in two JavaScript worlds on the Coretax page that communicate **only** through token-validated `postMessage`:

- **Isolated world** — `src/content/main.ts`: the content script (has `browser.runtime`). Injects in-page UI, fires browser downloads, relays messages. Workflow UI lives in-page; the manifest also declares an action popup (`popup/popup.html`) that sets the export-mode preference and the debug-log switch via `storage.local`.
- **MAIN world** — `src/content/scraper.ts`: injected into the page via a `<script>` tag pointing at the web-accessible `content/scraper.js`. It sits next to the portal's own code, so it can intercept XHR/fetch, read request bodies (filters), and **capture** API responses for scraping and PDF download. It has no browser API.

The **bridge token** correlates messages with the current bridge: `bridge.ts` generates it in the isolated world and passes it through the script URL without storing it on `window`. MAIN-world code can still observe it through the shared DOM and `postMessage` traffic; it is not secret authentication against hostile same-page scripts. `shouldProcessPageMessage` checks source, origin, token, and direction. Source/origin bind the window and origin, not the JavaScript world; `FROM_PAGE` and `FROM_CONTENT` are protocol fields, not proof of sender identity. Keep the two-worlds seam and token validation with these accepted limitations (ADR-0007).

Key message types:
- isolated → MAIN: `START_SCRAPE`, `STOP_SCRAPE`, `SCRAPE_BY_INVOICES`, `SET_SERVER_FILTER`, `RESET_SCRAPER`, `START_PDF_DOWNLOAD`
- MAIN → isolated: `INJECTED_READY`, `SCRAPE_PROGRESS`, `SCRAPE_COMPLETE`, `SCRAPE_ERROR`, `DOWNLOAD_PDF_ITEM`

`main.ts` and `scraper.ts` each run one `createMessageDispatcher` (from `postmessage-guard.ts`) — a guard-then-dispatch seam per world, keyed by message `type`. New message types register in the handler table of the world that receives them. State is stored in `main-actions.ts` (`ContentState`) so the in-page panel survives content-script restarts and SPA navigation.

## Source map (`src/content/`)

| Module | Role |
|---|---|
| `main.ts` | Content-script entry: SPA navigation tracking, message relay, in-page button events |
| `scraper.ts` | MAIN-world entry: XHR/fetch interception and request capture, pagination orchestration |
| `scraper-actions.ts` | High-level flows extracted from scraper.ts (paginated scrape, bulk PDF, scrape-by-invoice); deps injected via `ScraperContext` |
| `scraper-xhr.ts` | The extension's own API calls (building on captured request metadata) |
| `scraper-intercept.ts` | `interceptRequest` factory + injectable `InterceptContext` |
| `scraper-helpers.ts` | Pure helpers: download-URL/body builders, row merge, field collection |
| `scraper-types.ts` | Shared types: `CapturedRequest`, `ScrapeMessage`, `FromContentMessage`, `InterceptedXHR` |
| `scraper-pdf.ts` | PDF download module: `createPdfDownloadSession` + pure unwrap/resolve/message build; all DOWNLOAD_PDF_ITEM emission |
| `scraper-fetch.ts` | fetch-path native-download interceptor (extracted seam): contract is one request per call, never a replay |
| `scraper-nets.ts` | Backup nets against a duplicate native save: the blob-anchor and `window.open` corridors, with injected targets so they unit-test |
| `scraper-xhr-patches.ts` | The XHR prototype patches (`open`/`send`/`setRequestHeader`): native-download arming, filter injection, grid capture; ships the pure `injectFilters`/`fillInvoiceRowIndex` helpers |
| `page-context.ts` | URL → `ExportSource` mapping (`OUTPUT_TAX`, `INPUT_TAX`, `SPT_A2`, `PPH_21_L1A`, ...), filename-hint extraction from request filters |
| `tax-date.ts` | Masa pajak period & date parsing: `extractYear`, `extractMonth`, `extractYMD`, `formatDate` |
| `exporter.ts` | XLSX/CSV generation, `generateDynamicFilename`, `buildCSV`, `PREFIX_MAP` |
| `downloader.ts` | Browser download orchestration with custom PDF naming |
| `main-actions.ts` | Scrape/export action handlers + `ContentState` (module singleton; `createContentState()` factory for tests) |
| `comparer.ts`, `comparer-logic.ts`, `ui-comparer.ts` | Paste-and-compare feature vs Coretax data |
| `ui.ts`, `ui-filters.ts`, `ui-badge.ts`, `button-state.ts`, `shortcuts.ts` | In-page DOM injection and UI state |
| `bridge.ts`, `postmessage-guard.ts` | Cross-world messaging: token generation + the guard-then-dispatch seam (`createMessageDispatcher`), pure and exported for tests |
| `browser-shim.ts` | Picks `browser`/`chrome` runtime |
| `debug.ts` | Logging; a release build stays silent unless opted in — precedence: `?chdebug` URL value, popup switch, page `cindieh:debug` storage flag, build default (see Gotchas) |
| `debug-preference.ts` | Extension-storage bridge behind the popup's debug switch: read/write the flag and apply it to the content script, background, and popup |

Outside `src/content/`: `src/background/background.ts` is the minimal MV3 background (install logging), and `src/popup/popup.ts` manages the export-mode preference. `build.cjs` bundles four entries (`content/main`, `content/scraper`, `background/background`, `popup/popup`).

## Conventions

Existing code follows these patterns — new code should match them:

- **Testability first:** logic extracted from the world-entry scripts is written as pure functions with browser/DOM dependencies injected through context interfaces (`ActionDeps`, `ScraperContext`, `InterceptContext`, `ContentState`). Add new flows the same way instead of growing `scraper.ts`/`main.ts`.
- **The world-entry wiring is itself tested.** Extracting patch bodies leaves the IIFE holding only wiring (which prototype goes to which factory, install order, teardown) — that layer is on its own, in both worlds. `scraper-boot.unit.test.ts` imports the real `scraper.ts` over `stubFakeDom()` plus stubbed `window`/`location`/`XMLHttpRequest`/`HTMLAnchorElement` and asserts both ends: every patched reference differs after boot and comes back on `pagehide`. `main-boot.unit.test.ts` does the same for `main.ts` with a deferred `storage.local.get` and a fireable `MutationObserver`: scraper.js is not appended until the read resolves (the scraper resolves its log flag at module load), the page mirror lands before the append, the one-time marker holds across that await, and a failed load clears the marker so injection retries. Extend the matching harness when you add or move a patch rather than trusting the seam suites to cover the plumbing. The two smaller contexts have startup tests of their own — `popup.unit.test.ts` (controls reflect stored state, a change persists rather than just repaints, the debug toggle applies locally) and `background.unit.test.ts` (install listener, and the documented cold-start race where the startup log is emitted before the switch is known).
- **Stateful modules** export a production singleton plus a `createX()` factory so tests use independent instances, never shared module state.
- **Tests** live in `src/tests/` with relative imports (`../content/...`): `*.unit.test.ts` for vitest `describe`/`it`/`expect` suites, `*.property.test.ts` for fast-check property tests, `*.invalid.property.test.ts` for rejection cases. Shared browser mocks live in `src/tests/__mocks__/` (e.g. `xhr-mock.ts`). There is no vitest config — defaults.
- **Storage reads are guarded, and the guard sets a definite UI state.** A rejected `storage.local.get`/`set` must not surface as an unhandled rejection or leave a control half-rendered: fall back to the documented default and report through `debugError` (`loadExportModePreference` in `main.ts`, the same guard in `popup.ts`). `writeDebugPreference()` swallows on purpose.
- **Teardown restores each surface independently.** `teardownInterceptors()` runs one guarded restore per patched surface so a single refused assignment (e.g. the portal redefining a prototype method as non-writable after we patched it) cannot strand the others; failures go to `debugError`. Keep new restores in that list, and prove it with a throwing property setter as `scraper-boot.unit.test.ts` does.
- **Strictness:** `tsconfig.json` is `strict`; `eslint.config.js` enforces `@typescript-eslint/recommended` with `no-explicit-any` at warn.
- Section banner comments (`===== NAME =====` / `── ... ──`) mark file and region intent.

## Gotchas

- **Coretax is an Angular SPA** — DOM re-renders constantly. `main.ts` observes mutations and debounces injection (`GRID_FILTER_INJECT_DELAY_MS`) to avoid fighting the framework. Injection logic should respect that pattern.
- **Production logs are opt-in; pick the hook by context.** `debug.ts` logs by default only in dev builds (`NODE_ENV=development`). In a release build the sources win in this order: (1) `?chdebug=1` on the page URL — that page load only; (2) the popup's **Log debug** switch, stored in extension storage and applied by `initDebugFromExtensionStorage()` in the content script, background, and popup; (3) `localStorage.setItem("cindieh:debug","1")` from DevTools, which persists per origin; (4) the build default. Off words (`0`/`false`/`off`/`no`) silence each of them, and a `?chdebug` value is never overturned. Sources 1 and 3 are readable from either world, but **the MAIN-world scraper can only use 1 and 3** — it has no browser API, so extension storage is out of reach there. That gap is bridged rather than left open: the content script calls `initDebugForPageWorld()`, which copies the switch into source 3 and records ownership under `cindieh:debug:ext`, so turning the switch off removes the copy and never the developer's own hand-set value; `injectScraper()` awaits that mirror before appending scraper.js, because the scraper resolves the flag at module load. Sources 1 and 3 are read at module load (reload after changing them); the popup switch takes effect on each context's next startup, applies live in the content script via `storage.onChanged`, and reaches the scraper at its next injection — the read is async, so the first log lines of a cold start may still be suppressed. None of the hooks exposes the bridge token; `enableDebug()`/`disableDebug()` remain for programmatic and test use.
- **Bridge validation is required, not same-page authentication.** Never store the token on `window`, log it, or weaken `shouldProcessPageMessage`. Shared DOM/message exposure means it does not prevent hostile same-page forgery. Removing the script's `src` during initialization reduces DOM exposure without a guaranteed sub-frame lifetime; retain the element/id as the injection marker (ADR-0008).
- **Extension-owned XHRs are flagged** `__isCindiehBulk` (see `InterceptedXHR` in `scraper-types.ts`) so the interceptor does not re-capture them and double-fire `DOWNLOAD_PDF_ITEM`. Keep that flag working when adding download paths.
- **Coretax API responses** wrap rows as `{ Payload: { Data: [...] } }`. Parse defensively; the scraper already treats `Payload.Data` as the row array.
- **Dates**: `tax-date.ts` (`formatDate`, `extractYear`, `extractMonth`, `extractYMD`) converts ISO strings to Indonesian `DD/MM/YYYY`; it is timezone-aware, and existing tests pin behaviour across `+07/+08/+09/Z` offsets. Do not "simplify" it, and put new date/period parsing there instead of hand-rolling regexes.
- **Filenames** use per-source prefixes in `PREFIX_MAP` (`FPK-`, `FPM-`, `RET-FPK-`, `A2-`, `B2-`, `PPH21-L1A-`, `BP-`, ...) — exporter specs enumerate all 11 sources.
- **`dist/` is a gitignored build artifact.** Never edit it; the build regenerates it. `build.cjs` rewrites the manifest per browser (Chrome `service_worker`, Firefox scripts + `browser_specific_settings.gecko.data_collection_permissions`), so manifest edits go in the source `manifest.json`.
- **Versioning:** `pnpm version` runs `sync-manifest.cjs` to keep `manifest.json` in sync; releases go through `pnpm release` (release-it + `@release-it/conventional-changelog` → CHANGELOG.md, tag `vX.Y.Z`, no push). Preview the next release without touching anything with `pnpm release:dry-run`.
- **pnpm 11 auto-runs `pnpm install` before every command** (`verify-deps-before-run`), and the install fails on the ignored `esbuild` build script (`ERR_PNPM_IGNORED_BUILDS`). Run commands with `pnpm --config.verify-deps-before-run=false <cmd>` to skip the pre-run install; the `node_modules` tree stays valid.
- **TypeScript 7 is the compiler; `typescript` is aliased on purpose.** `tsc` runs the Go-native TypeScript 7 (`@typescript/native`), while the `typescript` dependency is deliberately `npm:@typescript/typescript6` because TypeScript 7 ships no compiler API and `typescript-eslint` (peer: `<6.1.0`) needs one. `pnpm exec tsc6` gives the 6.0 compiler. Never bump `typescript` to `^7` directly — lint breaks; keep both aliases in sync when upgrading.

## Validation loop

With `cd` at the repo root:

1. **Typecheck** — run `pnpm typecheck`; criterion: zero TS errors.
2. **Tests** — run `pnpm test`; criterion: the whole vitest suite passes, including new coverage for changed logic.
3. **Lint** — run `pnpm lint`; criterion: no eslint errors (warnings acceptable).
4. **Build** — run `pnpm build:chrome` (and `build:firefox` when the change touches cross-browser or manifest concerns); criterion: `dist/cindieh-<browser>/` completes with the manifest produced. For UI changes, nothing substitutes loading `dist/cindieh-chrome` unpacked against the live portal (see below).

## Portal verification (manual)

Unit tests cover the seams, the patches, and the wiring; nothing covers the live portal. Re-run this after any change to the download path (`scraper.ts`, `scraper-pdf.ts`, `scraper-fetch.ts`, `scraper-nets.ts`, `scraper-xhr-patches.ts`, `scraper-xhr.ts`, `downloader.ts`): rebuild, reload the extension, **load the grid once first** — an unpopulated `invoiceRowMap` is what yields `TANPA_REFERENSI` filenames, a missing capture rather than a blocking failure — then record the current download list as the baseline.

Evidence is Network + the download list, not console output: in DevTools → Network (filter `download-invoice-document`, Preserve log) each click must produce **exactly one** request whose response body is the failure payload `{"IsSuccessful":false,"Content":""}`, and `chrome://downloads` must gain **exactly one** file per click, extension-named (`SZ-0447-07-26 - 010.000-26.00000001.pdf` for e-Faktur, `01-2026-BP-001-PT Contoh.pdf` for withholding) — never a portal-named one.

Run all six, because each exercises different code: one 1-click download · two downloads inside the 5s processing window · a legitimate portal save/popup between two blocks (the nets must self-reset, not pile up) · bulk e-Faktur and withholding with the >10-file confirmation both declined and accepted · scrape/export/filter/stop untouched · SPA navigation followed by a full reload (one injection per page, teardown restores every patched surface).

Symptom → suspect: a portal-named PDF with full content means the sabotage never applied (check whether that endpoint went via fetch or XHR); the same file at 0 KB means the dummy stopped being a failure payload; two requests per click means a replayed request or a doubly registered reader; two extension-named files for one row means double emission (`__isCindiehBulk`, XHR arm state); a legitimate download swallowed means the net scope widened; `teardown failed` names one surface and the rest still restore. For logs use `?chdebug=1` (that load only, and it reaches the scraper) or the popup switch (MAIN world from the next page load, since the scraper resolves its flag at module load); confirm the mirror landed by checking `cindieh:debug` + `cindieh:debug:ext` in Application → Local Storage. **Stop and collect evidence the moment a portal-named PDF with real content appears** — that is a regression of the primary block, not a nuance.