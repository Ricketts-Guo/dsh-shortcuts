# dsh-shortcuts — DeepSeek Harness WebUI 键盘快捷键

为 [DeepSeek Harness](https://deepseek.com) 的 WebUI 提供一套**可完全自定义的键盘快捷键系统**。所有可触达的功能预注册在分组列表中，带默认键的直接生效（macOS 优先，其他平台自动改用 Ctrl），其余一键录制即可绑定。配置保存在浏览器 localStorage，刷新/重启不丢。

- **34 个预置功能**，6 个分组：会话 / 视图 / 剪贴板 / 模型 / 权限 / 系统
- **自定义绑定**：任何功能都可录制任意组合键、清除、禁用，冲突自动检测
- **快捷键速查表**（`⌘/`）：随时查看全部绑定 + 内置诊断面板
- **权限快速切换**：`Shift+Tab` 调用宿主权限服务，切换当前会话的权限预设，不插入聊天命令节点
- **官方 Bundle 安装**：通过 `dsh plugin` 管理依赖与注册，只新增插件自有条目
- **本地运行**：配置保存在 localStorage；权限切换使用本地 HTTP 路由，无遥测或插件自有外部服务

## 兼容性

`1.1.5` 针对 DSH `0.1.5-rc.2`、`0.1.6-alpha.1`、`0.1.6-alpha.2` 修复并验证。
Node.js 范围为 `>=22.13.0`，实际验收环境为 Node.js `24.14.1`、macOS arm64、Chrome、一次性 `web` Profile。
Desktop、Windows、Linux 和其他 DSH 版本尚未运行验收；不要据此推断兼容。

完整版本声明见 `package.json` 的 `dsh.compatibility`，测试方法及证据见 [兼容性验收记录](docs/compatibility.md)。
商城收录状态由 DSH STORE 的固定 Commit 复检决定，仓库测试通过不代表已经恢复上架。

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

## 安装、更新与卸载

先准备兼容的 DSH CLI 和 Node.js。保存当前任务，停止准备修改的 WebUI 实例，并备份它的 Profile 目录。
默认目标是 `DSH_HOME`（未设置时为 `~/.dsh`）下的 `web` Profile；Desktop 由官方应用管理，不使用本脚本修改。

```bash
git clone https://github.com/Ricketts-Guo/dsh-shortcuts.git
cd dsh-shortcuts
git rev-parse HEAD   # 记录并核对要安装的完整 Commit
./install.sh
```

脚本安装当前检出内容，不自动拉取代码。它委托官方 CLI 完成依赖、锁文件、模块映射和 Bundle 注册，并运行配置合成检查：

```bash
dsh plugin --profile web add --save-prod --ignore-scripts "file:$PWD"
dsh --profile web --dump-config
```

配置合成通过后，启动该 WebUI，确认侧边栏「快捷键」按钮、`⌘/` 速查表和 设置 → 快捷键 页面可用。
脚本不会自动关闭或重启正在使用的 DSH。无需手工编辑 Profile 的 `package.json` 或创建软链接。

更新时先核对新版本的代码和权限变化，再 `git pull --ff-only` 并重新运行 `./install.sh`，最后重启该 WebUI。
可以用 `DSH_BIN` 指定 CLI、`DSH_HOME` 指定独立根目录、`DSH_PROFILE` 选择已有自定义 Web Profile（默认 `web`）。
历史 `DSH_PROFILE_DIR` 仅接受 `<DSH_HOME>/profiles/<profile>` 结构。

卸载前停止目标实例，然后运行：

```bash
dsh plugin --profile web remove dsh-shortcuts
dsh --profile web --dump-config
```

重新启动后确认快捷键入口消失。浏览器 localStorage 中的 `dsh.shortcuts.v1` 可按需删除。
如需回滚，停止目标实例后恢复安装前备份的完整 Profile，再检查配置合成和冷启动；不要在运行中覆盖 Profile。

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

**通道说明**：会话导航使用 `uiWorkspace`，当前会话由 `uiSession.current` 或旧版 `sessions.list.current` 提供；
详情面板使用 `sidebarRight`，停止任务使用 `sessions.binding(id).ctx`。模型、主题、语言使用对应的公开 Client 服务。
快速切换面板直接订阅会话 store，不要求根 overlay 传入旧版隐式 hook。
权限切换从会话投影读取当前值；alpha.2 的选项通过公开 `remote.permissionPresets.catalog()` 读取。

**权限边界**：本地 `/dsh-shortcuts-permission` 路由会改变当前会话的 sandbox/approval 预设，并非只读操作。
路由显式调用宿主 connection 的登录及 Host/Origin 检查，仅允许 POST，并校验会话存在和预设合法性。请保持 loopback 绑定；本次没有进行独立安全审计。
剪贴板功能可能复制会话内容。详见 [权限与边界](SECURITY.md)。

## 开发与测试

```bash
npm ci --ignore-scripts
npm run check
```

单元与契约测试使用固定的开发依赖，不读取本机 DSH 安装。覆盖组合键、模型与思考强度、权限切换、消息复制、
会话导航、overlay 渲染、alpha.2 当前会话订阅、目录异常与异步切换会话、Host 路由生命周期、安装脚本参数及失败传播。

真实运行测试使用官方 CLI、精确版本依赖图、临时 `DSH_HOME` 和独立浏览器，检查安装、冷启动、速查表/设置页、卸载及回滚。
[复验步骤](docs/compatibility.md#reproduce) 包含三个版本的运行环境清单。它不需要模型 API key，也不发送模型请求。

## 许可证

[MIT](LICENSE)
