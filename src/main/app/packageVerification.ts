import { isAbsolute } from 'node:path'

export const PACKAGE_VERIFICATION_SWITCH = '--nnote-verify-package='

export interface PackageVerificationRequest {
  resultPath: string
}

export function parsePackageVerificationRequest(argv: readonly string[]): PackageVerificationRequest | null {
  const argument = argv.find((value) => value.startsWith(PACKAGE_VERIFICATION_SWITCH))
  if (argument === undefined) return null
  const resultPath = argument.slice(PACKAGE_VERIFICATION_SWITCH.length)
  return resultPath.length > 0 && isAbsolute(resultPath) ? { resultPath } : null
}
