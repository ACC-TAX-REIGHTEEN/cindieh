# AGENTS.md

## Project

**Cindieh** — a Manifest V3 browser extension (Chrome + Firefox) for the Indonesian DJP Coretax tax portal (`coretaxdjp.pajak.go.id`). It replaces slow portal workflows with one-click features: bulk export of grid data to Excel/CSV, bulk PDF downloads, reference-number search, and a comparer that checks internal invoice records (pasted from Excel) against Coretax.

Tech: TypeScript (strict), esbuild bundling, SheetJS (`xlsx`), vanilla DOM/CSS — no UI framework. Commands and scripts live in `package.json`; install deps with `pnpm install`.

**Language split:** user-facing strings (UI text, alerts, panel status) and the README are in **Indonesian**; code comments and this file are in English. Keep user-visible text in Indonesian.

## Two-worlds architecture

The extension runs in two JavaScript worlds on the Coretax page that communicate **only** through token-authenticated `postMessage`:

- **Isolated world** — `src/content/main.ts`: the content script (has `browser.runtime`). Injects in-page UI, fires browser downloads, relays messages. All extension UI lives in-page; there is **no browser-action popup** in the manifest.
- **MAIN world** — `src/content/scraper.ts`: injected into the page via a `<script>` tag pointing at the web-accessible `content/scraper.js`. It sits next to the portal's own code, so it can intercept XHR/fetch, read request bodies (filters), and **capture** API responses for scraping and PDF download. It has no browser API.

The **bridge token** makes this safe: `bridge.ts` generates a random token once, in the isolated world, and smuggles it to the scraper through the script's URL query param so it never sits on `window`. Message direction and token are validated by `postmessage-guard.ts` (`shouldProcessPageMessage` requires `direction: "FROM_PAGE"`, matching `event.source`, and the token).

Key message types:
- isolated → MAIN: `START_SCRAPE`, `STOP_SCRAPE`, `SCRAPE_BY_INVOICES`, `SET_SERVER_FILTER`, `RESET_SCRAPER`, `START_PDF_DOWNLOAD`
- MAIN → isolated: `INJECTED_READY`, `SCRAPE_PROGRESS`, `SCRAPE_COMPLETE`, `SCRAPE_ERROR`, `DOWNLOAD_PDF_ITEM`

`main.ts` relays these (`window.postMessage` ↔ `browser.runtime.onMessage`). State is stored in `main-actions.ts` (`ContentState`) so the in-page panel survives content-script restarts and SPA navigation.

## Source map (`src/content/`)

| Module | Role |
|---|---|
| `main.ts` | Content-script entry: SPA navigation tracking, message relay, in-page button events |
| `scraper.ts` | MAIN-world entry: XHR/fetch interception and request capture, pagination orchestration |
| `scraper-actions.ts` | High-level flows extracted from scraper.ts (paginated scrape, bulk PDF, scrape-by-invoice); deps injected via `ScraperContext` |
| `scraper-xhr.ts` | The extension's own API calls (building on captured request metadata) |
| `scraper-intercept.ts` | `interceptRequest` factory + injectable `InterceptContext` |
| `scraper-helpers.ts` | Pure helpers: download-URL/body builders, row merge, field collection |
| `scraper-types.ts` | Shared types: `CapturedRequest`, `ScrapeMessage`, `InterceptedXHR` |
| `page-context.ts` | URL → `ExportSource` mapping (`OUTPUT_TAX`, `INPUT_TAX`, `SPT_A2`, `PPH_21_L1A`, ...), filename-hint extraction from request filters |
| `exporter.ts` | XLSX/CSV generation, `generateDynamicFilename`, `formatDate`, `PREFIX_MAP` |
| `downloader.ts` | Browser download orchestration with custom PDF naming |
| `main-actions.ts` | Scrape/export action handlers + `ContentState` (module singleton; `createContentState()` factory for tests) |
| `comparer.ts`, `comparer-logic.ts`, `ui-comparer.ts` | Paste-and-compare feature vs Coretax data |
| `ui.ts`, `ui-filters.ts`, `ui-badge.ts`, `button-state.ts`, `shortcuts.ts` | In-page DOM injection and UI state |
| `bridge.ts`, `postmessage-guard.ts` | Cross-world messaging + validator (pure, exported for tests) |
| `browser-shim.ts` | Picks `browser`/`chrome` runtime |
| `debug.ts` | Logging; suppressed in production builds unless `enableDebug()` |
| `background.ts` | Minimal MV3 background (install logging) |

`src/background/background.ts` is the only background file. `build.cjs` bundles three entries (`content/main`, `content/scraper`, `background/background`).

## Conventions

Existing code follows these patterns — new code should match them:

- **Testability first:** logic extracted from the world-entry scripts is written as pure functions with browser/DOM dependencies injected through context interfaces (`ActionDeps`, `ScraperContext`, `InterceptContext`, `ContentState`). Add new flows the same way instead of growing `scraper.ts`/`main.ts`.
- **Stateful modules** export a production singleton plus a `createX()` factory so tests use independent instances, never shared module state.
- **Tests** live in `src/tests/` with relative imports (`../content/...`): `*.unit.test.ts` for vitest `describe`/`it`/`expect` suites, `*.property.test.ts` for fast-check property tests, `*.invalid.property.test.ts` for rejection cases. Shared browser mocks live in `src/tests/__mocks__/` (e.g. `xhr-mock.ts`). There is no vitest config — defaults.
- **Strictness:** `tsconfig.json` is `strict`; `eslint.config.js` enforces `@typescript-eslint/recommended` with `no-explicit-any` at warn.
- Section banner comments (`===== NAME =====` / `── ... ──`) mark file and region intent.

## Gotchas

- **Coretax is an Angular SPA** — DOM re-renders constantly. `main.ts` observes mutations and debounces injection (`GRID_FILTER_INJECT_DELAY_MS`) to avoid fighting the framework. Injection logic should respect that pattern.
- **Bridge token is the security boundary.** Never store it on `window`, log it, or weaken `shouldProcessPageMessage`. A forged `DOWNLOAD_PDF_ITEM`/`START_SCRAPE` is exactly what the token prevents.
- **Extension-owned XHRs are flagged** `__isCindiehBulk` (see `ScraperContext.__isCindiehBulk` in `scraper-types.ts`) so the interceptor does not re-capture them and double-fire `DOWNLOAD_PDF_ITEM`. Keep that flag working when adding download paths.
- **Coretax API responses** wrap rows as `{ Payload: { Data: [...] } }`. Parse defensively; the scraper already treats `Payload.Data` as the row array.
- **Dates**: `formatDate` converts ISO strings to Indonesian `DD/MM/YYYY`; it is timezone-aware, and existing tests pin behaviour across `+07/+08/+09/Z` offsets. Do not "simplify" it.
- **Filenames** use per-source prefixes in `PREFIX_MAP` (`FPK-`, `FPM-`, `RET-FPK-`, `A2-`, `B2-`, `PPH21-L1A-`, `BP-`, ...) — exporter specs enumerate all 11 sources.
- **`dist/` is a gitignored build artifact.** Never edit it; the build regenerates it. `build.cjs` rewrites the manifest per browser (Chrome `service_worker`, Firefox scripts + `browser_specific_settings.gecko.data_collection_permissions`), so manifest edits go in the source `manifest.json`.
- **Versioning:** `pnpm version` runs `sync-manifest.cjs` to keep `manifest.json` in sync; releases go through `pnpm release` (standard-version → CHANGELOG.md).

## Validation loop

With `cd` at the repo root:

1. **Typecheck** — run `pnpm typecheck`; criterion: zero TS errors.
2. **Tests** — run `pnpm test`; criterion: the whole vitest suite passes, including new coverage for changed logic.
3. **Lint** — run `pnpm lint`; criterion: no eslint errors (warnings acceptable).
4. **Build** — run `pnpm build:chrome` (and `build:firefox` when the change touches cross-browser or manifest concerns); criterion: `dist/cindieh-<browser>/` completes with the manifest produced. For UI changes, nothing substitutes loading `dist/cindieh-chrome` unpacked against the live portal.