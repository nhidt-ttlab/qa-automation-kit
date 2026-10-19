import { EvidenceStore, type LoadedProjectConfig, type Logger } from '@qakit/core';
import type { DesktopDriverText } from './driver.js';
import { createDesktopRuntime, type DesktopLauncher, type DesktopRuntime } from './runtime.js';
import { projectDesktopTarget } from './target.js';
import type { DesktopTarget } from './types.js';

export interface OpenProjectDesktopOptions {
  loaded: LoadedProjectConfig;
  logger: Pick<Logger, 'warn'>;
  scenario: string;
  runId: string;
  /** Evidence folder for this run's desktop session. */
  runDir: string;
  driverText?: DesktopDriverText;
  launch?: DesktopLauncher;
  redact?: readonly string[];
}

export interface ProjectDesktop {
  runtime: DesktopRuntime;
  evidence: EvidenceStore;
  target: DesktopTarget;
}

/**
 * A desktop runtime for the app the config's `desktop` block describes, with evidence under the project root
 * (ids `E-DT-nn`). Launching is lazy — nothing starts until `runtime.app()`.
 */
export function openProjectDesktop(options: OpenProjectDesktopOptions): ProjectDesktop {
  const target = projectDesktopTarget(options.loaded);
  const evidence = new EvidenceStore({
    scenario: options.scenario,
    runId: options.runId,
    webBaseUrl: `${target.framework}://${target.appBinaryPath ?? target.appEntryPoint ?? target.appRoot}`.split('\\').join('/'),
    rootDir: options.loaded.rootDir,
    runDir: options.runDir,
    idPrefix: 'E-DT',
  });
  const runtime = createDesktopRuntime({ target, evidence, logger: options.logger, launch: options.launch, driverText: options.driverText, redact: options.redact });
  return { runtime, evidence, target };
}
