# Cindieh

**Cindieh** adalah ekstensi browser yang dirancang untuk meningkatkan pengalaman penggunaan portal DJP Coretax. Ekstensi ini menyederhanakan proses pengambilan dan ekspor data pajak dalam jumlah besar ke file Excel/CSV terformat, unduhan PDF massal (dengan filter nomor faktur), pencarian faktur berdasarkan referensi, serta perbandingan data faktur antara catatan internal dan Coretax, sekaligus pemeriksaan keakuratan nilai DPP/Nilai Lain/PPN pada faktur yang sudah tercatat di Coretax.

## Prinsip Desain & Otomatisasi Terukur

Cindieh **bukanlah alat untuk melompati (*bypass*) atau menerobos protokol keamanan Coretax**. Ekstensi ini bekerja secara sah di dalam browser pengguna menggunakan sesi login aktif Wajib Pajak.

Alih-alih menjanjikan kecepatan di luar batas wajar yang berisiko memicu pemblokiran akun/IP, Cindieh menawarkan **Otomatisasi Alur Kerja Terukur (*Smart Workflow Automation*)**:
* **Menghilangkan Pekerjaan Repetitif**: Menggantikan ratusan klik manual (*next page*, re-apply filter, unduh PDF satu per satu) dengan **satu kali klik (*one-click*)**.
* **Kecepatan Maksimal yang Diizinkan**: Mengambil data pada kecepatan puncak yang diizinkan oleh Coretax (500 baris/request untuk e-Invoice dan 1.000 baris/request untuk SPT) secara berurutan (*sequential*).
* **Aman & Patuh (*Compliant & Safe*)**: Menggunakan jeda waktu teratur (*inter-request delay*) sehingga proses scraping berjalan lancar di latar belakang tanpa memicu alarm keamanan WAF DJP.

## Fitur Utama

### 1. Ekspor Data ke Excel & CSV

Coretax bawaan hanya mengunduh data yang sedang ditampilkan di layar. Untuk mengunduh semua data, pengguna harus mengatur tampilan ke jumlah baris maksimal (500–1.000 per halaman) — yang membuat portal menjadi berat dan lambat — lalu klik unduh Excel, pindah ke halaman berikutnya, klik unduh lagi, dan seterusnya hingga semua halaman selesai.

Cindieh menghilangkan seluruh proses itu. Cukup klik satu tombol, ekstensi akan mengambil semua data langsung dari API internal Coretax secara otomatis di latar belakang, tanpa perlu membuka banyak halaman atau menunggu portal memuat ratusan baris sekaligus.

Halaman yang didukung (ekspor XLSX/CSV):
- **e-Faktur** — PPN Keluaran, PPN Masukan, Retur PPN Keluaran, Retur PPN Masukan
- **SPT Masa PPN** — Lampiran A2 (PPN Keluaran) dan Lampiran B2 (PPN Masukan)
- **SPT PPh 21/26** — Lampiran L1A, L1B, L2, L3
- **Bukti Potong (Withholding Slips)** — kolom: No Bukti Potong, Tanggal, Masa, Tahun, Nama Pemotong, NPWP Pemotong. Halaman ini juga punya tombol unduhan PDF massal tersendiri.

Data yang dihasilkan sudah diformat untuk kemudahan pengguna:
- Format tanggal dikonversi otomatis dari ISO string (`2026-07-01T00:00:00`) ke format Indonesia standar (`01/07/2026`)
- File tersedia langsung dalam format `.xlsx` atau `.csv` — tidak perlu konversi manual

---

### 2. Unduhan PDF Massal

Alih-alih mengklik tombol unduh satu per satu seperti di Coretax bawaan, Cindieh mengunduh semua PDF sekaligus secara berurutan di latar belakang. Setiap file otomatis diberi nama yang informatif:

- **e-Faktur (PPN Keluaran, Masukan, Retur):**
  Format nama: `Referensi - NomorFakturPajak.pdf`
  Contoh: `SZ-0447-07-26 - 010.000-26.00000001.pdf` (tanda `/` pada referensi diganti `-` agar nama berkas sah)

- **Bukti Potong:**
  Format nama: `MM-YYYY-NomorBuktiPotong-NamaPemotong.pdf`
  Contoh: `07-2026-BP-001-PT MITRA SEJAHTERA.pdf`

**Bukti Potong:** di halaman ini tombol **Unduh PDF** berdiri sendiri di samping tombol **Ekspor**. Memilih ekspor XLSX/CSV **tidak** ikut mengunduh PDF — Cindieh hanya mengambil baris datanya, jadi Anda bisa mengambil spreadsheet tanpa mengunduh satu PDF per bukti potong. Mode *Asli* menampilkan seluruh field Coretax apa adanya bila kolom di atas belum cukup.

**Filter No. Faktur (khusus e-Faktur):** di halaman e-Faktur, unduhan PDF bisa dibatasi ke nomor faktur tertentu. Klik tombol **"No. Faktur"** di toolbar, tempel daftar nomor faktur (satu per baris, atau dipisah koma/titik koma), lalu klik **Unduh PDF** — hanya faktur yang cocok yang akan diunduh. Filter ini hanya tersedia di halaman e-Faktur (PPN Keluaran, PPN Masukan, Retur) dan tidak muncul di halaman Bukti Potong.

Sebelum unduhan PDF dimulai, Cindieh juga memeriksa daftar nomor Anda terhadap data yang sudah diambil: nomor yang tidak punya baris di data tersebut akan **disebutkan namanya** di dialog konfirmasi (atau di peringatan tersendiri bila konfirmasi dimatikan), karena berkas itu memang tidak akan ikut terunduh.

Setelah ekspor bertarget selesai, Cindieh membandingkan daftar nomor yang Anda minta dengan baris yang benar-benar ditemukan, lalu melaporkan nomor yang tidak ada di Coretax di panel — mis. *"3 dari 20 nomor faktur tidak ditemukan di Coretax: 040-002, 040-007, 040-011."* Tanpa laporan ini, nomor yang tidak ketemu akan membuat berkas hasilnya lebih pendek tanpa penjelasan.

---

### 3. Pencarian Berdasarkan Referensi di e-Faktur PPN Keluaran

Coretax dulu menyediakan fitur pencarian berdasarkan nomor referensi internal di kolom Referensi, namun fitur tersebut dihilangkan. Cindieh mengembalikannya dengan menambahkan kolom filter Referensi langsung di toolbar dan header grid halaman PPN Keluaran, sehingga pengguna bisa langsung menemukan faktur berdasarkan nomor referensi internal tanpa harus scroll manual.

Pencarian dikirim ke server dengan pencocokan **awalan** (`startswith`), karena mode tersebut terbukti jauh lebih cepat daripada pencocokan **mengandung** (`contains`) yang dipakai sebelumnya — selisihnya bisa dari 0,15 detik menjadi lebih dari 1 menit untuk nilai yang sama (pengukuran lengkap di [`tools/README.md`](tools/README.md)). Bila awalan tersebut tidak menemukan apa pun, panel melaporkan **tidak ditemukan** dan pencarian berhenti — Cindieh tidak pernah mengulang dengan pencocokan mengandung yang lambat (lihat [ADR-0012](docs/adr/0012-reference-search-stops-on-empty-prefix.md)); coba ketik awalan yang lebih pendek. Nilai yang dicari juga otomatis diubah ke huruf besar, karena filter Referensi di server Coretax bersifat case-sensitive.

---

### 4. Komparator Faktur PPN Keluaran

Fitur ini memudahkan pengguna membandingkan data penjualan internal (dari Excel) dengan data faktur yang tercatat di Coretax — untuk melihat dengan cepat faktur mana yang nilainya berubah (direvisi), dibatalkan, atau baru diterbitkan di Coretax tapi belum ada di catatan internal.

Cara kerja: cukup **copy dari Excel, lalu paste** ke panel Komparator. Tidak perlu upload file atau menyesuaikan format kolom — jauh lebih praktis.

**Format input yang didukung (tab-separated dari Excel):**
- **3 kolom:** `Referensi`, `DPP`, `PPN`
- **4 kolom (mode Ref Lain):** `Referensi`, `Referensi Lain`, `DPP`, `PPN`

**Status hasil perbandingan:**

| Status | Keterangan |
|---|---|
| **Cocok** | DPP dan PPN sesuai antara data internal dan Coretax |
| **DPP Berbeda** | Hanya DPP yang tidak sesuai |
| **PPN Berbeda** | Hanya PPN yang tidak sesuai |
| **Berbeda** | DPP dan PPN keduanya tidak sesuai |
| **Tidak Ditemukan** | Referensi dari Excel tidak ditemukan di Coretax |
| **Hanya di Coretax** | Ada di Coretax pada tanggal yang dipilih, tapi tidak ada di data Excel |

**Opsi tambahan:**
- **Toleransi** — batas selisih yang masih dianggap cocok, berguna untuk menangani pembulatan
- **Mode Harian** — masukkan tanggal tertentu (1–31) untuk mendeteksi faktur di Coretax yang belum ada di catatan internal
- **Filter Status** — saring hasil berdasarkan satu atau lebih status sekaligus
- **Export Excel / CSV** — ekspor seluruh hasil perbandingan, ke `perbandingan-faktur.xlsx` atau `perbandingan-faktur.csv`. CSV siap dibuka di editor teks atau dipakai untuk membandingkan dua hasil
- **Klik baris hasil** — langsung menutup panel dan menjalankan pencarian referensi tersebut di tabel PPN Keluaran Coretax, untuk validasi cepat tanpa perlu copy-paste manual

### 5. Pengecekan Keakuratan Nilai (PPN Keluaran & PPN Masukan)

Tab kedua di panel yang sama dengan Komparator. Fitur ini memeriksa apakah nilai **DPP**, **DPP Nilai Lain**, dan **PPN** pada faktur yang sudah tercatat di Coretax konsisten secara aritmetika — berguna untuk menemukan faktur yang nilai dasarnya terlanjur salah sebelum dilaporkan.

Cara pakai: buka panel **Bandingkan** (ikon daftar di toolbar), pilih tab **Pengecekan Keakuratan Nilai**, pilih **Acuan**, isi **Toleransi** bila perlu, lalu klik **Periksa**. Bila data belum ada, Cindieh menarik data grid tersebut terlebih dahulu secara otomatis (sama seperti Komparator). Tab ini muncul di halaman e-Faktur **PPN Keluaran** dan **PPN Masukan**.

Kolom nama pihak lain menyesuaikan gridnya: di PPN Keluaran kolomnya **Nama Pembeli**, di PPN Masukan **Nama Penjual** — karena faktur masuk menunjuk penjualan orang lain, bukan milik Wajib Pajak sendiri. Perhitungan DPP / DPP NL / PPN-nya identik di kedua halaman: yang diperiksa adalah konsistensi aritmetika satu faktur, bukan pencocokan antar faktur.

> **Kenapa Komparator tidak ikut ke PPN Masukan?** Komparator mencocokkan catatan internal dengan Coretax berdasarkan kolom **Referensi**. Referensi di PPN Masukan adalah referensi milik **penjual**, jadi bisa sama antar faktur dari penjual berbeda dan sering kosong — tidak ada kunci yang bisa diandalkan untuk pencocokan.

**Acuan** menentukan nilai mana yang dianggap benar, nilai mana yang dihitung darinya, dan nilai mana yang diperiksa:

| Acuan | Nilai yang dihitung dari acuan | Nilai yang diperiksa |
|---|---|---|
| **DPP** | DPP NL = 11/12 × DPP · PPN = 11% × DPP | DPP NL dan PPN |
| **DPP NL** | DPP = 12/11 × DPP NL · PPN = 12% × DPP NL | DPP dan PPN |
| **PPN** | DPP = PPN / 11% · DPP NL = PPN / 12% | DPP dan DPP NL |

**Status hasil** — hanya faktur yang tidak sesuai atau datanya tidak lengkap yang masuk daftar; faktur yang sudah benar tidak ditampilkan:

| Status | Keterangan |
|---|---|
| **DPP Berbeda** | Nilai DPP tidak sesuai dengan hasil hitung dari Acuan |
| **DPP NL Berbeda** | Nilai DPP Nilai Lain tidak sesuai |
| **PPN Berbeda** | Nilai PPN tidak sesuai |
| **DPP & PPN Berbeda** dsb. | Dua nilai sekaligus tidak sesuai; nama status menyebut pasangan yang berbeda (mis. **DPP NL & PPN Berbeda**, **DPP & DPP NL Berbeda**) |
| **Data tidak lengkap** | Salah satu dari DPP / DPP NL / PPN kosong atau tidak valid, sehingga tidak bisa dihitung |

Baris yang DPP Nilai Lain-nya **0** berarti faktur tidak menerapkan DPP Nilai Lain — nilainya tidak dijadikan pembanding (tidak dilaporkan sebagai **DPP NL Berbeda**) dan kolom selisihnya tampil sebagai `-`. Pengecualian ini berlaku saat Acuan DPP atau PPN; saat Acuan DPP Nilai Lain sendiri, nilai 0 tetap dipakai seperti yang dipilih.

**Opsi tambahan:**
- **Toleransi** — selisih yang masih dianggap cocok (untuk pembulatan); selisih di dalam toleransi ditampilkan sebagai `-`
- **Filter Status** — saring hasil (Semua Status, DPP Berbeda, DPP NL Berbeda, PPN Berbeda, Dua Nilai Berbeda, Data tidak lengkap)
- **Export Excel / CSV** — ekspor hasil pengecekan ke `pengecekan-nilai-faktur.xlsx` atau `.csv`. Keduanya menyimpan seluruh temuan, bukan hanya yang sedang tampil
- **Klik baris hasil** — klik 1× untuk melihat teks lengkap, klik 2× untuk mencari referensi tersebut di grid PPN Keluaran (sama seperti Komparator)
- **Ringkasan** — "Semua faktur sesuai." bila tidak ada temuan, atau jumlah faktur yang berbeda dan yang datanya tidak lengkap
- Hasil dipaginasi per halaman, dan angka besar tetap tersimpan sebagai angka di Excel (bukan teks)

---

## Pengaturan (Popup)

Klik ikon Cindieh di toolbar browser untuk membuka pengaturan. Semua preferensi tersimpan di `storage.local` dan berlaku di tab portal yang sedang terbuka tanpa perlu reload. Pengecualian kecil: **Log debug** di dunia halaman (scraper) baru terbaca pada injeksi berikutnya, karena scraper membaca saklar itu saat modulnya dimuat.

| Kontrol | Fungsi |
|---|---|
| **Aktifkan Cindieh** | Saklar utama. Saat dimatikan, seluruh tombol dan panel Cindieh dibersihkan dari halaman portal; menyalakannya kembali menyuntik ulang tanpa reload. |
| **Format export** | *Dirapikan* (header Indonesia + kolom pilihan) atau *Asli* (field Coretax apa adanya). |
| **Format file default** | XLSX atau CSV. Pilihan ini ditandai centang di menu ekspor portal, sehingga format yang biasa dipakai langsung terlihat. |
| **Ekspor sekali klik** | Nonaktif secara default. Jika diaktifkan, sekali klik pada tombol ekspor portal langsung mengunduh format default, dan tombol panah terpisah di sebelahnya membuka pilihan format lain. |
| **Awalan nama file** | Awalan tambahan di depan awalan bawaan untuk berkas XLSX/CSV, mis. `PTABC-` menghasilkan `PTABC-FPK-072026.xlsx`. Berguna saat mengelompokkan berkas per klien. Nama berkas PDF tidak diubah. |
| **Kecepatan** | *Normal* / *Hati-hati* (2×) / *Sabar* (4×) jeda antar request. Pilihan ini hanya **memperlambat**; Cindieh tidak pernah lebih cepat dari batas aman Coretax (lihat [RATE_LIMITING.md](RATE_LIMITING.md)). |
| **Unduhan massal** | Jumlah berkas yang memicu konfirmasi (bawaan 10). Isi `0` untuk tidak pernah bertanya. |
| **Default Komparator** | Toleransi selisih DPP/PPN, tanggal mode harian, dan filter status yang otomatis terisi saat panel Komparator dibuka. |
| **Default Pengecekan** | Acuan yang dihitung ulang (*DPP* / *DPP Nilai Lain* / *PPN*), toleransi selisih nilai, dan filter status yang otomatis terisi saat tab Pengecekan Keakuratan Nilai dibuka. |
| **Log debug** | Menampilkan log `[Cindieh]` di console halaman, background, dan popup. |
| **Notifikasi saat selesai** | Notifikasi desktop setelah ekspor atau unduhan massal selesai — termasuk bila prosesnya gagal atau hanya selesai sebagian ("Proses Cindieh gagal" beserta alasannya), supaya kegagalan tidak terlewat saat panel tidak diawasi. Bila ada nomor faktur yang tidak ditemukan, jumlahnya ikut disebut — mis. "17 data diproses, 3 nomor faktur tidak ditemukan, tanpa kegagalan." Pada ekspor setahun, masa yang gagal diambil ("1 masa gagal diambil") dan masa tanpa baris ("1 masa tanpa baris") juga disebut, begitu pula hasil yang belum lengkap karena portal membatasi jumlah baris. Izin `notifications` diminta saat saklar ini dinyalakan (izin opsional — tidak diminta saat pemasangan). Klik notifikasi membawa kembali ke halaman tempat prosesnya berjalan dan membuka panel Cindieh. |
| **Bersihkan cache** | Membuang data yang sudah diambil di tab portal, sehingga ekspor berikutnya mengambil ulang dari Coretax. |
| **Reset preferensi** | Mengembalikan seluruh pengaturan di atas ke nilai bawaan. Format export dan Log debug tidak ikut direset. |
| **Buka portal Coretax** | Tautan di bagian bawah popup yang membuka [coretaxdjp.pajak.go.id](https://coretaxdjp.pajak.go.id/) di tab baru — berguna saat popup dibuka dari halaman lain. |

### Ekspor satu tahun (PPN Keluaran)

Menu **Ekspor** di halaman PPN Keluaran punya satu entri tambahan: **Ekspor 1 Tahun (12 Masa)**. Satu klik mengambil seluruh dua belas masa pajak dan menulisnya ke satu berkas: satu proses, satu panel progress, satu file.

| | |
|---|---|
| Halaman | PPN Keluaran saja. Di halaman lain entri ini tidak muncul. |
| Isi file | Seluruh masa pajak dalam satu tahun pajak. |
| Nama file | Dinamai untuk **tahunnya** (`FPK-2026.xlsx`), bukan untuk satu bulan, karena isinya dua belas bulan. |
| Perkiraan waktu | Sekitar 4 menit bagi Wajib Pajak besar pada kecepatan pacing normal, memakai jeda antar-halaman yang sama seperti ekspor biasa. Kecepatan yang lebih lambat memperpanjang waktu ini, tidak pernah memendekkannya. |
| Menghentikan | Tombol ekspor mana pun membatalkan proses, seperti ekspor biasa. |

Setelah selesai, panel menyebut jumlah masa dan jumlah baris. Bila ada masa yang **balik kosong di tengah masa lain yang berisi data**, panel menyebutkannya: itu tanda ada bulan yang hilang, dan tidak ada jumlah total dari portal yang bisa dipakai sebagai pembanding (lihat catatan di bawah). Masa yang gagal diambil disebut terpisah dari masa yang memang kosong, karena dua masalah itu punya dua perbaikan berbeda.

> **Catatan.** Keseluruhan proses adalah **satu Run**: semua masa berbagi satu daftar data dan satu set deduplikasi, sehingga faktur yang muncul di dua masa tetap tercatat satu kali. Kalau prosesnya dipecah menjadi dua belas proses terpisah, satu invoice bisa terhitung dua kali tanpa disadari.

### Pintasan papan ketik

Ketiganya memakai `Ctrl` (atau `Cmd` di macOS) + `Shift`, dan hanya aktif di halaman portal yang didukung Cindieh. Saat saklar utama dimatikan, ketiganya diam.

| Pintasan | Fungsi |
|---|---|
| `Ctrl+Shift+E` | Mulai ambil data dari grid (*scrape*), sama seperti tombol scrape di toolbar; di halaman Bukti Potong, proses yang sama sekaligus mengunduh PDF massalnya. Diabaikan ketika sedang berjalan, supaya dua proses tidak berlomba untuk grid yang sama. |
| `Ctrl+Shift+S` | Batalkan proses yang sedang berjalan. |
| `Ctrl+Shift+B` | Buka panel Bandingkan / Pengecekan Keakuratan Nilai. Hanya di halaman e-Faktur PPN Keluaran dan PPN Masukan; ditutup dengan `Esc` seperti biasa. |

Daftar ini bukan tabel terpisah: `SHORTCUTS` di [`src/content/shortcuts.ts`](src/content/shortcuts.ts) adalah satu-satunya sumber. Handler membacanya langsung, halaman situs membacanya lewat import yang sama di `microsite-sync.unit.test.ts`, sedangkan tabel README ini disalin tangan — jadi ubah keduanya dalam satu commit.

## Instalasi & Build

### 1. Persiapan
Clone repositori dan install dependensi:
```bash
pnpm install
```

### 2. Build untuk Produksi
Buat ekstensi siap pakai untuk browser yang diinginkan:

| Perintah | Direktori Output | Hasil |
|---|---|---|
| `pnpm run build:chrome` | `dist/cindieh-chrome/` | Ekstensi Chrome (unpacked) |
| `pnpm run build:firefox` | `dist/cindieh-firefox/` | Ekstensi Firefox (unpacked) |
| `pnpm run package` | `dist/` | `cindieh-chrome.zip`, `cindieh-firefox.xpi`, dan `cindieh-source.zip` (sumber untuk submission Mozilla) |

### 3. Memasang Ekstensi

#### Google Chrome / Edge
1. Buka `chrome://extensions/`.
2. Aktifkan **Mode Developer** di pojok kanan atas.
3. Klik **Load unpacked**.
4. Pilih folder `dist/cindieh-chrome/`.

#### Mozilla Firefox
1. Buka `about:addons`.
2. Klik ikon roda gigi (⚙️) dan pilih **Install Add-on From File...**.
3. Pilih file `dist/cindieh-firefox.xpi` hasil `pnpm run package`.
   *(Catatan: Untuk pengujian lokal, pastikan `xpinstall.signatures.required` diatur ke `false` di `about:config`).*

### 4. Rilis

`pnpm run release` menjalankan satu alur penuh: menaikkan versi di `package.json` + `manifest.json`, memperbarui `CHANGELOG.md`, membangun dan mengarsipkan ekstensi, membuat GitHub Release, lalu mengunggah tiga arsip sebagai aset rilis:

| Aset Rilis | URL Stabil |
|---|---|
| `cindieh-chrome.zip` | `https://github.com/allababbot/cindieh/releases/latest/download/cindieh-chrome.zip` |
| `cindieh-firefox.xpi` | `https://github.com/allababbot/cindieh/releases/latest/download/cindieh-firefox.xpi` |
| `cindieh-source.zip` | `https://github.com/allababbot/cindieh/releases/latest/download/cindieh-source.zip` |

* **Butuh `GITHUB_TOKEN`** dengan izin `contents: write` — release-it memakainya untuk membuat release dan mengunggah aset.
* **Tag belum didorong otomatis** (`push: false`): GitHub membuat tag rilis dari commit terakhir yang sudah ada di remote. Agar tag menunjuk ke commit rilis, dorong branch dan tag setelah selesai (`git push origin main --follow-tags`) — atau setel `"push": true` di `.release-it.json` supaya release-it yang mendorong keduanya sebelum membuat release.
* Hanya ingin membangun arsip tanpa menerbitkan rilis? Jalankan `pnpm run release:assets`.
* Pratinjau tanpa menyentuh apa pun: `pnpm run release:dry-run` (pengunggahan aset otomatis dilewati).

## Situs Web (Microsite)

Halaman utama yang publik untuk Cindieh ada di folder [`microsite/`](microsite/) dan sudah tayang di **https://cindieh.pages.dev** (Cloudflare Pages, tanpa build step).

Isinya one-pager statis — HTML, CSS, dan JS polos tanpa dependensi — yang menjelaskan tujuh fitur Cindieh dalam bahasa Indonesia, ditambah [`privacy.html`](microsite/privacy.html), **halaman kebijakan privasi yang tayang di https://cindieh.pages.dev/privacy.html**. Halaman kedua itu ada karena Chrome Web Store dan Firefox Add-ons meminta kebijakan privasi berupa URL saat review — berkas di dalam repositori tidak bisa dijadikan tautan. Isinya diturunkan dari kode: tidak ada server, telemetri, maupun analitik, dan hanya `coretaxdjp.pajak.go.id` yang dihubungi. Dokumentasi untuk folder tersebut ada di [`microsite/README.md`](microsite/README.md): struktur, konvensi, dan setelan deploy.

Yang membuatnya tidak melenceng dari kode adalah [`src/tests/microsite-sync.unit.test.ts`](src/tests/microsite-sync.unit.test.ts). Halaman itu menyalin fakta dari TypeScript (prefix berkas, permission, shortcut, halaman portal yang didukung, label status kedua grid, nama berkas ekspor, setiap kontrol popup, dan hostname situs), lalu tes tersebut membandingkannya balik dengan sumber aslinya. Menambah sumber ekspor, permission, shortcut, halaman portal, status, nama berkas, atau preferensi wajib disertai perubahan halaman di commit yang sama — kalau tidak, tesnya merah. Suite yang sama juga menjaga struktur ketiga halaman situs (beranda, privasi, dan 404), mulai dari satu label dan satu panel per tab fitur sampai `<base href="/">` di halaman 404 dan kecocokan `sitemap.xml` dengan setiap halaman. Tabel izin di halaman privasi diperiksa dua arah terhadap `manifest.json`: setiap permission yang diminta harus disebut di sana, dan setiap permission yang diklaim harus benar-benar ada di manifest — jadi penambahan izin baru tidak bisa tayang tanpa dicatat di sana.

Workflow [`CI`](.github/workflows/ci.yml) menjalankan `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:coverage`, `build:chrome` + `build:firefox`, dan `pnpm run package` di GitHub Actions pada setiap push ke `main` dan setiap pull request — dan `microsite-sync.unit.test.ts` termasuk salah satu file di dalam `pnpm test`. Jadi guard-nya bekerja di CI, bukan hanya saat ada yang ingat menjalankannya secara lokal.

## Tech Stack
- **Bahasa:** TypeScript
- **Bundler:** esbuild
- **Persistensi:** WebExtension Storage API (`storage.local`)
- **Generasi Excel/CSV:** SheetJS (xlsx)
- **UI:** Vanilla DOM & CSS

## Dokumentasi & Kepatuhan Hukum
- [Panduan Pembatasan Kecepatan](RATE_LIMITING.md) — Penjelasan rinci teknis rate-limiting & RTT.
- [Pernyataan Kepatuhan Hukum & Keamanan](LEGAL_COMPLIANCE.md) — Audit hukum ITE, privasi data lokal, dan keamanan arsitektur kode.

## Lisensi
Proyek ini dilisensikan di bawah MIT License. Lihat [LICENSE](LICENSE) untuk detailnya.
