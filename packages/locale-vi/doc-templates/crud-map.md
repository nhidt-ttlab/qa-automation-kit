# Template: `CRUD-MAP.md`

Output của pass khám phá CRUD/Validation: bước lập bản đồ (liệt kê mọi màn có form từ tài liệu nguồn)
cộng bước probe màn thật (quan sát control thật). Một file cho mỗi module, đặt tại
`<paths.steps>/ui/<thư mục module>/CRUD-MAP.md`, với `<thư mục module>` là
`<module.stepDir ?? module.docSlug ?? module.id>`. Roadmap của pass này (nếu dự án có) được dẫn trong
`<paths.knowledge>/doc-templates.md`.

**Đây chưa phải step matrix.** Nó là bản đồ *có gì để test* + *nhắm vào đâu*, để pass viết step
không phải mở lại 20 file nguồn. Không viết assertion, không viết bước, không đặt ID testcase ở đây.

**Luật cứng**: mọi selector và mọi cờ bắt buộc phải **quan sát được** — từ probe màn thật hoặc từ mã
nguồn web app — hoặc ghi `[cần xác nhận]`. Selector bịa theo quy ước đặt tên trông rất đúng
lúc review và vỡ lúc chạy.

---

## 1. Phạm vi

| | |
|---|---|
| Module | `<tên module>` |
| Tài liệu nguồn | `<paths.featureDocs>/<module.docSlug ?? module.id>/` |
| FeatureID | `modules[].featureCodes` |
| Host API | khoá trong `apiSources` mà các màn gọi tới |
| Số màn có form | |
| Probe chạy ngày | |
| Dự án / fixture dùng để probe | ví dụ `projectId=…` (`--project-keyword …`) |

## 2. Màn hình có CRUD

Một dòng cho mỗi màn. `Đường dẫn` là app-relative path đã **quan sát được** là mở lên đúng màn —
không phải suy từ bảng route.

| # | Màn hình | Đường dẫn | Thành phần render | Thêm | Sửa | Xoá | Import | Nguồn spec |
|---|---|---|---|---|---|---|---|---|
| 1 | | `/…` | `<Component>` | `/…/them` | `/…/:id` | nút/xác nhận | `/…/import` | [file#anchor](…) |

**Ghi chú kiến trúc** — nêu rõ màn này dùng shell dùng chung hay component riêng. Nếu dùng chung
(một trang tạo/sửa + form chung, cấu hình theo từng entity), nói rõ: các case CRUD của màn này
**tham số hoá theo `entityKey`**, không viết lại từ đầu cho từng danh mục.

## 3. Trường của từng form

Một bảng cho mỗi form. Cột `Bắt buộc (app)` lấy từ dấu bắt buộc của thư viện form **do probe đọc được**;
cột `Bắt buộc (spec)` lấy từ tài liệu nguồn. **Hai cột lệch nhau là một phát hiện, không phải lỗi
gõ** — ghi vào §6.

### 3.x `<tên form>` — `<đường dẫn>`

| Nhãn hiển thị | `id` control | Kiểu | Bắt buộc (app) | Bắt buộc (spec) | SpecID | Rule validation nguồn ghi được |
|---|---|---|---|---|---|---|
| | `field-id` | select/number/text/datepicker/checkbox | ✅/— | ✅/— | `XX-nn` | |

**Nút hành động** (chép nguyên văn `id`/`data-testid` từ probe):

| Nút | `id` | `data-testid` |
|---|---|---|
| Lưu | | |
| Huỷ bỏ | | |
| Quay lại | | |

## 4. Ứng viên testcase

Ma trận nhóm case áp lên từng màn: `C-n` cho luồng CRUD end-to-end qua form (tạo mới đủ trường, tạo mới
chỉ trường bắt buộc, sửa rồi mở lại, xoá có xác nhận, thoát form đang nhập dở, điều hướng + lưới refresh
sau lưu) và `D-n` cho validation tại form (bỏ trống trường bắt buộc, ràng buộc chéo trường, định dạng /
miền giá trị, trùng / duy nhất, trạng thái control, lỗi server hiển thị lên form). **Chưa đặt ID
testcase** — pass chốt danh mục case mới đặt. Cột `Chạy được ngay?` trả lời: case này có cần mở quyền
ghi dữ liệu trước không.

| Màn | Nhóm | Case | Chạy được ngay? | Ghi chú / dữ liệu tiền đề |
|---|---|---|---|---|
| | `D-1` | Bỏ trống `<field>` ⇒ chặn lưu | ✅ chỉ-đọc | |
| | `C-1` | Tạo mới thành công | ❌ chờ quyền ghi | |

**Case bị loại theo gate trùng lặp** — một case bị loại khi assertion của nó phát biểu được bằng
request/response mà không cần trình duyệt. Bỏ im lặng là mất dấu vết:

| Case định viết | Vì sao loại |
|---|---|
| | |

## 5. Chặn / thiếu dữ liệu

| # | Vấn đề | Ảnh hưởng case nào | Cần gì để gỡ |
|---|---|---|---|
| | | | |

Chặn nào trùng với bảng "Chặn chung" của module (file `CHECKLIST.md` cạnh file này, hoặc file được nêu
trong knowledge file) thì **trỏ về số hiệu ở đó**, đừng chép lại nội dung.

## 6. Lệch giữa spec và ứng dụng

Mục quan trọng nhất của file này. Mỗi dòng là một câu hỏi cho BA, hoặc một lỗi sản phẩm.

| Điểm lệch | Spec nói | Ứng dụng làm | Đề xuất |
|---|---|---|---|

## 7. Cách tái lập probe

Chạy probe screen-controls của dự án (lệnh ghi trong knowledge file) với một file targets, hoặc probe
từng màn bằng `mcp__<mcp.uiServerName>__ui_open_screen` + `mcp__<mcp.uiServerName>__ui_describe_screen`.

```
<lệnh probe screen-controls> --targets <targets.json> --out <outDir>
```

Đính kèm nguyên văn `targets.json` đã dùng, để người sau chạy lại ra đúng tập màn.
