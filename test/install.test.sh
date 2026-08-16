#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

PROFILE_DIR="$TEST_ROOT/home/.dsh/profiles/web"
FAKE_BIN="$TEST_ROOT/bin"
mkdir -p "$PROFILE_DIR" "$FAKE_BIN"

cat > "$PROFILE_DIR/package.json" <<'JSON'
{
  "name": "dsh-profile-web-test",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app"
      ]
    }
  }
}
JSON

cat > "$PROFILE_DIR/pnpm-workspace.yaml" <<'YAML'
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
YAML

# 安装器对已有 checkout 只会执行 git pull；测试中隔离网络和真实工作树。
cat > "$FAKE_BIN/git" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$FAKE_BIN/git"

run_installer() {
  PATH="$FAKE_BIN:$PATH" \
    DSH_SHORTCUTS_DIR="$ROOT_DIR" \
    DSH_PROFILE_DIR="$PROFILE_DIR" \
    bash "$ROOT_DIR/install.sh"
}

# 首次安装必须生成 DSH 冷启动依赖的模块映射。
run_installer

node - "$PROFILE_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');

const profileDir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
const packageMap = JSON.parse(fs.readFileSync(path.join(profileDir, 'node_modules', '.package-map.json'), 'utf8'));
const bundles = pkg.dsh.profile.bundles.filter((name) => name === 'dsh-shortcuts');

if (!pkg.dependencies['dsh-shortcuts']) throw new Error('dependency was not registered');
if (bundles.length !== 1) throw new Error(`expected one bundle registration, got ${bundles.length}`);
if (!packageMap.packages['.'].dependencies['dsh-shortcuts']) throw new Error('package map is missing dsh-shortcuts');
if (!fs.existsSync(path.join(profileDir, 'node_modules', 'dsh-shortcuts', 'package.json'))) {
  throw new Error('installed plugin package is unavailable');
}
NODE

# 重复运行必须幂等，不得追加重复 bundle。
run_installer

node - "$PROFILE_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');

const profileDir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
const bundles = pkg.dsh.profile.bundles.filter((name) => name === 'dsh-shortcuts');
if (bundles.length !== 1) throw new Error(`reinstall duplicated bundle registration: ${bundles.length}`);
NODE

printf '  ✓ installer registers the plugin for DSH cold starts\n'
