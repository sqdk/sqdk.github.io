# sqdk.io

Personal site of Christian Probst, built with [Astro](https://astro.build) and Tailwind and deployed to GitHub Pages on every push to `main`.

## Pages

| Path | Source | What it is |
| :-- | :-- | :-- |
| `/` | `src/pages/index.astro` | Splash and title page over an animated bead backdrop (`src/home/beads.ts`) |
| `/resume/` | `src/pages/resume.astro` | Resume (printable) |
| `/experiments/` | `src/pages/experiments/index.astro` | List of experiments |
| `/experiments/<slug>/` | `src/pages/experiments/<slug>.astro` | One page per experiment |

## Adding an experiment

1. Create `src/pages/experiments/<slug>.astro` (put supporting code in `src/experiments/<slug>/`).
2. Add an entry to the list in `src/experiments/index.ts`. The index page picks it up from there.

## The home page backdrop

`src/home/beads.ts` is a single WebGL fragment shader with no dependencies: a grid of chrome beads carved by a slowly moving gyroid surface. The splash plays on fresh visits and reloads, and is skipped when arriving from another page on the site, with reduced-motion enabled, or without WebGL. If the GPU can't keep up, the page lowers the render resolution instead of dropping frames.

In development, `/?at=<ms>` renders a single frame of the splash timeline, which is handy for screenshots.

## Commands

| Command | Action |
| :-- | :-- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server at `localhost:4321` |
| `npm run build` | Build the site to `./dist/` |
| `npm run preview` | Preview the build locally |
