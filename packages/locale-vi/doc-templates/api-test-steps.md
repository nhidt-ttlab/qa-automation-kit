# Template: API-driven test steps

Chép file này thành `<paths.steps>/api/<thư mục module>/TC-<ID>-<slug>.md`, trong đó `<thư mục module>`
là `<module.stepDir ?? module.docSlug ?? module.id>` và `TC-<ID>` khớp `ids.testCase`
(`TC-<module.tcPrefix>-<dãy><nn>`, ví dụ `TC-ORD-R02`). Viết bằng tiếng Việt; giữ nguyên tên định danh
trong code, đường dẫn endpoint, tên field và mã lỗi để grep được trong mã nguồn. Ví dụ và quy ước riêng
của dự án nằm ở `<paths.knowledge>/doc-templates.md`.

## Status

- Test step status: `Draft` or `Ready`
- Use `Draft` when any core API, rule, assertion, dependency, or evidence path is still unresolved, blocking, or marked `[cần xác nhận]`.
- Use `Ready` only when the testcase can be executed end-to-end with concrete steps, concrete evidence, and finalized pass/fail criteria.
- If the testcase is `Draft`, add a short banner under the title, for example:
  - `> **DRAFT** - ...`
  - `> **DRAFT - BLOCKING** - ...`

## 1. Test overview

| Field | Content |
|---|---|
| Test case ID | `TC-...` |
| Test case name | Short business rule name |
| Test step status | `Draft` or `Ready` |
| Module | Example: `Đơn hàng` |
| Source feature doc | Relative link to feature extraction doc (dưới `<paths.featureDocs>`) |
| Covered SpecID | Example: `DH-198`, `DH-205`, `DH-209`, `DH-210` |
| Primary rule | One sentence that states the rule being verified |
| Test type | `API-driven`, `UI-assisted`, or `Hybrid` |

> `Test type` is `API-driven` here. For `UI-assisted` or `Hybrid`, start from
> [`ui-test-steps.md`](ui-test-steps.md) instead — it adds a gate for whether the UI case should
> exist at all, the `U`-series ID rule, a `Target (selector)` column in section 6, a permission
> convention in section 5, and the oracle/wait/grid/selector-stability blocks in section 9.

## 2. Business rule in one paragraph

Describe the behavior in business language only:
- Input/state before action
- Business event
- Expected business result

## 3. Traceability to API feature

| SpecID | Feature field / rule | Why this test needs it |
|---|---|---|
| `DH-xxx` | Field or rule name | Reason |

## 4. Test data

| Key | Value | Notes |
|---|---|---|
| `projectId` | | |
| `contractId` | | |
| `itemCode` | | |
| `baselineQty` | | |
| `orderQtyStep1` | | |

## 5. Preconditions

| ID | Condition | How to verify / prepare | Evidence |
|---|---|---|---|
| `P1` | | | API / query / doc |
| `P2` | | | API / query / doc |

## 6. Step matrix

| Step | Phase | Action | API / actionId | Input | Expected result | Evidence to capture |
|---|---|---|---|---|---|---|
| `S1` | Setup | Prepare data | | | Data exists and is valid | Response payload |
| `S2` | Execute | Trigger business action | | | Action succeeds | Created ID / status |
| `S3` | Verify | Re-read computed data | | | Returned values match rule | Key fields |

Authoring rules:
- One row = one verifiable action.
- Every verification step must point to an API, not only a screen.
- Use `Expected result` for the business meaning and `Evidence to capture` for the exact field/value.
- Split `Execute` and `Verify`; do not hide verification inside an action step.
- Keep the declared `Test step status` aligned with the actual content of the file.
- `API / actionId` dùng action id của API MCP, dạng `<apiSource>::<METHOD>::<path>` (`<apiSource>` là một
  khoá của `apiSources`). Xác nhận bằng `mcp__<mcp.apiServerName>__load_domain_api_registry`, không đoán
  đường dẫn.

## 7. Assertions

| Assertion ID | Expression | Expected |
|---|---|---|
| `A1` | `actualRemainingQty = baselineQty` after cancellation | `true` |
| `A2` | `cancelledOrderQty` is excluded from cumulative quantity | `true` |

Assertion ID khớp `ids.assertion`; check trong automation trích dẫn chúng theo `ids.checkRef`
(`TC-ORD-R02 / A2`), nên giữ ổn định khi đã có automation.

## 8. Pass / fail rule

- `PASS` when all assertions are true and all required evidence is captured.
- `FAIL` when any assertion is false or a required API result cannot be verified.

## 9. Notes for automation

- Required dynamic outputs from prior steps
- APIs that can be called directly from MCP (`mcp__<mcp.apiServerName>__execute_api_action`) / regression suite
- Cleanup steps if test data should be restored
