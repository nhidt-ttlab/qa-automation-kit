import { z } from 'zod';

/**
 * The shape of `qakit.config.yaml` — the one declarative file a project fills in to use the kit.
 *
 * Everything project-specific that config *can* express lives here (hosts, auth, module registry,
 * paths the skills read, safety switches). Behaviour it cannot express goes in the project's
 * `ProjectAdapter` instead. `schema/qakit.config.schema.json` is generated from this file by
 * `pnpm schema:build`; never edit the JSON by hand.
 */

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use kebab-case (a-z, 0-9, hyphen).');

const envName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'Environment variable names are UPPER_SNAKE_CASE.');

const regexSource = z.string().refine(
  (source) => {
    try {
      new RegExp(source);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Not a valid regular expression.' },
);

/** A literal value, or one read from an environment variable with an optional fallback. */
export const envValueSchema = z.union([
  z.string(),
  z
    .object({ env: envName.optional(), default: z.string().optional() })
    .strict()
    .refine((value) => value.env !== undefined || value.default !== undefined, {
      message: 'Provide `env`, `default`, or both.',
    }),
]);
export type EnvValue = z.infer<typeof envValueSchema>;

const credentialFields = {
  usernameEnv: envName,
  passwordEnv: envName,
  /** When set and non-empty, used as the bearer token and login is skipped. */
  staticTokenEnv: envName.optional(),
};

export const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('static-bearer'), tokenEnv: envName }).strict(),
  z
    .object({
      type: z.literal('api-key'),
      keyEnv: envName,
      in: z.enum(['header', 'query']).default('header'),
      name: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('oauth2-password'),
      tokenPath: z.string().min(1),
      clientId: z.string().min(1),
      clientSecretEnv: envName.optional(),
      scope: z.string().optional(),
      ...credentialFields,
    })
    .strict(),
  /**
   * OpenID Connect authorization code + PKCE, signing in at the identity provider's own form — for a
   * provider that issues audience-bound tokens or has the password grant switched off.
   */
  z
    .object({
      type: z.literal('oidc-code'),
      /** The identity provider, when it is not this source's `baseUrl`. Discovery is read from it. */
      issuer: envValueSchema.optional(),
      clientId: z.string().min(1),
      /** Leave out for a public client, which relies on PKCE alone. */
      clientSecretEnv: envName.optional(),
      /** A redirect URI registered for the client: absolute, or a path on `baseUrl`. It is never called. */
      redirectUri: z.string().min(1),
      scope: envValueSchema.default('openid'),
      /**
       * Extra authorization request parameters, e.g. the organization or tenant the token is asked for.
       * One that resolves to nothing (an unset env var without a default) is not sent.
       */
      authorizeParams: z.record(z.string(), envValueSchema).default({}),
      ...credentialFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('jwt-login'),
      loginPath: z.string().min(1),
      usernameField: z.string().default('username'),
      passwordField: z.string().default('password'),
      /** Dot path into the login response body, e.g. `data.accessToken`. */
      tokenJsonPath: z.string().default('token'),
      refreshTokenJsonPath: z.string().optional(),
      expiresInJsonPath: z.string().optional(),
      ...credentialFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('cookie-session'),
      loginPath: z.string().min(1),
      usernameField: z.string().default('username'),
      passwordField: z.string().default('password'),
      usernameEnv: envName,
      passwordEnv: envName,
    })
    .strict(),
  /** Trust the credentials another api source obtains (one hop only). `staticTokenEnv` still overrides. */
  z.object({ type: z.literal('reuse'), from: slug, staticTokenEnv: envName.optional() }).strict(),
]);
export type AuthConfig = z.infer<typeof authSchema>;

export const apiSourceSchema = z
  .object({
    baseUrl: envValueSchema,
    openapi: z
      .object({
        /** Path on `baseUrl`, e.g. `/swagger/v1/swagger.json`. */
        path: z.string().optional(),
        /** Absolute URL when the spec is served elsewhere. */
        url: envValueSchema.optional(),
        /** Env var naming a local spec file that overrides the network. */
        fileEnv: envName.optional(),
        cacheTtlSeconds: z.number().int().nonnegative().default(3600),
      })
      .strict()
      .optional(),
    auth: authSchema.default({ type: 'none' }),
    description: z.string().optional(),
    /** Source-code repository behind this API; generated API docs are grouped by it. Defaults to the source id. */
    repository: z.string().min(1).optional(),
    /**
     * The id the API MCP server and generated API docs use for this source, when it must differ
     * from the key — e.g. a legacy id already written into actionIds across a project's docs.
     */
    mcpId: slug.optional(),
  })
  .strict();
export type ApiSourceConfig = z.infer<typeof apiSourceSchema>;

/**
 * One business module: the join key between spec docs, step docs, suites and reports. Several
 * modules may share one automation `suite` (a suite folder can cover more than one spec module).
 */
export const moduleSchema = z
  .object({
    id: slug,
    /** Folder name used by the docs pipeline when it differs from `id`. */
    docSlug: z.string().min(1).optional(),
    /** Spec feature codes this module covers, verbatim from the source spec. */
    featureCodes: z.array(z.string().min(1)).default([]),
    tcPrefix: z.string().regex(/^[A-Z0-9]+$/, 'Use upper-case letters and digits.').optional(),
    /** Step-doc folder under `paths.steps`, when it differs from `docSlug ?? id`. */
    stepDir: z.string().min(1).optional(),
    /** Automation suite folder under `paths.suites` that holds this module's scenarios. */
    suite: slug.optional(),
    description: z.string().optional(),
  })
  .strict();
export type ModuleConfig = z.infer<typeof moduleSchema>;

export const webSchema = z
  .object({
    baseUrl: envValueSchema,
    loginPath: z.string().default('/login'),
    /**
     * `storage`: the adapter seeds an authenticated browser session; `form`: log in through the page;
     * `none`: sessions open signed out and each scenario signs in as whoever it needs.
     */
    authMode: z.enum(['storage', 'form', 'none']).default('form'),
    /** Dot-boundary suffix match. Every host the page may reach, including its API hosts. */
    allowedHosts: z.array(z.string().min(1)).min(1),
    /** Widget adapters to load, in priority order. `html` is the ARIA/native fallback. */
    widgets: z.array(z.string().min(1)).default(['html']),
    viewport: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .strict()
      .default({ width: 1440, height: 900 }),
    /** The api source whose token backs the browser session. */
    apiSource: slug.optional(),
    /** POST endpoints the page may call in read-only runs because they only read (a login, a search). Matched as URL substrings. */
    postLookups: z.array(z.string().min(1)).default([]),
    /**
     * The identity provider's protocol endpoints, as regular expressions matched against the URL. They stay
     * reachable in read-only runs, and a request to one never has its body recorded. The defaults fit a
     * provider that serves `/connect/token` and `/connect/authorize`.
     */
    authPaths: z.array(regexSource).default(['/connect/token$', '/connect/authorize']),
  })
  .strict();
export type WebConfig = z.infer<typeof webSchema>;

/**
 * The desktop application under test, driven through WebdriverIO and its Electron service (`@qakit/desktop`).
 * Give `appBinaryPath` for a packaged build, or `appEntryPoint` for an unpackaged one launched with the app's own
 * `electron`; with neither, the service looks for an Electron Forge or electron-builder output under `appRoot`.
 */
export const desktopSchema = z
  .object({
    framework: z.literal('electron').default('electron'),
    /** The packaged app's executable. Relative paths are resolved against the config file. */
    appBinaryPath: envValueSchema.optional(),
    /** The built main-process entry of an unpackaged app (e.g. `out/main/index.js`). Relative to the config file. */
    appEntryPoint: envValueSchema.optional(),
    /** The app's folder (its `package.json` and `node_modules/electron`), relative to the config file. Defaults to the config's folder. */
    appRoot: z.string().min(1).optional(),
    /** Command-line arguments passed to the app. */
    appArgs: z.array(z.string()).default([]),
    /**
     * A chromedriver to use instead of the one WebdriverIO downloads for the app's Chromium version — for an offline
     * machine, or one where the download cannot be unpacked. Relative to the config file.
     */
    chromedriverPath: envValueSchema.optional(),
    /** Environment the app process starts with, on top of the runner's own. A value that resolves to nothing is not set. */
    env: z.record(envName, envValueSchema).default({}),
    /** How long one step waits for its element, in milliseconds. */
    timeoutMs: z.number().int().positive().default(30_000),
    /** Capture the main and renderer process consoles into the run's evidence. */
    captureLogs: z.boolean().default(true),
  })
  .strict();
export type DesktopConfig = z.infer<typeof desktopSchema>;

export const safetySchema = z
  .object({
    allowWrites: z.boolean().default(false),
    allowDestructive: z.boolean().default(false),
    /** When this env var is `1`, both `allowWrites` and `allowDestructive` are switched on for the process. */
    allowWritesEnv: envName.optional(),
    /** `locale` uses the active locale pack's labels; an object supplies a project-specific pattern. */
    destructiveLabels: z
      .union([
        z.literal('locale'),
        z.object({ pattern: regexSource, flags: z.string().regex(/^[imsu]*$/).default('i') }).strict(),
      ])
      .default('locale'),
    /** Prefix stamped on every record the harness creates, so cleanup can find them. */
    testDataMarker: z.string().min(1).optional(),
    seedingBaseUrlAllowlist: z.array(z.string().min(1)).default([]),
    budget: z
      .object({
        maxActionsPerSession: z.number().int().positive().default(200),
        maxSessionMs: z.number().int().positive().default(10 * 60_000),
      })
      .strict()
      .default({}),
  })
  .strict()
  .refine((safety) => !safety.allowDestructive || safety.allowWrites, {
    message: '`allowDestructive` requires `allowWrites`.',
    path: ['allowDestructive'],
  });
export type SafetyConfig = z.infer<typeof safetySchema>;

export const projectConfigSchema = z
  .object({
    $schema: z.string().optional(),
    project: slug,
    environment: z.string().min(1).default('default'),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use a language tag such as `en` or `vi`.')
      .default('en'),
    /** Module path, relative to the config file, whose default export is the `ProjectAdapter`. */
    adapter: z.string().min(1).optional(),
    /** `.env` files the CLIs load before resolving env values, relative to the config; earlier files win. */
    envFiles: z.array(z.string().min(1)).default(['.env']),
    modules: z.array(moduleSchema).default([]),
    apiSources: z.record(slug, apiSourceSchema).default({}),
    /** The API MCP server: domain registry, OpenAPI cache, write gate and doc generation. */
    api: z
      .object({
        /** Folder of `<domain>.yaml` files. */
        domainsDir: z.string().min(1).optional(),
        /** Cross-domain dependency edges. */
        businessGraph: z.string().min(1).optional(),
        /** Field name -> lookup endpoint index the planner uses to resolve foreign keys. */
        fieldDependencies: z.string().min(1).optional(),
        cacheDir: z.string().default('.cache/openapi'),
        /** How long an actionId issued by discovery or planning stays executable. */
        actionTtlSeconds: z.number().int().positive().default(1800),
        /** Let `execute_api_action` send requests that change data. */
        allowWrites: z.boolean().default(false),
        /** When this env var is `1`, `allowWrites` is switched on for the process. */
        allowWritesEnv: envName.optional(),
        /** POST paths that only read (search/list endpoints implemented as POST). Matched against the path. */
        readOnlyPostPatterns: z.array(regexSource).default([]),
        /** Operations matching this (operationId, path, summary) need `confirm: true` even with writes on. DELETE always does. */
        destructiveOperations: regexSource.default('delete|remove|cancel|approve|reject|submit|void|purge'),
        docs: z
          .object({
            /** `<source id or repository>.swagger.json` files read by `qakit-api docgen`. */
            swaggerDir: z.string().default('api/swaggers'),
            /** Receives `metadata/generated/<repository>/*.yaml` and `docs/<repository>/*.md`. */
            outputDir: z.string().default('api/generated'),
            /** Optional table assigning generated metadata files to domains. */
            domainFileMapping: z.string().min(1).optional(),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    web: webSchema.optional(),
    desktop: desktopSchema.optional(),
    safety: safetySchema.default({}),
    ids: z
      .object({
        testCase: regexSource.default('^TC-[A-Z0-9]+-[A-Z]*\\d+[a-z]?$'),
        assertion: regexSource.default('^A\\d+$'),
        /** How a recorded check names what it proves: test case plus assertion, e.g. `TC-ORD-U01 / A2`. */
        checkRef: regexSource.default('^TC-[A-Z0-9-]+ / A\\d+[a-z]?$'),
      })
      .strict()
      .default({}),
    /** Locations the CLI and the skills read and write, relative to the config file. */
    paths: z
      .object({
        /** Folder holding the specification sources the extraction reads: CSV sheets, Markdown specs, or both. */
        specSource: z.string().min(1).optional(),
        /** @deprecated Former, CSV-only name for `specSource`; still read when `specSource` is absent. */
        specCsv: z.string().min(1).optional(),
        featureDocs: z.string().default('docs/features'),
        steps: z.string().default('test-steps'),
        suites: z.string().default('src/suites'),
        checklists: z.string().default('checklists'),
        knowledge: z.string().default('.qakit/knowledge'),
        evidence: z.string().default('evidence'),
        reports: z.string().default('reports'),
      })
      .strict()
      .default({}),
    reporting: z
      .object({
        sqlite: z.string().default('db/regression.db'),
        tracker: z
          .discriminatedUnion('type', [
            z.object({ type: z.literal('none') }).strict(),
            z
              .object({
                type: z.literal('redmine'),
                baseUrl: envValueSchema,
                apiKeyEnv: envName,
                projectId: z.string().min(1).optional(),
                customFields: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
              })
              .strict(),
          ])
          .default({ type: 'none' }),
      })
      .strict()
      .default({}),
    /**
     * Project-specific settings the kit does not interpret, read by the project's own code or
     * adapter (e.g. a default fixture selector). Keeps such settings in the one config file
     * without widening the schema for every project.
     */
    extensions: z.record(z.string(), z.unknown()).default({}),
    /** Server names as registered in `.mcp.json`; the skills derive tool names from these. */
    mcp: z
      .object({ apiServerName: z.string().default('qakit-api'), uiServerName: z.string().default('qakit-ui') })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((config, ctx) => {
    const seen = new Map<string, number>();
    config.modules.forEach((module, index) => {
      const first = seen.get(module.id);
      if (first !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modules', index, 'id'],
          message: `Duplicate module id "${module.id}" (first declared at modules.${first}).`,
        });
      } else {
        seen.set(module.id, index);
      }
    });

    for (const [id, source] of Object.entries(config.apiSources)) {
      if (source.auth.type !== 'reuse') continue;
      const target = config.apiSources[source.auth.from];
      if (!target) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['apiSources', id, 'auth', 'from'],
          message: `Unknown api source "${source.auth.from}".`,
        });
      } else if (target.auth.type === 'reuse') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['apiSources', id, 'auth', 'from'],
          message: `"${source.auth.from}" itself reuses another source; reuse is one hop only.`,
        });
      }
    }

    if (config.web?.apiSource && !config.apiSources[config.web.apiSource]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['web', 'apiSource'],
        message: `Unknown api source "${config.web.apiSource}".`,
      });
    }
  });

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type ProjectConfigInput = z.input<typeof projectConfigSchema>;
