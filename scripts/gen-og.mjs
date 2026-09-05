/**
 * Generate social-preview (Open Graph) cards into public/og/.
 *
 *   npm run og            # all posts + the default card (skips ones already up to date)
 *   npm run og -- --force # regenerate everything
 *
 * Runs locally (needs the macOS CJK fonts); the PNGs are committed, so the
 * Cloudflare build never has to render text. BlogPost.astro falls back to
 * /og/default.png for any post without a card.
 *
 * Card design mirrors the site: cool-grey paper, roofline mark, indigo/amber
 * regime accent, Day badge for course posts. 1200×630.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname;
const CONTENT = join(ROOT, 'src/content/blog');
const OUT = join(ROOT, 'public/og');
const FORCE = process.argv.includes('--force');

const W = 1200;
const H = 630;
const SITE_TITLE = 'AI Infra';
const DOMAIN = 'aiinfra.blog';
const COURSE_TITLE = '365 天 AI Infra 自学课程';

// Light palette from global.css. OG cards are always light — dark cards vanish on X's dark UI borders.
const C = {
	paper: '#f7f8fa',
	raised: '#ffffff',
	ink: '#0f1520',
	inkSoft: '#3a4352',
	inkFaint: '#6b7483',
	rule: '#d3d8e0',
	mem: '#2b53d8',
	compute: '#b26a12',
};
// Latin faces first so hyphens/quotes come from Helvetica; Pango falls back per glyph to PingFang for CJK.
const FONT_SANS = "'Archivo', 'Helvetica Neue', Helvetica, Arial, 'PingFang SC', 'Hiragino Sans GB', sans-serif";
const FONT_MONO = "'JetBrains Mono', 'SF Mono', Menlo, monospace";

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isWide = (ch) => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch);
const charW = (ch) => (isWide(ch) ? 1 : /[A-Z0-9]/.test(ch) ? 0.66 : /[ilj.,:;'’ ]/.test(ch) ? 0.3 : 0.55);
const textW = (s) => [...s].reduce((n, ch) => n + charW(ch), 0);

/** Greedy wrap: CJK breaks anywhere, Latin at spaces. Returns at most `maxLines`, ellipsising the last. */
function wrap(text, maxEm, maxLines) {
	const tokens = [];
	for (const seg of text.split(/(\s+)/)) {
		if (!seg) continue;
		if (/^\s+$/.test(seg)) tokens.push(' ');
		else if ([...seg].some(isWide)) tokens.push(...[...seg]);
		else tokens.push(seg);
	}
	const lines = [];
	let cur = '';
	for (const tok of tokens) {
		if (tok === ' ' && !cur) continue;
		if (textW(cur + tok) <= maxEm) cur += tok;
		else {
			if (cur) lines.push(cur.trimEnd());
			cur = tok === ' ' ? '' : tok;
		}
	}
	if (cur) lines.push(cur.trimEnd());
	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		let last = kept[maxLines - 1];
		while (textW(last + '…') > maxEm && last.length) last = last.slice(0, -1).trimEnd();
		kept[maxLines - 1] = last + '…';
		return kept;
	}
	return lines;
}

function frontmatter(md) {
	const fm = md.split('---')[1] ?? '';
	const get = (k) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
	return {
		title: get('title') ?? '',
		description: get('description') ?? '',
		regime: get('regime') ?? 'none',
		series: get('series'),
		day: get('day') !== undefined ? Number(get('day')) : undefined,
		draft: get('draft') === 'true',
		pubDate: get('pubDate'),
	};
}

function rooflineMark(x, y, scale, accent) {
	// The header logo: rising indigo slope, flat amber roof.
	return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke-linecap="round" stroke-width="2.4">
		<path d="M1 13 L15 3" stroke="${C.mem}"/>
		<path d="M15 3 L25 3" stroke="${C.compute}"/>
	</g>`;
}

function card({ title, description, regime, series, day, kicker }) {
	const accent = regime === 'compute' ? C.compute : C.mem;
	const inCourse = series === 'aiinfra-365';
	const cjk = [...title].some(isWide);

	// Title: shrink until it fits in 3 lines.
	const boxEm = 1040; // px available for the title column
	let size = cjk ? 62 : 70;
	let lines;
	for (;;) {
		lines = wrap(title, boxEm / size, 3);
		const fits = wrap(title, boxEm / size, 99).length <= 3;
		if (fits || size <= 40) break;
		size -= 4;
	}
	const lineH = size * (cjk ? 1.38 : 1.18);
	const titleTop = 200;

	const descTop = titleTop + lines.length * lineH + 34;
	// Description gets whatever room is left above the footer rule: 2 lines, 1 line, or none.
	const descLines = Math.max(0, Math.min(2, Math.floor((H - 84 - 28 - descTop) / 42)));
	const desc = description && descLines ? wrap(description, 1040 / 27, descLines) : [];

	const badge = inCourse && day !== undefined ? `DAY ${String(day).padStart(2, '0')}` : kicker ?? (regime !== 'none' ? `${regime.toUpperCase()}-BOUND` : '');
	const badgeW = badge ? Math.round(textW(badge) * 18 + 40) : 0;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
	<rect width="${W}" height="${H}" fill="${C.paper}"/>
	<rect x="0" y="0" width="14" height="${H}" fill="${accent}"/>
	<line x1="80" y1="128" x2="${W - 80}" y2="128" stroke="${C.rule}" stroke-width="1.5"/>

	${rooflineMark(80, 60, 2.2, accent)}
	<text x="150" y="86" font-family="${FONT_SANS}" font-weight="700" font-size="30" fill="${C.ink}" letter-spacing="-0.5">${SITE_TITLE}</text>
	<text x="${W - 80}" y="86" text-anchor="end" font-family="${FONT_MONO}" font-size="22" fill="${C.inkFaint}" letter-spacing="2">${DOMAIN}</text>

	${
		badge
			? `<rect x="80" y="${titleTop - 74}" width="${badgeW}" height="44" rx="4" fill="${C.raised}" stroke="${C.rule}"/>
	<rect x="80" y="${titleTop - 74}" width="5" height="44" rx="2" fill="${accent}"/>
	<text x="${80 + 24}" y="${titleTop - 44}" font-family="${FONT_MONO}" font-weight="500" font-size="20" letter-spacing="3" fill="${C.ink}">${esc(badge)}</text>`
			: ''
	}
	${inCourse ? `<text x="${80 + badgeW + 22}" y="${titleTop - 44}" font-family="${FONT_SANS}" font-weight="500" font-size="21" fill="${C.inkFaint}">${esc(COURSE_TITLE)}</text>` : ''}

	<text font-family="${FONT_SANS}" font-weight="700" font-size="${size}" fill="${C.ink}" letter-spacing="${cjk ? 0 : -1.2}">
		${lines.map((l, i) => `<tspan x="80" y="${titleTop + size * 0.82 + i * lineH}">${esc(l)}</tspan>`).join('\n\t\t')}
	</text>

	<text font-family="${FONT_SANS}" font-weight="400" font-size="27" fill="${C.inkSoft}">
		${desc.map((l, i) => `<tspan x="80" y="${descTop + 27 * 0.85 + i * 42}">${esc(l)}</tspan>`).join('\n\t\t')}
	</text>

	<line x1="80" y1="${H - 84}" x2="${W - 80}" y2="${H - 84}" stroke="${C.rule}" stroke-width="1.5"/>
	<text x="80" y="${H - 44}" font-family="${FONT_MONO}" font-size="20" fill="${C.inkFaint}" letter-spacing="2">MIN LIU · GPU INFERENCE PERFORMANCE</text>
	${
		regime !== 'none'
			? `<text x="${W - 80}" y="${H - 44}" text-anchor="end" font-family="${FONT_MONO}" font-size="20" fill="${accent}" letter-spacing="2">${regime.toUpperCase()}-BOUND</text>`
			: ''
	}
</svg>`;
}

async function render(svg, outPath) {
	mkdirSync(dirname(outPath), { recursive: true });
	await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(outPath);
}

function* posts(dir = CONTENT) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, e.name);
		if (e.isDirectory()) yield* posts(full);
		else if (/\.mdx?$/.test(e.name)) yield full;
	}
}

const stale = (src, out) => FORCE || !existsSync(out) || statSync(out).mtimeMs < statSync(src).mtimeMs;

let made = 0;
let skipped = 0;

// Default card: site title + tagline. Rebuilt when this script changes.
const defaultOut = join(OUT, 'default.png');
if (stale(new URL(import.meta.url).pathname, defaultOut)) {
	await render(
		card({
			title: 'GPU inference performance, from the arithmetic up',
			description: 'Roofline analysis, profiling, kernels, inference engines — and a 365-day AI Infra self-study course in Chinese.',
			regime: 'memory',
			kicker: 'AIINFRA.BLOG',
		}),
		defaultOut,
	);
	made++;
} else skipped++;

for (const file of posts()) {
	const fm = frontmatter(readFileSync(file, 'utf8'));
	if (fm.draft) continue;
	const slug = relative(CONTENT, file).replace(/\.mdx?$/, '');
	const out = join(OUT, `${slug}.png`);
	if (!stale(file, out)) {
		skipped++;
		continue;
	}
	// Course titles carry "Day N · " — the badge already says it, so strip it from the headline.
	const title = fm.title.replace(/^Day \d+\s*·\s*/, '');
	await render(card({ ...fm, title }), out);
	made++;
	process.stdout.write(`  ${slug}\n`);
}

console.log(`og: ${made} generated, ${skipped} up to date → public/og/`);
