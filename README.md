# Ridge Point

A technical blog about GPU inference performance. Astro, static output, deployed on Cloudflare Pages.

## Running it

The project needs Node 22 (`.nvmrc` pins it). The system Node here is 16, so load nvm first:

```bash
nvm use            # picks up .nvmrc
npm install
npm run dev        # http://localhost:4321
npm run build      # static output in dist/
```

## Writing a post

Add a Markdown file under `src/content/blog/`. The filename becomes the URL:
`decode-is-memory-bound.md` → `/blog/decode-is-memory-bound/`.

```yaml
---
title: 'Post title'
description: 'One or two sentences. Shows on the index and in the RSS feed.'
pubDate: 2026-08-20
regime: memory # memory | compute | none — drives the accent colour
tags: ['nsight', 'profiling']
draft: false # true keeps it out of the build entirely
---
```

`regime` is the one bit of colour logic in the design: `memory` marks a post as living on the
bandwidth-bound side of the roofline (indigo), `compute` on the FLOP-bound side (amber), `none`
opts out. Don't use it decoratively.

Reading time is computed at build time from the word count — nothing to fill in.

## Layout

```
src/
  components/Roofline.astro    the homepage plot — hand-placed log-scale coordinates
  content/blog/                posts
  content.config.ts            frontmatter schema (build fails if a post breaks it)
  consts.ts                    site title, tagline, social links
  layouts/BlogPost.astro       article page
  plugins/                     remark plugin for reading time
  styles/global.css            every design token lives here
```

## Deploying to Cloudflare Pages

The site is fully static, so Pages needs no adapter.

1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Output directory: `dist`
   - Environment variable: `NODE_VERSION` = `22.21.1`
4. **After the first deploy, set the real origin in `astro.config.mjs`.** `SITE` currently points at
   `https://ridge-point.pages.dev`. RSS links, canonical URLs and the sitemap are all derived from
   it, so a wrong value there ships broken feed links.

Fonts are fetched from Google at build time and self-hosted in the output — the deployed site makes
no third-party requests, but the build machine needs network access.
