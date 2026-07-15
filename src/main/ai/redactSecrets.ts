const REDACTED = '[REDACTED]'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function redactAuthorizationValues(value: string): string {
  let result = value

  // Serialized header tuples, for example ["Authorization", "Bearer token"].
  result = result.replace(
    /(\[\s*["']authorization["']\s*,\s*)"(?:\\.|[^"\\])*"/gi,
    `$1"${REDACTED}"`,
  )
  result = result.replace(
    /(\[\s*["']authorization["']\s*,\s*)'(?:\\.|[^'\\])*'/gi,
    `$1'${REDACTED}'`,
  )

  // Quoted property values may safely contain whitespace, commas, and escaped quotes.
  result = result.replace(
    /((?:"authorization"|'authorization'|\bauthorization\b)\s*[:=]\s*)"(?:\\.|[^"\\])*"/gi,
    `$1"${REDACTED}"`,
  )
  result = result.replace(
    /((?:"authorization"|'authorization'|\bauthorization\b)\s*[:=]\s*)'(?:\\.|[^'\\])*'/gi,
    `$1'${REDACTED}'`,
  )

  // A plain HTTP header owns the remainder of its line.
  result = result.replace(/^(\s*authorization\s*:\s*)[^\r\n]*$/gim, `$1${REDACTED}`)

  // Unquoted serialized properties end at their representation's field delimiter.
  result = result.replace(
    /((?:"authorization"|'authorization')\s*[:=]\s*)(?!["'])[^,;}\r\n]+/gi,
    `$1${REDACTED}`,
  )
  result = result.replace(
    /((?<!["'])\bauthorization\b\s*[:=]\s*)(?!["'])[^,;}\r\n]+/gi,
    `$1${REDACTED}`,
  )
  return result
}

export function redactSecrets(value: string, absolutePaths: readonly string[] = []): string {
  let result = value
  for (const path of [...absolutePaths].sort((left, right) => right.length - left.length)) {
    if (path.length > 0) result = result.replace(new RegExp(escapeRegExp(path), 'gi'), REDACTED)
  }
  result = redactAuthorizationValues(result)
  result = result.replace(/sk-\S+/g, REDACTED)
  result = result.replace(/[A-Za-z]:\\[^\r\n"']*?\.webm(?:\.part)?/gi, REDACTED)
  result = result.replace(/\/(?:[^\s/]+\/)+[^\s"']*?\.webm(?:\.part)?/gi, REDACTED)
  return result
}
