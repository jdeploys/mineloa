interface AfterSignContext {
  electronPlatformName: string
  appOutDir: string
  packager: { appInfo: { productFilename: string } }
}

interface CommandResult { status: number | null; error?: Error }
interface AfterSignDependencies {
  run?(program: string, args: string[]): CommandResult
  signingConfigured?(): boolean
}

export function createAfterSignHook(dependencies?: AfterSignDependencies): (context: AfterSignContext) => Promise<void>
declare const hook: (context: AfterSignContext) => Promise<void>
export default hook
