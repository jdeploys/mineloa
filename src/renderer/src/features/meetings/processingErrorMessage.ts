// "처리할 수 없는 오류" tells nobody what to change. Where the failure has a
// concrete cause the user can act on, say it.
const MESSAGES: Record<string, string> = {
  OPENAI_API_KEY_MISSING: 'OpenAI API 키가 없습니다. 설정에서 키를 등록해 주세요.',
  OPENAI_UNAUTHORIZED: 'OpenAI가 API 키를 거부했습니다. 설정에서 키를 다시 확인해 주세요.',
  OPENAI_AUDIO_TOO_LONG: '녹음이 음성 변환 모델이 한 번에 받을 수 있는 길이를 넘었습니다.',
  OPENAI_SUMMARY_REFUSED: 'OpenAI가 이 대화 내용의 회의록 작성을 거절했습니다.',
  LOCAL_WHISPER_MODEL_UNAVAILABLE: '선택한 로컬 Whisper 모델을 사용할 수 없습니다. 설정에서 모델을 내려받아 주세요.',
}

export function processingErrorMessage(code: string, retryable: boolean): string {
  return MESSAGES[code]
    ?? (retryable
      ? '일시적인 오류가 발생했습니다. 다시 시도해 주세요.'
      : '현재 설정으로는 처리할 수 없는 오류가 발생했습니다. 설정을 바꾼 뒤 처음부터 다시 만들 수 있습니다.')
}
