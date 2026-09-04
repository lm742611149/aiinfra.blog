// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';
import { remarkReadingTime } from './src/plugins/remark-reading-time.mjs';

// The real origin — RSS links, canonical URLs and the sitemap all derive from it.
const SITE = 'https://aiinfra.blog';

export default defineConfig({
	site: SITE,
	integrations: [mdx(), sitemap()],

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
			weights: [400, 600],
			styles: ['normal', 'italic'],
			subsets: ['latin'],
			fallbacks: ['Georgia', 'serif'],
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
