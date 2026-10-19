import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeLocator, parseLocatorSpec } from './locator.js';

test('parseLocatorSpec understands every strategy prefix', () => {
  assert.deepEqual(parseLocatorSpec('id=input-search-overpaid-page'), { domId: 'input-search-overpaid-page' });
  assert.deepEqual(parseLocatorSpec('testid=input-username-login'), { testId: 'input-username-login' });
  assert.deepEqual(parseLocatorSpec('label=Tên đăng nhập'), { label: 'Tên đăng nhập' });
  assert.deepEqual(parseLocatorSpec('placeholder=Tìm kiếm'), { placeholder: 'Tìm kiếm' });
  assert.deepEqual(parseLocatorSpec('text=Tổng hợp giá trị theo thầu phụ'), {
    text: 'Tổng hợp giá trị theo thầu phụ',
  });
  assert.deepEqual(parseLocatorSpec('css=.ag-center-cols-container [row-index="0"]'), {
    css: '.ag-center-cols-container [row-index="0"]',
  });
});

test('parseLocatorSpec splits role from its accessible name', () => {
  assert.deepEqual(parseLocatorSpec('role=button[name="Đăng nhập"]'), { role: 'button', name: 'Đăng nhập' });
  assert.deepEqual(parseLocatorSpec('role=table'), { role: 'table' });
});

test('parseLocatorSpec keeps a value that itself contains "="', () => {
  // StockInInforTab.tsx really does ship data-testid="form=stock-in-infor-tab".
  assert.deepEqual(parseLocatorSpec('testid=form=stock-in-infor-tab'), { testId: 'form=stock-in-infor-tab' });
});

test('parseLocatorSpec reads a trailing index as nth', () => {
  assert.deepEqual(parseLocatorSpec('css=.ant-tabs-tab[2]'), { css: '.ant-tabs-tab', nth: 2 });
  // No index means "must be unique" — nth stays absent rather than defaulting to 0.
  assert.equal('nth' in parseLocatorSpec('css=.ant-tabs-tab'), false);
});

test('parseLocatorSpec nests scoping segments left to right', () => {
  const spec = parseLocatorSpec('css=.ant-tabs-tabpane-active >> id=input-search-overpaid-page');
  assert.deepEqual(spec, {
    domId: 'input-search-overpaid-page',
    within: { css: '.ant-tabs-tabpane-active' },
  });
});

test('parseLocatorSpec rejects malformed input instead of guessing', () => {
  assert.throws(() => parseLocatorSpec('input-search-overpaid-page'), /must be <strategy>=<value>/);
  assert.throws(() => parseLocatorSpec('xpath=//div'), /Unknown locator strategy "xpath"/);
  assert.throws(() => parseLocatorSpec('   '), /Empty locator string/);
});

test('describeLocator round-trips the canonical string form', () => {
  const round = (s: string): string => describeLocator(parseLocatorSpec(s));
  assert.equal(round('id=input-search-overpaid-page'), '#input-search-overpaid-page');
  assert.equal(round('role=button[name="Đăng nhập"]'), 'role=button[name="Đăng nhập"]');
  assert.equal(
    round('css=.ant-tabs-tabpane-active >> id=input-search-overpaid-page'),
    'css=.ant-tabs-tabpane-active >> #input-search-overpaid-page',
  );
  assert.equal(round('css=.ant-tabs-tab[2]'), 'css=.ant-tabs-tab[2]');
});
