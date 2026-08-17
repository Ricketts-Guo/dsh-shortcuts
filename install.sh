#!/usr/bin/env bash
#
# dsh-shortcuts — 一键安装脚本
#
# 用法（任选其一）:
#   curl -fsSL https://raw.githubusercontent.com/Ricketts-Guo/dsh-shortcuts/main/install.sh | bash
#   或克隆仓库后: ./install.sh
#
# 环境变量（可选）:
#   DSH_SHORTCUTS_REPO  插件仓库地址（默认 https://github.com/Ricketts-Guo/dsh-shortcuts.git）
#   DSH_SHORTCUTS_DIR   插件代码安装目录（默认 ~/dsh-shortcuts）
#   DSH_PROFILE_DIR     DSH web profile 目录（默认 ~/.dsh/profiles/web）
#
# 幂等：重复运行安全，会更新代码并确保注册完整。

set -euo pipefail

REPO_URL="${DSH_SHORTCUTS_REPO:-https://github.com/Ricketts-Guo/dsh-shortcuts.git}"
INSTALL_DIR="${DSH_SHORTCUTS_DIR:-$HOME/dsh-shortcuts}"
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}"

echo "==> 1/5 获取插件代码"

if [ ! -d "$INSTALL_DIR/.git" ]; then
  mkdir -p "$(dirname "$INSTALL_DIR")"
  echo "    克隆 $REPO_URL → $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  echo "    已存在 ${INSTALL_DIR}，尝试更新…"
  git -C "$INSTALL_DIR" pull --ff-only 2>/dev/null || echo "    更新失败（网络问题？），继续使用现有代码"
fi

echo "==> 2/5 检查 DSH profile"

if [ ! -f "$PROFILE_DIR/package.json" ]; then
  echo "错误: 找不到 $PROFILE_DIR/package.json"
  echo "     请先启动一次 DeepSeek Harness（会自动创建 web profile），然后重试本脚本。"
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM_CMD=(corepack pnpm)
else
  echo "错误: 找不到 pnpm。DSH 的 profile 插件需要由 pnpm 注册。"
  echo "     请先安装 pnpm（https://pnpm.io/installation），然后重试本脚本。"
  exit 1
fi

echo "==> 3/5 安装到 DSH profile"

# DSH 冷启动通过 pnpm 生成的 .package-map.json 解析 profile bundle。
# 只手动创建 node_modules 软链接不会更新这份映射，重启 DSH 后插件将无法加载。
"${PNPM_CMD[@]}" --dir "$PROFILE_DIR" add --save-prod "$INSTALL_DIR"

echo "==> 4/5 注册并校验 profile bundle"

python3 - "$PROFILE_DIR" <<'PY'
import json, os, sys

profile_dir = sys.argv[1]
pkg_path = os.path.join(profile_dir, 'package.json')

with open(pkg_path) as f:
    pkg = json.load(f)

changed = False

bundles = pkg.setdefault('dsh', {}).setdefault('profile', {}).setdefault('bundles', [])
if 'dsh-shortcuts' not in bundles:
    bundles.append('dsh-shortcuts')
    changed = True

if changed:
    with open(pkg_path, 'w') as f:
        json.dump(pkg, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print('    package.json 已更新（bundles）')
else:
    print('    package.json 无需修改（bundle 已注册）')

deps = pkg.get('dependencies', {})
if 'dsh-shortcuts' not in deps:
    raise SystemExit('错误: pnpm 未将 dsh-shortcuts 写入 dependencies')

map_path = os.path.join(profile_dir, 'node_modules', '.package-map.json')
try:
    with open(map_path) as f:
        package_map = json.load(f)
except (OSError, json.JSONDecodeError) as exc:
    raise SystemExit(f'错误: 无法读取 DSH 模块映射 {map_path}: {exc}')

root_deps = package_map.get('packages', {}).get('.', {}).get('dependencies', {})
if 'dsh-shortcuts' not in root_deps:
    raise SystemExit('错误: dsh-shortcuts 未进入 .package-map.json，DSH 重启后将无法加载')

installed_pkg = os.path.join(profile_dir, 'node_modules', 'dsh-shortcuts', 'package.json')
if not os.path.isfile(installed_pkg):
    raise SystemExit('错误: profile node_modules 中的 dsh-shortcuts 不可用')

print('    冷启动校验通过（dependencies + bundles + .package-map.json）')
PY

echo "==> 5/5 完成"
echo ""
echo "✅ 永久安装完成：Desktop APP 与命令行启动的 WebUI 共用这个 web profile。"
echo "   完全退出并重新打开 DeepSeek Harness 后，插件会随两种界面自动启动。"
echo "   左下角设置按钮旁出现「⌘K 快捷键」按钮即安装成功。"
echo ""
echo "🔧 常用命令"
echo "   更新插件:   $INSTALL_DIR/install.sh   （或重新运行上面那行 curl 命令）"
echo "   卸载:       ${PNPM_CMD[*]} --dir $PROFILE_DIR remove dsh-shortcuts，"
echo "               再从 $PROFILE_DIR/package.json 的 dsh.profile.bundles 移除 dsh-shortcuts，重启 DSH"
echo ""
echo "💡 如果 git 克隆/更新因网络失败，请先为 git 配置代理，例如："
echo "   git config --global http.proxy http://127.0.0.1:7897"
