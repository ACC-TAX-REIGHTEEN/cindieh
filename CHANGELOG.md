# Changelog

## [2.1.0](https://github.com/allababbot/cindieh/compare/v2.0.0...v2.1.0) (2026-09-25)

### Features

* **checker:** add DPP/PPN accuracy validation logic and UI ([9247efb](https://github.com/allababbot/cindieh/commit/9247efb2e7d65f543b33129ec974df9fe3489ab0))
* **content:** stop reference search on empty prefix instead of widening to contains ([d1d5c2a](https://github.com/allababbot/cindieh/commit/d1d5c2a588b76b65bdecbab8b9186b99634dcaac))
* **debug:** make production logging opt-in from every extension context ([cf49d93](https://github.com/allababbot/cindieh/commit/cf49d9315ac792de987d072c887562152b4c6c36))
* **exporter:** add support for Coretax tax domain period format ([22a142a](https://github.com/allababbot/cindieh/commit/22a142ab288226e3fa6aad3dd62e4af309c69b17))
* **exporter:** refactor tax data processing with explicit field mapping ([4ea87dc](https://github.com/allababbot/cindieh/commit/4ea87dc5f07e6b3183607418198e4357d0cd1c2a))
* **popup:** add extension popup UI with export mode selection ([eb16e1d](https://github.com/allababbot/cindieh/commit/eb16e1d88f2e6d657dae6c80129e0cfda6766314))
* **popup:** add full preferences panel — master switch, pacing preset, notifications ([fce940c](https://github.com/allababbot/cindieh/commit/fce940cb3786939b369193772ac432b3ec752ef3))
* **popup:** fold settings sections so the popup fits without scrolling ([92d7161](https://github.com/allababbot/cindieh/commit/92d7161ef3cdbbc7ea43976c78a621412e66a3d6))
* **ui:** refactor floating panel with pill badge and animation wrapper ([6adda2d](https://github.com/allababbot/cindieh/commit/6adda2d8f1576f203c1f27ab462ab58c19f98db2))
* **ui:** shorten "DPP Nilai Lain" terminology and enhance row interaction UX ([4b65e01](https://github.com/allababbot/cindieh/commit/4b65e01579c182aa6a614612ec78e9257209d269))

### Bug Fixes

* **content:** implement seven audit findings for scrape isolation and result integrity ([0252919](https://github.com/allababbot/cindieh/commit/0252919f5ba5872176117b048ad6c8a65f0ddc62))
* **content:** make reference search fast by matching prefixes first ([aced420](https://github.com/allababbot/cindieh/commit/aced420019298085e8dec9d709a2a8ec59c5e50e))
* **content:** report when the bulk PDF flow does not start ([2f2ce64](https://github.com/allababbot/cindieh/commit/2f2ce64f8a2ad55d7ba36ba62cc2d77602627c77))
* **downloader:** add generic PDF filename fallback for unhandled sources ([2c56615](https://github.com/allababbot/cindieh/commit/2c5661592f4d9390b75e4089fd5596445b332ec6))
* **exporter:** make dynamic filename date fallbacks timezone-safe ([7162677](https://github.com/allababbot/cindieh/commit/716267760fd554c23e916a12741579639f2aa6e3))
* **messaging:** evaluate bridge token dynamically in postmessage dispatcher ([0aa6f38](https://github.com/allababbot/cindieh/commit/0aa6f3866a97fcb0fc15716d7139734630490dee))
* **scraper:** explicitly validate filter value in SET_SERVER_FILTER handler ([619d3fa](https://github.com/allababbot/cindieh/commit/619d3fa8dad19ad603395f911eba37acc795f86a))
* **scraper:** return empty string instead of javascript:void(0) in createObjectURL override ([fb4adf7](https://github.com/allababbot/cindieh/commit/fb4adf7e4bde73097fe4c8e4967b6f3c77c18dff))
* **security:** enforce non-empty token requirement in postmessage guard ([c8e6c52](https://github.com/allababbot/cindieh/commit/c8e6c527d592acb496eeaed66e3ec09fdb895a78))
* **security:** remove injected script element from DOM after token reading ([5f808c0](https://github.com/allababbot/cindieh/commit/5f808c044fb0fc71d68282d21a163d83afeec0ce))
* **security:** sanitize CSV formula injection characters in exporter (CWE-1236) ([92a9333](https://github.com/allababbot/cindieh/commit/92a933303b4b7ff432bd4dbb77c86ed2c435d048))
* **security:** use CSPRNG crypto.getRandomValues fallback in bridge token generation ([4630dd5](https://github.com/allababbot/cindieh/commit/4630dd55d36bd6985f8c6dc983f6954545799f5a))
* **ui-badge:** drop the stale stats reference when the badge is destroyed ([e8adc9e](https://github.com/allababbot/cindieh/commit/e8adc9eb11c8c3238f6ba295d0b58d1823fa40dd))
* **ui-badge:** replace un-guarded console.log with debugLog ([5d309ef](https://github.com/allababbot/cindieh/commit/5d309efabfb0726940ab58a8f5828a44cd3c634e))
* **ui-comparer:** export comparison results as XLSX instead of CSV ([56d0877](https://github.com/allababbot/cindieh/commit/56d0877ee0b50b76ce9b0f1051906843689384fc))

All notable changes to this project will be documented in this file, generated with release-it + conventional commits.

## [2.0.0](https://github.com/allababbot/cindieh/compare/v1.3.0...v2.0.0) (2026-08-06)


### Features

* **comparer:** add invoice comparator panel with paste-from-excel workflow ([d3e273a](https://github.com/allababbot/cindieh/commit/d3e273a))
* **comparer:** support 3-column and 4-column (Ref Lain) paste modes
* **comparer:** add daily mode to detect coretax-only rows by date range
* **comparer:** add status filter dropdown, tolerance input, and XLSX export
* **comparer:** double-click row to close panel and trigger reference search in coretax grid
* **comparer:** auto-scrape when no data is available before comparison
* rename project from better-coretax to cindieh

## [1.2.0](https://github.com/allababbot/cindieh/compare/v1.1.1...v1.2.0) (2026-07-24)


### Features

* add SPA navigation state reset and fetch interceptor PDF metadata resolution ([e360d42](https://github.com/allababbot/cindieh/commit/e360d425dc807fac0ae94aba84ebd81ffeaa9c2c))

### [1.1.1](https://github.com/allababbot/cindieh/compare/v1.1.0...v1.1.1) (2026-06-04)


### Bug Fixes

* **content:** format imports and fix export format variable assignment ([dc82a9f](https://github.com/allababbot/cindieh/commit/dc82a9f8b5de4ee2ce246bfb3b2a0181dab48109))

## 1.1.0 (2026-06-04)


### Features

* add better export for input and return pages ([20f896b](https://github.com/allababbot/cindieh/commit/20f896b00ec13c7db2fad6b3d2a8475209619102))
* add comprehensive test suite, ESLint config, and modular architecture improvements ([601b9f6](https://github.com/allababbot/cindieh/commit/601b9f6e13df17f34f325108234f9a4bb8c53a04))
* add download PDF in efaktur page ([591f859](https://github.com/allababbot/cindieh/commit/591f859c5387f2fbf69aaf87b93b61ed8b6d098d))
* add export support for PPh 21/26 and improve filename detection from header ([039a867](https://github.com/allababbot/cindieh/commit/039a867c2fb51598ca1e4134ff9252fb7ad1d060))
* auto-start scraping when clicking export button ([ca414ad](https://github.com/allababbot/cindieh/commit/ca414ad7d7cdcdc4d9c389f949466c81247b5c5c))
* **content:** add auto-export on scrape completion ([6322123](https://github.com/allababbot/cindieh/commit/632212304513c7c30ec9fa88de9fc8a07f7845ae))
* **content:** add multi-invoice filter for targeted PDF export ([be34a63](https://github.com/allababbot/cindieh/commit/be34a6316c8b66526d024fe5db21a2470f68b67f))
* implement browser-specific build system for Chrome and Firefox ([cf32328](https://github.com/allababbot/cindieh/commit/cf32328546143fab975f368e5cea27e1d8fdcdd9))
* implement bulk PDF download for withholding slips portal ([36d11e9](https://github.com/allababbot/cindieh/commit/36d11e9e46e64e098a8249e71c61a18fc48f7897))
* integrate A2 and B2 export functionality with speed optimizations ([23ee5f6](https://github.com/allababbot/cindieh/commit/23ee5f69a5f1a9d1de872663af9acd097a3ab138))


### Bug Fixes

* add mandatory 'required' property to Firefox data_collection_permissions ([5cc77ec](https://github.com/allababbot/cindieh/commit/5cc77ec9920b0a3a12c5c05eaa9645291ec820bc))
* address Firefox submission issues by adding data_collection_permissions and removing innerHTML ([12afb92](https://github.com/allababbot/cindieh/commit/12afb9203e5fb89a3ce9efab522a6888e1da8677))
* corrected icon dimensions and updated Gecko ID for Mozilla submission ([1d9eeed](https://github.com/allababbot/cindieh/commit/1d9eeed906c2a413a9f9200178a22786588b8223))
* correctly format data_collection_permissions as arrays for Firefox ([c831de5](https://github.com/allababbot/cindieh/commit/c831de5c2c616ed49c26e03d8fd7ed13c52da33e))
* ensure Firefox data_collection_permissions are added even if settings already exist ([4d4384a](https://github.com/allababbot/cindieh/commit/4d4384a25b6cc3924abf83a1f6e1f0622bc920d5))
* **filter:** correct date boundary handling for inclusive range filtering ([f2ad215](https://github.com/allababbot/cindieh/commit/f2ad21576463c5642a1f6d04afb4b616bd29df6b))
* remove redundant floating badge from scraper.ts ([e555f89](https://github.com/allababbot/cindieh/commit/e555f89b729d1e6df43fa468a264995719abb36e))
* remove redundant old badge during injection ([0776f6d](https://github.com/allababbot/cindieh/commit/0776f6dbf9133a07ad8146725b9db80608570e3b))
* resolve 'currentPageSource' not found error in scraper.ts ([a6472be](https://github.com/allababbot/cindieh/commit/a6472be92c231c73d7c7b9467e3cf593389553c4))
* resolve page freeze bug and implement custom PDF naming for Output Tax with double download prevention ([55e29b0](https://github.com/allababbot/cindieh/commit/55e29b0b62bdf58a4cc4acfdfcb47b89b220ef79))
