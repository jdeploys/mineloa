import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectRuntimeVerificationSignals,
  hasNativeArchitecture,
  verifyLocalRuntimePayload,
} from '../../src/main/app/runtimePackageVerification'
import type { OwnedProcessRequest, OwnedProcessResult } from '../../src/main/process/runOwnedProcess'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

function pe(machine = 0x8664): Buffer {
  const binary = Buffer.alloc(512)
  binary.write('MZ', 0)
  binary.writeUInt32LE(0x80, 0x3c)
  binary.write('PE\0\0', 0x80, 'binary')
  binary.writeUInt16LE(machine, 0x84)
  return binary
}

function mach(cpuType: number): Buffer {
  const binary = Buffer.alloc(64)
  binary.writeUInt32LE(0xfeedfacf, 0)
  binary.writeUInt32LE(cpuType, 4)
  return binary
}

async function payload(platform: 'win32' | 'darwin' = 'win32', arch = 'x64', helperContents = pe()) {
  const resourcesPath = await realpath(await mkdtemp(join(tmpdir(), 'nnote-packaged-runtime-')))
  roots.push(resourcesPath)
  const directory = join(resourcesPath, 'local-runtime', `${platform}-${arch}`)
  await mkdir(directory, { recursive: true })
  const names = platform === 'win32' ? ['whisper-cli.exe', 'ffmpeg.exe'] : ['whisper-cli', 'ffmpeg']
  const files = [...names, 'THIRD_PARTY_NOTICES.md', 'LICENSE.whisper.cpp', 'LICENSE.FFmpeg']
  const entries: Record<string, { size: number; sha256: string }> = {}
  for (const name of files) {
    const contents = names.includes(name) ? helperContents : Buffer.from(`verified ${name}`)
    await writeFile(join(directory, name), contents)
    if (platform === 'darwin' && names.includes(name)) await chmod(join(directory, name), 0o755)
    entries[name] = { size: contents.length, sha256: createHash('sha256').update(contents).digest('hex') }
  }
  await writeFile(join(directory, 'runtime-manifest.json'), JSON.stringify({
    schemaVersion: 1, platform, arch,
    whisperCpp: 'v1.9.1', whisperCppCommit: 'f049fff95a089aa9969deb009cdd4892b3e74916',
    ffmpeg: 'n8.1.2', ffmpegCommit: '1c2c67c0b9f7f66ab32c19dcf7f227bcd290aa4c', files: entries,
  }))
  return { resourcesPath, directory, names }
}

describe('local runtime payload verification', () => {
  const successfulRunner = async (request: OwnedProcessRequest): Promise<OwnedProcessResult> => ({
    status: 'success', exitCode: 0,
    stdout: request.args.includes('-version') ? 'ffmpeg version 8.1.2 Copyright' : 'usage: whisper-cli [options]',
    stderr: '',
  })

  it('accepts matching native helpers only after bounded shell-free version probes succeed', async () => {
    const fixture = await payload()
    const requests: OwnedProcessRequest[] = []
    await expect(verifyLocalRuntimePayload({
      resourcesPath: fixture.resourcesPath, platform: 'win32', arch: 'x64',
    }, { runHelper: async (request) => { requests.push(request); return successfulRunner(request) },
    })).resolves.toEqual({ whisper: true, ffmpeg: true, notices: true })
    expect(requests).toEqual([
      expect.objectContaining({ command: join(fixture.directory, 'whisper-cli.exe'), args: ['--help'], timeoutMs: 5_000, outputCapBytes: 64 * 1024 }),
      expect.objectContaining({ command: join(fixture.directory, 'ffmpeg.exe'), args: ['-version'], timeoutMs: 5_000, outputCapBytes: 64 * 1024 }),
    ])
    expect(requests.every((request) => !('shell' in request))).toBe(true)
  })

  it('rejects hash-valid text files instead of reporting localRuntime true', async () => {
    const fixture = await payload('win32', 'x64', Buffer.from('not a native executable'))
    await expect(verifyLocalRuntimePayload({
      resourcesPath: fixture.resourcesPath, platform: 'win32', arch: 'x64',
    }, { runHelper: successfulRunner })).rejects.toThrow('localRuntime.whisper')
  })

  it('rejects a native helper for the wrong architecture before launch', async () => {
    const fixture = await payload('win32', 'x64', pe(0xaa64))
    const runHelper = vi.fn(successfulRunner)
    await expect(verifyLocalRuntimePayload({
      resourcesPath: fixture.resourcesPath, platform: 'win32', arch: 'x64',
    }, { runHelper })).rejects.toThrow('localRuntime.whisper')
    expect(runHelper).not.toHaveBeenCalled()
  })

  it.each([
    ['x64', 0x01000007],
    ['arm64', 0x0100000c],
  ])('recognizes a thin Mach-O header matching darwin-%s', (arch, cpuType) => {
    expect(hasNativeArchitecture(mach(cpuType), 'darwin', arch)).toBe(true)
    expect(hasNativeArchitecture(mach(cpuType), 'darwin', arch === 'x64' ? 'arm64' : 'x64')).toBe(false)
  })

  it('rejects a missing-DLL or launch failure without leaking process details', async () => {
    const fixture = await payload()
    const failure = await verifyLocalRuntimePayload({
      resourcesPath: fixture.resourcesPath, platform: 'win32', arch: 'x64',
    }, { runHelper: async () => ({ status: 'spawn_error', code: 'DLL canary C:\\secret' }) }).catch((error: unknown) => error)
    expect(String(failure)).toContain('localRuntime.whisper')
    expect(String(failure)).not.toMatch(/DLL canary|secret/)
  })

  it('rejects the nearest invalid payload with a safe component name', async () => {
    const fixture = await payload()
    await writeFile(join(fixture.directory, 'ffmpeg.exe'), 'tampered path canary')
    const failure = await verifyLocalRuntimePayload({
      resourcesPath: fixture.resourcesPath, platform: 'win32', arch: 'x64',
    }, { runHelper: successfulRunner }).catch((error: unknown) => error)
    expect(String(failure)).toContain('localRuntime.ffmpeg')
    expect(String(failure)).not.toContain('canary')
    expect(String(failure)).not.toContain(fixture.resourcesPath)
  })

  it('rejects a symlinked manifest before reading it', async (context) => {
    const fixture = await payload()
    const manifest = join(fixture.directory, 'runtime-manifest.json')
    const outside = join(fixture.resourcesPath, 'outside-manifest.json')
    await writeFile(outside, '{}')
    await rm(manifest)
    try { await symlink(outside, manifest, 'file') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { context.skip(); return }
      throw error
    }
    await expect(verifyLocalRuntimePayload({
      resourcesPath: fixture.resourcesPath, platform: 'win32', arch: 'x64',
    }, { runHelper: successfulRunner })).rejects.toThrow('localRuntime.manifest')
  })
})

describe('packaged runtime verification', () => {
  it('checks main, native modules, local runtime, preload, and renderer through runtime ports', async () => {
    const close = vi.fn()
    const signals = await collectRuntimeVerificationSignals({
      checkSqlite: () => ({ value: 1, close }),
      checkKeyring: () => true,
      checkLocalRuntime: async () => ({ whisper: true, ffmpeg: true, notices: true }),
      checkRenderer: async () => ({ title: 'Nnote', desktopApiAvailable: true, dashboardVisible: true }),
    })

    expect(signals).toEqual({
      main: true, sqlite: true, keyring: true, localRuntime: true, preload: true, renderer: true,
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('preserves renderer failure attribution independently of local runtime success', async () => {
    await expect(collectRuntimeVerificationSignals({
      checkSqlite: () => ({ value: 1, close: () => undefined }),
      checkKeyring: () => true,
      checkLocalRuntime: async () => ({ whisper: true, ffmpeg: true, notices: true }),
      checkRenderer: async () => ({ title: 'wrong', desktopApiAvailable: true, dashboardVisible: true }),
    })).rejects.toThrow('renderer')
  })
})
