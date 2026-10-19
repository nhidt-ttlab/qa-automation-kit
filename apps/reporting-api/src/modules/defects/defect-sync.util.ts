/**
 * Which columns of a `defect_signatures` row `db:sync` may write, and when.
 *
 * The runner recomputes a signature's diagnostic fields on every non-PASS run and always writes
 * `status = 'draft'` — it has no concept of triage. Importing the whole SQLite record on update
 * therefore silently reset any status this API had moved to `submitted` or `resolved`: a QA lead's
 * triage would survive until the next `db:sync` and then vanish with no trace. Status is
 * reporting-owned from the moment the row exists here.
 *
 * Split out of the sync script so the ownership boundary is a unit-testable value rather than an
 * object literal that is easy to "tidy up" back into a single `data` shared by create and update.
 */

/** The shape the sync reads out of SQLite. Mirrors `defect_signatures` in the runner schema. */
export interface SqliteDefectSignatureRow {
  signature_hash: string;
  scenario_key: string;
  title: string;
  severity: string | null;
  probable_failing_rule: string | null;
  suspected_component: string | null;
  regression_note: string | null;
  status: string;
  first_observed_run_id: string | null;
  last_observed_run_id: string | null;
}

export interface RunnerOwnedDefectFields {
  title: string;
  severity: string | null;
  probableFailingRule: string | null;
  suspectedComponent: string | null;
  regressionNote: string | null;
}

/**
 * Diagnostics the runner recomputes from the latest observation. Safe to refresh on every sync —
 * this API never edits them, and a fresher failing rule is strictly more useful.
 */
export function runnerOwnedDefectFields(
  row: SqliteDefectSignatureRow,
): RunnerOwnedDefectFields {
  return {
    title: row.title,
    severity: row.severity,
    probableFailingRule: row.probable_failing_rule,
    suspectedComponent: row.suspected_component,
    regressionNote: row.regression_note,
  };
}

/**
 * Everything a brand new row needs, including the values this API will own from then on.
 *
 * `first/last_observed_run_id` are seeded here and then left to
 * `trg_defect_observations_touch_signature`, which maintains them from this database's own
 * observations by `started_at` chronology. Re-copying them on every sync would overwrite the
 * trigger's answer with a stale one whenever the runner has purged a run Postgres still holds —
 * and `--clean` does purge runs.
 */
export function initialDefectFields(
  row: SqliteDefectSignatureRow,
): RunnerOwnedDefectFields & {
  signatureHash: string;
  scenarioKey: string;
  status: string;
  firstObservedRunId: string | null;
  lastObservedRunId: string | null;
} {
  return {
    ...runnerOwnedDefectFields(row),
    signatureHash: row.signature_hash,
    scenarioKey: row.scenario_key,
    status: row.status,
    firstObservedRunId: row.first_observed_run_id,
    lastObservedRunId: row.last_observed_run_id,
  };
}
