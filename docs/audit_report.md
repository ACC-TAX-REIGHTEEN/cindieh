# Audit Menyeluruh — Cindieh Extension v2.0.0 (2026-09-24)

**Tanggal audit:** 2026-09-24
**Audit sebelumnya:** 2026-08-15
**Hasil validasi otomatis:** ✅ TypeScript 0 error · ✅ 1.082/1.082 test pass (41 file) · ✅ ESLint 0 error · ✅ Build Chrome sukses

**Ruang lingkup:** Seluruh `src/`, `popup/`, `manifest.json`, `styles/`, `docs/`, dan toolchain. Audit ini mencakup seluruh perubahan sejak audit 2026-08-15: **ADR-0010** (isolasi run scrape), **ADR-0011 → ADR-0012** (pencarian referensi berhenti saat hasil awalan kosong), fitur **Pengecekan Keakuratan Nilai** (tab kedua panel), modul `checker-logic.ts` / `comparer-export.ts` / `scrape-result.ts` / `scraper-run.ts`, test DOM `ui-filters.ts`, dan perluasan test `ui-badge.ts`.

> Catatan angka: jumlah kasus test di dokumen ini diambil dari `vitest` pada 2026-09-24 (41 file, 1.082 kasus, semuanya hijau), bukan dari dokumentasi versi sebelumnya.

---

## Ringkasan Eksekutif

Proyek dalam kondisi **sehat**. Tidak ada temuan berseverity **High** atau **Medium**; sisa temuan berkelas **Low/Info** dan seluruhnya berupa utang struktural kecil atau gap dokumentasi, bukan bug. Tidak ada blocker rilis.

Perbedaan besar sejak audit 2026-08-15:

- **Test bertambah 531 → 1.082 kasus** (22 → 41 file), termasuk keluarga test baru untuk `checker-logic` (77), `scraper-xhr-cancellation` (45), `scraper-fetch` (12), `scrape-result` (20), dan `ui-comparer-export` (18).
- **Fitur baru "Pengecekan Keakuratan Nilai"** — pemeriksaan aritmetika DPP / DPP Nilai Lain / PPN per baris faktur. Logikanya murni (`checker-logic.ts`) dan UI-nya menempel pada panel Komparator; tab ini hanya muncul di halaman e-Faktur PPN Keluaran.
- **ADR bertambah 0010–0012**: run scrape punya identitas + `AbortController` sendiri (ADR-0010), pencarian referensi memakai mode awalan dan **tidak pernah** mengirim `contains` (ADR-0011 → ADR-0012).
- **Dokumentasi disinkronkan dalam audit ini**: fitur Pengecekan kini terdokumentasi di README + `CONTEXT.md` + source map `AGENTS.md`, klaim widening usang di `RATE_LIMITING.md` diperbaiki.

Dua tema sisa yang layak dicatat: **(a)** `ui-comparer.ts` kini 1.268 baris dan menampung dua fitur dalam satu modul DOM tanpa seam unit-test tersendiri (padahal pola proyek adalah "logika murni + view tipis", lihat ADR-0003), dan **(b)** beberapa nilai kebijakan pajak (11/12, 11%, 12%) masih literal di `checker-logic.ts`.

---

## 1. Status Temuan Audit Sebelumnya

Seluruh 14 temuan audit pertama tetap selesai dan tidak ada yang regresi:

| # | Temuan lama | Severity lama | Status |
|---|-------------|---------------|--------|
| 1 | Fetch interceptor tidak cek `__isCindiehBulk` | Medium | ✅ Selesai — `isBulkFetchRequest()` guard ada di `scraper.ts` |
| 2 | `xhrRequestByInvoice` `JSON.parse` tanpa try-catch | Medium | ✅ Selesai — try-catch + `parseCapturedBody()` defensif |
| 3 | `getMasaPajakFromDOM` inline regex | Low | ✅ Selesai — `extractMasaPajak()` di `tax-date.ts` |
| 4 | Test `scrapeByInvoices` retry exhaustion | Low | ✅ Selesai — 6 kasus baru (abort, early-return, backoff, reset, stop) |
| 5 | Test `ui-filters.ts` tipis | Low | ✅ Selesai — helper murni + DOM (lihat kolom rekomendasi di bawah) |
| 6 | `bridge.ts` tanpa factory | Low | ✅ Selesai — `createBridge(windowRef?)` + singleton |
| 7 | Upgrade TypeScript | Low | ✅ Selesai — TS 7 native (ADR-0009) |
| 8 | Ganti `standard-version` | Low | ✅ Selesai — `release-it` + `@release-it/conventional-changelog` |
| 9 | Token di postMessage = accepted risk | Low | ✅ Selesai — ADR-0007 |
| 10 | `createPdfDownloadSession` `setTimeout` global | Quality | ✅ Selesai — `setTimeout`/`clearTimeout` injectable |
| 11 | `ui-comparer.ts` `innerHTML = "&times;"` | Quality | ✅ Selesai — `textContent = "×"` |
| 12 | `ui.ts` listener `click` tidak di-remove | Quality | ✅ Selesai — `outsideClickHandler` dilacak & dilepas |
| 13 | Duplikasi XLSX (`aoa_to_sheet` vs `json_to_sheet`) | Quality | ✅ Diklarifikasi — komentar menjelaskan dua path disengaja |
| 14 | Rate-limit guard `INJECTED_READY` → `START_SCRAPE` | Low | ✅ Selesai — `scraperResendArmed` (satu resend per injeksi) |

### Rekomendasi audit 2026-08-15

| # | Rekomendasi lama | Effort | Status |
|---|------------------|--------|--------|
| 1 | Test logika DOM `ui-filters.ts` (re-injection & cleanup) | Medium | ✅ **Ditutup** — `ui-filters.unit.test.ts` kini 22 kasus, termasuk blok describe DOM: injection, re-injection bersih, dan unregister listener |
| 2 | Rapikan `RATE_LIMITING.md` (hapus nomor baris) | Trivial | ✅ **Selesai** — tabel memakai nama fungsi/konstanta. Satu klaim usang ("pengulangan `startswith` → `contains`") yang bertentangan dengan ADR-0012 diperbaiki pada audit ini |
| 3 | Perluas test `ui-badge.ts` dari 3 smoke test | Low | ✅ **Ditutup** — kini 14 kasus |
| 4 | (Opsional) Hapus branch `keyup` `ch-multi-invoice-textarea` yang mati | Trivial | ⚠️ **Masih terbuka** — handler di `main.ts` masih memproses id tersebut di semua halaman (aman, hanya sisa kode) |

---

## 2. Keamanan

### [INFO] Paparan token bridge — accepted risk (ADR-0007)

Tidak berubah: token dikirim sebagai field plaintext di `window.postMessage` dan sempat berada di `?token=` pada `<script src>`. Ini disengaja dan terdokumentasi (ADR-0007); MAIN world tidak punya `browser.runtime`, jadi `postMessage` adalah satu-satunya kanal. Mitigasi yang dijaga:

- Token tidak pernah disimpan di `window`; `scraper.ts` membacanya dari elemen `<script>` sendiri.
- Guard `shouldProcessPageMessage` (source, origin, direction, token) diuji property (`postmessage.origin.property.test.ts`, 19 kasus) — **jangan dilemahkan**.
- ADR-0008: elemen script dipertahankan hanya sebagai marker id (tanpa token) → satu instance scraper per halaman.

### [INFO] Run ID adalah korelasi, bukan autentikasi (ADR-0010)

ADR-0010 menambahkan ID run monotonik ke pesan yang dimiliki satu operasi, dan pesan dari run lama ditolak. Dokumen ADR menyatakannya eksplisit: ID adalah korelasi, bukan autentikasi — ADR-0007 tetap berlaku. Cakupan test memadai: `scraper-xhr-cancellation.unit.test.ts` (45 kasus, termasuk abort propagation & pesan run lama) dan `scrape-result.unit.test.ts` (20 kasus, termasuk hasil parsial/dibatalkan tidak pernah dianggap hasil lengkap).

### [INFO] CSV formula-injection hardening ✅

`escapeCSV` me-prefix `'` pada nilai berawalan `= + - @ tab CR` dan apostrof; ada property test (`csv.property.test.ts`, 8 kasus) + unit test. XLSX via SheetJS menulis string sebagai sel bertipe string, bukan formula. Postur baik.

### [INFO] Permukaan baru dari fitur Pengecekan ✅

Tab Pengecekan tidak menambah tipe pesan baru ke bridge dan tidak membuka kanal lintas world: ia membaca `contentState.scrapedData` (state lokal isolated world) dan, bila data belum ada, memakai jalur `START_SCRAPE` yang sudah ada plus `pendingCheck`. Tidak ada penurunan postur keamanan.

### [INFO] Permintaan minimal — manifest ✅

`host_permissions` dan `web_accessible_resources` dibatasi ke `https://coretaxdjp.pajak.go.id/*`; `use_dynamic_url: true` pada `scraper.js`; permission hanya `activeTab` + `storage`, dengan `notifications` sebagai `optional_permissions` yang diminta saat saklar notifikasi dinyalakan (bukan saat pemasangan). Tidak ada `unlimitedStorage` atau permission berlebihan.

---

## 3. Kualitas Kode & Temuan Baru

### [LOW] Angka laju pajak sebagai literal di `checker-logic.ts`

**File:** [`checker-logic.ts`](src/content/checker-logic.ts) — fungsi `checkRowAccuracy`

Fitur Pengecekan ada untuk menandai selisih aritmetika, tetapi aritmetikanya sendiri adalah literal yang tersebar di tiga cabang benchmark: `(dppSystem * 11) / 12`, `dppSystem * 0.11`, `dppNilaiLainSystem * 0.12`, `ppnSystem / 0.11`, `ppnSystem / 0.12`. Nilai-nilai itu juga dipatok ulang di `checker-logic.unit.test.ts`. Bila fraksi DPP Nilai Lain atau tarif PPN berubah, setiap baris akan dilaporkan "Berbeda" tanpa ada test yang gagal lebih dulu.

**Rekomendasi:** jadikan satu sumber bernama (mis. `PPN_RATE` / `DPP_NILAI_LAIN_FRACTION`) plus komentar yang menyebut dasar kebijakannya, lalu hitung semua cabang dari konstanta itu.

### [LOW] Setelan Pengecekan tidak dipersistensi

**File:** [`ui-comparer.ts`](src/content/ui-comparer.ts) (`checkerSession`), [`checker-logic.ts`](src/content/checker-logic.ts) (`createCheckerSession`), [`extension-preferences.ts`](src/shared/extension-preferences.ts) (`ComparerDefaults`)

Panel Komparator punya default yang bisa diatur dari popup (**Default Komparator**: toleransi, tanggal mode harian, filter status), tetapi tab Pengecekan di sebelahnya tidak mengingat apa pun: `createCheckerSession()` memulai dengan `benchmark: "DPP"` dan `tolerance: 0`, dan popup tidak memiliki kontrol untuk Acuan/Toleransi/Filter Status Pengecekan. `checkerSession` juga singleton modul, jadi sesi berulang selalu mulai dari nol.

**Rekomendasi:** perluas `ComparerDefaults` (atau tambahkan `CheckerDefaults`) dan seed `checkerSession` dari `getPreferences()` saat modal dibangun — pola yang sudah dipakai `applyStoredComparerDefaults`.

### [LOW] `ui-comparer.ts` menampung dua fitur tanpa seam

**File:** [`ui-comparer.ts`](src/content/ui-comparer.ts) (1.268 baris)

Modul ini sekarang membangun dua view (Bandingkan + Pengecekan), dua sesi, dua tabel hasil, dua filter, dan dua jalur export. Pola proyek menyatakan sebaliknya — ADR-0003 memisahkan logika sesi Komparator ke `comparer-logic.ts` dengan `ui-comparer` sebagai view tipis, dan AGENTS.md meminta flow baru ditambahkan sebagai fungsi murni dengan dependensi disuntikkan, bukan menumbuhkan entry script. Bagian logika Pengecekan sudah murni di `checker-logic.ts` (✅), tetapi lapisan view/render-nya belum punya seam maupun file test sendiri; keputusannya hanya diuji lewat `ui-comparer-export.unit.test.ts` (18 kasus) memakai fake DOM.

**Rekomendasi:** pisahkan tab Pengecekan ke modul view sendiri (mis. `ui-checker.ts`) dengan pola konteks/DI yang sama seperti `ScraperContext`/`ActionDeps`, lalu beri test render terpisah. Bukan blocker, tetapi biaya perubahannya naik setiap kali fitur ini disentuh.

### [LOW] Panel tidak bisa ditutup dengan Escape; tanpa semantik dialog

**File:** [`ui-comparer.ts`](src/content/ui-comparer.ts) (`closeComparerModal`, wiring header)

`closeComparerModal()` hanya terhubung ke tombol `×` dan klik overlay. Tidak ada handler `Escape` di `src/content`, dan overlay tidak memakai `role="dialog"`/`aria-modal` (pencarian: 0 hasil). Untuk panel yang menutupi grid portal dan memuat tabel panjang, ini menyulitkan pengguna keyboard.

**Rekomendasi:** tambahkan listener `keydown` Escape saat overlay terbuka (dan lepas saat ditutup), plus `role="dialog"` + `aria-modal="true"` + label pada overlay.

### [INFO] Tidak ada laporan "nomor faktur tidak ditemukan" untuk filter No. Faktur

**File:** [`main-actions.ts`](src/content/main-actions.ts) (`handleExportAction`, jalur `SCRAPE_BY_INVOICES`), [`scrape-result.ts`](src/content/scrape-result.ts) (`incompleteResultMessage`)

Filter No. Faktur menerima daftar nomor (satu per baris / koma / titik koma) lalu menjalankan scrape bertarget. Bila sebagian nomor tidak ada di Coretax, pengguna tidak diberi tahu nomor mana yang tidak ketemu: `ScrapeComplete` membawa `failedInvoices`/`failureCount` yang berarti **error saat lookup**, bukan "nol baris". Ditambah lagi, teks konfirmasi unduhan massal sudah memperingatkan faktur lama "akan dilewati (skip)" tanpa menyebut mana.

**Rekomendasi:** setelah run bertarget, bandingkan daftar nomor yang diminta dengan baris yang terkumpul dan tampilkan ringkasannya (mis. "3 dari 20 nomor faktur tidak ditemukan di Coretax").

### [INFO] Baris dengan `OtherTaxBase = 0` belum punya perlakuan khusus di checker

**File:** [`checker-logic.ts`](src/content/checker-logic.ts) (cabang `DPP`/`DPP_NILAI_LAIN`/`PPN`)

Untuk benchmark `DPP`, nilai DPP Nilai Lain yang diharapkan selalu dihitung `11/12 × DPP`. Baris portal yang sah membawa `OtherTaxBase: 0` (lihat fixture di `src/tests/exporter.processdata.unit.test.ts`) akan dianggap "DPP NL Berbeda". Apakah `0` di situ berarti "DPP Nilai Lain tidak berlaku untuk faktur ini" atau hanya penyederhanaan fixture **belum bisa dipastikan dari kode** — perlu satu sampel halaman PPN Keluaran untuk memutuskan.

**Rekomendasi:** verifikasi dengan data portal nyata sebelum mengubah perilaku; bila `0` memang berarti "tidak berlaku", kecualikan baris tersebut dari perbandingan DPP NL (dan dokumentasikan).

### [INFO] Branch `keyup` mati di `main.ts` (warisan audit lalu)

**File:** [`main.ts`](src/content/main.ts) — handler `keyup`, cabang `ch-multi-invoice-textarea`

Masih diproses di semua halaman; elemennya hanya ada di halaman e-Faktur (`ui-filters.ts`). Aman, hanya sisa kode. Tidak perlu diubah kecuali ingin dirapikan.

### [INFO] Fitur Pengecekan & ADR-0010–0012 belum tercatat di CHANGELOG

`CHANGELOG.md` berhenti di rilis **2.0.0 (2026-08-06)**, sedangkan ADR-0010–0012 bertanggal 2026-09-24. Ini konsisten dengan alur proyek (CHANGELOG dihasilkan `release-it` dari commit saat rilis, bukan ditulis manual), jadi bukan cacat — hanya catatan agar fitur Pengecekan ikut masuk pada rilis berikutnya.

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
| 0010 | Scrape Run Isolation | ✅ Implemented |
| 0011 | Reference Search Prefix First | ⤴️ Superseded by 0012 (prefix-first tetap) |
| 0012 | Reference Search Stops on Empty Prefix | ✅ Implemented |

### Kepatuhan Two-Worlds Architecture

| Aspek | Status | Catatan |
|-------|--------|---------|
| Bridge token tidak di-`window` | ✅ | ADR-0007, ADR-0008 |
| Guard sebelum dispatch | ✅ | `createMessageDispatcher` tunggal per world; property-tested (19 kasus) |
| `__isCindiehBulk` flag | ✅ | XHR **dan** fetch (`isBulkFetchRequest`) |
| Isolated world: hanya relay + UI | ✅ | `main.ts` tidak scrape; fitur Pengecekan juga hanya membaca state lokal |
| MAIN world: tanpa browser API | ✅ | `scraper.ts` tidak import `browser.*`; `page-pacing.ts` tetap bebas API browser |
| Idempotensi & siklus hidup run | ✅ | ADR-0008 (satu scraper per halaman) + ADR-0010 (identitas & pembatalan per operasi) |
| SPA nav reset | ✅ | `RESET_SCRAPER` + `resetContentState` (mencakup `pendingCheck`) |
| Stateful modul: singleton + factory | ✅ | `bridge`, `contentState`, `createPdfDownloadSession`, `ScraperContext`, identitas run |
| Timer injectable untuk test | ✅ | `PdfDownloadSessionDeps.setTimeout`, `ScraperContext.setTimeout`, `triggerSearch(scheduleDelay)` |
| Modul non-entry yang baru terdokumentasi | ✅ | `checker-logic.ts`, `comparer-export.ts`, `scrape-result.ts`, `scraper-run.ts` kini ada di source map AGENTS.md |

---

## 5. Test Coverage

**Total:** 41 file, 1.082 kasus, semuanya hijau (diukur 2026-09-24 dengan `vitest`).

| Area | File test | Kasus | Penilaian |
|------|-----------|-------|-----------|
| Bridge & messaging | `bridge.unit`, `postmessage.origin.property` | 9 + 19 | ✅ Property test guard keamanan |
| Scraper (inti) | `scraper`, `scraper-boot`, `scraper-actions`, `scraper-intercept`, `scraper-helpers`, `scraper-pdf`, `scraper-nets`, `scraper-fetch`, `scraper-xhr`, `scraper-xhr-download`, `scraper-xhr-patches`, `scraper-xhr-cancellation` | 2 + 20 + 39 + 30 + 24 + 41 + 20 + 12 + 13 + 35 + 40 + 45 | ✅ Termasuk retry-exhaustion, pembatalan run, dan patch/teardown |
| Export & file | `exporter.unit`, `exporter.processdata`, `exporter.property`, `csv.property` | 45 + 36 + 5 + 8 | ✅ Termasuk formula-injection & 11 source |
| Download | `downloader.unit`, `downloader.property`, `downloader.invalid.property` | 28 + 1 + 2 | ✅ Termasuk base64 invalid & naming |
| Aksi & hasil content | `main-actions.unit`, `scrape-result.unit`, `main-boot.unit` | 51 + 20 + 23 | ✅ Termasuk penolakan hasil parsial/dibatalkan (`pendingCheck` ikut dicakup) |
| Konteks halaman & tanggal | `page-context.unit`, `tax-date.unit`, `reference-search.unit` | 60 + 25 + 1 | ✅ Termasuk `isEfakturPage` & mode `startswith` |
| Komparator & Pengecekan | `comparer.unit`, `comparer-logic.unit`, `checker-logic.unit`, `ui-comparer-export.unit` | 60 + 83 + 77 + 18 | ✅ Logika murni komprehensif; view Pengecekan diuji lewat fake DOM |
| UI DOM | `ui-filters.unit`, `ui.badge.unit`, `ui-export-dropdown.unit` | 22 + 14 + 9 | ✅ Gap audit lalu sudah ditutup |
| Preferensi & storage | `preferences.unit`, `extension-preferences.unit`, `debug-preference.unit`, `debug.unit` | 13 + 36 + 25 + 13 | ✅ Termasuk normalizer & guard baca/gagal |
| Popup & background | `popup.unit`, `background.unit`, `completion-notice.unit` | 33 + 11 + 14 | ✅ Perilaku kontrol & notifikasi |
| World-entry | `scraper.ts`, `main.ts` | — | ⚠️ Tidak di-unit-test penuh (by design); dijaga lewat `scraper-boot`/`main-boot` |
| View Pengecekan | — | — | ⚠️ Belum ada seam/file test tersendiri (lihat temuan §3) |

---

## 6. Dependensi

| Package | Versi | Catatan |
|---------|-------|---------|
| `xlsx` | 0.20.3 | Custom CDN (SheetJS) — pinned, aman; satu-satunya dependensi runtime |
| `@typescript/native` | ^7.0.2 | Compiler Go-native (ADR-0009) |
| `typescript` (alias) | npm:@typescript/typescript6@^6.0.2 | API compiler untuk typescript-eslint — **jangan** diubah ke ^7 |
| `vitest` | ^4.1.5 | Mutakhir ✅ |
| `esbuild` | ^0.25.12 | Mutakhir ✅ |
| `eslint` | ^10.3.0 | Mutakhir ✅ |
| `fast-check` | ^4.7.0 | Mutakhir ✅ |
| `release-it` + `@release-it/conventional-changelog` | ^21.0.2 / ^12.0.0 | Pengganti `standard-version` ✅ |
| `archiver` | ^7.0.1 | Dipakai `package.cjs` ✅ |

Tidak ada dependensi runtime selain `xlsx`; semua devDependencies relevan dan terpakai.

---

## 7. Verifikasi Build & Toolchain

| Langkah | Perintah | Hasil |
|---------|----------|-------|
| Typecheck | `pnpm typecheck` (`tsc --noEmit`, TS 7 native) | ✅ 0 error |
| Test | `pnpm test` (vitest, 41 file) | ✅ 1.082/1.082 |
| Lint | `pnpm lint` (eslint + typescript-eslint) | ✅ 0 error |
| Build | `pnpm build:chrome` | ✅ Build complete + manifest & aset tersalin |

Catatan: pada pnpm 11, jalankan dengan `pnpm --config.verify-deps-before-run=false <cmd>` agar pre-run install (yang gagal karena build script `esbuild` diabaikan) tidak mengganggu; `node_modules` tetap valid. `popup.js` adalah artefak build dari `src/popup/popup.ts` (lihat `build.cjs`), bukan file sumber. `dist/` di-gitignore dan diregenerasi build.

---

## Prioritas Rekomendasi

| # | Temuan | Severity | Effort |
|---|--------|----------|--------|
| 1 | Persistensi setelan Pengecekan (Acuan, Toleransi, Filter Status) | Low | Low |
| 2 | Angka laju pajak di `checker-logic.ts` → satu konstanta bernama | Low | Low |
| 3 | Pisahkan tab Pengecekan dari `ui-comparer.ts` + seam/file test sendiri | Low | Medium |
| 4 | Laporan "nomor faktur tidak ditemukan" untuk filter No. Faktur | Low | Low |
| 5 | Escape + semantik dialog (`role`, `aria-modal`) pada panel | Info | Trivial |
| 6 | Verifikasi perlakuan `OtherTaxBase = 0` dengan satu sampel portal | Info | Trivial |
| 7 | Hapus branch `keyup` `ch-multi-invoice-textarea` yang mati di `main.ts` | Info | Trivial |

**Kesimpulan:** Tidak ada blocker. Proyek siap untuk iterasi berikutnya. Prioritas terbaik ada di sekitar fitur Pengecekan — memindahkan angka kebijakan pajaknya ke satu konstanta dan menyimpan setelannya — karena itulah area dengan pertumbuhan tercepat saat ini.
