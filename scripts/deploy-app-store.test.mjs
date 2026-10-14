import test from 'node:test'
import assert from 'node:assert/strict'
import { deploy, parseArguments } from './deploy-app-store.mjs'

test('rejects invalid versions, build numbers, and duplicate arguments', () => {
  for (const args of [[], ['--version', '1.0', '--build', '0'], ['--version', '$(id)', '--build', '6'], ['--version', '1.0', '--build', '6', '--build', '7']]) {
    assert.throws(() => parseArguments(args))
  }
  assert.deepEqual(parseArguments(['--version', '1.0', '--build', '6', '--build-only']), { upload: false, dryRun: false, version: '1.0', build: '6' })
})

test('dirty or unpushed changes cannot dispatch', async () => {
  const options = parseArguments(['--version', '1.0', '--build', '6'])
  await assert.rejects(deploy(options, () => ' M package.json'), /Commit all changes/)
  const calls = []
  await assert.rejects(deploy(options, (command, args) => {
    calls.push([command, ...args])
    if (args[0] === 'branch') return 'main'
    if (args[0] === 'rev-parse') return 'local'
    if (args[0] === 'ls-remote') return 'remote\trefs/heads/main'
    return ''
  }), /Push main/)
  assert.equal(calls.some(call => call.includes('workflow')), false)
})

test('watches only its own dispatch and propagates failed workflow without downloading', async () => {
  let requestId
  const calls = []
  await assert.rejects(deploy(parseArguments(['--version', '1.0', '--build', '6']), (command, args) => {
    calls.push([command, ...args])
    if (args[0] === 'branch') return 'main'
    if (args[0] === 'rev-parse') return 'abc'
    if (args[0] === 'ls-remote') return 'abc\trefs/heads/main'
    if (args[0] === 'workflow') requestId = args.find(value => value.startsWith('request_id=')).split('=')[1]
    if (args[1] === 'list') return JSON.stringify([{ databaseId: 1, displayTitle: 'Earlier run' }, { databaseId: 2, displayTitle: `App Store 1.0 (6) ${requestId}`, url: 'https://example.com/run/2' }])
    if (args[1] === 'watch') {
      assert.equal(args[2], '2')
      throw new Error('workflow failed')
    }
    return ''
  }), /workflow failed/)
  assert.equal(calls.some(call => call.includes('download')), false)
})
