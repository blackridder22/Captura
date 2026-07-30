# Captura operating guide

Captura is a macOS-first, local-first menubar utility for capturing text, links,
notes, and follow-up prompts without breaking an AI-assisted workflow.

## Product rules

- The menu bar is the app's home. Do not add a conventional Dock-first window.
- `Option + Space` is the default capture shortcut.
- Captured data stays local. Do not add accounts, analytics, sync, or servers.
- Rust owns SQLite, clipboard automation, app focus, and macOS window behavior.
- React communicates with native code only through typed Tauri commands/events.
- Keep the interface fast, keyboard-first, calm, and useful at 430 px wide.
- Use "capture", "prompt", "note", "link", "queue", and "paste back" in UI.

## Visual direction

- Use the approved charcoal-and-copper concept under `docs/design/`.
- Borrow component craft from Fragment: native SF typography, dark glass
  surfaces, inset hairlines, compact controls, and short restrained motion.
- Do not copy Fragment's cyan/green brand palette or visual-vault layout.
- Avoid dashboard framing, card grids, decorative glows, and excessive pills.

## Engineering rules

- Use pnpm.
- Keep TypeScript strict.
- Put all schema changes in ordered SQLite migrations.
- Add tests for domain logic and database behavior.
- Before release, run frontend tests/build, Rust tests/Clippy, Tauri build,
  strict code-sign verification, and a packaged app launch.

