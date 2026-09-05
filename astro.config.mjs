// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { remarkReadingTime } from './src/plugins/remark-reading-time.mjs';

// The real origin — RSS links, canonical URLs and the sitemap all derive from it.
const SITE = 'https://aiinfra.blog';

/**
 * Sitemap <lastmod> per post, read straight from frontmatter (astro:content isn't
 * available inside the config). Index pages take the newest date among their posts.
 */
function postDates(dir = 'src/content/blog', root = dir, out = new Map()) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			postDates(full, root, out);
			continue;
		}
		if (!/\.mdx?$/.test(entry.name)) continue;
		const fm = readFileSync(full, 'utf8').split('---')[1] ?? '';
		const pub = fm.match(/^pubDate:\s*['"]?([\d-]+)/m)?.[1];
		const upd = fm.match(/^updatedDate:\s*['"]?([\d-]+)/m)?.[1];
		const series = fm.match(/^series:\s*['"]?([\w-]+)/m)?.[1];
		const tags = [...(fm.match(/^tags:\s*\[(.*)\]/m)?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
		const date = upd ?? pub;
		if (!date) continue;
		const slug = relative(root, full).replace(/\.mdx?$/, '');
		out.set(`${SITE}/blog/${slug}/`, { date, series, tags });
	}
	return out;
}
const POST_DATES = postDates();
// Tag archives with a single post are noindex (see src/pages/tags/[tag].astro); keep them out of the sitemap too.
const TAG_COUNTS = new Map();
for (const { tags } of POST_DATES.values()) for (const t of tags) TAG_COUNTS.set(t, (TAG_COUNTS.get(t) ?? 0) + 1);
const thinTag = (url) => {
	const m = url.match(/\/tags\/([^/]+)\/$/);
	return m ? (TAG_COUNTS.get(decodeURIComponent(m[1])) ?? 0) < 2 : false;
};
const newest = (filter = () => true) =>
	[...POST_DATES.values()]
		.filter(filter)
		.map((v) => v.date)
		.sort()
		.at(-1);
const INDEX_DATES = {
	[`${SITE}/`]: newest(),
	[`${SITE}/blog/`]: newest(),
	[`${SITE}/tags/`]: newest(),
	[`${SITE}/course/`]: newest((v) => v.series === 'aiinfra-365'),
};

export default defineConfig({
	site: SITE,
	integrations: [
		mdx(),
		sitemap({
			filter: (page) => !page.includes('/404') && !thinTag(page),
			serialize(item) {
				const date = POST_DATES.get(item.url)?.date ?? INDEX_DATES[item.url];
				if (date) item.lastmod = new Date(date).toISOString();
				return item;
			},
		}),
	],

	markdown: {
		remarkPlugins: [remarkReadingTime],
		shikiConfig: {
			// css-variables lets the palette in global.css drive syntax colours,
			// so code blocks stay in the same design system as everything else.
			theme: 'css-variables',
			wrap: false,
		},
	},

	fonts: [
		{
			provider: fontProviders.google(),
			name: 'Archivo',
			cssVariable: '--font-archivo',
			weights: [600, 700],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['Helvetica Neue', 'system-ui', 'sans-serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Source Serif 4',
			cssVariable: '--font-serif',
			weights: [400, 500, 600],
			styles: ['normal', 'italic'],
			subsets: ['latin'],
			fallbacks: ['Georgia', 'serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Noto Sans SC',
			cssVariable: '--font-cjk-sans',
			weights: [500, 700],
			styles: ['normal'],
			subsets: ['chinese-simplified', 'latin'],
			fallbacks: ['PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'Noto Serif SC',
			cssVariable: '--font-cjk-serif',
			weights: [400, 500, 600],
			styles: ['normal'],
			subsets: ['chinese-simplified', 'latin'],
			fallbacks: ['Songti SC', 'Noto Serif CJK SC', 'PingFang SC', 'serif'],
		},
		{
			provider: fontProviders.google(),
			name: 'JetBrains Mono',
			cssVariable: '--font-mono-face',
			weights: [400, 500],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['ui-monospace', 'monospace'],
		},
	],
});
