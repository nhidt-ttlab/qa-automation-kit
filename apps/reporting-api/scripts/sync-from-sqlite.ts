/**
 * CLI wrapper around the SQLite -> Postgres import.
 *
 *   pnpm --filter @qakit/reporting-api run db:sync   (or `pnpm db:sync` from the workspace root)
 *   pnpm db:sync -- --repair-resolution              (re-project the full history)
 *
 * All the work lives in src/modules/sync/sqlite-sync.ts, which is also what the reporting API's
 * regression-jobs module calls in-process after a batch. This file owns only the things a script
 * may own and a service may not: reading the environment, constructing a PrismaClient it will
 * close again, parsing argv, printing, and setting an exit code.
 */
import '../src/common/load-reporting-env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  resolveArtifactStorageRoot,
  resolveRegressionSqlitePath,
} from '../src/modules/runs/artifact-storage.util';
import { resolveEvidenceStorageRoot } from '../src/modules/runs/evidence-storage.util';
import { ResolutionProjectionService } from '../src/modules/resolution/resolution-projection.service';
import { ResolutionWorkflowService } from '../src/modules/resolution/resolution-workflow.service';
import type { PrismaService } from '../src/prisma.service';
import { syncFromSqlite } from '../src/modules/sync/sqlite-sync';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  console.log(
    `Target (Postgres): ${connectionString.replace(/:[^:@/]*@/, ':***@')}\n`,
  );

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  // Outside Nest there is no container to ask, so the two services are wired by hand. The casts
  // are the long-standing shape here: PrismaService extends PrismaClient and adds only lifecycle
  // hooks, none of which the projection touches.
  const projection = new ResolutionProjectionService(
    prisma as unknown as PrismaService,
    new ResolutionWorkflowService(prisma as unknown as PrismaService),
  );

  try {
    await syncFromSqlite({
      prisma,
      projection,
      sqlitePath: resolveRegressionSqlitePath(),
      runnerRoot: resolveArtifactStorageRoot(),
      evidenceRoot: resolveEvidenceStorageRoot(),
      repairResolution: process.argv.includes('--repair-resolution'),
      onProgress: (message) => console.log(message),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\nSync failed:', err);
  process.exit(1);
});
