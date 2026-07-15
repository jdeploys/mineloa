import { describe, expect, it, vi } from 'vitest'
import { bootstrapAfterImportRecovery } from '../../src/main/app/archiveStartup'

describe('archive import startup recovery', () => {
  it('shows safe copy, closes the DB, quits once, and never starts services or windows after recovery failure', async () => {
    const error = new Error('C:\\private\\recordings\\secret.import.json')
    const quit = vi.fn(); const close = vi.fn(); const showErrorBox = vi.fn(); const start = vi.fn()
    const result = await bootstrapAfterImportRecovery({
      app: { quit }, database: { close }, dialog: { showErrorBox }, recordingsDirectory: 'C:\\private\\recordings',
      reconcile: vi.fn(async () => { throw error }), start,
    })
    expect(result).toBe(false)
    expect(showErrorBox).toHaveBeenCalledWith('Nnote 가져오기 복구 필요', expect.not.stringContaining('C:\\private'))
    expect(close).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })

  it('starts services only after successful reconciliation', async () => {
    const start = vi.fn(async () => undefined)
    const result = await bootstrapAfterImportRecovery({
      app: { quit: vi.fn() }, database: { close: vi.fn() }, dialog: { showErrorBox: vi.fn() }, recordingsDirectory: 'recordings',
      reconcile: vi.fn(async () => undefined), start,
    })
    expect(result).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
  })
})
