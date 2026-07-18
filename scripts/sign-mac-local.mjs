import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { signAsync } from '@electron/osx-sign'

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
