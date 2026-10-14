# macOS 애플 온디바이스 전사·요약 추가 설계

작성일: 2026-09-26

기준 코드: `main` / `b1e7e8c` (`git pull --ff-only` 이후)

상태: 설계 제안. 앱 코드·설정·패키징은 아직 변경하지 않았으며 macOS 실행 검증 전이다.

## 1. 목적과 범위

지원되는 Mac에서 사용자 계정이나 OpenAI API 키 없이 회의 전사와 구조화 요약을 수행하는 선택지를 추가한다. 전사는 Apple Speech의 `SpeechAnalyzer` / `SpeechTranscriber`, 요약은 Foundation Models의 **온디바이스** 모델을 사용한다.

기존 OpenAI 공급자는 유지한다. Windows와 기존 macOS 사용자의 설정을 바꾸지 않는다. 애플 공급자가 사용할 수 없거나 실패했을 때 클라우드 공급자로 자동 전환하지 않는다. Private Cloud Compute, 로그인, 자체 서버, 실시간 자막, 새로운 화자 분리 모델, 녹음 포맷 변경은 이번 범위에 넣지 않는다.

이 기능이 모든 Mac에서 동작하거나 현재 OpenAI의 한국어 품질·화자 분리를 그대로 대체한다고 보장하지 않는다. 또한 애플 경로 추가만으로 남아 있는 OpenAI 기능의 심사용 접근 정보 요구가 사라지는 것은 아니다.

## 2. 현재 코드에서 재사용할 부분

| 현재 파일 | 확인한 동작과 설계 영향 |
| --- | --- |
| `src/main/index.ts` | `process.mas`일 때 Whisper·Codex 공급자만 제외한다. 애플 공급자는 별도로 등록해야 한다. |
| `src/shared/contracts/settings.ts` | 전사·요약 공급자가 별도 enum이다. 각 enum에 ID 하나씩 추가하면 된다. |
| `src/main/ai/providers/providerPorts.ts` | `TranscriptionProvider`, `SummaryProvider`, availability, privacy, capabilities 계약이 이미 있다. 새 플러그인 계층은 필요 없다. |
| `src/main/ai/transcriptionService.ts` | 녹음 파트 순회, 공급자별 길이 제한에 따른 분할, 시간 오프셋 합산, 결과 검증과 저장을 담당한다. |
| `src/main/ai/summaryService.ts` | 템플릿과 전사로 프롬프트를 만들고 결과를 검증한다. `sourceIndex`를 실제 전사 시각으로 바꾼다. |
| `src/main/ai/summarySchema.ts` | 섹션 ID·종류·화자 ID를 검증한다. 애플 결과도 같은 검증을 통과해야 한다. |
| `src/main/ai/processingService.ts` | 전사 → 요약 → 원본 보존 정책 적용, 실패 단계 재시도와 처음부터 재처리를 제공한다. |
| `src/main/process/runOwnedProcess.ts` | shell 없이 자식 프로세스 실행, timeout, 출력 상한, AbortSignal 및 자식 종료를 제공한다. |
| `src/main/localRuntime/ownedTemporaryFiles.ts` | 작업 소유 임시 파일을 검증하고 읽는 기존 패턴을 재사용할 수 있다. |
| `src/main/settings/processingSettingsRepository.ts` | 현재 MAS 설정 조정은 전사·요약을 각각 OpenAI로 강제한다. 애플 선택을 덮어쓰지 않도록 조건을 좁혀야 한다. |
| `src/renderer/src/features/settings/ProcessingProviderSettings.tsx` | 현재 OpenAI/로컬 이분법이며 로컬=Whisper로 가정한다. 애플 ID만 추가하면 잘못 표시된다. |
| `package.json`, `scripts/after-pack.mjs` | MAS에도 FFmpeg/Whisper 리소스와 서명 경로가 있다. 공급자 비활성화와 실행 파일 미포함은 다르다. |

녹음은 WebM이며 기존 FFmpeg 변환 경로가 있다. 애플 API가 현재 WebM을 직접 읽을 수 있다고 전제하지 않는다. 저장된 회의·아카이브 형식과 DB 테이블은 변경하지 않는다.

## 3. 지원 조건과 먼저 확인할 사항

애플 전사·요약 기능의 제품 지원 시작점은 **macOS 26 이상, Apple silicon**으로 잡는다. 앱 전체의 최소 OS 버전은 올리지 않는다. Intel Mac·Windows·구형 macOS는 기존 기능을 유지한다. 이 조건은 제품 범위 결정이며 Speech의 모든 기술적 지원 범위를 단정하는 문장이 아니다.

| 기능 | 실행 전 확인 | 미충족 시 동작 |
| --- | --- | --- |
| 애플 음성 전사 | OS/아키텍처, helper 실행, `SpeechTranscriber.isAvailable`, 선택 locale 지원, 언어 자산 설치 상태 | 정확한 이유와 준비/재확인 동작 제공 |
| 애플 회의록 요약 | `SystemLanguageModel` availability, Apple Intelligence 활성화·모델 준비 상태, 입력 언어 지원 | 시스템 설정 안내 또는 준비 후 재시도 |

전사와 요약 가용성은 독립적으로 검사한다. Apple Intelligence가 꺼져 있다는 이유만으로 전사를 막지 않는다. OS 버전이나 파일 존재만으로 준비 완료로 표시하지 않는다.

초기 전사 대상 언어는 기존 로컬 전사와 동일한 한국어(`ko-KR`)로 한정한다. `supportedLocale(equivalentTo:)`/지원 locale 목록으로 실제 지원을 확인하고, 지원되지 않으면 명확히 비활성화한다. 다른 언어로 몰래 인식하거나 네트워크 기반 받아쓰기로 대체하지 않는다. 한국어가 목표 OS에서 지원되지 않거나 품질 기준에 미달하면 한국어용 애플 전사 출시는 보류한다. 애플 요약은 별도로 검증할 수 있다.

Foundation Models의 컨텍스트 한도에는 지시문·스키마·입력·출력이 함께 포함된다. 공개 문서의 4,096-token 예시를 모든 OS의 영구 상수로 취급하지 않는다. 선택한 SDK에서 지원되는 `contextSize`/토큰 계산 API의 availability를 확인하고 사용한다. 이전 OS 분기는 보수적 예산과 실제 초과 오류 처리가 필요하다. [컨텍스트 관리](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window)

## 4. 연결 구조

```text
설정 / 기존 처리 UI
  → 기존 IPC · ProcessingService
    → TranscriptionService → AppleSpeechTranscriptionAdapter
      → 기존 FFmpeg로 WebM → 임시 PCM WAV
      → 서명된 Swift helper → SpeechAnalyzer → 정규화된 전사
    → SummaryService → AppleFoundationSummaryAdapter
      → 같은 Swift helper → Foundation Models → 기존 요약 JSON
  → 기존 검증 · DB 저장 · 원본 보존 정책
```

Node 네이티브 애드온이나 별도 서버 대신 **앱에 포함한 Swift 실행 파일 하나**를 우선안으로 사용한다. 기존 프로세스 실행기를 재사용하고, 명령은 `status`, `prepare-speech`, `transcribe`, `summarize`로 제한한다. 이 방식이 서명된 MAS 샌드박스에서 실제로 동작하는지 1단계에서 검증한다. 실패하면 entitlement를 임의로 완화하지 않고 원인을 기록한 뒤 XPC 등 대체 연결 설계를 다시 결정한다.

helper는 해당 기능의 OS에서만 실행한다. 낮은 OS에서는 main에서 차단하여 동적 라이브러리 로딩 실패가 앱 실행에 영향을 주지 않게 한다. 앱 시작 시 모델 생성이나 다운로드를 실행하지 않는다.

### 프로세스 경계

- 요청은 stdin의 버전 있는 JSON, 응답은 stdout의 단일 JSON으로 제한한다. 예: `{ protocolVersion: 1, operation, payload }`, `{ protocolVersion: 1, ok, result?, error? }`.
- Swift와 TypeScript 양쪽에서 명령·필드·크기·숫자 범위를 검증한다. 버전 불일치나 잘못된 응답은 안전한 공급자 오류가 된다.
- 실행 파일은 앱 리소스 안의 검증된 절대 경로만 사용한다. PATH 탐색, 사용자 지정 실행 파일, shell 명령 문자열은 받지 않는다.
- 원문 전사·템플릿·키는 argv나 로그에 넣지 않는다. stderr 원문도 UI·DB 오류로 복사하지 않고 고정 오류 코드로 매핑한다.
- 음성 파일은 main이 생성·검증한 작업 디렉터리만 전달한다. symlink와 경로 이탈을 거부한다. 다운로드 URL이나 외부 파일을 helper가 임의로 열 수 있게 하지 않는다.
- 작업마다 helper를 실행하고 종료한다. 장기 실행 데몬·결과 캐시는 만들지 않는다. 초기에는 애플 모델 작업을 앱 내에서 하나씩 실행하도록 제한하고 대기 중 중복 실행을 막는다.
- `runOwnedProcess` 기본 10분/1MiB 한도를 그대로 가정하지 않는다. 상태 조회는 짧은 timeout, 전사·요약은 검증된 작업별 timeout과 유한 출력 상한을 명시한다. 2시간 전사 결과가 상한을 넘지 않는지 측정한다.
- 실패·timeout·종료 시 자식 프로세스를 정리하고 작업 소유 임시 파일만 제거한다. 앱 강제 종료로 남은 임시 파일은 다음 시작 시 살아 있는 작업이 아닌지 확인 후 정리한다. 원본 녹음은 이 정리에 포함하지 않는다.

## 5. 애플 전사

공급자 ID는 `apple_speech`, privacy는 `local`이다. `speaker_diarization` capability는 선언하지 않는다.

1. 가용성을 다시 확인한다. 모델이 없으면 자동 다운로드하지 않고 준비 필요 오류를 반환한다.
2. 기존 FFmpeg로 해당 녹음 파트를 PCM WAV로 변환한다. 기존 16kHz mono 변환을 시작점으로 사용하되 helper에서 Analyzer가 요구하는 포맷을 조회하고 `AVAudioConverter`로 맞춘다.
3. `SpeechTranscriber`를 한국어 locale과 시간 정보 옵션으로 구성한다. 파일을 순차 입력하고 최종 결과만 수집한다. 임시 인식 결과를 중복 저장하지 않는다.
4. 결과를 `{ durationSeconds, segments: [{ speakerLabel: null, startSeconds, endSeconds, text }] }`로 변환한다. 단어 시간 정보를 문장으로 합칠 경우 첫 시작과 마지막 끝을 사용한다.
5. 기존 TranscriptionService가 파트 오프셋·밀리초 변환·DB 저장을 처리한다. helper가 전체 회의 오프셋을 다시 더하지 않는다.

duration은 기존 요청의 녹음 길이를 우선 사용하고 없으면 PCM 측정값을 사용한다. 시간 범위가 duration을 크게 벗어나거나 역전되면 실패시킨다. 작은 변환 반올림 오차 허용 폭은 샘플 단위 측정 후 고정하고, 실제 오류를 숨기는 광범위한 clamp는 금지한다.

초기에는 `maxAudioDurationSeconds`를 임의로 설정하지 않고 기존 녹음 파트 단위로 처리한다. 구형 장시간 단일 파트를 실측하여 메모리/timeout 한계가 확인되면 기존 분할 기능에 상한만 추가한다. 이때 분할 파일의 신뢰 경로도 어댑터 입력 검증에 포함해야 한다.

화자는 추측하지 않는다. 기존 계약이 `speakerId: null`을 지원하므로 스키마 변경 없이 저장하고, UI에는 “애플 전사는 화자를 자동 구분하지 않습니다”라고 설명한다. 요약의 담당자 ID도 근거가 없으면 null이다.

### 언어 모델 준비

설정에 “한국어 음성 모델 준비”와 “상태 다시 확인”을 제공한다. 사용자가 준비를 실행하면 `AssetInventory`로 필요한 자산만 설치 요청한다. Apple이 관리하는 자산이므로 Whisper 다운로드 관리자나 `.bin` 경로를 재사용하지 않는다. 최초 준비에 인터넷이 필요할 수 있다는 점을 표시한다. 초기 버전은 준비 중 상태와 완료/실패만 표시하며 가짜 백분율은 표시하지 않는다. [SpeechAnalyzer 소개](https://developer.apple.com/videos/play/wwdc2025/277/)

## 6. 애플 요약과 긴 회의

공급자 ID는 `apple_foundation`, privacy는 `local`이다. 명시적으로 온디바이스 `SystemLanguageModel`을 사용한다. 외부 모델·PCC로 전환하지 않는다.

현재 `SummaryRequest`는 `input` 문자열과 JSON Schema뿐이다. 전사 문자열을 역파싱해 분할하지 않도록 다음 **선택적 구조화 필드 하나**를 추가한다.

```ts
context?: {
  sections: Array<{ id: string; title: string; kind: TemplateSectionKind; prompt: string }>
  transcript: Array<{ sourceIndex: number; speakerId: string | null; text: string }>
  speakerIds: string[]
}
```

SummaryService는 이미 조회한 자료로 이 필드를 구성한다. 기존 OpenAI·Codex 어댑터는 기존 `input`/`schema`만 계속 사용한다. 애플 어댑터는 context가 없으면 계약 오류로 처리한다. 날짜와 시각은 모델이 발명하지 않도록 현재 출처 인덱스 방식과 nullable 필드를 유지한다.

### 제한된 형태의 구조화 생성

기존 JSON Schema 전체를 Swift용 범용 스키마 변환기로 옮기지 않는다. 고정 `@Generable` 결과 타입으로 항목 텍스트·출처 인덱스·선택적 담당자·기한을 생성하고, 호출한 섹션의 ID와 kind는 어댑터가 부여한다. 기존 `sections`/`actionItems` JSON으로 조립한 뒤 SummaryService의 검증을 그대로 적용한다. 구조화 생성은 사실성 보장이 아니므로 잘못된 화자·출처·섹션 참조를 별도로 검사한다. [Guided generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation)

### 분할 및 병합 정책

1. 템플릿 **섹션별**로 처리해 최대 8개 섹션 × 2,000자 지시문을 한 요청에 싣지 않는다. 전사에는 전체 회의 기준 sourceIndex를 유지한다.
2. 섹션 지시문·출력 스키마·출력 여유를 뺀 입력 예산에 맞춰 전사 구간을 나눈다. 토큰 수를 문자 수와 동일하다고 가정하지 않는다.
3. 구간마다 새 세션에서 해당 섹션의 근거 있는 후보를 생성한다. 한 전사 줄 자체가 너무 길면 문장 경계에서 나누되 원래 sourceIndex를 유지한다.
4. 후보가 한 번에 들어가면 섹션별 최종 요약을 생성한다. 넘으면 예산에 맞는 묶음으로 축약하고, 최종 요청이 들어갈 때까지 크기를 줄인다. 각 결과는 원래 sourceIndex 집합에 속하는 값이나 null만 참조할 수 있다.
5. 병합 단계가 크기를 줄이지 못하거나 최소 입력조차 들어가지 않으면 명시적으로 실패한다. 원문 뒷부분을 잘라 성공 처리하지 않는다. 컨텍스트 초과 시 해당 구간을 더 작게 나누는 재시도는 입력 길이가 감소할 때만 허용한다.
6. 액션 항목은 별도 목록으로 보존해 일반 서술 요약 과정에서 유실되지 않게 한다. 정확히 같은 내용·담당자·기한·출처만 결정적으로 중복 제거한다. 최종 출력 상한을 넘으면 오류를 내며 임의 개수로 잘라내지 않는다.
7. 기존 응답 구조로 조립해 공통 검증 후 저장한다. 유효하지 않은 sourceIndex는 현재 동작처럼 시각을 null로 처리하고, 존재하지 않는 담당자 ID는 검증 실패로 처리한다.

큰 단일 템플릿 지시문이 예산을 차지해 처리할 수 없는 경우 `APPLE_SUMMARY_TEMPLATE_TOO_LARGE`로 안내하고 지시문 축소 또는 다른 공급자 선택을 제시한다. 다단계 요약의 정보 손실 가능성은 품질 검증 대상이며, OpenAI와 동등한 결과를 약속하지 않는다.

전사 내용은 데이터로, 앱의 지시는 별도 Instructions로 전달한다. 전사 안의 “이전 지시를 무시하라” 같은 문장을 명령으로 취급하지 않도록 구분하며 도구 실행 권한은 부여하지 않는다. 모델 거절·지원되지 않는 언어·잘못된 출력·컨텍스트 초과를 구분한다.

## 7. 설정·실행·실패 UX

현재 이분법 라디오 대신 기존 descriptor로 채운 **음성 변환 방식 / 회의록 작성 방식** 선택을 각각 제공한다. 새 복합 프리셋 체계는 만들지 않는다.

- macOS에서는 “Apple 음성 전사”, “Apple Intelligence 요약”과 각 준비 상태를 표시한다. 해당 기능을 지원하지 않는 Mac에서도 이유를 확인할 수 있다. Windows에는 애플 항목을 표시하지 않는다.
- 어느 단계든 OpenAI를 선택하면 API 키 입력을 표시한다. Apple 전사 + OpenAI 요약은 “음성은 기기에서 처리하고 전사문은 OpenAI로 전송”이라고 정확히 설명한다.
- 기존 Whisper 모델 관리·Codex 상태는 해당 공급자를 선택할 때만 표시한다. MAS의 기존 Whisper·Codex 비활성 정책은 유지한다.
- 애플을 선택했다고 Apple Intelligence를 앱이 켜거나 모델을 몰래 다운로드하지 않는다. 준비 버튼과 시스템 설정 안내, 재확인 동작을 제공한다.
- 저장된 공급자 선택은 유지한다. 준비 상태가 바뀌면 오류를 보여주며 자동으로 OpenAI로 덮어쓰지 않는다. 신규 설치 기본값도 이번에는 기존 OpenAI로 유지하고 애플 경로를 설정에서 명시적으로 선택하게 한다.

설정 repository의 reconcile은 “MAS면 무조건 OpenAI”가 아니라 **선택된 ID가 `local_whisper`/`codex_cli`이고 해당 기능이 비활성일 때만** 기존 보정 동작을 적용한다. 기존 app_settings JSON에 enum 값만 추가하므로 DB 마이그레이션은 필요 없다.

실행 도중 설정 변경이 다음 단계에서 클라우드 사용으로 바뀌지 않게 한 번의 처리 시도에 전사·요약 공급자 설정을 고정한다. 현재 두 서비스는 각 단계에서 설정을 다시 읽으므로, 실행 시작 시 해석한 공급자를 서비스에 전달하도록 최소 변경한다. 실패 후 사용자가 누르는 새 재시도에는 현재 선택을 반영한다. 전체 실행에 선택된 두 단계의 준비 상태를 미리 확인하되, 실행 직전 어댑터도 다시 검사한다.

실패는 기존 ProviderError/처리 상태 UI로 연결한다. 대표 코드는 OS/기기 미지원, locale 미지원, 모델 미준비, Apple Intelligence 꺼짐, helper 실패, timeout, 컨텍스트 초과, 템플릿 과대, 모델 거절, 출력 검증 실패이다. 환경 변경 후 회복 가능한 실패는 재시도 가능으로 분류한다. 요약 실패 시 저장된 전사를 사용해 요약 단계부터 재시도하고 원본 녹음 삭제는 기존 성공 후 정책을 따른다.

## 8. 빌드·서명·개인정보

- `native/apple-processing/`에 작은 Swift executable target을 추가하고, macOS 빌드에서만 생성한다. SDK와 배포 target을 고정하고 사용하는 API의 `#available` 조건을 컴파일로 확인한다. macOS 27 전용/베타 API는 첫 구현의 필수 의존성으로 삼지 않는다.
- 앱 리소스에 helper를 포함하고 기존 `after-pack.mjs`/로컬 서명 경로에서 함께 서명한다. MAS와 DMG 모두 검증하되 초점은 arm64 MAS이다. Windows 패키지에는 포함하지 않는다.
- FFmpeg 경로 조회가 현재 Whisper 실행 파일까지 함께 요구하므로, 애플 경로는 FFmpeg만 검증할 수 있도록 기존 함수에서 필요한 부분만 분리한다. 별도 FFmpeg 다운로드나 새 오디오 라이브러리는 추가하지 않는다.
- MAS helper는 기존 sandbox inheritance 구성을 출발점으로 삼는다. Speech와 Foundation Models의 실제 entitlement/권한 요구, helper의 모델 서비스 접근 및 언어 자산 설치를 **서명된 mas-dev 앱**에서 검증한다. 개발용 CLI 성공만으로 통과 처리하지 않는다.
- 마이크 권한은 기존 Electron 녹음 경로가 담당한다. 파일 전사에 추가 Speech 권한/usage description이 필요한지는 선택 API·SDK의 공식 요구와 실기기 결과로 확정한다. 근거 없이 entitlement를 늘리지 않는다.
- 번들 FFmpeg의 외부 dylib 의존성과 서명도 점검한다. 현재 build-local-runtime 및 after-pack 검사를 확장하고 시스템에 설치된 Homebrew에 의존하지 않게 한다.
- 로컬 처리 중 녹음·전사문을 외부로 전송하지 않는다. Apple 모델 준비를 위한 다운로드와 실제 회의 데이터 처리를 개인정보 설명에서 구분한다. 로그에는 작업 상태·고정 오류 코드만 남긴다.
- 새 빌드 배포 시 README, 개인정보 정책, 지원 문서, App Store 메타데이터에 지원 조건·화자 구분 제한·모델 준비 절차를 반영한다. 이번 설계 작업에서는 출시된 기능처럼 기존 문구를 바꾸지 않는다.

## 9. 구현 순서와 완료 기준

### 1단계 — 실제 Mac에서 가능 여부 확인

서명된 mas-dev 패키지에서 helper 상태 조회, 한국어 자산 준비, 현재 앱의 짧은 WebM → WAV → 최종 전사, 짧은 구조화 요약을 실행한다. API 키 없이 실행하며 모델 준비 후 네트워크를 끈 조건도 확인한다. OS·칩·SDK·언어·모델 상태와 결과를 기록한다.

**진행 조건:** 한국어 지원, 파일 변환, MAS helper 접근, 요약 가용성 모두 확인. 막힌 항목은 해결 전 해당 기능을 출시 가능으로 표시하지 않는다. Windows에서의 코드 검토로 대체하지 않는다.

### 2단계 — 기존 처리 흐름 연결

ID·어댑터·구조화 요약 context·설정 UI·준비 IPC를 추가한다. 준비 IPC는 기존 SettingsApi/preload/registerSettingsHandlers에 작은 메서드로 넣고 범용 native 실행 API는 노출하지 않는다. 공급자 고정, 기존 설정 유지, 실패 단계 재시도와 원본 보존까지 연결한다.

### 3단계 — 긴 회의와 패키지 검증

2시간 회의, 여러 녹음 파트, 긴 단일 전사 줄, 최대 템플릿 크기, 무음, 모델 미준비, 앱 종료 상황을 확인한다. 성능은 소요시간·최대 메모리·임시 디스크 사용량을 기록하고 그 결과로 작업 timeout/출력 상한을 정한다. 요약의 결정 사항·담당 업무 누락과 출처 시각 정확도를 사람이 점검한다.

회귀 테스트는 아래 고유 실패만 직접 검증한다. 전체 release suite는 실제 릴리스 준비 시 별도로 실행한다.

| 검증 위치 | 반드시 잡을 실패 |
| --- | --- |
| 설정 repository/UI 테스트 | 기존 선택 보존, MAS에서 애플 ID를 OpenAI로 덮어쓰지 않음, 혼합 선택의 키·전송 안내 |
| 어댑터/Swift 계약 테스트 | protocol 불일치, 잘못된 파일 경로·시간·출력, helper 실패 및 정리 |
| 요약 분할 테스트 | 모든 입력 구간 포함, 원래 sourceIndex 유지, 한도 초과 종료, 액션 항목 유실 방지 |
| 기존 처리 integration 테스트 확장 | 실행 중 설정 변경으로 클라우드 전환 없음, 요약 실패 시 전사 보존·요약 재시도, 성공 전 원본 삭제 없음 |
| 실제 서명된 Mac 앱 | framework 로딩·한국어 지원·권한·모델 다운로드·오프라인 처리·긴 회의 품질 |

## 10. 개발 시 변경할 파일 범위

필수 변경 후보는 `settings.ts`, `providerPorts.ts`, `processingSettingsRepository.ts`, `index.ts`, `summaryService.ts`, 처리 시도에 공급자를 전달하는 서비스 경계, `ProcessingProviderSettings.tsx`, 설정 IPC/preload 및 오류 표시이다. 새 파일은 애플 어댑터 두 개, 작은 helper 호출 모듈, Swift target과 필요한 빌드 스크립트로 제한한다. 별도 provider framework, DB 테이블, 새 녹음 포맷은 만들지 않는다.

## 11. 공식 참고 자료와 확인 한계

- [SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer): 음성 처리 API.
- [SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber): 기기·locale 지원 상태 확인.
- [WWDC25: SpeechAnalyzer](https://developer.apple.com/videos/play/wwdc2025/277/): 시간 정보, 오디오 포맷, 언어 자산 설치 흐름.
- [Foundation Models로 콘텐츠 생성](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models): 온디바이스 모델 사용.
- [SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel): 모델 가용성과 지원 조건.
- [Guided generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation): 구조화 결과.
- [컨텍스트 관리](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window): 입력·출력 예산과 초과 처리.

2026-09-26 공식 문서와 현재 저장소의 정적 흐름을 확인했다. 웹 문서에는 후속 OS API도 섞여 있으므로 정확한 메서드 시그니처와 availability는 구현 SDK에서 재확인해야 한다. 한국어 전사 품질, MAS helper 권한, 성능, 심사 통과 여부는 아직 검증되지 않았다.

## 12. 2026-10-12 구현·실기기 확인 기록

작업 트리의 Apple 공급자 구현을 이어서 점검했다. macOS 26.5.2 / arm64 / Xcode 26.6에서 Swift 6 helper 빌드와 앱 TypeScript 검사·빌드가 통과했다. 설정 보존, 처리 시도 공급자 고정, helper 경계, 음성 임시 파일 정리 및 서명 관련 최소 테스트 6개 파일 / 72개가 통과했다. 전체 release suite는 실행하지 않았다.

추가로 고친 부분:

- Swift JSON에서 화자·출처·담당자·기한의 null을 생략하지 않고 기존 공통 계약대로 출력한다.
- 긴 요약 병합에서 후보 순번을 원본 sourceIndex로 바꾸지 않는다. 출처 없는 서술은 null로 유지한다. 축약이 입력 크기를 줄이지 못하면 종료한다.
- macOS 26.4 이상에서는 실제 토큰 계산으로 템플릿 초과를 판정한다.
- helper 입력 필드를 검증하고 stdin 읽기 크기를 제한한다.
- 앱 종료 시 helper 및 Apple 경로의 FFmpeg 작업을 취소한다.

Swift 순수 계약 검증은 `bash scripts/test-apple-processing.sh`로 실행할 수 있다. null 출력, 긴 한국어 줄의 누락 없는 분할, 원래 sourceIndex 유지, 출처 없는 데이터 및 알 수 없는 요청 필드 거부를 직접 검증한다.

실제 helper에서 Apple Intelligence 활성화·모델 준비 후 API 키 없는 한국어 구조화 요약이 생성됐다. 짧은 두 결정 사항 샘플에서 한 항목이 누락돼 품질 통과로 판정하지 않았다. 사용자 요청으로 한국어 Speech 자산 준비를 실행했고 speech/summary 모두 available 상태가 확인됐다.

`npm run package:mas-dev:arm64`로 Apple Development 서명 패키지 생성 및 `codesign --verify --deep --strict` 검증은 통과했다. 그러나 실행은 `No matching profile found`로 차단됐다. 이 Mac에는 해당 팀·앱 ID의 개발 provisioning profile이 없다. Mineloa용 Mac 개발 프로필과 이 Mac 등록을 갖춘 뒤 패키지를 최신 소스로 다시 생성하고 MAS 내부의 상태 조회·자산 설치·전사·요약을 검증해야 한다. 서명 확인만으로 1단계 완료나 출시 가능 상태로 판정하지 않는다.

남은 필수 검증: 실제 서명된 MAS 앱, 네트워크를 끈 조건, 장시간 회의의 성능·품질, 강제 종료 후 임시 파일 정리. README·스토어 메타데이터에 출시 기능으로 반영하지 않았다.

추가 실기기 결과: 합성 한국어 음성을 Chromium MediaRecorder로 앱과 같은 WebM/Opus에 담고 번들 FFmpeg로 16kHz mono PCM WAV로 변환한 뒤 SpeechAnalyzer의 최종 결과를 받았다. 약 3.84초 샘플에서 “오늘 회의에서는 다음 배포를 금요일에 하기로 결정했습니다.”가 null 화자와 구간 시각으로 정상 반환됐다. 변환기의 EOF 이후 추가 읽기에서 발생하던 오류를 수정했고, 마지막 PCM 버퍼가 부분 길이일 때도 정확한 프레임 수로 변환되는 Swift 회귀 검증을 추가했다. 이 확인은 CLI 조건이며 MAS 샌드박스·오프라인 실측·실제 회의 품질 검증을 대체하지 않는다.

## 13. 2026-10-14 Mac 개발 서명 준비

사용자가 승인한 범위에서 CHANMI KIM 팀(J3W2GDPJ7Y)에 현재 Mac을 개발 기기로 등록하고 이 Mac의 로컬 개인키에 대응하는 Apple Development 인증서를 발급했다. 개인키는 저장소 밖의 로컬 키체인 및 접근 제한된 서명 자료 디렉터리에 보관한다. `Mineloa Mac Development 2026-10-14` 프로필은 `com.jdeploys.mineloa`, 새 인증서, 현재 Mac만 포함하며 2027-10-14에 만료된다. 다운로드한 프로필의 앱 ID·인증서 SHA-1·기기 일치를 검증하고 Xcode의 로컬 프로필 디렉터리에 설치했다. 기존 배포 인증서와 제출용 프로필은 수정하지 않았다.

새 Xcode 27의 사용권 미동의로 Swift 빌드가 중단됐다. Xcode 동의 화면을 열었고 사용자에게 직접 동의를 요청했다. 이 동의가 끝난 뒤 새 개발 프로필 및 같은 팀의 인증서로 mas-dev를 재빌드하고 실행 검증을 이어가야 한다.

Xcode 사용권 동의가 반영된 뒤 Xcode 27에서 Swift helper 빌드와 Swift 계약 검증을 통과했다. MAS 개발판 빌드는 `MAS_APP_SIGNING_IDENTITY`와 `CSC_NAME`에 해당 프로필에 포함된 개발 인증서를 지정하고 `--config.masDev.provisioningProfile=<개발 프로필 경로>`로 수행한다. 로컬 개발 서명에는 `--config.masDev.timestamp=none`을 사용했다. 키체인의 최초 서명키 사용 승인은 사용자가 직접 완료했다.

실행 검증에서 Apple silicon의 일반 하드웨어 UUID와 Provisioning UDID가 다름을 확인했다. 최초 하드웨어 UUID 등록은 이 Mac의 실행 허가에 유효하지 않았으며, `system_profiler SPHardwareDataType`의 `provisioning_UDID`로 개발 기기를 등록하고 프로필의 포함 기기를 교체했다. 수정된 프로필·인증서의 일치를 확인한 후 번들의 embedded.provisionprofile을 갱신하고 entitlements를 보존해 재서명했다. `codesign --verify --deep --strict`를 통과했고 실제 mas-dev 앱 창이 열렸다. 설정 UI에서 Apple 음성 전사와 Apple Intelligence 요약을 선택·저장했으며 helper 상태 조회에서 두 공급자 모두 미준비 오류 없이 사용 가능했다. 실제 MAS 회의 전사·요약 작업 및 오프라인·장시간 품질 검증은 별도로 남아 있다.

## 14. 2026-10-14 기존 데이터 처리 수정 및 재검증

기존 99.234초 녹음을 보존한 아카이브 복사본을 서명된 mas-dev 앱에 가져와 처리했다. 전사는 완료됐지만 요약의 helper 출력 검증이 두 차례 실패했다. 공통 SummaryService 계약과 맞추어 잘못된 출처 참조는 null로 정규화하고, 화자 ID가 없는 전사에서는 생성된 담당자 ID를 null로 처리했다. 알려진 화자가 있는 경우 알 수 없는 담당자 ID는 계속 거부한다. 단일 구간 요약의 불필요한 재생성을 제거하고, 전사에 없는 결정·업무를 추측하지 않는 지시 및 출처 번호와 생성 항목 순번의 구분을 강화했다.

Swift 회귀 검증에 범위 밖 출처·화자 없는 입력의 담당자 정규화와 알려진 화자 목록의 외부 담당자 거부를 추가했다. Swift 계약 검증, TypeScript 검사, diff 공백 검사 및 서명 검증이 통과했다. 같은 기존 녹음을 새 복사본에서 전사부터 처리하여 앱 UI의 회의록 생성 완료와 결과 저장을 확인했다. 해당 샘플은 불명확한 발화가 포함돼 핵심 요약 품질은 제한적이지만, 근거 없는 결정사항과 할 일은 생성하지 않았으며 주요 논의의 출처 시각이 전사와 일치했다. 원래 DB·오디오·요약은 변경하지 않았다. 장시간 회의 및 오프라인 검증은 미완료다.

## 15. 정답 대본이 있는 한국어 낭독 기준 샘플

2026-10-14 `google/fleurs`의 `ko_kr/test` 첫 3개 공개 샘플을 내려받아 현재 helper에 PCM WAV로 직접 입력했다. WebM 변환·MAS UI를 제외해 전사 모델의 기본 인식 상태를 분리한 검사다. 길이는 각각 12.48초, 10.80초, 8.94초다. NFC 정규화 후 띄어쓰기·문장부호를 제거한 정답 53/41/33글자에 대해 편집거리는 1/2/0, 합계 CER은 3/127=2.36%였다. 숫자 표기 차이도 이 지표의 오류에 포함한다. 셋째 문장은 정답과 일치했다. 데이터 출처: https://huggingface.co/datasets/google/fleurs .

이 전사 3개를 기본 템플릿으로 요약했을 때 주요 수치·날짜·사실을 보존하고 actionItems는 비어 있었지만 역사적 사실을 결정사항 섹션에도 반복해 넣었다. 따라서 짧은 낭독 전사 기준은 양호하나 회의용 요약의 섹션 분류 품질은 추가 개선이 필요하다. 3개 샘플로 일반 회의·먼 거리 음성·장시간 품질을 일반화하지 않는다.
