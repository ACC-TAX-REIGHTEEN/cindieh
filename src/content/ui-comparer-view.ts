// ============================================================
// UI-COMPARER-VIEW.TS — the "Bandingkan Data Penjualan" tab
// ============================================================
// The Komparator's VIEW, and nothing else: the paste area, the
// controls, the result grid and the export. Its arithmetic lives
// in comparer-logic.ts, its columns in result-columns.ts, the grid
// markup in result-grid-view.ts, and the overlay it lives in in
// ui-panel.ts.
//
// It follows the checker's own shape (ui-checker.ts, ADR-0036): a
// `createComparerView(deps)` factory plus a production singleton,
// so a test can drive the tab without an overlay and without the
// portal. The deps are the things the tab cannot own: the Run it
// reads and owes, the scrape it asks for, the hand-back to the
// grid, the grid's name, and whether this page can serve the tab
// at all.
//
// What it does NOT do: decide anything about tax. The matching,
// the pasted-row parsing and the tolerance are comparer-logic.ts's;
// the columns are result-columns.ts's; the overlay is ui-panel.ts's.
// ============================================================

import type { ComparisonResult } from "./comparer";
import { downloadXLSXFile, downloadCSVFile, resultNumberFormats } from "./exporter";
import {
  buildComparisonExportRows,
  COMPARISON_EXPORT_BASENAME,
  RESULT_EXPORT_LABELS,
  resultExportFilename,
  type ResultExportFormat,
} from "./comparer-export";
import { comparerSheetColumns, comparisonColumns } from "./result-columns";
import { runLifecycle, type RunLifecycle } from "./run-lifecycle";
import { createStatusLine } from "./status-line";
import { getPreferences } from "./preferences";
import { referenceIsIdentity } from "./page-context";
import {
  appendPagination,
  buildHeaderRow,
  buildResultRow,
  buildStatusFilterMenu,
  makeRowInteractive,
  reportResultExportFailure,
  PAGE_SIZE,
  type StatusFilterMenu,
} from "./result-grid-view";
import {
  currentGridLabel,
  RETIRED_REQUEST_NOTICE,
  scrapeForPanel,
  searchReference,
} from "./ui-panel";
import { debugLog } from "./debug";
import {
  applyComparerDefaults,
  applyStatusFilter,
  buildStatusSummary,
  computePagination,
  createComparerSession,
  formatStatusSummary,
  prepareComparison,
  rerunComparison,
  runComparison as runSessionComparison,
  type ComparerSession,
} from "./comparer-logic";

/** The tab's status line and result grid, for the messages that name them. */
const STATUS_ID = "ch-comparer-status";
const RESULTS_ID = "ch-comparer-results";
const FILTER_WRAP_ID = "ch-comparer-filter-wrap";

/** The status filter's own rows, in panel order. */
const FILTER_OPTIONS = [
  { value: "COCOK", label: "Cocok" },
  { value: "DPP_BERBEDA", label: "DPP Berbeda" },
  { value: "PPN_BERBEDA", label: "PPN Berbeda" },
  { value: "BERBEDA", label: "Berbeda" },
  { value: "TIDAK_DITEMUKAN", label: "Tidak ditemukan" },
  { value: "HANYA_CORETAX", label: "Hanya di Coretax" },
];

// ── The view's seam ───────────────────────────────────

/**
 * Everything the Komparator tab needs that is NOT its own. The Run is injected
 * whole rather than as the two or three calls the tab makes on it, because a
 * test can then build a real one with `createRunLifecycle()` and drive the
 * "no data yet" path and the settled-run path for real.
 */
export interface ComparerViewDeps {
  /** The Run whose result the comparison reads, and which the comparison owes. */
  run: RunLifecycle;
  /** Fetch the grid when the comparison has no rows to read yet. */
  scrape: () => void;
  /** Fill the portal's Referensi filter for a double-clicked row. */
  searchReference: (reference: string) => void;
  /** The grid's own name, for the "still fetching" notice. */
  gridLabel: () => string;
  /**
   * Whether this page can serve this tab at all. The Komparator matches
   * internal records to Coretax by Referensi, and a Referensi identifies a row
   * only on PPN Keluaran: a PPN Masukan Referensi is the seller's, and the
   * Retur grids have no Referensi column. The tab owns this question, because
   * the tab is what the answer is about (ADR-0036).
   */
  available: () => boolean;
}

/** One instance of the tab: its root, its controls, and its rendering. */
export interface ComparerView {
  /** Mount point for the panel shell. */
  readonly root: HTMLElement;
  /** Built by `inject()`; null until then. */
  filterMenu: StatusFilterMenu | null;
  /** Whether this page can serve this tab. */
  available(): boolean;
  /** Build the tab's controls and wire their events. Idempotent. */
  inject(): void;
  /** Draw the current results, pagination and filter state. */
  render(): void;
  /** "Periksa": compare the pasted rows with the Run's rows. */
  runCompare(): void;
  /** Re-compare after a tolerance, "Ref Lain" or date change. */
  rerun(): void;
  /** Run a comparison the Run owes it — the panel reopens on this tab. */
  runPending(): void;
  /**
   * Take back the "waiting for the grid" promise: the comparison this tab
   * queued was retired, so no completion will arrive to answer it.
   */
  dropPending(): void;
  exportResults(format: ResultExportFormat): void;
  /**
   * Put the caret in the paste area and offer the clipboard's contents.
   *
   * The panel's own work when it opens on this tab, which is why it lives with
   * the textarea rather than in the shell: the shell does not know that this
   * tab has a paste area, let alone what to paste into it.
   */
  focusInput(): void;
}

export function createComparerView(deps: ComparerViewDeps): ComparerView {
  const session: ComparerSession = createComparerSession();

  const root = document.createElement("div");
  root.id = "ch-comparer-view-compare";
  root.className = "ch-comparer-view";

  let filterMenu: StatusFilterMenu | null = null;
  let injected = false;

  /**
   * The controls this tab owns, held directly rather than looked up by id on
   * every use. They are created once, by `inject()`, and the panel may be
   * rebuilt around them — the shell re-hosts the same root, so the elements
   * never go stale.
   *
   * They stay nullable because the tab can be asked to render before it was
   * ever injected: a completion that arrives on a page where the panel was
   * never built has nothing to paint, and that is not an error.
   */
  let textarea: HTMLTextAreaElement | null = null;
  let toleranceInput: HTMLInputElement | null = null;
  let dailyDatesInput: HTMLInputElement | null = null;
  let refLainCheckbox: HTMLInputElement | null = null;
  let dailyCheckbox: HTMLInputElement | null = null;
  let toggleIcon: HTMLElement | null = null;
  let exportBtn: HTMLButtonElement | null = null;
  let exportCsvBtn: HTMLButtonElement | null = null;
  let resultsEl: HTMLElement | null = null;

  /**
   * This tab's status field.
   *
   * The promise, the summary, an error and the retirement notice all go
   * through it, so the tab has one account of what it is doing and the promise
   * lapses when anything else speaks (status-line.ts, ADR-0029).
   */
  const status = createStatusLine(STATUS_ID);

  // ── Stored defaults ────────────────────────────────

  /**
   * Apply the popup's Comparer defaults to the session and the two inputs that
   * mirror it. Called while the tab is built, because the panel owns these
   * controls per session and re-injecting the modal must not lose them.
   */
  function applyStoredDefaults(): void {
    const defaults = getPreferences().comparerDefaults;
    applyComparerDefaults(session, defaults);
    // An empty box, not "0": the panel shows the tolerance as an optional value.
    if (toleranceInput) toleranceInput.value = session.tolerance > 0 ? String(session.tolerance) : "";
    if (dailyDatesInput) {
      dailyDatesInput.value = defaults.dailyDates;
      dailyDatesInput.classList.toggle("ch-hidden", !session.dailyEnabled);
    }
  }

  // ── Inject ─────────────────────────────────────────

  function inject(): void {
    // The tab starts visible, and it starts visible EVERY time the panel is
    // built: a panel rebuilt after the last session ended on the other tab must
    // not come back showing it, and the shell decides which tab is showing when
    // the panel opens.
    root.classList.remove("ch-hidden");
    if (injected) return;
    injected = true;

    // Paste section (collapsible)
    const pasteSection = document.createElement("div");
    pasteSection.id = "ch-comparer-paste-section";
    pasteSection.className = "ch-comparer-paste-section";

    const pasteHeader = document.createElement("div");
    pasteHeader.className = "ch-comparer-paste-header";

    const pasteTitle = document.createElement("span");
    pasteTitle.textContent = "Data dari Excel";

    const toggleBtn = document.createElement("button");
    toggleBtn.id = "ch-comparer-toggle-btn";
    toggleBtn.type = "button";
    toggleBtn.className = "ch-comparer-toggle-btn";
    toggleBtn.title = "Tampilkan / sembunyikan area paste";
    // Icon-only (a chevron), so the title alone leaves it unnamed for a screen
    // reader.
    toggleBtn.setAttribute("aria-label", "Tampilkan / sembunyikan area paste");
    const icon = document.createElement("span");
    icon.id = "ch-comparer-toggle-icon";
    icon.className = "pi pi-chevron-up";
    icon.setAttribute("aria-hidden", "true");
    toggleBtn.appendChild(icon);
    toggleIcon = icon;

    pasteHeader.appendChild(pasteTitle);
    pasteHeader.appendChild(toggleBtn);

    const area = document.createElement("textarea");
    area.id = "ch-comparer-textarea";
    area.className = "ch-comparer-textarea";
    area.rows = 8;
    area.placeholder =
      "SZ-0447/07/26\tREF-001\t568.000\t62.480\nHH-0357/07/26\tREF-002\t1.481.203\t162.932\nSP-0169/07/26\tREF-003\t1.132.023\t124.523";
    textarea = area;

    pasteSection.appendChild(pasteHeader);
    pasteSection.appendChild(area);

    // Button row: Periksa (left) ... filter + Export Excel + CSV (right)
    const btnRow = document.createElement("div");
    btnRow.className = "ch-comparer-btn-row";

    const checkBtn = document.createElement("button");
    checkBtn.id = "ch-comparer-check-btn";
    checkBtn.className = "ch-comparer-btn ch-comparer-btn-primary";
    checkBtn.textContent = "Periksa";

    const clearBtn = document.createElement("button");
    clearBtn.id = "ch-comparer-clear-btn";
    clearBtn.className = "ch-comparer-btn ch-comparer-btn-secondary";
    clearBtn.textContent = "Hapus";

    // Tolerance input (next to Hapus)
    const tolerance = document.createElement("input");
    tolerance.id = "ch-comparer-tolerance";
    tolerance.type = "number";
    tolerance.min = "0";
    tolerance.step = "1";
    tolerance.placeholder = "Toleransi";
    tolerance.className = "ch-comparer-tolerance-input";
    tolerance.title = "Toleransi selisih DPP/PPN (default 0)";
    toleranceInput = tolerance;

    const leftGroup = document.createElement("div");
    leftGroup.className = "ch-comparer-btn-left";
    leftGroup.appendChild(checkBtn);
    leftGroup.appendChild(clearBtn);
    leftGroup.appendChild(toleranceInput);

    // Ref Lain checkbox
    const refLainWrap = document.createElement("div");
    refLainWrap.className = "ch-comparer-daily-wrap";

    const refLain = document.createElement("input");
    refLain.id = "ch-comparer-ref-lain";
    refLain.type = "checkbox";
    refLain.checked = true;
    refLain.className = "ch-comparer-daily-checkbox";
    refLainCheckbox = refLain;

    const refLainLabel = document.createElement("label");
    refLainLabel.className = "ch-comparer-daily-label";
    refLainLabel.htmlFor = "ch-comparer-ref-lain";
    refLainLabel.textContent = "Ref Lain";

    refLainWrap.appendChild(refLainCheckbox);
    refLainWrap.appendChild(refLainLabel);

    leftGroup.appendChild(refLainWrap);

    // Daily checkbox + date input
    const dailyWrap = document.createElement("div");
    dailyWrap.className = "ch-comparer-daily-wrap";

    const daily = document.createElement("input");
    daily.id = "ch-comparer-daily";
    daily.type = "checkbox";
    daily.checked = true;
    daily.className = "ch-comparer-daily-checkbox";
    // The box says which SCOPE the reverse check has: ticked, only the days
    // below are candidates for "Hanya di Coretax"; unticked, the whole grid is.
    daily.title = "Centang untuk mengecek hanya tanggal (1-31) di bawah. Biarkan kosong untuk mengecek seluruh periode.";
    dailyCheckbox = daily;

    const dailyLabel = document.createElement("label");
    dailyLabel.className = "ch-comparer-daily-label";
    dailyLabel.htmlFor = "ch-comparer-daily";
    dailyLabel.textContent = "Hari";

    dailyWrap.appendChild(dailyCheckbox);
    dailyWrap.appendChild(dailyLabel);

    const dailyDates = document.createElement("input");
    dailyDates.id = "ch-comparer-daily-dates";
    dailyDates.type = "text";
    dailyDates.className = "ch-comparer-daily-dates";
    dailyDates.title = "Tanggal (1-31), pisahkan dengan koma";
    dailyDatesInput = dailyDates;

    leftGroup.appendChild(dailyWrap);
    leftGroup.appendChild(dailyDatesInput);

    applyStoredDefaults();

    const xlsxBtn = document.createElement("button");
    xlsxBtn.id = "ch-comparer-export-btn";
    xlsxBtn.className = "ch-comparer-btn ch-comparer-btn-primary";
    xlsxBtn.textContent = RESULT_EXPORT_LABELS.xlsx;
    xlsxBtn.title = "Ekspor hasil perbandingan ke file Excel";
    xlsxBtn.disabled = true;
    exportBtn = xlsxBtn;

    // Two plain buttons rather than a format menu: the grid export already offers
    // XLSX and CSV side by side, and a second format must not cost a dropdown's
    // open/close state on a panel that is already the largest module in the project.
    const csvBtn = document.createElement("button");
    csvBtn.id = "ch-comparer-export-csv-btn";
    csvBtn.className = "ch-comparer-btn";
    csvBtn.textContent = RESULT_EXPORT_LABELS.csv;
    csvBtn.title = "Ekspor hasil perbandingan ke file CSV";
    csvBtn.disabled = true;
    exportCsvBtn = csvBtn;

    // Status filter dropdown (next to Export). Seeded from the session, because the
    // popup's stored filter has to survive the modal being re-injected.
    const menu: StatusFilterMenu = buildStatusFilterMenu({
      idPrefix: "ch-comparer",
      options: FILTER_OPTIONS,
      selected: session.statusFilter,
      onApply: (values) => {
        session.statusFilter = values as ComparisonResult["status"][];
        session.currentPage = 1;
        render();
      },
    });
    filterMenu = menu;

    const rightGroup = document.createElement("div");
    rightGroup.className = "ch-comparer-btn-right";
    rightGroup.appendChild(menu.wrap);
    rightGroup.appendChild(xlsxBtn);
    rightGroup.appendChild(csvBtn);

    btnRow.appendChild(leftGroup);
    btnRow.appendChild(rightGroup);

    const statusMsg = document.createElement("div");
    statusMsg.id = STATUS_ID;
    statusMsg.className = "ch-comparer-status";

    const results = document.createElement("div");
    results.id = RESULTS_ID;
    results.className = "ch-comparer-results ch-hidden";
    resultsEl = results;

    root.appendChild(pasteSection);
    root.appendChild(btnRow);
    root.appendChild(statusMsg);
    root.appendChild(results);

    // ── Event wiring ────────────────────────────────

    checkBtn.addEventListener("click", runCompare);

    clearBtn.addEventListener("click", () => {
      if (textarea) textarea.value = "";
      session.results = [];
      session.currentPage = 1;
      session.viewedRefs.clear();
      deps.run.cancelPending("compare");
      if (exportBtn) exportBtn.disabled = true;
      if (exportCsvBtn) exportCsvBtn.disabled = true;
      if (textarea) textarea.classList.remove("ch-hidden");
      if (toggleIcon) toggleIcon.className = "pi pi-chevron-up";
      if (resultsEl) {
        resultsEl.classList.add("ch-hidden");
        resultsEl.innerHTML = "";
      }
      status.clear();
      const wrap = document.getElementById(FILTER_WRAP_ID);
      if (wrap) wrap.classList.add("ch-hidden");
    });

    xlsxBtn.addEventListener("click", () => exportResults("xlsx"));
    csvBtn.addEventListener("click", () => exportResults("csv"));

    tolerance.addEventListener("change", () => {
      const val = parseInt(tolerance.value, 10);
      session.tolerance = isNaN(val) || val < 0 ? 0 : val;
      rerun();
    });

    refLain.addEventListener("change", () => {
      session.refLainEnabled = refLain.checked;
      rerun();
    });

    daily.addEventListener("change", () => {
      session.dailyEnabled = daily.checked;
      dailyDates.classList.toggle("ch-hidden", !session.dailyEnabled);
      rerun();
    });

    dailyDates.addEventListener("change", () => {
      rerun();
    });

    toggleBtn.addEventListener("click", () => {
      const isHidden = area.classList.contains("ch-hidden");
      area.classList.toggle("ch-hidden", !isHidden);
      if (toggleIcon) toggleIcon.className = isHidden ? "pi pi-chevron-up" : "pi pi-chevron-down";
    });

    area.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runCompare();
      }
    });
  }

  // ── The clipboard ──────────────────────────────────

  /**
   * Pre-fill the paste area from the clipboard, when the browser lets us read it.
   *
   * The read is permission-dependent — Chrome prompts for clipboard-read and
   * Firefox refuses without a declared permission — and this is a convenience,
   * not a feature, so the outcome is reported at debug level rather than shown.
   * Reported, though: the old `catch(() => {})` made "nothing on the clipboard"
   * and "never allowed to read it" indistinguishable in the field, and a browser
   * with no `navigator.clipboard` at all threw synchronously and took the whole
   * openPanel call with it.
   */
  function autoFillFromClipboard(area: HTMLTextAreaElement): void {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard || typeof clipboard.readText !== "function") {
      debugLog("Clipboard tidak tersedia; area tempel dibiarkan apa adanya.");
      return;
    }

    clipboard
      .readText()
      .then((text) => {
        if (text && !area.value) {
          area.value = text;
        }
      })
      .catch((err: unknown) => {
        debugLog("Clipboard read ditolak:", err);
      });
  }

  function focusInput(): void {
    if (!textarea) return;
    textarea.focus();
    autoFillFromClipboard(textarea);
  }

  // ── Check handlers ────────────────────────────────────

  function runCompare(): void {
    const textareaValue = textarea ? textarea.value : "";
    const datesValue = dailyDatesInput ? dailyDatesInput.value : "";
    const scrapedData = deps.run.result()?.data ?? null;

    const decision = prepareComparison(session, textareaValue, scrapedData, datesValue);

    deps.run.cancelPending("compare");
    if (decision.action === "error") {
      renderComparisonError(decision.message);
      return;
    }

    if (decision.action === "needScrape") {
      render();
      // The line remembers this as the promise it is making, so a retirement can
      // take it back (dropPending). A detached tab has nowhere to say any of
      // this, so it does not start a scrape it could never report on.
      const shown = status.set(
        "waiting",
        `Belum ada data. Mohon tunggu, sedang melakukan scraping data ${deps.gridLabel()} terlebih dahulu...`,
      );
      if (!shown) return;
      deps.run.request({ kind: "compare" });
      deps.scrape();
      return;
    }

    runSessionComparison(session, decision.pastedRows, decision.scrapedData);
    renderAfterComparison();
  }

  function rerun(): void {
    if (session.results.length === 0) return;
    runPending();
  }

  function runPending(): void {
    const result = rerunComparison(
      session, textarea ? textarea.value : "", deps.run.result()?.data ?? null,
      dailyDatesInput ? dailyDatesInput.value : "",
    );
    if (result.action === "error") {
      renderComparisonError(result.message);
    } else {
      renderAfterComparison();
    }
  }

  /**
   * The comparison this tab queued was retired — a stop, a failure, a lost chunk
   * or a reset — so the line promising it is replaced with the one line saying why
   * the result will not arrive.
   *
   * Nothing else moves: the pasted rows stay, so running it again is one click.
   * The badge carries the stop's own account, and this says only what the tab can
   * know — a blank line read as "nothing was asked for", while a second full
   * explanation would have been two accounts of one event (ADR-0026). The line's
   * own kind is the guard: it replaces a promise and nothing else, so a summary or
   * an error written since — the tab's real output — is out of its reach.
   */
  function dropPending(): void {
    status.replace("waiting", { kind: "notice", text: RETIRED_REQUEST_NOTICE });
  }

  function renderComparisonError(message: string): void {
    render();
    status.set("error", message);
    if (textarea) textarea.classList.remove("ch-hidden");
    if (toggleIcon) toggleIcon.className = "pi pi-chevron-up";
  }

  // ── Render results table ──────────────────────────────

  function renderAfterComparison(): void {
    render();
    status.set("summary", formatStatusSummary(buildStatusSummary(session.results)));

    if (textarea) textarea.classList.add("ch-hidden");
    if (toggleIcon) toggleIcon.className = "pi pi-chevron-down";
  }

  function render(): void {
    if (exportBtn) exportBtn.disabled = session.results.length === 0;
    // Both format buttons gate on the same thing — a grid with no results exports
    // nothing in either format, so leaving one enabled would promise a file.
    if (exportCsvBtn) exportCsvBtn.disabled = session.results.length === 0;
    const container = resultsEl;
    if (!container) return;

    container.classList.remove("ch-hidden");
    container.innerHTML = "";

    const filterWrap = document.getElementById(FILTER_WRAP_ID);
    if (filterWrap) filterWrap.classList.toggle("ch-hidden", session.results.length === 0);

    if (session.results.length === 0) {
      container.classList.add("ch-hidden");
      return;
    }

    const filtered = applyStatusFilter(session.results, session.statusFilter);
    const { totalPages, currentPage: clampedPage, startIndex, pageRows } =
      computePagination(filtered, PAGE_SIZE, session.currentPage);
    session.currentPage = clampedPage;

    const columns = comparisonColumns(session.refLainEnabled);

    const table = document.createElement("table");
    table.className = "ch-comparer-table";
    // The grid has no visible caption, so the table is named for assistive tech.
    table.setAttribute("aria-label", "Hasil perbandingan data penjualan");
    table.appendChild(buildHeaderRow(columns));

    const tbody = document.createElement("tbody");
    pageRows.forEach((r, idx) => {
      const tr = buildResultRow(columns, r, startIndex, idx);
      if (session.viewedRefs.has(r.reference)) {
        tr.classList.add("ch-comparer-row-viewed");
      }

      const isNotFound = r.status === "TIDAK_DITEMUKAN";
      makeRowInteractive(
        tr,
        isNotFound
          ? "Klik 1x untuk melihat teks lengkap"
          : "Klik 1x untuk melihat teks lengkap, klik 2x untuk mencari di Coretax",
      );

      if (!isNotFound) {
        tr.addEventListener("dblclick", () => {
          session.viewedRefs.add(r.reference);
          render();
          deps.searchReference(r.reference);
        });
      }

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    if (totalPages > 1) {
      appendPagination(container, session.currentPage, totalPages, (page) => {
        session.currentPage = page;
        render();
      });
    }
  }

  // ── Export results ────────────────────────────────────

  function exportResults(format: ResultExportFormat): void {
    const container = resultsEl;
    if (!container || container.classList.contains("ch-hidden")) return;

    if (session.results.length === 0) return;

    const rows = buildComparisonExportRows(session.results, session.refLainEnabled);
    const filename = resultExportFilename(COMPARISON_EXPORT_BASENAME, format);
    // CSV is hand-rolled and synchronous: no chunk load, so no failure to report.
    if (format === "csv") {
      downloadCSVFile(rows, filename);
      return;
    }
    // The amount columns' positions come from the same schema the rows do, so a
    // new sheet-only column cannot shift the formats one column left.
    void downloadXLSXFile(rows, filename, "Perbandingan", {
      numberFormats: resultNumberFormats(comparerSheetColumns(session.refLainEnabled)),
    }).catch((err: unknown) => reportResultExportFailure(err, status));
  }

  const view: ComparerView = {
    root,
    filterMenu: null,
    available: deps.available,
    inject() {
      inject();
      view.filterMenu = filterMenu;
    },
    render,
    runCompare,
    rerun,
    runPending,
    dropPending,
    exportResults,
    focusInput,
  };
  return view;
}

// ── Production view ───────────────────────────────────

/**
 * The tab as the panel builds it. Every dep here is a project singleton rather
 * than a browser API, so the factory above exists for tests that want their own
 * Run instead of the shared one.
 */
export const comparerView: ComparerView = createComparerView({
  run: runLifecycle,
  scrape: scrapeForPanel,
  searchReference,
  gridLabel: currentGridLabel,
  // A Referensi identifies a row only where the seller filed the invoice:
  // PPN Keluaran. On PPN Masukan it is the seller's, and the Retur grids have
  // no Referensi column at all — so the Komparator is PPN Keluaran's alone
  // (README.md, "Kenapa Komparator tidak ikut ke PPN Masukan?").
  available: referenceIsIdentity,
});

/** Re-run the comparison a finished Run owed it — main.ts calls this. */
export function runPendingCompare(): void {
  comparerView.runPending();
}

/**
 * Take back the comparison this tab queued: the Run it was waiting on is gone,
 * so no completion will arrive. The panel's badge already carries the stop; the
 * tab only stops promising (ADR-0022).
 */
export function dropPendingCompare(): void {
  comparerView.dropPending();
}
