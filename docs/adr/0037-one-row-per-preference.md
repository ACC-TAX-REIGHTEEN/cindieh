# One row per preference, and one binder for the popup's controls

The extension has nine stored preferences. Each one was declared in four parallel hand-maintained
lists, and then wired a fifth time in the popup:

| Where | What it said |
|---|---|
| `shared/extension-preferences.ts` | a constant block per key: key, default, normalizer |
| `content/preferences.ts` | `STORAGE_KEY_BY_FIELD` — the field → key map |
| `content/preferences.ts` | `normalizePreferences` — the key → normalizer map |
| `content/preferences.ts` | `preferencesFromChanges` — the key → normalizer map again, for live changes |
| `popup/popup.ts` | a block per control: look the element up, paint it, attach a listener, read the value, normalize it, write it, say something |

Nothing in the build failed if one of the five disagreed. A key spelled correctly in three places
stored a value the fourth looked for under another name — the control looks saved and does nothing,
which is exactly the failure `preferences.unit.test.ts` was written to prevent one payload at a
time. The popup carried the repo's lowest branch coverage (61.7%), because every block re-tested
`if (element)` and every normalizer choice by hand.

Decision:

1. **`shared/extension-preferences.ts` declares `PREFERENCE_FIELDS`**: one row per preference,
   keyed by the field the code reads, holding its storage key, a `defaultValue()` and its
   normalizer. `PREFERENCE_STORAGE_KEYS` is derived from it, so the reset path removes exactly what
   the table declares.
2. **`defaultValue` is a function, not a value.** The two defaults objects hold an array, and a
   shared literal would hand one array to every reader; `defaultPreferences()` builds a fresh copy
   on every read, which also removed the two hand-written `{ ...DEFAULT, statusFilter: [] }`
   clones.
3. **`content/preferences.ts` derives all three of its maps from the table.** `normalizePreferences`
   and `preferencesFromChanges` are one loop each, and `STORAGE_KEY_BY_FIELD` is a projection. The
   rule from AGENTS.md is unchanged: a `Partial<ExtensionPreferences>` is still never passed
   straight to `storage.local.set` — `writePreferences` remains the only writer, and it translates
   fields to keys through the projection.
4. **`popup/preference-controls.ts` is the one binder.** A control is a row: which element it is,
   the event that means "changed", how it paints itself from a preference snapshot, the patch a
   change produces (null when it stores nothing — the losing half of a radio pair), and — for the
   few that need one — an asynchronous gate before the write, a rollback, and the line the status
   field should say. `paintPreferenceControls` and `bindPreferenceControls` own the lookup, the
   listener, the write and the ordering: the line is said after the write, never before it.
5. **The rows live in `popup.ts`; the mechanism lives in the binder.** A row names an element id
   from `popup.html` and the FIELD it sets — never a storage key — so the markup and the control
   stay together while the key stays in the schema.
6. **Two controls are deliberately not rows.** The export MODE (`cleaned` / `raw`) has its own key,
   its own writer and its own lifecycle outside the managed set (a reset must not change how data is
   exported). The debug switch has its own key, is never cleared by a reset, and applies to the
   popup's own logger. Both stay hand-written in `popup.ts`, which is now mostly those two plus
   maintenance and the portal status line.

Consequences: adding a preference is one table row, one markup element and one control row — and
the read path, the write path, the live-change path and the reset path all follow from the first,
with no second list to edit. The popup's branch coverage moved from 61.7% to 77.4% without a single
new behaviour, and the total rose to 94.91/89.89/93.21/95.88 on 2018 tests. A new case pins the
defensive contract that had only ever been asserted in prose: the popup opens with no controls on
the page at all.

Status: accepted.
