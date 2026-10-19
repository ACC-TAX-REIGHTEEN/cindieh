// ============================================================
// UI-CHECKER.TS — the "Pengecekan Keakuratan Nilai" tab
// ============================================================
// The accuracy check's arithmetic was already pure in
// checker-logic.ts (ADR-0003); its VIEW was not. It lived inside
// ui-comparer.ts, which by the audit's count meant one 1.268-line
// module building two views, two sessions, two tables, two filters
// and two export paths — with the checker's view reachable only
// through the comparer's test file. This is that tab's own view
// module, and it follows the project's DI convention: a
// `createCheckerView(deps)` factory plus a production singleton, so
// a test can drive the tab without an overlay or a portal.
//
// What it does NOT do: decide anything about tax. The benchmark,
// the tolerance and the per-row verdicts all arrive from
// checker-logic.ts; the labels it renders come from the preference
// schema; the grid markup it renders comes from result-grid-view.ts;
// and the overlay it lives in comes from ui-panel.ts.
// ============================================================

import { downloadXLSXFile, downloadCSVFile, resultNumberFormats } from "./exporter";
import {
  buildCheckerExportRows,
  CHECKER_EXPORT_BASENAME,
  RESULT_EXPORT_LABELS,
  resultExportFilename,
  type ResultExportFormat,
} from "./comparer-export";
import {
  CHECKER_IDENTITIES,
  checkerColumns,
  checkerSheetColumns,
  type Counterparty,
} from "./result-columns";
import { runLifecycle, type RunLifecycle } from "./run-lifecycle";
import { createStatusLine } from "./status-line";
import { getPreferences } from "./preferences";
import {
  checkerRowIdentity,
  counterpartyIsBuyer,
  hasReferenceFilter,
  type CheckerRowIdentity,
} from "./page-context";
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
  openPanel,
  RETIRED_REQUEST_NOTICE,
  scrapeForPanel,
  searchReference,
} from "./ui-panel";
import { computePagination } from "./comparer-logic";
import {
  applyCheckerDefaults,
  applyCheckerStatusFilter,
  checkAllRowsAccuracy,
  createCheckerSession,
  formatCheckSummary,
  BENCHMARK_TYPES,
  CHECKER_STATUSES,
  type BenchmarkType,
  type CheckerSession,
} from "./checker-logic";

/**
 * Panel label per benchmark value. Kept here rather than in the preference
 * schema because a label is presentation: the schema owns the VALUES, and this
 * is the only place they are rendered.
 */
export const BENCHMARK_LABELS: Record<BenchmarkType, string> = {
  DPP: "DPP",
  DPP_NILAI_LAIN: "DPP NL",
  PPN: "PPN",
};

/** Panel label per checker status-filter key, in the schema's own order. */
export const CHECKER_STATUS_LABELS: Record<string, string> = {
  DPP_BERBEDA: "DPP Berbeda",
  DPP_NILAI_LAIN_BERBEDA: "DPP NL Berbeda",
  PPN_BERBEDA: "PPN Berbeda",
  DUA_BERBEDA: "Dua Nilai Berbeda",
  DATA_TIDAK_LENGKAP: "Data tidak lengkap",
};

// ── The view's seam ───────────────────────────────────

/**
 * Everything the Pengecekan tab needs that is NOT its own. The Run is injected
 * whole rather than as the two or three calls the tab makes on it, because a
 * test can then build a real one with `createRunLifecycle()` and drive the
 * "no data yet" path and the settled-run path for real.
 */
export interface CheckerViewDeps {
  /** The Run whose result the check reads, and which the check owes. */
  run: RunLifecycle;
  /** Fetch the grid when the check has no rows to read yet. */
  scrape: () => void;
  /** Show the panel on this tab — a pending check lands with the panel closed. */
  openCheckTab: () => void;
  /** Fill the portal's Referensi filter for a double-clicked row. */
  searchReference: (reference: string) => void;
  /** The grid's own name, for the "still fetching" notice. */
  gridLabel: () => string;
  /** Which side of the transaction this page shows — decides the column words. */
  counterparty: () => Counterparty;
  /**
   * What names a row on this grid: the Referensi on the two PPN grids, the NO
   * RETUR on the two Retur grids. A page fact of its own, and not a synonym for
   * either neighbour — `canSearchInGrid` (the filter's fact) is about a lookup,
   * and the page gate is about whether the check runs here at all. The identity
   * decides the column AND the double-click's key, which is why the retur grids
   * get a "No Retur" column while their rows offer no search.
   */
  identity: () => CheckerRowIdentity;
  /** Whether a double-clicked row can actually be searched in the portal grid. */
  canSearchInGrid: () => boolean;
}

/** One instance of the tab: its root, its controls, and its rendering. */
export interface CheckerView {
  /** Mount point for the panel shell. */
  readonly root: HTMLElement;
  /** Built by `inject()`; null until then. */
  filterMenu: StatusFilterMenu | null;
  /** Build the tab's controls and wire their events. Idempotent. */
  inject(): void;
  /** Draw the current results, pagination and filter state. */
  render(): void;
  /** "Periksa": check the Run's rows, scraping first when there are none. */
  runCheck(): void;
  /** Re-check after a benchmark or tolerance change. */
  rerun(): void;
  /** Run a check the Run owes — the panel reopens on this tab. */
  runPending(): void;
  /**
   * Take back the "waiting for the grid" promise: the check this tab queued was
   * retired, so no completion will arrive to answer it.
   */
  dropPending(): void;
  exportResults(format: ResultExportFormat): void;
}

export function createCheckerView(deps: CheckerViewDeps): CheckerView {
  const session: CheckerSession = createCheckerSession();

  const root = document.createElement("div");
  root.id = "ch-comparer-view-checker";
  root.className = "ch-comparer-view ch-hidden";

  let filterMenu: StatusFilterMenu | null = null;
  let benchmarkSelect: HTMLSelectElement | null = null;
  let toleranceInput: HTMLInputElement | null = null;
  let injected = false;

  /**
   * The tab's status field.
   *
   * Every line this tab shows — the promise made while the grid is fetched, the
   * summary of a finished check, an error, the retirement notice — is written
   * through this one object, so no caller picks a class by hand and the promise
   * lapses the moment anything else speaks (status-line.ts, ADR-0029).
   */
  const status = createStatusLine("ch-checker-status");

  // ── Stored defaults ────────────────────────────────

  /**
   * Apply the popup's Checker defaults to the session and the two inputs that
   * mirror the first two of them. The third — the status filter — is applied by
   * the menu builder, which takes the stored selection to seed its checkboxes.
   */
  function applyStoredDefaults(): string[] {
    const defaults = getPreferences().checkerDefaults;
    applyCheckerDefaults(session, defaults);
    if (benchmarkSelect) benchmarkSelect.value = session.benchmark;
    // Same rule as the comparer's box: an empty field means "no tolerance".
    if (toleranceInput) {
      toleranceInput.value = session.tolerance > 0 ? String(session.tolerance) : "";
    }
    return session.statusFilter;
  }

  // ── Inject ─────────────────────────────────────────

  function inject(): void {
    if (injected) return;
    injected = true;

    const btnRow = document.createElement("div");
    btnRow.className = "ch-comparer-btn-row";

    const checkBtn = document.createElement("button");
    checkBtn.id = "ch-checker-check-btn";
    checkBtn.className = "ch-comparer-btn ch-comparer-btn-primary";
    checkBtn.textContent = "Periksa";

    const benchmarkWrap = document.createElement("div");
    benchmarkWrap.className = "ch-checker-benchmark-wrap";

    const benchmarkLabel = document.createElement("label");
    benchmarkLabel.className = "ch-checker-benchmark-label";
    benchmarkLabel.htmlFor = "ch-checker-benchmark-select";
    benchmarkLabel.textContent = "Acuan:";

    const select = document.createElement("select") as HTMLSelectElement;
    select.id = "ch-checker-benchmark-select";
    select.className = "ch-checker-benchmark-select";

    // Built from the schema's list, so a benchmark added there cannot be missing
    // from the panel (and the panel cannot offer one the session cannot store).
    for (const benchmark of BENCHMARK_TYPES) {
      const option = document.createElement("option");
      option.value = benchmark;
      option.textContent = BENCHMARK_LABELS[benchmark];
      select.appendChild(option);
    }
    benchmarkSelect = select;

    benchmarkWrap.appendChild(benchmarkLabel);
    benchmarkWrap.appendChild(benchmarkSelect);

    const tolerance = document.createElement("input") as HTMLInputElement;
    tolerance.id = "ch-checker-tolerance";
    tolerance.type = "number";
    tolerance.min = "0";
    tolerance.step = "1";
    tolerance.placeholder = "Toleransi";
    tolerance.className = "ch-comparer-tolerance-input";
    tolerance.title = "Toleransi selisih parameter yang tidak perlu ditampilkan (default 0)";
    toleranceInput = tolerance;

    // The popup's stored defaults, applied while the tab is built — the panel
    // owns these controls for the life of the modal, so a later fetch would be a
    // race with the user's first click.
    const storedFilter = applyStoredDefaults();

    const leftGroup = document.createElement("div");
    leftGroup.className = "ch-comparer-btn-left";
    leftGroup.appendChild(checkBtn);
    leftGroup.appendChild(benchmarkWrap);
    leftGroup.appendChild(toleranceInput);

    const exportBtn = document.createElement("button");
    exportBtn.id = "ch-checker-export-btn";
    exportBtn.className = "ch-comparer-btn ch-comparer-btn-primary";
    exportBtn.textContent = RESULT_EXPORT_LABELS.xlsx;
    exportBtn.title = "Ekspor hasil pengecekan ke file Excel";

    const exportCsvBtn = document.createElement("button");
    exportCsvBtn.id = "ch-checker-export-csv-btn";
    exportCsvBtn.className = "ch-comparer-btn";
    exportCsvBtn.textContent = RESULT_EXPORT_LABELS.csv;
    exportCsvBtn.title = "Ekspor hasil pengecekan ke file CSV";

    // "ALL" is the empty selection, which applyCheckerStatusFilter already
    // treats as "no filter"; the rest come from the schema so the panel and the
    // stored default can never disagree.
    const menu = buildStatusFilterMenu({
      idPrefix: "ch-checker",
      options: CHECKER_STATUSES.map((status) => ({
        value: status,
        label: CHECKER_STATUS_LABELS[status],
      })),
      selected: storedFilter,
      onApply: (values) => {
        session.statusFilter = values;
        session.currentPage = 1;
        render();
      },
    });
    filterMenu = menu;

    const rightGroup = document.createElement("div");
    rightGroup.className = "ch-comparer-btn-right";
    rightGroup.appendChild(menu.wrap);
    rightGroup.appendChild(exportBtn);
    rightGroup.appendChild(exportCsvBtn);

    btnRow.appendChild(leftGroup);
    btnRow.appendChild(rightGroup);

    const statusMsg = document.createElement("div");
    statusMsg.id = "ch-checker-status";
    statusMsg.className = "ch-comparer-status";

    const results = document.createElement("div");
    results.id = "ch-checker-results";
    results.className = "ch-comparer-results ch-hidden";

    root.appendChild(btnRow);
    root.appendChild(statusMsg);
    root.appendChild(results);

    // ── Event wiring ────────────────────────────────

    checkBtn.addEventListener("click", runCheck);

    select.addEventListener("change", () => {
      session.benchmark = select.value as BenchmarkType;
      rerun();
    });

    tolerance.addEventListener("change", () => {
      const val = parseInt(tolerance.value, 10);
      session.tolerance = isNaN(val) || val < 0 ? 0 : val;
      rerun();
    });

    exportBtn.addEventListener("click", () => exportResults("xlsx"));
    exportCsvBtn.addEventListener("click", () => exportResults("csv"));
  }

  // ── Check handlers ────────────────────────────────

  function check(scrapedData: Record<string, unknown>[]): void {
    session.results = checkAllRowsAccuracy(
      scrapedData,
      session.benchmark,
      session.tolerance,
    );
    session.currentPage = 1;
    renderAfterCheck();
  }

  function runCheck(): void {
    const scrapedData = deps.run.result()?.data ?? null;
    if (!scrapedData || scrapedData.length === 0) {
      // The line remembers this as the promise it is making, so a retirement can
      // take it back (dropPending). A detached tab has nowhere to say any of
      // this, so it does not start a scrape it could never report on.
      const shown = status.set(
        "waiting",
        `Belum ada data. Mohon tunggu, sedang melakukan scraping data ${deps.gridLabel()} terlebih dahulu...`,
      );
      if (!shown) return;
      deps.run.request({ kind: "check" });
      deps.scrape();
      return;
    }

    check(scrapedData);
  }

  function rerun(): void {
    const scrapedData = deps.run.result()?.data ?? null;
    if (!scrapedData || scrapedData.length === 0) return;
    check(scrapedData);
  }

  function runPending(): void {
    const scrapedData = deps.run.result()?.data ?? null;
    if (!scrapedData || scrapedData.length === 0) return;

    deps.openCheckTab();
    check(scrapedData);
  }

  // ── Render ─────────────────────────────────────────

  function renderAfterCheck(): void {
    render();
    status.set("summary", formatCheckSummary(session.results));
  }

  function render(): void {
    const container = document.getElementById("ch-checker-results");
    if (!container) return;

    container.classList.remove("ch-hidden");
    container.innerHTML = "";

    const filterWrap = document.getElementById("ch-checker-filter-wrap");
    if (filterWrap) filterWrap.classList.remove("ch-hidden");

    if (session.results.length === 0) {
      if (filterWrap) filterWrap.classList.add("ch-hidden");
      container.textContent = "Semua faktur sesuai.";
      return;
    }

    const filtered = applyCheckerStatusFilter(session.results, session.statusFilter);
    const { totalPages, currentPage, startIndex, pageRows } = computePagination(
      filtered,
      PAGE_SIZE,
      session.currentPage,
    );
    session.currentPage = currentPage;

    const identity = deps.identity();
    const columns = checkerColumns(session.benchmark, deps.counterparty(), identity);
    const rowIdentity = CHECKER_IDENTITIES[identity].value;

    const table = document.createElement("table");
    table.className = "ch-comparer-table";
    // The grid has no visible caption, so the table is named for assistive tech.
    table.setAttribute("aria-label", "Hasil pengecekan keakuratan nilai");
    table.appendChild(buildHeaderRow(columns));

    const tbody = document.createElement("tbody");
    pageRows.forEach((r, idx) => {
      const tr = buildResultRow(columns, r, startIndex, idx);
      // The row's identity is what a double-click hands back to the grid. On the
      // invoice grids that is the Referensi, or the invoice number where the row
      // has none; on the retur grids it is the NO RETUR and `canSearchInGrid`
      // refuses the offer, because no Referensi filter is injected there.
      const searchKey = rowIdentity(r);
      makeRowInteractive(
        tr,
        searchKey
          ? "Klik 1x untuk melihat teks lengkap, klik 2x untuk mencari di Coretax"
          : "Klik 1x untuk melihat teks lengkap",
      );

      if (session.viewedRefs.has(searchKey)) {
        tr.classList.add("ch-comparer-row-viewed");
      }

      if (searchKey && deps.canSearchInGrid()) {
        tr.addEventListener("dblclick", () => {
          session.viewedRefs.add(searchKey);
          render();
          deps.searchReference(searchKey);
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

  // ── Export ─────────────────────────────────────────

  function exportResults(format: ResultExportFormat): void {
    if (session.results.length === 0) return;

    const rows = buildCheckerExportRows(
      session.results,
      session.benchmark,
      deps.counterparty(),
      deps.identity(),
    );
    const filename = resultExportFilename(CHECKER_EXPORT_BASENAME, format);
    // CSV is hand-rolled and synchronous: no chunk load, so no failure to report.
    if (format === "csv") {
      downloadCSVFile(rows, filename);
      return;
    }
    // The formats' positions come from the same schema the rows do, so a column
    // added ahead of the amounts cannot shift them (exporter.resultNumberFormats).
    void downloadXLSXFile(rows, filename, "Pengecekan", {
      numberFormats: resultNumberFormats(
        checkerSheetColumns(session.benchmark, deps.counterparty(), deps.identity()),
      ),
    }).catch((err: unknown) => reportResultExportFailure(err, status));
  }

  /**
   * The check this tab queued was retired — a stop, a failure, a lost chunk or a
   * reset — so the line promising it is replaced with the one-line reason it will
   * not arrive.
   *
   * The badge still carries the stop's own account; this says only what the tab
   * can know, so a blank line cannot read as "nothing was ever asked for"
   * (ADR-0026). The line's own kind is the guard: it replaces a promise and
   * nothing else, so a summary or an error written since is out of its reach.
   */
  function dropPending(): void {
    status.replace("waiting", { kind: "notice", text: RETIRED_REQUEST_NOTICE });
  }

  const view: CheckerView = {
    root,
    filterMenu: null,
    inject() {
      inject();
      view.filterMenu = filterMenu;
    },
    render,
    runCheck,
    rerun,
    runPending,
    dropPending,
    exportResults,
  };
  return view;
}

// ── Production view ───────────────────────────────────

/**
 * The tab as the panel builds it. Every dep here is a project singleton rather
 * than a browser API, so the factory above exists for tests that want their own
 * Run instead of the shared one.
 */
export const checkerView: CheckerView = createCheckerView({
  run: runLifecycle,
  scrape: scrapeForPanel,
  openCheckTab: () => openPanel("check"),
  searchReference,
  gridLabel: currentGridLabel,
  // Buyer on PPN Keluaran AND on Retur PPN Keluaran, whose rows carry the
  // buyer exactly as the invoice they return does — a fact of its own, not
  // `isOutputTaxPage` (Retur Keluaran is not the output-tax grid).
  counterparty: () => (counterpartyIsBuyer() ? "pembeli" : "penjual"),
  // The identity column: a Referensi on the two PPN grids, a NO RETUR on the two
  // Retur grids, which have no Referensi column at all.
  identity: checkerRowIdentity,
  // The hand-back needs the grid to HAVE the Referensi filter — the page fact
  // for a lookup, not the identity one the Comparer lives by: on PPN Masukan a
  // search works, it may just land on several rows that share a seller's
  // reference, so the double-click is offered there too.
  canSearchInGrid: hasReferenceFilter,
});

/** Run the check a Run owes, from main.ts's `currentRunHandlers` dispatcher. */
export function runPendingCheck(): void {
  checkerView.runPending();
}

/**
 * Take back the check this tab queued: the Run it was waiting on is gone, so no
 * completion will arrive. The panel's badge already carries the stop; the tab
 * only stops promising (ADR-0022).
 */
export function dropPendingCheck(): void {
  checkerView.dropPending();
}