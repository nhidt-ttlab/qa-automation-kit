# Handoff 2026-10-15 — URL giữ base path; env của scenario đọc trực tiếp process.env

> **Bối cảnh:** một dự án dùng kit chạy suite trên môi trường có API nằm sau một path prefix (`https://host/be`) và token
> truy cập chỉ sống 300 s. Hai lỗi chung của kit lộ ra.
>
> **Trạng thái:** nhánh `feature/desktop-sync-sit-iam-env`, base `main` @ `c2957f3d8e`, push và mở MR bằng `/handoff-pr`.
> MR này merge **trước** MR của superproject trỏ submodule tới commit của nhánh này.

## 1. Vấn đề

1. `HttpClient.prepare` dựng URL bằng `new URL(path, source.baseUrl)`. Với `baseUrl` có path (`https://host/be`) và
   `path` tuyệt đối (`/items`), kết quả là `https://host/items` — mất `/be`. Mọi lời gọi qua `ctx.http` nhận 404, và các
   scenario báo BLOCKED với lý do sai.
2. `runSuiteCli` chụp `{ ...process.env }` **một lần** cho cả batch. Token `static-bearer` mà entrypoint của dự án làm mới
   trong `process.env` không bao giờ tới các scenario sau; với token 300 s, sau khoảng 5 phút mọi lời gọi của kit đều 401.

## 2. Đã làm

- `packages/core/src/http/http-client.ts`: hàm mới `resolveAgainstBase(path, baseUrl)` — nối `path` vào **sau** path của base
  (`/orders` trên `https://host/api` → `https://host/api/orders`); URL tuyệt đối (`https://…`) giữ nguyên. `prepare` dùng nó.
- `packages/runner/src/cli.ts`: hàm mới `liveEnv(layer, base = process.env)` — một Proxy: đọc giá trị **hiện tại** của
  `process.env`; các khoá riêng của scenario (`QAKIT_UI_HEADLESS`, `QAKIT_UI_SLOWMO_MS`) và mọi lần ghi nằm ở lớp riêng;
  spread (`{ ...env }`) chép cả hai. Mỗi scenario nhận một `liveEnv` mới.
- Test: `http-client.test.ts` ("keeps the path prefix of a base URL"), `cli.test.ts` ("liveEnv …").

## 3. Đã verify

- `pnpm test` **234/234**; `pnpm typecheck` sạch; `pnpm build` sạch.
- Chạy thật trong dự án dùng kit (API sau `/be`, token 300 s): sau sửa (1) các lời gọi `ctx.http` trả đúng 200 thay vì 404;
  sau sửa (2) các scenario từng BLOCKED vì 401 chạy được.

## 4. Cố ý KHÔNG làm

- Không có trap `deleteProperty` trong `liveEnv`: không code nào xoá khoá khỏi env của scenario (đã grep).
- Không đổi kiểu auth `static-bearer` (vẫn đọc `context.env` lúc `authorize()`); `liveEnv` là đủ.

## 5. Còn phải làm / verify

1. Một scenario dài hơn tuổi thọ token chỉ được cứu nếu entrypoint của dự án làm mới token trong `process.env` trong lúc
   chạy; kit không tự làm mới `static-bearer`.
2. Dự án có `baseUrl` trỏ vào path mà vẫn cố ý gọi path gốc của host (nếu có) sẽ đổi hành vi.
