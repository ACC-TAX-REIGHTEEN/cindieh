// Unit tests for ui-badge.ts — the floating badge/info panel.
// Pure helpers (labels, idle status, visibility toggle) are covered first;
// the DOM describe blocks drive the real panel state transitions
// (injectBadge → progress → complete/error → idle → destroy) through a
// minimal fake DOM — no jsdom/happy-dom — following the stub style of the
// ui-filters and main-actions tests.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// button-state refs and page-context predicate are mocked so the panel
// transitions can assert against controllable button elements.
vi.mock("../content/button-state", () => ({
  getExportBtnEl: vi.fn(() => null),
  getExportDropdownBtnEl: vi.fn(() => null),
  getScrapeBtnEl: vi.fn(() => null),
}));
vi.mock("../content/page-context", () => ({
  isWithholdingPage: vi.fn(() => false),
}));

import {
  getExportButtonLabel,
  getIdlePanelStatus,
  getToggledPanelVisibility,
  injectBadge,
  showPanel,
  updatePanelProgress,
  updatePanelComplete,
  updatePanelError,
  updatePanelIdle,
  updatePanelStatus,
  destroyBadge,
} from "../content/ui-badge";
import { getExportBtnEl, getExportDropdownBtnEl, getScrapeBtnEl } from "../content/button-state";
import { isWithholdingPage } from "../content/page-context";
import { stubFakeDom, type FakeDoc, type FakeEl } from "./__mocks__/fake-dom";

// ── Pure helpers ───────────────────────────────────────────────

describe("floating badge panel", () => {
  it("toggles the panel visibility whenever the badge is clicked", () => {
    expect(getToggledPanelVisibility(true)).toBe(false);
    expect(getToggledPanelVisibility(false)).toBe(true);
  });

  it("uses an informative status when opened while idle", () => {
    expect(getIdlePanelStatus()).toBe("Siap. Mulai ekspor dari toolbar.");
  });

  it("uses consistent export button labels across normal and running states", () => {
    expect(getExportButtonLabel("xlsx", false)).toBe("Ekspor XLSX");
    expect(getExportButtonLabel("csv", false)).toBe("Ekspor CSV");
    expect(getExportButtonLabel("pdf", false)).toBe("Unduh PDF");
    expect(getExportButtonLabel("dropdown", false)).toBe("Ekspor");
    expect(getExportButtonLabel("xlsx", true)).toBe("Berhenti");
    expect(getExportButtonLabel("csv", true)).toBe("Berhenti");
    expect(getExportButtonLabel("pdf", true)).toBe("Berhenti");
    expect(getExportButtonLabel("dropdown", true)).toBe("Berhenti");
  });
});

// ── Panel state transitions (DOM) ─────────────────────────────
// The fake DOM itself lives in ./__mocks__/fake-dom.ts (shared with the
// ui-filters tests); these tests only drive it via stubFakeDom().

describe("panel state transitions", () => {
  let doc: FakeDoc;
  let badge: FakeEl;

  /** A fake toolbar button carrying the icon + label spans ui-badge mutates. */
  function makeButton(): FakeEl {
    const btn = doc.createElement("button");
    const icon = doc.createElement("span");
    icon.className = "p-button-icon p-button-icon-left pi pi-download mr-1";
    const label = doc.createElement("span");
    label.className = "p-button-label";
    label.textContent = "Ekspor";
    btn.appendChild(icon);
    btn.appendChild(label);
    return btn;
  }

  /** Cast a FakeEl to the HTMLButtonElement type the button-state mocks expect. */
  function asBtn(el: FakeEl): HTMLButtonElement {
    return el as unknown as HTMLButtonElement;
  }

  beforeEach(() => {
    doc = stubFakeDom().doc;
    vi.mocked(isWithholdingPage).mockReturnValue(false);
    vi.mocked(getExportBtnEl).mockReturnValue(null);
    vi.mocked(getExportDropdownBtnEl).mockReturnValue(null);
    vi.mocked(getScrapeBtnEl).mockReturnValue(null);
    injectBadge();
    badge = doc.getElementById("ch-floating-info-container")!;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injectBadge builds the floating panel and the badge click opens/closes it with idle content", () => {
    expect(badge).not.toBeNull();
    expect(badge.className).toContain("ch-floating-info");
    expect(doc.body.children).toContain(badge);
    expect(badge.classList.contains("ch-panel-open")).toBe(false);

    const badgeEl = doc.getElementById("ch-badge")!;
    const click = badgeEl.listeners["click"][0];

    // First click opens and fills idle content.
    click({});
    expect(badge.classList.contains("ch-panel-open")).toBe(true);
    expect(doc.getElementById("ch-f-status")!.textContent).toBe(getIdlePanelStatus());

    // Second click closes again.
    click({});
    expect(badge.classList.contains("ch-panel-open")).toBe(false);
  });

  it("showPanel opens the panel without touching its content", () => {
    expect(badge.classList.contains("ch-panel-open")).toBe(false);
    showPanel();
    expect(badge.classList.contains("ch-panel-open")).toBe(true);
  });

  it("updatePanelProgress updates stats, opens the panel, and marks buttons as running", () => {
    updatePanelIdle(); // independent of any prior test's running state

    const dropdownBtn = makeButton();
    const scrapeBtn = makeButton();
    vi.mocked(getExportDropdownBtnEl).mockReturnValue(asBtn(dropdownBtn));
    vi.mocked(getScrapeBtnEl).mockReturnValue(asBtn(scrapeBtn));

    updatePanelProgress(1234, 5, "2.3s", "Page 5: 500 baris, 500 baru");

    expect(badge.classList.contains("ch-panel-open")).toBe(true);
    expect(doc.getElementById("ch-f-total")!.textContent).toBe("1.234"); // id-ID locale
    expect(doc.getElementById("ch-f-pages")!.textContent).toBe("5");
    expect(doc.getElementById("ch-f-time")!.textContent).toBe("2.3s");
    expect(doc.getElementById("ch-f-status")!.textContent).toBe("Page 5: 500 baris, 500 baru");
    expect(doc.getElementById("ch-f-progress-bar")!.style.width).toBe("50%"); // min(95, 5 * 10)

    expect(dropdownBtn.querySelector(".p-button-label")!.textContent).toBe("Berhenti");
    expect(dropdownBtn.classList.contains("ch-btn-danger")).toBe(true);
    expect(scrapeBtn.title).toBe("Menghentikan scrape...");
  });

  it("updatePanelProgress uses the single PDF button on withholding pages", () => {
    updatePanelIdle();
    vi.mocked(isWithholdingPage).mockReturnValue(true);
    const pdfBtn = makeButton();
    vi.mocked(getExportBtnEl).mockReturnValue(asBtn(pdfBtn));

    updatePanelProgress(10, 1, "0.5s", "Mengunduh PDF 1/10");

    expect(pdfBtn.querySelector(".p-button-label")!.textContent).toBe("Berhenti");
    expect(pdfBtn.classList.contains("ch-btn-danger")).toBe(true);
    expect(doc.getElementById("ch-f-status")!.textContent).toBe("Mengunduh PDF 1/10");
  });

  it("updatePanelComplete shows a success status, restores buttons, and fills the bar", () => {
    const dropdownBtn = makeButton();
    const scrapeBtn = makeButton();
    vi.mocked(getExportDropdownBtnEl).mockReturnValue(asBtn(dropdownBtn));
    vi.mocked(getScrapeBtnEl).mockReturnValue(asBtn(scrapeBtn));

    updatePanelProgress(100, 3, "1.0s", "Page 3"); // enter running state
    updatePanelComplete(100, 3, "1.2s");

    expect(doc.getElementById("ch-f-status")!.textContent).toBe("100 Data Berhasil");
    expect(doc.getElementById("ch-f-progress-bar")!.style.width).toBe("100%");
    expect(dropdownBtn.querySelector(".p-button-label")!.textContent).toBe("Ekspor");
    expect(dropdownBtn.classList.contains("ch-btn-danger")).toBe(false);
    expect(scrapeBtn.title).toBe("Scrape data dari sistem");
  });

  it("updatePanelComplete reports failures when some PDFs failed", () => {
    updatePanelComplete(10, 3, "1.2s", 2);
    expect(doc.getElementById("ch-f-status")!.textContent).toBe("8/10 berhasil, 2 gagal (PDF sudah tidak tersedia)");
    expect(doc.getElementById("ch-f-total")!.textContent).toBe("10");
  });

  it("updatePanelComplete uses the PDF success phrasing on withholding pages", () => {
    vi.mocked(isWithholdingPage).mockReturnValue(true);
    updatePanelComplete(7, 1, "5.0s");
    expect(doc.getElementById("ch-f-status")!.textContent).toBe("7 PDF Berhasil");
  });

  it("updatePanelError surfaces the message, keeps the panel open, and restores buttons", () => {
    const dropdownBtn = makeButton();
    vi.mocked(getExportDropdownBtnEl).mockReturnValue(asBtn(dropdownBtn));

    updatePanelError("3 error berturut-turut: Timeout di ...");

    expect(doc.getElementById("ch-f-status")!.textContent).toBe("3 error berturut-turut: Timeout di ...");
    expect(badge.classList.contains("ch-panel-open")).toBe(true);
    expect(dropdownBtn.querySelector(".p-button-label")!.textContent).toBe("Ekspor");
    expect(dropdownBtn.classList.contains("ch-btn-danger")).toBe(false);
  });

  it("updatePanelStatus explains a wait without claiming a scrape is running", () => {
    const dropdownBtn = makeButton();
    vi.mocked(getExportDropdownBtnEl).mockReturnValue(asBtn(dropdownBtn));

    updatePanelStatus(
      'Referensi "EE-0300" tidak ditemukan.',
    );

    expect(doc.getElementById("ch-f-status")!.textContent).toContain("tidak ditemukan");
    expect(badge.classList.contains("ch-panel-open")).toBe(true);
    // Progress numbers and running markers are untouched: this is not a scrape.
    expect(doc.getElementById("ch-f-total")!.textContent).toBe("0");
    expect(doc.getElementById("ch-f-pages")!.textContent).toBe("0");
    expect(dropdownBtn.querySelector(".p-button-label")!.textContent).toBe("Ekspor");
    expect(dropdownBtn.classList.contains("ch-btn-danger")).toBe(false);
  });

  it("updatePanelIdle closes the panel and resets all values", () => {
    updatePanelProgress(50, 2, "1.0s", "Page 2");

    updatePanelIdle();

    expect(badge.classList.contains("ch-panel-open")).toBe(false);
    expect(doc.getElementById("ch-f-total")!.textContent).toBe("0");
    expect(doc.getElementById("ch-f-pages")!.textContent).toBe("0");
    expect(doc.getElementById("ch-f-time")!.textContent).toBe("-");
    expect(doc.getElementById("ch-f-status")!.textContent).toBe(getIdlePanelStatus());
    expect(doc.getElementById("ch-f-progress-bar")!.style.width).toBe("0%");
  });

  it("destroyBadge removes the container and makes further updates safe no-ops", () => {
    destroyBadge();

    expect(doc.getElementById("ch-floating-info-container")).toBeNull();
    expect(doc.getElementById("ch-badge")).toBeNull();
    expect(() => updatePanelProgress(1, 1, "1s", "x")).not.toThrow();
    expect(() => updatePanelComplete(1, 1, "1s")).not.toThrow();
    expect(() => updatePanelError("x")).not.toThrow();
    expect(() => updatePanelIdle()).not.toThrow();
    expect(() => showPanel()).not.toThrow();
  });
});
