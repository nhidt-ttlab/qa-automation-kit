import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectConfig, type LoadedProjectConfig } from '@qakit/core';

export const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/shop', import.meta.url));
export const SHOP_SPEC = path.join(FIXTURE_ROOT, 'openapi', 'shop.swagger.json');

/** A temp project whose config points at the shop fixture. */
export function shopProject(extraApi = ''): { loaded: (env?: NodeJS.ProcessEnv) => LoadedProjectConfig; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qakit-mcp-api-'));
  const posix = (p: string) => p.split(path.sep).join('/');
  const yaml = `
project: demo-shop
apiSources:
  shop:
    baseUrl: https://shop.example.test
    repository: shop-service
    openapi: { path: /openapi.json, fileEnv: SHOP_SPEC_FILE }
    auth: { type: static-bearer, tokenEnv: SHOP_TOKEN }
api:
  domainsDir: ${posix(path.join(FIXTURE_ROOT, 'domains'))}
  businessGraph: ${posix(path.join(FIXTURE_ROOT, 'business-graph.yaml'))}
  cacheDir: cache
${extraApi}
  docs:
    swaggerDir: ${posix(path.join(FIXTURE_ROOT, 'openapi'))}
    outputDir: generated
mcp: { apiServerName: shop-api }
`;
  const configPath = path.join(dir, 'qakit.config.yaml');
  fs.writeFileSync(configPath, yaml);
  return { dir, loaded: (env = {}) => loadProjectConfig({ configPath, env }) };
}
