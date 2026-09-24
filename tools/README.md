# Diagnostik Pencarian Referensi

Skrip console untuk menyelidiki laporan: **pencarian referensi dengan ≤ 6 karakter instan, tetapi > 6 karakter sangat lama** (muncul setelah portal sempat gangguan). Tujuannya menjawab satu pertanyaan dengan data: lambatnya di **server DJP**, atau di **ekstensi/portal**.

## Alur pencarian referensi (untuk konteks)

1. `main.ts` menangkap `keyup` Enter pada `#ch-toolbar-filter-reference` / `#ch-grid-filter-reference`.
2. `postToScraper({ type: "SET_SERVER_FILTER", field: "Reference", value, matchMode: "startswith" })` → `scraper.ts` menyimpan `filterState.Reference` dengan mode tersebut.
3. `triggerSearch()` mengklik tombol cari portal setelah 100 ms.
4. Request grid milik portal lewat patch XHR `injectFilters()` (`scraper-xhr-patches.ts`) menyuntikkan filter `Reference` bermode `startswith` ke body, lalu portal merender hasilnya.
5. Bila hasilnya 0 baris, `scraper.ts` mengirim `REFERENCE_SEARCH_NOT_FOUND` dan panel melaporkan "tidak ditemukan" — pencarian berhenti, tanpa pencarian ulang (lihat `docs/adr/0012-reference-search-stops-on-empty-prefix.md`).

Jadi durasi pencarian = waktu server menjawab query filter + waktu portal merender + waktu ekstensi mengklik. Skrip ini memisahkan ketiganya.

> Catatan: langkah 2 dan 4 sudah memakai `startswith` **sejak perbaikan 24 September 2026**. Skrip ini sengaja tetap mengukur `contains` sebagai pembanding — pengukuran aslinya yang membuat perubahan diputuskan, dan sejak ADR-0012 mode itu tidak pernah dikirim ekstensi lagi.

## Cara pakai

1. Buka halaman e-Faktur PPN Keluaran dan pastikan daftar faktur sudah tampil minimal sekali.
2. (Opsional) ketik referensi yang lambat di kolom **Cari Referensi** Cindieh, atau isi `CONFIG.nilaiPanjang` di awal skrip.
3. DevTools → Console → tempel seluruh isi `reference-search-diagnostic.js` → Enter (Chrome mungkin meminta konfirmasi *allow pasting*).
4. Tunggu sampai blok **KESIMPULAN** muncul.

## Apa yang diukur

| Jalur | Cara | Artinya |
|---|---|---|
| `ekstensi` | Skrip mengisi kolom Cari Referensi + mengirim `keyup` Enter, lalu memantau mutasi tabel | Durasi yang dirasakan pengguna (end-to-end) |
| `api (iframe bersih)` | Body template dari request grid portal dikirim ulang dari **iframe same-origin** (content script tidak berjalan di frame itu, jadi patch XHR/fetch Cindieh tidak ada) | Murni waktu server DJP, tanpa filter suntikan ekstensi dan tanpa render portal |

Karena body request disalin dari request portal sendiri, request uji memakai parameter grid yang asli (termasuk header sesi pengguna). Nilai `Authorization`/`Cookie` tidak pernah dicetak ke console.

Perekam juga mencatat **semua** XHR/fetch di jendela waktu (kolom `request lain`), bukan hanya request grid — portal mengirim lookup tambahan (`getSingleReferenceData …`) tepat setelah grid dimuat, dan itu bisa jadi tempat waktu tunggu bersembunyi.

Variabel uji: panjang 5, 6, 7, dan panjang penuh; `MatchMode` `contains`, `startswith`, dan `equals` (hanya pada nilai panjang) — `startswith`/`equals` diuji sebagai **kandidat perbaikan**, bukan sebagai perilaku sekarang. Nilai selalu dinormalkan ke huruf besar karena `main.ts` mengirim `value.toUpperCase()`; satu probe tambahan memakai huruf asli sebagai kontrol untuk menguji sensitivitas huruf di server.

Arti kolom: `durasi ms` pada jalur ekstensi = jendela pengukuran (Enter → request grid selesai → jeda singkat), bukan repaint terakhir — portal bisa menggambar spinner jauh sebelum data tiba (rinciannya ada di `hasil.ekstensi[].stabilMs`). Kolom `total` diambil dari field numerik pertama yang ditemukan di `Payload` dan **belum tentu jumlah baris**; pakai kolom `baris` (`Payload.Data.length`) sebagai acuan. `ttfb` terisi hanya bila iframe menyediakan Resource Timing.

## Cara membaca KESIMPULAN

- **"LAMBAT DI SERVER DJP"** → request terisolasi juga lambat. Bukan bug ekstensi; ini sisi server/portal. Langkah berikutnya: pindah ke match mode cepat (lihat temuan di bawah) atau cari via prefix lalu saring lokal.
- **"SERVER CEPAT"** → biaya ada di jalur portal/ekstensi (klik tombol, render Angular, atau retry). Periksa kolom `request grid` (lebih dari 1 = portal mengirim beberapa request) dan kolom `ms request` vs `durasi ms`.
- **"ADA JALAN CEPAT"** → salah satu match mode alternatif jauh lebih cepat pada nilai panjang. Kandidat perbaikan di `SET_SERVER_FILTER`; sejak ADR-0012 ekstensi tidak lagi mengirim fallback `contains` bila hasilnya 0 baris.
- **`hasil cocok = TIDAK`** → filter referensi tampak tidak diterapkan pada request portal (ada baris hasil yang tidak memuat nilai yang dicari).

## Hasil diagnostik 24 September 2026 (portal Coretax)

Halaman e-Faktur PPN Keluaran, sesi pengguna sendiri, `Rows: 10`. Run 1 dan 2 memakai nilai uji `EE-0309`; run 3 memakai `EE-0300` (referensi yang benar-benar ada, hasilnya 1 baris):

| Uji (API terisolasi, iframe bersih) | Run 1 (`EE-0309`) | Run 2 (`EE-0309`) | Run 3 (`EE-0300`) |
|---|---|---|---|
| `contains`, 5 karakter (`EE-03`) | 0,23 s | 0,29 s | **24,8 s** |
| `contains`, 6 karakter (`EE-030`) | 0,19 s | **61,8 s** | 0,21 s |
| `contains`, 7 karakter | **100,6 s** | **96,1 s** | **96,9 s** (1 baris) |
| `startswith`, 5 / 6 / 7 karakter | 0,16 / 0,18 / 0,14 s | 0,14 / 0,26 / 0,14 s | 0,09 / 0,26 / 0,15 s (7 kar. → 1 baris) |
| `equals`, 7 karakter | ≈ 0,1 s | 0,11 s | 0,10 s (**0 baris**) |
| Jalur ekstensi (request grid portal) | 0,5 s (6 kar.) · 98,8 s (7 kar.) | **21,0 s (6 kar.)** · 100,8 s (7 kar.) | 1,07 s (6 kar.) · **96,6 s (7 kar.)** |

Kesimpulan yang bisa dipertanggungjawabkan:

1. **Lambatnya di server DJP, bukan di kode Cindieh.** Jalur ekstensi pada run 3 = 96 592 ms sementara request identik lewat iframe bersih = 96 895 ms; selisihnya di bawah 1 s (≈ 0,3 %), yaitu delay klik 100 ms + render Angular + jitter jaringan. Overhead ekstensi/portal tidak terukur di skala ini — **bukan** tempat masalahnya.
2. **Yang menentukan adalah `MatchMode`, bukan panjang nilai.** `contains` adalah jalur lambat dan biayanya liar: 5 karakter pernah 24,8 s (run 3), 6 karakter pernah 61,8 s (run 2), tapi 6 karakter juga pernah 0,19–0,21 s (run 1 & 3). Sementara `startswith` konsisten 0,09–0,26 s di semua panjang dan ketiga run. Jadi "≤ 6 cepat, > 6 lambat" hanyalah gejala: nilai pendek kadang kebetulan lewat jalur cepat.
3. **Kandidat perbaikan: `startswith`, bukan `equals`.** Pada nilai 7 karakter, `equals` selalu mengembalikan **0 baris** ("EE-0300" baru awalan dari referensi lengkap), sedangkan `startswith` mengembalikan baris yang benar dalam 0,135–0,149 s. Perbaikan yang diterapkan: kirim `MatchMode: "startswith"`; sejak ADR-0012 hasil 0 baris dilaporkan "tidak ditemukan", bukan diulang dengan `contains`.

**Verifikasi setelah perbaikan (24 September 2026):** pencarian referensi lewat Cindieh di portal Coretax dikonfirmasi **sudah cepat** oleh pengguna pada portal asli. Perbaikannya: mode `startswith` selalu, tanpa fallback `contains` (lihat [ADR-0012](../docs/adr/0012-reference-search-stops-on-empty-prefix.md)).

Temuan sampingan: filter `Reference` di server tampak **case-sensitive** (nilai huruf kecil → 0 baris). `main.ts` sudah mengirim `value.toUpperCase()` — jangan hapus normalisasi itu, dan replika di skrip ini meniru hal yang sama. Kolom `request lain` tetap 0 di ketiga run, jadi `getSingleReferenceData … timer ended` yang muncul di console portal bukan request jaringan (cache internal portal, ~300 ms lalu ~45 ms pada pencarian berikutnya).

## Alat bantu cepat (sementara)

```
__cindiehRefDiag.cariReferensi("EE-0309/07/26")
```

Mencari lewat **prefix ≤ 6 karakter** (jalur cepat) lalu menyaring hasil di sisi skrip, dan mencetak No Faktur/Referensi/Tanggal/Pembeli/DPP/PPN. Nomor di kolom **No Faktur** bisa ditempel ke filter **No. Faktur** Cindieh untuk unduh PDF massal selama pencarian panjang masih bermasalah.

Perintah lain:

```
__cindiehRefDiag.jalankan()   // ulangi seluruh pengukuran
__cindiehRefDiag.hasil        // data mentah (JSON) untuk dikirim ke developer
__cindiehRefDiag.pulihkan()   // lepas semua patch skrip ini dari halaman
```

## Kepatuhan

- Belasan request, selalu berurutan (tidak pernah paralel), jeda antar request dari `CONFIG.jedaMs` (default 700 ms).
- `Rows` request uji mengikuti `CONFIG.rows` (default 10, sama dengan grid portal). `cariReferensi()` memakai 100 (batas maksimum opsi UI portal) — bukan di atas batas di [RATE_LIMITING.md](../RATE_LIMITING.md).
- Hanya membaca data milik sesi login pengguna sendiri.

Skrip ini alat diagnostik manual (tidak ikut ter-bundle ke `dist/`); `pnpm typecheck`, `pnpm test`, dan `pnpm lint` tidak mencakup direktori `tools/`.
