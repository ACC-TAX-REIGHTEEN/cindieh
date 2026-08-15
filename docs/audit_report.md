# Audit Menyeluruh — Cindieh Extension v2.0.0 (2026-08-15)

**Tanggal audit:** 2026-08-15
**Hasil validasi otomatis:** ✅ TypeScript 0 error · ✅ 531/531 test pass (22 file) · ✅ ESLint 0 error · ✅ Build Chrome sukses

**Ruang lingkup:** Seluruh `src/`, `popup/`, `manifest.json`, `docs/`, dan toolchain. Audit mencakup perubahan terbaru yang belum di-commit (isolasi filter No. Faktur ke halaman e-Faktur saja + perbaikan re-injection panel).

---

## Ringkasan Eksekutif

Proyek dalam kondisi **sehat dan jauh lebih baik dari audit sebelumnya**. Seluruh 14 temuan audit lama sudah dituntaskan (detail di bawah): temuan keamanan didokumentasikan sebagai *accepted risk* (ADR-0007), bug potensial diperbaiki, dan gap test ditutup. Tidak ada temuan baru berseverity **High** atau **Medium**. Sisa temuan berkelas **Low/Info** — sebagian besar soal dokumentasi yang usang dan modul DOM-heavy yang belum punya unit test.

Perbedaan besar sejak audit sebelumnya:

- **Keamanan bridge**: paparan token di `postMessage` dan URL script kini terdokumentasi eksplisit sebagai *accepted risk* (ADR-0007) dengan mitigasi yang dijaga; guard `shouldProcessPageMessage` tetap utuh dan diuji property.
- **Anti-zombie interceptor**: injeksi scraper kini one-time per halaman (ADR-0008) — bug lama *stacked interceptors* saat SPA navigate sudah hilang.
- **Toolchain**: TypeScript 7 (native) + alias TypeScript 6 untuk typescript-eslint (ADR-0009); `standard-version` diganti `release-it`.
- **Test**: 499 → 531 kasus. Path retry-exhaustion `scrapeByInvoices` yang tadinya tidak diuji kini lengkap (abort, early-return, backoff, reset counter).

---

## 1. Status Temuan Audit Sebelumnya

| # | Temuan lama | Severity lama | Status |
|---|-------------|---------------|--------|
| 1 | Fetch interceptor tidak cek `__isCindiehBulk` | Medium | ✅ **Diperbaiki** — `isBulkFetchRequest()` guard ada di `scraper.ts`; komentar peringatan mengikuti pola AGENTS.md |
| 2 | `xhrRequestByInvoice` `JSON.parse` tanpa try-catch | Medium | ✅ **Diperbaiki** — try-catch + `parseCapturedBody()` defensif |
| 3 | `getMasaPajakFromDOM` inline regex | Low | ✅ **Diperbaiki** — `extractMasaPajak()` di `tax-date.ts` |
| 4 | Test `scrapeByInvoices` retry exhaustion | Low | ✅ **Ditutup** — 6 kasus baru (abort, early-return, backoff, reset, stop) |
| 5 | Test `ui-filters.ts` tipis | Low | ✅ **Ditutup** — 13 kasus untuk `splitInvoiceNumbers`/`parseMultiInvoiceText` |
| 6 | `bridge.ts` tanpa factory | Low | ✅ **Diperbaiki** — `createBridge(windowRef?)` + singleton; test bebas order-dependency |
| 7 | Upgrade TypeScript | Low | ✅ **Selesai** — TS 7 native (ADR-0009) |
| 8 | Ganti `standard-version` | Low | ✅ **Selesai** — `release-it` + `@release-it/conventional-changelog` |
| 9 | Token di postMessage = accepted risk (ADR baru) | Low | ✅ **Selesai** — ADR-0007 |
| 10 | `createPdfDownloadSession` `setTimeout` global | Quality | ✅ **Diperbaiki** — `setTimeout`/`clearTimeout` injectable via deps |
| 11 | `ui-comparer.ts` `innerHTML = "&times;"` | Quality | ✅ **Diperbaiki** — `textContent = "×"` |
| 12 | `ui.ts` listener `click` tidak di-remove | Quality | ✅ **Diperbaiki** — `outsideClickHandler` dilacak & dilepas di `removeExportButton` |
| 13 | Duplikasi XLSX (`aoa_to_sheet` vs `json_to_sheet`) | Quality | ✅ **Diklarifikasi** — komentar menjelaskan dua path disengaja untuk dua bentuk data |
| 14 | Rate-limit guard `INJECTED_READY` → `START_SCRAPE` | Low | ✅ **Diperbaiki** — `scraperResendArmed` (satu resend per injeksi) |

---

## 2. Keamanan

### [INFO] Paparan token bridge — accepted risk (ADR-0007)

Token tetap dikirim sebagai field plaintext dalam `window.postMessage` dan sempat berada di `?token=` pada `<script src>` saat injeksi. Ini **disengaja dan didokumentasikan** (ADR-0007): MAIN world tidak punya `browser.runtime`, jadi `postMessage` adalah satu-satunya kanal; membacanya butuh skrip MAIN-world yang sudah berjalan, yang saat itu bisa membaca apa pun di halaman. Mitigasi yang masih dijaga:

- Token tidak pernah disimpan di `window`; `scraper.ts` membaca dari elemen `<script>` sendiri lalu langsung `removeAttribute("src")`.
- Guard `shouldProcessPageMessage` (source, origin, direction, token) diuji dengan property test (`postmessage.origin.property.test.ts`, 19 kasus) — **jangan dilemahkan**.
- ADR-0008: elemen script dipertahankan hanya sebagai marker id (tanpa token) → satu instance scraper per halaman, tanpa zombie interceptor.

### [INFO] CSV formula-injection hardening ✅

`escapeCSV` me-prefix `'` pada nilai berawalan `= + - @ tab CR` dan apostrof; ada property test (`csv.property.test.ts`) + unit test. XLSX via SheetJS menulis string sebagai sel bertipe string, bukan formula. Postur baik.

### [INFO] Permintaan minimal — manifest

`host_permissions` dan `web_accessible_resources` dibatasi ke `https://coretaxdjp.pajak.go.id/*`; `use_dynamic_url: true` pada `scraper.js`; permission hanya `activeTab` + `storage`. Tidak ada `unlimitedStorage` atau permission berlebihan. ✅

---

## 3. Kualitas Kode & Temuan Baru

### [LOW] `RATE_LIMITING.md` — referensi baris usang

**File:** [`RATE_LIMITING.md`](RATE_LIMITING.md)

Link `file:///...scraper-actions.ts#L159`, `#L388`, `#L344` sudah tidak akurat setelah refactor (merge `ScraperContext`/`InterceptContext`, `ContentState`, ekstraksi modul). Nilainya sendiri masih cocok dengan kode: bulk PDF `delay(800)`, per-invoice `delay(50)`, `MAX_INVOICE_RETRIES = 2`, `BACKOFF_BASE_MS = 1000`.

**Rekomendasi:** Hapus nomor baris dari link (atau sebut nama fungsi, bukan nomor baris) supaya tidak usang lagi.

### [LOW] Modul DOM-heavy masih minim unit test

- `ui-filters.ts` — helper murni sudah diuji (13 kasus), tapi logika **injection DOM** belum: guard `isEfakturPage`, deteksi setengah-inject (toggle/panel), unregister listener di `removeMultiInvoiceFilter`. Ini logika yang baru ditulis dan paling rentan regresi.
- `ui-badge.ts` — hanya 3 smoke test (`ui.badge.unit.test.ts`).
- `ui.ts`, `ui-comparer.ts` — tanpa unit test (DOM-heavy, di-cover sebagian lewat `comparer-logic`).

**Rekomendasi:** Minimal, tambah test untuk logika *re-injection* `injectMultiInvoiceFilter` (DOM stub minimal seperti pola `triggerSearch` di `main-actions.unit.test.ts`). Tidak menuntut test penuh untuk `ui.ts`/`ui-comparer.ts`.

### [INFO] `main.ts` — branch keyup `ch-multi-invoice-textarea` mati di halaman non-e-Faktur

**File:** [`main.ts:241`](src/content/main.ts)

Handler masih memproses `target.id === "ch-multi-invoice-textarea"` di semua halaman. Aman (elemen hanya ada di halaman e-Faktur), hanya sisa kode yang tidak pernah aktif di halaman Withholding Slips. Tidak perlu diubah kecuali mau dirapikan.

### [INFO] Logika baru filter No. Faktur (efaktur-only) — direview

Perubahan terbaru (belum di-commit): `injectMultiInvoiceFilter` kini dibatasi ke halaman e-Faktur via `isEfakturPage()` dan melakukan *re-injection bersih* jika salah satu bagian (toggle/panel) hilang karena re-render Angular; `removeMultiInvoiceFilter()` melepas listener `click`/`scroll`/`resize` yang dilacak modul-level; guard paralel di `main-actions.ts` (`applyMultiInvoiceFilter` + jalur `SCRAPE_BY_INVOICES`) mencegah nomor faktur basi bocor ke halaman lain. Konsisten dengan pola DI `ActionDeps`. Tidak ada masalah ditemukan; satu-satunya catatan adalah belum ada unit test untuk logika DOM-nya (lihat temuan di atas).

---

## 4. Arsitektur

### Status ADR

| ADR | Judul | Status |
|-----|-------|--------|
| 0001 | PDF Download Emission Module | ✅ Implemented |
| 0002 | Message Dispatch Seam | ✅ Implemented |
| 0003 | Comparer Session | ✅ Implemented |
| 0004 | Export Tree & Tax Date | ✅ Implemented |
| 0005 | Deferred Refactors (dua context interface) | ✅ Semua selesai |
| 0006 | Comparer Reference Matching | ✅ Implemented |
| 0007 | Bridge Token Exposure — accepted risk | ✅ Accepted |
| 0008 | Scraper Injection One-Time per Page | ✅ Accepted |
| 0009 | TypeScript 7 native + TS 6 alias | ✅ Accepted |

### Kepatuhan Two-Worlds Architecture

| Aspek | Status | Catatan |
|-------|--------|---------|
| Bridge token tidak di-`window` | ✅ | ADR-0007, ADR-0008 |
| Guard sebelum dispatch | ✅ | `createMessageDispatcher` tunggal per world; property-tested |
| `__isCindiehBulk` flag | ✅ | XHR **dan** fetch (`isBulkFetchRequest`) |
| Isolated world: hanya relay + UI | ✅ | `main.ts` tidak scrape |
| MAIN world: tanpa browser API | ✅ | `scraper.ts` tidak import `browser.*` |
| SPA nav reset | ✅ | `RESET_SCRAPER` + `resetContentState` |
| Injeksi idempotent | ✅ | `getElementById` guard + ADR-0008 |
| Stateful modul: singleton + factory | ✅ | `bridge`, `contentState`, `createPdfDownloadSession`, `ScraperContext`/`ActionDeps` |
| Timer injectable untuk test | ✅ | `PdfDownloadSessionDeps.setTimeout`, `ScraperContext.setTimeout`, `triggerSearch(scheduleDelay)` |

---

## 5. Test Coverage

| Modul | File test | Kasus | Penilaian |
|-------|-----------|-------|-----------|
| `bridge.ts` | `bridge.unit.test.ts` | 7 | ✅ Factory + isolasi instance |
| `comparer-logic.ts` | `comparer-logic.unit.test.ts` | 61 | ✅ Komprehensif |
| `comparer.ts` | `comparer.unit.test.ts` | 39 | ✅ Komprehensif |
| `csv.property.test.ts` | — | 8 | ✅ Property: escaping & formula-injection |
| `downloader.ts` | `downloader.unit/property/invalid.property` | 31 | ✅ Termasuk base64 invalid & naming |
| `exporter.ts` | `exporter.unit/processdata/property` | 82 | ✅ Sangat lengkap |
| `main-actions.ts` | `main-actions.unit.test.ts` | 46 | ✅ Termasuk guard e-Faktur baru |
| `page-context.ts` | `page-context.unit.test.ts` | 56 | ✅ Termasuk `isEfakturPage` baru |
| `postmessage-guard.ts` | `postmessage.origin.property.test.ts` | 19 | ✅ Property test guard keamanan |
| `scraper-actions.ts` | `scraper-actions.unit.test.ts` | 16 | ✅ Termasuk retry-exhaustion `scrapeByInvoices` |
| `scraper-helpers.ts` | `scraper-helpers.unit.test.ts` | 24 | ✅ Lengkap |
| `scraper-intercept.ts` | `scraper-intercept.unit.test.ts` | 24 | ✅ Termasuk cache validity |
| `scraper-pdf.ts` | `scraper-pdf.unit.test.ts` | 29 | ✅ Termasuk session + pure core |
| `scraper-xhr.ts` | `scraper-xhr.unit.test.ts` + `scraper-xhr-download.unit.test.ts` | 48 | ✅ Termasuk parse defensif & 4 source PDF |
| `tax-date.ts` | `tax-date.unit.test.ts` | 25 | ✅ Timezone-aware |
| `ui-filters.ts` | `ui-filters.unit.test.ts` | 13 | ⚠️ Helper murni ✅; logika DOM belum |
| `ui-badge.ts` | `ui.badge.unit.test.ts` | 3 | ⚠️ Sangat tipis |
| `ui.ts`, `ui-comparer.ts` | — | 0 | ❌ DOM-heavy; acceptable tapi catat gap |
| `scraper.ts`, `main.ts` | — | 0 | ❌ World-entry, tidak bisa unit-test (by design) |

**Total:** 22 file, 531 kasus, semuanya hijau.

---

## 6. Dependensi

| Package | Versi | Catatan |
|---------|-------|---------|
| `xlsx` | 0.20.3 | Custom CDN (SheetJS) — pinned, aman |
| `@typescript/native` | ^7.0.2 | Compiler Go-native (ADR-0009) |
| `typescript` (alias) | npm:@typescript/typescript6@^6.0.2 | API compiler untuk typescript-eslint |
| `vitest` | ^4.1.5 | Mutakhir ✅ |
| `esbuild` | ^0.25.12 | Mutakhir ✅ |
| `eslint` | ^10.3.0 | Mutakhir ✅ |
| `fast-check` | ^4.7.0 | Mutakhir ✅ |
| `release-it` | ^21.0.2 | Pengganti `standard-version` ✅ |

Tidak ada dependensi runtime selain `xlsx`. Semua devDependencies relevan dan terpakai.

---

## 7. Verifikasi Build & Toolchain

| Langkah | Hasil |
|---------|-------|
| `pnpm typecheck` (`tsc --noEmit`, TS 7 native) | ✅ 0 error |
| `pnpm test` (vitest, 22 file) | ✅ 531/531 |
| `pnpm lint` (eslint + typescript-eslint) | ✅ 0 error |
| `pnpm build:chrome` | ✅ Build + manifest + assets lengkap |

`popup.js` adalah artefak build dari `src/popup/popup.ts` (lihat `build.cjs`), bukan file sumber — jangan diedit langsung. `dist/` di-gitignore, di-regenerasi build.

---

## Prioritas Rekomendasi

| # | Temuan | Severity | Effort |
|---|--------|----------|--------|
| 1 | Test logika DOM `ui-filters.ts` (re-injection & cleanup) | Low | Medium |
| 2 | Rapikan `RATE_LIMITING.md` (hapus nomor baris) | Low | Trivial |
| 3 | Test `ui-badge.ts` diperluas dari 3 smoke test | Low | Low |
| 4 | (Opsional) Hapus branch keyup `ch-multi-invoice-textarea` yang mati di `main.ts` | Info | Trivial |

**Kesimpulan:** Tidak ada blocker. Proyek siap untuk iterasi berikutnya; rekomendasi fokus ke menutup gap test untuk logika DOM yang baru ditulis.
