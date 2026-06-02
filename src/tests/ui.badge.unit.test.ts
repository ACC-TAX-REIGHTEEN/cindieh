import { describe, expect, it } from "vitest";
import {
	getExportButtonLabel,
	getIdlePanelStatus,
	getToggledPanelVisibility,
} from "../content/ui";

describe("floating badge panel", () => {
	it("toggles the panel visibility whenever the badge is clicked", () => {
		expect(getToggledPanelVisibility(true)).toBe(false);
		expect(getToggledPanelVisibility(false)).toBe(true);
	});

	it("uses an informative status when opened while idle", () => {
		expect(getIdlePanelStatus()).toBe(
			"Tidak ada proses berjalan. Mulai export dari tombol Better Export.",
		);
	});

	it("uses consistent export button labels across normal and running states", () => {
		expect(getExportButtonLabel("xlsx", false)).toBe("Export XLSX");
		expect(getExportButtonLabel("csv", false)).toBe("Export CSV");
		expect(getExportButtonLabel("pdf", false)).toBe("Download PDF");
		expect(getExportButtonLabel("xlsx", true)).toBe("Stop Export");
		expect(getExportButtonLabel("csv", true)).toBe("Stop Export");
		expect(getExportButtonLabel("pdf", true)).toBe("Stop Export");
	});
});
