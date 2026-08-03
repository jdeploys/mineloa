import { describe, expect, it } from 'vitest'
import { chronological } from '../../src/main/ai/summaryService'
import { summaryItemLine, summaryTimeLabel } from '../../src/shared/summaryItemTime'

describe('summaryTimeLabel', () => {
  it('reads like the audio player clock', () => {
    expect(summaryTimeLabel(0)).toBe('00:00')
    expect(summaryTimeLabel(724_000)).toBe('12:04')
  })

  // A 71 minute meeting's player reads 61:30, so its summary must too.
  it('does not wrap minutes into hours', () => {
    expect(summaryTimeLabel(3_690_000)).toBe('61:30')
  })

  it('has nothing to show for an item with no source', () => {
    expect(summaryTimeLabel(null)).toBeNull()
    expect(summaryTimeLabel(Number.NaN)).toBeNull()
    expect(summaryTimeLabel(-1)).toBeNull()
  })
})

describe('summaryItemLine', () => {
  it('prefixes the time when there is one', () => {
    expect(summaryItemLine(724_000, '계정 연동 문서 정리')).toBe('12:04 계정 연동 문서 정리')
  })

  it('leaves an untimed item unchanged rather than showing an empty gutter', () => {
    expect(summaryItemLine(null, '계정 연동 문서 정리')).toBe('계정 연동 문서 정리')
  })
})

describe('chronological', () => {
  it('orders items by when they were raised', () => {
    expect(chronological([
      { text: 'c', atMs: 3_690_000 },
      { text: 'a', atMs: 12_000 },
      { text: 'b', atMs: 724_000 },
    ]).map(({ text }) => text)).toEqual(['a', 'b', 'c'])
  })

  // An item the model could not place is still worth keeping; it just cannot be
  // sorted, so it holds its given order behind the ones that can.
  it('keeps untimed items in the order given, after the timed ones', () => {
    expect(chronological([
      { text: 'no-source-1', atMs: null },
      { text: 'late', atMs: 900_000 },
      { text: 'no-source-2', atMs: null },
      { text: 'early', atMs: 1_000 },
    ]).map(({ text }) => text)).toEqual(['early', 'late', 'no-source-1', 'no-source-2'])
  })

  it('is stable for items raised at the same moment', () => {
    expect(chronological([
      { text: 'first', atMs: 5_000 },
      { text: 'second', atMs: 5_000 },
    ]).map(({ text }) => text)).toEqual(['first', 'second'])
  })

  it('handles nothing to sort', () => {
    expect(chronological([])).toEqual([])
  })
})
