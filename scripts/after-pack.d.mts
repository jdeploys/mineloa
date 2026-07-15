import type { RuntimeManifestWriteOptions } from './write-local-runtime-manifest.mjs'

interface AfterPackContext {
  electronPlatformName: string
  appOutDir: string
  packager: { appInfo: { productFilename: string } }
}

interface AfterPackDependencies {
  sign?(identity: string, helper: string): Promise<void> | void
  writeManifest?(options: RuntimeManifestWriteOptions): Promise<void>
  identity?(): string
}

export function createAfterPackHook(dependencies?: AfterPackDependencies): (context: AfterPackContext) => Promise<void>
declare const hook: (context: AfterPackContext) => Promise<void>
export default hook
