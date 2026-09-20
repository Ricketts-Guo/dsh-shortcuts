import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

let requiredServices;
let mount;

apply({
  inject(services, callback) {
    requiredServices = services;
    mount = callback;
  },
});

assert.deepEqual(requiredServices, ['webServer', 'permissionPresets', 'sessions', 'connection']);
assert.equal(typeof mount, 'function', 'host route must be deferred until services exist');

const session = { id: 'session-1' };
const presetCalls = [];
let route;
let disposed = false;
let effectLabel;
let effectDispose;

const hostCtx = {
  connection: { requestRejection: (req) => req.rejection },
  sessions: { get: (id) => (id === session.id ? session : undefined) },
  permissionPresets: {
    set(target, preset) {
      if (preset === 'invalid') throw new Error('unknown preset');
      presetCalls.push([target, preset]);
    },
  },
  webServer: {
    register(spec) {
      route = spec;
      return () => { disposed = true; };
    },
  },
  effect(callback, label) {
    effectLabel = label;
    effectDispose = callback();
    return effectDispose;
  },
};

mount(hostCtx);
assert.equal(effectLabel, 'dsh-shortcuts: permission route');
assert.equal(route.path, '/dsh-shortcuts-permission');
assert.equal(route.kind, 'prefix');

function request(url, { method = 'POST', rejection } = {}) {
  let status;
  let headers;
  let body;
  route.handler({ url, method, rejection }, {
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end(nextBody) { body = JSON.parse(nextBody); },
  });
  return { status, headers, body };
}

assert.deepEqual(request('/dsh-shortcuts-permission'), {
  status: 400,
  headers: { 'content-type': 'application/json' },
  body: { ok: false, error: 'sessionId and preset are required' },
});
assert.equal(request('/dsh-shortcuts-permission?sessionId=missing&preset=read-only').status, 404);
assert.equal(request('/dsh-shortcuts-permission?sessionId=session-1&preset=invalid').status, 400);
const validPath = '/dsh-shortcuts-permission?sessionId=session-1&preset=read-only';
assert.equal(request(validPath, { rejection: 401 }).status, 401);
assert.equal(request(validPath, { rejection: 403 }).status, 403);
assert.equal(request(validPath, { method: 'GET' }).status, 405);
assert.equal(request(validPath, { method: 'GET' }).headers.allow, 'POST');
assert.deepEqual(presetCalls, [], 'authentication, origin and method rejection must precede permission mutation');
assert.deepEqual(request('/dsh-shortcuts-permission?sessionId=session-1&preset=read-only').body, { ok: true });
assert.deepEqual(presetCalls, [[session, 'read-only']]);

effectDispose();
assert.equal(disposed, true, 'route disposer must follow the plugin lifecycle');

console.log('  ✓ host waits for services, enforces authentication/origin/POST, validates requests, and disposes its route');
