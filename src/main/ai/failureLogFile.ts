import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const FAILURE_LOG_LIMIT_BYTES = 1024 * 1024

export function failureLogFile(directory: string, now: () => Date = () => new Date()): (line: string) => void {
  const path = join(directory, 'main.log')
  return (line) => {
    console.warn(line)
    try {
      mkdirSync(directory, { recursive: true })
      if ((statSync(path, { throwIfNoEntry: false })?.size ?? 0) > FAILURE_LOG_LIMIT_BYTES) renameSync(path, `${path}.1`)
      appendFileSync(path, `${now().toISOString()} ${line}\n`)
    } catch (error) {
      console.warn('Failure log write failed', error)
    }
  }
}
