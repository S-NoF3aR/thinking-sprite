# thinking-sprite

A Claude Code plugin that shows a small animated sprite next to the thinking line while Claude works, with a speech bubble that complains more the longer the turn takes. `/sprite` shows or hides it. The bubble's lines are the `MOODS` list in `hooks/register.tsx`.

The sprite is drawn as real pixels only in terminals with an image protocol: kitty, Ghostty, iTerm2 3.5 or later, and tmux with `allow-passthrough` on. Other terminals show `(¬_¬)` instead.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install thinking-sprite --marketplace S-NoF3aR/thinking-sprite
```

From a shell:

```
claude plugin install thinking-sprite --marketplace S-NoF3aR/thinking-sprite
```

## Adding the sprite

The repository ships no artwork. Put your own frames as numbered PNG files (`0.png`, `1.png`, …, any count) into a `frames/` folder in the installed plugin. They are shown in the order of their numbers, one every 350 ms, and are read when a session starts. Without frames the plugin draws nothing.

The installed plugin lives under `~/.claude/plugins/cache/thinking-sprite/thinking-sprite/`, in a folder named after the installed version. An update installs a fresh copy, so copy your frames in again after updating.

For another speed or size, adjust `FRAME_MS`, `COLUMNS` and `ROWS` in `hooks/register.tsx`.

## Turning a GIF into frames

These steps use [ImageMagick 7](https://imagemagick.org) (`magick`). Run them in the installed plugin's folder, with your GIF as `sprite.gif`.

1. Look at the GIF: one line per frame, with its size and delay in hundredths of a second.

   ```
   magick identify -format "%w x %h delay=%T\n" sprite.gif
   ```

   A delay of `35` is 350 ms; set `FRAME_MS` to it if it differs.

2. Find the box around the figure, so empty borders are cut off. This prints a geometry such as `309x420+0+112`:

   ```
   magick sprite.gif -coalesce -evaluate-sequence max -fuzz 8% -format "%@\n" info:
   ```

3. Split the GIF into numbered frames, cropped to that box and scaled to 200 pixels high:

   ```
   mkdir -p frames
   magick sprite.gif -coalesce -crop 309x420+0+112 +repage -resize x200 -strip frames/%d.png
   ```

   `-coalesce` turns each frame into a whole picture: many GIFs store only what changed since the frame before.

4. Optional: make a solid background transparent. This fills the background from the two top corners, so dark parts of the figure that do not touch the background stay. Add it before `-resize` in step 3, with the crop width less one as the right corner's x:

   ```
   -alpha set -fuzz 2% -fill none -draw "color 0,0 floodfill" -draw "color 308,0 floodfill"
   ```

   Raise `-fuzz` if a fringe of background stays, lower it if parts of the figure disappear.

5. Start a new Claude Code session: the frames are read when a session starts.

A terminal cell is about twice as tall as it is wide. For a figure that is not about three quarters as wide as it is tall, change `COLUMNS` against `ROWS` so it is not stretched.
