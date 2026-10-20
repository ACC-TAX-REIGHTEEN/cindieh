# Misi: membaca dan menulis keputusan arsitektur di Cindieh

> **Workspace root: `docs/teach/`** — pelajaran, referensi, dan komponen bersama semua ada di
> folder ini. `MISSION.md`, `RESOURCES.md`, `NOTES.md`, `lessons/`, `reference/`, `assets/`,
> dan `learning-records/` (kalau nanti ada) dipanggil relatif terhadap folder `docs/teach/`,
> bukan terhadap root repo.
>
> **Status: draf.** Misi ini disusun dari permintaan awal: “bantu saya memahami semua ADR di
> proyek ini”. Bagian tujuan dan batas cakupan di bawah masih berupa asumsi; koreksi dari Anda
> akan menjadi acuan untuk pengembangan materi berikutnya.

## Tujuan

Memahami ADR Cindieh bukan soal menghafal 38 dokumen. Tujuannya adalah mampu **mengambil
keputusan arsitektur dengan bahasa dan landasan yang sama**, tanpa mengulang persoalan yang
sudah pernah diselesaikan. Saat sebuah PR atau permintaan fitur menyentuh modul tertentu, Anda
diharapkan dapat menemukan ADR yang relevan dalam beberapa menit, memahami batas tanggung
jawab yang sudah ditetapkan, serta mengenali bagian yang tidak boleh disederhanakan begitu saja.

## Hasil yang diharapkan

- Anda dapat memetakan ADR ke tujuh klaster dan mengetahui ADR mana yang
  menjawab pertanyaan tertentu (mis. “siapa pemilik state Run?”).
- Anda dapat menjelaskan kepada rekan tim mengapa token jembatan bukan rahasia, mengapa stop harus
  membatalkan semua permintaan yang masih tercatat, dan mengapa grid retur punya identitas baris yang berbeda —
  tanpa membuka kode.
- Anda bisa menulis ADR baru di repo ini dengan bentuk yang konsisten: judul sebagai kalimat
  keputusan, konteks berisi bukti, konsekuensi yang menyebut berkas, tes, dan verifikasi
  portal manual.
- Anda dapat menilai PR yang menyentuh jalur unduhan PDF atau sapuan setahun: apakah PR itu
  melanggar keputusan yang sudah tercatat?

## Batasan

- Bahasa pengantar pelajaran: Bahasa Indonesia, istilah kode dalam bahasa Inggris.
- Materi sumbernya adalah repo itu sendiri (ADR, `CONTEXT.md`, `AGENTS.md`, kode sumber) —
  bukan dokumentasi eksternal yang menggeneralisasi.
- Setiap pelajaran singkat (sekitar 12–15 menit) dan ditutup dengan uji ingatan, agar kursus dapat
  dilanjutkan di sesi berikutnya tanpa harus mengulang dari awal.

## Di luar cakupan

- Mengajarkan TypeScript, esbuild, atau MV3 dari nol.
- Membaca dan menjelaskan seluruh basis kode modul per modul.
- Menulis ADR baru untuk fitur yang belum ada (kecuali kalau Anda meminta).
