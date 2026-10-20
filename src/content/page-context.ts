import { extractYear, extractMonth } from "./tax-date";
import { GRID_FILTER_NAMES, filterValueOf, filtersOf, parseGridBody } from "./grid-request";

export type ExportSource =
	| "OUTPUT_TAX"
	| "INPUT_TAX"
	| "OUTPUT_RETURN"
	| "INPUT_RETURN"
	| "SPT_A2"
	| "SPT_B2"
	| "PPH_21_L1A"
	| "PPH_21_L1B"
	| "PPH_21_L2"
	| "PPH_21_L3"
	| "WITHHOLDING_SLIPS";

function normalizeUrl(url: string): string {
	return url.toLowerCase();
}

export function isOutputTaxPage(url = location.href): boolean {
	const normalizedUrl = normalizeUrl(url);
	return (
		normalizedUrl.includes("/e-invoice-portal") &&
		(normalizedUrl.includes("output-tax") ||
			normalizedUrl.includes("keluaran") ||
			normalizedUrl.includes("vat-out"))
	);
}

export function isInputTaxPage(url = location.href): boolean {
	const normalizedUrl = normalizeUrl(url);
	return normalizedUrl.includes("/e-invoice-portal") && normalizedUrl.includes("input-tax");
}

export function isOutputReturnPage(url = location.href): boolean {
	const normalizedUrl = normalizeUrl(url);
	return normalizedUrl.includes("/e-invoice-portal") && normalizedUrl.includes("output-return");
}

export function isInputReturnPage(url = location.href): boolean {
	const normalizedUrl = normalizeUrl(url);
	return normalizedUrl.includes("/e-invoice-portal") && normalizedUrl.includes("input-return");
}

/**
 * The two PPN grids that list the taxpayer's own VAT INVOICES: sales and
 * purchases. Named for what the rows ARE, not for what a feature may do with
 * them — several questions are answered around these grids, and this is one.
 *
 * The Referensi filter happens to be offered on exactly these grids (a Referensi
 * column is what they have and the Retur grids do not), but the filter's page
 * fact (`hasReferenceFilter`) reads `PANEL_GRIDS`, not this predicate: the two
 * are held together by a test rather than by one calling the other (ADR-0028).
 * The Comparer is its own fact (`referenceIsIdentity`), and the checker a third
 * (`isCheckerPage`) which is WIDER than this: a retur row carries the same
 * DPP / DPP Nilai Lain / PPN, so the check runs there too.
 */
export function isVatInvoicePage(url = location.href): boolean {
	return isOutputTaxPage(url) || isInputTaxPage(url);
}

// ── The per-grid table the panel reads ─────────────────────────
//
// Which grid this is, and everything the panel's tabs, columns and notices ask
// about it, is ONE row per grid below. The QUESTIONS keep their own names — the
// projections that follow — because they genuinely disagree: PPN Masukan takes
// a Referensi filter that identifies nothing (ADR-0021), and Retur PPN
// Keluaran carries the buyer on a grid that is not the output-tax one
// (ADR-0024). What collapses is where the ANSWERS live: once here, so the
// entry point, the tabs, the columns and the copy that describes them cannot
// drift apart (ADR-0028).

/** The grids the panel knows about, as a key into the table. */
export type PanelGridId = "OUTPUT_TAX" | "INPUT_TAX" | "OUTPUT_RETURN" | "INPUT_RETURN";

/** What ONE grid is, for every panel question the table answers. */
export interface GridFacts {
	/** The grid's own name, for progress lines and notices ("PPN Masukan"). */
	readonly label: string;
	/**
	 * The popup's status-line name for the same grid, in the portal's fuller
	 * spelling ("e-Faktur PPN Masukan"). Carried beside `label` rather than
	 * derived, because the two wordings differ by more than a prefix on the retur
	 * grids — a derivation rule is a second place for the name to live.
	 */
	readonly statusLabel: string;
	/** Do the rows carry the BUYER (true) or the SELLER (false)? */
	readonly counterpartyIsBuyer: boolean;
	/** What names ONE row of a Pengecekan result here. */
	readonly rowIdentity: CheckerRowIdentity;
	/** Is the Komparator tab offered here? */
	readonly comparerTab: boolean;
	/** Is the Pengecekan tab offered here? */
	readonly checkerTab: boolean;
	/** Does the grid take Cindieh's Referensi filter (toolbar box and column input)? */
	readonly referenceFilter: boolean;
}

/**
 * ONE row per grid, holding every value the panel reads about a grid.
 *
 * Adding a column, renaming a grid or moving a tab's gate is ONE edit here,
 * and the projections below cannot disagree with each other because they are
 * reads of the same row. Two gates are deliberately NOT in this table:
 * `isEfakturPage()` (the year-wide export's gate) keeps its own predicate so
 * that widening the table cannot silently widen the sweep, and
 * `isVatInvoicePage()` keeps the meaning it is named for (whose rows these are).
 */
export const PANEL_GRIDS: Record<PanelGridId, GridFacts> = {
	OUTPUT_TAX: {
		label: "PPN Keluaran",
		statusLabel: "e-Faktur PPN Keluaran",
		counterpartyIsBuyer: true,
		rowIdentity: "referensi",
		comparerTab: true,
		checkerTab: true,
		referenceFilter: true,
	},
	INPUT_TAX: {
		label: "PPN Masukan",
		statusLabel: "e-Faktur PPN Masukan",
		// The row carries the SELLER, and the reference is the seller's too —
		// which is why it may be FILTERED by one but cannot be MATCHED on one.
		counterpartyIsBuyer: false,
		rowIdentity: "referensi",
		comparerTab: false,
		checkerTab: true,
		referenceFilter: true,
	},
	OUTPUT_RETURN: {
		label: "Retur PPN Keluaran",
		statusLabel: "Retur PPN Keluaran",
		// A retur nota carries the buyer exactly as the invoice it returns does.
		counterpartyIsBuyer: true,
		// A retur grid has no Referensi column at all, so its rows are named by
		// their NO RETUR and have no filter to be looked up by.
		rowIdentity: "no-retur",
		comparerTab: false,
		checkerTab: true,
		referenceFilter: false,
	},
	INPUT_RETURN: {
		label: "Retur PPN Masukan",
		statusLabel: "Retur PPN Masukan",
		counterpartyIsBuyer: false,
		rowIdentity: "no-retur",
		comparerTab: false,
		checkerTab: true,
		referenceFilter: false,
	},
};

/**
 * The panel's row for this page, or null when the page carries no grid.
 *
 * The lookup goes through `getPageExportSource`, so a grid is recognised by the
 * same predicates that name it everywhere else rather than by a second set of
 * URL patterns that could drift from them.
 */
export function panelGridFacts(url = location.href): GridFacts | null {
	const source = getPageExportSource(url);
	// The cast is safe: getPageExportSource answers exactly these four or null.
	if (!source || !(source in PANEL_GRIDS)) return null;
	return PANEL_GRIDS[source as PanelGridId];
}

/**
 * Whether this grid gets Cindieh's Referensi filter: the toolbar box and the
 * column-filter input in the grid header.
 *
 * Both PPN grids carry a Referensi column, so both can be LOOKED UP by one —
 * type an internal prefix, get the rows that start with it. That is the whole
 * promise, and it holds on PPN Masukan even though a seller's reference is not
 * unique: three purchases that share a reference IS an answer to a lookup.
 *
 * Read from the grid's row (PANEL_GRIDS), which today marks exactly the two
 * VAT-invoice grids — the same set `isVatInvoicePage` is named for, and a test
 * holds the two together. Widening the filter to a grid, or narrowing it, is a
 * decision about a lookup, not a side effect of which page the panel happens to
 * be on.
 */
export function hasReferenceFilter(url = location.href): boolean {
	return panelGridFacts(url)?.referenceFilter ?? false;
}

/**
 * Whether a Referensi identifies ONE row here — which is a different question
 * from whether the grid can be filtered by it.
 *
 * True on PPN Keluaran, where the reference is the Wajib Pajak's own. False on
 * PPN Masukan, where it is whatever the SELLER filed: it repeats across
 * purchases from different sellers and is often empty, so it cannot key a match
 * (ADR-0006). That is why the Comparer's tab stays hidden there while the
 * filter itself is still offered — one grid, two answers.
 */
export function referenceIsIdentity(url = location.href): boolean {
	return panelGridFacts(url)?.comparerTab ?? false;
}

/**
 * Whether Pengecekan Keakuratan Nilai can run on this grid: both PPN grids and
 * both Retur PPN grids.
 *
 * The check tests ONE row's arithmetic at a time — do its DPP, DPP Nilai Lain
 * and PPN agree with each other — and a retur row carries those three amounts
 * exactly as an invoice row does (`SellingPrice`, `OtherTaxBase`, `VAT`). Whose
 * document it is, and whether a Referensi identifies it, change nothing here —
 * but all three read one row of PANEL_GRIDS, so they cannot drift apart.
 *
 * Named apart from `isEfakturPage`, which covers the same four grids today and
 * answers a different question: that one gates the year-wide EXPORT (a tax year
 * can be swept on these grids), this one gates the CHECK (a row on these grids
 * has the three amounts). Adding a fifth grid to one must be a deliberate
 * decision for the other, which is why the export gate is NOT a projection of
 * the table and neither delegates to the other.
 */
export function isCheckerPage(url = location.href): boolean {
	return panelGridFacts(url)?.checkerTab ?? false;
}

/**
 * What names ONE row of a Pengecekan result on this grid.
 *
 * `referensi` on both PPN grids: the row is an invoice, and its Reference — or,
 * where the taxpayer left that empty, its No. Faktur — is what the reader looks
 * it up by. `no-retur` on both Retur grids, where the row is a retur nota: there
 * is no Referensi column at all, so a header saying "Referensi" would point the
 * reader at a column the grid does not have, and the row's own NO RETUR is what
 * identifies it.
 *
 * A third question beside the page gate and the filter's fact: the filter asks
 * whether a reference can LOOK a row up, this asks which field a result row is
 * NAMED by. They read the same underlying fact (does the grid carry a Referensi
 * column) and are kept separate anyway — a lookup on PPN Masukan is a supported
 * feature, and the checker's own column there is still the seller's reference.
 */
export type CheckerRowIdentity = "referensi" | "no-retur";

export function checkerRowIdentity(url = location.href): CheckerRowIdentity {
	return panelGridFacts(url)?.rowIdentity ?? "no-retur";
}

// ── The panel's toolbar entry, named ───────────────────

/**
 * The two names the panel's toolbar entry can carry, spelled once.
 *
 * The button opens the OVERLAY and the grid decides which tab it lands on, so it
 * is named for the tab its page can serve (ADR-0025). They are constants rather
 * than literals at the injection site for the same reason the grid labels are:
 * the microsite's per-grid table and this module's own test both have to name
 * them, and a copy of a sentence is a second place for it to change.
 */
export const COMPARER_ENTRY_LABEL = "Bandingkan data penjualan";
export const CHECKER_ENTRY_LABEL = "Pengecekan keakuratan nilai";

/**
 * What the panel's toolbar entry is called for ONE grid.
 *
 * The derivation, kept apart from the page lookup so the injection site (which
 * already holds the row) can ask it without reading the URL again, while a test
 * holding a URL can use the projection below.
 */
export function panelEntryLabelFor(facts: GridFacts): string {
	return facts.comparerTab ? COMPARER_ENTRY_LABEL : CHECKER_ENTRY_LABEL;
}

/**
 * What the panel's toolbar entry is called on this page, or null where there is
 * no button to inject.
 *
 * ONE read of the grid's row, like every other projection here: a page the panel
 * cannot serve gets no name (the button is not injected at all), PPN Keluaran —
 * whose Referensi identifies a row — gets the Komparator's name, and PPN Masukan
 * and both Retur grids get the check's. A grid moved between tabs in PANEL_GRIDS
 * therefore renames the button without a second mapping to remember.
 */
export function panelEntryLabel(url = location.href): string | null {
	const facts = panelGridFacts(url);
	return facts ? panelEntryLabelFor(facts) : null;
}

/**
 * Whether the rows on this page belong to the taxpayer's own SALE, so the other
 * party named on them is the BUYER.
 *
 * True on PPN Keluaran and on Retur PPN Keluaran: a retur row carries
 * BuyerTIN / BuyerTaxpayerNameClear exactly as the invoice it returns does, so a
 * checker column reading "Nama Pembeli" is right on both. `isOutputTaxPage`
 * answers which GRID this is, and Retur PPN Keluaran is not the output-tax grid
 * — which is why the counterparty column needs this fact rather than that one.
 */
export function counterpartyIsBuyer(url = location.href): boolean {
	return panelGridFacts(url)?.counterpartyIsBuyer ?? false;
}

/**
 * Whether the Bandingkan / Pengecekan panel has a tab to offer here: the check
 * on the four e-Faktur PPN grids, the Comparer where a Referensi identifies a
 * row. Asked by the keyboard shortcut and by the toolbar entry point, which open
 * the OVERLAY — so neither of them may ask one tab's own gate and declare the
 * other's page unusable. The overlay decides which tab it lands on from those
 * two facts itself (ui-panel.ts).
 */
export function isPanelPage(url = location.href): boolean {
	const facts = panelGridFacts(url);
	return Boolean(facts && (facts.checkerTab || facts.comparerTab));
}

export function isEfakturPage(url = location.href): boolean {
	return (
		isOutputTaxPage(url) ||
		isInputTaxPage(url) ||
		isOutputReturnPage(url) ||
		isInputReturnPage(url)
	);
}

export function isSptPage(url = location.href): boolean {
	const normalizedUrl = normalizeUrl(url);
	return (
		normalizedUrl.includes("/returnsheets-portal") &&
		(normalizedUrl.includes("value-added-tax-return") ||
			normalizedUrl.includes("article-21-26-tax-return"))
	);
}

export function isWithholdingPage(url = location.href): boolean {
	const normalizedUrl = normalizeUrl(url);
	return (
		normalizedUrl.includes("/withholding-slips-portal") &&
		normalizedUrl.includes("my-withholding-slips")
	);
}

export function isSupportedExportPage(url = location.href): boolean {
	return (
		isOutputTaxPage(url) ||
		isInputTaxPage(url) ||
		isOutputReturnPage(url) ||
		isInputReturnPage(url) ||
		isSptPage(url) ||
		isWithholdingPage(url)
	);
}

/**
 * Human label for the page in the given URL, for the popup's status line.
 * Distinguishes "a portal page Cindieh does not support" from "not the portal at
 * all", because those need different advice. Pure — the popup passes the active
 * tab's URL in.
 */
export function describePortalPage(url: string | undefined): string {
  if (!url) return "Buka portal Coretax untuk memakai fitur ekspor.";
  // The four grids word their status line from the same row the panel reads,
  // so "PPN Keluaran" in a progress line and "e-Faktur PPN Keluaran" in the
  // popup cannot name two different grids.
  const grid = panelGridFacts(url);
  if (grid) return `Terhubung: ${grid.statusLabel}`;
  if (isSptPage(url)) {
    return normalizeUrl(url).includes("article-21-26")
      ? "Terhubung: SPT PPh 21/26"
      : "Terhubung: SPT Masa PPN";
  }
  if (isWithholdingPage(url)) return "Terhubung: Bukti Potong";
  if (normalizeUrl(url).includes("coretaxdjp.pajak.go.id")) {
    return "Portal Coretax — halaman ini belum didukung.";
  }
  return "Buka portal Coretax untuk memakai fitur ekspor.";
}

export function getPageExportSource(url = location.href): ExportSource | null {
	if (isOutputTaxPage(url)) return "OUTPUT_TAX";
	if (isInputTaxPage(url)) return "INPUT_TAX";
	if (isOutputReturnPage(url)) return "OUTPUT_RETURN";
	if (isInputReturnPage(url)) return "INPUT_RETURN";
	return null;
}

export function inferCapturedSource(requestUrl: string, pageUrl = location.href): ExportSource | null {
	const normalizedRequestUrl = normalizeUrl(requestUrl);

	if (normalizedRequestUrl.includes("la2-grid")) return "SPT_A2";
	if (normalizedRequestUrl.includes("lb2-grid")) return "SPT_B2";
	if (normalizedRequestUrl.includes("l1a-")) return "PPH_21_L1A";
	if (normalizedRequestUrl.includes("l1b-")) return "PPH_21_L1B";
	if (normalizedRequestUrl.includes("l2-")) return "PPH_21_L2";
	if (normalizedRequestUrl.includes("l3-")) return "PPH_21_L3";
	if (normalizedRequestUrl.includes("getmywithholdingslip")) return "WITHHOLDING_SLIPS";
	if (normalizedRequestUrl.includes("outputinvoice/list")) return "OUTPUT_TAX";

	return getPageExportSource(pageUrl);
}

export function extractFilenameHintFromBody(
	rawBody: string,
	source: ExportSource,
): string | undefined {
	const body = parseGridBody(rawBody);
	const filters = filtersOf(body);

	if (source === "INPUT_TAX") {
		const periodValue = filterValueOf(filters, GRID_FILTER_NAMES.period);
		const monthValue =
			filterValueOf(filters, GRID_FILTER_NAMES.month) || periodValue;
		const yearValue =
			filterValueOf(filters, GRID_FILTER_NAMES.year) || periodValue;

		const month = extractMonth(monthValue);
		const year = extractYear(yearValue);
		if (month && year) return `${year}_${month}`;
		return undefined;
	}

	if (source === "OUTPUT_RETURN" || source === "INPUT_RETURN") {
		const value =
			filterValueOf(filters, [
				...GRID_FILTER_NAMES.year,
				...GRID_FILTER_NAMES.period,
			]) || String(body?.TaxYear || body?.Year || body?.Tahun || "");
		const year = extractYear(value);
		return year || undefined;
	}

	if (
		source === "OUTPUT_TAX" ||
		source === "SPT_A2" ||
		source === "SPT_B2" ||
		source.startsWith("PPH_21_")
	) {
		const value = filterValueOf(filters, GRID_FILTER_NAMES.period);
		return value ? value.replace(/[^a-zA-Z0-9_-]/g, "") : undefined;
	}

	return undefined;
}
