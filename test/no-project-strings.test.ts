import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';

/**
 * The kit must stay project-neutral: anything naming the first consuming project belongs in that
 * project's config, adapter or knowledge folder. Locale packs and ADRs are the only exceptions —
 * a locale pack carries real UI wording, and an ADR records where the kit came from.
 */
const KIT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const FORBIDDEN = /starlive|cxmapi|dang-nhap|ttl|anybim/i;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', 'generated', 'storage']);
const ALLOWED_PREFIXES = [
  join('packages', 'locale-vi') + sep,
  join('docs', 'adr') + sep,
  // Applied migrations are immutable (Prisma checksums them), and their comments name the project
  // the reporting app was first built for.
  join('apps', 'reporting-api', 'prisma', 'migrations') + sep,
];
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.md', '.html', '.sql']);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (TEXT_EXTENSIONS.has(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

it('no project-specific names leak into the kit', () => {
  const offenders: string[] = [];
  for (const file of walk(KIT_ROOT)) {
    const rel = relative(KIT_ROOT, file);
    if (file === SELF || ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (FORBIDDEN.test(line)) offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(offenders, [], `Move these into the consuming project:\n${offenders.join('\n')}`);
});
