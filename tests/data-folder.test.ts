import { expect, test } from 'claude-code/testing'

const start = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.exists', () => ({ value: false }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

test('/sprite names the data folder when it has no frames', async ($, on) => {
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_DATA: '/data/thinking-sprite' } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await start($, on)

  const { text } = await $.command.run({ command: 'sprite' })

  expect(text).toContain('/data/thinking-sprite/frames')
})

test('/sprite says why when the data folder is unavailable', async ($, on) => {
  on('process.hookEnv', () => ({ deny: 'cannot create the data folder' }))
  await start($, on)

  const { text } = await $.command.run({ command: 'sprite' })

  expect(text).toContain('cannot create the data folder')
})

test('/sprite says why when Claude Code sets no data folder', async ($, on) => {
  on('process.hookEnv', () => ({ value: {} }))
  await start($, on)

  const { text } = await $.command.run({ command: 'sprite' })

  expect(text).toContain('CLAUDE_PLUGIN_DATA')
})

test('/sprite-gif says why when the data folder is unavailable', async ($, on) => {
  on('process.hookEnv', () => ({ deny: 'cannot create the data folder' }))
  await start($, on)

  const { text } = await $.command.run({ command: 'sprite-gif', args: 'a.gif' })

  expect(text).toContain('cannot create the data folder')
})
