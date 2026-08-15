# Changelog

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
