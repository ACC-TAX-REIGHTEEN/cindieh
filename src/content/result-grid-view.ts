// ============================================================
// RESULT-GRID-VIEW.TS — the result-grid markup BOTH tabs share
// ============================================================
// "Bandingkan Data Penjualan" and "Pengecekan Keakuratan Nilai"
// render the same shape out of the same `ResultColumn<T>` schema
// (result-columns.ts): a table, page controls, a status-filter
// menu, and the click / double-click row behaviour. All of it lived
// inside ui-comparer.ts, where one change to the grid meant editing
// two blocks of identical markup — and the audit that flagged that
// module also flagged that neither tab had a seam of its own.
//
// This is the shared half of that seam. The compare view lives in
// ui-comparer.ts, the checker view in ui-checker.ts, and neither
// re-declares any of what follows. Nothing here knows which tab it
// is drawing for: everything tab-specific arrives as an argument.
// ============================================================

import type { ResultColumn } from "./result-columns";
import { debugError } from "./debug";

/** Rows per page on both result grids. */
export const PAGE_SIZE = 10;

// ── Table ──────────────────────────────────────────────

/** Build `<thead>` from a column schema. */
export function buildHeaderRow<T>(columns: readonly ResultColumn<T>[]): HTMLElement {
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column.label;
    // Scope, or a screen reader announces the cells without saying which
    // column they belong to. The table itself carries the name (see the two
    // call sites), since neither grid can be told apart from its cells alone.
    th.setAttribute("scope", "col");
    th.className = column.className;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  return thead;
}

/**
 * Build one `<tr>` from a column schema. `startIndex` is the 0-based index of
 * the page's first row within the whole filtered set, so "No" keeps counting
 * across pages.
 */
export function buildResultRow<T>(
  columns: readonly ResultColumn<T>[],
  row: T,
  startIndex: number,
  offset: number,
): HTMLTableRowElement {
  const tr = document.createElement("tr") as HTMLTableRowElement;
  for (const column of columns) {
    const value = column.value(row, startIndex + offset);
    const td = document.createElement("td");
    td.textContent = value;
    td.title = value;
    td.className = column.numeric ? `${column.className} ch-comparer-num` : column.className;
    tr.appendChild(td);
  }
  return tr;
}

/**
 * Make a result row behave the way both grids' rows do: one click expands the
 * row to show its full text, and a click that landed on a button or an input
 * belongs to that control rather than to the row.
 *
 * The caller adds its own double-click listener — only rows that CAN be
 * searched get one, and what searching means differs per tab.
 */
export function makeRowInteractive(tr: HTMLElement, title: string): void {
  tr.style.cursor = "pointer";
  tr.title = title;
  tr.addEventListener("click", (e: MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "BUTTON" || (e.target as HTMLElement).tagName === "INPUT") return;
    tr.classList.toggle("ch-comparer-row-expanded");
  });
}

// ── Pagination ─────────────────────────────────────────

/**
 * Append the page controls both result grids use. Kept in one place because
 * the two grids showed byte-identical markup that had to be changed twice.
 */
export function appendPagination(
  container: HTMLElement,
  currentPage: number,
  totalPages: number,
  onGoTo: (page: number) => void,
): void {
  const pagination = document.createElement("div");
  pagination.className = "ch-comparer-pagination";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "ch-comparer-page-btn";
  prevBtn.textContent = "Sebelumnya";
  prevBtn.disabled = currentPage === 1;
  prevBtn.addEventListener("click", () => {
    if (currentPage > 1) onGoTo(currentPage - 1);
  });

  const pageInfo = document.createElement("span");
  pageInfo.className = "ch-comparer-page-info";
  pageInfo.textContent = `Halaman ${currentPage} dari ${totalPages}`;

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "ch-comparer-page-btn";
  nextBtn.textContent = "Berikutnya";
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.addEventListener("click", () => {
    if (currentPage < totalPages) onGoTo(currentPage + 1);
  });

  pagination.appendChild(prevBtn);
  pagination.appendChild(pageInfo);
  pagination.appendChild(nextBtn);
  container.appendChild(pagination);
}

// ── Status filter ──────────────────────────────────────

/** One checkbox row in a status-filter menu, excluding the "Semua Status" row. */
export interface StatusFilterOption {
  value: string;
  label: string;
}

/** What a tab needs back from its menu to wire the panel's shared chrome. */
export interface StatusFilterMenu {
  /** Where the toggle sits — the panel's outside-click test needs this. */
  wrap: HTMLElement;
  /** The openable menu itself — Escape closes this and nothing else. */
  menu: HTMLElement;
  close(): void;
}

/** The "no filter" row both menus open with, and the only mutual exclusion. */
const ALL_STATUSES = "ALL";

/**
 * Build the status-filter dropdown both tabs put next to their export button:
 * a toggle labelled with the current selection, and a hidden menu of
 * checkboxes.
 *
 * "Semua Status" is the empty selection — both sessions' filter functions
 * already treat `[]` as "no filter" — and it is mutually exclusive with the
 * individual statuses, so the menu can never report both at once. The caller
 * supplies its own status list and is handed the chosen values on every
 * change; an empty list means "no filter".
 *
 * `idPrefix` keeps the two menus' ids disjoint ("ch-comparer" / "ch-checker"),
 * and the built menu starts hidden — a grid with no results has no statuses
 * to filter, and each tab reveals its own wrap when results arrive.
 */
export function buildStatusFilterMenu(config: {
  idPrefix: string;
  options: readonly StatusFilterOption[];
  /** The session's current filter, as its own ids. Empty means "Semua Status". */
  selected: readonly string[];
  onApply: (values: string[]) => void;
}): StatusFilterMenu {
  const { idPrefix, options, selected, onApply } = config;

  const wrap = document.createElement("div");
  wrap.id = `${idPrefix}-filter-wrap`;
  wrap.className = "ch-comparer-filter-wrap ch-hidden";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = `${idPrefix}-filter-toggle`;
  toggle.className = "ch-comparer-filter-toggle";
  toggle.title = "Filter berdasarkan status";

  const toggleLabel = document.createElement("span");
  toggleLabel.className = "ch-comparer-filter-toggle-label";

  const toggleIcon = document.createElement("span");
  toggleIcon.className = "pi pi-chevron-down";
  toggleIcon.setAttribute("aria-hidden", "true");

  toggle.appendChild(toggleLabel);
  toggle.appendChild(toggleIcon);

  const menu = document.createElement("div");
  menu.id = `${idPrefix}-filter-menu`;
  menu.className = "ch-comparer-filter-menu ch-hidden";

  // Seeded from the session rather than left at the default, because the
  // popup's stored filter has to survive the modal being re-injected.
  const wanted = new Set(selected);
  const checkboxes: HTMLInputElement[] = [];
  const rows: StatusFilterOption[] = [
    { value: ALL_STATUSES, label: "Semua Status" },
    ...options,
  ];
  for (const row of rows) {
    const item = document.createElement("label");
    item.className = "ch-comparer-filter-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = row.value;
    cb.checked = row.value === ALL_STATUSES ? wanted.size === 0 : wanted.has(row.value);
    checkboxes.push(cb);

    const span = document.createElement("span");
    span.textContent = row.label;

    item.appendChild(cb);
    item.appendChild(span);
    menu.appendChild(item);
  }

  const labelFor = (values: readonly string[]): string =>
    values.length === 0 ? "Semua Status" : `${values.length} status`;
  toggleLabel.textContent = labelFor(selected);

  const allCheckbox = checkboxes[0];
  checkboxes.forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.value === ALL_STATUSES && cb.checked) {
        checkboxes.forEach((other) => {
          if (other.value !== ALL_STATUSES) other.checked = false;
        });
      } else if (cb.value !== ALL_STATUSES && cb.checked) {
        allCheckbox.checked = false;
      }
      const checked = checkboxes.filter((box) => box.checked).map((box) => box.value);
      const values = checked.includes(ALL_STATUSES) ? [] : checked;
      toggleLabel.textContent = labelFor(values);
      onApply(values);
    });
  });

  toggle.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
    menu.classList.toggle("ch-hidden");
  });

  wrap.appendChild(toggle);
  wrap.appendChild(menu);

  return {
    wrap,
    menu,
    close: () => menu.classList.add("ch-hidden"),
  };
}

// ── Export failure ─────────────────────────────────────

/**
 * Report a failed spreadsheet export in the panel instead of letting the
 * rejection die silently — the click handler is fire-and-forget, and the most
 * likely cause is the SheetJS chunk failing to load.
 *
 * `statusId` is the failing tab's status line, so the message lands on the tab
 * whose button was pressed.
 */
export function reportResultExportFailure(err: unknown, statusId: string): void {
  debugError("Gagal mengekspor hasil ke Excel", err);
  const statusMsg = document.getElementById(statusId);
  if (statusMsg) {
    statusMsg.textContent = "Gagal membuat berkas Excel. Coba ekspor kembali.";
    statusMsg.className = "ch-comparer-status ch-comparer-status-error";
  }
}