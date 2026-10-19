import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { loadProjectAdapter } from './adapter.js';
import { loadDotEnvFile, loadDotEnvFiles } from './config/dotenv.js';
import { ConfigError, loadProjectConfig } from './config/load.js';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-adapter-'));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

function write(name: string, content: string): string {
  const file = path.join(DIR, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

describe('loadDotEnvFile', () => {
  it('fills unset keys only, strips quotes and skips comments and empty values', () => {
    const file = write('.env', ['# comment', 'A=1', 'B="two words"', "C='3'", 'D=', 'E=kept', 'not a pair', ' F = spaced '].join('\n'));
    const env: NodeJS.ProcessEnv = { E: 'from-env' };
    assert.deepEqual(loadDotEnvFile(file, env), ['A', 'B', 'C', 'F']);
    assert.deepEqual(env, { A: '1', B: 'two words', C: '3', E: 'from-env', F: 'spaced' });
    assert.deepEqual(loadDotEnvFile(path.join(DIR, 'missing.env'), env), []);
  });

  it('lets earlier files win', () => {
    const first = write('first.env', 'KEY=first');
    const second = write('second.env', 'KEY=second\nOTHER=2');
    const env: NodeJS.ProcessEnv = {};
    loadDotEnvFiles([first, second], env);
    assert.deepEqual(env, { KEY: 'first', OTHER: '2' });
  });

  it('lets a value point at a variable another file defines, without copying it', () => {
    const first = write('refs.env', ['QA_USERNAME=${PERSONA_ALICE_USERNAME}', 'QA_LABEL=as ${PERSONA_ALICE_USERNAME} on ${STAGE}', 'QA_PASSWORD=${PERSONA_NOBODY_PASSWORD}', 'FROM_SHELL=${STAGE}'].join('\n'));
    const second = write('secrets.env', 'PERSONA_ALICE_USERNAME=alice@example.test');
    const env: NodeJS.ProcessEnv = { STAGE: 'uat', FROM_SHELL: 'kept-${STAGE}' };
    loadDotEnvFiles([first, second], env);
    assert.equal(env.QA_USERNAME, 'alice@example.test');
    assert.equal(env.QA_LABEL, 'as alice@example.test on uat');
    // Nothing to point at: the text stays as written, since it may be a literal.
    assert.equal(env.QA_PASSWORD, '${PERSONA_NOBODY_PASSWORD}');
    // A real environment variable is never rewritten.
    assert.equal(env.FROM_SHELL, 'kept-${STAGE}');
  });
});

describe('loadProjectAdapter', () => {
  it('returns undefined when no adapter is configured', async () => {
    const configPath = write('none/qakit.config.yaml', 'project: demo-shop\n');
    assert.equal(await loadProjectAdapter(loadProjectConfig({ configPath, env: {} })), undefined);
  });

  it('imports the default export relative to the config file', async () => {
    write('shop/adapter/index.mjs', "export default { name: 'demo-shop', moduleAliases: { po: 'orders' } };\n");
    const configPath = write('shop/qakit.config.yaml', 'project: demo-shop\nadapter: ./adapter/index.mjs\nextensions: { anything: [1, 2] }\n');
    const loaded = loadProjectConfig({ configPath, env: {} });
    assert.deepEqual(loaded.config.extensions, { anything: [1, 2] });
    const adapter = await loadProjectAdapter(loaded);
    assert.equal(adapter?.name, 'demo-shop');
    assert.deepEqual(adapter?.moduleAliases, { po: 'orders' });
  });

  it('accepts a named `adapter` export and rejects a module without one', async () => {
    write('named/a.mjs', "export const adapter = { name: 'named' };\n");
    const named = write('named/qakit.config.yaml', 'project: named\nadapter: ./a.mjs\n');
    assert.equal((await loadProjectAdapter(loadProjectConfig({ configPath: named, env: {} })))?.name, 'named');

    write('bad/a.mjs', 'export const something = 1;\n');
    const bad = write('bad/qakit.config.yaml', 'project: bad\nadapter: ./a.mjs\n');
    await assert.rejects(loadProjectAdapter(loadProjectConfig({ configPath: bad, env: {} })), (error: unknown) => {
      return error instanceof ConfigError && /must default-export an object with a string `name`/.test(error.message);
    });

    const missing = write('missing/qakit.config.yaml', 'project: missing\nadapter: ./nope.mjs\n');
    await assert.rejects(loadProjectAdapter(loadProjectConfig({ configPath: missing, env: {} })), /Could not import the project adapter/);
  });
});
