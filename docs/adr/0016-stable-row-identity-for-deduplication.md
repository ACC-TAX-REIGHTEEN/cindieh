# A scraped row's identity is the portal's own id field

`getRowDedupeKey` picks one id per row from a declared, ordered list — `RecordId`, then `AggregateIdentifier` — and namespaces the value with the field it came from. A row carrying neither falls back to a whole-row stable stringify, as before.

## What was wrong

The old expression was `row.RecordId || row.AggregateIdentifier`, then `String(id)`. Two separate problems, both silent:

- **`||` tests truthiness, not presence.** `0` is a legal `RecordId`, and `""` and `null` are the two spellings of "absent" the portal mixes in. A row with `RecordId: 0` skipped the check, skipped the second field too, and landed on the whole-row fallback — where its key was a hash of every field rather than an id. The same invoice on the next page, keyed by its id, produced a different key, and the row was collected twice.
- **The key did not say which space it came from.** `RecordId` and `AggregateIdentifier` are separate counters on the portal. Both produced a bare `"5"`, so a row whose `RecordId` was 5 and an unrelated row whose `AggregateIdentifier` was 5 produced the same key, and the second one was silently dropped as a duplicate.

## Why the list stops at two

Not invoice numbers, and not `Reference`. On PPN Masukan the `Referensi` belongs to the **seller** and repeats across one taxpayer's invoices — often empty. Treating it as an identity would merge rows that are genuinely different, and a dedupe key that drops real rows is worse than one that occasionally keeps a duplicate: the export silently loses invoices. So the identity is the portal's own per-row id and nothing else.

A grid that carries neither id still gets a key — the whole-row stringify, which sorts keys so two rows with the same values in a different order still match. That path is correct and slow, and it is the reason to keep the ids working rather than to relax the list.

## One id, chosen by a fixed order

The key names one field, not every field present. Concatenating all present identity values would be *less* stable, not more: a row that arrives on page 1 carrying both a reference and an aggregate id, and on page 5 carrying only the aggregate id, would key differently either way — and the second spelling is the one the user can see in a third invoice of the same seller. A declared order makes the key a function of the row's identity values alone.

`0` and `"7"` still produce the same key for the same id, because `String()` normalises the number/string split a portal is free to make between two responses.

## Consequences

- The key is now namespaced (`RecordId:5`), which is a **wire-visible change**: nothing outside `mergeRows` reads it, and `seen` is rebuilt per run, so no stored state depends on the old shape.
- `scraper-helpers.unit.test.ts` pins the namespace, the cross-space collision, the zero id, the empty/null id, and that an id-less row still deduplicates across pages.
- **No portal verification is required for this half.** `scraper.ts` and the download path are untouched; the change is one pure function plus its tests.

Status: accepted. Recorded and implemented 2026-10-06.
