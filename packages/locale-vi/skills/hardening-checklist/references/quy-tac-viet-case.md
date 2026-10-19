# Quy tắc viết case checklist

Nguồn: bộ `TESTCASE_GENERATION_RULES` của team, đã lược bỏ phần thuần UI và chuyển sang
định dạng checklist hardening (layout cột lấy trực tiếp từ template `Common`).

> **NGUYÊN TẮC BAO TRÙM:** Tuân thủ đúng tài liệu này. Không tự thêm, sửa, tối ưu, suy diễn
> hay tạo ra bất kỳ rule, format, quy ước đặt tên, coverage hay nội dung nào không được định
> nghĩa ở đây. Nếu thiếu thông tin → tạo mục `Cần confirm`, không tự bịa.

---

## 1. Schema 1 dòng checklist

Layout cột **lấy từ sheet `Common` của template** (không cố định trong script). Template chuẩn
hiện có 12 cột — trong đó phần nội dung QA phải điền như sau:

| # | Cột | Bắt buộc |
|---|---|---|
| 1 | `#` | Script tự sinh `=ROW()-…` |
| 2 | Screen | ✅ |
| 3 | Category | ✅ |
| 4 | Sub-Category | ✅ |
| 5 | Business Rule / Checklist | ✅ |
| 6 | Test Data (if needed) | Ghi `N/A` nếu không cần |
| 7 | Expected Result | ✅ |
| 8 | Impact | ✅ |
| 9 | Priority | ✅ P1/P2/P3 |
| 10 | Test result | Script tự gắn dropdown + tô màu; để trống, tester chọn khi chạy |
| 11 | Link redmine | Để trống — điền khi chạy test |
| 12 | Note | Tùy chọn |

Chế độ **extended** (bật bằng `"extended": true` trong spec.json) chèn thêm vào layout template:

- **Case ID** — chèn sau `#`
- **Precondition** — chèn sau Business Rule / Checklist

Chỉ bật extended khi cần trace bug qua nhiều vòng hardening hoặc khi case phụ thuộc trạng
thái dữ liệu phức tạp.

> Nếu team đổi cột trong template (thêm/bớt/đổi tên/đổi độ rộng), file gen ra tự bám theo; chỉ
> khi *đổi tên* cột mới phải thêm alias vào `HEADER_KEY_MAP` trong `scripts/build_checklist.py`.

---

## 2. Quy ước mã

### Case ID (chỉ dùng ở chế độ extended)

Format: `TC_<MÃ_MÀN_HÌNH>_<SEQ 3 chữ số>`

```
TC_HOPDONG_001
TC_DONHANG_001
TC_NHAPKHO_012
```

Mã màn hình viết hoa không dấu, màn hình tên dài thì viết tắt. Script tự sinh nếu case không
khai `id`. Khai `screen_code` ở cấp sheet để kiểm soát tiền tố.

### QA ID — điểm cần BA xác nhận

Format: `QA_<MÃ_MÀN_HÌNH>_<SEQ>`

Ghi ở cột **Note** theo mẫu:

```
Cần confirm (QA_DONHANG_001): unique số đơn hàng theo dự án hay toàn hệ thống?
```

Cột **Expected Result** của case liên quan phải nêu rõ đang chờ chốt, ví dụ:

```
Cần confirm (QA_DONHANG_001) — spec chưa nêu phạm vi unique; chưa viết được kết quả kỳ vọng
```

Script tự tô vàng ô Note chứa chuỗi `Cần confirm`.

> Quy ước này thay cho `Refer QA_xxx` của bộ rule gốc: với checklist hardening, người đọc cần
> thấy ngay ở Expected Result là case chưa chốt, không phải tra sang tài liệu khác.

---

## 3. Category & Sub-Category

**Category = tên tab / khối chức năng thật trên màn hình.** Không dùng tên chung chung.

| ✅ Đúng | ❌ Sai |
|---|---|
| `Thông tin chung` | `Validation` |
| `Danh mục vật tư` | `Testing` |
| `Công thức giá trị` | `Case 1`, `Case 2` |
| `Tiến độ thực hiện` | `Nhóm A` |

**Sub-Category = tên trường hoặc tên rule**, lấy đúng theo tên hiển thị trong spec để trace
ngược được về field-table.

Các case cùng một Sub-Category phải nằm **liên tiếp nhau**, không rải rác.

---

## 4. Viết cột Business Rule / Checklist

**Phát biểu RULE, không phát biểu THAO TÁC.**

| ✅ Đúng | ❌ Sai |
|---|---|
| Chỉ HĐ trạng thái "Đã xác nhận" mới lên list chọn của Đơn hàng | Kiểm tra list chọn hợp đồng |
| KL đặt hàng = KL theo ĐM + ngoài ĐM + mất cost − KL đặt thừa; phải > 0 | Test công thức KL đặt hàng |
| Đơn hàng vượt Cost phải được duyệt bởi 2 vai trò khác nhau | Kiểm tra phê duyệt |

Nhận biết nhanh: nếu câu bắt đầu bằng "Kiểm tra…", "Test…", "Verify…" thì gần như chắc chắn
đang viết thao tác. Script Quality Gate sẽ cảnh báo.

### 6 nhóm rule nên có (rút từ bộ rule gốc, đã bỏ nhóm thuần UI)

| Nhóm | Dùng khi | Mẫu phát biểu |
|---|---|---|
| **Input Validation** | Trường có ràng buộc nhập liệu | `<Trường> chỉ nhận <điều kiện>; vi phạm → <thông báo>` |
| **State Change** | Điều kiện làm đổi trạng thái đối tượng | `<Đối tượng> chuyển sang <trạng thái> khi <điều kiện>` |
| **Business Rule** | Rule nghiệp vụ, công thức | `<Công thức / điều kiện xử lý>` |
| **Data Integrity** | Dữ liệu lưu / trả về sau thao tác | `Sau <thao tác>, <dữ liệu> phải <trạng thái>` |
| **Dependency Logic** | Trường đích phụ thuộc trường nguồn | `<Trường đích> phụ thuộc <trường nguồn>: khi <điều kiện> thì <hành vi>` |
| **Error Handling** | Lỗi hệ thống / API / dữ liệu bất thường | `Khi <lỗi>, hệ thống <xử lý>` |

> Hai nhóm **UI Display** và **Interaction** (hover, focus, expand/collapse) của bộ rule gốc
> đã bị loại khỏi phạm vi hardening. Chỉ giữ interaction nào kéo theo thay đổi nghiệp vụ.

---

## 5. Viết cột Expected Result

**Mục tiêu:** mô tả kết quả **quan sát được** tương ứng đúng với rule đang kiểm.

### Quy tắc

- ✅ Nêu đúng 1 kết quả, kiểm chứng được
- ✅ Với công thức → ghi **kết quả số cụ thể**, không ghi lại công thức
- ✅ Với validate → copy **nguyên văn Error Message** trong spec nếu có
- ✅ Khớp trực tiếp với rule ở cột Business Rule
- ❌ Không lặp lại thao tác đã nêu ở Test Data
- ❌ Không dùng từ mơ hồ

### Từ CẤM trong Expected Result

**Nhóm 1 — cấm ở mọi vị trí:**

```
hoạt động đúng · hoạt động bình thường · hoạt động tốt · hoạt động chính xác
chạy đúng · chạy tốt · chạy bình thường
đúng như mong đợi · như mong đợi · như kỳ vọng
đúng yêu cầu · đúng nghiệp vụ · đúng logic
không có lỗi · không lỗi · không bị lỗi
works correctly · functions properly · behaves as expected · successfully · properly
```

**Nhóm 2 — chỉ cấm khi đứng gần như một mình** (Expected Result ≤ 25 ký tự):

```
thành công · chính xác · đúng · ok · pass · bình thường
```

Script Quality Gate: chứa cụm nhóm 1 và Expected Result < 60 ký tự → **báo lỗi**;
dài hơn 60 ký tự → **cảnh báo** để rà lại. Cụm nhóm 2 đứng một mình → **báo lỗi**.

### Ví dụ

| Business Rule | ✅ Expected Result | ❌ Expected Result |
|---|---|---|
| Thành tiền = Đơn giá × KL đặt hàng | Đơn giá 1.500, KL 20 → Thành tiền hiển thị 30.000 | Tính đúng công thức |
| Số HĐ là duy nhất | Message "Số hợp đồng XXX đã tồn tại"; không cho lưu | Báo lỗi trùng |
| KL đặt thừa ≤ KL dư thừa thực tế | Nhập vượt → chặn lưu, giữ nguyên giá trị cũ | Không cho nhập sai |
| Tỷ giá = 0 | Chặn lưu, message "Tỷ giá phải lớn hơn 0" | Hệ thống hoạt động đúng |

---

## 6. Viết cột Impact

Impact trả lời đúng 1 câu hỏi: **"Sai cái này thì sai tiếp cái gì?"**

- ✅ Nêu **chuỗi tác động dây chuyền**, lấy từ cột "Mức ảnh hưởng nghiệp vụ khi Feature bị lỗi"
  và phần "Data của … được sử dụng cho" trong Feature List
- ❌ Không viết "không dùng được chức năng", "ảnh hưởng người dùng", "sai dữ liệu"

| ✅ Đúng | ❌ Sai |
|---|---|
| Sai lũy kế → cho đặt vượt định mức vị trí → sai chi phí dự án và sai báo cáo tổng hợp vật tư | Sai khối lượng |
| Tỷ giá = 0 → mọi giá trị quy đổi về 0 → sai giá trị nhập kho, sai giá vốn | Không tính được tiền |

Impact là căn cứ trực tiếp để xếp Priority. Impact viết yếu → không xếp được P1/P2/P3.

---

## 7. Viết cột Test Data

- Test Data phải **cụ thể**, tái chạy được. Không có thì ghi `N/A`.
- Rule là khoảng số → luôn kèm **giá trị biên** và các giá trị âm / 0 / null.
- Chuỗi dài viết dạng `[chuỗi 256 ký tự 'A'] (vượt giới hạn 255)`.

| ✅ Đúng | ❌ Sai |
|---|---|
| `Tỷ giá = 0; -1; 1; 25.000` | `Nhập tỷ giá không hợp lệ` |
| `KL đặt hàng = 102, quy cách 10 chiếc/gói` | `Nhập khối lượng` |
| `HĐ-2026-0012` | `Nhập mã hợp lệ` |

---

## 8. Viết cột Precondition (chỉ chế độ extended)

Format: `<Đối tượng> + đang ở + <trạng thái hiện tại>`

- ✅ Chỉ mô tả trạng thái hệ thống **trước khi** test
- ❌ Không chứa thao tác, không chứa kết quả kỳ vọng

| ✅ Đúng | ❌ Sai |
|---|---|
| Đơn hàng đang ở trạng thái "Đang soạn thảo" | Tạo đơn hàng rồi bấm Lưu |
| Vật tư A có KL dư thừa = 500 tại màn kiểm soát dư thừa | KL dư thừa phải bằng 500 |

---

## 9. Anti-Patterns

### 9.1 Không gộp nhiều mục tiêu — 1 case = 1 mục tiêu

❌ Sai: 1 case kiểm cả min, cả max, cả bắt buộc
✅ Đúng: 3 case riêng

### 9.2 Không gộp trạng thái đối lập

❌ Sai: 1 case kiểm cả "hiện" và "ẩn", cả "enable" và "disable"
✅ Đúng: case riêng cho từng trạng thái

### 9.3 Quy tắc tách case theo State Change

**1 case = 1 thao tác + 1 trường + 1 thay đổi trạng thái + 1 kết quả kỳ vọng.**

Bắt buộc tách case khi khác nhau về:

- Thao tác: nhập / chọn / bấm / xác nhận / hủy
- Trạng thái: mở / đóng / cho sửa / không cho sửa
- Giá trị: option A / option B / option C
- Loại kết quả: đổi trạng thái UI **vs** đổi dữ liệu hệ thống
- Logic: khớp đúng / chứa / loại trừ / rỗng / đã tồn tại

**Ví dụ** — trường "Loại hợp đồng" có 3 giá trị (HĐ vật tư / HĐ thiết bị / Xác nhận đơn hàng),
mỗi loại có logic tách đơn khác nhau → **bắt buộc 3 case riêng** cho phần logic tách đơn,
không gộp thành 1 case "kiểm tra tách đơn theo loại HĐ".

---

## 10. Thứ tự sắp case trong mỗi Sub-Category

Áp dụng thứ tự cố định cho mọi trường (đã bỏ bước UI Validation của bộ rule gốc):

```
1. Input Validation   (bắt buộc, min/max, biên, định dạng sai, giá trị hợp lệ)
        ↓
2. State / Interaction nghiệp vụ  (đổi trạng thái, khóa/mở trường theo điều kiện)
        ↓
3. Business Rule      (công thức, điều kiện xử lý, dependency logic)
        ↓
4. Data Integrity     (dữ liệu lưu, dữ liệu trả về, lũy kế, reload)
        ↓
5. Permission         (quyền theo vai trò, theo trạng thái, chặn API)
        ↓
6. Error Handling     (lỗi API, timeout, dữ liệu null/bất thường)
```

## 11. Quy tắc gom nhóm

- ✅ Gom theo: **Màn hình → Tab/Khối (Category) → Trường/Rule (Sub-Category)**
- ❌ KHÔNG gom theo loại test (Validation, Business Logic, Permission…)

**Golden Rule:** viết xong toàn bộ case của 1 Sub-Category rồi mới chuyển sang cái tiếp theo.
