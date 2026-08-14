import { describe, expect, it } from "vitest";
import { getExportButtonLabel, getIdlePanelStatus, getToggledPanelVisibility } from "../content/ui-badge";

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
    expect(getExportButtonLabel("xlsx", true)).toBe("Berhenti");
    expect(getExportButtonLabel("csv", true)).toBe("Berhenti");
    expect(getExportButtonLabel("pdf", true)).toBe("Berhenti");
  });
});
