import { expect, test } from 'claude-code/testing'
import { columnsFor } from '../hooks/register'

const png = (width: number, height: number, rest = 0) => {
  const size = (value: number) => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]
  bytes.push(...size(width), ...size(height), ...Array.from({ length: rest }, () => 7))

  return btoa(String.fromCharCode(...bytes))
}

test('the columns follow the frame size and the cell ratio', () => {
  expect(columnsFor(png(147, 200), 2.2)).toBe(8)
  expect(columnsFor(png(178, 200), 2.2)).toBe(10)
  expect(columnsFor(png(147, 200), 2)).toBe(7)
})

test('a read that returns the whole file gives the same columns', () => {
  expect(columnsFor(png(147, 200, 64_000), 2.2)).toBe(8)
})

test('bytes that are not a PNG header give the default width', () => {
  // What a read that ignores `offset: 16` returned: the PNG signature as the size.
  expect(columnsFor(btoa('\x89PNG\r\n\x1a\n'), 2.2)).toBe(8)
  expect(columnsFor(btoa('GIF89a, not a png at all'), 2.2)).toBe(8)
  expect(columnsFor('', 2.2)).toBe(8)
  expect(columnsFor(png(0, 200), 2.2)).toBe(8)
})
