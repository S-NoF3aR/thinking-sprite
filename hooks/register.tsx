import type { Register } from 'claude-code'

const KEY = 'sprite'
const FRAME_MS = 350
// The frames are 147x200 pixels; a terminal cell is about twice as tall as wide.
const COLUMNS = 8
const ROWS = 5

type Frame = { file: string; generation: number }

export const register: Register = on => {
  let frames: Frame[] = []
  let frame = 0
  let isHidden = false
  let site: string | undefined
  const source = () => {
    const { file, generation } = frames[frame % frames.length] as Frame

    return { file, generation, format: 'png' as const }
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
      if (isHidden || site === undefined || frames.length < 2) {
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
    const { Box, Image } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" alignItems="flex-end" gap={1}>
        <Image key={KEY} source={source()} columns={COLUMNS} rows={ROWS} alt="(¬_¬)" />
        {await next(e)}
      </Box>
    )
  })
}
