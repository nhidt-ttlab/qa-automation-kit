import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { projectConfigSchema, type EnvValue, type ProjectConfig } from './schema.js';

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(issues.length > 0 ? `${message}\n${issues.map((issue) => `  - ${issue}`).join('\n')}` : message);
    this.name = 'ConfigError';
  }
}

export interface LoadProjectConfigOptions {
  /** Path to `qakit.config.yaml`. */
  configPath: string;
  /**
   * Environment overlay to apply. Falls back to `QAKIT_ENV`, then to the file's own `environment`.
   * An overlay is the sibling file `qakit.config.<environment>.yaml`; it is optional.
   */
  environment?: string;
  /** Defaults to `process.env`. Injected by tests. */
  env?: NodeJS.ProcessEnv;
}

export interface LoadedProjectConfig {
  config: ProjectConfig;
  configPath: string;
  /** Directory of the config file; every relative path in the config resolves against it. */
  rootDir: string;
  overlayPath?: string;
  resolveValue(value: EnvValue | undefined): string | undefined;
  resolvePath(path: string): string;
}

export function loadProjectConfig(options: LoadProjectConfigOptions): LoadedProjectConfig {
  const configPath = resolve(options.configPath);
  const env = options.env ?? process.env;
  const base = readYamlObject(configPath);

  const environment =
    options.environment ?? nonEmpty(env.QAKIT_ENV) ?? (typeof base.environment === 'string' ? base.environment : undefined);

  let raw = base;
  let overlayPath: string | undefined;
  if (environment !== undefined) {
    const candidate = overlayPathFor(configPath, environment);
    if (existsSync(candidate)) {
      raw = deepMerge(base, readYamlObject(candidate));
      overlayPath = candidate;
    }
    raw = { ...raw, environment };
  }

  const parsed = projectConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid project config ${configPath}${overlayPath ? ` (with overlay ${overlayPath})` : ''}`,
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  const rootDir = dirname(configPath);
  return {
    config: applyEnvSwitches(parsed.data, env),
    configPath,
    rootDir,
    overlayPath,
    resolveValue: (value) => resolveEnvValue(value, env),
    resolvePath: (path) => resolve(rootDir, path),
  };
}

export function resolveEnvValue(value: EnvValue | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (value === undefined || typeof value === 'string') return value;
  return (value.env !== undefined ? nonEmpty(env[value.env]) : undefined) ?? value.default;
}

/** `qakit.config.yaml` + `uat` → `qakit.config.uat.yaml`. */
export function overlayPathFor(configPath: string, environment: string): string {
  const extension = extname(configPath);
  return `${configPath.slice(0, configPath.length - extension.length)}.${environment}${extension}`;
}

/** Plain objects merge recursively; arrays and scalars from the overlay replace the base value. */
export function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = merged[key];
    merged[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return merged;
}

function applyEnvSwitches(config: ProjectConfig, env: NodeJS.ProcessEnv): ProjectConfig {
  const switchName = config.safety.allowWritesEnv;
  if (switchName === undefined || env[switchName] !== '1') return config;
  return { ...config, safety: { ...config.safety, allowWrites: true, allowDestructive: true } };
}

function readYamlObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) throw new ConfigError(`Project config not found: ${path}`);
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`Could not parse YAML in ${path}: ${(error as Error).message}`);
  }
  if (!isPlainObject(parsed)) throw new ConfigError(`Project config must be a YAML mapping: ${path}`);
  return parsed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}
