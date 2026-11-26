import { expect, test } from 'claude-code/testing'
import { dataFolderName } from '../hooks/register'

type Args = Parameters<Parameters<typeof test>[1]>

const ran = (exitCode: number, stderr = '') => ({
  value: { exitCode, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

const start = async ($: Args[0], on: Args[1]) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.exists', () => ({ value: false }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

test('the data folder is named as Claude Code names it', () => {
  expect(dataFolderName('/home/u/.claude/plugins/cache/thinking-sprite/thinking-sprite/0.2.2', 'thinking-sprite')).toBe(
    'thinking-sprite-thinking-sprite',
  )
  expect(dataFolderName('/home/u/.claude/plugins/cache/my.market/thinking-sprite/1.0.0', 'thinking-sprite')).toBe(
    'thinking-sprite-my-market',
  )
  expect(dataFolderName('/home/u/.claude/mods/rin-sprite', 'rin-sprite')).toBe('rin-sprite-inline')
})

test('/sprite names the data folder Claude Code gives', async ($, on) => {
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_DATA: '/data/thinking-sprite' } }))
  on('process.run', () => ran(1))
  await start($, on)

  const { text } = await $.command.run({ command: 'sprite' })

  expect(text).toContain('/data/thinking-sprite/frames')
})

test('without CLAUDE_PLUGIN_DATA the folder is built under HOME and created', async ($, on) => {
  const commands: string[][] = []
  on('process.hookEnv', () => ({ deny: 'hookEnv unavailable' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('process.run', (_, e) => {
    commands.push([...e.argv])

    return ran(0)
  })
  await start($, on)

  const { text } = await $.command.run({ command: 'sprite' })

  expect(text).toContain('/home/u/.claude/plugins/data/thinking-sprite-inline/frames')
  expect(commands).toContainEqual(['mkdir', '-p', '/home/u/.claude/plugins/data/thinking-sprite-inline'])
  expect(commands).toContainEqual(['sh', '-c', 'ps -o tty= -p "$PPID"'])
})

test('without CLAUDE_PLUGIN_DATA the folder follows CLAUDE_CONFIG_DIR', async ($, on) => {
  on('process.hookEnv', () => ({ value: {} }))
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : '/home/u' }))
  on('process.run', () => ran(0))
  await start($, on)

  const { text } = await $.command.run({ command: 'sprite' })

  expect(text).toContain('/cfg/plugins/data/thinking-sprite-inline/frames')
})

test('/sprite and /sprite-gif say why when the folder cannot be created', async ($, on) => {
  on('process.hookEnv', () => ({ deny: 'hookEnv unavailable' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('process.run', () => ran(1, 'Permission denied'))
  await start($, on)

  const sprite = await $.command.run({ command: 'sprite' })
  const gif = await $.command.run({ command: 'sprite-gif', args: 'a.gif' })

  for (const { text } of [sprite, gif]) {
    expect(text).toContain('hookEnv unavailable')
    expect(text).toContain('Permission denied')
  }
})
