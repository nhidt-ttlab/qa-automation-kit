import type { Locator, Page } from 'playwright';
import type { LocatorSpec, LocatorStrategy, ResolvedLocator } from './types.js';

/**
 * Resolution order. `domId` leads deliberately — this is not the usual Playwright advice,
 * and the reason is what the target app actually ships:
 *
 * - The nhan-cong surface (project/laborCatalog, staff, workerGroup, jobTitle,
 *   organization, laborsAndMaterials) has ZERO `data-testid` attributes. Only 30 of ~600
 *   page components carry any, and those are on toolbar chrome, never the field under test.
 *   Meanwhile OverpaidPage.tsx labels its controls `btn-refresh-overpaid-page`,
 *   `input-search-overpaid-page`, `button-download-overpaid-page` — `id` only.
 * - Where testids DO exist they are not reliably unique: CreatePaymentRequestPage reuses
 *   `button-export-create-payment-request` for a direct download AND a Dropdown trigger in
 *   mutually-exclusive tab branches, and ForgotPasswordPage duplicates one in a single tree.
 * - `label`/`text`/`role`+name rank low because translations/index.ts hard-pins `lng: 'vi'`,
 *   so any name-based locator is a Vietnamese string literal coupled to the translation
 *   resources; and only 9 of ~55 antd <Form> sites pass a `name`, so generated label ids
 *   collide between two unnamed forms on one page.
 */
const ORDER: LocatorStrategy[] = ['domId', 'testId', 'role', 'label', 'placeholder', 'text', 'css'];

/** Escapes an id for use in a CSS selector. ids like `form=stock-in-infor-tab` exist in this app. */
function cssEscapeId(id: string): string {
  return id.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function buildFor(scope: Page | Locator, spec: LocatorSpec, strategy: LocatorStrategy): Locator | undefined {
  switch (strategy) {
    case 'domId':
      return spec.domId ? scope.locator(`#${cssEscapeId(spec.domId)}`) : undefined;
    case 'testId':
      return spec.testId ? scope.locator(`[data-testid="${spec.testId}"]`) : undefined;
    case 'role':
      return spec.role
        ? scope.getByRole(spec.role as Parameters<Page['getByRole']>[0], spec.name ? { name: spec.name } : undefined)
        : undefined;
    case 'label':
      return spec.label ? scope.getByLabel(spec.label) : undefined;
    case 'placeholder':
      return spec.placeholder ? scope.getByPlaceholder(spec.placeholder) : undefined;
    case 'text':
      return spec.text ? scope.getByText(spec.text) : undefined;
    case 'css':
      return spec.css ? scope.locator(spec.css) : undefined;
  }
}

export function describeLocator(spec: LocatorSpec): string {
  const parts: string[] = [];
  if (spec.domId) parts.push(`#${spec.domId}`);
  if (spec.testId) parts.push(`testid=${spec.testId}`);
  if (spec.role) parts.push(spec.name ? `role=${spec.role}[name="${spec.name}"]` : `role=${spec.role}`);
  if (spec.label) parts.push(`label=${spec.label}`);
  if (spec.placeholder) parts.push(`placeholder=${spec.placeholder}`);
  if (spec.text) parts.push(`text=${spec.text}`);
  if (spec.css) parts.push(`css=${spec.css}`);
  const self = parts.join(' | ') || '<empty locator>';
  const suffix = spec.nth === undefined ? '' : `[${spec.nth}]`;
  return spec.within ? `${describeLocator(spec.within)} >> ${self}${suffix}` : `${self}${suffix}`;
}

export class LocatorResolutionError extends Error {}

export interface ResolveResult {
  locator: Locator;
  resolved: ResolvedLocator;
}

/**
 * Returns the first strategy that matches. A multi-match is an ERROR unless `nth` was given
 * explicitly — never `.first()`, because this app's reused testids would silently target the
 * wrong control (see the ORDER comment).
 */
export async function resolveLocator(page: Page, spec: LocatorSpec, timeoutMs = 10_000): Promise<ResolveResult> {
  let scope: Page | Locator = page;
  if (spec.within) {
    scope = (await resolveLocator(page, spec.within, timeoutMs)).locator;
  }

  const deadline = Date.now() + timeoutMs;
  const attempted = new Set<string>();

  // Poll: the SPA renders asynchronously, so "not found yet" is not "not found".
  for (;;) {
    for (const strategy of ORDER) {
      const candidate = buildFor(scope, spec, strategy);
      if (!candidate) continue;
      const count = await candidate.count();
      if (count === 0) {
        attempted.add(`${strategy}: 0 matches`);
        continue;
      }
      if (count > 1 && spec.nth === undefined) {
        throw new LocatorResolutionError(
          `${describeLocator(spec)} matched ${count} elements via ${strategy}. ` +
            'Pass nth to disambiguate deliberately, or narrow with within — this harness never guesses with .first().',
        );
      }
      return {
        locator: spec.nth === undefined ? candidate : candidate.nth(spec.nth),
        resolved: { strategy, matched: count, description: describeLocator(spec) },
      };
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new LocatorResolutionError(
    `${describeLocator(spec)} matched nothing within ${timeoutMs}ms ` +
      `(${[...attempted].join('; ') || 'no strategies supplied'})`,
  );
}

/**
 * Builds the locator WITHOUT waiting for it to match, using the same strategy order.
 *
 * `resolveLocator` is the right tool when the element must exist: it polls, and a miss is an
 * error. That contract is wrong for questions whose expected answer may legitimately be zero —
 * "how many rows are still ticked?" after unticking every one, or "is this control present at
 * all?". Routing those through `resolveLocator` turns the passing case into a timeout and
 * reports a satisfied assertion as a failure.
 *
 * It also cannot report a multi-match, because counting is precisely the caller's intent here;
 * `within` and `nth` still apply so a scoped spec keeps meaning the same thing in both paths.
 */
export function buildLocator(page: Page, spec: LocatorSpec): Locator {
  let scope: Page | Locator = page;
  // Scope without waiting too — `within` here narrows the search, it does not assert presence.
  if (spec.within) scope = buildLocator(page, spec.within);

  for (const strategy of ORDER) {
    const candidate = buildFor(scope, spec, strategy);
    if (!candidate) continue;
    return spec.nth === undefined ? candidate : candidate.nth(spec.nth);
  }
  throw new LocatorResolutionError(`${describeLocator(spec)} supplies no usable strategy.`);
}

/**
 * Parses the canonical string form used in the step-matrix "Target (selector)" column, so a
 * step doc is machine-readable by the planner without a second encoding.
 *
 *   id=input-search-overpaid-page
 *   testid=input-username-login
 *   role=button[name="Đăng nhập"]
 *   label=Tên đăng nhập
 *   text=Tổng hợp giá trị theo thầu phụ
 *   css=.ag-pinned-left-cols-container [col-id="index"]
 *
 * Scoping uses ` >> `, and a trailing `[n]` selects the nth match.
 */
export function parseLocatorSpec(input: string): LocatorSpec {
  const segments = input.split('>>').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) throw new Error(`Empty locator string: "${input}"`);

  let spec: LocatorSpec | undefined;
  for (const segment of segments) {
    const parsed = parseSegment(segment);
    if (spec) parsed.within = spec;
    spec = parsed;
  }
  return spec as LocatorSpec;
}

function parseSegment(segment: string): LocatorSpec {
  let body = segment;
  let nth: number | undefined;

  const nthMatch = body.match(/\[(\d+)\]$/);
  if (nthMatch) {
    nth = Number(nthMatch[1]);
    body = body.slice(0, nthMatch.index).trim();
  }

  const eq = body.indexOf('=');
  if (eq === -1) throw new Error(`Locator segment "${segment}" must be <strategy>=<value>`);
  const key = body.slice(0, eq).trim().toLowerCase();
  const value = body.slice(eq + 1).trim();

  const spec: LocatorSpec = {};
  switch (key) {
    case 'id':
      spec.domId = value;
      break;
    case 'testid':
      spec.testId = value;
      break;
    case 'label':
      spec.label = value;
      break;
    case 'placeholder':
      spec.placeholder = value;
      break;
    case 'text':
      spec.text = value;
      break;
    case 'css':
      spec.css = value;
      break;
    case 'role': {
      const withName = value.match(/^([a-z]+)\[name="(.*)"\]$/i);
      if (withName) {
        spec.role = withName[1];
        spec.name = withName[2];
      } else {
        spec.role = value;
      }
      break;
    }
    default:
      throw new Error(`Unknown locator strategy "${key}" in "${segment}"`);
  }
  if (nth !== undefined) spec.nth = nth;
  return spec;
}
