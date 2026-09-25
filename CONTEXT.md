# Cindieh

The domain of the Cindieh extension: bulk capture, export, comparison, and accuracy checking of tax data inside the Indonesian DJP Coretax portal, built as two JavaScript worlds (isolated + MAIN) that talk only over a token-validated message channel.

## Language

### Portal & tax data

**Coretax**:
The Indonesian DJP tax portal (`coretaxdjp.pajak.go.id`) the extension operates on.
_Avoid_: the portal, DJP Coretax

**Wajib Pajak**:
The taxpayer who uses the portal in their own browser session; the extension's only user. It never acts without an active taxpayer login.
_Avoid_: user, account

**Grid**:
The Coretax data table that renders the current filter result. The unit that gets scraped, filtered, searched, and exported.
_Avoid_: table, datagrid, grid data

**Masa pajak**:
The tax period — a year plus month (e.g. `2026-07`) — that filters grids, seeds filenames, and splits into year/month columns on export. Surfaced as a filter and as the "tax domain period" string in requests.
_Avoid_: period, masa, tax period

**E-faktur**:
Electronic tax invoice. Covers the four e-invoice portal grids: PPN Keluaran, PPN Masukan, and their retur.
_Avoid_: e-invoice, invoice (when you mean a specific kind)

**PPN Keluaran**:
Output VAT — the seller's e-faktur grid. The extension's reference search and comparer operate here.
_Avoid_: output tax, output invoice (code constant: `OUTPUT_TAX`)

**PPN Masukan**:
Input VAT — the buyer's e-faktur grid.
_Avoid_: input tax (code constant: `INPUT_TAX`)

**Retur PPN Keluaran** / **Retur PPN Masukan**:
Credit-note grids for output/input e-faktur.
_Avoid_: output return, input return (code constants: `OUTPUT_RETURN`, `INPUT_RETURN`)

**SPT**:
Tax return. The SPT portal (`returnsheets-portal`) hosts the PPN sheets — Lampiran A2 (PPN Keluaran) and Lampiran B2 (PPN Masukan) — and the Article 21/26 sheets — Lampiran L1A, L1B, L2, L3 (grids `rshshr-art2126-l1a/l1b/l2/l3-grid`).
_Avoid_: return, tax return form (code constants: `SPT_A2`, `SPT_B2`, `PPH_21_L1A`, `PPH_21_L1B`, `PPH_21_L2`, `PPH_21_L3`)

**Bukti Potong**:
Withholding slip (PPh 21) — the portal's withholding-slips grid and its bulk PDFs.
_Avoid_: withholding slip document (code constant: `WITHHOLDING_SLIPS`)

**Referensi**:
The internal reference number on an e-faktur (e.g. `SZ-0447/07/26`) that identifies a row and matches internal records against Coretax. Also usable in the secondary form **Referensi Lain** (Ref Lain).
_Avoid_: reference number, ref

### Extension features

**Scrape**:
Capturing all rows of a grid by replaying the portal's own grid request page by page, with rate-limited pacing, until every filtered row is collected.
_Avoid_: capture data, crawl, fetch data

**Export**:
Generating an Excel (`.xlsx`) or CSV file from scraped rows.
_Avoid_: download data, export file

**Export source**:
Which Coretax page/grid a scrape or export came from — determines the column mapping and the filename prefix (`FPK-`, `FPM-`, `RET-FPK-`, `A2-`, `B2-`, `PPH21-L1A-`, `BP-`, …).
_Avoid_: source type, page type

**Export mode**:
How export shapes the data: **raw** keeps the portal's columns (only dates reformatted); **cleaned** maps fields to stable Indonesian labels and splits masa pajak into month/year columns.
_Avoid_: format mode, output style

**Filename hint**:
The fragment extracted from a grid request's filters (masa pajak, year) that seeds export and PDF filenames.
_Avoid_: filename, name hint

**PDF download**:
Getting a PDF (e-faktur or bukti potong) out of Coretax into the browser under extension-owned naming. Comes in two modes that differ only in where the PDF request originates and where the invoice metadata comes from.
_Avoid_: bulk PDF, PDF export

**Native download**:
The portal's own single-PDF download button, which the extension intercepts, renames, and suppresses the duplicate native file for. The download response carries only the PDF binary, so the invoice metadata must be recovered from the grid capture — never from the download itself.
_Avoid_: portal download, one-click download

**Bulk download**:
The extension firing the download requests itself for a set of grid rows (e-faktur or bukti potong). It already holds each row, so naming uses that row's data directly; it never re-resolves metadata from the grid capture.
_Avoid_: bulk PDF, batch download

**No. Faktur filter**:
The efaktur-only filter (toolbar toggle "No. Faktur" on the four e-invoice grids) that takes a list of invoice numbers — one per line, or comma/semicolon separated — and restricts which rows get PDF downloads, or which invoice numbers get a targeted scrape for XLSX/CSV export. Not available on withholding-slips or SPT pages.
_Avoid_: invoice filter, multi-invoice filter

**Pending export**:
An export (or comparison) the user requested before any data existed; it is fulfilled automatically when a scrape completes.
_Avoid_: queued export, deferred export

### Comparer

**Comparer**:
The paste-and-compare feature: internal invoice records pasted from Excel are matched against scraped PPN Keluaran rows.
_Avoid_: comparator, comparison tool

**Internal records**:
The Wajib Pajak's own invoice rows, pasted as tab-separated text (Referensi, DPP, PPN — optionally with Referensi Lain).
_Avoid_: pasted data, source data, Excel data

**Comparison status**:
The verdict per matched row: **Cocok**, **DPP Berbeda**, **PPN Berbeda**, **Berbeda**, **Tidak Ditemukan**, **Hanya di Coretax**.
_Avoid_: match state, result type

**Tolerance**:
The allowed amount difference (in rupiah) below which DPP/PPN still count as Cocok, to absorb rounding.
_Avoid_: tolerance value, delta

**Daily mode**:
A reverse check: only Coretax invoices dated on the given days of month (1–31) are candidates for "Hanya di Coretax", so internal records are only compared against the days the Wajib Pajak actually recorded.
_Avoid_: day filter, daily date mode

**Pengecekan (Checker)**:
The value-accuracy tab of the panel (next to the Comparer): every scraped PPN Keluaran row's DPP, DPP Nilai Lain, and PPN are tested against the chosen **Acuan**; only rows that differ or carry incomplete data are ever listed.
_Avoid_: accuracy check, validation, audit

**Acuan (Benchmark)**:
The value a checker run treats as ground truth — **DPP**, **DPP NL**, or **PPN** (`BenchmarkType`) — which decides both the two derived values and the two columns compared.
_Avoid_: reference, baseline

### Architecture

**Scraper**:
The MAIN-world module that intercepts the portal's grid and download requests, replays grid requests for scraping, and resolves invoice rows for PDF naming. It has no browser API of its own.
_Avoid_: injector, agent

**Isolated world** / **MAIN world**:
The two JavaScript worlds the extension runs in — the content script (isolated, has `browser.runtime`, owns the UI) and the page-context scraper (MAIN, sits beside the portal's own code). They communicate only via the bridge.
_Avoid_: content script side, page side

**Bridge token**:
The random value generated in the isolated world and passed to the scraper through the script URL. Every cross-world message must carry it to correlate messages with the bridge. MAIN-world scripts can observe it through the shared DOM and postMessage traffic, so it is not secret authentication against hostile same-page scripts. Source/origin checks bind the window and origin, not the JavaScript world; direction is a protocol field, not proof of sender identity. The two-worlds seam and token validation remain required with these accepted limitations (ADR-0007).
_Avoid_: secret, token, security key

**Grid request**:
The portal's own list request (URL + body with filters and paging) that the scraper captures once and replays with advancing `First`/`Rows` to scrape a grid.
_Avoid_: request template, captured request
