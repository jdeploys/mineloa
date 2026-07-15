import { describe, expect, it, vi } from 'vitest'
import type { CredentialStore } from '../../src/main/credentials/credentialStore'
import { KeyringCredentialStore } from '../../src/main/credentials/keyringCredentialStore'
import { OpenAiKeyValidator } from '../../src/main/ai/openAiKeyValidator'
import { registerSettingsHandlers } from '../../src/main/ipc/registerSettingsHandlers'

class MemoryCredentialStore implements CredentialStore {
  private value: string | null = null

  async get(): Promise<string | null> {
    return this.value
  }

  async set(value: string): Promise<void> {
    this.value = value
  }

  async delete(): Promise<void> {
    this.value = null
  }
}

describe('OpenAI credential settings', () => {
  it('maps a missing native keyring entry to null', async () => {
    const entry = {
      getPassword: vi.fn().mockReturnValue(null),
      setPassword: vi.fn(),
      deletePassword: vi.fn(),
    }
    const store = new KeyringCredentialStore(entry)

    await expect(store.get()).resolves.toBeNull()
  })

  it('stores and deletes the OpenAI key through the credential port', async () => {
    const store = new MemoryCredentialStore()

    await store.set('sk-test')
    expect(await store.get()).toBe('sk-test')

    await store.delete()
    expect(await store.get()).toBeNull()
  })

  it('rejects a malformed key without making an OpenAI request', async () => {
    const createClient = vi.fn()
    const validator = new OpenAiKeyValidator(createClient)

    await expect(validator.validate('not-a-key')).rejects.toThrow('must start with sk-')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('validates before storing and reports status without the key', async () => {
    const store = new MemoryCredentialStore()
    const validate = vi.fn().mockResolvedValue(undefined)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()

    registerSettingsHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      store,
      { validate },
      () => new Date('2026-07-14T01:02:03.000Z'),
    )

    await handlers.get('settings:save-api-key')?.({}, 'sk-test')

    expect(validate).toHaveBeenCalledWith('sk-test')
    expect(await store.get()).toBe('sk-test')
    await expect(handlers.get('settings:get-api-key-status')?.({})).resolves.toEqual({
      configured: true,
      lastValidatedAt: '2026-07-14T01:02:03.000Z',
    })

    await handlers.get('settings:delete-api-key')?.({})
    expect(await store.get()).toBeNull()
    await expect(handlers.get('settings:get-api-key-status')?.({})).resolves.toEqual({
      configured: false,
      lastValidatedAt: null,
    })
  })

  it('does not replace the saved key when validation fails', async () => {
    const store = new MemoryCredentialStore()
    await store.set('sk-existing')
    const handlers = new Map<string, (...args: unknown[]) => unknown>()

    registerSettingsHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      store,
      { validate: vi.fn().mockRejectedValue(new Error('Invalid API key')) },
    )

    await expect(handlers.get('settings:save-api-key')?.({}, 'sk-invalid')).rejects.toThrow(
      'Invalid API key',
    )
    expect(await store.get()).toBe('sk-existing')
  })
})
