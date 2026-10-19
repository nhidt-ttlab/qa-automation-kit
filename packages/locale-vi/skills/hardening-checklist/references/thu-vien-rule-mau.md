# Thư viện rule mẫu theo loại trường

Dùng để không bỏ sót case. Với mỗi trường trong spec, xác định nó thuộc loại nào dưới đây
rồi lấy nguyên bộ rule + Impact gợi ý.

---

## Trường tiền tệ / giá trị (Only number, ≥ 0)

- Ràng buộc: âm, ký tự, `0`, giá trị rất lớn, số chữ số thập phân
- Impact: sai tổng giá trị chứng từ → sai đối chiếu công nợ, sai báo cáo chi phí — **P2**
- Nếu tham gia công thức tổng → nâng **P1**

## Trường % (0 ≤ X ≤ 100)

- Ràng buộc: `-1`, `0`, giá trị hợp lệ, `100`, `101`, để trống
- Impact: sai tiền thuế → sai đối chiếu hóa đơn NCC — **P2**

## Tỷ giá

- Ràng buộc: `0`, âm, null, mặc định `1`, khóa khi loại tiền bản địa
- Quy đổi: giá trị quy đổi = giá gốc × tỷ giá; **giá trị nguyên tệ KHÔNG đổi**
- Nhiều lần điều chỉnh: luôn lấy tỷ giá phiếu mới nhất, lưu đủ lịch sử
- Impact: tỷ giá = 0 → toàn bộ giá trị quy đổi về 0 → sai giá trị nhập kho, sai giá vốn,
  sai báo cáo quản trị — **P1**

## Ô Auto-calculated

Mỗi ô Auto-calculated trong spec = **1 case bắt buộc**, luôn P1 nếu nằm trong chuỗi tính tiền.

- Kiểm tra: đúng công thức, readonly, tự tính lại khi đổi input, tính lại khi thêm/xóa dòng
- Expected Result phải ghi **kết quả số cụ thể**, không ghi lại công thức
- Impact: viết theo chuỗi phụ thuộc, vd "sai giá trị hàng hóa → sai giá trị hợp đồng →
  sai điều kiện giữ giá theo giá trị hợp đồng"

## Khối lượng lũy kế (đã đặt / đã giao / còn lại)

Bộ rule chuẩn, tất cả **P1**:

- Lũy kế cộng dồn đúng khi phát sinh chứng từ mới
- Công thức còn lại = tổng − lũy kế, không âm
- **Hoàn lũy kế khi chứng từ bị Hủy / Đóng** ← case hay bị thiếu nhất
- Chặn thao tác vượt phần còn lại (kiểm cả biên **bằng đúng** phần còn lại)
- Lũy kế truyền sang chứng từ tiếp theo cùng vị trí/đối tượng phải đúng
- Impact: sai lũy kế → cho đặt/xuất vượt hạn mức, sai chi phí dự án và sai báo cáo tổng hợp

## Khối lượng dư thừa / bù trừ

- Lấy đúng nguồn từ màn kiểm soát, giới hạn `0 ≤ giá trị áp dụng ≤ KL dư thừa thực tế`
- **Chống dùng trùng (double-use):** dùng ở chứng từ A rồi thì phần khả dụng cho chứng từ B
  phải giảm tương ứng, kể cả khi A chưa duyệt
- Phân bổ đúng theo từng vị trí khi áp dụng đồng thời nhiều vị trí
- Thứ tự ưu tiên: dùng hết phần dư thừa trước, rồi mới phát sinh nhu cầu mới
- Impact: sai KL dư thừa → đặt hàng trùng/thừa, sai KL dư thừa toàn dự án — **P1**

## Trạng thái chứng từ

- Trạng thái mặc định khi tạo mới
- Từng bước chuyển trạng thái + điều kiện + người thực hiện
- Bước chuyển **không hợp lệ** phải bị chặn
- Quyền Sửa / Xóa / Thêm dòng / Import ở **từng** trạng thái
- Chỉ trạng thái cuối mới được dùng ở nghiệp vụ khác
- Ẩn/hiện tab theo trạng thái
- Impact: lọt kiểm soát phê duyệt — **P1**

## Phê duyệt nhiều cấp

- Điều kiện xác định chứng từ cần duyệt mấy cấp
- **Chặn cứng khi thiếu vai trò:** 1 người không thể vừa trình vừa duyệt bổ sung
- Chặn cả khi gọi trực tiếp API duyệt
- Chứng từ không thuộc diện duyệt nhiều cấp chỉ cần 1 lần duyệt
- Impact: vượt quyền phê duyệt → rủi ro kiểm soát nội bộ, duyệt sai chi phí — **P1**

## Import có sinh mã tự động

- Sinh mã đúng công thức cấu hình
- Thiếu trường theo ma trận thuộc tính → báo lỗi ở preview, **KHÔNG sinh mã**
- Giá trị không có trong danh mục → báo lỗi
- Import lặp: **cộng dồn hay ghi đè**
- Dòng lỗi: bỏ qua hay chặn toàn bộ file
- Giá trị số không hợp lệ trong file
- Dòng trùng trong cùng file
- Impact: sinh mã sai → không mapping được dữ liệu giữa các chứng từ và báo cáo — **P1**

## Trường tham chiếu danh mục (dropdown)

- Chỉ lấy bản ghi đang Kích hoạt / đúng trạng thái nghiệp vụ / đúng phạm vi dự án
- **Reset giá trị con khi đổi giá trị cha** (đổi NCC → reset hợp đồng; đổi Tháp → reset Vị trí)
- Bản ghi đã gán trước đó có bị ảnh hưởng khi điều kiện thay đổi không
- Impact: tham chiếu sai đối tượng → sai công nợ / sai phân loại — **P2**
- Nếu list quyết định đơn giá hoặc điều kiện tách chứng từ → nâng **P1**

## Trường ngày

- Ràng buộc quan hệ: ngày kết thúc ≥ ngày bắt đầu; ngày phiếu ≥ ngày chứng từ gốc
- Giá trị mặc định (ngày tạo chứng từ)
- Ngày quá khứ / tương lai / năm nhuận / định dạng sai
- Impact: sai ngày → sai kỳ tính lũy kế, sai báo cáo theo kỳ — **P2**

## Phân quyền

- Ẩn/disable đúng nút theo vai trò
- **Chặn cả khi gọi trực tiếp URL/API** ← luôn phải có, hay bị thiếu
- Quyền khác nhau theo trạng thái chứng từ
- Impact: vượt quyền phê duyệt → rủi ro kiểm soát nội bộ — **P1**

## Tích hợp sang màn hình / báo cáo khác

Với mỗi mục trong phần "Data của … được sử dụng cho" ở Feature List, sinh tối thiểu 1 case:

- Số liệu ở màn đích khớp với màn nguồn
- Chứng từ điều chỉnh được sinh đúng khi dữ liệu nguồn thay đổi
- Giá trị real-time (bảng giá, lũy kế, tồn kho) cập nhật đúng
- Số liệu **đồng nhất giữa các báo cáo** cùng lấy 1 nguồn

Tất cả **P1**.

## Làm tròn / quy cách đóng gói

- Chiều làm tròn (lên hay xuống), áp dụng ở bước nào trong chuỗi tính
- Áp dụng nhất quán cho mọi loại chứng từ cùng nghiệp vụ hay không
- Test Data phải ghi rõ: giá trị trước làm tròn, quy cách, kết quả kỳ vọng
- Impact: làm tròn sai → sai số lượng thực mua so với hệ thống ghi nhận — **P1**
