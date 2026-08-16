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

echo "==> 1/4 获取插件代码"

if [ ! -d "$INSTALL_DIR/.git" ]; then
  mkdir -p "$(dirname "$INSTALL_DIR")"
  echo "    克隆 $REPO_URL → $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  echo "    已存在 $INSTALL_DIR，尝试更新…"
  git -C "$INSTALL_DIR" pull --ff-only 2>/dev/null || echo "    更新失败（网络问题？），继续使用现有代码"
fi

echo "==> 2/4 链接到 DSH profile"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "错误: 找不到 $PROFILE_DIR"
  echo "     请先启动一次 DeepSeek Harness（会自动创建 web profile），然后重试本脚本。"
  exit 1
fi
mkdir -p "$PROFILE_DIR/node_modules"
ln -sfn "$INSTALL_DIR" "$PROFILE_DIR/node_modules/dsh-shortcuts"
echo "    已链接 $PROFILE_DIR/node_modules/dsh-shortcuts → $INSTALL_DIR"

echo "==> 3/4 注册到 profile 配置"

python3 - "$INSTALL_DIR" "$PROFILE_DIR" <<'PY'
import json, os, sys

install_dir, profile_dir = sys.argv[1], sys.argv[2]
pkg_path = os.path.join(profile_dir, 'package.json')

with open(pkg_path) as f:
    pkg = json.load(f)

rel = os.path.relpath(install_dir, profile_dir)
changed = False

deps = pkg.setdefault('dependencies', {})
if deps.get('dsh-shortcuts') != 'file:' + rel:
    deps['dsh-shortcuts'] = 'file:' + rel
    changed = True

bundles = pkg.setdefault('dsh', {}).setdefault('profile', {}).setdefault('bundles', [])
if 'dsh-shortcuts' not in bundles:
    bundles.append('dsh-shortcuts')
    changed = True

if changed:
    with open(pkg_path, 'w') as f:
        json.dump(pkg, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print('    package.json 已更新（dependencies + bundles）')
else:
    print('    package.json 无需修改（已注册）')
PY

echo "==> 4/4 同步 pnpm lockfile（纳入 pnpm 管理，防止后续安装/更新其他插件时被清掉）"

if command -v pnpm >/dev/null 2>&1 || [ -x "$HOME/.dsh/bin/pnpm" ]; then
  export PATH="$HOME/.dsh/bin:/usr/local/bin:$PATH"
  if (cd "$PROFILE_DIR" && pnpm install --no-frozen-lockfile); then
    echo "    lockfile 已同步（dsh-shortcuts 现由 pnpm 管理）"
  else
    echo "⚠️  pnpm install 失败（网络问题？），当前链接仍可工作；"
    echo "    但下次在 profile 中运行 pnpm（如插件市场安装/更新）可能清掉 dsh-shortcuts，"
    echo "    请网络恢复后重跑本脚本。"
  fi
else
  echo "⚠️  未找到 pnpm（PATH 或 ~/.dsh/bin/pnpm），跳过 lockfile 同步；"
  echo "    建议安装 pnpm 后重跑本脚本，否则后续 pnpm 操作可能清掉插件。"
fi

echo "==> 5/5 完成"
echo ""
echo "✅ 安装完成！最后一步：完全退出并重新打开 DeepSeek Harness。"
echo "   重启后，左下角设置按钮旁出现「⌘K 快捷键」按钮即安装成功。"
echo ""
echo "🔧 常用命令"
echo "   更新插件:   $INSTALL_DIR/install.sh   （或重新运行上面那行 curl 命令）"
echo "   卸载:       删除 $PROFILE_DIR/node_modules/dsh-shortcuts 链接，"
echo "               并从 $PROFILE_DIR/package.json 移除两处 dsh-shortcuts 引用，重启 DSH"
echo ""
echo "💡 如果 git 克隆/更新因网络失败，请先为 git 配置代理，例如："
echo "   git config --global http.proxy http://127.0.0.1:7897"
