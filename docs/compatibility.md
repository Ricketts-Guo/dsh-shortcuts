# DSH compatibility validation

Version **1.1.5** updates source commit `bf392410868c9686ed3292d2c2272469da3a3293`
for the official release window resolved on **2026-09-20** from npm and the
published official GitHub Releases. The plugin uses the standard DSH Bundle
contract: **compatible**, with one additive plugin-owned entry, `shortcuts`.

## Acceptance matrix

Environment: macOS arm64, Node.js **24.14.1**, headless Chrome with a new browser
context for each run, and a newly created temporary `DSH_HOME` / `web` Profile.

| Exact DSH release | Install | Cold start / browser | Uninstall | Snapshot rollback | Source declaration |
| --- | --- | --- | --- | --- | --- |
| 0.1.5-rc.2 | passed | passed | passed | passed | compatible |
| 0.1.6-alpha.1 | passed | passed | passed | passed | compatible |
| 0.1.6-alpha.2 | passed | passed | passed | passed | compatible |

Sanitized machine-readable results are committed under
[`docs/evidence`](evidence/). Each record includes the runtime package count,
check time, Node/platform, tested package SHA-256, source-file SHA-256 values,
and operation results. Evidence JSON and screenshots are repository artifacts;
they are deliberately outside the npm package file list so the measured package
does not contain its own hash. The result files belong to the same source commit
as this document; subsequent runs must revalidate these hashes.

The runtime harness verifies **every installed `@deepseek-ai/dsh*` package**
against the exact target version and its npm lockfile. Pinning only the CLI is
insufficient: prerelease dependency ranges can select a newer alpha component.
The three setup manifests in `test/runtimes/` pin the full DSH package graph.

## What the checks prove

- **Install:** pack the checkout without lifecycle scripts, extract the artifact,
  and run the repository's `install.sh` against the official exact-version CLI.
  The script delegates to `dsh plugin --profile web add --save-prod --ignore-scripts`.
  `--dump-config` shows exactly one plugin entry and unchanged official entries.
- **Start:** cold-start the WebUI on a temporary loopback port, authenticate with
  its disposable boot URL, acknowledge the welcome notice and skip API-key setup.
  Click the visible shortcut entry, open the 34-feature cheatsheet, render the
  palette and all 34 settings rows, and dispatch theme/sidebar shortcuts.
  No uncaught browser exceptions are allowed. Permission requests without
  authentication return 401, foreign Origin returns 403, GET returns 405, and
  missing POST parameters return 400 with `ok: false`.
- **Uninstall:** stop the test server, use `dsh plugin --profile web remove`,
  compare composed configuration with the baseline, cold-start, and confirm
  the plugin permission route is absent.
- **Rollback:** restore the complete pre-install Profile snapshot, compare
  composition, and cold-start once more. The test removes its disposable data.
- **Regression suite:** 22 Client checks plus Host and installer contracts cover
  public navigation services, palette rendering without implicit slot hooks,
  legacy and alpha.2 selection, permission catalog failure/retries, cancellation
  after navigation/unmount, subscription disposal, model/reasoning selection, message
  copying, keyboard defaults, route errors and CLI failure propagation.

## Limits and permissions

The Node.js declared range is `>=22.13.0`, matching the supported host minimum;
only Node.js 24.14.1 was exercised here. Desktop, Windows, Linux, and other DSH
releases remain **unverified**. No user's real Profile was changed or restarted.
No model API key is required and no model request is sent during acceptance.
Model selection, task cancellation and successful session-permission mutations
are covered with public-service fakes; this browser smoke run does not prove a
live model conversation or every session action end to end.

The permission shortcut changes the selected session's sandbox/approval preset.
It reads the existing session projection and, on alpha.2, the public process-wide
permission catalog, then calls the existing local Host route. It can increase
session permissions. The route explicitly calls the public Host connection
authentication/Host/Origin check and accepts POST only. Keep the WebUI on loopback;
this release does not claim an independent security audit. See [SECURITY.md](../SECURITY.md).

The Bundle, client slots and runtime code remain additive. No protected entry,
`@deepseek-ai/*` package, loader or fiber is replaced. The installer changes
Profile dependencies only through the official CLI. User key bindings remain in
browser localStorage until explicitly cleared.

## Reproduce

From a checkout of this commit, install only the pinned development dependencies:

```bash
npm ci --ignore-scripts
npm run check
```

Prepare an isolated runtime (repeat with each version in the matrix):

```bash
DSH_TEST_VERSION=0.1.6-alpha.2
DSH_TEST_RUNTIME="$(mktemp -d)"
cp "test/runtimes/$DSH_TEST_VERSION.json" "$DSH_TEST_RUNTIME/package.json"
npm install --prefix "$DSH_TEST_RUNTIME" --ignore-scripts --no-audit --no-fund
npm run test:runtime -- \
  --runtime "$DSH_TEST_RUNTIME" \
  --output "$PWD/.tmp/evidence/$DSH_TEST_VERSION" \
  --browser chrome
```

The harness starts its own headless Chrome instance; it does not attach to a
personal browser profile. Alternatively install Playwright Chromium with
`npx playwright install chromium` and omit `--browser chrome`.
`--output` keeps sanitized `result.json`, `commands.json`, and screenshots. Boot
tokens and temporary source/runtime paths are redacted from retained logs.
The runtime installation is left in the caller's temporary directory for reuse;
the harness itself cleans its per-run Profile and workspace.

## Engineering decisions and release gates

| Decision | Objective / benefit | Cost | Evidence | Reconsider when |
| --- | --- | --- | --- | --- |
| Public UI services with legacy selection fallback | Support the three official releases | Maintain two selection shapes | Regression suite and browser boot | DSH publishes a different public API |
| Exact release declarations | Supply installable compatibility evidence | Retest new releases | Per-version matrix and hashes | Official latest-three window changes |
| Official CLI installer | Preserve DSH package ownership | Requires an installed CLI | Real disposable installation | Official package-management contract changes |
| Web-only tested scope | Make support claims match evidence | Desktop/other systems remain unverified | macOS disposable tests | Separate platform acceptance is available |

Evidence levels are source review (E1), regressions (E2), and disposable runtime
acceptance (E3). Real Profile acceptance and an independent security review are
not claimed. Source publication, Catalog acceptance and public marketplace
visibility are separate outcomes. The next gate after pushing this fixed commit
to the default branch is **DSH STORE's own source verification and Catalog/page
readback**; these tests alone do not prove reinstatement.
