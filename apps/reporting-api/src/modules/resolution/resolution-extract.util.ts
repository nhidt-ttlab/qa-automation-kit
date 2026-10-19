import { createHash } from 'node:crypto';
import {
  CHECK_STATUS,
  FEATURE_DOMAIN,
  RESOLUTION_OBSERVED_RESULT,
  TEST_RUN_RESULT,
  checkStatus,
  domainFromTestCaseId,
} from '@qakit/reporting-shared';
import type {
  ResolutionObservedResult,
  TestRunResult,
} from '@qakit/reporting-shared';

/**
 * Turns one imported test run into Resolution Queue candidates.
 *
 * Pure by design — no Prisma, no filesystem, no SQLite, no clock. That is what lets the
 * historical backfill and the incremental `db:sync` share a single definition of "what counts as
 * an unresolved condition and which issue does it belong to", and it is what makes the grouping
 * rules unit-testable against real strings lifted out of the runner database.
 *
 * The two rules that everything else hangs off:
 *
 *  1. **Never branch on `check.passed`.** The harness encodes "this assertion could not be
 *     scored" as the literal marker `NOT_EVALUATED` on *both* `expected` and `actual`, which
 *     makes `passed` trivially true — 2231 of the 2252 such checks in the current runner DB are
 *     `passed = true`. `checkStatus()` from the shared package is the only correct reading.
 *
 *  2. **Identity is (domain, blocker) — never scenario alone.** `BL-03` means one thing in
 *     `kiem-soat-dat-hang-thua` and something unrelated in `nhan-cong`, while the *same*
 *     `BL-03` recurring across a dozen scenarios of one domain is one issue, not a dozen.
 */

// ---------------------------------------------------------------------------
// Named blocker codes
// ---------------------------------------------------------------------------

/**
 * Blocker codes as they actually appear in evidence. They are documentation identifiers from the
 * step docs (`BL-03`, `OPEN-5`), embedded as free text — there is no column, enum or registry for
 * them anywhere in the runner, so they must be parsed.
 *
 * The leading `(?:^|[^A-Za-z0-9])` prevents matching inside a longer token (`KSDH-35`, `TBL-2`),
 * and the trailing `(?![0-9])` stops `BL-1` from swallowing the `1` of `BL-12`.
 */
const BLOCKER_CODE_RE =
  /(?:^|[^A-Za-z0-9])(BL|BLK|GAP|OPEN)[-_ ]?(\d{1,3})(?![0-9])/gi;

/**
 * Digit padding per prefix.
 *
 * The `BL` family is written both padded and unpadded in the same corpus — `boq-gop` uses `BL-1`
 * through `BL-8` while every other domain uses `BL-01` — and those are the same blockers, so they
 * must normalize together. `OPEN` is written unpadded everywhere (`OPEN-5`), so padding it would
 * invent a spelling nobody uses.
 */
const CODE_PADDING: Record<string, number> = { BL: 2, BLK: 2, GAP: 2, OPEN: 0 };

export interface BlockerCodeMatch {
  /** Canonical form, e.g. `BL-03` or `OPEN-5`. */
  code: string;
  /** Exactly as it appeared, e.g. `BL-3`. Kept for the ambiguity report. */
  raw: string;
}

/** Canonicalizes one prefix/digits pair: `BL`+`3` -> `BL-03`, `OPEN`+`05` -> `OPEN-5`. */
function canonicalizeCode(prefix: string, digits: string): string {
  const upper = prefix.toUpperCase();
  const n = Number.parseInt(digits, 10);
  const pad = CODE_PADDING[upper] ?? 0;
  return `${upper}-${String(n).padStart(pad, '0')}`;
}

/**
 * Every blocker code in a piece of text, in order of appearance, deduplicated by canonical form.
 *
 * Order matters: a reason routinely cites its primary blocker first and a knock-on blocker later
 * ("... depends on `excessQty`, which `BL-03` locks. Also `BL-05` ..."), so the first match is the
 * issue the observation belongs to and the rest are recorded as an ambiguity for manual triage.
 */
export function findBlockerCodes(
  text: string | null | undefined,
): BlockerCodeMatch[] {
  if (!text) return [];
  const out: BlockerCodeMatch[] = [];
  const seen = new Set<string>();
  BLOCKER_CODE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCKER_CODE_RE.exec(text)) !== null) {
    const code = canonicalizeCode(m[1], m[2]);
    if (seen.has(code)) continue;
    seen.add(code);
    // m[0] may carry the separator character the lookbehind-substitute consumed.
    out.push({ code, raw: m[0].replace(/^[^A-Za-z0-9]/, '') });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reason text
// ---------------------------------------------------------------------------

/**
 * `expected` / `actual` reach Postgres as `Json`, because the runner stores them
 * `JSON.stringify`'d. A string check is therefore the JSON string `"NOT_EVALUATED — ..."`, and
 * Prisma hands it back already parsed. Anything non-string (object, number) is rendered so the
 * marker test and the reason text still see something meaningful.
 */
export function decodeCheckValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Strips the `NOT_EVALUATED` marker and any immediately following separator. */
export function stripNotEvaluatedMarker(text: string): string {
  return text.replace(/^\s*NOT_EVALUATED\b\s*[—\-:(]?\s*/u, '').trim();
}

/**
 * Canonical form of an unresolved reason, used only as fingerprint material for fallback keys.
 *
 * Removes the values that change between two runs of the same unresolved condition — run ids,
 * GUIDs, ISO timestamps, elapsed times and generated fixture identifiers — and nothing else.
 *
 * It deliberately does **not** mask ordinary numbers. Measured over the 1381 unnamed
 * NOT_EVALUATED checks in the current runner DB, masking every number moved the group count from
 * 647 to 645: numbers are not what makes these keys churn, while `KSDH-35`, `12.000.000` and
 * `2/2 gói` are exactly the business detail that distinguishes one unresolved condition from
 * another. Removing them would merge issues that are not the same issue.
 */
export function normalizeReason(text: string | null | undefined): string {
  if (!text) return '';
  return (
    text
      .replace(/run-[a-z0-9]{4,12}-[a-z0-9]{4,12}/gi, ' ')
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        ' ',
      )
      .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/gi, ' ')
      .replace(
        /\b\d+(?:[.,]\d+)?\s?(?:ms|milliseconds?|s|seconds?|giây)\b/gi,
        ' ',
      )
      // Whole tokens carrying an epoch-millisecond stamp are generated fixture identifiers
      // (`AUTO-C09-A-1787788854055-774`), and the random suffix beside the stamp is just as
      // volatile — masking only the digits would still fork a new issue on every run. Business
      // numbers in this corpus never reach ten consecutive digits.
      .replace(/\S*\d{10,}\S*/g, ' ')
      .replace(/[`"'*_]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 600)
  );
}

/** Collapses a reason to a one-line summary for the list view. */
export function summarizeReason(text: string, maxLength = 400): string {
  const flat = stripNotEvaluatedMarker(text).replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLength) return flat;
  return `${flat.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Title text for a newly created issue: short, specific, and never empty. */
function buildTitle(params: {
  code?: string;
  reason: string;
  checkTestId?: string | null;
  scenarioKey: string;
}): string {
  const body = summarizeReason(params.reason, 200) || params.scenarioKey;
  if (params.code) return `${params.code} — ${body}`;
  const anchor = params.checkTestId ?? params.scenarioKey;
  return `${anchor} — ${body}`;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

function sha256Hex(material: string): string {
  return createHash('sha256').update(material).digest('hex');
}

/** `<domain>:BL-03` — the same code in two domains is deliberately two issues. */
export function buildNamedImportKey(domain: string, code: string): string {
  return `${domain}:${code}`;
}

/**
 * `auto:<domain>:<sha256-16>` over domain + scenario + assertion anchor + normalized reason.
 *
 * The `auto:` prefix is load-bearing: it makes a fallback issue distinguishable from a named one
 * at a glance, in the database and in a URL, without a second column.
 */
export function buildFallbackImportKey(params: {
  domain: string;
  scenarioKey: string;
  anchor: string;
  reason: string;
}): string {
  const material = [
    params.domain,
    params.scenarioKey,
    params.anchor,
    normalizeReason(params.reason),
  ].join('|');
  return `auto:${params.domain}:${sha256Hex(material).slice(0, 16)}`;
}

/**
 * Readable label. Not unique — two fallback issues on the same assertion with different reasons
 * share it — so the hash suffix is what a human uses to tell them apart when that happens.
 */
export function buildFallbackDisplayKey(params: {
  domain: string;
  testCaseId: string;
  scenarioKey: string;
  checkTestId?: string | null;
  checkSequence?: number | null;
  importKey: string;
}): string {
  const suffix = params.importKey.slice(-6);
  if (params.checkTestId) {
    // `TC-KSDH-A05 / A3` -> `TC-KSDH-A05/A3`
    const compact = params.checkTestId
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s+/g, ' ')
      .trim();
    return `${params.domain}:${compact}#${suffix}`;
  }
  if (params.checkSequence != null) {
    return `${params.domain}:${params.testCaseId}#${params.checkSequence}.${suffix}`;
  }
  return `${params.domain}:${params.testCaseId}#${suffix}`;
}

// ---------------------------------------------------------------------------
// Candidate extraction
// ---------------------------------------------------------------------------

/** The subset of a `test_runs` row the extractor needs. */
export interface ExtractableRun {
  id: string;
  testCaseId: string;
  scenarioKey: string;
  result: string;
  module?: string | null;
  domain?: string | null;
  startedAt: Date;
  blockedReason?: string | null;
  errorSummary?: string | null;
  defectStatement?: string | null;
  reportModel?: unknown;
  /** Joined test case, used only to recover a domain the run row does not carry. */
  testCase?: { domain?: string | null; module?: string | null } | null;
}

/** The subset of a `test_run_checks` row the extractor needs. */
export interface ExtractableCheck {
  sequence: number;
  testId?: string | null;
  label: string;
  expected?: unknown;
  actual?: unknown;
  passed: boolean;
}

export interface ResolutionCandidate {
  importKey: string;
  displayKey: string;
  title: string;
  /** Sync-owned one-line summary derived from this occurrence. */
  sourceSummary: string;
  domain: string;
  module: string | null;
  /** Present only when the evidence named a blocker code. */
  blockerCode?: string;
  observation: {
    runId: string;
    testCaseId: string;
    scenarioKey: string;
    checkSequence: number | null;
    checkTestId: string | null;
    checkLabel: string | null;
    observationKey: string;
    observedResult: ResolutionObservedResult;
    rawReason: string;
    observedAt: Date;
  };
  /** Extra blocker codes cited by the same reason. Reported for manual triage, never grouped on. */
  ambiguousCodes: string[];
}

export interface ExtractionDiagnostics {
  /** Reason text was empty or unusable, so no candidate could be built. */
  malformed: Array<{ runId: string; where: string; note: string }>;
  /** More than one blocker code in one reason; the first was used. */
  ambiguous: Array<{ runId: string; where: string; codes: string[] }>;
  /** Run-level reason suppressed because a check already represents it. */
  suppressedRunLevel: Array<{ runId: string; reason: string }>;
}

export function emptyDiagnostics(): ExtractionDiagnostics {
  return { malformed: [], ambiguous: [], suppressedRunLevel: [] };
}

/**
 * `_unknown` is not absence — it is the bucket for a producer that is not a registered scenario
 * (a probe, an ad hoc MCP session), matching UNKNOWN_DOMAIN in the runner. 96 of the 1007 runs in
 * the current database land here, and they must still be groupable.
 */
/** A stored domain worth trusting: present, non-blank, and not the runner's own placeholder. */
function usableDomain(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === FEATURE_DOMAIN.UNKNOWN) return undefined;
  return trimmed;
}

function resolveDomain(
  run: ExtractableRun,
  checks: ReadonlyArray<ExtractableCheck>,
): string {
  // A literal `_unknown` is not an answer, it is the runner's own placeholder for a scenario
  // missing from SCENARIO_GROUPS (96 runs carry it). Treating it as authoritative is how
  // TC-CHVT-U01 and TC-QCDG-U04 ended up sharing the `_unknown` bucket, which is precisely the
  // cross-feature collision the domain prefix exists to prevent.
  const denormalized =
    usableDomain(run.domain) ?? usableDomain(run.testCase?.domain);
  if (denormalized) return denormalized;

  // Runs that predate the module/domain columns were never re-persisted, so the denormalized
  // value is NULL for a large slice of the history. Recovering the domain matters more than it
  // sounds: `_unknown` is a single bucket, so grouping a named blocker under it would let BL-11
  // from two unrelated features collide into one issue.
  const fromRun = domainFromTestCaseId(run.testCaseId);
  if (fromRun) return fromRun;

  // Older rows carry the legacy `id === scenario_key` shape, which encodes nothing. The assertion
  // ids on the checks still do (`TC-BCK-U01 / A1`), and every check of a run belongs to one test
  // case, so the first TC-shaped one settles the whole run — including its run-level observation.
  for (const check of checks) {
    const head = check.testId?.split(/\s*\/\s*/)[0];
    const fromCheck = domainFromTestCaseId(head);
    if (fromCheck) return fromCheck;
  }
  return FEATURE_DOMAIN.UNKNOWN;
}

/** Cheap textual containment test used to suppress redundant run-level observations. */
function representsSameThing(runReason: string, checkReason: string): boolean {
  const a = normalizeReason(runReason);
  const b = normalizeReason(checkReason);
  if (!a || !b) return false;
  if (a === b) return true;
  // A run reason is frequently the concatenation of its checks' reasons, or a prefix of one.
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 40 && longer.includes(shorter);
}

/**
 * All Resolution Queue candidates for one run.
 *
 * Candidate sources, in the order the brief defines them:
 *   1/3. every check whose canonical status is NOT_EVALUATED (this covers PARTIAL runs too —
 *        their *failed* checks keep flowing to the defect workflow, untouched)
 *   2.   a BLOCKED run's top-level reason, including the 29 runs that have no checks at all
 *   4.   a PARTIAL run's top-level reason, only when a check does not already say the same thing
 *   5.   an ERROR run's summary
 *
 * FAIL and PASS runs produce nothing: the runner never writes a `blocked_reason` for them.
 */
export function extractCandidates(
  run: ExtractableRun,
  checks: ReadonlyArray<ExtractableCheck>,
  diagnostics: ExtractionDiagnostics = emptyDiagnostics(),
): ResolutionCandidate[] {
  const domain = resolveDomain(run, checks);
  const module = run.module?.trim() || run.testCase?.module?.trim() || null;
  const candidates: ResolutionCandidate[] = [];

  // --- check-level -------------------------------------------------------
  for (const check of checks) {
    if (checkStatus(check) !== CHECK_STATUS.NOT_EVALUATED) continue;

    const expected = decodeCheckValue(check.expected);
    const actual = decodeCheckValue(check.actual);
    // The reason lives on whichever side carries more than the bare marker. Scenarios put it on
    // both, but `notEvaluated()` in the runner writes the detail only to `actual`.
    const expectedBody = stripNotEvaluatedMarker(expected);
    const actualBody = stripNotEvaluatedMarker(actual);
    const reasonBody =
      actualBody.length >= expectedBody.length ? actualBody : expectedBody;
    const reason = reasonBody || check.label;

    if (!reason.trim()) {
      diagnostics.malformed.push({
        runId: run.id,
        where: `check:${check.sequence}`,
        note: 'NOT_EVALUATED check with no reason and no label',
      });
      continue;
    }

    // Search order: the check's own values first (most specific), then the run reason, then the
    // label and assertion id. The report model is the last resort — it is the whole rendered
    // model, so a code found there is the least precisely attributed.
    const haystacks = [
      expected,
      actual,
      run.blockedReason ?? '',
      check.label,
      check.testId ?? '',
    ];
    const codes = firstCodesFrom(haystacks);
    const candidate = buildCandidate({
      run,
      domain,
      module,
      codes,
      reason,
      checkSequence: check.sequence,
      checkTestId: check.testId ?? null,
      checkLabel: check.label,
      observationKey: `check:${check.sequence}`,
      observedResult: RESOLUTION_OBSERVED_RESULT.NOT_EVALUATED,
    });
    if (codes.length > 1) {
      diagnostics.ambiguous.push({
        runId: run.id,
        where: `check:${check.sequence}`,
        codes: codes.map((c) => c.code),
      });
    }
    candidates.push(candidate);
  }

  // --- run-level ---------------------------------------------------------
  const runLevel = resolveRunLevelReason(run);
  if (runLevel) {
    const suppressedBy = candidates.find((c) =>
      representsSameThing(runLevel.reason, c.observation.rawReason),
    );
    const codes = firstCodesFrom([
      runLevel.reason,
      run.defectStatement ?? '',
      stringifyReportModel(run.reportModel),
    ]);
    const sameCode =
      codes.length > 0 &&
      candidates.some((c) => c.blockerCode && c.blockerCode === codes[0].code);

    if (suppressedBy || sameCode) {
      diagnostics.suppressedRunLevel.push({
        runId: run.id,
        reason: summarizeReason(runLevel.reason, 160),
      });
    } else {
      const candidate = buildCandidate({
        run,
        domain,
        module,
        codes,
        reason: runLevel.reason,
        checkSequence: null,
        checkTestId: null,
        checkLabel: null,
        observationKey: runLevel.observationKey,
        observedResult: runLevel.observedResult,
      });
      if (codes.length > 1) {
        diagnostics.ambiguous.push({
          runId: run.id,
          where: runLevel.observationKey,
          codes: codes.map((c) => c.code),
        });
      }
      candidates.push(candidate);
    }
  }

  return candidates;
}

function firstCodesFrom(haystacks: ReadonlyArray<string>): BlockerCodeMatch[] {
  for (const text of haystacks) {
    const found = findBlockerCodes(text);
    if (found.length > 0) return found;
  }
  return [];
}

function stringifyReportModel(model: unknown): string {
  if (model == null) return '';
  if (typeof model === 'string') return model;
  try {
    return JSON.stringify(model);
  } catch {
    return '';
  }
}

function resolveRunLevelReason(run: ExtractableRun): {
  reason: string;
  observationKey: string;
  observedResult: ResolutionObservedResult;
} | null {
  const result = run.result as TestRunResult;
  if (result === TEST_RUN_RESULT.ERROR) {
    const reason = (run.errorSummary || run.blockedReason || '').trim();
    return reason
      ? {
          reason,
          observationKey: 'run:error',
          observedResult: RESOLUTION_OBSERVED_RESULT.ERROR,
        }
      : null;
  }
  if (
    result === TEST_RUN_RESULT.BLOCKED ||
    result === TEST_RUN_RESULT.PARTIAL
  ) {
    const reason = (run.blockedReason || '').trim();
    return reason
      ? {
          reason,
          observationKey: 'run:blocked',
          observedResult:
            result === TEST_RUN_RESULT.BLOCKED
              ? RESOLUTION_OBSERVED_RESULT.BLOCKED
              : RESOLUTION_OBSERVED_RESULT.PARTIAL,
        }
      : null;
  }
  // PASS and FAIL never carry one; if a future runner writes one, ignore it rather than guess.
  return null;
}

function buildCandidate(params: {
  run: ExtractableRun;
  domain: string;
  module: string | null;
  codes: BlockerCodeMatch[];
  reason: string;
  checkSequence: number | null;
  checkTestId: string | null;
  checkLabel: string | null;
  observationKey: string;
  observedResult: ResolutionObservedResult;
}): ResolutionCandidate {
  const { run, domain, module, codes, reason } = params;
  const primary = codes[0];

  let importKey: string;
  let displayKey: string;
  if (primary) {
    importKey = buildNamedImportKey(domain, primary.code);
    displayKey = importKey;
  } else {
    const anchor =
      params.checkTestId ??
      (params.checkSequence != null
        ? `seq:${params.checkSequence}`
        : params.observationKey);
    importKey = buildFallbackImportKey({
      domain,
      scenarioKey: run.scenarioKey,
      anchor,
      reason,
    });
    displayKey = buildFallbackDisplayKey({
      domain,
      testCaseId: run.testCaseId,
      scenarioKey: run.scenarioKey,
      checkTestId: params.checkTestId,
      checkSequence: params.checkSequence,
      importKey,
    });
  }

  return {
    importKey,
    displayKey,
    title: buildTitle({
      code: primary?.code,
      reason,
      checkTestId: params.checkTestId,
      scenarioKey: run.scenarioKey,
    }),
    sourceSummary: summarizeReason(reason, 1200),
    domain,
    module,
    blockerCode: primary?.code,
    observation: {
      runId: run.id,
      testCaseId: run.testCaseId,
      scenarioKey: run.scenarioKey,
      checkSequence: params.checkSequence,
      checkTestId: params.checkTestId,
      checkLabel: params.checkLabel,
      observationKey: params.observationKey,
      observedResult: params.observedResult,
      rawReason: reason,
      observedAt: run.startedAt,
    },
    ambiguousCodes: codes.slice(1).map((c) => c.code),
  };
}
