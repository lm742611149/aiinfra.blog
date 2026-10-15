---
title: 'Day 114 · Agent Loupe(三):React 时间轴与一万步的渲染性能'
description: '前端开工。Vite + React + TypeScript 起项目,写运行列表页和运行详情页,用步骤树加瀑布时间轴把一次 Agent 运行画出来;再用虚拟滚动让一万步也能顺畅滚动,并学会用 Chrome Performance 面板测量它到底卡不卡。'
pubDate: 2026-10-15
regime: none
tags: ['agent-loupe', 'react', 'typescript', 'virtual-scroll', 'performance', 'agent-60']
series: 'agent-60'
day: 114
lang: 'zh'
---

## 今天要解决的问题

后端已经能吐出数据了,今天让它变成能看的东西。这是这个项目里前端分量最重的一天,也是你作为前端出身的人最能拉开差距的一天。学完你应该能:

1. 写出类型完整的 API 客户端,前端类型和后端模型一一对应。
2. 实现运行列表页:搜索、按状态筛选、上传 trace、加载更多。
3. 把扁平的步骤数组变成一棵可折叠的树,算出每一步的缩进深度。
4. 画出瀑布时间轴:每一步一根长条,位置和长度按时间比例,报错的标红。
5. 用 `@tanstack/react-virtual` 做虚拟滚动,让一万步的时间轴只渲染几十个 DOM 节点;用键盘上下移动、左右折叠。
6. 用 Chrome Performance 面板测量首屏时间和滚动时有没有长任务,把数字记下来。

预计用时 5 到 7 小时。前置:Day 111 的前端骨架;Day 113 的后端接口(今天全程要开着它);React 基础(组件、`useState`、`useEffect`、`useMemo`)。

开两个终端:

```bash
# 终端 1
cd agent-loupe/server && uv run uvicorn loupe.app:create_app --factory --reload --port 8000
# 终端 2
cd agent-loupe/web && pnpm dev
```

`vite.config.ts` 里已经配了 `/api` 转发到 8000,所以前端代码里只写 `/api/runs` 这样的相对路径。部署时前端和后端放在同一个域名下,这些路径不用改。

## 先写类型:前端和后端的契约

```ts
// agent-loupe/web/src/api.ts
export type StepKind = 'llm' | 'tool' | 'agent' | 'retrieval' | 'other';

export interface Run {
  id: string;
  name: string;
  started_at: string;
  ended_at: string;
  status: 'ok' | 'error';
  model: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  tags: string[];
  parent_run_id: string | null;
  forked_from_step: number | null;
  step_count: number;
}

/** 列表接口默认返回的「轻」步骤:没有 input/output,一万步也只有两三 MB */
export interface StepLight {
  run_id: string;
  idx: number;
  parent_idx: number | null;
  kind: StepKind;
  name: string;
  started_at: string;
  ended_at: string;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  model: string | null;
}

export interface StepFull extends StepLight {
  input: unknown;
  output: unknown;
}

export interface RunPage {
  items: Run[];
  next_cursor: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function fetchRuns(params: { q?: string; status?: string; tag?: string; cursor?: string | null }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  return getJson<RunPage>(`/api/runs?${sp}`);
}

export const fetchRun = (id: string) => getJson<Run>(`/api/runs/${id}`);

export const fetchStep = (runId: string, idx: number) => getJson<StepFull>(`/api/runs/${runId}/steps/${idx}`);

/** 一页一页把轻步骤全拉下来;onProgress 让界面能显示「已加载 3000 / 10000」 */
export async function fetchAllSteps(runId: string, onProgress?: (loaded: number, total: number) => void) {
  const all: StepLight[] = [];
  let from: number | null = 0;
  while (from !== null) {
    const page: { steps: StepLight[]; next_from: number | null; total: number } = await getJson(
      `/api/runs/${runId}/steps?from=${from}&limit=5000`,
    );
    all.push(...page.steps);
    onProgress?.(all.length, page.total);
    from = page.next_from;
  }
  return all;
}

export async function importFile(file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/import', { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(body.detail ?? '导入失败');
  return body as { imported: { id: string; name: string; steps: number }[] };
}
```

`Run`、`StepLight`、`StepFull` 和 Day 112 的 pydantic 模型逐字段对应。时间字段在前端是 `string`(ISO 格式),因为 JSON 里没有日期类型,需要计算时再 `new Date()`。可选字段写成 `number | null` 而不是 `number | undefined`,因为后端返回的是 JSON 的 `null`。

`StepLight` 和 `StepFull` 用 `extends` 区分,对应后端的「轻」和「完整」。这样 TypeScript 会阻止你在时间轴组件里不小心访问 `step.input`:时间轴拿到的是 `StepLight[]`,那里根本没有这个字段。类型在这里不只是文档,它把 Day 113 的设计决定(时间轴不加载大字段)变成了编译期的约束。

`fetchAllSteps` 用一个 while 循环一页页地拉,每页 5000 步,一万步两个请求。`onProgress` 回调让界面能显示「已加载 5000 / 10000」。为什么不一次 `limit=10000`?后端限制了单页最多 5000,这是给公开部署留的保护;而且分页加载时进度可见,对大文件的体验更好。

错误处理:后端返回非 2xx 时,优先用它 JSON 里的 `detail`(Day 113 我们特意把它写成了人话),拿不到才用状态码。`.catch(() => ({}))` 是因为 500 这类错误的响应体不一定是 JSON。

## 三个小工具

格式化函数:

```ts
// agent-loupe/web/src/lib/format.ts
export const ms = (a: string, b: string) => new Date(b).getTime() - new Date(a).getTime();

export function fmtDuration(millis: number): string {
  if (millis < 1000) return `${Math.round(millis)}ms`;
  if (millis < 60_000) return `${(millis / 1000).toFixed(1)}s`;
  const m = Math.floor(millis / 60_000);
  return `${m}m${Math.round((millis % 60_000) / 1000)}s`;
}

export const fmtTokens = (n: number | null | undefined) =>
  n == null ? '–' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export const fmtCost = (usd: number | null | undefined) =>
  usd == null ? '–' : usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(3)}`;

/** 时间轴刻度:把总时长分成 4–8 段「好看」的整数(1、2、5 × 10 的幂) */
export function niceTicks(totalMs: number, maxTicks = 6): number[] {
  if (totalMs <= 0) return [0];
  const rough = totalMs / maxTicks;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const ticks: number[] = [];
  for (let t = 0; t <= totalMs; t += step) ticks.push(t);
  return ticks;
}
```

`niceTicks` 负责时间轴顶部的刻度。总时长 24.1 秒的运行,我们希望刻度是 0、5s、10s、15s、20s,而不是 0、4.02s、8.03s 这种。做法是先算一个粗略步长(总时长 / 6),再向上取到 1、2、5 乘以 10 的幂里最近的一个。这是画图库里常见的「nice number」算法的最简版本。

把扁平数组变成树:

```ts
// agent-loupe/web/src/lib/tree.ts
import type { StepLight } from '../api';

export interface Row {
  step: StepLight;
  depth: number;
  hasChildren: boolean;
}

/** 预先算好每个步骤的深度和子步骤列表,一万步只算一次 */
export function buildIndex(steps: StepLight[]) {
  const children = new Map<number | null, number[]>();
  for (const s of steps) {
    const key = s.parent_idx;
    const list = children.get(key);
    if (list) list.push(s.idx);
    else children.set(key, [s.idx]);
  }
  const depth = new Map<number, number>();
  const byIdx = new Map(steps.map((s) => [s.idx, s]));
  // 后端保证 idx 按开始时间递增,父步骤一定先开始,所以顺序扫一遍就能算出深度
  for (const s of steps) depth.set(s.idx, s.parent_idx == null ? 0 : (depth.get(s.parent_idx) ?? 0) + 1);
  return { children, depth, byIdx };
}

export type TreeIndex = ReturnType<typeof buildIndex>;

/** 按折叠状态算出当前可见的行(深度优先,和文件树一样) */
export function visibleRows(index: TreeIndex, collapsed: Set<number>): Row[] {
  const rows: Row[] = [];
  const stack = [...(index.children.get(null) ?? [])].reverse();
  while (stack.length) {
    const idx = stack.pop()!;
    const kids = index.children.get(idx) ?? [];
    rows.push({ step: index.byIdx.get(idx)!, depth: index.depth.get(idx) ?? 0, hasChildren: kids.length > 0 });
    if (!collapsed.has(idx)) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return rows;
}
```

后端给的步骤是一个按 idx 排好序的扁平数组,每一步有 `parent_idx`。要画成可折叠的树,需要两样东西:每个步骤的子步骤列表,和每个步骤的深度。

`buildIndex` 扫一遍数组建出 `children` 映射。深度的算法依赖 Day 112 定下的那个约定:父步骤的 idx 一定比子步骤小。所以按顺序扫的时候,算到某一步时它父亲的深度一定已经算好了,一遍就够,不需要递归。这就是在数据模型里多想一步带来的回报。

`visibleRows` 根据折叠状态算出当前要显示哪些行,顺序是深度优先,和文件管理器的树一样。用显式的栈而不是递归,一万步深度嵌套时不会爆调用栈。注意入栈时子节点要倒序压入,弹出时才是正序。

全局 UI 状态:

```ts
// agent-loupe/web/src/store.ts
import { create } from 'zustand';

interface UiState {
  selectedIdx: number | null;
  collapsed: Set<number>;
  select: (idx: number | null) => void;
  toggle: (idx: number) => void;
  reset: () => void;
}

export const useUi = create<UiState>((set) => ({
  selectedIdx: null,
  collapsed: new Set(),
  select: (idx) => set({ selectedIdx: idx }),
  toggle: (idx) =>
    set((s) => {
      const next = new Set(s.collapsed); // 换一个新 Set,zustand 才知道状态变了
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return { collapsed: next };
    }),
  reset: () => set({ selectedIdx: null, collapsed: new Set() }),
}));
```

选中了哪一步、哪些步骤被折叠了,这两个状态时间轴要用,详情面板要用,明天的上下文增长图和火焰图也要用。用 props 一层层传会很乱,用 Context 又会让所有消费者在任何变化时都重新渲染。Zustand 足够小,而且组件可以只订阅自己关心的那部分状态。

`toggle` 里每次创建一个新的 `Set`。Zustand 和 React 判断状态有没有变,用的是引用比较;直接 `collapsed.add(idx)` 修改原来的 Set,引用没变,界面不会更新。这是 React 里最常见的坑之一。

## 运行列表页

```tsx
// agent-loupe/web/src/pages/RunList.tsx
import { useEffect, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { fetchRuns, importFile, type Run } from '../api';
import { fmtCost, fmtDuration, fmtTokens, ms } from '../lib/format';

export function RunList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');

  async function load(reset: boolean) {
    try {
      const page = await fetchRuns({ q, status, cursor: reset ? null : cursor });
      setRuns((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCursor(page.next_cursor);
    } catch (e) {
      setMessage(String(e));
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => load(true), 250); // 输入停 250ms 再查,别每敲一个字发一次请求
    return () => clearTimeout(timer);
  }, [q, status]); // 只在筛选条件变化时重查;load 每次渲染都是新函数,不放进依赖

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(`正在导入 ${file.name}…`);
    try {
      const res = await importFile(file);
      setMessage(`导入了 ${res.imported.length} 条运行记录`);
      await load(true);
    } catch (err) {
      setMessage(String(err));
    }
    e.target.value = '';
  }

  return (
    <main className="page">
      <header className="toolbar">
        <h1>运行记录</h1>
        <input placeholder="按名称搜索" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="ok">成功</option>
          <option value="error">失败</option>
        </select>
        <label className="upload">
          导入 trace
          <input type="file" accept=".json,.jsonl" onChange={onUpload} hidden />
        </label>
        {message && <span className="hint">{message}</span>}
      </header>
      <table className="runs">
        <thead>
          <tr>
            <th>名称</th><th>状态</th><th>开始时间</th><th>耗时</th><th>步数</th><th>输入 / 输出 token</th><th>成本</th><th>标签</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/runs/${r.id}`}>{r.name}</Link></td>
              <td className={r.status === 'error' ? 'bad' : 'good'}>{r.status}</td>
              <td>{new Date(r.started_at).toLocaleString()}</td>
              <td>{fmtDuration(ms(r.started_at, r.ended_at))}</td>
              <td>{r.step_count}</td>
              <td>{fmtTokens(r.total_input_tokens)} / {fmtTokens(r.total_output_tokens)}</td>
              <td>{fmtCost(r.total_cost_usd)}</td>
              <td>{r.tags.map((t) => <span key={t} className="tag">{t}</span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cursor && <button className="more" onClick={() => load(false)}>加载更多</button>}
      {runs.length === 0 && <p className="hint">还没有数据。点「导入 trace」,选 samples 目录里的文件试试。</p>}
    </main>
  );
}
```

搜索框加了 250 毫秒的防抖:每次输入都重置计时器,停止输入 250 毫秒后才真正请求。不加的话,输入「cities」六个字母会发六个请求,而且返回顺序不保证,可能出现旧请求的结果覆盖新请求的情况。

「加载更多」把 Day 113 的 `next_cursor` 传回去,新的一页追加到列表末尾。筛选条件变化时 `load(true)` 从头加载,游标清空。

上传用的是一个隐藏的 `<input type="file">` 包在 `<label>` 里,点 label 就会触发文件选择。上传后把 `e.target.value` 清空,否则连续两次选择同一个文件不会触发 `onChange`,这是浏览器的行为。

## 时间轴:树 + 瀑布

```tsx
// agent-loupe/web/src/components/Timeline.tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, type KeyboardEvent } from 'react';
import type { StepLight } from '../api';
import { fmtDuration, ms, niceTicks } from '../lib/format';
import { buildIndex, visibleRows } from '../lib/tree';
import { useUi } from '../store';

const ROW_HEIGHT = 26;

interface Props {
  steps: StepLight[];
  runStart: string;
  runEnd: string;
}

export function Timeline({ steps, runStart, runEnd }: Props) {
  const { selectedIdx, collapsed, select, toggle } = useUi();
  const index = useMemo(() => buildIndex(steps), [steps]);
  const rows = useMemo(() => visibleRows(index, collapsed), [index, collapsed]);
  const total = Math.max(ms(runStart, runEnd), 1);
  const t0 = new Date(runStart).getTime();

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20, // 视口外多渲染 20 行,快速滚动时不容易露白
  });

  const pos = selectedIdx == null ? -1 : rows.findIndex((r) => r.step.idx === selectedIdx);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const row = rows[pos];
    let next = pos;
    if (e.key === 'ArrowDown' || e.key === 'j') next = Math.min(pos + 1, rows.length - 1);
    else if (e.key === 'ArrowUp' || e.key === 'k') next = Math.max(pos - 1, 0);
    else if (e.key === 'ArrowLeft' && row?.hasChildren && !collapsed.has(row.step.idx)) toggle(row.step.idx);
    else if (e.key === 'ArrowRight' && row?.hasChildren && collapsed.has(row.step.idx)) toggle(row.step.idx);
    else return;
    e.preventDefault();
    if (next !== pos && rows[next]) {
      select(rows[next].step.idx);
      virtualizer.scrollToIndex(next, { align: 'auto' });
    }
  }

  return (
    <div className="timeline">
      <div className="timeline-ruler">
        <div className="name-col">步骤({rows.length} / {steps.length})</div>
        <div className="bar-col">
          {niceTicks(total).map((t) => (
            <span key={t} className="tick" style={{ left: `${(t / total) * 100}%` }}>
              {fmtDuration(t)}
            </span>
          ))}
        </div>
      </div>
      <div ref={scrollRef} className="timeline-scroll" tabIndex={0} onKeyDown={onKeyDown}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const { step, depth, hasChildren } = rows[v.index];
            const left = ((new Date(step.started_at).getTime() - t0) / total) * 100;
            const width = Math.max((ms(step.started_at, step.ended_at) / total) * 100, 0.2);
            const cls = ['row', `kind-${step.kind}`, step.error ? 'has-error' : '', step.idx === selectedIdx ? 'selected' : '']
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={step.idx}
                className={cls}
                style={{ height: ROW_HEIGHT, transform: `translateY(${v.start}px)` }}
                onClick={() => select(step.idx)}
              >
                <div className="name-col" style={{ paddingLeft: 6 + depth * 14 }}>
                  <button
                    className="caret"
                    disabled={!hasChildren}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(step.idx);
                    }}
                    aria-label={collapsed.has(step.idx) ? '展开' : '折叠'}
                  >
                    {hasChildren ? (collapsed.has(step.idx) ? '▸' : '▾') : ''}
                  </button>
                  <span className="idx">#{step.idx}</span>
                  <span className="step-name">{step.name}</span>
                </div>
                <div className="bar-col">
                  <div className="bar" style={{ left: `${left}%`, width: `${width}%` }} />
                  <span className="bar-label" style={{ left: `${Math.min(left + width, 92)}%` }}>
                    {fmtDuration(ms(step.started_at, step.ended_at))}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

每一行分成左右两栏:左边是步骤名,按深度缩进;右边是一根长条,横向位置和长度都按时间比例算。

长条的定位用的是 CSS 百分比,不是像素:`left` 是「这一步开始时间相对运行开始过了多久」占总时长的百分比,`width` 是这一步的耗时占总时长的百分比。这样不需要测量容器宽度,窗口变宽变窄时长条自动跟着缩放,也不用监听 resize。耗时太短的步骤(比如 `calculate` 只有零点几毫秒)宽度会接近 0,所以给了一个 0.2% 的最小宽度,保证看得见。

报错的步骤整行标红:名字红色,长条也是红色。调试时第一眼要找的就是它们。

### 虚拟滚动是怎么回事

一万步的时间轴,如果每一步渲染一个 `<div>`,里面再套几层元素,DOM 节点会有五六万个。浏览器能渲染出来,但首屏要等很久,滚动时每一帧都要处理大量节点的布局和绘制,会明显卡顿。

虚拟滚动的思路是:用户一次只能看见几十行,那就只渲染这几十行。

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="虚拟滚动示意:外层容器高度等于全部行的总高度,只有视口内和上下少量缓冲行被真正渲染">
  <rect x="0" y="0" width="640" height="320" fill="var(--paper-raised)" rx="6"/>
  <rect x="60" y="20" width="200" height="280" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="160" y="40" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">占位容器</text>
  <text x="160" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">高度 = 10000 × 26px</text>
  <text x="160" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">(不渲染,只撑开滚动条)</text>
  <rect x="70" y="120" width="180" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="160" y="135" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">缓冲行(overscan)</text>
  <rect x="50" y="146" width="220" height="90" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2"/>
  <text x="160" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">视口:真正渲染的行</text>
  <text x="160" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">#3120 … #3150</text>
  <text x="160" y="214" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">translateY(3120 × 26px)</text>
  <rect x="70" y="240" width="180" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="160" y="255" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">缓冲行(overscan)</text>
  <text x="300" y="120" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">滚动时发生的事:</text>
  <text x="300" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1. 读 scrollTop</text>
  <text x="300" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">2. 算出视口内是第几行到第几行</text>
  <text x="300" y="190" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3. 只渲染这些行 + 上下各 20 行缓冲</text>
  <text x="300" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">4. 每行用 transform 放到正确的位置</text>
  <text x="300" y="250" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">DOM 里的行数和总步数无关,</text>
  <text x="300" y="268" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">只和视口高度有关</text>
</svg>
<figcaption>外层容器撑出全部行的高度,让滚动条的长度和位置正确;里面只放视口附近的几十行,用 transform 移到它们该在的位置。</figcaption>
</figure>

`useVirtualizer` 帮我们做了这些计算。你告诉它总共多少行(`count`)、滚动容器是谁(`getScrollElement`)、每行大概多高(`estimateSize`),它返回 `getTotalSize()`(用来撑开外层容器)和 `getVirtualItems()`(当前要渲染的行,每行带着它的 `start` 位置)。我们的每一行都是固定的 26 像素,这是最简单也最快的情况;行高不固定时它也能处理,但要额外测量每行的实际高度。

`overscan: 20` 是视口上下各多渲染 20 行。快速滚动时,浏览器先滚动、后执行 JavaScript,如果只渲染视口内的行,滚得快了就会短暂露出空白。多渲染一些能遮住这个空白,代价是 DOM 节点多一点。20 是一个经验值,不是算出来的最优解,你可以在练习里改大改小,用 Performance 面板看看效果。

用 `transform: translateY` 而不是 `top` 定位每一行,是因为 transform 不触发重新布局,只在合成阶段处理,滚动时更省。

我用一万步的合成数据打开详情页,在控制台里数了一下:

```js
document.querySelectorAll('.row').length
```

页面刚打开时是 45 行左右,滚到中间以后是 65 行左右(视口内的行加上下缓冲)。不管总步数是一万还是十万,这个数字都差不多。

### 键盘导航

调试工具是给工程师用的,工程师喜欢键盘。时间轴容器设了 `tabIndex={0}`,让它能获得焦点、接收键盘事件。↑↓(或者 vim 风格的 k、j)在可见行之间移动,← 折叠当前步骤,→ 展开。移动后调用 `virtualizer.scrollToIndex(next, { align: 'auto' })`,目标行在视口外时自动滚过去,已经在视口内时不动。

一个细节:键盘导航是在 `rows`(当前可见行)里移动,而不是在全部步骤里移动。被折叠起来的子步骤会被跳过,这和文件管理器的行为一致。

## 运行详情页

```tsx
// agent-loupe/web/src/pages/RunDetail.tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchAllSteps, fetchRun, type Run, type StepLight } from '../api';
import { Timeline } from '../components/Timeline';
import { fmtCost, fmtDuration, fmtTokens, ms } from '../lib/format';
import { useUi } from '../store';

export function RunDetail() {
  const { id = '' } = useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<StepLight[] | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const { selectedIdx, reset } = useUi();

  useEffect(() => {
    reset();
    setSteps(null);
    let cancelled = false; // 用户在加载中途切到别的 run,旧请求的结果不能覆盖新的
    (async () => {
      try {
        const r = await fetchRun(id);
        if (cancelled) return;
        setRun(r);
        const t = performance.now();
        const all = await fetchAllSteps(id, (n, total) => !cancelled && setProgress(`已加载 ${n} / ${total}`));
        if (cancelled) return;
        setSteps(all);
        setProgress(`${all.length} 步,加载 ${Math.round(performance.now() - t)}ms`);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reset]);

  if (error) return <main className="page"><p className="bad">{error}</p></main>;
  if (!run) return <main className="page"><p className="hint">加载中…</p></main>;
  const selected = steps?.find((s) => s.idx === selectedIdx);

  return (
    <main className="page detail">
      <header className="toolbar">
        <Link to="/">← 全部运行</Link>
        <h1>{run.name}</h1>
        <span className={run.status === 'error' ? 'bad' : 'good'}>{run.status}</span>
        <span>{fmtDuration(ms(run.started_at, run.ended_at))}</span>
        <span>token {fmtTokens(run.total_input_tokens)} / {fmtTokens(run.total_output_tokens)}</span>
        <span>{fmtCost(run.total_cost_usd)}</span>
        <span className="hint">{progress}</span>
      </header>
      <div className="split">
        {steps ? <Timeline steps={steps} runStart={run.started_at} runEnd={run.ended_at} /> : <p className="hint">{progress}</p>}
        <aside className="inspector">
          {selected ? (
            <dl>
              <dt>步骤</dt><dd>#{selected.idx} {selected.name}</dd>
              <dt>类型</dt><dd>{selected.kind}</dd>
              <dt>耗时</dt><dd>{fmtDuration(ms(selected.started_at, selected.ended_at))}</dd>
              <dt>token</dt><dd>{fmtTokens(selected.input_tokens)} / {fmtTokens(selected.output_tokens)}</dd>
              {selected.error && (<><dt>错误</dt><dd className="bad">{selected.error}</dd></>)}
            </dl>
          ) : (
            <p className="hint">点左边任意一步,或者用 ↑↓ 键移动、←→ 折叠展开。</p>
          )}
        </aside>
      </div>
    </main>
  );
}
```

`useEffect` 里那个 `cancelled` 变量很重要。用户打开一条一万步的运行,加载到一半又点了浏览器的后退、打开了另一条。没有这个标记的话,第一条的请求回来以后会 `setSteps`,把第二条的数据覆盖掉,界面上显示的是 A 运行的标题和 B 运行的步骤。清理函数在 `id` 变化时执行,把标记设成 true,旧请求回来时就什么都不做。React 18 的严格模式在开发环境下会故意把每个 effect 执行两次,正是为了帮你暴露这类问题。

页面切换时调用 `reset()` 清掉选中和折叠状态,否则从一条运行切到另一条时,第 3 步还是选中的,这在新的运行里毫无意义。

右边的详情面板今天先放一个简单版本,只显示选中步骤的名字、类型、耗时、token 和错误。明天会换成能看完整消息的版本。

最后是入口文件和样式:

```tsx
// agent-loupe/web/src/App.tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RunDetail } from './pages/RunDetail';
import { RunList } from './pages/RunList';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RunList />} />
        <Route path="/runs/:id" element={<RunDetail />} />
      </Routes>
    </BrowserRouter>
  );
}
```

```tsx
// agent-loupe/web/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

```css
/* agent-loupe/web/src/index.css */
:root {
  --bg: #f7f8fa; --panel: #ffffff; --ink: #1d2330; --soft: #5b6475; --faint: #9aa3b2; --line: #e3e6ec;
  --llm: #3b6fd8; --tool: #c9821b; --agent: #6b7385; --retrieval: #2f9a6a; --other: #8a6fc4;
  --bad: #d0443e; --good: #2f9a6a; --sel: #e8efff;
  font-family: system-ui, -apple-system, 'PingFang SC', sans-serif; font-size: 13px; color: var(--ink); background: var(--bg);
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #14171d; --panel: #1b1f27; --ink: #e4e7ee; --soft: #a3abba; --faint: #6b7385; --line: #2b313c; --sel: #24314d; }
}
* { box-sizing: border-box; }
body { margin: 0; }
a { color: var(--llm); }
.page { padding: 16px 20px; }
.toolbar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.toolbar h1 { font-size: 18px; margin: 0 8px 0 0; }
input, select, button, .upload { font: inherit; padding: 4px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel); color: var(--ink); }
.upload { cursor: pointer; }
.hint { color: var(--faint); }
.bad { color: var(--bad); }
.good { color: var(--good); }
.tag { display: inline-block; padding: 0 6px; margin-right: 4px; border-radius: 3px; background: var(--line); }
table.runs { width: 100%; border-collapse: collapse; background: var(--panel); }
table.runs th, table.runs td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.more { margin-top: 12px; }
.detail { height: 100vh; display: flex; flex-direction: column; }
.split { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 3fr) minmax(320px, 2fr); gap: 12px; }
.timeline { display: flex; flex-direction: column; min-height: 0; background: var(--panel); border: 1px solid var(--line); }
.timeline-ruler { display: flex; height: 24px; border-bottom: 1px solid var(--line); color: var(--faint); }
.timeline-scroll { flex: 1; overflow: auto; outline: none; }
.timeline-scroll:focus-visible { box-shadow: inset 0 0 0 2px var(--llm); }
.row { position: absolute; left: 0; right: 0; display: flex; align-items: center; cursor: pointer; border-bottom: 1px solid var(--line); }
.row:hover { background: var(--bg); }
.row.selected { background: var(--sel); }
.name-col { width: 260px; flex-shrink: 0; display: flex; align-items: center; gap: 4px; overflow: hidden; white-space: nowrap; padding-right: 6px; }
.bar-col { position: relative; flex: 1; height: 100%; }
.tick { position: absolute; top: 4px; transform: translateX(-50%); font-size: 11px; }
.caret { border: 0; background: none; width: 16px; padding: 0; color: var(--soft); }
.idx { color: var(--faint); font-variant-numeric: tabular-nums; }
.step-name { overflow: hidden; text-overflow: ellipsis; }
.bar { position: absolute; top: 7px; height: 12px; border-radius: 2px; background: var(--other); }
.kind-llm .bar { background: var(--llm); }
.kind-tool .bar { background: var(--tool); }
.kind-agent .bar { background: var(--agent); opacity: 0.5; }
.kind-retrieval .bar { background: var(--retrieval); }
.has-error .bar { background: var(--bad); }
.has-error .step-name { color: var(--bad); }
.bar-label { position: absolute; top: 5px; margin-left: 4px; font-size: 11px; color: var(--faint); }
.inspector { background: var(--panel); border: 1px solid var(--line); padding: 12px; overflow: auto; min-height: 0; }
.inspector dl { display: grid; grid-template-columns: 56px 1fr; gap: 6px 10px; margin: 0; }
.inspector dt { color: var(--faint); }
.inspector dd { margin: 0; }
```

颜色用 CSS 变量定义在 `:root` 上,暗色模式下覆盖一遍。步骤类型的颜色有含义:模型调用蓝色,工具琥珀色,和这门课所有图里的配色一致,用户在课程里看熟了的颜色,到了工具里还是同一个意思。

## 测量:到底卡不卡

做完了不等于做好了。Day 111 定的验收指标是「一万步打开到首屏可交互 2 秒内」「滚动时没有超过 50 毫秒的长任务」,现在来测。

**首屏时间**。详情页的标题栏会显示「10000 步,加载 xxx ms」,这是 `fetchAllSteps` 前后用 `performance.now()` 量的,只包括拉数据的时间。要量到「首屏可交互」,用 Chrome 的 Performance 面板:

1. 打开开发者工具的 Performance 面板,勾上 Screenshots。
2. 点左上角的「重新加载并录制」按钮(圆形箭头),页面会刷新并自动录制。
3. 加载完以后停止录制。看时间线上的截图,找到时间轴第一次出现行的那一帧,读它的时间。

**滚动时的长任务**。主线程上一个任务超过 50 毫秒,就会让这段时间里的输入和动画卡住,浏览器把它叫长任务(long task):

1. 页面加载完以后,在 Performance 面板点「录制」(实心圆)。
2. 在时间轴上用鼠标滚轮快速滚动几秒,再用键盘按住 ↓ 键几秒。
3. 停止录制。看 Main 那一行,任务块右上角有红色三角的就是长任务,点开能看到是哪个函数。也可以看 Frames 那一行有没有大段的红色或黄色(掉帧)。

**对照实验**。把 `overscan` 改成 `rows.length`,相当于关掉虚拟滚动,全部行都渲染,再测一次。前后两组数字放在一起,面试时你能说「虚拟滚动把首屏从多少降到多少」,而不是「据说虚拟滚动能提升性能」。

| 测量项(1 万步合成数据) | 虚拟滚动 | 全量渲染 |
| --- | --- | --- |
| 拉数据耗时(标题栏显示) | | |
| 首屏出现行(Performance 截图) | | |
| 滚动时长任务个数 / 最长一个 | | |
| DOM 中 `.row` 的数量 | | |

这张表留给你填。性能数字和机器关系很大,写清楚机器型号、浏览器版本,开发模式和生产构建(`pnpm build && pnpm preview`)也要分开测,开发模式下 React 会做很多额外检查,慢不少。

## 动手练习

**练习 1:跑起来。** 按上面的文件把前端代码放好,后端导入 `samples/` 里的三条 trace,打开 `http://localhost:5173`。依次检查:列表页能搜索、能按状态筛选;点进 `day09-cities` 能看到 10 步,三根 `get_weather` 的长条明显比别的长;点进一万步那条能流畅滚动;键盘 ↑↓←→ 都有效。

```bash
pnpm typecheck
pnpm build
```

我这里两个命令都通过,`build` 产出的 JS 大约 200 KB(gzip 后 65 KB 左右)。

**练习 2:填性能表。** 按「测量」一节的步骤,把上面那张表填完,写进 `docs/perf.md`。

**练习 3:给时间轴加缩放。** 一万步的运行总时长两个多小时,单个步骤的长条细得几乎看不见。给时间轴加一个缩放功能:在长条区域上按住 Ctrl(Mac 上是 Command)滚动鼠标滚轮时,以鼠标位置为中心放大或缩小时间范围。

<details><summary>参考思路</summary>

把「可见时间范围」做成状态 `[viewStart, viewEnd]`(毫秒,相对运行开始),初始是 `[0, total]`。长条的 left 和 width 改成相对这个范围计算:`(stepStart - viewStart) / (viewEnd - viewStart)`。滚轮事件里先算出鼠标位置对应的时间 `t = viewStart + (x / width) * (viewEnd - viewStart)`,缩放后保证 t 还在鼠标下面:新范围 `[t - (t - viewStart) * k, t + (viewEnd - t) * k]`,k 小于 1 是放大。刻度用新范围重新算。完全落在范围外的长条可以不渲染。注意 React 的 onWheel 是被动监听,要阻止页面滚动得用 `addEventListener('wheel', fn, { passive: false })`。

</details>

**验收标准**:`pnpm typecheck` 和 `pnpm build` 通过;三条样例 trace 都能正常打开,报错步骤是红色的;一万步时 DOM 里的 `.row` 数量在一百以内;`docs/perf.md` 里有虚拟滚动开和关两组数字,注明机器和浏览器。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 虚拟滚动(virtualization) | 只渲染视口内和附近的行,其余用一个撑高的空容器占位 |
| overscan | 虚拟滚动时视口外额外渲染的行数,用来遮住快速滚动时的空白 |
| 瀑布图(waterfall) | 每一项一根横条,横向位置表示开始时间、长度表示耗时,浏览器 Network 面板就是这种图 |
| 长任务(long task) | 主线程上超过 50 毫秒的任务,期间页面无法响应输入 |
| 防抖(debounce) | 连续触发时只在停下来一段时间后执行一次 |
| 引用相等 | 两个变量指向同一个对象;React 和 Zustand 用它判断状态有没有变 |
| 严格模式(StrictMode) | React 开发环境下的检查模式,会故意把 effect 执行两次以暴露清理问题 |
| nice number | 画坐标轴时把刻度间隔取成 1、2、5 乘以 10 的幂,让刻度读起来整齐 |
| Zustand | 一个很小的 React 状态管理库,组件可以只订阅需要的那部分状态 |

## 常见误区

**一万行直接 map 出来,想着「先做出来再优化」。** 时间轴是这个工具的核心交互,一开始就卡,后面所有功能都建立在卡顿上。虚拟滚动的代码量不大,第一天就该上。

**长条用像素定位。** 那就得测量容器宽度、监听窗口变化、处理侧边栏拖动。百分比定位一行 CSS 解决。

**直接修改 Set 或数组再 set 回去。** 引用没变,React 认为状态没变,界面不更新。每次创建新的集合。

**effect 里发请求不处理竞态。** 快速切换页面时,旧请求的结果会覆盖新页面的数据,界面显示错乱,而且很难复现。加一个 cancelled 标记,或者用 AbortController 直接取消请求。

**在开发模式下测性能。** 开发模式比生产构建慢不少,严格模式还会让 effect 执行两次。正式的数字要用 `pnpm build && pnpm preview` 测。

**性能结论没有对照组。** 「用了虚拟滚动,很流畅」说服力很弱;「关掉它首屏从多少变成多少、出现了几个长任务」才有说服力。

## 学习资料

### 文档与文章

- [TanStack Virtual 文档](https://tanstack.com/virtual/latest):看 Introduction 和 React 的「Fixed」示例,和我们的写法一一对应,30 分钟。
- [Zustand 文档:Maps and Sets Usage](https://zustand.docs.pmnd.rs/learn/guides/maps-and-sets-usage):专门讲在状态里放 Set 和 Map 时为什么要创建新对象,正对应我们 `toggle` 的写法;再顺手看一下同目录的 Updating state,15 分钟。
- [Chrome DevTools:Performance 面板](https://developer.chrome.com/docs/devtools/performance):官方教程,跟着它的示例页录一次,学会看 Main 线程和长任务标记,40 分钟。
- [web.dev:用 DevTools 找长任务](https://web.dev/articles/long-tasks-devtools):什么是长任务、为什么阈值是 50 毫秒,20 分钟。
- [React 文档:useMemo](https://react.dev/reference/react/useMemo):理解 `buildIndex` 和 `visibleRows` 为什么要包在 useMemo 里,15 分钟。
- [Vite 指南](https://vite.dev/guide/):看「Server Options」里 proxy 的配置,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pr4y1N7QZ&autoplay=0&high_quality=1" title="使用Chrome Performance进行性能调优" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>前夕Sama · 使用Chrome Performance进行性能调优 · 27 分钟,从录制到看懂火焰图和长任务,做「测量」一节之前看。2021 年的视频,面板布局和现在略有不同,概念不变。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cLBxYVEXz&autoplay=0&high_quality=1" title="不理解zustand?用不到50行代码带你手写zustand" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>玖一号机 · 不理解zustand?用不到50行代码带你手写zustand · 29 分钟,看完就明白为什么直接改 Set 不会触发更新。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/DBdo7mmuGx4" title="TanStack Virtual - Lightning Fast React Pages" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Austin Davis · TanStack Virtual - Lightning Fast React Pages · 27 分钟,从零写一个虚拟列表,固定行高和动态行高都讲了。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7A70hBrPL4I" title="Record and analyze a performance trace #DevToolsTips" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Chrome for Developers · Record and analyze a performance trace · 6 分钟,官方的录制和分析演示,短而准。</figcaption>
</figure>

### 书籍

- **Fluent React**,Tejas Kumar,O'Reilly,2024。讲 React 内部怎么工作的。读讲 reconciliation(协调)的那一章,理解 key 和重新渲染,对写高性能列表很有帮助,约 1 小时。
- **High Performance Browser Networking**,Ilya Grigorik,O'Reilly,2013(作者网站上可以免费在线读)。今天不用读,如果你对「为什么分页加载比一次加载快」想深入,读讲 HTTP 和延迟的部分。

### 开源项目与代码

- [TanStack/virtual](https://github.com/TanStack/virtual):`examples/react/fixed` 是和我们最接近的示例,不到 100 行。
- [pmndrs/zustand](https://github.com/pmndrs/zustand):核心代码 `src/vanilla.ts` 很短,读一遍就知道它是怎么通知组件更新的。

## 自测

1. 一万步的时间轴,虚拟滚动下 DOM 里大概有多少行?这个数字由什么决定?

<details><summary>答案</summary>

几十行(我这里打开时 45 行左右,滚动后 65 行左右)。它由视口高度除以行高,再加上上下各 overscan 行决定,和总步数无关。总步数只影响外层占位容器的高度。

</details>

2. `buildIndex` 计算深度时只扫一遍数组,没有用递归。它依赖了什么前提?如果前提不成立会怎样?

<details><summary>答案</summary>

依赖父步骤的 idx 小于子步骤,也就是数组里父亲一定在儿子前面。这样扫到某一步时,父亲的深度已经算好了。如果前提不成立,子步骤会读到一个还没算的父亲深度,默认当成 0,于是缩进错乱。这个前提由 Day 112 的 normalize 保证。

</details>

3. 为什么长条用 CSS 百分比定位而不是像素?

<details><summary>答案</summary>

百分比相对于父容器宽度,不需要用 JavaScript 测量容器、监听窗口大小变化;容器变宽变窄时长条自动缩放。像素定位要在每次尺寸变化时重算所有长条的位置。

</details>

4. `RunDetail` 的 effect 里如果不用 `cancelled` 标记,会出现什么问题?怎么复现?

<details><summary>答案</summary>

快速切换运行时,前一条运行的请求晚回来,会把后一条运行的步骤覆盖掉,界面显示 A 的标题和 B 的步骤。复现方法:打开一万步那条,在加载完成前马上点后退进入另一条;在 Network 面板里把网速限制成 Slow 3G 更容易复现。

</details>

5. 资深面试题:产品经理说「时间轴要支持十万步,还要能按名字过滤、按耗时排序」。你会怎么评估和设计?

<details><summary>答案</summary>

先算账:十万步的轻数据大约二三十 MB,前端全量拉下来可以但偏重,首屏会慢;渲染用虚拟滚动不是问题。过滤和排序如果放在前端,十万条数组的 filter 和 sort 在几十毫秒级,可以放在 useMemo 里,但要放进 Web Worker 避免阻塞主线程。更稳的方案是过滤排序放到后端,前端按需分页拉取,只保留当前窗口附近的数据,代价是滚动到远处时要等请求。先问清楚用户真实的 trace 规模和使用场景,用一份十万步的合成数据把两种方案各测一次,拿数字做决定。

</details>

6. 测性能时为什么要分开测开发模式和生产构建?

<details><summary>答案</summary>

开发模式下 React 带着大量开发期检查和警告,严格模式还会把 effect 执行两次,Vite 也不做打包优化,所以比生产构建慢不少。用户看到的是生产构建,性能结论要以它为准;开发模式的数字只能用来做前后对比。

</details>

## 明天预告

时间轴能看到「哪一步慢、哪一步错」,但还看不到「这一步里发生了什么」。明天(Day 115)做 **步骤详情、token 成本与上下文占用**:点开任意一步,看模型收到的完整 messages、它返回的工具调用和思考内容;把每次模型调用的上下文拆成系统提示词、工具定义、历史、工具结果几块,看各占多少;再画一张成本火焰图,一眼看出钱花在哪。
