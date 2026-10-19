# Common Pages - Test checklist

| # | Screen | Category | Sub-Category | Business Rule / Checklist | Test Data (if needed) | Expected Result | Impact | Priority | Test result | Link redmine | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Xuất bán hàng | Thông tin chung | Loại phiếu xuất | Khi mở màn Thêm mới từ menu Xuất bán hàng, Loại phiếu xuất mặc định = "Phiếu xuất kho thi công" (KHÔNG tự động là "Phiếu xuất bán hàng") — người dùng PHẢI tự chọn lại "Phiếu xuất bán hàng" trên dropdown | Mở màn Thêm mới từ menu Xuất bán hàng, kiểm tra giá trị mặc định của dropdown Loại phiếu xuất | Dropdown Loại phiếu xuất hiển thị mặc định "Phiếu xuất kho thi công"; người dùng chọn lại đúng "Phiếu xuất bán hàng" thì các field/luồng liên quan đổi đúng theo | Default sai (tự động đã là Phiếu xuất bán hàng, hoặc để trống) → hành vi khác thiết kế, người dùng dễ tạo nhầm loại phiếu nếu quên chọn lại |  |  |  |  |
| 2 | Xuất bán hàng | Thông tin chung | Trường bắt buộc | Validate bắt buộc: Ngày xuất kho, Kho xuất, Đơn vị nhận; Loại phiếu xuất phải được chọn đúng "Phiếu xuất bán hàng" trước khi lưu | Bỏ trống từng trường rồi Lưu/Xác nhận | Chặn lưu, hiển thị message tương ứng từng trường | Thiếu dữ liệu gốc → sai đối tượng nhận, sai nguồn kho, khó đối soát công nợ/doanh thu |  |  |  |  |
| 3 |  |  |  |  |  |  |  |  |  |  |  |
