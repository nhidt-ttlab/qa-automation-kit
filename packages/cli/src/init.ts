import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { KIT_ROOT } from './skills.js';

export interface InitOptions {
  targetDir: string;
  /** Kebab-case project id. */
  project: string;
  locale?: string;
  force?: boolean;
  kitRoot?: string;
}

export interface InitResult {
  written: string[];
  skipped: string[];
}

const TEXT_EXTENSIONS = new Set(['.ts', '.json', '.yaml', '.yml', '.md', '.snippet', '.example', '']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full).map((f) => path.join(name, f)) : [name];
  });
}

/** `demo-shop` -> `DEMO_SHOP`, the prefix of the project's environment variables. */
export function envPrefixOf(project: string): string {
  return project.toUpperCase().replace(/-/g, '_');
}

/**
 * Writes the kit's `project-template/` into `targetDir`: `{{project}}`, `{{locale}}`, `{{kitDir}}` (the
 * kit's path relative to the target) and `{{PROJECT_ENV}}` are substituted; `_gitignore` becomes
 * `.gitignore`. Existing files are kept unless `force`.
 */
export function initProject(options: InitOptions): InitResult {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(options.project)) throw new Error(`Project id "${options.project}" must be kebab-case (a-z, 0-9, hyphen).`);
  const locale = options.locale ?? 'en';
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) throw new Error(`Locale "${locale}" must be a language tag such as en or vi.`);

  const kitRoot = options.kitRoot ?? KIT_ROOT;
  const templateRoot = path.join(kitRoot, 'project-template');
  const targetDir = path.resolve(options.targetDir);
  const kitDir = path.relative(targetDir, kitRoot).split(path.sep).join('/') || '.';
  const tokens: Record<string, string> = {
    '{{project}}': options.project,
    '{{locale}}': locale,
    '{{kitDir}}': kitDir,
    '{{PROJECT_ENV}}': envPrefixOf(options.project),
  };

  const result: InitResult = { written: [], skipped: [] };
  for (const rel of walk(templateRoot).sort()) {
    const destRel = rel.replace(/(^|[\\/])_gitignore$/, '$1.gitignore');
    const dest = path.join(targetDir, destRel);
    if (existsSync(dest) && !options.force) {
      result.skipped.push(destRel);
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    const source = path.join(templateRoot, rel);
    if (TEXT_EXTENSIONS.has(path.extname(rel))) {
      let content = readFileSync(source, 'utf8');
      for (const [token, value] of Object.entries(tokens)) content = content.split(token).join(value);
      writeFileSync(dest, content, 'utf8');
    } else {
      copyFileSync(source, dest);
    }
    result.written.push(destRel);
  }
  return result;
}
