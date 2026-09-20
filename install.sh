#!/usr/bin/env bash
# Install the current checkout through DSH's official plugin manager.
# Optional: DSH_SHORTCUTS_DIR, DSH_BIN, DSH_HOME, DSH_PROFILE (default: web).
# DSH_PROFILE_DIR remains supported for <DSH_HOME>/profiles/<profile> paths.
set -euo pipefail

INSTALL_DIR="${DSH_SHORTCUTS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
DSH_CMD="${DSH_BIN:-dsh}"
PROFILE_NAME="${DSH_PROFILE:-web}"

if [ -n "${DSH_PROFILE_DIR:-}" ]; then
  PROFILE_DIR="${DSH_PROFILE_DIR%/}"
  PROFILES_DIR="$(dirname "$PROFILE_DIR")"
  if [ "$(basename "$PROFILES_DIR")" != profiles ]; then
    echo '错误: DSH_PROFILE_DIR 必须是 <DSH_HOME>/profiles/<profile>。' >&2
    exit 1
  fi
  export DSH_HOME="$(dirname "$PROFILES_DIR")"
  PROFILE_NAME="$(basename "$PROFILE_DIR")"
fi

if [[ ! "$PROFILE_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || [ "$PROFILE_NAME" = desktop ]; then
  echo '错误: 请选择 web 或已有的自定义 Web Profile；Desktop 由官方应用管理。' >&2
  exit 1
fi
if ! command -v "$DSH_CMD" >/dev/null 2>&1; then
  echo '错误: 找不到 DSH，请先安装 DSH，或通过 DSH_BIN 指定可执行文件。' >&2
  exit 1
fi
if [ ! -f "$INSTALL_DIR/package.json" ]; then
  echo '错误: 请克隆插件仓库后运行 install.sh，或设置 DSH_SHORTCUTS_DIR。' >&2
  exit 1
fi
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
node - "$INSTALL_DIR/package.json" <<'NODE'
const pkg = require(process.argv[2]);
if (pkg.name !== 'dsh-shortcuts' || !pkg.dsh?.bundle?.patch) {
  throw new Error('The selected checkout is not a dsh-shortcuts Bundle.');
}
NODE

# DSH owns dependencies, lockfiles, module resolution, and bundle reconciliation.
# file: installs a managed copy; this script never pulls or edits the checkout.
"$DSH_CMD" plugin --profile "$PROFILE_NAME" add --save-prod --ignore-scripts "file:$INSTALL_DIR"
"$DSH_CMD" --profile "$PROFILE_NAME" --dump-config > /dev/null
printf '插件已安装到 %s，配置合成通过。请在方便时自行重启该 WebUI，再检查快捷键入口。\n' "$PROFILE_NAME"
printf '卸载：%q plugin --profile %q remove dsh-shortcuts\n' "$DSH_CMD" "$PROFILE_NAME"
