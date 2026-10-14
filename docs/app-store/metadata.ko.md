# Mineloa App Store 메타데이터 (한국어)

## 앱 정보

- 이름: Mineloa
- 부제: 회의를 녹음하고 전사·요약
- 기본 카테고리: 생산성
- 보조 카테고리: 비즈니스
- 콘텐츠 권한: AMI Meeting Corpus 영어 샘플 음원·수동 전사 포함. CC BY 4.0에 따라 출처·라이선스·편집 내역 표시.
- 버전: 1.0
- 저작권: 2026 Mineloa

## 제품 페이지

- 프로모션 텍스트: 회의 녹음부터 전사, 구조화된 요약과 실행 항목까지 한곳에서 관리하세요. 기록은 기본적으로 이 Mac에 저장됩니다.
- 키워드: 회의,녹음,전사,요약,회의록,생산성,음성,Whisper,OpenAI
- 지원 URL: https://github.com/jdeploys/Mineloa/blob/main/SUPPORT.md
- 마케팅 URL: https://github.com/jdeploys/Mineloa

### 설명

Mineloa는 회의를 녹음하고 전사·요약해 주는 독립 실행형 macOS 앱입니다. Mineloa 계정이나 별도 서버 없이 바로 시작할 수 있으며, 회의 기록은 기본적으로 이 Mac에 저장됩니다.

주요 기능

• 회의 녹음, 일시정지, 재개 및 안전한 복구
• Apple 음성 전사와 Apple Intelligence를 이용한 기기 내 구조화 요약 (기본 처리 방식)
• 선택 기능: OpenAI를 이용한 화자 분리 전사와 구조화 요약
• 원하는 항목과 순서로 구성하는 요약 템플릿
• 화자 이름 수정과 회의별 원본 오디오 보존 정책
• Mineloa 기록 파일 가져오기·내보내기 및 Markdown 내보내기
• 라이트·다크 테마

Apple 기본 처리는 Apple silicon Mac과 macOS 26 이상, Apple Intelligence 활성화 및 모델 준비가 필요합니다. 음성과 전사문을 외부 AI 서비스로 전송하지 않습니다.

선택 기능인 OpenAI는 사용자가 직접 입력한 OpenAI API 키를 사용합니다. 선택한 처리 방식에 필요한 데이터만 전송되며, 로컬 Whisper 전사는 오디오를 외부 AI 서비스로 전송하지 않습니다. API 키는 macOS Keychain에 저장됩니다.

로그인이나 API 키 없이도 녹음과 로컬 기록 관리를 사용할 수 있습니다. 네트워크 오류나 AI 처리 실패가 발생해도 원본 녹음은 안전하게 유지됩니다.

## 앱 심사 정보

- 로그인 필요: 아니요
- 출시 방식: 수동 출시

### 심사 메모

Mineloa 계정 로그인은 필요하지 않습니다.

기본 검토 절차:
1. Apple silicon Mac, macOS 26 이상에서 실행합니다. 신규 설치의 전사·요약 기본 공급자는 Apple이며 OpenAI API 키나 Mineloa 계정이 필요하지 않습니다.
2. 시스템 설정 → Apple Intelligence 및 Siri에서 Apple Intelligence를 활성화하고 모델 다운로드가 완료될 때까지 기다립니다.
3. 앱 설정 → 처리 방식에서 Apple 음성 전사 / Apple Intelligence 요약을 확인하고 ‘음성 모델 준비’를 누릅니다. Mac의 기본 언어가 한국어이면 한국어, 그 외에는 영어 전사를 사용합니다. 모델 준비에는 인터넷이 필요할 수 있습니다. ‘상태 다시 확인’으로 두 공급자의 준비 상태를 확인합니다.
4. ‘녹음 시작’을 누르고 선택된 전사 언어로 짧은 회의를 녹음합니다. 녹음을 종료한 뒤 ‘회의록 만들기’를 누릅니다. 전사와 요약은 Mac에서 실행되며 OpenAI로 전송하지 않습니다.
5. 생성된 전사·요약·할 일, 화자 이름 편집, 오디오 보존, 기록 파일 및 Markdown 내보내기를 검토합니다. Apple 전사는 화자를 자동 분리하지 않습니다.
6. 첫 실행의 AMI 영어 샘플은 재생·문서·내보내기 사용법을 보여주는 보조 예제입니다. 수동 전사와 미리 작성한 요약이며, 실제 처리 검증은 4번의 새 녹음으로 진행합니다.
7. OpenAI는 사용자가 선택할 수 있는 선택 공급자이며 개인 API 키가 필요합니다. 모델 미준비나 미지원 환경에서 OpenAI로 자동 전환하지 않습니다. App Store판에는 외부 Codex CLI와 로컬 Whisper 공급자가 포함되지 않습니다.

파일 가져오기와 내보내기는 사용자가 macOS 파일 선택 대화상자에서 명시적으로 고른 파일에만 접근합니다.

2026년 7월 23일 심사 의견 반영:

8. 중국 본토 App Store는 Pricing and Availability의 App Availability에서 배포 대상에서 제외했습니다. OpenAI 기능이 포함된 이 빌드는 중국 본토에서 제공되지 않습니다.
9. 주 창을 닫은 뒤에도 macOS 메뉴 막대의 “Window → Mineloa” 또는 Command–0으로 주 창을 다시 열 수 있습니다. Dock에서 앱을 다시 활성화해도 주 창이 열립니다.
10. Support URL을 사용자가 질문 및 지원 요청 방법, 필수 진단 정보, 자주 발생하는 문제와 개인정보 보호 주의사항을 확인할 수 있는 공개 지원 페이지로 변경했습니다.

### App Review Notes (English — build 1.0 (5))

Mineloa now uses Apple Speech transcription and the on-device Apple Foundation Models summarizer by default on fresh Mac installations. No Mineloa account or OpenAI API key is required for this primary workflow. OpenAI remains an optional provider selected explicitly by the user.

Please test on an Apple silicon Mac running macOS 26 or later:
1. Enable Apple Intelligence in System Settings > Apple Intelligence & Siri, and wait for its models to finish downloading.
2. In Mineloa Settings (설정), confirm Apple 음성 전사 and Apple Intelligence 요약 are selected. Click 음성 모델 준비 to prepare the speech model, then 상태 다시 확인 to refresh readiness. Speech uses Korean when the Mac's first preferred language is Korean; otherwise it uses English. Initial model preparation may require internet access.
3. Start a new recording (녹음 시작), speak a short meeting in that language, and stop recording. Click 회의록 만들기 to transcribe and summarize the new recording on this Mac.
4. Review the transcript, structured summary and action items. Test audio retention and meeting/Markdown export. Apple Speech does not automatically separate speakers.

The bundled AMI English sample is supplementary onboarding content. It contains an original audio excerpt, manual transcript and a prewritten example summary, clearly labeled with source and CC BY 4.0 attribution. It is not presented as generated output. Please use a new recording to test the actual Apple processing workflow.

Existing installations preserve their saved provider choice; if updating a previous review installation, choose the two Apple providers explicitly in Settings. The app never silently switches from Apple processing to OpenAI. The App Store build does not expose external Codex CLI or local Whisper providers.
