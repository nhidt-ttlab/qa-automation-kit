# Test Case Authoring Guide

Hướng dẫn này là quy trình mà AI (hoặc người) phải theo để tạo một regression test case mới trong dự án
dùng QA automation kit, **cùng hình dạng** với test case tham chiếu của dự án (ghi trong
`<paths.knowledge>/doc-templates.md`). Mọi đường dẫn dưới đây là khoá của `qakit.config.yaml`, tương đối
với thư mục chứa file config; `<thư mục module>` nghĩa là `<module.stepDir ?? module.docSlug ?? module.id>`.
Một test case luôn có tối đa **ba artifact**, tạo theo thứ tự:

| # | Artifact | Vị trí | Ai viết | Khi nào |
|---|---|---|---|---|
| 1 | Test-steps spec (`.md`) | `<paths.steps>/api/<thư mục module>/TC-<ID>-<slug>.md` | AI/người, từ feature doc | Trước khi có automation |
| 2 | Scenario automation (`.ts`) | `<paths.suites>/<module.suite>/<api\|ui>/<slug>.scenario.ts` | AI, trong lúc trace hành vi backend thật | Trong/sau khi dựng automation |
| 3a | QA/QC run report tự sinh (`.md`) + JSON run artifact | `<paths.reports>/<domain>/<kind>/<TC-ID>/<timestamp>.md` + cùng thư mục nhóm trong cây outputs của harness (`<timestamp>.<runId>.json`) | **Sinh tự động** bởi report pipeline của kit (`@qakit/core`, `packages/core/src/report/`) qua lớp bọc report của harness — không bao giờ viết tay | Mỗi lần scenario chạy |
| 3b | Recap report viết tay (`.md`) | Thư mục recap report của dự án (knowledge file), `TC-<ID>-<YYYYMMDD>.md` | AI, tóm tắt một hoặc vài lần chạy cho người đọc | Khi một lần chạy cho ra điều đáng ghi thành verdict (blocker, bug, xác nhận PASS) |

Đừng bỏ #1 để nhảy thẳng vào code — spec là thứ chốt rule nghiệp vụ và assertion ID (`A1`, `A2`, ... khớp
`ids.assertion`) mà check của scenario và recap report cùng tham chiếu.

Mỗi lần chạy #3a còn (a) ghi một dòng vào kho kết quả SQLite cục bộ (`reporting.sqlite`, best-effort) và
(b) xem được trên review dashboard cục bộ, nơi ghi quyết định review của người và đề xuất do AI hỗ trợ cạnh
report. Cả hai không đòi hỏi gì ở tác giả scenario ngoài việc điền `overview`/`reportModel` tốt (§2.5) —
chúng là consumer phía sau của cùng `ReportableResult`, không phải thứ viết riêng cho từng test case.

Quan trọng: verdict được ghi/sinh ra là `PASS | PARTIAL | FAIL | BLOCKED | ERROR`. Dùng `PARTIAL` khi lần
chạy chứng minh được một số assertion nhưng checkpoint khác còn blocked hoặc `NOT_EVALUATED`; không co hình
dạng đó thành một `PASS` tổng gây hiểu nhầm.

---

## 1. Test-steps spec (`<paths.steps>/api/<thư mục module>/TC-<ID>-<slug>.md`)

Bắt đầu từ template `api-test-steps.md` — copy nó, đừng tự nghĩ lại danh sách mục. Điền theo thứ tự:

1. **Test overview** — `Test case ID` (hợp lệ theo `ids.testCase`), tên, `Module`, link tới feature
   extraction doc dưới `<paths.featureDocs>`, các `Covered SpecID`, `Primary rule` một câu, `Test type`
   (`API-driven` trừ khi không tránh được tương tác UI), và `Priority` khi có lịch sử bug để dẫn (ví dụ
   `**High** (lịch sử bug #1201 / #1207)`).
2. **Business rule in one paragraph** — tiếng Việt, chỉ ngôn ngữ nghiệp vụ. Không tên field, không
   endpoint. Nêu: trạng thái tiền đề → hành động người dùng → hành vi hệ thống mong đợi, gồm cả case
   âm/biên nếu rule có (ví dụ "không được vượt quá X").
3. **Traceability to API feature** — một dòng cho mỗi `SpecID` được phủ, viết rõ *vì sao test này cần
   nó* (không chỉ nhắc lại).
4. **Test data** — mọi giá trị động mà các bước sẽ dùng (`projectId`, `baselineXxx`, `orderIdA`, ...),
   kèm một dòng ghi chú lấy từ đâu (bước trước, fixture, dò tự động).
5. **Preconditions** — `P1`, `P2`, ... mỗi mục có API/query cụ thể để kiểm tra và evidence mong đợi. Điều
   gì chưa kiểm chứng thì đánh dấu **`[cần xác nhận]`** thay vì đoán — xem ghi chú §11 bên dưới.
6. **Step matrix** — một dòng cho mỗi hành động kiểm chứng được, cột `Step | Phase | Action | API /
   actionId | Input | Expected result | Evidence to capture`. `Phase` là `Setup | Execute | Verify |
   Cleanup`. Không bao giờ gộp bước kiểm chứng vào bước hành động — tách ra. Khi `actionId`/endpoint chưa
   được xác nhận, ghi `[cần xác nhận]` kèm phỏng đoán tốt nhất và lập luận — đừng ngầm giả định một hình
   dạng chưa đối chiếu với mã nguồn (`mcp__<mcp.apiServerName>__load_domain_api_registry` liệt kê action thật).
7. **Assertions** — `A1`, `A2`, ... là biểu thức một dòng kèm giá trị mong đợi (thường là `true`). Các ID
   này mang tải: `check(...)` của scenario trích dẫn chúng theo `ids.checkRef` (`'TC-ORD-R02 / A2'`) và
   recap report tham chiếu trực tiếp, nên giữ ổn định khi đã có automation.
8. **Pass / fail rule** — điều kiện PASS và FAIL tường minh theo assertion ID. Chỉ rõ assertion nào có
   điều kiện/best-effort (ví dụ bị chặn bởi background job chập chờn) và nói rõ nó không tính vào verdict
   PASS/FAIL chính.
9. **Notes for automation** — bước nào đã có `actionId` xác nhận, bước nào cần đối chiếu mã nguồn backend
   trước, giá trị nào phải truyền giữa các bước, ghi chú cleanup.
10. **Open questions / `[cần xác nhận]`** — danh sách phẳng mọi giả định chưa giải quyết từ các mục trên,
    để người/AI dựng automation biết chính xác phải đối chiếu gì với mã nguồn trước khi code.
11. **Automation findings (đối chiếu mã nguồn ..., <ngày>)** — **chỉ thêm sau khi đã dựng automation**,
    khi đã thực sự trace mã nguồn backend. Mục này *đính chính* step matrix/assertion phía trên thay vì
    sửa tại chỗ, để tài liệu giữ trung thực "điều ta đã giả định" vs. "điều ta đã kiểm chứng". Mỗi đính
    chính là một bullet:
    - Điều gì đã giả định sai (dẫn bước/mục)
    - Điều gì thực sự đúng, với class/method/field DTO chính xác từ mã nguồn (không bao giờ đoán — đọc mã
      nguồn backend (`apiSources.<source>.repository`) hoặc bằng chứng gọi live đã kiểm chứng, và nói rõ
      là cái nào)
    - Mọi bẫy wire-format (ví dụ tên field request ≠ tên field response)
    - Điều gì vẫn chưa tự động hoá được, và vì sao

Viết mọi thứ bằng tiếng Việt, trừ tên định danh trong code, đường dẫn endpoint, tên field và mã lỗi — những
thứ này giữ nguyên cách viết/ngôn ngữ gốc để grep được trong mã nguồn.

---

## 1.5. UI-assisted test cases (browser-driven)

Phần lớn dòng trong feature extraction doc là `API`, nhưng tài liệu phân loại API/UI của mỗi module (dưới
`<paths.featureDocs>`; tên file ghi trong knowledge file) cũng xếp một số dòng là **UI** — những thứ không
endpoint nào trả về, mà API regression suite về cấu trúc không phủ được và vì thế đã bị loại ở bước
inventory. Những dòng đó giờ phủ được. Artifact khác §1/§2 như sau:

| # | Artifact | Vị trí |
|---|---|---|
| 1 | Test-steps spec | `<paths.steps>/ui/<thư mục module>/TC-<ID>-<slug>.md`, từ template `ui-test-steps.md` — viết bằng skill UI test steps |
| 2 | Scenario automation | `<paths.suites>/<module.suite>/ui/<slug>.scenario.ts`, tên khai trong registry tên scenario UI của dự án |
| 3 | Evidence (thêm) | `<paths.evidence>/<domain>/<kind>/<TC-ID>/<runId>/` — screenshot, `trace.zip`, video, `network.har`, `console.json`, `manifest.json` |

Report (§3) không đổi: một lần chạy UI sinh cùng Markdown + JSON + dòng SQLite như lần chạy API, vì tầng
trình duyệt tổng hợp cùng `RequestTraceEntry` mà report writer vốn đã đọc. Review dashboard hiển thị
screenshot ngay trong trang.

Luật riêng cho case UI-assisted:

- **Dành dãy `U` cho ID** (`TC-ORD-U01`) để case UI không bao giờ đụng dãy số API đã lên kế hoạch.
- **Kiểm tra precondition qua API trước khi mở trình duyệt.** Front end thường loại hẳn menu chưa được
  cấp quyền, nên thiếu quyền trông y hệt trang hỏng. Probe quyền đã cấp và lượng dữ liệu trước, trả
  `BLOCKED` — không bao giờ `FAIL` — khi không đạt.
- **Mặc định chạy chỉ-đọc.** Mọi request không phải GET tới host trong `web.allowedHosts` bị huỷ ở tầng
  route của trình duyệt, trừ khi `<safety.allowWritesEnv>` bằng `1`. Ghi dữ liệu phải opt-in tường minh,
  đánh dấu dữ liệu tạo ra bằng `<safety.testDataMarker>`, và tự chịu trách nhiệm dọn dẹp.
- **Assert trên `pageErrors`, không phải `consoleErrors`.** Bản build production thường loại bỏ
  `console.*`, nên lỗi console có thể đọc ra 0 ngay cả khi app hỏng. Exception chưa bắt vẫn sống sót qua
  minify.
- **Không suy ra kích thước tập dữ liệu từ DOM.** Lưới phân trang phía client trên một trang dữ liệu
  server thì chỉ chứa nhiều nhất trang hiện tại.

---

## 2. Scenario automation (`<paths.suites>/<module.suite>/<api|ui>/<slug>.scenario.ts`)

Dùng scenario tham chiếu của dự án (knowledge file) làm bản mẫu. Cấu trúc:

### 2.1 Header constants
```ts
const TEST_CASE_ID = 'TC-ORD-Rxx';
const TEST_CASE_NAME = '<tên tiếng Việt ngắn, khớp tiêu đề spec>';
const TEST_OBJECTIVE = '<một câu bao mọi rule mà lần chạy này kiểm chứng>';
```

Giữ `TEST_CASE_ID` là string literal: công cụ của harness quét file scenario để nhóm artifact theo nó.

### 2.2 Options / Result interfaces
- `<Slug>Options`: tối thiểu `{ <bộ chọn fixture>, dryRun?, cleanup? }` cộng mọi override hữu ích để ghim
  tay (ví dụ `itemCode`, `contractId`) để có thể bỏ qua dò tự động chập chờn.
- `<Slug>Result`: `{ scenario, dryRun, passed, blocked?, blockedReason?, payload(A/B)?,
  payload(A/B)Context?, createdOrder(A/B)?, checks?, steps, error?, overview?, reportModel? }`. Nó phải
  thoả về cấu trúc `ReportableResult` của kit (`@qakit/core`, `report/result.ts`). `CheckResult` và
  `check` đến từ `@qakit/core` (`assertions.ts`), thường qua lớp re-export assertions của harness. Phần tử
  `steps` có hình dạng `ReportStep` của kit (`{ title, ok, status?, data? }`) — dùng lại kiểu step dùng
  chung của harness nếu có; đừng tự chế một hình dạng khác.
  `reportModel?: QaReportModelOverride` (`@qakit/core`, `report/model.ts`) không bắt buộc nhưng nên có —
  xem §2.5.

### 2.3 Top-of-function JSDoc block
Trước hàm `run...Scenario` được export, viết JSDoc ghi lại:
- Scenario hiện thực testcase doc nào, và một dòng nêu step matrix giả định của doc lệch hợp đồng backend
  thật ở đâu (nếu có) — đây là chỗ kết quả trace mã nguồn thuộc về trong code, phản chiếu §11 của spec.
- Class/method/field DTO backend chính xác liên quan, kèm tham chiếu file, để người đọc sau không phải suy
  lại.
- Mọi **wire gotcha** in đậm, đã kiểm chứng live kèm ngày (`WIRE GOTCHA (verified live, YYYY-MM-DD)`).
- Scenario chia thành các phần thế nào (ví dụ "Part A: luôn chạy, không cần duyệt" / "Part B:
  best-effort, cần duyệt") và mỗi phần phủ gì.
- `TODO [cần xác nhận]` cho mọi thứ cố ý không phủ, kèm lý do.

Comment này không để trang trí — nó là nơi duy nhất chứa "vì sao" của phần hiện thực, nên viết như thể
người đọc tiếp theo mở sẵn testcase doc nhưng không có mã nguồn backend.

**Ranh giới kiến trúc (nêu tường minh, trong comment phía trên import):** scenario chỉ resolve dữ liệu, gọi
API của sản phẩm (hoặc điều khiển trình duyệt), và trả `<Slug>Result` (steps/checks/overview/reportModel).
Nó không bao giờ được import kho kết quả chạy, gọi hàm persist, hay phụ thuộc `node:sqlite` — ghi lần chạy
vào DB là việc của report pipeline, chạy *sau* khi hàm này trả về và cố ý best-effort (lỗi DB không bao
giờ được làm hỏng scenario hay chặn việc ghi report Markdown/JSON). Harness giữ luật này bằng một
architecture fitness test (knowledge file).

### 2.4 Function body pattern
1. Resolve điều kiện tiền đề qua data provider của context, `steps.push({ title, ok, status, data })` cho
   mọi lời gọi có ý nghĩa (dò, resolve, và mọi HTTP call của luồng).
2. Nếu precondition bắt buộc không thoả (ví dụ không fixture nào thoả `P1`), **trả kết quả `blocked` ngay**
   kèm `blockedReason` cụ thể nói rõ người vận hành phải sửa gì — không bao giờ bịa dữ liệu để ép pass.
3. Tôn trọng `options.dryRun`: dựng payload, trả sớm với `passed: true` và `overview` ghi "Dry run: chỉ
   chuẩn bị dữ liệu đầu vào, chưa tạo bản ghi thật." — không mutation live.
4. Check biên/âm trước (độc lập với bản ghi được tạo), rồi mới tới luồng dương chính, dùng helper
   `check(label, expected, actual, testId)` dùng chung. Chuỗi `testId` phải là
   `'<TEST_CASE_ID> / <assertion ID>'` (hợp lệ theo `ids.checkRef`) khớp §7 của spec.
   - So theo mã lỗi ổn định (hàm trích mã lỗi của dự án / `ReportWording.extractError`), không bao giờ so
     chuỗi message đã dịch.
5. Bọc phần mutation live trong `try { ... } catch (err) { failed = ... }` để lỗi ném ra vẫn tới cleanup và
   report vẫn được ghi.
6. Coi vấn đề chập chờn/đã biết của môi trường (background job, luồng duyệt chập chờn) là `blocked`, không
   phải `failed` — ghi `blockedReason*` dễ đọc và để các check *đã* chạy vẫn tính vào `passed`. Gộp các lý
   do chặn từng phần thành một `blockedReason` ở cuối.
7. **Cleanup luôn chạy** (trừ khi `options.cleanup === false`), kể cả sau lỗi ném ra, và phòng thủ theo từng
   bản ghi (bỏ qua nếu đã huỷ, log lỗi mà không ném).
8. Tính `passed` như tín hiệu hỏng cứng của scenario, không phải verdict QA cuối. Verdict cuối được suy ra
   sau bởi `deriveVerdict(...)` của kit (`@qakit/core`, `report/verdict.ts`) từ `checks`, `blocked`, và
   quy ước marker `NOT_EVALUATED`:
   - dùng `passed = false` cho lỗi sản phẩm đã xác nhận hoặc lỗi thực thi cứng
   - giữ `passed = true` khi phần đã chứng minh của scenario thành công, kể cả khi checkpoint khác bị
     blocked hoặc `NOT_EVALUATED`
   - đặt `blocked` / `blockedReason` cho blocker về môi trường, fixture, quyền, hoặc hợp đồng chưa chốt
   - đánh dấu assertion chưa đánh giá bằng chuỗi literal `NOT_EVALUATED` ở `expected` và/hoặc `actual`
   Đây là thứ cho phép verdict cuối của report/DB thành `PARTIAL` thay vì một `PASS` sai.
9. Dựng `overview` qua helper cục bộ `buildOverview({...})` (xem §2.5) — chỉ bỏ qua khi lần chạy crash
   (`failed` truthy) trước khi có đủ ngữ cảnh. Có thể dựng thêm `reportModel` qua helper cục bộ
   `buildReportModelOverride({...})` (xem §2.5) — cùng điều kiện bỏ qua.

### 2.5 `overview` và `reportModel`: hai đầu vào report mà scenario cung cấp

Luồng ghi luôn dựng một `QaReportModel` chung từ `steps`/`checks`/`overview` của scenario
(`buildDefaultReportModel` của report kit), rồi merge override `reportModel` của scenario lên trên
(`mergeReportModel` — field override thắng, mọi thứ không đặt giữ giá trị chung). **`overview` vẫn bắt
buộc** — nó nuôi phần fallback chung (header report, danh sách key data, fallback business
scenario/defect statement) kể cả khi scenario cung cấp đủ `reportModel`. **`reportModel` không bắt buộc** —
viết khi fallback chung, suy ra máy móc, không kể được câu chuyện nghiệp vụ thật bằng bản tuyển chọn tay
(đây là điều làm scenario tham chiếu nổi bật: mọi mục trong report Markdown của nó do scenario viết, không
phải chung chung).

#### `buildOverview` → `ReportOverview` (`@qakit/core`, `report/result.ts`)
Một hàm riêng ở cuối file, nhận đúng các field cần để render:
```ts
interface ReportOverview {
  testCaseId: string;
  testCaseName: string;
  objective: string;
  keyData?: string[];       // chuỗi "Nhãn `giá trị`": dự án, hợp đồng, hạng mục, số đơn
  highlights?: string[];    // 1 bullet cho mỗi rule lần chạy này phủ, quan trọng nhất trước, tiếng Việt
  attention?: string;       // thất bại/blocker quan trọng nhất, hoặc undefined nếu sạch
}
```
Luật điền:
- `keyData`: mọi giá trị định danh mà reviewer cần để tìm dữ liệu của lần chạy trong môi trường — tên đã
  resolve từ id (không chỉ id thô) và mọi số bản ghi được tạo.
- `highlights`: suy mỗi bullet từ một entry `checks` cụ thể qua `findCheck(label)` — viết tường minh cả
  trường hợp PASS và FAIL (đừng chỉ nói "đã kiểm X"; nói điều gì được xác nhận hoặc điều gì hỏng). Khi nghi
  regression khớp lịch sử bug đã biết, nói rõ ("PHÁT HIỆN NGHI VẤN BUG ... — khớp lịch sử bug #xxxx").
- `attention`: chọn một điều tệ nhất — bug đã xác nhận > blocker chưa kiểm chứng > check fail đầu tiên —
  không bao giờ để trống khi có gì đó sai.

#### `buildReportModelOverride` → `QaReportModelOverride` (`@qakit/core`, `report/model.ts`)
Một hàm riêng ở cuối file, suy mọi field từ cùng trạng thái `checks`/blocker mà `buildOverview` đọc. Mọi
field đều tuỳ chọn — chỉ đặt những field đáng tuyển chọn:
```ts
interface QaReportModelOverride {
  header?: Pick<QaReportHeader, 'relatedBugs'>;  // ví dụ ['#1201', '#1207']
  qaSummary?: {
    businessScenario: string; verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED';
    severity?: string; reproducibility?: string; defectStatement?: string; impactedArea?: string;
  };
  expectedVsActual?: QaCheckpointRow[];   // { checkpoint, expected, actual, result } — chỉ các check CHÍNH
  reproSteps?: string[];                  // repro tối thiểu, ngôn ngữ nghiệp vụ, renderer tự đánh số
  passedScope?: string[];                 // điều đã xác nhận đúng, một bullet cho mỗi rule
  defectDetails?: { observedMismatch?: string; probableFailingRule?: string; regressionNote?: string; suspectedComponent?: string };
  conclusion?: string;                    // một đoạn kết, theo verdict
}
```
Luật điền:
- `qaSummary.verdict`: giữ khớp với kết quả thật suy ra từ `deriveVerdict(...)`, không phải lối tắt
  `passed ? PASS : FAIL`. Cụ thể:
  - dùng `PARTIAL` khi một số check thực sự pass nhưng checkpoint khác bị blocked hoặc `NOT_EVALUATED`
  - dùng `BLOCKED` chỉ khi testcase không tạo được bằng chứng pass có ý nghĩa cho phần được chấm
  - dùng `FAIL` cho hành vi sai đã xác nhận
  Không bao giờ để lệch với `passed`/`blocked` của chính scenario và bằng chứng checklist.
- `expectedVsActual`: dựng qua `KEY_CHECK_LABELS.map(findCheck).filter(Boolean).map(...)` — chọn các check
  kể được câu chuyện, không phải mọi check (checklist đầy đủ vẫn render ở phụ lục kỹ thuật). Dùng
  `describeCheck`/`formatCheckValue` của wording dự án (export qua lớp bọc report của harness) để nhãn/giá
  trị khớp với phụ lục.
- `defectDetails`/`conclusion`: chỉ điền khi có phát hiện đã xác nhận — khi không có gì fail hẳn, để
  `defectDetails` là `{}` và để `conclusion` nêu kết quả PASS/BLOCKED sạch thay vì bịa ra defect.
- Để field không đặt (không phải giá trị rỗng) để fallback về builder chung — `mergeReportModel` chỉ ghi đè
  field thực sự được đặt.

### 2.6 Đặt tên & đăng ký
- Tên file: `<slug>.scenario.ts`, kebab-case, khớp khái niệm chứ không khớp test-case ID (nhiều test case có
  thể dùng chung hạ tầng nhưng mỗi rule riêng thường có file scenario riêng). File nằm trong
  `<paths.suites>/<module.suite>/<api|ui>/`.
- Đăng ký scenario theo cách harness của dự án yêu cầu (knowledge file): thường là một tên trong registry
  tên scenario, một entry handler trong barrel của thư mục suite, và sinh lại chỉ mục scenario-group. Chạy
  mọi scenario bằng lệnh chạy một scenario chung của harness; các lát tổng hợp (all / api / ui / theo
  module) chọn từ chỉ mục scenario-group và tự nhận scenario mới — không thêm script riêng cho từng
  scenario.

---

## 3. Reports

### 3a. QA/QC run report tự sinh — không viết tay

Mỗi lần chạy scenario ghi `<paths.reports>/<domain>/<kind>/<TC-ID>/<timestamp>.md` cùng một JSON run
artifact máy đọc được trong cùng thư mục nhóm của cây outputs. Builder chung, renderer, luật verdict và run
artifact nằm trong kit (`@qakit/core`, `packages/core/src/report/`: `createReportKit`, `ReportWording`,
`deriveVerdict`, `mergeReportModel`); harness gắn chúng với wording của dự án trong lớp bọc report và gọi
luồng ghi từ CLI (vị trí ghi trong knowledge file). **Không bao giờ viết tay hay sửa tay `.md`/`.json` sinh
ra** — thay vào đó, bảo đảm scenario điền các field nuôi nó (§2.2/§2.5):

- `overview` + `reportModel` → nuôi `buildDefaultReportModel` chung merge với override `reportModel` của
  scenario, rồi `renderQaMarkdown` render thành report Markdown 9 mục: **1** Report Header, **2** QA/QC
  Decision Summary, **3** Expected vs Actual, **4** Business Reproduction Steps, **5** Scope of What Passed,
  **6** Defect Details, **7** Evidence Summary, **8** Technical Appendix (bảng checklist/evidence/steps đầy
  đủ — xem dưới), **9** Final Conclusion.
- `steps` → nuôi cả fallback repro-step chung của §4 và bảng Steps đầy đủ trong Technical Appendix §8, dịch
  sang ngôn ngữ nghiệp vụ bởi `describeStep` của wording. **Nếu scenario đưa vào một dạng tiêu đề step
  thực sự mới**, thêm luật tương ứng vào bảng wording step của dự án để nó không rơi vào bản dịch fallback
  chung.
- `checks` → nuôi Expected vs Actual của §3 (qua `reportModel.expectedVsActual` nếu có, không thì fallback
  chung top-N fail rồi pass) và checklist đầy đủ ở §8. Thêm luật tương ứng vào bảng wording check của dự án
  (đọc bởi `describeCheck`) cho mọi check label mới để nó đọc thành câu nghiệp vụ thay vì nhãn thô.
- `payload(A/B)` + `payload(A/B)Context` → render mục payload trong Technical Appendix §8 với tên đã
  resolve, không phải id thô (qua các hook appendix của wording).
- Mọi HTTP call đi qua HTTP client của harness được tự động ghi vào bảng trace/evidence (Evidence Summary
  §7 và bảng call đầy đủ §8). Nếu call chạm một endpoint hoàn toàn mới, thêm luật mục đích vào bảng wording
  API call của dự án (đọc bởi `describeApiCall`) để bảng hiện mục đích thật thay vì `METHOD /path` thô.

Nếu report render ra nhãn step/check chưa dịch, §2-§6 chung chung/trống mà một `reportModel` tuyển chọn lẽ
ra phải điền, hoặc field "(not set)" lẽ ra có dữ liệu, đó là tín hiệu phải sửa scenario hoặc bảng wording —
không phải sửa file `.md` sinh ra.

**Cũng tự động, scenario không cần làm gì:** luồng ghi persist cùng lần chạy vào kho SQLite
(`reporting.sqlite`) ngay sau khi ghi file — best-effort, nên lỗi DB được log và không bao giờ làm hỏng
scenario hay chặn Markdown/JSON xuống đĩa. Lần chạy sau đó xem được trên review dashboard cục bộ, nơi đọc
cây outputs/reports và ghi quyết định review của người cùng đề xuất do AI hỗ trợ vào các cây anh em nhóm
cùng cách. Không điều nào trong số này đổi thứ tác giả scenario viết — chúng dùng cùng
`ReportableResult`/`QaReportModel` mà mục này mô tả.

Report sinh ra và dòng DB phân biệt:
- `PASS`: mọi checkpoint được chấm đều chứng minh đúng
- `PARTIAL`: một phần bằng chứng đã chứng minh, nhưng còn ít nhất một checkpoint blocked hoặc `NOT_EVALUATED`
- `BLOCKED`: phần được chấm chưa thể thực thi có ý nghĩa
- `FAIL`: một checkpoint được chấm chắc chắn sai

### 3b. Recap report viết tay (`<thư mục recap>/TC-<ID>-<YYYYMMDD>.md`)

Viết khi một lần chạy (hoặc một điều tra ngắn qua vài lần chạy) cho ra verdict đáng tóm tắt cho người đọc
không kỹ thuật, hoặc khi lần chạy tự động là `BLOCKED`/`FAIL` và cần chẩn đoán dễ đọc hơn report tự sinh.
Các recap tham chiếu được liệt kê trong knowledge file. Hình dạng:

```markdown
# TC-<ID> — <tên ngắn> (<ngày>)

## 1. Tóm tắt
| Field | Value |
|---|---|
| Test case | `TC-<ID>` — <phát biểu rule một dòng> |
| Kết quả | **PASS** / **FAIL** / **BLOCKED (môi trường)** — một dòng bổ nghĩa |
| Automation | [`<slug>.scenario.ts`](link tương đối) — chạy: <lệnh chạy một scenario> <slug> |
| Run artifact (cuối) | [`<artifact>.json`](link tương đối tới cây outputs) |
| Bản ghi test | số bản ghi đã tạo, và trạng thái dọn dẹp |

## 2. Assertion results (<ngữ cảnh: run nào, biến thể payload nào>)
| Assertion | Kết quả | Bằng chứng |
|---|---|---|
| `A1` ... | **PASS**/**FAIL**/**BLOCKED** | con số/giá trị cụ thể, không phải văn xuôi |

## 3. Blocker môi trường   ← chỉ khi có gì đó bị chặn
### <BLOCKER-ID> (đã biết / MỚI, <ngày>): <mô tả ngắn>
- Chuyện gì xảy ra (nguyên văn lỗi/HTTP status)
- Là lỗi harness hay vấn đề môi trường/backend — nói rõ vì sao biết (ví dụ "một lần chạy PASS trước đó trên
  cùng dữ liệu giờ fail y hệt ⇒ không phải harness")
- Hệ quả phía sau (assertion nào bị chặn)

## 4. Điều kiện thực thi & field names đã xác nhận
- Ràng buộc môi trường phát hiện khi chạy (ví dụ "chỉ có 1 hạng mục có ≥2 đơn vị")
- Tên field chính xác đã kiểm chứng từ response, để lần chạy sau không phải dò lại

## 5. Kết luận & đề xuất
1. Kết luận đánh số: điều đã chứng minh vs chưa chứng minh
2. Backend/hạ tầng cần sửa gì, dẫn blocker ID
3. Lệnh chạy lại chính xác
4. Khoảng trống coverage còn lại và dữ liệu/fixture nào sẽ lấp nó
```

Luật:
- Mỗi dòng assertion phải dẫn **con số hoặc giá trị cụ thể**, không phải "OK"/"trông ổn".
- Mọi khẳng định BLOCKED/FAIL phải truy được về report tự sinh hoặc JSON artifact — dẫn link, đừng nhắc lại
  số liệu theo trí nhớ.
- Nếu một blocker có thể là lỗi harness chứ không phải lỗi sản phẩm thật, nói rõ đã kiểm gì để loại trừ (ví
  dụ chạy lại một scenario từng pass trên cùng dữ liệu).
- Kết thúc bằng một hành động tiếp theo cụ thể (lệnh chạy lại, fixture dữ liệu cần chuẩn bị, file mã nguồn
  cần đọc) — không bao giờ kết thúc bằng câu hỏi mở không kèm hướng giải quyết.

---

## 4. Checklist end-to-end cho một test case mới

1. Đọc tài liệu nguồn inventory/scenario liên quan dưới `<paths.featureDocs>/<module>/` trước.
2. Copy template `api-test-steps.md` → `<paths.steps>/api/<thư mục module>/TC-<ID>-<slug>.md`, điền mục 1–10.
3. Trace backend thật (repository mã nguồn trong `apiSources.<source>.repository`, hoặc gọi live đã kiểm
   chứng qua `mcp__<mcp.apiServerName>__execute_api_action`) cho mọi `[cần xác nhận]` trước khi viết code —
   không bao giờ mã hoá một hợp đồng đoán mò vào scenario.
4. Viết `<slug>.scenario.ts` trong `<paths.suites>/<module.suite>/<api|ui>/` theo §2; chạy dry-run trước để
   kiểm tra payload trước khi chạm endpoint live.
5. Chạy live; nếu bảng wording của dự án thiếu bản dịch tiêu đề step hay nhãn check, thêm vào. Nếu fallback
   `QaReportModel` chung không kể tốt câu chuyện nghiệp vụ, thêm `buildReportModelOverride` (§2.5).
6. Nối §11 "Automation findings" vào test-steps doc với những gì trace mã nguồn đã đính chính.
7. Nếu lần chạy sạch và khớp kỳ vọng, xong — report tự sinh là hồ sơ. Nếu là
   `PARTIAL`/`BLOCKED`/`FAIL`/phát hiện bug, viết recap report theo §3b, nhất là khi cần giải thích việc tách
   blocker cho người đọc.
