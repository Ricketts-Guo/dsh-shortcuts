# dsh-shortcuts — DeepSeek Harness Desktop / WebUI 键盘快捷键

为 [DeepSeek Harness](https://deepseek.com) 的 WebUI 提供一套**可完全自定义的键盘快捷键系统**。所有可触达的功能预注册在分组列表中，带默认键的直接生效（macOS 优先，其他平台自动改用 Ctrl），其余一键录制即可绑定。配置保存在浏览器 localStorage，刷新/重启不丢。

- **34 个预置功能**，6 个分组：会话 / 视图 / 剪贴板 / 模型 / 权限 / 系统
- **自定义绑定**：任何功能都可录制任意组合键、清除、禁用，冲突自动检测
- **快捷键速查表**（`⌘/`）：随时查看全部绑定 + 内置诊断面板
- **无留痕权限切换**：⇧Tab 直调宿主权限服务，对话流零污染
- **权限快速切换**：只读 / 工作区写入 / 完全访问（Shitft+tab）
- **双部署形态**：会话级动态插件（WebUI）+ 宿主级静态插件（Desktop），行为一致
- **纯浏览器端为主**：无网络请求、不触碰业务数据；仅权限切换经宿主侧路由直写

## 功能一览

| 分组 | 功能（默认键） |
| --- | --- |
| 会话 | 新建会话 `⌘N` · 会话快速切换 `⌘K` · 归档当前会话 `⌘⇧A` · 聚焦消息输入框 `⌘⇧K` · 停止当前任务 `⌘.` |
| 视图 | 切换侧边栏 `⌘B` · 切换详情面板 `⌘⇧D` · 切换明暗主题 `⌘⇧L` · 全屏 · 滚动到顶/底部 · 聚焦会话搜索 |
| 剪贴板 | 复制最后一条助手消息 · 复制会话标题 · 复制会话 ID |
| 模型 | 选择模型 1–9 `⌘1`–`⌘9` · 思考强度 1–5 `Tab+1`–`Tab+5`（按住 Tab）· 循环思考强度 |
| 权限 | 循环切换权限（只读 / 工作区写入 / 完全访问）`⇧Tab` |
| 系统 | 打开设置 `⌘,` · 快捷键速查表 `⌘/` · 切换界面语言 |

> 未标注默认键的功能初始为「未绑定」，在 设置 → 快捷键 中点击「录制」即可自定义添加。
> 思考强度档位取决于当前模型（如 DeepSeek 的低/中/最大）；权限轮换顺序取决于部署配置的预设表。

## 安装

### 方式一：一键安装（推荐，一行命令）

```bash
curl -fsSL https://raw.githubusercontent.com/Ricketts-Guo/dsh-shortcuts/main/install.sh | bash
```

脚本自动完成：克隆插件 → 链接到 web profile → 注册到 `package.json` → **同步 pnpm lockfile（将插件纳入 pnpm 管理，防止后续安装/更新其他插件时被清掉）**（幂等，可重复运行）。完成后**完全退出并重新打开 DeepSeek Harness**，左下角设置按钮旁出现「⌘K 快捷键」按钮即安装成功。

**更新插件**：重新运行上面同一行命令即可（`pnpm install` 会同步最新代码副本，再重启 DSH 生效）。

**手动步骤版**（脚本等价操作）：

1. `git clone https://github.com/Ricketts-Guo/dsh-shortcuts.git ~/dsh-shortcuts`
2. 编辑 `~/.dsh/profiles/web/package.json`，在 `dependencies`（`"dsh-shortcuts": "file:../../../dsh-shortcuts"`）与 `dsh.profile.bundles` 中分别加入 `dsh-shortcuts`
3. `cd ~/.dsh/profiles/web && pnpm install`（生成 pnpm 受管的 `node_modules/dsh-shortcuts` 副本）
4. 重启 DSH

> ⚠️ 版本 1.1.0 起安装改为 pnpm 托管：`node_modules/dsh-shortcuts` 是 pnpm 从源码仓库同步的**受管副本**而非符号链接。修改 `~/dsh-shortcuts` 源码后，需重新运行 install.sh（或 `cd ~/.dsh/profiles/web && pnpm install`）同步副本，再重启 DSH 生效。不要手动 `ln -sfn` 覆盖它——pnpm 下次运行时若检测到依赖状态不符可能重装或清理。

### 方式二：会话级动态插件（临时，进程重启后失效）

在 DSH 会话中通过 Cordis 工具加载（`cordis_define` + `cordis_run`）。适合快速试用；需要持久使用请用方式一。

## 卸载

- 静态安装：`cd ~/.dsh/profiles/web && pnpm remove dsh-shortcuts`（或从 `~/.dsh/profiles/web/package.json` 移除两处 `dsh-shortcuts` 引用并运行 `pnpm install`），重启 DSH。
- 动态插件：`cordis_stop` / `cordis_undefine`。
- 自定义配置残留在浏览器 localStorage（键 `dsh.shortcuts.v1`），可在浏览器开发者工具中删除。

## 自定义

设置 → 快捷键 页面：

- **录制**：点击「录制」后按下任意组合键（如 `⌘⇧C`）即绑定；Backspace 清除绑定，Esc 取消录制
- **启用/禁用**：每行复选框
- **冲突检测**：重复绑定会提示并阻止保存
- **恢复默认**：一键还原全部默认键位
- **动态描述**：模型/思考强度行实时显示当前位置对应的实际模型名与档位名

## 诊断面板（`⌘/` 速查表底部）

不需要开发者工具即可自检：

- **当前会话**：快捷键动作依赖的会话 ID
- **⇧Tab 绑定**：绑定状态（已启用/未绑定/已禁用）
- **权限投影**：权限服务是否可用、几档
- **上次权限切换**：最近一次切换的成功/失败原因
- **最近按键**：最近 12 次按键是否被插件捕获（带 ✓ 表示命中快捷键）

## 架构

单一 `FEATURES` 注册表驱动一切：

```js
{ id: 'stopTask', group: '会话', label: '停止当前任务',
  description: '中断正在运行的 agent 回合', defaultCombo: 'Meta+.',
  run: () => { /* 任意 client 端逻辑 */ } }
```

设置页、速查表、冲突检测、持久化、键盘分发全部由注册表自动派生 —— 新增功能只需加一行。`Tab+数字` 使用按住状态识别，同时保留裸 Tab 的正常焦点导航；录制与匹配自洽。

**通道说明**：所有动作走 DSH 官方 client 服务（`layout` / `workspaces` / `theme` / `locale` / `sessions` / `modelDirectories` / session projections），不依赖私有 DOM 结构（仅「打开设置」通过语义属性定位触发按钮）。权限切换经宿主侧通道（动态版 `harness` RPC；静态版本地 HTTP 路由 `/dsh-shortcuts-permission`）直调 `permissionPresets`。

**Host half 安全说明**：静态版的权限路由校验会话存在与预设合法性，且仅在部署挂载了权限服务时激活；DSH Web 服务应保持 loopback 绑定。

## 开发与测试

```bash
npm test        # 运行测试（需本机装有 DSH，测试通过 host node_modules 解析 react）
npm run check   # 语法检查 + 测试
```

测试覆盖：组合键匹配（含上档字符归一化）、模型/思考强度位置选择、无留痕权限轮换、复制消息、剪贴板、全屏、滚动、语言轮换、打字不拦截、优雅降级、React hooks 顺序静态检查（防渲染崩溃）。

## 许可证

[MIT](LICENSE)
