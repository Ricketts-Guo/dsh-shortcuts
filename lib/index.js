/**
 * dsh-shortcuts — host half.
 *
 * The browser half (`./client`) is picked up by dsh-client-modules through the
 * package's `dsh.client` declaration. This host half exists for ONE reason:
 * silent permission cycling. The official permission switcher routes through
 * the `/permission` slash command, whose lifecycle is durably logged as
 * command nodes in the conversation flow (`command/run` / `command/done`).
 * Cycling permissions with a hotkey would spam the transcript with those
 * nodes. Instead, this half exposes a minimal loopback HTTP endpoint that the
 * browser half calls to write the permission directly through the
 * `permissionPresets` service — the same service the command handler uses,
 * minus the transcript noise.
 *
 * Security posture: the route is a no-op unless the deployment actually
 * mounts the permission service, and it validates the session id against the
 * live session store and the preset against the configured preset table
 * (`permissionPresets.set` throws on unknown presets). DSH's own web server
 * binds to loopback; keep it that way.
 */

/** Minimal JSON response helper. */
function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Host loader entry. */
export function apply(ctx) {
  // A profile bundle is mounted before these host services during a cold
  // Desktop/WebUI boot.  A one-shot ctx.get() here used to return undefined
  // and permanently skip the route until the plugin was manually reloaded.
  // Cordis inject is reactive: it mounts this effect as soon as every service
  // exists and disposes the route with the plugin scope.
  ctx.inject(['webServer', 'permissionPresets', 'sessions'], (hostCtx) => {
    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'prefix',
      path: '/dsh-shortcuts-permission',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost');
          const sessionId = url.searchParams.get('sessionId');
          const preset = url.searchParams.get('preset');
          if (!sessionId || !preset) {
            writeJson(res, 400, { ok: false, error: 'sessionId and preset are required' });
            return;
          }
          const session = hostCtx.sessions.get(sessionId);
          if (!session) {
            writeJson(res, 404, { ok: false, error: 'session not found' });
            return;
          }
          try {
            hostCtx.permissionPresets.set(session, preset); // throws on unknown preset
            writeJson(res, 200, { ok: true });
          } catch (err) {
            writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
          }
        } catch (err) {
          writeJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      },
    }), 'dsh-shortcuts: permission route');
  });
}
