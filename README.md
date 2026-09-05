# AI Infra · aiinfra.blog

A technical blog about GPU inference performance, plus a 365-day AI Infra study log. Astro, static
output, deployed on Cloudflare Pages at https://aiinfra.blog.

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

### The 365-day course

Study-log posts live in `src/content/blog/aiinfra-365/` and carry three extra fields:

```yaml
series: 'aiinfra-365'   # membership in the course
day: 7                  # orders the course page and drives prev/next links
lang: 'zh'              # sets <html lang>; course posts are written in Chinese
```

Title convention: `Day N · 标题` — the `Day N · ` prefix is stripped on the course index and in
prev/next navigation. Every course post follows the same skeleton: 今天要解决的问题 → 正文 → 名词解释
→ 常见误区 → 参考资料 → 自测 (answers inside `<details>`) → 明天预告. Reading time counts CJK
characters at 400/min.

Every course post also carries **figures and video**:

- Diagrams are inline SVG inside `<figure>…<figcaption>` (theme-aware: colour only with the tokens
  `--ink`, `--ink-soft`, `--ink-faint`, `--rule`, `--paper-raised`, `--mem`/`--mem-wash` for the
  memory-bound side, `--compute`/`--compute-wash` for the compute-bound side). No hot-linked images.
- Videos use `<figure class="video"><div class="video-frame"><iframe …></iframe></div></figure>` with
  a `youtube-nocookie.com/embed/ID` or `player.bilibili.com/player.html?bvid=BV…` source. Embed only
  IDs verified through YouTube oEmbed or the Bilibili view API.
- Measured numbers that have not actually been measured are written as expected ranges with their
  derivation, plus an empty table to fill in later. Spec numbers cite the vendor page.

`python3 scripts/check-course.py` validates frontmatter, skeleton order, day/date consistency,
prev/next previews, figure and video counts; add `--links` to curl every URL and embed ID.

The course index is `/course` (`src/pages/course/index.astro`), grouped by month of the study plan.

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
  consts.ts                    site title, tagline, social links, OG defaults
  layouts/BlogPost.astro       article page
  lib/seo.ts                   schema.org builders + OG image lookup
  pages/tags/                  tag archives (one page per tag, /tags/ index)
  plugins/                     remark plugin for reading time + word count
  styles/global.css            every design token lives here
public/
  og/                          social preview cards, generated — see below
  robots.txt, _headers         crawler + Cloudflare cache/security headers
scripts/gen-og.mjs             renders public/og/*.png with sharp
```

## SEO

What every page ships with, all derived from frontmatter — nothing to fill in by hand:

- `<title>`, meta description, canonical, `og:*` / `twitter:*` (large image card), `og:locale` and
  `<html lang>` from the post's `lang` (`zh` → `zh-CN`), `article:published_time` / `modified_time` / `tag`.
- JSON-LD: `WebSite` + `Person` on the homepage, `BlogPosting` + `BreadcrumbList` on posts,
  `CollectionPage`/`ItemList` on `/course` and tag pages, `ProfilePage` on `/about`.
- `sitemap-index.xml` with `<lastmod>` from `updatedDate ?? pubDate`; `robots.txt` points at it.
  Tag pages with a single post are `noindex` and left out of the sitemap.
- A 404 page, and `_headers` marking hashed `/_astro/*` assets immutable.

**Social cards.** `npm run og` renders one 1200×630 PNG per post into `public/og/` (plus `default.png`),
using the macOS fonts, and only for posts newer than their card. Run it after writing or retitling a
post and commit the PNGs — the Cloudflare build never renders text. A post without a card falls back
to the default one automatically.

After the first deploy: add the domain to Google Search Console (DNS TXT record in Cloudflare) and
submit `https://aiinfra.blog/sitemap-index.xml`; do the same in Bing Webmaster Tools.

## Comments

Self-hosted on Cloudflare: Pages Functions in `functions/api/` + a D1 database (`aiinfra-comments`,
schema in `db/schema.sql`) + Turnstile + Resend for the notification mail. Bindings live in
`wrangler.toml`; secrets are set once with `npx wrangler pages secret put <NAME> --project-name aiinfra-blog`:

| secret | purpose |
|---|---|
| `TURNSTILE_SECRET` | server-side Turnstile verification (site key is `TURNSTILE_SITEKEY` in `src/consts.ts`) |
| `MOD_SECRET` | salts the visitor hash and signs the one-click delete / ban links in the mail |
| `RESEND_API_KEY`, `NOTIFY_EMAIL` | where new-comment notifications go; mail is skipped if either is missing |

What is stored: name, comment, coarse region (`CN|Guangdong`) from Cloudflare's request geo, a salted
hash of the IP for rate limiting and bans. No raw IPs, no e-mail addresses from commenters. Defences on
POST: origin allow-list, size caps, honeypot field, Turnstile, ban list, 3 per 10 min / 30 per day per
visitor, duplicate check, max 2 links, the post must exist. Rendering uses `textContent` only.

Local run: `npm run build && npx wrangler pages dev dist` (reads `.dev.vars`, uses a local D1; apply the
schema once with `npx wrangler d1 execute aiinfra-comments --local --file db/schema.sql`).
Schema changes go to production with the same command plus `--remote`.

## Deploying to Cloudflare Pages

The site is fully static, so Pages needs no adapter.

1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Output directory: `dist`
   - Environment variable: `NODE_VERSION` = `22.21.1`
4. Custom domain: Pages project → Custom domains → add `aiinfra.blog` (and `www.aiinfra.blog` as a
   redirect). If the domain's DNS is already on Cloudflare the CNAME is created for you; otherwise
   point a CNAME at `<project>.pages.dev`. `SITE` in `astro.config.mjs` is already `https://aiinfra.blog`;
   RSS links, canonical URLs and the sitemap derive from it.

Fonts are fetched from Google at build time and self-hosted in the output — the deployed site makes
no third-party requests, but the build machine needs network access.
