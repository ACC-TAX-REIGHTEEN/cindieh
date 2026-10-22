# A tab's status line is one module, and its kind is the guard

Each panel tab has exactly one status field, and four things speak through it: the promise
made while the grid is fetched, the summary of a finished run, an error, and the retirement
notice a stop leaves. Before this, every writer found the element by id, assigned
`textContent` and picked a class by hand — four call sites per tab, each free to choose the
wrong weight — and the retirement was guarded by comparing the text the tab remembered
writing. The same field therefore had two tabs' worth of near-identical code, and the
`error` weight existed in three separate places (each tab, plus `reportResultExportFailure`).

`src/content/status-line.ts` is that field, as one thing:

```ts
type StatusKind = "waiting" | "summary" | "error" | "notice";

const line = createStatusLine("ch-checker-status");
line.set("waiting", notice);                              // the promise
line.set("summary", formatCheckSummary(results));         // a finished run
line.set("error", message);                               // something failed
line.clear();                                             // nothing to say
line.replace("waiting", { kind: "notice", text: … });     // a retirement
```

The module owns the element id, the class each kind paints, and the memory of what it last
set. Callers name an **intent**, never a CSS class.

Rationale:

1. **The kind is the guard.** ADR-0026's rule was "replace the line only while it is still
   the promise". It compared text because nothing tracked the state; the string was a proxy.
   A kind is the actual state, so `replace()` fires only while the line still shows a
   `waiting` this module set, and a summary or an error written since is out of its reach by
   construction — not by a string that happens to differ. One retirement also consumes the
   promise, so two announcements cannot paint over what the user has since seen.
2. **One mapping from kind to weight.** Which class an error gets, and that the retirement
   notice is deliberately quiet (the badge is the primary account), are decisions, so they
   belong in one place instead of being re-typed at every write. `reportResultExportFailure`
   takes the tab's line rather than its id, which removed the third copy of the error class.
3. **The line looks its element up on every call.** The panel is re-injected when Angular
   re-renders its header; a captured node would go on being painted after the live one
   replaced it. `set()` returning false is the one condition a caller acts on — a detached tab
   has nowhere to promise anything, so it does not start a scrape it could never report on.
4. **The kinds are the panel's vocabulary, not the DOM's.** `waiting`, `summary`, `error` and
   `notice` are what a tab can be saying; the classes are how that looks. A fifth state (say,
   a warning) is one entry in the kind map, and every tab gets it.

Consequences: both tabs construct their line once (`createStatusLine(<their id>)`) and every
status write in `ui-checker.ts`, `ui-comparer-view.ts` and `result-grid-view.ts` goes through it;
the `waitingNotice` string each tab carried is gone. `status-line.ts` is pure DOM with no
browser API, so it unit-tests directly: the class per kind, the missing-element refusal, the
`replace` guard in both directions, one-shot replacement, and writing to a re-injected
element. The tabs' own suites still pin the user-visible text, including that a summary
survives a retirement.

Status: accepted.
