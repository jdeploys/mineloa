// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ProcessingProviderDescriptor,
  ProcessingProviderSettings,
  SettingsApi,
  WhisperModelProgress,
  WhisperModelStatus,
} from '../../src/shared/contracts/settings'
import { ProcessingProviderSettings as ProcessingProviderSettingsView } from '../../src/renderer/src/features/settings/ProcessingProviderSettings'

const defaults: ProcessingProviderSettings = {
  transcriptionProvider: 'openai', summaryProvider: 'openai', localWhisperModel: 'base',
}

const descriptors: ProcessingProviderDescriptor[] = [
  { id: 'openai', stage: 'transcription', displayName: 'OpenAI API', availability: { available: true, code: null, message: null }, privacy: 'audio_cloud', capabilities: ['api_key', 'speaker_diarization'] },
  { id: 'local_whisper', stage: 'transcription', displayName: '로컬 Whisper', availability: { available: false, code: 'LOCAL_WHISPER_MODEL_UNAVAILABLE', message: 'unsafe C:/model' }, privacy: 'local', capabilities: ['model_manager'] },
  { id: 'openai', stage: 'summary', displayName: 'OpenAI API', availability: { available: true, code: null, message: null }, privacy: 'text_cloud', capabilities: ['api_key'] },
  { id: 'codex_cli', stage: 'summary', displayName: 'Codex CLI', availability: { available: true, code: null, message: null }, privacy: 'text_cloud', capabilities: ['cli_status'] },
]

const model = (modelId: 'base' | 'small', state: WhisperModelStatus['state'], receivedBytes = 0): WhisperModelStatus => ({
  modelId, state, expectedBytes: modelId === 'base' ? 147_951_465 : 487_601_967,
  receivedBytes, error: null,
})

function settingsApi(overrides: Partial<SettingsApi> = {}): SettingsApi {
  return {
    saveApiKey: vi.fn(), getApiKeyStatus: vi.fn(async () => ({ configured: false, lastValidatedAt: null })), deleteApiKey: vi.fn(),
    getProcessingProviders: vi.fn(async () => defaults),
    updateProcessingProviders: vi.fn(async (input) => input),
    listProcessingProviderDescriptors: vi.fn(async () => descriptors),
    listWhisperModels: vi.fn(async () => [model('base', 'not_installed'), model('small', 'not_installed')]),
    downloadWhisperModel: vi.fn(async (id) => model(id, 'installed', id === 'base' ? 147_951_465 : 487_601_967)),
    deleteWhisperModel: vi.fn(async (id) => model(id, 'not_installed')),
    onWhisperModelProgress: vi.fn(() => () => undefined),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function expand() {
  await screen.findByLabelText('전사 방식')
  const disclosure = screen.getByText('고급 처리 옵션')
  await userEvent.setup().click(disclosure)
}

describe('processing provider settings visible outcomes', () => {
  afterEach(cleanup)

  it('shows OpenAI defaults while advanced controls remain secondary', async () => {
    render(<ProcessingProviderSettingsView settings={settingsApi()} />)
    await screen.findByLabelText('전사 방식')
    const disclosure = screen.getByText('고급 처리 옵션')
    expect(disclosure.closest('details')).not.toHaveAttribute('open')
    expect(screen.getByLabelText('전사 방식')).toHaveValue('openai')
    expect(screen.getByLabelText('요약 방식')).toHaveValue('openai')
  })

  it('persists only the selected transcription setting and preserves summary/model', async () => {
    const api = settingsApi()
    render(<ProcessingProviderSettingsView settings={api} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('전사 방식'), 'local_whisper')
    expect(api.updateProcessingProviders).toHaveBeenCalledWith({
      transcriptionProvider: 'local_whisper', summaryProvider: 'openai', localWhisperModel: 'base',
    })
  })

  it('shows local-only audio privacy and missing speaker separation', async () => {
    render(<ProcessingProviderSettingsView settings={settingsApi()} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('전사 방식'), 'local_whisper')
    expect(await screen.findByRole('note', { name: '로컬 처리' })).toBeVisible()
    expect(screen.getByText('오디오는 외부로 전송되지 않습니다.')).toBeVisible()
    expect(screen.getByText('화자 분리를 지원하지 않습니다.')).toBeVisible()
    expect(screen.getByText('로컬 처리 구성 요소 또는 선택한 모델을 아직 사용할 수 없습니다.').closest('.status-indicator')).not.toBeNull()
    expect(screen.queryByText(/C:\/model/)).not.toBeInTheDocument()
  })

  it('shows model download progress and exact unsubscribe cleanup', async () => {
    let listener!: (progress: WhisperModelProgress) => void
    const unsubscribe = vi.fn()
    const api = settingsApi({ onWhisperModelProgress: vi.fn((next) => { listener = next; return unsubscribe }) })
    const view = render(<ProcessingProviderSettingsView settings={api} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('전사 방식'), 'local_whisper')
    await screen.findByRole('button', { name: 'base 모델 다운로드' })
    act(() => listener({ modelId: 'base', receivedBytes: 73_975_732, totalBytes: 147_951_465 }))
    const progress = screen.getByRole('progressbar', { name: 'base 모델 다운로드 진행률' })
    expect(progress).toHaveAttribute('value', '73975732')
    expect(progress).toHaveAttribute('max', '147951465')
    expect(screen.getByText(/50%/)).toBeVisible()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('shows installed model deletion without exposing a path', async () => {
    const api = settingsApi({ listWhisperModels: vi.fn(async () => [model('base', 'installed', 147_951_465), model('small', 'not_installed')]) })
    render(<ProcessingProviderSettingsView settings={api} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('전사 방식'), 'local_whisper')
    const remove = await screen.findByRole('button', { name: 'base 모델 삭제' })
    expect(remove).toBeVisible()
    expect(document.body.textContent).not.toMatch(/[A-Z]:\\|\/Users\//)
  })

  it('enables the newly selected small model while a stale base download remains pending', async () => {
    let finishBase!: (status: WhisperModelStatus) => void
    const pendingBase = new Promise<WhisperModelStatus>((resolve) => { finishBase = resolve })
    const api = settingsApi({
      downloadWhisperModel: vi.fn((id) => id === 'base' ? pendingBase : Promise.resolve(model('small', 'installed', 487_601_967))),
    })
    render(<ProcessingProviderSettingsView settings={api} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('전사 방식'), 'local_whisper')
    await userEvent.setup().click(await screen.findByRole('button', { name: 'base 모델 다운로드' }))
    await userEvent.setup().selectOptions(screen.getByLabelText('로컬 모델'), 'small')

    expect(await screen.findByRole('button', { name: 'small 모델 다운로드' })).toBeEnabled()
    await act(async () => finishBase(model('base', 'installed', 147_951_465)))
    expect(screen.getByRole('button', { name: 'small 모델 다운로드' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'base 모델 삭제' })).not.toBeInTheDocument()
  })

  it('refreshes descriptor availability after model download without changing provider selections', async () => {
    const available = descriptors.map((descriptor) => descriptor.id === 'local_whisper'
      ? { ...descriptor, availability: { available: true, code: null, message: null } }
      : descriptor)
    const listDescriptors = vi.fn()
      .mockResolvedValueOnce(descriptors)
      .mockResolvedValueOnce(descriptors)
      .mockResolvedValue(available)
    const api = settingsApi({ listProcessingProviderDescriptors: listDescriptors })
    render(<ProcessingProviderSettingsView settings={api} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('전사 방식'), 'local_whisper')
    expect(await screen.findByText('로컬 처리 구성 요소 또는 선택한 모델을 아직 사용할 수 없습니다.')).toBeVisible()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'base 모델 다운로드' }))

    expect(await screen.findByText('로컬 처리 구성 요소를 사용할 수 있습니다.')).toBeVisible()
    expect(screen.getByLabelText('전사 방식')).toHaveValue('local_whisper')
    expect(screen.getByLabelText('요약 방식')).toHaveValue('openai')
    expect(screen.getByLabelText('로컬 모델')).toHaveValue('base')
    expect(listDescriptors).toHaveBeenCalledTimes(3)
  })

  it('labels Codex summary as transcript cloud processing', async () => {
    render(<ProcessingProviderSettingsView settings={settingsApi()} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('요약 방식'), 'codex_cli')
    expect(await screen.findByText('전사문이 Codex 계정으로 전송됩니다.')).toBeVisible()
    expect(screen.getByText('로컬 추론이 아닌 클라우드 처리입니다.')).toBeVisible()
  })

  it('shows concise field help, a cloud privacy notice and failure-only troubleshooting in that order', async () => {
    const invalid = descriptors.map((descriptor) => descriptor.id === 'codex_cli'
      ? { ...descriptor, availability: { available: false, code: 'CODEX_CONFIG_INVALID', message: null } }
      : descriptor)
    render(<ProcessingProviderSettingsView settings={settingsApi({ listProcessingProviderDescriptors: vi.fn(async () => invalid) })} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('요약 방식'), 'codex_cli')

    const section = screen.getByRole('region', { name: 'Codex CLI 상태' })
    const text = section.textContent ?? ''
    expect(screen.getByRole('note', { name: '클라우드 처리' })).toBeVisible()
    expect(screen.getByText('Nnote는 전역 Codex 설정이나 로그인 정보를 변경하지 않습니다.')).toHaveClass('field-help')
    expect(text.indexOf('Nnote는 전역 Codex 설정이나 로그인 정보를 변경하지 않습니다.')).toBeLessThan(text.indexOf('전사문이 Codex 계정으로 전송됩니다.'))
    expect(text.indexOf('전사문이 Codex 계정으로 전송됩니다.')).toBeLessThan(text.indexOf('Codex CLI 설정이 올바르지 않습니다.'))
    expect(text.indexOf('Codex CLI 설정이 올바르지 않습니다.')).toBeLessThan(text.indexOf('Codex CLI 문제 해결'))
  })

  it('keeps provider refresh independent from saving provider choices', async () => {
    const invalid = descriptors.map((descriptor) => descriptor.id === 'codex_cli'
      ? { ...descriptor, availability: { available: false, code: 'CODEX_CONFIG_INVALID', message: null } }
      : descriptor)
    const listDescriptors = vi.fn()
      .mockResolvedValueOnce(descriptors)
      .mockResolvedValueOnce(invalid)
      .mockResolvedValue(descriptors)
    const api = settingsApi({ listProcessingProviderDescriptors: listDescriptors })
    render(<ProcessingProviderSettingsView settings={api} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('요약 방식'), 'codex_cli')
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Codex CLI 상태 다시 확인' }))

    expect(api.updateProcessingProviders).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('요약 방식')).toHaveValue('codex_cli')
  })

  it('prevents duplicate or conflicting Codex refresh and restores controls after success', async () => {
    const user = userEvent.setup()
    const invalid = descriptors.map((descriptor) => descriptor.id === 'codex_cli'
      ? { ...descriptor, availability: { available: false, code: 'CODEX_CONFIG_INVALID', message: null } }
      : descriptor)
    const refresh = deferred<ProcessingProviderDescriptor[]>()
    const listDescriptors = vi.fn()
      .mockResolvedValueOnce(invalid)
      .mockResolvedValueOnce(invalid)
      .mockImplementationOnce(() => refresh.promise)
    const api = settingsApi({ listProcessingProviderDescriptors: listDescriptors })
    render(<ProcessingProviderSettingsView settings={api} />)
    await expand()
    await user.selectOptions(screen.getByLabelText('요약 방식'), 'codex_cli')
    await screen.findByText('Codex CLI 설정이 올바르지 않습니다. 터미널에서 설정을 확인한 뒤 다시 시도하세요.')

    const refreshButton = screen.getByRole('button', { name: 'Codex CLI 상태 다시 확인' })
    refreshButton.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: 'Codex CLI 상태 확인 중…' })).toBeDisabled()
    expect(screen.getByRole('region', { name: 'Codex CLI 상태' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByLabelText('전사 방식')).toBeDisabled()
    expect(screen.getByLabelText('요약 방식')).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(listDescriptors).toHaveBeenCalledTimes(3)
    expect(api.updateProcessingProviders).toHaveBeenCalledTimes(1)

    await act(async () => refresh.resolve(descriptors))
    expect(await screen.findByText('Codex CLI가 설치되고 인증되어 사용할 수 있습니다.')).toBeVisible()
    expect(screen.getByLabelText('전사 방식')).toBeEnabled()
    expect(screen.getByLabelText('요약 방식')).toBeEnabled()
    expect(screen.getByLabelText('요약 방식')).toHaveValue('codex_cli')
    expect(api.updateProcessingProviders).toHaveBeenCalledTimes(1)
  })

  it('restores Codex refresh and provider controls after descriptor rejection', async () => {
    const user = userEvent.setup()
    const invalid = descriptors.map((descriptor) => descriptor.id === 'codex_cli'
      ? { ...descriptor, availability: { available: false, code: 'CODEX_CONFIG_INVALID', message: null } }
      : descriptor)
    const refresh = deferred<ProcessingProviderDescriptor[]>()
    const listDescriptors = vi.fn()
      .mockResolvedValueOnce(invalid)
      .mockResolvedValueOnce(invalid)
      .mockImplementationOnce(() => refresh.promise)
    const api = settingsApi({ listProcessingProviderDescriptors: listDescriptors })
    render(<ProcessingProviderSettingsView settings={api} />)
    await expand()
    await user.selectOptions(screen.getByLabelText('요약 방식'), 'codex_cli')
    await screen.findByText('Codex CLI 설정이 올바르지 않습니다. 터미널에서 설정을 확인한 뒤 다시 시도하세요.')

    await user.click(screen.getByRole('button', { name: 'Codex CLI 상태 다시 확인' }))
    await act(async () => refresh.reject(new Error('unsafe C:/secret/config.toml')))

    expect(await screen.findByRole('alert')).toHaveTextContent('처리 설정을 불러오지 못했습니다. 잠시 후 다시 시도하세요.')
    expect(document.body.textContent).not.toContain('C:/secret')
    expect(screen.getByRole('button', { name: 'Codex CLI 상태 다시 확인' })).toBeEnabled()
    expect(screen.getByRole('region', { name: 'Codex CLI 상태' })).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByLabelText('전사 방식')).toBeEnabled()
    expect(screen.getByLabelText('요약 방식')).toBeEnabled()
    expect(api.updateProcessingProviders).toHaveBeenCalledTimes(1)
  })

  it('disables Codex refresh while a conflicting provider save is pending', async () => {
    const user = userEvent.setup()
    const invalid = descriptors.map((descriptor) => descriptor.id === 'codex_cli'
      ? { ...descriptor, availability: { available: false, code: 'CODEX_CONFIG_INVALID', message: null } }
      : descriptor)
    const initial = { ...defaults, summaryProvider: 'codex_cli' as const }
    const persisted = { ...initial, transcriptionProvider: 'local_whisper' as const }
    const save = deferred<ProcessingProviderSettings>()
    const listDescriptors = vi.fn(async () => invalid)
    const api = settingsApi({
      getProcessingProviders: vi.fn(async () => initial),
      updateProcessingProviders: vi.fn(() => save.promise),
      listProcessingProviderDescriptors: listDescriptors,
    })
    render(<ProcessingProviderSettingsView settings={api} />)
    await expand()

    await user.selectOptions(screen.getByLabelText('전사 방식'), 'local_whisper')
    expect(screen.getByRole('button', { name: 'Codex CLI 상태 다시 확인' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Codex CLI 상태 다시 확인' }))
    expect(listDescriptors).toHaveBeenCalledTimes(1)

    await act(async () => save.resolve(persisted))
    await waitFor(() => expect(listDescriptors).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Codex CLI 상태 다시 확인' })).toBeEnabled()
  })

  it.each([
    ['CODEX_NOT_INSTALLED', 'npm install --global @openai/codex', 'codex --version'],
    ['CODEX_NOT_AUTHENTICATED', 'codex login', 'codex login status'],
    ['CODEX_CONFIG_INVALID', 'codex login status', '오류에 표시된 설정 파일과 줄을 수정하세요.'],
    ['CODEX_UNAVAILABLE', 'codex --version', 'codex login status'],
  ] as const)('shows actionable Codex troubleshooting for %s', async (code, firstStep, secondStep) => {
    const unavailable = descriptors.map((descriptor) => descriptor.id === 'codex_cli'
      ? { ...descriptor, availability: { available: false, code, message: 'C:/secret/config.toml' } }
      : descriptor)
    const api = settingsApi({ listProcessingProviderDescriptors: vi.fn(async () => unavailable) })
    render(<ProcessingProviderSettingsView settings={api} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('요약 방식'), 'codex_cli')

    const help = await screen.findByRole('region', { name: 'Codex CLI 문제 해결' })
    expect(help).toHaveTextContent(firstStep)
    expect(help).toHaveTextContent(secondStep)
    expect(screen.getByRole('button', { name: 'Codex CLI 상태 다시 확인' })).toBeVisible()
    expect(document.body.textContent).not.toContain('C:/secret')
  })

  it('refreshes Codex invalid-config status without changing the selected providers', async () => {
    const invalid = descriptors.map((descriptor) => descriptor.id === 'codex_cli'
      ? { ...descriptor, availability: { available: false, code: 'CODEX_CONFIG_INVALID', message: null } }
      : descriptor)
    const listDescriptors = vi.fn()
      .mockResolvedValueOnce(descriptors)
      .mockResolvedValueOnce(invalid)
      .mockResolvedValue(descriptors)
    const api = settingsApi({ listProcessingProviderDescriptors: listDescriptors })
    render(<ProcessingProviderSettingsView settings={api} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('요약 방식'), 'codex_cli')
    await screen.findByText('Codex CLI 설정이 올바르지 않습니다. 터미널에서 설정을 확인한 뒤 다시 시도하세요.')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Codex CLI 상태 다시 확인' }))

    expect(await screen.findByText('Codex CLI가 설치되고 인증되어 사용할 수 있습니다.')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Codex CLI 문제 해결' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('전사 방식')).toHaveValue('openai')
    expect(screen.getByLabelText('요약 방식')).toHaveValue('codex_cli')
  })

  it('keeps available Codex status free of troubleshooting instructions', async () => {
    render(<ProcessingProviderSettingsView settings={settingsApi()} />)
    await expand()
    await userEvent.setup().selectOptions(screen.getByLabelText('요약 방식'), 'codex_cli')
    expect(await screen.findByText('Codex CLI가 설치되고 인증되어 사용할 수 있습니다.')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Codex CLI 문제 해결' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Codex CLI 상태 다시 확인' })).not.toBeInTheDocument()
  })

  it('keeps OpenAI selectors on API-key and speaker capability without local or Codex panels', async () => {
    render(<ProcessingProviderSettingsView settings={settingsApi()} />)
    await expand()
    await waitFor(() => expect(screen.getByLabelText('전사 방식')).toHaveValue('openai'))
    expect(screen.getByText('OpenAI API 키를 사용하며 화자 분리를 지원합니다.')).toBeVisible()
    expect(screen.queryByLabelText('로컬 모델')).not.toBeInTheDocument()
    expect(screen.queryByText('전사문이 Codex 계정으로 전송됩니다.')).not.toBeInTheDocument()
  })

  it('shows a fixed actionable alert when settings fail without raw diagnostics', async () => {
    const api = settingsApi({ getProcessingProviders: vi.fn(async () => { throw new Error('ipc C:/secret') }) })
    render(<ProcessingProviderSettingsView settings={api} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('처리 설정을 불러오지 못했습니다. 잠시 후 다시 시도하세요.')
    expect(document.body.textContent).not.toContain('C:/secret')
  })
})
