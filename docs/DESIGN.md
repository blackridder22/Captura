# Captura design system

The implementation follows `docs/design/captura-menubar-concept.png` for
information architecture and the local Fragment app for component craft.
Tokens live in `src/styles/tokens.css`; motion in `src/styles/motion.css`;
bundled fonts in `src/styles/fonts.css` and `public/fonts/`.

## Surface

- Native popover footprint: 430 × 650 px.
- One open list with separators; no dashboard cards.
- Editorial header: the Captura wordmark with a status line (open count,
  sections, Local only), settings and close at the right, and a full-width
  search bar underneath.
- Composer card with Prompt / Note / Link as a tab row (image button at its
  end), then the text and Save.
- Text filter tabs with a sliding underline and a trailing Trash tab; section
  chips with live counts; two-line rows whose meta line starts with the mono
  time; keyboard footer.
- Capture page: one Notion-style page per capture with a Page | Source toggle.
- Settings: General · Shortcuts · Editor · Trash · About. Settings and the
  capture page are full pages inside the panel (no modal cards, no dimmed
  backdrop); they push in from the right while the queue slides back, and
  closing runs the same slide backwards (same distance, curve and duration;
  the page stays mounted for the whole run).
- Separate 360 × 92 px confirmation HUD (non-focusable).

## Brand tokens

- Background: `#08090a`
- Strong surface: `rgba(27, 29, 31, 0.96)`
- Soft surface: `rgba(23, 25, 27, 0.82)`
- Text: `#f4f2f0`
- Muted: `#aaa7a3`
- Subtle: `#777673`
- Copper: `#f08b64`
- Copper strong: `#ffb08f`
- Success: `#58d17b`
- Danger: `#f17b72`
- Code: `#e2b6a3`

## Type

- Families: Instrument Sans (`--font-sans`) for UI and capture text, JetBrains
  Mono (`--font-mono`) for Source, code, times and key caps. Both are bundled
  variable woff2 (OFL, latin subsets); the system stack remains the fallback.
- Scale: 10 / 11 / 12 / 13 / 15 / 17 px (`--text-xs` … `--text-xl`). Nothing
  on screen is smaller than 10 px.
- Capture text 13–13.5 px at 1.35 (queue) to 1.65 (page) line height; metadata
  10–11 px at weight 600; headings 740–790.
- Tabular numerals for counts and times.

## Shape and controls

- Radii: 6 / 9 / 12 px for controls, 20 px panel. Pages inherit the panel's clip.
- Control heights: 28 / 32 / 34 px.
- 1 px translucent borders with a soft top inset highlight.
- Selected rows use a copper left rail and a subtle surface lift.
- Copper communicates action, focus, and selection. It is not decorative glow.

## Motion

- Durations: 120 ms (fast, press/selection), 180 ms (base), 240 ms (slow,
  pages). Never above 300 ms in the UI.
- Buttons have no hover effects and never move: no lift, scale or bounce.
  Hover highlight is kept only on menu items and queue rows. Tab rows
  (filters, composer kind, Settings sections, segmented controls) use one
  sliding indicator element rather than per-tab state changes.
- Never place a `backdrop-filter` element where it can overlap the window's
  transparent rounded corners: WebKit paints the blurred under-page colour
  there as a square (light grey in light mode).
- Curves: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for anything entering or
  leaving; `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` for movement on
  screen (the filter underline).
- Presence: overlays carry `data-state="enter | open | exit"` from
  `usePresence` and animate with transitions, so rapid re-triggers retarget.
- Keyboard-driven, high-frequency actions (panel open, arrow navigation) stay
  near-instant: opacity only, ≤120 ms.
- Reduced motion keeps the fades and removes movement.

## Allowed first-viewport copy

- Captura
- Local only
- Search captures
- Save a thought, prompt, link…
- Inbox
- Prompts
- Notes
- Done
- Trash
- Option Space capture
- Command Enter paste
- Arrow keys navigate
