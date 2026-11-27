import type { FsEntry, Hook, Register } from 'claude-code'

const KEY = 'sprite'
const FRAME_MS = 350
const LINE_MS = 4000
const GREETING = 'Fine. I will talk.'

type Api = Parameters<Hook<'command.run'>>[0]
// Speech programs tried in order when ElevenLabs is not set up; each gets the
// line as its last argument.
const VOICES = [
  ['spd-say', '-t', 'female1'],
  ['espeak-ng', '-v', 'en+f3'],
]
// Players tried in order for a rendered clip; each gets the file last.
const PLAYERS = [['pw-play'], ['paplay'], ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet']]
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech'

type ElevenLabs = { key: string; voiceId: string; model: string }

// Runs a command to its end and resolves its exit code and what it wrote to
// stderr. Spawned, so it runs on after the hook that started it returns.
async function finish($: Api, argv: string[], input?: string) {
  const child = $.process.spawn(input === undefined ? { argv } : { argv, input })
  let stderr = ''
  let step = await child.next()
  while (step.done !== true) {
    if (step.value.stream === 'stderr') {
      stderr += step.value.text
    }
    step = await child.next()
  }

  return { code: step.value.code, stderr: stderr.trim() }
}

// A clip's file name, from everything that changes how it sounds (FNV-1a).
export const clipName = (voiceId: string, model: string, words: string) => {
  let hash = 0x811c9dc5
  for (const char of `${voiceId}\n${model}\n${words}`) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return `${hash.toString(16).padStart(8, '0')}.mp3`
}

// Has ElevenLabs say a line into an MP3 in `dir`, once: a clip already there
// is reused. Resolves the clip's path, or why it could not be made.
async function render($: Api, eleven: ElevenLabs, dir: string, text: string): Promise<{ file: string } | { error: string }> {
  const words = spoken(text)
  const file = `${dir}/${clipName(eleven.voiceId, eleven.model, words)}`
  if (await $.fs.exists(file)) {
    return { file }
  }
  try {
    await finish($, ['mkdir', '-p', dir])
    const body = `${file}.json`
    const part = `${file}.part`
    await $.fs.write(body, JSON.stringify({ text: words, model_id: eleven.model }))
    // The key goes to curl on stdin, so it never shows in the process list.
    const config = [
      `url = "${ELEVENLABS_URL}/${encodeURIComponent(eleven.voiceId)}?output_format=mp3_44100_128"`,
      `header = "xi-api-key: ${eleven.key.replace(/["\\\r\n]/g, '')}"`,
      'header = "Content-Type: application/json"',
    ].join('\n')
    const curl = ['curl', '-sS', '--fail-with-body', '--max-time', '30', '-X', 'POST', '--data-binary', `@${body}`]
    const { code, stderr } = await finish($, [...curl, '-o', part, '--config', '-'], `${config}\n`)
    let error: string | undefined
    if (code !== 0) {
      // With --fail-with-body the part file holds ElevenLabs' error message.
      const answer = (await $.fs.exists(part)) ? (await $.fs.read(part)).slice(0, 300) : ''
      error = `ElevenLabs: ${answer || stderr || `curl exited with ${code}`}`
    } else {
      await finish($, ['mv', part, file])
    }
    await finish($, ['rm', '-f', body, part])

    return error === undefined ? { file } : { error }
  } catch (error) {
    return { error: `${error instanceof Error ? error.message : error}` }
  }
}

// Renders every line not rendered yet; resolves the first error, if any.
async function renderAll($: Api, eleven: ElevenLabs, dir: string, lines: string[]) {
  for (const text of lines) {
    const result = await render($, eleven, dir, text)
    if ('error' in result) {
      return result.error
    }
  }

  return undefined
}

// Plays a file with the first player that works.
async function play($: Api, file: string) {
  for (const player of PLAYERS) {
    try {
      if ((await finish($, [...player, file])).code === 0) {
        return true
      }
    } catch {
      // Not installed: try the next one.
    }
  }

  return false
}

// Says a line: with ElevenLabs when it is set up, else with the first speech
// program that works. Resolves what said it, or why nothing did.
async function speak($: Api, eleven: ElevenLabs | undefined, dir: string, text: string): Promise<{ by: string } | { error: string }> {
  if (spoken(text) === '') {
    return { by: 'nobody' }
  }
  if (eleven !== undefined) {
    const result = await render($, eleven, dir, text)
    if ('error' in result) {
      return result
    }

    return (await play($, result.file))
      ? { by: 'ElevenLabs' }
      : { error: `No player worked. Install one of: ${PLAYERS.map(one => one[0]).join(', ')}.` }
  }
  for (const voice of VOICES) {
    try {
      if ((await finish($, [...voice, spoken(text)])).code === 0) {
        return { by: voice[0]! }
      }
    } catch {
      // Not installed: try the next one.
    }
  }

  return { error: `No speech program worked. Install one of: ${VOICES.map(one => one[0]).join(', ')}.` }
}

// What a line sounds like: *actions* dropped, no leading dash read as an option.
export const spoken = (text: string) =>
  text
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^-+\s*/, '')
// The columns follow from the frames' aspect ratio, see columnsFor.
const ROWS = 5
// The width when the frames' size cannot be read.
const DEFAULT_COLUMNS = 8
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

const MOODS_SYSTEM = `You write the lines of a speech bubble next to an animated sprite in a terminal while an AI coding assistant works on a task.
Answer with JSON only, no other text: an array of 4 moods,
[{ "after": 0, "lines": [...] }, { "after": 15000, "lines": [...] }, { "after": 45000, "lines": [...] }, { "after": 120000, "lines": [...] }].
"after" is how many milliseconds the task has run; later moods react to a task that takes longer and longer.
Each mood has 3 lines of at most 30 characters. Write them in the tone the user gives.`

// Turns a model's reply into moods: the JSON array, also inside a code fence.
export const parseMoods = (reply: string): Mood[] | undefined => {
  const json = reply.slice(reply.indexOf('['), reply.lastIndexOf(']') + 1)
  try {
    const parsed: unknown = JSON.parse(json)

    return isMoods(parsed) ? [...parsed].sort((a, b) => a.after - b.after) : undefined
  } catch {
    return undefined
  }
}

const isFrameFile = (name: string) => /^\d+\.png$/.test(name)

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const decodeBase64 = (text: string) => {
  const bits = [...text.replace(/=+$/, '')].map(char => BASE64.indexOf(char).toString(2).padStart(6, '0')).join('')

  return (bits.match(/.{8}/g) ?? []).map(byte => parseInt(byte, 2))
}

const PNG_START = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]

// The picture is stretched to fill its box of cells. `start` is the base64 of the
// file's first bytes: a PNG holds its width and height at bytes 16 to 23. Only the
// first 24 bytes are decoded, in case a read returned the whole file.
export const columnsFor = (start: string, cellRatio: number) => {
  const bytes = decodeBase64(start.slice(0, 32))
  const read = (at: number) => bytes.slice(at, at + 4).reduce((value, byte) => value * 256 + byte, 0)
  const [width, height] = [read(16), read(20)]
  if (bytes.length < 24 || PNG_START.some((byte, at) => bytes[at] !== byte) || width === 0 || height === 0) {
    return DEFAULT_COLUMNS
  }

  return Math.min(255, Math.max(1, Math.round((ROWS * cellRatio * width) / height)))
}

// The data folder's name as Claude Code makes it: <plugin>-<marketplace> for an
// installed plugin (root <config dir>/plugins/cache/<marketplace>/<plugin>/<version>),
// <plugin>-inline for one loaded from a folder.
export const dataFolderName = (root: string, name: string) => {
  const [, marketplace, plugin] = root.match(/\/cache\/([^/]+)\/([^/]+)\/[^/]+$/) ?? []

  return marketplace === undefined ? `${name}-inline` : `${plugin}-${marketplace}`.replace(/[^A-Za-z0-9_-]/g, '-')
}

const toFrames = (dir: string, entries: FsEntry[]): Frame[] =>
  entries
    .filter(entry => entry.kind === 'file' && isFrameFile(entry.name))
    .sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10))
    // The modification time makes the terminal read a replaced file again.
    .map(entry => ({ file: `${dir}/${entry.name}`, generation: Math.floor(entry.mtimeMs) }))

export const register: Register = (on, options) => {
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
  let isVoiced = false
  let eleven: ElevenLabs | undefined
  const clips = () => `${data}/voice`
  const allLines = () => [GREETING, ...moods.flatMap(mood => mood.lines)]
  // The mood whose lines the bubble shows; -1 before a turn's first line.
  let shownMood = 0
  // Set while a line is being said, so lines never talk over each other.
  let isSpeaking = false
  // Set from a prompt until its turn completes; the bubble changes and talks only then.
  let isTurnRunning = false
  const source = () => {
    const { file, generation } = frames[frame % frames.length] as Frame

    return { file, generation, format: 'png' as const }
  }
  const moodAt = (now: number) => {
    const elapsed = now - startedAt
    const index = moods.findLastIndex(one => elapsed >= one.after)

    return Math.max(index, 0)
  }
  const say = (now: number) => {
    const mood = moods[moodAt(now)]!

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
    await $.command.register({
      name: 'sprite-voice',
      description: 'Have the sprite say its lines aloud, or stop it',
    })
    await $.command.register({
      name: 'sprite-moods',
      description: 'Write new speech bubble lines in a tone you describe',
      argumentHint: '<tone>',
    })
    // Kept across plugin updates, unlike $.plugin.root.
    let env: Record<string, string> = {}
    let reason = 'Claude Code sets no CLAUDE_PLUGIN_DATA'
    try {
      env = await $.process.hookEnv()
    } catch (error) {
      reason = error instanceof Error ? error.message : `${error}`
    }
    if (env.CLAUDE_PLUGIN_DATA !== undefined) {
      data = env.CLAUDE_PLUGIN_DATA
    } else {
      // Where Claude Code does not say, build the path it uses and create it.
      const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
      data = `${configDir}/plugins/data/${dataFolderName($.plugin.root, $.plugin.name)}`
      try {
        const { exitCode, stderr } = await $.process.run(['mkdir', '-p', data])
        if (exitCode !== 0) {
          throw new Error(stderr.trim())
        }
      } catch (error) {
        dataError = `${reason}, and creating ${data} failed: ${error instanceof Error ? error.message : error}`
        $.ui.log(`could not get the data folder: ${dataError}`)

        return next(e)
      }
      $.ui.log(`${reason}, using ${data}`)
    }
    // The hooks run without a terminal, so ask the one Claude Code draws in;
    // without CLAUDE_PID, the parent of a child process is Claude Code.
    try {
      const ps =
        env.CLAUDE_PID === undefined ? ['sh', '-c', 'ps -o tty= -p "$PPID"'] : ['ps', '-o', 'tty=', '-p', env.CLAUDE_PID]
      const tty = (await $.process.run(ps)).stdout.trim()
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
    frames = toFrames(dir, (await $.fs.exists(dir)) ? await $.fs.list(dir) : [])
    if (frames[0] !== undefined) {
      columns = columnsFor((await $.fs.read(frames[0].file, { as: 'bytes', length: 24 })).base64, cellRatio)
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
    const option = (name: string) => {
      const value = options[name]

      return typeof value === 'string' ? value.trim() : ''
    }
    const key = option('elevenlabsApiKey') || ((await $.env.get('ELEVENLABS_API_KEY')) ?? '').trim()
    const voiceId = option('elevenlabsVoiceId') || ((await $.env.get('ELEVENLABS_VOICE_ID')) ?? '').trim()
    if (key !== '' && voiceId !== '') {
      eleven = { key, voiceId, model: option('elevenlabsModel') || 'eleven_multilingual_v2' }
    }
    const voiceFile = `${data}/voice.json`
    if (await $.fs.exists(voiceFile)) {
      try {
        isVoiced = JSON.parse(await $.fs.read(voiceFile)).enabled === true
      } catch (error) {
        $.ui.log(`${voiceFile}: ${error}, voice stays off`)
      }
    }
    $.clock.every(FRAME_MS, async () => {
      if (isHidden || site === undefined || !isTurnRunning) {
        return
      }
      const now = await $.clock.now()
      // A new mood shows its line at once; within a mood the line changes every
      // LINE_MS. Each new line is said as it appears.
      const mood = moodAt(now)
      const isNewMood = mood !== shownMood
      if (isNewMood || now - lastLineAt >= LINE_MS) {
        if (isNewMood) {
          shownMood = mood
        } else {
          line += 1
        }
        lastLineAt = now
        $.ui.invalidate('ui.render')
        if (isVoiced && !isSpeaking) {
          isSpeaking = true
          void speak($, eleven, clips(), say(now) ?? '').then(result => {
            isSpeaking = false
            if ('error' in result) {
              $.ui.log(result.error)
            }
          })
        }
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
    shownMood = -1
    isTurnRunning = true

    return next(e)
  })

  // A main turn that no prompt started, as a background task's, runs the bubble too.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = true
    }

    return next(e)
  })

  // The main turn's end, finished or stopped: the bubble stops changing and talking.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = false
      site = undefined
    }

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

  on('command.run', { command: 'sprite-voice' }, async $ => {
    if (dataError !== undefined) {
      return { text: `Could not get the plugin's data folder: ${dataError}` }
    }
    let by = ''
    if (!isVoiced) {
      if (eleven !== undefined) {
        const error = await renderAll($, eleven, clips(), allLines())
        if (error !== undefined) {
          return { text: `Voice stays off. ${error}` }
        }
      }
      const result = await speak($, eleven, clips(), GREETING)
      if ('error' in result) {
        return { text: `Voice stays off. ${result.error}` }
      }
      by = result.by
    }
    isVoiced = !isVoiced
    await $.fs.write(`${data}/voice.json`, `${JSON.stringify({ enabled: isVoiced })}\n`)
    if (!isVoiced) {
      return { text: 'Voice off.' }
    }

    return {
      text:
        eleven === undefined
          ? `Voice on, using ${by}. For a natural voice, set an ElevenLabs API key and voice ID (see the README).`
          : `Voice on, using ElevenLabs voice ${eleven.voiceId}. All ${allLines().length} lines are ready.`,
    }
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
      columns = columnsFor((await $.fs.read(frames[0].file, { as: 'bytes', length: 24 })).base64, cellRatio)
    }
    frame = 0
    $.ui.invalidate('ui.render')

    return { text: `Made ${frames.length} frames from ${gif} in ${dir}.` }
  })

  on('command.run', { command: 'sprite-moods' }, async ($, e) => {
    const tone = e.args.trim()
    if (tone === '') {
      return { text: 'Usage: /sprite-moods <tone>, for example /sprite-moods grumpy pirate' }
    }
    if (dataError !== undefined) {
      return { text: `Could not get the plugin's data folder: ${dataError}` }
    }
    let reply
    try {
      reply = await $.model.complete({
        model: 'haiku',
        system: MOODS_SYSTEM,
        prompt: `The tone: ${tone}`,
        maxTokens: 1024,
        timeoutMs: 60_000,
      })
    } catch (error) {
      return { text: `Could not ask the model: ${error instanceof Error ? error.message : error}` }
    }
    if (!reply.isAnswered) {
      return { text: `The model gave no lines (${reply.reason}). Try again.` }
    }
    const generated = parseMoods(reply.text)
    if (generated === undefined) {
      return { text: 'The model answered in the wrong shape. Try again.' }
    }
    const file = `${data}/moods.json`
    await $.fs.write(file, `${JSON.stringify(generated, null, 2)}\n`)
    moods = generated
    $.ui.invalidate('ui.render')
    if (isVoiced && eleven !== undefined) {
      // The new lines are rendered in the background, ready before they are said.
      void renderAll($, eleven, clips(), allLines()).then(error => {
        if (error !== undefined) {
          $.ui.log(error)
        }
      })
    }
    const preview = generated.map(mood => `${mood.after / 1000}s: ${mood.lines.join(' · ')}`).join('\n')

    return { text: `New lines in ${file}:\n${preview}` }
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
