import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { writeRuntimeManifest } from './write-local-runtime-manifest.mjs'
import { signAsync } from '@electron/osx-sign'

function runCodesign(run, identity, helper, keychainFile, masBuild) {
  const signingOptions = identity === '-'
    ? []
    : masBuild
      ? ['--entitlements', 'build/entitlements.mas.inherit.plist']
      : ['--options', 'runtime', '--timestamp']
  const keychainOptions = keychainFile ? ['--keychain', keychainFile] : []
  const result = run('codesign', [
    '--force', ...signingOptions, ...keychainOptions, '--sign', identity, helper,
  ])
  if (result.error || result.status !== 0) throw new Error('Nested helper signing failed: codesign')
}

function defaultRun(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
}

async function resolveKeychainFile(context, identity) {
  if (identity === '-') return undefined
  const signingInfo = await context.packager.codeSigningInfo?.value
  if (!signingInfo || typeof signingInfo !== 'object') {
    throw new Error('Nested helper signing failed: signing info')
  }
  const { keychainFile } = signingInfo
  if (keychainFile != null && (typeof keychainFile !== 'string' || keychainFile.trim() === '')) {
    throw new Error('Nested helper signing failed: keychain')
  }
  if (process.env.CSC_LINK && !keychainFile) {
    throw new Error('Nested helper signing failed: keychain')
  }
  return keychainFile ?? undefined
}

export function createAfterPackHook(dependencies = {}) {
  const run = dependencies.run ?? defaultRun
  const refreshManifest = dependencies.writeManifest ?? writeRuntimeManifest
  const resolveIdentity = dependencies.identity ?? (() => process.env.CSC_NAME?.trim() || '-')
  const signApplication = dependencies.signApplication ?? signAsync
  return async function signLocalRuntimeHelpers(context) {
    if (!['darwin', 'mas'].includes(context.electronPlatformName)) return
    const masBuild = context.electronPlatformName === 'mas' || process.env.MAS_BUILD === 'true'
    const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    const root = join(app, 'Contents', 'Resources', 'local-runtime')
    const targets = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    if (targets.length !== 1 || !/^darwin-(?:x64|arm64)$/.test(targets[0].name)) {
      throw new Error('Nested helper signing failed: target')
    }
    const targetRoot = join(root, targets[0].name)
    const helperPaths = new Set([
      join(targetRoot, 'whisper-cli'),
      join(targetRoot, 'ffmpeg'),
    ])
    const identity = resolveIdentity()
    if (typeof identity !== 'string' || identity.trim() === '') {
      throw new Error('Nested helper signing failed: identity')
    }
    const keychainFile = await resolveKeychainFile(context, identity)
    runCodesign(run, identity, join(targetRoot, 'whisper-cli'), keychainFile, masBuild)
    runCodesign(run, identity, join(targetRoot, 'ffmpeg'), keychainFile, masBuild)
    await refreshManifest({
      directory: targetRoot,
      platform: 'darwin',
      arch: targets[0].name.slice('darwin-'.length),
      replaceExisting: true,
    })
    if (identity === '-') {
      await signApplication({
        app,
        identity: '-',
        identityValidation: false,
        ignore: (file) => helperPaths.has(file),
        preAutoEntitlements: false,
        preEmbedProvisioningProfile: false,
      })
    }
  }
}

export default createAfterPackHook()
