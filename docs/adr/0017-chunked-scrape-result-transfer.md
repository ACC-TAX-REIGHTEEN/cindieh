# A large scrape result crosses the bridge in chunks

A result above `SCRAPE_CHUNK_ROWS` is sent as `SCRAPE_DATA_CHUNK` messages and the completion names how many must arrive. Below the threshold, and for every result that is empty, the completion carries the rows exactly as before. `scrape-result-transfer.ts` splits and sends; `result-chunks.ts` reassembles.

## The problem

`SCRAPE_COMPLETE` carried every collected row in one message. `postMessage` structured-clones the payload **synchronously on the sender's thread**, which for the scraper is the page's own main thread — the thread the portal's Angular app renders on, during the export the user is watching. A year of a busy grid is tens of thousands of rows; cloning them is one long block with nothing to yield to.

The opposite extreme is wrong too: a chunk small enough to feel instant costs more in per-message overhead than it saves, and a portal that answers 2000-row pages has already told us how much data is in flight at once.

## Why a threshold rather than always

Below the threshold the old message is unchanged: one message, rows inline, no flag. That is deliberate. The chunked path is new code in the most delicate seam in the project, and making every ordinary run depend on it would mean the common case is only ever tested by the new path's own tests. As written, a small run is byte-for-byte the behaviour it always had, and `dataChunks` is the flag that distinguishes the two.

## The completeness rule

The receiving side **refuses to finish an incomplete transfer**. `assembleRows` returns `null` when a chunk is missing, and `main.ts` reports the run as failed rather than settling it with what arrived.

This is the whole point, and it connects to the truncated-export notice from the scrape work: a lost chunk and a short grid produce identical output — a file that is a bit smaller than expected — and neither is distinguishable from a genuine end of data once it has been written. Exporting the remainder would reintroduce, through a different door, exactly the failure `truncatedResultNotice` exists to make visible. So a lost chunk is loud: the panel says so, the completion notice is published as an error, and the Run keeps nothing.

An **empty** result is not a missing one: `assembleRows(buffer, 0)` is `[]`, and a scrape that legitimately found nothing settles as an ordinary empty success.

## Ordering, indexing, and the flag

`postMessage` between one sender and one receiver preserves order, so chunks cannot arrive out of order in practice. The receiver indexes by `index` anyway, because arrival order is not the contract and a future batching or retry path would break the assumption silently. Every chunk declares the same total, and a repeated index **overwrites** rather than appends — a duplicated delivery is a bug to be harmless, not a reason to double the rows.

`dataChunks` is absent for every pre-existing message, so an older receiver keeps working unchanged and needs no special case: absent means "the rows are in `data`". In the chunked case `data` is sent as `[]`, deliberately — a receiver that lost a chunk must see an obviously empty result, not a plausible-looking partial one.

## What is NOT chunked

`START_PDF_DOWNLOAD` carries a row list the other way (isolated → MAIN) and is left alone. It is a much smaller payload — the rows of one grid, which the scraper has already been holding — and chunking it would mean a second protocol in the opposite direction for no measured gain.

## Consequences

- **New message type, so this needs portal verification.** It is the only change in this ADR that touches the download-adjacent path (`scraper-actions.ts`), and it changes what the MAIN world sends on every completion. AGENTS.md's evidence — one request per click, one file per click, `dist/cindieh-chrome` unpacked — applies, and this change has not been run against a live portal.
- `scrape-result-transfer.unit.test.ts` covers the sender (threshold behaviour, chunk count, order, the emptied `data`, the rest of the completion surviving) and the reassembler (index order, refusal, empty-vs-missing, duplicate delivery, reset).
- `main-boot.unit.test.ts` covers the wiring that a seam suite cannot see: a chunked result driven through the guarded message path into a real Run, and an incomplete transfer leaving that Run with nothing.
- The protocol's shape is documented in `AGENTS.md` under the two-worlds message list.

Status: accepted. Recorded and implemented 2026-10-06.
