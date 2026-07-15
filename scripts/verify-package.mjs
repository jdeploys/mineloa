import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

function fail(component, detail = '') {
  throw new Error(`Package verification failed: ${component}${detail ? ` (${detail})` : ''}`)
}

function resolveExecutable(packagePath) {
  const absolute = resolve(packagePath)
  if (process.platform === 'win32') {
    const direct = join(absolute, 'Nnote.exe')
    if (existsSync(direct)) return direct
  }
  if (process.platform === 'darwin') {
    const appPath = absolute.endsWith('.app') ? absolute : join(absolute, 'Nnote.app')
    const executable = join(appPath, 'Contents', 'MacOS', 'Nnote')
    if (existsSync(executable)) return executable
  }
  fail('executable', basename(absolute))
}

const packagePath = process.argv[2]
if (!packagePath) fail('arguments', 'expected unpacked directory or .app path')
const executable = resolveExecutable(packagePath)
const temporary = await mkdtemp(join(tmpdir(), 'nnote-package-verification-'))
const resultPath = join(temporary, 'result.json')
const userDataPath = join(temporary, 'user-data')

try {
  const run = spawnSync(executable, [
    `--user-data-dir=${userDataPath}`,
    `--nnote-verify-package=${resultPath}`,
  ], { encoding: 'utf8', timeout: 45_000, windowsHide: true })
  if (run.error) fail('launch', run.error.message)
  if (!existsSync(resultPath)) fail('runtime-result', `exit ${run.status}; ${run.stderr.trim()}`)
  const result = JSON.parse(await readFile(resultPath, 'utf8'))
  if (!result.ok) fail('runtime', result.error)
  for (const component of ['main', 'sqlite', 'keyring', 'preload', 'renderer']) {
    if (result.signals?.[component] !== true) fail(component)
  }
  if (run.status !== 0) fail('exit', String(run.status))
  process.stdout.write(`VERIFIED ${JSON.stringify(result.signals)}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
