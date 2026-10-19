# Kỹ thuật thiết kế case & coverage theo loại field

Nguồn: bộ `TESTCASE_GENERATION_RULES` của team, đã lược phần thuần UI/hiển thị.

---

## 1. Phân vùng tương đương (Equivalence Partitioning)

Mỗi rule nhập liệu phải có **tối thiểu**:

- 1 dữ liệu **hợp lệ**
- 1 dữ liệu **không hợp lệ**

Ví dụ: Đơn giá → hợp lệ `1.500`; không hợp lệ `-1`.

---

## 2. Phân tích giá trị biên (Boundary Value Analysis)

Trường có min/max **bắt buộc kiểm đủ 6 giá trị. Không được bỏ qua.**

```
min − 1
min
min + 1
max − 1
max
max + 1
```

Ví dụ: min = 5, max = 20 → `4, 5, 6, 19, 20, 21`.

Với ERP, biên hay bị bỏ sót nhất:

- `KL đặt thừa` vs `KL dư thừa thực tế` → biên là **bằng đúng** KL dư thừa và **vượt 1 đơn vị**
- `KL đặt hàng` vs `KL định mức còn lại` → biên là bằng đúng và vượt 1
- `Giá trị đặt hàng` vs `Giá trị cost duyệt` → biên là bằng nhau (chưa vượt) và vượt 1 đồng

Biên "bằng nhau" cực kỳ quan trọng: rất nhiều bug nằm ở chỗ hệ thống dùng `>` thay vì `>=`.

---

## 3. Trường bắt buộc (Required Field)

Mỗi trường bắt buộc phải có **1 case riêng** cho giá trị rỗng. Không gộp nhiều trường bắt
buộc vào 1 case, trừ khi mức chi tiết được chọn là "luồng chính".

---

## 4. Bảng quyết định (Decision Table)

Dùng khi kết quả phụ thuộc **tổ hợp nhiều điều kiện**. Bắt buộc dùng cho:

- Logic tách đơn theo loại hợp đồng × điều kiện khối lượng × điều kiện đầu mục
- Xác định vượt Cost theo phương pháp quản lý gói công việc
- Quy trình phê duyệt 1 cấp / 2 cấp

Cách làm: liệt kê mọi tổ hợp điều kiện → mỗi tổ hợp có kết quả khác nhau = 1 case.

**Ví dụ** — điều kiện tách đơn:

| Loại HĐ | KL ký HĐ < KL đơn hàng | Có đầu mục ngoài HĐ | Tách đơn? |
|---|---|---|---|
| Thiết bị | Có | Không | **Có** |
| Thiết bị | Không | Có | **Có** |
| Vật tư | Có | Không | **Không** |
| Vật tư | Không | Có | **Có** |

→ 4 case, không gộp.

---

## 5. Chuyển trạng thái (State Transition)

Bắt buộc dùng cho mọi chứng từ có vòng đời trạng thái. Cần phủ:

- Trạng thái mặc định khi tạo mới
- Từng bước chuyển hợp lệ + điều kiện + ai được thực hiện
- Bước chuyển **không hợp lệ** (phải bị chặn)
- Quyền Sửa / Xóa / Thêm dòng / Import ở **từng** trạng thái
- Luồng từ chối / trả về trạng thái trước (nếu có)
- **Hoàn lũy kế khi Hủy / Đóng** ← case bị thiếu nhiều nhất

---

## 6. Pairwise

Dùng khi có nhiều trường mỗi trường nhiều giá trị mà tổ hợp đầy đủ quá lớn. Chọn tổ hợp phủ
được mọi cặp giá trị thay vì mọi tổ hợp.

---

## 7. Coverage theo loại field

Chỉ giữ các case mang tính ràng buộc dữ liệu / nghiệp vụ. Các case hiển thị (label,
placeholder, tooltip, preview) đã bị loại khỏi phạm vi hardening.

### 7.1 Text

Rỗng · Hợp lệ · Không hợp lệ · đủ 6 giá trị biên độ dài:
`min−1` · `min` · `min+1` · `max−1` · `max` · `max+1`

### 7.2 Number / Tiền tệ / Khối lượng

Số hợp lệ · Số âm · `0` · đủ 6 giá trị biên (`min−1`, `min`, `min+1`, `max−1`, `max`, `max+1`)
· Số thập phân (đúng số chữ số quy định) · Giá trị rất lớn

> Với ERP: `0` và số âm gần như luôn phải chặn ở đơn giá, khối lượng, tỷ giá. Nếu spec chỉ ghi
> `>= 0` mà nghiệp vụ vô nghĩa với 0 → ghi `Cần confirm`.

### 7.3 Phần trăm (%VAT, tỷ lệ hao hụt)

`-1` · `0` · giá trị hợp lệ · `100` · `101` · để trống

### 7.4 Ngày

Hợp lệ · Ngày hiện tại · Ngày quá khứ · Ngày tương lai · Năm nhuận · Định dạng sai ·
**Quan hệ với ngày khác** (ngày kết thúc ≥ ngày bắt đầu, ngày phiếu ≥ ngày chứng từ gốc)

### 7.5 Email

Trống · Hợp lệ · Không hợp lệ · Đã tồn tại
Dữ liệu mẫu: `abc@test.com`, `abc`, `@test.com`, `abc@`, `abc@test`, `abc@@test.com`

### 7.6 URL

Trống · Hợp lệ · Không hợp lệ · Đã tồn tại
Dữ liệu mẫu: `https://abc.com`, `http://abc.com`, `abc.com`, `ftp://abc.com`

### 7.7 Số điện thoại

Hợp lệ · Thiếu số · Dư số · Chứa chữ cái · Chứa ký tự đặc biệt

### 7.8 File Upload / Import

- **Happy path:** file hợp lệ đúng mẫu
- **Validation:** sai định dạng · vượt kích thước · file rỗng · file đổi đuôi ·
  thiếu cột bắt buộc · giá trị không có trong danh mục · dòng trùng
- **Nghiệp vụ:** sinh mã tự động đúng quy tắc · import lần 2 **cộng dồn hay ghi đè** ·
  dòng lỗi bị bỏ qua hay chặn cả file
- **Security:** double extension (`abc.xlsx.exe`) · MIME type không khớp phần mở rộng

### 7.9 File Download / Export

Chỉ giữ case nghiệp vụ: **nội dung đúng dữ liệu nguồn** · **quyền truy cập đúng theo vai trò**.
Bỏ case tên file, encoding, định dạng hiển thị.

### 7.10 Dropdown / List tham chiếu danh mục

- Chỉ lấy bản ghi đúng **trạng thái** (đang kích hoạt / đã xác nhận / đã duyệt)
- Chỉ lấy bản ghi đúng **phạm vi** (thuộc dự án hiện tại)
- **Reset giá trị con khi đổi giá trị cha** (đổi NCC → reset hợp đồng, đổi Tháp → reset Vị trí)
- Bản ghi đã gán trước đó có bị ảnh hưởng khi điều kiện thay đổi không

### 7.11 Checkbox / Radio

Trạng thái mặc định do rule nghiệp vụ quy định · ràng buộc bắt buộc chọn · dữ liệu lưu đúng
theo lựa chọn · trường phụ thuộc đổi theo lựa chọn

### 7.12 Nút thao tác sinh chứng từ / ghi dữ liệu

Không kiểm giao diện nút, chỉ kiểm rủi ro dữ liệu:

- **Double-submit / spam click:** bấm Lưu / Xác nhận / Duyệt nhiều lần liên tiếp →
  **chỉ sinh 1 chứng từ**, lũy kế **chỉ cộng 1 lần**
- Gửi lại request khi mạng chậm → không tạo bản ghi trùng
- Impact: sinh trùng chứng từ, cộng lũy kế 2 lần → sai tồn kho, sai công nợ — **P1**

### 7.13 Thông báo / mail nghiệp vụ

Chỉ kiểm phần nghiệp vụ, bỏ phần hiển thị toast/màu sắc:

- **Đúng người nhận** (gửi tới đúng vai trò duyệt / người liên quan)
- **Đúng thời điểm** (khi trình duyệt, khi bị từ chối, khi quá hạn)
- **Đúng nội dung dữ liệu** (mã chứng từ, giá trị, người thực hiện)
- Impact: gửi sai người → lộ thông tin chi phí / chứng từ nằm chờ không ai duyệt — **P1**

---

## 8. Coverage mức màn hình

Mỗi màn hình phải phủ đủ 4 khía cạnh (đã bỏ UI Validation):

| Khía cạnh | Nội dung |
|---|---|
| **Business Logic** | Công thức, điều kiện xử lý, show/hide theo điều kiện nghiệp vụ |
| **Data Integrity** | Lưu đúng, hiển thị đúng, reload/sửa đúng, lũy kế đúng |
| **Permission** | Đúng theo vai trò, đúng theo trạng thái, chặn cả gọi trực tiếp API |
| **Error Handling** | Xử lý null/dữ liệu bất thường, lỗi API, không crash |

---

## 9. Tích hợp sang màn hình / báo cáo khác

Với **mỗi mục** trong phần "Data của … được sử dụng cho" ở Feature List, sinh tối thiểu 1 case:

- Số liệu ở màn đích khớp với màn nguồn
- Chứng từ điều chỉnh được sinh đúng khi dữ liệu nguồn thay đổi
- Giá trị real-time (bảng giá, lũy kế, tồn kho) cập nhật đúng
- Số liệu **đồng nhất giữa các báo cáo** cùng lấy 1 nguồn

Tất cả đều là **P1**.
