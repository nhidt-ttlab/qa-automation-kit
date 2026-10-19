import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectConfig } from '@qakit/core';

/**
 * Installs the kit's QA skills into a project's skills folder (e.g. `.claude/skills`):
 *
 * 1. copies `skills/<skill>/` (without `skill.json`),
 * 2. overlays `packages/locale-<lang>/skills/<skill>/` when the project's locale has one,
 * 3. copies each template named in `skill.json` into `templates/` — the locale's version from
 *    `packages/locale-<lang>/doc-templates/` when it exists, else `doc-templates/`,
 * 4. renames the skill when `extensions.skillNames` maps it (e.g. `{ api-mcp: shop-api }`),
 * 5. stamps `.qakit-skill.json`, so a later install can tell its own copies from hand-written skills.
 *
 * A destination skill without a stamp is left alone unless `force` is set.
 */

/** The kit checkout this module belongs to (`packages/cli/{src,dist}` -> kit root). */
export const KIT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface InstallSkillsOptions {
  configPath: string;
  targetDir: string;
  only?: string[];
  force?: boolean;
  kitRoot?: string;
}

export interface InstalledSkill {
  skill: string;
  installedAs: string;
  status: 'installed' | 'replaced' | 'skipped-unstamped';
  templates: string[];
  localeOverlay: boolean;
}

export const STAMP_FILE = '.qakit-skill.json';

export function kitVersion(kitRoot: string = KIT_ROOT): string {
  return (JSON.parse(readFileSync(path.join(kitRoot, 'package.json'), 'utf8')) as { version: string }).version;
}

export function installSkills(options: InstallSkillsOptions): InstalledSkill[] {
  const kitRoot = options.kitRoot ?? KIT_ROOT;
  const { config } = loadProjectConfig({ configPath: options.configPath, env: {} });
  const language = config.locale.split('-')[0]!;
  const names = (config.extensions.skillNames ?? {}) as Record<string, string>;
  const version = kitVersion(kitRoot);

  const skillsRoot = path.join(kitRoot, 'skills');
  const available = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const unknown = (options.only ?? []).filter((s) => !available.includes(s));
  if (unknown.length > 0) throw new Error(`Unknown skill(s): ${unknown.join(', ')}. Available: ${available.join(', ')}`);

  const results: InstalledSkill[] = [];
  for (const skill of options.only ?? available) {
    const installedAs = names[skill] ?? skill;
    const dest = path.join(options.targetDir, installedAs);
    const stamped = existsSync(path.join(dest, STAMP_FILE));
    if (existsSync(dest) && !stamped && !options.force) {
      results.push({ skill, installedAs, status: 'skipped-unstamped', templates: [], localeOverlay: false });
      continue;
    }
    const existed = existsSync(dest);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });

    const source = path.join(skillsRoot, skill);
    cpSync(source, dest, { recursive: true, filter: (src) => path.basename(src) !== 'skill.json' && !isBuildLeftover(src) });

    const overlay = path.join(kitRoot, 'packages', `locale-${language}`, 'skills', skill);
    const localeOverlay = language !== 'en' && existsSync(overlay);
    if (localeOverlay) cpSync(overlay, dest, { recursive: true, filter: (src) => !isBuildLeftover(src) });

    const manifestPath = path.join(source, 'skill.json');
    const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { templates?: string[] }) : {};
    const templates = manifest.templates ?? [];
    for (const template of templates) {
      const localized = path.join(kitRoot, 'packages', `locale-${language}`, 'doc-templates', `${template}.md`);
      const english = path.join(kitRoot, 'doc-templates', `${template}.md`);
      const from = language !== 'en' && existsSync(localized) ? localized : english;
      if (!existsSync(from)) throw new Error(`Skill "${skill}" needs template "${template}", which the kit does not have.`);
      mkdirSync(path.join(dest, 'templates'), { recursive: true });
      cpSync(from, path.join(dest, 'templates', `${template}.md`));
    }

    if (installedAs !== skill) {
      const skillMd = path.join(dest, 'SKILL.md');
      writeFileSync(skillMd, readFileSync(skillMd, 'utf8').replace(/^name:\s*.+$/m, `name: ${installedAs}`), 'utf8');
    }

    writeFileSync(
      path.join(dest, STAMP_FILE),
      `${JSON.stringify({ kit: 'qa-automation-kit', version, skill, locale: config.locale, templates, installedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
    results.push({ skill, installedAs, status: existed ? 'replaced' : 'installed', templates, localeOverlay });
  }
  return results;
}

/** Caches left behind by running a skill's scripts in the kit (Python bytecode, OS metadata). */
function isBuildLeftover(src: string): boolean {
  const name = path.basename(src);
  return name === '__pycache__' || name.endsWith('.pyc') || name === '.DS_Store';
}

/** Formats install results, one line per skill. */
export function describeInstall(results: InstalledSkill[]): string[] {
  const lines = results.map(
    (r) =>
      `${r.status.padEnd(18)} ${r.skill}${r.installedAs !== r.skill ? ` -> ${r.installedAs}` : ''}${r.localeOverlay ? ' (+locale)' : ''}` +
      `${r.templates.length ? ` templates: ${r.templates.join(', ')}` : ''}`,
  );
  if (results.some((r) => r.status === 'skipped-unstamped')) {
    lines.push('Skipped skills exist without a kit stamp (hand-written?). Re-run with --force to replace them.');
  }
  return lines;
}
