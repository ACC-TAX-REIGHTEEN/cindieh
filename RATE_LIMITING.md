# Panduan & Rasionansi Pembatasan Kecepatan (Rate Limiting) Cindieh

Dokumen ini mencatat batasan kecepatan (*rate limiting*), jeda waktu (*delays*), dan toleransi kesalahan (*error handling*) yang diimplementasikan pada Cindieh untuk portal **DJP Coretax (`coretaxdjp.pajak.go.id`)**, serta alasan teknis di balik penetapan angka-angka tersebut.

> **Filosofi Produk**: Cindieh bukanlah alat penembus (*bypass*) atau pencarian data agresif, melainkan **Asisten Otomatisasi Alur Kerja (*Smart Workflow Automation*)**. Ekstensi ini menghemat waktu pengguna dengan mengotomatisasi proses manual pada **kecepatan maksimal yang diizinkan & aman** menurut batas UI/API Coretax.

---

## 1. Parameter Pembatasan dalam Kode

Berikut adalah konstanta dan jeda waktu yang diterapkan dalam kode ([`src/content/scraper-actions.ts`](file:///d:/PROGRAMMING/cindieh/src/content/scraper-actions.ts) & [`src/content/scraper.ts`](file:///d:/PROGRAMMING/cindieh/src/content/scraper.ts)):

| Fitur / Parameter | Nilai / Konfigurasi | Lokasi Kode | Keterangan |
|---|---|---|---|
| **Batch Pagination e-Invoice** | `step = 500`, `delayMs = 100` | [`scraper-actions.ts`](file:///d:/PROGRAMMING/cindieh/src/content/scraper-actions.ts#L199) | 500 data/req (menyesuaikan batas maks UI e-Invoice portal `500`). |
| **Batch Pagination SPT atau Returnsheets Portal** | `step = 1000`, `delayMs = 150` | [`scraper-actions.ts`](file:///d:/PROGRAMMING/cindieh/src/content/scraper-actions.ts#L199) | 1.000 data/req (menyesuaikan batas maks UI Returnsheets PPN portal `1000`). |
| **Bulk PDF Download** | `delay(800)` (800 ms) | [`scraper-actions.ts`](file:///d:/PROGRAMMING/cindieh/src/content/scraper-actions.ts#L159) | Jeda 800 ms antar unduhan berkas PDF (e-Faktur & Bukti Potong). |
| **Scrape per Faktur Spesifik** | `delay(50)` (50 ms) | [`scraper-actions.ts`](file:///d:/PROGRAMMING/cindieh/src/content/scraper-actions.ts#L388) | Jeda 50 ms antar nomor faktur pada fitur pencarian dari daftar. |
| **Retry & Backoff Faktur** | `MAX_INVOICE_RETRIES = 2`, `BACKOFF_BASE_MS = 1000` | [`scraper-actions.ts`](file:///d:/PROGRAMMING/cindieh/src/content/scraper-actions.ts#L344) | Maks 2x retry dengan *exponential backoff* (`1000ms`, `2000ms`) jika request gagal. |
| **Request Timeout** | `TIMEOUT = 30000` (30 detik) | [`scraper.ts`](file:///d:/PROGRAMMING/cindieh/src/content/scraper.ts#L36) | Batas waktu maksimal tunggu respons XHR dari Coretax. |
| **Circuit Breaker** | `MAX_ERRORS = 3` | [`scraper.ts`](file:///d:/PROGRAMMING/cindieh/src/content/scraper.ts#L37) | Hentikan scraping otomatis jika terjadi 3 error berturut-turut. |
| **Recovery Delay** | `delay(2000)` (2 detik) | [`scraper-actions.ts`](file:///d:/PROGRAMMING/cindieh/src/content/scraper-actions.ts#L107) | Jeda pemulihan 2 detik jika terjadi 1 kali error sebelum mencoba lagi. |

> **Catatan Eksekusi Sequential**: Seluruh eksekusi fetching bersifat berurutan (*serial/sequential*). Jeda `delayMs` (misal 100 ms) dihitung **setelah request sebelumnya selesai/berhasil diterima** dari server Coretax (`await request -> merge data -> await delay(100ms) -> request berikutnya`). Ekstensi tidak pernah mengirim request baru secara bersamaan/tumpang tindih (*no concurrent requests*).

---

## 2. Alasan & Dampak Jika Pembatasan Dinaikkan/Dihapus

### A. Deteksi Anomali WAF & API Gateway Coretax (*Payload Anomaly*)
* **Kondisi Normal UI**: Aplikasi web bawaan Coretax (Angular SPA) hanya mengirim request `Rows` sebanyak 10, 25, 50, atau 100 baris.
* **Risiko Pengubahan**: Mengubah `step` dari `1000` ke angka ekstrem seperti `5000` akan langsung ditandai oleh Web Application Firewall (WAF) Coretax sebagai lalu lintas bot/script non-standar.

### B. Validasi Schema & Batasan Server Backend (*Server Hard Cap*)
* Backend API Coretax memiliki aturan validasi parameter pagination. Pengiriman nilai `Rows` melebihi batas maksimal server dapat memicu penolakan **HTTP 400 Bad Request / 422 Unprocessable Entity**, atau pembatasan nilai (*truncation*) secara sepihak oleh backend server.

### C. Beban Database & Risiko Crash (*HTTP 504 / 500*)
* Setiap baris data faktur memuat puluhan bidang data terstruktur (NPWP, DPP, PPN, status, tanggal, dll.).
* Penarikan >1.000 data dalam 1 request memaksa database DJP melakukan operasi *join* & query massal yang sangat berat. Hal ini berisiko tinggi memicu **HTTP 504 Gateway Timeout** atau melumpuhkan layanan (*server crash*).

### D. Identitas Pengguna & Audit Logging DJP
* Setiap request yang dikirim Cindieh menggunakan header asli pengguna (`Authorization: Bearer <JWT_Token>`).
* JWT Token ini **memuat identitas pasti Wajib Pajak (NPWP, NIK, User ID, dan IP Address)**.
* Log server DJP mencatat secara presisi siapa yang mengirim request. Aktivitas agresif yang tidak ramah dapat memicu pemblokiran akun/IP (*HTTP 429 Too Many Requests*) atau pembekuan sesi login.

### E. Perlindungan Bagi Pengguna Lain (*Resource Allocation*)
* Coretax digunakan oleh jutaan Wajib Pajak secara bersamaan. Pembatasan kecepatan memastikan ekstensi tidak menyedot alokasi *bandwidth* dan CPU server secara serakah yang dapat mengganggu pengguna lain.

---

## 3. Faktor Real-World: Network Round-Trip Time (RTT) & Performa di Lapangan

Di kondisi riil/lapangan, jeda waktu nyata antar request sering kali terlihat mencapai **> 1 detik per halaman**, meskipun di dalam kode hanya diatur `delayMs = 100ms`. 

Hal ini disebabkan oleh gabungan tiga komponen waktu utama:

$$\text{Total Waktu Nyata} = \underbrace{\text{delayMs}}_{\text{100 ms (Kode)}} + \underbrace{\text{Network RTT}}_{\text{\~200--500 ms (Jaringan)}} + \underbrace{\text{Server Processing Coretax}}_{\text{\~400--1.000 ms (Database DJP)}}$$

### Mengapa Mengurangi `delayMs` ke 50 ms Kurang Efektif?
* **Bottleneck Utama**: Hambatan terbesar waktu tunggu bukanlah jeda buatan kodingan (`delayMs`), melainkan waktu pemrosesan database backend Coretax dan latensi jaringan (*Network RTT*).
* **Efisiensi Rendah vs Risiko Tinggi**: Mengurangi delay dari `100ms` ke `50ms` hanya menghemat ~1 detik untuk 10.000 data, namun meningkatkan risiko penolakan *burst rate* oleh WAF Coretax hingga 2x lipat.
* **Fluktuasi Jam Sibuk**: Pada batas waktu pelaporan SPT/faktur (akhir bulan), waktu tunggu *Server Processing* bisa membengkak hingga >1.5 detik per request. Jeda `100ms` memberikan buffer yang aman agar koneksi TCP socket browser tidak *stall* atau *timeout*.

---

## 4. Pedoman Bagi Pengembang (Developer Guidelines)

1. **JANGAN menaikkan `step` di atas 500 (e-Invoice) atau 1000 (Returnsheets/SPT)** sesuai dengan batas UI resmi portal Coretax terkait.
2. **JANGAN mengurangi `delayMs` di bawah 100ms** karena hambatan utama adalah Network RTT & Server Processing Time Coretax.
3. **JANGAN menghapus `delay(800)`** pada pengunduhan PDF massal untuk menghindari penolakan *bulk request* dari server.
4. **Pertahankan mekanisme *Circuit Breaker*** (`MAX_ERRORS = 3`) agar ekstensi tidak melakukan spamming request saat server DJP sedang mengalami gangguan (*down/maintenance*).
5. **Selalu hormati respon error HTTP 429 / 504** dengan memberikan jeda pemulihan (*backoff*) yang cukup.

