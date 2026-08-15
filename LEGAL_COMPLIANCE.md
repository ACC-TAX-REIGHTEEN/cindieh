# Pernyataan Kepatuhan Hukum & Keamanan (Legal & Compliance Audit) Cindieh

Dokumen ini mencatat hasil audit hukum, privasi data, dan keamanan teknis terhadap ekstensi **Cindieh** untuk portal **DJP Coretax (`coretaxdjp.pajak.go.id`)**.

---

## 1. Kepatuhan Terhadap Undang-Undang ITE (UU No. 11 Tahun 2008 jo UU No. 1 Tahun 2024)

### A. Pasal 30 UU ITE — Akses Tanpa Hak (*Unauthorized Access*)
* **Analisis**: Cindieh **TIDAK melakukan penerobosan, pembobolan (*hacking*), atau bypass sistem autentikasi**.
* **Fakta Teknis**: Ekstensi hanya dapat berjalan **jika dan hanya jika Wajib Pajak yang sah telah melakukan login resmi** menggunakan kredensial mereka sendiri di portal Coretax. Ekstensi memanfaatkan sesi browser aktif atas persetujuan penuh (*explicit consent*) dari pengguna pemilik akun.
* **Kesimpulan**: Cindieh tidak melanggar Pasal 30 UU ITE karena akses dilakukan secara sah oleh pemilik akun/kuasa hukum yang berhak.

### B. Pasal 32 UU ITE — Pengrusakan, Pengubahan, atau Pengurangan Informasi Elektronik
* **Analisis**: Cindieh bersifat **100% Read-Only** untuk seluruh fitur pencarian, ekstraksi data grid, dan pengunduhan berkas PDF.
* **Fakta Teknis**: Kode ekstensi tidak memiliki instruksi untuk mengubah, memanipulasi, memalsukan, atau menghapus nilai Faktur Pajak, DPP, PPN, Bukti Potong, atau data transaksi apa pun di server DJP.
* **Kesimpulan**: Cindieh tidak melanggar Pasal 32 UU ITE karena tidak ada bentuk pengrusakan atau manipulasi data elektronik.

---

## 2. Privasi Data & Perlindungan Informasi Pribadi

| Aspek Privasi | Penjelasan Teknis | Status Kepatuhan |
|---|---|---|
| **Pemrosesan Data Lokal (*Client-Side Only*)** | Seluruh proses ekstraksi data, konversi ke Excel (`.xlsx`) atau CSV (`.csv`), penataan format tanggal, dan penamaan PDF dilakukan 100% di memori browser lokal pengguna. | ✅ **Patuh** |
| **Tanpa Server Pihak Ketiga (*Zero Exfiltration*)** | Cindieh **TIDAK memiliki server perantara (proxy), telemetri, atau pustaka analitik eksternal**. Tidak ada data Wajib Pajak yang dikirimkan ke pihak ketiga mana pun. | ✅ **Patuh** |
| **Pengelolaan Kredensial** | Cindieh **TIDAK pernah mencatat, membaca, atau menyimpan Password, PIN, atau Passphrase** pengguna. | ✅ **Patuh** |

---

## 3. Kepatuhan Terhadap Ketentuan Portal DJP Coretax

DJP melarang aktivitas otomatisasi yang berpotensi menggangu ketersediaan layanan (*Denial of Service* / DoS). Cindieh mematuhi ketentuan ini dengan menerapkan batas efisiensi yang terukur:

1. **Penggunaan Pagination Resmi Portal**:
   - `step = 500` untuk e-Invoice Portal (sesuai batas maksimal UI e-Invoice).
   - `step = 1000` untuk Returnsheets/SPT Portal (sesuai batas maksimal UI Returnsheets PPN).
2. **Jeda Waktu Terukur (*Inter-Request Delays*)**:
   - Menggunakan jeda `100 ms` – `150 ms` antar halaman request data.
   - Menggunakan jeda `800 ms` antar unduhan berkas PDF massal.
3. **Mekanisme *Circuit Breaker***:
   - Jika terjadi 3 kali kesalahan koneksi/server berturut-turut (`MAX_ERRORS = 3`), ekstensi otomatis menghentikan proses untuk mencegah penumpukan request pada server DJP yang sedang mengalami gangguan.

---

## 4. Keamanan Arsitektur Kode (*Code Security*)

- **Bridge Token Security** ([`src/content/bridge.ts`](src/content/bridge.ts)): Menggunakan token acak unik yang dibuat sekali per halaman di dunia Isolated dan dibawa ke scraper (MAIN World) melalui URL script, lalu divalidasi pada setiap pesan. Hal ini mencegah skrip MAIN-world lain (misalnya ekstensi lain atau kode yang disuntikkan ke halaman) memalsukan perintah ke ekstensi.
- **PostMessage Guard** ([`src/content/postmessage-guard.ts`](src/content/postmessage-guard.ts)): Memvalidasi `event.source`, *origin*, *direction*, dan token bridge pada setiap pesan sebelum di-dispatch, guna memastikan keamanan dari serangan *Cross-World Script Hijacking*.

---

## 5. Pernyataan Penutup

Cindieh dirancang sebagai **Asisten Otomatisasi Alur Kerja (*Smart Workflow Automation*)** yang etis, aman, dan patuh hukum. Ekstensi ini tidak mengandung *malware*, *spyware*, atau mekanisme tidak sah lainnya.
