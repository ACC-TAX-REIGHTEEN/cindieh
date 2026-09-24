/* ============================================================================
 * Cindieh — DIAGNOSTIK PENCARIAN REFERENSI  (tempel di DevTools Console)
 * ----------------------------------------------------------------------------
 * Tujuan: membandingkan pencarian referensi dengan nilai pendek (<= 6 karakter)
 * vs panjang (> 6 karakter), lalu MEMISAHKAN apakah lambatnya di SERVER DJP atau
 * di sisi EKSTENSI/PORTAL (klik tombol, render Angular, retry, dsb).
 *
 * CARA PAKAI
 *   1. Buka halaman e-Faktur PPN Keluaran di portal Coretax dan pastikan daftar
 *      faktur sudah pernah tampil (skrip mengambil "template request" dari sana).
 *   2. Isi CONFIG.nilaiPanjang di bawah, atau ketik referensi yang lambat
 *      (mis. EE-0309/07/26) di kolom "Cari Referensi" Cindieh sebelum menjalankan.
 *   3. Buka DevTools > Console, tempel seluruh isi file ini, lalu Enter.
 *      (Chrome mungkin meminta konfirmasi "allow pasting".)
 *   4. Tunggu. Skrip: (a) mengukur jalur ekstensi (Enter -> tabel berubah),
 *      (b) mengirim request uji dari iframe bersih yang TIDAK melewati patch
 *      ekstensi, (c) mencetak tabel hasil + blok KESIMPULAN.
 *
 * KENAPA PAKAI IFRAME
 *   Content script Cindieh hanya berjalan di frame utama (tanpa all_frames), jadi
 *   iframe same-origin punya XMLHttpRequest/PerformanceObserver yang masih asli.
 *   Request uji lewat iframe = murni perilaku server DJP, tanpa filter suntikan
 *   ekstensi, tanpa render portal. Selisihnya dengan jalur ekstensi menunjukkan
 *   biaya yang ditambahkan ekstensi/portal.
 *
 * KEPATUHAN
 *   - Hanya belasan request, berurutan (tidak pernah paralel), dengan jeda.
 *   - Hanya membaca data milik sesi login pengguna sendiri (memakai header yang
 *     sudah dipakai portal sendiri pada request grid-nya).
 *   - Nilai header Authorization/Cookie TIDAK pernah dicetak ke console.
 *
 * PERINTAH MANUAL SETELAH SKRIP JALAN
 *   __cindiehRefDiag.jalankan()                      -> ulangi seluruh pengukuran
 *   __cindiehRefDiag.cariReferensi("EE-0309/07/26")   -> cari cepat via prefix
 *   __cindiehRefDiag.hasil                            -> data mentah (JSON)
 *   __cindiehRefDiag.pulihkan()                       -> lepas semua patch skrip
 * ========================================================================== */

(() => {
  "use strict";

  // ── Konfigurasi (boleh diubah sebelum menjalankan) ───────────────────────
  const CONFIG = {
    /** Nilai uji utama (referensi lengkap yang lambat). Kosong = ambil dari kolom Cari Referensi. */
    nilaiPanjang: "",
    /** Panjang nilai yang dianggap masih "cepat" menurut laporan. */
    panjangPrefix: 6,
    /** Panjang nilai yang diuji pada eksperimen API terisolasi. */
    panjangUji: [5, 6, 7],
    /** MatchMode yang dibandingkan. "contains" = yang dipakai Cindieh saat ini. */
    matchModes: ["contains", "startswith"],
    /** MatchMode tambahan, hanya diuji pada nilai terpanjang (kandidat solusi). */
    matchModesNilaiPanjang: ["equals"],
    /** Rows per request uji (10 = default grid portal). */
    rows: 10,
    /** Jeda antar request uji (ms). Tidak pernah dikurangi otomatis. */
    jedaMs: 700,
    /** Timeout satu request uji (ms). Nilai lambat bisa > 30s, jadi jangan kecil. */
    timeoutMs: 180000,
    /** Batas halaman untuk __cindiehRefDiag.cariReferensi(). */
    maxHalamanCari: 3,
    /** Rows per halaman untuk cariReferensi (100 = opsi maksimum di UI portal). */
    rowsCari: 100,
    /** Uji juga nilai apa adanya (tanpa huruf besar) untuk membuktikan sensitivitas huruf server. */
    ujiKasus: true,
    /** Cetak detail request mentah. */
    verbose: false,
  };

  // ── State ────────────────────────────────────────────────────────────────
  const diag = {
    versi: "1.0.0",
    config: CONFIG,
    hasil: { ekstensi: [], api: [] },
    catatan: [],
  };
  window.__cindiehRefDiag = diag;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => performance.now();
  const bulat = (n) => (typeof n === "number" && isFinite(n) ? Math.round(n) : null);
  const median = (arr) => {
    const s = arr.filter((n) => typeof n === "number" && isFinite(n)).sort((a, b) => a - b);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const ms = (n) => (typeof n === "number" && isFinite(n) ? `${Math.round(n)} ms` : "-");
  const pathOf = (url) => {
    try {
      return new URL(url, location.href).pathname;
    } catch {
      return String(url || "").slice(0, 80);
    }
  };

  // ── Patch skrip ini (perekam request grid) ───────────────────────────────
  // Our patches are outermost: the portal calls us first, then Cindieh's own
  // XHR patch. We therefore see the portal's ORIGINAL body (the extension adds
  // its Reference filter one layer below) — which is exactly what we want as a
  // body template for the isolated experiment.
  const XHR_PROTO = XMLHttpRequest.prototype;
  const asli = {
    open: XHR_PROTO.open,
    send: XHR_PROTO.send,
    setRequestHeader: XHR_PROTO.setRequestHeader,
    fetch: window.fetch,
  };
  let terpasang = false;
  let iframeRealm = null;
  const templat = { ada: false, url: "", headers: {}, body: "" };
  const logReq = []; // { t, url, metode, sumber, durasiMs, status, baris, total, referensi[] }

  /** Same heuristic as the extension's isPaginatedGridBody(). */
  function bodyGrid(teks) {
    try {
      const p = JSON.parse(teks);
      return !!p && typeof p === "object" && p.First !== undefined && p.Rows !== undefined;
    } catch {
      return false;
    }
  }

  /** Pull the row array and row count out of `{ Payload: { Data: [...] } }`. */
  function barisDariRespons(teks) {
    if (!teks) return null;
    let p;
    try {
      p = JSON.parse(teks);
    } catch {
      return null;
    }
    const payload = (p && (p.Payload || p.payload)) || {};
    if (!Array.isArray(payload.Data)) return null;
    // The count field varies and is NOT guaranteed to be a row count (a 0-row
    // response can still carry a number here), so record which field answered —
    // `baris` (Data.length) stays the trustworthy one.
    const kandidat = ["Total", "TotalRecords", "TotalCount", "Count", "RecordsTotal"];
    let total = null;
    let totalField = null;
    for (const f of kandidat) {
      if (typeof payload[f] === "number") {
        total = payload[f];
        totalField = `Payload.${f}`;
        break;
      }
    }
    if (total === null && typeof p.Total === "number") {
      total = p.Total;
      totalField = "Total";
    }
    return {
      baris: payload.Data.length,
      total,
      totalField,
      rows: payload.Data,
      referensi: payload.Data.slice(0, 200).map((r) => String((r && r.Reference) || "")),
      contoh: payload.Data.slice(0, 3).map((r) => ({ noFaktur: r && r.TaxInvoiceNumber, referensi: r && r.Reference })),
    };
  }

  function simpanTemplat(url, headers, body) {
    if (!url || !body) return;
    templat.ada = true;
    templat.url = url;
    templat.headers = { ...headers };
    templat.body = body;
  }

  function catatSelesai(entri, t0, teks) {
    entri.durasiMs = now() - t0;
    // Never JSON.parse a huge payload (PDF base64 bodies) just for a row count.
    if (typeof teks !== "string" || teks.length > 3000000 || /download/i.test(entri.url || "")) return;
    const info = barisDariRespons(teks);
    if (info) {
      entri.baris = info.baris;
      entri.total = info.total;
      entri.totalField = info.totalField;
      entri.referensi = info.referensi;
      entri.contoh = info.contoh;
    }
  }

  function headersDariFetch(input, init) {
    const out = {};
    const taruh = (h) => {
      if (!h) return;
      if (typeof h.forEach === "function" && typeof h.get === "function") {
        h.forEach((v, k) => {
          out[k] = v;
        });
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) out[k] = v;
      } else if (typeof h === "object") {
        Object.assign(out, h);
      }
    };
    if (input && typeof input === "object" && input.headers) taruh(input.headers);
    if (init && typeof init === "object" && init.headers) taruh(init.headers);
    return out;
  }

  async function fetchDiag(ctx, args) {
    const input = args[0];
    const init = args[1];
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const metode = String((init && init.method) || (input && input.method) || "GET").toUpperCase();

    // Only read a body we can read safely: cloning a streaming download body
    // would buffer it and can break the portal's own response.
    let body = "";
    const punyaBody = metode !== "GET" && metode !== "HEAD";
    try {
      if (init && typeof init === "object" && typeof init.body === "string") {
        body = init.body;
      } else if (typeof init === "string") {
        body = init;
      } else if (
        punyaBody &&
        !url.includes("download") &&
        input &&
        typeof input === "object" &&
        typeof input.clone === "function" &&
        "body" in input
      ) {
        body = await input.clone().text();
      }
    } catch {
      /* body tidak terbaca — lewati saja */
    }

    const grid = !!body && bodyGrid(body);
    if (grid) simpanTemplat(url, headersDariFetch(input, init), body);

    const t0 = now();
    const entri = { t: t0, url, metode, sumber: "fetch", grid };
    logReq.push(entri);

    try {
      const resp = await asli.fetch.apply(ctx, args);
      entri.status = resp.status;
      if (grid) {
        try {
          catatSelesai(entri, t0, await resp.clone().text());
        } catch {
          entri.durasiMs = now() - t0;
        }
      } else {
        entri.durasiMs = now() - t0;
      }
      return resp;
    } catch (err) {
      entri.durasiMs = now() - t0;
      entri.error = `fetch gagal: ${(err && err.message) || err}`;
      throw err;
    }
  }

  function pasangPerekam() {
    if (terpasang) return;
    terpasang = true;

    XHR_PROTO.open = function (method, url, ...sisa) {
      this.__diagUrl = String(url);
      this.__diagMetode = String(method || "GET").toUpperCase();
      this.__diagHeaders = {};
      return asli.open.apply(this, [method, url, ...sisa]);
    };

    XHR_PROTO.setRequestHeader = function (nama, nilai) {
      if (this.__diagHeaders) this.__diagHeaders[nama] = nilai;
      return asli.setRequestHeader.apply(this, arguments);
    };

    XHR_PROTO.send = function (body) {
      const grid = typeof body === "string" && bodyGrid(body);
      if (grid) simpanTemplat(this.__diagUrl, this.__diagHeaders || {}, body);

      // Record EVERY request, not just grid-shaped ones: after a grid load the
      // portal fires its own lookup calls (see "getSingleReferenceData" in
      // main.js), and those can be where the wall-clock time actually goes.
      const t0 = now();
      const entri = { t: t0, url: this.__diagUrl, metode: this.__diagMetode, sumber: "xhr", grid };
      logReq.push(entri);
      this.addEventListener("load", () => {
        try {
          entri.status = this.status;
          catatSelesai(entri, t0, this.responseText);
        } catch (e) {
          entri.durasiMs = now() - t0;
          entri.error = String((e && e.message) || e);
        }
      });
      const gagal = (jenis) => () => {
        entri.durasiMs = now() - t0;
        entri.error = jenis;
      };
      this.addEventListener("error", gagal("network error"));
      this.addEventListener("timeout", gagal("timeout"));
      this.addEventListener("abort", gagal("abort"));

      return asli.send.apply(this, [body]);
    };

    window.fetch = function (...args) {
      return fetchDiag(this, args);
    };
  }

  function pulihkan() {
    if (!terpasang) return;
    terpasang = false;
    XHR_PROTO.open = asli.open;
    XHR_PROTO.send = asli.send;
    XHR_PROTO.setRequestHeader = asli.setRequestHeader;
    window.fetch = asli.fetch;
  }
  diag.pulihkan = pulihkan;

  // ── Realm bersih (iframe) untuk request uji terisolasi ───────────────────
  function realmBersih() {
    if (iframeRealm && iframeRealm.win && !iframeRealm.win.closed) return iframeRealm;
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(f);
    iframeRealm = { el: f, win: f.contentWindow, doc: f.contentDocument };
    diag.catatan.push(
      "Iframe bersih dibuat: request uji tidak melewati patch XHR/fetch Cindieh (murni server DJP).",
    );
    return iframeRealm;
  }

  function requestApi(url, headers, body) {
    const { win } = realmBersih();
    const XHRc = win.XMLHttpRequest;
    return new Promise((resolve) => {
      const xhr = new XHRc();
      let ttfbMs = null;
      let ukuranBytes = null;
      try {
        const po = new win.PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.name === url) {
              ttfbMs = e.responseStart - e.requestStart;
              ukuranBytes = e.transferSize || e.encodedBodySize || null;
            }
          }
        });
        po.observe({ type: "resource", buffered: false });
        setTimeout(() => {
          try {
            po.disconnect();
          } catch {
            /* sudah lepas */
          }
        }, CONFIG.timeoutMs + 2000);
      } catch {
        /* PerformanceObserver tidak tersedia — biarkan null */
      }

      const t0 = now();
      const selesai = (hasil) => resolve(Object.assign({ url, t0 }, hasil));
      xhr.open("POST", url, true);
      for (const [k, v] of Object.entries(headers)) {
        try {
          xhr.setRequestHeader(k, v);
        } catch {
          /* header tidak sah untuk XHR — dilewati */
        }
      }
      xhr.timeout = CONFIG.timeoutMs;
      xhr.onload = () => {
        const info = barisDariRespons(xhr.responseText) || {};
        const ok = xhr.status >= 200 && xhr.status < 300;
        selesai({
          durasiMs: now() - t0,
          ttfbMs,
          ukuranBytes,
          status: xhr.status,
          baris: info.baris,
          total: info.total,
          totalField: info.totalField,
          rows: info.rows,
          referensi: info.referensi,
          contoh: info.contoh,
          error: ok ? null : `HTTP ${xhr.status}`,
        });
      };
      xhr.onerror = () => selesai({ durasiMs: now() - t0, ttfbMs, ukuranBytes, status: 0, error: "network error" });
      xhr.ontimeout = () =>
        selesai({ durasiMs: now() - t0, ttfbMs, ukuranBytes, status: 0, error: `timeout > ${CONFIG.timeoutMs} ms` });
      xhr.send(body);
    });
  }

  // ── Body request: tiru injectFilters() milik ekstensi ────────────────────
  function bodyDenganFilter(bodyTemplat, nilai, matchMode) {
    const p = JSON.parse(bodyTemplat);
    const key = "Filters" in p ? "Filters" : "filters";
    if (!Array.isArray(p[key])) p[key] = [];
    // Idempotent, sama seperti injectFilters(): buang filter milik ekstensi dulu.
    p[key] = p[key].filter((f) => !f || !["Reference", "TaxInvoiceNumber"].includes(f.PropertyName || ""));
    if (nilai !== null) {
      p[key].push({
        PropertyName: "Reference",
        Value: nilai,
        MatchMode: matchMode,
        CaseSensitive: false,
        AsString: false,
      });
    }
    p.First = 0;
    p.Rows = CONFIG.rows;
    return JSON.stringify(p);
  }

  /**
   * Did every returned row actually contain the searched value? Empty
   * Reference cells are ignored (some rows legitimately carry none), so this is
   * only about rows that DO have a reference and still don't match. null = no
   * rows to judge.
   */
  function cocokSemua(referensi, nilai) {
    if (!Array.isArray(referensi)) return null;
    const terisi = referensi.filter((r) => String(r || "").trim() !== "");
    if (!terisi.length) return null;
    const atas = String(nilai).toUpperCase();
    return terisi.every((r) => r.toUpperCase().includes(atas));
  }

  // ── Pengukuran jalur ekstensi (yang dirasakan pengguna) ──────────────────
  function inputReferensi() {
    return (
      document.getElementById("ch-toolbar-filter-reference") ||
      document.getElementById("ch-grid-filter-reference")
    );
  }

  /**
   * Watch the grid table for mutations; resolve when it goes quiet. Gives both
   * "first paint after Enter" and "stable" timings.
   */
  function pantauTabel(tabel, timeoutMs = 90000, diamMs = 600) {
    const t0 = now();
    return new Promise((resolve) => {
      let pertamaMs = null;
      let terakhir = t0;
      let timer = null;
      let batas = null;
      const obs = new MutationObserver(() => {
        const t = now();
        if (pertamaMs === null) pertamaMs = t - t0;
        terakhir = t;
        if (timer) clearTimeout(timer);
        timer = setTimeout(tutup, diamMs);
      });
      function tutup() {
        if (timer) clearTimeout(timer);
        if (batas) clearTimeout(batas);
        obs.disconnect();
        resolve({ pertamaMs, stabilMs: pertamaMs === null ? null : terakhir - t0, selesaiMs: terakhir, diam: true });
      }
      obs.observe(tabel, { childList: true, subtree: true, characterData: true });
      batas = setTimeout(() => {
        obs.disconnect();
        resolve({ pertamaMs, stabilMs: null, selesaiMs: now(), diam: false });
      }, timeoutMs);
    });
  }

  async function ukurJalurEkstensi(nilai) {
    const input = inputReferensi();
    if (!input) {
      return { jalur: "ekstensi", nilai, error: "kolom Cari Referensi Cindieh tidak ada di halaman ini" };
    }
    const tabel = (document.querySelector("thead") || {}).closest
      ? document.querySelector("thead").closest("table") || document.body
      : document.body;

    console.log(`%c[Cindieh/diag] jalur ekstensi: "${nilai}" (Enter → tabel)`, "color:#888");
    const t0 = now();
    const pantau = pantauTabel(tabel);
    input.value = nilai;
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true, cancelable: true }));
    const ux = await pantau;
    // The table can settle while the grid request is still in flight (Angular
    // repaints the spinner first), so wait for the requests to finish before
    // closing the measurement window — otherwise we would report 0 requests.
    const selesaiMs = await tungguRequestSelesai(t0, ux.selesaiMs);
    await sleep(200);

    const reqs = logReq.filter((r) => r.t >= t0 - 20 && r.t <= selesaiMs + 50);
    const reqsGrid = reqs.filter((r) => r.grid);
    // The portal's own lookups ("getSingleReferenceData") start right after the
    // grid request, sometimes just past the settle window — include those too.
    const reqsLain = logReq
      .filter((r) => !r.grid && r.t >= t0 - 20 && r.t <= selesaiMs + 3000)
      .map((r) => `${pathOf(r.url)} (${ms(r.durasiMs)}${r.error ? `, ${r.error}` : ""})`);
    const terakhir = reqsGrid[reqsGrid.length - 1] || {};
    const cocok = cocokSemua(terakhir.referensi, nilai);

    const hasil = {
      jalur: "ekstensi",
      nilai,
      panjang: String(nilai).length,
      pertamaMs: bulat(ux.pertamaMs),
      stabilMs: bulat(ux.stabilMs) ?? (ux.diam ? bulat(ux.pertamaMs) : null),
      // End-to-end = the measurement window (Enter → grid request settled →
      // grace), not the last table repaint: the portal can repaint a spinner
      // long before the data arrives.
      selesaiMs: bulat(selesaiMs - t0),
      jumlahRequest: reqsGrid.length,
      msRequest:
        bulat(Math.max(...reqsGrid.map((r) => (typeof r.durasiMs === "number" ? r.durasiMs : 0)), 0)) || null,
      baris: terakhir.baris ?? null,
      total: terakhir.total ?? null,
      totalField: terakhir.totalField ?? null,
      cocok,
      permintaanLain: reqsLain,
      error: ux.diam ? terakhir.error || null : `tabel tidak stabil dalam 90s`,
      mentah: reqs,
    };
    diag.hasil.ekstensi.push(hasil);
    console.log(
      `%c[Cindieh/diag] jalur ekstensi "${nilai}": end-to-end ${ms(hasil.selesaiMs)} · ` +
        `${hasil.jumlahRequest} request grid (${ms(hasil.msRequest)}) · ${hasil.baris ?? "?"} baris · ` +
        `${reqsLain.length} request lain`,
      "color:#888",
    );
    if (reqsLain.length) console.log("%c[Cindieh/diag] request lain di jendela waktu:", "color:#888", reqsLain);
    return hasil;
  }

  // ── Eksperimen API terisolasi ────────────────────────────────────────────
  /**
   * Wait until every grid request started after `mulaiT` has settled (or the
   * cap is hit), then return the timestamp that closes the measurement window.
   */
  async function tungguRequestSelesai(mulaiT, sejakMs, batasMs = CONFIG.timeoutMs + 5000) {
    const batas = now() + batasMs;
    for (;;) {
      // Only grid requests gate the measurement; a long-lived portal request
      // (polling, asset fetch) must not hold the window open.
      const milik = logReq.filter((r) => r.grid && r.t >= mulaiT - 20);
      const masihJalan = milik.some((r) => r.durasiMs === undefined);
      if (!masihJalan) {
        const akhirRequest = milik.reduce((maks, r) => Math.max(maks, r.t + (r.durasiMs || 0)), sejakMs);
        return Math.max(sejakMs, akhirRequest);
      }
      if (now() > batas) return now();
      await sleep(200);
    }
  }

  async function ukurApi(nilai, matchMode, label = null) {
    const body = bodyDenganFilter(templat.body, nilai, matchMode);
    const hasil = await requestApi(templat.url, templat.headers, body);
    const cocok = cocokSemua(hasil.referensi, nilai);
    const baris = {
      jalur: "api (iframe bersih)",
      nilai,
      panjang: String(nilai).length,
      matchMode,
      label,
      durasiMs: bulat(hasil.durasiMs),
      ttfbMs: bulat(hasil.ttfbMs),
      status: hasil.status,
      baris: hasil.baris ?? null,
      total: hasil.total ?? null,
      totalField: hasil.totalField ?? null,
      ukuranKB: typeof hasil.ukuranBytes === "number" ? Math.round(hasil.ukuranBytes / 102.4) / 10 : null,
      cocok,
      error: hasil.error || null,
      contoh: hasil.contoh || [],
    };
    diag.hasil.api.push(baris);
    console.log(
      `%c[Cindieh/diag] api: "${nilai}" ${matchMode}${label ? ` [${label}]` : ""} → ${ms(hasil.durasiMs)}` +
        `${hasil.status ? ` · HTTP ${hasil.status}` : ""} · ${hasil.baris ?? "?"} baris` +
        `${typeof hasil.total === "number" ? ` (total ${hasil.total})` : ""}${hasil.error ? ` · ${hasil.error}` : ""}`,
      "color:#888",
    );
    return baris;
  }

  // ── Nilai uji ────────────────────────────────────────────────────────────
  function tentukanNilaiPanjang() {
    if (CONFIG.nilaiPanjang) return String(CONFIG.nilaiPanjang).trim();
    const input = inputReferensi();
    const terisi = input && String(input.value || "").trim();
    if (terisi) return terisi;
    try {
      const jawab = window.prompt("Referensi lengkap yang lambat (mis. EE-0309/07/26):", "");
      return String(jawab || "").trim();
    } catch {
      return "";
    }
  }

  /** Prefix of `panjang` characters, or null when the value is shorter than that. */
  function nilaiUntukPanjang(nilaiPanjang, panjang) {
    const potong = String(nilaiPanjang).slice(0, panjang);
    return potong.length === panjang ? potong : null;
  }

  /**
   * Test plan. `nilaiUji` is the UPPERCASED value — SET_SERVER_FILTER sends
   * `value.toUpperCase()` (main.ts) and the server's Reference filter turns out
   * to be case-sensitive, so a lowercase probe returns 0 rows and would measure
   * a near-empty query instead of the real one.
   */
  function rencanaUji(nilaiUji, nilaiMentah) {
    const rencana = [];
    const panjangSet = new Set([...CONFIG.panjangUji].filter((p) => p < String(nilaiUji).length));
    for (const p of [...panjangSet].sort((a, b) => a - b)) {
      const nilai = nilaiUntukPanjang(nilaiUji, p);
      if (nilai) for (const mode of CONFIG.matchModes) rencana.push({ nilai, mode });
    }
    for (const mode of CONFIG.matchModes) rencana.push({ nilai: nilaiUji, mode });
    for (const mode of CONFIG.matchModesNilaiPanjang) rencana.push({ nilai: nilaiUji, mode });
    if (CONFIG.ujiKasus && nilaiMentah && nilaiMentah !== nilaiUji) {
      rencana.push({ nilai: nilaiMentah, mode: "contains", label: "huruf asli (kontrol kasus)" });
    }
    return rencana;
  }

  // ── Alat bantu: cari referensi cepat (prefix + filter lokal) ─────────────
  /**
   * Fallback finder: query the server with a SHORT prefix (fast path) and then
   * filter the returned rows locally for the full reference. Prints the matching
   * invoices so the numbers can be used with the No. Faktur filter.
   */
  diag.cariReferensi = async function cariReferensi(referensi, opsi = {}) {
    const ref = String(referensi || "").trim();
    if (!ref) throw new Error("Referensi kosong.");
    if (!templat.ada) {
      throw new Error(
        "Belum ada template request grid. Jalankan satu pencarian dulu (Enter di kolom Cari Referensi), lalu ulangi.",
      );
    }
    // Uppercased for the same reason the extension does it in main.ts: the
    // server's Reference filter matches case-sensitively, so a lowercase
    // prefix would come back with 0 rows.
    const prefix = ref.slice(0, opsi.panjangPrefix || CONFIG.panjangPrefix).toUpperCase();
    const maxHalaman = opsi.maxHalaman || CONFIG.maxHalamanCari;
    const rowsPer = opsi.rows || CONFIG.rowsCari;
    const cocok = [];
    let total = null;
    let halaman = 0;

    for (halaman = 0; halaman < maxHalaman; halaman += 1) {
      const body = JSON.parse(bodyDenganFilter(templat.body, prefix, "contains"));
      body.First = halaman * rowsPer;
      body.Rows = rowsPer;
      const hasil = await requestApi(templat.url, templat.headers, JSON.stringify(body));
      if (hasil.error) throw new Error(`Request gagal: ${hasil.error}`);
      const atas = String(ref).toUpperCase();
      for (const row of hasil.rows || []) {
        if (String((row && row.Reference) || "").toUpperCase().includes(atas)) cocok.push(row);
      }
      total = hasil.total ?? total;
      if (!hasil.baris) break;
      await sleep(CONFIG.jedaMs);
    }

    // One row per invoice number so a reference appearing on two rows is visible.
    const unik = [];
    const sudah = new Set();
    for (const r of cocok) {
      const kunci = String((r && r.TaxInvoiceNumber) || "") + "|" + String((r && r.Reference) || "");
      if (sudah.has(kunci)) continue;
      sudah.add(kunci);
      unik.push({
        "No Faktur": (r && r.TaxInvoiceNumber) || "",
        Referensi: (r && r.Reference) || "",
        Tanggal: (r && r.TaxInvoiceDate) || "",
        Pembeli: (r && (r.BuyerTaxpayerNameClear || r.BuyerTaxpayerName)) || "",
        DPP: (r && r.SellingPrice) ?? "",
        PPN: (r && r.VAT) ?? "",
      });
    }

    const diperiksa = halaman * rowsPer;
    const terpotong = typeof total === "number" && diperiksa < total;
    console.group(`%c[Cindieh/diag] cari "${ref}" via prefix "${prefix}"`, "color:#0a7;font-weight:bold");
    console.log(
      `Halaman diperiksa: ${halaman} (${diperiksa} baris) · total baris di server: ${total ?? "?"} · faktur cocok: ${unik.length}`,
    );
    if (unik.length) console.table(unik);
    else console.warn("Tidak ada faktur yang cocok di halaman yang diperiksa — perpendek prefix atau naikkan maxHalamanCari.");
    if (terpotong) {
      console.warn(
        `Hasil server terpotong (${diperiksa} dari ${total} baris). Referensi yang dicari mungkin ada di halaman berikutnya.`,
      );
    }
    console.log("Tip: nomor di kolom 'No Faktur' di atas bisa ditempel ke filter No. Faktur Cindieh untuk unduh PDF massal.");
    console.groupEnd();
    return unik;
  };

  // ── Laporan & kesimpulan ─────────────────────────────────────────────────
  function lapor(nilaiPanjang) {
    const ekstensi = diag.hasil.ekstensi;
    const api = diag.hasil.api;

    console.group("%c[Cindieh] HASIL DIAGNOSTIK PENCARIAN REFERENSI", "color:#0a7;font-weight:bold");
    console.log(`Nilai uji utama: "${nilaiPanjang}" · panjang ${nilaiPanjang.length} karakter`);
    console.table(
      [...ekstensi, ...api].map((r) => ({
        jalur: r.jalur,
        nilai: r.nilai,
        panjang: r.panjang,
        matchMode: r.matchMode || "(contains, dari ekstensi)",
        uji: r.label || "",
        "durasi ms": r.jalur === "ekstensi" ? (r.selesaiMs ?? r.stabilMs) : r.durasiMs,
        "request grid": r.jalur === "ekstensi" ? r.jumlahRequest : 1,
        "ms request": r.jalur === "ekstensi" ? r.msRequest : r.durasiMs,
        "request lain": r.jalur === "ekstensi" ? (r.permintaanLain || []).length : "-",
        ttfb: r.ttfbMs ?? "-",
        HTTP: r.status ?? "-",
        baris: r.baris ?? "-",
        total: r.total === null || r.total === undefined ? "-" : `${r.total} [${r.totalField || "?"}]`,
        "hasil cocok": r.cocok === null ? "-" : r.cocok ? "ya" : "TIDAK",
        catatan: r.error || "",
      })),
    );
    if (diag.catatan.length) console.log("Catatan:", diag.catatan);
    if (CONFIG.verbose) console.log("Request log mentah:", logReq);
    console.log("Data mentah: __cindiehRefDiag.hasil");

    // ── Analisis ──
    // The case-control probe (same value, original letter case) is reported but
    // excluded from the timing medians: it is a different query (0 rows).
    const apiBersih = api.filter((r) => !r.error && !r.label);
    // Durasi dikelompokkan per MatchMode, BUKAN per panjang nilai: pada portal
    // asli "contains" 5 karakter pernah 24,8 s sementara 6 karakter 0,2 s
    // (run 3), jadi panjang nilai bukan variabel penentunya.
    const medianMode = (mode) => median(apiBersih.filter((r) => r.matchMode === mode).map((r) => r.durasiMs));
    const mContains = medianMode("contains");
    const ekstensiPanjang = ekstensi.find((e) => e.nilai === nilaiPanjang);
    const ekstensiPendek = ekstensi.find((e) => e.nilai !== nilaiPanjang);
    const apiPanjang = apiBersih.find((r) => r.matchMode === "contains" && r.panjang === nilaiPanjang.length);

    const temuan = [];
    const probeContains = apiBersih.filter((r) => r.matchMode === "contains" && typeof r.durasiMs === "number");
    const containsLambat = probeContains.filter((r) => r.durasiMs >= 3000);
    if (mContains !== null) {
      if (containsLambat.length) {
        const pendek = containsLambat.filter((r) => r.panjang <= CONFIG.panjangPrefix).length;
        temuan.push(
          `LAMBAT DI SERVER DJP, khususnya pada MatchMode "contains". Request terisolasi (tanpa ekstensi, tanpa render portal) juga lambat: ` +
            `${containsLambat.length} dari ${probeContains.length} probe "contains" ≥ 3 s ` +
            `(${containsLambat.map((r) => `${r.nilai} = ${ms(r.durasiMs)}`).join(", ")})` +
            `${pendek ? `, dan ${pendek} di antaranya bernilai ≤ ${CONFIG.panjangPrefix} karakter, jadi panjang nilai bukan penentunya` : ""}. ` +
            `Artinya bukan bug di kode Cindieh.`,
        );
      } else {
        temuan.push(
          `SERVER CEPAT pada "contains" (median ${ms(mContains)}) — lambatnya bukan di query server, cari biaya di jalur ekstensi/portal.`,
        );
      }
    } else if (api.length) {
      temuan.push("Data eksperimen API tidak lengkap (ada error/timeout) — ulangi run atau cek koneksi sesi.");
    }

    // Mode apa yang lebih cepat daripada "contains"? Bandingkan per mode,
    // bukan per panjang nilai, supaya kesimpulannya tidak menyesatkan.
    const alternatif = apiBersih.filter((r) => r.matchMode !== "contains" && typeof r.durasiMs === "number");
    if (alternatif.length && mContains !== null) {
      const tercepatPerMode = new Map();
      for (const r of alternatif) {
        const kini = tercepatPerMode.get(r.matchMode);
        if (!kini || r.durasiMs < kini.durasiMs) tercepatPerMode.set(r.matchMode, r);
      }
      const kandidatCepat = [...tercepatPerMode.values()].filter((r) => r.durasiMs < Math.max(mContains / 3, 800));
      if (kandidatCepat.length) {
        temuan.push(
          `ADA JALAN CEPAT: ${kandidatCepat
            .map((r) => `MatchMode "${r.matchMode}" (nilai "${r.nilai}") ${ms(r.durasiMs)}`)
            .join("; ")} vs median "contains" ${ms(mContains)}. ` +
            `Ini kandidat perbaikan di ekstensi (ganti match mode), dengan fallback ke "contains" bila 0 baris.`,
        );
      }
      const nolBaris = kandidatCepat.filter((r) => (r.baris || 0) === 0);
      if (nolBaris.length) {
        temuan.push(
          `Hati-hati: ${nolBaris.map((r) => `"${r.matchMode}" pada "${r.nilai}"`).join(", ")} cepat tetapi 0 baris — ` +
            `untuk nilai parsial hanya "startswith" yang cocok, "equals" tidak.`,
        );
      }
    }

    if (ekstensiPanjang && ekstensiPendek && ekstensiPanjang.jumlahRequest > 1) {
      temuan.push(
        `Jalur ekstensi mengirim ${ekstensiPanjang.jumlahRequest} request grid untuk satu pencarian — periksa apakah portal melakukan retry/duplikasi.`,
      );
    }
    if (ekstensiPanjang && ekstensiPanjang.error) temuan.push(`Jalur ekstensi: ${ekstensiPanjang.error}.`);
    if (ekstensiPanjang && ekstensiPanjang.cocok === false) {
      temuan.push(
        "Filter referensi tampak TIDAK diterapkan pada request portal (ada baris hasil yang tidak memuat nilai yang dicari).",
      );
    }
    if (apiPanjang && ekstensiPanjang && typeof apiPanjang.durasiMs === "number" && typeof ekstensiPanjang.msRequest === "number") {
      const selisih = ekstensiPanjang.msRequest - apiPanjang.durasiMs;
      // The server's own run-to-run variance on the same query reached ~5%
      // (96.1 s vs 100.6 s for one value), so a fixed 2 s threshold cried wolf:
      // require a gap that is both sizable in absolute terms and relative.
      if (selisih > 3000 && selisih > 0.25 * apiPanjang.durasiMs) {
        temuan.push(
          `Request lewat portal +${ms(selisih)} lebih lama daripada request identik lewat iframe bersih ` +
            `(request yang sama, jalur berbeda) — indikasi overhead di sisi portal/browser, bukan di server.`,
        );
      }
    }
    // Case sensitivity: the extension normalizes to uppercase, so this matters
    // for any future change that stops doing that.
    const kontrolKasus = api.filter((r) => r.label);
    if (kontrolKasus.length) {
      const k = kontrolKasus[0];
      const pembanding = api.find((r) => !r.label && r.matchMode === "contains" && r.panjang === k.panjang);
      if ((k.baris === 0 || k.baris === null) && pembanding && (pembanding.baris || 0) > 0) {
        temuan.push(
          `Filter Reference di SERVER bersifat case-sensitive: nilai "${k.nilai}" → ${k.baris ?? 0} baris, ` +
            `sedangkan "${pembanding.nilai}" → ${pembanding.baris} baris. main.ts sudah memakai value.toUpperCase(), ` +
            `jadi filter ekstensi selalu cocok — jangan hapus normalisasi itu.`,
        );
      }
    }
    const ekstensiDenganLain = ekstensi.filter((e) => (e.permintaanLain || []).length > 0);
    for (const e of ekstensiDenganLain) {
      temuan.push(
        `Jalur ekstensi "${e.nilai}": portal mengirim ${e.permintaanLain.length} request TAMBAHAN di luar request grid ` +
          `(${e.permintaanLain.slice(0, 4).join(", ")}${e.permintaanLain.length > 4 ? ", ..." : ""}). ` +
          `Ini bagian yang tidak terukur oleh request API langsung — periksa apakah jumlahnya meledak pada nilai panjang.`,
      );
    }
    if (!api.length) temuan.push("Eksperimen API tidak jalan (template request belum tertangkap).");

    console.group("%cKESIMPULAN", "color:#0a7;font-weight:bold");
    temuan.forEach((t, i) => console.log(`${i + 1}. ${t}`));
    console.groupEnd();
    console.groupEnd();
    diag.hasil.temuan = temuan;

    return temuan;
  }

  // ── Alur utama ───────────────────────────────────────────────────────────
  diag.jalankan = async function jalankan() {
    const nilaiMentah = tentukanNilaiPanjang();
    if (!nilaiMentah) {
      console.warn(
        "[Cindieh/diag] Tidak ada nilai uji. Isi CONFIG.nilaiPanjang atau ketik di kolom Cari Referensi, lalu jalankan ulang.",
      );
      return null;
    }

    // Mirror the extension: main.ts posts value.toUpperCase() as the server
    // filter value, and the server side turns out to be case-sensitive.
    const nilaiPanjang = nilaiMentah.toUpperCase();

    diag.hasil.ekstensi = [];
    diag.hasil.api = [];
    console.log(
      `%c[Cindieh/diag] mulai · nilai uji "${nilaiPanjang}"` +
        `${nilaiMentah !== nilaiPanjang ? ` (diketik "${nilaiMentah}", dinormalkan seperti ekstensi)` : ""}`,
      "color:#0a7;font-weight:bold",
    );

    const nilaiPrefix = nilaiPanjang.slice(0, CONFIG.panjangPrefix);
    // 1. Jalur ekstensi: nilai pendek dulu (sekaligus menjadi template request).
    if (nilaiPrefix !== nilaiPanjang) await ukurJalurEkstensi(nilaiPrefix);
    await ukurJalurEkstensi(nilaiPanjang);

    // 2. Pastikan template request grid ada sebelum eksperimen API.
    if (!templat.ada) {
      console.warn(
        "[Cindieh/diag] Belum ada request grid yang tertangkap. Pastikan daftar faktur sudah tampil, " +
          "lalu jalankan __cindiehRefDiag.jalankan() lagi.",
      );
      pulihkan();
      return null;
    }
    console.log(
      `%c[Cindieh/diag] template request dari ${pathOf(templat.url)} ` +
        `(header: ${Object.keys(templat.headers).length} · nilai Authorization/Cookie tidak dicetak)`,
      "color:#888",
    );

    // 3. Eksperimen API terisolasi.
    for (const { nilai, mode, label } of rencanaUji(nilaiPanjang, nilaiMentah)) {
      await ukurApi(nilai, mode, label);
      await sleep(CONFIG.jedaMs);
    }

    // 4. Laporan.
    const temuan = lapor(nilaiPanjang);
    pulihkan();
    return temuan;
  };

  // ── Boot ─────────────────────────────────────────────────────────────────
  if (window.__cindiehRefDiag && window.__cindiehRefDiag !== diag && window.__cindiehRefDiag.pulihkan) {
    window.__cindiehRefDiag.pulihkan();
  }
  pasangPerekam();
  console.log(
    "%c[Cindieh] Skrip diagnostik pencarian referensi aktif.",
    "color:#0a7;font-weight:bold",
  );
  void diag
    .jalankan()
    .catch((err) => console.error("[Cindieh/diag] gagal:", err))
    .finally(() => pulihkan());
})();
