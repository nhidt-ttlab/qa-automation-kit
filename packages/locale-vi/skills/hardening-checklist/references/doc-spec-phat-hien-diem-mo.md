# Đọc spec & phát hiện điểm mờ

Hợp nhất từ `requirements_analyzer` (cách bóc tách tài liệu yêu cầu) và bộ 10 nhóm câu hỏi
nghiệp vụ ERP của team.

---

## Phần 1 — Bóc tách spec

### 1.1 Nhận diện loại tài liệu

| Loại | Dấu hiệu | Cách dùng |
|---|---|---|
| **Sheet tổng quan** (vd `ERP`) | Có cột Feature Name, Description, Business Impact, Priority, Note liệt kê tab | Nguồn của cột **Impact** + căn cứ **Priority** |
| **Sheet field-table** (vd `Vật tư`) | Có cột Field, Required, Readonly, Default, Business Meaning, Validation, Boundary, Error Message | Nguồn của cột **Business Rule** + **Expected Result** |
| **BRD / URD / User Story** | Mô tả nghiệp vụ dạng văn xuôi | Bổ sung luồng nghiệp vụ, điều kiện xử lý |
| **Basic / Detail Design** | Mô tả màn hình + hành vi | Bổ sung luồng trạng thái, dependency |
| **API Specification** | Endpoint, Request, Response, Status Code | Nguồn case phân quyền mức API và case Error Handling |
| **Database Design** | Table, Column, Constraint, Relationship | Nguồn ràng buộc unique / NOT NULL / quan hệ khóa ngoại — rất hữu ích cho hardening |

Một tài liệu có thể thuộc nhiều loại cùng lúc.

### 1.2 Xác định phạm vi

Trích đủ 4 trục trước khi viết case:

- **Chức năng** — Đơn hàng, Hợp đồng vật tư, Nhập kho…
- **Màn hình + cấp** — cấp dự án hay cấp hệ thống (rất hay bị nhầm)
- **Vai trò** — ai lập, ai trình, ai duyệt
- **Đối tượng nghiệp vụ** — chứng từ, danh mục, báo cáo bị ảnh hưởng

### 1.3 Trích rule theo 5 nhóm

Đánh mã để trace ngược (ghi vào cột Note nếu cần chứng minh độ bao phủ):

| Nhóm | Mã | Lấy từ đâu | Nội dung cần tìm |
|---|---|---|---|
| Business Rule | `BR-xxx` | Cột `Business Meaning`, Description | Điều kiện xử lý, công thức tính, điều kiện chuyển trạng thái, điều kiện được phép thao tác |
| Validation Rule | `VR-xxx` | Cột `Required` / `Validation` / `Boundary` / `Default` | Min, Max, Length, Format, Required, Data type |
| Permission Rule | `PR-xxx` | Cột `Readonly`, mô tả vai trò duyệt | Vai trò, hành động được phép, hành động bị cấm |
| Error Handling | `EH-xxx` | Cột `Error Message` | Nội dung message + điều kiện kích hoạt |
| Dependency | `DP-xxx` | Phần "Data của … được sử dụng cho" | Màn hình / dữ liệu / báo cáo phụ thuộc → nguồn cột **Impact** |

### 1.4 Xác định luồng

- **Happy Path** — luồng nghiệp vụ chính đi trơn tru
- **Alternate Path** — rẽ nhánh hợp lệ (đơn hàng theo ĐM vs ngoài ĐM vs hao hụt)
- **Exception Path** — hủy, đóng, từ chối duyệt, mất kết nối, timeout, dữ liệu null

### 1.5 Đọc cell đầy đủ

Spec ERP thường nhét 2000+ ký tự vào 1 ô. Luôn in nguyên nội dung ô, không cắt chuỗi:

```python
for row in ws.iter_rows():
    for c in row:
        if c.value and 'TÊN_NGHIỆP_VỤ' in str(c.value):
            print(c.row, [f'{x.column_letter}: {x.value}' for x in row if x.value])
```

Xác định biên section bằng cách quét heading: `^\d+\.\s`, `Tab_`, `Danh sách`, `Popup`.

---

## Phần 2 — 10 nhóm câu hỏi luôn phải soi khi đọc spec ERP

Spec field-table hầu như luôn thiếu các thông tin dưới đây. Soi đủ 10 nhóm này trước khi gen
file, hỏi lại người dùng, và đánh dấu `Cần confirm` cho phần chưa có câu trả lời.

### 1. Phạm vi unique
Spec hay ghi mâu thuẫn kiểu "không trùng trong cùng dự án và cả toàn hệ thống".
→ Hỏi: unique theo dự án hay toàn hệ thống? Có phân biệt hoa/thường, khoảng trắng không?

### 2. Ràng buộc giữa các trường ngày
Spec chỉ ghi "cho phép null" mà không ghi quan hệ.
→ Hỏi: Ngày kết thúc ≥ Ngày bắt đầu? Ngày lập phiếu có được nhỏ hơn ngày chứng từ gốc?
Chứng từ quá hạn có tự đổi trạng thái không?

### 3. Quyền thao tác theo trạng thái
Đây là nguồn sinh case lớn nhất và gần như luôn thiếu trong spec.
→ Hỏi: ở mỗi trạng thái được Sửa / Xóa / Import / Thêm dòng / Hủy đến đâu? Có luồng từ chối
(trả về trạng thái trước) không? Trường nào còn sửa được sau khi đã xác nhận?

### 4. Ràng buộc số học chưa chốt
Spec ghi `>= 0` nhưng thực tế giá trị 0 vô nghĩa (tỷ giá, đơn giá, khối lượng).
→ Hỏi: `>= 0` hay `> 0`? Cho phép số âm không? Bao nhiêu chữ số thập phân? Quy tắc làm tròn nào?

### 5. Cơ chế cảnh báo: chặn hay warning
Spec hay ghi "sẽ có thông báo tùy vào loại vi phạm".
→ Hỏi từng loại vi phạm: chặn không cho thao tác, hay chỉ cảnh báo và vẫn cho tiếp?
Vi phạm nhiều điều kiện cùng lúc thì hiển thị thế nào?

### 6. Quy tắc import lặp
→ Hỏi: import lần 2 chứa bản ghi đã có thì cộng dồn hay ghi đè? Có file mẫu và danh sách
message lỗi ở màn preview không? Dòng lỗi bị bỏ qua hay chặn toàn bộ file?

### 7. Điều kiện lấy dữ liệu lên list chọn ở màn khác
→ Hỏi đủ tổ hợp điều kiện: trạng thái + hiệu lực + phạm vi dự án + điều kiện nghiệp vụ riêng.
Bản ghi đã gán trước đó có bị ảnh hưởng khi điều kiện thay đổi không?

### 8. Tác động dây chuyền khi sửa dữ liệu đã phát sinh nghiệp vụ
→ Hỏi: chặn hay cho sửa? Nếu cho sửa thì hệ thống sinh chứng từ điều chỉnh gì, tại thời điểm
nào? Số liệu lũy kế ở màn/báo cáo khác được tính lại hay giữ nguyên?

### 9. Chiều đồng bộ dữ liệu giữa 2 cấp (hệ thống ↔ dự án)
→ Hỏi: dữ liệu ở dự án kế thừa động hay tách độc lập sau khi phân bổ? Sửa ở cấp trên có
đẩy xuống không? Dữ liệu tạo ở cấp dưới có tổng hợp lên không? Tổng hợp thế nào khi 1 bản
ghi được phân bổ cho nhiều dự án?

### 10. Ẩn/hiện tab và điều kiện hiển thị theo trạng thái
→ Hỏi: tab nào chỉ xuất hiện khi chứng từ ở trạng thái nào? (spec hay ghi rải rác, dễ bỏ sót)

---

## Phần 3 — 6 vùng điểm mờ cần rà thêm

| Vùng | Điểm cần rà |
|---|---|
| Validation | Min, Max, Length, Format, số chữ số thập phân |
| Permission | Vai trò, quyền thao tác, quyền theo trạng thái |
| Import / Upload | Kích thước file, định dạng, cột bắt buộc, xử lý dòng lỗi |
| Export / Download | Nội dung dữ liệu, quyền truy cập |
| Tính toán | Thứ tự ưu tiên khi nhiều rule cùng áp dụng, quy tắc làm tròn |
| Error Message | Nội dung chính xác, điều kiện hiển thị |

---

## Phần 4 — Luôn ghi nhận

- Ô `Note` trong spec chứa link Redmine / Google Sheet → đưa vào cột Note của case tương ứng
- Ô `Hardening Status` = `In Progress` / `Not Started` → gợi ý mức ưu tiên khi xếp lịch chạy;
  nếu có `Bug` đang mở → ghi vào Note là case regression, cần confirm đã fix chưa
- Dòng spec tự ghi "Chưa nắm được hết nghiệp vụ, cần hỏi thêm" → **bắt buộc** gắn `Cần confirm`
- Ô trống ở cột `Validation` / `Boundary` / `Error Message` với trường có ràng buộc nghiệp vụ
  → là điểm mờ, không phải "không có ràng buộc"

---

## Phần 5 — Anti-pattern khi phân tích spec

| Anti-Pattern | Lý do |
|---|---|
| Tự suy diễn Business Rule | Checklist sai, tệ hơn là thiếu case |
| Tự thêm Validation Rule không có trong spec | Không phản ánh yêu cầu thực tế |
| Bỏ qua tab phụ / popup | Thiếu coverage |
| Bỏ qua luồng lỗi, luồng hủy/đóng | Thiếu Exception Coverage — nơi bug tập trung |
| Gộp nhiều chức năng thành 1 nhóm | Khó trace ngược về spec |
| Không liệt kê điểm mờ | Mất cơ hội làm rõ yêu cầu, phải làm lại |
| Đánh giá thiết kế thay vì phân tích | Sai mục tiêu — nhiệm vụ là trích xuất, không phải review |
