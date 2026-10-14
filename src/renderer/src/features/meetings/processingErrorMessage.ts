// "처리할 수 없는 오류" tells nobody what to change. Where the failure has a
// concrete cause the user can act on, say it.
const MESSAGES: Record<string, string> = {
  OPENAI_API_KEY_MISSING: 'OpenAI API 키가 없습니다. 설정에서 키를 등록해 주세요.',
  OPENAI_UNAUTHORIZED: 'OpenAI가 API 키를 거부했습니다. 설정에서 키를 다시 확인해 주세요.',
  OPENAI_AUDIO_TOO_LONG: '녹음이 음성 변환 모델이 한 번에 받을 수 있는 길이를 넘었습니다.',
  OPENAI_SUMMARY_REFUSED: 'OpenAI가 이 대화 내용의 회의록 작성을 거절했습니다.',
  LOCAL_WHISPER_MODEL_UNAVAILABLE: '선택한 로컬 Whisper 모델을 사용할 수 없습니다. 설정에서 모델을 내려받아 주세요.',
  APPLE_UNSUPPORTED_DEVICE: 'Apple 온디바이스 처리는 Apple silicon Mac에서 사용할 수 있습니다.',
  APPLE_UNSUPPORTED_OS: 'Apple 온디바이스 처리는 macOS 26 이상에서 사용할 수 있습니다.',
  APPLE_HELPER_UNAVAILABLE: 'Apple 처리 구성 요소를 찾을 수 없습니다. 앱을 다시 설치해 주세요.',
  APPLE_HELPER_TIMEOUT: 'Apple 온디바이스 처리가 시간 제한을 넘었습니다. 다시 시도해 주세요.',
  APPLE_SPEECH_UNAVAILABLE: '이 Mac에서 Apple 음성 전사를 사용할 수 없습니다.',
  APPLE_SPEECH_LOCALE_UNSUPPORTED: '이 Mac의 Apple 음성 전사는 선택된 전사 언어를 지원하지 않습니다.',
  APPLE_SPEECH_ASSET_NOT_READY: '설정에서 음성 모델을 준비한 뒤 다시 시도해 주세요.',
  APPLE_SUMMARY_UNAVAILABLE: '이 Mac에서 Apple Intelligence 요약을 사용할 수 없습니다.',
  APPLE_SUMMARY_INTELLIGENCE_DISABLED: '시스템 설정에서 Apple Intelligence를 켠 뒤 다시 시도해 주세요.',
  APPLE_SUMMARY_MODEL_NOT_READY: 'Apple Intelligence 모델 준비가 끝난 뒤 다시 시도해 주세요.',
  APPLE_SUMMARY_LOCALE_UNSUPPORTED: '이 Mac의 Apple Intelligence는 해당 언어의 요약을 지원하지 않습니다.',
  APPLE_SUMMARY_CONTEXT_EXCEEDED: '회의 내용이 Apple Intelligence의 처리 한도를 넘었습니다. 다른 요약 방식을 선택해 주세요.',
  APPLE_SUMMARY_TEMPLATE_TOO_LARGE: '템플릿 지시문이 너무 깁니다. 지시문을 줄이거나 다른 요약 방식을 선택해 주세요.',
  APPLE_SUMMARY_REFUSED: 'Apple Intelligence가 이 회의록 작성을 거절했습니다.',
  APPLE_SUMMARY_OUTPUT_INVALID: 'Apple Intelligence의 요약 결과가 올바르지 않습니다. 다시 시도해 주세요.',
}

export function processingErrorMessage(code: string, retryable: boolean): string {
  return MESSAGES[code]
    ?? (retryable
      ? '일시적인 오류가 발생했습니다. 다시 시도해 주세요.'
      : '현재 설정으로는 처리할 수 없는 오류가 발생했습니다. 설정을 바꾼 뒤 처음부터 다시 만들 수 있습니다.')
}
