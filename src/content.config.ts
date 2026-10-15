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

// Portfolio projects: standalone briefs, listed at /projects, kept out of the day-by-day course.
const projects = defineCollection({
	loader: glob({ base: './src/content/projects', pattern: '*.md' }),
	schema: z.object({
		title: z.string(),
		name: z.string(),
		tagline: z.string(),
		summary: z.string(),
		order: z.number().int().positive(),
		difficulty: z.number().int().min(1).max(5),
		level: z.enum(['中高级', '资深', '资深+']),
		duration: z.string(),
		cost: z.string(),
		gpu: z.boolean().default(false),
		targets: z.array(z.string()),
		stack: z.array(z.string()),
		recognition: z.string(),
		depends: z.array(z.string()).default([]),
		status: z.enum(['spec', 'tutorial']).default('spec'),
		// First lesson of the day-by-day tutorial, when one exists.
		tutorial: z.string().optional(),
	}),
});

export const collections = { blog, projects };
