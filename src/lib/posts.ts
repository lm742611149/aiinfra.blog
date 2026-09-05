import type { CollectionEntry } from 'astro:content';

type Post = CollectionEntry<'blog'>;

/** Newest first; course posts published on the same day fall back to Day order so the list reads right. */
export const byNewest = (a: Post, b: Post) =>
	b.data.pubDate.valueOf() - a.data.pubDate.valueOf() || (b.data.day ?? -1) - (a.data.day ?? -1);
