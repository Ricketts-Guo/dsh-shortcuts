# Boundaries and permissions

The plugin adds the existing plugin-owned `shortcuts` Bundle entry and
`dyn-shortcuts*` client contributions. It does not modify DSH source,
`@deepseek-ai/*` packages, official entries, or loader/fiber internals.

The browser stores user bindings in `localStorage` (`dsh.shortcuts.v1`), handles
keyboard input, copies text on explicit commands, and invokes DSH's public UI
services. Permission cycling changes the selected session's sandbox/approval
preset through the Host `permissionPresets` service; it is not a read-only action.
It emits the Host's normal permission events but does not add slash-command
messages. The plugin has no model Tool, credential access, telemetry, external
network service, or install-time package lifecycle script.

The permission endpoint is intended for the loopback WebUI. It calls the public
`connection.requestRejection()` authentication and Host/Origin fence before
reading session parameters, accepts POST only, and rejects GET mutations. The installer is an
explicit operator action and delegates package changes to `dsh plugin`; runtime
code never writes Profile manifests. Stop the affected test server before
uninstall or rollback. All automated integration tests use disposable homes and
browser contexts and do not restart or modify the user's running DSH.

Code review and passing tests are not an independent security audit. Marketplace
source-update review should account for session permission changes and local HTTP
traffic; low-risk automatic approval must not be inferred from the UI appearance.
