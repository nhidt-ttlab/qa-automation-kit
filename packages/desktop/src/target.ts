import { ConfigError, type LoadedProjectConfig } from '@qakit/core';
import type { DesktopTarget } from './types.js';

/** The config's `desktop` block as a launch target: paths made absolute against the config file, env values read. */
export function projectDesktopTarget(loaded: LoadedProjectConfig): DesktopTarget {
  const desktop = loaded.config.desktop;
  if (!desktop) throw new ConfigError(`${loaded.configPath} has no \`desktop\` block — a desktop session needs one.`);

  const resolvedPath = (value: Parameters<LoadedProjectConfig['resolveValue']>[0]): string | undefined => {
    const raw = loaded.resolveValue(value);
    return raw ? loaded.resolvePath(raw) : undefined;
  };
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(desktop.env)) {
    const resolved = loaded.resolveValue(value);
    if (resolved !== undefined && resolved !== '') env[name] = resolved;
  }

  return {
    framework: desktop.framework,
    appBinaryPath: resolvedPath(desktop.appBinaryPath),
    appEntryPoint: resolvedPath(desktop.appEntryPoint),
    appRoot: loaded.resolvePath(desktop.appRoot ?? '.'),
    appArgs: desktop.appArgs,
    chromedriverPath: resolvedPath(desktop.chromedriverPath),
    env,
    timeoutMs: desktop.timeoutMs,
    captureLogs: desktop.captureLogs,
  };
}

/** One line naming what will be launched, for logs and `qakit doctor`. */
export function describeDesktopTarget(target: DesktopTarget): string {
  if (target.appBinaryPath) return `electron binary ${target.appBinaryPath}`;
  if (target.appEntryPoint) return `electron entry ${target.appEntryPoint} (app root ${target.appRoot})`;
  return `electron build detected under ${target.appRoot}`;
}
