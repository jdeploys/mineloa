# Nnote

Nnote는 Windows와 macOS에서 노트북 마이크 회의를 로컬에 녹음하고, 사용자가 제공한 OpenAI API 키로 화자 분리 전사와 구조화 요약을 만드는 독립 실행형 Electron 앱입니다. 로그인이나 자체 서버가 필요하지 않습니다.

## 현재 범위

- 녹음과 기록은 이 기기에만 저장합니다.
- OpenAI 처리를 선택한 경우에만 녹음이 OpenAI API로 전송됩니다.
- API 키는 Windows Credential Manager 또는 macOS Keychain에 저장하며 SQLite, 로그, `.nnote` 내보내기에 넣지 않습니다.
- 외부 오디오 가져오기, 탭 오디오, 실시간 전사, 클라우드 동기화, Linux, FFmpeg는 지원하지 않습니다.
- 최대 녹음 시간은 2시간이며 22 MiB에서 경고합니다. 한 파트가 24 MiB에 도달하면 현재 WebM을 완전히 종료한 뒤 같은 마이크 스트림으로 독립적인 새 WebM 파트를 시작합니다.

## 개발

요구 사항은 Node.js 22.12 이상, npm, Windows 또는 macOS입니다.

```powershell
npm ci
npm run dev
```

전체 자동 검증:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`test:e2e`는 Electron 43 ABI에 맞게 네이티브 의존성을 재빌드한 뒤 실제 빌드 앱을 가짜 Chromium 마이크로 실행합니다. 이후 같은 작업 폴더에서 Node 기반 통합 테스트를 다시 실행하려면 `npm rebuild better-sqlite3`로 Node ABI를 복원하거나 `npm ci`를 다시 실행하십시오.

## 패키징

Windows:

```powershell
npm run package:win
node scripts/verify-package.mjs dist/win-unpacked
```

macOS:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac
node scripts/verify-package.mjs dist/mac-*/Nnote.app
```

검증 스크립트는 임시 사용자 데이터 디렉터리에서 실제 패키지 실행 파일을 시작하고 Main, SQLite, OS Keyring 네이티브 모듈, sandbox preload, renderer 대시보드를 확인합니다. 키를 읽거나 저장하지 않습니다.

로컬 및 CI 산출물은 서명되지 않습니다. 공개 배포에는 Windows 코드 서명 인증서가 필요하며 macOS에는 Apple Developer ID, hardened runtime 서명, notarization 자격 증명이 필요합니다. 서명되지 않은 빌드는 Windows SmartScreen 또는 macOS Gatekeeper 경고를 표시할 수 있습니다.

## OpenAI API 키

앱의 **설정**에서 개인 OpenAI API 키를 저장할 수 있습니다. 저장 전 최소 인증 요청으로 키를 검증합니다. 전사는 `gpt-4o-transcribe-diarize`, 요약은 `gpt-5-mini`를 사용하며 API 사용료는 키 소유자에게 청구됩니다. 네트워크 또는 처리 실패 시 원본 녹음은 유지됩니다.

## 개인 정보와 로컬 파일

기본 정책은 전사와 요약이 모두 안전하게 커밋된 후 원본 오디오를 삭제하는 것입니다. 회의별로 원본 유지를 선택할 수 있습니다. 앱 제거 시 사용자 데이터는 자동 삭제하지 않습니다. 기록을 지우려면 앱 안의 명시적 삭제/폐기 기능을 사용하십시오.

`.nnote`는 Nnote 간 이동용 버전 ZIP이며 API 키와 로컬 절대 경로를 포함하지 않습니다. 현재 내보내기는 archive v2로 보존된 모든 오디오 파트를 포함하고, 가져오기는 안전한 v1 패키지도 읽습니다. 녹음·복구·처리 중 같은 일시 상태는 내보내거나 가져오지 않습니다. Markdown 내보내기는 읽기용이며 다시 가져오는 형식이 아닙니다.

## 릴리스 검증 상태

자동 및 수동 확인의 정확한 범위는 [릴리스 인수 매트릭스](docs/release/acceptance-matrix.md)에 기록합니다. Windows 로컬 결과를 macOS 결과로 간주하지 않으며, 2시간 실기기·실제 마이크·실제 OpenAI 네트워크 검증은 별도 수동 항목입니다.

macOS 시각 CI는 기준선이 없거나 픽셀이 다르면 성공으로 건너뛰지 않습니다. 실패한 작업의 `macos-visual-candidates-and-diffs` artifact에서 darwin 후보 원본과 실제·예상·diff 이미지를 내려받아 검토하고, 승인한 `tests/visual/snapshots/darwin` PNG만 커밋한 뒤 CI를 다시 실행해야 합니다. `npm run test:visual:update`는 후보 생성 명령이며 그 결과 자체가 승인이라는 뜻은 아닙니다.
