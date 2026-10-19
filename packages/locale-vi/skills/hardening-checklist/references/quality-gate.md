# Quality Gate

Ba lớp kiểm soát chất lượng: **Inventory Gate** (trước khi viết), **Reject Conditions**
(script tự chạy khi gen file), **Review Checklist** (tự rà trước khi giao).

---

## 1. Inventory Gate — trước khi viết case

**Không được viết case khi chưa có Inventory.** Mục đích: biết mình còn thiếu gì.

### 1.1 Bảng inventory field/rule

| Tab / Khối | Field / Rule | Loại | Đã có case? | Case tương ứng |
|---|---|---|---|---|
| Thông tin chung | Nhà cung cấp | Bắt buộc + list lọc theo dự án | ☑ | A-02 |
| Công thức giá trị | Tổng giá trị sau VAT | Auto-calculated | ☑ | B-03 |
| Danh mục vật tư | KL đặt thừa | Khoảng giá trị 0..KL dư thừa | ☐ | — |

Dòng nào còn `☐` → chưa hoàn thành, không được gen file.

### 1.2 Quét nghiệp vụ bắt buộc

Với mỗi màn hình, tự trả lời và ghi lại kết quả:

| Câu hỏi quét | Có/Không | Case chứng minh |
|---|---|---|
| Có ô **Auto-calculated**? → mỗi ô 1 case P1 | | |
| Có **lũy kế / tồn kho**? → có case **hoàn lũy kế khi Hủy/Đóng** chưa? | | |
| Có **trạng thái chứng từ**? → có ma trận quyền theo từng trạng thái chưa? | | |
| Có **import**? → có case sinh mã, validate danh mục, cộng dồn/ghi đè chưa? | | |
| Có **phân quyền / phê duyệt**? → có case chặn gọi trực tiếp API chưa? | | |
| Có **dữ liệu chảy sang màn/báo cáo khác**? → mỗi đích ≥ 1 case chưa? | | |
| Có **tỷ giá / ngoại tệ**? → có case tỷ giá = 0 chưa? | | |
| Có **quan hệ giữa các trường ngày**? → có case ràng buộc thứ tự ngày chưa? | | |

**Quy tắc:** trả lời "Có" nhưng cột case rỗng → **REJECT**, phải bổ sung case.
Không được tự đánh PASS mà không liệt kê case cụ thể.

---

## 2. Reject Conditions — script tự kiểm

`build_checklist.py` chạy Quality Gate trước khi ghi file. Chạy với `--strict` để dừng hẳn
khi có lỗi.

### 2.1 Lỗi (ERROR) — bắt buộc sửa

| Lỗi | Ý nghĩa |
|---|---|
| Thiếu Business Rule / Checklist | Dòng rỗng, không kiểm được gì |
| Thiếu Expected Result | Không kết luận được Pass/Fail |
| Thiếu Impact | Checklist hardening bắt buộc có Impact — không có thì không xếp được Priority |
| Priority không hợp lệ | Chỉ nhận `P1` / `P2` / `P3` (không phân biệt hoa thường, tự bỏ khoảng trắng) |
| Thiếu Test Data | Case không cần dữ liệu vẫn phải ghi rõ `N/A` |
| Expected Result dùng từ mơ hồ | Chứa cụm bị cấm và Expected Result ngắn (< 60 ký tự); nếu dài hơn thì chỉ cảnh báo |
| Expected Result chỉ ghi 1 từ chung chung | "Thành công", "Chính xác", "OK", "Đúng"… đứng gần như một mình |
| Chuỗi của case bắt đầu bằng `=` | Excel ghi thành công thức → `#N/A` / `#NAME?` trong file giao đi (xem mục 3) |
| Khai `precondition` / `id` khi chưa bật `extended` | Dữ liệu sẽ bị bỏ đi khi ghi file — bật `"extended": true` hoặc xóa key |
| Case ID trùng | Trùng giữa các case khai tay, hoặc trùng với ID script sinh tự động |
| `sheet_name` trùng nhau | Excel tự đổi tên sheet thứ 2 → số liệu FunctionList sai |
| `sheet_name` rỗng / dài quá 31 ký tự / chứa `[ ] : * ? / \` | Excel không cho phép |
| Sheet không có group nào | Spec.json sai cấu trúc |

### 2.2 Cảnh báo (WARNING) — nên xem lại

| Cảnh báo | Ý nghĩa |
|---|---|
| Business Rule bắt đầu bằng "Kiểm tra…" / "Verify…" | Đang phát biểu thao tác thay vì rule |
| Case P1 về công thức/khoảng giá trị nhưng Test Data = `N/A` | Case công thức/biên phải có giá trị cụ thể kèm biên |
| Expected Result gộp 2 trạng thái đối lập | Vi phạm anti-pattern, nên tách 2 case |
| Group rỗng | Nhóm khai ra nhưng chưa có case |
| Đánh dấu `Cần confirm` nhưng Expected Result quá ngắn | Phải nêu rõ đang chờ chốt điều gì |

### 2.3 Các điều kiện reject phải tự kiểm (script không tự bắt được)

- Thiếu case biên với trường có min/max (đủ 6 giá trị)
- Thiếu case rỗng với trường bắt buộc
- Thiếu Inventory Gate
- Thiếu traceability (có field trong spec không map được sang case nào)
- Gộp nhiều mục tiêu trong 1 case
- Case trùng lặp nội dung

---

## 3. Verify công thức Excel — BẮT BUỘC

Mục đích: file gen ra chỉ có 2 loại công thức do script ghi (`=ROW()-n` ở cột `#`,
`=COUNTA(...)` ở cột Total của `FunctionList`), nhưng **mọi chuỗi trong `spec.json` bắt đầu
bằng ký tự `=` cũng bị ghi thành công thức** → Excel trả `#N/A` / `#NAME?`. File được lưu
không kèm giá trị đã tính, nên lỗi chỉ lộ ra khi người nhận mở file.

```json
"rule": "= Đơn giá * KL đặt hàng"          ← SAI, sẽ ra #N/A
"rule": "Công thức: Đơn giá * KL đặt hàng" ← ĐÚNG
```

Cách verify:

1. **Quality Gate của script** báo ERROR cho mọi chuỗi bắt đầu bằng `=` (xem 2.1). Phải ra
   0 lỗi — chạy `--strict` thì script không ghi file khi còn lỗi.
2. **Mở file bằng Excel / LibreOffice Calc / Google Sheets** để công thức được tính lại, rồi
   xác nhận: cột `#` của mọi sheet đánh số 1, 2, 3…; cột Total ở `FunctionList` khớp số case
   script in ra; không ô nào hiện `#N/A`, `#NAME?`, `#REF!`, `#VALUE!`.
3. Không có ứng dụng bảng tính: với file script vừa sinh và **chưa sửa tay**, bước 1 là đủ
   (công thức còn lại chỉ là 2 loại trên) — ghi rõ trong báo cáo là chưa mở file kiểm tra.

Kiểm nhanh trước khi gen:

```bash
grep -n '"=' spec.json      # không được có kết quả nào
```

---

## 4. Review Checklist — trước khi giao file

- [ ] Đã có bảng Inventory Gate, mọi dòng đều đã map sang case
- [ ] Đủ case biên (min−1, min, min+1, max−1, max, max+1) cho trường có min/max
- [ ] Đủ case rỗng cho trường bắt buộc
- [ ] Đủ case âm (negative) — không chỉ có happy path
- [ ] Đủ case phân quyền, bao gồm chặn gọi trực tiếp URL/API
- [ ] Đủ case xử lý lỗi (API lỗi, dữ liệu null, timeout)
- [ ] Đủ case tích hợp — mỗi màn/báo cáo đích ≥ 1 case
- [ ] Có case hoàn lũy kế khi Hủy / Đóng chứng từ
- [ ] Không có case trùng lặp
- [ ] Test Data cụ thể, hoặc ghi `N/A`
- [ ] Expected Result không có từ mơ hồ, công thức ghi kết quả số cụ thể
- [ ] Impact nêu tác động dây chuyền, không viết "không dùng được chức năng"
- [ ] Không lẫn case UI/UX, tìm kiếm, lọc, phân trang, hiệu năng
- [ ] Mọi điểm chưa chốt đều gắn `Cần confirm` + mã `QA_xxx`
- [ ] Quality Gate 0 lỗi (không chuỗi nào bắt đầu bằng `=`) và đã mở file bằng ứng dụng bảng
      tính: cột `#` / Total đúng số, không ô nào `#N/A` / `#NAME?` (xem mục 3)

---

## 5. Báo cáo kết thúc

Báo cho người dùng đúng 3 thông tin:

1. **Tổng số case**
2. **Số case P1** (chạy trước nếu gấp)
3. **Danh sách rule chưa chốt cần BA confirm** (liệt kê theo mã `QA_xxx`)
