# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [2.0.0](https://github.com/allababbot/cindieh/compare/v1.3.0...v2.0.0) (2026-08-06)


### Features

* **comparer:** add invoice comparator panel with paste-from-excel workflow ([ui-comparer](https://github.com/allababbot/cindieh/commit/ui-comparer))
* **comparer:** support 3-column and 4-column (Ref Lain) paste modes
* **comparer:** add daily mode to detect coretax-only rows by date range
* **comparer:** add status filter dropdown, tolerance input, and XLSX export
* **comparer:** double-click row to close panel and trigger reference search in coretax grid
* **comparer:** auto-scrape when no data is available before comparison
* rename project from better-coretax to cindieh


### Features

* add SPA navigation state reset and fetch interceptor PDF metadata resolution ([e360d42](https://github.com/allababbot/cindieh/commit/e360d425dc807fac0ae94aba84ebd81ffeaa9c2c))

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
