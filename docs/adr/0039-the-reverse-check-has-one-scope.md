# The comparer's reverse check has one scope: the given days, or the whole grid

The Comparer runs in two directions. Forward, every pasted internal record is
looked up in the scraped grid. In reverse, the grid's rows the internal records
do not carry are listed as **Hanya di Coretax** — the invoice exists in
Coretax and is missing from the Wajib Pajak's own records, which is the row
worth finding.

The reverse check's scope used to be the DAY LIST itself. `compareData`'s fourth
argument was `dailyDates: number[] | null`, and it did two jobs at once: it
switched the reverse check ON (a non-null list) and it said WHICH rows could be
candidates (the rows dated on one of those days). Unticking the panel's "Hari"
box therefore did not widen the check — it switched it off, and a monthly
comparison could never list a Coretax invoice the internal records did not
carry, even though the status, the status filter, the summary line and the
exported sheet all knew the status.

One argument answering two questions is what made the widening impossible: there
was no way to say "check every row" without a day list to hand.

## The decision

The scope is ONE value with two shapes, and the reverse check is always on:

```ts
export type CoretaxOnlyScope =
  | { kind: "days"; days: number[] }   // daily mode: the rows on those days
  | { kind: "all" };                    // monthly mode: every row of the grid
```

`comparer-logic.coretaxOnlyScope(session)` derives it from the session, and
that derivation is the whole rule:

- the "Hari" box TICKED → `{ kind: "days", days: session.dailyDates }`
- the "Hari" box UNTICKED → `{ kind: "all" }`

Rationale:

1. **The mode is the scope, and the mode is the user's decision.** Daily mode
   exists because the Wajib Pajak recorded only some days, so only those days
   are candidates. Monthly mode is the same question asked about the whole
   period: the internal records are compared against every row of the grid, and
   every row they do not carry is listed. The check is never switched off by
   the box; the box only narrows it.
2. **One argument, one question.** "Which rows are candidates for Hanya di
   Coretax?" is a single question, so it gets a single value. A `dailyDates`
   list that both enabled the check and scoped it could not answer it, and the
   only way to widen it was to have no list at all — which read as "off".
3. **The day list is still validated where it belongs.** Daily mode still asks
   for the days before a comparison runs (ADR-0003's decision tree), so a
   ticked box with an empty list never reaches a comparison. A daily session
   with no day yet has NO scope, which is the one case where the reverse check
   does not run.
4. **One row per reference, in both directions.** The forward lookup keeps the
   FIRST row of a reference the grid carries twice, so the reverse check keeps
   one row per reference too: a reference the grid carries twice is one
   invoice, and listing it twice would inflate the "hanya di coretax" count
   with a row the Wajib Pajak never saw.

Consequences: the status filter, the summary line, the panel's table and the
exported sheet needed no change — the status already existed, only the way to
produce one was unreachable in monthly mode. What the change touches is the
scope itself: `comparer.ts` (the type and the reverse check), `comparer-logic.ts`
(the derivation), the panel's "Hari" box (its tooltip now says which scope it
chooses), `CONTEXT.md`'s glossary (a **Monthly mode** beside **Daily mode**),
and the microsite's Mode Harian paragraph.

Status: accepted.
