import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OwnedProcessRequest, OwnedProcessResult } from '../../process/runOwnedProcess'
import {
  OwnedTemporaryFileInvalidError,
  OwnedTemporaryFiles,
  OwnedTemporaryFileTooLargeError,
} from '../../localRuntime/ownedTemporaryFiles'
import {
  createCodexCommandResolver,
  type CodexCommandResolver,
} from './codexCommandResolver'
import { ProviderError, safeProviderError } from './providerErrors'
import type {
  ProviderAvailability,
  ProviderDescriptor,
  SummaryProvider,
  SummaryRequest,
} from './providerPorts'

export type OwnedProcessRunner = (request: OwnedProcessRequest) => Promise<OwnedProcessResult>

export interface CodexSummaryFiles {
  mkdtemp: typeof mkdtemp
  writeFile: typeof writeFile
  rm: typeof rm
}

export type CodexResultReader = (ownedDirectory: string) => Promise<string>

const nodeFiles: CodexSummaryFiles = { mkdtemp, writeFile, rm }
const MAX_RESULT_BYTES = 4 * 1024 * 1024
const readOwnedResult: CodexResultReader = async (ownedDirectory) => {
  const ownedFiles = await OwnedTemporaryFiles.capture(ownedDirectory)
  return ownedFiles.readText(join(ownedDirectory, 'result.json'), MAX_RESULT_BYTES)
}

const available: ProviderAvailability = { available: true, code: null, message: null }
const availabilityMessages = {
  CODEX_NOT_INSTALLED: 'Codex CLI is not installed.',
  CODEX_NOT_AUTHENTICATED: 'Codex CLI is not authenticated.',
  CODEX_CONFIG_INVALID: 'Codex CLI configuration is invalid.',
  CODEX_UNAVAILABLE: 'Codex CLI is unavailable.',
} as const

type UnavailableCode = keyof typeof availabilityMessages

export class CodexCliSummaryAdapter implements SummaryProvider {
  readonly id = 'codex_cli' as const

  constructor(
    private readonly runProcess: OwnedProcessRunner,
    private readonly temporaryRoot: string,
    private readonly resolveCommand: CodexCommandResolver = createCodexCommandResolver(),
    private readonly files: CodexSummaryFiles = nodeFiles,
    private readonly readResult: CodexResultReader = readOwnedResult,
  ) {}

  async availability(): Promise<ProviderAvailability> {
    try {
      const result = await this.runResolvedCommand({
        args: ['login', 'status'],
        cwd: this.temporaryRoot,
      })
      if (result.status === 'success') return available
      return unavailable(classifyAvailability(result))
    } catch {
      return unavailable('CODEX_UNAVAILABLE')
    }
  }

  async descriptor(): Promise<ProviderDescriptor> {
    return {
      id: this.id,
      stage: 'summary',
      displayName: 'Codex CLI',
      availability: await this.availability(),
      privacy: 'text_cloud',
      capabilities: ['cli_status'],
    }
  }

  async summarize(request: SummaryRequest): Promise<string> {
    let ownedDirectory: string | undefined
    let operationFailed = false
    try {
      const canonicalTemporaryRoot = await realpath(this.temporaryRoot)
      ownedDirectory = await this.files.mkdtemp(join(canonicalTemporaryRoot, 'nnote-codex-summary-'))
      await this.files.writeFile(join(ownedDirectory, 'schema.json'), JSON.stringify(request.schema), 'utf8')
      const processResult = await this.runResolvedCommand({
        args: [
          'exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check',
          '--output-schema', 'schema.json', '--output-last-message', 'result.json', '-',
        ],
        cwd: ownedDirectory,
        stdin: request.input,
      })
      if (processResult.status !== 'success') throw executionError(processResult)

      let resultText: string
      try {
        resultText = await this.readResult(ownedDirectory)
      } catch (error) {
        if (
          hasErrorCode(error, 'ENOENT')
          || error instanceof OwnedTemporaryFileInvalidError
          || error instanceof OwnedTemporaryFileTooLargeError
        ) throw invalidSummaryError()
        throw safeProviderError('CODEX_UNAVAILABLE', 'Codex CLI summary failed.', true)
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(resultText)
      } catch {
        throw invalidSummaryError()
      }
      if (!matchesSchema(parsed, request.schema)) throw invalidSummaryError()
      return JSON.stringify(parsed)
    } catch (error) {
      operationFailed = true
      if (error instanceof ProviderError) throw error
      throw safeProviderError('CODEX_UNAVAILABLE', 'Codex CLI summary failed.', true)
    } finally {
      if (ownedDirectory !== undefined) {
        try {
          await this.files.rm(ownedDirectory, { recursive: true, force: true })
        } catch {
          if (!operationFailed) {
            throw safeProviderError('CODEX_UNAVAILABLE', 'Codex CLI summary failed.', true)
          }
        }
      }
    }
  }

  private async runResolvedCommand(
    request: Omit<OwnedProcessRequest, 'command'>,
  ): Promise<OwnedProcessResult> {
    return runResolvedCodexCommand(this.runProcess, this.resolveCommand, request)
  }
}

export async function runResolvedCodexCommand(
  runProcess: OwnedProcessRunner,
  resolveCommand: CodexCommandResolver,
  request: Omit<OwnedProcessRequest, 'command'>,
): Promise<OwnedProcessResult> {
  const candidates = await resolveCommand()
  if (candidates.length === 0) return { status: 'spawn_error', code: 'ENOENT' }

  let lastSpawnFailure: OwnedProcessResult = { status: 'spawn_error', code: 'ENOENT' }
  for (const candidate of candidates) {
    const result = await runProcess({
      ...request,
      command: candidate.command,
      args: [...candidate.argsPrefix, ...request.args],
    })
    if (!isSpawnLayerFailure(result)) return result
    lastSpawnFailure = result
  }
  return lastSpawnFailure
}

function unavailable(code: UnavailableCode): ProviderAvailability {
  return { available: false, code, message: availabilityMessages[code] }
}

function classifyAvailability(result: Exclude<OwnedProcessResult, { status: 'success' }>): UnavailableCode {
  if (result.status === 'spawn_error' && result.code === 'ENOENT') return 'CODEX_NOT_INSTALLED'
  if (result.status !== 'nonzero_exit') return 'CODEX_UNAVAILABLE'
  const diagnostic = `${result.stdout}\n${result.stderr}`.toLowerCase()
  if (/config\.toml|invalid config|failed to (?:load|parse) config|unknown (?:field|variant)/.test(diagnostic)) {
    return 'CODEX_CONFIG_INVALID'
  }
  if (/not logged in|not authenticated|unauthenticated|login required|please log in/.test(diagnostic)) {
    return 'CODEX_NOT_AUTHENTICATED'
  }
  return 'CODEX_UNAVAILABLE'
}

function executionError(result: Exclude<OwnedProcessResult, { status: 'success' }>) {
  if (result.status === 'spawn_error' && result.code === 'ENOENT') {
    return safeProviderError('CODEX_NOT_INSTALLED', availabilityMessages.CODEX_NOT_INSTALLED, true)
  }
  return safeProviderError('CODEX_UNAVAILABLE', 'Codex CLI summary failed.', true)
}

function isSpawnLayerFailure(result: OwnedProcessResult): boolean {
  return result.status === 'spawn_error'
    && ['ENOENT', 'EACCES', 'EPERM', 'EINVAL'].includes(result.code)
}

function invalidSummaryError() {
  return safeProviderError(
    'CODEX_INVALID_SUMMARY',
    'Codex CLI returned an invalid summary response.',
    false,
  )
}

function matchesSchema(value: unknown, rawSchema: { [key: string]: unknown }): boolean {
  return validateSchema(value, rawSchema)
}

function validateSchema(value: unknown, schema: unknown): boolean {
  if (!isRecord(schema)) return false
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some((candidate) => validateSchema(value, candidate))
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) return false

  switch (schema.type) {
    case 'null':
      return value === null
    case 'string':
      return typeof value === 'string'
        && (typeof schema.minLength !== 'number' || value.length >= schema.minLength)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
        && (typeof schema.minItems !== 'number' || value.length >= schema.minItems)
        && (typeof schema.maxItems !== 'number' || value.length <= schema.maxItems)
        && (schema.items === undefined || value.every((item) => validateSchema(item, schema.items)))
    case 'object': {
      if (!isRecord(value)) return false
      const properties = isRecord(schema.properties) ? schema.properties : {}
      const required = Array.isArray(schema.required) ? schema.required : []
      if (!required.every((key) => typeof key === 'string' && Object.hasOwn(value, key))) return false
      if (schema.additionalProperties === false
        && Object.keys(value).some((key) => !Object.hasOwn(properties, key))) return false
      return Object.entries(properties).every(([key, propertySchema]) =>
        !Object.hasOwn(value, key) || validateSchema(value[key], propertySchema))
    }
    default:
      return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code
}
