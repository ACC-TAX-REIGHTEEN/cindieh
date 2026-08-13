# PDF download emission is one module with split item sourcing

The four DOWNLOAD_PDF_ITEM emission sites (fetch interceptor, XHR interceptor, bulk e-faktur, bulk withholding) were collapsed into `scraper-pdf.ts` (`createPdfDownloadSession` + pure `unwrapPdfData`/`resolveInvoiceRow`/`buildPdfDownloadMessage`), with the fetch/XHR monkey-patches in `scraper.ts` kept as thin adapters.

The load-bearing part: **item sourcing is deliberately split and must never be unified.** Native downloads (interceptors) resolve the invoice row from the grid-capture map (`invoiceRowMap`) because the download response carries only base64; bulk downloads already hold the full row and must pass it through untouched. A previous bug produced `TANPA_REFERENSI` filenames when the two paths were conflated — do not "simplify" them back together.

Status: accepted.
