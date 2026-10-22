# Catatan kerja

## Preferensi yang sudah diketahui

- Bahasa pengantar pelajaran: **Bahasa Indonesia**; istilah kode, nama berkas, dan nama fungsi
  tetap dalam bahasa Inggris.
- Suka pelajaran pendek dengan feedback langsung: tiap pelajaran ditutup uji ingatan dengan
  umpan balik per opsi.
- Ingin memahami **seluruh** ADR — jadi cakupannya sengaja luas, bukan satu topik.

## Keadaan workspace (2026-10-20)

- **Workspace root = `docs/teach/`** (pilihan pengguna: semua berkas kursus dalam satu folder
  di dalam `docs/`, bukan berserakan di root repo). Semua path di bawah dipanggil relatif
  terhadap `docs/teach/`: `docs/teach/lessons/`, `docs/teach/reference/`,
  `docs/teach/assets/`, `docs/teach/MISSION.md`, `docs/teach/RESOURCES.md`,
  `docs/teach/NOTES.md`, dan `docs/teach/learning-records/` (kalau nanti ada).
  Skill `teach` menulis path relatif terhadap direktori tempat `/teach` dijalankan — jadi
  jalankan `/teach` dari dalam folder `docs/teach/`, atau sebut eksplisit saat sesi berikutnya.
- 9 pelajaran + 2 halaman referensi + komponen bersama (`docs/teach/assets/course.css`,
  `docs/teach/assets/quiz.js`).
- `docs/teach/assets/check-course.mjs` memeriksa konsistensi kursus (tautan mati, opsi kuis yang
  panjangnya tidak sama, kelas CSS asing, `data-quiz` duplikat, keseimbangan tag). Jalankan:
  `node docs/teach/assets/check-course.mjs` dari root repo.
- Kursus tidak memengaruhi build, lint, atau typecheck: `tsconfig.json` dan `eslint.config.js`
  hanya mencakup `src/**/*`. Folder `docs/teach/` juga bisa di-ignore utuh lewat satu entri
  `.gitignore`.

## Keadaan proyek saat pelajaran dibuat

- **Jumlah ADR bergerak cepat.** Angka yang dipakai kursus ini selalu mengikuti indeks resmi
  `docs/adr/README.md` saat materi itu ditulis:
  - 34 ADR — versi pertama kursus (20 Oktober 2026, pagi);
  - 36 ADR — setelah ADR-0035 dan ADR-0036 masuk (versi yang sempat ditulis di pelajaran);
  - 38 ADR — versi sebelum ADR-0039: 0001–0038, tanpa celah. Pelajaran 09 (ADR-0037), ADR-0036 di
    pelajaran 05, dan ADR-0035 + ADR-0038 di pelajaran 07 adalah tambahan terbaru.
  - 39 ADR — versi sebelum ADR-0040: 0001–0039, tanpa celah. ADR-0039 (satu scope untuk pemeriksaan
    terbalik Komparator) masuk di pelajaran 07 dan di peta ADR; peta rujukan silang menambah baris
    `0039 → 0003, 0006`.
  - 44 ADR — sekarang: 0001–0044, tanpa celah. ADR-0040 (sweep membawa rencananya), ADR-0041
    (body grid dibaca satu modul), ADR-0042 (satu nama untuk satu baris), ADR-0043 (filter masa
    boleh berupa daftar kode), dan ADR-0044 (grid yang sudah menampilkan setahun diambil apa adanya)
    masuk di peta ADR; klaster sweep di pelajaran 01 dan 04 memakai 0043–0044.
  - Saat ditulis ulang, angka yang disebut pengguna adalah “36”, padahal indeks sudah 37 lalu 38.
    Kursus memakai angka yang terverifikasi dari indeks resmi, bukan angka yang diberikan lisan.
- Pengguna sedang menggarap dunia MAIN: `src/content/scraper-install.ts` dan
  `src/content/ui-comparer-view.ts` (baru), dengan ADR-0036 dan ADR-0038 sebagai catatannya.
  Berkas-berkas itu milik pengguna — jangan disentuh.
- **ADR-0039 sudah diverifikasi manual di portal Coretax** (20 Oktober 2026): mode bulanan
  Komparator (kotak “Hari” tidak dicentang) kini menampilkan baris “Hanya di Coretax” seperti yang
  diminta. Pelajaran 07 dan peta ADR sudah menyebutkannya.
- Angka “1.283 → 1.121 baris” di ADR-0003 sudah usang karena pemecahan tab Komparator.
  Pelajaran 07 menyebutnya sebagai angka yang ADR itu catat, bukan kondisi sekarang.

## Temuan yang muncul saat menyusun pelajaran

- **ADR-0034 vs kode:** ADR menyebut dua loop PDF “announce the end”, sementara
  `scraper-actions.ts` tampaknya melempar pada alur bulk Bukti Potong. Perlu diverifikasi apakah
  ADR-nya yang perlu diamendemen atau kodenya.
- **Angka historis di ADR-0003** (1.283 → 1.121 baris) sudah usang: `ui-comparer.ts` kini
  **226 baris** setelah tab Komparator dipisah ke `ui-comparer-view.ts` (**716 baris**) lewat
  ADR-0036, dan `ui-comparer.ts` tinggal jadi composition root. Pelajaran 07 menyebut angka ADR
  sebagai “angka yang ADR itu catat”, bukan kondisi sekarang.

## Pertanyaan yang masih terbuka untuk pengguna

- Misi apa yang sebenarnya: **(a)** memahami untuk berkontribusi/menulis ADR sendiri,
  **(b)** memahami untuk me-review PR, atau **(c)** memahami untuk onboarding tim? Jawaban ini
  menentukan pelajaran berikutnya (misalnya latihan menulis ADR, atau latihan review).
- Apakah kursus boleh membahas **latihan langsung di repo** (mis. menjalankan `pnpm test`,
  membuka `docs/adr` di editor) sebagai bagian dari pelajaran?

## Yang belum dilakukan

- Belum ada `learning-records/` — tunggu bukti pemahaman dari pengguna sebelum menulis catatan
  pembelajaran (kategori: baru menunjukkan pemahaman, atau memberi tahu pengetahuan sebelumnya).
- Microsite dan README proyek tidak diubah; isi kursus berdiri sendiri di folder terpisah.
