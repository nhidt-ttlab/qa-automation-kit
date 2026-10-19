import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { it } from 'node:test';
import { renderSchema, SCHEMA_PATH } from '../scripts/build-schema.js';

it('schema/qakit.config.schema.json matches the zod schema (run `pnpm schema:build`)', () => {
  assert.ok(existsSync(SCHEMA_PATH), `${SCHEMA_PATH} is missing — run \`pnpm schema:build\`.`);
  assert.equal(readFileSync(SCHEMA_PATH, 'utf8').replace(/\r\n/g, '\n'), renderSchema());
});
