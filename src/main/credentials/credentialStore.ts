export interface CredentialStore {
  get(): Promise<string | null>
  set(value: string): Promise<void>
  delete(): Promise<void>
}
