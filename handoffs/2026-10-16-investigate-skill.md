# Handoff 2026-10-16 — Skill `investigate`: chẩn đoán lỗi chỉ đọc, không sửa code

> **Bối cảnh:** skill `investigate` (chẩn đoán root cause + đề xuất cách sửa, không Edit/Write) đang chỉ có ở mức user
> (`~/.claude/skills/investigate`), viết riêng cho một workspace và gọi thẳng GitNexus. Đưa nó vào kit để mọi dự án dùng
> kit cài được bằng `qakit skills install`.
>
> **Trạng thái:** nhánh `feature/investigate-skill`, base `main` @ `6a06629fd3`, push và mở MR bằng `/handoff-pr`.
> MR này merge **trước** MR của superproject (`dms-workspace`, cùng tên nhánh) trỏ submodule tới commit của nhánh này.

## 1. Đã làm

- `skills/investigate/SKILL.md` (mới) + `skill.json` (`{ "templates": [] }`). Giữ nguyên luật cứng của bản user (không
  `Edit`/`Write`/`NotebookEdit`, không lệnh làm đổi working tree) và template báo cáo 4 mục: Root cause / Evidence /
  Proposed solution / Risk / blast radius. Khác bản user:
  - Mục **Project settings** như các skill khác của kit: đọc `qakit.config.yaml` (`paths.knowledge`, `paths.steps`,
    `paths.suites`) và knowledge file tuỳ chọn `<paths.knowledge>/investigate.md` (chỗ ghi log, cách tái hiện, code graph
    dự án dùng, lỗi môi trường / test flaky đã biết).
  - Bỏ phần gắn cứng GitNexus: dùng code graph mà `CLAUDE.md` hoặc thư mục index của dự án chỉ ra; không có thì grep và
    nói rõ trong báo cáo.
  - Mục mới **When The Symptom Is A Failed Test Run**: đọc report / JSON artifact / evidence của lần chạy → step doc →
    `*.scenario.ts` → chạy lại đúng test case (`npx qakit suite --testcase <TC-ID>`), rồi phân loại: product bug, spec
    change, script drift, test data / state, environment, flaky — mỗi loại chỉ ra chỗ phải sửa. Cấm đề xuất "sửa script
    cho xanh" với product bug hay spec change.
  - Chạy lại test để quan sát được phép, nhưng phải chạy như suite vẫn chạy: không đổi env flag, công tắc ghi, test data
    hay config.
- `ADOPTING.md`: thêm `investigate` là mục 9 trong danh sách skill của pipeline (`handoff-pr` thành 10).
- `docs/usage-guidelines.md`: thêm một dòng vào bảng Quick reference.

## 2. Đã verify

- `npx tsx --test test/no-project-strings.test.ts test/install-skills.test.ts` → **5/5 pass** (sau `npm run build` để có
  `packages/core/dist`; trước khi build, `install-skills.test.ts` lỗi `ERR_MODULE_NOT_FOUND` cả trên cây sạch).
- Cài thật: `npx tsx scripts/install-skills.ts --config <qakit.config.yaml của một dự án> --target <scratch> --only investigate`
  → `installed investigate`; thư mục đích có `SKILL.md` và `.qakit-skill.json`, không có `skill.json`.
- `pnpm test` toàn bộ: **194/202 pass, 8 fail** — **giống hệt trên cây sạch** (đã `git stash -u` rồi chạy lại: 194/202, cùng
  8 file). Cả 8 lỗi là `ERR_MODULE_NOT_FOUND` (`@modelcontextprotocol/sdk`, `openapi-types`) do checkout này cài thiếu
  dependency; không liên quan thay đổi này.
- GitNexus `detect-changes --scope all` trong `dms-workspace`: "Diff touched 4 file(s) but no indexed symbols overlap those
  hunks" — 4 file đó là con trỏ submodule của superproject; index gắn với superproject không nhìn vào trong kit. Thay đổi
  chỉ gồm Markdown/JSON, không có symbol nào.

## 3. Chưa verify

- Chưa dùng skill trên một lỗi thật sau khi cài vào dự án.
- `pnpm build` dừng ở `packages/mcp-ui` (thiếu `@modelcontextprotocol/sdk` trong checkout này) — có sẵn từ trước.

## 4. Còn phải làm

1. Dự án nào đã có skill `investigate` ở mức user sẽ thấy hai skill trùng tên sau khi `npm run skills`: xoá một bản, hoặc
   đổi tên bản của kit bằng `extensions.skillNames`.
2. Dự án muốn tận dụng hết skill nên viết `<paths.knowledge>/investigate.md` (log ở đâu, cách tái hiện, code graph, lỗi môi
   trường / flaky đã biết).
