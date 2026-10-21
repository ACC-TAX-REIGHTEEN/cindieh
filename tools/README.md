# Diagnostik Portal

Skrip console yang ditempel di DevTools untuk menjawab pertanyaan tentang **portal Coretax** dengan pengukuran, bukan tebakan. Semuanya alat investigasi manual: tidak ikut ter-bundle ke `dist/`, dan `pnpm typecheck`, `pnpm test`, serta `pnpm lint` **tidak mencakup direktori `tools/`**.

| Skrip | Pertanyaan yang dijawab | Status |
|---|---|---|
| [`reference-search-diagnostic.js`](reference-search-diagnostic.js) | Kenapa pencarian referensi ≤ 6 karakter instan tapi > 6 karakter sangat lambat — lambatnya di server DJP atau di ekstensi/portal? | Sudah dijalankan 24 Sep 2026, hasilnya jadi dasar ADR-0012 |
| [`masa-batch-diagnostic.js`](masa-batch-diagnostic.js) | Apakah fitur **ekspor satu tahun sekaligus** (batch lintas masa pajak) mungkin di portal, atau terhalang batas portal? Apakah batas halaman server bisa memotong data secara senyap? Filter apa yang dipakai tiap grid, dan apakah penjaga sweep menerima permintaannya? | Dijalankan Okt 2026 di PPN Keluaran — hasilnya menentukan ADR-0018 dan fitur ekspor satu tahun (77dde73). Fase 1b mencetak **verdict penjaga sweep** per grid (`__cindiehMasaDiag.jalankan([1])` atau `__cindiehMasaDiag.verdictFilter()`); jalankan di kedua grid Retur lalu isi barisnya di tabel **Pengukuran filter per grid** di bawah — itulah satu-satunya cara sebuah grid bisa disapu lagi (ADR-0019). PPN Masukan sudah terukur (21 Okt 2026, ADR-0043) |

---

## Diagnostik Batch Masa Pajak

> **Status: dijalankan pada portal Coretax, Oktober 2026.** Cakupan pengukuran:
> endpoint e-Faktur PPN Keluaran, masa TD.00701–TD.00703 tahun 2026 (3 dari 12
> masa — batas tahun baru Des→Jan belum diukur). Hasil lengkap di bagian
> "Hasil" di bawah. Per grid, fase 1 + 1b + 2 yang dijalankan: hasilnya
> tercatat di tabel **Pengukuran filter per grid**.

### Pertanyaan yang harus dijawab

Ide fitur "ekspor satu tahun sekaligus" yang berarti menjalankan scrape yang sama berulang kali untuk 12 masa. Supaya tidak membangun sesuatu yang portal tidak izinkan, empat hal diukur dulu:

| # | Pertanyaan | Kenapa menentukan |
|---|---|---|
| **A** | Apakah masa bisa difilter **dari sisi server**? | Kalau filter masa tidak ada di `body.Filters`, fitur tidak mungkin lewat jalur ini. Nama `PropertyName` **harus dibaca dari request portal sendiri**, bukan ditebak — berbeda antar grid (e-faktur vs SPT vs Bukti Potong). |
| **B** | Apakah server menghormati `Rows`? | `scrapePaginated()` ([scraper-actions.ts](../src/content/scraper-actions.ts)) berhenti saat `rows.length < step`, dengan `step` = 500 (e-faktur) / 1000 (SPT). Kalau server **meng-clamp** `Rows` di bawah `step`, halaman pertama sudah terlihat "habis", loop berhenti, dan run tetap melaporkan "Complete" dengan data **terpotong tanpa error**. Ini risiko paling senyap di seluruh jalur scrape, dan harus tahu sebelum fitur apa pun yang bergantung pada kelengkapan. |
| **C** | Apakah respons membawa jumlah total yang bisa dipercaya? | Kalau ada total yang benar, loop bisa memeriksa kelengkapan terhadap angka itu, bukan cuma menebak dari "halaman ini pendek". Skrip referensi menemukan `Payload.Total` "belum tentu jumlah baris" — fase 2 membandingkannya dengan baris nyata agar ketahuan field mana yang benar. |
| **D** | Berapa lama satu masa, dan adakah jebakan setelah banyak request? | Kalau satu masa butuh 60 detik, dua belas masa = 12 menit. Itu menentukan fitur harus punya progres per masa, bisa dijeda, dan jelas tidak boleh berjalan diam-diam. |

Skrip juga melaporkan apakah baris punya `RecordId` / `AggregateIdentifier`. `getRowDedupeKey()` ([scraper-helpers.ts](../src/content/scraper-helpers.ts)) jatuh ke `stableStringify()` yang rekursif dan mahal kalau keduanya kosong — ini yang menentukan seberapa serius biaya dedupe pada grid tersebut.

### Cara pakai

1. Buka halaman grid di portal Coretax (e-Faktur PPN Keluaran, atau grid lain yang mau diuji).
2. Pilih **satu** masa pajak di filter portal → klik **Cari** → biarkan tabel tampil. **Jangan** ganti masa setelahnya; skrip mengambil template dari request grid terakhir.
3. DevTools → Console → tempel seluruh isi `masa-batch-diagnostic.js` → Enter (Chrome mungkin meminta konfirmasi *allow pasting*).
4. Tunggu blok **KESIMPULAN**. Kalau tabel sudah tampil sebelum skrip ditempel, jalankan manual `__cindiehMasaDiag.jalankan()`.
5. Untuk menguji grid/masa lain: pilih masa baru di portal, lalu `__cindiehMasaDiag.templateUlang()` dan jalankan ulang.

Perintah:

```
__cindiehMasaDiag.jalankan()            // seluruh fase 1-4
__cindiehMasaDiag.jalankan([1, 3])      // hanya fase yang dipilih
__cindiehMasaDiag.fase2()               // probe batas Rows saja
__cindiehMasaDiag.fase3(["TD.00701"])  // satu masa, diukur
__cindiehMasaDiag.hasil                 // data mentah (JSON)
__cindiehMasaDiag.templateUlang()       // kosongkan template, ambil lagi
__cindiehMasaDiag.pulihkan()            // lepas semua patch skrip
```

### Cara membaca KESIMPULAN

Blok **Jawaban singkat** meringkas tiga hal yang harus diputuskan sebelum fitur dikerjakan:

- **Batch lintas masa lewat filter server: YA / belum terbukti.** Kalau `YA`, jalur teknisnya ada: `injectFilters()` ([scraper-xhr-patches.ts](../src/content/scraper-xhr-patches.ts)) sudah generik terhadap `PropertyName`, `SET_SERVER_FILTER` sudah ada di bridge, dan `xhrRequest()` sudah bisa mengirim ulang `First`/`Rows`. Kalau belum terbukti, jangan mulai kodenya — cari dulu arah lain.
- **Batas `Rows` portal perlu ditangani: YA / tidak terlihat.** `YA` berarti ada pemotongan senyap yang harus diperbaiki **lebih dulu**, karenaEXPORT yang diam-diam kurang baris lebih buruk daripada error.
- **Jumlah total dari server bisa dipakai: YA / tidak.** `YA` membuka jalan ke pemeriksaan kelengkapan yang jujur; `tidak` berarti andalan pada heuristik "halaman pendek" tetap satu-satunya opsi, dan itu perlu dinyatakan terbuka di UI.

### Hasil

*(dijalankan Oktober 2026 — 3 masa pertama TD.00701–TD.00703, tahun 2026, endpoint e-Faktur PPN Keluaran)*

| Pertanyaan | Jawaban | Angka pendukung |
|---|---|---|
| A. Filter masa di server? | **YA** | `TaxInvoicePeriod` (TD.00708) dan `TaxInvoiceYear` (2026) ada di `body.Filters`, MatchMode `equals`; masa TD.007MM = bulan MM — pola yang sama dikenali `tax-date.ts` |
| B. Server menghormati `Rows`? | **YA, sampai 5000** | Keenam probe (10/100/500/1000/2000/5000) mengembalikan baris sebanyak yang diminta; 5000 baris selesai dalam 1.910 ms |
| C. Field total yang bisa dipercaya? | **TIDAK — ini yang genting** | `Payload.TotalRecords` = `Rows + 1` di semua probe (10→11, 100→101, 500→501, 1000→1001, 2000→2001, 5000→5001): angkanya mengikuti permintaan, bukan isi grid. Angka seperti itu juga menipu pembacaan total milik ekstensi sendiri — sudah ditambal di `readGridTotal` (3b2f1fb) |
| D. Durasi per masa / perkiraan 1 tahun? | ~14,7 ribu baris/masa | 44.237 baris untuk 3 masa; perkiraan 1 tahun ≈ 10 menit pada jeda 1,2 dtk milik skrip; ≈ 4 menit pada pacing ekstensi (`step` 500, jeda 100 ms) |
| Baris tanpa ID (beban `stableStringify`)? | **0 dari 44.237** | Setiap baris punya `RecordId` — kunci dedupe selalu O(1), tanpa fallback hash |
| Duplikat antara masa (Jan/Feb, Feb/Mar)? | **0** | 44.237 baris = 44.237 unik, dengan kunci yang persis sama dengan `mergeRows` |

**Belum terukur:** masa ke-4 sampai ke-12, khususnya batas tahun baru Des→Jan — kasus bukti kredit yang sempat masuk Januari tahun berikutnya, risiko duplikasi lintas periode yang paling mungkin. Fitur yang sudah dikirim menganggap hasil ini berlaku umum untuk masa yang belum diukur. Per grid, pengukurannya sendiri sudah tercatat di tabel dan di blok Hasil di bawah.

> **Fasa 2 tidak boleh diasumsikan sama antar endpoint.** Di PPN Masukan (21 Okt 2026) bentuk echo `Payload.TotalRecords`-nya **berbeda** dari PPN Keluaran, dan itu sempat membuat satu tahun yang lengkap dilaporkan "mungkin belum lengkap". Yang boleh diasumsikan sama hanya **bentuknya** (jawaban A dan bentuk kode masanya) — bentuk echo, durasi, dan jumlah baris per masa harus diukur per endpoint.

### Hasil — PPN Masukan (21 Okt 2026)

Dua sesi di grid e-Faktur PPN Masukan (`/einvoiceportal/api/inputinvoice/list`): satu dengan dua bulan dipilih di filter portal, satu dengan satu bulan.

| Pertanyaan | Jawaban | Angka pendukung |
|---|---|---|
| A. Filter masa di server? | **YA** | `TaxInvoicePeriod` ada di `body.Filters`, tapi nilainya **daftar** kode (`["TD.00709"]`) dengan MatchMode `contains` — bukan satu string seperti di PPN Keluaran. `TaxInvoiceYear` = `"2026"`, `equals` |
| B. Server menghormati `Rows`? | **YA** | 10→10 dan 100→100 tepat; di atas itu server mengembalikan **seluruh baris yang ada** (235 baris untuk satu masa, 369 untuk dua bulan) — bukan pemotongan diam-diam |
| C. Field total yang bisa dipercaya? | **TIDAK — dan bentuknya berbeda** | `Payload.TotalRecords` mengikuti permintaan: `Rows + 1` saat halamannya penuh (10→11, 100→101) dan **`Rows` sendiri** saat halamannya pendek (500→500, 1000→1000, 2000→2000, 5000→5000). Semuanya echo permintaan, tidak pernah jumlah baris. `readGridTotal` membuang keduanya — sebelumnya hanya bentuk `Rows + 1`, sehingga tiap masa yang lebih pendek dari 500 baris dilaporkan "mungkin belum lengkap" |
| D. Durasi per masa? | ~1,6 detik per masa | 3 masa dalam 5,0 detik pada jeda 1,2 dtk; satu tahun ≈ 0,5 menit |
| Baris tanpa ID (beban `stableStringify`)? | **0 dari 750** | Semua baris punya `RecordId` — kunci dedupe selalu O(1) |
| Duplikat antara masa? | **0** | 750 baris = 750 unik, dengan kunci yang persis sama dengan `mergeRows` |
| Apakah server menghormati filter yang ditulis ulang? | **YA** | Satu kode yang ditulis sebagai **string biasa** (dengan MatchMode milik filter itu sendiri) dikembalikan tepat: 334, 274, dan 142 baris untuk tiga masa berturut-turut, dan `TaxInvoicePeriod` tiap baris sama dengan kode yang diminta |
| Uji sungguhan di portal? | **YA** | Ekspor satu tahun dijalankan di portal pada 21 Okt 2026: 12 masa tercatat, 2.335 baris, dua masa tanpa baris (November, Desember — belum tiba), tanpa peringatan "mungkin belum lengkap". Dicoba dua kali: filter portal berisi **satu** bulan dan **beberapa** bulan; keduanya menyapu 12 masa |

### Pengukuran filter per grid (ADR-0019)

Ekspor satu tahun hanya bisa dijalankan kalau grid-nya punya baris di `MEASURED_SWEEP_FILTERS` ([scrape-batch.ts](../src/content/scrape-batch.ts)) **dan** request yang ditangkap membawa kedua filter itu: masa pajak dan tahun pajak. PPN Keluaran (6 Okt 2026) dan PPN Masukan (21 Okt 2026) yang punya baris — nama filternya sama (`TaxInvoicePeriod`/`TaxInvoiceYear`), tetapi PPN Masukan mengirim nilainya sebagai **daftar** kode, dan itu dicatat terpisah di ADR-0043. Dua grid Retur **ditolak** selama barisnya masih kosong — tidak ada lagi pintu "petunjuk nama": nama yang mirip, nilai yang berbentuk kode `TD.007MM`, atau tahun sebagai field body tidak cukup, karena pertanyaan yang harus dijawab (apakah endpoint ini menghormati filter itu?) hanya terjawab dengan mengukurnya di portal. Baris di bawah masih kosong = grid itu **belum bisa disapu sama sekali**.

Fase 1b menjawabnya per grid, memakai aturan penjaga yang disalin ke dalam skrip:

1. Buka halaman grid yang mau diukur, pilih **satu** masa di filter portal → **Cari** → biarkan tabel tampil.
2. Tempel `masa-batch-diagnostic.js` di Console.
3. `__cindiehMasaDiag.jalankan([1, 2])` (fase 1 + 1b + 2). Kalau templatenya sudah tertangkap: `__cindiehMasaDiag.verdictFilter()`.
4. Salin baris yang dicetak (formatnya sama dengan tabel di bawah) dan isi barisnya. Selama baris itu belum ada, verdictnya `DITOLAK — grid ini BELUM TERUKUR` — sama persis dengan yang dilakukan penyapu sungguhan.

Yang dicetak fase 1b: apakah grid ini punya baris terukur (dan barisnya apa), nama filter masa + nilainya bila barisnya cocok, nama filter tahun, **semua** filter yang ada di body — termasuk yang berkredit, mis. `PeriodCredit`, dan yang namanya mirip tapi bukan baris terukurnya — keputusan penjaga (DITERIMA/DITOLAK) beserta alasannya, dan dua belas kode masa yang akan disapu. Log yang sama muncul saat ekstensi menjalankan sweep sungguhan (`?chdebug=1`; baris `Sweep filters on <sumber>: …` di `scraper-actions.ts`), jadi penolakan di panel selalu bisa dicocokkan dengan pembacaan yang menyebabkannya.

| Halaman | Endpoint | Filter masa | Filter tahun | Penjaga | Rencana |
|---|---|---|---|---|---|
| e-Faktur PPN Keluaran | `/einvoiceportal/api/outputinvoice/list` | `TaxInvoicePeriod=TD.00708` (nama terukur, `MatchMode` `equals`) | `TaxInvoiceYear=2026` | DITERIMA — menyapu TD.00701..TD.00712 untuk tahun 2026 | TD.00701..TD.00712 |
| e-Faktur PPN Masukan | `/einvoiceportal/api/inputinvoice/list` | `TaxInvoicePeriod=["TD.00709"]` (nama terukur, `MatchMode` `contains`, nilainya **daftar** kode) | `TaxInvoiceYear=2026` (`equals`) | DITERIMA — menyapu TD.00701..TD.00712 untuk tahun 2026; nilainya ditulis ulang satu kode satu string, yang justru bentuk yang portal menghormati (ADR-0043) | TD.00701..TD.00712 |
| Retur PPN Keluaran | | | | **DITOLAK — belum terukur** (tidak ada barisnya) | |
| Retur PPN Masukan | | | | **DITOLAK — belum terukur** (tidak ada barisnya) | |

Aturan setelah sebuah baris terisi: barisnya masuk ke `MEASURED_SWEEP_FILTERS` di `scrape-batch.ts` **dan** dicatat di ADR-0019, bersama test yang membuktikan grid itu diterima sementara grid yang masih kosong tetap ditolak. Kalau satu grid ternyata memakai nama (atau bentuk nilai) lain, perubahan yang benar adalah **mempelajarinya** — nama filternya masuk baris itu, dan `periodPrefix` diperluas bersama testnya — bukan menambahkan kembali tebakan "petunjuk nama". Itulah yang terjadi di PPN Masukan: **namanya sama, bentuk nilainya yang baru** (daftar kode, bukan satu string), dan pembelajarannya ditulis sebagai ADR-0043 yang merujuk ADR-0019. Sebuah grid tanpa baris berarti fiturnya **mati** di halaman itu, bukan jalan dengan syarat.

> **Catatan cakupan:** fase 3-4 (durasi per masa, kebutuhan `RecordId`, duplikat antar masa) sengaja **tidak** diulang per grid — pertanyaannya terjawab untuk endpoint e-Faktur dan tidak berubah antar grid e-Faktur. **Fase 2 (batas `Rows` dan jumlah total yang bisa dipercaya) justru wajib diulang per grid**, karena bentuk echo `Payload.TotalRecords` ternyata **per endpoint**: PPN Keluaran menjawab `Rows + 1`, PPN Masukan menjawab `Rows` sendiri saat halamannya pendek (21 Okt 2026). Bentuk yang tidak dikenali akan lolos sebagai "jumlah asli" dan membuat satu tahun yang lengkap dilaporkan "mungkin belum lengkap".

### Kepatuhan

- Semua request **berurutan**, tidak pernah paralel, dengan jeda `CONFIG.jedaMs` (default 1.200 ms — lebih besar dari jeda normal karena ini sengaja menguji beban, bukan export normal).
- Hanya membaca data milik sesi login pengguna sendiri, memakai header yang sudah dipakai portal sendiri pada request grid-nya. Nilai `Authorization`/`Cookie` **tidak pernah** dicetak.
- Hanya memakai URL grid yang portal pakai sendiri; tidak ada URL tebakan. Fase 3 dibatasi `CONFIG.maxMasa` (default 12) supaya tidak berubah jadi pemuatan.
- Fase 2 sengaja menyentuh batas `Rows`. Itu memang tujuannya, tapi jangan jalankan berulang-ulang pada grid yang sama dalam waktu berdekatan.

---

## Diagnostik Pencarian Referensi

Skrip console untuk menyelidiki laporan: **pencarian referensi dengan ≤ 6 karakter instan, tetapi > 6 karakter sangat lama** (muncul setelah portal sempat gangguan). Tujuannya menjawab satu pertanyaan dengan data: lambatnya di **server DJP**, atau di **ekstensi/portal**.

### Alur pencarian referensi (untuk konteks)

1. `main.ts` menangkap `keyup` Enter pada `#ch-toolbar-filter-reference` / `#ch-grid-filter-reference`.
2. `postToScraper({ type: "SET_SERVER_FILTER", field: "Reference", value, matchMode: "startswith" })` → `scraper.ts` menyimpan `filterState.Reference` dengan mode tersebut.
3. `triggerSearch()` mengklik tombol cari portal setelah 100 ms.
4. Request grid milik portal lewat patch XHR `injectFilters()` (`scraper-xhr-patches.ts`) menyuntikkan filter `Reference` bermode `startswith` ke body, lalu portal merender hasilnya.
5. Bila hasilnya 0 baris, `scraper.ts` mengirim `REFERENCE_SEARCH_NOT_FOUND` dan panel melaporkan "tidak ditemukan" — pencarian berhenti, tanpa pencarian ulang (lihat `docs/adr/0012-reference-search-stops-on-empty-prefix.md`).

Jadi durasi pencarian = waktu server menjawab query filter + waktu portal merender + waktu ekstensi mengklik. Skrip ini memisahkan ketiganya.

> Catatan: langkah 2 dan 4 sudah memakai `startswith` **sejak perbaikan 24 September 2026**. Skrip ini sengaja tetap mengukur `contains` sebagai pembanding — pengukuran aslinya yang membuat perubahan diputuskan, dan sejak ADR-0012 mode itu tidak pernah dikirim ekstensi lagi.

### Cara pakai

1. Buka halaman e-Faktur PPN Keluaran dan pastikan daftar faktur sudah tampil minimal sekali.
2. (Opsional) ketik referensi yang lambat di kolom **Cari Referensi** Cindieh, atau isi `CONFIG.nilaiPanjang` di awal skrip.
3. DevTools → Console → tempel seluruh isi `reference-search-diagnostic.js` → Enter (Chrome mungkin meminta konfirmasi *allow pasting*).
4. Tunggu sampai blok **KESIMPULAN** muncul.

### Apa yang diukur

| Jalur | Cara | Artinya |
|---|---|---|
| `ekstensi` | Skrip mengisi kolom Cari Referensi + mengirim `keyup` Enter, lalu memantau mutasi tabel | Durasi yang dirasakan pengguna (end-to-end) |
| `api (iframe bersih)` | Body template dari request grid portal dikirim ulang dari **iframe same-origin** (content script tidak berjalan di frame itu, jadi patch XHR/fetch Cindieh tidak ada) | Murni waktu server DJP, tanpa filter suntikan ekstensi dan tanpa render portal |

Karena body request disalin dari request portal sendiri, request uji memakai parameter grid yang asli (termasuk header sesi pengguna). Nilai `Authorization`/`Cookie` tidak pernah dicetak ke console.

Perekam juga mencatat **semua** XHR/fetch di jendela waktu (kolom `request lain`), bukan hanya request grid — portal mengirim lookup tambahan (`getSingleReferenceData …`) tepat setelah grid dimuat, dan itu bisa jadi tempat waktu tunggu bersembunyi.

Variabel uji: panjang 5, 6, 7, dan panjang penuh; `MatchMode` `contains`, `startswith`, dan `equals` (hanya pada nilai panjang) — `startswith` dulu diuji sebagai **kandidat perbaikan** dan sejak 24 September 2026 justru menjadi mode yang dipakai ekstensi, sementara `equals` tetap sekadar kandidat; skrip mengukur keduanya bersama `contains` sebagai pembanding. Nilai selalu dinormalkan ke huruf besar karena `main.ts` mengirim `value.toUpperCase()`; satu probe tambahan memakai huruf asli sebagai kontrol untuk menguji sensitivitas huruf di server.

Arti kolom: `durasi ms` pada jalur ekstensi = jendela pengukuran (Enter → request grid selesai → jeda singkat), bukan repaint terakhir — portal bisa menggambar spinner jauh sebelum data tiba (rinciannya ada di `hasil.ekstensi[].stabilMs`). Kolom `total` diambil dari field numerik pertama yang ditemukan di `Payload` dan **belum tentu jumlah baris**; pakai kolom `baris` (`Payload.Data.length`) sebagai acuan. `ttfb` terisi hanya bila iframe menyediakan Resource Timing.

### Cara membaca KESIMPULAN

- **"LAMBAT DI SERVER DJP"** → request terisolasi juga lambat. Bukan bug ekstensi; ini sisi server/portal. Langkah berikutnya: pindah ke match mode cepat (lihat temuan di bawah) atau cari via prefix lalu saring lokal.
- **"SERVER CEPAT"** → biaya ada di jalur portal/ekstensi (klik tombol, render Angular, atau retry). Periksa kolom `request grid` (lebih dari 1 = portal mengirim beberapa request) dan kolom `ms request` vs `durasi ms`.
- **"ADA JALAN CEPAT"** → salah satu match mode alternatif jauh lebih cepat pada nilai panjang. Kandidat perbaikan di `SET_SERVER_FILTER`; sejak ADR-0012 ekstensi tidak lagi mengirim fallback `contains` bila hasilnya 0 baris.
- **`hasil cocok = TIDAK`** → filter referensi tampak tidak diterapkan pada request portal (ada baris hasil yang tidak memuat nilai yang dicari).

### Hasil diagnostik 24 September 2026 (portal Coretax)

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

### Alat bantu cepat (sementara)

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

### Kepatuhan

- Belasan request, selalu berurutan (tidak pernah paralel), jeda antar request dari `CONFIG.jedaMs` (default 700 ms).
- `Rows` request uji mengikuti `CONFIG.rows` (default 10, sama dengan grid portal). `cariReferensi()` memakai 100 (batas maksimum opsi UI portal) — bukan di atas batas di [RATE_LIMITING.md](../RATE_LIMITING.md).
- Hanya membaca data milik sesi login pengguna sendiri.
