# Handoff 2026-10-16 — create-feature-extraction chia file theo capability area, không theo tên file nguồn

> **Bối cảnh:** chạy `create-feature-extraction` trên một bộ tài liệu thiết kế (SRS/architecture, không có màn hình) cho ra
> một file extraction cho mỗi file nguồn (`01-architecture.md` từ `ARCHITECTURE.md`, `02-engineering-agents.md` từ
> `ENGINEERING_AGENTS.md`…) và một tiền tố SpecID cho mỗi file nguồn (`ARC`, `ENG`, `ORC`…). Inventory phía sau phải sắp
> lại từng SpecID theo chức năng bằng tay.
>
> **Trạng thái:** nhánh `feature/feature-extraction-capability-area-split`, base `main` @ `6a06629fd3`, push và mở MR bằng
> `/handoff-pr`. MR này đứng riêng: superproject chưa có commit nào ghi submodule này, nên không có MR bump pointer đi kèm.

## 1. Vấn đề

Bước 3 của skill mặc định "một file cho mỗi sub-group heading / screen section". Với nguồn tổ chức theo màn hình thì đúng.
Với nguồn tổ chức theo loại tài liệu (kiến trúc, data model, tích hợp, storage…), không có màn hình nào, nên quy tắc này
rơi về "một file cho mỗi tài liệu nguồn" — tái tạo mục lục của tác giả thay vì các chức năng của hệ thống.

## 2. Đã làm

- `skills/create-feature-extraction/SKILL.md`:
  - Bước 3: file được chia theo **capability area**, không bao giờ theo file nguồn. Nguồn theo màn hình giữ nguyên hành vi
    (màn hình chính là area). Nguồn không theo màn hình phải dựng **capability-area map** trước: `--list` mọi section, gán
    mỗi section cho đúng một area đặt tên theo việc hệ thống làm, chốt map với user, rồi mỗi area một file (gom section từ
    nhiều tài liệu). Thêm mục "Never": đặt tên file theo file nguồn, một tiền tố SpecID cho mỗi tài liệu nguồn.
  - SpecID sinh ra đánh số liên tục theo **thứ tự output** (area theo thứ tự file), mỗi file một dải liền.
  - `00-index.md`: bảng mapping thành capability-area map, mỗi dòng một section nguồn, đủ theo cấu trúc. Extraction decisions
    ghi lý do cho section nằm giữa hai area.
  - Bước 5: file area gom nhiều section mở đầu bằng bảng nguồn; tên area là scaffolding, heading bên dưới vẫn nguyên văn.
  - Bước 1: nguồn không có feature code thì các area chính là feature list (`F01`…, khai báo là sinh ra).
  - Self-check thêm một mục kiểm tra chia theo area. "per-screen file" → "per-area file" trong toàn skill.
- `skills/create-feature-extraction/scripts/profile-spec.cjs`: cờ mới `--start <n>` — số đầu tiên của SpecID sinh ra
  (mặc định 1), để profile từng section mà vẫn giữ một dải đánh số liên tục cho cả bộ. Áp dụng cho cả CSV và Markdown;
  giá trị không phải số nguyên dương bị từ chối (exit 2).

## 3. Đã verify

- `pnpm test` **234/234** pass.
- GitNexus `impact` upstream trên `profileMarkdown` và `profileCsv`: risk LOW, 1 caller trực tiếp mỗi hàm.
  `detect_changes --scope all`: risk low, 0 symbol bị ảnh hưởng.
- Chạy tay profiler:
  - Markdown `--section "5. Credentials and configuration" --prefix AIA` → `AIA-1…AIA-5`; thêm `--start 38` → `AIA-38…AIA-42`.
  - CSV 2 dòng item với `--start 10` → `X-10…X-11`; qua shim `profile-csv.cjs` cũng nhận cờ.
  - `--start 0` → `--start must be a positive integer.`, exit 2.
- `qakit skills install` vào một dự án dùng kit: bản cài khớp nguồn (bỏ qua khác biệt CRLF).

## 4. Cố ý KHÔNG làm

- Không cắt lại bộ extraction đang có của dự án đã lộ ra lỗi; đó là việc của dự án, chạy lại skill sau khi MR này merge.
- Không thêm test tự động cho `--start`: profiler không có test hiện tại trong `test/`.

## 5. Còn phải làm / verify

1. Chạy lại skill trên một nguồn không theo màn hình và kiểm tra capability-area map trong `00-index.md` phủ đủ mọi section
   của `--list`.
2. Cân nhắc thêm test cho `profile-spec.cjs` (ít nhất `--start` và tái dùng id gốc của nguồn).
