// ============================================================
// FILTER.TS — Data filtering
// ============================================================

export interface FilterOptions {
	dateFrom?: string;
	dateTo?: string;
	status?: string;
	keyword?: string;
}

function parseDateBound(value: string, endOfDay: boolean): Date {
	const d = new Date(value);
	if (endOfDay) {
		d.setHours(23, 59, 59, 999);
	} else {
		d.setHours(0, 0, 0, 0);
	}
	return d;
}

export function applyFilters(
	data: Record<string, unknown>[],
	options: FilterOptions,
): Record<string, unknown>[] {
	return data.filter((row) => {
		// Date range filter
		if (options.dateFrom || options.dateTo) {
			const raw = row["InvoiceDate"];
			if (raw == null) return false;
			const d = new Date(String(raw));
			if (isNaN(d.getTime())) return false;
			if (options.dateFrom && d < parseDateBound(options.dateFrom, false)) return false;
			if (options.dateTo   && d > parseDateBound(options.dateTo, true))   return false;
		}
		// Status filter (case-insensitive exact match)
		if (options.status !== undefined) {
			const rowStatus = String(row["Status"] ?? "");
			if (rowStatus.toLowerCase() !== options.status.toLowerCase()) return false;
		}
		// Keyword filter (case-insensitive substring in any string field)
		if (options.keyword !== undefined) {
			const kw = options.keyword.toLowerCase();
			const match = Object.values(row).some(
				(v) => typeof v === "string" && v.toLowerCase().includes(kw),
			);
			if (!match) return false;
		}
		return true;
	});
}
