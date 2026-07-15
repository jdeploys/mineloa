import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePackageVerificationRequest } from '../../src/main/app/packageVerification'

describe('package verification boundary', () => {
  it('enables verification only for an explicit absolute result path', () => {
    const resultPath = resolve('verification-result.json')
    expect(parsePackageVerificationRequest(['electron', `--nnote-verify-package=${resultPath}`]))
      .toEqual({ resultPath })
  })

  it('keeps the normal application surface unchanged without the explicit switch', () => {
    expect(parsePackageVerificationRequest(['electron'])).toBeNull()
    expect(parsePackageVerificationRequest(['electron', '--nnote-verify-package=relative.json'])).toBeNull()
  })
})

describe('release package configuration', () => {
  const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

  it('uses the public desktop identity and native dependency rebuild', () => {
    expect(manifest.build).toMatchObject({
      appId: 'com.jdeploys.nnote',
      productName: 'Nnote',
      npmRebuild: true,
    })
    expect(manifest.build.win.target).toEqual(expect.arrayContaining(['nsis', 'dir']))
    expect(manifest.build.mac.target).toEqual(expect.arrayContaining(['dmg', 'dir']))
  })

  it('allowlists runtime output and excludes user data and source maps', () => {
    expect(manifest.build.files).toEqual(expect.arrayContaining([
      'out/**/*',
      'package.json',
      '!**/*.map',
      '!**/*.webm',
      '!**/*.nnote',
      '!**/*.sqlite',
      '!**/.env*',
    ]))
  })

  it('defines the exact 0.0.1 cross-platform prerelease contract', () => {
    expect(manifest.version).toBe('0.0.1')
    expect(manifest.scripts).toMatchObject({
      'package:win:x64': expect.stringContaining('--x64'),
      'package:mac:x64': expect.stringContaining('--x64'),
      'package:mac:arm64': expect.stringContaining('--arm64'),
    })
    const workflowPath = resolve('.github/workflows/release.yml')
    expect(existsSync(workflowPath)).toBe(true)
    if (!existsSync(workflowPath)) return
    const workflow = readFileSync(workflowPath, 'utf8')
    expect(workflow).toContain('v0.0.1')
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('--prerelease')
    expect(workflow).toContain('scripts/verify-package.mjs')
  })

  it('packages only the matching platform runtime and never a downloaded model', () => {
    expect(manifest.build).toMatchObject({
      afterPack: 'scripts/after-pack.mjs',
      afterSign: 'scripts/after-sign.mjs',
    })
    expect(manifest.build.win.extraResources).toContainEqual({
      from: 'build/local-runtime/win32-${arch}',
      to: 'local-runtime/win32-${arch}',
    })
    expect(manifest.build.mac.extraResources).toContainEqual({
      from: 'build/local-runtime/darwin-${arch}',
      to: 'local-runtime/darwin-${arch}',
    })
    expect(JSON.stringify(manifest.build)).not.toMatch(/ggml-(?:base|small)\.bin|models\/|models\\/)
  })

  it('builds and verifies each runtime before clobbering the existing prerelease assets', () => {
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    expect(workflow).toContain('build-local-runtime.ps1')
    expect(workflow).toContain('build-local-runtime.sh')
    expect(workflow).toContain('"localRuntime":true')
    expect(workflow).toContain('gh release upload v0.0.1 --clobber')
    expect(workflow).not.toContain('gh release create v0.0.1')
  })

  it('invokes the macOS runtime builder through bash while preserving each workflow architecture argument', () => {
    const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
    const release = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    expect(ci).toContain('bash ./scripts/build-local-runtime.sh "$native_arch"')
    expect(release).toContain('bash ./scripts/build-local-runtime.sh "${{ matrix.arch }}"')
  })

  it('keeps Windows orchestration native and bridges only FFmpeg commands through MSYS2', () => {
    const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
    const release = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    for (const workflow of [ci, release]) {
      expect(workflow).toContain('shell: pwsh')
      expect(workflow).toContain('./scripts/build-local-runtime.ps1 -Arch x64 -FfmpegShell msys2')
      expect(workflow).toContain('npm run package:win:x64')
    }
  })

  it('installs NASM with the Windows toolchain while preserving optimized FFmpeg assembly', () => {
    for (const name of ['ci.yml', 'release.yml']) {
      const workflow = readFileSync(resolve('.github/workflows', name), 'utf8')
      expect(workflow).toContain('mingw-w64-x86_64-toolchain')
      expect(workflow).toMatch(/install:\s+>-\s+(?:.|\r|\n)*?\bnasm\b/)
    }
    const script = readFileSync(resolve('scripts/build-local-runtime.ps1'), 'utf8')
    expect(script).not.toContain('--disable-x86asm')
  })

  it('pins actions, limits permissions, and keeps secrets in the mac package step', () => {
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8').replace(/\r\n/g, '\n')
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).toMatch(/release:\n(?:.|\n)*?permissions:\n\s+contents: write/)
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@(?![a-f0-9]{40}(?:\s+#|\s*$))/m)
    expect(workflow).not.toMatch(/^\s{4}env:\n(?:\s{6}.+\n)*?\s{6}(?:CSC_|APPLE_)/m)
    expect(workflow).toContain("MAC_SIGNING_CONFIGURED: ${{ secrets.CSC_LINK != '' && secrets.CSC_KEY_PASSWORD != '' && secrets.MAC_CSC_NAME != '' }}")
  })

  it('pins every repository workflow action and reserves baseline recording for manual workflow', () => {
    for (const name of ['ci.yml', 'release.yml', 'record-macos-visual-baselines.yml']) {
      const workflow = readFileSync(resolve('.github/workflows', name), 'utf8')
      expect(workflow, name).not.toMatch(/uses:\s+[^\s]+@(?![a-f0-9]{40}(?:\s+#|\s*$))/m)
    }
    expect(readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')).not.toContain('--update-snapshots')
  })

  it('compares reviewed mac baselines during release and records updates only manually', () => {
    const release = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    const recorder = readFileSync(resolve('.github/workflows/record-macos-visual-baselines.yml'), 'utf8')
    expect(release).toContain('processing-settings.visual.pw.ts')
    expect(release).not.toContain('--update-snapshots')
    expect(recorder).toContain('workflow_dispatch:')
    expect(recorder).toContain('--update-snapshots')
    expect(recorder).toContain('tests/visual/snapshots/darwin/processing-*.png')
    expect(recorder).not.toMatch(/uses:\s+[^\s]+@(?![a-f0-9]{40}(?:\s+#|\s*$))/m)
  })

  it('separates hardened Developer ID signing from ad-hoc fallback', () => {
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    const helperHook = readFileSync(resolve('scripts/after-pack.mjs'), 'utf8')
    const appHook = readFileSync(resolve('scripts/after-sign.mjs'), 'utf8')
    expect(manifest.build.mac.hardenedRuntime).toBe(true)
    expect(manifest.build.mac.signIgnore).toEqual([
      '/Contents/Resources/local-runtime/darwin-(?:x64|arm64)/whisper-cli$',
      '/Contents/Resources/local-runtime/darwin-(?:x64|arm64)/ffmpeg$',
    ])
    expect(workflow).toContain('--config.mac.hardenedRuntime=false')
    expect(workflow).toContain('MAC_CSC_NAME')
    expect(workflow).toContain('TeamIdentifier')
    expect(workflow).toContain('DEVELOPER ID SIGNED; UNNOTARIZED')
    expect(helperHook).toContain("identity === '-' ? [] : ['--options', 'runtime', '--timestamp']")
    expect(appHook).not.toContain("'--options', 'runtime'")
    expect(appHook).not.toContain("'--deep'")
    expect(workflow).toMatch(/grep -E .+Mach-O 64-bit executable/)
  })

  it('uses state-neutral release copy for macOS signing diagnostics', () => {
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    expect(workflow).toContain('macOS signing and notarization diagnostics are available as workflow artifacts')
    expect(workflow).not.toContain('attached workflow diagnostics')
    expect(workflow).not.toContain('macOS artifacts are ad-hoc signed and unnotarized unless')
  })

  it('uses electron-builder supported signIgnore regex semantics', () => {
    const schema = JSON.parse(readFileSync(resolve('node_modules/app-builder-lib/scheme.json'), 'utf8'))
    const macSchema = schema.definitions.MacConfiguration.properties.signIgnore
    expect(macSchema.description).toContain('Regex')
    const installedHelper = readFileSync(resolve('node_modules/app-builder-lib/out/mac/MacTargetHelper.js'), 'utf8')
    expect(installedHelper).toContain('new RegExp(it)')
    expect(installedHelper).toContain('regExp.test(file)')
  })
})
