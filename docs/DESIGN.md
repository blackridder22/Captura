# Captura design system

The implementation follows `docs/design/captura-menubar-concept.png` for
information architecture and the local Fragment app for component craft.

## Surface

- Native popover footprint: 430 × 650 px.
- One open list with separators; no dashboard cards.
- Header, quick capture, filters, queue, and keyboard footer.
- Separate 360 × 92 px confirmation HUD.

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

## Component rules

- SF Pro/system font stack.
- 13–14 px controls and metadata; 15–17 px capture content.
- 1 px translucent borders with a soft top inset highlight.
- 12–18 px radii; the outer popover uses 18 px.
- 150–170 ms motion with reduced-motion support.
- Selected rows use a copper left rail and a subtle surface lift.
- Copper communicates action, focus, and selection. It is not decorative glow.

## Allowed first-viewport copy

- Captura
- Local only
- Search captures
- Save a thought, prompt, link…
- Inbox
- Prompts
- Notes
- Done
- Option Space capture
- Command Enter paste
- Arrow keys navigate

