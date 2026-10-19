import fs from 'node:fs';

/**
 * Loads `KEY=value` lines from a `.env` file into `env` (default `process.env`). Values already set
 * always win, so a real environment variable overrides the file; empty values are skipped; `#`
 * comments and blank lines are ignored; one layer of matching single or double quotes is stripped.
 * Missing files are a no-op. Returns the keys it set.
 */
export function loadDotEnvFile(filePath: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!fs.existsSync(filePath)) return [];
  const set: string[] = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined && value !== '') {
      env[key] = value;
      set.push(key);
    }
  }
  return set;
}

/**
 * Loads several `.env` files in order; earlier files win over later ones. Once all are loaded, a value
 * the files set may name another variable as `${NAME}`, so one variable can point at another that a later
 * file defines (`QA_USERNAME=${PERSONA_ALICE_USERNAME}`) without the secret being copied.
 */
export function loadDotEnvFiles(filePaths: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const set = filePaths.flatMap((filePath) => loadDotEnvFile(filePath, env));
  for (const key of set) {
    // A reference to a variable that is not set stays as written: it may be a literal, and the kit cannot tell.
    env[key] = env[key]!.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (reference, name: string) => (name !== key && env[name] ? env[name] : reference));
  }
  return set;
}
