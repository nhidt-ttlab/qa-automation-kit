/**
 * CSV export of Resolution Queue issues, for taking answers back into the spec documents and
 * testcases they came from.
 *
 *   pnpm db:export-resolution -- --status=VERIFIED --out=./resolved.csv
 *   pnpm db:export-resolution -- --domain=kiem-soat-dat-hang-thua --kind=SPEC_DECISION
 *
 * The same rows the UI's "Export CSV" button produces — both go through
 * `ResolutionService.exportIssuesCsv`, so a column cannot mean two different things depending on
 * how you exported. This entry point exists for scripted and scheduled use, where clicking a
 * button is not an option.
 *
 * Reads PostgreSQL only. Like everything else in this feature it never opens the runner's SQLite
 * file.
 *
 * Flags (all optional; they mirror the list endpoint's filters):
 *   --out=PATH             write here instead of stdout
 *   --status=STATUS        workflow_status
 *   --kind=KIND            kind
 *   --owner=NAME           owner
 *   --priority=LEVEL       priority
 *   --module=MODULE        suite folder
 *   --domain=DOMAIN        documentation module
 *   --scenario-key=KEY     scenario the issue was observed in
 *   --test-case-id=ID      test case the issue was observed in
 *   --observed-result=R    NOT_EVALUATED | BLOCKED | PARTIAL | ERROR
 *   --q=TEXT               free text over key, title and both summaries
 *   --last-seen-from=DATE  ISO date; issues seen on or after it
 */
import '../src/common/load-reporting-env';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { ResolutionService } from '../src/modules/resolution/resolution.service';
import { ResolutionWorkflowService } from '../src/modules/resolution/resolution-workflow.service';
import type { PrismaService } from '../src/prisma.service';
import type { ListResolutionIssuesQueryDto } from '@qakit/reporting-shared';

/** `--name=value` -> value. Absent flags stay undefined so they are omitted from the filter. */
function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function buildQuery(): Partial<ListResolutionIssuesQueryDto> {
  const query: Record<string, unknown> = {
    q: flag('q'),
    workflow_status: flag('status'),
    kind: flag('kind'),
    owner: flag('owner'),
    priority: flag('priority'),
    module: flag('module'),
    domain: flag('domain'),
    scenario_key: flag('scenario-key'),
    test_case_id: flag('test-case-id'),
    observed_result: flag('observed-result'),
    last_seen_from: flag('last-seen-from'),
  };
  for (const key of Object.keys(query)) {
    if (query[key] === undefined) delete query[key];
  }
  return query as Partial<ListResolutionIssuesQueryDto>;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  const query = buildQuery();
  const out = flag('out');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const service = new ResolutionService(
      prisma as unknown as PrismaService,
      new ResolutionWorkflowService(prisma as unknown as PrismaService),
    );

    const { filename, csv } = await service.exportIssuesCsv(
      query as ListResolutionIssuesQueryDto,
    );

    if (!out) {
      // Straight to stdout so the export can be piped. Progress chatter goes to stderr, or it
      // would end up inside the CSV.
      process.stdout.write(csv);
      return;
    }

    const target = path.resolve(process.cwd(), out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, csv, 'utf8');

    // Header line plus one row per affected test case, so the row count is not the issue count.
    const rows = Math.max(csv.split('\r\n').filter(Boolean).length - 1, 0);
    console.error(`Filters: ${JSON.stringify(query)}`);
    console.error(`Wrote ${rows} row(s) to ${target}`);
    console.error(`Suggested name: ${filename}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\nExport failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
