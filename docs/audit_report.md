# Audit Menyeluruh — Cindieh Extension v2.2.0 (2026-10-13)

**Tanggal audit:** 2026-10-13
**Audit sebelumnya:** 2026-09-24 (mencakup state v2.0.0). Audit ini mencakup rilis **v2.1.0 (2026-09-25)**, **v2.2.0 (2026-10-13)**, dan empat commit setelah rilis 2.2.0.
**Batas audit:** commit `0c2fc06` (fix(ui): paint the tint pill text from text-safe -ink twins).
**Hasil validasi otomatis:** ✅ TypeScript 0 error · ✅ 1.544/1.544 test pass (53 file) · ✅ ESLint 0 error · ✅ Build Chrome & Firefox sukses · ✅ Coverage ratchet hijau (88.04 / 82.05 / 84.16 / 89.63 terhadap lantai 87.7 / 81.3 / 83.7 / 89.3).

**Ruang lingkup:** seluruh `src/`, `popup/`, `styles/`, `microsite/`, `manifest.json`, `tools/`, dan toolchain. Sejak audit sebelumnya: **ADR-0013** (SheetJS lazy chunk), **ADR-0014** (`run-lifecycle.ts` menggantikan `ContentState`), **ADR-0015** (satu deklarasi per source di `export-source.ts`), **ADR-0016** (identitas baris dari `RecordId`), **ADR-0017** (hasil besar melintasi bridge dalam chunk), **ADR-0018** (ekspor satu tahun sebagai satu Run), plus situs publik `microsite/` dengan guard anti-drift, panel popup preferensi lengkap, notifikasi penyelesaian yang membawa pengguna kembali ke halaman asal saat toast diklik, dan Pengecekan Keakuratan Nilai yang kini jalan di PPN Masukan juga.

> Catatan angka: jumlah test (53 file / 1.544 kasus), angka coverage, dan hasil build diambil langsung dari `vitest`, `tsc`, `eslint`, dan `build.cjs` pada 2026-10-13 di commit `0c2fc06` — bukan dari dokumentasi rilis.

---

## Ringkasan Eksekutif

Proyek dalam kondisi **sehat**. Tidak ada temuan berseverity **High** atau **Medium**. Seluruh tujuh rekomendasi audit 2026-09-24 **selesai** — dua di antaranya (persistensi setelan Pengecekan dan pemisahan tab Pengecekan) bergabung menjadi satu refactor struktural yang merapikan panel itu sendiri (`ui-checker.ts` kini punya suite render sendiri), dan satu temuan INFO (`OtherTaxBase = 0`) kini ditutup dengan bukti portal nyata, bukan dibiarkan terbuka. Tidak ada blocker rilis.

Tiga tema sisa yang layak dicatat:

- **Asimetri fitur batch**: ekspor satu tahun hanya aktif di PPN Keluaran, padahal `scrape-batch.ts` sengaja ditulis agnostik terhadap source (kode masa berasal dari request yang ditangkap portal, bukan yang disintesis). Perluasannya ke PPN Masukan kebanyakan soal gate, teks konfirmasi, dan verifikasi satu sampel body request di portal nyata.
- **Gap coverage yang sudah terdokumentasi** (`scraper.ts`, `downloader.ts`, `ui-filters.ts`, jalur cabang `main.ts`/`ui-comparer.ts`) praktis tidak bergerak — logika murninya sudah terpisah dan penuh test; yang tersisa adalah wiring, dan AGENTS.md sendiri mencatatnya sebagai gap yang diketahui.
- **Dua perbaikan hari ini**: CI kini membangun kedua browser (sebelumnya build hanya jalan bila ada yang mengingatnya secara lokal), dan defect kontras pill pada `injected.css` (yang AGENTS.md catat "out of scope untuk mikro-situs") sudah diperbaiki dengan cara yang sama seperti mikro-situs memperbaiki mirror-nya — kalimat defect itu di AGENTS.md kini usang dan boleh dihapus.

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

Tiga permission inti plus `notifications` opsional yang diminta saat saklar dinyalakan; `host_permissions` dan `web_accessible_resources` tetap hanya `coretaxdjp.pajak.go.id`; ADR-0007 (exposure token bridge) dan ADR-0008 (injeksi satu kali) tak berubah. Guard `shouldProcessPageMessage` tidak melemah: property test origin/direction masih 19 kasus di `postmessage.origin.property.test.ts`, dan audit ini tidak melihat adanya jalan pintas baru.

### [INFO] Permukaan baru dari chunk transfer (ADR-0017) ✅

`SCRAPE_DATA_CHUNK` menambah satu tipe pesan MAIN → isolated. Pemindahannya dijaga oleh modul transfer dengan kontrak eksplisit: completion menyebut`dataChunks`, dan transfer yang tidak lengkap **dilaporkan** bukan di-settle sebagai hasil lengkap. Tidak ada kanal lintas world lain yang terbuka.

### [INFO] Notifikasi penyelesaian ✅

`completion-notice.ts` membangun dan memvalidasi record sebelum dipublikasikan; toast yang diklik kembali ke halaman asal via `notificationTabPattern` (pola SPA-stabil: origin plus dua segmen path pertama), perintah "buka panel" dikirim lewat seam storage yang sama dengan perintah popup lain, dan id toast yang bukan `cindieh-completion-` diabaikan. Toast yang mengalah worker-nya kehilangan mapnya dan only falls back ke tab portal mana pun — perilaku yang didokumentasikan, bukan cacat.

### [INFO] Permintaan tetap minimal ✅

Tidak ada permission baru sejak audit lama. Halaman `privacy.html` memeriksa tabel izinnya dua arah terhadap `manifest.json` di CI, jadi satu permission tidak bisa tayang atau menghilang tanpa salah satu sisi merah.

### [INFO] Baru: CI membangun kedua browser ✅ (commit `5e8f91d`)

Sebelumnya build hanya dijalankan seseorang secara lokal sebelum rilis; kini `build:chrome` dan `build:firefox` jalan di setiap push/PR, jadi perubahan `build.cjs` atau rewrite manifest per-browser yang hanya Firefox kena gagal merah di PR, bukan di hari rilis.

---

## 3. Kualitas Kode & Temuan Baru

### [LOW] Gap coverage yang terdokumentasi, praktis diam di tempat

**File:** [scraper.ts](src/content/scraper.ts), [downloader.ts](src/content/downloader.ts), [ui-filters.ts](src/content/ui-filters.ts), [main.ts](src/content/main.ts), [ui-comparer.ts](src/content/ui-comparer.ts), [ui-panel.ts](src/content/ui-panel.ts)

Ada yang naik: `ui-checker.ts` 97.31% stmts / 83.33% branch dan `checker-logic.ts` 98% statement menutup sebagian besar gap panel lama. Yang tersisa adalah angka yang AGENTS.md sudah catat sebagai gap yang diketahui, diukur ulang hari ini: `scraper.ts` 39.39% stmts / **28.73% branch** (wiring IIFE MAIN-world), `downloader.ts` 44.44% (dispatch nama PDF), `ui-filters.ts` 55%, `main.ts` branch 49.25%, `ui-comparer.ts` branch 56.32%, `ui-panel.ts` 73.91%, dan `exporter.ts` funcs 56% (entry point unduh yang belum teruji). Komposisinya sama dengan catatan AGENTS.md — angka menyusul, bukan lompatan baru.

**Rekomendasi:** perluas harness two-worlds yang ada (`scraper-boot.unit.test.ts`, `main-boot.unit.test.ts`) sampai jalur yang belum teruji tercakup, lalu naikkan lantai ratchet — sesuai AGENTS.md, jangan pernah dilonggarkan sekadar memperhijaukan build.

### [LOW] Batch export terkunci satu halaman, padahal mesinnya agnostik

**File:** [main-actions.ts](src/content/main-actions.ts) (`isBatchPage: () => isOutputTaxPage()`), [scrape-batch.ts](src/content/scrape-batch.ts)

`scrape-batch.ts` sengaja tidak tahu halamannya: kode masa berasal dari request yang ditangkap, dan `overridesForPeriod()` mengganti satu nilai `Value` sambil membawa sisa filter apa adanya. Yang mengunci fitur ini ke PPN Keluaran hanya gate di `main-actions`, teks konfirmasi, nama file, dan README/microsite (yang mesti ikut diubah dalam commit yang sama — dijaga `microsite-sync`). Untuk **PPN Masukan**, satu hal perlu diukur di portal nyata: nilai `PropertyName` filter masa pada body request daftar PPN Masukan. `TaxInvoicePeriod` diharapkan dipakai pola yang sama, tapi aturan proyeknya sendiri adalah mengukur, bukan mengasumsikan.

**Rekomendasi:** satu sampel Network dari portal memutuskan itu; sisanya gate + copy + nama file + sinkronisasi README/microsite.

### [INFO] Panel kini bisa dibuka keyboard (commit `d921003`)

Audit lama menandai panel sebagai mouse-only; kini `Ctrl+Shift+B` membukanya. Pintasan itu memakai event `ch:compare-open` yang sama dengan tombol toolbar (semantik on/off panel tetap satu sumber), digate `isVatInvoicePage()` — predikat yang sama yang `ui-panel.ts` pakai untuk halaman tempat dua tab itu hidup. README dan microsite memuat baris pintas itu dalam commit yang sama, jadi guard sync-nya hijau.

### [INFO] Defect kontras `injected.css` ditutup di pihak extension juga (commit `0c2fc06`)

AGENTS.md mencatat defect pill `--ch-diff`-pada-`--ch-diff-tint` di `injected.css` sebagai bug yang sama dengan yang dikoreksi mikro-situs, tapi "out of scope" — mirror-nya sudah memakai token `-ink`, sheet aslinya belum. Kini sheet aslinya juga: `--ch-match-ink`, `--ch-diff-ink`, dan `--ch-bad-ink` masuk `:root` `injected.css` dengan nilai yang sama dengan yang token mirror mikro-situs tulis (hue/saturation sama, lightness di-solve ke 5:1), dan tiga situs teks yang sebelumnya gagal AA (`summary-ok`, `summary-warn`, `status-error`) melepas token dasar. Latar, border, dan pill `--ch-info` tetap token dasar karena sudah 4.5:1. Perbaikan ini tidak menggerakkan `microsite-sync`: token dasar tak berubah, jadi pemeriksaan kesetaraan sepuluh pasang tetap hijau. **Catatan AGENTS.md "injected.css still ships the same defect" kini usang** — lihat Prioritas #4.

### [INFO] Tool pengukuran portal kini ada di repo

`tools/` memuat diagnostic masa-batch (commit `9936a9f`) yang mengukur aturan `scrape-batch` langsung terhadap portal. Sampel Network yang dibutuhkan rekomendasi batch-Masukan di atas bisa diambil dengan jalur yang sama — pola "diukur, bukan diasumsikan" sudah punya tempat kerjanya.

### [INFO] CHANGELOG sudah sinkron

Audit lama mencatat CHANGELOG berhenti di 2.0.0. Kini sampai 2.2.0 karena alur release-it; tidak ada temuan.

---

## 4. Arsitektur

### Status ADR

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
| Stateful module = factory + singleton | ✅ | `bridge`, `run-lifecycle`, `checkerView`, `checkerSession` |
| Teardown permukaan demi permukaan | ✅ | `teardownInterceptors()` dijaga per permukaan; `scraper-boot` membuktikannya dengan property setter yang melempar |
| Preferensi schema → guard → cache | ✅ | `extension-preferences.ts` satu schema; `preferences.ts` satu translasi; popup hidup via `storage.onChanged` |
| Microsite tidak drift dari kode | ✅ | `microsite-sync.unit.test.ts` di CI; tabel izin diperiksa dua arah; page list, popup, status legend juga dua arah |

---

## 5. Test Coverage

**Total:** 53 file, 1.544 kasus, semuanya hijau (diukur 2026-10-13, commit `0c2fc06`).

| Area | File test khas | Catatan |
|------|----------------|---------|
| Batch & lifecycle | `scrape-batch.unit` 13, `scrape-batch-helpers.unit` 26, `run-lifecycle.unit` 29 | ADR-0014/0018; masa kosong di tengah masa berisi dilaporkan terpisah dari masa yang gagal diambil |
| Checker & panel Pengecekan | `checker-logic.unit` 94, `ui-checker.unit` 29 | Termasuk 5 kasus `OtherTaxBase = 0` yang baru; `ui-checker` drivable tanpa overlay |
| Export & source | `export-source.unit` 18, `export-source.matrix.unit` 32, `exporter.*` 86 | Satu deklarasi per source; matrix menutup kolom dan dua ejaan nomor bukti potong |
| Persistensi & notifikasi | `extension-preferences.unit` 36, `preferences.unit` 13, `completion-notice.unit` 24 | Normalizer per nilai + guard baca/gagal + ringkasan yang tidak mengumumkan run sebagian sebagai sukses |
| Pintasan & shell panel | `shortcuts.unit` (3 binding), `ui-panel`/`ui-comparer` | Ctrl+Shift+B digate `isVatInvoicePage` |
| Wiring dunia | `scraper-boot.unit` 20, `main-boot.unit` 33 | Pembuktian patch/teardown kedua dunia di entry script |
| Microsite | `microsite-sync.unit` 79 | Kontra-drift fakta, struktur halaman, dan 86 pasang kontras AA — termasuk `404.html` |

Known gap yang menahan rata-rata, sengaja begitu (angka hari ini):

| Area | % Stmts | % Branch | Penjelasan |
|------|---------|----------|------------|
| `scraper.ts` | 39.39 | 28.73 | IIFE wiring MAIN-world; dijaga `scraper-boot` |
| `downloader.ts` | 44.44 | 55.31 | Dispatch nama PDF |
| `main.ts` | 71.71 | 49.25 | SPA nav + event wiring |
| `ui-filters.ts` | 55.00 | 55.68 | Toolbar filter DOM |
| `ui-comparer.ts` | 89.71 | 56.32 | Jalur open/close overlay |
| `ui-panel.ts` | 73.91 | 54.54 | Konstruksi DOM shell |
| `exporter.ts` | 81.56 | 84.46 | funcs 56% — entry point unduh |
| `scraper-types.ts`, `xlsx-runtime.ts` | — | — | Di-exclude dengan sengaja (modul type-only; chunk hasil build ADR-0013) |

Rata-rata global: 88.04 stmts / 82.05 branch / 84.16 funcs / 89.63 lines — semuanya berada di atas lantai masing-masing.

---

## 6. Dependensi

Satu runtime dependency (`xlsx` 0.20.3 dari CDN SheetJS, pinned) tidak berubah sejak audit lama. DevDependencies tetap relevan: `@typescript/native ^7.0.2` sebagai compiler (ADR-0009), alias `typescript` = `npm:@typescript/typescript6@^6.0.2` untuk eslint — **jangan** dinaikkan ke `^7` langsung, lint bakal patah — serta `vitest ^4.1.5`, `esbuild ^0.25.12`, `eslint ^10.3.0`, `fast-check ^4.7.0`, `release-it ^21.0.2` + `@release-it/conventional-changelog ^12.0.0`, `archiver ^7.0.1`. Alias dan compiler harus diangkat berpasangan bila kelak di-upgrade.

---

## 7. Verifikasi Build & Toolchain

| Langkah | Perintah | Hasil |
|---------|----------|-------|
| Typecheck | `pnpm typecheck` | ✅ 0 error |
| Test | `pnpm test` | ✅ 1.544/1.544 (53 file) |
| Lint | `pnpm lint` | ✅ 0 error |
| Build Chrome | `pnpm build:chrome` | ✅ manifest dioptimalkan + aset tersalin |
| Build Firefox | `pnpm build:firefox` | ✅ — dan kini juga di CI, bukan lokal-saja |
| Coverage ratchet | `pnpm test:coverage` | ✅ semua di atas lantai |

Catatan pnpm 11+ (turunannya CI memakai pnpm 12): jalankan dengan `pnpm --config.verify-deps-before-run=false <cmd>` agar pre-run install tidak menabrak `ERR_PNPM_IGNORED_BUILDS`. `dist/` di-gitignore dan diregenerasi build; tidak ada yang diedit langsung di sana.

---

## 8. Verifikasi Portal (manual, belum tergantikan unit test)

Satu loop manual tersisa sebelum rilis berikutnya — unit test menjangkau seam dan keputusan, bukan piksel di layar dan perilaku jalan di portal:

1. **Checker `OtherTaxBase = 0`** — buka PPN Keluaran di portal nyata; baris dengan DPP NL 0 plus DPP/PPN valid harusnya tidak masuk daftar "DPP NL Berbeda".
2. **Warna pill** — ringkasan "Semua faktur sesuai" (tint hijau) dan ringkasan peringatan (tint kuning) harus terbaca jelas; ukuran dihitung ~5-6:1, tapi piksel di portal adalah hakim akhir.
3. **Ctrl+Shift+B** — panel terbuka di PPN Keluaran dan PPN Masukan, dan di halaman lain (mis. Bukti Potong) event dibiarkan lewat untuk portal.

---

## Prioritas Rekomendasi

| # | Temuan | Severity | Effort |
|---|--------|----------|--------|
| 1 | Jalankan loop manual §8 (perilaku checker baru, warna pill, pintas panel) sebelum rilis berikutnya | Info | Low |
| 2 | Extend batch export ke PPN Masukan: gate `main-actions`, copy konfirmasi, nama file `FPM-<tahun>`, satu sampel Network untuk `PropertyName` masa, README + microsite di commit yang sama | Low (fitur) | Medium |
| 3 | Dalami test pada gap coverage §5, lalu naikkan lantai ratchet — sesuai AGENTS.md, tidak boleh dilonggarkan demi build hijau | Low | Medium |
| 4 | Saat berikutnya menyentuh AGENTS.md: hapus kalimat "injected.css still ships the same defect" — usang sejak `0c2fc06` | Info | Trivial |
| 5 | Refresh audit ini setelah rilis berikut — cadence yang sudah dipegang sejak audit pertama 2026 | Info | Trivial |

**Kesimpulan:** tidak ada blocker. Utang struktural dari audit 2026-09-24 sudah lunas semuanya; sisa pekerjaan berbentuk asimetri fitur (batch Masukan) dan disiplin yang sudah punya rumah di toolchain (coverage boot-wiring, banding ratchet, loop manual portal).
