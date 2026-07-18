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
    expect(manifest.name).toBe('mineloa')
    expect(manifest.build).toMatchObject({
      appId: 'com.jdeploys.mineloa',
      productName: 'Mineloa',
      npmRebuild: true,
    })
    expect(manifest.build.artifactName).toBe('${productName}-${version}-${os}-${arch}.${ext}')
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

  it('keeps the existing .nnote archive format during the public rebrand', () => {
    expect(manifest.build.files).toContain('!**/*.nnote')
    expect(readFileSync(resolve('src/main/ipc/registerArchiveHandlers.ts'), 'utf8'))
      .toContain("extensions: ['nnote']")
  })

  it('defines a version-neutral tagged cross-platform prerelease contract', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.scripts).toMatchObject({
      'package:win:x64': expect.stringContaining('--x64'),
      'package:mac:x64': expect.stringContaining('--x64'),
      'package:mac:arm64': expect.stringContaining('--arm64'),
      'package:mas:arm64': expect.stringContaining('--mac mas --arm64'),
    })
    const workflowPath = resolve('.github/workflows/release.yml')
    expect(existsSync(workflowPath)).toBe(true)
    if (!existsSync(workflowPath)) return
    const workflow = readFileSync(workflowPath, 'utf8')
    expect(workflow).not.toContain('0.0.1')
    expect(workflow).toContain("tags: ['v*']")
    expect(workflow).toContain("VERSION=$(node -p \"require('./package.json').version\")")
    expect(workflow).toContain('test "$GITHUB_REF_NAME" = "v${VERSION}"')
    expect(workflow).toMatch(/release:\s+[\s\S]*?steps:\s+- uses: actions\/checkout@/)
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

  it('defines a sandboxed Mac App Store package and automated upload workflow', () => {
    expect(manifest.build.mas).toMatchObject({
      target: ['mas'],
      entitlements: 'build/entitlements.mas.plist',
      entitlementsInherit: 'build/entitlements.mas.inherit.plist',
      signIgnore: [],
      bundleShortVersion: '1.0',
    })
    const entitlements = readFileSync(resolve('build/entitlements.mas.plist'), 'utf8')
    expect(entitlements).toContain('com.apple.security.app-sandbox')
    expect(entitlements).toContain('com.apple.security.device.audio-input')
    expect(entitlements).toContain('com.apple.security.network.client')
    const workflow = readFileSync(resolve('.github/workflows/app-store.yml'), 'utf8')
    expect(workflow).toContain('xcrun altool --validate-app')
    expect(workflow).toContain('xcrun altool --upload-app')
    expect(workflow).toContain('com.jdeploys.mineloa')
  })

  it('builds and verifies each runtime before clobbering the existing prerelease assets', () => {
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    expect(workflow).toContain('build-local-runtime.ps1')
    expect(workflow).toContain('build-local-runtime.sh')
    expect(workflow).toContain('"localRuntime":true')
    expect(workflow).toContain('gh release upload "$TAG" --clobber')
    expect(workflow).toContain('gh release create "$TAG"')
  })

  it('builds the macOS runtime only for release while preserving the matrix architecture argument', () => {
    const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
    const release = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    expect(ci).not.toContain('build-local-runtime.sh')
    expect(release).toContain('bash ./scripts/build-local-runtime.sh "${{ matrix.arch }}"')
  })

  it('keeps runtime builds, packaging, and full validation in the release workflow only', () => {
    const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
    const release = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    expect(ci).toContain('runs-on: windows-latest')
    expect(ci).toContain('npm run test:ci')
    expect(ci).not.toContain('build-local-runtime')
    expect(ci).not.toContain('npm run package:')
    expect(ci).not.toContain('npm run test:release')
    expect(release).toContain('npm run test:release')
    expect(release).toContain('shell: pwsh')
    expect(release).toContain('./scripts/build-local-runtime.ps1 -Arch x64 -FfmpegShell msys2')
    expect(release).toContain('npm run package:win:x64')
  })

  it('anchors the Windows release build log outside the temporary runtime tree', () => {
    const release = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
    expect(release).toContain("$runtimeLog = Join-Path $PWD 'runtime-build.log'")
    expect(release).toContain('Tee-Object -LiteralPath $runtimeLog')
    expect(ci).not.toContain('Tee-Object -LiteralPath $runtimeLog')
  })

  it('installs NASM with the release Windows toolchain while preserving optimized FFmpeg assembly', () => {
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    expect(workflow).toContain('mingw-w64-x86_64-toolchain')
    expect(workflow).toMatch(/install:\s+>-\s+(?:.|\r|\n)*?\bnasm\b/)
    const script = readFileSync(resolve('scripts/build-local-runtime.ps1'), 'utf8')
    expect(script).not.toContain('--disable-x86asm')
  })

  it('installs NASM for the Intel macOS release runtime and accepts padded file output', () => {
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    expect(workflow).toContain('if [[ "${{ matrix.arch }}" == x64 ]]; then')
    expect(workflow).toContain('brew install nasm')
    expect(workflow).toContain('whisper-cli:[[:space:]]+Mach-O 64-bit executable ${expected_arch}$')
    expect(workflow).toContain('ffmpeg:[[:space:]]+Mach-O 64-bit executable ${expected_arch}$')
  })

  it('keeps Apple Silicon NASM setup conditional and Windows runtime setup unchanged', () => {
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8').replace(/\r\n/g, '\n')
    expect(workflow).toMatch(/if \[\[ "\$\{\{ matrix\.arch \}\}" == x64 \]\]; then\n\s+brew install nasm\n\s+fi/)
    expect(workflow).toContain('./scripts/build-local-runtime.ps1 -Arch x64 -FfmpegShell msys2')
  })

  it('pins actions, limits permissions, and keeps secrets in the mac package step', () => {
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8').replace(/\r\n/g, '\n')
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).toMatch(/release:\n(?:.|\n)*?permissions:\n\s+contents: write/)
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@(?![a-f0-9]{40}(?:\s+#|\s*$))/m)
    expect(workflow).not.toMatch(/^\s{4}env:\n(?:\s{6}.+\n)*?\s{6}(?:CSC_|APPLE_)/m)
    expect(workflow).toContain("MAC_SIGNING_CONFIGURED: ${{ secrets.CSC_LINK != '' && secrets.CSC_KEY_PASSWORD != '' && secrets.MAC_CSC_NAME != '' }}")
  })

  it('pins every repository workflow action', () => {
    for (const name of ['ci.yml', 'release.yml', 'app-store.yml']) {
      const workflow = readFileSync(resolve('.github/workflows', name), 'utf8')
      expect(workflow, name).not.toMatch(/uses:\s+[^\s]+@(?![a-f0-9]{40}(?:\s+#|\s*$))/m)
    }
  })

  it('keeps routine CI platform-neutral and leaves macOS packaging to release jobs', () => {
    const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
    const release = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
    expect(ci).not.toContain('mac-visual-baseline:')
    expect(ci).not.toContain('macos-latest')
    expect(ci).not.toContain('Package and verify macOS')
    expect(release).not.toContain('processing-settings.visual.pw.ts')
    expect(release).not.toContain('visual-comparison-macos')
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
    expect(helperHook).toContain("? ['--entitlements', 'build/entitlements.mas.inherit.plist']")
    expect(helperHook).toContain(": ['--options', 'runtime', '--timestamp']")
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
