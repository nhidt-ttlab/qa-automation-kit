/**
 * Parser for the runner's `--list` output, which is how this API learns what a selector resolves
 * to without executing anything.
 *
 * The format is fixed-width, written by `pad()` in run-suite.ts:
 *
 *   TC-DH-L01        api  don-hang                     po-list-keyword-search
 *   <blank>
 *   2 scenario(s) selected  [TC-DH-L01-TC-DH-L02]
 *   <blank>
 *   module tokens: boq, boq-acceptance, ...
 *
 * None of the four columns can contain a space (they are ids, an enum, a slug and a scenario
 * key), so splitting on runs of whitespace is safe and does not depend on the exact padding —
 * which matters, because the padding widths are presentation and could change.
 */
import type { RegressionScenarioDto, RegressionSuiteKind } from '@qakit/reporting-shared';

export interface ParsedListOutput {
  /**
   * Read off the runner's own summary line rather than counted from the rows.
   *
   * They should agree, but the summary line is authoritative: it is what the runner will actually
   * execute, and a row this parser failed to recognise must not silently shrink the count a user
   * is about to confirm.
   */
  total: number;
  items: RegressionScenarioDto[];
  label: string;
  /** From the trailing `module tokens:` line, present only when no --module was given. */
  moduleTokens: string[];
}

const ROW = /^(\S+)\s+(api|ui)\s+(\S+)\s+(\S+)\s*$/;
const SUMMARY = /^(\d+)\s+scenario\(s\)\s+selected\s+\[(.*)\]\s*$/;
const MODULE_TOKENS = /^module tokens:\s*(.*)$/;

export function parseListOutput(stdout: string): ParsedListOutput {
  const items: RegressionScenarioDto[] = [];
  let total: number | undefined;
  let label = '';
  let moduleTokens: string[] = [];

  // Tolerates CRLF and a lone CR: this text arrives from a child process on Windows.
  for (const rawLine of stdout.split(/\r\n|\n|\r/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const summary = SUMMARY.exec(line.trim());
    if (summary) {
      total = Number(summary[1]);
      label = summary[2];
      continue;
    }

    const tokens = MODULE_TOKENS.exec(line.trim());
    if (tokens) {
      moduleTokens = tokens[1]
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      continue;
    }

    const row = ROW.exec(line);
    if (row) {
      items.push({
        test_case_id: row[1],
        kind: row[2] as RegressionSuiteKind,
        domain: row[3],
        scenario: row[4],
      });
    }
    // Anything else is npm's own preamble ("> demo-runner@0.1.0 suite:list") or a
    // logger line, and is ignored rather than treated as an error.
  }

  return { total: total ?? items.length, items, label, moduleTokens };
}
