# Mineloa 배포 가이드

## 현재 자동화 동작

- `main`에 푸시하면 `.github/workflows/ci.yml`의 빠른 CI만 실행됩니다. 릴리스나 설치 파일 업로드는 하지 않습니다.
- 전체 단위·통합·E2E·시각 검증과 Windows/macOS 패키징은 `.github/workflows/release.yml`에서만 실행됩니다.
- 현재 릴리스 워크플로우는 `v0.0.1` 태그와 파일명에 맞춰 하드코딩되어 있습니다.
- `workflow_dispatch`로 수동 실행하면 플랫폼별 패키지는 만들지만, 최종 GitHub Release 업로드 작업은 태그 실행이 아니므로 건너뜁니다.

`main` 푸시마다 자동 배포하지 않는 이유는 Windows와 macOS 두 아키텍처의 패키징 비용을 매 변경마다 발생시키지 않기 위해서입니다.

## 권장 배포 절차

다음 버전이 `0.0.2`라면 아래 순서로 진행합니다.

1. `package.json`의 버전을 `0.0.2`로 변경합니다.
2. `.github/workflows/release.yml`에 하드코딩된 `v0.0.1`, `0.0.1` 태그·파일명·릴리스 제목을 `v0.0.2`, `0.0.2`로 변경합니다.
3. 변경을 `main`에 푸시하고 빠른 CI가 통과하는지 확인합니다.
4. 검증된 `main` 커밋에 태그를 만들고 푸시합니다.

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
