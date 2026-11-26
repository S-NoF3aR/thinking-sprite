import { expect, test } from 'claude-code/testing'
import { parseMoods } from '../hooks/register'

type Args = Parameters<Parameters<typeof test>[1]>

const MOODS = [
  { after: 15000, lines: ['Arr, still sailing.', 'Patience, matey.', 'Wind be slow.'] },
  { after: 0, lines: ['Ahoy, thinking!', 'Hoist the code!', 'Aye, aye.'] },
]

const start = async ($: Args[0], on: Args[1]) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_DATA: '/data/thinking-sprite' } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

test('a reply is parsed and sorted, also inside a code fence', () => {
  const sorted = [MOODS[1], MOODS[0]]
  expect(parseMoods(JSON.stringify(MOODS))).toEqual(sorted)
  expect(parseMoods(`Here you go:\n\`\`\`json\n${JSON.stringify(MOODS)}\n\`\`\``)).toEqual(sorted)
  expect(parseMoods('[{ "after": 0 }]')).toBeUndefined()
  expect(parseMoods('no json here')).toBeUndefined()
})

test('/sprite-moods writes the lines in the tone and uses them', async ($, on) => {
  const written: { path: string; text: string }[] = []
  let prompt = ''
  on('model.complete', (_, e) => {
    prompt = `${e.prompt}`

    return { value: { isAnswered: true, text: JSON.stringify(MOODS), usage: { input_tokens: 1, output_tokens: 1 } } }
  })
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })

    return { value: undefined }
  })
  await start($, on)

  const { text } = await $.command.run({ command: 'sprite-moods', args: 'grumpy pirate' })

  expect(prompt).toContain('grumpy pirate')
  expect(written[0]?.path).toBe('/data/thinking-sprite/moods.json')
  expect(JSON.parse(written[0]?.text ?? '')).toEqual([MOODS[1], MOODS[0]])
  expect(text).toContain('Ahoy, thinking!')
})

test('/sprite-moods writes nothing when the reply has the wrong shape', async ($, on) => {
  let isWritten = false
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Sure! Here are some lines.', usage: { input_tokens: 1, output_tokens: 1 } } }))
  on('fs.write', () => {
    isWritten = true

    return { value: undefined }
  })
  await start($, on)

  const { text } = await $.command.run({ command: 'sprite-moods', args: 'cheerful' })

  expect(text).toContain('wrong shape')
  expect(isWritten).toBe(false)
})

test('/sprite-moods says why when the model gives no answer', async ($, on) => {
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'aborted', usage: { input_tokens: 0, output_tokens: 0 } } }))
  await start($, on)

  const { text } = await $.command.run({ command: 'sprite-moods', args: 'cheerful' })

  expect(text).toContain('aborted')
})

test('/sprite-moods without a tone explains itself', async ($, on) => {
  await start($, on)

  const { text } = await $.command.run({ command: 'sprite-moods', args: '' })

  expect(text).toContain('Usage: /sprite-moods <tone>')
})
