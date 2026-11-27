import { expect, test } from 'claude-code/testing'
import { clipName, spoken } from '../hooks/register'

test('actions between asterisks are not spoken', () => {
  expect(spoken("*snore* ...I didn't fall asleep.")).toBe("...I didn't fall asleep.")
  expect(spoken('Ugh, don\'t watch me. *yawn*')).toBe("Ugh, don't watch me.")
  expect(spoken('*nods off*')).toBe('')
})

test('a line is never read as an option', () => {
  expect(spoken('-- wait!')).toBe('wait!')
  expect(spoken('  Hmph.   Thinking…  ')).toBe('Hmph. Thinking…')
})

test('a clip is named by voice, model and words', () => {
  const name = clipName('voice1', 'eleven_multilingual_v2', 'Hmph.')
  expect(name).toMatch(/^[0-9a-f]{8}\.mp3$/)
  expect(clipName('voice1', 'eleven_multilingual_v2', 'Hmph.')).toBe(name)
  expect(clipName('voice2', 'eleven_multilingual_v2', 'Hmph.')).not.toBe(name)
  expect(clipName('voice1', 'eleven_flash_v2_5', 'Hmph.')).not.toBe(name)
  expect(clipName('voice1', 'eleven_multilingual_v2', 'Baka.')).not.toBe(name)
})
