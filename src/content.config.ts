import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		// Which side of the roofline the post lives on. Drives the accent colour.
		regime: z.enum(['memory', 'compute', 'none']).default('none'),
		tags: z.array(z.string()).default([]),
		// Drafts build locally but are excluded from the site.
		draft: z.boolean().default(false),
		// Series membership. `aiinfra-365` is the day-by-day study log; `day` orders it.
		series: z.string().optional(),
		day: z.number().int().nonnegative().optional(),
		// Content language. Drives <html lang> so CJK fallbacks and hyphenation behave.
		lang: z.enum(['en', 'zh']).default('en'),
	}),
});

export const collections = { blog };
