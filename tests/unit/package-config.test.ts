import { readFileSync } from 'node:fs'
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
})
