# Building Excel data for an upload test case

Read this before writing the first cell of an import fixture. Most of these rules exist because
breaking them produces a failure that **looks like a product bug and is not** — which costs a defect
ticket, a triage, and the credibility of the next real one.

The project knowledge file (`<paths.knowledge>/checklist-to-ui-automation.md`) names the project's
sample-workbook folder, its worked fixture example, its upload helper and import flows, and its
field-level import rules, under the same section numbers.

## 1. Customer sample workbooks are column evidence, never fixtures

Projects usually keep the customer's real import files somewhere in the repository. They are kept so
you can check **what the column set is**, and for nothing else.

A scenario must not read them at run time. Two reasons:

- **They are outside the package.** A run that opens one breaks the moment the file moves, and cannot
  run anywhere the full repository is not checked out.
- **Their values belong to other tenants or projects.** The rows reference catalogue entries from
  whatever tenant produced the file. Uploading them into the fixture under test fails on data, not on
  the rule you meant to check.

So: **copy the header row into a TS constant**, and build the workbook in memory (e.g. with
`exceljs`).

To inspect a workbook without opening Excel, convert it to CSV with a small script (one CSV per sheet)
and read the header rows.

## 2. The pattern to copy

A good upload fixture module exports:

| Export | What it is |
|---|---|
| `<NAME>_UPLOAD_HEADERS` | the column labels, `as const`, verbatim from the sample workbook |
| `<NAME>_UPLOAD_SHEET_NAME` | the sheet name, sent verbatim wherever the request names the sheet |
| `<Name>UploadRow` | typed row: `cells` keyed by header, plus any dynamic columns |
| `<CASE>_SAMPLE_ROW` | one real row, copied from a manual upload that is known to have succeeded |
| `build<Name>UploadWorkbook(rows, sheetName?)` | returns `{ data: Buffer, sheetName, headers, rowCount, byteLength }` |

The doc comment records **where the sample came from and when** (file name, sheet name, date). Keep
that habit: a fixture whose provenance is unrecorded cannot be re-verified when the server's mapping
changes.

Prefer a sample row that a human has actually uploaded successfully on the test environment. Every
reference value has to exist and be active in the tenant's catalogue, so an invented row fails
validation for a reason that has nothing to do with the rule under test.

## 3. Column labels are load-bearing — never retype one

Import endpoints commonly match each header against a table of known column mappings. A label the
server recognises fills the matching property; a label it **does not** recognise may be treated as a
dynamic column (a quantity, an attribute) rather than rejected.

So a single character out of place does not raise "unknown column". It silently reclassifies the
column, and the upload fails — or worse, succeeds with the wrong shape. The failure reads as a product
defect and is a harness defect.

Rules that follow from this:

- Copy labels; never retype them. Diacritics, non-breaking spaces and trailing spaces all count.
- Never reorder columns. Build the row array from the header constant so order cannot drift.
- Never "tidy" a label that looks misspelled in the source file. If the server expects the typo, the
  typo is the contract.

## 4. Empty cells must be genuinely empty

Write `null`, not `''`. Servers that read `Value?.ToString()` (or equivalent) treat `null` as
*absent*; an empty string is a present-but-blank value and can pass a required-field check that should
have failed.

Make the builder do this explicitly — `v === '' ? null : v` — so typed row literals may carry `''`
and still upload correctly.

## 5. Where the file goes

Use the project's shared upload helper (temp-file upload, then the domain's import call) and the
per-domain import flow built on it; the knowledge file lists them. Do not write a new upload path per
scenario.

A common limitation to plan around: **templates the host serves for download may not open in the
in-memory workbook library.** Build the workbook from your own header constant rather than downloading
a template and editing it.

## 6. Field-level import rules

The hardest import files have cross-field constraints that make a row valid — fields locked together
by one API response (picking them independently yields a 500 or a "no match" error), values that must
belong to a parent entity's set, fields that may only be written when the parent declares them, and
references that must belong to the running fixture. Two import files that feed one downstream match
must agree exactly on their shared fields, or they generate different keys and the match finds
nothing.

If the project has a rules document for these, read it before building rows; the knowledge file names
it and says which of its paths are stale. Treat such a document as a **rules document, not a file
map** when its paths predate the current layout.

## 7. Known bad data to route around

Before blaming your fixture, check the project's list of known bad reference data (in the knowledge
file) — e.g. catalogue entries missing a configuration the import depends on.

If a row fails on one of these, it is a data finding to report, not a fixture to fix.

## Checklist before you run the upload

- [ ] Headers copied verbatim from a named sample file, with the date recorded in a doc comment
- [ ] Sheet name matches what the request sends
- [ ] Row values exist and are active in the tenant under test
- [ ] Blank cells written as `null`
- [ ] The workbook is built in memory — nothing reads the sample-workbook folder at run time
- [ ] Cross-field clusters resolved from live API data, not assembled by hand
