import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeInstall, installSkills } from '../packages/cli/src/skills.js';

/** The skill installer lives in `@qakit/cli` (`qakit skills install`); this keeps the script entry point. */
export { installSkills, describeInstall, STAMP_FILE, KIT_ROOT, type InstallSkillsOptions, type InstalledSkill } from '../packages/cli/src/skills.js';

function main(argv: string[]): void {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const configPath = value('--config');
  const targetDir = value('--target');
  if (!configPath || !targetDir) {
    console.error('usage: tsx scripts/install-skills.ts --config <qakit.config.yaml> --target <.claude/skills> [--only a,b] [--force]');
    process.exitCode = 1;
    return;
  }
  const results = installSkills({
    configPath: path.resolve(configPath),
    targetDir: path.resolve(targetDir),
    only: value('--only')?.split(',').filter(Boolean),
    force: argv.includes('--force'),
  });
  for (const line of describeInstall(results)) console.log(line);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
