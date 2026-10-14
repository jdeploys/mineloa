import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { signAsync } from '@electron/osx-sign'
import { writeRuntimeManifest } from './write-local-runtime-manifest.mjs'

const [appArgument, identityArgument] = process.argv.slice(2)

if (!appArgument || !identityArgument) {
  throw new Error('Usage: node scripts/sign-mac-local.mjs <app> <codesign identity>')
}

const app = resolve(appArgument)
const runtime = join(app, 'Contents', 'Resources', 'local-runtime')
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const binaries = [
  join(runtime, `darwin-${arch}`, 'whisper-cli'),
  join(runtime, `darwin-${arch}`, 'ffmpeg'),
  join(app, 'Contents', 'Resources', 'apple-processing', 'apple-processing-helper'),
]

await Promise.all([access(app), ...binaries.map((binary) => access(binary))])

await signAsync({
  app,
  identity: identityArgument,
  identityValidation: true,
  platform: 'darwin',
  binaries,
  preAutoEntitlements: false,
  preEmbedProvisioningProfile: false,
  optionsForFile: () => ({ timestamp: 'none' }),
})

// Signing rewrites the helper binaries, so the manifest the packaging hook
// computed from the ad-hoc signed ones no longer describes what ships. Refresh
// it against the signed bytes, then reseal the bundle whose Resources changed.
await writeRuntimeManifest({
  directory: join(runtime, `darwin-${arch}`),
  platform: 'darwin',
  arch,
  replaceExisting: true,
})

const reseal = spawnSync('codesign', [
  '--force', '--timestamp=none', '--sign', identityArgument, app,
], { encoding: 'utf8' })
if (reseal.error || reseal.status !== 0) {
  throw new Error(`Resealing the signed app failed: ${reseal.error?.message ?? reseal.stderr.trim()}`)
}
