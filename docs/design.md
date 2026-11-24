# Piano design system

The living style guide. Everything here is live at `#/styleguide` in the dev server (`npm run dev`, then open
`/#/styleguide`); a production build shows "not found" there. Tokens and base components are in `src/style.css`;
pictures, icons and interactive pieces are in `src/ui/`.

## Principles

1. **One main thing per screen, with one obvious big button.** The sun-yellow `.primary` button appears once per
   view. Everything else is secondary, quiet, or tucked away (a sheet, a search button, a "More" link).
2. **Colour fills the screen.** The ocean gradient is the page. Big cards are filled with sun, coral or mint. Never
   go back to near-black panels on near-black.
3. **Pictures, not lists.** Songs are picture cards in sideways rows. Lessons and units get illustrated art. No photos
   of real people, ever.
4. **Big, round, few words.** Headings in Fredoka, large. Body in Atkinson Hyperlegible at 17px. Cut every sentence
   you can; then cut again.
5. **Celebrate real moments.** The first key from a piano, a finished lesson, three stars, a streak day: use
   `celebrate()`, the mascot cheering and a `.pop`. Not for ordinary clicks.
6. **Everyone can use it.** Real buttons and links, 44px minimum targets, visible focus (the sun ring), AA contrast,
   reduced motion respected.

## Our own look (the non-copying rule)

We hold ourselves to the friendliness of the leading commercial piano apps, **not their look**. Do not use their
colours (no purple brand), typefaces, logos, names, course or song-list names, wording, streak badge (no flame, no
coin), illustrations, artist photos, or the arrangement of any of their screens. Never use a photo of a real
person. A side-by-side should read "same category, different brand, equally inviting".

What makes ours ours: the **ocean** (teal to blue) world, the **sun** for action, coral and mint friends, cream paper
cards, **generated cover art** from each song's data, the **sunny note mascot**, the **sun** streak badge, and the
stepping-stone **Learn** journey.

## Tokens (`:root` in `src/style.css`)

### Colour

| Token | Use |
|---|---|
| `--page` | The full-bleed background gradient (`--ocean-1` teal to `--ocean-3` blue). Set on `body`. |
| `--ocean-deep` | Navigation rail and tab bar. |
| `--panel`, `--panel-2`, `--panel-3`, `--bg-raised` | Panels on the ocean (deepest to lightest). |
| `--text`, `--muted`, `--faint` | Cream text on the ocean, then softer. All meet 4.5:1 on every ocean surface. |
| `--sun` | **The** primary action colour. Buttons, current nav item, focus ring, progress fills. |
| `--coral`, `--mint`, `--sky` | Supporting fills for big cards, badges and art. |
| `--paper`, `--paper-2`, `--paper-3` | Light surfaces: sheets, picture-card bodies, welcome choices. |
| `--ink`, `--ink-muted` | Text on paper and on sun, coral, mint and sky fills. |
| `--coral-deep`, `--mint-deep`, `--sun-deep` | Coloured text on paper. |
| `--accent` | Links and small highlights on the ocean (mint). On paper it becomes coral-deep. |
| `--right`, `--left` | **Hand colours, falling notes only.** Never use them for UI decoration, so blue and amber always mean "right hand" and "left hand". |
| `--wash`, `--wash-strong` | Translucent tints for secondary buttons and chips. |
| `--scrim` | Behind dialogs. |

Deprecated but still defined so older screens draw: `--violet` (now a soft coral), `--keyline`, `--primary-fill`,
`--warm*`, `--good*`, `--bad*`, `--accent-soft`. Do not use them in new code.

Every text/background pair is checked by `e2e/a11y.e2e.ts` ("colour contrast of the design tokens"). Add a pair
there when you add a token.

### Surfaces

Add `.paper` to any container to flip it to a light surface: text becomes ink, secondary buttons, chips, fields,
links and the focus ring all adapt automatically. `dialog.sheet` is paper by default. `.fill-sun`, `.fill-coral`,
`.fill-mint`, `.fill-sky` do the same for filled cards (and turn `.primary` into an ink button so it still stands
out).

### Type

| Token | Size | Use |
|---|---|---|
| `--text-4xl` | 40 to 68px | Greetings, welcome questions (`.display`) |
| `--text-3xl` | 32 to 46px | Page heading (`h1`, `.page-title`) |
| `--text-2xl` | 26 to 32px | Section and row headings (`h2`) |
| `--text-xl` | 23px | Card titles (`h3`), big buttons |
| `--text-lg` | 19px | Lead text, picture-card titles |
| `--text-md` | 17px | Body (the default) |
| `--text-sm` | 15px | Hints, chips, small buttons |
| `--text-xs` | 13px | Badges only. Never for sentences. |

`--font-display` (Fredoka at one weight, 600) for headings, buttons, labels and numbers;
`--font-family` (Atkinson Hyperlegible, 400 and 700) for reading. Its zero has a slash on purpose (so 0 and O never mix up); for big friendly numbers (scores, counts, times) use `--font-display`. Both are self-hosted in `public/fonts/` under the
SIL Open Font License (`OFL-*.txt` next to them), in a Latin file and an extended Latin file loaded only when
needed, with `font-display: swap`.

### Space, shape, depth, motion

- Space: `--space-1` (4px) to `--space-8` (64px). `--gutter` for page edges. Prefer `--space-5` and up between blocks.
- Radii: `--radius-sm` 12, `--radius` 18, `--radius-lg` 26, `--radius-xl` 36, `--radius-pill`.
- Shadows: `--shadow-card` (panels), `--shadow`, `--shadow-lg` (sheets). Chunky things get a solid lower lip
  (`0 6px 0 rgb(2 24 40 / 0.18)`) instead of a blur.
- Motion: `--fast` 140ms, `--slow` 300ms, `--ease`, `--ease-bounce`. Both drop to 0 under
  `prefers-reduced-motion`, and every animation is cut to one quick frame. Respect `settings.reduceMotion` too (pass
  `calm` to `celebrate()`).
- Controls: `--control-h` 52px, `--control-h-sm` 44px (the minimum), `--control-h-lg` 64px.

## Components

### App shell (`src/ui/nav.ts`, drawn by `src/main.ts`)

An icon rail with labels on the left from 900px wide, a bottom tab bar below that: **Learn** (course), **Songs**
(home), **Shared**, **Settings**. The current place has `aria-current="page"` (or `"location"` inside it, such as
the player under Songs) and a sun pill. Screens do not draw navigation.

Full-screen places hide it (`isFullScreen(route)`): the player, a lesson in progress (`#/course/<id>`), the editor
and the welcome. They must show **one** clear way back: `appBar(title, { back: { route, label } })` draws a
`.back-link` (a round sun chevron with words).

### Page heading: `appBar(title, options)` (`src/app/dom.ts`)

Kept under its old name. Draws `.page-top > .page-head` with the optional `.back-link`, the `h1.page-title` and
optional actions. Every screen still renders exactly one `h1`.

### Buttons

```html
<button class="primary big">Play</button>        <!-- the one main action: sun, chunky lip, presses down -->
<button class="primary">Continue</button>
<button>Secondary</button>                         <!-- soft wash pill -->
<button class="quiet">Not now</button>             <!-- .ghost is the old name, still works -->
<button class="quiet danger">Remove</button>
<button class="button-coral">Yes, remove</button>  <!-- also .button-mint -->
<button class="icon-button" aria-label="Close">…icon…</button>  <!-- 48px round; .big = 64px -->
<a class="button primary" href="#/course">Start</a>   <!-- links can look like buttons -->
<button class="link-button">Measure again</button>
```

Sizes: `.big` (64px), default (52px), `.small` (44px). `.wide` fills the width. Put an icon first with
`icon('play')` from `src/ui/icons.ts`.

### Icons (`src/ui/icons.ts`)

`icon(name)` returns an inline, decorative SVG (24px, round 2.25px strokes, `currentColor`). Names: learn, songs,
shared, settings, search, close, back, forward, play, plus, check, edit, download, trash, more, addSong, clock, star,
sun, heart, listen, learnMode, playAlong, piano, keyboard, usb, mic, wave, lock, info, undo, redo, pointer, zoomIn,
zoomOut, record, pause, tools, link, send, speaker, eye, help. Draw new ones on the same
grid; never copy another app's icons.

### Cards

```html
<div class="card">…</div>                                <!-- everyday panel on the ocean -->
<section class="bigcard fill-sun">…</section>            <!-- one idea, big; fills: sun, coral, mint, sky, paper, ocean -->
```

**Picture card** (songs, and anything with a cover). The title button is the card's one control; its hit area
stretches over the whole card.

```html
<article class="pcard" data-song-id="twinkle">
  <svg class="pcard-cover">…songCover(song)…</svg>
  <span class="pcard-badge badge badge-sun">New</span>      <!-- optional -->
  <div class="pcard-body">
    <h3 class="pcard-title"><button type="button" class="pcard-open">Twinkle, Twinkle, Little Star</button></h3>
    <p class="pcard-by">Traditional</p>
    <div class="pcard-meta">levelDots(1) starRating(2)</div>
  </div>
</article>
```

Set `--pcard-w` to change the width (208px, 164px on phones). In a wrapping grid use `ul.pcard-grid`.

### Shelf (`src/ui/shelf.ts`)

`shelf({ id, title, items, count?, extra? })`: a titled sideways row. Swipe on touch, drag or use the round
arrows with a mouse, and Left/Right/Home/End between cards with a keyboard. Each item should hold one focusable
control.

### Song covers and unit art (`src/ui/cover-art.ts`)

`songCover(song)` draws an illustrated 4:3 cover from the song's data: style family from tags (lullaby moon,
holiday star or snowflake or tree, march drum or flag, ragtime hat, dance swirl or fan, hymn bell or window,
children balloon or kite or boat, folk leaf or flower, classical column or lyre or feather or metronome; your own
recordings a sound wave, shared songs a heart), the colourway from the composer (so one composer's pieces look
related), and the pattern (waves, keys, arcs, dots, stripes), layout and sparkles from the song id. Deterministic,
about 20 to 40 shapes, safe (no song text enters the markup). `coverColor(song)` gives the background colour for
tinting around it. `unitArt(index)` draws square art for the nine course units in the same language.

### Mascot (`src/ui/mascot.ts`)

`mascot('happy' | 'cheer' | 'curious', extraClass?)`: a round sunny note with a coral flag. Use sparingly:
greetings, empty states, celebrations, the welcome. Add `.is-bobbing` for a gentle idle float, `.is-cheering` for a
jump. Never put it where it competes with the primary button.

### Illustrations (`src/ui/illustrations.ts`)

`illustration('usb-piano' | 'computer' | 'acoustic' | 'songs' | 'connected')`: flat spot pictures for choices and
empty states. Also `cable` (a cable going into a piano), `link`, `share`, `file`, `sound`, `mic`, `timing`,
`display`, `about`, `write`, `fix`, `resume`: used by settings cards, step-by-step sheets and the editor start.

### Picture-card menus and "More options"

A place with several areas (Settings, the editor start) is a short grid of big filled buttons, each with an
illustration, a title and one live line (`.st-card`, `.ed-start-card`). Inside, show a few large controls;
fold anything advanced into `<details class="more-options">`. Troubleshooting is a list of tappable questions
(`tipList()` in `src/input/connect-ui.ts`), never a wall of text.

### Badges, stars, levels

```html
<span class="badge">Plain</span>  <span class="badge badge-sun">…icon('sun')… 3 days in a row</span>
<span class="badge badge-coral">New</span> <span class="badge badge-mint">Done</span> <span class="badge badge-cream">…</span>
```

- `starRating(n, big?)`: drawn stars out of three with an `aria-label` ("2 of 3 stars"). `big` for results.
- `starsBadge(n)`: the old text stars, still fine inline.
- `levelBadge(d)`: "Level 2 · Easy" with five steps. `levelDots(d)`: five dots for cards, with words for screen readers.
- `.tag`, `.tag-good`, `.tag-warm`, `.tag-accent`: deprecated, use `.badge`.
- Streaks are a **sun** badge, never a flame.

### Form controls

```html
<div class="field"><label for="x">Name</label><input id="x" type="text"><p class="hint">Short hint.</p></div>
<select>…</select>                                     <!-- sun chevron; ink chevron on paper -->
<label class="toggle">Show note names <input type="checkbox" role="switch"></label>
<label class="check"><input type="checkbox"> Every key the same loudness</label>
<input type="range">                                   <!-- thick track, sun thumb -->
<div class="segmented" role="group" aria-label="Hands"><button aria-pressed="true">Right hand</button>…</div>
<div class="chip-row" role="group" aria-label="Level"><button class="chip" aria-pressed="true">All</button>…</div>
```

### Progress

```html
<progress max="1" value="0.4" aria-label="Progress"></progress>
<div class="meter-bar" role="progressbar" aria-label="Course" aria-valuemin="0" aria-valuemax="40" aria-valuenow="7"><span style="width: 18%"></span></div>
<div class="ring" style="--value: 0.25" role="img" aria-label="10 of 40 lessons"><span>10</span></div>
```

`.ring` takes `--size`, `--fill`, `--track` and `--ring-hole` (the colour behind it).

### Sheets and dialogs (`src/ui/sheet.ts`)

`openSheet({ labelledBy, content, className?, onClose? })` opens a `<dialog class="sheet paper">`: centred on wide
screens, from the bottom on phones, Escape and the backdrop close it, focus returns to the opener. Put one primary
button in it. Older overlays (`.overlay > .card`, the add-song flow) get the same look automatically.

### Toasts (`src/ui/toast.ts`)

`toast('Song added!')`, `toast('That file did not work.', { kind: 'error' })`. One shared live region; never the only
way to do something.

### Empty, loading and error states

`notice(kind, title, text?, ...actions)` from `src/app/dom.ts`: `empty` (soft panel), `loading` (spinner, `role=status`),
`error` (paper with a coral ring, `role=alert`), `info`. Add `mascot('curious')` at the top of an empty state when
there is room. `.skeleton` draws a shimmering placeholder shape.

### Celebration (`src/ui/celebrate.ts`)

`celebrate(element?, { pieces?, spread?, calm? })`: stars and confetti burst from an element. Calm (fade in place)
under reduced motion; pass `calm: ctx.settings.get().reduceMotion` too. `.pop` makes a heading or badge pop in.

## Do and do not

| Do | Do not |
|---|---|
| One `.primary` per view | Two sun buttons side by side |
| Picture cards in a `shelf` | Long text lists of songs |
| "Play", "Start", "Continue" | "Initiate playback", "Proceed" |
| Big type, 2 lines at most per card | Paragraphs on cards |
| Hide rare actions in a sheet | Rows of small buttons on every card |
| Use the hand colours only for notes | Blue or amber UI decoration |
| Draw pictures from shapes | Photos of people, copied art |
| Sun streak badge | Flame or coin streak badges |
| `--text-sm` at the smallest for sentences | 12px grey text |

## Words

- Short, warm, concrete. Say what happens: "Plug in the USB cable", not "Ensure connectivity".
- Half the words you first wrote. One idea per sentence. Exclamation marks only for real wins.
- No jargon: never "MIDI CC", "velocity", "transcription", "latency" in the UI. Shared terms live in
  `src/app/words.ts`.
- The promise in few words: "Nothing is uploaded." "Free forever." "No account."
- No em dash (U+2014) in anything a user reads, including `aria-label`, `title`, `alt` and docs. Use a period, a
  comma, a colon, a middle dot `·` or parentheses.

## Checks before you finish

```bash
npx tsc --noEmit && npm test && npm run build && npm run e2e
grep -rn "$(printf '\u2014')" src index.html docs public community scripts e2e *.md --include='*.ts' --include='*.mjs' --include='*.css' --include='*.html' --include='*.md' --include='*.json' | grep -vE ':[0-9]+: *(\*|//|/\*)'
```

`e2e/design.e2e.ts` takes screenshots of the shell, home, song sheet and style guide at all four sizes into
`E2E_SHOTS` (default `test-results/shots`).
