# Comparer matching uses primary Reference only; refLain is reserved for internal tracking

In `comparer.ts` and `comparer-logic.ts`, invoice comparison against Coretax data (`scrapedData`) matches rows strictly via the primary `Reference` field. The secondary column `refLain` ("Referensi Lain") is parsed and displayed in the comparison results table for user context, but is deliberately excluded from the Coretax lookup key.

Rationale:
1. Users often maintain two internal reference numbers (e.g. internal ERP voucher number in `Reference` and secondary internal tracking number in `refLain`).
2. Coretax's system stores and indexes invoices under the primary reference number. Matching strictly on `Reference` avoids ambiguity and false positive matches when users paste internal secondary numbers into `refLain`.
3. Keeping `refLain` as a display-only column allows users to cross-check their secondary internal identifiers alongside the primary matching status without altering Coretax lookup logic.

Status: accepted.
