export interface ArchiveStartupDependencies {
  app: { quit(): void }
  database: { close(): void }
  dialog: { showErrorBox(title: string, content: string): void }
  recordingsDirectory: string
  reconcile(): Promise<void>
  start(): void | Promise<void>
}

export async function bootstrapAfterImportRecovery(dependencies: ArchiveStartupDependencies): Promise<boolean> {
  try {
    await dependencies.reconcile()
  } catch {
    try {
      dependencies.dialog.showErrorBox(
        'Nnote 가져오기 복구 필요',
        '완료되지 않은 가져오기 기록을 안전하게 복구하지 못했습니다. 파일은 보존되었습니다.',
      )
    } finally {
      try { dependencies.database.close() }
      finally { dependencies.app.quit() }
    }
    return false
  }
  await dependencies.start()
  return true
}
