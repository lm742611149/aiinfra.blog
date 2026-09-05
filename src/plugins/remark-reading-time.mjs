/**
 * Adds `readingTime` (whole minutes) and `wordCount` to each post's frontmatter.
 * Counts words in the mdast rather than the raw source, so frontmatter,
 * import statements and JSX attributes don't inflate the estimate.
 * Code blocks are counted at a slower rate — you read them differently.
 */

const PROSE_WPM = 220;
const CJK_CPM = 400; // CJK has no word boundaries — count characters instead
const CODE_LPM = 24;
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g;

function collect(node, acc) {
	if (node.type === 'code') {
		acc.codeLines += node.value.split('\n').length;
		return acc;
	}
	if (typeof node.value === 'string') {
		const cjk = node.value.match(CJK)?.length ?? 0;
		const rest = node.value.replace(CJK, ' ');
		acc.cjk += cjk;
		acc.words += rest.trim().split(/\s+/).filter(Boolean).length;
	}
	for (const child of node.children ?? []) collect(child, acc);
	return acc;
}

export function remarkReadingTime() {
	return (tree, file) => {
		const { words, cjk, codeLines } = collect(tree, { words: 0, cjk: 0, codeLines: 0 });
		const minutes = words / PROSE_WPM + cjk / CJK_CPM + codeLines / CODE_LPM;
		file.data.astro.frontmatter.readingTime = Math.max(1, Math.round(minutes));
		// Surfaced as schema.org `wordCount`; CJK characters count as words.
		file.data.astro.frontmatter.wordCount = words + cjk;
	};
}
