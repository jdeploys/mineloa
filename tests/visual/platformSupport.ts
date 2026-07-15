export function hasTask10VisualBaseline(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}
