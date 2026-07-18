import type { ProcessingProviderDescriptor } from '../../../../shared/contracts/settings'
import { StatusIndicator } from '../../components/feedback/StatusIndicator'
import { FieldHelp } from '../../components/help/FieldHelp'
import { PrivacyNotice } from '../../components/help/PrivacyNotice'
import { TroubleshootingDisclosure } from '../../components/help/TroubleshootingDisclosure'
import { Button } from '../../components/ui/Button'

const guidance: Readonly<Record<string, string>> = {
  CODEX_NOT_INSTALLED: 'Codex CLI가 설치되어 있지 않습니다. 터미널에서 Codex CLI를 설치한 뒤 다시 확인하세요.',
  CODEX_NOT_AUTHENTICATED: 'Codex CLI에 로그인되어 있지 않습니다. 터미널에서 로그인한 뒤 다시 확인하세요.',
  CODEX_CONFIG_INVALID: 'Codex CLI 설정이 올바르지 않습니다. 터미널에서 설정을 확인한 뒤 다시 시도하세요.',
  CODEX_UNAVAILABLE: 'Codex CLI를 사용할 수 없습니다. 터미널에서 실행 상태를 확인한 뒤 다시 시도하세요.',
}

const troubleshooting: Readonly<Record<string, readonly string[]>> = {
  CODEX_NOT_INSTALLED: ['npm install --global @openai/codex', 'codex --version'],
  CODEX_NOT_AUTHENTICATED: ['codex login', 'codex login status'],
  CODEX_CONFIG_INVALID: ['codex login status', '오류에 표시된 설정 파일과 줄을 수정하세요.', 'codex login status'],
  CODEX_UNAVAILABLE: ['codex --version', 'codex login status'],
}

interface CodexCliStatusProps {
  descriptor: ProcessingProviderDescriptor
  onAvailabilityChanged: () => Promise<void>
  pending: boolean
  disabled: boolean
}

export function CodexCliStatus({ descriptor, onAvailabilityChanged, pending, disabled }: CodexCliStatusProps) {
  const status = descriptor.availability.available
    ? 'Codex CLI가 설치되고 인증되어 사용할 수 있습니다.'
    : guidance[descriptor.availability.code ?? ''] ?? guidance.CODEX_UNAVAILABLE
  const steps = descriptor.availability.available
    ? null
    : troubleshooting[descriptor.availability.code ?? ''] ?? troubleshooting.CODEX_UNAVAILABLE

  return <section className="cli-status" aria-label="Codex CLI 상태" aria-busy={pending}>
    <FieldHelp>Mineloa는 전역 Codex 설정이나 로그인 정보를 변경하지 않습니다.</FieldHelp>
    {descriptor.privacy === 'text_cloud' && <PrivacyNotice title="클라우드 처리">
      <p>대화 내용이 Codex 계정으로 전송됩니다.</p>
      <p>로컬 추론이 아닌 클라우드 처리입니다.</p>
    </PrivacyNotice>}
    <StatusIndicator available={descriptor.availability.available}>{status}</StatusIndicator>
    <TroubleshootingDisclosure
      title="Codex CLI 문제 해결"
      steps={steps?.map((step) => step.startsWith('codex ') || step.startsWith('npm ') ? <code>{step}</code> : step) ?? null}
      action={steps === null ? undefined : <Button icon={pending ? 'processing' : 'retry'} type="button" disabled={disabled} onClick={() => void onAvailabilityChanged()} aria-label={pending ? 'Codex CLI 상태 확인 중…' : 'Codex CLI 상태 다시 확인'}>{pending ? '확인 중…' : '다시 확인'}</Button>}
    />
  </section>
}
