/**
 * GET /api/moderate?a=delete|ban&id=<comment id>&t=<hmac>
 * One-click moderation from the notification e-mail. The token is an HMAC over
 * "<action>:<id>" with MOD_SECRET, so a link only ever does the one thing it was minted for.
 */
import { escapeHtml, verifyAction, type Env } from '../../server/comments-lib';

type Ctx = { request: Request; env: Env };

const page = (title: string, body: string, status = 200) =>
	new Response(
		`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<body style="font:16px/1.6 -apple-system,Helvetica,Arial,sans-serif;color:#0f1520;background:#f7f8fa;padding:3rem 1.5rem;max-width:32em;margin:auto">
<h1 style="font-size:1.25rem">${escapeHtml(title)}</h1><p style="color:#3a4352">${body}</p></body>`,
		{ status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
	);

export async function onRequestGet({ request, env }: Ctx) {
	const url = new URL(request.url);
	const action = url.searchParams.get('a') ?? '';
	const id = url.searchParams.get('id') ?? '';
	const token = url.searchParams.get('t') ?? '';

	if (!['delete', 'ban'].includes(action) || !/^[0-9a-f-]{36}$/.test(id)) return page('Bad request', 'Malformed link.', 400);
	if (!(await verifyAction(env.MOD_SECRET, action, id, token))) return page('Not authorised', 'This link is invalid or has been tampered with.', 403);

	const row = await env.DB.prepare('SELECT ip_hash, name, status FROM comments WHERE id = ?1')
		.bind(id)
		.first<{ ip_hash: string; name: string; status: string }>();
	if (!row) return page('Not found', 'That comment no longer exists.', 404);

	if (action === 'delete') {
		if (row.status === 'deleted') return page('Already deleted', `The comment by ${escapeHtml(row.name)} was already removed.`);
		await env.DB.prepare(`UPDATE comments SET status = 'deleted' WHERE id = ?1`).bind(id).run();
		return page('Comment deleted', `The comment by ${escapeHtml(row.name)} is no longer shown.`);
	}

	const now = Date.now();
	const [, removed] = await env.DB.batch([
		env.DB.prepare('INSERT OR IGNORE INTO bans (ip_hash, reason, created_at) VALUES (?1, ?2, ?3)').bind(row.ip_hash, `via comment ${id}`, now),
		env.DB.prepare(`UPDATE comments SET status = 'deleted' WHERE ip_hash = ?1 AND status = 'approved'`).bind(row.ip_hash),
	]);
	const n = (removed as { meta?: { changes?: number } }).meta?.changes ?? 0;
	return page('Visitor banned', `${escapeHtml(row.name)} can no longer comment. ${n} comment${n === 1 ? '' : 's'} removed.`);
}
