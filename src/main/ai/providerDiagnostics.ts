import { redactSecrets } from './redactSecrets'

const DETAIL_LIMIT = 500

// A provider failure is stored under a sanitized code so nothing sensitive
// reaches the database, which also meant the one sentence that explained the
// failure — "audio duration 2053 seconds is longer than 1400 seconds" — was
// discarded before anybody could read it. Keep that sentence in the process
// log, with credentials and recording paths removed.
export function formatProviderFailure(
  scope: string,
  code: string,
  error: unknown,
  absolutePaths: readonly string[] = [],
): string {
  const status = typeof error === 'object' && error !== null && 'status' in error
    && typeof (error as { status: unknown }).status === 'number'
    ? ` status=${(error as { status: number }).status}`
    : ''
  const raw = error instanceof Error ? error.message : String(error)
  const detail = redactSecrets(raw, absolutePaths).replace(/\s+/g, ' ').trim().slice(0, DETAIL_LIMIT)
  return `[${scope}] ${code}${status} ${detail}`
}

export function reportProviderFailure(
  scope: string,
  code: string,
  error: unknown,
  absolutePaths: readonly string[] = [],
): void {
  console.warn(formatProviderFailure(scope, code, error, absolutePaths))
}
