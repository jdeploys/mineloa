# Nnote 0.1.0 릴리스 인수 매트릭스

작성일: 2026-07-15 (Asia/Seoul)

`PASS`는 표에 적힌 명령과 환경에서 실제 실행한 항목만 뜻합니다. 다른 운영체제나 실제 장치 결과를 추론하지 않습니다.

## 자동 검증

| 대상 | 환경 | 결과 | 실제 신호 |
|---|---|---:|---|
| 단위·통합 테스트 | Windows 10.0.26200, Node 22.14.0, 로컬 | PASS | `npm test`: 39 files, 311 tests |
| TypeScript / ESLint / build | Windows 10.0.26200, 로컬 | PASS | `npm run lint`, `npm run typecheck`, `npm run build`: exit 0 |
| 실제 Electron E2E | Windows 10.0.26200, Electron 43.1.0, 로컬 | PASS | secure renderer, Chromium fake WAV 녹음 후 `recorded`, detail 처리/내보내기 및 dashboard 가져오기 동작 진입점; 1/1 |
| Windows 시각 회귀 | Windows 10.0.26200, Chromium, 로컬 | PASS | dashboard 녹음 telemetry/일시정지/가져오기와 detail 처리/내보내기 포함 6/6 픽셀 비교 |
| win-unpacked 런타임 | Windows 10.0.26200, 로컬 | PASS | `main/sqlite/keyring/preload/renderer` 모두 `true` |
| Windows 설치 프로그램 | Windows 10.0.26200, 로컬 | PASS | `dist/Nnote Setup 0.1.0.exe` 생성; Authenticode `NotSigned` |
| 릴리스 내용 allowlist | Windows 10.0.26200, 로컬 | PASS | ASAR에 `out`, package metadata, SQLite/Keyring 최소 native runtime만 존재; source map/recording/db/archive/env/app tests/src 없음 |
| macOS 패키지·런타임 | macOS CI/실기기 | PENDING | Windows 결과로 대체하지 않음 |
| macOS 시각 기준선 | macOS CI | PENDING | 비교 실패 시 CI도 실패하며, 생성된 darwin 후보를 검토·커밋하기 전에는 통과하지 않음 |

## 수동 실기기 검증

| 항목 | Windows | macOS | 기록해야 할 값 |
|---|---:|---:|---|
| 2시간 연속 실제 마이크 녹음 | PENDING | PENDING | OS 버전, 실제 duration, 총 bytes, part 수 |
| 녹음 중 강제 종료와 복구 | PENDING | PENDING | 종료 시점, 복구 선택, 보존 파일 |
| 마이크 권한 거부 후 복원 | PENDING | PENDING | OS 권한 화면과 재시도 결과 |
| 네트워크 중단 후 단계 재시도 | PENDING | PENDING | 실패 단계, 재시도 단계, 원본 보존 |
| 실제 OpenAI 키 저장·교체·삭제 | PENDING | PENDING | Credential Manager/Keychain 표시와 삭제 결과(키 값 기록 금지) |
| `delete_after_processing` / `keep` | PENDING | PENDING | 처리 커밋과 오디오 존재 여부 |
| Windows→Mac `.nnote` 왕복 | PENDING | PENDING | 파일 bytes, 스키마 버전, 새 meeting ID |
| Mac→Windows `.nnote` 왕복 | PENDING | PENDING | 파일 bytes, 스키마 버전, 새 meeting ID |
| 설치·실행·제거와 사용자 데이터 보존 | PENDING | PENDING | 설치 형식, unsigned 경고, 데이터 경로 |

## macOS 시각 기준선 절차

1. `mac-visual-baseline` CI 작업은 먼저 추적 중인 `tests/visual/snapshots/darwin` 기준선과 실제 macOS 픽셀을 비교한다.
2. 기준선이 없거나 픽셀이 다르면 작업은 `macos-visual-candidates-and-diffs` artifact를 업로드한 뒤 명시적으로 실패한다. 성공으로 건너뛰지 않는다.
3. artifact에서 `tests/visual/snapshots/darwin` 후보 원본과 `visual-comparison-results`/`test-results`의 실제·예상·diff 이미지를 모두 내려받아 사람이 확인한다.
4. Windows PNG를 복사하거나 이름만 바꾸지 말고, 승인한 darwin 후보 PNG만 별도 기준선 PR에 커밋한다.
5. CI를 다시 실행한다. 추적된 darwin 기준선과 새 macOS 렌더링 비교가 통과해야 작업이 성공한다.

로컬 macOS에서 후보를 다시 만들 때만 `npm run test:visual:update`를 사용한다. 이 명령의 출력은 승인된 기준선이 아니며 검토 없이 커밋하지 않는다.

## 서명 상태

0.1.0 개발/CI 패키지는 unsigned입니다. Windows 인증서 또는 Apple Developer ID/notarization 자격 증명을 사용하지 않았으며, 서명·공증 완료를 주장하지 않습니다.
