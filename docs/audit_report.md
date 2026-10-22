# Audit Menyeluruh — Cindieh Extension v2.2.0 (2026-10-13)

**Tanggal audit:** 2026-10-13
**Audit sebelumnya:** 2026-09-24 (mencakup state v2.0.0). Audit ini mencakup rilis **v2.1.0 (2026-09-25)**, **v2.2.0 (2026-10-13)**, dan lima commit setelah rilis 2.2.0 (sampai `0c2fc06`).
**Batas audit:** commit `0c2fc06` (fix(ui): paint the tint pill text from text-safe -ink twins). Temuan di bawah dibatasi commit itu; **angka test, coverage, dan build diukur ulang pada commit `2f6baa1`** (14 commit sesudah batas — menutup gap `downloader`/`ui-filters`/`exporter`/`main-boot` dan menaikkan lantai ratchet).
**Hasil validasi otomatis (angka snapshot 2026-10-13, commit `2f6baa1`):** ✅ TypeScript 0 error · ✅ 1.598/1.598 test pass (53 file) · ✅ ESLint 0 error · ✅ Build Chrome & Firefox sukses · ✅ Coverage ratchet hijau (92.79 / 85.84 / 89.34 / 94.18 terhadap lantai 92.4 / 85.4 / 88.9 / 93.8).

**Ruang lingkup:** seluruh `src/`, `popup/`, `styles/`, `microsite/`, `manifest.json`, `tools/`, dan toolchain. Sejak audit sebelumnya: **ADR-0013** (SheetJS lazy chunk), **ADR-0014** (`run-lifecycle.ts` menggantikan `ContentState`), **ADR-0015** (satu deklarasi per source di `export-source.ts`), **ADR-0016** (identitas baris dari `RecordId`), **ADR-0017** (hasil besar melintasi bridge dalam chunk), **ADR-0018** (ekspor satu tahun sebagai satu Run), plus situs publik `microsite/` dengan guard anti-drift, panel popup preferensi lengkap, notifikasi penyelesaian yang membawa pengguna kembali ke halaman asal saat toast diklik, dan Pengecekan Keakuratan Nilai yang kini jalan di PPN Masukan juga.

> Catatan angka: jumlah test (53 file / 1.598 kasus), angka coverage per file, dan hasil build diambil langsung dari `vitest`, `tsc`, `eslint`, dan `build.cjs` pada 2026-10-13 di commit `2f6baa1` — bukan dari dokumentasi rilis. Batas temuan tetap `0c2fc06`.
>
> **Snapshot 2026-10-13 · commit `2f6baa1` (angka) / `0c2fc06` (temuan) — angka dan rujukan `file:line` di bawah adalah ukuran saat itu, bukan hari ini.** Laporan ini adalah catatan bertanggal: setiap angka test/coverage/build dan setiap rujukan kode menunjuk repository pada 2026-10-13. Angka asli sengaja dibiarkan sebagai catatan sejarah; setiap bagian yang mengutip angka atau anchor kode punya blok **"Hari ini"** di sampingnya, supaya pembaca tidak memakainya sebagai kondisi sekarang.
>
> **Angka hari ini (commit `c18f76e`, 2026-10-21):** 68 file / 2.148 tes · coverage **95,27 / 90,59 / 93,66 / 96,29** (statements / branches / functions / lines) · lantai ratchet yang ditegakkan `vitest.config.ts`: **94,9 / 90,2 / 93,3 / 95,9**. Modul terendah sekarang bukan `scraper.ts` lagi (kini adapter 35 baris, 100%) melainkan `src/content/scraper-install.ts` (49,7% statements / 34,8% branch).

---

## Ringkasan Eksekutif

Proyek dalam kondisi **sehat**. Tidak ada temuan ber-severity **High** atau **Medium**. Seluruh tujuh rekomendasi audit 2026-09-24 **selesai** — dua di antaranya (persistensi setelan Pengecekan dan pemisahan tab Pengecekan) bergabung menjadi satu refactor struktural yang merapikan panel itu sendiri (`ui-checker.ts` kini punya suite render sendiri), dan satu temuan INFO (`OtherTaxBase = 0`) kini ditutup dengan bukti portal nyata, bukan dibiarkan terbuka. Tidak ada blocker rilis.

Tiga tema sisa yang layak dicatat:

- **Asimetri fitur batch** — ⚠️ **TEMUAN INI SUDAH SUPERSEDED (lihat §3)**: waktu audit ini, ekspor satu tahun hanya aktif di PPN Keluaran, padahal `scrape-batch.ts` sengaja ditulis agnostik terhadap source (kode masa berasal dari request yang ditangkap portal, bukan yang disintesis). **Hari ini (commit `c18f76e`)** gate-nya bukan satu grid melainkan `deps.isEfakurPage()` (`src/content/main-actions.ts:320`) — keempat grid e-Faktur PPN: PPN Keluaran, PPN Masukan, Retur PPN Keluaran, dan Retur PPN Masukan (ADR-0019, ADR-0025, ADR-0043) — dan keempatnya punya baris terukur di `MEASURED_SWEEP_FILTERS` (`src/content/scrape-batch.ts:108-113`).
- **Gap coverage yang sudah terdokumentasi** (angka snapshot 2026-10-13) tinggal `scraper.ts` dan jalur cabang `main.ts`/`ui-comparer.ts`/`ui-panel.ts` — `downloader.ts` (96%), `ui-filters.ts` (99,5%), `exporter.ts` (92%) dan harness `main-boot` naik sendiri sesudah batas audit (`15d5924`…`2f6baa1`). Logika murninya sudah terpisah dan penuh test; yang tersisa adalah wiring, dan AGENTS.md sendiri mencatatnya sebagai gap yang diketahui. **Hari ini (commit `c18f76e`)**: `scraper.ts` bukan lagi gap — ia kini adapter 35 baris pada 100% coverage (ADR-0038), dan wiring yang belum teruji pindah ke `src/content/scraper-install.ts` (49,7% statements / 34,8% branch) — lihat §3 dan §5.
- **Dua perbaikan hari ini**: CI kini membangun kedua browser (sebelumnya build hanya jalan bila ada yang mengingatnya secara lokal), dan defect kontras pill pada `injected.css` (yang AGENTS.md catat "out of scope untuk mikro-situs") sudah diperbaiki dengan cara yang sama seperti mikro-situs memperbaiki mirror-nya — kalimat defect itu di AGENTS.md sudah diganti oleh `c934fdd`.

---

## 1. Status Temuan Audit Sebelumnya (2026-09-24)

Seluruh tujuh prioritas selesai, tanpa regresi yang terlihat:

| # | Temuan | Severity lama | Status |
|---|--------|---------------|--------|
| 1 | Persistensi setelan Pengecekan | Low | ✅ Selesai — `CheckerDefaults` masuk `src/shared/extension-preferences.ts`, sesi Pengecekan di-seed via `applyCheckerDefaults()`; popup punya baris "Default Pengecekan" (commit `9d23db6`) |
| 2 | Angka laju pajak literal di `checker-logic.ts` | Low | ✅ Selesai — `PPN_RATE_PERCENT`, `DPP_NILAI_LAIN_NUMERATOR/DENOMINATOR`, dan `PPN_RATE_ON_NILAI_LAIN` (diturunkan dari dua konstanta, bukan kebetulan 12%) jadi satu sumber; test membaca konstanta, bukan literal (commit `a351628`) |
| 3 | `ui-comparer.ts` menampung dua fitur tanpa seam | Low | ✅ Selesai — tab Pengecekan pindah ke `ui-checker.ts` (factory `createCheckerView(deps)` + singleton, pola DI modul lain), dengan suite render sendiri `ui-checker.unit.test.ts` (29 kasus); `checker-logic.ts` kini 98% statement (commit `5600bea`; ratchet dinaikkan `f001098`) |
| 4 | Laporan "nomor faktur tidak ditemukan" | Low | ✅ Selesai — dialog pre-download menyebut nomor yang tak punya baris (`c0ef836`), run melaporkan shortfall-nya (`9da279d`), notifikasi menghitungnya (`a91d914`), dan run bulk PDF menamai berkas individual yang gagal diambil (`6315f4f`) |
| 5 | Panel tanpa Escape / tanpa semantik dialog | Info | ✅ Selesai — panel `<dialog>` betulan, Escape menutup, satu handler Escape dan klik-di-luar milik `ui-panel.ts` (commit `1c15384`) |
| 6 | `OtherTaxBase = 0` belum punya perlakuan khusus | Info | ✅ Ditutup 2026-10-13 — bukti portal nyata sudah ada di fixture (DPP 100, DPP NL 0, VAT 11): baris seperti itu memang sah, jadi perbandingan terhadap nilai yang dihitung dari 11/12 × DPP dibuang untuk acuan DPP dan PPN (kolom selisih tampil `-`); saat Acuan DPP Nilai Lain, nilai 0 tetap dipakai sesuai pilihan pengguna. Diperbaiki di `checker-logic.ts` + 5 kasus test baru + catatan README (commit `7c5b915`) |
| 7 | ~~Hapus branch `keyup` yang "mati"~~ | Info | ✅ Tetap ditutup sebagaimana 2026-09-25 — branch itu hidup, premis kode-matinya keliru |

Tiga kemampuan baru sejak itu yang tidak ada di daftar lama (karena belum dibangun saat audit lama): ekspor satu tahun PPN Keluaran sebagai satu Run (ADR-0018), pemecahan hasil besar lintas bridge menjadi chunk (ADR-0017), dan tab Pengecekan di PPN Masukan dengan kolom yang berpindah dari Nama Pembeli ke Nama Penjual sesuai gridnya.

---

## 2. Keamanan

### [INFO] Postur yang tidak berubah ✅

Tiga izin browser (`activeTab` dan `storage` wajib, `notifications` opsional yang diminta saat saklar dinyalakan) plus satu `host_permissions`; `host_permissions` dan `web_accessible_resources` tetap hanya `coretaxdjp.pajak.go.id`; ADR-0007 (exposure token bridge) dan ADR-0008 (injeksi satu kali) tak berubah. Guard `shouldProcessPageMessage` tidak melemah: property test origin/direction masih 19 kasus di `postmessage.origin.property.test.ts`, dan audit ini tidak melihat adanya jalan pintas baru.

### [INFO] Permukaan baru dari chunk transfer (ADR-0017) ✅

`SCRAPE_DATA_CHUNK` menambah satu tipe pesan MAIN → isolated. Pemindahannya dijaga oleh modul transfer dengan kontrak eksplisit: completion menyebut `dataChunks`, dan transfer yang tidak lengkap **dilaporkan** bukan di-settle sebagai hasil lengkap. Tidak ada kanal lintas world lain yang terbuka.

### [INFO] Notifikasi penyelesaian ✅

`completion-notice.ts` membangun dan memvalidasi record sebelum dipublikasikan; toast yang diklik kembali ke halaman asal via `notificationTabPattern` (pola SPA-stabil: origin plus dua segmen path pertama), perintah "buka panel" dikirim lewat seam storage yang sama dengan perintah popup lain, dan id toast yang bukan `cindieh-completion-` diabaikan. Toast yang hidup lebih lama dari worker-nya kehilangan map itu dan jatuh kembali ke tab portal mana pun — perilaku yang didokumentasikan, bukan cacat.

### [INFO] Permintaan tetap minimal ✅

Tidak ada permission baru sejak audit lama. Halaman `privacy.html` memeriksa tabel izinnya dua arah terhadap `manifest.json` di CI, jadi satu permission tidak bisa tayang atau menghilang tanpa salah satu sisi merah.

### [INFO] Baru: CI membangun kedua browser ✅ (commit `5e8f91d`)

Sebelumnya build hanya dijalankan seseorang secara lokal sebelum rilis; kini `build:chrome` dan `build:firefox` jalan di setiap push/PR, jadi perubahan `build.cjs` atau rewrite manifest per-browser yang hanya Firefox kena gagal merah di PR, bukan di hari rilis.

---

## 3. Kualitas Kode & Temuan Baru

### [LOW] Gap coverage yang terdokumentasi, praktis diam di tempat

> **Snapshot 2026-10-13 · commit `2f6baa1` — angka di bawah adalah ukuran saat itu, bukan angka hari ini.** Angka asli dipertahankan sebagai catatan sejarah; lihat blok "Hari ini" di akhir bagian.

**File:** [scraper.ts](../src/content/scraper.ts), [downloader.ts](../src/content/downloader.ts), [ui-filters.ts](../src/content/ui-filters.ts), [main.ts](../src/content/main.ts), [ui-comparer.ts](../src/content/ui-comparer.ts), [ui-panel.ts](../src/content/ui-panel.ts)

Ada yang naik: `ui-checker.ts` 97.32% stmts / 83.33% branch dan `checker-logic.ts` 98% statement menutup sebagian besar gap panel lama. Sesudah batas audit tiga penulis di ujung rantai naik sendiri lewat suite baru — `downloader.ts` 44,44% → 96,29%, `ui-filters.ts` 55% → 99,54%, `exporter.ts` 81,56% → 92,19% — dan `main.ts` ikut naik lewat harness `main-boot` (71,71% → 90,47% stmts). Yang tersisa adalah angka yang AGENTS.md sudah catat sebagai gap yang diketahui, diukur ulang pada `2f6baa1`: `scraper.ts` 39,39% stmts / **28,73% branch** (wiring IIFE MAIN-world), `main.ts` branch 72,38%, `ui-comparer.ts` branch 57,30%, `ui-panel.ts` branch 73,07%, `ui.ts` 89,01% stmts / 76,66% branch, dan `exporter.ts` funcs 76% (entry point `exportXLSX` yang sengaja belum teruji). Komposisinya sama dengan catatan AGENTS.md — angka menyusul, bukan lompatan baru.

**Rekomendasi:** perluas harness two-worlds yang ada (`scraper-boot.unit.test.ts`, `main-boot.unit.test.ts`) sampai jalur yang belum teruji tercakup, lalu naikkan lantai ratchet — sesuai AGENTS.md, jangan pernah dilonggarkan sekadar memperhijaukan build.

**Hari ini (commit `c18f76e`, 2026-10-21):** rekomendasi di atas sudah dikerjakan, dan bentuk gap-nya berubah. `scraper.ts` kini **adapter 35 baris pada 100% coverage** (ADR-0038) — wiring MAIN-world pindah ke `src/content/scraper-install.ts`, dan angka yang belum teranjak lagi adalah **49,7% statements / 34,8% branch** (action bodies: scrape paginasi nyata dan bulk PDF dengan requesttertangkap). Lantai ratchet naik ke **94,9 / 90,2 / 93,3 / 95,9** (`vitest.config.ts`), dan rata-rata global **95,27 / 90,59 / 93,66 / 96,29** pada 68 file / 2.148 tes. `main.ts` 94,53% stmts / 84,84% branch, `ui-comparer.ts` 91,86% / 66,66%, `ui-panel.ts` 91,04% / 77,41%, `ui.ts` 93,22% / 85,23%, `popup.ts` 93,58% / 77,41%, `exporter.ts` 97,11% / 93,54%.

### [LOW] Batch export terkunci satu halaman, padahal mesinnya agnostik — ⚠️ **SUPERSEDED**

> **Snapshot 2026-10-13 · commit `0c2fc06` — temuan di bawah adalah catatan sejarah; fitur ini sudah tidak lagi terkunci ke satu grid.** Ditandai SUPERSEDED, tidak dihapus, karena laporan ini adalah catatan temuan audit dan perkembangannya.

**File (waktu itu):** [main-actions.ts](../src/content/main-actions.ts) (`isBatchPage: () => isOutputTaxPage()`), [scrape-batch.ts](../src/content/scrape-batch.ts)

`scrape-batch.ts` sengaja tidak tahu halamannya: kode masa berasal dari request yang ditangkap, dan `overridesForPeriod()` mengganti satu nilai `Value` sambil membawa sisa filter apa adanya. Yang mengunci fitur ini ke PPN Keluaran hanya gate di `main-actions`, teks konfirmasi, nama file, dan README/microsite (yang mesti ikut diubah dalam commit yang sama — dijaga `microsite-sync`). Untuk **PPN Masukan**, satu hal perlu diukur di portal nyata: nilai `PropertyName` filter masa pada body request daftar PPN Masukan. `TaxInvoicePeriod` diharapkan dipakai pola yang sama, tapi aturan proyeknya sendiri adalah mengukur, bukan mengasumsikan.

**Rekomendasi (waktu itu):** satu sampel Network dari portal memutuskan itu; sisanya gate + copy + nama file + sinkronisasi README/microsite.

**Hari ini (commit `c18f76e`, 2026-10-21) — sudah selesai, lihat ADR-0019, ADR-0025, dan ADR-0043:**
- Gate yang berlaku adalah `deps.isEfakurPage()` (`src/content/main-actions.ts:320`), bukan `isBatchPage` — nama `isBatchPage` sendiri sudah tidak ada (hanya sisa komentar historis di `src/content/main-actions.ts:45`). Gate itu mencakup **keempat grid e-Faktur PPN**: PPN Keluaran, PPN Masukan, Retur PPN Keluaran, dan Retur PPN Masukan.
- Keempatnya sudah punya baris terukur di `MEASURED_SWEEP_FILTERS` (`src/content/scrape-batch.ts:108-113`) — jadi guard yang menolak grid tak terukur sudah tidak menolak satu pun dari keempat grid.
- Bentuk nilai filter masanya juga berubah (ADR-0043): pada tiga grid baru nilainya **daftar kode** (`["TD.00709"]`), bukan satu string — pembaca yang hanya paham bentuk string akan mengira grid itu tidak punya filter masa sama sekali.

### [INFO] Panel kini bisa dibuka keyboard (commit `d921003`)

Audit lama menandai panel sebagai mouse-only; kini `Ctrl+Shift+B` membukanya. Pintasan itu memakai event `ch:compare-open` yang sama dengan tombol toolbar (semantik on/off panel tetap satu sumber), **digate `isPanelPage()`** (`src/content/shortcuts.ts:126`) — predikat yang sama yang `ui-panel.ts` pakai untuk "halaman tempat dua tab itu hidup", jadi tombol dan kunci tidak bisa berbeda pendapat soal halaman. README dan microsite memuat baris pintasan itu dalam commit yang sama, jadi guard sync-nya hijau.

> **Perkembangan sesudah snapshot:** `isVatInvoicePage()` yang disebut audit ini sebagai gate sudah bukan gate pintasan — `isVatInvoicePage()` masih ada di `src/content/page-context.ts:59-61`, tetapi hanya sebagai fakta "grid ini berisi invoice PPN", bukan sebagai penentu halaman mana yang boleh punya panel. Pintasan sendiri kini digate `isPanelPage()` (`src/content/page-context.ts:306-309`), yang berarti **panel terbuka di keempat grid e-Faktur PPN**: PPN Keluaran, PPN Masukan, Retur PPN Keluaran, dan Retur PPN Masukan (ADR-0024, ADR-0025, ADR-0028) — tab Komparator hanya di PPN Keluaran, tab Pengecekan di keempatnya, dan `isPanelPage()` menjawab "apakah salah satu tersedia".

### [INFO] Defect kontras `injected.css` ditutup di pihak extension juga (commit `0c2fc06`)

AGENTS.md mencatat defect pill `--ch-diff`-pada-`--ch-diff-tint` di `injected.css` sebagai bug yang sama dengan yang dikoreksi mikro-situs, tapi "out of scope" — mirror-nya sudah memakai token `-ink`, sheet aslinya belum. Kini sheet aslinya juga: `--ch-match-ink`, `--ch-diff-ink`, dan `--ch-bad-ink` masuk `:root` `injected.css` dengan nilai yang sama dengan yang token mirror mikro-situs tulis (hue/saturation sama, lightness di-solve ke 5:1), dan tiga situs teks yang sebelumnya gagal AA (`summary-ok`, `summary-warn`, `status-error`) melepas token dasar. Latar, border, dan pill `--ch-info` tetap token dasar karena sudah 4.5:1. Perbaikan ini tidak menggerakkan `microsite-sync`: token dasar tak berubah, jadi pemeriksaan kesetaraan sepuluh pasang tetap hijau. **Catatan AGENTS.md "injected.css still ships the same defect" sudah diganti pada `c934fdd`** — lihat Prioritas #4.

### [INFO] Tool pengukuran portal kini ada di repo

`tools/` memuat diagnostic masa-batch (commit `9936a9f`) yang mengukur aturan `scrape-batch` langsung terhadap portal. Sampel Network yang dibutuhkan rekomendasi batch-Masukan di atas bisa diambil dengan jalur yang sama — pola "diukur, bukan diasumsikan" sudah punya tempat kerjanya.

### [INFO] CHANGELOG sudah sinkron

Audit lama mencatat CHANGELOG berhenti di 2.0.0. Kini sampai 2.2.0 karena alur release-it; tidak ada temuan.

---

## 4. Arsitektur

### Status ADR

> **Snapshot 2026-10-13 · commit `0c2fc06` — tabel di bawah adalah daftar ADR yang ada saat itu.** ADR-0019 s.d. ADR-0044 lahir sesudah snapshot; indeks lengkapnya ada di [docs/adr/README.md](adr/README.md).

| ADR | Judul | Status |
|-----|-------|--------|
| 0001–0010, 0012 | tata kelola PDF emission, dispatch seam, session comparer, export tree, context interface, matching comparer, token bridge, injeksi satu kali, run isolation, prefix-first | ✅ Implemented/Accepted |
| 0009 | TypeScript 7 native + alias TS 6 | ✅ Accepted (compiler tak berubah sejak audit lama) |
| 0011 | Prefix-first dengan widening | ⤴️ Superseded by 0012 |
| 0013 | SheetJS lazy chunk | ✅ Implemented — `xlsx-runtime.ts` di-exclude dari coverage dengan sengaja; kebenarannya dites lewat berkas *hasil build*, karena AGENTS.md melarang meng-import source-nya |
| 0014 | `run-lifecycle.ts` memegang run state | ✅ Implemented — `ContentState` bag-of-fields tidak ada lagi |
| 0015 | Satu deklarasi per source | ✅ Implemented — `export-source.ts` 100% stmts/branch/lines |
| 0016 | Identitas baris = id portal | ✅ Implemented — `RecordId`/`AggregateIdentifier` menopang dedupe O(1); test pin `0` sebagai id yang legal |
| 0017 | Chunk transfer hasil besar | ✅ Implemented |
| 0018 | Ekspor satu tahun = satu Run | ✅ Implemented — `scrape-batch.ts` 100% stmts/lines |

### Kepatuhan Two-Worlds Architecture

| Aspek | Status | Catatan |
|-------|--------|---------|
| Guard sebelum dispatch, satu dispatcher per world | ✅ | `createMessageDispatcher` diuji property |
| MAIN world tanpa browser API | ✅ | `page-pacing.ts` tetap bebas API browser |
| Idempotensi & identitas run | ✅ | ADR-0008 / ADR-0010 / ADR-0014 |
| Stateful module = factory + singleton | ✅ | `bridge`, `run-lifecycle`, `checkerView` (dengan `createCheckerSession` di baliknya) |
| Teardown permukaan demi permukaan | ✅ | `teardownInterceptors()` dijaga per permukaan; `scraper-boot` membuktikannya dengan property setter yang melempar |
| Preferensi schema → guard → cache | ✅ | `extension-preferences.ts` satu schema; `preferences.ts` satu translasi; popup hidup via `storage.onChanged` |
| Microsite tidak drift dari kode | ✅ | `microsite-sync.unit.test.ts` di CI; tabel izin diperiksa dua arah; page list, popup, status legend juga dua arah |

---

## 5. Test Coverage

> **Snapshot 2026-10-13 · commit `2f6baa1` — seluruh angka di bagian ini adalah ukuran saat itu, bukan angka hari ini.** Angka asli dipertahankan sebagai catatan sejarah; lihat blok "Hari ini" di akhir bagian.

**Total (snapshot 2026-10-13):** 53 file, 1.598 kasus, semuanya hijau (diukur ulang 2026-10-13 pada commit `2f6baa1`).

| Area | File test khas | Catatan |
|------|----------------|---------|
| Batch & lifecycle | `scrape-batch.unit` 13, `scrape-batch-helpers.unit` 26, `run-lifecycle.unit` 29 | ADR-0014/0018; masa kosong di tengah masa berisi dilaporkan terpisah dari masa yang gagal diambil |
| Checker & panel Pengecekan | `checker-logic.unit` 94, `ui-checker.unit` 29 | Termasuk 5 kasus `OtherTaxBase = 0` yang baru; `ui-checker` drivable tanpa overlay |
| Export & source | `export-source.unit` 18, `export-source.matrix.unit` 32, `exporter.*` 100 | Satu deklarasi per source; matrix menutup kolom dan dua ejaan nomor bukti potong |
| Persistensi & notifikasi | `extension-preferences.unit` 42, `preferences.unit` 13, `completion-notice.unit` 24 | Normalizer per nilai + guard baca/gagal + ringkasan yang tidak mengumumkan run sebagian sebagai sukses |
| Pintasan & shell panel | `shortcuts.unit` (3 binding), `ui-comparer-view.unit` + `ui-comparer-export.unit` (shell/overlay) | Ctrl+Shift+B digate `isPanelPage` (waktu itu `isVatInvoicePage`) |
| Wiring dunia | `scraper-boot.unit` 20, `main-boot.unit` 47 | Pembuktian patch/teardown kedua dunia di entry script |
| Microsite | `microsite-sync.unit` 79 | Kontra-drift fakta, struktur halaman, dan 86 pasang kontras AA — termasuk `404.html` |

Jumlah kasus per file di tabel ini adalah hitungan **snapshot 2026-10-13**; suite-nya kini 68 file / 2.148 kasus (lihat blok "Hari ini" di bawah).

Known gap yang menahan rata-rata, sengaja begitu (**angka snapshot 2026-10-13** — bukan hari ini):

| Area | % Stmts | % Branch | Penjelasan |
|------|---------|----------|------------|
| `scraper.ts` | 39.39 | 28.73 | IIFE wiring MAIN-world; dijaga `scraper-boot` |
| `main.ts` | 90.47 | 72.38 | SPA nav + event wiring (tersisa import-time glue dan listener `init()`) |
| `ui-comparer.ts` | 89.97 | 57.30 | Jalur open/close overlay |
| `ui-panel.ts` | 91.46 | 73.07 | Konstruksi DOM shell |
| `ui.ts` | 89.01 | 76.66 | DOM toolbar & dropdown in-page |
| `popup.ts` | 93.64 | 61.66 | Cabang render kontrol popup |
| `exporter.ts` | 92.19 | 85.43 | funcs 76% — `exportXLSX` sengaja belum teruji (ADR-0013) |
| `scraper-types.ts`, `xlsx-runtime.ts` | — | — | Di-exclude dengan sengaja (modul type-only; chunk hasil build ADR-0013) |

Rata-rata global (snapshot 2026-10-13): 92.79 stmts / 85.84 branch / 89.34 funcs / 94.18 lines — semuanya berada di atas lantai masing-masing (92.4 / 85.4 / 88.9 / 93.8).

**Hari ini (commit `c18f76e`, 2026-10-21):** 68 file test, 2.148 kasus, semuanya hijau. Coverage terukur **95,27 stmts / 90,59 branch / 93,66 funcs / 96,29 lines**, dengan lantai ratchet yang ditegakkan `vitest.config.ts` **94,9 / 90,2 / 93,3 / 95,9**. Modul terendah bukan lagi `scraper.ts` — ia kini adapter 35 baris pada **100%**; gap terendah ada di `src/content/scraper-install.ts` (**49,7% stmts / 34,8% branch**), lalu `main.ts` 94,53 / 84,84, `ui-comparer.ts` 91,86 / 66,66, `ui-panel.ts` 91,04 / 77,41, `ui.ts` 93,22 / 85,23, `popup.ts` 93,58 / 77,41, `exporter.ts` 97,11 / 93,54, `ui-comparer-view.ts` 94,06 / 68,31. `scraper-types.ts` dan `xlsx-runtime.ts` tetap di-exclude dengan sengaja.

---

## 6. Dependensi

Satu runtime dependency (`xlsx` 0.20.3 dari CDN SheetJS, pinned) tidak berubah sejak audit lama. DevDependencies tetap relevan: `@typescript/native ^7.0.2` sebagai compiler (ADR-0009), alias `typescript` = `npm:@typescript/typescript6@^6.0.2` untuk eslint — **jangan** dinaikkan ke `^7` langsung, lint bakal patah — serta `vitest ^4.1.5`, `esbuild ^0.25.12`, `eslint ^10.3.0`, `fast-check ^4.7.0`, `release-it ^21.0.2` + `@release-it/conventional-changelog ^12.0.0`, `archiver ^7.0.1`. Alias dan compiler harus diangkat berpasangan bila kelak di-upgrade.

---

## 7. Verifikasi Build & Toolchain

> **Snapshot 2026-10-13 · commit `2f6baa1` — hasil di bawah adalah ukuran saat itu, bukan hari ini.**

| Langkah | Perintah | Hasil |
|---------|----------|-------|
| Typecheck | `pnpm typecheck` | ✅ 0 error |
| Test | `pnpm test` | ✅ 1.598/1.598 (53 file) |
| Lint | `pnpm lint` | ✅ 0 error |
| Build Chrome | `pnpm build:chrome` | ✅ manifest dioptimalkan + aset tersalin |
| Build Firefox | `pnpm build:firefox` | ✅ — dan kini juga di CI, bukan lokal-saja |
| Coverage ratchet | `pnpm test:coverage` | ✅ semua di atas lantai |

Semua perintah di tabel ini ada di `package.json` dan berjalan pada commit `c18f76e` seperti pada saat snapshot; hanya jumlah test dan angka coverage yang sudah maju (lihat §5).

Catatan pnpm 11+ (turunannya CI memakai pnpm 12): jalankan dengan `pnpm --config.verify-deps-before-run=false <cmd>` agar pre-run install tidak menabrak `ERR_PNPM_IGNORED_BUILDS`. `dist/` di-gitignore dan diregenerasi build; tidak ada yang diedit langsung di sana.

---

## 8. Verifikasi Portal (manual, belum tergantikan unit test)

Satu loop manual tersisa sebelum rilis berikutnya — unit test menjangkau seam dan keputusan, bukan piksel di layar dan perilaku jalan di portal:

1. **Checker `OtherTaxBase = 0`** — buka PPN Keluaran di portal nyata; baris dengan DPP NL 0 plus DPP/PPN valid harusnya tidak masuk daftar "DPP NL Berbeda".
2. **Warna pill** — ringkasan "Semua faktur sesuai" (tint hijau) dan ringkasan peringatan (tint kuning) harus terbaca jelas; ukuran dihitung ~5-6:1, tapi piksel di portal adalah hakim akhir.
3. **Ctrl+Shift+B** — panel terbuka di **keempat grid e-Faktur PPN** (PPN Keluaran, PPN Masukan, Retur PPN Keluaran, Retur PPN Masukan), dan di halaman lain (mis. Bukti Potong) event dibiarkan lewat untuk portal. (Snapshot 2026-10-13: panel hanya terbuka di PPN Keluaran dan PPN Masukan — gate waktu itu `isVatInvoicePage()`; sekarang gate-nya `isPanelPage()`, ADR-0025/ADR-0028.)

---

## Prioritas Rekomendasi

| # | Temuan | Severity | Effort |
|---|--------|----------|--------|
| 1 | Jalankan loop manual §8 (perilaku checker baru, warna pill, pintas panel) sebelum rilis berikutnya | Info | Low |
| 2 | ~~Extend batch export ke PPN Masukan: gate `main-actions`, copy konfirmasi, nama file `FPM-<tahun>`, satu sampel Network untuk `PropertyName` masa, README + microsite di commit yang sama~~ — ✅ selesai pada ADR-0019 + ADR-0043: gate `isEfakturPage()` di empat grid e-Faktur PPN, keempatnya terukur | ~~Low (fitur)~~ | ~~Medium~~ |
| 3 | Dalami test pada gap coverage §5, lalu naikkan lantai ratchet — sesuai AGENTS.md, tidak boleh dilonggarkan demi build hijau | Low | Medium |
| 4 | ~~Saat berikutnya menyentuh AGENTS.md: hapus kalimat "injected.css still ships the same defect"~~ — ✅ selesai pada `c934fdd` | Info | Trivial |
| 5 | Refresh audit ini setelah rilis berikut — cadence yang sudah dipegang sejak audit pertama 2026 | Info | Trivial |

**Kesimpulan:** tidak ada blocker. Utang struktural dari audit 2026-09-24 sudah lunas semuanya; sisa pekerjaan berbentuk asimetri fitur (batch Masukan) dan disiplin yang sudah punya rumah di toolchain (coverage boot-wiring, banding ratchet, loop manual portal).
