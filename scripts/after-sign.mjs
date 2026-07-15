import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

function runCodesign(program, args) {
  return spawnSync(program, args, { encoding: 'utf8', windowsHide: true })
}

export function createAfterSignHook(dependencies = {}) {
  const run = dependencies.run ?? runCodesign
  const signingConfigured = dependencies.signingConfigured ?? (() => {
    const configuredIdentity = process.env.CSC_NAME?.trim()
    return Boolean(process.env.CSC_LINK || (configuredIdentity && configuredIdentity !== '-'))
  })
  return async function signAdHocFallback(context) {
    if (context.electronPlatformName !== 'darwin' || signingConfigured()) return
    const appPath = context.appOutDir.endsWith('.app')
      ? context.appOutDir
      : join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    const result = run('codesign', ['--force', '--sign', '-', appPath])
    if (result.error || result.status !== 0) throw new Error('Ad-hoc application signing failed')
  }
}

export default createAfterSignHook()
