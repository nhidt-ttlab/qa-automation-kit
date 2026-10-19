import { Chip, TableCell, Tooltip } from '@mui/material';

/**
 * The checklist-snapshot cells and the checkpoint label shared by `UiCheckpointsTable` and
 * `RunChecksTable`.
 *
 * Kept in one place because those two tables render the same rows for different run types — a UI
 * run with synced evidence goes to the first, everything else to the second — and a reviewer
 * comparing them must not find the checklist presented two different ways.
 *
 * **What the checklist fields are.** The CSV testcase id, business rule, expected text and priority
 * are a snapshot of the hardening-checklist row an assertion answers, frozen when the run executed. They describe
 * the sheet's *invented* test data, so they deliberately do not match the `Expected`/`Actual`
 * columns beside them, which hold what this run actually measured. Nothing here feeds the
 * pass/fail icon.
 *
 * **How the row divides.** The snapshot keeps columns of its own: priority leads, because it is
 * what a reviewer triages by, and the sheet row id plus its rule follow in one `Business Rule`
 * cell. `Checkpoint` is then left to state the harness's own identity — the assertion id and the
 * name the runner gave it — so the two vocabularies sit side by side instead of one overwriting
 * the other.
 */

/** An assertion that answers no checklist row — most of them — reads as an em dash. */
const NONE = '—';

/**
 * Priority is an open vocabulary: `P1`…`P3` are what the sheets use today, but a new label is a
 * routine edit to a spreadsheet and must not render as a crash or a blank. Anything unrecognised
 * falls through to the neutral chip rather than being dropped.
 */
const PRIORITY_COLOR: Record<string, 'error' | 'warning' | 'info'> = {
  P1: 'error',
  P2: 'warning',
  P3: 'info',
};

export interface CheckpointLabelFields {
  name: string;
  /** Assertion id, e.g. `TC-CHVT-U19 / A1`. Also the key UI evidence links a screenshot by. */
  test_id?: string;
  csv_checklist_id?: string;
  csv_testcase_id?: string;
  csv_business_rule?: string;
  csv_expected?: string;
  csv_priority?: string;
}

/**
 * What the `Business Rule` cell says, in preference order.
 *
 * The sheet's `Business Rule / Checklist` cell first: it states the rule the row exists to check,
 * in the spec's own words, which is what a reviewer scanning a run needs. `Expected Result` is the
 * fallback because it describes one invented data set rather than the rule — useful, but a rung
 * more specific than the question "what does this row check?".
 *
 * Runs imported before the business-rule column existed have none stored even where their sheet
 * has the column, so the fallback is a live path rather than a defensive one. `undefined` when the
 * assertion answers no checklist row at all; the harness `name` is no longer a rung here, because
 * it has the `Checkpoint` column to itself.
 */
function ruleText(check: CheckpointLabelFields): string | undefined {
  return check.csv_business_rule ?? check.csv_expected;
}

/**
 * The separator `flattenCsvMeta` (core `checklist/flatten.ts`) joins every snapshot column with
 * when one assertion answers several checklist rows. Not imported: the web app does not depend on
 * the core package.
 */
const CSV_COLUMN_JOIN = ' | ';

/**
 * The single priority to show for an assertion: the highest among the rows it answers.
 *
 * `P1 | P3` is stored so the positions line up with the other joined columns, but a reviewer
 * triages by the most severe row — an assertion that answers one P1 row is a P1 checkpoint. `Pn`
 * ranks by `n`; a label outside that pattern still shows when no `Pn` label is present, and a row
 * with no priority (the em dash placeholder) never wins over one that has one.
 */
function highestPriority(joined: string | undefined): string | undefined {
  const labels = (joined ?? '')
    .split(CSV_COLUMN_JOIN)
    .map((label) => label.trim())
    .filter((label) => label && label !== NONE);
  const rank = (label: string) => {
    const match = /^P(\d+)$/i.exec(label);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
  };
  return labels.reduce<string | undefined>(
    (best, label) => (best === undefined || rank(label) < rank(best) ? label : best),
    undefined,
  );
}

/**
 * The leading column: what a QA reviewer sorts and triages by, so it is read before the assertion
 * it applies to rather than hunted for at the end of a wide row. Shows only the highest priority;
 * the full joined list stays in the tooltip.
 */
export function CheckpointPriorityCell({ check }: { check: CheckpointLabelFields }) {
  const priority = highestPriority(check.csv_priority);
  return (
    <TableCell align="center">
      {priority ? (
        <Chip
          label={priority}
          size="small"
          color={PRIORITY_COLOR[priority.toUpperCase()] ?? 'default'}
          variant="outlined"
          title={check.csv_priority !== priority ? check.csv_priority : undefined}
        />
      ) : (
        <span className="text-xs text-gray-400">{NONE}</span>
      )}
    </TableCell>
  );
}

/**
 * Renders `TC_02  <business rule>` — the checklist row an assertion answers, then the rule that row
 * exists to check; see {@link ruleText} for the fallback.
 *
 * The text is clamped to four lines; hovering shows the full rule.
 *
 * The sheet id stays in the tooltip rather than the line: `TC_02` exists in 28 different
 * checklists, so the row id is only unambiguous next to its sheet id, and a reviewer who needs
 * that pair is reading one row, not scanning the column.
 */
export function ChecklistRuleCell({ check }: { check: CheckpointLabelFields }) {
  const text = ruleText(check);

  if (!text && !check.csv_testcase_id) {
    return (
      <TableCell className="min-w-[320px]">
        <span className="text-xs text-gray-400">{NONE}</span>
      </TableCell>
    );
  }

  // Inline, not flex: the id and the sentence are one line of prose that should wrap like one.
  // A flex row pins the id to its own column and squeezes the sentence into whatever is left,
  // which on a narrow table turns a one-line label into a ten-line ribbon.
  //
  // Clamped to four lines: some sheet rules run to a paragraph, and one of them would otherwise
  // stretch its row past the screen. The tooltip carries the whole rule plus the sheet id.
  return (
    <TableCell className="min-w-[320px]">
      <Tooltip
        placement="bottom-start"
        slotProps={{ tooltip: { sx: { maxWidth: 480, whiteSpace: 'pre-line' } } }}
        title={
          <>
            {check.csv_checklist_id && (
              <span className="mb-1 block font-mono opacity-75">
                {check.csv_checklist_id}
                {check.csv_testcase_id && ` / ${check.csv_testcase_id}`}
              </span>
            )}
            {text ?? NONE}
          </>
        }
      >
        <span className="line-clamp-4">
          {check.csv_testcase_id && (
            <span className="mr-2 font-mono text-xs text-gray-500">{check.csv_testcase_id}</span>
          )}
          {text}
        </span>
      </Tooltip>
    </TableCell>
  );
}

/**
 * Renders `TC-CHVT-U19 / A1  <name>` — the assertion id and the name the harness gave it, which is
 * what identifies the checkpoint independently of any sheet it happens to answer.
 */
export function CheckpointLabel({ check }: { check: CheckpointLabelFields }) {
  return (
    <span>
      {check.test_id && (
        <span className="mr-2 font-mono text-xs text-gray-500">{check.test_id}</span>
      )}
      {check.name}
    </span>
  );
}
