# Nnote Electron Meeting Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows와 macOS에서 최대 2시간의 오프라인 회의를 안전하게 녹음하고 OpenAI 화자 분리 전사와 구조화 요약을 로컬에 저장하는 Electron 앱을 만든다.

**Architecture:** Electron Renderer는 React UI와 MediaRecorder만 담당하고, 타입이 지정된 Preload IPC를 통해 Main의 녹음 파일, SQLite, OS 자격 증명, OpenAI 처리 기능을 호출한다. Main은 별도 HTTP 포트를 열지 않으며 도메인 서비스와 인프라 어댑터를 분리해 테스트에서 파일시스템, Keyring, OpenAI를 대체할 수 있게 한다.

**Tech Stack:** Node.js 22.12+, Electron 43, electron-vite 5, React 19, TypeScript 7, Vitest 4, Playwright 1.61, better-sqlite3 12, Zod 4, OpenAI Node SDK 6, `@napi-rs/keyring`, fflate, electron-builder 26.

## Global Constraints

- 공식 지원 운영체제는 Windows와 macOS이며 Linux는 지원하지 않는다.
- 노트북 마이크로 녹음하는 오프라인 회의만 지원하고 탭 오디오와 외부 오디오 가져오기는 제외한다.
- 녹음 한도는 2시간이며 `audio/webm;codecs=opus`, 20~24kbps, 10초 청크를 사용한다.
- 실제 누적 크기 22MB에서 경고하고 24MB에서 안전하게 새 파트로 전환한다.
- PWA, localhost 서버, 회원가입, 클라우드 동기화, 실시간 전사, FFmpeg를 추가하지 않는다.
- Renderer는 Node.js, 파일시스템, SQLite, API 키에 직접 접근하지 않는다.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`를 유지한다.
- API 키는 Windows Credential Manager 또는 macOS Keychain에만 보관하며 DB, 로그, 내보내기에 포함하지 않는다.
- 전사는 `gpt-4o-transcribe-diarize`, `diarized_json`, `chunking_strategy: "auto"`를 사용한다.
- 요약은 `gpt-5-mini`와 구조화 출력을 사용한다.
- 화면 이동과 앱 종료는 삭제가 아니며 명시적인 폐기와 삭제만 파괴적 동작이다.
- 기본 원본 정책은 처리 성공 후 삭제이며 전사와 요약의 DB 커밋 전에는 삭제하지 않는다.
- 변경 작업은 실패 테스트, 최소 구현, 통과 테스트, 작은 Gitmoji 커밋 순서로 수행한다.

## File Structure

```text
package.json                         # scripts, dependencies, electron-builder config
electron.vite.config.ts              # main/preload/renderer build entry points
tsconfig.json                        # shared TypeScript rules
tsconfig.node.json                   # main/preload TypeScript rules
src/shared/contracts/                # IPC and domain types shared across processes
src/main/index.ts                    # Electron lifecycle and composition root
src/main/window/createMainWindow.ts  # secure BrowserWindow and permission policy
src/main/ipc/registerIpcHandlers.ts  # typed IPC registration only
src/main/db/                         # SQLite open, migrations, repositories
src/main/credentials/                # OS Keyring adapter
src/main/recording/                  # chunk persistence and recovery
src/main/ai/                         # OpenAI gateway, transcription, summary, orchestration
src/main/archive/                    # .nnote export/import
src/preload/index.ts                 # contextBridge implementation
src/renderer/src/                    # React application
src/renderer/src/features/recording/ # MediaRecorder controller and recording UI
src/renderer/src/features/meetings/  # dashboard and document detail
src/renderer/src/features/templates/ # template editor
src/renderer/src/features/settings/  # API key settings
tests/unit/                           # pure domain and service tests
tests/integration/                    # SQLite, IPC, filesystem integration tests
tests/e2e/                            # packaged Electron smoke and visual tests
```

---

### Task 1: Secure Electron Shell and Test Harness

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `src/main/index.ts`
- Create: `src/main/window/createMainWindow.ts`
- Create: `src/preload/index.ts`
- Create: `src/shared/contracts/desktopApi.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `tests/unit/window-security.test.ts`

**Interfaces:**
- Produces: `DesktopApi`, `createMainWindow()`, secure BrowserWindow defaults, Vitest scripts.
- Consumes: none.

- [ ] **Step 1: Create the package manifest and install the exact dependency set**

Create scripts `dev`, `build`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:e2e`, `lint`, `package:win`, and `package:mac`. Use npm overrides only if an audit or Electron ABI failure demonstrates a need.

Run:

```powershell
npm install react@19.2.7 react-dom@19.2.7 better-sqlite3@12.11.1 zod@4.4.3 openai@6.46.0 @napi-rs/keyring@1.3.0 fflate
npm install -D electron@43.1.0 electron-vite@5.0.0 typescript@7.0.2 vitest@4.1.10 @playwright/test@1.61.1 electron-builder@26.15.3 @vitejs/plugin-react@5.1.4 @types/react@19.2.14 @types/react-dom@19.2.3 @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom eslint
```

Expected: `npm install` exits 0 and `package-lock.json` is created.

- [ ] **Step 2: Write the failing BrowserWindow security test**

```ts
import { describe, expect, it } from 'vitest'
import { getWindowWebPreferences } from '../../src/main/window/createMainWindow'

describe('desktop window security', () => {
  it('isolates the renderer and disables Node integration', () => {
    expect(getWindowWebPreferences('/tmp/preload.js')).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: '/tmp/preload.js',
    })
  })
})
```

- [ ] **Step 3: Run the focused test and verify the expected failure**

Run: `npm run test:unit -- tests/unit/window-security.test.ts`

Expected: FAIL because `createMainWindow` does not exist.

- [ ] **Step 4: Implement the secure shell**

```ts
import type { BrowserWindowConstructorOptions } from 'electron'

export function getWindowWebPreferences(preload: string): NonNullable<BrowserWindowConstructorOptions['webPreferences']> {
  return { contextIsolation: true, nodeIntegration: false, sandbox: true, preload }
}
```

`createMainWindow()` must deny unexpected navigation with `will-navigate`, deny `setWindowOpenHandler`, and grant only `media` permission for the app's own renderer origin. `src/preload/index.ts` exposes an initially empty, frozen `DesktopApi`; later tasks extend this contract instead of adding untyped channels.

- [ ] **Step 5: Verify shell, types, and renderer smoke build**

Run:

```powershell
npm run test:unit -- tests/unit/window-security.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0 and `out/main`, `out/preload`, `out/renderer` exist.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json electron.vite.config.ts tsconfig*.json src tests/unit/window-security.test.ts
git commit -m "🏗️ build: scaffold secure Electron shell"
```

---

### Task 2: Domain Model, State Machine, and SQLite Repositories

**Files:**
- Create: `src/shared/contracts/meeting.ts`
- Create: `src/shared/contracts/template.ts`
- Create: `src/main/domain/meetingState.ts`
- Create: `src/main/db/database.ts`
- Create: `src/main/db/migrations.ts`
- Create: `src/main/db/meetingRepository.ts`
- Create: `src/main/db/templateRepository.ts`
- Create: `tests/unit/meeting-state.test.ts`
- Create: `tests/integration/meeting-repository.test.ts`

**Interfaces:**
- Produces: `MeetingStatus`, `Meeting`, `TranscriptSegment`, `Speaker`, `SummaryTemplate`, `assertMeetingTransition`, `MeetingRepository`, `TemplateRepository`.
- Consumes: Node filesystem path supplied by the composition root.

- [ ] **Step 1: Write paired failing state tests**

```ts
it('allows a recorded meeting to start transcription', () => {
  expect(() => assertMeetingTransition('recorded', 'transcribing')).not.toThrow()
})

it('does not treat navigation as a destructive meeting transition', () => {
  expect(() => assertMeetingTransition('recording', 'deleted')).toThrow(/explicit delete/i)
})
```

- [ ] **Step 2: Run the state tests and verify failure**

Run: `npm run test:unit -- tests/unit/meeting-state.test.ts`

Expected: FAIL because the domain state module is missing.

- [ ] **Step 3: Implement exact domain types and allowed transitions**

```ts
export type MeetingStatus =
  | 'draft' | 'recording' | 'recoverable' | 'recorded'
  | 'transcribing' | 'summarizing' | 'completed' | 'failed' | 'deleted'

const allowed: Record<MeetingStatus, readonly MeetingStatus[]> = {
  draft: ['recording', 'deleted'],
  recording: ['recorded', 'recoverable', 'deleted'],
  recoverable: ['recorded', 'recording', 'deleted'],
  recorded: ['transcribing', 'deleted'],
  transcribing: ['summarizing', 'failed'],
  summarizing: ['completed', 'failed'],
  completed: ['transcribing', 'deleted'],
  failed: ['transcribing', 'summarizing', 'deleted'],
  deleted: [],
}
```

`assertMeetingTransition` throws a typed `InvalidMeetingTransitionError`; attempts to reach `deleted` require `{ explicitDelete: true }`.

- [ ] **Step 4: Write the failing repository transaction test**

The integration test opens a temporary SQLite file, inserts a `recording` meeting, closes the database, reopens it, and asserts that status, byte count, and audio policy survive. A paired test rolls back an invalid transcript segment insert and asserts the meeting row remains unchanged.

- [ ] **Step 5: Implement migrations and repositories**

Migration 1 creates `meetings`, `recording_parts`, `transcript_segments`, `speakers`, `summary_sections`, `action_items`, `summary_templates`, and `processing_attempts`. Enable `foreign_keys`, `journal_mode = WAL`, and `busy_timeout = 5000`. Repository write methods use explicit transactions and return validated Zod domain objects.

- [ ] **Step 6: Run focused and full persistence tests**

Run:

```powershell
npm run test:unit -- tests/unit/meeting-state.test.ts
npm run test:integration -- tests/integration/meeting-repository.test.ts
```

Expected: PASS with no open-handle warning.

- [ ] **Step 7: Commit**

```powershell
git add src/shared/contracts src/main/domain src/main/db tests/unit/meeting-state.test.ts tests/integration/meeting-repository.test.ts
git commit -m "🗃️ feat: add meeting domain and local database"
```

---

### Task 3: OS Credential Store and API Key Settings

**Files:**
- Create: `src/main/credentials/credentialStore.ts`
- Create: `src/main/credentials/keyringCredentialStore.ts`
- Create: `src/main/ai/openAiKeyValidator.ts`
- Create: `src/shared/contracts/settings.ts`
- Modify: `src/shared/contracts/desktopApi.ts`
- Modify: `src/preload/index.ts`
- Create: `src/main/ipc/registerSettingsHandlers.ts`
- Create: `src/renderer/src/features/settings/ApiKeySettings.tsx`
- Create: `tests/unit/credential-store.test.ts`
- Create: `tests/unit/api-key-settings.test.tsx`

**Interfaces:**
- Produces: `CredentialStore.get/set/delete`, `OpenAiKeyValidator.validate`, `DesktopApi.settings`.
- Consumes: `@napi-rs/keyring.Entry`, OpenAI SDK client factory.

- [ ] **Step 1: Write failing credential behavior tests**

```ts
it('stores and deletes the OpenAI key through the credential port', async () => {
  const store = new MemoryCredentialStore()
  await store.set('sk-test')
  expect(await store.get()).toBe('sk-test')
  await store.delete()
  expect(await store.get()).toBeNull()
})

it('never exposes the saved key through the desktop API', () => {
  expect(Object.keys(api.settings)).not.toContain('getApiKey')
})
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- tests/unit/credential-store.test.ts tests/unit/api-key-settings.test.tsx`

Expected: FAIL because credential and settings modules are missing.

- [ ] **Step 3: Implement the credential boundary**

```ts
export interface CredentialStore {
  get(): Promise<string | null>
  set(value: string): Promise<void>
  delete(): Promise<void>
}

export class KeyringCredentialStore implements CredentialStore {
  private readonly entry = new Entry('Nnote', 'openai-api-key')
  async get() { return this.entry.getPassword() ?? null }
  async set(value: string) { this.entry.setPassword(value) }
  async delete() { this.entry.deletePassword() }
}
```

Map a missing Keyring item to `null`. Do not log the value or include it in thrown error metadata.

- [ ] **Step 4: Implement save, validate, and delete IPC**

`settings.saveApiKey(value)` validates the `sk-` prefix locally, performs one minimal authenticated model-list request, and stores only on success. `settings.getApiKeyStatus()` returns `{ configured: boolean, lastValidatedAt: string | null }`. `settings.deleteApiKey()` deletes the Keyring entry.

- [ ] **Step 5: Run tests and a manual OS-store smoke check**

Run: `npm run test:unit -- tests/unit/credential-store.test.ts tests/unit/api-key-settings.test.tsx`

Expected: PASS. On Windows, save and delete a test key and verify it appears only in Credential Manager; repeat with Keychain on macOS during platform verification.

- [ ] **Step 6: Commit**

```powershell
git add src/main/credentials src/main/ai/openAiKeyValidator.ts src/main/ipc/registerSettingsHandlers.ts src/shared/contracts src/preload src/renderer/src/features/settings tests/unit
git commit -m "🔐 feat: secure OpenAI credentials in the OS keyring"
```

---

### Task 4: Crash-Safe Recording Persistence

**Files:**
- Create: `src/main/recording/recordingTypes.ts`
- Create: `src/main/recording/recordingPaths.ts`
- Create: `src/main/recording/recordingService.ts`
- Create: `src/main/recording/sessionManifest.ts`
- Create: `tests/unit/recording-size-policy.test.ts`
- Create: `tests/integration/recording-service.test.ts`

**Interfaces:**
- Produces: `RecordingService.start`, `appendChunk`, `pause`, `resume`, `stop`, `discard`; `RecordingProgress`.
- Consumes: `MeetingRepository`, recordings directory path, ordered byte chunks.

- [ ] **Step 1: Write paired size-policy tests**

```ts
it('warns at 22 MiB without rolling the part', () => {
  expect(evaluateRecordingSize(22 * 1024 * 1024)).toEqual({ warn: true, rollPart: false })
})

it('rolls at 24 MiB without deleting completed bytes', () => {
  expect(evaluateRecordingSize(24 * 1024 * 1024)).toEqual({ warn: true, rollPart: true })
})
```

- [ ] **Step 2: Verify size tests fail, then implement the pure policy**

Run: `npm run test:unit -- tests/unit/recording-size-policy.test.ts`

Expected before implementation: FAIL. Implement byte constants with `1024 * 1024`, rerun, and expect PASS.

- [ ] **Step 3: Write failing recording integration tests**

Cover these exact cases:

- ordered chunks append and survive service reopen;
- duplicate chunk index is idempotent;
- skipped chunk index is rejected;
- `stop` renames `.webm.part` to `.webm` and marks `recorded`;
- explicit `discard` deletes files;
- `pause`, navigation, and service close keep files.

- [ ] **Step 4: Implement atomic manifest and chunk append**

```ts
export interface AppendChunkInput {
  meetingId: string
  partIndex: number
  chunkIndex: number
  durationMs: number
  bytes: Uint8Array
}

export interface RecordingProgress {
  totalBytes: number
  durationMs: number
  warn: boolean
  rolledToPartIndex: number | null
}
```

Append bytes using one file handle per active part, call `sync()` after each chunk, write the manifest to a sibling temporary JSON file, then atomically rename it. Commit DB byte count and manifest index only after file sync succeeds.

- [ ] **Step 5: Run recording tests**

Run: `npm run test:integration -- tests/integration/recording-service.test.ts`

Expected: PASS including the explicit-delete versus non-destructive-close pair.

- [ ] **Step 6: Commit**

```powershell
git add src/main/recording tests/unit/recording-size-policy.test.ts tests/integration/recording-service.test.ts
git commit -m "💾 feat: persist recording chunks safely"
```

---

### Task 5: MediaRecorder Controller and Typed Recording IPC

**Files:**
- Create: `src/shared/contracts/recording.ts`
- Create: `src/main/ipc/registerRecordingHandlers.ts`
- Modify: `src/shared/contracts/desktopApi.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/features/recording/mediaRecorderController.ts`
- Create: `src/renderer/src/features/recording/RecordingPanel.tsx`
- Create: `tests/unit/media-recorder-controller.test.ts`
- Create: `tests/unit/recording-panel.test.tsx`

**Interfaces:**
- Produces: `MediaRecorderController`, `DesktopApi.recording`, `RecordingPanel`.
- Consumes: Task 4 `RecordingService` and Task 1 typed IPC bridge.

- [ ] **Step 1: Write a failing controller test with a fake MediaRecorder**

The fake emits two `dataavailable` events. Assert `appendChunk` receives indices 0 and 1, MIME `audio/webm;codecs=opus`, and that `stop()` waits for the final event before calling Main `stop`.

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- tests/unit/media-recorder-controller.test.ts`

Expected: FAIL because the controller is missing.

- [ ] **Step 3: Implement the controller**

```ts
const MIME_TYPE = 'audio/webm;codecs=opus'
const TIMESLICE_MS = 10_000
const AUDIO_BITS_PER_SECOND = 20_000

const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
})
const recorder = new MediaRecorder(stream, {
  mimeType: MIME_TYPE,
  audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
})
recorder.start(TIMESLICE_MS)
```

Convert each Blob with `arrayBuffer()`, send a copied `Uint8Array` through IPC, and serialize sends with a promise chain so chunk order cannot change. Stop all media tracks after the final chunk is acknowledged.

- [ ] **Step 4: Write and implement paired UI behavior tests**

Assert `종료` commits the meeting. Assert route navigation only changes the screen and never calls `discard`. The destructive `폐기` button opens a confirmation dialog and calls `discard` only after confirmation.

- [ ] **Step 5: Run focused tests and renderer typecheck**

Run:

```powershell
npm run test:unit -- tests/unit/media-recorder-controller.test.ts tests/unit/recording-panel.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/shared/contracts src/main/ipc/registerRecordingHandlers.ts src/preload src/renderer/src/features/recording tests/unit
git commit -m "🎙️ feat: add desktop meeting recorder controls"
```

---

### Task 6: Startup Recovery Workflow

**Files:**
- Create: `src/main/recording/recoveryService.ts`
- Create: `src/main/ipc/registerRecoveryHandlers.ts`
- Modify: `src/shared/contracts/desktopApi.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/features/recording/RecoveryDialog.tsx`
- Create: `tests/integration/recovery-service.test.ts`
- Create: `tests/unit/recovery-dialog.test.tsx`

**Interfaces:**
- Produces: `RecoveryService.scan`, `recover`, `keepAsFile`, `discard`; `DesktopApi.recovery`.
- Consumes: Task 4 manifests and Task 2 repositories.

- [ ] **Step 1: Write paired recovery tests**

Create a `recording` row and `.part` file, reopen the app services, and assert it becomes `recoverable`. In the paired test, create a normal `recorded` meeting and assert scanning leaves its status and file unchanged.

- [ ] **Step 2: Verify integration failure**

Run: `npm run test:integration -- tests/integration/recovery-service.test.ts`

Expected: FAIL because `RecoveryService` is missing.

- [ ] **Step 3: Implement recovery decisions**

`recover` reopens the last part for append only when manifest and file byte counts agree. `keepAsFile` finalizes the current bytes and marks `recorded`. `discard` requires `explicitDelete: true`. A corrupt manifest preserves the `.part` file and returns a user-visible `exportOnly` recovery option.

- [ ] **Step 4: Implement the blocking startup dialog**

Show each recoverable meeting with timestamp, duration, and byte count. Disable normal recording start until the user selects `복구`, `현재 파일로 보관`, or `폐기`; only `폐기` uses destructive styling and confirmation.

- [ ] **Step 5: Run recovery tests**

Run:

```powershell
npm run test:integration -- tests/integration/recovery-service.test.ts
npm run test:unit -- tests/unit/recovery-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/main/recording/recoveryService.ts src/main/ipc/registerRecoveryHandlers.ts src/shared/contracts src/preload src/renderer/src/features/recording/RecoveryDialog.tsx tests
git commit -m "🛟 feat: recover interrupted recordings"
```

---

### Task 7: OpenAI Speaker-Diarized Transcription

**Files:**
- Create: `src/main/ai/openAiGateway.ts`
- Create: `src/main/ai/transcriptionService.ts`
- Create: `src/main/ai/openAiErrors.ts`
- Create: `src/main/ai/redactSecrets.ts`
- Create: `tests/unit/transcription-service.test.ts`
- Create: `tests/unit/redact-secrets.test.ts`

**Interfaces:**
- Produces: `OpenAiGateway.transcribe`, `TranscriptionService.transcribeMeeting`, normalized `TranscriptSegment[]` and `Speaker[]`.
- Consumes: Task 3 `CredentialStore`, Task 2 repositories, finalized WebM part paths.

- [ ] **Step 1: Write the failing request-shape test**

```ts
it('requests diarized JSON with automatic chunking', async () => {
  await service.transcribeMeeting(meetingId)
  expect(gateway.requests[0]).toMatchObject({
    model: 'gpt-4o-transcribe-diarize',
    responseFormat: 'diarized_json',
    chunkingStrategy: 'auto',
  })
})
```

- [ ] **Step 2: Write the nearest non-change test**

When transcription returns an error, assert the meeting audio path, bytes, and existing summary remain unchanged; only status, failed stage, and redacted error change.

- [ ] **Step 3: Verify failure and implement the gateway adapter**

Run: `npm run test:unit -- tests/unit/transcription-service.test.ts`

Expected before implementation: FAIL. Implement the SDK adapter in Main only:

```ts
const response = await client.audio.transcriptions.create({
  file: createReadStream(path),
  model: 'gpt-4o-transcribe-diarize',
  response_format: 'diarized_json',
  chunking_strategy: 'auto',
})
```

Validate every returned segment with Zod and assign internal IDs as `<part-index>:<provider-speaker>`.

- [ ] **Step 4: Implement secret redaction and typed errors**

Redact `Authorization`, strings matching `sk-` plus non-whitespace characters, and local absolute recording paths. Map 401, 429, network timeout, invalid audio, and unknown failures to stable UI error codes.

- [ ] **Step 5: Run transcription and redaction tests**

Run: `npm run test:unit -- tests/unit/transcription-service.test.ts tests/unit/redact-secrets.test.ts`

Expected: PASS and snapshots contain no API key or absolute path.

- [ ] **Step 6: Commit**

```powershell
git add src/main/ai tests/unit/transcription-service.test.ts tests/unit/redact-secrets.test.ts
git commit -m "🗣️ feat: transcribe meetings with speaker diarization"
```

---

### Task 8: Summary Templates and Structured Summaries

**Files:**
- Create: `src/main/templates/defaultTemplate.ts`
- Create: `src/main/templates/templateService.ts`
- Create: `src/main/ai/summarySchema.ts`
- Create: `src/main/ai/summaryService.ts`
- Create: `src/main/ipc/registerTemplateHandlers.ts`
- Modify: `src/shared/contracts/desktopApi.ts`
- Create: `src/renderer/src/features/templates/TemplateEditor.tsx`
- Create: `tests/unit/template-service.test.ts`
- Create: `tests/unit/summary-service.test.ts`

**Interfaces:**
- Produces: immutable default template, CRUD for user templates, `SummaryService.summarizeMeeting`.
- Consumes: Task 2 template and meeting repositories, Task 7 gateway base client.

- [ ] **Step 1: Write paired template tests**

Assert a user template can be created, renamed, reordered, and deleted. Assert deleting or modifying the default template throws `ImmutableDefaultTemplateError` and leaves it unchanged.

- [ ] **Step 2: Verify template test failure**

Run: `npm run test:unit -- tests/unit/template-service.test.ts`

Expected: FAIL because template services are missing.

- [ ] **Step 3: Implement template rules**

Allowed section kinds are `paragraph`, `bullet_list`, and `action_items`. Require a non-empty name, one to eight sections, stable UUID section IDs, and prompts between 1 and 2,000 characters. Seed the ordered default sections: 핵심 요약, 결정사항, 할 일, 주요 논의.

- [ ] **Step 4: Write the failing structured-summary test**

Use a transcript with speakers `0:A` and `0:B`. Return an action assigned to `0:B`, rename that speaker to `홍길동`, and assert rendered output changes to `홍길동` while the stored transcript segment text and timestamps remain byte-for-byte equal.

- [ ] **Step 5: Implement summary generation**

Call `gpt-5-mini` through the Responses API with a strict JSON schema containing `sections[]`, `actionItems[]`, and only known internal speaker IDs. Reject unknown IDs and malformed section IDs before committing the summary transaction.

- [ ] **Step 6: Run template and summary tests**

Run: `npm run test:unit -- tests/unit/template-service.test.ts tests/unit/summary-service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/main/templates src/main/ai/summarySchema.ts src/main/ai/summaryService.ts src/main/ipc/registerTemplateHandlers.ts src/shared/contracts src/renderer/src/features/templates tests/unit
git commit -m "🧩 feat: add reusable structured summary templates"
```

---

### Task 9: Processing Orchestration, Retry, and Audio Retention

**Files:**
- Create: `src/main/ai/processingService.ts`
- Create: `src/main/ipc/registerProcessingHandlers.ts`
- Modify: `src/shared/contracts/desktopApi.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/src/features/meetings/ProcessingStatus.tsx`
- Create: `tests/integration/processing-service.test.ts`
- Create: `tests/unit/processing-status.test.tsx`

**Interfaces:**
- Produces: `ProcessingService.process`, `retry`, processing progress events.
- Consumes: Tasks 2, 7, and 8 repositories and AI services; Task 4 audio paths.

- [ ] **Step 1: Write paired audio-retention tests**

```ts
it('deletes audio only after transcript and summary commit', async () => {
  await service.process(deleteAfterProcessingMeeting)
  expect(files.exists(audioPath)).toBe(false)
})

it('keeps audio after success when policy is keep', async () => {
  await service.process(keepMeeting)
  expect(files.exists(audioPath)).toBe(true)
})
```

Add a third failure test: summary persistence throws, audio remains, transcript remains, and retry starts at `summarizing` without calling transcription again.

- [ ] **Step 2: Verify failure**

Run: `npm run test:integration -- tests/integration/processing-service.test.ts`

Expected: FAIL because the orchestration service is missing.

- [ ] **Step 3: Implement stage-aware orchestration**

Persist a processing attempt before each external request. Commit transcript before entering `summarizing`. Commit summary and status `completed` in one transaction. Delete audio only after that transaction returns successfully and only for `delete_after_processing`.

- [ ] **Step 4: Implement progress IPC and retry UI**

Expose `transcribing`, `summarizing`, `completed`, and typed failure states. Disable duplicate process starts for the same meeting. The retry action calls the saved failed stage and displays whether the original audio is required.

- [ ] **Step 5: Run orchestration tests**

Run:

```powershell
npm run test:integration -- tests/integration/processing-service.test.ts
npm run test:unit -- tests/unit/processing-status.test.tsx
```

Expected: PASS with transcription call count unchanged during summary retry.

- [ ] **Step 6: Commit**

```powershell
git add src/main/ai/processingService.ts src/main/ipc/registerProcessingHandlers.ts src/shared/contracts src/preload src/renderer/src/features/meetings/ProcessingStatus.tsx tests
git commit -m "🔁 feat: orchestrate retryable AI processing"
```

---

### Task 10: Dashboard and Single-Document Meeting Detail

**Files:**
- Create: `src/renderer/src/styles/tokens.css`
- Create: `src/renderer/src/styles/app.css`
- Create: `src/renderer/src/features/meetings/Dashboard.tsx`
- Create: `src/renderer/src/features/meetings/MeetingDetail.tsx`
- Create: `src/renderer/src/features/meetings/SpeakerEditor.tsx`
- Create: `src/renderer/src/features/meetings/Transcript.tsx`
- Create: `src/main/media/registerMediaProtocol.ts`
- Create: `src/main/ipc/registerMeetingHandlers.ts`
- Modify: `src/shared/contracts/desktopApi.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/App.tsx`
- Create: `tests/unit/dashboard.test.tsx`
- Create: `tests/unit/meeting-detail.test.tsx`
- Create: `tests/integration/media-protocol.test.ts`

**Interfaces:**
- Produces: balanced dashboard, recording entry, recent meetings, document detail, speaker rename, validated local audio playback.
- Consumes: Tasks 2, 5, 8, and 9 APIs.

- [ ] **Step 1: Write the failing dashboard test**

Render one completed meeting and one failed meeting. Assert the left side contains `녹음 시작`, the right side lists both records with their exact statuses, and selecting a row opens the detail without starting or discarding a recording.

- [ ] **Step 2: Write the paired speaker rename tests**

Assert renaming `0:B` updates summary and action-owner display plus Markdown preview. Assert segment text, start, and end values passed to the Transcript component do not change.

- [ ] **Step 3: Verify UI tests fail**

Run: `npm run test:unit -- tests/unit/dashboard.test.tsx tests/unit/meeting-detail.test.tsx`

Expected: FAIL because the screens are missing.

- [ ] **Step 4: Implement the approved layouts**

Dashboard uses a two-column main area: new-meeting recorder on the left and recent records on the right, with top navigation for all records, templates, and settings. Meeting detail is one vertical document ordered as title/player, 핵심 요약, 결정사항, 할 일, 주요 논의, 화자 이름, full timestamped transcript.

- [ ] **Step 5: Implement local playback without exposing file paths**

Register `nnote-media` as a privileged streaming scheme before `app.ready`. Handle only URLs shaped as `nnote-media://meeting/<meeting-id>`, resolve the file through `MeetingRepository`, reject deleted or missing audio, and support HTTP byte ranges for the native audio element. Never accept a path, drive letter, or relative segment from Renderer input. Integration tests assert a retained meeting returns audio bytes, a deleted-audio meeting returns 404, and `nnote-media://meeting/../settings` is rejected.

- [ ] **Step 6: Add visible-state regression coverage**

Create component screenshots for idle dashboard, active recording, completed detail, failed processing, and recoverable recording. Name snapshots after visible outcomes, for example `dashboard-shows-record-and-recent-meetings` and `meeting-detail-shows-renamed-speaker-everywhere`.

- [ ] **Step 7: Run UI, playback, and accessibility checks**

Run:

```powershell
npm run test:unit -- tests/unit/dashboard.test.tsx tests/unit/meeting-detail.test.tsx
npm run test:integration -- tests/integration/media-protocol.test.ts
npm run typecheck
```

Expected: PASS with no React act warning.

- [ ] **Step 8: Commit**

```powershell
git add src/renderer src/main/media src/main/ipc/registerMeetingHandlers.ts src/shared/contracts src/preload tests/unit tests/integration/media-protocol.test.ts
git commit -m "✨ feat: build the Nnote meeting workspace"
```

---

### Task 11: Versioned `.nnote` Export and Import

**Files:**
- Create: `src/main/archive/archiveSchema.ts`
- Create: `src/main/archive/exportMeeting.ts`
- Create: `src/main/archive/importMeeting.ts`
- Create: `src/main/archive/exportMarkdown.ts`
- Create: `src/main/ipc/registerArchiveHandlers.ts`
- Modify: `src/shared/contracts/desktopApi.ts`
- Modify: `src/preload/index.ts`
- Create: `tests/integration/archive-roundtrip.test.ts`
- Create: `tests/unit/archive-validation.test.ts`
- Create: `tests/unit/markdown-export.test.ts`

**Interfaces:**
- Produces: `.nnote` ZIP version 1 export/import and current-display-name Markdown export.
- Consumes: meeting repositories, optional retained audio path, Electron save/open dialogs.

- [ ] **Step 1: Write the failing cross-platform round-trip test**

Export a meeting with transcript, summary, renamed speakers, custom template reference, and retained WebM. Import into an empty temporary database and assert a new meeting ID, identical semantic content, relative audio location, and no API key or absolute path in the archive.

- [ ] **Step 2: Write malicious archive validation tests**

Reject `../` paths, absolute paths, duplicate manifest entries, unsupported versions, malformed JSON, declared sizes that exceed 100MB, and more than one audio file. Assert rejection writes no DB rows and no files.

- [ ] **Step 3: Write the Markdown export regression test**

Create a completed meeting, rename speaker `0:B` to `홍길동`, export Markdown, and assert the title, ordered summary sections, action owner `홍길동`, timestamps, and transcript are present. Assert provider label `0:B`, API key text, absolute audio path, and processing error metadata are absent.

- [ ] **Step 4: Verify failure**

Run: `npm run test:integration -- tests/integration/archive-roundtrip.test.ts && npm run test:unit -- tests/unit/archive-validation.test.ts tests/unit/markdown-export.test.ts`

Expected: FAIL because archive modules are missing.

- [ ] **Step 5: Implement the archive and Markdown formats**

Version 1 contains `manifest.json`, `meeting.json`, `transcript.json`, `summary.json`, and optional `audio.webm`. Use fflate with stored compression for WebM. Validate all entries in memory before writing to the database, then copy audio and commit imported rows in one coordinated operation with cleanup on failure.

`exportMarkdown` resolves every internal speaker ID through the current `Speaker` mapping at export time and renders the approved single-document order. Save through an Electron save dialog; the Renderer receives success, cancel, or typed failure but never the local source paths.

- [ ] **Step 6: Run archive tests**

Run: `npm run test:integration -- tests/integration/archive-roundtrip.test.ts && npm run test:unit -- tests/unit/archive-validation.test.ts tests/unit/markdown-export.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/main/archive src/main/ipc/registerArchiveHandlers.ts src/shared/contracts src/preload tests
git commit -m "📦 feat: export and import Nnote meetings"
```

---

### Task 12: Packaging, Electron E2E, and Platform Verification

**Files:**
- Modify: `package.json`
- Create: `build/entitlements.mac.plist`
- Create: `build/icons/icon.ico`
- Create: `build/icons/icon.icns`
- Create: `tests/e2e/app.spec.ts`
- Create: `tests/e2e/fixtures/fake-audio.wav`
- Create: `scripts/verify-package.mjs`
- Create: `README.md`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: Windows NSIS installer, macOS DMG, CI checks, installation documentation.
- Consumes: complete application from Tasks 1–11.

- [ ] **Step 1: Write the failing Electron launch test**

Use Playwright `_electron.launch` against the built Main entry. Assert one window opens, title is `Nnote`, `window.require` is unavailable, the dashboard is visible, and a fake meeting can be created through test-only injected service ports without a real OpenAI call.

- [ ] **Step 2: Verify E2E failure**

Run: `npm run build && npm run test:e2e -- tests/e2e/app.spec.ts`

Expected: FAIL until packaging paths and test composition are configured.

- [ ] **Step 3: Configure electron-builder**

Set `appId` to `com.jdeploys.nnote`, product name `Nnote`, Windows target `nsis`, macOS target `dmg`, and rebuild native dependencies for the Electron ABI. Include only `out`, migrations, package metadata, and required native modules. Do not include recordings, development keys, fixtures, or source maps in release artifacts.

- [ ] **Step 4: Add CI without pretending to sign releases**

Run unit, integration, typecheck, build, and Electron smoke tests on `windows-latest` and `macos-latest`. Build unsigned test artifacts in CI. Document that public signed distribution requires a Windows code-signing certificate and Apple Developer ID/notarization credentials; local development and tests must not depend on those credentials.

- [ ] **Step 5: Add the platform verification script**

`scripts/verify-package.mjs` launches the packaged app with a temporary `userData` directory and checks the Main entry, preload bundle, SQLite native module load, Keyring native module load, and renderer asset existence. It exits nonzero with the failing component name.

- [ ] **Step 6: Run the full automated gate**

Run:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
npm run package:win
node scripts/verify-package.mjs dist/win-unpacked
```

Expected on Windows: every command exits 0, the unpacked app launches, and no secret or user recording is present in `dist`. On macOS run the equivalent `npm run package:mac` and verification against the `.app` bundle.

- [ ] **Step 7: Perform the manual two-hour acceptance matrix**

On both Windows and macOS verify: two-hour recording, actual size below the processing boundary or safe part rollover, forced app termination and recovery, microphone denial and recovery, network failure and retry, API key save/replace/delete, `delete_after_processing` and `keep`, and Windows-to-Mac plus Mac-to-Windows `.nnote` round trips. Record exact app version, OS version, duration, bytes, and result in the release notes.

- [ ] **Step 8: Commit**

```powershell
git add package.json build tests/e2e scripts README.md .github/workflows/ci.yml
git commit -m "🚀 build: package and verify Nnote on desktop"
```

---

## Final Verification

- [ ] Run `git diff --check` and confirm no whitespace errors.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, and `npm run test:e2e`.
- [ ] Inspect `git status --short` and account for every changed file.
- [ ] Confirm no API key, Authorization header, absolute recording path, `.webm`, `.nnote`, SQLite database, or Keyring dump is tracked by Git.
- [ ] Confirm the paired regression tests named in Tasks 2, 4, 7, 8, 9, and 10 pass.
- [ ] Review the final diff against `docs/superpowers/specs/2026-07-14-nnote-electron-meeting-recorder-design.md` and remove any PWA, cloud, login, real-time transcription, external import, FFmpeg, or Linux scope leakage.
