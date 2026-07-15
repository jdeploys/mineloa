# Configurable Processing Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep OpenAI as Nnote's default processing path while adding independently selectable local Whisper transcription and Codex CLI summary through small provider adapters.

**Architecture:** Persist provider IDs in one SQLite settings record, resolve them through one main-process registry, and inject stable transcription and summary ports into orchestration. Package signed platform helpers, manage verified model data separately, and keep every provider-specific process and error behind its adapter.

**Tech Stack:** Electron 43, TypeScript 7, React 19, Vitest, better-sqlite3, Node child processes, whisper.cpp v1.9.1, FFmpeg n8.1.2, electron-builder

## Global Constraints

- `openai` remains the default for transcription and summary.
- Provider-specific behavior must not be implemented through repeated `if`/`else` or `switch` branches across services, IPC, or renderer components.
- `TranscriptionProvider` and `SummaryProvider` plus one registry are the only provider abstractions.
- Nnote never silently falls back to another provider.
- Provider failures preserve source audio, existing transcript, existing summary, and processing state semantics.
- Local Whisper does not promise Korean speaker diarization and stores `speakerId: null`.
- Codex CLI summary is cloud processing through the user's authenticated Codex account.
- Helpers are bundled and signed; executable code is never downloaded after installation.
- Downloaded model data is activated only after pinned SHA-256 verification.
- Every visible UI state receives a named regression test and a final screenshot.

---

### Task 1: Persist schema-validated provider settings

**Files:**
- Create: `src/main/settings/processingSettingsRepository.ts`
- Create: `tests/integration/processing-settings-repository.test.ts`
- Modify: `src/shared/contracts/settings.ts`
- Modify: `src/main/db/migrations.ts`
- Modify: `src/main/ipc/registerSettingsHandlers.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/unit/api-key-settings.test.tsx`
- Test: `tests/integration/migration-v2.test.ts`

**Interfaces:**
- Produces `ProcessingProviderSettings`, `ProcessingProviderSettingsSchema`, and `ProcessingSettingsRepository.get()/update()`.
- Extends `SettingsApi` with `getProcessingProviders()` and `updateProcessingProviders(input)`.

- [ ] **Step 1: Add failing migration and repository tests**

```ts
it('defaults existing databases to OpenAI providers without changing existing rows', () => {
  const database = openDatabase(path)
  const settings = new ProcessingSettingsRepository(database)
  expect(settings.get()).toEqual({ transcriptionProvider: 'openai', summaryProvider: 'openai', localWhisperModel: 'base' })
  expect(database.pragma('user_version', { simple: true })).toBe(3)
})

it('persists only known provider IDs and reconciles invalid stored values', () => {
  const settings = new ProcessingSettingsRepository(database)
  expect(settings.update({ transcriptionProvider: 'local_whisper', summaryProvider: 'codex_cli', localWhisperModel: 'small' }))
    .toEqual({ transcriptionProvider: 'local_whisper', summaryProvider: 'codex_cli', localWhisperModel: 'small' })
  database.prepare('UPDATE app_settings SET value_json = ? WHERE key = ?')
    .run('{"transcriptionProvider":"bad"}', 'processing_providers')
  expect(settings.get()).toEqual({ transcriptionProvider: 'openai', summaryProvider: 'openai', localWhisperModel: 'base' })
})
```

Run: `npx vitest run tests/integration/processing-settings-repository.test.ts tests/integration/migration-v2.test.ts`

Expected: FAIL because migration 3 and `ProcessingSettingsRepository` do not exist.

- [ ] **Step 2: Add exact shared schemas and migration 3**

```ts
export const TranscriptionProviderIdSchema = z.enum(['openai', 'local_whisper'])
export const SummaryProviderIdSchema = z.enum(['openai', 'codex_cli'])
export const ProcessingProviderSettingsSchema = z.object({
  transcriptionProvider: TranscriptionProviderIdSchema,
  summaryProvider: SummaryProviderIdSchema,
  localWhisperModel: z.enum(['base', 'small']),
}).strict()
export type ProcessingProviderSettings = z.infer<typeof ProcessingProviderSettingsSchema>
```

Migration 3 creates `app_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL)` and inserts `processing_providers` with `{"transcriptionProvider":"openai","summaryProvider":"openai"}` using `INSERT OR IGNORE`, then sets `PRAGMA user_version = 3` in the existing transactional migration style.

- [ ] **Step 3: Implement the focused repository and IPC/preload methods**

```ts
export class ProcessingSettingsRepository {
  constructor(private readonly database: Database.Database) {}
  get(): ProcessingProviderSettings {
    const row = this.database.prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get('processing_providers') as { value_json: string } | undefined
    let stored: unknown = null
    try { stored = row === undefined ? null : JSON.parse(row.value_json) } catch { stored = null }
    const parsed = ProcessingProviderSettingsSchema.safeParse(stored)
    return parsed.success ? parsed.data : { transcriptionProvider: 'openai', summaryProvider: 'openai', localWhisperModel: 'base' }
  }
  update(input: ProcessingProviderSettings): ProcessingProviderSettings {
    const value = ProcessingProviderSettingsSchema.parse(input)
    this.database.prepare('INSERT INTO app_settings(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
      .run('processing_providers', JSON.stringify(value))
    return value
  }
}
```

Validate every IPC input with the shared schema and parse every preload response before returning it to the renderer.

- [ ] **Step 4: Run paired unchanged/changed tests and commit**

Run: `npx vitest run tests/integration/processing-settings-repository.test.ts tests/integration/migration-v2.test.ts tests/unit/api-key-settings.test.tsx`

Expected: PASS; existing API-key secrecy tests remain green and provider defaults persist.

Commit: `git add src/main/settings src/shared/contracts/settings.ts src/main/db/migrations.ts src/main/ipc/registerSettingsHandlers.ts src/preload/index.ts tests && git commit -m "✨ feat: persist processing provider settings"`

---

### Task 2: Introduce provider ports and a single registry

**Files:**
- Create: `src/main/ai/providers/providerPorts.ts`
- Create: `src/main/ai/providers/providerRegistry.ts`
- Create: `src/main/ai/providers/openAiTranscriptionAdapter.ts`
- Create: `src/main/ai/providers/openAiSummaryAdapter.ts`
- Create: `tests/unit/provider-registry.test.ts`
- Modify: `src/main/ai/transcriptionService.ts`
- Modify: `src/main/ai/summaryService.ts`
- Modify: `src/main/index.ts`
- Test: `tests/unit/transcription-service.test.ts`
- Test: `tests/unit/summary-service.test.ts`
- Test: `tests/integration/processing-service.test.ts`

**Interfaces:**
- Produces `TranscriptionProvider`, `SummaryProvider`, `ProviderAvailability`, `ProviderDescriptor`, and `ProviderRegistry`.
- Existing services consume only the two provider ports.
- Extends `SettingsApi` with `listProcessingProviderDescriptors()` through a registry-backed IPC handler.

- [ ] **Step 1: Add failing registry tests for exact IDs and safe defaults**

```ts
it('resolves each stable provider ID exactly once', () => {
  const registry = new ProviderRegistry({ openai: openAiTranscription, local_whisper: localTranscription }, { openai: openAiSummary, codex_cli: codexSummary })
  expect(registry.transcription('local_whisper')).toBe(localTranscription)
  expect(registry.summary('codex_cli')).toBe(codexSummary)
})

it('rejects unknown runtime IDs instead of silently selecting another provider', () => {
  const registry = createRegistry()
  expect(() => registry.transcription('unknown' as never)).toThrow(/unknown transcription provider/i)
})
```

Run: `npx vitest run tests/unit/provider-registry.test.ts`

Expected: FAIL because the ports and registry do not exist.

- [ ] **Step 2: Define small ports and concrete OpenAI adapters**

```ts
export interface ProviderAvailability { available: boolean; code: string | null; message: string | null }
export interface ProviderDescriptor {
  id: TranscriptionProviderId | SummaryProviderId
  stage: 'transcription' | 'summary'
  displayName: string
  availability: ProviderAvailability
  privacy: 'audio_cloud' | 'text_cloud' | 'local'
  capabilities: readonly ('api_key' | 'model_manager' | 'cli_status' | 'speaker_diarization')[]
}
export interface TranscriptionProviderRequest { filePath: string }
export interface NormalizedTranscriptSegment {
  speakerLabel: string | null
  startSeconds: number
  endSeconds: number
  text: string
}
export interface NormalizedTranscription { durationSeconds: number; segments: NormalizedTranscriptSegment[] }
export interface TranscriptionProvider {
  readonly id: TranscriptionProviderId
  availability(): Promise<ProviderAvailability>
  transcribe(request: TranscriptionProviderRequest): Promise<NormalizedTranscription>
}
export interface SummaryProvider {
  readonly id: SummaryProviderId
  availability(): Promise<ProviderAvailability>
  summarize(request: SummaryRequest): Promise<string>
}
```

The OpenAI transcription adapter translates `{ filePath }` into the existing OpenAI-specific model, response-format, and chunking request. It maps provider speaker strings into `speakerLabel`; the local adapter returns `speakerLabel: null`. The OpenAI summary adapter delegates the existing request without changing error behavior. Move no orchestration state transitions into adapters.

- [ ] **Step 3: Implement the registry as the only provider selection point**

```ts
export class ProviderRegistry {
  constructor(
    private readonly transcriptions: Readonly<Record<TranscriptionProviderId, TranscriptionProvider>>,
    private readonly summaries: Readonly<Record<SummaryProviderId, SummaryProvider>>,
  ) {}
  transcription(id: TranscriptionProviderId): TranscriptionProvider {
    const provider = this.transcriptions[id]
    if (provider === undefined) throw new Error(`Unknown transcription provider: ${id}`)
    return provider
  }
  summary(id: SummaryProviderId): SummaryProvider {
    const provider = this.summaries[id]
    if (provider === undefined) throw new Error(`Unknown summary provider: ${id}`)
    return provider
  }
}
```

At the composition root, create two resolver closures: `() => registry.transcription(settings.get().transcriptionProvider)` and `() => registry.summary(settings.get().summaryProvider)`. Inject those closures into `TranscriptionService` and `SummaryService`, which resolve once at the beginning of their stage. This makes retry use the current setting without provider-ID branches in `ProcessingService`, `TranscriptionService`, or `SummaryService`.

Expose `registry.descriptors()` through `settings:list-processing-provider-descriptors`. Each adapter supplies its own descriptor and availability result; the registry flattens them without inspecting provider IDs. Parse the descriptor array in preload before returning it to the renderer.

Refactor transcript persistence so a non-null `speakerLabel` creates the existing stable speaker record while `null` stores a transcript segment with `speakerId: null` and a deterministic part/segment ID. Timing validation accepts a null speaker but still rejects missing text, non-finite time, reversed time, and non-monotonic segments. Replace service-level OpenAI error coercion with a provider-neutral safe error contract; each concrete adapter remains responsible for translating its own raw failures.

- [ ] **Step 4: Prove OpenAI behavior is unchanged and commit**

Run: `npx vitest run tests/unit/provider-registry.test.ts tests/unit/transcription-service.test.ts tests/unit/summary-service.test.ts tests/integration/processing-service.test.ts`

Expected: PASS; OpenAI gateway call counts, diarization, transactions, retries, and retention assertions remain unchanged.

Commit: `git add src/main/ai src/main/index.ts tests && git commit -m "♻️ refactor: isolate processing provider adapters"`

---

### Task 3: Add the Codex CLI summary adapter

**Files:**
- Create: `src/main/ai/providers/codexCliSummaryAdapter.ts`
- Create: `src/main/process/runOwnedProcess.ts`
- Create: `tests/unit/codex-cli-summary-adapter.test.ts`
- Modify: `src/main/ai/openAiErrors.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Produces `CodexCliSummaryAdapter implements SummaryProvider`.
- Produces `runOwnedProcess(request)` with timeout, bounded output, cancellation, and owned-process-tree termination.

- [ ] **Step 1: Add failing availability, invocation, and safe-error tests**

```ts
it('runs codex in an isolated ephemeral read-only job and returns only schema-valid JSON', async () => {
  const run = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }))
  const adapter = new CodexCliSummaryAdapter(run, files, temporaryRoot)
  await adapter.summarize({ input: 'meeting transcript', schema })
  expect(run).toHaveBeenCalledWith(expect.objectContaining({
    command: 'codex',
    args: expect.arrayContaining(['exec', '--ephemeral', '--sandbox', 'read-only', '--output-schema']),
    stdin: 'meeting transcript',
    cwd: expect.stringContaining('nnote-codex-summary-'),
  }))
})

it.each(['ENOENT', 'timeout', 'nonzero', 'malformed'])('maps %s without exposing paths, prompts, or stderr', async (failure) => {
  await expect(makeAdapter(failure).summarize(request)).rejects.toMatchObject({ retryable: true })
})
```

Run: `npx vitest run tests/unit/codex-cli-summary-adapter.test.ts`

Expected: FAIL because the adapter and process runner do not exist.

- [ ] **Step 2: Implement a shell-free owned process runner**

Use `spawn(command, args, { shell: false, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })`. Cap stdout and stderr at 1 MiB, use a 10-minute timeout, write stdin once, and terminate only the spawned process tree. Return `{ exitCode, stdout, stderr }`; never throw raw child-process errors past the adapter boundary.

- [ ] **Step 3: Implement Codex availability and summary execution**

Availability invokes `codex login status` with the same safe runner and distinguishes `CODEX_NOT_INSTALLED`, `CODEX_NOT_AUTHENTICATED`, `CODEX_CONFIG_INVALID`, and `CODEX_UNAVAILABLE`. Summary creates an owned temporary directory, writes `schema.json`, invokes `codex exec --ephemeral --sandbox read-only --skip-git-repo-check --output-schema schema.json --output-last-message result.json -`, validates `result.json`, and removes the directory in `finally`.

- [ ] **Step 4: Run adapter and unchanged OpenAI summary tests and commit**

Run: `npx vitest run tests/unit/codex-cli-summary-adapter.test.ts tests/unit/summary-service.test.ts`

Expected: PASS; Codex failures are safe and OpenAI summary calls remain unchanged.

Commit: `git add src/main/ai/providers/codexCliSummaryAdapter.ts src/main/process src/main/ai/openAiErrors.ts src/main/index.ts tests/unit/codex-cli-summary-adapter.test.ts && git commit -m "✨ feat: add Codex CLI summary adapter"`

---

### Task 4: Manage verified local Whisper models

**Files:**
- Create: `src/main/localModels/whisperModelManifest.ts`
- Create: `src/main/localModels/whisperModelManager.ts`
- Create: `tests/unit/whisper-model-manager.test.ts`
- Modify: `src/shared/contracts/settings.ts`
- Modify: `src/main/ipc/registerSettingsHandlers.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Produces `WhisperModelId = 'base' | 'small'`, `WhisperModelStatus`, and `WhisperModelManager.status/download/delete`.
- Exposes model lifecycle methods through `SettingsApi` and progress through a typed preload subscription.

- [ ] **Step 1: Add failing tests for download activation and cleanup**

```ts
it('activates a model only after its pinned digest matches', async () => {
  const manager = createManager({ bytes: validBytes, digest: validDigest })
  await manager.download('base')
  expect(await manager.status('base')).toMatchObject({ state: 'installed' })
  expect(files.rename).toHaveBeenCalledWith(expect.stringMatching(/\.partial$/), expect.stringMatching(/ggml-base\.bin$/))
})

it('deletes a mismatched partial model and leaves no installed state', async () => {
  const manager = createManager({ bytes: invalidBytes, digest: validDigest })
  await expect(manager.download('small')).rejects.toMatchObject({ code: 'WHISPER_MODEL_DIGEST_MISMATCH' })
  expect(await manager.status('small')).toMatchObject({ state: 'not_installed' })
})
```

Run: `npx vitest run tests/unit/whisper-model-manager.test.ts`

Expected: FAIL because the model manager does not exist.

- [ ] **Step 2: Add a pinned manifest and atomic model manager**

Use this exact immutable application manifest:

```ts
export const WHISPER_MODELS = {
  base: {
    filename: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    size: 147_951_465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
  },
  small: {
    filename: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    size: 487_601_967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
  },
} as const
```

The implementation streams to `<filename>.partial`, reports `{ modelId, receivedBytes, totalBytes }`, resumes only when the server confirms the requested range, hashes the completed file, atomically renames it, and derives installed status by rechecking filename, size, and digest.

- [ ] **Step 3: Expose validated IPC and preload operations**

Add `listWhisperModels`, `downloadWhisperModel`, `deleteWhisperModel`, and `onWhisperModelProgress`. Parse model IDs in main and progress payloads in preload. Permit only manifest-owned paths beneath the application model directory.

- [ ] **Step 4: Run lifecycle and API secrecy tests and commit**

Run: `npx vitest run tests/unit/whisper-model-manager.test.ts tests/unit/api-key-settings.test.tsx`

Expected: PASS; model progress works and no credential value becomes readable.

Commit: `git add src/main/localModels src/shared/contracts/settings.ts src/main/ipc/registerSettingsHandlers.ts src/preload/index.ts tests && git commit -m "✨ feat: manage verified Whisper models"`

---

### Task 5: Add the packaged local Whisper transcription adapter

**Files:**
- Create: `src/main/ai/providers/localWhisperTranscriptionAdapter.ts`
- Create: `src/main/localRuntime/runtimePaths.ts`
- Create: `src/main/localRuntime/whisperOutput.ts`
- Create: `tests/unit/local-whisper-transcription-adapter.test.ts`
- Modify: `src/main/ai/openAiErrors.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Produces `LocalWhisperTranscriptionAdapter implements TranscriptionProvider`.
- Consumes the verified model path, packaged FFmpeg path, packaged whisper path, trusted finalized recording paths, and `runOwnedProcess`.

- [ ] **Step 1: Add paired local/OpenAI invocation and cleanup tests**

```ts
it('local Whisper transcription invokes only packaged helpers and deletes each temporary WAV', async () => {
  const result = await adapter.transcribe(request)
  expect(run.mock.calls.map(([call]) => call.command)).toEqual([packagedFfmpeg, packagedWhisper])
  expect(result.segments).toEqual([{ speakerLabel: null, startSeconds: 0, endSeconds: 1.2, text: '안녕하세요' }])
  expect(files.remove).toHaveBeenCalledWith(expect.stringMatching(/\.wav$/))
})

it('OpenAI transcription still invokes only the OpenAI gateway', async () => {
  await openAiAdapter.transcribe(request)
  expect(openAiClient.audio.transcriptions.create).toHaveBeenCalledOnce()
  expect(run).not.toHaveBeenCalled()
})
```

Add failures for converter nonzero exit, Whisper nonzero exit, malformed JSON, timeout, path escape, symlink input, and cleanup after every terminal outcome.

Run: `npx vitest run tests/unit/local-whisper-transcription-adapter.test.ts tests/unit/transcription-service.test.ts`

Expected: FAIL because the local adapter does not exist.

- [ ] **Step 2: Resolve only packaged runtime and verified model paths**

`runtimePaths.ts` accepts `process.resourcesPath`, platform, and architecture and returns fixed paths under `resources/local-runtime`. Development accepts only the explicit `NNOTE_LOCAL_RUNTIME_DIR` override. Reject missing files, symbolic links, and paths outside the owned runtime/model roots.

- [ ] **Step 3: Convert and transcribe each finalized part without a shell**

Invoke FFmpeg with `['-nostdin','-hide_banner','-loglevel','error','-i',input,'-ac','1','-ar','16000','-c:a','pcm_s16le','-y',temporaryWav]`. Invoke whisper with `['-m',modelPath,'-f',temporaryWav,'-l','ko','-oj','-of',outputBase]`. Parse bounded JSON, require finite monotonic timestamps and nonempty normalized text, offset each part by persisted part duration, set speaker to `null`, and remove WAV/output files in `finally`.

- [ ] **Step 4: Run provider and orchestration regressions and commit**

Run: `npx vitest run tests/unit/local-whisper-transcription-adapter.test.ts tests/unit/transcription-service.test.ts tests/integration/processing-service.test.ts`

Expected: PASS; local processing is isolated and existing OpenAI diarization and processing transitions remain green.

Commit: `git add src/main/ai/providers/localWhisperTranscriptionAdapter.ts src/main/localRuntime src/main/ai/openAiErrors.ts src/main/index.ts tests && git commit -m "✨ feat: add local Whisper transcription adapter"`

---

### Task 6: Build advanced provider settings UI

**Files:**
- Create: `src/renderer/src/features/settings/ProcessingProviderSettings.tsx`
- Create: `src/renderer/src/features/settings/WhisperModelSettings.tsx`
- Create: `src/renderer/src/features/settings/CodexCliStatus.tsx`
- Create: `tests/unit/processing-provider-settings.test.tsx`
- Modify: `src/renderer/src/features/settings/ApiKeySettings.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles/app.css`
- Modify: `tests/visual/harness/src.tsx`
- Modify: `tests/visual/feature-docs.pw.ts`

**Interfaces:**
- Consumes generic provider descriptors and model/status methods from `SettingsApi`.
- Produces a default OpenAI panel plus secondary advanced controls without changing existing API-key semantics.

- [ ] **Step 1: Add exact visible-outcome tests**

```tsx
it('shows OpenAI as both defaults while keeping advanced providers secondary', async () => {
  render(<ProcessingProviderSettings settings={settings} />)
  expect(await screen.findByLabelText('전사 방식')).toHaveValue('openai')
  expect(screen.getByLabelText('요약 방식')).toHaveValue('openai')
  expect(screen.getByText('고급 처리 옵션')).toBeInTheDocument()
})

it('shows local privacy and missing speaker separation before enabling Whisper', async () => {
  await user.selectOptions(screen.getByLabelText('전사 방식'), 'local_whisper')
  expect(screen.getByText(/오디오는 외부로 전송되지 않습니다/)).toBeInTheDocument()
  expect(screen.getByText(/화자 분리를 지원하지 않습니다/)).toBeInTheDocument()
})

it('labels Codex summary as cloud processing and renders its actionable status', async () => {
  await user.selectOptions(screen.getByLabelText('요약 방식'), 'codex_cli')
  expect(screen.getByText(/전사문이 Codex 계정으로 전송됩니다/)).toBeInTheDocument()
})
```

Run: `npx vitest run tests/unit/processing-provider-settings.test.tsx tests/unit/api-key-settings.test.tsx`

Expected: FAIL because the advanced settings components do not exist.

- [ ] **Step 2: Implement generic controls and focused capability panels**

`ProcessingProviderSettings` owns provider selections only. `WhisperModelSettings` owns model progress/install/delete only. `CodexCliStatus` owns CLI availability guidance only. Use descriptor capabilities to mount focused panels; do not put process invocation or provider-specific state machines into `ApiKeySettings`.

- [ ] **Step 3: Apply the existing design system and visual harness states**

Use existing tokens, control radii, hairlines, ink hierarchy, and button variants. Add harness states for OpenAI defaults, expanded advanced controls, model downloading, model installed, Codex available, and Codex unavailable.

- [ ] **Step 4: Run UI and visual tests and commit**

Run: `npx vitest run tests/unit/processing-provider-settings.test.tsx tests/unit/api-key-settings.test.tsx tests/unit/app-routing.test.tsx`

Run: `npm run test:visual`

Expected: PASS with approved snapshots for both Windows and macOS visual gates.

Commit: `git add src/renderer tests/unit tests/visual && git commit -m "✨ feat: add advanced processing provider settings"`

---

### Task 7: Build and verify signed platform runtime payloads

**Files:**
- Create: `scripts/build-local-runtime.ps1`
- Create: `scripts/build-local-runtime.sh`
- Create: `build/local-runtime/THIRD_PARTY_NOTICES.md`
- Create: `tests/unit/local-runtime-build-contract.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/verify-package.mjs`
- Modify: `src/main/app/runtimePackageVerification.ts`
- Test: `tests/unit/package-config.test.ts`
- Test: `tests/unit/runtime-package-verification.test.ts`

**Interfaces:**
- Produces platform payload at `build/local-runtime/<platform>-<arch>/` containing `whisper-cli`, `ffmpeg`, license notices, and `runtime-manifest.json`.
- Package verification reports `localRuntime: true` only when both helpers are present, executable, inside resources, and match the manifest.

- [ ] **Step 1: Add failing build-contract and package-verification tests**

```ts
it('pins reproducible local runtime source versions and LGPL-compatible FFmpeg flags', () => {
  expect(manifest).toMatchObject({ whisperCpp: 'v1.9.1', ffmpeg: 'n8.1.2' })
  expect(buildScript).toContain('--disable-gpl')
  expect(buildScript).toContain('--disable-nonfree')
})

it('requires the matching helper payload in packaged runtime verification', async () => {
  expect(await verifyLocalRuntime(resourcesPath)).toEqual({ whisper: true, ffmpeg: true, notices: true })
})
```

Run: `npx vitest run tests/unit/local-runtime-build-contract.test.ts tests/unit/package-config.test.ts tests/unit/runtime-package-verification.test.ts`

Expected: FAIL because runtime build scripts and package signals do not exist.

- [ ] **Step 2: Add reproducible runtime build scripts**

Build whisper.cpp from tag `v1.9.1`. Build FFmpeg from tag `n8.1.2` with `--disable-gpl --disable-nonfree --disable-doc --disable-network --disable-ffplay --disable-ffprobe --disable-everything --enable-ffmpeg --enable-protocol=file --enable-demuxer=matroska --enable-decoder=opus --enable-filter=aresample --enable-encoder=pcm_s16le --enable-muxer=wav --enable-avformat --enable-avcodec --enable-avfilter --enable-swresample`. Emit SHA-256 values into `runtime-manifest.json` and copy MIT/LGPL notices.

- [ ] **Step 3: Package and verify the exact architecture payload**

Add `extraResources` for `build/local-runtime/${platform}-${arch}` to `local-runtime`. Release jobs build the runtime before electron-builder for Windows x64, macOS x64, and macOS arm64. The macOS signing step signs helper binaries within the app bundle before notarization. Downloaded model files are never included.

- [ ] **Step 4: Run full verification and capture screenshots**

Run: `npm rebuild better-sqlite3 && npm run typecheck && npm run lint && npm test && npm run build`

Run on Windows: `npm run rebuild:electron && npm run package:win:x64 && node scripts/verify-package.mjs dist/win-unpacked`

Run in the release matrix: package and verify macOS x64 and arm64, then inspect signatures and notarization results.

Capture final screenshots for default OpenAI settings, advanced selectors, model downloading, model installed, Codex available/unavailable, local transcription progress, and Codex summary progress under `docs/screenshots/processing-providers/`.

Expected: all scoped and full tests pass; each package reports `localRuntime: true`; helper signatures are valid; screenshots show the reported visible outcomes.

- [ ] **Step 5: Review scope leakage and commit**

Run: `git diff --check && git status --short && git diff --stat main...HEAD`.

Confirm every changed file belongs to provider selection, provider adapters, model/runtime management, settings UI, tests, documentation, or packaging. Confirm recording, recovery, archive, and retention semantics changed only where required to call the selected ports.

Commit: `git add scripts build package.json .github/workflows/release.yml src/main/app tests docs/screenshots && git commit -m "📦 build: package local Whisper runtime"`
