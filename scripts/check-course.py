#!/usr/bin/env python3
"""Sanity checks for the agent-60 course posts.

Run from the repo root:  python3 scripts/check-course.py [--links] [--series=agent-zero]

Checks every post under src/content/blog/agent-60/:
  * frontmatter has the seven course fields, and `day` matches the filename
  * pubDate is a real date, never in the future (it is metadata for search engines; the UI only shows Day N)
  * the seven skeleton sections are present, in order
  * the "明天预告 / 下周预告" section names the next day's title
  * figure / video counts and CJK character count
  * (--links) every http(s) URL answers 2xx/3xx, every YouTube embed resolves
    through oEmbed, every Bilibili embed resolves through the public view API
"""

from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERIES = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--series=')), 'agent-60')
POSTS = ROOT / 'src/content/blog' / SERIES
TODAY = dt.date.today()
SECTIONS = ['今天要解决的问题', '动手练习', '名词解释', '常见误区', '学习资料', '自测', '明天预告']
RESOURCE_GROUPS = ['文档与文章', 'B 站视频', '其他经典视频', '书籍', '开源项目与代码']
CJK = re.compile(r'[一-鿿]')


def frontmatter(text: str) -> dict[str, str]:
    m = re.match(r'^---\n(.*?)\n---\n', text, re.S)
    if not m:
        return {}
    out: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ':' in line:
            k, v = line.split(':', 1)
            out[k.strip()] = v.strip().strip("'\"")
    return out


def curl(url: str) -> str:
    try:
        r = subprocess.run(
            ['curl', '-s', '-L', '-m', '20', '-o', '/dev/null', '-w', '%{http_code}', url],
            capture_output=True, text=True, timeout=30,
        )
        return r.stdout.strip()
    except Exception as e:  # noqa: BLE001
        return f'ERR {e}'


def curl_body(url: str) -> str:
    try:
        r = subprocess.run(['curl', '-s', '-L', '-m', '20', url], capture_output=True, text=True, timeout=30)
        return r.stdout
    except Exception:  # noqa: BLE001
        return ''


def main() -> int:
    check_links = '--links' in sys.argv
    posts = sorted(POSTS.glob('day-*.md'))
    by_day: dict[int, dict] = {}
    problems: list[str] = []

    for p in posts:
        text = p.read_text(encoding='utf-8')
        fm = frontmatter(text)
        m = re.match(r'day-(\d+)-', p.name)
        fday = int(m.group(1)) if m else -1
        day = int(fm.get('day', -1))
        title = fm.get('title', '')
        info = {
            'file': p.name,
            'title': title,
            'cjk': len(CJK.findall(text)),
            'figures': len(re.findall(r'<figure(?![^>]*class="video")', text)),
            'videos': len(re.findall(r'<figure class="video"', text)),
            'text': text,
        }
        by_day[day] = info

        for f in ['title', 'description', 'pubDate', 'regime', 'series', 'day', 'lang']:
            if f not in fm:
                problems.append(f'{p.name}: missing frontmatter `{f}`')
        if day != fday:
            problems.append(f'{p.name}: day={day} but filename says {fday}')
        if not title.startswith(f'Day {day} · '):
            problems.append(f'{p.name}: title does not start with "Day {day} · " → {title!r}')
        try:
            pub = dt.date.fromisoformat(fm.get('pubDate', ''))
            if pub > TODAY:
                problems.append(f'{p.name}: pubDate {pub} is in the future')
        except ValueError:
            problems.append(f'{p.name}: bad pubDate {fm.get("pubDate")!r}')
        if fm.get('series') != SERIES or fm.get('lang') != 'zh':
            problems.append(f'{p.name}: series/lang wrong')
        if fm.get('regime') not in ('memory', 'compute', 'none'):
            problems.append(f'{p.name}: regime {fm.get("regime")!r}')

        heads = re.findall(r'^## (.+)$', text, re.M)
        pos = -1
        for s in SECTIONS:
            idx = next((i for i, h in enumerate(heads) if h.startswith(s)), None)
            if idx is None:
                problems.append(f'{p.name}: missing section `## {s}`')
            elif idx < pos:
                problems.append(f'{p.name}: section `{s}` out of order')
            else:
                pos = idx
        if not any(h.startswith(('明天预告', '下周预告', '下个月预告', 'M2 预告')) for h in heads):
            problems.append(f'{p.name}: missing 预告 section')
        subs = re.findall(r'^### (.+)$', text, re.M)
        for g in RESOURCE_GROUPS:
            if not any(h.startswith(g) for h in subs):
                problems.append(f'{p.name}: 学习资料 missing `### {g}`')
        if 'player.bilibili.com' not in text:
            problems.append(f'{p.name}: no Bilibili embed')
        if heads and not heads[0].startswith('今天要解决的问题'):
            problems.append(f'{p.name}: first section is `{heads[0]}`, expected 今天要解决的问题')

        # <details> blocks need blank lines around their content for markdown to render inside.
        for bad in re.finditer(r'<summary>答案</summary>\n(?!\n)', text):
            problems.append(f'{p.name}: <details> answer lacks blank line after summary (offset {bad.start()})')
            break

        # line-notes keys must match the code block right above, in order (same rule as src/scripts/line-notes.ts).
        for block in re.finditer(r'```[^\n]*\n((?:(?!```).)*?)\n```\n\n<div class="line-notes">\n(.*?)\n</div>', text, re.S):
            lines = block.group(1).split('\n')
            start = 0
            for key in re.findall(r'^- `([^`]+)`', block.group(2), re.M):
                idx = next((i for i in range(start, len(lines)) if key in lines[i]), None)
                if idx is None:
                    problems.append(f'{p.name}: line-notes key not found after code line {start + 1}: {key!r}')
                else:
                    start = idx + 1
        if text.count('<div class="line-notes">') != len(re.findall(r'```\n\n<div class="line-notes">', text)):
            problems.append(f'{p.name}: <div class="line-notes"> must follow a code block after one blank line')

        if info['figures'] < 1:
            problems.append(f'{p.name}: only {info["figures"]} figure(s)')
        if info['videos'] < 2:
            problems.append(f'{p.name}: only {info["videos"]} video embed(s)')
        if info["cjk"] < 4500:
            problems.append(f'{p.name}: only {info["cjk"]} CJK chars')

    # prev/next consistency: the 预告 section should mention the next day's title words.
    for day, info in sorted(by_day.items()):
        nxt = by_day.get(day + 1)
        if not nxt:
            continue
        m = re.search(r'^## (明天预告|下周预告|下个月预告|M2 预告).*?$(.*?)(?=^## |\Z)', info['text'], re.M | re.S)
        if not m:
            continue
        tail = m.group(2)
        nxt_title = re.sub(r'^Day \d+ · ', '', nxt['title'])
        # take the first noun phrase of the next title (before ：or :) as the key
        key = re.split(r'[：:]', nxt_title)[0].strip()
        if key[:6] not in tail and f'Day {day + 1}' not in tail:
            problems.append(f'{info["file"]}: 预告 does not mention Day {day + 1} / "{key}"')

    print(f'{"day":>3}  {"cjk":>6}  {"fig":>3}  {"vid":>3}  file')
    for day, info in sorted(by_day.items()):
        print(f'{day:>3}  {info["cjk"]:>6}  {info["figures"]:>3}  {info["videos"]:>3}  {info["file"]}')
    print()

    if check_links:
        seen: dict[str, str] = {}
        for day, info in sorted(by_day.items()):
            text = info['text']
            urls = set(re.findall(r'https?://[^\s)\]>"\'`]+', text))
            for u in sorted(urls):
                u = u.rstrip('.,;，。')
                if 'youtube-nocookie.com/embed/' in u or 'player.bilibili.com' in u:
                    continue
                if '${' in u or '<' in u or 'example.invalid' in u or '.invalid' in u:
                    continue  # placeholder inside a code block, not a real link
                if u not in seen:
                    seen[u] = curl(u)
                code = seen[u]
                if not code.startswith(('2', '3')):
                    problems.append(f'{info["file"]}: {code} {u}')
            for vid in re.findall(r'youtube-nocookie\.com/embed/([A-Za-z0-9_-]{6,})', text):
                body = curl_body(f'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json')
                try:
                    t = json.loads(body).get('title')
                    print(f'  yt  {vid}  {t}')
                except Exception:  # noqa: BLE001
                    problems.append(f'{info["file"]}: YouTube {vid} failed oEmbed')
            for bv in re.findall(r'bvid=(BV[0-9A-Za-z]{10})', text):
                body = curl_body(f'https://api.bilibili.com/x/web-interface/view?bvid={bv}')
                try:
                    j = json.loads(body)
                    if j.get('code') != 0:
                        raise ValueError
                    print(f'  bili {bv}  {j["data"]["title"]}')
                except Exception:  # noqa: BLE001
                    problems.append(f'{info["file"]}: Bilibili {bv} failed view API')
        print()

    if problems:
        print(f'{len(problems)} problem(s):')
        for x in problems:
            print('  -', x)
        return 1
    print('all checks passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
