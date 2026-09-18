# Export goes through one decision tree; parsing lives in tax-date

`handleExportAction(format, state, deps)` in `main-actions.ts` resolves every format internally, including PDF (filter + confirmation via `startPdfDownload`). The old implicit hand-off — "returns false, caller must call `handlePdfExport`" — is gone; the SCRAPE_COMPLETE auto-export path calls the same interface rather than building `ExportData` inline. CSV generation is shared via `buildCSV`/`downloadTextFile`.

Update (2026-09-18): the return value is now meaningful rather than constant. It was always `true`, and the PDF branch dropped the decline from `startPdfDownload`, so the `boolean` promised a decision it never carried. The PDF branch propagates that result: `false` means the flow did not start (no invoice matched the filter, or the confirmation was cancelled) and the caller must **not** do anything else about it — the filter, alert, and panel updates already happened inside, and there is still no `handlePdfExport` to call. Callers may keep ignoring it; the change is that the type no longer lies.

`tax-date.ts` is the single home for masa-pajak period and date parsing (`extractYear`, `extractMonth`, `extractYMD`, `formatDate`). Do not hand-roll date/period regexes elsewhere; the timezone rule (reformat captured digits, never round-trip through `Date`) is pinned by tests across `+07/+08/+09/Z`.

Status: accepted.
