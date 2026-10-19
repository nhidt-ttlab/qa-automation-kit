import path from 'node:path';
import { runApiMcpCli, runApiToolsCli } from '@qakit/mcp-api';
import { runUiMcpCli } from '@qakit/mcp-ui';
import { runSuiteCli } from '@qakit/runner';
import { formatDoctor, runDoctor } from './doctor.js';
import { initProject } from './init.js';
import { describeInstall, installSkills } from './skills.js';

const USAGE = `Usage: qakit <command> [options]

  init <dir> --project <id> [--locale en|vi] [--force]     scaffold a QA project from the kit template
  doctor --config <yaml> [--env <name>] [--offline] [--browser] [--desktop] [--skills <dir>]
                                                          check config, credentials, specs, web and desktop targets
  skills install --config <yaml> --target <dir> [--only a,b] [--force]
                                                          install the QA skills (e.g. into .claude/skills)
  suite --config <yaml> [--env <name>] [--kind api|ui] [--module m] [--testcase id,id] [--grep x] [--list]
        [--bail] [--clean] [--headed] [--ui-slowmo <ms>] [files...]
                                                          run scenarios under paths.suites
  api docgen|domains|field-deps --config <yaml>           API docs and domain files from OpenAPI
  mcp-api --config <yaml>                                 API MCP server (stdio)
  mcp-ui --config <yaml>                                  UI MCP server (stdio)`;

function option(argv: readonly string[], flag: string): string | undefined {
  const index = argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (index === -1) return undefined;
  const arg = argv[index]!;
  if (arg.includes('=')) return arg.slice(arg.indexOf('=') + 1);
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
  return value;
}

const configOf = (argv: readonly string[]): string => path.resolve(option(argv, '--config') ?? process.env.QAKIT_CONFIG ?? 'qakit.config.yaml');

/** The `qakit` command. Resolves to the exit code (the MCP servers keep running instead). */
export async function runQakitCli(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'init': {
      const dir = rest.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--project', '--locale'].includes(rest[i - 1]!)));
      const project = option(rest, '--project');
      if (!dir || !project) throw new Error('Usage: qakit init <dir> --project <id> [--locale en|vi] [--force]');
      const result = initProject({ targetDir: dir, project, locale: option(rest, '--locale'), force: rest.includes('--force') });
      for (const file of result.written) console.log(`wrote   ${file}`);
      for (const file of result.skipped) console.log(`kept    ${file} (exists; --force to overwrite)`);
      console.log(`\nNext: cd ${dir} && npm install && copy .env.example to .env, then run \`npx qakit doctor --config qakit.config.yaml\`.`);
      return 0;
    }
    case 'doctor': {
      const checks = await runDoctor({
        configPath: configOf(rest),
        environment: option(rest, '--env'),
        offline: rest.includes('--offline'),
        browser: rest.includes('--browser'),
        desktop: rest.includes('--desktop'),
        skillsDir: option(rest, '--skills'),
      });
      for (const line of formatDoctor(checks)) console.log(line);
      return checks.some((c) => c.status === 'fail') ? 1 : 0;
    }
    case 'skills': {
      if (rest[0] !== 'install') throw new Error('Usage: qakit skills install --config <yaml> --target <dir> [--only a,b] [--force]');
      const target = option(rest, '--target');
      if (!target) throw new Error('--target is required, e.g. --target .claude/skills');
      const results = installSkills({ configPath: configOf(rest), targetDir: path.resolve(target), only: option(rest, '--only')?.split(',').filter(Boolean), force: rest.includes('--force') });
      for (const line of describeInstall(results)) console.log(line);
      return 0;
    }
    case 'suite':
      return runSuiteCli(rest);
    case 'api':
      return runApiToolsCli(rest);
    case 'mcp-api':
      await runApiMcpCli({ argv: rest });
      return 0;
    case 'mcp-ui':
      await runUiMcpCli({ argv: rest });
      return 0;
    case undefined:
    case 'help':
    case '--help':
      console.log(USAGE);
      return 0;
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      return 1;
  }
}
