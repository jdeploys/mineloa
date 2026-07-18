import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAfterPackHook } from '../../scripts/after-pack.mjs'
import { createAfterSignHook } from '../../scripts/after-sign.mjs'
import { writeRuntimeManifest } from '../../scripts/write-local-runtime-manifest.mjs'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture() {
  const appOutDir = await realpath(await mkdtemp(join(tmpdir(), 'nnote-sign-order-')))
  roots.push(appOutDir)
  const runtime = join(appOutDir, 'Mineloa.app', 'Contents', 'Resources', 'local-runtime', 'darwin-arm64')
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

const context = (appOutDir: string, codeSigningInfo?: { value: Promise<{ keychainFile?: string | null }> }) => ({
  electronPlatformName: 'darwin', appOutDir,
  packager: { appInfo: { productFilename: 'Mineloa' }, ...(codeSigningInfo && { codeSigningInfo }) },
})

describe('macOS local runtime signing order', () => {
  it('signs bundled executables with inherited sandbox entitlements for MAS', async () => {
    const target = await fixture()
    const calls: string[][] = []
    const hook = createAfterPackHook({
      run: (_command, args) => {
        calls.push(args)
        return { status: 0, error: undefined }
      },
      identity: () => 'Apple Distribution: Example',
    })

    await hook({ ...context(target.appOutDir, { value: Promise.resolve({}) }), electronPlatformName: 'mas' })

    expect(calls).toHaveLength(2)
    for (const args of calls) {
      expect(args).toEqual(expect.arrayContaining([
        '--entitlements', 'build/entitlements.mas.inherit.plist',
        '--sign', 'Apple Distribution: Example',
      ]))
      expect(args).not.toContain('--options')
      expect(args).not.toContain('--timestamp')
    }
  })

  it('signs both helpers before atomically refreshing hashes from final bytes', async () => {
    const target = await fixture()
    const order: string[] = []
    const calls: string[][] = []
    const signingInfo = {
      value: Promise.resolve().then(() => {
        order.push('codeSigningInfo')
        return { keychainFile: '/private/tmp/nnote-signing.keychain' }
      }),
    }
    const signApplication = vi.fn()
    const hook = createAfterPackHook({
      run: (_command, args) => {
        calls.push(args)
        const helper = args.at(-1)!
        const name = helper.endsWith('whisper-cli') ? 'whisper-cli' : 'ffmpeg'
        order.push(`sign:${name}`)
        writeFileSync(helper, `${name}-signed-final`, { mode: 0o755 })
        return { status: 0, error: undefined }
      },
      writeManifest: async (options) => {
        order.push('manifest')
        await writeRuntimeManifest(options)
      },
      identity: () => 'Developer ID Application: Example',
      signApplication,
    })

    await hook(context(target.appOutDir, signingInfo))

    expect(order).toEqual(['codeSigningInfo', 'sign:whisper-cli', 'sign:ffmpeg', 'manifest'])
    expect(signApplication).not.toHaveBeenCalled()
    for (const args of calls) {
      expect(args).toEqual(expect.arrayContaining([
        '--keychain', '/private/tmp/nnote-signing.keychain',
        '--sign', 'Developer ID Application: Example',
      ]))
    }
    const manifest = JSON.parse(await readFile(join(target.runtime, 'runtime-manifest.json'), 'utf8'))
    for (const name of ['whisper-cli', 'ffmpeg']) {
      const bytes = await readFile(join(target.runtime, name))
      expect(manifest.files[name]).toEqual({
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    }
  })

  it('ad-hoc helper signing never resolves the Developer ID keychain', async () => {
    const target = await fixture()
    let signingInfoReads = 0
    const codeSigningInfo = {
      get value() {
        signingInfoReads += 1
        return Promise.reject(new Error('Developer ID keychain must stay lazy'))
      },
    }
    const calls: string[][] = []
    const signApplication = vi.fn()
    const hook = createAfterPackHook({
      run: (_command, args) => {
        calls.push(args)
        return { status: 0, error: undefined }
      },
      identity: () => '-',
      signApplication,
    })

    await hook(context(target.appOutDir, codeSigningInfo))

    expect(signingInfoReads).toBe(0)
    expect(calls).toHaveLength(2)
    for (const args of calls) {
      expect(args).not.toContain('--keychain')
      expect(args).toEqual(expect.arrayContaining(['--sign', '-']))
    }
    expect(signApplication).toHaveBeenCalledWith(expect.objectContaining({
      app: join(target.appOutDir, 'Mineloa.app'),
      identity: '-',
      identityValidation: false,
      ignore: expect.any(Function),
    }))
    const ignore = signApplication.mock.calls[0][0].ignore as (path: string) => boolean
    expect(ignore(join(target.runtime, 'whisper-cli'))).toBe(true)
    expect(ignore(join(target.runtime, 'ffmpeg'))).toBe(true)
    expect(ignore(join(target.appOutDir, 'Mineloa.app', 'Contents', 'Frameworks', 'Electron Framework.framework'))).toBe(false)
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
      '--force', '--sign', '-', join(target.appOutDir, 'Mineloa.app'),
    ])
    expect(run.mock.calls.flat().join(' ')).not.toContain('--deep')
  })
})
