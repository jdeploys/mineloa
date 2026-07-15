import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAfterPackHook } from '../../scripts/after-pack.mjs'
import { createAfterSignHook } from '../../scripts/after-sign.mjs'
import { writeRuntimeManifest } from '../../scripts/write-local-runtime-manifest.mjs'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture() {
  const appOutDir = await mkdtemp(join(tmpdir(), 'nnote-sign-order-'))
  roots.push(appOutDir)
  const runtime = join(appOutDir, 'Nnote.app', 'Contents', 'Resources', 'local-runtime', 'darwin-arm64')
  await mkdir(runtime, { recursive: true })
  await Promise.all([
    writeFile(join(runtime, 'whisper-cli'), 'whisper-unsigned', { mode: 0o755 }),
    writeFile(join(runtime, 'ffmpeg'), 'ffmpeg-unsigned', { mode: 0o755 }),
    writeFile(join(runtime, 'THIRD_PARTY_NOTICES.md'), 'notices'),
    writeFile(join(runtime, 'LICENSE.whisper.cpp'), 'whisper license'),
    writeFile(join(runtime, 'LICENSE.FFmpeg'), 'ffmpeg license'),
    writeFile(join(runtime, 'runtime-manifest.json'), '{"old":true}\n'),
  ])
  return { appOutDir, runtime }
}

const context = (appOutDir: string) => ({
  electronPlatformName: 'darwin', appOutDir,
  packager: { appInfo: { productFilename: 'Nnote' } },
})

describe('macOS local runtime signing order', () => {
  it('signs both helpers before atomically refreshing hashes from final bytes', async () => {
    const target = await fixture()
    const order: string[] = []
    const hook = createAfterPackHook({
      sign: async (_identity, helper) => {
        const name = helper.endsWith('whisper-cli') ? 'whisper-cli' : 'ffmpeg'
        order.push(`sign:${name}`)
        await writeFile(helper, `${name}-signed-final`, { mode: 0o755 })
      },
      writeManifest: async (options) => {
        order.push('manifest')
        await writeRuntimeManifest(options)
      },
      identity: () => 'Developer ID Application: Example',
    })

    await hook(context(target.appOutDir))

    expect(order).toEqual(['sign:whisper-cli', 'sign:ffmpeg', 'manifest'])
    const manifest = JSON.parse(await readFile(join(target.runtime, 'runtime-manifest.json'), 'utf8'))
    for (const name of ['whisper-cli', 'ffmpeg']) {
      const bytes = await readFile(join(target.runtime, name))
      expect(manifest.files[name]).toEqual({
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    }
  })

  it('refuses to replace a linked packaged manifest', async (testContext) => {
    const target = await fixture()
    const manifest = join(target.runtime, 'runtime-manifest.json')
    const outside = join(target.appOutDir, 'outside.json')
    await writeFile(outside, 'outside')
    await rm(manifest)
    try { await symlink(outside, manifest, 'file') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { testContext.skip(); return }
      throw error
    }
    await expect(writeRuntimeManifest({
      directory: target.runtime, platform: 'darwin', arch: 'arm64', replaceExisting: true,
    })).rejects.toThrow('manifest')
    await expect(readFile(outside, 'utf8')).resolves.toBe('outside')
  })

  it('ad-hoc fallback seals only the app and never deep-signs helpers again', async () => {
    const target = await fixture()
    const run = vi.fn(() => ({ status: 0, error: undefined }))
    const hook = createAfterSignHook({ run, signingConfigured: () => false })
    await hook(context(target.appOutDir))
    expect(run).toHaveBeenCalledWith('codesign', [
      '--force', '--sign', '-', join(target.appOutDir, 'Nnote.app'),
    ])
    expect(run.mock.calls.flat().join(' ')).not.toContain('--deep')
  })
})
