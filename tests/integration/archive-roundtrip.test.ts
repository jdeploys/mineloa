import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import { TemplateRepository } from '../../src/main/db/templateRepository'
import { exportMeetingArchive } from '../../src/main/archive/exportMeeting'
import { importMeetingArchive, reconcileImportJournals } from '../../src/main/archive/importMeeting'
import { parseArchive } from '../../src/main/archive/archiveSchema'

describe('Nnote archive round trip', () => {
  const minimalWebm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x18, 0x53, 0x80, 0x67, 0xff])
  const roots: string[] = []
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

  it('exports archive v2 with every ordered recording part and imports ownership for all parts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nnote-archive-v2-')); roots.push(root)
    const sourceRecordings = join(root, 'source'); const targetRecordings = join(root, 'target')
    await mkdir(sourceRecordings); await mkdir(targetRecordings)
    const sourceDb = openDatabase(join(root, 'source.sqlite')); const targetDb = openDatabase(join(root, 'target.sqlite'))
    const now = '2026-07-15T00:00:00.000Z'
    const first = 'source.part-0.webm'; const second = 'source.part-1.webm'
    await writeFile(join(sourceRecordings, first), minimalWebm)
    await writeFile(join(sourceRecordings, second), minimalWebm)
    sourceDb.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('source', '회의', now, now, 2, 'recorded', 'keep', first, minimalWebm.byteLength * 2, null)
    sourceDb.prepare('INSERT INTO recording_parts VALUES (?, ?, ?, ?, ?)').run('source', 0, first, minimalWebm.byteLength, 1)
    sourceDb.prepare('INSERT INTO recording_parts VALUES (?, ?, ?, ?, ?)').run('source', 1, second, minimalWebm.byteLength, 2)

    const exported = await exportMeetingArchive('source', new MeetingRepository(sourceDb), new TemplateRepository(sourceDb), sourceRecordings)
    const parsed = parseArchive(exported.bytes)
    expect(parsed.manifest.version).toBe(2)
    expect(parsed.audioParts.map((part) => [part.partIndex, part.entry, part.bytes])).toEqual([
      [0, 'audio/part-0.webm', minimalWebm],
      [1, 'audio/part-1.webm', minimalWebm],
    ])
    expect(exported.audioCoverage).toBe('all-parts')

    const imported = await importMeetingArchive(exported.bytes, targetDb, targetRecordings)
    const parts = new MeetingRepository(targetDb).listRecordingParts(imported.meetingId)
    expect(parts.map((part) => [part.partIndex, part.byteCount, part.durationMs])).toEqual([[0, minimalWebm.byteLength, 1], [1, minimalWebm.byteLength, 2]])
    expect(await Promise.all(parts.map((part) => readFile(join(targetRecordings, part.relativePath))))).toEqual([Buffer.from(minimalWebm), Buffer.from(minimalWebm)])
    sourceDb.close(); targetDb.close()
  })

  it('remaps IDs while preserving semantic content and a relative retained WebM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nnote-archive-')); roots.push(root)
    const sourceRecordings = join(root, 'source-recordings'); const targetRecordings = join(root, 'target-recordings')
    await mkdir(sourceRecordings); await mkdir(targetRecordings)
    const sourceDb = openDatabase(join(root, 'source.sqlite')); const targetDb = openDatabase(join(root, 'target.sqlite'))
    const sectionId = '10000000-0000-4000-8000-000000000009'
    const now = '2026-07-15T00:00:00.000Z'
    const template = { id: 'custom-template', name: '고객 회의', isDefault: false, sections: [{ id: sectionId, title: '할 일', kind: 'action_items' as const, prompt: '할 일' }], createdAt: now, updatedAt: now }
    new TemplateRepository(sourceDb).save(template)
    const audioName = 'meeting.part-0.webm'; const audio = minimalWebm
    await writeFile(join(sourceRecordings, audioName), audio)
    sourceDb.prepare(`INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('original', '고객 회의', now, now, 5000, 'completed', 'keep', audioName, audio.byteLength, template.id)
    sourceDb.prepare('INSERT INTO speakers VALUES (?, ?, ?)').run('0:B', 'original', '홍길동')
    sourceDb.prepare('INSERT INTO transcript_segments VALUES (?, ?, ?, ?, ?, ?)').run('seg-old', 'original', '0:B', 0, 5000, '진행합니다')
    sourceDb.prepare('INSERT INTO summary_sections VALUES (?, ?, ?, ?, ?, ?)').run('sum-old', 'original', sectionId, 'action_items', JSON.stringify({ text: '', items: [] }), 0)
    sourceDb.prepare('INSERT INTO action_items VALUES (?, ?, ?, ?, ?, ?)').run('act-old', 'original', '배포', '0:B', null, 0)

    const exported = await exportMeetingArchive('original', new MeetingRepository(sourceDb), new TemplateRepository(sourceDb), sourceRecordings)
    const parsed = parseArchive(exported.bytes)
    expect(JSON.stringify(parsed)).not.toContain(sourceRecordings)
    expect(JSON.stringify(parsed)).not.toMatch(/sk-|processing_attempt/i)
    const imported = await importMeetingArchive(exported.bytes, targetDb, targetRecordings)
    expect(imported.meetingId).not.toBe('original')
    const target = new MeetingRepository(targetDb)
    expect(target.requireById(imported.meetingId)).toMatchObject({ title: '고객 회의', audioPath: expect.not.stringContaining('\\'), selectedTemplateId: expect.any(String) })
    expect(target.listSpeakers(imported.meetingId).map((s) => s.displayName)).toEqual(['홍길동'])
    expect(target.listTranscript(imported.meetingId).map((s) => [s.startMs, s.endMs, s.text])).toEqual([[0, 5000, '진행합니다']])
    expect(target.listActionItems(imported.meetingId).map((item) => item.content)).toEqual(['배포'])
    expect(await readFile(join(targetRecordings, target.requireById(imported.meetingId).audioPath!))).toEqual(Buffer.from(audio))
    sourceDb.close(); targetDb.close()
  })

  it('performs no writes when validation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nnote-archive-bad-')); roots.push(root)
    const recordings = join(root, 'recordings'); const database = openDatabase(join(root, 'target.sqlite'))
    await expect(importMeetingArchive(new Uint8Array([1, 2, 3]), database, recordings)).rejects.toThrow()
    expect(database.prepare('SELECT count(*) count FROM meetings').get()).toEqual({ count: 0 })
    database.close()
  })

  it('rolls back database rows and removes staged audio when the database commit fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nnote-archive-rollback-')); roots.push(root)
    const sourceRecordings = join(root, 'source'); const targetRecordings = join(root, 'target')
    await mkdir(sourceRecordings); await mkdir(targetRecordings)
    const sourceDb = openDatabase(join(root, 'source.sqlite')); const targetDb = openDatabase(join(root, 'target.sqlite'))
    const now = '2026-07-15T00:00:00.000Z'; const audioName = 'safe.webm'
    await writeFile(join(sourceRecordings, audioName), minimalWebm)
    sourceDb.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('source', '회의', now, now, 1, 'completed', 'keep', audioName, minimalWebm.byteLength, null)
    const exported = await exportMeetingArchive('source', new MeetingRepository(sourceDb), new TemplateRepository(sourceDb), sourceRecordings)
    targetDb.exec("CREATE TRIGGER reject_import BEFORE INSERT ON meetings BEGIN SELECT RAISE(ABORT, 'forced'); END")
    await expect(importMeetingArchive(exported.bytes, targetDb, targetRecordings)).rejects.toThrow(/forced/)
    expect(targetDb.prepare('SELECT count(*) count FROM meetings').get()).toEqual({ count: 0 })
    expect((await import('node:fs/promises')).readdir(targetRecordings)).resolves.toEqual([])
    sourceDb.close(); targetDb.close()
  })

  it.each([
    ['before-stage-open', false, false],
    ['during-stage-write', false, false],
    ['after-stage-fsync', false, false],
    ['after-database-commit', true, true],
    ['after-audio-rename', true, true],
  ] as const)('reconciles a simulated crash %s', async (phase, rowExistsBefore, audioExistsAfter) => {
    const root = await mkdtemp(join(tmpdir(), `nnote-archive-${phase}-`)); roots.push(root)
    const sourceRecordings = join(root, 'source'); const targetRecordings = join(root, 'target')
    await mkdir(sourceRecordings); await mkdir(targetRecordings)
    const sourceDb = openDatabase(join(root, 'source.sqlite')); const targetDb = openDatabase(join(root, 'target.sqlite'))
    const now = '2026-07-15T00:00:00.000Z'; await writeFile(join(sourceRecordings, 'a.webm'), minimalWebm)
    sourceDb.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('source', '회의', now, now, 1, 'completed', 'keep', 'a.webm', minimalWebm.byteLength, null)
    const bytes = (await exportMeetingArchive('source', new MeetingRepository(sourceDb), new TemplateRepository(sourceDb), sourceRecordings)).bytes
    await expect(importMeetingArchive(bytes, targetDb, targetRecordings, { interruptAt: phase })).rejects.toThrow(/simulated crash/i)
    expect((targetDb.prepare('SELECT count(*) count FROM meetings').get() as any).count > 0).toBe(rowExistsBefore)
    const interruptedFiles = await readdir(targetRecordings)
    expect(interruptedFiles.some((name) => name.endsWith('.import.json'))).toBe(true)
    expect(interruptedFiles.some((name) => name.endsWith('.importing'))).toBe(phase !== 'before-stage-open' && phase !== 'after-audio-rename')
    const stagedName = interruptedFiles.find((name) => name.endsWith('.importing'))
    if (phase === 'during-stage-write') expect((await stat(join(targetRecordings, stagedName!))).size).toBeLessThan(minimalWebm.byteLength)
    if (phase === 'after-stage-fsync') expect((await stat(join(targetRecordings, stagedName!))).size).toBe(minimalWebm.byteLength)
    await reconcileImportJournals(targetDb, targetRecordings)
    expect((await readdir(targetRecordings)).some((name) => name.endsWith('.import.json') || name.endsWith('.importing'))).toBe(false)
    expect((targetDb.prepare('SELECT count(*) count FROM meetings').get() as any).count > 0).toBe(rowExistsBefore)
    expect((await readdir(targetRecordings)).some((name) => name.endsWith('.webm'))).toBe(audioExistsAfter)
    sourceDb.close(); targetDb.close()
  })

  it.each(['before-stage-open', 'during-stage-write', 'after-stage-fsync', 'after-database-commit', 'after-audio-rename'] as const)('rolls back rows and journal-owned files on an ordinary exception %s', async (phase) => {
    const root = await mkdtemp(join(tmpdir(), `nnote-archive-exception-${phase}-`)); roots.push(root)
    const sourceRecordings = join(root, 'source'); const targetRecordings = join(root, 'target')
    await mkdir(sourceRecordings); await mkdir(targetRecordings)
    const sourceDb = openDatabase(join(root, 'source.sqlite')); const targetDb = openDatabase(join(root, 'target.sqlite'))
    const now = '2026-07-15T00:00:00.000Z'; await writeFile(join(sourceRecordings, 'a.webm'), minimalWebm)
    sourceDb.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('source', '회의', now, now, 1, 'completed', 'keep', 'a.webm', minimalWebm.byteLength, null)
    const bytes = (await exportMeetingArchive('source', new MeetingRepository(sourceDb), new TemplateRepository(sourceDb), sourceRecordings)).bytes
    await expect(importMeetingArchive(bytes, targetDb, targetRecordings, { failAt: phase })).rejects.toThrow(/injected failure/i)
    expect(targetDb.prepare('SELECT count(*) count FROM meetings').get()).toEqual({ count: 0 })
    expect(await readdir(targetRecordings)).toEqual([])
    sourceDb.close(); targetDb.close()
  })

  it('preserves files and reports a safe error for a corrupt recovery journal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nnote-corrupt-journal-')); roots.push(root)
    const recordings = join(root, 'recordings'); await mkdir(recordings)
    const database = openDatabase(join(root, 'target.sqlite'))
    const journal = join(recordings, 'owned.import.json'); const preserved = join(recordings, 'preserved.webm.importing')
    await writeFile(journal, '{'); await writeFile(preserved, minimalWebm)
    await expect(reconcileImportJournals(database, recordings)).rejects.toThrow(/corrupt.*preserved/i)
    expect(await readdir(recordings)).toEqual(['owned.import.json', 'preserved.webm.importing'])
    database.close()
  })

  it('cleans only strictly generated journal temp artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nnote-journal-temp-')); roots.push(root)
    const recordings = join(root, 'recordings'); await mkdir(recordings)
    const database = openDatabase(join(root, 'target.sqlite'))
    const generated = `${'a'.repeat(64)}.import.json.tmp`
    const unowned = 'notes.import.json.tmp'
    await writeFile(join(recordings, generated), 'partial')
    await writeFile(join(recordings, unowned), 'do not delete')
    await reconcileImportJournals(database, recordings)
    expect(await readdir(recordings)).toEqual([unowned])
    database.close()
  })
})
