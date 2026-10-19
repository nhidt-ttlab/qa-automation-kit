import { englishUiMcpText, mergeUiMcpText, type UiMcpLocalePack, type UiMcpText } from '@qakit/mcp-ui';
import type { UiCheckText, UiDriverText } from '@qakit/ui';

/**
 * Vietnamese wording of the shared UI checks. These labels and expected/actual values are stored
 * with every run, so changing one changes how existing results compare — edit deliberately.
 */
export const viUiCheckText: UiCheckText = {
  noPageErrorsLabel: 'Không có lỗi JavaScript chưa bắt (pageerror) trong suốt phiên',
  noConsoleErrorsLabel: 'Không có console.error (chỉ có ý nghĩa khi chạy với bản build dev)',
  noFailedRequestsLabel: 'Không có request nào thất bại ở tầng mạng',
  noMatchingRequest: (urlContains) => `không có request khớp ${urlContains}`,
  emptyGrid: 'lưới không có dòng nào',
  contiguous: (count, startsAt) => `1..${count} liên tục từ ${startsAt}`,
  sequenceBreak: (position, expected, actual) => `sai tại vị trí ${position}: mong đợi "${expected}", nhận "${actual}"`,
  allRowsContain: (count, keyword) => `tất cả ${count} dòng chứa "${keyword}"`,
  rowMismatch: (value) => `dòng không khớp: "${value}"`,
  collationLocale: 'vi',
  flaggedFields: (fields) => (fields.length === 0 ? 'không ô nào báo lỗi' : `ô báo lỗi: ${fields.join(', ')}`),
  fieldLevel: 'cấp ô nhập',
  pageLevel: 'cấp trang (modal/toast/hộp thoại)',
  atLeastOneMessage: (level) => `có ít nhất 1 thông điệp ở ${level}`,
  messageCount: (count, level) => `${count} thông điệp ở ${level}`,
  noMessages: (level) => `không có thông điệp nào ở ${level}`,
  flaggedFieldsLabel: 'Đúng những ô mà tài liệu khai là bắt buộc/sai định dạng được đánh dấu lỗi',
  messageCountLabel: (level) => `Số thông điệp báo lỗi hiển thị ở ${level}`,
  noWritesLabel: 'Không có request ghi nào rời khỏi trình duyệt',
  noWrites: 'không có request ghi nào',
  escapedWrites: (count, list) => `${count} request ghi: ${list}`,
};

/** Vietnamese browser step titles — what a Vietnamese QA report shows for each recorded UI step. */
export const viUiDriverText: UiDriverText = {
  goto: (pathname) => `Mở màn hình ${pathname}`,
  click: (target) => `Bấm ${target}`,
  fill: (value, target) => `Nhập "${value}" vào ${target}`,
  press: (key, target) => `Nhấn phím ${key} tại ${target}`,
  selectOption: (optionText, target) => `Chọn "${optionText}" tại ${target}`,
  switchTab: (tabLabel) => `Chuyển sang tab "${tabLabel}"`,
  gotoPage: (pageNumber) => `Chuyển sang trang ${pageNumber}`,
  readText: (target) => `Đọc nội dung ${target}`,
  readSelectValue: (target) => `Đọc giá trị đang chọn tại ${target}`,
  countMatching: (target) => `Đếm số phần tử khớp ${target}`,
  readControlState: (target) => `Đọc trạng thái điều khiển ${target}`,
  pickInModal: (keyword) => `Chọn ${keyword ? `"${keyword}"` : 'dòng đầu tiên'} trong hộp thoại`,
  confirmModal: (label) => `Bấm "${label}" trên hộp thoại`,
  closeModal: 'Đóng hộp thoại nếu đang mở',
  readGrid: (columns) => `Đọc dữ liệu lưới (${columns.join(', ')})`,
  editGridCell: (value, column, rowNumber) => `Nhập "${value}" vào ô ${column} dòng ${rowNumber} của lưới`,
  defaultConfirmLabel: 'Đồng ý',
};

/**
 * Vietnamese and English labels for actions that mutate or approve business records.
 *
 * Vietnamese is written with two tone-placement conventions, so a diacritic can sit on either
 * vowel of a digraph: "hủy" and "huỷ" are the same word, as are "xóa" and "xoá". Each vowel
 * needs its own character class, or half the real button labels slip past.
 */
export const viDestructiveLabel =
  /x[oó][aá]|delete|remove|h[uủ][yỷ]|cancel|duy[eệ]t|approve|submit|x[aá]c\s*nh[aậ]n|g[uử]i\s*duy[eệ]t/i;

/** What the UI MCP server shows an agent, in Vietnamese. Field descriptions stay English except where the UI language matters. */
export const viUiMcpText: UiMcpText = mergeUiMcpText(englishUiMcpText, {
  tools: {
    ui_open_session: 'Mở phiên trình duyệt (Chromium headless) và đăng nhập. Phải gọi trước mọi tool khác.',
    ui_open_screen: 'Điều hướng tới một màn hình theo đường dẫn ứng dụng. Chỉ truy cập được các host trong allowlist.',
    ui_describe_screen:
      'Chụp ảnh ngữ nghĩa màn hình: liệt kê các control tương tác được kèm role, tên, id, testid. ' +
      'Dùng để biết "trên màn hình này có thể làm gì" trước khi gọi ui_act.',
    ui_act:
      'Thực hiện MỘT hành động của người dùng (click/fill/press/select/switchTab/gotoPage/' +
      'pickInModal/confirmModal/closeModal), kèm điều kiện chờ. ' +
      'Trường reason là bắt buộc và được ghi vào nhật ký kiểm toán.',
    ui_read_grid:
      'Đọc dữ liệu lưới theo col-id. LƯU Ý: số dòng trong DOM KHÔNG phải kích thước tập dữ liệu — lưới có thể ảo hoá dòng và phân trang.',
    ui_assert:
      'Ghi nhận một điểm kiểm tra, gắn với mã assertion trong tài liệu test step (ví dụ "TC-XX-U01 / A1"). ' +
      'So sánh dùng === nên hãy chuẩn hoá giá trị trước khi truyền vào.',
    ui_capture_evidence: 'Chụp bằng chứng (ảnh màn hình / DOM) vào kho evidence của phiên, gắn với assertion nếu có.',
    ui_finish_run:
      'Kết thúc phiên: dựng ReportableResult từ các bước và điểm kiểm tra đã ghi, rồi ghi báo cáo Markdown/JSON ' +
      'và lưu vào SQLite — giống hệt một scenario viết tay.',
    ui_close_session: 'Đóng trình duyệt và ghi manifest bằng chứng. passed=false sẽ giữ lại trace và video (retain-on-failure).',
  },
  fields: {
    locatorLabel: 'Form label. NOTE: the app is pinned to Vietnamese',
    locatorText: 'Visible text. Same Vietnamese caveat as label',
    locatorRequired: 'Cần ít nhất một chiến lược định vị (domId, testId, role, label, placeholder, text, css).',
    expectSettled:
      'Chờ các chỉ báo loading của thư viện giao diện biến mất. Thường đúng hơn networkIdle: bảng đã render ' +
      'vẫn có thể hiển thị dữ liệu của lần truy vấn trước khi đang tải lại.',
    actModalPickMode:
      'Cho pickInModal. radio: bảng chọn một. checkAll: chọn toàn bộ trang. exactRow: khớp CHÍNH XÁC từ khoá rồi tick ' +
      'checkbox của dòng đó (tìm kiếm thường là substring). exactCell: bấm thẳng vào ô (bảng không có cột checkbox).',
    actModalKeyword: 'Từ khoá tìm trong hộp thoại; bắt buộc với exactRow/exactCell',
    actConfirmLabel: 'Nhãn nút xác nhận của hộp thoại (mặc định "Đồng ý")',
    assertCheckRefFormat: 'Dạng bắt buộc: "TC-XX-Y01 / A2"',
    assertLabel: 'Business-readable description, in Vietnamese',
    captureLabel: 'Caption, in Vietnamese',
  },
  deny: {
    unparseableUrl: (url) => `Không phân tích được URL "${url}".`,
    hostNotAllowed: (host, allowedHosts) => `Host "${host}" không nằm trong allowedHosts (${allowedHosts.join(', ')}).`,
    destructive: (descriptor) =>
      `Thao tác "${descriptor}" trông giống hành động thay đổi/duyệt dữ liệu. ` +
      'Harness không tự dọn dữ liệu do UI tạo ra, nên thao tác loại này phải được bật tường minh (allowWrites + allowDestructive).',
    secretValue: 'Giá trị chứa thông tin bí mật (mật khẩu/token) — từ chối để tránh lộ qua kết quả tool.',
    actionBudget: (maxActions) => `Đã vượt giới hạn ${maxActions} hành động trong một phiên.`,
    timeBudget: (minutes) => `Đã vượt giới hạn thời gian ${minutes} phút cho một phiên.`,
  },
  errors: {
    noSession: 'Chưa mở phiên trình duyệt. Gọi ui_open_session trước.',
    needTarget: 'Hành động này cần trường target.',
    needValue: 'Hành động này cần trường value.',
    needPageNumber: 'gotoPage cần pageNumber.',
    needModalPickMode: 'pickInModal cần modalPickMode.',
    unsupportedAction: (action) => `Hành động không hỗ trợ: ${action}`,
  },
  sessionWritable: 'CẢNH BÁO: phiên này được phép ghi dữ liệu vào môi trường đích.',
  sessionReadOnly: 'Phiên chỉ đọc: mọi request không phải GET tới ứng dụng đều bị chặn ở tầng route.',
  describeHint: 'Ưu tiên domId, rồi testId. Nhãn hiển thị là tiếng Việt nên tránh dùng label/text làm khoá chính.',
  finishKeyData: (runId, checkCount) => [`Phiên do agent điều khiển (runId ${runId})`, `Số điểm kiểm tra: ${checkCount}`],
});

/** Loaded by the kit's servers when `locale: vi` is set in `qakit.config.yaml`. */
export const locale: UiMcpLocalePack = {
  uiMcpText: viUiMcpText,
  destructiveLabel: viDestructiveLabel,
  uiDriverText: viUiDriverText,
  uiCheckText: viUiCheckText,
};
