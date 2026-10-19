import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { projectConfigSchema } from '../packages/core/src/config/schema.js';

export const SCHEMA_PATH = fileURLToPath(new URL('../schema/qakit.config.schema.json', import.meta.url));

/**
 * Renders the editor/skill-facing JSON Schema from the zod source of truth. Cross-field rules
 * (duplicate module ids, reuse targets) live in `superRefine` and are enforced only by the loader.
 */
export function renderSchema(): string {
  const schema = {
    ...zodToJsonSchema(projectConfigSchema, { $refStrategy: 'none', target: 'jsonSchema7' }),
    title: 'QA automation kit project config (qakit.config.yaml)',
  };
  return `${JSON.stringify(schema, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(dirname(SCHEMA_PATH), { recursive: true });
  writeFileSync(SCHEMA_PATH, renderSchema());
  console.log(`Wrote ${SCHEMA_PATH}`);
}
