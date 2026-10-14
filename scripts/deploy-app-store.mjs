import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))

export function parseArguments(args) {
  if (args.includes('--help')) return { help: true }
  const options = { upload: true, dryRun: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--version' || arg === '--build') {
      const key = arg === '--version' ? 'version' : 'build'
      if (options[key] !== undefined) throw new Error(`Duplicate option: ${arg}`)
      options[key] = args[++i]
    } else if (arg === '--build-only') options.upload = false
    else if (arg === '--dry-run') options.dryRun = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(options.version ?? '')) throw new Error('--version requires a numeric App Store version, e.g. 1.0')
  if (!/^[1-9]\d*$/.test(options.build ?? '')) throw new Error('--build requires a unique positive integer, e.g. 6')
  return options
}

export async function deploy(options, run, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (run('git', ['status', '--porcelain']).trim()) throw new Error('Commit all changes before deployment.')
  const branch = run('git', ['branch', '--show-current']).trim()
  if (!branch) throw new Error('Check out a branch before deployment.')
  const sha = run('git', ['rev-parse', 'HEAD']).trim()
  const requestId = randomUUID()
  const fields = ['-f', `marketing_version=${options.version}`, '-f', `build_number=${options.build}`, '-f', `upload=${options.upload}`, '-f', `request_id=${requestId}`]
  const dispatch = ['workflow', 'run', 'app-store.yml', '--ref', branch, ...fields]
  if (options.dryRun) {
    console.log(JSON.stringify({ command: ['gh', ...dispatch], commit: sha }, null, 2))
    return
  }
  run('gh', ['auth', 'status'])
  const remoteSha = run('git', ['ls-remote', 'origin', `refs/heads/${branch}`]).trim().split(/\s/)[0]
  if (remoteSha !== sha) throw new Error(`Push ${branch} before deployment.`)
  run('gh', dispatch)
  let workflowRun
  for (let attempt = 0; attempt < 30; attempt++) {
    const runs = JSON.parse(run('gh', ['run', 'list', '--workflow', 'app-store.yml', '--branch', branch, '--commit', sha, '--event', 'workflow_dispatch', '--limit', '100', '--json', 'databaseId,displayTitle,url']))
    workflowRun = runs.find(candidate => candidate.displayTitle.endsWith(requestId))
    if (workflowRun) break
    await pause(2000)
  }
  if (!workflowRun) throw new Error(`Dispatched but could not locate run ${requestId}. Check GitHub Actions before retrying.`)
  console.log(workflowRun.url)
  run('gh', ['run', 'watch', String(workflowRun.databaseId), '--exit-status'], true)
  const destination = path.join(root, 'dist', `app-store-${options.version}-${options.build}`, String(workflowRun.databaseId))
  mkdirSync(destination, { recursive: true })
  run('gh', ['run', 'download', String(workflowRun.databaseId), '--name', `mineloa-mas-${options.version}-${options.build}`, '--dir', destination], true)
  console.log(`${options.upload ? 'App Store Connect upload' : 'Signed build'} completed. Artifacts: ${destination}`)
  console.log('Review submission and review correspondence are managed separately in App Store Connect.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) console.log('npm run deploy:app-store -- --version 1.0 --build 6 [--build-only] [--dry-run]\nRequires git, authenticated gh, a clean pushed branch, and configured app-store environment secrets.')
    else await deploy(options, (command, args, stream = false) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: stream ? 'inherit' : ['ignore', 'pipe', 'inherit'] }) ?? '')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
