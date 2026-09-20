import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  runtime: { type: 'string' }, output: { type: 'string' }, browser: { type: 'string' },
} });
const runtimePath = values.runtime || process.env.DSH_TEST_RUNTIME;
const outputPath = values.output || process.env.DSH_TEST_OUTPUT;
assert.ok(runtimePath, 'Pass --runtime for an isolated DSH installation.');
const runtime = resolve(runtimePath);
const runtimeRequire = createRequire(join(runtime, 'package.json'));
const dshManifest = runtimeRequire('@deepseek-ai/dsh/package.json');
const cli = join(dirname(runtimeRequire.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js');
const version = dshManifest.version;
// A prerelease CLI can otherwise resolve newer DSH transitive packages.
const runtimeLock = JSON.parse(await readFile(join(runtime, 'package-lock.json'), 'utf8'));
const dshPackages = Object.entries(runtimeLock.packages).filter(([path]) => /(?:^|\/)node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(path));
assert.ok(dshPackages.length > 0, 'Provide an npm-installed runtime using the checked-in fixture.');
for (const [path, pkg] of dshPackages) {
  assert.equal(pkg.version, version, `Mixed DSH version in lockfile: ${path}`);
  const installed = JSON.parse(await readFile(join(runtime, path, 'package.json'), 'utf8'));
  assert.equal(installed.version, version, `Mixed installed DSH version: ${path}`);
}
const scratch = await mkdtemp(join(tmpdir(), 'dsh-shortcuts-'));
const home = join(scratch, 'home');
const workspace = join(scratch, 'workspace');
const evidenceDir = resolve(outputPath || join(scratch, 'evidence'));
await mkdir(workspace, { recursive: true });
await mkdir(evidenceDir, { recursive: true });
const env = { ...process.env, DSH_HOME: home, DSH_PROFILE: 'web', DSH_BIN: cli,
  DSH_SHORTCUTS_DIR: join(scratch, 'package'), npm_config_cache: join(scratch, 'npm-cache'),
  npm_config_store_dir: join(scratch, 'pnpm-store') };
delete env.DSH_PROFILE_DIR;
const evidence = { dsh: version, node: process.version, platform: process.platform, arch: process.arch,
  checkedAt: new Date().toISOString(), pinnedDshPackages: dshPackages.length, operations: {}, checks: [], browserErrors: [] };
let server, browser, page, serverCookie;
const logs = [];
const yaml = runtimeRequire('js-yaml');
// DSH prints unevaluated expressions as !!js; preserve them as data.
const configSchema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar', construct: value => ({ expression: value }),
}));

function run(executable, args, cwd = workspace) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stdout = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 120_000);
    child.stdout.on('data', data => { output += data; stdout += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      logs.push({ args: [executable, ...args], code, output });
      if (code === 0) accept(stdout);
      else reject(new Error(`Command failed (${code}): ${args.slice(0, 4).join(' ')}\n${output.slice(-5000)}`));
    });
  });
}
const dsh = (...args) => run(process.execPath, [cli, ...args]);
function configOf(text) {
  // Initialisation notices are on stderr, before the YAML document.
  const start = text.indexOf('\n- id:');
  return yaml.load(text.startsWith('- id:') ? text : text.slice(start + 1), { schema: configSchema });
}
async function boot() {
  let output = '';
  const child = spawn(process.execPath, [cli, 'web', '--port', '0', '--no-open'], {
    cwd: workspace, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`DSH exited during startup:\n${output.slice(-6000)}`);
    const match = output.match(/https?:\/\/127\.0\.0\.1:\d+[^\s\x1b]*/);
    if (match) {
      const url = new URL(match[0]);
      try {
        const response = await fetch(url.href, { redirect: 'manual' });
        if (response.status >= 200 && response.status < 400) {
          serverCookie = response.headers.get('set-cookie')?.split(';')[0];
          logs.push({ phase: 'boot', output }); return url.href;
        }
      } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Startup timed out:\n${output.slice(-6000)}`);
}
async function stop() {
  if (!server) return;
  const child = server;
  server = undefined;
  if (child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('close', resolve));
  process.kill(-child.pid, 'SIGTERM');
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000);
  await exited;
  clearTimeout(timer);
}

try {
  console.log(`[${version}] initialise disposable Profile`);
  const baseline = configOf(await dsh('web', '--dump-config'));
  assert.ok(Array.isArray(baseline), 'DSH must emit a composed entry array');
  const profile = join(home, 'profiles/web');
  const snapshot = join(scratch, 'before');
  await cp(profile, snapshot, { recursive: true, verbatimSymlinks: true });
  const packText = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], plugin);
  const packed = JSON.parse(packText)[0];
  const tarball = join(scratch, packed.filename);
  evidence.package = { version: packed.version, sha256: createHash('sha256').update(await readFile(tarball)).digest('hex') };
  evidence.sourceFiles = {};
  for (const file of ['package.json', 'lib/client.js', 'lib/index.js', 'cordis.patch.yml', 'install.sh', 'test/runtime.test.mjs']) {
    evidence.sourceFiles[file] = createHash('sha256').update(await readFile(join(plugin, file))).digest('hex');
  }
  console.log(`[${version}] install via official CLI`);
  await run('tar', ['-xf', tarball, '-C', scratch]);
  await run('bash', [join(plugin, 'install.sh')]);
  const installed = configOf(await dsh('web', '--dump-config'));
  assert.equal(installed.filter(x => x.id === 'shortcuts' && x.name === 'dsh-shortcuts').length, 1);
  assert.deepEqual(installed.filter(x => x.id !== 'shortcuts'), baseline, 'official entries must remain unchanged');
  evidence.operations.install = 'passed';
  evidence.checks.push('install.sh delegates packed artifact to official CLI', 'one additive Bundle entry; unchanged official composition');
  console.log(`[${version}] cold start and browser smoke`);
  const url = await boot();
  const channel = values.browser || process.env.DSH_TEST_BROWSER;
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  const context = await browser.newContext({ viewport: { width: 1360, height: 950 } });
  page = await context.newPage();
  page.on('pageerror', error => evidence.browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') logs.push({ phase: 'browser-console', output: message.text() });
  });
  await page.goto(url);
  // Fresh Profiles show DSH's welcome notice and optional provider setup.
  // Dismiss both through their visible controls; no API key is needed for UI checks.
  await page.getByRole('button', { name: /^(继续|Continue)$/ }).click({ timeout: 30_000 });
  await page.getByRole('button', { name: /^(稍后配置|Configure later)$/ }).click({ timeout: 30_000 });
  await page.getByRole('button', { name: /快捷键/ }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /快捷键/ }).click();
  await page.locator('.dyn-kbd-cheat-head').waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+/');
  await page.locator('.dyn-kbd-cheat-head').waitFor();
  assert.equal(await page.locator('.dyn-kbd-cheat-row').count() >= 34, true);
  await page.screenshot({ path: join(evidenceDir, 'shortcuts.png') });
  await page.keyboard.press('Meta+/');
  await page.keyboard.press('Meta+k');
  await page.locator('.dyn-kbd-input').waitFor();
  assert.equal(await page.locator('.dyn-kbd-item').first().innerText().then(text => text.includes('新建会话')), true);
  await page.keyboard.press('Escape');
  await page.locator('.dyn-kbd-input').waitFor({ state: 'hidden' });
  await page.keyboard.press('Meta+,');
  await page.getByText('快捷键', { exact: true }).last().click();
  await page.locator('.dyn-kbd-page').first().waitFor();
  assert.equal(await page.locator('.dyn-kbd-row').count(), 34);
  await page.screenshot({ path: join(evidenceDir, 'settings.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Shift+l');
  await page.keyboard.press('Meta+b');
  await page.keyboard.press('Meta+b');
  assert.deepEqual(evidence.browserErrors, [], 'browser must not have uncaught errors');
  const permissionUrl = new URL('/dsh-shortcuts-permission', url).href;
  assert.equal((await fetch(permissionUrl, { method: 'POST' })).status, 401);
  assert.equal((await context.request.post(permissionUrl, { headers: { origin: 'https://example.invalid' } })).status(), 403);
  assert.equal((await context.request.get(permissionUrl)).status(), 405);
  const invalid = await context.request.post(permissionUrl);
  assert.equal(invalid.status(), 400);
  assert.equal((await invalid.json()).ok, false);
  evidence.operations.start = 'passed';
  evidence.checks.push('welcome dismissed and model-key setup skipped', 'browser shortcut entry, 34-feature cheatsheet and settings, palette, theme and sidebar', 'permission route rejects unauthenticated (401), cross-origin (403), GET (405) and missing parameters (400)');
  await browser.close(); browser = undefined;
  await stop();
  console.log(`[${version}] uninstall`);
  await dsh('plugin', '--profile', 'web', 'remove', 'dsh-shortcuts');
  assert.deepEqual(configOf(await dsh('web', '--dump-config')), baseline);
  const cleanUrl = await boot();
  const missingRoute = await fetch(new URL('/dsh-shortcuts-permission', cleanUrl), {
    headers: serverCookie ? { cookie: serverCookie } : {},
  });
  assert.ok(!missingRoute.headers.get('content-type')?.includes('application/json'), 'plugin route must be absent');
  await stop();
  evidence.operations.uninstall = 'passed';
  console.log(`[${version}] restore pre-install snapshot`);
  await rm(profile, { recursive: true, force: true });
  await cp(snapshot, profile, { recursive: true, verbatimSymlinks: true });
  assert.deepEqual(configOf(await dsh('web', '--dump-config')), baseline);
  await boot();
  await stop();
  evidence.operations.rollback = 'passed';
  evidence.checks.push('uninstall removes Bundle and route', 'restored pre-install snapshot composes and cold-starts');
  evidence.status = 'passed';
  console.log(`[${version}] PASS`);
} catch (error) {
  evidence.status = 'failed';
  evidence.error = error.stack;
  console.error(error.stack.replace(/([?&#](?:token|auth|key)=)[^\s"&]+/gi, '$1<REDACTED>'));
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(evidenceDir, 'failure.png') });
    logs.push({ phase: 'browser-body', output: await page.locator('body').innerText() });
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
  const redact = value => JSON.stringify(value, null, 2).replaceAll(scratch, '<DISPOSABLE>')
    .replaceAll(runtime, '<DSH_RUNTIME>').replaceAll(plugin, '<PLUGIN_SOURCE>')
    .replace(/([?&#](?:token|auth|key)=)[^\s"&]+/gi, '$1<REDACTED>');
  await writeFile(join(evidenceDir, 'result.json'), redact(evidence) + '\n');
  await writeFile(join(evidenceDir, 'commands.json'), redact(logs) + '\n');
  if (outputPath) await rm(scratch, { recursive: true, force: true });
}
