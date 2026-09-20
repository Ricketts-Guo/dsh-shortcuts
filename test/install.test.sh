#!/usr/bin/env bash
# CLI dispatch/failure tests; runtime.test.mjs separately runs the real DSH CLI.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/isolated home/profiles/web"
cat > "$TEST_ROOT/bin/dsh" <<'NODE'
#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.DSH_TEST_LOG, JSON.stringify({args:process.argv.slice(2),home:process.env.DSH_HOME})+'\n');
process.exit(process.env.DSH_TEST_FAIL === '1' ? 17 : 0);
NODE
chmod +x "$TEST_ROOT/bin/dsh"
export DSH_BIN="$TEST_ROOT/bin/dsh"
export DSH_TEST_LOG="$TEST_ROOT/calls.jsonl"
export DSH_PROFILE_DIR="$TEST_ROOT/isolated home/profiles/web"
export DSH_SHORTCUTS_DIR="$ROOT_DIR"
bash "$ROOT_DIR/install.sh" > "$TEST_ROOT/result.txt"
node - "$DSH_TEST_LOG" "$ROOT_DIR" "$TEST_ROOT/isolated home" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const calls = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
assert.deepEqual(calls.map(x => x.args), [
  ['plugin','--profile','web','add','--save-prod','--ignore-scripts','file:'+process.argv[3]],
  ['--profile','web','--dump-config'],
]);
assert.ok(calls.every(x=>x.home===process.argv[4]), 'all calls must use the explicit disposable home');
NODE
: > "$DSH_TEST_LOG"
if DSH_TEST_FAIL=1 bash "$ROOT_DIR/install.sh" > "$TEST_ROOT/failed.txt" 2>&1; then
  echo 'installer must propagate CLI failure' >&2; exit 1
fi
node - "$DSH_TEST_LOG" "$TEST_ROOT/failed.txt" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.equal(fs.readFileSync(process.argv[2],'utf8').trim().split('\n').length,1);
assert.ok(!fs.readFileSync(process.argv[3],'utf8').includes('插件已安装'));
NODE
: > "$DSH_TEST_LOG"
if DSH_PROFILE_DIR="$TEST_ROOT/not-a-profile" bash "$ROOT_DIR/install.sh" >/dev/null 2>&1; then
  echo 'installer must reject a directory outside the Profile layout' >&2; exit 1
fi
[ ! -s "$DSH_TEST_LOG" ]
printf '  ✓ installer uses official CLI with quoted paths, propagates failure, rejects ambiguous profiles\n'
