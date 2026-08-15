// dsh-shortcuts — browser half (client plugin bundle).
//
// Loaded by dsh-client-modules at /plugins/dsh-shortcuts/client.js and executed
// through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS with
// require() resolved against the shell's module table — the same shape the
// shipped ui-* packages' tsdown bundles emit.
//
// Extensible keyboard-shortcut system for the DeepSeek Harness WebUI.
// Every reachable feature is pre-registered in FEATURES below (grouped:
// session / view / clipboard / model / permission / system). Features with a
// sensible default combo ship pre-bound (macOS-first: ⌘; Ctrl on other
// platforms); the rest start unbound — the user records any combination in
// Settings → 快捷键 to add them. Settings persist in localStorage
// (key dsh.shortcuts.v1).

window.__ModuleLoader__.load({
	id: "dsh-shortcuts",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");

		// ============ 常量 ============
		const STORAGE_KEY = 'dsh.shortcuts.v1';
		const MODIFIERS = ['Meta', 'Control', 'Alt', 'Shift'];

		const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
		const lead = isMac ? 'Meta' : 'Control';

		// ============ 共享状态 ============
		const listeners = new Set();
		let paletteOpen = false;
		let cheatsheetOpen = false;
		let detailsOpen = false;
		let recordingAction = null; // 设置页录制期间暂停全局快捷键
		let currentSessionId = null; // 由 apply 中的 sessions.list 订阅维护
		let pluginCtx = null; // apply 时注入的 client runtime ctx
		let toastMsg = null; // { text, kind: 'ok' | 'error' | 'info' }
		let toastTimer = null;
		let keyLog = []; // 最近按键事件环形缓冲（诊断用，最多 30 条）

		function getState() { return { settings, paletteOpen, cheatsheetOpen, toast: toastMsg }; }
		function emit() { for (const fn of listeners) fn(); }
		function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

		// 记录一次按键（诊断面板展示 ⇧Tab 是否被捕获）
		function logKey(e, hit) {
			keyLog.push({
				key: String(e.key),
				meta: !!e.metaKey, ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey,
				hit: !!hit,
				time: new Date().toLocaleTimeString(),
			});
			if (keyLog.length > 30) keyLog.shift();
		}

		function formatLogKey(entry) {
			const mods = (entry.meta ? '⌘' : '') + (entry.ctrl ? '⌃' : '') + (entry.alt ? '⌥' : '') + (entry.shift ? '⇧' : '');
			const key = entry.key === ' ' ? '空格' : entry.key;
			return (mods + key) + (entry.hit ? ' ✓' : '');
		}

		// 诊断信息（速查表底部展示）
		function diagnosticInfo() {
			let permState = '未知';
			try {
				const binding = sessionsBinding(currentSessionId);
				const session = binding && binding.session;
				const permView = session && session.projections && typeof session.projections.faceOf === 'function'
					? session.projections.faceOf('permissions')
					: undefined;
				if (!permView) permState = '投影缺失';
				else {
					const snap = permView.getSnapshot();
					permState = snap && Array.isArray(snap.options) ? '可用（' + snap.options.length + ' 档）' : '无数据';
				}
			} catch (err) { permState = '读取异常'; }
			const cp = (settings && settings.actions && settings.actions.cyclePermission) || { enabled: false, combo: null };
			const cpText = cp.combo
				? (cp.enabled ? '已启用 ' + formatCombo(cp.combo) : '已禁用（' + formatCombo(cp.combo) + '）')
				: '未绑定';
			const remoteOk = !!(pluginCtx && pluginCtx.remote && pluginCtx.remote.commands && typeof pluginCtx.remote.commands.execute === 'function');
			return { sessionId: currentSessionId || '（无）', cyclePermission: cpText, permState, remoteOk };
		}

		// 短暂提示（成功/失败反馈），2.5 秒后自动消失
		function showToast(text, kind) {
			toastMsg = { text, kind: kind || 'info' };
			emit();
			if (toastTimer && typeof toastTimer === 'function') toastTimer();
			try {
				if (pluginCtx && typeof pluginCtx.timeout === 'function') {
					toastTimer = pluginCtx.timeout(() => { toastMsg = null; emit(); }, 2500);
				} else {
					toastTimer = window.setTimeout(() => { toastMsg = null; emit(); }, 2500);
				}
			} catch (err) {
				toastMsg = null;
				emit();
			}
		}

		function setPaletteOpen(open) {
			if (paletteOpen !== open) { paletteOpen = open; emit(); }
		}
		function setCheatsheetOpen(open) {
			if (cheatsheetOpen !== open) { cheatsheetOpen = open; emit(); }
		}

		function useStoreState() {
			const [state, setState] = React.useState(getState());
			React.useEffect(() => subscribe(() => setState(getState())), []);
			return state;
		}

		// ============ 剪贴板与 DOM 工具 ============
		function copyText(text) {
			if (!text) return;
			try {
				const p = navigator.clipboard.writeText(text);
				if (p && typeof p.catch === 'function') p.catch((err) => console.error('dsh-shortcuts: 复制失败', err));
			} catch (err) { /* 剪贴板不可用 */ }
		}

		// ============ 会话/模型服务工具 ============
		function sessionsBinding(id) {
			const sessionsSvc = pluginCtx && pluginCtx.get('sessions');
			if (!sessionsSvc || !id) return undefined;
			try { return sessionsSvc.binding(id) || undefined; } catch (err) { return undefined; }
		}

		function modelDirectoryOf(sessionId) {
			const svc = pluginCtx && pluginCtx.get('modelDirectories');
			if (!svc || !sessionId) return null;
			try {
				const dir = svc.directoryFor(sessionId);
				return dir && dir.store ? dir : null;
			} catch (err) { /* 会话不可用 */ }
			return null;
		}

		function flatModelList(groups) {
			const flat = [];
			if (Array.isArray(groups)) {
				for (const g of groups) {
					if (!g || !Array.isArray(g.models)) continue;
					for (const m of g.models) flat.push({ provider: g.id, providerName: g.name, model: m });
				}
			}
			return flat;
		}

		// ============ 功能注册表（全部可绑定功能） ============
		// defaultCombo 为 null 的功能初始未绑定 —— 用户在设置页录制组合键即「自定义添加」。
		const FEATURES = [
			// ---- 会话 ----
			{ id: 'newSession', group: '会话', label: '新建会话', description: '开始一个新会话（沿用当前或最近的工作区）', defaultCombo: lead + '+N', run: () => {
				const svc = pluginCtx && pluginCtx.get('workspaces');
				if (svc) svc.startSession();
			} },
			{ id: 'quickSwitcher', group: '会话', label: '会话快速切换', description: '打开会话搜索面板，回车直达任意会话', defaultCombo: lead + '+K', run: () => setPaletteOpen(!paletteOpen) },
			{ id: 'archiveSession', group: '会话', label: '归档当前会话', description: '把当前会话归档（从列表隐藏，会话日志保留）', defaultCombo: lead + '+Shift+A', run: () => {
				const svc = pluginCtx && pluginCtx.get('workspaces');
				if (svc && currentSessionId) {
					const p = svc.archiveSession(currentSessionId);
					if (p && typeof p.catch === 'function') p.catch((err) => console.error('归档会话失败', err));
				}
			} },
			{ id: 'focusComposer', group: '会话', label: '聚焦消息输入框', description: '将光标移回输入框，立即开始输入', defaultCombo: lead + '+Shift+K', run: () => {
				const ta = document.querySelector('textarea');
				if (ta) ta.focus();
			} },
			{ id: 'stopTask', group: '会话', label: '停止当前任务', description: '中断正在运行的 agent 回合（等价于点击停止按钮）', defaultCombo: lead + '+.', run: () => {
				if (!currentSessionId) return;
				const sessionsSvc = pluginCtx && pluginCtx.get('sessions');
				if (!sessionsSvc) return;
				try {
					const scoped = sessionsSvc.scope(currentSessionId);
					const conversation = scoped && scoped.get('conversation');
					if (conversation && typeof conversation.cancel === 'function') {
						const p = conversation.cancel();
						if (p && typeof p.catch === 'function') p.catch((err) => console.error('停止任务失败', err));
					}
				} catch (err) { console.error('dsh-shortcuts: 停止任务失败', err); }
			} },

			// ---- 视图 ----
			{ id: 'toggleSidebar', group: '视图', label: '切换侧边栏', description: '显示或隐藏左侧会话栏', defaultCombo: lead + '+B', run: () => {
				const svc = pluginCtx && pluginCtx.get('layout');
				if (svc) svc.toggleSidebar();
			} },
			{ id: 'toggleDetails', group: '视图', label: '切换详情面板', description: '打开或关闭右侧详情栏', defaultCombo: lead + '+Shift+D', run: () => {
				const svc = pluginCtx && pluginCtx.get('layout');
				if (svc) {
					detailsOpen = !detailsOpen;
					if (detailsOpen) svc.openDetails(); else svc.closeDetails();
				}
			} },
			{ id: 'toggleTheme', group: '视图', label: '切换明暗主题', description: '在浅色与深色主题之间切换', defaultCombo: lead + '+Shift+L', run: () => {
				const svc = pluginCtx && pluginCtx.get('theme');
				if (svc) {
					const snap = svc.getTheme();
					svc.setTheme(snap.active.colorScheme === 'dark' ? 'light' : 'dark');
				}
			} },
			{ id: 'toggleFullscreen', group: '视图', label: '切换全屏', description: '浏览器全屏 / 退出全屏', defaultCombo: null, run: () => {
				try {
					if (document.fullscreenElement) {
						const p = document.exitFullscreen();
						if (p && typeof p.catch === 'function') p.catch(() => {});
					} else {
						const p = document.documentElement.requestFullscreen();
						if (p && typeof p.catch === 'function') p.catch(() => {});
					}
				} catch (err) { /* 环境不支持全屏 */ }
			} },
			{ id: 'scrollToTop', group: '视图', label: '滚动到顶部', description: '平滑滚动页面到顶部', defaultCombo: null, run: () => {
				try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (err) { window.scrollTo(0, 0); }
			} },
			{ id: 'scrollToBottom', group: '视图', label: '滚动到底部', description: '平滑滚动页面到底部', defaultCombo: null, run: () => {
				const bottom = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
				try { window.scrollTo({ top: bottom, behavior: 'smooth' }); } catch (err) { window.scrollTo(0, bottom); }
			} },
			{ id: 'focusSidebarSearch', group: '视图', label: '聚焦会话搜索', description: '聚焦侧边栏的会话搜索框', defaultCombo: null, run: () => {
				const candidates = document.querySelectorAll('input[type="search"], input[placeholder*="搜索"], input[placeholder*="Search"]');
				if (candidates.length > 0) candidates[0].focus();
			} },

			// ---- 剪贴板 ----
			{ id: 'copyLastMessage', group: '剪贴板', label: '复制最后一条助手消息', description: '把会话中最后一条助手回复的文本复制到剪贴板', defaultCombo: null, run: () => {
				const binding = sessionsBinding(currentSessionId);
				const session = binding && binding.session;
				if (!session || !session.projections) return;
				let conv;
				try { conv = session.projections.faceOf('conversation') ? session.projections.faceOf('conversation').getSnapshot() : undefined; } catch (err) { return; }
				const nodes = conv && Array.isArray(conv.nodes) ? conv.nodes : [];
				for (let i = nodes.length - 1; i >= 0; i--) {
					const n = nodes[i];
					if (n && n.kind === 'assistant' && Array.isArray(n.blocks)) {
						const text = n.blocks.filter((b) => b && b.kind === 'text' && b.text).map((b) => b.text).join('\n');
						if (text) { copyText(text); break; }
					}
				}
			} },
			{ id: 'copySessionTitle', group: '剪贴板', label: '复制当前会话标题', description: '把当前会话的标题复制到剪贴板', defaultCombo: null, run: () => {
				if (!currentSessionId) return;
				const sessionsSvc = pluginCtx && pluginCtx.get('sessions');
				if (!sessionsSvc || !sessionsSvc.list) return;
				try {
					const snap = sessionsSvc.list.getSnapshot();
					const sum = snap && snap.byId ? snap.byId[currentSessionId] : undefined;
					copyText(sum ? (sum.displayTitle || currentSessionId) : currentSessionId);
				} catch (err) { /* ignore */ }
			} },
			{ id: 'copySessionId', group: '剪贴板', label: '复制当前会话 ID', description: '把当前会话的 ID 复制到剪贴板', defaultCombo: null, run: () => {
				if (currentSessionId) copyText(currentSessionId);
			} },

			// ---- 模型 ----
			{ id: 'cycleEffort', group: '模型', label: '循环思考强度', description: '在当前模型的可用思考强度之间轮换（如低 / 中 / 最大）', defaultCombo: null, run: () => {
				const dir = modelDirectoryOf(currentSessionId);
				if (!dir) return;
				try {
					const snap = dir.store.getSnapshot();
					if (!snap || !snap.current) return;
					const { provider, model, reasoningEffort } = snap.current;
					const entry = flatModelList(snap.groups).find((f) => f.provider === provider && f.model.id === model);
					if (!entry || !entry.model.reasoning || !Array.isArray(entry.model.reasoning.efforts) || entry.model.reasoning.efforts.length === 0) return;
					const efforts = entry.model.reasoning.efforts;
					const idx = efforts.findIndex((e) => e.id === reasoningEffort);
					const next = efforts[(idx + 1) % efforts.length];
					const p = dir.select({ provider, model, reasoningEffort: next.id });
					if (p && typeof p.catch === 'function') p.catch((err) => console.error('dsh-shortcuts: 切换思考强度失败', err));
				} catch (err) { console.error('dsh-shortcuts: 切换思考强度失败', err); }
			} },
		];

		// 模型位置动作：⌘+1..⌘+9 对应模型列表中的第 1..9 个模型（顺序 = 模型选择弹窗的展示顺序）
		for (let i = 1; i <= 9; i++) {
			FEATURES.push({
				id: 'selectModel' + i,
				group: '模型',
				label: '选择模型 ' + i,
				description: '切换到模型列表中的第 ' + i + ' 个模型（含默认思考强度）',
				defaultCombo: lead + '+' + i,
				run: () => selectModelAt(currentSessionId, i - 1),
			});
		}

		// 思考强度位置动作：⌘⇧+1..⌘⇧+5 对应当前模型的第 1..5 个思考强度
		for (let i = 1; i <= 5; i++) {
			FEATURES.push({
				id: 'selectEffort' + i,
				group: '模型',
				label: '思考强度 ' + i,
				description: '把当前模型的思考强度设为第 ' + i + ' 档',
				defaultCombo: lead + '+Shift+' + i,
				run: () => selectEffortAt(currentSessionId, i - 1),
			});
		}

		// ---- 权限 ----
		FEATURES.push({
			id: 'cyclePermission', group: '权限', label: '循环切换权限', description: '在只读 / 工作区写入 / 完全访问之间轮换（输入框内也生效）', defaultCombo: 'Shift+Tab', run: () => {
				cyclePermissionRun();
			},
		});

		// 权限预设 → toast 配色（readonly 绿 / workspace write 蓝 / full access 橙）
		function permTone(preset) {
			if (preset === 'read-only') return 'perm-readonly';
			if (preset === 'workspace-write') return 'perm-workspace';
			if (preset === 'danger-full-access') return 'perm-full';
			return 'ok';
		}

		// 权限循环执行（独立函数便于诊断记录）
		let lastPermResult = null; // 最近一次权限切换结果（诊断面板展示）

		async function cyclePermissionRun() {
			if (!currentSessionId) {
				console.warn('dsh-shortcuts: 权限切换失败 — 当前会话未就绪（currentSessionId 为空）');
				lastPermResult = '失败：当前会话未就绪';
				showToast('权限切换失败：当前会话未就绪', 'error');
				return;
			}
			const binding = sessionsBinding(currentSessionId);
			const session = binding && binding.session;
			if (!session) {
				console.warn('dsh-shortcuts: 权限切换失败 — sessions.binding 返回空（会话未绑定）', currentSessionId);
				lastPermResult = '失败：会话绑定不可用';
				showToast('权限切换失败：会话绑定不可用', 'error');
				return;
			}

			const readPerm = () => {
				try {
					const permView = session.projections && typeof session.projections.faceOf === 'function'
						? session.projections.faceOf('permissions')
						: undefined;
					return permView ? permView.getSnapshot() : undefined;
				} catch (err) { return undefined; }
			};

			// 投影可能滞后于会话窗口打开：最多自动重试 2 次（间隔 300ms）
			const attempt = (perm, retriesLeft) => {
				if (!perm || !Array.isArray(perm.options) || perm.options.length === 0) {
					if (retriesLeft > 0) {
						const timerCtx = pluginCtx;
						try {
							if (timerCtx && typeof timerCtx.timeout === 'function') {
								timerCtx.timeout(() => attempt(readPerm(), retriesLeft - 1), 300);
								return;
							}
						} catch (err) { /* ignore */ }
					}
					console.warn('dsh-shortcuts: 权限切换失败 — permissions 投影不可用（当前环境可能没有权限服务）');
					lastPermResult = '失败：权限投影不可用';
					showToast('权限切换失败：权限投影不可用（环境可能未启用权限服务）', 'error');
					return;
				}
				const values = perm.options.map((o) => o.value).filter((v) => v !== 'custom');
				if (values.length === 0) {
					lastPermResult = '失败：没有可切换的权限';
					showToast('权限切换失败：没有可切换的权限', 'error');
					return;
				}
				const idx = values.indexOf(perm.currentValue);
				const next = values[(idx + 1) % values.length];
				const label = (perm.options.find((o) => o.value === next) || {}).name || next;
				console.log('dsh-shortcuts: 权限切换', perm.currentValue, '→', next, '(' + label + ')');
				// 无留痕通道：直调宿主 permissionPresets 服务（本插件注册的本地路由），
				// 不经过 /permission 命令系统 —— 对话流不会出现命令节点。
				const applyPerm = (preset) => {
					try {
						const p = fetch('/dsh-shortcuts-permission?sessionId=' + encodeURIComponent(currentSessionId) + '&preset=' + encodeURIComponent(preset));
						if (p && typeof p.then === 'function') {
							p.then((res) => {
								const j = res.json();
								if (j && typeof j.then === 'function') {
									j.then((data) => {
										if (data && data.ok) {
											lastPermResult = '成功：' + label;
											showToast('权限已切换：' + label, permTone(next));
										} else {
											console.warn('dsh-shortcuts: 权限切换被宿主拒绝', data);
											lastPermResult = '失败：' + ((data && data.error) || '宿主拒绝');
											showToast('权限切换失败：' + ((data && data.error) || '宿主拒绝'), 'error');
										}
									}, (err) => {
										console.error('dsh-shortcuts: 权限切换响应解析失败', err);
										lastPermResult = '失败：响应解析错误';
										showToast('权限切换失败：响应解析错误', 'error');
									});
								}
							}, (err) => {
								console.error('dsh-shortcuts: 权限切换请求失败', err);
								lastPermResult = '失败：' + (err && err.message ? err.message : String(err));
								showToast('权限切换失败：' + (err && err.message ? err.message : String(err)), 'error');
							});
						}
					} catch (err) {
						console.error('dsh-shortcuts: 权限切换请求异常', err);
						lastPermResult = '失败：' + (err && err.message ? err.message : String(err));
						showToast('权限切换失败：' + (err && err.message ? err.message : String(err)), 'error');
					}
				};
				applyPerm(next);
			};
			attempt(readPerm(), 2);
		}

		// ---- 系统 ----
		FEATURES.push({
			id: 'openSettings', group: '系统', label: '打开设置', description: '打开或关闭设置面板（面板打开时再按一次即关闭）', defaultCombo: lead + '+,', run: () => {
				setPaletteOpen(false);
				setCheatsheetOpen(false);
				const trigger = document.querySelector('button[aria-haspopup="dialog"]');
				if (!trigger) return;
				if (trigger.getAttribute('aria-expanded') === 'true') {
					document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
				} else {
					trigger.click();
				}
			},
		});
		FEATURES.push({
			id: 'showCheatsheet', group: '系统', label: '快捷键速查表', description: '显示当前全部快捷键绑定一览', defaultCombo: lead + '+/', run: () => {
				setPaletteOpen(false);
				setCheatsheetOpen(!cheatsheetOpen);
			},
		});
		FEATURES.push({
			id: 'cycleLocale', group: '系统', label: '切换界面语言', description: '在已注册的界面语言之间轮换（如中文 ↔ English）', defaultCombo: null, run: () => {
				const svc = pluginCtx && pluginCtx.get('locale');
				if (!svc) return;
				try {
					const snap = svc.getSnapshot ? svc.getSnapshot() : null;
					const locales = snap && Array.isArray(snap.locales)
						? snap.locales.map((l) => (typeof l === 'string' ? l : (l && l.id))).filter(Boolean)
						: [];
					if (locales.length === 0) return;
					const idx = locales.indexOf(snap.active);
					svc.setLocale(locales[(idx + 1) % locales.length]);
				} catch (err) { /* ignore */ }
			},
		});

		const FEATURE_BY_ID = {};
		for (const f of FEATURES) FEATURE_BY_ID[f.id] = f;

		// ============ 组合键工具 ============
		// 上档字符 → 基础键（按住 Shift 时数字键的 e.key 是 !@#$…，需要反归一化才能匹配 ⌘⇧1 这类组合）
		const SHIFT_KEYS = {
			'!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
			'_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`',
		};

		function normalizeKey(key) {
			if (key === ' ') return 'Space';
			if (typeof key === 'string' && key.length === 1) return key.toUpperCase();
			return key;
		}

		// 事件按键归一化：Shift 按下时的上档字符反映射回基础键（字母保持大写）
		function keyFromEvent(e) {
			let key = normalizeKey(e.key);
			if (e.shiftKey && SHIFT_KEYS[key]) key = SHIFT_KEYS[key];
			return key;
		}

		function parseCombo(combo) {
			if (typeof combo !== 'string' || !combo) return null;
			const parts = combo.split('+');
			const mods = new Set();
			let key = null;
			for (const part of parts) {
				if (MODIFIERS.includes(part)) mods.add(part);
				else key = part;
			}
			if (!key || mods.size === 0) return null;
			return { mods, key };
		}

		function comboFromEvent(e) {
			const mods = [];
			if (e.metaKey) mods.push('Meta');
			if (e.ctrlKey) mods.push('Control');
			if (e.altKey) mods.push('Alt');
			if (e.shiftKey) mods.push('Shift');
			if (mods.length === 0) return null;
			const key = keyFromEvent(e);
			if (MODIFIERS.includes(key)) return null;
			return mods.join('+') + '+' + key;
		}

		function matchCombo(combo, e) {
			const parsed = parseCombo(combo);
			if (!parsed) return false;
			if (parsed.mods.has('Meta') !== e.metaKey) return false;
			if (parsed.mods.has('Control') !== e.ctrlKey) return false;
			if (parsed.mods.has('Alt') !== e.altKey) return false;
			if (parsed.mods.has('Shift') !== e.shiftKey) return false;
			return parsed.key === keyFromEvent(e);
		}

		const DISPLAY = {
			Meta: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Space: '空格', Enter: '⏎',
			ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc',
			Tab: '⇥', Backspace: '⌫', Delete: '⌦', Home: '↖', End: '↘', PageUp: '⇞', PageDown: '⇟',
		};

		function formatCombo(combo) {
			if (!combo) return null;
			const parsed = parseCombo(combo);
			if (!parsed) return null;
			const parts = [];
			for (const m of MODIFIERS) if (parsed.mods.has(m)) parts.push(DISPLAY[m] || m);
			parts.push(DISPLAY[parsed.key] || parsed.key);
			return parts.join(' ');
		}

		function isEditable(target) {
			if (!target || typeof target.tagName !== 'string') return false;
			const tag = target.tagName.toLowerCase();
			return tag === 'input' || tag === 'textarea' || target.isContentEditable === true;
		}

		// ============ 模型切换 ============
		async function selectModelAt(sessionId, index) {
			const dir = modelDirectoryOf(sessionId);
			if (!dir) return;
			let groups = null;
			try {
				const snap = dir.store.getSnapshot();
				groups = snap && Array.isArray(snap.groups) && snap.groups.length > 0 ? snap.groups : null;
			} catch (err) { /* ignore */ }
			if (!groups) {
				try {
					const loaded = await dir.load();
					groups = loaded ? loaded.groups : null;
				} catch (err) {
					console.error('dsh-shortcuts: 加载模型目录失败', err);
					return;
				}
			}
			const flat = flatModelList(groups);
			const target = flat[index];
			if (!target) return;
			const selection = { provider: target.provider, model: target.model.id };
			if (target.model.reasoning && target.model.reasoning.defaultEffort) {
				selection.reasoningEffort = target.model.reasoning.defaultEffort;
			}
			try {
				await dir.select(selection);
				console.log('dsh-shortcuts: 已切换到', target.providerName + ' / ' + target.model.name);
			} catch (err) {
				console.error('dsh-shortcuts: 切换模型失败', err);
			}
		}

		// 第 index 个模型的显示名（设置页动态描述用）
		function modelNameAt(sessionId, index) {
			const dir = modelDirectoryOf(sessionId);
			if (!dir) return null;
			try {
				const snap = dir.store.getSnapshot();
				const target = flatModelList(snap && snap.groups)[index];
				return target ? target.providerName + ' / ' + target.model.name : null;
			} catch (err) { /* ignore */ }
			return null;
		}

		// 把当前模型的思考强度设为第 index 档（0 起）
		async function selectEffortAt(sessionId, index) {
			const dir = modelDirectoryOf(sessionId);
			if (!dir) return;
			let snap;
			try { snap = dir.store.getSnapshot(); } catch (err) { return; }
			if (!snap || !snap.current) return;
			const { provider, model } = snap.current;
			const entry = flatModelList(snap.groups).find((f) => f.provider === provider && f.model.id === model);
			if (!entry || !entry.model.reasoning || !Array.isArray(entry.model.reasoning.efforts)) return;
			const target = entry.model.reasoning.efforts[index];
			if (!target) return;
			try {
				await dir.select({ provider, model, reasoningEffort: target.id });
				console.log('dsh-shortcuts: 思考强度 →', target.name);
			} catch (err) {
				console.error('dsh-shortcuts: 切换思考强度失败', err);
			}
		}

		// 当前模型第 index 档思考强度的显示名（设置页动态描述用）
		function effortNameAt(sessionId, index) {
			const dir = modelDirectoryOf(sessionId);
			if (!dir) return null;
			try {
				const snap = dir.store.getSnapshot();
				if (!snap || !snap.current) return null;
				const entry = flatModelList(snap.groups).find((f) => f.provider === snap.current.provider && f.model.id === snap.current.model);
				if (!entry || !entry.model.reasoning || !Array.isArray(entry.model.reasoning.efforts)) return null;
				const target = entry.model.reasoning.efforts[index];
				return target ? target.name : null;
			} catch (err) { /* ignore */ }
			return null;
		}

		// ============ 持久化（浏览器 localStorage，失败时回退内存） ============
		let memoryStore = null;

		function defaults() {
			const actions = {};
			for (const f of FEATURES) actions[f.id] = { enabled: true, combo: f.defaultCombo };
			return { actions };
		}

		function loadSettings() {
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY);
				if (raw) return normalize(JSON.parse(raw));
			} catch (err) { /* 忽略 */ }
			if (memoryStore) return normalize(memoryStore);
			return defaults();
		}

		function saveSettings() {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
			} catch (err) {
				memoryStore = settings;
			}
		}

		function normalize(stored) {
			const base = defaults();
			if (!stored || typeof stored !== 'object' || typeof stored.actions !== 'object') return base;
			for (const f of FEATURES) {
				const raw = stored.actions[f.id];
				if (raw && typeof raw === 'object') {
					base.actions[f.id] = {
						enabled: raw.enabled !== false,
						combo: parseCombo(raw.combo) ? raw.combo : null,
					};
				}
			}
			return base;
		}

		let settings = loadSettings();

		function patchSettings(mutator) {
			const next = mutator(settings);
			if (next) settings = next;
			saveSettings();
			emit();
		}

		// ============ 动作执行 ============
		function runAction(id) {
			const feature = FEATURE_BY_ID[id];
			if (feature && typeof feature.run === 'function') {
				try { feature.run(); } catch (err) { console.error('dsh-shortcuts: 执行失败', id, err); }
			}
		}

		// ============ 全局键盘监听（capture 阶段，抢先于浏览器默认行为） ============
		function installKeydown(ctx) {
			ctx.effect(() => {
				const handler = (e) => {
					if (e.repeat) return;
					logKey(e, false); // 先记录，命中后更新
					if (recordingAction) return; // 录制中：交给设置页的录制监听器
					for (const f of FEATURES) {
						const a = settings.actions[f.id];
						if (!a || !a.enabled || !a.combo) continue;
						if (!matchCombo(a.combo, e)) continue;
						const parsed = parseCombo(a.combo);
						const hasCmdLike = parsed.mods.has('Meta') || parsed.mods.has('Control');
						// 输入中不劫持无 ⌘/Ctrl 的组合；Tab 系（Shift+Tab 切权限）除外
						if (!hasCmdLike && parsed.key !== 'Tab' && isEditable(e.target)) return;
						e.preventDefault();
						e.stopPropagation();
						logKey(e, true);
						runAction(f.id);
						return;
					}
				};
				window.addEventListener('keydown', handler, true);
				return () => window.removeEventListener('keydown', handler, true);
			}, 'dsh-shortcuts: keydown');
		}

		// ============ 设置页：快捷键自定义 ============
		function useModelDirectory() {
			const [, force] = React.useState(0);
			React.useEffect(() => {
				const dir = modelDirectoryOf(currentSessionId);
				if (!dir) return;
				dir.load().catch(() => {});
				return dir.store.subscribe(() => force((n) => n + 1));
			}, []);
		}

		function ShortcutsPage() {
			const state = useStoreState();
			const [recording, setRecording] = React.useState(null);
			const [notice, setNotice] = React.useState(null);
			useModelDirectory();

			React.useEffect(() => {
				if (!recording) return;
				recordingAction = recording;
				const onKey = (e) => {
					e.preventDefault();
					e.stopPropagation();
					if (e.key === 'Escape') { setRecording(null); return; }
					if (e.key === 'Backspace' || e.key === 'Delete') {
						patchSettings((s) => ({
							...s,
							actions: { ...s.actions, [recording]: { ...s.actions[recording], combo: null } },
						}));
						setRecording(null);
						setNotice({ kind: 'info', text: '已清除该快捷键绑定' });
						return;
					}
					const combo = comboFromEvent(e);
					if (!combo) return; // 只按了修饰键，继续等待
					const conflict = FEATURES.find((f) =>
						f.id !== recording && settings.actions[f.id].enabled && settings.actions[f.id].combo === combo);
					if (conflict) {
						setNotice({ kind: 'error', text: '「' + conflict.label + '」已在使用 ' + formatCombo(combo) + '，请换一个组合' });
						return;
					}
					patchSettings((s) => ({
						...s,
						actions: { ...s.actions, [recording]: { ...s.actions[recording], combo } },
					}));
					setRecording(null);
					setNotice({ kind: 'info', text: '已更新为 ' + formatCombo(combo) });
				};
				window.addEventListener('keydown', onKey, true);
				return () => {
					recordingAction = null;
					window.removeEventListener('keydown', onKey, true);
				};
			}, [recording]);

			const groups = [];
			const groupIndex = {};
			for (const f of FEATURES) {
				if (groupIndex[f.group] === undefined) {
					groupIndex[f.group] = groups.length;
					groups.push({ name: f.group, items: [] });
				}
				groups[groupIndex[f.group]].items.push(f);
			}

			const rows = groups.map((group) => {
				const items = group.items.map((f) => {
					const a = state.settings.actions[f.id];
					const isRecording = recording === f.id;
					const comboText = a.combo ? formatCombo(a.combo) : null;
					let desc = f.description;
					const modelMatch = /^selectModel(\d+)$/.exec(f.id);
					if (modelMatch) {
						const name = modelNameAt(currentSessionId, parseInt(modelMatch[1], 10) - 1);
						desc = name ? '切换到：' + name + '（含默认思考强度）' : '模型列表中没有第 ' + modelMatch[1] + ' 个模型';
					}
					const effortMatch = /^selectEffort(\d+)$/.exec(f.id);
					if (effortMatch) {
						const name = effortNameAt(currentSessionId, parseInt(effortMatch[1], 10) - 1);
						desc = name ? '当前模型的第 ' + effortMatch[1] + ' 档思考强度：' + name : '当前模型没有第 ' + effortMatch[1] + ' 档思考强度';
					}
					return React.createElement('div', { key: f.id, className: 'dyn-kbd-row' },
						React.createElement('div', { className: 'dyn-kbd-row-main' },
							React.createElement('div', { className: 'dyn-kbd-row-title' }, f.label),
							React.createElement('div', { className: 'dyn-kbd-row-desc' }, desc),
						),
						React.createElement('div', { className: 'dyn-kbd-row-controls' },
							React.createElement('label', { className: 'dyn-kbd-enable', title: '启用 / 禁用' },
								React.createElement('input', {
									type: 'checkbox',
									checked: a.enabled,
									onChange: (e) => patchSettings((s) => ({
										...s,
										actions: { ...s.actions, [f.id]: { ...s.actions[f.id], enabled: e.target.checked } },
									})),
								}),
							),
							isRecording
								? React.createElement('span', { className: 'dyn-kbd-recording' }, '按组合键…（Esc 取消 / ⌫ 清除）')
								: (comboText
									? React.createElement('span', { className: 'dyn-kbd-keys' },
										comboText.split(' ').map((part, i) => React.createElement('kbd', { key: i, className: 'dyn-kbd-key' }, part)))
									: React.createElement('span', { className: 'dyn-kbd-unset' }, '未绑定')),
							React.createElement('button', {
								className: 'dyn-kbd-btn' + (isRecording ? ' recording' : ''),
								onClick: () => { setNotice(null); setRecording(isRecording ? null : f.id); },
							}, isRecording ? '取消' : '录制'),
							React.createElement('button', {
								className: 'dyn-kbd-btn',
								disabled: !a.combo,
								onClick: () => patchSettings((s) => ({
									...s,
									actions: { ...s.actions, [f.id]: { ...s.actions[f.id], combo: null } },
								})),
							}, '清除'),
						),
					);
				});
				return React.createElement('div', { key: group.name, className: 'dyn-kbd-page' },
					React.createElement('h2', null, group.name),
					items,
				);
			});

			return React.createElement('div', { className: 'dyn-kbd-page' },
				React.createElement('h2', null, '键盘快捷键'),
				React.createElement('p', { className: 'dyn-kbd-hint' },
					'所有可用功能都已列出：带默认组合的直接生效；显示「未绑定」的点击「录制」后按下任意组合键即可自定义添加。' +
					'Backspace 清除绑定，Esc 取消录制。默认组合面向 macOS（⌘），Windows / Linux 自动改用 Ctrl。' +
					'⌘+数字 1-9 选模型，⌘⇧+数字 1-5 设当前模型思考强度；配置保存在浏览器 localStorage 中。'),
				notice && React.createElement('div', { className: 'dyn-kbd-notice-' + notice.kind }, notice.text),
				rows,
				React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } },
					React.createElement('button', {
						className: 'dyn-kbd-btn',
						onClick: () => {
							settings = defaults();
							saveSettings();
							emit();
							setNotice({ kind: 'info', text: '已恢复全部默认快捷键' });
						},
					}, '恢复默认快捷键'),
				),
			);
		}

		// ============ 操作反馈 Toast ============
		function ToastHost() {
			const state = useStoreState();
			if (!state.toast) return null;
			return React.createElement('div', { className: 'dyn-kbd-toast dyn-kbd-toast-' + state.toast.kind }, state.toast.text);
		}

		// ============ 会话快速切换面板（⌘K） ============
		function Palette(props) {
			const state = useStoreState();
			// 常驻订阅会话快照（currentSessionId 由 apply 中的 sessions.list 订阅维护）
			const list = props.useSessions((s) => s);
			const current = list && list.current ? list.current : undefined;
			// 预热模型目录：让 ⌘+数字 首次按下即有数据
			React.useEffect(() => {
				if (!current) return;
				const dir = modelDirectoryOf(current);
				if (dir) dir.load().catch(() => {});
			}, [current]);
			if (!state.paletteOpen) return null;
			return React.createElement(PaletteInner, { list });
		}

		function PaletteInner(props) {
			const list = props.list;
			const [query, setQuery] = React.useState('');
			const [index, setIndex] = React.useState(0);
			const inputRef = React.useRef(null);

			React.useEffect(() => {
				const el = inputRef.current;
				if (el) { el.focus(); el.select(); }
			}, []);
			React.useEffect(() => { setIndex(0); }, [query]);

			const q = query.trim().toLowerCase();
			const sessionRows = [];
			if (list && Array.isArray(list.ids) && list.byId) {
				for (const id of list.ids) {
					const sum = list.byId[id];
					if (!sum || sum.origin === 'subagent') continue;
					if (q && !(sum.displayTitle || '').toLowerCase().includes(q)
						&& !(sum.cwd || '').toLowerCase().includes(q)
						&& !id.toLowerCase().includes(q)) continue;
					sessionRows.push({ id, title: sum.displayTitle, cwd: sum.cwd, running: !!sum.running, current: id === list.current });
					if (sessionRows.length >= 60) break;
				}
			}
			const total = sessionRows.length + 1; // +「新建会话」
			const active = Math.min(Math.max(index, 0), total - 1);

			const sessionsSvc = pluginCtx && pluginCtx.get('sessions');
			const workspacesSvc = pluginCtx && pluginCtx.get('workspaces');

			const choose = (i) => {
				if (i === 0) {
					if (workspacesSvc) workspacesSvc.startSession();
					setPaletteOpen(false);
					return;
				}
				const row = sessionRows[i - 1];
				if (!row || !sessionsSvc) return;
				try { sessionsSvc.open(row.id); } catch (err) { /* 忽略未知会话 */ }
				setPaletteOpen(false);
			};

			const onKeyDown = (e) => {
				if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, total - 1)); }
				else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
				else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
				else if (e.key === 'Escape') { e.preventDefault(); setPaletteOpen(false); }
			};

			const items = [
				React.createElement('div', {
					key: '__new__',
					className: 'dyn-kbd-item' + (active === 0 ? ' active' : ''),
					onClick: () => choose(0),
				},
					React.createElement('span', { className: 'dyn-kbd-title' }, '新建会话'),
					React.createElement('span', { className: 'dyn-kbd-secondary' }, '↖ 新会话'),
				),
				...sessionRows.map((row, i) => React.createElement('div', {
					key: row.id,
					className: 'dyn-kbd-item' + (active === i + 1 ? ' active' : ''),
					onClick: () => choose(i + 1),
				},
					React.createElement('span', { className: 'dyn-kbd-title' }, row.title),
					React.createElement('span', { className: 'dyn-kbd-secondary' },
						row.running ? '运行中' : (row.current ? '当前' : (row.cwd || ''))),
				)),
			];

			return React.createElement('div', { className: 'dyn-kbd-palette-backdrop', onClick: () => setPaletteOpen(false) },
				React.createElement('div', { className: 'dyn-kbd-palette', onClick: (e) => e.stopPropagation() },
					React.createElement('input', {
						ref: inputRef,
						className: 'dyn-kbd-input',
						value: query,
						placeholder: '搜索会话…',
						onChange: (e) => setQuery(e.target.value),
						onKeyDown: onKeyDown,
					}),
					React.createElement('div', { className: 'dyn-kbd-items' },
						items,
						sessionRows.length === 0 && React.createElement('div', { className: 'dyn-kbd-empty' },
							q ? '没有匹配的会话' : '还没有会话，回车或点击「新建会话」'),
					),
					React.createElement('div', { className: 'dyn-kbd-footer' },
						React.createElement('span', null, '↑↓ 选择'),
						React.createElement('span', null, '↵ 打开'),
						React.createElement('span', null, 'Esc 关闭'),
					),
				),
			);
		}

		// ============ 快捷键速查表（⌘/） ============
		function Cheatsheet() {
			const state = useStoreState();
			// ⚠️ hooks 必须在条件 return 之前调用（否则开关面板时 React #310 崩溃）
			React.useEffect(() => {
				if (!state.cheatsheetOpen) return;
				const onKey = (e) => { if (e.key === 'Escape') setCheatsheetOpen(false); };
				window.addEventListener('keydown', onKey, true);
				return () => window.removeEventListener('keydown', onKey, true);
			}, [state.cheatsheetOpen]);
			if (!state.cheatsheetOpen) return null;

			const groups = [];
			const groupIndex = {};
			for (const f of FEATURES) {
				if (groupIndex[f.group] === undefined) {
					groupIndex[f.group] = groups.length;
					groups.push({ name: f.group, items: [] });
				}
				groups[groupIndex[f.group]].items.push(f);
			}

			return React.createElement('div', { className: 'dyn-kbd-palette-backdrop', onClick: () => setCheatsheetOpen(false) },
				React.createElement('div', { className: 'dyn-kbd-palette dyn-kbd-cheat', onClick: (e) => e.stopPropagation() },
					React.createElement('div', { className: 'dyn-kbd-cheat-head' }, '快捷键速查表'),
					React.createElement('div', { className: 'dyn-kbd-items dyn-kbd-cheat-body' },
						groups.map((group) => React.createElement('div', { key: group.name, className: 'dyn-kbd-cheat-group' },
							React.createElement('div', { className: 'dyn-kbd-cheat-group-title' }, group.name),
							group.items.map((f) => {
								const a = state.settings.actions[f.id];
								const comboText = a && a.enabled && a.combo ? formatCombo(a.combo) : null;
								return React.createElement('div', { key: f.id, className: 'dyn-kbd-cheat-row' },
									React.createElement('span', { className: 'dyn-kbd-title' }, f.label),
									comboText
										? React.createElement('span', { className: 'dyn-kbd-keys' },
											comboText.split(' ').map((part, i) => React.createElement('kbd', { key: i, className: 'dyn-kbd-key' }, part)))
										: React.createElement('span', { className: 'dyn-kbd-unset' }, '未绑定'),
								);
							}),
						)),
						React.createElement('div', { className: 'dyn-kbd-cheat-group dyn-kbd-diag' },
							React.createElement('div', { className: 'dyn-kbd-cheat-group-title' }, '诊断'),
							React.createElement('div', { className: 'dyn-kbd-cheat-row' },
								React.createElement('span', null, '当前会话'),
								React.createElement('span', { className: 'dyn-kbd-secondary' }, diagnosticInfo().sessionId)),
							React.createElement('div', { className: 'dyn-kbd-cheat-row' },
								React.createElement('span', null, '⇧Tab 绑定'),
								React.createElement('span', { className: 'dyn-kbd-secondary' }, diagnosticInfo().cyclePermission)),
							React.createElement('div', { className: 'dyn-kbd-cheat-row' },
								React.createElement('span', null, '权限投影'),
								React.createElement('span', { className: 'dyn-kbd-secondary' }, diagnosticInfo().permState)),
							React.createElement('div', { className: 'dyn-kbd-cheat-row' },
								React.createElement('span', null, '命令通道'),
								React.createElement('span', { className: 'dyn-kbd-secondary' }, diagnosticInfo().remoteOk ? '可用' : '不可用')),
						),
						React.createElement('div', { className: 'dyn-kbd-cheat-group dyn-kbd-diag' },
							React.createElement('div', { className: 'dyn-kbd-cheat-group-title' }, '最近按键（按 ⇧Tab 后看这里是否被捕获）'),
							keyLog.length === 0
								? React.createElement('div', { className: 'dyn-kbd-cheat-row' }, React.createElement('span', { className: 'dyn-kbd-unset' }, '还没有按键记录'))
								: keyLog.slice(-12).reverse().map((entry, i) => React.createElement('div', { key: i, className: 'dyn-kbd-cheat-row' },
									React.createElement('span', { className: 'dyn-kbd-title' }, formatLogKey(entry)),
									React.createElement('span', { className: 'dyn-kbd-secondary' }, entry.time))),
						),
					),
					React.createElement('div', { className: 'dyn-kbd-footer' },
						React.createElement('span', null, '点击空白处或按 Esc 关闭'),
						React.createElement('span', null, '设置 → 快捷键 可自定义'),
					),
				),
			);
		}

		// ============ 侧边栏底部入口按钮（常驻，确认插件在运行） ============
		function ShortcutButton(props) {
			const wide = !!props.wide;
			return React.createElement('button', {
				className: 'dyn-kbd-foot-btn',
				title: '快捷键：⌘K 会话切换 · ⌘/ 速查表 · ⌘, 设置 · ⌘1-9 选模型 · ⇧Tab 权限 · ⌘⇧A 归档 · ⌘. 停止',
				onClick: () => setCheatsheetOpen(true),
			},
				React.createElement('span', { className: 'dyn-kbd-foot-icon' }, '⌘K'),
				wide && React.createElement('span', { className: 'dyn-kbd-foot-label' }, '快捷键'),
			);
		}

		// ============ 插件入口 ============
		function apply(ctx) {
			pluginCtx = ctx;

			// 当前会话跟踪：订阅 sessions 列表快照（归档 / 权限 / 模型 / 剪贴板动作需要当前会话 id）
			ctx.effect(() => {
				const sessionsSvc = ctx.get('sessions');
				if (!sessionsSvc || !sessionsSvc.list || typeof sessionsSvc.list.getSnapshot !== 'function') return;
				const sync = () => {
					try {
						const snap = sessionsSvc.list.getSnapshot();
						if (snap && snap.current) currentSessionId = snap.current;
					} catch (err) { /* ignore */ }
				};
				sync();
				if (typeof sessionsSvc.list.subscribe === 'function') return sessionsSvc.list.subscribe(sync);
				return undefined;
			}, 'dsh-shortcuts: current session');

			// 全局键盘监听
			installKeydown(ctx);

			// UI 槽位注册
			const slots = ctx.get('slots');
			if (slots) {
				slots.inject('settings.section', () => slots.register(
					{ name: 'settings.section', id: 'dyn-shortcuts', order: 30, label: '快捷键' },
					() => React.createElement(ShortcutsPage, null),
				), 'dsh-shortcuts: settings section');
				slots.inject('shell.overlay', () => slots.register(
					{ name: 'shell.overlay', id: 'dyn-shortcuts-palette' },
					(props) => React.createElement(Palette, { useSessions: props.useSessions }),
				), 'dsh-shortcuts: palette overlay');
				slots.inject('shell.overlay', () => slots.register(
					{ name: 'shell.overlay', id: 'dyn-shortcuts-cheatsheet' },
					() => React.createElement(Cheatsheet, null),
				), 'dsh-shortcuts: cheatsheet overlay');
				slots.inject('shell.overlay', () => slots.register(
					{ name: 'shell.overlay', id: 'dyn-shortcuts-toast' },
					() => React.createElement(ToastHost, null),
				), 'dsh-shortcuts: toast');
				slots.inject('sidebar.footer.action', () => slots.register(
					{ name: 'sidebar.footer.action', id: 'dyn-shortcuts', order: 10 },
					(props) => React.createElement(ShortcutButton, { wide: props.wide }),
				), 'dsh-shortcuts: footer button');
			}

			// 包样式（theme 变量跟随明暗主题）
			ctx.effect(() => {
				const tag = document.createElement('style');
				tag.setAttribute('data-plugin-css', 'dsh-shortcuts');
				tag.textContent = `
					.dyn-kbd-palette-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;}
					.dyn-kbd-palette{width:min(600px,calc(100vw - 48px));background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif;overflow:hidden;}
					.dyn-kbd-input{width:100%;box-sizing:border-box;border:none;outline:none;background:transparent;color:inherit;font-size:15px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);}
					.dyn-kbd-input::placeholder{color:var(--dsw-alias-label-secondary);}
					.dyn-kbd-items{max-height:min(46vh,420px);overflow-y:auto;padding:6px;}
					.dyn-kbd-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px;border-radius:8px;cursor:pointer;font-size:14px;}
					.dyn-kbd-item.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);}
					.dyn-kbd-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
					.dyn-kbd-secondary{color:var(--dsw-alias-label-secondary);font-size:12px;flex-shrink:0;}
					.dyn-kbd-empty{padding:18px 10px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;}
					.dyn-kbd-footer{display:flex;gap:16px;padding:8px 16px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px;}
					.dyn-kbd-page{display:flex;flex-direction:column;gap:10px;padding:4px 2px;}
					.dyn-kbd-page h2{margin:8px 0 0;font-size:15px;color:var(--dsw-alias-label-primary);}
					.dyn-kbd-page h2:first-child{margin-top:0;}
					.dyn-kbd-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6;}
					.dyn-kbd-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);}
					.dyn-kbd-row-main{display:flex;flex-direction:column;gap:2px;min-width:0;}
					.dyn-kbd-row-title{font-size:13px;color:var(--dsw-alias-label-primary);}
					.dyn-kbd-row-desc{font-size:12px;color:var(--dsw-alias-label-secondary);}
					.dyn-kbd-row-controls{display:flex;align-items:center;gap:8px;flex-shrink:0;}
					.dyn-kbd-enable{display:inline-flex;align-items:center;}
					.dyn-kbd-keys{display:inline-flex;align-items:center;gap:4px;}
					.dyn-kbd-key{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:22px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-bottom-width:2px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:12px;}
					.dyn-kbd-recording{font-size:12px;color:var(--dsw-alias-state-warn-primary);}
					.dyn-kbd-unset{font-size:12px;color:var(--dsw-alias-label-secondary);}
					.dyn-kbd-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;}
					.dyn-kbd-btn:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);}
					.dyn-kbd-btn.recording{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);}
					.dyn-kbd-btn:disabled{opacity:.4;cursor:default;}
					.dyn-kbd-notice-error{color:var(--dsw-alias-state-error-primary);font-size:12px;}
					.dyn-kbd-notice-info{color:var(--dsw-alias-label-secondary);font-size:12px;}
					.dyn-kbd-foot-btn{display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:6px 8px;font-size:12px;cursor:pointer;}
					.dyn-kbd-foot-btn:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-label-primary);}
					.dyn-kbd-foot-icon{font-size:12px;font-weight:600;}
					.dyn-kbd-foot-label{white-space:nowrap;}
					.dyn-kbd-cheat-head{padding:14px 16px;font-size:15px;font-weight:600;border-bottom:1px solid var(--dsw-alias-border-l1);}
					.dyn-kbd-cheat-body{max-height:min(60vh,560px);}
					.dyn-kbd-cheat-group{padding:8px 6px 2px;}
					.dyn-kbd-cheat-group-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:2px 10px 6px;}
					.dyn-kbd-cheat-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 10px;border-radius:8px;font-size:13px;}
					.dyn-kbd-cheat-row:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);}
					.dyn-kbd-diag{border-top:1px dashed var(--dsw-alias-border-l1);}
					.dyn-kbd-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2000;max-width:min(480px,calc(100vw - 48px));padding:10px 18px;border-radius:10px;font-size:13px;box-shadow:0 8px 28px rgba(0,0,0,.24);pointer-events:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);}
					.dyn-kbd-toast-ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);color:var(--dsw-alias-state-success-primary);}
					.dyn-kbd-toast-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);color:var(--dsw-alias-state-error-primary);}
					.dyn-kbd-toast-info{color:var(--dsw-alias-label-secondary);}
					.dyn-kbd-toast-perm-readonly{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 55%,transparent);color:var(--dsw-alias-state-success-primary,#22c55e);font-weight:600;}
					.dyn-kbd-toast-perm-workspace{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 55%,transparent);color:var(--dsw-alias-brand-primary,#3b82f6);font-weight:600;}
					.dyn-kbd-toast-perm-full{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 55%,transparent);color:var(--dsw-alias-state-warn-primary,#f59e0b);font-weight:600;}
				`;
				document.head.append(tag);
				return () => tag.remove();
			}, 'dsh-shortcuts: styles');

			console.log('dsh-shortcuts 已加载（平台: ' + (isMac ? 'macOS' : '非 macOS') + '，功能数: ' + FEATURES.length + '）');

			// 就绪提示：确认插件已生效（不需要开发者工具即可验证）
			try {
				if (typeof ctx.timeout === 'function') {
					ctx.timeout(() => showToast('快捷键插件已就绪（' + FEATURES.length + ' 个功能）', 'info'), 1200);
				}
			} catch (err) { /* ignore */ }
		}

		exports.apply = apply;
		return module.exports;
	}
});
