# Configurable processing providers

## Goal

Keep OpenAI API processing as Nnote's default, reliable path while adding advanced, independently selectable transcription and summary providers. Users who opt in can transcribe locally with a managed Whisper runtime and summarize through an installed Codex CLI without manually installing Whisper, Python, or FFmpeg.

## Locked scope

### Changed modes

- Advanced transcription provider selection: OpenAI API or local Whisper.
- Advanced summary provider selection: OpenAI API or Codex CLI.
- In-app installation and lifecycle management for local Whisper models.
- Runtime availability and actionable error reporting for local Whisper and Codex CLI.

### Modes that must not change

- OpenAI API remains the default for both transcription and summary.
- Recording, recovery, archive import/export, retention policy, and meeting state semantics remain unchanged.
- Provider failures never discard source audio, an existing transcript, or an existing summary.
- Nnote never silently falls back to a different provider because that could upload data against the user's selection.

## Provider model

Store transcription and summary choices independently:

- `transcriptionProvider`: `openai` or `local_whisper`.
- `summaryProvider`: `openai` or `codex_cli`.
- `localWhisperModel`: `base` or `small`, defaulting to `base` until the user chooses another installed model.

The default pair is `openai` plus `openai`. The settings UI keeps the API key controls prominent and places provider selection, local model management, and CLI status under an advanced section.

Provider choices are stored in a schema-validated singleton settings record in Nnote's SQLite database. A migration creates the record with the OpenAI/OpenAI defaults. Missing or invalid values reconcile to those safe defaults without changing credential or model files. Model installation state is derived from the verified model manifest and files rather than trusted from the preference record.

OpenAI credentials are required only when at least one selected processing stage uses OpenAI. Recording, meeting management, archive import/export, and transcript import remain usable without a key. When processing requires a missing key, Nnote routes the user to settings rather than blocking unrelated features.

## Adapter architecture

Provider-specific behavior must not be implemented through repeated `if`/`else` or `switch` branches across processing services, IPC handlers, or renderer components. Nnote uses two small provider ports:

- `TranscriptionProvider`: exposes a stable provider ID, availability status, and `transcribe(request)` operation that returns normalized transcription segments.
- `SummaryProvider`: exposes a stable provider ID, availability status, and `summarize(request)` operation that returns the existing validated summary response shape.

Concrete adapters own every provider-specific detail:

- `OpenAiTranscriptionAdapter` wraps the existing OpenAI transcription gateway.
- `LocalWhisperTranscriptionAdapter` owns conversion, helper execution, and Whisper output normalization.
- `OpenAiSummaryAdapter` wraps the existing Responses gateway.
- `CodexCliSummaryAdapter` owns Codex discovery, invocation, and output normalization.

A provider registry is created once in the main-process composition root. It maps stable IDs to adapter instances and is the only place that resolves a persisted provider ID. `ProcessingService`, `TranscriptionService`, and `SummaryService` depend on the selected port interface and do not know how many providers exist or contain provider-name conditionals. Adding another provider requires a new adapter plus one registry entry, not edits throughout the processing flow.

The registry exposes provider descriptors containing generic fields such as ID, stage, display name, availability, privacy classification, and capabilities. A settings IPC endpoint returns only those safe descriptors to the renderer. The settings UI renders them through shared provider controls. Provider-specific actions such as Whisper model management or Codex authentication guidance live in focused child components selected by descriptor capability, not in one monolithic conditional component.

Error translation follows the same boundary. Each adapter converts process, SDK, and validation failures into the existing safe processing-error contract before returning control to orchestration. Orchestration remains responsible only for state transitions, transactions, retries, and progress events.

The implementation must prefer composition over provider inheritance, keep adapter files focused on one external system, and avoid a generic abstraction layer beyond the two ports and registry. This prevents both scattered branching and an unnecessary provider framework.

## Local Whisper distribution

Nnote packages a platform- and architecture-specific `whisper.cpp` helper in each installer:

- Windows x64 helper for the Windows x64 package.
- macOS x64 helper for the Intel package.
- macOS arm64 helper with Apple acceleration for the Apple Silicon package.

The helper is part of the signed application payload. Nnote does not download executable code after installation and does not invoke a user-installed Python or Whisper environment.

Model data is downloaded only when the user selects local Whisper and explicitly chooses a model:

- `base`: lower memory and storage use, lower expected Korean accuracy.
- `small`: recommended balance for systems with adequate memory.

The model manager shows download size, progress, installed state, and deletion controls. Downloads use a temporary partial file, support retry, verify a pinned SHA-256 digest before activation, and rename atomically into the application model directory. A mismatch deletes the invalid download. Models are data files and are stored outside the signed application bundle under the application data directory.

## Audio conversion and local transcription

Existing Nnote recordings are WebM/Opus, while the packaged Whisper helper consumes a supported transcription format. Each platform package therefore includes a minimal FFmpeg executable built without GPL-only components and distributed under an LGPL-compatible configuration. Nnote includes the required license notices and reproducible build/source information. The signed helper converts one finalized WebM part into 16 kHz mono PCM WAV and is not exposed as a general-purpose command runner.

Local processing handles recording parts in their persisted order:

1. Resolve and validate the repository-owned canonical WebM path.
2. Convert one part to a uniquely named temporary WAV inside Nnote's private processing directory.
3. Invoke the packaged Whisper helper with the selected model and machine-readable segment output.
4. Validate timestamps, ordering, text, and process exit status before persistence.
5. Delete the temporary WAV in a `finally` path on success, provider failure, validation failure, or cancellation.
6. Continue with the next part and normalize timestamps across parts.

The packaged converter and Whisper helper receive argument arrays through a process-spawning API; Nnote does not build shell command strings. Paths, stdout, stderr, and provider details are redacted from renderer-visible errors.

Local Whisper does not promise Korean speaker diarization. Local segments are stored with no speaker assignment and render as an unknown speaker. Nnote must label this limitation before the user selects local transcription. OpenAI transcription retains its existing diarized speaker behavior.

## Codex CLI summary

Codex CLI summary is an advanced option for users who have installed and authenticated Codex. It reuses the existing summary prompt and strict JSON schema.

Nnote launches `codex exec`:

- In a dedicated empty temporary working directory.
- With ephemeral session storage.
- With read-only sandboxing.
- With the summary prompt and transcript on stdin rather than in command-line arguments.
- With an output schema and final-message file owned by the temporary job.

Nnote parses the final JSON using the same application-level schema validation used by the OpenAI summary gateway. It deletes all temporary prompt, schema, and output artifacts after the attempt.

Codex CLI summary does not mean fully local inference. The settings UI states that the transcript is sent through the user's authenticated Codex/OpenAI account. Availability checks distinguish at least: command missing, not authenticated, invalid local Codex configuration, process failure, timeout, malformed output, and valid output.

Nnote does not modify the user's global Codex configuration or authentication files.

## Settings and user flow

The default settings view contains API key status, save, validation, and removal. An advanced disclosure contains:

- Transcription provider selector.
- Local Whisper model selector and model lifecycle controls.
- Local Whisper availability, privacy, performance, and missing-diarization notice.
- Summary provider selector.
- Codex CLI installed/authenticated status and cloud-processing notice.

Provider changes affect future processing attempts. They do not mutate already committed transcripts or summaries. Retrying a failed stage uses the provider selected at retry time and preserves the existing transactional apply/rollback behavior.

Nnote never auto-selects a provider from hardware detection. Capability checks can explain whether a local model is likely to be slow, but the user makes the provider and model choice.

## Error handling

- Missing OpenAI key: retain the meeting and route the user to settings.
- Missing local model: retain the meeting and offer the model download action.
- Interrupted model download: retain the partial download only when it can be safely resumed; otherwise remove it and retry from zero.
- Invalid model digest: delete the invalid model and report a fixed, safe error.
- Converter or Whisper failure: retain every finalized WebM and any prior transcript or summary.
- Missing or invalid Codex CLI: retain the transcript and any prior summary while reporting an actionable status.
- Timeout or cancellation: terminate only the owned child process tree and clean owned temporary artifacts.
- Application restart: recover or clean stale provider-job temporary artifacts without touching repository-owned recordings.

## Security and privacy

- The UI describes which data leaves the computer for every provider combination.
- Local Whisper sends no audio to a network provider.
- Codex CLI summary sends transcript text through the user's Codex account.
- OpenAI transcription sends audio and OpenAI summary sends transcript text using the user's API key.
- Executables are bundled, signed with the app, invoked without a shell, and never replaced by model downloads.
- Model URLs and SHA-256 digests are pinned in the application release.
- Temporary data stays in an application-owned directory and is removed after every terminal outcome.

## Regression coverage

Paired tests must cover the exact changed and unchanged modes:

- Provider registry contract tests prove each stable ID resolves exactly one adapter and an unknown persisted ID reconciles to the OpenAI default.
- Shared adapter contract tests exercise normalized success, availability, cancellation, and safe failure behavior without provider branches in orchestration tests.
- `local Whisper transcription invokes only bundled local helpers` and `OpenAI transcription still invokes only the OpenAI gateway`.
- `Codex CLI summary invokes only codex exec` and `OpenAI summary still invokes only the Responses gateway`.
- Model download success, resumable interruption, digest rejection, atomic activation, and deletion.
- Ordered multi-part conversion and transcription, timestamp normalization, process timeout, output validation, and temporary-file cleanup.
- Local transcription persists unassigned speakers without altering OpenAI diarization behavior.
- Codex availability status and safe mapping of missing command, invalid configuration, timeout, nonzero exit, and malformed JSON.
- Provider retry preserves prior transcript, summary, audio, and processing state semantics.
- Windows x64, macOS x64, and macOS arm64 packages contain the expected signed helper payload while production packages exclude downloaded models.
- Settings UI visible outcomes: OpenAI defaults, advanced provider controls, model progress, privacy notices, and unavailable-provider guidance.

## Visual acceptance

Capture final screenshots for:

1. Default OpenAI API settings.
2. Advanced provider selectors.
3. Local model download and installed states.
4. Codex CLI available and unavailable states.
5. Processing status for local transcription and Codex summary.

The advanced controls must use the existing Nnote design system and remain secondary to the default OpenAI flow.

## Delivery boundary

This work updates source, tests, build inputs, and platform packaging configuration. It does not republish version `0.0.1`. A new signed/notarized release version is a separate delivery step after all three platform artifacts have been built and verified.
