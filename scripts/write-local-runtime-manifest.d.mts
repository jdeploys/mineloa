export interface RuntimeManifestWriteOptions {
  directory: string
  platform: 'win32' | 'darwin'
  arch: string
  replaceExisting?: boolean
}

export function writeRuntimeManifest(options: RuntimeManifestWriteOptions): Promise<void>
