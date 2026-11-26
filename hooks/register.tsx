import type { Register } from 'claude-code'

const KEY = 'sprite'
const FRAME_MS = 350
const LINE_MS = 4000
// The frames are 147x200 pixels; a terminal cell is about twice as tall as wide.
const COLUMNS = 8
const ROWS = 5

// What the speech bubble says while a turn runs, more annoyed the longer it takes.
const MOODS: { after: number; lines: string[] }[] = [
  { after: 0, lines: ['Hmph. Thinking…', "Don't rush me!", 'W-wait a second!'] },
  { after: 15_000, lines: ['Ugh, this takes forever.', "It's not like I'm slow!", 'Are you even watching?'] },
  { after: 45_000, lines: ['Sooo boring…', 'Why is this so long?!', "I'm doing my best, baka!"] },
  { after: 120_000, lines: ['(╯°□°)╯ Still going…', 'You owe me for this.', 'Never. Ending. Turn.'] },
]

type Frame = { file: string; generation: number }

export const register: Register = on => {
  let frames: Frame[] = []
  let frame = 0
  let isHidden = false
  let site: string | undefined
  let startedAt = 0
  let line = 0
  let lastLineAt = 0
  const source = () => {
    const { file, generation } = frames[frame % frames.length] as Frame

    return { file, generation, format: 'png' as const }
  }
  const say = (now: number) => {
    const elapsed = now - startedAt
    const mood = [...MOODS].reverse().find(one => elapsed >= one.after) ?? MOODS[0]!

    return mood.lines[line % mood.lines.length]
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sprite',
      description: 'Show or hide the sprite on the thinking line',
    })
    const dir = `${$.plugin.root}/frames`
    const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
    frames = entries
      .filter(entry => entry.kind === 'file' && /^\d+\.png$/.test(entry.name))
      .sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10))
      // The modification time makes the terminal read a replaced file again.
      .map(entry => ({ file: `${dir}/${entry.name}`, generation: Math.floor(entry.mtimeMs) }))
    $.clock.every(FRAME_MS, async () => {
      if (isHidden || site === undefined) {
        return
      }
      const now = await $.clock.now()
      if (now - lastLineAt >= LINE_MS) {
        line += 1
        lastLineAt = now
        $.ui.invalidate('ui.render')
      }
      if (frames.length < 2) {
        return
      }
      frame = (frame + 1) % frames.length
      const blit = await $.ui.blit({ requestId: site, key: KEY, source: source() })
      if ('deny' in blit) {
        $.ui.invalidate('ui.render')
      }
    })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    startedAt = await $.clock.now()
    lastLineAt = startedAt
    line = Math.floor(Math.random() * 3)

    return next(e)
  })

  on('command.run', { command: 'sprite' }, async $ => {
    isHidden = !isHidden
    $.ui.invalidate('ui.render')

    return { text: isHidden ? 'Sprite hidden.' : 'Sprite shown.' }
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (isHidden || frames.length === 0 || e.surface !== 'terminal') {
      site = undefined

      return next(e)
    }
    site = e.requestId
    const { Box, Image, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" alignItems="flex-end" gap={1}>
        <Image key={KEY} source={source()} columns={COLUMNS} rows={ROWS} alt="(¬_¬)" />
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="flex-end">
            <Text color="magenta">◀</Text>
            <Box borderStyle="round" borderColor="magenta" paddingX={1}>
              <Text>{say(await $.clock.now())}</Text>
            </Box>
          </Box>
          {await next(e)}
        </Box>
      </Box>
    )
  })
}
