/**
 * Shared helpers for the comments API (Cloudflare Pages Functions in functions/api/).
 * Kept outside functions/ so it is bundled as a module, not exposed as a route.
 */

export interface Env {
	DB: D1Database;
	/** Static assets of this deployment (built-in Pages binding). */
	ASSETS: { fetch(req: Request): Promise<Response> };
	ALLOWED_ORIGINS: string;
	SITE_ORIGIN: string;
	MAIL_FROM: string;
	// secrets
	TURNSTILE_SECRET: string;
	MOD_SECRET: string;
	RESEND_API_KEY?: string;
	NOTIFY_EMAIL?: string;
}

// Minimal D1 typing so this compiles without @cloudflare/workers-types.
export interface D1Database {
	prepare(sql: string): D1Statement;
	batch<T = unknown>(stmts: D1Statement[]): Promise<{ results?: T[] }[]>;
}
export interface D1Statement {
	bind(...values: unknown[]): D1Statement;
	first<T = Record<string, unknown>>(col?: string): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
	run(): Promise<{ success: boolean; meta: { changes?: number } }>;
}

export const LIMITS = {
	name: 32,
	body: 1500,
	slug: 120,
	perTenMinutes: 3,
	perDay: 30,
	maxLinks: 2,
};

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
	});

export const error = (status: number, code: string, message: string) => json({ error: code, message }, status);

/** Origin allow-list: configured origins plus this project's Pages preview deployments. */
export function originAllowed(origin: string | null, env: Env): boolean {
	if (!origin) return false;
	const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
	if (allowed.includes(origin)) return true;
	try {
		const host = new URL(origin).hostname;
		return host.endsWith('.aiinfra-blog.pages.dev') || host === 'localhost' || host === '127.0.0.1';
	} catch {
		return false;
	}
}

export function corsHeaders(origin: string): Record<string, string> {
	return {
		'access-control-allow-origin': origin,
		'access-control-allow-methods': 'GET, POST, OPTIONS',
		'access-control-allow-headers': 'content-type',
		vary: 'origin',
	};
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) =>
	[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Salted, truncated hash — enough to rate-limit and ban, useless for recovering the IP. */
export async function hashIp(ip: string, salt: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${ip}`));
	return hex(digest).slice(0, 32);
}

async function hmacKey(secret: string) {
	return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Signed token for one-click moderation links in the notification mail. */
export async function signAction(secret: string, action: string, id: string): Promise<string> {
	const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${action}:${id}`));
	return hex(sig).slice(0, 40);
}

export async function verifyAction(secret: string, action: string, id: string, token: string): Promise<boolean> {
	if (!/^[0-9a-f]{40}$/.test(token)) return false;
	const expected = await signAction(secret, action, id);
	// Constant-time compare.
	let diff = 0;
	for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
	return diff === 0;
}

export async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
	if (!token || token.length > 2048) return false;
	const form = new FormData();
	form.set('secret', secret);
	form.set('response', token);
	if (ip) form.set('remoteip', ip);
	try {
		const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
		const data = (await res.json()) as { success?: boolean };
		return data.success === true;
	} catch {
		return false;
	}
}

export const escapeHtml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Collapse whitespace, strip control chars, enforce length. Returns null when unusable. */
export function cleanText(value: unknown, max: number, { multiline = false } = {}): string | null {
	if (typeof value !== 'string') return null;
	let s = value.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
	s = multiline ? s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
	s = s.trim();
	if (!s || [...s].length > max) return null;
	return s;
}

export interface CommentRow {
	id: string;
	slug: string;
	name: string;
	body: string;
	region: string | null;
	created_at: number;
}

export const publicComment = (r: CommentRow) => ({
	id: r.id,
	name: r.name,
	body: r.body,
	region: r.region,
	createdAt: r.created_at,
});

/** `origin` is the deployment that received the comment, so links work on previews too. */
export async function sendNotification(env: Env, origin: string, c: CommentRow, ip_hash: string): Promise<void> {
	if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return;
	const postUrl = `${origin}/blog/${c.slug}/#comments`;
	const del = `${origin}/api/moderate?a=delete&id=${c.id}&t=${await signAction(env.MOD_SECRET, 'delete', c.id)}`;
	const ban = `${origin}/api/moderate?a=ban&id=${c.id}&t=${await signAction(env.MOD_SECRET, 'ban', c.id)}`;
	const html = `<div style="font:15px/1.6 -apple-system,Helvetica,Arial,sans-serif;color:#0f1520;max-width:36em">
<p style="color:#6b7483;margin:0 0 .5em">New comment on <a href="${postUrl}">${escapeHtml(c.slug)}</a></p>
<p style="margin:0 0 .25em"><strong>${escapeHtml(c.name)}</strong> <span style="color:#6b7483">· ${escapeHtml(c.region ?? 'unknown region')}</span></p>
<blockquote style="margin:.5em 0 1.25em;padding:.6em 1em;border-left:3px solid #2b53d8;background:#f7f8fa;white-space:pre-wrap">${escapeHtml(c.body)}</blockquote>
<p style="font-size:13px;color:#6b7483">
<a href="${del}" style="color:#b26a12">Delete this comment</a> &nbsp;·&nbsp;
<a href="${ban}" style="color:#b26a12">Delete and ban this visitor</a><br>
One click, no login. Visitor key ${ip_hash.slice(0, 8)}…
</p></div>`;
	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
		body: JSON.stringify({
			from: env.MAIL_FROM,
			to: [env.NOTIFY_EMAIL],
			subject: `[aiinfra.blog] ${c.name} commented on ${c.slug}`,
			html,
			text: `${c.name} (${c.region ?? '?'}) on ${postUrl}\n\n${c.body}\n\nDelete: ${del}\nBan: ${ban}`,
		}),
	});
	if (!res.ok) console.error('resend failed', res.status, await res.text());
}
