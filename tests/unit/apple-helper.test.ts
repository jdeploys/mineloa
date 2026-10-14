import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppleHelper } from '../../src/main/ai/providers/appleHelper'
import type { OwnedProcessRequest } from '../../src/main/process/runOwnedProcess'

const temporary: string[] = []
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture(stdout: string) {
  const projectDirectory = await realpath(await mkdtemp(join(tmpdir(), 'nnote-apple-helper-test-')))
  temporary.push(projectDirectory)
  const helperDirectory = join(projectDirectory, 'build', 'apple-processing', 'arm64')
  await mkdir(helperDirectory, { recursive: true })
  const path = join(helperDirectory, 'apple-processing-helper')
  await writeFile(path, '')
  await chmod(path, 0o755)
  const runProcess = vi.fn(async (_request: OwnedProcessRequest) => ({ status: 'success' as const, exitCode: 0 as const, stdout, stderr: 'SECRET /Users/person/key' }))
  const helper = new AppleHelper({
    isPackaged: false, resourcesPath: projectDirectory, projectDirectory,
    platform: 'darwin', arch: 'arm64', osRelease: '25.5.0', runProcess,
  })
  return { helper, runProcess, path, projectDirectory }
}

describe('Apple helper boundary', () => {
  it('cancels the running helper and rejects queued work when the app quits', async () => {
    const { helper, runProcess } = await fixture(JSON.stringify({ protocolVersion: 1, ok: true, result: {} }))
    await helper.call('status')
    const signal = runProcess.mock.calls[0]![0].signal!
    expect(signal.aborted).toBe(false)
    helper.dispose()
    expect(signal.aborted).toBe(true)
    await expect(helper.call('status')).rejects.toMatchObject({ code: 'APPLE_HELPER_CANCELLED' })
    expect(runProcess).toHaveBeenCalledTimes(1)
  })
  it('rejects a protocol mismatch without exposing helper diagnostics', async () => {
    const { helper, runProcess, path } = await fixture(JSON.stringify({ protocolVersion: 2, ok: true, result: {} }))
    await expect(helper.call('status')).rejects.toMatchObject({ code: 'APPLE_HELPER_INVALID_RESPONSE' })
    expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
      command: path, args: [], stdin: '{"protocolVersion":1,"operation":"status","payload":{}}',
    }))
  })

  it('maps an untrusted error code and message to fixed text', async () => {
    const { helper } = await fixture(JSON.stringify({ protocolVersion: 1, ok: false, error: { code: 'SECRET_PATH', message: '/Users/person/key' } }))
    await expect(helper.call('status')).rejects.toMatchObject({
      code: 'APPLE_HELPER_FAILED', message: 'Apple on-device processing failed. Try again.',
    })
  })

  it('does not invoke the helper on an unsupported OS', async () => {
    const { runProcess, path } = await fixture('{}')
    const helper = new AppleHelper({
      isPackaged: false, resourcesPath: path, projectDirectory: path,
      platform: 'darwin', arch: 'arm64', osRelease: '24.6.0', runProcess,
    })
    await expect(helper.call('status')).rejects.toMatchObject({ code: 'APPLE_UNSUPPORTED_OS' })
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('rejects a symlinked executable before spawning', async () => {
    const { runProcess, path, projectDirectory } = await fixture('{}')
    const outside = join(await realpath(tmpdir()), 'nnote-apple-helper-outside')
    await rm(path)
    await symlink(outside, path)
    const helper = new AppleHelper({
      isPackaged: false, resourcesPath: projectDirectory, projectDirectory,
      platform: 'darwin', arch: 'arm64', osRelease: '25.5.0', runProcess,
    })
    await expect(helper.call('status')).rejects.toMatchObject({ code: 'APPLE_HELPER_UNAVAILABLE' })
    expect(runProcess).not.toHaveBeenCalled()
  })
})
