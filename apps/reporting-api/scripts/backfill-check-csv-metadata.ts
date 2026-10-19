/**
 * Backfills the hardening-checklist snapshot onto historical check rows.
 *
 *   pnpm db:backfill-csv-metadata -- --dry-run     # report only, writes nothing
 *   pnpm db:backfill-csv-metadata                  # apply
 *
 * **Why a separate script rather than a smarter `db:sync`.** `db:sync` inserts only runs that are
 * missing (`sqlite-sync.ts`, pass 2), so every run imported before these columns existed is invisible
 * to it forever. Widening that pass to update existing rows would make a re-sync able to rewrite
 * history, which is exactly what the snapshot design forbids.
 *
 * **What counts as an establishable mapping.** Only two things, neither of them a guess:
 *
 *   1. The historical `test_id` itself. Before this feature, the trace appended the row to the
 *      assertion id — `TC-CHVT-U16 / A1 / TC_16`. That third segment is the mapping *as it was
 *      actually recorded at run time*, not a reconstruction of what it probably was.
 *   2. The scenario's declared sheet, exported by the runner in `checklist-rows.generated.json`.
 *      A scenario citing no sheet, or two, is left alone.
 *
 * Anything else is reported as unresolved. A check whose row id no longer exists in the sheet is
 * reported too, never approximated to a neighbouring row.
 *
 * **The limitation, stated plainly.** The text written here is read from the CSV *as it is today*.
 * That is not necessarily the wording the historical run was judged alongside, and nothing in the
 * schema records the difference — the `csv_source_sha256` column that would have detected it was
 * cut from the design. The run log below therefore prints the date and the sheet sha256s it used,
 * so the provenance lives somewhere even though it is not in a column.
 *
 * Safe to interrupt and rerun: a row is written only when all four columns are still NULL, so a
 * second pass writes nothing and changes nothing. It never deletes a run, a review or a resolution
 * issue, and it touches no column other than the four.
 *
 * Flags:
 *   --dry-run          compute and report; opens no transaction and performs no write
 *   --batch-size=N     checks per transaction (default 500)
 *   --limit=N          only the N oldest candidate runs — for a quick smoke test
 *   --samples=N        how many representative samples to print (default 5)
 *   --runner=PATH      the regression runner package (default: REGRESSION_RUNNER_PATH)
 */
import '../src/common/load-reporting-env';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { resolveArtifactStorageRoot } from '../src/modules/runs/artifact-storage.util';
import { testcaseIdFromTestId } from '../src/modules/sync/checklist-backfill.util';

interface ChecklistExport {
  sources: Array<{ checklistId: string; csvFile: string; sha256: string; rowCount: number }>;
  scenarioChecklists: Record<string, string>;
  ambiguous: string[];
  rows: Array<{
    checklistId: string;
    testcaseId: string;
    csvFile: string;
    csvLine: number;
    expected: string;
    businessRule?: string;
    priority?: string;
  }>;
}

function numericFlag(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number.parseInt(raw.slice(name.length + 3), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringFlag(name: string): string | undefined {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : undefined;
}

function loadExport(runnerPath: string): ChecklistExport {
  const file = path.join(runnerPath, 'src', 'harness', 'checklist', 'checklist-rows.generated.json');
  if (!fs.existsSync(file)) {
    throw new Error(
      `No checklist export at ${file}. Run \`npm run checklist:import\` in the regression runner ` +
        'first, or pass --runner=<path>.',
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ChecklistExport;
  if (!Array.isArray(parsed.rows)) throw new Error(`${file} has no "rows" array.`);
  return parsed;
}


type Unresolved = { runId: string; scenarioKey: string; testId: string; reason: string };

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  const dryRun = process.argv.includes('--dry-run');
  const batchSize = numericFlag('batch-size', 500);
  const limit = process.argv.some((a) => a.startsWith('--limit=')) ? numericFlag('limit', 0) : undefined;
  const sampleCount = numericFlag('samples', 5);
  const runnerPath = stringFlag('runner') ?? resolveArtifactStorageRoot();

  const startedAt = Date.now();
  const data = loadExport(runnerPath);
  const rowIndex = new Map(data.rows.map((r) => [`${r.checklistId}::${r.testcaseId}`, r]));
  const ambiguous = new Set(data.ambiguous);

  console.log(`Source (runner):   ${runnerPath}`);
  console.log(`Target (Postgres): ${connectionString.replace(/:[^:@/]*@/, ':***@')}`);
  console.log(`Mode:              ${dryRun ? 'DRY RUN — no writes' : 'APPLY'}`);
  if (limit) console.log(`Limit:             ${limit} oldest candidate runs`);
  console.log(`Backfilled on:     ${new Date().toISOString()}`);
  console.log('Sheets read (text is as of TODAY, not necessarily as of each run):');
  for (const s of data.sources) console.log(`  ${s.checklistId.padEnd(14)} ${s.sha256.slice(0, 12)}  ${s.csvFile}`);
  console.log('');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const unresolved: Unresolved[] = [];
  const samples: string[] = [];
  let candidates = 0;
  let resolved = 0;
  let written = 0;

  try {
    const runs = await prisma.testRun.findMany({
      where: { checks: { some: { csvTestcaseId: null } } },
      select: { id: true, scenarioKey: true },
      orderBy: { startedAt: 'asc' },
      ...(limit ? { take: limit } : {}),
    });
    console.log(`Candidate runs:    ${runs.length}`);

    let pending: Array<{ id: number; data: Record<string, string | null> }> = [];
    const flush = async (): Promise<void> => {
      if (dryRun || pending.length === 0) {
        pending = [];
        return;
      }
      await prisma.$transaction(
        pending.map((u) => prisma.testRunCheck.update({ where: { id: u.id }, data: u.data })),
      );
      written += pending.length;
      pending = [];
    };

    for (const run of runs) {
      const sheet = data.scenarioChecklists[run.scenarioKey];
      const checks = await prisma.testRunCheck.findMany({
        // Only rows that are still entirely unfilled. This is the idempotency guarantee, and it is
        // also what stops a rerun from overwriting a snapshot a real run wrote.
        where: {
          runId: run.id,
          csvChecklistId: null,
          csvTestcaseId: null,
          csvExpected: null,
          csvBusinessRule: null,
          csvPriority: null,
        },
        select: { id: true, testId: true },
      });

      for (const check of checks) {
        const testcaseId = testcaseIdFromTestId(check.testId);
        if (!testcaseId) continue; // Carries no recorded mapping; not a candidate at all.
        candidates += 1;

        if (!sheet) {
          unresolved.push({
            runId: run.id,
            scenarioKey: run.scenarioKey,
            testId: check.testId ?? '',
            reason: 'scenario declares no single checklistId',
          });
          continue;
        }
        if (ambiguous.has(`${sheet}::${testcaseId}`)) {
          unresolved.push({
            runId: run.id,
            scenarioKey: run.scenarioKey,
            testId: check.testId ?? '',
            reason: `${testcaseId} is reused in ${sheet} and identifies no single row`,
          });
          continue;
        }
        const row = rowIndex.get(`${sheet}::${testcaseId}`);
        if (!row) {
          unresolved.push({
            runId: run.id,
            scenarioKey: run.scenarioKey,
            testId: check.testId ?? '',
            reason: `${testcaseId} not found in ${sheet} as it stands today`,
          });
          continue;
        }

        resolved += 1;
        if (samples.length < sampleCount) {
          samples.push(
            `  ${run.scenarioKey} ${check.testId} -> ${row.checklistId}/${row.testcaseId} ` +
              `[${row.priority ?? '—'}] ${row.expected.slice(0, 60)}${row.expected.length > 60 ? '…' : ''}`,
          );
        }
        pending.push({
          id: check.id,
          data: {
            csvChecklistId: row.checklistId,
            csvTestcaseId: row.testcaseId,
            csvExpected: row.expected,
            csvBusinessRule: row.businessRule ?? null,
            csvPriority: row.priority ?? null,
          },
        });
        if (pending.length >= batchSize) await flush();
      }
    }
    await flush();

    console.log(`\nChecks carrying a recorded mapping: ${candidates}`);
    console.log(`Resolved to a sheet row:            ${resolved}`);
    console.log(`Unresolved (left untouched):        ${unresolved.length}`);
    console.log(`Rows written:                       ${written}${dryRun ? ' (dry run)' : ''}`);

    if (samples.length) {
      console.log('\nSamples:');
      for (const s of samples) console.log(s);
    }

    if (unresolved.length) {
      const byReason = new Map<string, number>();
      for (const u of unresolved) byReason.set(u.reason, (byReason.get(u.reason) ?? 0) + 1);
      console.log('\nUnresolved mappings — reported, never guessed:');
      for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(count).padStart(5)}  ${reason}`);
      }
      for (const u of unresolved.slice(0, sampleCount)) {
        console.log(`    e.g. run ${u.runId} ${u.scenarioKey} "${u.testId}"`);
      }
    }

    if (dryRun) {
      // A dry run that wrote something would be a bug worth failing on, not a warning to skim.
      if (written !== 0) throw new Error(`Dry run wrote ${written} rows — refusing to report success.`);
      console.log('\nDry run wrote nothing, as expected.');
    } else {
      console.log('\nBackfill complete.');
    }
    console.log(`Elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked as a script, so the pure helpers above stay unit-testable.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
