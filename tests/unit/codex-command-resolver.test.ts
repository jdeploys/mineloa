import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCodexCommandResolver } from '../../src/main/ai/providers/codexCommandResolver'
import { createOwnedProcessRunner } from '../../src/main/process/runOwnedProcess'

const roots: string[] = []

async function root() {
  const value = await realpath(await mkdtemp(join(tmpdir(), 'nnote-codex-resolver-')))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })))
})

describe('Codex command resolver', () => {
  it('keeps non-Windows invocation direct and shell-free', async () => {
    await expect(createCodexCommandResolver({ platform: 'darwin', pathValue: '/unused' })())
      .resolves.toEqual([{ command: 'codex', argsPrefix: [] }])
  })

  it('prefers a real codex.exe anywhere on Windows PATH even when npm shims precede it', async () => {
    const base = await root()
    const shimDirectory = join(base, 'shim')
    const executableDirectory = join(base, 'executable')
    await mkdir(join(shimDirectory, 'node_modules', '@openai', 'codex', 'bin'), { recursive: true })
    await mkdir(executableDirectory)
    await writeFile(join(shimDirectory, 'codex.cmd'), '@echo unsafe')
    await writeFile(join(shimDirectory, 'codex.ps1'), 'Write-Output unsafe')
    await writeFile(join(shimDirectory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), 'process.exit(0)')
    await copyFile(process.execPath, join(executableDirectory, 'codex.exe'))
    await copyFile(process.execPath, join(executableDirectory, 'node.exe'))

    const candidates = await createCodexCommandResolver({
      platform: 'win32',
      pathValue: `${shimDirectory};${executableDirectory}`,
    })()
    expect(candidates[0]).toEqual({ command: join(executableDirectory, 'codex.exe'), argsPrefix: [] })
    expect(candidates[1]?.argsPrefix).toEqual([
      join(shimDirectory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    ])
    expect(candidates[1]?.command).toBe(join(executableDirectory, 'node.exe'))
  })

  it('rejects directories and shim-only Windows candidates as not installed', async () => {
    const base = await root()
    await mkdir(join(base, 'codex.exe'))
    await writeFile(join(base, 'codex.cmd'), '@echo unsafe')
    await writeFile(join(base, 'codex.ps1'), 'Write-Output unsafe')

    await expect(createCodexCommandResolver({ platform: 'win32', pathValue: base })())
      .resolves.toEqual([])
  })

  it.runIf(process.platform === 'win32')(
    'runs an npm-installed codex.js through a real node.exe with no shell',
    async () => {
      const base = await root()
      const npmDirectory = join(base, 'npm')
      const nodeDirectory = join(base, 'node')
      const binDirectory = join(npmDirectory, 'node_modules', '@openai', 'codex', 'bin')
      await mkdir(binDirectory, { recursive: true })
      await mkdir(nodeDirectory)
      const codexJs = join(binDirectory, 'codex.js')
      const nodeExe = join(nodeDirectory, 'node.exe')
      await copyFile(process.execPath, nodeExe)
      await writeFile(codexJs, "process.stdout.write(JSON.stringify(process.argv.slice(2)))", 'utf8')
      await writeFile(join(npmDirectory, 'codex.cmd'), '@echo unsafe', 'utf8')

      const [resolved] = await createCodexCommandResolver({
        platform: 'win32',
        pathValue: `${npmDirectory};${nodeDirectory}`,
      })()
      expect(resolved).toEqual({ command: nodeExe, argsPrefix: [codexJs] })

      const execution = await createOwnedProcessRunner()({
        command: resolved!.command,
        args: [...resolved!.argsPrefix, '--version'],
        cwd: base,
      })
      expect(execution).toMatchObject({ status: 'success', stdout: '["--version"]' })
    },
  )
})
