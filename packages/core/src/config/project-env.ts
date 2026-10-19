import { resolve } from 'node:path';
import { loadDotEnvFiles } from './dotenv.js';
import { loadProjectConfig, type LoadedProjectConfig, type LoadProjectConfigOptions } from './load.js';

/**
 * Loads the config's `envFiles` into `process.env`, then loads the config again so env switches
 * (`safety.allowWritesEnv`, `api.allowWritesEnv`) see the values those files set. Real environment
 * variables still win over the files. What every kit CLI does before it reads the config.
 */
export function loadProjectConfigWithEnv(options: Omit<LoadProjectConfigOptions, 'env'>): LoadedProjectConfig {
  const first = loadProjectConfig({ ...options, env: process.env });
  loadDotEnvFiles(first.config.envFiles.map((file) => first.resolvePath(file)));
  return loadProjectConfig({ ...options, configPath: resolve(options.configPath), env: process.env });
}
