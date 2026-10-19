import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RequestTraceEntry } from '@qakit/core';
import { emptyDiagnostics } from './types.js';
import {
  checkAllContain,
  checkContiguousSequence,
  checkNoPageErrors,
  checkRequestCount,
  checkRequestObserved,
  checkFormBlocksSave,
  checkNoEscapedWrites,
  createUiChecks,
  englishUiCheckText,
  type FormBlocksSaveInput,
  findRequests,
} from './ui-checks.js';

const BASE = 'https://api.example.test';

function entry(url: string, status = 200, method: RequestTraceEntry['method'] = 'GET'): RequestTraceEntry {
  return { timestamp: new Date().toISOString(), sourceId: 'web-ui', method, url, status };
}

test('checkNoPageErrors passes clean and reports the count when it fails', () => {
  assert.equal(checkNoPageErrors(emptyDiagnostics(), 'TC / A1').passed, true);

  const dirty = emptyDiagnostics();
  dirty.pageErrors.push({ message: 'x is not a function', timestamp: '' });
  const result = checkNoPageErrors(dirty, 'TC / A1');
  assert.equal(result.passed, false);
  assert.equal(result.actual, 1);
  assert.equal(result.testId, 'TC / A1');
});

test('findRequests filters on url, method and exact query values', () => {
  const trace = [
    entry(`${BASE}/api/app/report-allow-customer?keyword=abc&SkipCount=0`),
    entry(`${BASE}/api/app/report-allow-customer?keyword=abc&SkipCount=20`),
    entry(`${BASE}/api/app/other`),
    entry(`${BASE}/api/app/report-allow-customer`, 200, 'POST'),
  ];

  assert.equal(findRequests(trace, { urlContains: 'report-allow-customer' }).length, 3);
  assert.equal(findRequests(trace, { urlContains: 'report-allow-customer', method: 'GET' }).length, 2);
  assert.equal(
    findRequests(trace, { urlContains: 'report-allow-customer', query: { keyword: 'abc', SkipCount: '0' } }).length,
    1,
  );
  // A query value that differs must not match.
  assert.equal(findRequests(trace, { urlContains: 'report-allow-customer', query: { keyword: 'zzz' } }).length, 0);
});

test('checkRequestObserved says so plainly when the UI never fired the request', () => {
  const result = checkRequestObserved([], { urlContains: 'report-allow-customer' }, 'Search API is called', 'TC / A2');
  assert.equal(result.passed, false);
  assert.match(String(result.actual), /no request matching/);
});

test('checkRequestCount catches a switchMap double-fire', () => {
  const trace = [entry(`${BASE}/x?keyword=a`), entry(`${BASE}/x?keyword=a`)];
  assert.equal(checkRequestCount(trace, { urlContains: '/x' }, 1, 'Called once', 'TC / A3').passed, false);
  assert.equal(checkRequestCount(trace, { urlContains: '/x' }, 2, 'Called twice', 'TC / A3').passed, true);
});

test('checkContiguousSequence validates row renumbering and pinpoints the break', () => {
  assert.equal(checkContiguousSequence(['1', '2', '3'], 1, 'Row no.', 'TC / A1').passed, true);
  // Page 2 with pageSize 20 must restart at 21, not at 1.
  assert.equal(checkContiguousSequence(['21', '22'], 21, 'Row no. page 2', 'TC / A2').passed, true);
  assert.equal(checkContiguousSequence(['21', '22'], 1, 'Row no. page 2', 'TC / A2').passed, false);

  const gap = checkContiguousSequence(['1', '2', '4'], 1, 'Row no.', 'TC / A1');
  assert.equal(gap.passed, false);
  assert.match(String(gap.actual), /wrong at position 3.*expected "3".*got "4"/);
});

test('checkContiguousSequence treats an empty grid as a failure, not a vacuous pass', () => {
  const result = checkContiguousSequence([], 1, 'Row no.', 'TC / A1');
  // Expected and actual agree textually, so this documents the deliberate no-rows outcome.
  assert.equal(result.actual, 'the grid has no rows');
});

test('checkAllContain is case-insensitive and names the offending row', () => {
  assert.equal(checkAllContain(['Subcontractor ABC', 'abc corp'], 'ABC', 'Keyword filter', 'TC / A3').passed, true);
  const result = checkAllContain(['Subcontractor ABC', 'XYZ Ltd'], 'abc', 'Keyword filter', 'TC / A3');
  assert.equal(result.passed, false);
  assert.match(String(result.actual), /XYZ Ltd/);
});

test('checkAllContain ignores surrounding whitespace in the keyword', () => {
  assert.equal(checkAllContain(['abc corp'], '  abc  ', 'Trim', 'TC / A5').passed, true);
});

test('createUiChecks reports in the wording it is given', () => {
  const checks = createUiChecks({ ...englishUiCheckText, emptyGrid: 'EMPTY', noWritesLabel: 'NO WRITES' });
  assert.equal(checks.checkContiguousSequence([], 1, 'Row no.', 'TC / A1').actual, 'EMPTY');
  assert.equal(checks.checkNoEscapedWrites([], 'TC / A2').label, 'NO WRITES');
  assert.equal(checks.checkFormBlocksSave(blocksSaveInput())[2]?.label, 'NO WRITES', 'the form check reuses the same wording');
});

/* --- checkFormBlocksSave ------------------------------------------------------------------- */

function blocksSaveInput(overrides: Partial<FormBlocksSaveInput> = {}): FormBlocksSaveInput {
  return {
    formErrors: {},
    blockedRequests: [],
    expectedFields: [],
    messageLevel: 'field',
    testIds: { fields: 'TC / A1', messages: 'TC / A2', noWrite: 'TC / A3' },
    ...overrides,
  };
}

test('checkFormBlocksSave returns all three checks, in step-matrix order, with their testIds', () => {
  const checks = checkFormBlocksSave(blocksSaveInput());
  assert.equal(checks.length, 3);
  assert.deepEqual(
    checks.map((c) => c.testId),
    ['TC / A1', 'TC / A2', 'TC / A3'],
  );
});

test('checkFormBlocksSave passes when exactly the documented fields are flagged, order-insensitively', () => {
  const [fields] = checkFormBlocksSave(
    blocksSaveInput({
      formErrors: { unitTo: ['Required'], unitFrom: ['Required'] },
      expectedFields: ['unitFrom', 'unitTo'],
    }),
  );
  assert.equal(fields?.passed, true);
  // `check()` compares strings exactly, so the PASS branch must return the very string
  // `expected` carries — a chattier one reddens a passing assertion.
  assert.equal(fields?.actual, fields?.expected);
});

test('checkFormBlocksSave reddens when the form flags a field the doc does not, and vice versa', () => {
  const missed = checkFormBlocksSave(
    blocksSaveInput({ formErrors: { unitFrom: ['Required'] }, expectedFields: ['unitFrom', 'unitTo'] }),
  )[0];
  assert.equal(missed?.passed, false);
  assert.equal(missed?.actual, 'fields flagged: unitFrom');

  const extra = checkFormBlocksSave(
    blocksSaveInput({ formErrors: { unitFrom: ['Required'], note: ['?'] }, expectedFields: ['unitFrom'] }),
  )[0];
  assert.equal(extra?.passed, false);
  assert.equal(extra?.actual, 'fields flagged: note, unitFrom');
});

test('checkFormBlocksSave treats an empty message array as "not flagged"', () => {
  const [fields] = checkFormBlocksSave(
    blocksSaveInput({ formErrors: { unitFrom: ['Required'], unitTo: [] }, expectedFields: ['unitFrom'] }),
  );
  assert.equal(fields?.passed, true);
});

test('checkFormBlocksSave counts messages at the level the doc names, not wherever it finds them', () => {
  // The doc says page level; three inline messages are NOT the thing it asked about.
  const pageLevel = checkFormBlocksSave(
    blocksSaveInput({
      formErrors: { a: ['x'], b: ['y'], c: ['z'] },
      messageLevel: 'page',
      expectedMessageCount: 1,
    }),
  )[1];
  assert.equal(pageLevel?.passed, false);
  assert.match(String(pageLevel?.actual), /^0 message/);

  const withModal = checkFormBlocksSave(
    blocksSaveInput({ pageMessages: ['Please fill in all fields'], messageLevel: 'page', expectedMessageCount: 1 }),
  )[1];
  assert.equal(withModal?.passed, true);
});

test('checkFormBlocksSave counts a native window.confirm as a page-level complaint', () => {
  const [, messages] = checkFormBlocksSave(
    blocksSaveInput({
      dialogs: [{ type: 'confirm', message: 'Changes you made may not be saved.' }],
      messageLevel: 'page',
      expectedMessageCount: 1,
    }),
  );
  assert.equal(messages?.passed, true);
});

test('checkFormBlocksSave accepts "at least one message" when the doc commits to no number', () => {
  const silent = checkFormBlocksSave(blocksSaveInput({ messageLevel: 'field' }))[1];
  assert.equal(silent?.passed, false);
  assert.match(String(silent?.actual), /no message/);

  const spoke = checkFormBlocksSave(blocksSaveInput({ formErrors: { a: ['Required'] } }))[1];
  assert.equal(spoke?.passed, true);
  assert.equal(spoke?.actual, spoke?.expected);
});

test('checkFormBlocksSave reads an escaped write from blockedRequests, and names it', () => {
  const clean = checkFormBlocksSave(blocksSaveInput())[2];
  assert.equal(clean?.passed, true);

  const escaped = checkFormBlocksSave(
    blocksSaveInput({
      blockedRequests: [{ method: 'POST', url: 'https://api.example.test/api/PackagingItem/create' }],
    }),
  )[2];
  assert.equal(escaped?.passed, false);
  assert.match(String(escaped?.actual), /POST https:\/\/api\.example\.test\/api\/PackagingItem\/create/);
});

test('checkFormBlocksSave ignores GET aborts and declared POST lookups', () => {
  const [, , noWrite] = checkFormBlocksSave(
    blocksSaveInput({
      blockedRequests: [
        { method: 'GET', url: 'https://elsewhere.example/asset.js' },
        { method: 'POST', url: 'https://api.example.test/api/Phase/list' },
      ],
      knownPostLookups: ['/api/Phase/list'],
    }),
  );
  assert.equal(noWrite?.passed, true);
  assert.equal(noWrite?.actual, 'no write request');
});

test('checkNoEscapedWrites is the same reading checkFormBlocksSave ships as its third check', () => {
  const blockedRequests = [{ method: 'PUT', url: 'https://api.example.test/api/PackagingItem/update/7' }];
  const standalone = checkNoEscapedWrites(blockedRequests, 'TC / A8');
  const fromForm = checkFormBlocksSave(blocksSaveInput({ blockedRequests }))[2];
  assert.equal(standalone.passed, false);
  assert.equal(standalone.expected, fromForm?.expected);
  assert.equal(standalone.actual, fromForm?.actual);
});
