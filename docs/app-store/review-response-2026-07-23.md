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
