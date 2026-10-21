/**
 * Per-line explanations for code blocks.
 *
 * Authoring (in a post, right after a fenced code block):
 *
 *   <div class="line-notes">
 *
 *   - `DB_PATH = Path(` 从里往外看……
 *   - `with db() as conn:` 第二次出现的那一行……
 *
 *   </div>
 *
 * Each list item starts with an inline-code key. Keys are matched in order
 * against the lines of the code block right before the list: the first line
 * after the previous match that contains the key gets the note, so a repeated
 * line like `with db() as conn:` can be annotated once per occurrence.
 *
 * Without JS the list simply renders under the code block. With JS the list is
 * hidden, annotated lines get a dot in the gutter, and hovering (or tapping,
 * or focusing) a line shows its note in a popover just below that line.
 */

const blocks = [...document.querySelectorAll<HTMLElement>('.line-notes')];

if (blocks.length) {
	const pop = document.createElement('div');
	pop.className = 'line-note-pop';
	pop.setAttribute('role', 'tooltip');
	pop.id = 'line-note-pop';
	pop.hidden = true;
	document.body.append(pop);

	let current: HTMLElement | null = null;
	let hideTimer = 0;
	let openedAt = 0;

	const place = (line: HTMLElement) => {
		const pre = line.closest('pre');
		if (!pre) return;
		const lr = line.getBoundingClientRect();
		const pr = pre.getBoundingClientRect();
		pop.style.left = `${pr.left + window.scrollX}px`;
		pop.style.width = `${pr.width}px`;
		pop.style.top = `${lr.bottom + window.scrollY + 6}px`;
		// Arrow points at the start of the code on that line, clamped inside the popover.
		const text = line.firstElementChild?.getBoundingClientRect() ?? lr;
		pop.style.setProperty('--arrow-x', `${Math.min(Math.max(text.left - pr.left + 8, 14), pr.width - 22)}px`);
	};

	const show = (line: HTMLElement) => {
		clearTimeout(hideTimer);
		if (current === line && !pop.hidden) return;
		current?.classList.remove('is-open');
		current = line;
		openedAt = Date.now();
		line.classList.add('is-open');
		pop.innerHTML = line.dataset.noteHtml ?? '';
		pop.hidden = false;
		place(line);
	};

	const hide = () => {
		current?.classList.remove('is-open');
		current = null;
		pop.hidden = true;
	};

	// A short grace period lets the pointer travel from the line into the popover
	// (to select text or follow a link) without it closing.
	const hideSoon = () => {
		clearTimeout(hideTimer);
		hideTimer = window.setTimeout(hide, 160);
	};

	pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
	pop.addEventListener('mouseleave', hideSoon);
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') hide();
	});
	document.addEventListener('click', (e) => {
		const t = e.target as Node;
		if (!pop.contains(t) && !current?.contains(t)) hide();
	});
	window.addEventListener('resize', () => current && place(current));

	for (const block of blocks) {
		const pre = block.previousElementSibling;
		if (!(pre instanceof HTMLPreElement)) {
			console.warn('[line-notes] no code block right before', block);
			continue;
		}
		const lines = [...pre.querySelectorAll<HTMLElement>('.line')];
		let from = 0;
		let attached = 0;

		for (const li of block.querySelectorAll<HTMLLIElement>(':scope > ul > li')) {
			const keyEl = li.querySelector('code');
			const key = keyEl?.textContent ?? '';
			if (!key) continue;
			const idx = lines.findIndex((l, i) => i >= from && (l.textContent ?? '').includes(key));
			if (idx < 0) {
				console.warn('[line-notes] key not found after line', from + 1, JSON.stringify(key));
				continue;
			}
			from = idx + 1;

			// The note body is the list item minus its leading key.
			const body = li.cloneNode(true) as HTMLLIElement;
			body.querySelector('code')?.remove();
			body.innerHTML = body.innerHTML.replace(/^\s*[::——-]?\s*/, '');

			const line = lines[idx];
			line.dataset.noteHtml = body.innerHTML;
			line.tabIndex = 0;
			line.setAttribute('aria-describedby', pop.id);
			line.addEventListener('mouseenter', () => show(line));
			line.addEventListener('mouseleave', hideSoon);
			line.addEventListener('focus', () => show(line));
			line.addEventListener('blur', hideSoon);
			// Touch screens have no hover: a tap toggles the note. A tap also fires
			// mouseenter just before click, so a note that opened a moment ago stays open.
			line.addEventListener('click', () => {
				if (current === line && !pop.hidden && Date.now() - openedAt > 400) hide();
				else show(line);
			});
			attached++;
		}

		if (!attached) continue;
		pre.classList.add('has-line-notes');
		block.hidden = true;

		const hint = document.createElement('p');
		hint.className = 'line-notes-hint';
		hint.innerHTML = `<span class="line-notes-dot" aria-hidden="true"></span>带圆点的 ${attached} 行有逐行解释,鼠标悬停(手机点一下)就会在这一行下面弹出。`;
		const toggle = document.createElement('button');
		toggle.type = 'button';
		toggle.textContent = '展开全部解释';
		toggle.addEventListener('click', () => {
			block.hidden = !block.hidden;
			toggle.textContent = block.hidden ? '展开全部解释' : '收起全部解释';
		});
		hint.append(toggle);
		pre.before(hint);
	}
}
