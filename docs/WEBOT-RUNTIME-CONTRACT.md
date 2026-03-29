# WeFlow Runtime Contract (webot)

This document records the minimal runtime-facing patch set added by the `webot-runtime` fork.

## Goals

- Keep upstream WeFlow core logic intact as much as possible.
- Avoid rewriting existing `dbPathService`, `keyService`, `wcdbService`, `chatService`, or renderer logic.
- Expose a small local runtime contract so an external app client can:
  - launch WeFlow in background mode
  - detect setup state
  - reuse WeFlow's built-in local bootstrap capabilities
  - embed and ship a stable WeFlow runtime

## Non-goals

- Do not move business/product logic into this fork.
- Do not turn WeFlow into the app client's UI shell.
- Do not replace existing onboarding logic internally.

## Launch contract

Supported CLI flags:

```bash
--hidden-backend
--http-api-autostart
--http-api-port=5031
--integration-token=xxxx
--config-root=/path/to/config
--user-data-path=/path/to/userData
```

Supported environment variables:

```bash
WEFLOW_HIDDEN_BACKEND=1
WEFLOW_HTTP_API_AUTOSTART=1
WEFLOW_HTTP_API_PORT=5031
WEFLOW_INTEGRATION_TOKEN=xxxx
WEFLOW_CONFIG_CWD=/path/to/config
WEFLOW_USER_DATA_PATH=/path/to/userData
```

## Hidden backend mode

When `--hidden-backend` is enabled:

- Splash window is skipped.
- Main window is not created.
- Onboarding window is not created.
- Tray is not created.
- The local HTTP API is started automatically.
- Runtime/bootstrap endpoints are registered for the external app client.
- Existing SSE message push plumbing remains available when WeFlow's own `messagePushEnabled` is turned on.

## Runtime status endpoint

The runtime exposes:

```http
GET /api/v1/runtime/status
```

Example response:

```json
{
  "success": true,
  "mode": "hidden-backend",
  "httpApiRunning": true,
  "httpApiPort": 5031,
  "httpApiEnabled": true,
  "httpApiHost": "127.0.0.1",
  "httpApiTokenConfigured": true,
  "messagePushEnabled": true,
  "integrationTokenConfigured": true,
  "configRoot": "C:\\path\\to\\config",
  "userDataPath": "C:\\path\\to\\userData",
  "setupComplete": false,
  "hasDbPath": true,
  "hasWxid": true,
  "hasDecryptKey": false,
  "onboardingDone": false,
  "reason": "setup_incomplete"
}
```

## Bootstrap endpoints

These endpoints intentionally wrap existing WeFlow capabilities instead of replacing them.

### 1. Auto detect DB path

```http
POST /api/v1/bootstrap/auto-detect-db-path
```

Wraps `dbPathService.autoDetect()`.

### 2. Scan wxids

```http
POST /api/v1/bootstrap/scan-wxids
Content-Type: application/json
Authorization: Bearer <integration-token>

{
  "rootPath": "C:\\Users\\xxx\\Documents\\xwechat_files"
}
```

Wraps `dbPathService.scanWxids(rootPath)`.

### 3. Scan wxid candidates

```http
POST /api/v1/bootstrap/scan-wxid-candidates
```

Wraps `dbPathService.scanWxidCandidates(rootPath)`.

### 4. Auto get DB key

```http
POST /api/v1/bootstrap/auto-get-db-key
```

Hidden-backend bootstrap now defaults to a **bootstrap wrapper** around the existing key logic:

- locate installed WeChat
- close running WeChat
- relaunch WeChat
- wait for login/main window readiness
- try candidate WeChat PIDs until the db key is acquired

Default behavior is equivalent to:

```json
{
  "restartWeChat": true
}
```

If a future caller explicitly wants the old in-process-only behavior, it can send:

```json
{
  "restartWeChat": false
}
```

That fallback path still wraps `keyService.autoGetDbKey()`.

### 5. Auto get image key

```http
POST /api/v1/bootstrap/auto-get-image-key
```

Wraps `keyService.autoGetImageKey(manualDir, ..., wxid)`.

### 6. Test connection

```http
POST /api/v1/bootstrap/test-connection
```

Wraps `wcdbService.testConnection(dbPath, hexKey, wxid)`.

### 7. Seed config

```http
POST /api/v1/bootstrap/seed-config
```

Stores a minimal working runtime state by writing through `ConfigService` only.

This does **not** replace WeFlow config internals. It only injects already-confirmed values:

- `dbPath`
- `decryptKey`
- `myWxid`
- `onboardingDone`
- optional `httpApiEnabled`
- optional `httpApiPort`
- optional `httpApiHost`
- optional `httpApiToken`
- optional `messagePushEnabled`
- optional `imageXorKey`
- optional `imageAesKey`

## Auth model

Runtime/bootstrap endpoints use a separate local integration token:

```http
Authorization: Bearer <integration-token>
```

If no integration token is supplied at launch, these endpoints stay open on loopback for local development. Production launchers should always pass a random integration token.

## Build/runtime packaging

This fork adds:

```bash
npm run build:runtime
npm run verify:runtime
```

`build:runtime` emits a directory runtime under:

```text
release-runtime/
```

This is the artifact intended for embedding into the future `webot` client.

## App client integration guidance

The app client should **not** rewrite local bootstrap logic first.

Recommended setup flow:

1. Launch WeFlow with `--hidden-backend --http-api-autostart`.
2. Call `/api/v1/runtime/status`.
3. If `setupComplete=false`, call the bootstrap endpoints.
4. After a successful `/seed-config`, call `/api/v1/runtime/status` again.
5. When `setupComplete=true`, continue with message listening and automation.

This keeps:

- local machine-specific path/key logic inside WeFlow
- product/business logic inside the external app client + server
- upstream sync cost lower

## SSE support

Upstream WeFlow already exposes SSE at:

```http
GET /api/v1/push/messages
```

This patch does **not** remove or rewrite that path.

Current expectation:

- If `messagePushEnabled=true` in WeFlow config, the SSE stream remains usable.
- Hidden backend mode still starts `messagePushService`, so background launches can also emit SSE events.
- The future app client can choose between:
  - SSE (`/api/v1/push/messages`) for push-based listening
  - polling (`/api/v1/sessions`, `/api/v1/messages`) as a fallback path

Important auth note:

- `/api/v1/runtime/status` and `/api/v1/bootstrap/*` use the **integration token**.
- `/api/v1/push/messages` still follows WeFlow's **normal HTTP API auth model** (`httpApiToken` / `Authorization: Bearer ...`) when configured.

Recommended client strategy:

1. Prefer SSE when available and healthy.
2. Fall back to polling when SSE is disabled, unavailable, or unstable.

## Patch close-out status

This patch round should be treated as **documented and usable as a first runtime contract**, but **not fully closed** yet.

What is already in place:

- hidden backend launch mode
- config/userData path override
- runtime status API
- bootstrap wrapper APIs
- bootstrap db-key wrapper now matches the older “close/reopen WeChat before grabbing key” behavior used in the customized branch
- background HTTP API autostart
- hidden backend startup still wiring `messagePushService`

What still needs a later completion pass:

- single-instance / second-instance forwarding for hidden backend launches
- more explicit runtime exit codes / failure taxonomy
- runtime smoke-test script that launches the built runtime and probes health endpoints
- Windows real-machine validation against live WeChat login / message arrival

## Open follow-up items

The current patch intentionally stops after the minimum runtime contract. These items are still pending for a later pass:

1. Single-instance / second-instance forwarding for hidden backend launches.
2. More explicit runtime exit codes / failure taxonomy.
3. Runtime smoke-test script that launches the built runtime and probes health endpoints.
4. Windows real-machine validation against live WeChat login / message arrival.
5. Bootstrap-driven SSE enablement has been added at the config-write level, but still needs full Windows real-machine validation.
