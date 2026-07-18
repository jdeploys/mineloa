export type OpenAiErrorCode =
  | 'OPENAI_API_KEY_MISSING'
  | 'OPENAI_UNAUTHORIZED'
  | 'OPENAI_RATE_LIMITED'
  | 'OPENAI_TIMEOUT'
  | 'OPENAI_NETWORK'
  | 'OPENAI_INVALID_AUDIO'
  | 'OPENAI_INVALID_SUMMARY_REQUEST'
  | 'OPENAI_MALFORMED_RESPONSE'
  | 'OPENAI_MALFORMED_SUMMARY'
  | 'OPENAI_SUMMARY_REFUSED'
  | 'OPENAI_SUMMARY_INCOMPLETE'
  | 'OPENAI_UNKNOWN'

export class OpenAiError extends Error {
  constructor(
    readonly code: OpenAiErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'OpenAiError'
  }
}

const safeDetails: Record<OpenAiErrorCode, { message: string; retryable: boolean }> = {
  OPENAI_API_KEY_MISSING: {
    message: 'An OpenAI API key is required.',
    retryable: false,
  },
  OPENAI_UNAUTHORIZED: {
    message: 'OpenAI rejected the API key.',
    retryable: false,
  },
  OPENAI_RATE_LIMITED: {
    message: 'OpenAI rate limit was reached. Try again later.',
    retryable: true,
  },
  OPENAI_TIMEOUT: {
    message: 'The OpenAI request timed out. Try again.',
    retryable: true,
  },
  OPENAI_NETWORK: {
    message: 'Could not reach OpenAI. Check the network connection and try again.',
    retryable: true,
  },
  OPENAI_INVALID_AUDIO: {
    message: 'OpenAI could not process this audio file.',
    retryable: false,
  },
  OPENAI_INVALID_SUMMARY_REQUEST: {
    message: 'OpenAI could not accept the summary request.',
    retryable: false,
  },
  OPENAI_MALFORMED_RESPONSE: {
    message: 'OpenAI returned an invalid transcription response.',
    retryable: true,
  },
  OPENAI_MALFORMED_SUMMARY: {
    message: 'OpenAI returned an invalid summary response.',
    retryable: false,
  },
  OPENAI_SUMMARY_REFUSED: {
    message: 'OpenAI declined to summarize this transcript.',
    retryable: false,
  },
  OPENAI_SUMMARY_INCOMPLETE: {
    message: 'OpenAI did not finish the summary. Try again.',
    retryable: true,
  },
  OPENAI_UNKNOWN: {
    message: 'OpenAI transcription failed.',
    retryable: false,
  },
}

export function safeOpenAiError(code: OpenAiErrorCode): OpenAiError {
  const details = safeDetails[code]
  return new OpenAiError(code, details.message, details.retryable)
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

function detailsOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function toOpenAiError(error: unknown): OpenAiError {
  if (error instanceof OpenAiError) {
    return safeOpenAiError(error.code)
  }

  const status = statusOf(error)
  const name = error instanceof Error ? error.name.toLowerCase() : ''
  const raw = detailsOf(error)
  const lower = raw.toLowerCase()
  let code: OpenAiErrorCode = 'OPENAI_UNKNOWN'

  if (status === 401 || status === 403) code = 'OPENAI_UNAUTHORIZED'
  else if (status === 429) {
    code = 'OPENAI_RATE_LIMITED'
  } else if (name.includes('timeout') || lower.includes('timed out') || lower.includes('timeout')) {
    code = 'OPENAI_TIMEOUT'
  } else if (
    status === 400 ||
    status === 413 ||
    lower.includes('invalid audio') ||
    lower.includes('unsupported audio')
  ) {
    code = 'OPENAI_INVALID_AUDIO'
  } else if (
    name.includes('connection') ||
    name.includes('network') ||
    ['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EAI_AGAIN'].some((token) =>
      raw.includes(token),
    )
  ) {
    code = 'OPENAI_NETWORK'
  }

  return safeOpenAiError(code)
}

export function toSummaryOpenAiError(error: unknown): OpenAiError {
  const classified = toOpenAiError(error)
  return classified.code === 'OPENAI_INVALID_AUDIO'
    ? safeOpenAiError('OPENAI_INVALID_SUMMARY_REQUEST')
    : classified
}
