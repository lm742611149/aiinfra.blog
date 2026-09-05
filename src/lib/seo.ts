/**
 * Shared SEO helpers: schema.org builders and the OG-image lookup.
 * Everything here runs at build time only.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectionEntry } from 'astro:content';
import { AUTHOR, COURSE_SERIES, COURSE_TITLE, DEFAULT_OG_IMAGE, SITE_DESCRIPTION, SITE_TITLE, SOCIALS } from '../consts';

type Post = CollectionEntry<'blog'>;

const abs = (site: URL | undefined, path: string) => new URL(path, site).toString();

/** `/og/<post id>.png` if `npm run og` has produced it, otherwise the site-wide default card. */
export function ogImageFor(postId: string): string {
	const rel = `/og/${postId}.png`;
	// Resolved from the project root (Astro runs the build from there); import.meta.url points into the bundle.
	return existsSync(join(process.cwd(), 'public', rel)) ? rel : DEFAULT_OG_IMAGE;
}

export function personSchema(site: URL | undefined) {
	return {
		'@type': 'Person',
		'@id': abs(site, '/about/#person'),
		name: AUTHOR,
		url: abs(site, '/about/'),
		sameAs: Object.values(SOCIALS),
	};
}

export function websiteSchema(site: URL | undefined) {
	return {
		'@type': 'WebSite',
		'@id': abs(site, '/#website'),
		name: SITE_TITLE,
		alternateName: 'aiinfra.blog',
		url: abs(site, '/'),
		description: SITE_DESCRIPTION,
		inLanguage: ['en', 'zh-CN'],
		author: { '@id': abs(site, '/about/#person') },
		publisher: { '@id': abs(site, '/about/#person') },
	};
}

export function breadcrumbSchema(site: URL | undefined, crumbs: { name: string; path: string }[]) {
	return {
		'@type': 'BreadcrumbList',
		itemListElement: crumbs.map((c, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			name: c.name,
			item: abs(site, c.path),
		})),
	};
}

export function blogPostingSchema(site: URL | undefined, post: Post, opts: { image: string; wordCount?: number }) {
	const { title, description, pubDate, updatedDate, tags, lang, series, day } = post.data;
	const url = abs(site, `/blog/${post.id}/`);
	const inCourse = series === COURSE_SERIES;
	return {
		'@type': 'BlogPosting',
		'@id': `${url}#article`,
		mainEntityOfPage: url,
		url,
		headline: title,
		description,
		image: abs(site, opts.image),
		datePublished: pubDate.toISOString(),
		dateModified: (updatedDate ?? pubDate).toISOString(),
		inLanguage: lang === 'zh' ? 'zh-CN' : 'en',
		keywords: tags.join(', '),
		author: { '@id': abs(site, '/about/#person') },
		publisher: { '@id': abs(site, '/about/#person') },
		isPartOf: inCourse
			? { '@type': 'Blog', '@id': abs(site, '/course/#series'), name: COURSE_TITLE, url: abs(site, '/course/') }
			: { '@type': 'Blog', '@id': abs(site, '/blog/#blog'), name: `${SITE_TITLE} — Writing`, url: abs(site, '/blog/') },
		...(inCourse && day !== undefined ? { position: day } : {}),
		...(opts.wordCount ? { wordCount: opts.wordCount } : {}),
	};
}

/** Slugify a tag for its archive URL. Tags are already kebab-case; this only guards against surprises. */
export const tagSlug = (t: string) =>
	t
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9一-鿿]+/g, '-')
		.replace(/^-|-$/g, '');
