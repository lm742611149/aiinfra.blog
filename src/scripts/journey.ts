/**
 * Home page: one prompt followed through the whole stack as a scroll-driven 3D pipeline.
 *
 * Scroll position maps to a float `s` in [0, STEPS-1]. Station i sits on a glowing bus at
 * curve(i / (STEPS-1)); the camera and the request packet ease between stations and hold at
 * each one while its own animation (driven by the local progress around i) plays.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

type Step = { key: string; layer: string; title: string; body: string; term: string; stat: string; ms: number };

const AMBER = 0xf0b90b;
const GREEN = 0x0ecb81;
const BLUE = 0x5ab8ff;
const WHITE = 0xeaecef;
const LAYER_COLOR: Record<string, string> = { USER: '#eaecef', INFRA: '#f0b90b', AGENT: '#0ecb81', MODEL: '#5ab8ff', YOU: '#eaecef', ALL: '#c9a7ff' };

const SPACING = 19;
const PROMPT = 'My annual plan was charged twice. Can you refund one?';
const ANSWER =
	'Found it: your annual plan was billed twice on Sep 3. I refunded the duplicate $64. It will be back on your card within 3 business days.';

const FONT = '"Archivo", "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", "SF Mono", Menlo, monospace';

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => {
	const t = clamp((v - a) / (b - a));
	return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ------------------------------------------------------------------ */
/* Canvas-drawn text                                                   */
/* ------------------------------------------------------------------ */

function textSprite(
	text: string,
	opts: { size?: number; color?: string; font?: string; weight?: number; bg?: string; border?: string; pad?: number; mono?: boolean } = {},
) {
	const { size = 0.42, color = '#d6dbe1', weight = 600, bg, border, pad = 18, mono = false } = opts;
	const px = 64;
	const family = opts.font ?? (mono ? MONO : FONT);
	const c = document.createElement('canvas');
	const ctx = c.getContext('2d')!;
	ctx.font = `${weight} ${px}px ${family}`;
	const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
	const h = px + pad * 2;
	c.width = w;
	c.height = h;
	ctx.font = `${weight} ${px}px ${family}`;
	if (bg) {
		roundRect(ctx, 1, 1, w - 2, h - 2, h / 3.2);
		ctx.fillStyle = bg;
		ctx.fill();
		if (border) {
			ctx.lineWidth = 3;
			ctx.strokeStyle = border;
			ctx.stroke();
		}
	}
	ctx.fillStyle = color;
	ctx.textBaseline = 'middle';
	ctx.fillText(text, pad, h / 2 + 3);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 1 });
	const sp = new THREE.Sprite(mat);
	sp.scale.set((w / h) * size, size, 1);
	return sp;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
	const words = text.split(' ');
	const lines: string[] = [];
	let line = '';
	for (const w of words) {
		const t = line ? `${line} ${w}` : w;
		if (ctx.measureText(t).width > maxW && line) {
			lines.push(line);
			line = w;
		} else line = t;
	}
	if (line) lines.push(line);
	return lines;
}

/** A chat window drawn on a canvas; redrawn only when its text changes. */
class ChatPanel {
	canvas = document.createElement('canvas');
	ctx = this.canvas.getContext('2d')!;
	texture: THREE.CanvasTexture;
	mesh: THREE.Mesh;
	private last = '';

	constructor(
		private title: string,
		w = 7.2,
		h = 4.3,
	) {
		this.canvas.width = 1200;
		this.canvas.height = Math.round((1200 * h) / w);
		this.texture = new THREE.CanvasTexture(this.canvas);
		this.texture.colorSpace = THREE.SRGBColorSpace;
		this.texture.anisotropy = 8;
		const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false });
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
	}

	/** `compose` is the text in the input box (null = placeholder). */
	draw(user: string, reply: string, compose: string | null, status: string, caret = false) {
		const key = `${user}|${reply}|${compose}|${status}|${caret}`;
		if (key === this.last) return;
		this.last = key;
		const { ctx, canvas } = this;
		const W = canvas.width;
		const H = canvas.height;
		ctx.clearRect(0, 0, W, H);
		roundRect(ctx, 4, 4, W - 8, H - 8, 34);
		const g = ctx.createLinearGradient(0, 0, 0, H);
		g.addColorStop(0, 'rgba(22,27,34,0.96)');
		g.addColorStop(1, 'rgba(10,13,18,0.96)');
		ctx.fillStyle = g;
		ctx.fill();
		ctx.lineWidth = 3;
		ctx.strokeStyle = 'rgba(240,185,11,0.55)';
		ctx.stroke();
		// title bar
		['#f6465d', '#f0b90b', '#0ecb81'].forEach((c, i) => {
			ctx.beginPath();
			ctx.arc(44 + i * 34, 46, 10, 0, Math.PI * 2);
			ctx.fillStyle = c;
			ctx.globalAlpha = 0.8;
			ctx.fill();
			ctx.globalAlpha = 1;
		});
		ctx.font = `500 26px ${MONO}`;
		ctx.fillStyle = '#707a8a';
		ctx.fillText(this.title, 160, 55);
		ctx.textAlign = 'right';
		ctx.fillStyle = status.startsWith('●') ? '#0ecb81' : '#707a8a';
		ctx.fillText(status, W - 40, 55);
		ctx.textAlign = 'left';
		ctx.fillStyle = 'rgba(255,255,255,0.07)';
		ctx.fillRect(4, 88, W - 8, 2);

		let y = 150;
		if (user) {
			ctx.font = `600 38px ${FONT}`;
			const lines = wrap(ctx, user, W - 300);
			const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 56;
			const bh = lines.length * 52 + 34;
			roundRect(ctx, W - 40 - bw, y - 44, bw, bh, 26);
			ctx.fillStyle = 'rgba(240,185,11,0.16)';
			ctx.fill();
			ctx.strokeStyle = 'rgba(240,185,11,0.5)';
			ctx.lineWidth = 2;
			ctx.stroke();
			ctx.fillStyle = '#f5f6f7';
			lines.forEach((l, i) => ctx.fillText(l, W - 40 - bw + 28, y + i * 52));
			y += bh + 30;
		}
		if (reply) {
			ctx.font = `500 34px ${FONT}`;
			const lines = wrap(ctx, reply, W - 200);
			ctx.fillStyle = '#0ecb81';
			ctx.font = `600 24px ${MONO}`;
			ctx.fillText('ASSISTANT', 48, y - 6);
			ctx.font = `500 34px ${FONT}`;
			ctx.fillStyle = '#dfe3e8';
			lines.forEach((l, i) => ctx.fillText(l, 48, y + 46 + i * 48));
			y += 46 + lines.length * 48;
		}
		// composer
		const cy = H - 120;
		roundRect(ctx, 40, cy, W - 80, 80, 22);
		ctx.fillStyle = 'rgba(255,255,255,0.04)';
		ctx.fill();
		ctx.strokeStyle = 'rgba(255,255,255,0.12)';
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.font = `500 30px ${FONT}`;
		ctx.fillStyle = compose === null ? '#5e6673' : '#eaecef';
		const shown = compose ?? 'Message the assistant…';
		ctx.fillText(shown, 72, cy + 50);
		if (caret) {
			ctx.fillStyle = '#f0b90b';
			ctx.fillRect(76 + (compose ? ctx.measureText(compose).width : 0), cy + 22, 4, 38);
		}
		roundRect(ctx, W - 150, cy + 12, 96, 56, 16);
		ctx.fillStyle = '#f0b90b';
		ctx.fill();
		ctx.fillStyle = '#0b0e11';
		ctx.font = `700 26px ${FONT}`;
		ctx.fillText('↵', W - 113, cy + 50);
		this.texture.needsUpdate = true;
	}
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                          */
/* ------------------------------------------------------------------ */

function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(240,185,11,0.45)') {
	const c = document.createElement('canvas');
	c.width = c.height = 128;
	const ctx = c.getContext('2d')!;
	const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
	g.addColorStop(0, inner);
	g.addColorStop(0.25, mid);
	g.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 128, 128);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

const edges = (geo: THREE.BufferGeometry, color: number, opacity = 1) =>
	new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));

const glass = (color = 0x0d1218, opacity = 0.55) =>
	new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.35, transparent: true, opacity, depthWrite: false });

const emissive = (color: number, intensity = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false });

type Ctx = { local: number; focus: number; lit: number; time: number; dt: number };
type Station = { group: THREE.Group; update: (c: Ctx) => void; cam: [number, number, number]; look: [number, number, number] };

/** Fade every material in a group by `lit` (0 = ghosted wireframe, 1 = fully on). */
function registerFade(group: THREE.Object3D) {
	const mats: { m: THREE.Material & { opacity: number }; base: number }[] = [];
	group.traverse((o) => {
		const m = (o as THREE.Mesh).material as (THREE.Material & { opacity: number }) | undefined;
		if (m && !mats.some((x) => x.m === m)) {
			m.transparent = true;
			mats.push({ m, base: m.opacity ?? 1 });
		}
	});
	return (lit: number) => {
		for (const { m, base } of mats) m.opacity = base * (0.18 + 0.82 * lit);
	};
}

/* ------------------------------------------------------------------ */
/* Stations                                                             */
/* ------------------------------------------------------------------ */

function stationPrompt(chat: ChatPanel): Station {
	const g = new THREE.Group();
	const frame = new THREE.Mesh(new THREE.BoxGeometry(7.5, 4.6, 0.18), glass(0x0a0e13, 0.7));
	frame.position.z = -0.12;
	g.add(frame, edges(frame.geometry, AMBER, 0.5));
	chat.mesh.position.z = 0.0;
	g.add(chat.mesh);
	g.position.set(2.4, 1.2, 0);
	return {
		group: g,
		cam: [-0.4, 1.4, 10.6],
		look: [1.4, 1.0, 0],
		update: ({ time, local }) => {
			const typed = Math.floor(clamp((time - 0.9) * 24, 0, PROMPT.length));
			const sent = local > 0.56;
			const blink = Math.floor(time * 2.2) % 2 === 0;
			if (sent) chat.draw(PROMPT, '', null, '● sent');
			else chat.draw('', '', typed ? PROMPT.slice(0, typed) : null, 'assistant · ready', blink || typed < PROMPT.length);
			g.rotation.y = -0.24 + Math.sin(time * 0.4) * 0.03;
		},
	};
}

function stationGateway(): Station {
	const g = new THREE.Group();
	const rings: THREE.Mesh[] = [];
	[3.1, 2.55, 2.0].forEach((r, i) => {
		const m = new THREE.Mesh(new THREE.TorusGeometry(r, i === 0 ? 0.05 : 0.025, 12, 140), emissive(i === 1 ? WHITE : AMBER, i === 1 ? 0.7 : 1));
		m.rotation.y = Math.PI / 2;
		rings.push(m);
		g.add(m);
	});
	// segmented outer ring
	const segs = new THREE.Group();
	for (let i = 0; i < 48; i++) {
		const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.14), emissive(i % 6 === 0 ? AMBER : 0x39404a, 1));
		const a = (i / 48) * Math.PI * 2;
		b.position.set(0, Math.cos(a) * 3.6, Math.sin(a) * 3.6);
		b.rotation.x = -a;
		segs.add(b);
	}
	g.add(segs);
	const labels = ['TLS', 'AUTH', 'RATE LIMIT', 'ROUTE'].map((t, i) => {
		const s = textSprite(t, { size: 0.36, mono: true, color: '#f0b90b', bg: 'rgba(12,14,18,0.85)', border: 'rgba(240,185,11,0.6)' });
		const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
		s.position.set(0.4, Math.cos(a) * 4.4, Math.sin(a) * 4.4);
		g.add(s);
		return s;
	});
	const scan = new THREE.Mesh(new THREE.CircleGeometry(2.0, 64), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
	scan.rotation.y = Math.PI / 2;
	g.add(scan);
	const fade = registerFade(g);
	return {
		group: g,
		cam: [6.5, 1.6, 7.5],
		look: [-1, 0.2, 0],
		update: ({ time, lit, focus, local }) => {
			fade(lit);
			rings[0].rotation.x = time * 0.25;
			rings[1].rotation.z = time * 0.5;
			rings[2].rotation.x = -time * 0.8;
			segs.rotation.x = time * 0.15;
			const pulse = Math.exp(-Math.pow((local - 0.5) * 6, 2));
			(scan.material as THREE.MeshBasicMaterial).opacity = 0.05 + pulse * 0.35;
			scan.scale.setScalar(1 + pulse * 0.5);
			labels.forEach((l, i) => (l.material.opacity = clamp(focus * 1.4 - i * 0.12)));
		},
	};
}

function stationAgent(): Station {
	const g = new THREE.Group();
	const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), new THREE.MeshBasicMaterial({ color: GREEN, wireframe: true, transparent: true, opacity: 0.85, toneMapped: false }));
	const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 3), emissive(GREEN, 1.4));
	g.add(core, inner);
	const orbit = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.018, 8, 160), emissive(GREEN, 0.6));
	orbit.rotation.x = Math.PI / 2.3;
	g.add(orbit);
	const nodes = ['PLAN', 'ACT', 'OBSERVE'].map((t) => {
		const n = new THREE.Group();
		const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 24), emissive(WHITE, 1.2));
		const lab = textSprite(t, { size: 0.34, mono: true, color: '#0ecb81', bg: 'rgba(8,16,12,0.85)', border: 'rgba(14,203,129,0.6)' });
		lab.position.y = 0.55;
		n.add(ball, lab);
		g.add(n);
		return n;
	});
	const chips = ['system prompt', 'memory', 'tool schemas'].map((t, i) => {
		const s = textSprite(t, { size: 0.32, mono: true, color: '#b7bdc6', bg: 'rgba(14,18,24,0.9)', border: 'rgba(255,255,255,0.18)' });
		s.position.set(-2.8 + i * 2.8, 3.4, -0.6);
		g.add(s);
		return s;
	});
	const beams = new THREE.Group();
	chips.forEach((c) => {
		const geo = new THREE.BufferGeometry().setFromPoints([c.position.clone().add(new THREE.Vector3(0, -0.25, 0)), new THREE.Vector3(0, 0.9, 0)]);
		beams.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.35 })));
	});
	g.add(beams);
	g.position.y = 1.0;
	const fade = registerFade(g);
	return {
		group: g,
		cam: [0, 3.6, 10],
		look: [0, 1.3, 0],
		update: ({ time, lit, local }) => {
			fade(lit);
			core.rotation.y = time * 0.4;
			core.rotation.x = time * 0.23;
			inner.scale.setScalar(1 + Math.sin(time * 3) * 0.06);
			nodes.forEach((n, i) => {
				const a = time * 0.9 + (i * Math.PI * 2) / 3;
				const v = new THREE.Vector3(Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6).applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2.3 - Math.PI / 2);
				n.position.copy(v);
			});
			chips.forEach((c, i) => (c.position.y = 3.4 - (1 - smooth(i * 0.15, 0.4 + i * 0.15, local)) * 1.2 + Math.sin(time + i) * 0.06));
		},
	};
}

function stationRetrieval(): Station {
	const g = new THREE.Group();
	const N = 1400;
	const pos = new Float32Array(N * 3);
	const col = new Float32Array(N * 3);
	const pts: THREE.Vector3[] = [];
	for (let i = 0; i < N; i++) {
		// a few clusters, like topics in a knowledge base
		const k = i % 5;
		const cx = [-2.2, 1.8, 0.2, -0.6, 2.4][k];
		const cy = [0.6, 1.4, -0.4, 2.2, -0.2][k];
		const cz = [0.4, -1.0, 1.2, -0.6, 0.9][k];
		const r = Math.pow(Math.random(), 0.6) * 1.5;
		const th = Math.random() * Math.PI * 2;
		const ph = Math.acos(2 * Math.random() - 1);
		const v = new THREE.Vector3(cx + r * Math.sin(ph) * Math.cos(th), cy + r * Math.cos(ph) * 0.7, cz + r * Math.sin(ph) * Math.sin(th));
		pts.push(v);
		pos.set([v.x, v.y, v.z], i * 3);
		const c = new THREE.Color(k === 2 ? GREEN : [0x2f8f6c, 0x4f6f9a, 0x6a5aa8, 0x3b7f8f][k % 4]).multiplyScalar(0.7 + Math.random() * 0.7);
		col.set([c.r, c.g, c.b], i * 3);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	const cloud = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.13, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTexture('rgba(255,255,255,1)', 'rgba(120,255,200,0.5)') }));
	g.add(cloud);
	const q = new THREE.Vector3(0.4, -0.2, 1.0);
	const query = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), emissive(WHITE, 1.5));
	query.position.copy(q);
	g.add(query);
	const near = pts
		.map((p, i) => ({ i, d: p.distanceTo(q) }))
		.sort((a, b) => a.d - b.d)
		.slice(0, 6)
		.map((x) => pts[x.i]);
	const links = near.map((p) => {
		const geo2 = new THREE.BufferGeometry().setFromPoints([q, p]);
		const l = new THREE.Line(geo2, new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0 }));
		g.add(l);
		const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), emissive(GREEN, 1.6));
		dot.position.copy(p);
		g.add(dot);
		return { l, dot };
	});
	const qlab = textSprite('embed("charged twice refund")', { size: 0.3, mono: true, color: '#eaecef', bg: 'rgba(12,14,18,0.88)', border: 'rgba(255,255,255,0.25)' });
	qlab.position.set(q.x, q.y - 0.6, q.z + 0.3);
	const hit = textSprite('top-k: refund-policy §3 · billing-faq §7', { size: 0.3, mono: true, color: '#0ecb81', bg: 'rgba(8,16,12,0.88)', border: 'rgba(14,203,129,0.6)' });
	hit.position.set(0.6, 3.6, 0);
	g.add(qlab, hit);
	g.position.y = 0.6;
	const fade = registerFade(g);
	return {
		group: g,
		cam: [-2.6, 2.2, 7.4],
		look: [0.2, 1.1, 0],
		update: ({ time, lit, local }) => {
			fade(lit);
			cloud.rotation.y = Math.sin(time * 0.15) * 0.25;
			links.forEach(({ l, dot }, i) => {
				const on = smooth(0.15 + i * 0.07, 0.3 + i * 0.07, local);
				(l.material as THREE.LineBasicMaterial).opacity = on * 0.9;
				dot.scale.setScalar(0.4 + on * (1 + Math.sin(time * 5 + i) * 0.2));
			});
			hit.material.opacity = smooth(0.55, 0.75, local) * lit;
			query.rotation.y = time * 1.5;
		},
	};
}

const TOKENS = ['<sys>', 'You', ' are', ' a', ' billing', ' agent', '…', '<ctx>', 'refund', ' policy', '…', '<user>', 'My', ' annual', ' plan', ' was', ' charged', ' twice', '.', ' Can', ' you', ' refund', ' one', '?'];
const TOKEN_IDS = [1, 2675, 527, 264, 33531, 8479, 1131, 3, 75428, 4947, 1131, 4, 5159, 9974, 3197, 574, 11684, 11157, 13, 3053, 499, 21639, 832, 30];

function stationTokenizer(): Station {
	const g = new THREE.Group();
	const blocks: { m: THREE.Group; target: THREE.Vector3; start: THREE.Vector3 }[] = [];
	const width = 0.62;
	const total = TOKENS.length;
	TOKENS.forEach((t, i) => {
		const kind = t.startsWith('<') ? 'tag' : i < 7 ? 'sys' : i < 11 ? 'ctx' : 'user';
		const color = kind === 'tag' ? WHITE : kind === 'sys' ? AMBER : kind === 'ctx' ? GREEN : BLUE;
		const m = new THREE.Group();
		const box = new THREE.Mesh(new THREE.BoxGeometry(width * 0.86, 0.7, 0.5), glass(0x0c1118, 0.75));
		m.add(box, edges(box.geometry, color, 0.9));
		const lab = textSprite(t.trim() || '·', { size: 0.2, mono: true, color: '#eaecef', pad: 8 });
		lab.position.set(0, 0.07, 0.27);
		const id = textSprite(String(TOKEN_IDS[i]), { size: 0.14, mono: true, color: new THREE.Color(color).getStyle(), pad: 6 });
		id.position.set(0, -0.2, 0.27);
		m.add(lab, id);
		const row = Math.floor(i / 12);
		const colI = i % 12;
		const target = new THREE.Vector3((colI - 5.5) * width, 1.9 - row * 1.0, 0);
		// Tokens pop out of the request packet, which sits on the bus just below the window.
		const start = new THREE.Vector3(-0.2, -0.1, 0.4);
		m.position.copy(start);
		g.add(m);
		blocks.push({ m, target, start });
	});
	const win = new THREE.Mesh(new THREE.BoxGeometry(12 * width + 0.5, 2.3, 0.9), new THREE.MeshBasicMaterial({ visible: false }));
	win.position.set(0, 1.4, 0);
	const winEdges = edges(win.geometry, BLUE, 0.55);
	winEdges.position.copy(win.position);
	g.add(winEdges);
	const lab = textSprite('CONTEXT WINDOW · 24 / 128,000 tokens', { size: 0.3, mono: true, color: '#5ab8ff' });
	lab.position.set(0, 2.95, 0);
	g.add(lab);
	const legend = textSprite('system · retrieved · user', { size: 0.24, mono: true, color: '#848e9c' });
	legend.position.set(0, -0.15, 0.4);
	g.add(legend);
	const fade = registerFade(g);
	return {
		group: g,
		cam: [0, 2.6, 9.6],
		look: [0, 1.3, 0],
		update: ({ time, lit, local }) => {
			fade(lit);
			blocks.forEach((b, i) => {
				const t = smooth(0.05 + (i / total) * 0.55, 0.25 + (i / total) * 0.55, local);
				b.m.position.lerpVectors(b.start, b.target, t);
				b.m.position.y += Math.sin(t * Math.PI) * 0.9 + Math.sin(time * 2 + i * 0.5) * 0.02 * t;
				b.m.scale.setScalar(0.05 + 0.95 * t);
				b.m.visible = t > 0.001;
				b.m.rotation.x = (1 - t) * 2.4;
			});
		},
	};
}

function stationScheduler(): Station {
	const g = new THREE.Group();
	// incoming request lanes
	const lanes: THREE.Mesh[] = [];
	for (let lane = 0; lane < 5; lane++) {
		for (let k = 0; k < 6; k++) {
			const ours = lane === 2 && k === 0;
			const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.32), ours ? emissive(AMBER, 1.6) : emissive(0x2c3440, 1));
			m.userData = { lane, k, ours };
			lanes.push(m);
			g.add(m);
		}
	}
	// batch slots
	const slots: THREE.Mesh[] = [];
	for (let r = 0; r < 4; r++)
		for (let c = 0; c < 8; c++) {
			const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.06), emissive(AMBER, 1));
			m.position.set(1.0 + c * 0.52, 0.4 + r * 0.52, -0.4);
			slots.push(m);
			g.add(m);
		}
	const batchFrame = edges(new THREE.BoxGeometry(4.4, 2.3, 0.3), AMBER, 0.6);
	batchFrame.position.set(1.0 + 3.5 * 0.52, 0.4 + 1.5 * 0.52, -0.4);
	g.add(batchFrame);
	// KV-cache pages on the floor
	const pages: THREE.Mesh[] = [];
	for (let r = 0; r < 6; r++)
		for (let c = 0; c < 16; c++) {
			const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0x1b2129, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
			m.rotation.x = -Math.PI / 2;
			m.position.set(-3.6 + c * 0.36, -0.7, 0.6 + r * 0.36);
			pages.push(m);
			g.add(m);
		}
	const l1 = textSprite('CONTINUOUS BATCHING', { size: 0.3, mono: true, color: '#f0b90b' });
	l1.position.set(2.8, 2.9, -0.4);
	const l2 = textSprite('PAGED KV CACHE', { size: 0.3, mono: true, color: '#f0b90b' });
	l2.position.set(-0.8, -0.2, 3.2);
	const l3 = textSprite('request queue', { size: 0.26, mono: true, color: '#848e9c' });
	l3.position.set(-3.8, 1.9, 0);
	g.add(l1, l2, l3);
	g.position.y = 0.2;
	const fade = registerFade(g);
	const seed = Array.from({ length: 96 }, () => Math.random());
	return {
		group: g,
		cam: [1.8, 5.6, 9.2],
		look: [0, 0.6, 0.4],
		update: ({ time, lit, local }) => {
			fade(lit);
			lanes.forEach((m) => {
				const { lane, k, ours } = m.userData as { lane: number; k: number; ours: boolean };
				const speed = 0.5 + lane * 0.13;
				let x = -5.5 + (((time * speed + k * 0.9 + lane * 0.37) % 5.4) + 5.4) % 5.4;
				if (ours) x = lerp(-5.2, 0.6, smooth(0.1, 0.6, local));
				m.position.set(x, 0.5 + lane * 0.42 - 0.2, -0.4);
				m.visible = ours || x < 0.6;
			});
			slots.forEach((m, i) => {
				const on = (Math.sin(time * (0.8 + seed[i] * 1.4) + seed[i] * 20) + 1) / 2 > 0.35;
				const ours = i === 10 && local > 0.6;
				(m.material as THREE.MeshBasicMaterial).color.setHex(ours ? 0xffffff : on ? AMBER : 0x232a33);
				m.scale.setScalar(ours ? 1.15 : 1);
			});
			const filled = Math.floor(smooth(0.5, 0.95, local) * 9);
			pages.forEach((m, i) => {
				const ours = i >= 20 && i < 20 + filled;
				const busy = seed[i % 96] > 0.62;
				(m.material as THREE.MeshBasicMaterial).color.setHex(ours ? AMBER : busy ? 0x3b3216 : 0x1b2129);
			});
		},
	};
}

function stationGPU(): Station {
	const g = new THREE.Group();
	const boards: THREE.Group[] = [];
	const strips: THREE.Mesh[] = [];
	for (let i = 0; i < 8; i++) {
		const b = new THREE.Group();
		const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.26, 1.7), new THREE.MeshStandardMaterial({ color: 0x14181e, metalness: 0.7, roughness: 0.35 }));
		b.add(body, edges(body.geometry, 0x3a424d, 0.9));
		for (let s = 0; s < 5; s++) {
			const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 1.5), emissive(AMBER, 1));
			strip.position.set(-1.2 + s * 0.45, 0.15, 0);
			b.add(strip);
			strips.push(strip);
		}
		const hbm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), emissive(BLUE, 0.9));
		hbm.position.set(1.15, 0.15, 0);
		b.add(hbm);
		const label = textSprite(`GPU ${i}`, { size: 0.2, mono: true, color: '#848e9c', pad: 6 });
		label.position.set(-2.15, 0, 0.9);
		b.add(label);
		b.position.y = i * 0.5;
		boards.push(b);
		g.add(b);
	}
	const rack = edges(new THREE.BoxGeometry(3.9, 4.4, 2.1), 0x4b525d, 0.8);
	rack.position.y = 1.75;
	g.add(rack);
	// NVLink rails with moving packets
	const rails: THREE.Mesh[] = [];
	for (let k = 0; k < 2; k++) {
		const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 3.7, 0.05), emissive(0x2b3139, 1));
		r.position.set(2.1 + k * 0.25, 1.75, 0.5);
		g.add(r);
		for (let j = 0; j < 5; j++) {
			const p = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), emissive(AMBER, 2));
			p.userData = { k, j };
			rails.push(p);
			g.add(p);
		}
	}
	const l1 = textSprite('8 × GPU · TENSOR PARALLEL', { size: 0.3, mono: true, color: '#f0b90b' });
	l1.position.set(0, 4.5, 0);
	const l2 = textSprite('HBM → SM  ~3 TB/s', { size: 0.26, mono: true, color: '#5ab8ff' });
	l2.position.set(3.2, 2.9, 0.6);
	const l3 = textSprite('NVLink', { size: 0.24, mono: true, color: '#848e9c' });
	l3.position.set(2.9, 0.1, 0.6);
	g.add(l1, l2, l3);
	g.position.set(0, -0.6, -0.6);
	const fade = registerFade(g);
	return {
		group: g,
		cam: [-5.2, 0.6, 7.6],
		look: [0.3, 1.5, 0],
		update: ({ time, lit, local }) => {
			fade(lit);
			const heat = 0.4 + smooth(0.1, 0.5, local) * 0.9;
			strips.forEach((s, i) => {
				const v = heat * (0.6 + 0.4 * Math.sin(time * 6 + i * 0.7));
				(s.material as THREE.MeshBasicMaterial).color.setRGB(0.94 * v * 1.4, 0.73 * v * 1.4, 0.04 * v);
			});
			boards.forEach((b, i) => (b.position.x = Math.sin(time * 1.2 + i) * 0.015));
			rails.forEach((p) => {
				const { k, j } = p.userData as { k: number; j: number };
				const y = ((time * (0.9 + k * 0.4) + j / 5) % 1) * 3.6;
				p.position.set(2.1 + k * 0.25, k ? 3.6 - y : y, 0.5);
			});
		},
	};
}

function stationTransformer(): Station {
	const g = new THREE.Group();
	const LAYERS = 12;
	const slabs: THREE.Mesh[] = [];
	for (let i = 0; i < LAYERS; i++) {
		const m = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.06, 3.2), new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false }));
		m.position.y = i * 0.55;
		const e = edges(m.geometry, BLUE, 0.45);
		e.position.y = m.position.y;
		slabs.push(m);
		g.add(m, e);
	}
	// token pillars
	const COLS = 7;
	const pillars: THREE.Mesh[] = [];
	for (let c = 0; c < COLS; c++) {
		const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, LAYERS * 0.55, 8), emissive(c === COLS - 1 ? WHITE : BLUE, c === COLS - 1 ? 1.2 : 0.6));
		p.position.set(-2.4 + c * 0.8, (LAYERS - 1) * 0.275, 0);
		pillars.push(p);
		g.add(p);
	}
	// rising pulse plane
	const pulse = new THREE.Mesh(new THREE.BoxGeometry(6.3, 0.09, 3.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(BLUE).multiplyScalar(1.6), transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }));
	g.add(pulse);
	// attention arcs from the newest token to the others
	const arcs = Array.from({ length: COLS - 1 }, (_, c) => {
		const geo = new THREE.BufferGeometry();
		const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: WHITE, transparent: true, opacity: 0.6 }));
		l.userData = { c, w: [0.9, 0.25, 0.4, 0.15, 0.7, 0.55][c] };
		g.add(l);
		return l;
	});
	const labs = [
		{ t: 'EMBEDDING', y: 0.15 },
		{ t: 'SELF-ATTENTION + MLP  × 32', y: 3.1 },
		{ t: 'LOGITS', y: LAYERS * 0.55 + 0.2 },
	].map(({ t, y }) => {
		const s = textSprite(t, { size: 0.3, mono: true, color: '#5ab8ff' });
		s.position.set(3.9, y, 0.4);
		g.add(s);
		return s;
	});
	const vec = textSprite('"refund"  →  [ 0.12, −0.87, 0.33, 0.05, … 8,192 numbers ]', { size: 0.3, mono: true, color: '#eaecef', bg: 'rgba(10,18,28,0.92)', border: 'rgba(90,184,255,0.6)' });
	vec.position.set(-3.6, 4.7, 0.6);
	g.add(vec);
	const phase = textSprite('PREFILL', { size: 0.34, mono: true, color: '#eaecef', bg: 'rgba(10,18,28,0.9)', border: 'rgba(90,184,255,0.7)' });
	phase.position.set(-4.4, 5.6, 0);
	g.add(phase);
	g.position.set(0, -1.4, -1.4);
	const fade = registerFade(g);
	return {
		group: g,
		cam: [6.4, -0.6, 10.5],
		look: [-0.5, 2.6, -1],
		update: ({ time, lit, local }) => {
			fade(lit);
			const h = ((local * 2.2 + time * 0.12) % 1) * (LAYERS - 1) * 0.55;
			pulse.position.y = h;
			(pulse.material as THREE.MeshBasicMaterial).opacity = 0.25 + lit * 0.45;
			slabs.forEach((s) => {
				const d = Math.abs(s.position.y - h);
				(s.material as THREE.MeshBasicMaterial).opacity = (0.05 + Math.max(0, 0.35 - d * 0.5)) * (0.3 + lit * 0.7);
			});
			const from = pillars[COLS - 1].position;
			arcs.forEach((l) => {
				const { c, w } = l.userData as { c: number; w: number };
				const to = pillars[c].position;
				const a = new THREE.Vector3(from.x, h, 0);
				const b = new THREE.Vector3(to.x, h, 0);
				const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.4 + Math.abs(a.x - b.x) * 0.22, 0.2));
				const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
				l.geometry.setFromPoints(curve.getPoints(24));
				(l.material as THREE.LineBasicMaterial).opacity = w * (0.5 + 0.5 * Math.sin(time * 4 + c)) * lit;
			});
			pillars.forEach((p, i) => p.scale.set(1, 1, 1 + Math.sin(time * 3 + i) * 0.1));
			labs.forEach((l) => (l.material.opacity = lit));
			const decode = local > 0.6;
			if (phase.userData.decode !== decode) {
				phase.userData.decode = decode;
				const fresh = textSprite(decode ? 'DECODE · 1 token / step' : 'PREFILL · whole prompt', {
					size: 0.34,
					mono: true,
					color: '#eaecef',
					bg: 'rgba(10,18,28,0.9)',
					border: 'rgba(90,184,255,0.7)',
				});
				phase.material.map?.dispose();
				phase.material.map = fresh.material.map;
				phase.scale.copy(fresh.scale);
				phase.material.needsUpdate = true;
			}
			phase.material.opacity = lit;
			vec.material.opacity = smooth(0.05, 0.25, local) * lit;
		},
	};
}

const CANDS = [
	{ t: 'Found', p: 0.46 },
	{ t: 'I', p: 0.17 },
	{ t: 'Sorry', p: 0.11 },
	{ t: 'Yes', p: 0.08 },
	{ t: 'Let', p: 0.06 },
	{ t: 'The', p: 0.05 },
	{ t: 'Your', p: 0.04 },
	{ t: 'We', p: 0.03 },
];

function stationSampling(): Station {
	const g = new THREE.Group();
	const bars = CANDS.map((c, i) => {
		const m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1, 0.55), i === 0 ? emissive(GREEN, 1.3) : new THREE.MeshStandardMaterial({ color: 0x1d2a38, emissive: new THREE.Color(BLUE).multiplyScalar(0.25), metalness: 0.3, roughness: 0.4, transparent: true }));
		m.position.set(-2.8 + i * 0.8, 0, 0);
		const e = edges(m.geometry, i === 0 ? GREEN : BLUE, 0.7);
		m.add(e);
		const lab = textSprite(c.t, { size: 0.26, mono: true, color: i === 0 ? '#0ecb81' : '#b7bdc6', pad: 8 });
		lab.position.set(m.position.x, -0.35, 0.5);
		const pct = textSprite(`${Math.round(c.p * 100)}%`, { size: 0.2, mono: true, color: '#848e9c', pad: 6 });
		g.add(m, lab, pct);
		return { m, pct, p: c.p };
	});
	const l1 = textSprite('softmax · temperature 0.7 · top-p 0.9', { size: 0.28, mono: true, color: '#5ab8ff' });
	l1.position.set(0, 3.9, 0);
	g.add(l1);
	const chosen = textSprite('next token → "Found"', { size: 0.32, mono: true, color: '#0b0e11', bg: '#0ecb81' });
	chosen.position.set(0, 3.2, 0.6);
	g.add(chosen);
	// autoregressive loop arc back toward the transformer
	const loopCurve = new THREE.CubicBezierCurve3(new THREE.Vector3(-3.2, 2.4, 0), new THREE.Vector3(-8, 7, -1), new THREE.Vector3(-15, 7, -2), new THREE.Vector3(-18.5, 5.2, -1.4));
	const loop = new THREE.Mesh(new THREE.TubeGeometry(loopCurve, 80, 0.025, 6, false), emissive(GREEN, 0.8));
	g.add(loop);
	const runners = Array.from({ length: 6 }, (_, i) => {
		const r = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), emissive(GREEN, 2));
		r.userData.o = i / 6;
		g.add(r);
		return r;
	});
	const WORDS = ['Found', ' it:', ' your', ' annual', ' plan', ' was', ' billed', ' twice', '…'];
	const sentences = WORDS.map((_, k) => {
		const sp = textSprite(WORDS.slice(0, k + 1).join(''), { size: 0.34, color: '#eaecef', bg: 'rgba(8,16,12,0.9)', border: 'rgba(14,203,129,0.55)' });
		sp.position.set(0, -1.15, 0.8);
		sp.visible = false;
		g.add(sp);
		return sp;
	});
	const loopLab = textSprite('decode loop ↺  run the whole model again for every word', { size: 0.26, mono: true, color: '#0ecb81' });
	loopLab.position.set(-9, 7.4, -1);
	g.add(loopLab);
	g.position.y = 0;
	const fade = registerFade(g);
	return {
		group: g,
		cam: [0.4, 2.8, 9.6],
		look: [-0.6, 1.6, 0],
		update: ({ time, lit, local }) => {
			fade(lit);
			const grow = smooth(0.05, 0.45, local);
			bars.forEach(({ m, pct, p }, i) => {
				const h = 0.05 + p * 5.2 * grow;
				m.scale.y = h;
				m.position.y = h / 2;
				pct.position.set(m.position.x, h + 0.25, 0);
				if (i === 0) m.scale.x = m.scale.z = 1 + smooth(0.5, 0.7, local) * 0.2 * (1 + Math.sin(time * 6) * 0.3);
			});
			chosen.material.opacity = smooth(0.5, 0.65, local) * lit;
			const k = Math.min(WORDS.length - 1, Math.floor(smooth(0.55, 0.98, local) * WORDS.length));
			sentences.forEach((sp, j) => {
				sp.visible = local > 0.55 && j === k;
				sp.material.opacity = lit;
			});
			runners.forEach((r) => {
				const u = (r.userData.o + time * 0.35) % 1;
				r.position.copy(loopCurve.getPointAt(u));
				r.visible = local > 0.55;
			});
		},
	};
}

function stationTool(): Station {
	const g = new THREE.Group();
	const call = textSprite('{"tool":"list_invoices","args":{"customer":"C007"}}', { size: 0.3, mono: true, color: '#0ecb81', bg: 'rgba(8,16,12,0.92)', border: 'rgba(14,203,129,0.7)' });
	call.position.set(0, 3.2, 0);
	g.add(call);
	// database
	const db = new THREE.Group();
	for (let i = 0; i < 3; i++) {
		const c = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.42, 48, 1, true), glass(0x0b1712, 0.8));
		c.position.y = i * 0.5;
		db.add(c, edges(new THREE.CylinderGeometry(0.9, 0.9, 0.42, 24, 1, true), GREEN, 0.7).translateY(i * 0.5));
	}
	const cap = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), emissive(GREEN, 0.5));
	cap.rotation.x = -Math.PI / 2;
	cap.position.y = 1.22;
	db.add(cap);
	db.position.set(4.4, -0.2, -3.6);
	g.add(db);
	const dblab = textSprite('billing DB', { size: 0.28, mono: true, color: '#848e9c' });
	dblab.position.set(4.4, 1.7, -3.6);
	g.add(dblab);
	const out = new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.5, 0, -0.5), new THREE.Vector3(3.5, 0.6, -3.0), new THREE.Vector3(4.4, 0.5, -3.6));
	const tube = new THREE.Mesh(new THREE.TubeGeometry(out, 60, 0.03, 6, false), emissive(GREEN, 0.9));
	g.add(tube);
	const pk = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), emissive(WHITE, 2));
	g.add(pk);
	const obs = textSprite('observation: INV-2290 $64 paid · INV-2291 $64 paid', { size: 0.28, mono: true, color: '#eaecef', bg: 'rgba(14,18,24,0.92)', border: 'rgba(255,255,255,0.3)' });
	obs.position.set(1.6, 2.2, -1.6);
	g.add(obs);
	const fade = registerFade(g);
	return {
		group: g,
		cam: [-1.8, 4.6, 10.4],
		look: [1.4, 0.9, -1.4],
		update: ({ time, lit, local }) => {
			fade(lit);
			const go = smooth(0.15, 0.5, local);
			const back = smooth(0.55, 0.85, local);
			const u = back > 0 ? 1 - back : go;
			pk.position.copy(out.getPointAt(clamp(u)));
			pk.visible = local > 0.12 && local < 0.88;
			call.material.opacity = smooth(0.0, 0.15, local) * lit;
			obs.material.opacity = smooth(0.6, 0.75, local) * lit;
			db.rotation.y = time * 0.3;
		},
	};
}

function stationStream(chat: ChatPanel): Station {
	const g = new THREE.Group();
	const frame = new THREE.Mesh(new THREE.BoxGeometry(7.5, 4.6, 0.18), glass(0x0a0e13, 0.7));
	frame.position.z = -0.12;
	g.add(frame, edges(frame.geometry, GREEN, 0.55));
	g.add(chat.mesh);
	const metrics = [
		{ t: 'TTFT  320 ms', x: -2.6 },
		{ t: 'TPOT  24 ms', x: 0 },
		{ t: 'SSE  text/event-stream', x: 2.8 },
	].map(({ t, x }) => {
		const s = textSprite(t, { size: 0.26, mono: true, color: '#0ecb81', bg: 'rgba(8,16,12,0.88)', border: 'rgba(14,203,129,0.5)' });
		s.position.set(x, -2.85, 0.2);
		g.add(s);
		return s;
	});
	g.position.set(0, 1.2, 0);
	return {
		group: g,
		cam: [0.8, 1.4, 9.6],
		look: [-0.6, 1.0, 0],
		update: ({ local, lit, time }) => {
			const n = Math.floor(smooth(0.08, 0.8, local) * ANSWER.length);
			const status = n >= ANSWER.length ? '✓ done · 41 tokens' : n > 0 ? '● streaming' : 'waiting for first token';
			chat.draw(PROMPT, ANSWER.slice(0, n), null, status);
			metrics.forEach((m, i) => (m.material.opacity = smooth(0.1 + i * 0.12, 0.25 + i * 0.12, local) * lit));
			g.rotation.y = 0.12 + Math.sin(time * 0.4) * 0.03;
		},
	};
}

function stationRecap(): Station {
	const g = new THREE.Group();
	const layers = [
		{ r: 1.1, color: BLUE, name: 'MODEL', line: 'the brain · predicts the next word' },
		{ r: 2.3, color: GREEN, name: 'AGENT', line: 'the hands · memory, lookups, tools' },
		{ r: 3.5, color: AMBER, name: 'INFRA', line: 'the factory · chips, queues, cables' },
	].map(({ r, color, name, line }, i) => {
		const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 12, 180), emissive(color, 1.4));
		const disc = new THREE.Mesh(new THREE.RingGeometry(r - 1.1, r, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
		const n = textSprite(name, { size: 0.38, mono: true, color: new THREE.Color(color).getStyle(), weight: 700 });
		const l = textSprite(line, { size: 0.24, mono: true, color: '#b7bdc6' });
		// Legend in a left-aligned column to the right, tied to its ring by a short leader.
		const y = 1.5 - i * 1.5;
		n.center.set(0, 0.5);
		l.center.set(0, 0.5);
		n.position.set(4.6, y + 0.22, 0.1);
		l.position.set(4.6, y - 0.2, 0.1);
		const ang = Math.asin(clamp(y / r, -1, 1));
		const from = new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r, 0);
		const lead = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, new THREE.Vector3(4.45, y, 0)]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }));
		const grp = new THREE.Group();
		grp.add(ring, disc, lead);
		g.add(grp, n, l);
		return { grp, ring, n, l, i };
	});
	const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 2), emissive(0xffffff, 1.1));
	g.add(core);
	const q = textSprite('your question  →  1.8 s  →  your answer', { size: 0.3, mono: true, color: '#eaecef', bg: 'rgba(14,12,22,0.9)', border: 'rgba(201,167,255,0.6)' });
	q.position.set(0, -4.4, 0.2);
	g.add(q);
	g.position.y = 1.6;
	return {
		group: g,
		cam: [1.6, 1.2, 12.5],
		look: [2.2, 1.0, 0],
		update: ({ time, lit, local }) => {
			layers.forEach(({ grp, ring, n, l, i }) => {
				const on = smooth(0.08 + i * 0.16, 0.3 + i * 0.16, local);
				grp.scale.setScalar(0.6 + on * 0.4);
				grp.rotation.z = Math.sin(time * 0.3 + i) * 0.04;
				(ring.material as THREE.MeshBasicMaterial).opacity = on * lit;
				n.material.opacity = on * lit;
				l.material.opacity = on * lit;
				ring.rotation.x = Math.sin(time * 0.5 + i * 1.3) * 0.25;
			});
			core.rotation.y = time * 0.6;
			core.scale.setScalar(1 + Math.sin(time * 3) * 0.05);
			q.material.opacity = smooth(0.6, 0.8, local) * lit;
		},
	};
}

function stationChoose(): Station {
	const g = new THREE.Group();
	const portals = [
		{ x: -3.4, color: AMBER },
		{ x: 3.4, color: GREEN },
	].map(({ x, color }) => {
		const p = new THREE.Group();
		const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.06, 16, 160), emissive(color, 1.6));
		const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.015, 8, 160), emissive(color, 0.8));
		p.add(ring, ring2);
		const N = 900;
		const pos = new Float32Array(N * 3);
		for (let i = 0; i < N; i++) {
			const r = Math.sqrt(Math.random()) * 2.1;
			const a = Math.random() * Math.PI * 2;
			pos.set([Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 0.6], i * 3);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		const swirl = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.05, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
		p.add(swirl);
		p.position.set(x, 1.4, 0);
		g.add(p);
		return { p, ring, ring2, swirl };
	});
	return {
		group: g,
		cam: [0, 1.4, 12.5],
		look: [0, 1.4, 0],
		update: ({ time, lit }) => {
			portals.forEach(({ ring, ring2, swirl }, i) => {
				ring.rotation.z = time * (i ? -0.3 : 0.3);
				ring2.rotation.x = Math.sin(time * 0.6 + i) * 0.4;
				swirl.rotation.z = time * (i ? -0.6 : 0.6);
				const s = 0.6 + lit * 0.4;
				ring.scale.setScalar(s);
				ring2.scale.setScalar(s);
				swirl.scale.setScalar(s);
			});
		},
	};
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

function webglOK() {
	try {
		const c = document.createElement('canvas');
		return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
	} catch {
		return false;
	}
}

export function startJourney() {
	const root = document.querySelector<HTMLElement>('[data-journey]');
	const canvas = document.querySelector<HTMLCanvasElement>('[data-gl]');
	const stepsEl = document.getElementById('journey-steps');
	if (!root || !canvas || !stepsEl) return;
	const STEPS: Step[] = JSON.parse(stepsEl.textContent || '[]');
	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (reduced || !webglOK()) {
		document.documentElement.classList.add('journey-static');
		return;
	}
	const fontsReady = (document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve();
	fontsReady.then(() => build(root, canvas, STEPS)).catch(() => document.documentElement.classList.add('journey-static'));
}

function build(root: HTMLElement, canvas: HTMLCanvasElement, STEPS: Step[]) {
	const N = STEPS.length;
	const mobile = window.matchMedia('(max-width: 760px)').matches;

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
	let dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
	renderer.setPixelRatio(dpr);
	renderer.setClearColor(0x04060a, 1);
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	const scene = new THREE.Scene();
	// Set the backdrop on the scene, not as the clear colour: the composer's render target
	// would otherwise get the sRGB value and OutputPass would encode it a second time.
	scene.background = new THREE.Color(0x04060a);
	scene.fog = new THREE.FogExp2(0x04060a, 0.028);
	const camera = new THREE.PerspectiveCamera(mobile ? 62 : 45, 1, 0.1, 400);

	scene.add(new THREE.AmbientLight(0x8899aa, 0.55));
	const key = new THREE.DirectionalLight(0xffffff, 0.9);
	key.position.set(5, 10, 8);
	scene.add(key);

	// The bus every station sits on.
	const busPts: THREE.Vector3[] = [];
	for (let i = -1; i <= N; i++) busPts.push(new THREE.Vector3(i * SPACING, i === -1 || i === N ? 0 : Math.sin(i * 1.7) * 0.25, Math.sin(i * 1.3) * 1.6));
	const bus = new THREE.CatmullRomCurve3(busPts, false, 'centripetal');
	// u along the whole curve for station i (curve starts one spacing before station 0)
	const uOf = (s: number) => (s + 1) / (N + 1);
	const stationPos = (i: number) => bus.getPointAt(uOf(i));

	const busMat = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		uniforms: { uProg: { value: 0 }, uStart: { value: 0 }, uTime: { value: 0 } },
		vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
		fragmentShader: /* glsl */ `
			varying vec2 vUv; uniform float uProg; uniform float uStart; uniform float uTime;
			void main(){
				float lit = (1.0 - smoothstep(uProg - 0.01, uProg + 0.004, vUv.x)) * smoothstep(uStart - 0.004, uStart + 0.01, vUv.x);
				float tail = smoothstep(uStart - 0.03, uStart, vUv.x);
				float dash = smoothstep(0.55, 1.0, sin((vUv.x * 900.0 - uTime * 6.0)));
				vec3 cold = vec3(0.16, 0.19, 0.24);
				vec3 hot = mix(vec3(0.05, 0.8, 0.5), vec3(0.94, 0.72, 0.04), smoothstep(0.0, 1.0, vUv.x));
				vec3 col = mix(cold * (0.6 + dash * 0.6), hot * (1.1 + dash * 1.6), lit);
				float a = mix(0.5, 1.0, lit) * tail;
				gl_FragColor = vec4(col, a);
			}`,
	});
	busMat.uniforms.uStart.value = uOf(0);
	const busMesh = new THREE.Mesh(new THREE.TubeGeometry(bus, 1400, 0.06, 8, false), busMat);
	scene.add(busMesh);

	// Flowing data particles along the lit part of the bus.
	const samples = bus.getSpacedPoints(3000);
	const FLOW = mobile ? 380 : 800;
	const flowPos = new Float32Array(FLOW * 3);
	const flowSeed = Array.from({ length: FLOW }, () => ({ u: Math.random(), sp: 0.004 + Math.random() * 0.01, r: Math.random() * 0.35, a: Math.random() * Math.PI * 2 }));
	const flowGeo = new THREE.BufferGeometry();
	flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));
	const flow = new THREE.Points(
		flowGeo,
		new THREE.PointsMaterial({ color: 0xffd76a, size: 0.07, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture('rgba(255,255,255,1)', 'rgba(255,215,106,0.6)') }),
	);
	scene.add(flow);

	// Ambient dust.
	const DUST = mobile ? 900 : 1800;
	const dPos = new Float32Array(DUST * 3);
	for (let i = 0; i < DUST; i++) dPos.set([(Math.random() * (N + 2) - 1.5) * SPACING, (Math.random() - 0.3) * 30, (Math.random() - 0.5) * 50], i * 3);
	const dGeo = new THREE.BufferGeometry();
	dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
	const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ color: 0x6b7686, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false }));
	scene.add(dust);

	// Floor grid.
	const floor = new THREE.Mesh(
		new THREE.PlaneGeometry((N + 4) * SPACING, 80, 1, 1),
		new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			uniforms: { uCam: { value: new THREE.Vector3() } },
			vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
			fragmentShader: /* glsl */ `
				varying vec3 vW; uniform vec3 uCam;
				float line(float v, float w){ float f = abs(fract(v - 0.5) - 0.5); return 1.0 - smoothstep(0.0, w, f / fwidth(v)); }
				void main(){
					float g = max(line(vW.x / 2.0, 1.0), line(vW.z / 2.0, 1.0));
					float g2 = max(line(vW.x / 10.0, 1.2), line(vW.z / 10.0, 1.2));
					float d = distance(vW.xz, uCam.xz);
					float fade = exp(-d * 0.085) * (1.0 - smoothstep(18.0, 42.0, d));
					vec3 c = mix(vec3(0.16,0.19,0.23), vec3(0.94,0.72,0.04), g2 * 0.5);
					gl_FragColor = vec4(c, (g * 0.22 + g2 * 0.42) * fade);
				}`,
		}),
	);
	floor.rotation.x = -Math.PI / 2;
	floor.position.set(((N - 1) * SPACING) / 2, -2.4, 0);
	scene.add(floor);

	// The request packet.
	const packet = new THREE.Group();
	const pCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 2), emissive(0xfff1c2, 1.3));
	const pShell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshBasicMaterial({ color: AMBER, wireframe: true, transparent: true, opacity: 0.6, toneMapped: false }));
	const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
	halo.scale.setScalar(1.8);
	const pLight = new THREE.PointLight(AMBER, 14, 14, 1.6);
	packet.add(pCore, pShell, halo, pLight);
	scene.add(packet);

	// Stations.
	const chatIn = new ChatPanel('chat · new conversation');
	const chatOut = new ChatPanel('chat · billing assistant');
	const builders = [
		() => stationPrompt(chatIn),
		stationGateway,
		stationAgent,
		stationRetrieval,
		stationTokenizer,
		stationScheduler,
		stationGPU,
		stationTransformer,
		stationSampling,
		stationTool,
		() => stationStream(chatOut),
		stationRecap,
		stationChoose,
	];
	const stations = builders.slice(0, N).map((b, i) => {
		const st = b();
		const p = stationPos(i);
		st.group.position.add(p);
		scene.add(st.group);
		// Station number + name, floating above.
		const tag = textSprite(`${String(i + 1).padStart(2, '0')}  ${STEPS[i].key}`, { size: 0.38, mono: true, color: LAYER_COLOR[STEPS[i].layer] ?? '#eaecef', weight: 600 });
		tag.position.copy(p).add(new THREE.Vector3(0, [0, 4.9, 5.6, 4.6, 3.7, 3.6, 4.9, 6.0, 4.6, 4.2, 4.2, 0, 0][i] ?? 4.4, 0));
		if (i !== 0 && i < N - 2) scene.add(tag);
		return { ...st, tag, p };
	});

	// Phones: the title sits on top, so frame the opening chat window in the lower half.
	if (mobile) {
		stations[0].cam = [2.4, 3.2, 16];
		stations[0].look = [2.4, 3.9, 0];
		stations[N - 2].cam = [2.6, 1.2, 21];
		stations[N - 2].look = [2.6, 1.0, 0];
	}

	// Post-processing.
	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.95, 0.4, 0.82);
	composer.addPass(bloom);
	composer.addPass(new OutputPass());
	let useBloom = !new URLSearchParams(location.search).has('nobloom');

	// HUD.
	const hud = root.querySelector<HTMLElement>('[data-hud]')!;
	const hudNum = root.querySelector<HTMLElement>('[data-hud-num]')!;
	const hudLayer = root.querySelector<HTMLElement>('[data-hud-layer]')!;
	const hudTitle = root.querySelector<HTMLElement>('[data-hud-title]')!;
	const hudBody = root.querySelector<HTMLElement>('[data-hud-body]')!;
	const hudStat = root.querySelector<HTMLElement>('[data-hud-stat]')!;
	const hudTerm = root.querySelector<HTMLElement>('[data-hud-term]')!;
	const hudClock = root.querySelector<HTMLElement>('[data-hud-clock]')!;
	const skip = root.querySelector<HTMLAnchorElement>('[data-skip]')!;
	const intro = root.querySelector<HTMLElement>('[data-intro]')!;
	const choose = root.querySelector<HTMLElement>('[data-choose]')!;
	const rail = root.querySelector<HTMLElement>('[data-rail]')!;
	const railFill = root.querySelector<HTMLElement>('[data-rail-fill]')!;
	const railBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-rail-step]')];
	let shown = -1;
	const showStep = (i: number) => {
		if (i === shown) return;
		shown = i;
		hud.classList.add('swap');
		window.setTimeout(() => {
			const s = STEPS[i];
			hudNum.textContent = String(i + 1).padStart(2, '0');
			hudLayer.textContent = s.layer;
			hud.style.setProperty('--layer', LAYER_COLOR[s.layer] ?? '#848e9c');
			hudTitle.textContent = s.title;
			hudBody.textContent = s.body;
			hudStat.textContent = s.stat;
			hudTerm.textContent = s.term;
			hud.classList.remove('swap');
		}, 180);
		railBtns.forEach((b, k) => {
			b.classList.toggle('now', k === i);
			b.classList.toggle('past', k < i);
		});
	};

	const scrollRange = () => {
		const r = root.getBoundingClientRect();
		const top = r.top + window.scrollY;
		return { top, span: Math.max(1, root.offsetHeight - window.innerHeight) };
	};
	skip.addEventListener('click', (ev) => {
		ev.preventDefault();
		const { top, span } = scrollRange();
		window.scrollTo({ top: top + span, behavior: 'auto' });
		s = N - 1;
	});
	railBtns.forEach((b) =>
		b.addEventListener('click', () => {
			const i = Number(b.dataset.railStep);
			const { top, span } = scrollRange();
			window.scrollTo({ top: top + (i / (N - 1)) * span, behavior: 'smooth' });
		}),
	);

	const resize = () => {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		renderer.setSize(w, h, false);
		composer.setSize(w, h);
		bloom.resolution.set(w * 0.5, h * 0.5);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	resize();
	window.addEventListener('resize', resize);

	let target = 0;
	const readScroll = () => {
		const { top, span } = scrollRange();
		target = clamp((window.scrollY - top) / span) * (N - 1);
	};
	readScroll();
	window.addEventListener('scroll', readScroll, { passive: true });

	let s = target;
	// Test hook: jump straight to the scroll target (headless screenshots run at a few fps).
	(window as unknown as { __journeySnap?: () => void }).__journeySnap = () => (s = target);
	(window as unknown as { __journeyState?: () => number[] }).__journeyState = () => [s, target];
	let visible = true;
	new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(root);

	const clock = new THREE.Clock();
	const camPos = new THREE.Vector3();
	const camLook = new THREE.Vector3();
	const tmpA = new THREE.Vector3();
	const tmpB = new THREE.Vector3();
	const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
	window.addEventListener('pointermove', (e) => {
		mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
		mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
	});

	// Hold at each station for the middle of its scroll window, glide between.
	const hold = (v: number) => {
		const i = Math.floor(v);
		const f = v - i;
		return i + smooth(0.3, 0.7, f);
	};

	// Frame-time watchdog: step down quality on slow machines.
	let slowFrames = 0;
	let frames = 0;

	const tick = () => {
		requestAnimationFrame(tick);
		const dt = Math.min(clock.getDelta(), 0.05);
		const time = clock.elapsedTime;
		if (!visible || document.hidden) return;

		s += (target - s) * Math.min(1, dt * 5);
		const e = hold(s);
		mouse.sx += (mouse.x - mouse.sx) * dt * 2;
		mouse.sy += (mouse.y - mouse.sy) * dt * 2;

		// camera: blend the two neighbouring stations' framing
		const i0 = Math.floor(e);
		const i1 = Math.min(N - 1, i0 + 1);
		const f = e - i0;
		const a = stations[i0];
		const b = stations[i1];
		tmpA.set(...a.cam).add(a.p);
		tmpB.set(...b.cam).add(b.p);
		camPos.lerpVectors(tmpA, tmpB, f);
		// lift the camera mid-flight for a little drama
		camPos.y += Math.sin(f * Math.PI) * 1.6;
		camPos.z += Math.sin(f * Math.PI) * 2.2;
		camPos.x += mouse.sx * 0.5;
		camPos.y += -mouse.sy * 0.3;
		tmpA.set(...a.look).add(a.p);
		tmpB.set(...b.look).add(b.p);
		camLook.lerpVectors(tmpA, tmpB, f);
		camera.position.copy(camPos);
		camera.lookAt(camLook);
		// Push the subject right of centre on wide screens so the HUD card never covers it;
		// ease back to centre for the final choice, where the HTML cards are centred.
		const vw = canvas.clientWidth;
		// Phones: lift the subject into the top half, above the HUD card.
		const vh = canvas.clientHeight;
		const away = 1 - smooth(N - 2.2, N - 1.4, s);
		const shift = vw > 900 ? 0.09 * away : 0;
		const lift = vw <= 900 ? 0.17 * away * smooth(0.15, 0.6, s) : 0;
		if (shift > 0.0005 || lift > 0.0005) camera.setViewOffset(vw, vh, -vw * shift, vh * lift, vw, vh);
		else if (camera.view?.enabled) camera.clearViewOffset();

		// packet rides the bus
		const pu = uOf(clamp(e, 0, N - 1));
		packet.position.copy(bus.getPointAt(pu));
		packet.position.y += Math.sin(time * 2.2) * 0.06;
		pShell.rotation.x = time * 1.3;
		pShell.rotation.y = time * 0.9;
		halo.scale.setScalar(1.7 + Math.sin(time * 4) * 0.18);
		packet.visible = e > 0.35 && e < N - 2.45;
		busMat.uniforms.uProg.value = pu;
		busMat.uniforms.uTime.value = time;
		(floor.material as THREE.ShaderMaterial).uniforms.uCam.value.copy(camPos);

		// data flow (only on the part of the bus already travelled)
		for (let k = 0; k < FLOW; k++) {
			const fs = flowSeed[k];
			fs.u = (fs.u + fs.sp * dt * 4) % 1;
			const uu = uOf(0) + fs.u * Math.max(0, pu - uOf(0));
			const pt = samples[Math.floor(uu * (samples.length - 1))];
			flowPos[k * 3] = pt.x;
			flowPos[k * 3 + 1] = pt.y + Math.sin(fs.a + time) * fs.r;
			flowPos[k * 3 + 2] = pt.z + Math.cos(fs.a + time) * fs.r;
		}
		flowGeo.attributes.position.needsUpdate = true;
		// Before the request leaves, the travelled stretch has zero length and every particle
		// would sit on one ring at station 0 (seen edge-on, a vertical line). Fade in with distance.
		const travelled = (pu - uOf(0)) * (N + 1);
		flow.visible = travelled > 0.02;
		(flow.material as THREE.PointsMaterial).opacity = 0.9 * smooth(0.02, 0.6, travelled);
		dust.rotation.y = Math.sin(time * 0.02) * 0.02;

		// stations
		stations.forEach((st, i) => {
			const local = clamp((s - i + 0.4) / 0.8);
			const focus = 1 - clamp(Math.abs(s - i));
			const lit = smooth(i - 0.7, i - 0.15, s);
			st.update({ local, focus, lit, time, dt });
			st.tag.material.opacity = 0.25 + lit * 0.75;
		});

		// HUD
		const step = Math.round(s);
		showStep(clamp(step, 0, N - 1));
		const started = s > 0.18;
		intro.style.opacity = String(1 - smooth(0.02, 0.22, s));
		hud.classList.toggle('on', started && s < N - 1.35);
		rail.classList.toggle('on', started);
		railFill.style.width = `${(s / (N - 1)) * 100}%`;
		// Wall-clock of the request, interpolated between the steps' timestamps.
		const ci = Math.floor(clamp(s, 0, N - 1));
		const cf = clamp(s, 0, N - 1) - ci;
		const ms = lerp(STEPS[ci].ms, STEPS[Math.min(N - 1, ci + 1)].ms, smooth(0.3, 0.7, cf));
		hudClock.textContent = `T+ ${(ms / 1000).toFixed(3)} s`;
		skip.classList.toggle('gone', s > N - 1.6);
		choose.classList.toggle('on', s > N - 1.3);

		if (useBloom) composer.render();
		else renderer.render(scene, camera);

		// adaptive quality after the first second
		if (time > 1.2) {
			frames++;
			if (dt > 1 / 32) slowFrames++;
			if (frames === 90) {
				if (slowFrames > 45) {
					if (dpr > 1) {
						dpr = 1;
						renderer.setPixelRatio(1);
						resize();
					} else useBloom = false;
				}
				frames = 0;
				slowFrames = 0;
			}
		}
	};
	tick();
}
