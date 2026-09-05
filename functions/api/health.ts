/**
 * GET /api/health?t=<hmac>[&send=1]
 * Operator-only diagnostics: which bindings the function actually sees, a D1 round-trip,
 * and (with send=1) one test mail with Resend's raw status/body. Token = HMAC(MOD_SECRET, "health:ping").
 * Never returns secret values, only whether they are set.
 */
import { json, verifyAction, type Env } from '../../server/comments-lib';

type Ctx = { request: Request; env: Env };

export async function onRequestGet({ request, env }: Ctx) {
	const url = new URL(request.url);
	const token = url.searchParams.get('t') ?? '';
	if (!env.MOD_SECRET || !(await verifyAction(env.MOD_SECRET, 'health', 'ping', token))) return json({ error: 'forbidden' }, 403);

	const out: Record<string, unknown> = {
		env: {
			DB: Boolean(env.DB),
			ASSETS: Boolean(env.ASSETS),
			RESEND_API_KEY: Boolean(env.RESEND_API_KEY),
			NOTIFY_EMAIL: Boolean(env.NOTIFY_EMAIL),
			TURNSTILE_SECRET: Boolean(env.TURNSTILE_SECRET),
			MAIL_FROM: env.MAIL_FROM ?? null,
			ALLOWED_ORIGINS: env.ALLOWED_ORIGINS ?? null,
		},
	};
	try {
		const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM comments WHERE status = 'approved'`).first<{ n: number }>();
		out.db = { ok: true, approvedComments: row?.n ?? 0 };
	} catch (e) {
		out.db = { ok: false, error: String(e) };
	}

	if (url.searchParams.get('send') === '1') {
		if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) out.mail = { skipped: 'RESEND_API_KEY or NOTIFY_EMAIL missing' };
		else {
			try {
				const res = await fetch('https://api.resend.com/emails', {
					method: 'POST',
					headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
					body: JSON.stringify({
						from: env.MAIL_FROM,
						to: [env.NOTIFY_EMAIL],
						subject: '[aiinfra.blog] comments health check',
						text: `Test mail from ${url.origin} at ${new Date().toISOString()}. If you read this, notifications work.`,
					}),
				});
				out.mail = { status: res.status, body: (await res.text()).slice(0, 500) };
			} catch (e) {
				out.mail = { status: 0, error: String(e) };
			}
		}
	}
	return json(out);
}
