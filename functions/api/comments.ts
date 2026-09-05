/**
 * GET  /api/comments?slug=<post id>   → { comments: [...] }
 * POST /api/comments                  → 201 { comment } | 4xx { error, message }
 *
 * Defences, in order: origin allow-list → payload shape/size → honeypot → Turnstile →
 * ban list → per-visitor rate limit → duplicate check → link cap → the post must exist.
 * Stored: name, body, coarse region, salted IP hash. Never the IP or an e-mail address.
 */
import {
	cleanText,
	corsHeaders,
	error,
	hashIp,
	json,
	LIMITS,
	originAllowed,
	publicComment,
	sendNotification,
	verifyTurnstile,
	type CommentRow,
	type Env,
} from '../../server/comments-lib';

type Ctx = {
	request: Request & { cf?: { country?: string; region?: string } };
	env: Env;
	waitUntil(p: Promise<unknown>): void;
};

const SLUG = /^[a-z0-9][a-z0-9/-]{0,119}$/;

export async function onRequestOptions({ request, env }: Ctx) {
	const origin = request.headers.get('origin');
	if (!originAllowed(origin, env)) return error(403, 'origin', 'Origin not allowed');
	return new Response(null, { status: 204, headers: corsHeaders(origin!) });
}

export async function onRequestGet({ request, env }: Ctx) {
	const url = new URL(request.url);
	const slug = url.searchParams.get('slug') ?? '';
	if (!SLUG.test(slug)) return error(400, 'slug', 'Bad slug');

	const { results } = await env.DB.prepare(
		`SELECT id, slug, name, body, region, created_at FROM comments
		 WHERE slug = ?1 AND status = 'approved' ORDER BY created_at ASC LIMIT 300`,
	)
		.bind(slug)
		.all<CommentRow>();

	const origin = request.headers.get('origin');
	const headers = origin && originAllowed(origin, env) ? corsHeaders(origin) : {};
	return json({ comments: results.map(publicComment) }, 200, headers);
}

export async function onRequestPost({ request, env, waitUntil }: Ctx) {
	const origin = request.headers.get('origin');
	if (!originAllowed(origin, env)) return error(403, 'origin', 'Origin not allowed');
	const cors = corsHeaders(origin!);
	const fail = (status: number, code: string, message: string) => json({ error: code, message }, status, cors);

	if (!(request.headers.get('content-type') ?? '').includes('application/json')) return fail(415, 'type', 'JSON only');
	const raw = await request.text();
	if (raw.length > 8192) return fail(413, 'size', 'Payload too large');
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(raw);
	} catch {
		return fail(400, 'json', 'Malformed JSON');
	}

	// Honeypot: real browsers leave the hidden "website" field empty.
	if (typeof data.website === 'string' && data.website.length > 0) return json({ comment: null }, 201, cors);

	const slug = typeof data.slug === 'string' && SLUG.test(data.slug) ? data.slug : null;
	const name = cleanText(data.name, LIMITS.name);
	const body = cleanText(data.body, LIMITS.body, { multiline: true });
	const token = typeof data.token === 'string' ? data.token : '';
	if (!slug) return fail(400, 'slug', 'Bad slug');
	if (!name) return fail(400, 'name', `Name is required (max ${LIMITS.name} characters)`);
	if (!body || [...body].length < 2) return fail(400, 'body', `Comment is required (max ${LIMITS.body} characters)`);
	if (/https?:\/\//i.test(name) || /[<>]/.test(name)) return fail(400, 'name', 'That name is not allowed');
	const links = body.match(/https?:\/\/|www\./gi)?.length ?? 0;
	if (links > LIMITS.maxLinks) return fail(400, 'links', `At most ${LIMITS.maxLinks} links per comment`);

	const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
	const tsErrors = await verifyTurnstile(env.TURNSTILE_SECRET, token);
	if (tsErrors.length) return fail(403, 'turnstile', `Verification failed (${tsErrors.join(', ')})`);

	const ip_hash = await hashIp(ip, env.MOD_SECRET);
	const now = Date.now();

	const banned = await env.DB.prepare('SELECT 1 AS x FROM bans WHERE ip_hash = ?1').bind(ip_hash).first();
	if (banned) return fail(403, 'banned', 'Commenting is disabled for this visitor');

	const recent = await env.DB.prepare(
		`SELECT
		   SUM(CASE WHEN created_at > ?2 THEN 1 ELSE 0 END) AS ten,
		   SUM(CASE WHEN created_at > ?3 THEN 1 ELSE 0 END) AS day,
		   SUM(CASE WHEN created_at > ?3 AND body = ?4 THEN 1 ELSE 0 END) AS dupe
		 FROM comments WHERE ip_hash = ?1`,
	)
		.bind(ip_hash, now - 10 * 60_000, now - 24 * 3_600_000, body)
		.first<{ ten: number; day: number; dupe: number }>();
	if ((recent?.ten ?? 0) >= LIMITS.perTenMinutes || (recent?.day ?? 0) >= LIMITS.perDay)
		return fail(429, 'rate', 'Too many comments, try again later');
	if ((recent?.dupe ?? 0) > 0) return fail(409, 'dupe', 'You already posted this');

	// The post has to exist in this deployment's static assets — stops garbage slugs filling the table.
	const page = await env.ASSETS.fetch(new Request(new URL(`/blog/${slug}/`, request.url), { method: 'HEAD' }));
	if (!page.ok) return fail(404, 'post', 'No such post');

	const cf = request.cf ?? {};
	const region = cf.country ? [cf.country, cf.region].filter(Boolean).join('|') : null;
	const ua = (request.headers.get('user-agent') ?? '').slice(0, 200);

	const row: CommentRow = { id: crypto.randomUUID(), slug, name, body, region, created_at: now };
	await env.DB.prepare(
		`INSERT INTO comments (id, slug, name, body, region, ip_hash, ua, status, created_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'approved', ?8)`,
	)
		.bind(row.id, slug, name, body, region, ip_hash, ua, now)
		.run();

	waitUntil(sendNotification(env, new URL(request.url).origin, row, ip_hash).catch((e) => console.error('notify failed', e)));

	return json({ comment: publicComment(row) }, 201, cors);
}
