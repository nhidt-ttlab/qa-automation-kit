# Schema của spec.json

File `spec.json` là đầu vào của `scripts/build_checklist.py`.

---

## 1. Cấu trúc tổng thể

```json
{
  "meta": {
    "project_name": "<Tên dự án>",
    "project_code": "<MA_DU_AN>",
    "version": "1.0",
    "test_environment": "<URL môi trường test>"
  },
  "sheets": [
    {
      "sheet_name": "HopDong_DuAn",
      "title": "Hợp đồng mua hàng (Trong dự án) - Business Rule Checklist",
      "screen": "Hợp đồng (Dự án)",
      "screen_code": "HOPDONG",
      "extended": false,
      "tab_color": "FF2E75B6",
      "epic": "Quản lý dự án",
      "module_name": "Hợp đồng mua hàng (Trong dự án)",
      "pic": "<Tên QA phụ trách>",
      "status": "Not Started",
      "note": "Hardening - business rule only",
      "groups": [
        {
          "name": "A. THÔNG TIN CHUNG HỢP ĐỒNG",
          "cases": [
            {
              "category": "Thông tin chung",
              "sub_category": "Số hợp đồng",
              "rule": "Số hợp đồng là mã định danh duy nhất — validate trùng",
              "test_data": "Nhập lại số HĐ đã tồn tại",
              "expected": "Message: \"Số hợp đồng XXX đã tồn tại\"; không cho lưu",
              "impact": "Trùng số HĐ → không truy vết được HĐ áp dụng cho đơn hàng, sai đối chiếu công nợ",
              "priority": "P1",
              "note": "Cần confirm (QA_HOPDONG_001): unique theo dự án hay toàn hệ thống"
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 2. Trường ở cấp `sheet`

| Key | Bắt buộc | Ý nghĩa |
|---|---|---|
| `sheet_name` | ✅ | Tên sheet trong Excel. Không dấu, không ký tự đặc biệt |
| `title` | | Tiêu đề in ở ô A1 |
| `screen` | | Giá trị mặc định cột Screen; case có thể override bằng key `screen` riêng |
| `screen_code` | | Tiền tố Case ID (vd `HOPDONG` → `TC_HOPDONG_001`). Không khai thì script tự sinh từ `screen` |
| `extended` | | `true` → **chèn thêm** 2 cột **Case ID** (sau `#`) và **Precondition** (sau Business Rule) vào layout template. Mặc định `false` → dùng đúng bộ cột của template (hiện là 12 cột). Số cột base do template quyết định, không cố định trong script |
| `scope_note` | | Ghi chú phạm vi ở ô A2. Không khai thì dùng câu mặc định về phạm vi hardening |
| `tab_color` | | Mã ARGB 8 ký tự (`FF` + RRGGBB) |
| `epic`, `module_name`, `pic`, `status`, `note` | | Dùng để điền sheet `FunctionList` |
| `groups` | ✅ | Danh sách nhóm case |

> **Dropdown cột Test result.** Nếu template có cột `Test result`, script tự gắn dropdown
> `Pass / Fail / Not test / Pending / Blocked / Testing` + tô màu theo giá trị (dùng
> conditional formatting nên chạy được cả trên Excel lẫn Google Sheets). Muốn đổi danh sách
> trạng thái / màu, khai ở cấp `meta`:
> ```json
> "meta": {
>   "test_result_options": [
>     ["Pass", "017F41", "FFFFFF"],
>     ["Fail", "B30000", "FFFFFF"],
>     ["Not test", "E7E9ED", "000000"],
>     ["Pending", "FEC6A4", "000000"],
>     ["Blocked", "753200", "FFFFFF"],
>     ["Testing", "3B38B2", "FFFFFF"]
>   ]
> }
> ```
> Mỗi phần tử là `[nhãn, mã nền RRGGBB, mã chữ RRGGBB]` (mã chữ tùy chọn, mặc định đen).

---

## 3. Trường ở cấp `case`

| Key | Bắt buộc | Ghi vào cột |
|---|---|---|
| `category` | ✅ | Category — tên tab/khối |
| `sub_category` | ✅ | Sub-Category — tên trường/rule |
| `rule` | ✅ | Business Rule / Checklist |
| `expected` | ✅ | Expected Result |
| `impact` | ✅ | Impact |
| `priority` | ✅ | Priority — chỉ nhận `P1` / `P2` / `P3` |
| `test_data` | | Test Data. Không có thì ghi `"N/A"` |
| `note` | | Note. Chứa chuỗi `Cần confirm` → script tự tô vàng |
| `precondition` | | Chỉ được ghi ra khi `extended: true` (cột Precondition chỉ xuất hiện ở chế độ extended) |
| `id` | | Chỉ dùng khi `extended: true`. Không khai thì script tự sinh `TC_<SCREEN_CODE>_<SEQ>` |
| `screen` | | Override cột Screen cho riêng case này |

---

## 4. Ví dụ chế độ extended (template 12 cột + Case ID + Precondition = 14 cột)

```json
{
  "sheet_name": "DonHang_DuAn",
  "screen": "Đơn hàng (Dự án)",
  "screen_code": "DONHANG",
  "extended": true,
  "groups": [
    {
      "name": "E. LUỒNG TRẠNG THÁI & QUYỀN THAO TÁC",
      "cases": [
        {
          "category": "Trạng thái & quyền",
          "sub_category": "Hoàn lũy kế khi Hủy đơn",
          "rule": "Khi đơn hàng bị Hủy, lũy kế KL đặt hàng của vị trí liên quan phải được hoàn trừ đúng phần KL của đơn hàng đó",
          "precondition": "Vị trí X đã có đơn hàng đợt 1 (KL 500) và đợt 2 (KL 300), cả hai ở trạng thái Đã duyệt",
          "test_data": "Hủy đơn hàng đợt 1 (KL 500)",
          "expected": "Lũy kế KL đặt hàng của vị trí X giảm từ 800 xuống 300; KL định mức còn được đặt tăng lại đúng 500",
          "impact": "Không hoàn lũy kế → KL định mức còn lại bị tính thiếu → chặn nhầm đơn hàng hợp lệ hoặc cho đặt vượt định mức thực tế",
          "priority": "P1"
        }
      ]
    }
  ]
}
```

→ Case ID tự sinh: `TC_DONHANG_001`.

---

## 5. Ghi chú quan trọng

- **Không để chuỗi bắt đầu bằng `=`.** Excel sẽ hiểu là công thức và trả `#N/A`.
  Viết `"Công thức: Đơn giá * KL"` thay vì `"= Đơn giá * KL"`. Quality Gate của script báo
  ERROR cho chuỗi của case bắt đầu bằng `=`; kiểm nhanh trước khi gen:
  `grep -n '"=' spec.json` — không được có kết quả nào.
- Không có file template `.xlsx` trong `assets/` (và không truyền `--template`) → script cảnh
  báo và dựng workbook trống với bộ cột fallback 12 cột, không có sheet `FunctionList`.
- Cột `#` do script sinh bằng công thức `=ROW()-4`, không khai trong JSON.
- Sheet `FunctionList` được điền từ dòng 9, mỗi sheet checklist 1 dòng; cột Total dùng
  `COUNTA` nên tự cập nhật khi thêm/bớt case.
- Với bộ case lớn (>100), **viết 1 script Python sinh `spec.json`** thay vì gõ tay JSON —
  dễ rà soát, dễ sửa theo nhóm, dễ đếm P1.

---

## 6. Lệnh chạy

```bash
# Gen bình thường (vẫn xuất file kể cả khi Quality Gate có lỗi)
python3 scripts/build_checklist.py spec.json -o DonHang_IT_TestChecklist.xlsx

# Gen ở chế độ nghiêm ngặt — dừng nếu có lỗi Quality Gate
python3 scripts/build_checklist.py spec.json -o DonHang_IT_TestChecklist.xlsx --strict

# Dùng template khác
python3 scripts/build_checklist.py spec.json -o out.xlsx --template path/to/template.xlsx

# Giữ lại sheet Common của template
python3 scripts/build_checklist.py spec.json -o out.xlsx --keep-common
```

Script in ra JSON tóm tắt: tổng case, số P1/P2/P3, số dòng `Cần confirm`, số lỗi/cảnh báo
Quality Gate.
