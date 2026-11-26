import type { FsEntry, Register } from 'claude-code'

const KEY = 'sprite'
const FRAME_MS = 350
const LINE_MS = 4000
// The columns follow from the frames' aspect ratio, see columnsFor.
const ROWS = 5
// How much taller than wide a terminal cell is, when the terminal does not say:
// about 2.2 in common monospace fonts.
const DEFAULT_CELL_RATIO = 2.2

// Prints the cell height over width of the terminal at argv[1], from its size in pixels.
const CELL_RATIO_SCRIPT = `
import fcntl, struct, sys, termios
with open(sys.argv[1], 'rb') as tty:
    rows, cols, width, height = struct.unpack('HHHH', fcntl.ioctl(tty, termios.TIOCGWINSZ, bytes(8)))
print((height / rows) / (width / cols) if rows and cols and width and height else '')
`

type Mood = { after: number; lines: string[] }

// What the speech bubble says while a turn runs, more annoyed the longer it takes.
const DEFAULT_MOODS: Mood[] = [
  { after: 0, lines: ['Hmph. Thinking…', "Don't rush me!", 'W-wait a second!'] },
  { after: 15_000, lines: ['Ugh, this takes forever.', "It's not like I'm slow!", 'Are you even watching?'] },
  { after: 45_000, lines: ['Sooo boring…', 'Why is this so long?!', "I'm doing my best, baka!"] },
  { after: 120_000, lines: ['(╯°□°)╯ Still going…', 'You owe me for this.', 'Never. Ending. Turn.'] },
]

type Frame = { file: string; generation: number }

const isMoods = (value: unknown): value is Mood[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    mood =>
      typeof mood?.after === 'number' &&
      Array.isArray(mood.lines) &&
      mood.lines.length > 0 &&
      mood.lines.every((line: unknown) => typeof line === 'string'),
  )

const isFrameFile = (name: string) => /^\d+\.png$/.test(name)

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const decodeBase64 = (text: string) => {
  const bits = [...text.replace(/=+$/, '')].map(char => BASE64.indexOf(char).toString(2).padStart(6, '0')).join('')

  return (bits.match(/.{8}/g) ?? []).map(byte => parseInt(byte, 2))
}

// The picture is stretched to fill its box of cells. A PNG holds its width and height at bytes 16 to 23.
const columnsFor = (header: string, cellRatio: number) => {
  const bytes = decodeBase64(header)
  const read = (at: number) => bytes.slice(at, at + 4).reduce((value, byte) => value * 256 + byte, 0)
  const [width, height] = [read(0), read(4)]

  return height > 0 ? Math.min(255, Math.max(1, Math.round((ROWS * cellRatio * width) / height))) : ROWS
}

const toFrames = (dir: string, entries: FsEntry[]): Frame[] =>
  entries
    .filter(entry => entry.kind === 'file' && isFrameFile(entry.name))
    .sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10))
    // The modification time makes the terminal read a replaced file again.
    .map(entry => ({ file: `${dir}/${entry.name}`, generation: Math.floor(entry.mtimeMs) }))

export const register: Register = on => {
  let frames: Frame[] = []
  let columns = ROWS
  let cellRatio = DEFAULT_CELL_RATIO
  let moods = DEFAULT_MOODS
  let data = ''
  // Why the data folder is unavailable; the commands report it.
  let dataError: string | undefined
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
    const mood = [...moods].reverse().find(one => elapsed >= one.after) ?? moods[0]!

    return mood.lines[line % mood.lines.length]
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sprite',
      description: 'Show or hide the sprite on the thinking line',
    })
    await $.command.register({
      name: 'sprite-gif',
      description: 'Replace the sprite frames with the frames of a GIF',
      argumentHint: '<path to gif>',
    })
    // Kept across plugin updates, unlike $.plugin.root.
    let env: Record<string, string>
    try {
      env = await $.process.hookEnv()
    } catch (error) {
      dataError = error instanceof Error ? error.message : `${error}`
      $.ui.log(`could not get the data folder: ${dataError}`)

      return next(e)
    }
    if (env.CLAUDE_PLUGIN_DATA === undefined) {
      dataError = 'this Claude Code version does not set CLAUDE_PLUGIN_DATA'
      $.ui.log(`could not get the data folder: ${dataError}`)

      return next(e)
    }
    data = env.CLAUDE_PLUGIN_DATA
    // The hooks run without a terminal, so ask the one Claude Code draws in.
    try {
      const tty = (await $.process.run(['ps', '-o', 'tty=', '-p', env.CLAUDE_PID ?? ''])).stdout.trim()
      if (tty !== '' && !tty.startsWith('?')) {
        const { stdout } = await $.process.run(['python3', '-I', '-c', CELL_RATIO_SCRIPT, `/dev/${tty}`])
        const ratio = parseFloat(stdout)
        if (ratio >= 1 && ratio <= 4) {
          cellRatio = ratio
        }
      }
    } catch {
      // No ps or python3: keep the default.
    }
    const dir = `${data}/frames`
    // Frames used to live in the installed plugin, one copy per version under
    // the plugin's cache folder: copy the newest set over once.
    if (!(await $.fs.exists(dir))) {
      const versions = `${$.plugin.root}/..`
      let newest: { path: string; mtimeMs: number } | undefined
      for (const version of await $.fs.list(versions)) {
        const path = `${versions}/${version.name}/frames`
        if (version.kind !== 'dir' || !(await $.fs.exists(path))) {
          continue
        }
        const hasFrames = (await $.fs.list(path)).some(entry => entry.kind === 'file' && isFrameFile(entry.name))
        const { mtimeMs } = await $.fs.stat(path)
        if (hasFrames && mtimeMs > (newest?.mtimeMs ?? -1)) {
          newest = { path, mtimeMs }
        }
      }
      if (newest !== undefined) {
        const { exitCode, stderr } = await $.process.run(['cp', '-R', newest.path, dir])
        $.ui.log(exitCode === 0 ? `copied frames from ${newest.path} to ${dir}` : `copying frames from ${newest.path} failed: ${stderr}`)
      }
    }
    frames = toFrames(dir, (await $.fs.exists(dir)) ? await $.fs.list(dir) : [])
    if (frames[0] !== undefined) {
      columns = columnsFor((await $.fs.read(frames[0].file, { as: 'bytes', offset: 16, length: 8 })).base64, cellRatio)
    }
    const moodsFile = `${data}/moods.json`
    if (await $.fs.exists(moodsFile)) {
      try {
        const parsed: unknown = JSON.parse(await $.fs.read(moodsFile))
        if (isMoods(parsed)) {
          moods = [...parsed].sort((a, b) => a.after - b.after)
        } else {
          $.ui.log(`${moodsFile}: expected [{ "after": <ms>, "lines": ["…"] }, …], using the built-in lines`)
        }
      } catch (error) {
        $.ui.log(`${moodsFile}: ${error}, using the built-in lines`)
      }
    }
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
    if (dataError !== undefined) {
      return { text: `Could not get the plugin's data folder: ${dataError}` }
    }
    if (frames.length === 0) {
      return { text: `No frames in ${data}/frames: add numbered PNGs there or run /sprite-gif <path to gif>.` }
    }
    isHidden = !isHidden
    $.ui.invalidate('ui.render')

    return { text: isHidden ? 'Sprite hidden.' : 'Sprite shown.' }
  })

  on('command.run', { command: 'sprite-gif' }, async ($, e) => {
    let gif = e.args.trim().replace(/^(["'])(.*)\1$/, '$2')
    if (gif === '') {
      return { text: 'Usage: /sprite-gif <path to gif>' }
    }
    if (dataError !== undefined) {
      return { text: `Could not get the plugin's data folder: ${dataError}` }
    }
    if (gif.startsWith('~/')) {
      gif = `${await $.env.get('HOME')}${gif.slice(1)}`
    }
    const dir = `${data}/frames`
    const staging = `${data}/frames.new`
    const run = async (argv: string[]) => {
      const { exitCode, stderr } = await $.process.run(argv, { timeoutMs: 120_000 })
      if (exitCode !== 0) {
        throw new Error(`${argv[0]} ${argv[1]} failed: ${stderr.trim()}`)
      }
    }
    try {
      // The box around the figure over all frames, so empty borders are cut off.
      const { exitCode, stdout, stderr } = await $.process.run(
        ['magick', gif, '-coalesce', '-evaluate-sequence', 'max', '-fuzz', '8%', '-format', '%@', 'info:'],
        { timeoutMs: 120_000 },
      )
      if (exitCode !== 0) {
        return { text: `Could not read ${gif}: ${stderr.trim()}` }
      }
      await run(['rm', '-rf', staging])
      await run(['mkdir', '-p', staging])
      // -coalesce turns each frame into a whole picture: many GIFs store only what changed.
      await run(['magick', gif, '-coalesce', '-crop', stdout.trim(), '+repage', '-resize', 'x200', '-strip', `${staging}/%d.png`])
      await run(['rm', '-rf', dir])
      await run(['mv', staging, dir])
    } catch (error) {
      return { text: `${error instanceof Error ? error.message : error}` }
    }
    frames = toFrames(dir, await $.fs.list(dir))
    if (frames[0] !== undefined) {
      columns = columnsFor((await $.fs.read(frames[0].file, { as: 'bytes', offset: 16, length: 8 })).base64, cellRatio)
    }
    frame = 0
    $.ui.invalidate('ui.render')

    return { text: `Made ${frames.length} frames from ${gif} in ${dir}.` }
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
        <Image key={KEY} source={source()} columns={columns} rows={ROWS} alt="(¬_¬)" />
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
