# App Review 보완 — 2026-07-23

대상 제출: `98ff401e-e519-42ac-b4c4-822d0169951a`

거절 빌드: `1.0 (3)`

재제출 빌드: `1.0 (4)`

## App Store Connect 변경 체크리스트

- [ ] **Pricing and Availability → App Availability → Manage Availability**에서
  `China mainland`를 해제하고 변경을 확인한다.
- [ ] 모든 향후 신규 국가/지역에 자동 배포하는 옵션이 켜져 있다면 끈다.
- [ ] macOS 1.0 버전의 Support URL을
  `https://github.com/jdeploys/Mineloa/blob/main/SUPPORT.md`로 변경한다.
- [ ] 새 지원 페이지가 로그인 없이 공개적으로 열리는지 시크릿 창에서 확인한다.
- [ ] Review Notes에 `docs/app-store/metadata.ko.md`의 8–10번 내용을 추가한다.
- [ ] 새 빌드 `1.0 (4)`를 업로드하고 선택한다.
- [ ] TestFlight 또는 설치 가능한 개발 서명판에서 주 창을 닫은 뒤
  **Window → Mineloa**, **Command–0**, Dock 클릭을 각각 확인한다.

## App Store Connect 답변 초안

안녕하세요. 자세한 검토 의견을 보내주셔서 감사합니다.

Guideline 5와 관련하여, OpenAI 기능이 포함된 Mineloa는 중국 본토 App Store에서
배포하지 않기로 했습니다. App Store Connect의 Pricing and Availability에서
China mainland를 배포 대상에서 제외했습니다. 이 빌드는 중국 본토에서 제공되지
않으며 다른 선택 지역에서만 제공됩니다.

Guideline 4와 관련하여, 빌드 1.0 (4)에 macOS Window 메뉴를 추가했습니다. 사용자는
주 창을 닫은 뒤 메뉴 막대에서 “Window → Mineloa”를 선택하거나 Command–0을 눌러
주 창을 다시 열 수 있습니다. Dock에서 앱을 다시 활성화해도 주 창이 다시 열립니다.

Guideline 1.5와 관련하여, Support URL을 아래 공개 지원 페이지로 변경했습니다.
이 페이지에는 질문 및 지원 요청 방법, 요청 시 포함할 정보, 자주 발생하는 문제의
해결 방법과 개인정보 보호 안내가 포함되어 있습니다.

https://github.com/jdeploys/Mineloa/blob/main/SUPPORT.md

검토해 주셔서 감사합니다.

---

Hello,

Thank you for the detailed review feedback.

For Guideline 5, we have chosen not to distribute Mineloa, which includes OpenAI
functionality, on the China mainland App Store. We deselected China mainland in
Pricing and Availability in App Store Connect. This build is not available in
China mainland and is distributed only in the other selected regions.

For Guideline 4, build 1.0 (4) adds a macOS Window menu. After closing the main
window, users can reopen it by choosing “Window → Mineloa,” pressing Command–0,
or activating the app again from the Dock.

For Guideline 1.5, we changed the Support URL to the public support page below.
It provides instructions for asking questions and requesting support, the
information users should include, troubleshooting guidance, and privacy
precautions.

https://github.com/jdeploys/Mineloa/blob/main/SUPPORT.md

Thank you for your review.

## 2026-10-14 후속 2.1(a) 대응 및 재제출 완료

7월 26일 빌드 1.0 (4)의 후속 심사는 전사·요약 기능 검토용 API 키 또는 전체 기능 데모를 요구했다. Apple Speech와 Apple Foundation Models를 신규 Mac 설치의 기본 처리 방식으로 제공하도록 변경했다. 기존 설치에는 공급자 선택이 보존되므로 심사자가 설정에서 Apple 두 공급자를 선택하도록 안내했다. AMI 샘플은 보조 튜토리얼로 명시했다.

- 제출 버전/빌드: **1.0 (5)**
- 재제출 확인: **2026-10-14 11:38 KST**, App Store Connect **심사 대기 중**
- 제출 ID: `98ff401e-e519-42ac-b4c4-822d0169951a`
- 빌드/Delivery UUID: `c21b9943-656d-4659-a30a-cbce9a443704`
- 배포 검증·서명·업로드 성공: https://github.com/jdeploys/mineloa/actions/runs/38499622750
- 심사 페이지: https://appstoreconnect.apple.com/apps/6792231571/distribution/reviewsubmissions/details/98ff401e-e519-42ac-b4c4-822d0169951a

제품 설명과 심사 메모에 Apple 기본 처리, 지원 기기/OS, 모델 준비, 새 녹음으로 실제 처리 검토 방법을 반영했다. 콘텐츠 권한을 허가된 타사 콘텐츠 포함으로 변경했으며 중국 본토 배포 제외를 확인했다. 소명 답변은 11:23 KST 발송했고 `mineloa-app-review-apple-defaults.png` 설정 화면을 첨부했다. 출시 방식은 기존 수동 출시를 유지했다.

배포 과정에서 패키징 테스트의 Apple helper 기대값을 수정하고, electron-builder의 임시 키체인 암호 불일치를 피하도록 기존 인증서를 전용 임시 키체인에 가져와 서명했다. 인증서·프로파일·API 키는 저장소에 포함하지 않았다.

이 Mac의 한국어 전사→요약 완료와 신규 설치 기본 선택은 확인했다. 영어 전사는 모델 준비가 20분 넘게 완료되지 않아 로컬 실행 검증을 완료하지 못했다. 재제출 완료는 심사 승인을 의미하지 않는다.
