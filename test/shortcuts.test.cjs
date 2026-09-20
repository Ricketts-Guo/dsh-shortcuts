/**
 * dsh-shortcuts — browser-half test suite.
 *
 * Loads lib/client.js in a vm sandbox with browser stubs, then drives the
 * registered keydown handler with synthetic events and asserts the actions
 * that fire. React is a pinned development dependency; no desktop installation
 * or real DSH profile is read or modified.
 *
 * Run: npm test
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.join(__dirname, '..');
const hostReq = createRequire(path.join(ROOT, 'package.json'));
const React = hostReq('react');
const ReactDOMServer = hostReq('react-dom/server');

// ---------- browser stubs ----------
const styleEl = { setAttribute() {}, remove() {}, textContent: '' };
const sandbox = {
  console,
  require: (spec) => hostReq(spec),
  navigator: {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh)',
    clipboard: { writeText: async (t) => { sandbox.__clipboard = (sandbox.__clipboard || []).concat([t]); } },
  },
  window: {
    localStorage: {
      getItem: () => sandbox.__preset || null,
      setItem: (k, v) => { sandbox.__stored = v; },
    },
    addEventListener: (type, fn, cap) => {
      if (type === 'keydown') sandbox.__handlers.push(fn);
      if (type === 'keyup') sandbox.__keyupHandlers.push(fn);
      if (type === 'blur') sandbox.__blurHandlers.push(fn);
    },
    removeEventListener: () => {},
    scrollTo: (o) => { sandbox.__scroll = o; },
  },
  fetch: (url, options) => { sandbox.__permFetch = String(url); sandbox.__permMethod = options?.method; return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); },
  document: {
    createElement: (tag) => (tag === 'style' ? styleEl : {
      append() {}, remove() {}, style: {}, focus() {}, select() {}, addEventListener() {}, removeEventListener() {},
      setAttribute() {}, getAttribute: () => null, click() {}, textContent: '', value: '',
    }),
    head: { append: () => {} },
    body: { contains: () => true, prepend: () => {}, scrollHeight: 5000 },
    documentElement: { scrollHeight: 5000, requestFullscreen: () => { sandbox.__fullscreen = 'enter'; return Promise.resolve(); } },
    fullscreenElement: null,
    exitFullscreen: () => { sandbox.__fullscreen = 'exit'; return Promise.resolve(); },
    querySelector: () => null,
    querySelectorAll: () => [],
    dispatchEvent: () => true,
  },
  KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
};
sandbox.window.__ModuleLoader__ = { load: (handoff) => { sandbox.__handoff = handoff; } };
sandbox.__handlers = [];
sandbox.__keyupHandlers = [];
sandbox.__blurHandlers = [];
sandbox.__preset = null;
sandbox.__selected = [];

// ---------- model directory fake ----------
const fakeGroups = [
  {
    id: 'deepseek-official', name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'V4 Flash', reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'medium', name: '中' }, { id: 'max', name: '最大' }], defaultEffort: 'low' } },
      { id: 'deepseek-v4-pro', name: 'V4 Pro', reasoning: { efforts: [{ id: 'max', name: '最大' }], defaultEffort: 'max' } },
    ],
  },
  { id: 'pi-ai', name: 'PI AI', models: [{ id: 'pi-model-1', name: 'Pi One' }] },
];
let groupsLoaded = true;
const fakeDirectory = {
  store: {
    getSnapshot: () => ({
      groups: groupsLoaded ? fakeGroups : [],
      current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
      status: groupsLoaded ? 'ready' : 'idle',
    }),
    subscribe: () => () => {},
    update: () => {},
  },
  load: async () => { groupsLoaded = true; return { groups: fakeGroups, current: null, routable: true, failures: [] }; },
  select: async (sel) => { sandbox.__selected.push(sel); },
};

// ---------- projections fake ----------
const permissionOptions = [{ value: 'read-only', name: 'Read only' }, { value: 'workspace-write', name: 'Workspace write' }, { value: 'danger-full-access', name: 'Full access' }];
let permissionSnapshot = { options: permissionOptions, currentValue: 'workspace-write' };
const fakeProjections = {
  faceOf: (key) => {
    if (key === 'permissions') return { getSnapshot: () => permissionSnapshot };
    if (key === 'conversation') return { getSnapshot: () => ({ nodes: [
      { kind: 'user', seq: 1, content: [] },
      { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: '回复一' }] },
      { kind: 'assistant', seq: 3, blocks: [{ kind: 'reasoning', text: 'rr' }, { kind: 'text', text: '回复二\n第二行' }] },
    ] }) };
    return undefined;
  },
};

const sessionList = { current: 's1', ids: ['s1'], byId: { s1: { displayTitle: '我的会话标题', cwd: '/test' } } };
const listListeners = new Set();

// ---------- load plugin ----------
const code = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8');

// ---------- React hooks 顺序静态检查（防 React #310：hook 不得出现在条件 return null 之后） ----------
function checkHookOrder(src) {
  const lines = src.split('\n');
  const errors = [];
  let inFn = null;
  let depth = 0;
  let seenReturnNull = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnMatch = /function\s+(\w+)\s*\(/.exec(line);
    if (fnMatch && depth === 0 && !line.trim().startsWith('//')) {
      inFn = fnMatch[1];
      seenReturnNull = false;
    }
    if (inFn) {
      if (!seenReturnNull && /return\s+null/.test(line)) seenReturnNull = true;
      if (seenReturnNull && /React\.use[A-Z]/.test(line)) {
        errors.push(inFn + ' 第 ' + (i + 1) + ' 行: hook 出现在条件 return null 之后（会触发 React #310）');
      }
    }
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (inFn && depth <= 0) inFn = null;
  }
  return errors;
}
{
  const hookErrors = checkHookOrder(code);
  if (hookErrors.length > 0) {
    console.error('\nReact hooks 顺序检查失败:\n  ' + hookErrors.join('\n  '));
    process.exit(1);
  }
  console.log('  ✓ React hooks 顺序检查（无 hook 在条件 return 之后）');
}

vm.runInNewContext(code, sandbox, { filename: 'dsh-shortcuts/client.js' });
const mod = sandbox.__handoff.factory((spec) => hostReq(spec));
if (JSON.stringify(mod.inject) !== JSON.stringify(['slots', 'sessions', 'remote', 'timer', 'uiSession', 'uiWorkspace'])) {
  throw new Error('client module must wait for its declared public services before apply');
}

const scopeConversation = { cancel: () => { sandbox.__cancel = true; return Promise.resolve(); } };
// 权限命令通道（session.command）：记录调用并返回 matched 结果
const commandCalls = [];
const slotRenderers = {};
const slotsService = {
  inject(name, mount) { return mount(); },
  register(spec, render) {
    slotRenderers[spec.id] = render;
    return () => { delete slotRenderers[spec.id]; };
  },
};
const sessionObj = {
  projections: fakeProjections,
  command: (line) => { commandCalls.push(line); return Promise.resolve({ ok: true, value: { matched: true } }); },
};
const ctxTarget = {
  get(name) {
    if (name === 'slots') return slotsService;
    if (name === 'sessions') return {
      binding: () => ({ session: sessionObj, ctx: { get: (k) => (k === 'conversation' ? scopeConversation : undefined) } }),
      list: { getSnapshot: () => sessionList, subscribe(fn) { listListeners.add(fn); return () => listListeners.delete(fn); } },
    };
    if (name === 'modelDirectories') return { directoryFor: () => fakeDirectory };
    if (name === 'uiWorkspace') return { startSession: () => { sandbox.__startSession = true; }, openSession: (id) => { sandbox.__opened = id; }, archiveSession: (id) => { sandbox.__archived = id; return Promise.resolve(); } };
    if (name === 'sidebarRight') return { toggleExpanded: () => { sandbox.__details = true; } };
    if (name === 'layout') return { toggleSidebar: () => { sandbox.__sidebar = true; }, openDetails: () => {}, closeDetails: () => {} };
    if (name === 'theme') return { getTheme: () => ({ active: { colorScheme: 'dark' } }), setTheme: (id) => { sandbox.__theme = id; } };
    if (name === 'locale') return { getSnapshot: () => ({ active: 'zh', locales: [{ id: 'zh' }, { id: 'en' }] }), setLocale: (id) => { sandbox.__locale = id; } };
    if (name === 'remote.commands') return { execute() {} };
    return undefined;
  },
  timeout(cb) { return () => {}; },
  effect(cb) { const d = cb(); return () => d && d(); },
};
// DSH rc.6 会阻止未声明的 ctx.remote.commands 属性访问。测试使用同类
// Guard，确保速查表诊断只通过 ctx.get('remote.commands') 读取嵌套服务。
const ctx = new Proxy(ctxTarget, {
  get(target, prop, receiver) {
    if (prop === 'remote') throw new Error('cannot get property "remote.commands" without inject');
    return Reflect.get(target, prop, receiver);
  },
});
mod.apply(ctx);

const handler = sandbox.__handlers[0];
if (!handler) throw new Error('keydown handler not registered');

const press = (init, target) => {
  const event = { repeat: false, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, target, preventDefault() { this._pd = true; }, stopPropagation() {}, ...init };
  handler(event);
  return event;
};
const release = (init) => sandbox.__keyupHandlers[0]({ ...init });
const ta = { tagName: 'TEXTAREA', isContentEditable: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (cond, name) => { if (!cond) throw new Error('FAIL: ' + name); passed++; console.log('  ✓', name); };

(async () => {
  // 1) ⌘+1 选第 1 个模型（含默认思考强度）
  press({ key: '1', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, ta);
  await sleep(20);
  ok(sandbox.__selected[0] && sandbox.__selected[0].model === 'deepseek-v4-flash' && sandbox.__selected[0].reasoningEffort === 'low', '⌘1 selects model 1 with default effort');

  // 2) 旧 ⌘⇧1 默认键不再触发（避免 macOS 截屏冲突）
  const beforeLegacyEffort = sandbox.__selected.length;
  press({ key: '!', shiftKey: true, metaKey: true, ctrlKey: false, altKey: false }, ta);
  await sleep(20);
  ok(sandbox.__selected.length === beforeLegacyEffort, 'legacy ⌘⇧1 no longer selects an effort');

  // 3) 按住 Tab + 1 → 第 1 档；裸 Tab 本身仍不被拦截
  const tabDown1 = press({ key: 'Tab', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, ta);
  press({ key: '1', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, ta);
  await sleep(20);
  ok(!tabDown1._pd && sandbox.__selected[1] && sandbox.__selected[1].reasoningEffort === 'low', 'Tab+1 sets effort[0] without intercepting bare Tab');
  release({ key: 'Tab' });

  // 4) 按住 Tab + 3 → max
  press({ key: 'Tab', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, ta);
  press({ key: '3', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, ta);
  await sleep(20);
  ok(sandbox.__selected[2] && sandbox.__selected[2].reasoningEffort === 'max', 'Tab+3 sets effort[2]');
  release({ key: 'Tab' });

  // 5) ⌘. 停止任务
  press({ key: '.', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, ta);
  await sleep(10);
  ok(sandbox.__cancel === true, '⌘. stops the running task');

  // 6) ⇧Tab 权限轮换
  press({ key: 'Tab', shiftKey: true, metaKey: false, ctrlKey: false, altKey: false }, ta);
  await sleep(10);
  ok(sandbox.__permMethod === 'POST' && sandbox.__permFetch && sandbox.__permFetch.includes('preset=danger-full-access') && sandbox.__permFetch.includes('sessionId=s1'), '⇧Tab cycles permission via POST to the silent host route');

  // 7) ⌘⇧L 主题
  press({ key: 'l', shiftKey: true, metaKey: true, ctrlKey: false, altKey: false }, ta);
  await sleep(10);
  ok(sandbox.__theme === 'light', '⌘⇧L toggles theme');

  // 8) ⌘/ 速查表开关，并真正渲染 overlay（覆盖 DSH rc.6 Guard）
  press({ key: '/', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, ta);
  const cheatsheetRenderer = slotRenderers['dyn-shortcuts-cheatsheet'];
  const cheatsheetMarkup = ReactDOMServer.renderToStaticMarkup(cheatsheetRenderer({}));
  ok(cheatsheetMarkup.includes('快捷键速查表') && cheatsheetMarkup.includes('命令通道'), '⌘/ renders cheatsheet under guarded DSH context');
  press({ key: '/', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, ta);

  press({ key: 'k', metaKey: true }, ta);
  const paletteMarkup = ReactDOMServer.renderToStaticMarkup(slotRenderers['dyn-shortcuts-palette']());
  ok(paletteMarkup.includes('我的会话标题') && paletteMarkup.includes('新建会话'), 'palette renders from public store without implicit slot props');
  press({ key: 'k', metaKey: true }, ta);
  press({ key: 'n', metaKey: true }, ta);
  ok(sandbox.__startSession === true, 'new session uses uiWorkspace');
  press({ key: 'a', metaKey: true, shiftKey: true }, ta);
  ok(sandbox.__archived === 's1', 'archive uses uiWorkspace and legacy list selection');
  press({ key: 'd', metaKey: true, shiftKey: true }, ta);
  ok(sandbox.__details === true, 'details uses sidebarRight public toggle');

  // 9) 复制最后一条助手消息（预置绑定 ⌘⇧C）
  sandbox.__preset = JSON.stringify({ actions: {
    copyLastMessage: { enabled: true, combo: 'Meta+Shift+C' },
    selectEffort1: { enabled: true, combo: 'Meta+Shift+1' },
  } });
  sandbox.__clipboard = [];
  const mod2 = sandbox.__handoff.factory((spec) => hostReq(spec));
  mod2.apply(ctx);
  const handler2 = sandbox.__handlers[1];
  handler2({ repeat: false, target: ta, preventDefault() {}, stopPropagation() {}, key: 'c', shiftKey: true, metaKey: true, ctrlKey: false, altKey: false });
  await sleep(20);
  ok(sandbox.__clipboard && sandbox.__clipboard[0] === '回复二\n第二行', 'copyLastMessage copies last assistant text (skips reasoning)');

  // 10) 旧版默认思考强度绑定自动迁移为 Tab+数字
  const beforeMigratedEffort = sandbox.__selected.length;
  handler2({ repeat: false, target: ta, preventDefault() {}, stopPropagation() {}, key: 'Tab', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false });
  handler2({ repeat: false, target: ta, preventDefault() {}, stopPropagation() {}, key: '1', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false });
  await sleep(20);
  ok(sandbox.__selected[beforeMigratedEffort] && sandbox.__selected[beforeMigratedEffort].reasoningEffort === 'low', 'legacy effort default migrates to Tab+1');
  sandbox.__keyupHandlers[1]({ key: 'Tab' });

  // 11) 打字不拦截
  const before = sandbox.__selected.length;
  press({ key: 'a', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, ta);
  ok(sandbox.__selected.length === before, 'typing is never intercepted');

  // 12) 裸 Tab 不触发
  const before2 = commandCalls.length;
  press({ key: 'Tab', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }, ta);
  ok(commandCalls.length === before2, 'bare Tab is not intercepted');
  release({ key: 'Tab' });

  // alpha.2 selection is a separate public store; list.current may be absent/stale.
  sandbox.__preset = null;
  permissionSnapshot = { currentValue: 'workspace-write' };
  let selectedSession = { key: 's2' };
  const currentListeners = new Set();
  const retries = [];
  const disposers = [];
  const catalogResult = { ok: true, value: { options: permissionOptions } };
  let catalog = async () => catalogResult;
  const alphaContext = {
    ...ctxTarget,
    get(name) {
      if (name === 'uiSession') return { current: {
        getSnapshot: () => selectedSession,
        subscribe(fn) { currentListeners.add(fn); return () => currentListeners.delete(fn); },
      } };
      if (name === 'remote.permissionPresets') return { catalog: () => catalog() };
      return ctxTarget.get(name);
    },
    timeout(callback, ms) { if (ms === 300) retries.push(callback); return () => {}; },
    effect(callback) { const dispose = callback(); if (dispose) disposers.push(dispose); },
  };
  const listCount = listListeners.size;
  sandbox.__handoff.factory(hostReq).apply(alphaContext);
  const alphaHandler = sandbox.__handlers.at(-1);
  const alphaPress = (init) => alphaHandler({ repeat: false, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, target: ta, preventDefault() {}, stopPropagation() {}, ...init });
  const selectSession = (value) => { selectedSession = value; for (const listener of currentListeners) listener(); };
  sandbox.__permFetch = null;
  alphaPress({ key: 'Tab', shiftKey: true });
  await sleep(10);
  ok(sandbox.__permFetch?.includes('sessionId=s2') && sandbox.__permFetch?.includes('preset=danger-full-access'), 'alpha.2 selection and separate permission catalog select the correct session/preset');

  sandbox.__permFetch = null;
  let resolveCatalog;
  catalog = () => new Promise(resolve => { resolveCatalog = resolve; });
  alphaPress({ key: 'Tab', shiftKey: true });
  selectSession({ key: 's3' });
  resolveCatalog(catalogResult);
  await sleep(10);
  ok(sandbox.__permFetch === null, 'navigation cancels an in-flight permission catalog action');

  catalog = async () => { throw new Error('catalog unavailable'); };
  alphaPress({ key: 'Tab', shiftKey: true });
  await sleep(10);
  for (let i = 0; i < 2; i++) { retries.shift()(); await sleep(10); }
  ok(sandbox.__permFetch === null && retries.length === 0, 'catalog failure exhausts bounded retries without changing permissions');

  sandbox.__archived = null;
  sandbox.__details = false;
  selectSession(null);
  alphaPress({ key: 'a', metaKey: true, shiftKey: true });
  alphaPress({ key: 'd', metaKey: true, shiftKey: true });
  ok(sandbox.__archived === null && sandbox.__details === false, 'empty current selection clears the old session instead of using stale list.current');
  selectSession({ key: 's3' });
  catalog = () => new Promise(resolve => { resolveCatalog = resolve; });
  alphaPress({ key: 'Tab', shiftKey: true });
  disposers.reverse().forEach(dispose => dispose());
  resolveCatalog(catalogResult);
  await sleep(10);
  ok(sandbox.__permFetch === null, 'unmount cancels a pending permission lookup');
  ok(currentListeners.size === 0 && listListeners.size === listCount, 'unmount releases both current-session and list subscriptions');

  console.log(`\nAll ${passed} tests passed.`);
})().catch((e) => { console.error('\n' + e.message); process.exit(1); });
