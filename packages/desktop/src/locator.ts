import { describeLocator, LocatorResolutionError, type LocatorSpec, type LocatorStrategy, type ResolvedLocator } from '@qakit/ui';
import type { DesktopBrowser, DesktopElement } from './types.js';

/** Same order as the browser lane (`@qakit/ui` locator.ts), so one step-doc target means the same thing in both. */
const ORDER: LocatorStrategy[] = ['domId', 'testId', 'role', 'label', 'placeholder', 'text', 'css'];

/** Elements a role matches without an explicit `role` attribute (HTML-AAM implicit roles, the common ones). */
const IMPLICIT_ROLES: Record<string, string[]> = {
  button: ['button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]'],
  link: ['a[href]'],
  textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="tel"]', 'input[type="url"]', 'textarea'],
  searchbox: ['input[type="search"]'],
  checkbox: ['input[type="checkbox"]'],
  radio: ['input[type="radio"]'],
  combobox: ['select:not([multiple])'],
  listbox: ['select[multiple]'],
  heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  list: ['ul', 'ol'],
  listitem: ['li'],
  table: ['table'],
  row: ['tr'],
  img: ['img[alt]:not([alt=""])'],
  navigation: ['nav'],
  main: ['main'],
  dialog: ['dialog'],
  progressbar: ['progress'],
};

const FORM_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'spinbutton', 'slider']);
const FORM_TAGS = new Set(['input', 'textarea', 'select']);

/** A WebdriverIO selector for one strategy, with an optional check each matched element must also pass. */
export interface DesktopCandidate {
  strategy: LocatorStrategy;
  selector: string;
  filter?: (element: DesktopElement) => Promise<boolean>;
}

function cssEscapeId(id: string): string {
  return id.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function cssString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** An XPath string literal for any text, including one holding both quote kinds. */
export function xpathLiteral(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `concat(${value
    .split('"')
    .map((part) => `"${part}"`)
    .join(`, '"', `)})`;
}

const roleIs = (role: string) => async (element: DesktopElement): Promise<boolean> => (await element.getComputedRole().catch(() => '')) === role;

const isFormControl = async (element: DesktopElement): Promise<boolean> => {
  const tag = (await element.getTagName()).toLowerCase();
  if (FORM_TAGS.has(tag)) return true;
  const role = await element.getAttribute('role');
  return (role !== null && FORM_ROLES.has(role)) || (await element.getAttribute('contenteditable')) === 'true';
};

/**
 * The candidate for one strategy, or undefined when the spec does not use it.
 *
 * WebdriverIO has no role engine, so `role` + `name` matches the accessible name (`aria/<name>`) and keeps the
 * elements whose computed role is the one asked for; a bare `role` matches the explicit attribute and the common
 * implicit roles. `label` matches the accessible name too, kept to form controls so the `<label>` itself never wins.
 */
export function candidateFor(spec: LocatorSpec, strategy: LocatorStrategy): DesktopCandidate | undefined {
  switch (strategy) {
    case 'domId':
      return spec.domId ? { strategy, selector: `#${cssEscapeId(spec.domId)}` } : undefined;
    case 'testId':
      return spec.testId ? { strategy, selector: `[data-testid=${cssString(spec.testId)}]` } : undefined;
    case 'role':
      if (!spec.role) return undefined;
      if (spec.name) return { strategy, selector: `aria/${spec.name}`, filter: roleIs(spec.role) };
      return { strategy, selector: [`[role=${cssString(spec.role)}]`, ...(IMPLICIT_ROLES[spec.role] ?? []).map((s) => `${s}:not([role])`)].join(', ') };
    case 'label':
      return spec.label ? { strategy, selector: `aria/${spec.label}`, filter: isFormControl } : undefined;
    case 'placeholder':
      return spec.placeholder ? { strategy, selector: `[placeholder=${cssString(spec.placeholder)}]` } : undefined;
    case 'text':
      return spec.text ? { strategy, selector: `.//*[text()[normalize-space(.)=${xpathLiteral(spec.text)}]]` } : undefined;
    case 'css':
      return spec.css ? { strategy, selector: spec.css } : undefined;
  }
}

type Scope = Pick<DesktopBrowser, '$$'> | DesktopElement;

async function matches(scope: Scope, candidate: DesktopCandidate): Promise<DesktopElement[]> {
  const found = Array.from(await scope.$$(candidate.selector));
  if (!candidate.filter) return found;
  const kept: DesktopElement[] = [];
  for (const element of found) if (await candidate.filter(element)) kept.push(element);
  return kept;
}

export interface DesktopResolveResult {
  element: DesktopElement;
  resolved: ResolvedLocator;
}

/**
 * The first strategy that matches, polling until `timeoutMs` because the renderer draws asynchronously. Several
 * matches are an error unless `nth` was given, exactly as in the browser lane.
 */
export async function resolveDesktopLocator(browser: Pick<DesktopBrowser, '$$'>, spec: LocatorSpec, timeoutMs = 10_000, pollMs = 150): Promise<DesktopResolveResult> {
  const scope: Scope = spec.within ? (await resolveDesktopLocator(browser, spec.within, timeoutMs, pollMs)).element : browser;
  const deadline = Date.now() + timeoutMs;
  const attempted = new Set<string>();

  for (;;) {
    for (const strategy of ORDER) {
      const candidate = candidateFor(spec, strategy);
      if (!candidate) continue;
      const found = await matches(scope, candidate);
      if (found.length === 0) {
        attempted.add(`${strategy}: 0 matches`);
        continue;
      }
      if (found.length > 1 && spec.nth === undefined) {
        throw new LocatorResolutionError(
          `${describeLocator(spec)} matched ${found.length} elements via ${strategy}. Pass nth to disambiguate deliberately, or narrow with within.`,
        );
      }
      const element = found[spec.nth ?? 0];
      if (!element) throw new LocatorResolutionError(`${describeLocator(spec)}: nth=${spec.nth} but only ${found.length} element(s) matched via ${strategy}.`);
      return { element, resolved: { strategy, matched: found.length, description: describeLocator(spec) } };
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new LocatorResolutionError(`${describeLocator(spec)} matched nothing within ${timeoutMs}ms (${[...attempted].join('; ') || 'no strategies supplied'})`);
}

/** How many elements the spec matches right now, without waiting — zero is a valid answer here. */
export async function countDesktopMatches(browser: Pick<DesktopBrowser, '$$'>, spec: LocatorSpec): Promise<number> {
  let scope: Scope = browser;
  if (spec.within) {
    const within = await countScope(browser, spec.within);
    if (!within) return 0;
    scope = within;
  }
  for (const strategy of ORDER) {
    const candidate = candidateFor(spec, strategy);
    if (candidate) return (await matches(scope, candidate)).length;
  }
  throw new LocatorResolutionError(`${describeLocator(spec)} supplies no usable strategy.`);
}

async function countScope(browser: Pick<DesktopBrowser, '$$'>, spec: LocatorSpec): Promise<DesktopElement | undefined> {
  try {
    return (await resolveDesktopLocator(browser, spec, 0)).element;
  } catch {
    return undefined;
  }
}
