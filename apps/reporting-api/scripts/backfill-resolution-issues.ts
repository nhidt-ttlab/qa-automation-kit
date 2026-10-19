/**
 * First-time historical backfill of the Resolution Queue.
 *
 *   pnpm db:backfill-resolution -- --dry-run     # report only, writes nothing
 *   pnpm db:backfill-resolution                  # apply
 *
 * Run `pnpm db:sync` first. This script reads **PostgreSQL only** — it never opens the runner's
 * SQLite file, which is what guarantees the queue cannot write back into the runner's evidence.
 * It also never reads the checklist Markdown: the blocker codes it groups on are parsed out of
 * the evidence the runner actually persisted, so a doc that drifts cannot silently re-key issues.
 *
 * It shares one extraction and projection service with the incremental `db:sync` path
 * (src/modules/resolution/), so the two cannot disagree about what an issue is.
 *
 * Safe to interrupt and rerun: issues are keyed on a unique `import_key`, observations on a
 * unique `(issue, run, observation_key)`, and occurrence statistics are recomputed from the
 * observations rather than incremented. A second run creates nothing and changes nothing.
 *
 * Flags:
 *   --dry-run          compute and report; opens no transaction and performs no write
 *   --batch-size=N     runs per transaction (default 25, matching db:sync)
 *   --limit=N          only the N oldest candidate runs — for a quick smoke test
 *   --samples=N        how many representative samples to print (default 5)
 */
import '../src/common/load-reporting-env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  ResolutionProjectionService,
  formatProjectionReport,
} from '../src/modules/resolution/resolution-projection.service';
import { ResolutionWorkflowService } from '../src/modules/resolution/resolution-workflow.service';
import type { PrismaService } from '../src/prisma.service';

const CANDIDATE_RESULTS = ['BLOCKED', 'PARTIAL', 'ERROR'];

function numericFlag(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number.parseInt(raw.slice(name.length + 3), 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  const dryRun = process.argv.includes('--dry-run');
  const batchSize = numericFlag('batch-size', 25);
  const sampleLimit = numericFlag('samples', 5);
  const limit = process.argv.some((a) => a.startsWith('--limit=')) ? numericFlag('limit', 0) : undefined;

  console.log(`Target (Postgres): ${connectionString.replace(/:[^:@/]*@/, ':***@')}`);
  console.log(`Mode:              ${dryRun ? 'DRY RUN — no writes' : 'APPLY'}`);
  if (limit) console.log(`Limit:             ${limit} oldest candidate runs`);
  console.log('');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const totalRuns = await prisma.testRun.count();
    if (totalRuns === 0) {
      console.warn(
        'No test runs in Postgres. Run `pnpm db:sync` first — this backfill reads the ' +
          'synchronized evidence, not the runner SQLite file.\n',
      );
      return;
    }

    let runIds: string[] | undefined;
    if (limit) {
      const rows = await prisma.testRun.findMany({
        where: { result: { in: CANDIDATE_RESULTS } },
        select: { id: true },
        orderBy: { startedAt: 'asc' },
        take: limit,
      });
      runIds = rows.map((r) => r.id);
    }

    const before = dryRun
      ? {
          issues: await prisma.resolutionIssue.count(),
          observations: await prisma.resolutionObservation.count(),
          events: await prisma.resolutionEvent.count(),
        }
      : null;

    const projection = new ResolutionProjectionService(
      prisma as unknown as PrismaService,
      new ResolutionWorkflowService(prisma as unknown as PrismaService),
    );

    const startedAt = Date.now();
    const report = await projection.projectRuns({
      runIds,
      batchSize,
      dryRun,
      sampleLimit,
      onProgress: (message) => process.stdout.write(`\r${message}   `),
    });
    process.stdout.write('\r');

    console.log(formatProjectionReport(report));
    console.log(`\nElapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

    if (before) {
      // A dry run that wrote something would be a bug worth failing on, not a warning to skim.
      const after = {
        issues: await prisma.resolutionIssue.count(),
        observations: await prisma.resolutionObservation.count(),
        events: await prisma.resolutionEvent.count(),
      };
      const unchanged =
        before.issues === after.issues &&
        before.observations === after.observations &&
        before.events === after.events;
      console.log(
        `\nDry-run write check: issues ${before.issues} -> ${after.issues}, ` +
          `observations ${before.observations} -> ${after.observations}, ` +
          `events ${before.events} -> ${after.events}`,
      );
      if (!unchanged) {
        throw new Error('Dry run modified the database. This is a bug; nothing should have been written.');
      }
      console.log('Dry run wrote nothing, as expected.');
    } else {
      const [issues, observations] = await Promise.all([
        prisma.resolutionIssue.count(),
        prisma.resolutionObservation.count(),
      ]);
      console.log(`\nResolution Queue now holds ${issues} issues and ${observations} observations.`);
    }

    console.log('\nBackfill complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\nBackfill failed:', err);
  process.exit(1);
});
