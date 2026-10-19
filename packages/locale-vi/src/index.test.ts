import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UiPolicy } from '@qakit/mcp-ui';
import { createUiChecks } from '@qakit/ui';
import { locale, viDestructiveLabel, viUiCheckText, viUiMcpText } from './index.js';

const policy = new UiPolicy({
  web: { baseUrl: 'https://app.example.test', loginPath: '/login', allowedHosts: ['app.example.test'] },
  destructiveLabel: viDestructiveLabel,
  text: viUiMcpText.deny,
});

test('destructive-looking controls are denied in Vietnamese and English', () => {
  const labels = [
    'Xóa đơn hàng',
    'Xoá dòng', // same word, tone on the other vowel
    'Huỷ phiếu',
    'Hủy đơn',
    'Duyệt đơn hàng',
    'Gửi duyệt',
    'Xác nhận phiếu', // space between syllables must still match
    'Delete row',
    'Approve',
    'btn-remove-item',
  ];
  for (const label of labels) assert.equal(policy.checkDestructive(label).allowed, false, `${label} must be denied`);
});

test('read-only controls are unaffected', () => {
  for (const label of ['input-search-purchase-order-page', 'Tìm kiếm', 'btn-refresh-overpaid-page', 'Xuất Excel']) {
    assert.equal(policy.checkDestructive(label).allowed, true, `${label} must be allowed`);
  }
});

test('denials and errors read in Vietnamese', () => {
  assert.match(policy.checkNavigation('https://evil.com/').reason ?? '', /không nằm trong allowedHosts/);
  assert.equal(viUiMcpText.errors.noSession, 'Chưa mở phiên trình duyệt. Gọi ui_open_session trước.');
  assert.deepEqual(viUiMcpText.finishKeyData('run-1', 2), ['Phiên do agent điều khiển (runId run-1)', 'Số điểm kiểm tra: 2']);
});

test('the locale pack exposes everything the servers load', () => {
  assert.equal(locale.uiMcpText, viUiMcpText);
  assert.equal(locale.destructiveLabel, viDestructiveLabel);
  assert.equal(locale.uiDriverText?.defaultConfirmLabel, 'Đồng ý');
  assert.equal(locale.uiCheckText, viUiCheckText);
});

test('UI checks report in Vietnamese and match rows under Vietnamese collation', () => {
  const checks = createUiChecks(viUiCheckText);
  assert.equal(checks.checkContiguousSequence([], 1, 'STT', 'TC / A1').actual, 'lưới không có dòng nào');
  assert.equal(checks.checkAllContain(['THÁP A', 'tháp b'], 'Tháp', 'Lọc', 'TC / A2').passed, true);
  const [fields, messages, noWrite] = checks.checkFormBlocksSave({
    formErrors: { unitFrom: ['Bắt buộc'] },
    blockedRequests: [{ method: 'POST', url: 'https://app.example.test/api/x/create' }],
    expectedFields: ['unitTo', 'unitFrom'],
    messageLevel: 'page',
    expectedMessageCount: 1,
    testIds: { fields: 'TC / A3', messages: 'TC / A4', noWrite: 'TC / A5' },
  });
  assert.equal(fields?.expected, 'ô báo lỗi: unitFrom, unitTo');
  assert.equal(messages?.actual, '0 thông điệp ở cấp trang (modal/toast/hộp thoại)');
  assert.equal(noWrite?.actual, '1 request ghi: POST https://app.example.test/api/x/create');
});
