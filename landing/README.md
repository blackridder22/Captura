# Captura landing page

[Public website](https://blackridder22.github.io/Captura/)

Standalone HTML, CSS, and vanilla JavaScript. Open `index.html` directly, or serve this directory:

```sh
python3 -m http.server 4175 --bind 127.0.0.1 --directory landing
```

Then open http://127.0.0.1:4175.

## Contents

- `index.html`: complete landing page and inline Lucide icon symbols.
- `styles.css`: responsive charcoal/copper design, system typography, motion preferences.
- `script.js`: mobile navigation, interactive capture/queue/paste demonstration, FAQ deep links.
- `assets/`: real Captura UI screenshot and existing app icons.
- `qa/`: generated local browser verification evidence (not committed or published).

## Offer and links

All acquisition links use `data-download` and currently point to Captura’s real [latest release page](https://github.com/blackridder22/Captura/releases/latest). A price, checkout provider, refund policy, and purchase terms have not been supplied. Add those once decided; no invented price, checkout, testimonial, customer count, guarantee, or scarcity appears in the page.

The copy applies the money-strategy Value Equation: keep useful ideas without interrupting work (outcome), show the actual UI and a hands-on preview (confidence), emphasize capture and paste shortcuts (time and effort), and use one consistent acquisition action. Copper’s [product explanation](https://shadcn.com/copper) informed the workflow framing; the copy is written for Captura.

The `Leonxlnx/taste-skill` instructions were loaded from a temporary directory outside this repository. Its `design-taste-frontend` instructions informed the design. Calibration: `DESIGN_VARIANCE: 6`, `MOTION_INTENSITY: 3`, `VISUAL_DENSITY: 3`. Native HTML is used as explicitly requested; the app’s system font and copper tokens take precedence over skill defaults.

## Product claim sources

- `../README.md`: capture, queue, paste back, shortcuts, Accessibility, MIT license.
- `../docs/DESIGN.md`: visual identity and typography.
- `../src-tauri/tauri.conf.json`: macOS 13 minimum and GitHub updater endpoint.
- `../src/hooks/use-updater.ts`: launch-time update check.
- Public release page, checked September 5, 2026: Apple Silicon download and development-signing/notarization disclosure.

The screenshot is a browser render of Captura’s actual React UI with sample captures in an isolated browser profile. It is product imagery, not evidence of native macOS capture or paste-back verification. The interactive website preview only moves text between fields on this page and never reads the clipboard, writes storage, invokes the native app, or sends captured text over a network.

## Hosting

GitHub Pages serves the site at **https://blackridder22.github.io/Captura/**.

The [Deploy landing page workflow](../.github/workflows/pages.yml) runs on changes to `landing/` or the workflow on `main`, and can also be run manually. It checks the JavaScript, stages only `index.html`, `styles.css`, `script.js`, and `assets/`, then deploys them using GitHub Pages. QA files and this README are not part of the website artifact.

No site build step, runtime packages, external fonts, analytics, or backend. Relative asset paths support GitHub Pages’ repository prefix and direct local file previews. Canonical and social metadata use the public site URL. Update them if the domain changes.

## Assets

Captura branding is copied from this repository. The inline interface icons are from the repository’s installed `lucide-react` package, ISC licensed; see `assets/LUCIDE-LICENSE`.
