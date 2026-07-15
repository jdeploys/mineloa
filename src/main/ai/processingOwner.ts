import { randomUUID } from 'node:crypto'

// One identity per Main-process lifetime. A different value after restart makes
// unfinished database attempts safely distinguishable from live local work.
export const PROCESS_OWNER_ID: string = randomUUID()
