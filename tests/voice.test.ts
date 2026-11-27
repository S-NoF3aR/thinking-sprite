import { expect, test } from 'claude-code/testing'
import { spoken } from '../hooks/register'

test('actions between asterisks are not spoken', () => {
  expect(spoken("*snore* ...I didn't fall asleep.")).toBe("...I didn't fall asleep.")
  expect(spoken('Ugh, don\'t watch me. *yawn*')).toBe("Ugh, don't watch me.")
  expect(spoken('*nods off*')).toBe('')
})

test('a line is never read as an option', () => {
  expect(spoken('-- wait!')).toBe('wait!')
  expect(spoken('  Hmph.   Thinking…  ')).toBe('Hmph. Thinking…')
})
