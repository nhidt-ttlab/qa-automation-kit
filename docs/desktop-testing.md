# Testing a desktop (Electron) app

The UI lane can drive an Electron application as well as a web page. `@qakit/desktop` starts the app through
[WebdriverIO's Electron service](https://webdriver.io/docs/desktop-testing/electron) in standalone mode, the
approach the [Electron testing guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing#using-webdriverio)
recommends. A UI scenario gets the app from `ctx.desktop()`, next to the browser from `ctx.ui()`, and one scenario
may use both: for example, act in the desktop app and check the result on the web app.

Desktop runs are ordinary UI-lane runs. They use the same `U`-series test-case ids, the same step-doc target
grammar (`id=…`, `testid=…`, `role=button[name="…"]`, `label=…`, `text=…`, `css=…`, `a >> b`, `[n]`), the same
report, and the same run store with `run_type` `ui`.

## Set up

1. Add the package next to the other kit packages in the QA project's `package.json`, then `npm install`:

   ```json
   "@qakit/desktop": "file:<kit>/packages/desktop"
   ```

   `@wdio/electron-service` and `webdriverio` come from the kit's own install (`pnpm install` in the kit), the same
   way Playwright does for `@qakit/ui`. `qakit doctor` reports `desktop driver` if they cannot be loaded.

2. Describe the app in `qakit.config.yaml`:

   ```yaml
   desktop:
     # Unpackaged build: the main-process entry, launched with the app's own `electron`.
     appEntryPoint: { env: APP_DESKTOP_ENTRY, default: ../apps/desktop/out/main/index.js }
     appRoot: ../apps/desktop            # its package.json and node_modules/electron
     # Or a packaged build instead:
     # appBinaryPath: ../apps/desktop/dist/win-unpacked/App.exe
     appArgs: []
     env:                                # set for the app process only
       APP_MODE: { env: APP_DESKTOP_MODE, default: test }
     # chromedriverPath: { env: APP_DESKTOP_CHROMEDRIVER }   # see "Chromedriver" below
     timeoutMs: 30000                    # how long a step waits for its element
     captureLogs: true                   # main and renderer console into the run's evidence
   ```

   With neither `appBinaryPath` nor `appEntryPoint`, the service looks for an Electron Forge or electron-builder
   output under `appRoot`.

3. Build the app, then check the setup. `--desktop` also launches the app once and reads its window title:

   ```bash
   npx qakit doctor --config qakit.config.yaml --desktop
   ```

## Write a scenario

```ts
import { defineUiScenario } from '@qakit/runner';

export default defineUiScenario({
  name: 'helper-diagnostics',
  testCaseId: 'TC-WRK-U01',
  title: 'Diagnostics shows the helper link state',
  objective: 'The local link is reported as connected on the Diagnostics screen.',
  module: 'worker',
  async run(ctx) {
    const app = await ctx.desktop();                        // launched on first call
    await app.click('role=button[name="Diagnostics"]');
    ctx.check('A1', 'Local link', 'Connected', await app.readText('text=Connected'));
    ctx.check('A2', 'Pause is not offered', 0, await app.countMatching('role=button[name="Pause"]'));
    await app.screenshot('Diagnostics', { checkTestId: 'TC-WRK-U01 / A1' });
  },
});
```

The `DesktopDriver` records one report step per call:

| Method | Does |
|---|---|
| `click(target)`, `fill(target, value)`, `press(key)` | act on the current window |
| `readText`, `readValue`, `readControlState`, `countMatching` | read; `readControlState` and `countMatching` treat "absent" as an answer, not a failure |
| `waitForText(text)`, `switchWindow(titleOrUrl)` | wait for the renderer, pick another window |
| `executeMain(fn, ...args)` | run code in the Electron main process; `fn` gets the `electron` module first |
| `screenshot(caption, { checkTestId })` | evidence tied to an assertion |
| `step(title, action)` | wrap anything else as a recorded step |
| `browser` | the raw WebdriverIO session, e.g. `browser.electron.mock('dialog', 'showOpenDialog')` |

A failed step records the error and a screenshot of the window. A failed run also keeps the final window and the
app's process logs. Desktop evidence is written to `<run evidence>/desktop/` with ids `E-DT-nn`.

## What differs from the browser lane

- **No read-only guard.** The browser lane aborts non-GET requests unless writes are on. A desktop app makes its own
  requests from the main process, which WebdriverIO cannot intercept. Point the app at a test backend through
  `desktop.env`, and gate data-changing steps on the writes switch in the scenario.
- **No sign-in modes.** The app signs in however it does; drive it, or seed it through `desktop.env`.
- **No network trace.** API evidence comes from `ctx.http` calls the scenario makes, not from the app.
- **`executeMain` needs the inspector fuse.** Development builds have it. A packaged build that turned off
  `EnableNodeCliInspectArguments` can still be driven through its windows, but not through the main process.

## Environment notes

- **`ELECTRON_RUN_AS_NODE`.** A VS Code terminal exports `ELECTRON_RUN_AS_NODE=1`, which makes Electron start as plain
  Node. The kit removes it from the app's environment, so runs work from any terminal.
- **The app is always closed.** The kit reads the app's process id at launch and ends that process tree after the
  session. An app that hides to the tray when its window closes does not outlive the run.
- **Chromedriver.** WebdriverIO downloads the chromedriver that matches the app's Chromium version into the OS temp
  folder on the first run. On a machine without that download, or where unpacking it fails (the downloader can stop
  silently, leaving a `chromedriver/<version>` folder with no `chromedriver.exe` in it; delete that folder before
  retrying), download `chromedriver-<platform>.zip` for the version the error names from
  [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/), unpack it, and set
  `desktop.chromedriverPath`.
- **Logs.** WebdriverIO is set to `warn` unless `WDIO_LOG_LEVEL` is already set; set `WDIO_LOG_LEVEL=info` to see
  every command.
- **Display.** Electron needs a desktop session. On a Linux CI runner use `xvfb-run`.

## Not covered yet

The UI MCP server (`qakit-mcp-ui`) drives the browser only, and Tauri and other desktop frameworks are not wired.
`@wdio/native-types` already describes Tauri and Dioxus services, so `desktop.framework` can grow in the same shape.
