import { Entry } from '@napi-rs/keyring'
import type { CredentialStore } from './credentialStore'

interface KeyringEntry {
  getPassword(): string | null
  setPassword(value: string): void
  deletePassword(): boolean | void
}

export class KeyringCredentialStore implements CredentialStore {
  constructor(private readonly entry: KeyringEntry = new Entry('Nnote', 'openai-api-key')) {}

  async get(): Promise<string | null> {
    return this.entry.getPassword() ?? null
  }

  async set(value: string): Promise<void> {
    this.entry.setPassword(value)
  }

  async delete(): Promise<void> {
    this.entry.deletePassword()
  }
}
