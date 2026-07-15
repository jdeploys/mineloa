import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

export function openDatabase(path: string): Database.Database {
  const database = new Database(path)
  try {
    database.pragma('foreign_keys = ON')
    database.pragma('journal_mode = WAL')
    database.pragma('busy_timeout = 5000')
    runMigrations(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}
