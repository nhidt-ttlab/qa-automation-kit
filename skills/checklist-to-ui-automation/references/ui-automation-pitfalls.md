# UI automation pitfalls — failure modes that cost live runs

Every entry below is a failure mode that has produced a wrong verdict on a real project. They are
ordered by how expensive they are to diagnose after the fact. Read this before writing assertions for
a `*.scenario.ts` under `<paths.suites>/<suite>/ui/`.

The project knowledge file (`<paths.knowledge>/checklist-to-ui-automation.md`) carries the project's
own evidence for these entries under the same numbers — the run, the component, the selector — plus
the quirks of the widget libraries named in `web.widgets`. Read both.

The unifying theme: **a UI scenario can be confidently wrong in both directions.** It can report a
defect that is a measurement artifact, and it can report green while measuring nothing. Both are
worse than a red run, because both get believed.

---

## 1. `check()` compares with `===` — build both sides in the same shape

`check(label, expected, actual, testId)` is a strict equality. A compound assertion whose `expected`
is prose and whose `actual` is a measurement **can never pass**, no matter how correct the product is.

```ts
// WRONG — these two strings never match
check(label, `item count = the number in the header, and ≤ ${apiCount}`,
             `${rendered} items, header says ${header}, API has ${apiCount}`, id);
```

```ts
// RIGHT — collapse the verdict to one token, put the numbers in the failure branch
check(label, 'consistent',
      consistent ? 'consistent' : `NOT consistent: ${rendered} rendered, header says ${header}, API has ${apiCount}`,
      id);
```

Alternative when the value itself is the point: make `expected` the **computed oracle string** and
`actual` the **read string**, so both are the same kind of thing — the report then shows two
comparable strings and a reviewer can see the difference.

Cost when missed: a red assertion against a working product, and a plausible-looking defect report.

---

## 2. Wait on the DOM, not the network, when one path serves many states

A "request URL contains" wait is a **substring** match. If every state of a screen calls the same
path, the wait is satisfied by whichever response lands first — including one still in flight from
mount.

Typical shape: switching a filter refetches `/api/<resource>?type=<n>`, but the wait is on the bare
path. The scenario reads the previous state's row count because the grid still holds the previous
state's data.

Waiting on the exactly-right URL is **still not enough**: the response landing and the framework
repainting are two different moments.

```ts
// The only correct wait: poll the DOM for the state you expect, bounded, and do NOT force it.
for (let i = 0; i < 20; i++) {
  if ((await ui.countGridBodyRows(GRID)) === expectedRows) break;
  await ui.page.waitForTimeout(200);
}
return ui.readGrid({ within: GRID, columns }, title);   // real reading either way
```

Bounded polling that returns the real reading is honest: if the state never arrives, the caller's
assertion fails on it — which is right when the grid genuinely fails to reload.

**Corollary:** when the assertion *is* "no request happened", you must **not** settle or wait on the
network at all — doing so hides the very thing being measured.

---

## 3. Never probe `disabled` on a renderer you have not read

Asking the wrong DOM question returns a confident answer in the **dangerous** direction: "not
locked" for a locked control.

Custom cell renderers (a checkbox drawn as a `div` + inline SVG, say) have no `<input>`, no widget
library class and no `aria-disabled`. A probe for `input[disabled]`, `aria-disabled` and the library's
disabled class then reports **zero locked cells everywhere** — including hard-locked columns. The lock
may live only in style (`cursor`, `opacity`).

The correct probe reads the signal the component actually sets (e.g. the **computed cursor**), and
then discriminates properly: none interactive in the locked columns vs all interactive in a control
column.

**Rule:** before asserting on a control's state, open the component. If it is not a native input or a
stock widget-library control, there is no attribute to read — find the signal the component actually
sets.

---

## 4. Always run a control step before concluding "disabled" or "locked"

"The control is locked" and "the mode never turned on" produce the **same observation**. Without a
control you cannot tell them apart, and you will report the wrong one.

Measure a column that is known **not** to be locked **first**. Only when the control column is
interactive does the claim about the locked columns mean anything; otherwise both ship
`NOT_EVALUATED`.

The same works across modes: probe the cell in **view mode** (must refuse) before probing it in
**edit mode**. That is what turns a "cell accepts typing" observation into a defensible finding rather
than an artifact.

---

## 5. Do not infer a mode from a button whose `disabled` means something else

A Save button next to an Edit toggle looks like an edit-mode signal. It usually is not:

```tsx
<Button id="btn-save"   disabled={isLoading || !isDirty} />   // tracks isDirty
<Button id="btn-import" disabled={isLoading || !editMode} />  // tracks editMode
```

Save tracks **dirtiness**, not mode; using it concludes "edit mode never turned on" while it was on.
Read the component; do not assume a button's `disabled` means what its position suggests.

---

## 6. The oracle must be recomputed, never read back from the surface under test

Reading the model out of the grid and then comparing it against the same grid is a tautology, and
worse, it launders display formatting into the expectation.

Take the row model from the **API payload** (read before the browser opens), apply each edit to that
local model, and compare the recomputed string against the DOM string. Two independent paths.

Reading the model from the grid goes wrong in predictable ways:
- a renderer shows a space as a visible glyph (`␣`), and
- a display column shows the **translated label** while the value the rule uses is the **raw key**.

Put shared oracles in the suite's `*-ui-shared.ts` precisely so several scenarios cannot drift apart.

---

## 7. A grid reader cannot prove a column does **not** exist

`readGrid` returns only the columns you name. Asking for `material` and getting nothing proves
nothing — the column may be off-screen, or you may be reading the wrong grid.

For an **absence** assertion, enumerate the whole header and compare sets:

```ts
const colIds = await ui.page.evaluate((sel) => { /* collect the column id from every header cell */ },
                                      `${ACTIVE_PANEL} <header-cell selector>`);
```

Grids that virtualise horizontally must be swept before concluding. Expect the live header to contain
ids that are absent from the column definitions (an action column, a selection column) — worth knowing
before anyone asserts "exactly N columns".

---

## 8. Tab widgets keep inactive panels mounted — scope every locator

Many tab components keep inactive tab panels in the DOM, hidden. Calling a grid reader right after
switching tab then times out on, or reads, the **other tab's** grid.

Scope everything to the active panel's selector. Never let a reader pick "the first grid".

Same family: select/dropdown widgets often keep **closed dropdowns** mounted with a "hidden" class.
Counting options without excluding that class picks up a stale dropdown and reports a confident wrong
number. Keep an `OPEN_DROPDOWN` selector in the shared module for this.

The exact active-panel and hidden-dropdown selectors for the project's widget libraries are in the
knowledge file.

---

## 9. Clicking a select widget: an inner element may intercept the pointer

Auto-generated ids on select inputs (numbered by mount order) move between renders, and the input
itself is often **not clickable** — an inner "selection item" element intercepts pointer events and
the click times out.

Click the visible item instead, and read the current value from its `title` (or equivalent):

```ts
const settingSelect = { css: '<select root selector>', nth: 0 };
await ui.readSelectValue(settingSelect);                          // current value
await ui.click({ css: '<selection item selector>[title="…"]' });  // open the dropdown
```

---

## 10. Display labels are not unique — do not build assertions on them

An assertion such as "no overlapping labels between two tables' field lists" fails on a label like
`Description` while the panel works perfectly: both entities simply have a `Description` field.

When a component puts **no key on the DOM** — no id, no test id — labels are all that can be read.
Rewrite the assertion to what labels can support (e.g. the item set **changed**, and its size matches
the header the panel renders).

**Rule:** when the only readable identifier is a display label, assert a property that labels can
actually carry. Ask for a `data-testid` and record it in the step doc's backlog section.

---

## 11. A count the screen shows is not the count the API returns

A panel header like `Fields (N)` often counts **after** client-side filters: items already used
elsewhere disappear, and per-type visibility rules narrow further. The API returns 11, the panel shows
7, and both are correct.

Rather than reimplementing the filters — which copies product logic into the test and makes a bug in
it invisible — assert the **weaker, honest** property: rendered count == the number the panel itself
declares, and ≤ the API count.

---

## 12. `passed: true` is not "the rule was checked"

The kit's verdict derivation downgrades a run with `NOT_EVALUATED` checkpoints to `PARTIAL`, but a
scenario that degrades **every** assertion still returns `passed: true` and may print `RESULT: PASS`
for a batch runner.

After each run, read the checkpoint list from the result JSON:

```bash
node -e "const j=require('<result json of the run>');
 for (const c of j.checks) console.log((c.testId||'').padEnd(26),
   /^NOT_EVALUATED/.test(String(c.expected)) ? 'NOT_EVALUATED' : (c.passed?'PASS':'FAIL'));"
```

A well-verified scenario shows every assertion judged, zero `NOT_EVALUATED`, and expected/actual
columns that visibly change between rows — proof each edit landed.

---

## 13. Trace the control before writing a step that uses it

A step specced as "remove a field from the grid" may have no remove control at all: the component
exists in the source, is re-exported from a barrel, and is **never rendered**
(`grep -rn <ComponentName> src/` finds only the re-export). Removal then means **dragging the row
back** — a verb the driver may not have.

A scenario may substitute a mechanism that exercises the same property (e.g. a cell edit, when both
mutate the same state and re-run the same derivation), and must **say so in Automation findings**
along with what was lost.

**Rule:** a substitution is legitimate when the property survives. Silence about it is not.

---

## 14. Blocker layers, and why the label decides the row's fate

| Layer | Meaning | Real? |
|---|---|---|
| `browser` | driver lacks a verb, or the write guard fires | **No** — reroute to the API lane |
| `API` | the endpoint genuinely does not exist | Yes, but verify against source first |
| `test data` | endpoint works, the test environment has no data in that shape | Yes — name the exact fixture |
| `product` | the feature does not behave as specced | Yes — this is a finding |
| `source` | no spec exists for the screen at all | Yes — precondition for the whole cluster |

A blocker recorded without a layer reads as "impossible" and the row dies. A missing `dragTo` verb
can block several test cases across files — labelled `browser`, it is one afternoon of driver work;
unlabelled, it looks like several dead test cases.

---

## 15. When a `FAIL` lands against a self-contradictory spec

A cell accepts typing, reproducibly, against a spec row that says `Readonly = TRUE` — while another
spec row with the same label and the same business meaning says `FALSE`, and the classification doc
already flags that pair as needing confirmation.

Report **both halves**, and do not file a defect ticket: the expected behaviour has not been agreed.
Put that in the report model's defect/regression note so the generated report says it, and the reader
gets it without opening the step doc.

---

## 16. A report field that compiles is not a field that renders

Report pipelines often have more than one rendering path, and a scenario field that renders in one is
silently absent from the other. Typical findings:

- `checks[].testId` renders verbatim in the checkpoint list but **not** in the expected-vs-actual
  summary, which builds its checkpoint text from `label`.
- An "overview highlights" field that no renderer reads at all — prose written there is invisible in
  the artifact QA actually opens.

To get the check reference into the summary, override the report model's expected-vs-actual rows in
the scenario (the trace helper's `expectedVsActual(checks)` does this), mirroring the builder's own
selection (non-passing first, capped) so the summary stays a summary. Anything a reader **must** see
goes in `conclusion` or a `detailTables` entry.

Checklist metadata does not ride on `testId`: it goes in `check.csv`, which the kit renders as
dedicated CSV columns and persists into the run store. Keep `testId` at two segments.

**Rule:** after adding any report-facing field, grep the generated Markdown for it:

```bash
grep -n "<a distinctive phrase you wrote>" <paths.reports>/<newest report for the test case>.md
```

---

## 17. `detailTables` is the place for evidence that will not fit a checkpoint row

`detailTables` on the result renders as its own heading + table straight after the checkpoint list,
and persists with the run, so it survives into the review UI and the database — it is not a
Markdown-only decoration.

Use it when one check would otherwise cram a whole matrix into a single cell: per-row join evidence,
or the verbatim checklist trace whose columns cannot fit the fixed checkpoint table.

Declare `detailTables?: DetailTable[]` on the scenario's **own** `*Result` interface, not just rely on
the base result type having it: the returned object literal is checked against the scenario's declared
return type, so an undeclared field is rejected as an excess property.

---

## 18. A grouped grid header carries no parent pointer — read the group geometrically

Grouped column headers are usually a **layout** contract. Leaf header cells hold no attribute naming
their group, so "this column sits under group X" cannot be read from the DOM directly.

What works: collect every group header cell with its bounding box, collect every leaf header cell
(with its column id) with its own, and assign each leaf to the group whose horizontal span contains
the leaf's centre **in the same frame**. Sweep the centre viewport first — the header virtualises
exactly like the body, so an unswept read reports a subset and calls the rest missing.

Two rules that come with it:

- **Identify the group by a column you already know belongs to it**, never by its translated label.
  Hard-coding the label turns a translation edit into a red test.
- **Strip a known prefix to recover a data-driven column id**, never `split('_')`. A column id built
  as `` `${valueType}_${name}` `` breaks when the name itself contains `_`.

---

## 19. The oracle for a client-generated column is the same function, re-executed

Some columns do not exist in any response: the client derives them from nested data in the payload,
and each cell is a client-side aggregation. The temptation is to assert against a catalogue the client
never reads — which turns every catalogue entry with no data red for a **data** reason.

Re-run the client's own derivation on the payload you fetched **before opening the browser**, and
compare *what was generated* with *what should have been generated*. Two independent executions of
one rule is a real comparison; reading the generated names out of the rendered header and comparing
them with themselves is not.

---

## 20. Tolerance for a sum of rendered numbers is measured, not chosen

Money and quantity cells usually pass through a rounding formatter, and the rounding rule itself may
be an open BA question. Comparing `Σ rendered terms` with a `rendered total` therefore needs a
tolerance derived from **the decimals actually on screen**: each rendered value carries up to half a
unit of its last place, so `tolerance = (terms + 1) × ½ × 10^-d`, with `d` read from the cells in that
comparison. For a product (`qty × unit price`) propagate both factors:
`|b|·½ulp(a) + |a|·½ulp(b) + ½ulp(result)`.

Picking a round number instead fails in both directions: too tight and a correct screen goes red on
rounding, too loose and a real divergence of a few thousand currency units passes unnoticed.

---

## 21. A tab fetches once; a sum needs the whole grid

Two independent traps in the same family:

- **Switching to a tab already visited often fires no request.** Waiting on that tab's endpoint the
  second time hangs until the timeout. Visit each tab once, in the order the step doc lists, and read
  everything that tab owes in that one visit.
- **A sum over "all rows of X" is meaningless on a cut grid.** A grid that paginates client-side over
  one server page shows only that page, so before summing a whole column compare the rendered row
  count with the payload's total count and ship `NOT_EVALUATED` naming both numbers when they differ.
  A short sum reported as a defect is the most expensive false positive a summary screen offers.
