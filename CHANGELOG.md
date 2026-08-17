# Changelog

## [1.1.4] - 2026-08-17

### Fixed
- 合并客户端重复的 `inject` 声明，修复 `Identifier 'inject' has already been declared` 导致整个插件无法加载
- 速查表诊断通过 `ctx.get('remote.commands')` 安全读取嵌套服务，避免 DSH rc.6 Guard 导致 `shell.overlay` 崩溃
- 新增真实渲染速查表的回归测试，覆盖 `⌘/` 触发、嵌套服务诊断与 overlay 渲染路径

## [1.1.3] - 2026-08-17

### Changed
- 思考强度第 1–5 档的默认快捷键由 `⌘⇧1`–`⌘⇧5` 改为按住 `Tab` 后按 `1`–`5`，避免与 macOS `⌘⇧3` / `⌘⇧4` / `⌘⇧5` 截屏快捷键冲突
- 自动迁移仍使用旧版默认思考强度快捷键的已有配置；用户自定义的其他绑定保持不变
- 裸按 `Tab` 仍保留浏览器和 Desktop APP 的正常焦点导航行为

## [1.1.2] - 2026-08-17

### Fixed
- 客户端显式声明 `slots` / `sessions` 服务依赖，等待 DSH client runtime 完成初始化后再注册快捷键监听、设置页、浮层和侧边栏入口，修复 WebUI 与 Desktop APP 冷启动时“显示已加载但快捷键不可用”
- 宿主权限路由改为响应式等待 `webServer` / `permissionPresets` / `sessions`，修复完全退出 DSH 后重启时路由永久漏注册的问题
- 新增客户端服务依赖与宿主冷启动生命周期回归测试

## [1.1.1] - 2026-08-16

### Fixed
- 持久安装改由 pnpm 管理本地插件依赖，同步更新 `pnpm-lock.yaml` 与 DSH 冷启动使用的 `.package-map.json`，解决首次动态加载可用、完全退出 DSH 后重启却无法再次加载的问题
- 安装完成前新增冷启动完整性校验，并增加首次安装/重复安装回归测试

## [1.1.0] - 2025-08-15

### Added
- **无留痕权限切换**：⇧Tab 不再走 `/permission` 命令系统（避免对话流命令节点），动态版经 `harness` RPC、静态版经本地路由直调宿主 `permissionPresets` 服务
- **权限 toast 三色反馈**：只读绿 / 工作区写入蓝 / 完全访问橙（主题 token 优先）
- **内置诊断面板**（`⌘/` 速查表底部）：当前会话 / ⇧Tab 绑定 / 权限投影 / 上次权限切换结果 / 最近按键捕获记录
- **插件就绪 toast**：激活后提示功能数，无需开发者工具即可确认生效
- Host half（静态版）：`/dsh-shortcuts-permission` 本地路由（会话存在 + 预设合法性校验）

### Fixed
- React #310 崩溃：速查表组件 hooks 顺序（`useEffect` 移到条件 return 之前）；测试套件新增 hooks 顺序静态检查防复发
- 动态插件 client guard：声明 `inject: ['timer']`（`ctx.timeout` 使用）
- 权限投影读取：会话窗口打开初期投影未就绪时自动重试（2 次 × 300ms）
- 权限切换结果检查：不再无条件提示成功，命令/宿主拒绝时显示具体原因
- 组合键匹配：Shift 组合上档字符归一化（`⌘⇧1` 按下时 `e.key` 为 `!`）

## [1.0.0] - 2025-08-15

### Added
- 快捷键动作库（34 个功能，6 分组）：会话 / 视图 / 剪贴板 / 模型 / 权限 / 系统
- 自定义绑定：任意功能录制组合键、清除、启用/禁用、冲突检测、恢复默认
- 快捷键速查表面板（默认 `⌘/`）与侧边栏底部入口按钮
- 会话快速切换面板（默认 `⌘K`）：搜索、键盘导航、新建会话入口
- 模型快捷键：`⌘1`–`⌘9` 按位置选模型（含默认思考强度）、`⌘⇧1`–`⌘⇧5` 设定思考强度
- 权限轮换（`⇧Tab`）：只读 / 工作区写入 / 完全访问
- 停止当前任务（`⌘.`）：会话作用域 `conversation.cancel()`
- 剪贴板：复制最后一条助手消息 / 会话标题 / 会话 ID
- 视图：全屏、滚动到顶/底部、聚焦会话搜索、语言轮换
- 操作反馈 toast（成功/失败原因）
- macOS 优先默认键位，非 Mac 自动改用 Ctrl；上档字符归一化匹配
- 配置持久化于 localStorage（`dsh.shortcuts.v1`）

### Notes
- 依赖 DSH client 服务：`layout` / `workspaces` / `theme` / `locale` / `sessions` / `modelDirectories` / session projections
- 1.1.0 起权限切换依赖宿主侧通道（动态版 harness / 静态版 webServer 路由），需要对应部署形态的 Host half
