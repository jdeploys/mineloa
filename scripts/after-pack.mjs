import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { writeRuntimeManifest } from './write-local-runtime-manifest.mjs'

function runCodesign(identity, helper) {
  const signingOptions = identity === '-' ? [] : ['--options', 'runtime', '--timestamp']
  const result = spawnSync('codesign', ['--force', ...signingOptions, '--sign', identity, helper], {
    encoding: 'utf8', windowsHide: true,
  })
  if (result.error || result.status !== 0) throw new Error('Nested helper signing failed: codesign')
}

export function createAfterPackHook(dependencies = {}) {
  const sign = dependencies.sign ?? runCodesign
  const refreshManifest = dependencies.writeManifest ?? writeRuntimeManifest
  const resolveIdentity = dependencies.identity ?? (() => process.env.CSC_NAME?.trim() || '-')
  return async function signLocalRuntimeHelpers(context) {
    if (context.electronPlatformName !== 'darwin') return
    const root = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'local-runtime')
    const targets = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    if (targets.length !== 1 || !/^darwin-(?:x64|arm64)$/.test(targets[0].name)) {
      throw new Error('Nested helper signing failed: target')
    }
    const targetRoot = join(root, targets[0].name)
    const identity = resolveIdentity()
    await sign(identity, join(targetRoot, 'whisper-cli'))
    await sign(identity, join(targetRoot, 'ffmpeg'))
    await refreshManifest({
      directory: targetRoot,
      platform: 'darwin',
      arch: targets[0].name.slice('darwin-'.length),
      replaceExisting: true,
    })
  }
}

export default createAfterPackHook()
