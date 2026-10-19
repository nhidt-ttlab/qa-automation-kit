/**
 * Records which requests the guards deliberately aborted, so the rest of the UI layer can
 * tell "we blocked this on purpose" from "the app failed".
 *
 * Matching on `request.failure().errorText === 'net::ERR_BLOCKED_BY_CLIENT'` would mostly
 * work, but it conflates our aborts with a real ad-blocker-style failure and depends on a
 * Chromium error string. A registry the guard writes to is exact.
 *
 * Without this, a correctly-guarded run reports failed requests it caused itself:
 * `checkNoFailedRequests` would fail, and the evidence table would carry status-0 rows for
 * calls that never should have been made.
 *
 * ===========================================================================================
 * ⭐ `body` — THỨ TRANG ĐỊNH GỬI, ĐỌC XONG RỒI VỨT
 * ===========================================================================================
 * Thêm 2026-09-06 cho `plan-vai-tro-phan-quyen-scenario-scripts.md` §3.5.
 *
 * Nhiều rule của tầng giao diện **chỉ quan sát được ở thân request**: "tích một ô con thì ô cha
 * cũng được gửi kèm", "bỏ quyền mặc định thì cả dòng bị gỡ", "không có nút Lưu ⇒ mỗi lần tích là
 * một lần ghi". Trước thay đổi này, registry chỉ ghi `{url, method, reason}` nên mọi case như vậy
 * phải để `NOT_EVALUATED` — không phải vì rule chưa chốt, mà vì **harness không nhìn được payload**.
 *
 * 🔴 **Đây KHÔNG phải nới quyền ghi.** Request vẫn bị `route.abort()` y hệt như cũ, tại đúng chỗ cũ,
 * trước khi một byte nào lên dây. Chỉ có một việc thêm: đọc `request.postData()` — thứ Playwright
 * đã giữ sẵn trong bộ nhớ — rồi lưu lại. Không có đường nào từ trường này quay ngược ra mạng.
 *
 * ⚠️ `postData()` trả `null` khi request không có thân (mọi `GET`), khi thân là binary/multipart mà
 * Playwright không giải mã được, hoặc khi thân quá lớn. `null` vì vậy có nghĩa **"không đọc được"**,
 * *không* có nghĩa "trang gửi rỗng" — scenario nào lấy `body` làm oracle phải phân biệt hai điều đó,
 * nếu không nó biến một phép đo hỏng thành một `FAIL` sai.
 *
 * 🚫 Không bao giờ đưa `body` vào log hoặc `steps.data` mà không lọc: thân của `/connect/token` hay của
 * form đăng nhập mang mật khẩu. Guard không đọc thân của request tới `web.authPaths` và `web.loginPath`
 * (`carriesCredentials` trong `guards.ts`) — chúng vào registry này với `body: null`, kể cả khi bị chặn
 * — và đó là điều **phải giữ nguyên** nếu ai đó sửa guard sau này.
 */

/** Một request đã bị guard huỷ, kèm thân mà trang định gửi. */
export interface BlockedRequestRecord {
  url: string;
  method: string;
  reason: string;
  timestamp: string;
  /**
   * Thân request đọc từ `request.postData()` **trước** khi huỷ.
   *
   * `null` = không đọc được (request không có thân, hoặc binary/multipart, hoặc quá lớn), hoặc guard
   * cố ý không đọc vì thân mang thông tin đăng nhập.
   * Phân biệt với chuỗi rỗng `''` = trang gửi thân rỗng thật.
   */
  body: string | null;
}

export class BlockedRequestRegistry {
  private readonly keys = new Set<string>();
  private readonly records: BlockedRequestRecord[] = [];

  private static key(method: string, url: string): string {
    return `${method} ${url}`;
  }

  /**
   * `body` là tham số **tuỳ chọn** và mặc định `null`, nên mọi nơi gọi cũ (`guards.ts` bản trước,
   * probe, unit test) vẫn biên dịch và vẫn chạy đúng như cũ.
   */
  record(method: string, url: string, reason: string, body: string | null = null): void {
    this.keys.add(BlockedRequestRegistry.key(method, url));
    this.records.push({ url, method, reason, timestamp: new Date().toISOString(), body });
  }

  has(method: string, url: string): boolean {
    return this.keys.has(BlockedRequestRegistry.key(method, url));
  }

  list(): BlockedRequestRecord[] {
    return [...this.records];
  }
}
