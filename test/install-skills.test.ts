import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { STAMP_FILE, installSkills } from '../scripts/install-skills.js';

function put(file: string, content: string): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

/** A tiny kit: two skills, an English and a Vietnamese template, a Vietnamese skill overlay. */
function fakeKit(): string {
  const kit = mkdtempSync(join(tmpdir(), 'qakit-kit-'));
  put(join(kit, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  put(join(kit, 'skills', 'steps', 'SKILL.md'), '---\nname: steps\ndescription: x\n---\nEnglish body\n');
  put(join(kit, 'skills', 'steps', 'skill.json'), JSON.stringify({ templates: ['ui-test-steps', 'crud-map'] }));
  put(join(kit, 'skills', 'steps', 'references', 'guide.md'), 'english guide');
  put(join(kit, 'skills', 'api-mcp', 'SKILL.md'), '---\nname: api-mcp\ndescription: y\n---\n');
  put(join(kit, 'doc-templates', 'ui-test-steps.md'), 'EN ui');
  put(join(kit, 'doc-templates', 'crud-map.md'), 'EN crud');
  put(join(kit, 'packages', 'locale-vi', 'doc-templates', 'ui-test-steps.md'), 'VI ui');
  put(join(kit, 'packages', 'locale-vi', 'skills', 'steps', 'references', 'phuong-phap.md'), 'vi method');
  put(join(kit, 'packages', 'locale-vi', 'skills', 'steps', 'scripts', '__pycache__', 'build.cpython-314.pyc'), 'bytecode');
  put(join(kit, 'skills', 'steps', 'scripts', 'build.pyc'), 'bytecode');
  return kit;
}

function project(locale: string): { config: string; target: string } {
  const dir = mkdtempSync(join(tmpdir(), 'qakit-project-'));
  const config = join(dir, 'qakit.config.yaml');
  writeFileSync(config, `project: demo-shop\nlocale: ${locale}\nextensions:\n  skillNames: { api-mcp: shop-api }\n`);
  return { config, target: join(dir, '.claude', 'skills') };
}

describe('installSkills', () => {
  it('copies skills, overlays the locale pack, picks locale templates and renames', () => {
    const kitRoot = fakeKit();
    const { config, target } = project('vi');
    const results = installSkills({ configPath: config, targetDir: target, kitRoot });

    assert.deepEqual(
      results.map((r) => [r.skill, r.installedAs, r.status, r.localeOverlay]),
      [
        ['api-mcp', 'shop-api', 'installed', false],
        ['steps', 'steps', 'installed', true],
      ],
    );
    const steps = join(target, 'steps');
    assert.equal(readFileSync(join(steps, 'templates', 'ui-test-steps.md'), 'utf8'), 'VI ui', 'the locale template wins');
    assert.equal(readFileSync(join(steps, 'templates', 'crud-map.md'), 'utf8'), 'EN crud', 'English when the locale has none');
    assert.equal(readFileSync(join(steps, 'references', 'phuong-phap.md'), 'utf8'), 'vi method');
    assert.equal(readFileSync(join(steps, 'references', 'guide.md'), 'utf8'), 'english guide');
    assert.ok(!existsSync(join(steps, 'skill.json')), 'the manifest is not installed');
    assert.ok(!existsSync(join(steps, 'scripts', '__pycache__')) && !existsSync(join(steps, 'scripts', 'build.pyc')), 'script caches are not installed');
    assert.match(readFileSync(join(target, 'shop-api', 'SKILL.md'), 'utf8'), /^name: shop-api$/m);
    assert.equal(JSON.parse(readFileSync(join(steps, STAMP_FILE), 'utf8')).version, '9.9.9');
  });

  it('uses English templates and no overlay for an English project', () => {
    const kitRoot = fakeKit();
    const { config, target } = project('en');
    installSkills({ configPath: config, targetDir: target, kitRoot, only: ['steps'] });
    assert.equal(readFileSync(join(target, 'steps', 'templates', 'ui-test-steps.md'), 'utf8'), 'EN ui');
    assert.ok(!existsSync(join(target, 'steps', 'references', 'phuong-phap.md')));
  });

  it('leaves a hand-written skill alone unless forced, and replaces its own installs', () => {
    const kitRoot = fakeKit();
    const { config, target } = project('en');
    put(join(target, 'steps', 'SKILL.md'), 'hand written');

    assert.equal(installSkills({ configPath: config, targetDir: target, kitRoot, only: ['steps'] })[0]?.status, 'skipped-unstamped');
    assert.equal(readFileSync(join(target, 'steps', 'SKILL.md'), 'utf8'), 'hand written');

    assert.equal(installSkills({ configPath: config, targetDir: target, kitRoot, only: ['steps'], force: true })[0]?.status, 'replaced');
    assert.equal(installSkills({ configPath: config, targetDir: target, kitRoot, only: ['steps'] })[0]?.status, 'replaced', 'a stamped copy is replaced without force');
  });

  it('rejects an unknown skill name', () => {
    const { config, target } = project('en');
    assert.throws(() => installSkills({ configPath: config, targetDir: target, kitRoot: fakeKit(), only: ['nope'] }), /Unknown skill/);
  });
});
