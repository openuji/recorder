# Recorder site

Static Astro site for `recorder.openuji.org`, including the general Recorder landing page and the FU Digital Journeys pilot.

## Local development

```bash
cd apps/site
npm install
npm run dev
```

## Static build

```bash
npm run build
```

The generated site is written to `apps/site/dist`.

## Cloudflare Pages

Recommended settings:

- Root directory: `apps/site`
- Build command: `npm install && npm run build`
- Build output directory: `dist`

No server-side rendering or runtime adapter is required.

## Architecture

- `src/pages`: route entry points only
- `src/templates`: page composition
- `src/components`: reusable layout, primitives, journey visuals and sections
- `src/content`: typed page copy/configuration
- `src/styles/theme.css`: design tokens
- `src/styles/utilities.css`: semantic Tailwind utilities

A new pilot should mostly require a new content object and the existing `PilotLanding` template rather than copied presentation code.
