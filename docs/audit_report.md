# Audit Menyeluruh — Cindieh Extension v2.0.0

**Tanggal audit:** 2026-08-15  
**Hasil validasi otomatis:** ✅ TypeScript 0 error · ✅ 499/499 test pass · ✅ ESLint 0 error

---

## Ringkasan Eksekutif

Proyek dalam kondisi **baik secara keseluruhan**: semua toolchain hijau, arsitektur dua-dunia (isolated ↔ MAIN) terimplementasi konsisten, dan cakupan tes sangat luas (22 file, 499 kasus). Namun ditemukan beberapa temuan yang perlu ditangani — dua di antaranya terkait keamanan dan satu potensi bug.

---

## 1. Keamanan

### [HIGH] Token bridge bisa terbaca oleh skrip MAIN-world lain

**File:** [`bridge.ts:51-54`](file:///D:/PROGRAMMING/cindieh/extension/src/content/bridge.ts#L50-L55), [`scraper.ts:217-221`](file:///D:/PROGRAMMING/cindieh/extension/src/content/scraper.ts#L216-L222)

```ts
// bridge.ts — postToScraper
window.postMessage({ ...msg, direction: "FROM_CONTENT", token: bridgeToken }, window.location.origin);
```

Token dikirim sebagai field plaintext dalam payload `window.postMessage`. Karena `window.addEventListener("message", ...)` dapat dipasang oleh **semua** skrip MAIN-world (termasuk skrip Angular Coretax itu sendiri, ekstensi lain, atau skrip injeksi), token bisa dibaca dari event `data.token`.

**Dampak nyata:** Sangat terbatas. Penyerang harus sudah ada di MAIN-world (artinya sudah berhasil inject skrip ke halaman). Namun jika ini terjadi, token bisa digunakan untuk forge `START_SCRAPE` atau `DOWNLOAD_PDF_ITEM`.

**Mitigasi yang ada:** Token di-validasi per-pesan, tidak di-store di `window`, dan script tag dihapus setelah load. Risiko residual tetap ada tapi **acceptable** mengingat threat model ekstensi browser.

**Rekomendasi:** Catat ini sebagai known accepted risk di ADR baru; tidak ada fix arsitektural tanpa mengganti postMessage dengan `chrome.runtime.sendMessage` (yang tidak tersedia di MAIN world).

---

### [MEDIUM] Token dalam URL saat injeksi scraper

**File:** [`main.ts:98`](file:///D:/PROGRAMMING/cindieh/extension/src/content/main.ts#L98)

```ts
script.src = `${browserAPI.runtime.getURL("content/scraper.js")}?token=${encodeURIComponent(token)}`;
```

Selama rentang waktu antara `appendChild` dan saat `scraper.ts` menghapus `src`/`id` (baris 54-56 `scraper.ts`), token terekspos di atribut `src` elemen `<script>`. Skrip MAIN-world yang sudah aktif dan memantau mutasi DOM bisa membacanya.

**Mitigasi yang ada:** `scraper.ts` langsung `removeAttribute("src")` dan `remove()` saat pertama berjalan. Jendela paparan sangat singkat.

**Rekomendasi:** Akui sebagai accepted risk; tidak ada cara lain untuk pass token ke MAIN world yang sudah terdokumentasi dalam arsitektur.

---

### [LOW] Tidak ada rate-limit guard di sisi isolated world

**File:** [`main.ts`](file:///D:/PROGRAMMING/cindieh/extension/src/content/main.ts) — handler `START_PDF_DOWNLOAD` tidak membatasi berapa kali scraper bisa dipanggil ulang jika `INJECTED_READY` diterima berkali-kali.

Jika scraper di-inject ulang (SPA navigate back-and-forth cepat), ada potensi race antara dua instance scraper mengirim `INJECTED_READY`. Saat ini `injectScraper()` memang sudah guard via `getElementById`, tapi ini patut diperhatikan.

---

## 2. Kualitas Kode & Bug Potensial

### [BUG — MEDIUM] Fetch interceptor tidak menghormati flag `__isCindiehBulk`

**File:** [`scraper.ts:333-369`](file:///D:/PROGRAMMING/cindieh/extension/src/content/scraper.ts#L333-L369)

```ts
// XHR send() — sudah ada guard:
if (...!(this as InterceptedXHR & { __isCindiehBulk?: boolean }).__isCindiehBulk) { ... }

// TAPI fetch interceptor TIDAK ada guard serupa:
window.fetch = async function (...args: unknown[]) {
  if (url?.includes("DownloadInvoice/download-invoice-document")) {
    pdfSession.beginProcessing();  // ← langsung diproses, tidak cek apakah ini bulk-fetch
```

AGENTS.md eksplisit menyebut: *"Keep that flag working when adding download paths."* Saat ini `xhrDownloadEfakturPdf` dan `xhrDownloadWithholdingPdf` menggunakan XHR (bukan fetch), jadi belum terdampak. Namun jika ada refactor ke fetch di masa depan, ini akan menyebabkan double-emit `DOWNLOAD_PDF_ITEM`.

**Rekomendasi:** Tambahkan komentar peringatan di fetch interceptor bahwa jika bulk-download path pindah ke fetch, flag harus dicek.

---

### [BUG — MINOR] `getMasaPajakFromDOM` menggunakan inline regex untuk date parsing

**File:** [`scraper.ts:265`](file:///D:/PROGRAMMING/cindieh/extension/src/content/scraper.ts#L265)

```ts
const match = text.match(/(\d{2}[-/]\d{4})/);
```

AGENTS.md melarang hand-rolling date regex: *"put new date/period parsing there instead of hand-rolling regexes"* (merujuk ke `tax-date.ts`). Format `MM/YYYY` atau `MM-YYYY` belum ada parser di `tax-date.ts`, jadi ini adalah gap kecil — tapi melanggar konvensi proyek.

**Rekomendasi:** Tambahkan `extractMasaPajak(text: string): string` ke `tax-date.ts` dan panggil dari `getMasaPajakFromDOM`.

---

### [QUALITY] `bridge.ts` tidak menyediakan factory untuk test isolation

**File:** [`bridge.ts`](file:///D:/PROGRAMMING/cindieh/extension/src/content/bridge.ts)

```ts
let bridgeToken = "";  // module-level shared state
export function setBridgeToken(t: string): void { bridgeToken = t; }
export function generateBridgeToken(): string { bridgeToken = generateToken(); return bridgeToken; }
```

AGENTS.md: *"Stateful modules export a production singleton plus a `createX()` factory so tests use independent instances."* `bridge.ts` tidak memiliki factory — `bridge.unit.test.ts` sudah ada tapi menggunakan module state langsung. Ini menyebabkan test order-dependency jika test dijalankan dalam batch tanpa reset.

**Rekomendasi:** Tambahkan `createBridge()` yang mengembalikan `{ setBridgeToken, getBridgeToken, generateBridgeToken, postToScraper }` object, dan buat singleton dari factory tersebut.

---

### [QUALITY] `createPdfDownloadSession` menggunakan `setTimeout` global tanpa injeksi

**File:** [`scraper-pdf.ts:155`](file:///D:/PROGRAMMING/cindieh/extension/src/content/scraper-pdf.ts#L154-L158)

```ts
resetTimer = setTimeout(() => {   // ← global setTimeout, tidak bisa di-stub tests
  if (processing) processing = false;
  resetTimer = null;
}, PROCESSING_RESET_TIMEOUT_MS);
```

`PdfDownloadSessionDeps` tidak menyertakan `setTimeout`/`clearTimeout`. Tests di `scraper-pdf.unit.test.ts` sudah menggunakan `vi.useFakeTimers()` untuk workaround ini, tapi dependency injection yang proper lebih rapi.

---

### [QUALITY] `xhrRequestByInvoice` melakukan `JSON.parse` tanpa try-catch

**File:** [`scraper-xhr.ts:72`](file:///D:/PROGRAMMING/cindieh/extension/src/content/scraper-xhr.ts#L72)

```ts
const fk = "Filters" in JSON.parse(captured.rawBody) ? "Filters" : "filters";
```

Jika `captured.rawBody` kosong atau bukan valid JSON, ini akan throw dan menyebabkan seluruh `scrapeByInvoices` gagal tanpa error message yang informatif. `makeXhrRequest` sudah ada try-catch di `onload`, tapi baris ini ada **sebelum** XHR dibuat.

**Rekomendasi:** Wrap dengan try-catch, fallback ke `"Filters"`.

---

### [QUALITY] `exporter.ts` duplikasi logika di `exportXLSX` vs `downloadXLSXFile`

**File:** [`exporter.ts:60-75`](file:///D:/PROGRAMMING/cindieh/extension/src/content/exporter.ts#L60-L75) dan [`exporter.ts:454-464`](file:///D:/PROGRAMMING/cindieh/extension/src/content/exporter.ts#L454-L464)

Ada dua cara buat XLSX — `downloadXLSXFile` (via `aoa_to_sheet`) dan `exportXLSX` (via `json_to_sheet`). Ini sengaja berbeda (AOA vs JSON), tapi bisa membingungkan. Tidak ada bug, hanya perlu komentar kenapa dua path ini ada.

---

## 3. Arsitektur

### Status ADR

| ADR | Judul | Status |
|-----|-------|--------|
| 0001 | PDF Download Emission Module | ✅ Implemented |
| 0002 | Message Dispatch Seam | ✅ Implemented |
| 0003 | Comparer Session | ✅ Implemented |
| 0004 | Export Tree & Tax Date | ✅ Implemented |
| 0005 | Deferred Refactors | ✅ All 3 completed |
| 0006 | Comparer Reference Matching | ✅ Implemented |

Semua ADR sudah diimplementasikan sesuai keputusan.

---

### Kepatuhan Two-Worlds Architecture

| Aspek | Status | Catatan |
|-------|--------|---------|
| Bridge token | ✅ | Token tidak di-store di `window` |
| Guard sebelum dispatch | ✅ | `shouldProcessPageMessage` + `createMessageDispatcher` dipakai keduanya |
| `__isCindiehBulk` flag | ⚠️ | XHR ✅, Fetch ❌ (belum terdampak tapi belum di-guard) |
| Isolated world: hanya relays, tidak scrape | ✅ | `main.ts` bersih |
| MAIN world: tidak ada browser API | ✅ | `scraper.ts` tidak import `browser.*` |
| SPA nav reset | ✅ | `RESET_SCRAPER` dikirim on navigate |
| Injection guard (idempotent) | ✅ | `getElementById` check |

---

### Modul yang tidak mengikuti pola DI

| Modul | Masalah |
|-------|---------|
| `bridge.ts` | Module-level state, tidak ada factory |
| `scraper-pdf.ts` | `setTimeout` langsung ke global |
| `scraper.ts:265` | Inline date regex |
| `main-actions.ts:126` | `setTimeout` langsung di `triggerSearch` |

---

## 4. Test Coverage

### Summary

| Modul | File test | Penilaian |
|-------|-----------|-----------|
| `bridge.ts` | `bridge.unit.test.ts` | ⚠️ Ada, tapi rentan order-dependency |
| `comparer-logic.ts` | `comparer-logic.unit.test.ts` | ✅ Komprehensif |
| `comparer.ts` | `comparer.unit.test.ts` | ✅ Komprehensif |
| `exporter.ts` | `exporter.unit.test.ts`, `exporter.processdata.unit.test.ts`, `exporter.property.test.ts`, `csv.property.test.ts` | ✅ Sangat lengkap |
| `downloader.ts` | `downloader.unit.test.ts`, `downloader.property.test.ts`, `downloader.invalid.property.test.ts` | ✅ Lengkap termasuk property |
| `main-actions.ts` | `main-actions.unit.test.ts` | ✅ Lengkap |
| `page-context.ts` | `page-context.unit.test.ts` | ✅ Lengkap |
| `postmessage-guard.ts` | `postmessage.origin.property.test.ts` | ✅ Property test komprehensif |
| `scraper-actions.ts` | `scraper-actions.unit.test.ts` | ⚠️ Partial — `scrapeByInvoices` belum diuji path retry exhaustion |
| `scraper-helpers.ts` | `scraper-helpers.unit.test.ts` | ✅ Lengkap |
| `scraper-intercept.ts` | `scraper-intercept.unit.test.ts` | ✅ Lengkap |
| `scraper-pdf.ts` | `scraper-pdf.unit.test.ts` | ✅ Lengkap |
| `scraper-xhr.ts` | `scraper-xhr.unit.test.ts`, `scraper-xhr-download.unit.test.ts` | ✅ Lengkap |
| `tax-date.ts` | `tax-date.unit.test.ts` | ✅ Timezone-aware |
| `ui-filters.ts` | `ui-filters.unit.test.ts` | ⚠️ Sangat tipis (1KB) — hanya smoke test |
| `ui-badge.ts` | `ui.badge.unit.test.ts` | ⚠️ Sangat tipis (1KB) — hanya smoke test |
| `ui.ts` | ❌ Tidak ada | DOM-heavy, acceptable tapi perlu integ test manual |
| `ui-comparer.ts` | ❌ Tidak ada | DOM-heavy, covered via comparer-logic tests |
| `scraper.ts` | ❌ Tidak ada | World-entry, tidak bisa unit-test |
| `main.ts` | ❌ Tidak ada | World-entry, tidak bisa unit-test |

### Gap kritis

1. **`scrapeByInvoices` retry exhaustion** — path di mana `consecutiveFailures >= maxErrors` dan fungsi return early belum diuji
2. **`ui-filters.ts`** — hampir tidak ada test; `splitInvoiceNumbers` dan `getMultiInvoiceNumbers` adalah fungsi critical path
3. **`isCacheValid`** — sudah diuji di `scraper-intercept.unit.test.ts` ✅

---

## 5. Dependensi

| Package | Versi | Catatan |
|---------|-------|---------|
| `xlsx` | 0.20.3 | Custom CDN (SheetJS Pro) — aman, pinned |
| `typescript` | ^5.3.3 | Cukup lama; TS 5.7+ sudah rilis. Pertimbangkan upgrade |
| `vitest` | ^4.1.5 | Mutakhir ✅ |
| `esbuild` | ^0.25.12 | Mutakhir ✅ |
| `eslint` | ^10.3.0 | Mutakhir ✅ |
| `fast-check` | ^4.7.0 | Mutakhir ✅ |
| `standard-version` | ^9.5.0 | ⚠️ Deprecated (unmaintained sejak 2022) — pertimbangkan `release-it` atau `changesets` |

---

## 6. Temuan Lain

### `ui-comparer.ts` — `innerHTML` untuk `&times;`

**File:** [`ui-comparer.ts:57`](file:///D:/PROGRAMMING/cindieh/extension/src/content/ui-comparer.ts#L57)

```ts
closeBtn.innerHTML = "&times;";
```

Ini adalah HTML entity yang aman (bukan string dari user), tapi secara konvensi lebih bersih menggunakan `textContent = "×"` atau `createTextNode("×")`. Tidak ada risiko XSS karena string statis.

---

### `ui.ts` — event listener `document.addEventListener("click", ...)` tidak di-remove

**File:** [`ui.ts:337-341`](file:///D:/PROGRAMMING/cindieh/extension/src/content/ui.ts#L337-L341)

```ts
document.addEventListener("click", (e: MouseEvent) => {
  if (!exportDropdown.contains(e.target as Node)) {
    menu.classList.add("ch-hidden");
  }
});
```

Setiap kali `injectExportButton()` dipanggil ulang (setelah Angular re-render), dropdown baru dibuat dan listener baru ditambahkan ke `document`. Listener lama tidak di-remove karena sudah ada `isInjected` guard yang mencegah double-inject, tapi jika inject terjadi ulang (misal setelah Angular re-mount), listener lama masih aktif. Bisa menyebabkan leak minor tapi tidak kritikal karena element reference ter-capture dalam closure sudah di-remove dari DOM.

---

## Prioritas Rekomendasi

| # | Temuan | Severity | Effort |
|---|--------|----------|--------|
| 1 | Fetch interceptor tidak check `__isCindiehBulk` | Medium | Low |
| 2 | `xhrRequestByInvoice` `JSON.parse` tanpa try-catch | Medium | Low |
| 3 | `getMasaPajakFromDOM` inline regex, harusnya di `tax-date.ts` | Low | Low |
| 4 | Test untuk `scrapeByInvoices` retry exhaustion | Low | Low |
| 5 | Test untuk `ui-filters.ts` (`splitInvoiceNumbers`) | Low | Low |
| 6 | `bridge.ts` factory pattern | Low | Medium |
| 7 | Upgrade TypeScript ke >=5.5 | Low | Low |
| 8 | Ganti `standard-version` dengan `release-it` | Low | Low |
| 9 | Dokumen token-in-postMessage sebagai accepted risk (ADR baru) | Low | Low |
