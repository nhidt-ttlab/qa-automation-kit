# Handoff 2026-10-17 — Test app desktop (Electron) bằng WebdriverIO trong UI lane

> **Bối cảnh:** UI runner của kit chỉ lái được web (`web.baseUrl`, Playwright). Dự án đầu tiên dùng kit có một Electron
> helper (tray/settings app) mà plan của nó phải miễn trừ khỏi UI lane vì lý do đó. Theo
> [hướng dẫn testing của Electron](https://www.electronjs.org/docs/latest/tutorial/automated-testing#using-webdriverio),
> kit giờ lái app Electron qua WebdriverIO + `@wdio/electron-service` (chế độ standalone, không cần WDIO test runner).
>
> **Trạng thái:** nhánh `feature/desktop-electron-wdio`, base `main` @ `e969b06808`, push và mở MR bằng `/handoff-pr`.
> MR này đứng riêng: superproject ghi pointer mới trên nhánh roadmap của nó (chưa push), không có MR bump pointer đi kèm.

## 1. Thiết kế

- **Desktop là một target trong UI lane, không phải kind thứ ba.** `defineUiScenario` nhận thêm `ctx.desktop()` bên
  cạnh `ctx.ui()`; một scenario dùng được một hoặc cả hai. Lý do: reporting app hard-code `api|ui` ở CHECK constraint
  của DB (`run_type`, `kind`), ở regex parse output `--list` và ở enum API — thêm kind `desktop` sẽ kéo theo migration
  và đổi contract batch. Desktop run vẫn là `U`-series, cùng report, cùng run store (`run_type` `ui`).
- **Cùng grammar locator với web lane** (`id=`, `testid=`, `role=…[name="…"]`, `label=`, `placeholder=`, `text=`, `css=`,
  `a >> b`, `[n]`), cùng thứ tự strategy, multi-match vẫn là lỗi nếu không có `nth`. WebdriverIO không có role engine:
  `role`+`name` = `aria/<name>` lọc theo computed role; `role` trơn = attribute + implicit role phổ biến; `label` =
  `aria/<label>` chỉ giữ form control.
- **Package mới `@qakit/desktop`**, `webdriverio` / `@wdio/electron-service` là optional peer (devDependency của kit, như
  Playwright với `@qakit/ui`), import lazy nên project không có `desktop` không bị ảnh hưởng.

## 2. Đã làm

- `packages/desktop/` (mới):
  - `driver.ts` — `DesktopDriver`: `click`, `fill`, `press`, `readText`, `readValue`, `readControlState` / `countMatching`
    (vắng mặt là câu trả lời, không phải lỗi), `waitForText`, `switchWindow`, `executeMain` (chạy ở main process),
    `screenshot`, `step`, `browser` (session WDIO thô). Mỗi lệnh ghi đúng một `UiStepRecord`; step lỗi tự chụp cửa sổ;
    `redact` giấu secret khỏi title/value.
  - `locator.ts` — map `LocatorSpec` sang selector WDIO, polling, `within`, `nth`.
  - `runtime.ts` — `createDesktopRuntime` (launch lazy một lần, ảnh cuối + log main/renderer khi fail, manifest, close
    không bao giờ throw), `launchElectronSession`, `electronCapability`, `applyLaunchEnv`, `quietWebdriverLogs`,
    `killProcessTree`, `desktopDriverInstalled`.
  - `target.ts`, `project-desktop.ts` — block `desktop` của config thành launch target; evidence riêng ở
    `<run evidence>/desktop/`, id `E-DT-nn`.
- `packages/core/src/config/schema.ts` — block `desktop` (tùy chọn): `appBinaryPath` | `appEntryPoint`, `appRoot`,
  `appArgs`, `chromedriverPath`, `env`, `timeoutMs`, `captureLogs`. `schema/qakit.config.schema.json` sinh lại.
- `packages/runner` — `UiScenarioContext.desktop()`; `ctx.web` resolve khi đọc (project chỉ có desktop không còn chết
  ngay khi chạy UI scenario); teardown đóng desktop trước browser; step desktop vào report; manifest desktop được ghi
  khi không có browser.
- `packages/cli` — `qakit doctor` kiểm tra target, `electron` dưới `appRoot`, driver, `chromedriverPath`; cờ mới
  `--desktop` launch app một lần và đọc title cửa sổ.
- `pnpm-workspace.yaml` — chặn build script của `edgedriver` / `geckodriver` (WDIO kéo theo, Electron không dùng).
- Docs: `docs/desktop-testing.md` (mới), README, ADOPTING, `docs/usage-guidelines.md`, `project-template/README.md`.
- Skills: `create-scenario-script` (mục "Desktop (Electron) windows"), `create-testcase-steps-ui` (desktop window cũng
  thuộc UI lane; không có read-only guard, không có network trace).

### Ba vấn đề môi trường gặp khi chạy thật, đã xử lý trong kit

1. **`ELECTRON_RUN_AS_NODE=1`** (terminal VS Code export) làm Electron chạy như Node → bỏ biến đó khỏi env của app khi
   launch, khôi phục sau.
2. **App ẩn xuống tray khi đóng cửa sổ** sống sót qua `deleteSession` (4 process `electron.exe` còn lại) → đọc PID main
   process lúc launch, `taskkill /T /F` cây process sau khi đóng session.
3. **Download chromedriver dừng im lặng** trên máy Windows + Node 24.16: zip tải xong (11 MB, curl 2.7s), extract dừng
   trước `chromedriver.exe`, process thoát không lỗi (exit 13, top-level await chưa settle) và để lại thư mục dở. Giải nén
   tay (`Expand-Archive`) cùng file thì chạy được → thêm `desktop.chromedriverPath` (service tôn trọng
   `wdio:chromedriverOptions.binary` nếu đã set). Ngoài ra `webdriver` chụp `WDIO_LOG_LEVEL` lúc import, nên mặc định
   `warn` được set trước import.

## 3. Đã verify

- `pnpm build` exit 0, `pnpm typecheck` exit 0.
- `pnpm test` **264/264** pass (gồm `no-project-strings` và `schema-sync`). Riêng `packages/desktop` + runner: **30/30**.
  - `packages/desktop/src/{locator,driver,runtime}.test.ts` chạy trên session WDIO giả (`fake-session.test-support.ts`,
    không ship vào `dist`).
  - `packages/runner/src/run.test.ts`: UI scenario trong project chỉ có `desktop` → PASS; **fail khi bỏ thay đổi ở
    `run.ts`** (đã kiểm bằng stash).
- GitNexus `impact` upstream trước khi sửa: `runScenario`, `isScenario`, `runDoctor` — đều LOW, mỗi hàm 1 caller trực tiếp
  (`runSuiteCli` / `runQakitCli`).
- Chạy thật trên dự án dùng kit, với Electron helper (Electron 44.8.0, chromedriver 152.0.7977.167 qua `chromedriverPath`):
  - `qakit doctor --desktop`: mọi check OK, `desktop launch` → `window "Engineering Agent" opened`.
  - Scenario tạm `TC-WRK-U90` qua `qakit suite`: **PASS 4/4 checks, 7.5s** — `executeMain` đọc title cửa sổ,
    `readText('text=…')`, `click('role=button[name="Diagnostics"]')`, `countMatching` = 0 cho nút không tồn tại, screenshot
    gắn `checkTestId`. Report có đủ 6 step desktop; evidence ở `…/desktop/` (screenshot, log WDIO, manifest). Không còn
    `electron.exe` nào sau run. Scenario tạm, report, evidence và dòng run store đã xóa sau khi kiểm.

## 4. Verify CHƯA làm

- GitNexus `detect_changes` của superproject **không thấy được** source trong submodule này (chỉ thấy diff của repo cha);
  thay bằng `impact` trước khi sửa và test ở trên.
- Chưa chạy trên Linux/macOS hay CI; Linux cần `xvfb-run` (đã ghi trong docs). Chưa thử `appBinaryPath` với bản build
  đóng gói (electron-builder) — chỉ thử `appEntryPoint`.
- Chưa thử đường download chromedriver tự động thành công trên một máy khác (trên máy này nó hỏng, xem §2.3).
- `examples/demo-app` không có app desktop nên `test/demo-e2e.test.ts` không phủ đường launch thật.

## 5. Cố ý KHÔNG làm

- **UI MCP server cho desktop** — chưa cần: dự án hiện tại có source renderer trong repo, và desktop không có read-only
  guard nên MCP cần cơ chế an toàn riêng. Làm khi viết nhiều step doc desktop hoặc test app không có source.
- Overlay tiếng Việt của skills (`packages/locale-vi/skills`) và `doc-templates/automation-guide.md` (vi) chưa có ghi chú
  desktop.
- Tauri / framework khác: `desktop.framework` hiện chỉ `electron`.

## 6. Còn phải làm / verify

1. Thêm một app Electron tối thiểu vào `examples/` và một test e2e desktop trong `test/`, chạy được trên CI (`xvfb-run`).
2. Báo lỗi extract chromedriver (Node 24 + `@puppeteer/browsers`) upstream nếu tái hiện được ngoài máy này.
3. Thêm `describeScreen()` cho `DesktopDriver` (liệt kê control đang render: id, role, name, enabled) — bước đầu cho
   desktop MCP sau này.
4. Bổ sung ghi chú desktop vào overlay `locale-vi`.
