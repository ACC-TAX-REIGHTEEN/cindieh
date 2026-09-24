# Cindieh

**Cindieh** adalah ekstensi browser yang dirancang untuk meningkatkan pengalaman penggunaan portal DJP Coretax. Ekstensi ini menyederhanakan proses pengambilan dan ekspor data pajak dalam jumlah besar ke file Excel/CSV terformat, unduhan PDF massal (dengan filter nomor faktur), pencarian faktur berdasarkan referensi, serta perbandingan data faktur antara catatan internal dan Coretax.

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
- **Bukti Potong (Withholding Slips)** — khusus unduhan PDF massal (tanpa ekspor Excel/CSV)

Data yang dihasilkan sudah diformat untuk kemudahan pengguna:
- Format tanggal dikonversi otomatis dari ISO string (`2026-07-01T00:00:00`) ke format Indonesia standar (`01/07/2026`)
- File tersedia langsung dalam format `.xlsx` atau `.csv` — tidak perlu konversi manual

---

### 2. Unduhan PDF Massal

Alih-alih mengklik tombol unduh satu per satu seperti di Coretax bawaan, Cindieh mengunduh semua PDF sekaligus secara berurutan di latar belakang. Setiap file otomatis diberi nama yang informatif:

- **e-Faktur (PPN Keluaran, Masukan, Retur):**
  Format nama: `Referensi - NomorFakturPajak.pdf`
  Contoh: `SZ-0447/07/26 - 010.000-26.00000001.pdf`

- **Bukti Potong:**
  Format nama: `MM-YYYY-NomorBuktiPotong-NamaPemotong.pdf`
  Contoh: `07-2026-BP-001-PT MITRA SEJAHTERA.pdf`

**Filter No. Faktur (khusus e-Faktur):** di halaman e-Faktur, unduhan PDF bisa dibatasi ke nomor faktur tertentu. Klik tombol **"No. Faktur"** di toolbar, tempel daftar nomor faktur (satu per baris, atau dipisah koma/titik koma), lalu klik **Unduh PDF** — hanya faktur yang cocok yang akan diunduh. Filter ini hanya tersedia di halaman e-Faktur (PPN Keluaran, PPN Masukan, Retur) dan tidak muncul di halaman Bukti Potong.

---

### 3. Pencarian Berdasarkan Referensi di e-Faktur PPN Keluaran

Coretax dulu menyediakan fitur pencarian berdasarkan nomor referensi internal di kolom Referensi, namun fitur tersebut dihilangkan. Cindieh mengembalikannya dengan menambahkan kolom filter Referensi langsung di toolbar dan header grid halaman PPN Keluaran, sehingga pengguna bisa langsung menemukan faktur berdasarkan nomor referensi internal tanpa harus scroll manual.

Pencarian dikirim ke server dengan pencocokan **awalan** (`startswith`), karena mode tersebut terbukti jauh lebih cepat daripada pencocokan **mengandung** (`contains`) yang dipakai sebelumnya — selisihnya bisa dari 0,15 detik menjadi lebih dari 1 menit untuk nilai yang sama (pengukuran lengkap di [`tools/README.md`](tools/README.md)). Bila awalan tersebut tidak menemukan apa pun, Cindieh otomatis mengulang sekali dengan pencocokan mengandung, sambil memberi tahu di panel bahwa pencarian ulang ini bisa berjalan lama. Nilai yang dicari juga otomatis diubah ke huruf besar, karena filter Referensi di server Coretax bersifat case-sensitive.

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
- **Export XLSX** — ekspor seluruh hasil perbandingan ke file yang bisa langsung dibuka di Excel
- **Klik baris hasil** — langsung menutup panel dan menjalankan pencarian referensi tersebut di tabel PPN Keluaran Coretax, untuk validasi cepat tanpa perlu copy-paste manual

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
| `pnpm run package` | `/` (root) | `.zip` (Chrome) & `.xpi` (Firefox) |

### 3. Memasang Ekstensi

#### Google Chrome / Edge
1. Buka `chrome://extensions/`.
2. Aktifkan **Mode Developer** di pojok kanan atas.
3. Klik **Load unpacked**.
4. Pilih folder `dist/cindieh-chrome/`.

#### Mozilla Firefox
1. Buka `about:addons`.
2. Klik ikon roda gigi (⚙️) dan pilih **Install Add-on From File...**.
3. Pilih file `cindieh-firefox.xpi` yang dihasilkan di direktori root.
   *(Catatan: Untuk pengujian lokal, pastikan `xpinstall.signatures.required` diatur ke `false` di `about:config`).*

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
