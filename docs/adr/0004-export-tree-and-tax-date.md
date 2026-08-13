# Export goes through one decision tree; parsing lives in tax-date

`handleExportAction(format, state, deps)` in `main-actions.ts` resolves every format internally, including PDF (filter + confirmation via `startPdfDownload`). The old implicit hand-off — "returns false, caller must call `handlePdfExport`" — is gone; the SCRAPE_COMPLETE auto-export path calls the same interface rather than building `ExportData` inline. CSV generation is shared via `buildCSV`/`downloadTextFile`.

`tax-date.ts` is the single home for masa-pajak period and date parsing (`extractYear`, `extractMonth`, `extractYMD`, `formatDate`). Do not hand-roll date/period regexes elsewhere; the timezone rule (reformat captured digits, never round-trip through `Date`) is pinned by tests across `+07/+08/+09/Z`.

Status: accepted.
