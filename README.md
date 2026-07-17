# Nnote

Nnote는 회의를 녹음하고 전사·요약해 주는 Windows/macOS용 독립 실행형 데스크톱 앱입니다. Nnote 계정이나 별도 서버 없이 바로 사용할 수 있으며, 기록은 기본적으로 이 기기에 저장됩니다.

[![Nnote 대시보드](docs/screenshots/after-airbnb/01-dashboard.png)](docs/screenshots/README.md)

## 주요 기능

- 노트북 마이크 녹음, 일시정지, 재개, 중지와 명시적 폐기
- 앱이 중단된 녹음의 안전한 복구 또는 원본 내보내기
- OpenAI를 이용한 화자 분리 전사와 구조화 요약
- 번들 Whisper/FFmpeg와 다운로드 모델을 이용한 로컬 전사
- 설치된 Codex CLI를 이용한 선택적 요약
- 원하는 항목과 순서로 구성하는 요약 템플릿
- 화자 이름 수정과 회의별 원본 오디오 보존 정책
- `.nnote` 백업·이동 및 Markdown 내보내기
- 라이트·다크 테마와 Windows/macOS 패키징

녹음 시간은 회의당 최대 2시간입니다. 파일이 커지면 현재 WebM을 안전하게 닫고 같은 마이크 스트림으로 다음 파트를 이어서 녹음합니다.

## 다운로드

[Nnote 0.0.1 프리릴리스](https://github.com/jdeploys/NNote/releases/tag/v0.0.1)에서 다음 파일을 받을 수 있습니다.

- Windows x64 설치 파일
- macOS Apple Silicon(arm64) DMG
- macOS Intel(x64) DMG
- SHA-256 체크섬

> 현재 0.0.1은 테스트용 프리릴리스이며 코드 서명되지 않았습니다. Windows SmartScreen이 경고할 수 있고, macOS 빌드는 Gatekeeper에서 열리지 않을 수 있습니다. 일반 사용자용 정식 서명 배포판은 아직 준비 중입니다.

## 처리 방식

전사와 요약 공급자는 각각 선택할 수 있습니다. 기본값은 OpenAI이며, 로컬 기능은 **설정 → 고급 처리 옵션**에서 활성화합니다.

| 단계 | 공급자 | 필요한 것 | 데이터 처리 |
| --- | --- | --- | --- |
| 전사 | OpenAI — 기본 | 개인 OpenAI API 키 | 녹음 오디오를 OpenAI API로 전송하며 화자 분리를 지원 |
| 전사 | Local Whisper — 고급 | 앱에서 base 또는 small 모델 다운로드 | 번들 Whisper/FFmpeg로 이 기기에서 처리 |
| 요약 | OpenAI — 기본 | 개인 OpenAI API 키 | 전사문을 OpenAI API로 전송 |
| 요약 | Codex CLI — 고급 | 별도 설치 및 로그인된 Codex CLI | 전사문을 사용자의 Codex 계정으로 전송 |

OpenAI 전사는 `gpt-4o-transcribe-diarize`, 요약은 `gpt-5-mini`를 사용합니다. API 사용료는 키 소유자에게 청구됩니다. Local Whisper 전사는 오디오를 외부 AI 서비스로 전송하지 않지만 OpenAI 방식의 화자 분리는 제공하지 않습니다.

OpenAI API 키는 Windows Credential Manager 또는 macOS Keychain에 저장합니다. SQLite, 로그, `.nnote` 파일에는 키를 기록하지 않습니다.

## 빠른 사용법

1. 앱을 실행하고 새 회의의 요약 템플릿과 원본 오디오 정책을 선택합니다.
2. 기본 AI 처리를 사용하려면 **설정**에서 OpenAI API 키를 입력합니다.
3. 로컬 전사를 원하면 **고급 처리 옵션**에서 Local Whisper와 모델을 선택해 다운로드합니다.
4. **녹음 시작**을 누르고 회의가 끝나면 녹음을 중지합니다.
5. 전사와 요약을 실행하고 결과에서 화자 이름, 요약, 실행 항목을 확인합니다.
6. 필요하면 `.nnote` 또는 Markdown으로 내보냅니다.

로그인이나 API 키 없이도 녹음과 로컬 기록 관리는 사용할 수 있습니다. AI 처리를 하지 못하거나 네트워크 오류가 발생해도 원본 녹음은 유지됩니다.

## 개인정보와 로컬 파일

- 회의, 전사문, 요약, 설정과 다운로드한 Whisper 모델은 로컬 앱 데이터 폴더에 저장됩니다.
- 선택한 공급자에 필요한 데이터만 전송합니다. OpenAI 전사에는 오디오, OpenAI 또는 Codex 요약에는 전사문이 전송됩니다.
- 기본 오디오 정책은 전사와 요약이 안전하게 저장된 뒤 원본을 삭제하는 것입니다. 회의별로 원본 유지를 선택할 수 있습니다.
- 앱 제거 시 사용자 데이터는 자동 삭제하지 않습니다. 기록은 앱의 명시적 삭제·폐기 기능으로 관리합니다.
- `.nnote`는 Nnote 간 기록 이동을 위한 버전 ZIP입니다. API 키와 로컬 절대 경로를 포함하지 않으며 보존된 모든 오디오 파트를 함께 담을 수 있습니다.
- Markdown은 읽기용 내보내기 형식이며 Nnote로 다시 가져올 수 없습니다.

## 개발

요구 사항:

- Node.js 22.12 이상
- npm
- Windows 또는 macOS

```powershell
npm ci
npm run dev
```

주요 검증 명령:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:visual
npm run build
npm run test:e2e
```

`test:e2e`는 Electron 43 ABI에 맞춰 `better-sqlite3`를 재빌드한 뒤 실제 Electron 앱을 가짜 Chromium 마이크로 실행합니다. 이후 Node 기반 테스트를 실행하려면 다음 명령으로 Node ABI를 복원합니다.

```powershell
npm rebuild better-sqlite3
```

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

패키지 검증은 임시 사용자 데이터 디렉터리에서 실제 앱을 실행해 Main, SQLite, OS Keyring, sandbox preload와 renderer 대시보드를 확인합니다. 저장된 API 키는 읽거나 변경하지 않습니다.

공개 배포에는 Windows 코드 서명 인증서가 필요합니다. macOS의 App Store 외부 배포에는 Apple Developer ID 서명과 notarization이 필요하며, Mac App Store판에는 별도의 Electron `mas` 빌드와 App Sandbox 구성이 필요합니다.

## 관련 문서

- [기능별 최신 스크린샷과 디자인 비교](docs/screenshots/README.md)
- [Mac App Store 등록 가이드](docs/mac-app-store-publishing.md)
- [릴리스 인수 매트릭스](docs/release/acceptance-matrix.md)
- [macOS 시각 기준선 관리](docs/release/macos-visual-baselines.md)

Windows에서 확인한 결과를 macOS 검증으로 간주하지 않습니다. 실제 Mac, 실제 마이크, 장시간 녹음과 실제 API 네트워크 검증 범위는 릴리스 인수 매트릭스에 별도로 기록합니다.
