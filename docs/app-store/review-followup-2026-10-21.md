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
- Bound one setup helper attempt to two minutes instead of twenty. After termination, recheck system status with a separate bounded status call. Report ready if installed; otherwise restore controls and offer status refresh and retry. The system may continue its own pending work.
- Distinguish reservation, installation, and setup-timeout failures. Do not expose raw native diagnostics. Waiting text does not assert that a download is actively progressing.
- Preserve the build 6 explicit ready indicator and next-step instructions.

## Verification

- Focused helper, adapter, and settings tests: 41 passed, including timeout queue recovery, shared completion at timeout, a successful UI retry after timeout, and clearing a stale failure after a ready status refresh.
- Typecheck, lint, Swift contract verification passed.
- Native helper: actual Korean (12.93 s) and English (10.65 s) test audio prepared and transcribed successfully. The English transcript includes the launch date and both named assignments; Korean includes the corresponding decisions and assignments.
- Signed application validation and deployment results are recorded below when complete.

Limit: deterministic timeout tests simulate process outcomes. No claim is made that a first-time network download or Apple's exact macOS 27.2 environment was reproduced.
