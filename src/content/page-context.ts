import { extractYear, extractMonth } from "./tax-date";

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

type FilterLike = {
	PropertyName?: string;
	propertyName?: string;
	Value?: unknown;
	value?: unknown;
};

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
 * Used today by the Referensi filter's page fact (`hasReferenceFilter`),
 * because a Referensi column is what these two grids have and the Retur grids
 * do not. The Comparer is its own fact (`referenceIsIdentity`), and the checker
 * a third (`isCheckerPage`) which is WIDER than this: a retur row carries the
 * same DPP / DPP Nilai Lain / PPN, so the check runs there too.
 */
export function isVatInvoicePage(url = location.href): boolean {
	return isOutputTaxPage(url) || isInputTaxPage(url);
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
 * Today this is `isVatInvoicePage` under another name, and that is the point —
 * widening the filter to a grid, or narrowing it, is a decision about a lookup,
 * not a side effect of which page the panel happens to be on.
 */
export function hasReferenceFilter(url = location.href): boolean {
	return isVatInvoicePage(url);
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
	return isOutputTaxPage(url);
}

/**
 * Whether Pengecekan Keakuratan Nilai can run on this grid: both PPN grids and
 * both Retur PPN grids.
 *
 * The check tests ONE row's arithmetic at a time — do its DPP, DPP Nilai Lain
 * and PPN agree with each other — and a retur row carries those three amounts
 * exactly as an invoice row does (`SellingPrice`, `OtherTaxBase`, `VAT`). Whose
 * document it is, and whether a Referensi identifies it, change nothing here.
 *
 * Named apart from `isEfakturPage`, which covers the same four grids today and
 * answers a different question: that one gates the year-wide EXPORT (a tax year
 * can be swept on these grids), this one gates the CHECK (a row on these grids
 * has the three amounts). Adding a fifth grid to one must be a deliberate
 * decision for the other, which is why neither delegates to the other.
 */
export function isCheckerPage(url = location.href): boolean {
	return (
		isOutputTaxPage(url) ||
		isInputTaxPage(url) ||
		isOutputReturnPage(url) ||
		isInputReturnPage(url)
	);
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
	return isVatInvoicePage(url) ? "referensi" : "no-retur";
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
	return isOutputTaxPage(url) || isOutputReturnPage(url);
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
	return isCheckerPage(url) || referenceIsIdentity(url);
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
  if (isOutputTaxPage(url)) return "Terhubung: e-Faktur PPN Keluaran";
  if (isInputTaxPage(url)) return "Terhubung: e-Faktur PPN Masukan";
  if (isOutputReturnPage(url)) return "Terhubung: Retur PPN Keluaran";
  if (isInputReturnPage(url)) return "Terhubung: Retur PPN Masukan";
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

function getFiltersFromBody(body: Record<string, unknown>): FilterLike[] {
	const filters = body.Filters || body.filters;
	return Array.isArray(filters) ? (filters as FilterLike[]) : [];
}

function getFilterName(filter: FilterLike): string {
	return String(filter.PropertyName || filter.propertyName || "").toLowerCase();
}

function getFilterValue(filter: FilterLike): string {
	const value = filter.Value ?? filter.value ?? "";
	return String(value).trim();
}

function findFirstFilterValue(filters: FilterLike[], patterns: string[]): string {
	for (const filter of filters) {
		const name = getFilterName(filter);
		if (patterns.some((pattern) => name.includes(pattern))) {
			const value = getFilterValue(filter);
			if (value) return value;
		}
	}
	return "";
}

export function extractFilenameHintFromBody(
	rawBody: string,
	source: ExportSource,
): string | undefined {
	try {
		const body = JSON.parse(rawBody) as Record<string, unknown>;
		const filters = getFiltersFromBody(body);

		if (source === "INPUT_TAX") {
			const periodValue = findFirstFilterValue(filters, ["period", "masa"]);
			const monthValue =
				findFirstFilterValue(filters, ["month", "bulan"]) ||
				periodValue;
			const yearValue =
				findFirstFilterValue(filters, ["year", "tahun"]) ||
				periodValue;

			const month = extractMonth(monthValue);
			const year = extractYear(yearValue);
			if (month && year) return `${year}_${month}`;
			return undefined;
		}

		if (source === "OUTPUT_RETURN" || source === "INPUT_RETURN") {
			const value =
				findFirstFilterValue(filters, ["year", "tahun", "period", "masa"]) ||
				String(body.TaxYear || body.Year || body.Tahun || "");
			const year = extractYear(value);
			return year || undefined;
		}

		if (
			source === "OUTPUT_TAX" ||
			source === "SPT_A2" ||
			source === "SPT_B2" ||
			source.startsWith("PPH_21_")
		) {
			const value = findFirstFilterValue(filters, ["period", "masa"]);
			return value ? value.replace(/[^a-zA-Z0-9_-]/g, "") : undefined;
		}
	} catch {
		return undefined;
	}

	return undefined;
}
