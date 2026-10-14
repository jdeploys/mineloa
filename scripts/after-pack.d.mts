import type { RuntimeManifestWriteOptions } from './write-local-runtime-manifest.mjs'
import type { SignOptions } from '@electron/osx-sign'

interface AfterPackContext {
  electronPlatformName: string
  appOutDir: string
  packager: {
    appInfo: { productFilename: string }
    codeSigningInfo?: { value: Promise<{ keychainFile?: string | null }> }
    _activePackConfig?: { type?: string; identity?: string | null }
    platformSpecificBuildOptions?: { type?: string; identity?: string | null }
    helper?: { findSigningIdentity(isMas: boolean, isDevelopment: boolean, qualifier: string | null | undefined, keychainFile: string | null, config: { type?: string; identity?: string | null }): Promise<{ hash?: string; name?: string } | null> }
  }
}

interface AfterPackDependencies {
  run?(command: string, args: string[]): { status: number | null, error?: Error }
  writeManifest?(options: RuntimeManifestWriteOptions): Promise<void>
  identity?(context: AfterPackContext, masBuild: boolean): string | Promise<string>
  signApplication?(options: SignOptions): Promise<void>
}

export function createAfterPackHook(dependencies?: AfterPackDependencies): (context: AfterPackContext) => Promise<void>
declare const hook: (context: AfterPackContext) => Promise<void>
export default hook
