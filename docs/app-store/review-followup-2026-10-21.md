# Build 7: speech setup investigation and recovery

## Comparable reports and official behavior

- [Apple Developer Forums thread 797835](https://developer.apple.com/forums/thread/797835): Apple explains that `AssetInventory.Status.downloading` can mean queued work, not an actively progressing download; a failed installation may be retried using the same or a new installation request without duplicate downloads. The Arabic-language support bug in this thread is not evidence that Korean or English is unsupported.
- [AssetInventory](https://developer.apple.com/documentation/speech/assetinventory): assets are shared across apps, but locale reservations belong to the app. Reservations can be assigned explicitly. A download can finish immediately because another app installed the shared asset.
- [AssetInstallationRequest](https://developer.apple.com/documentation/speech/assetinstallationrequest): installation requests are consolidated by the system.

These reports establish failure modes to test; they do not prove the cause on Apple's review device.

## Local observations

A fresh diagnostic executable reported no reserved locales and `supported` for both ko_KR and en_US. Explicit reservation returned true for each; the installation request then required no download and status became `installed`. The production helper already reported installed assets. This demonstrates why app registration and shared asset presence must be distinguished.

Local hardware runs macOS 27.0.1 (26A434). The device already has both supported language assets. We did not delete macOS-managed assets, and this is not a claim to have tested downloading every asset from an empty machine.

## Corrections

- Explicitly reserve the resolved supported locale before setup and before transcription, including when shared assets are already installed. A false reservation result means already reserved, not failure.
- Recheck installation state after an installation error before declaring failure.
- Terminate a setup attempt after two minutes without output, while allowing advancing native installation progress to extend that inactivity deadline up to the existing twenty-minute absolute limit. Native progress reports contain only increasing completed-unit counts; a queued status or repeated heartbeat cannot prolong a stalled attempt. After termination, recheck system status with a separate bounded status call. Report ready if installed; otherwise restore controls and offer status refresh and retry. The system may continue its own pending work.
- Distinguish reservation, installation, and setup-timeout failures. Do not expose raw native diagnostics. Waiting text does not assert that a download is actively progressing.
- Preserve the build 6 explicit ready indicator and next-step instructions.

## Verification

- Focused helper, adapter, settings, and shared process-runner tests: 94 passed, 1 platform-specific skip, including timeout queue recovery, shared completion at timeout, a successful UI retry after timeout, and clearing a stale failure after a ready status refresh.
- Typecheck, lint, Swift contract verification passed.
- Native helper: actual Korean (12.93 s) and English (10.65 s) test audio prepared and transcribed successfully. The English transcript includes the launch date and both named assignments; Korean includes the corresponding decisions and assignments.
- The initial build 7 CI run was cancelled before upload to include progress-sensitive timeouts; the replacement run and signed application results are recorded below when complete.

Limit: deterministic timeout tests simulate process outcomes. No claim is made that a first-time network download or Apple's exact macOS 27.2 environment was reproduced.

### Signed application and real process evidence

- The final MAS development build was signed with the Mineloa team's development identity. The actual sandboxed app imported an audio-only `.nnote` test recording and completed Apple Speech transcription and Apple Intelligence summary generation from the visible “회의록 만들기” action. The generated document includes the launch date and both tasks. This verifies stored audio processing, not physical microphone capture.
- Ready indicators were confirmed in the signed app. Screenshots: `/tmp/Mineloa-Build7-Signed-Ready.png`, `/tmp/Mineloa-Build7-Signed-Complete.png`, `/tmp/Mineloa-Build7-Signed-Summary.png`.
- A real sleeping child process hit the production 120-second inactivity limit; the next status process succeeded. A separate real process emitting advancing output remained alive beyond its initial inactivity deadline and was terminated after output stopped.
- Direct debugger launch of the sandboxed app was unsuitable; the successful test used the normal app UI and archive import. No successful debugger test is claimed.

### Distribution build

- Source commit: `a225d74` (following `02b3b4a`).
- [Build 7 validation/sign/upload workflow](https://github.com/jdeploys/mineloa/actions/runs/39446822428): succeeded. Apple package validation and upload succeeded.
- Downloaded signed distribution artifacts: `dist/app-store-1.0-7/39446822428`.
- Final local signed app verified with `codesign --verify --strict`, bundle version 7; packaged main code contains the inactivity watchdog and setup timeout recovery.

### Resubmission

- 2026-10-21 00:40 KST: build 1.0 (7) submitted, confirmed **WAITING_FOR_REVIEW** in App Store Connect.
- New submission: [`c9ab3cf6-bb87-4d18-8940-c725aaaa7657`](https://appstoreconnect.apple.com/apps/6792231571/distribution/reviewsubmissions/details/c9ab3cf6-bb87-4d18-8940-c725aaaa7657).
- Selected build ID: `f70c4e28-2a17-47e3-8a12-c9d8cdabbb47`.
- Previous submission `98ff401e-e519-42ac-b4c4-822d0169951a` was cancelled to replace build 6, after build 7 was processed and available.
- App Review notes contain the setup corrections, reproduction steps, actual signed-app validation, and cold-download limitation. `Mineloa-Build7-Signed-Complete.png` was attached to App Review information. Both notes and attachment were verified after reloading.
- The cancelled submission no longer offers a reply action, so no new Resolution Center reply was sent; the explanation is in the new submission's App Review notes.
- Manual release remains selected. The two-hour monitor now tracks build 7 and the new submission ID, ignoring the expected cancellation of the previous submission.
