# App Review 2.1(a) — Speech model preparation

- App: Mineloa, 6792231571
- Reviewed version: 1.0 (5)
- Submission: 98ff401e-e519-42ac-b4c4-822d0169951a
- Apple message: 2026-10-20 23:10 KST
- Reviewer: MacBook Pro (14-inch, Nov 2024), macOS 27.2
- Report: pressing “음성 모델 준비” appeared unresponsive and prevented use of the core feature.

## Finding and changes

The supplied screenshot shows neither speech nor summary unavailability warnings. When speech assets were already installed, preparation returned successfully but the UI continued to show the same preparation button without any success message. This made successful preparation indistinguishable from an unresponsive button.

Build 6 displays ready status and recording instructions immediately when assets are installed. When installation is needed, it displays a persistent installation message, a longer-wait explanation after 30 seconds, and an actionable retry on failure or an unavailable result. It uses the preparation result directly instead of running another helper process to discover the same status. The native helper verifies readiness after installation, including when Apple returns no installation request because shared assets are already installed. Apple Intelligence readiness is displayed separately.

## Proposed reply (send after build validation and upload)

Thank you for the report and screenshot. We identified and fixed a missing completion indication in the speech model setup in version 1.0, build 6.

When the speech model was already installed, the previous build completed the request without changing the preparation button or showing a success message. Build 6 now explicitly shows “음성 모델 준비 완료” (Speech model ready) and instructions for the next step. If a download is needed, the app immediately displays an installation status and shows a retry action if preparation does not complete successfully. Apple Intelligence summary readiness is also displayed separately.

To test the core feature without an API key:
1. Open Settings (“설정”). Keep Apple Speech and Apple Intelligence selected.
2. Confirm “음성 모델 준비 완료” and “Apple Intelligence 요약 준비 완료”. If the speech model is not installed, press “음성 모델 준비” and wait for the completion status. Apple Intelligence must be enabled in macOS System Settings.
3. Click “녹음 시작”, record a short meeting in the Mac's default language (Korean for a Korean system, otherwise English), then click “종료”.
4. Open the new recording in “최근 기록” and press “회의록 만들기”. The app transcribes the recording and then generates its summary on the device without an API key.

The included sample meeting contains a prerecorded transcript and summary for orientation; the steps above exercise fresh transcription and summarization.
