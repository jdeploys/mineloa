# Mineloa 배포 가이드

## Mac App Store 배포 스크립트

```bash
npm run deploy:app-store -- --version 1.0 --build 6
```

커밋하고 원격 브랜치에 푸시한 상태에서 실행합니다. `git`, Node.js, GitHub CLI(`gh`)와 이 저장소의 Actions 실행 권한이 필요합니다. `gh auth login`으로 로그인합니다. 위의 `6`은 이미 업로드한 `1.0 (5)` 다음 번호 예시이며, 업로드마다 사용하지 않은 빌드 번호를 지정합니다.

스크립트는 `.github/workflows/app-store.yml`을 실행하고 해당 실행을 기다립니다. CI가 테스트, Apple helper와 런타임 빌드, 배포 인증서 서명, 패키지 검증, App Store Connect 업로드를 수행합니다. 성공하면 패키지와 검증 로그를 `dist/app-store-<버전>-<빌드>/<실행 ID>/`에 다운로드합니다. 실패 시 0이 아닌 종료 코드를 반환하며 출력된 Actions 링크에서 원인을 확인합니다.

- 명령만 확인: `npm run deploy:app-store -- --version 1.0 --build 6 --dry-run`
- 업로드 없이 서명 패키지 생성: `npm run deploy:app-store -- --version 1.0 --build 6 --build-only`

서명 자료는 GitHub `app-store` environment의 기존 secrets를 사용합니다. 로컬에 인증서나 API 키를 복사할 필요가 없습니다. 환경을 새로 만들 때 필요한 secrets는 `MAS_PROVISIONING_PROFILE_BASE64`, `MAS_CERTIFICATE_P12_BASE64`, `MAS_INSTALLER_CERTIFICATE_P12_BASE64`, `MAS_CERTIFICATE_PASSWORD`, `ASC_API_PRIVATE_KEY`, `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`입니다.

이 명령의 완료 범위는 **빌드 업로드**입니다. Apple의 빌드 처리가 끝난 뒤 App Store Connect에서 빌드 선택, 메타데이터 확인, 심사 제출과 소명을 진행합니다. 현재 심사 대기 중인 1.0 (5)을 바꾸거나 심사를 취소하지 않습니다.

## 현재 자동화 동작

- `main`에 푸시하면 `.github/workflows/ci.yml`의 빠른 CI만 실행됩니다. 릴리스나 설치 파일 업로드는 하지 않습니다.
- 전체 단위·통합·E2E·시각 검증과 Windows/macOS 패키징은 `.github/workflows/release.yml`에서만 실행됩니다.
- 릴리스 워크플로우는 `package.json`의 버전을 산출물명과 릴리스 제목에 사용하고, `v${version}` 태그와 일치하는지 확인합니다.
- `workflow_dispatch`로 수동 실행하면 플랫폼별 패키지는 만들지만, 최종 GitHub Release 업로드 작업은 태그 실행이 아니므로 건너뜁니다.

`main` 푸시마다 자동 배포하지 않는 이유는 Windows와 macOS 두 아키텍처의 패키징 비용을 매 변경마다 발생시키지 않기 위해서입니다.

## 권장 배포 절차

다음 버전이 `0.0.2`라면 아래 순서로 진행합니다.

1. `package.json`의 버전을 `0.0.2`로 변경합니다.
2. 변경을 `main`에 푸시하고 빠른 CI가 통과하는지 확인합니다.
3. 검증된 `main` 커밋에 `v${version}` 태그를 만들고 푸시합니다.

```powershell
git switch main
git pull --ff-only
git tag -a v0.0.2 -m "Mineloa 0.0.2"
git push origin v0.0.2
```

태그 푸시 후 릴리스 워크플로우가 다음 작업을 수행합니다.

1. 릴리스 전체 테스트 실행
2. Windows x64 설치 파일 생성과 검증
3. macOS Intel·Apple Silicon DMG 생성과 검증
4. SHA-256 체크섬 생성
5. GitHub prerelease 자산 업로드

## 주의사항

- 기존 `v0.0.1` 태그를 강제로 옮겨 재배포하지 않습니다. 변경 사항은 새 버전과 새 태그로 배포합니다.
- `main` CI 통과만으로 Windows/macOS 패키지가 검증됐다고 판단하지 않습니다.
- 코드 서명과 notarization 상태는 [릴리스 인수 매트릭스](acceptance-matrix.md)에서 별도로 확인합니다.
