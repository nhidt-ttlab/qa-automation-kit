# Template: UI-assisted test steps

Dùng template này khi `Test type` là `UI-assisted` hoặc `Hybrid`. Với testcase thuần API, dùng
[`api-test-steps.md`](api-test-steps.md).

Cấu trúc mục (số và tiêu đề) của phần 1–10 **giữ nguyên** như template API-driven để mọi công
cụ/skill đọc được cả hai. Phần khác biệt được đánh dấu **[UI]**.

Nguồn quy ước: hướng dẫn automation (`automation-guide.md`) §1.5. Ví dụ đã chạy thật của dự án được
liệt kê trong `<paths.knowledge>/doc-templates.md`.

---

## 0. Gate — testcase UI này có đáng tồn tại không?

**[UI]** Mục này không nằm trong file kết quả; trả lời nó **trước khi** copy template. Test qua
trình duyệt đắt và dễ vỡ hơn test API một bậc, nên chỉ viết khi có failure mode mà API mù.

Viết testcase UI khi rule rơi vào một trong các nhóm sau:

| Nhóm | Ví dụ | Vì sao API không bắt được |
|---|---|---|
| Rule sinh hoàn toàn ở client | STT theo dòng, phân trang phía client | Không có endpoint nào trả giá trị đó |
| Tầng hiển thị của một rule đã có API | định dạng `DD/MM/YYYY`, rút gọn khi nhiều dòng | API trả giá trị thô; format/rút gọn nằm ở cellRenderer |
| Cột bind sai nguồn | `field` trỏ nhầm nhánh DTO | Cả 2 vế của test API đều là cùng một DTO ⇒ tautology |
| Luồng nền tảng của chính trình duyệt | đăng nhập, nạp phiên, phân quyền ẩn menu | Hợp đồng nằm ở `localStorage`/router, không ở response |

**Không** viết testcase UI cho: sort / filter / search / phân trang của lưới (đó là kiểm thử thư viện
lưới, không phải kiểm thử sản phẩm), và cho bất kỳ rule nào đã được một testcase API phủ **cùng một
tầng**.

Nếu SpecID nguồn được tài liệu phân loại API/UI của module (dưới `<paths.featureDocs>/<module>/`, tên file
ghi trong knowledge file) xếp `UI` kèm lý do — trích nguyên văn lý do đó vào mục 3. Đó là chứng cứ mạnh
nhất cho việc testcase này tồn tại.

## Quy ước ID và vị trí file

**[UI]**

- **ID dùng dãy `U` riêng**: `TC-<module.tcPrefix>-U<nn>` (ví dụ `TC-ORD-U01`), hợp lệ theo
  `ids.testCase`. Không tái sử dụng ID của testcase API kể cả khi phủ đúng cùng một rule và cùng SpecID —
  nếu dùng chung, `TC-ORD-L06 / A2` sẽ mang 2 nghĩa khác nhau tuỳ run nào đang xem, làm hỏng truy vết
  trong kho kết quả chạy và trên dashboard. Luồng nền tảng dùng chung (đăng nhập, phiên) đi theo module
  dùng chung khai trong `modules`, với dãy `A` riêng.
- **Vị trí**: `<paths.steps>/ui/<thư mục module>/TC-<ID>-<slug>.md` — `<thư mục module>` là
  `<module.stepDir ?? module.docSlug ?? module.id>`; thư mục `ui/` song song với `api/`. Luồng dùng chung
  nằm ở thư mục của module dùng chung.
- **Scenario tương ứng**: `<paths.suites>/<module.suite>/ui/<slug>.scenario.ts`, tên khai trong registry
  tên scenario UI của dự án (vị trí ghi trong knowledge file).

## Status

- Test step status: `Draft` hoặc `Ready`
- Dùng `Draft` khi còn bất kỳ selector, rule, assertion, dependency hoặc evidence path nào chưa
  chốt, đang bị chặn, hoặc còn `[cần xác nhận]`.
- Dùng `Ready` chỉ khi chạy được end-to-end với step cụ thể, evidence cụ thể, pass/fail rõ ràng.
- Nếu `Draft`, thêm banner ngắn dưới tiêu đề, ví dụ `> **DRAFT** — ...`, nêu đúng assertion nào
  còn treo và vì sao.

## 1. Test overview

| Field | Content |
|---|---|
| Test case ID | `TC-<mã module>-U<nn>` |
| Test case name | Tên rule nghiệp vụ, ngắn gọn |
| Test step status | `Draft` hoặc `Ready` |
| Module | Ví dụ: `Đơn hàng — Danh sách đơn hàng` |
| Source feature doc | Link tương đối tới tài liệu nguồn (scenario section có anchor, hoặc dòng UI-only trong inventory) + tài liệu phân loại API/UI của module |
| Covered SpecID | Ví dụ: `DH-7` |
| Primary rule | Một câu nêu rule được kiểm chứng |
| Test type | `UI-assisted` hoặc `Hybrid` |
| **[UI] UI target** | `<web.baseUrl>` của môi trường, ví dụ `https://shop.example.test` |
| **[UI] Screen path** | Ví dụ: `/du-an/:projectId/don-hang` |
| **[UI] Auth mode** | `storage` (nạp sẵn phiên) · `form` (đăng nhập thật) · `none` (scenario tự đăng nhập) — mặc định lấy từ `web.authMode` |
| Priority | Chép từ nguồn nếu nguồn có |

**[UI] Quan hệ với testcase API** — bắt buộc khi rule đã có một testcase API phủ. Nêu rõ hai bên
khác nhau ở tầng nào; nếu không nêu được, đây là coverage trùng lặp và testcase không nên tồn tại:

| | `TC-<ID>` (API-driven) | `TC-<ID>` (UI-assisted) |
|---|---|---|
| So sánh cái gì | | |
| Bắt được lỗi gì | | |
| Điểm mù | | |

## 2. Business rule in one paragraph

Mô tả bằng ngôn ngữ nghiệp vụ: trạng thái trước hành động → sự kiện → kết quả mong đợi.
Không nêu tên field kỹ thuật, không nêu endpoint, không nêu selector. Người đọc là BA.

## 3. Traceability to API feature

Lấy ánh xạ SpecID ↔ field **trực tiếp từ bảng `SpecID | Field` của tài liệu phân loại API/UI**,
không suy luận theo thứ tự liệt kê. Cột `Lý do` của chính bảng đó là nguồn xác định phần nào của
rule là hành vi UI — trích nguyên văn.

| SpecID | Feature field / rule | **[UI]** Phần được tài liệu phân loại đánh dấu là UI | Why this test needs it |
|---|---|---|---|
| `DH-xxx` | Tên field hoặc rule | Trích nguyên văn, hoặc `—` nếu rule thuần client | Lý do |

## 4. Test data

| Key | Value | Notes |
|---|---|---|
| `projectId` | | Lấy từ đâu: probe API, fixture, hay bước trước |
| `<entity>Expected` | | **[UI] Oracle phải độc lập với tầng đang test** — xem mục 9 |

**[UI]** Ghi kèm cờ ghim tay khi scenario cho phép cố định dữ liệu (ví dụ `--order-id <id>`), để
người chạy lại không phụ thuộc vào việc dò tự động ra đúng bản ghi cũ.

## 5. Preconditions

| ID | Condition | How to verify / prepare | Evidence |
|---|---|---|---|
| `P1` | **[UI] Quyền:** `Project.Xxx.Yyy.Read` | Endpoint backend trả danh sách quyền đã cấp cho user đang đăng nhập | Response |
| `P2` | Dữ liệu tối thiểu để quan sát rule | Gọi API danh sách, đếm `totalCount` | Response |

**[UI] Quy ước quyền:** ghi đúng chuỗi permission mà backend cấp. Front end thường **loại bỏ hẳn**
tab/menu chưa được cấp quyền, nên thiếu quyền trông y hệt màn hình hỏng. Mọi precondition phải được
kiểm tra **qua API trước khi mở trình duyệt** (probe khả dụng của dự án, tên ghi trong knowledge file)
và trả `BLOCKED`, **không phải** `FAIL`.

## 6. Step matrix

**[UI]** So với template API: thêm cột `Target (selector)`; đổi tên `API / actionId` →
`API observed / actionId`.

| Step | Phase | Action | Target (selector) | API observed / actionId | Input | Expected result | Evidence to capture |
|---|---|---|---|---|---|---|---|
| `S1` | Setup | Dò dữ liệu thoả precondition | — | `<apiSource>::GET::/api/app/...` | — | Có bản ghi thoả `P2` | network |
| `S2` | Setup | Đọc dữ liệu nguồn làm oracle | — | `<apiSource>::GET::/api/app/.../{id}` | | Baseline khác rỗng | network |
| `S3` | Execute | Mở màn hình | — | `<apiSource>::GET::/api/app/...` | `projectId` | Lưới hiển thị | screenshot, network |
| `S4` | Execute | Thao tác của người dùng | `id=input-search-xxx` | `<apiSource>::GET::/api/app/...` (`chờ: keyword=<...>`) | | Hành động thành công | screenshot, network |
| `S5` | Verify | Đọc lại dữ liệu đã render | `css=[col-id="__index__"]` | — | — | Giá trị đúng rule | grid-rows |
| `S6` | Verify | Kiểm tra không có lỗi JavaScript | — | — | — | `pageErrors` = 0 | console, trace |

Authoring rules:

- Một dòng = một hành động kiểm chứng được. Tách `Execute` và `Verify`; giấu bước kiểm chứng bên
  trong bước hành động là lỗi của tài liệu.
- Case biên viết thành nhóm step riêng (`S6`–`S8`), không gộp vào case chính.
- Phase dùng đúng bộ: `Setup | Execute | Verify | Cleanup`.
- **[UI] `Action`** phải ánh xạ được sang một verb có thật của driver UI trong kit (`@qakit/ui`):
  `goto | click | fill | press | selectOption | switchTab | gotoPage | readText | readSelectValue |
  countMatching | readControlState | pickInModal | confirmModal | closeModal | readGrid | editGridCell`.
  Viết một hành động mà driver không làm được nghĩa là step đó không tự động hoá được.
- **[UI] `Target (selector)`** dùng dạng chuẩn, phân tách phạm vi bằng ` >> `, chỉ số bằng `[n]`:
  `id=input-search-order-page` · `testid=input-username-login` ·
  `role=button[name="Đăng nhập"]` · `label=Tên đăng nhập` · `text=Tổng hợp giá trị theo nhà cung cấp` ·
  `css=.grid-pinned-left [col-id="__index__"]`
  - Thứ tự ưu tiên `id` → `testid` → `role` → `label` → `placeholder` → `text` → `css`, khớp thứ tự
    phân giải `LocatorSpec` của kit (`domId | testId | role | label | placeholder | text | css`). Dự án
    nào lệch thứ tự này ghi lý do trong knowledge file.
  - **Selector phải quan sát được từ màn hình thật hoặc từ mã nguồn web app** — không bịa ra theo quy
    ước đặt tên. Dò bằng `mcp__<mcp.uiServerName>__ui_describe_screen`; cách lấy: skill UI test steps, mục
    "Resolving selectors".
  - Dùng `css=` phải giải thích lý do ở mục 9.
  - Tránh `label`/`text` khi có thể: chuỗi hiển thị gắn chặt với file dịch và sẽ vỡ âm thầm khi ai đó
    sửa câu chữ.
- **[UI] `API observed / actionId`** là request mà giao diện **được kỳ vọng tự gọi** (bằng chứng
  quan sát), không phải request ta chủ động gọi. Để trống nếu hành động thuần client (ví dụ đánh
  số STT). Khi bước phải chờ **đúng một** response cụ thể chứ không phải bất kỳ request nào tới
  cùng đường dẫn, ghi điều kiện chờ ngay trong ô này: `… (chờ: keyword=<Số đơn>)`.
- **[UI] `Evidence to capture`** dùng đúng bộ từ vựng, ánh xạ 1–1 sang `EvidenceKind` của kit
  (`@qakit/core`):

  | Viết trong tài liệu | `EvidenceKind` |
  |---|---|
  | `screenshot` | `screenshot` |
  | `dom` | `dom_snapshot` |
  | `grid-rows` | `grid_snapshot` |
  | `network` | `network_har` |
  | `console` | `console_log` |
  | `trace` | `trace_zip` |
  | `video` | `video` |

## 7. Assertions

| Assertion ID | Expression | Expected | Dòng checklist |
|---|---|---|---|
| `A1` | | `true` | `TC_nn` |
| `A2` | **[cần xác nhận]** ... | `NOT_EVALUATED` | `TC_nn`, `TC_mm` |
| `An` | Không có lỗi JavaScript chưa bắt (`pageerror`) trong suốt phiên | `true` | — |

- Cột `Dòng checklist` chỉ ghi **mã dòng** của checklist dưới `<paths.checklists>`. Không chép cột
  `Expected Result` hay `Priority` của sheet vào đây: scenario đọc thẳng từ CSV qua bước import checklist
  của dự án, và bản chép tay thứ hai chính là thứ sẽ lệch. Assertion không sinh từ checklist ghi `—`;
  đừng bịa dòng cho nó.
- Bỏ hẳn cột này khi testcase không sinh từ hardening checklist.

- ID ngắn và ổn định — automation `check()`, dòng check trong kho kết quả chạy và report đều trích dẫn
  chúng. Định dạng chấp nhận là `ids.checkRef`: `TC-ORD-U01 / A1` (hậu tố chữ thường được phép: `A2b`).
- **[UI] Mọi testcase UI đều có assertion `pageerror` = 0** ở cuối. Đây chính là thứ test UI thêm
  được so với test API: "trang ném React error nhưng trông vẫn bình thường".
  Dùng `checkNoPageErrors`, **không** dùng `checkNoConsoleErrors` (`@qakit/ui`, `createUiChecks`) — bản
  build production thường loại bỏ `console.*`, nên lỗi console có thể luôn đọc ra 0 ngay cả khi app hỏng,
  còn exception chưa bắt vẫn sống sót qua minify. Dự án có loại bỏ hay không được ghi trong knowledge file.
- So sánh trong `check()` dùng `===`, nên giá trị đem so phải là **kết luận đã chuẩn hoá**. Chi
  tiết thay đổi theo lần chạy (HTTP status, đường dẫn cuối) đưa vào `step.data`, không nhét vào
  chuỗi so sánh — nếu không thì mọi lần chạy đều FAIL dù hành vi đúng.

## 8. Pass / fail rule

- `PASS` khi mọi assertion bắt buộc đúng và evidence bắt buộc được ghi nhận.
- `FAIL` khi có assertion bắt buộc sai.
- `BLOCKED` khi thiếu quyền hoặc thiếu dữ liệu tiền đề — **không tính là FAIL**.
- `NOT_EVALUATED` cho assertion không quan sát được (thiếu dữ liệu, rule chưa chốt). Nêu rõ
  assertion nào, vì sao, và **không tính vào verdict**.
- Bộ từ vựng verdict: `PASS | PARTIAL | FAIL | BLOCKED | ERROR`. Không co một case chỉ kiểm chứng
  được một phần vào hình dạng `PASS`.

## 9. Notes for automation

- Scenario: `<slug>.scenario.ts`, chạy bằng lệnh chạy một scenario của dự án (xem knowledge file).
- Giá trị động cần truyền giữa các bước.
- Bước cleanup nếu có tạo dữ liệu.

**[UI] Oracle độc lập** — giá trị đem so sánh **không được lấy từ chính tầng đang kiểm thử**.
So ô đã render với response danh sách của cùng màn hình là so danh sách với chính nó. Baseline
phải lấy từ endpoint chi tiết, từ fixture, hoặc từ một nguồn dữ liệu khác — và nói rõ ở đây lấy
từ đâu.

**[UI] Điều kiện chờ** — nguồn flake số một. Chờ chung theo đường dẫn (`/api/app/order`)
là **sai và hỏng âm thầm** khi trang tự bắn một request cùng đường dẫn lúc mount: điều kiện chờ
thoả mãn ngay, trong khi request thật còn chưa gửi. Ghi rõ ở đây phải chờ response nào (kèm query
param đã percent-encode), và mọi debounce/điều kiện kích hoạt của control (ví dụ ô tìm kiếm chỉ bắn
khi nhấn Enter, sau đó còn debounce).

**[UI] Đọc lưới dữ liệu** — khi testcase đọc lưới (widget adapter khai trong `web.widgets`), nêu rõ ở đây:

- `col-id` được suy ra thế nào (ví dụ từ `field` khi không đặt column id tường minh) — dẫn mã nguồn
  web app.
- Cột **pin trái / cố định** nằm ở đâu. Nhiều thư viện lưới render chúng trong một container DOM
  **riêng**, dùng chung `row-index` với row ở container giữa. Bộ đọc lưới phải gộp theo `row-index`,
  không theo thứ tự DOM; gộp sai sẽ mất hẳn cột pin, tức là mất chính thứ đang cần kiểm tra.
- **Không suy ra kích thước tập dữ liệu từ số dòng trong DOM**: lưới phân trang phía client trên
  **một trang dữ liệu của server** thì DOM nhiều nhất chỉ chứa trang hiện tại.
- Ảo hoá cột và chiều cao lưới tính theo cửa sổ khiến **viewport phải đặt tường minh**
  (`web.viewport`); viewport mặc định cho ra một lưới khác hẳn.

**[UI] Selector stability** — liệt kê mọi target phải dùng `css=` hoặc `id` trần, kèm đánh giá có
nên xin thêm `data-testid` từ team web hay không. Mục này là backlog để dần gắn testid cho ứng
dụng; thiếu nó thì selector mục rữa dần mà không ai thấy.

| Target | Strategy đã dùng | Đề xuất |
|---|---|---|
| | | |

**[UI] Chế độ chỉ đọc** — mặc định route guard của kit chặn mọi request không phải GET tới các host trong
`web.allowedHosts` (POST tra cứu đã kiểm chứng chỉ-đọc có thể được mở riêng cho từng scenario). Chỉ ghi
được khi `<safety.allowWritesEnv>` bằng `1`, và dữ liệu do UI tạo nên mang `<safety.testDataMarker>`. Nếu
testcase buộc phải ghi dữ liệu, nói rõ ở đây, bật opt-in tường minh, và mô tả cách dọn dẹp.

## 10. Open questions / `[cần xác nhận]`

Danh sách phẳng mọi giả định chưa được xác nhận từ các mục trên. Mỗi mục nêu: điều gì chưa biết,
vì sao chưa quan sát được, và **cần gì để gỡ** (dữ liệu cụ thể cần tạo, câu hỏi cụ thể cần BA
chốt). "Thiếu dữ liệu để quan sát" khác "sản phẩm sai" — không được viết lẫn lộn.

## 11. Automation findings

**Không viết ở pass này.** Mục 11 chỉ tồn tại sau khi scenario đã chạy thật và việc trace mã nguồn
đính chính lại điều gì đó ở các mục trên (xem hướng dẫn automation §4 bước 6).
