/**
 * Adds `readingTime` (whole minutes) to each post's frontmatter.
 * Counts words in the mdast rather than the raw source, so frontmatter,
 * import statements and JSX attributes don't inflate the estimate.
 * Code blocks are counted at a slower rate — you read them differently.
 */

const PROSE_WPM = 220;
const CODE_LPM = 24;

function collect(node, acc) {
	if (node.type === 'code') {
		acc.codeLines += node.value.split('\n').length;
		return acc;
	}
	if (typeof node.value === 'string') {
		const words = node.value.trim().split(/\s+/).filter(Boolean).length;
		acc.words += words;
	}
	for (const child of node.children ?? []) collect(child, acc);
	return acc;
}

export function remarkReadingTime() {
	return (tree, file) => {
		const { words, codeLines } = collect(tree, { words: 0, codeLines: 0 });
		const minutes = words / PROSE_WPM + codeLines / CODE_LPM;
		file.data.astro.frontmatter.readingTime = Math.max(1, Math.round(minutes));
	};
}
