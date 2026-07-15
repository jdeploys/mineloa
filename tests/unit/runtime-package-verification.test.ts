import { describe, expect, it, vi } from 'vitest'
import { collectRuntimeVerificationSignals } from '../../src/main/app/runtimePackageVerification'

describe('packaged runtime verification', () => {
  it('checks main, SQLite, keyring, preload, and renderer through real runtime ports', async () => {
    const close = vi.fn()
    const signals = await collectRuntimeVerificationSignals({
      checkSqlite: () => ({ value: 1, close }),
      checkKeyring: () => true,
      checkRenderer: async () => ({ title: 'Nnote', desktopApiAvailable: true, dashboardVisible: true }),
    })

    expect(signals).toEqual({ main: true, sqlite: true, keyring: true, preload: true, renderer: true })
    expect(close).toHaveBeenCalledOnce()
  })

  it('names the failing component instead of reporting a generic launch failure', async () => {
    await expect(collectRuntimeVerificationSignals({
      checkSqlite: () => ({ value: 1, close: () => undefined }),
      checkKeyring: () => true,
      checkRenderer: async () => ({ title: 'wrong', desktopApiAvailable: true, dashboardVisible: true }),
    })).rejects.toThrow('renderer')
  })
})
