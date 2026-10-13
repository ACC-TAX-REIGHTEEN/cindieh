/* ============================================================================
 * Cindieh — DIAGNOSTIK BATCH MASA PAJAK  (tempel di DevTools Console)
 * ----------------------------------------------------------------------------
 * Tujuan: menjawab dengan DATA apakah fitur "ekspor satu tahun sekaligus" itu
 * mungkin di portal Coretax, atau terhalang batas portal. Empat pertanyaan:
 *
 *   A. BISakah filter masa dijalankan dari sisi server? Body request grid portal
 *      memuat Filters — skrip membaca apa adanya lalu mencetak PropertyName,
 *      MatchMode, dan nilainya. Ini yang akan dipakai fitur, jadi jangan ditebak.
 *   B. APAKAH server menghormati Rows? scrapePaginated() (scraper-actions.ts)
 *      berhenti saat `rows.length < step` dengan step = 500 (e-faktur) / 1000
 *      (SPT). Kalau server MEMANGKAHI Rows lebih kecil dari step, satu halaman
 *      sudah terlihat "habis" dan run berhenti dengan data terpotong — tanpa
 *      error. Fase 2 mengukurnya langsung.
 *   C. APAKAH respons membawa jumlah total yang bisa dipercaya? referensi-search
 *      diagnostic menemukan Payload.Total "belum tentu jumlah baris". Fase 2
 *      membandingkannya dengan baris yang benar-benar dikembalikan.
 *   D. BERAPA lama satu masa, dan apakah ada jebakan setelah banyak request?
 *      Fase 3 memutar ulang beberapa masa berurutan seperti yang akan dilakukan
 *      fitur aslinya, lalu mengukur durasi realistisnya.
 *
 * Bonus: fase 3 melaporkan apakah baris punya RecordId / AggregateIdentifier.
 * getRowDedupeKey() (scraper-helpers.ts) jatuh ke stableStringify yang mahal
 * kalau kedua field itu kosong, jadi ini ikut menentukan berapa mahal dedupe.
 *
 * CARA PAKAI
 *   1. Buka halaman e-Faktur PPN Keluaran (atau PPN Masukan/SPT/Bukti Potong).
 *   2. Pilih SATU masa pajak di filter portal, klik Cari, dan biarkan tabel
 *      tampil. JANGAN ganti masa setelahnya — skrip mengambil template request
 *      dari request grid terakhir.
 *   3. DevTools > Console, tempel seluruh isi file ini, Enter.
 *      (Chrome mungkin meminta konfirmasi "allow pasting".)
 *   4. Tunggu blok KESIMPULAN.
 *   5. Kalau perlu menguji halaman/masa lain: __cindiehMasaDiag.templateUlang()
 *      lalu pilih masa baru di portal dan jalankan ulang.
 *
 * KEPATUHAN
 *   - Semua request berurutan, tidak pernah paralel, dengan jeda (CONFIG.jedaMs,
 *     default 1.200 ms — lebih besar dari default RATE_LIMITING.md karena ini
 *     sengaja menguji beban, bukan/export normal).
 *   - Hanya membaca data milik sesi login pengguna sendiri, memakai header yang
 *     sudah dipakai portal sendiri pada request grid-nya.
 *   - Nilai header Authorization/Cookie TIDAK pernah dicetak.
 *   - Rows pada fase 2 sengaja menyentuh batas; faze 3 dibatasi CONFIG.maxMasa.
 *   - Hanya URL grid yang portal pakai sendiri; tidak ada URL tebakan.
 *
 * PERINTAH MANUAL
 *   __cindiehMasaDiag.jalankan()            -> seluruh fase 1-4
 *   __cindiehMasaDiag.jalankan([2,3])       -> hanya fase yang dipilih
 *   __cindiehMasaDiag.fase2()               -> probe batas Rows saja
 *   __cindiehMasaDiag.fase3(["2026-01"])    -> satu masa, diukur
 *   __cindiehMasaDiag.hasil                 -> data mentah (JSON)
 *   __cindiehMasaDiag.templateUlang()       -> kosongkan template, ambil lagi
 *   __cindiehMasaDiag.pulihkan()            -> lepas semua patch skrip ini
 * ========================================================================== */

(() => {
  "use strict";

  // ── Konfigurasi (boleh diubah sebelum menjalankan) ───────────────────────
  const CONFIG = {
    /** Masa yang diuji di fase 3, dalam format yang-dimethylkan di dialog. Kosong = pakai masa aktif. */
    masaUji: [],
    /** Berapa banyak masa yang dicoba dialihkan bila CONFIG.masaUji kosong. */
    jumlahMasa: 3,
    /** Rows yang diuji di fase 2 (naik, untuk menemukan batas atas server). */
    rowsUji: [10, 100, 500, 1000, 2000, 5000],
    /** Jeda antar request (ms). JANGAN dikurangi — ini uji beban. */
    jedaMs: 1200,
    /** Timeout satu request (ms). */
    timeoutMs: 120000,
    /** Batas jumlah masa di fase 3 supaya tidak berubah jadi pemuatan. */
    maxMasa: 12,
    /** Cetak body request mentah (bukan hanya ringkasannya). */
    verbose: false,
  };

  // ── State ────────────────────────────────────────────────────────────────
  const diag = {
    versi: "1.0.0",
    config: CONFIG,
    hasil: { template: null, batasRows: [], masa: [] },
    temuan: [],
    catatan: [],
  };
  window.__cindiehMasaDiag = diag;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => performance.now();
  const bulat = (n) => (typeof n === "number" && isFinite(n) ? Math.round(n) : null);
  const ms = (n) => (typeof n === "number" && isFinite(n) ? `${Math.round(n)} ms` : "-");
  const locale = (n) => (typeof n === "number" ? n.toLocaleString("id-ID") : "-");

  const pathOf = (url) => {
    try {
      return new URL(url, location.href).pathname;
    } catch {
      return String(url || "").slice(0, 80);
    }
  };

  // ── Perekam template request ─────────────────────────────────────────────
  // Kita hanya melihat bentuk body, tidak pernah mencetak header sensitif.
  const XHR_PROTO = XMLHttpRequest.prototype;
  const asli = {
    open: XHR_PROTO.open,
    send: XHR_PROTO.send,
    setRequestHeader: XHR_PROTO.setRequestHeader,
  };
  let terpasang = false;
  const templat = { ada: false, url: "", headers: {}, body: "", t: 0 };

  /** Heuristik sama seperti isPaginatedGridBody() di skrip referensi. */
  function bodyGrid(teks) {
    try {
      const p = JSON.parse(teks);
      return !!p && typeof p === "object" && p.First !== undefined && p.Rows !== undefined;
    } catch {
      return false;
    }
  }

  function pasangPerekam() {
    if (terpasang) return;
    terpasang = true;

    XHR_PROTO.open = function (method, url, ...sisa) {
      this.__masaUrl = String(url);
      this.__masaHeaders = {};
      return asli.open.apply(this, [method, url, ...sisa]);
    };

    XHR_PROTO.setRequestHeader = function (nama, nilai) {
      if (this.__masaHeaders) this.__masaHeaders[nama] = nilai;
      return asli.setRequestHeader.apply(this, arguments);
    };

    XHR_PROTO.send = function (body) {
      // Hanya request BERKODE MASA (grid) yang dipakai sebagai template. Portal
      // mengirim banyak XHR lain (lookup, timer) yang bentuknya berbeda.
      if (typeof body === "string" && bodyGrid(body)) {
        templat.ada = true;
        templat.url = this.__masaUrl;
        templat.headers = { ...(this.__masaHeaders || {}) };
        templat.body = body;
        templat.t = Date.now();
      }
      return asli.send.apply(this, [body]);
    };
  }

  function pulihkan() {
    if (!terpasang) return;
    terpasang = false;
    XHR_PROTO.open = asli.open;
    XHR_PROTO.send = asli.send;
    XHR_PROTO.setRequestHeader = asli.setRequestHeader;
  }
  diag.pulihkan = pulihkan;

  // ── Realm bersih: request tanpa patch Cindieh maupun patch skrip ini ─────
  // Content script hanya jalan di frame utama (tanpa all_frames), jadi iframe
  // same-origin punya XHR asli. Hasilnya murni perilaku server DJP — persis
  // yang mau diukur di sini.
  let iframeRealm = null;
  function realmBersih() {
    if (iframeRealm && iframeRealm.win && !iframeRealm.win.closed) return iframeRealm;
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(f);
    iframeRealm = { el: f, win: f.contentWindow };
    return iframeRealm;
  }

  // ── Membaca respons ──────────────────────────────────────────────────────
  /**
   * Tarik baris + calon jumlah total dari `{ Payload: { Data: [...] } }`.
   *
   * Field total dicatat BESERTAN nama fieldnya karena tidak satu pun yang
   * ditemukan skrip referensi bisa dipercaya tanpa pembanding — fase 2
   * membandingkannya dengan baris nyata, jadi di situ nanti ketahuan mana
   * yang benar dan mana yang hanya kebetulan cocok.
   */
  function bacaRespons(teks) {
    const kosong = { ok: false, baris: null, rows: null, total: null, totalField: null, kandidat: [] };
    if (!teks) return kosong;
    let p;
    try {
      p = JSON.parse(teks);
    } catch {
      return { ...kosong, error: "respons bukan JSON" };
    }
    const payload = (p && (p.Payload || p.payload)) || {};
    if (!Array.isArray(payload.Data)) {
      return { ...kosong, error: "tidak ada Payload.Data (bukan respons grid?)" };
    }
    const nama = ["Total", "TotalRecords", "TotalCount", "Count", "RecordsTotal", "TotalRow"];
    const kandidat = [];
    for (const f of nama) {
      if (typeof payload[f] === "number") kandidat.push({ field: `Payload.${f}`, nilai: payload[f] });
    }
    if (typeof p.Total === "number") kandidat.push({ field: "Total", nilai: p.Total });
    return {
      ok: true,
      baris: payload.Data.length,
      rows: payload.Data,
      total: kandidat.length ? kandidat[0].nilai : null,
      totalField: kandidat.length ? kandidat[0].field : null,
      kandidat,
    };
  }

  function requestApi(body) {
    const { win } = realmBersih();
    const XHRc = win.XMLHttpRequest;
    return new Promise((resolve) => {
      const xhr = new XHRc();
      const t0 = now();
      xhr.open("POST", templat.url, true);
      for (const [k, v] of Object.entries(templat.headers)) {
        try {
          xhr.setRequestHeader(k, v);
        } catch {
          /* header tidak sah untuk XHR — dilewati, sama seperti portal */
        }
      }
      xhr.timeout = CONFIG.timeoutMs;
      xhr.onload = () => {
        const info = bacaRespons(xhr.responseText);
        const httpOk = xhr.status >= 200 && xhr.status < 300;
        resolve({
          durasiMs: now() - t0,
          status: xhr.status,
          httpOk,
          // 200 dengan payload rusak tetap kegagalan: portal kadang membalas
          // 200 lalu IsSuccessful=false, jadi bentuk respons ikut diperiksa.
          ok: httpOk && info.ok,
          ...info,
          error: httpOk ? info.error || null : `HTTP ${xhr.status}`,
        });
      };
      xhr.onerror = () =>
        resolve({ durasiMs: now() - t0, status: 0, ok: false, baris: null, rows: null, total: null, totalField: null, kandidat: [], error: "network error" });
      xhr.ontimeout = () =>
        resolve({ durasiMs: now() - t0, status: 0, ok: false, baris: null, rows: null, total: null, totalField: null, kandidat: [], error: `timeout > ${CONFIG.timeoutMs} ms` });
      xhr.send(body);
    });
  }

  // ── Body: meniru injectFilters() milik ekstensi ──────────────────────────
  /**
   * Clone template lalu set First/Rows. Filter dari portal dibiarkan apa adanya
   * — mengutak-atik Filters di sini justru akan mengukur sesuatu yang tidak
   * akan pernah dikirim fitur aslinya.
   */
  function bodyPaginasi(first, rows) {
    const p = JSON.parse(templat.body);
    p.First = first;
    p.Rows = rows;
    return JSON.stringify(p);
  }

  /**
   * Ganti filter masa pada template dengan nilai baru.
   *
   * `field` harus nama PropertyName yang BENAR — fase 1 membacanya dari request
   * portal, bukan ditebak. Mode-nya juga ikut diganti ke `matchMode` karena
   * server bisa memfilternya sebagai awalan; mismatch di sini akan terlihat
   * sebagai jumlah baris yang tidak berubah.
   */
  function bodyDenganMasa(field, nilaiMasa, mode, first, rows) {
    const p = JSON.parse(templat.body);
    const key = "Filters" in p ? "Filters" : "filters";
    if (!Array.isArray(p[key])) p[key] = [];
    p[key] = p[key].map((f) => {
      if (!f || f.PropertyName !== field) return f;
      return { ...f, Value: nilaiMasa, MatchMode: mode || f.MatchMode };
    });
    p.First = first;
    p.Rows = rows;
    return JSON.stringify(p);
  }

  /** Filter yang PORTAL kirim sendiri untuk masa — inilah yang harus diubah. */
  function filterMasaDariTemplate() {
    let p;
    try {
      p = JSON.parse(templat.body);
    } catch {
      return [];
    }
    const arr = p.Filters || p.filters;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((f) => f && typeof f.PropertyName === "string")
      .map((f) => ({
        PropertyName: f.PropertyName,
        Value: f.Value,
        MatchMode: f.MatchMode,
        CaseSensitive: f.CaseSensitive,
      }));
  }

  /** Deteksi field yang jelas-jelasJvibe periode, dari nama + nilainya. */
  function kandidatFieldMasa(filters) {
    const polaNama = /period|masa|taxmonth|taxyear|month|year|tahun|bulan/i;
    return filters.filter(
      (f) =>
        polaNama.test(f.PropertyName) &&
        f.Value !== null &&
        f.Value !== undefined &&
        f.Value !== "" &&
        typeof f.Value !== "boolean",
    );
  }

  // ── Fase 1: apa yang sebenarnya dikirim portal? ──────────────────────────
  async function fase1() {
    if (!templat.ada) {
      diag.temuan.push("FASE 1 GAGAL: belum ada request grid yang tertangkap.");
      return null;
    }
    let parsed = {};
    try {
      parsed = JSON.parse(templat.body);
    } catch {
      /* sudah dijaga di bodyGrid */
    }
    const filters = filterMasaDariTemplate();
    const kandidat = kandidatFieldMasa(filters);

    const laporan = {
      url: pathOf(templat.url),
      rowsDiTemplate: parsed.Rows ?? null,
      firstDiTemplate: parsed.First ?? null,
      jumlahFilter: filters.length,
      filters,
      kandidatMasa: kandidat,
      // Bawa seluruh kunci body selain Filters: nama seperti "SortOrder",
      // "TaxProfileId", atau apa pun yang ikut menentukan hasil perlu terlihat.
      kunciBody: Object.keys(parsed).filter((k) => k !== "Filters" && k !== "filters"),
    };
    diag.hasil.template = laporan;

    console.group("%c[Cindieh/diag] FASE 1 — template request dari portal", "color:#0a7;font-weight:bold");
    console.log(`URL grid: ${laporan.url}`);
    console.log(`Rows di template: ${laporan.rowsDiTemplate} · First: ${laporan.firstDiTemplate}`);
    console.log(`Kunci body lain: ${laporan.kunciBody.join(", ") || "-"}`);
    console.table(filters);
    if (kandidat.length) {
      console.log("%cField yang tampak seperti periode:", "color:#0a7;font-weight:bold");
      console.table(kandidat);
    } else {
      console.warn(
        "Tidak ada filter yang jelas-jelas periode di body ini. Kalau daftar faktur terfilter masa di layar, " +
          "portal mungkin mengirimnya lewat cookie/session, bukan Filters — itu sendiri jawaban penting.",
      );
    }
    if (CONFIG.verbose) console.log("Body mentah:", templat.body);
    console.log("Data: __cindiehMasaDiag.hasil.template");
    console.groupEnd();

    if (kandidat.length) {
      diag.temuan.push(
        `Filter masa dikirim portal lewat body.Filters sebagai ${kandidat
          .map((f) => `"${f.PropertyName}" (MatchMode "${f.MatchMode || "?"}", nilai contoh "${f.Value}")`)
          .join("; ")} — jadi BISA diubah dari skrip/ekstensi tanpa harus memutar UI portal.`,
      );
    } else {
      diag.temuan.push(
        "TIDAK ada filter periode di body.Filters. Kalau masa masih berlaku di layar, portal mengelola-nya di luar body — fitur batch harus mencari arah lain (atau tidak mungkin lewat jalur ini).",
      );
    }
    return laporan;
  }

  // ── Fase 2: apakah server menghormati Rows? ──────────────────────────────
  // Ini sekaligus menguji dugaan pada scrapePaginated(): kalau server meng-Clamp
  // Rows, halaman pertama yang lebih pendek dari step akan menghentikan loop
  // dan report "Complete" dengan data terpotong.
  async function fase2() {
    if (!templat.ada) {
      diag.temuan.push("FASE 2 GAGAL: belum ada template request grid.");
      return [];
    }
    const hasil = [];
    console.group("%c[Cindieh/diag] FASE 2 — batas Rows di server", "color:#0a7;font-weight:bold");
    console.log(`Request ${CONFIG.rowsUji.length}, berurutan, jeda ${CONFIG.jedaMs} ms. Jangan tutup tab.`);

    for (const rows of CONFIG.rowsUji) {
      const res = await requestApi(bodyPaginasi(0, rows));
      const catat = {
        rowsDiminta: rows,
        barisDikembalikan: res.baris,
        dihormati: res.baris === rows,
        total: res.total,
        totalField: res.totalField,
        kandidatTotal: res.kandidat,
        durasiMs: bulat(res.durasiMs),
        status: res.status,
        error: res.error || null,
        // Total yang persis sama dengan baris nyata adalah satu-satunya bukti
        // field itu jumlah baris, bukan field lain yang kebetulan bernilai.
        totalCocokBaris: res.total !== null && res.total === res.baris,
      };
      hasil.push(catat);
      diag.hasil.batasRows = hasil;
      console.log(
        `Rows ${String(rows).padStart(6)} → ${String(res.baris ?? "?").padStart(6)} baris` +
          `${catat.dihormati ? "" : "  ← TIDAK DIHORMATI (di-clamp/ditolak)"}` +
          `${res.total !== null ? ` · total ${res.total} [${res.totalField}]${catat.totalCocokBaris ? " ✓ cocok" : ""}` : " · total ?"}` +
          `${res.error ? ` · ${res.error}` : ""}`,
      );
      await sleep(CONFIG.jedaMs);
    }

    console.table(
      hasil.map((h) => ({
        "Rows diminta": h.rowsDiminta,
        "baris kembali": h.barisDikembalikan,
        dihormati: h.dihormati ? "ya" : "TIDAK",
        total: h.total ?? "-",
        "field total": h.totalField ?? "-",
        "total = baris": h.totalCocokBaris ? "ya" : "tidak",
        "durasi ms": h.durasiMs,
        HTTP: h.status,
        error: h.error || "",
      })),
    );

    // Penemuan 1: clamp tersembunyi.
    const diClamp = hasil.filter((h) => h.ok && !h.dihormati && h.barisDikembalikan > 0);
    if (diClamp.length) {
      const tertinggi = Math.max(...diClamp.map((h) => h.barisDikembalikan));
      const terkecilDiminta = Math.min(...diClamp.map((h) => h.rowsDiminta));
      diag.temuan.push(
        `PENTING — server MEMANGKAHI Rows: permintaan ${terkecilDiminta}+ hanya mengembalikan ${tertinggi} baris. ` +
          `Karena scrapePaginated() berhenti saat \`rows.length < step\` dengan step = 500 (e-faktur) / 1000 (SPT), ` +
          `run akan berhenti di halaman pertama dan tetap melaporkan "Complete". ` +
          `Ini adalah pemotongan data senyap dan harus ditangani (hentikan lebih awal atau bandingkan dengan total dari server) sebelum fitur apa pun yang bergantung pada kelengkapan.`,
      );
    } else {
      diag.temuan.push(
        "Server menghormati Rows pada semua nilai yang diuji — tidak ada pemotongan senyap dari sisi batas halaman.",
      );
    }

    // Penemuan 2: field mana yang benar-benar jumlah baris.
    const tepat = hasil.filter((h) => h.totalCocokBaris);
    if (tepat.length) {
      const fields = [...new Set(tepat.map((h) => h.totalField))];
      diag.temuan.push(
        `Field total yang PERTAMA kali cocok dengan jumlah baris nyata: ${fields.join(", ")}. ` +
          `Field ini bisa dipakai sebagai pembanding: run boleh memeriksa total yang diharapkan server, bukan hanya "halaman ini pendek".`,
      );
    } else {
      diag.temuan.push(
        "Tidak ada field total yang sama dengan jumlah baris nyata — respons jelas tidak membawa jumlah baris yang bisa dipercaya. " +
          "Kemungkinan besar tidak ada cara lain untuk memastikan semua baris terambil, selain andalan pada halaman pendek.",
      );
    }
    console.groupEnd();
    return hasil;
  }

  // ── Fase 3: memutar balik beberapa masa, seperti yang akan dilakukan fitur ─
  async function fase3(masaTersedia) {
    if (!templat.ada) {
      diag.temuan.push("FASE 3 GAGAL: belum ada template request grid.");
      return [];
    }
    const kandidat = kandidatFieldMasa(filterMasaDariTemplate());
    if (!kandidat.length) {
      diag.temuan.push("FASE 3 dilewati: tidak ada field periode yang bisa diganti di body (lihat FASE 1).");
      return [];
    }
    const field = kandidat[0].PropertyName;
    const modeAsli = kandidat[0].MatchMode || "equals";

    let daftar = Array.isArray(CONFIG.masaUji) && CONFIG.masaUji.length ? CONFIG.masaUji.map(String) : null;
    if (!daftar) {
      // Kode periode portal: TD.<3 digit prefix><2 digit bulan>. Prefix-nya
      // tetap untuk satu Wajib Pajak dan hanya bulan yang bergerak
      // (TD.00708 = Agustus, dilihat langsung di
      // /einvoiceportal/api/outputinvoice/list). Sintesis "2026-01" seperti
      // sebelumnya meminta nilai periode yang tidak pernah ada pada portal,
      // dan setiap bulan balik 0 baris - yang terbaca sebagai "tidak ada data
      // sama sekali", bukan sebagai bug yang sebenarnya.
      //
      // TaxInvoiceYear juga muncul sebagai kandidat, jadi pilih yang benar
      // berbentuk kode periode.
      const polaPeriode = /^.*\d{3}(0[1-9]|1[0-2])$/;
      const contoh = kandidat.map((k) => String(k.Value ?? "")).find((v) => polaPeriode.test(v));
      const pecah = contoh ? contoh.match(/^(.*\d{3})(0[1-9]|1[0-2])$/) : null;
      if (!pecah) {
        diag.temuan.push(
          "FASE 3 dilewati: nilai periode yang ditemukan tidak berbentuk TD.<prefix><MM>, " +
          "jadi masanya tidak bisa diturunkan. Isi CONFIG.masaUji manual.",
        );
        return [];
      }
      const prefiks = pecah[1];
      daftar = Array.from({ length: Math.min(CONFIG.jumlahMasa, CONFIG.maxMasa) }, (_, i) =>
        `${prefiks}${String(i + 1).padStart(2, "0")}`,
      );
      diag.catatan.push(
        `CONFIG.masaUji kosong, masa diturunkan dari nilai portal "${contoh}": ` +
        `${daftar.join(", ")}. Bulan tanpa data akan balik 0 baris; itu normal.`,
      );
    }
    daftar = daftar.slice(0, CONFIG.maxMasa);

    console.group("%c[Cindieh/diag] FASE 3 — putar balik per masa", "color:#0a7;font-weight:bold");
    console.log(`Field periode: "${field}" (MatchMode "${modeAsli}") · masa: ${daftar.join(", ")}`);

    const hasil = [];
    // Satu Set flatten dipakai lintas masa untuk menghitung duplikasi —
    // persis yang akan dilakukan mergeRows(), dan memberi tahu apakah
    // getRowDedupeKey() perlu stableStringify yang mahal.
    const semua = new Set();
    const idFieldHit = { RecordId: 0, AggregateIdentifier: 0, tanpaId: 0, contohTanpaId: null };

    for (const masa of daftar) {
      const tMasa = now();
      let halaman = 0;
      let barisMasa = 0;
      let rowsPerHalaman = 500;
      let galat = null;
      const contohMasa = [];

      for (;;) {
        const res = await requestApi(bodyDenganMasa(field, masa, modeAsli, halaman * rowsPerHalaman, rowsPerHalaman));
        if (!res.ok) {
          galat = res.error || `HTTP ${res.status}`;
          break;
        }
        barisMasa += res.baris || 0;
        for (const row of res.rows || []) {
          if (!contohMasa.length) {
            contohMasa.push({
              TaxInvoiceNumber: row.TaxInvoiceNumber ?? null,
              Reference: row.Reference ?? null,
              masaDariFilter: Object.entries(row).find(([k]) => /period|masa/i.test(k))?.[1] ?? null,
            });
          }
          const punyaId = row.RecordId || row.AggregateIdentifier;
          if (row.RecordId) idFieldHit.RecordId++;
          else if (row.AggregateIdentifier) idFieldHit.AggregateIdentifier++;
          else {
            idFieldHit.tanpaId++;
            if (!idFieldHit.contohTanpaId) {
              const kunci = Object.keys(row)[0];
              idFieldHit.contohTanpaId = kunci ? { field: kunci, nilai: row[kunci] } : null;
            }
          }
          semua.add(
            row.RecordId || row.AggregateIdentifier
              ? `id:${row.RecordId || row.AggregateIdentifier}`
              : `json:${JSON.stringify(row)}`,
          );
        }
        await sleep(CONFIG.jedaMs);
        // Berhenti saat halaman pendek — heuristik yang sama dengan scraper.
        if ((res.baris || 0) < rowsPerHalaman) break;
        // Pengaman: jangan halaman tanpa batas.
        if (++halaman >= 60) {
          galat = "pengaman: lebih dari 60 halaman untuk satu masa";
          break;
        }
      }

      const catat = {
        masa,
        barisMasa,
        halaman,
        durasiMs: bulat(now() - tMasa),
        galat,
        contoh: contohMasa,
      };
      hasil.push(catat);
      diag.hasil.masa = hasil;
      console.log(
        `${masa} → ${locale(barisMasa)} baris, ${halaman} halaman, ${ms(catat.durasiMs)}${galat ? ` · ${galat}` : ""}`,
      );
    }

    console.table(
      hasil.map((h) => ({
        masa: h.masa,
        baris: h.barisMasa,
        halaman: h.halaman,
        "durasi ms": h.durasiMs,
        galat: h.galat || "",
      })),
    );

    const totalBaris = hasil.reduce((s, h) => s + h.barisMasa, 0);
    const totalDurasi = hasil.reduce((s, h) => s + (h.durasiMs || 0), 0);
    const unik = semua.size;
    const contoh = hasil.find((h) => h.barisMasa > 0)?.contoh || [];

    diag.hasil.rangkumanMasa = {
      jumlahMasa: hasil.length,
      totalBaris,
      barisUnik: unik,
      duplikat: totalBaris - unik,
      totalDurasiMs: totalDurasi,
      idFieldHit,
      contoh,
    };

    console.group("%cRangkuman", "color:#0a7;font-weight:bold");
    console.log(`Total baris: ${locale(totalBaris)} · unik: ${locale(unik)} · duplikat: ${locale(totalBaris - unik)}`);
    console.log(`Total durasi: ${(totalDurasi / 1000).toFixed(1)} s untuk ${hasil.length} masa`);
    console.log(
      `Baris dengan RecordId: ${locale(idFieldHit.RecordId)} · AggregateIdentifier saja: ${locale(idFieldHit.AggregateIdentifier)} · tanpa ID: ${locale(idFieldHit.tanpaId)}`,
    );
    if (contoh.length) {
      console.log("Contoh baris dari masa pertama yang berisi data:");
      console.table(contoh);
    }
    console.log("Data: __cindiehMasaDiag.hasil.rangkumanMasa");
    console.groupEnd();
    console.groupEnd();

    // Temuan: filter masa benar-benar mengubah hasil.
    const adaData = hasil.filter((h) => h.barisMasa > 0);
    const kosong = hasil.filter((h) => h.barisMasa === 0 && !h.galat);
    if (adaData.length && kosong.length) {
      diag.temuan.push(
        `Filter masa terbukti bekerja dari sisi server: ${adaData.length} masa mengembalikan baris, ${kosong.length} masa mengembalikan 0. ` +
          `Jadi mengganti Value pada filter yang sama benar-benar mengganti kumpulan data — bukan mengabaikan filter.`,
      );
    } else if (adaData.length && adaData.length === hasil.length) {
      diag.temuan.push(
        "Semua masa yang diuji mengembalikan baris. Kalau itu terjadi padahal masa itu seharusnya kosong, nilai yang dikirim mungkin tidak sama dengan yang dipakai portal — periksa `contoh` di atas (kolom masaDariFilter).",
      );
    }
    if (hasil.some((h) => h.galat)) {
      diag.temuan.push(
        `Ada masa yang gagal: ${hasil.filter((h) => h.galat).map((h) => `${h.masa} (${h.galat})`).join(", ")}. ` +
          `Periksa apakah itu rate limit setelah request bertumpuk, atau masa yang memang tidak bisa difilter.`,
      );
    }

    // Temuan: apakah dedupe perlu stableStringify yang mahal.
    const pTanpaId = idFieldHit.tanpaId / Math.max(1, idFieldHit.tanpaId + idFieldHit.RecordId + idFieldHit.AggregateIdentifier);
    if (pTanpaId > 0.5) {
      diag.temuan.push(
        `Mayoritas baris (${(pTanpaId * 100).toFixed(0)}%) tidak punya RecordId maupun AggregateIdentifier, jadi ` +
          `getRowDedupeKey() jatuh ke stableStringify() yang rekursif dan mahal. ` +
          `Untuk ${locale(totalBaris)} baris itu berarti hitungan detik di thread portal — layak diganti kunci komposit O(1). ` +
          `Contoh nilai field pertama pada baris tanpa ID: ${JSON.stringify(idFieldHit.contohTanpaId)}`,
      );
    } else {
      diag.temuan.push(
        `Baris pada sumber ini memakai ID (${(100 - pTanpaId * 100).toFixed(0)}%), jadi jalur O(1) getRowDedupeKey() terpakai ` +
          `dan stableStringify() tidak menjadi bottleneck di sumber ini.`,
      );
    }

    // Temuan: perkiraan waktu untuk satu tahun.
    if (hasil.length && totalDurasi > 0) {
      const perMasa = totalDurasi / hasil.length;
      // perMasa is in MILLISECONDS. Dividing by 1000 gives seconds, not
      // minutes -- which printed a ~10 minute job as a ~10 hour one and put the
      // verdict on the wrong side of its own threshold.
      const perkiraanTahun = (perMasa * 12) / 60000;
      diag.temuan.push(
        `Perkiraan satu tahun (12 masa): ${perkiraanTahun.toFixed(1)} menit dengan jeda ${CONFIG.jedaMs} ms. ` +
          `${perkiraanTahun > 10 ? "Cukup lama — fitur perlu progres per masa, bisa dijeda, dan tidak boleh berjalan diam-diam." : "Layak dijalankan satu klik, asal ada progres per masa."}`,
      );
    }
    return hasil;
  }

  // ── Fase 4: kesimpulan ───────────────────────────────────────────────────
  function fase4() {
    console.group("%c[Cindieh/diag] KESIMPULAN", "color:#0a7;font-weight:bold");
    if (!diag.temuan.length) {
      console.warn("Tidak ada temuan — fase tidak jalan. Periksa __cindiehMasaDiag.hasil.");
    }
    diag.temuan.forEach((t, i) => console.log(`${i + 1}. ${t}`));
    if (diag.catatan.length) console.log("Catatan:", diag.catatan);
    console.log("Data mentah: __cindiehMasaDiag.hasil");
    console.groupEnd();

    const bisaBatch = diag.temuan.some((t) => t.includes("terbukti bekerja"));
    const adaClamp = diag.temuan.some((t) => t.includes("MEMANGKAHI Rows"));
    const adaTotal = diag.temuan.some((t) => t.includes("Field total yang PERTAMA"));
    console.group("%cJawaban singkat", "color:#0a7;font-weight:bold");
    console.log(`Batch lintas masa lewat filter server : ${bisaBatch ? "YA — terbukti" : "belum terbukti / perlu data lagi"}`);
    console.log(`Batas Rows portal perlu ditangani      : ${adaClamp ? "YA — pemotongan senyap terkonfirmasi" : "tidak terlihat pada Rows yang diuji"}`);
    console.log(`Jumlah total dari server bisa dipakai   : ${adaTotal ? "YA" : "tidak — hanya andalan halaman pendek"}`);
    console.groupEnd();

    return { bisaBatch, adaClamp, adaTotal, temuan: diag.temuan };
  }

  // ── Alur utama ───────────────────────────────────────────────────────────
  diag.templateUlang = function templateUlang() {
    templat.ada = false;
    templat.url = "";
    templat.headers = {};
    templat.body = "";
    diag.hasil.template = null;
    console.log(
      "%c[Cindieh/diag] Template dikosongkan. Pilih masa baru di filter portal, klik Cari, " +
        "lalu jalankan __cindiehMasaDiag.jalankan() lagi.",
      "color:#0a7",
    );
  };

  diag.fase2 = () => fase2().then(() => fase4());
  diag.fase3 = (masa) => fase3(masa).then(() => fase4());

  diag.jalankan = async function jalankan(fase = [1, 2, 3, 4]) {
    if (!templat.ada) {
      console.warn(
        "%c[Cindieh/diag] Belum ada template request grid tertangkap.\n" +
          "Pilih SATU masa pajak di filter portal → klik Cari → biarkan tabel tampil → tempel ulang skrip ini.",
        "color:#c00;font-weight:bold",
      );
      return null;
    }
    diag.temuan = [];
    diag.catatan = [];
    diag.hasil.batasRows = [];
    diag.hasil.masa = [];
    console.log(
      `%c[Cindieh/diag] mulai · fase ${fase.join(",")} · template dari ${pathOf(templat.url)}`,
      "color:#0a7;font-weight:bold",
    );

    let template = null;
    if (fase.includes(1)) template = await fase1();
    if (fase.includes(2)) await fase2();
    if (fase.includes(3)) await fase3(template ? template.kandidatMasa.map((k) => String(k.Value)) : null);

    const hasil = fase.includes(4) ? fase4() : null;
    pulihkan();
    return hasil;
  };

  // ── Boot ─────────────────────────────────────────────────────────────────
  if (window.__cindiehMasaDiag && window.__cindiehMasaDiag !== diag && window.__cindiehMasaDiag.pulihkan) {
    window.__cindiehMasaDiag.pulihkan();
  }
  pasangPerekam();
  console.log(
    "%c[Cindieh] Skrip diagnostik batch masa pajak aktif. Tunggu request grid pertama (pilih masa + Cari), lalu otomatis jalan.",
    "color:#0a7;font-weight:bold",
  );
  console.log(
    "%cKalau tabel sudah tampil SEBELUM skrip ini ditempel, jalankan manual: __cindiehMasaDiag.jalankan()",
    "color:#888",
  );

  // Tunggu request grid pertama muncul, lalu jalankan otomatis. Kalau tabel
  // sudah tampil, timeout pendek ini habis dan skrip menunggu perintah manual.
  void (async () => {
    const tenggat = now() + 30000;
    while (!templat.ada && now() < tenggat) await sleep(250);
    if (!templat.ada) return;
    await sleep(400); // beri portal kesempatan menyelesaikan render-nya
    await diag.jalankan().catch((err) => console.error("[Cindieh/diag] gagal:", err));
  })();

  void diag;
})();
