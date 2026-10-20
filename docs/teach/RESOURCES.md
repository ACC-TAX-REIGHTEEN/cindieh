# Sumber daya kursus ADR Cindieh

> **Workspace root: `docs/teach/`.** Tautan di bawah bersifat relatif terhadap folder
> `docs/teach/`, sehingga satu tingkat lebih tinggi untuk menuju repo.

## Pengetahuan

Sumber utama kursus ini adalah repo itu sendiri. Semua “pengetahuan” diukur terhadap berkas-berkas
ini, bukan terhadap internet.

- [Indeks ADR resmi (`docs/adr/README.md`)](../adr/README.md)
  Sumber kebenaran untuk seluruh keputusan dan statusnya. Baca ini sebelum menghafal atau
  menyimpulkan apa pun.
  Gunakan untuk: memverifikasi status, mencari ADR berdasarkan nomor.
- [Kamus domain (`CONTEXT.md`)](../../CONTEXT.md)
  Definisi istilah yang dipakai ADR — Run, masa pajak, Referensi, page fact, surface.
  Gunakan untuk: memahami kata kunci dalam sebuah ADR tanpa menebak.
- [Aturan proyek (`AGENTS.md`)](../../AGENTS.md)
  Konvensi repo: dua dunia, aturan bahasa, gotcha build, dan loop verifikasi manual.
  Gunakan untuk: memahami *kenapa* keputusan tertentu terlihat seperti sekarang.
- [Tabel pengukuran filter sweep per grid (`tools/README.md`)](../../tools/README.md)
  Bukti terukur yang jadi dasar ADR-0019 (hanya grid dengan filter terukur boleh menyapu setahun).
  Gunakan untuk: membedakan keputusan berbasis pengukuran dari keputusan berbasis penalaran.
- [Catatan rate limit (`RATE_LIMITING.md`)](../../RATE_LIMITING.md)
  Aturan jeda dan anggaran permintaan; ADR-0012 mengubah salah satu butirnya.
  Gunakan untuk: memahami kenapa jeda hanya boleh lebih lambat.
- [Michael Nygard, “Documenting Architecture Decisions” (Cognitect, 2011)](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
  Asal-usul format ADR dan alasan bentuk “konteks → keputusan → konsekuensi”.
  Gunakan untuk: pelajaran 01 dan saat menulis ADR sendiri.
- [adr.github.io](https://adr.github.io/)
  Kumpulan praktik penulisan ADR dari komunitas.
  Gunakan untuk: membandingkan bentuk ADR repo ini dengan praktik umum.
- [MDN — `Window.postMessage()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
  Perilaku dasar pesan antar jendela dan structured clone.
  Gunakan untuk: pelajaran 02 (kenapa hasil besar harus dipecah) dan ADR-0017.
- [esbuild — code splitting](https://esbuild.github.io/content-types/#code-splitting)
  Syarat `format: "esm"` dan perilaku dynamic import.
  Gunakan untuk: pelajaran 08 (ADR-0013) dan saat menyentuh `build.cjs`.
- [Chrome — content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
  Batasan MV3 soal tipe modul content script.
  Gunakan untuk: pelajaran 08 (ADR-0013).

## Komunitas dan praktik

Belum ada komunitas yang direkomendasikan. Kalau Anda ingin mempraktikkan “menulis ADR” di
luar repo ini, kandidat yang layak dijelajahi:

- [r/ExperiencedDevs](https://www.reddit.com/r/ExperiencedDevs/) — diskusi praktik arsitektur
  dengan moderator yang cukup ketat.

Preferensi komunitas: belum ada. Kalau Anda tidak ingin bergabung ke komunitas mana pun, catat
di sini supaya sesi berikutnya tidak terus mengusulkannya.

## Keterbatasan sumber

- **Tidak ada sumber tepercaya untuk keputusan “hanya PPN Keluaran boleh menyapu setahun”.**
  Sumbernya adalah pengukuran internal terhadap portal Coretax, yang tercatat di
  `tools/README.md` dan ADR-0019. Tidak ada publikasi eksternal yang bisa diverifikasi.
  Implikasi: jangan mencari pembenaran dari luar; rujuk tabel pengukuran.
- **Indeks ADR sudah lengkap 0001–0039**, jadi jumlah ADR di kursus ini berubah dari waktu ke waktu.
  Sebelum menyimpulkan “ada ADR untuk ini”, periksa indeks resmi
  (`docs/adr/README.md`) — bukan catatan lama di dokumen lain. Angka pada materi kursus selalu
   menyatakan jumlah pada saat materi itu ditulis.
- **Tidak ada dokumentasi resmi Microsoft untuk TypeScript 7** yang bisa dipercaya dari luar
  repo; dasar keputusan di ADR-0009 adalah sumber yang dipakai kursus ini.
