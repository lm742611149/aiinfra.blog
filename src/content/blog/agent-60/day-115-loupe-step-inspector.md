---
title: 'Day 115 · Agent Loupe(四):步骤详情、token 成本与上下文占用'
description: '点开任意一步,看模型收到的完整 messages、返回的工具调用和思考内容;把每次模型调用的上下文拆成系统提示词、工具定义、历史、工具结果、本轮新增五块,看各占多少;再画一张上下文增长图和一张成本冰柱图,找出「哪一步把上下文撑大了」「钱花在了哪」。'
pubDate: 2026-10-15
regime: none
tags: ['agent-loupe', 'react', 'context-engineering', 'token-cost', 'agent-60']
series: 'agent-60'
day: 115
lang: 'zh'
---

## 今天要解决的问题

昨天的时间轴回答了「哪一步慢、哪一步错」。今天回答更深一层的问题:这一步里到底发生了什么,上下文为什么这么大,钱花在了哪。学完你应该能:

1. 写一个步骤详情面板,把模型调用的输入渲染成一条条可读的消息,工具调用的参数、思考内容、超长的工具结果都能折叠展开。
2. 写一个通用的 JSON 树组件,用来看任何不是消息格式的输入输出。
3. 把一次模型调用的上下文拆成五块,估算各占多少 token,并按真实的输入 token 校准。
4. 画一张上下文增长图,自动标出上下文涨得最多的那一步。
5. 画一张成本冰柱图(倒过来的火焰图),按成本或耗时看每棵子树的占比。

预计用时 5 到 6 小时。前置:Day 114 的前端;Day 112 定下的 llm 步输入输出格式;Day 11 的工具设计和 Day 20 的上下文工程(工具定义占 token、窗口预算、压缩)。

## 先看一个真实的例子

还是 Day 112 那条 Day 9 的运行。做完今天的代码以后,我点开第 3 步(第二次模型调用),详情面板的「概览」里显示这一次输入 639 个 token,上下文构成是这样的:

| 部分 | 估算 token | 占比 |
| --- | --- | --- |
| 系统提示词 | 35 | 5% |
| 工具定义 | 436 | 68% |
| 历史对话 | 128 | 20% |
| 历史工具结果 | 0 | 0% |
| 本轮新增 | 40 | 6% |

工具定义占了三分之二。三个工具的 JSON Schema,加上每个参数的描述,比用户的问题、系统提示词、模型上一轮的回复加起来还多。

切到「上下文增长」图,四次模型调用的输入 token 分别是 542、639、977、1117,工具自动把第 7 步标红,写着「涨得最多的是 #7,比上一次多了 338」。点开第 7 步看输入就明白了:第 4 到 6 步三次 `get_weather` 的结果全部塞进了上下文,每个结果都是一个带六个字段的 JSON。

切到「成本火焰图」,整条运行花了 0.00159 美元(按 Day 113 的价格表估算),四次模型调用分别是 0.00023、0.00041、0.00041、0.00055 美元。第 3 步输入只比第 1 步多 97 个 token,成本却多了将近一倍。原因在输出:第 3 步输出了 181 个 token,第 1 步只有 53 个,而 DeepSeek 输出的单价是输入的 4 倍。这次运行没有关掉思考模式,思考过程的 token 算在输出里。

这三个发现,用 Langfuse 也能得出来,但要点开 JSON 自己数、自己算。今天的目标就是让它们一眼可见。

## 渲染消息:能读,也能折叠

模型调用的 input 是 `{messages, tools}`,直接显示成 JSON 树也行,但读起来很累。按消息渲染,每条消息一个块,角色用颜色区分,工具调用单独列出来,才像是在「看对话」。

先写两个基础组件。超长文本折叠:

```tsx
// agent-loupe/web/src/components/LongText.tsx
import { useState } from 'react';

/** 超过 limit 个字符的文本先折叠。工具结果动不动几万字,全展开浏览器会卡 */
export function LongText({ text, limit = 800 }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  if (text.length <= limit) return <span className="pre">{text}</span>;
  return (
    <span className="pre">
      {open ? text : text.slice(0, limit) + '…'}
      <button className="link" onClick={() => setOpen(!open)}>
        {open ? '收起' : `展开全部(${text.length} 字)`}
      </button>
    </span>
  );
}
```

JSON 树:

```tsx
// agent-loupe/web/src/components/JsonTree.tsx
import { useState } from 'react';
import { LongText } from './LongText';

interface Props {
  value: unknown;
  name?: string;
  depth?: number;
}

/** 可折叠的 JSON 树。默认展开两层,再深的点开再看 */
export function JsonTree({ value, name, depth = 0 }: Props) {
  const [open, setOpen] = useState(depth < 2);
  const label = name !== undefined ? <span className="json-key">{name}: </span> : null;

  if (value === null || typeof value !== 'object') {
    const cls = `json-${value === null ? 'null' : typeof value}`;
    return (
      <div className="json-line" style={{ paddingLeft: depth * 14 }}>
        {label}
        {typeof value === 'string' ? <LongText text={JSON.stringify(value)} limit={300} /> : <span className={cls}>{String(value)}</span>}
      </div>
    );
  }

  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const brackets = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return (
    <div>
      <div className="json-line json-toggle" style={{ paddingLeft: depth * 14 }} onClick={() => setOpen(!open)}>
        {open ? '▾ ' : '▸ '}
        {label}
        {brackets[0]}
        {!open && <span className="hint"> {entries.length} 项 {brackets[1]}</span>}
      </div>
      {open && entries.map(([k, v]) => <JsonTree key={k} name={k} value={v} depth={depth + 1} />)}
      {open && <div className="json-line" style={{ paddingLeft: depth * 14 }}>{brackets[1]}</div>}
    </div>
  );
}
```

`LongText` 默认只显示前 800 个字符。这不只是为了好看:一个工具结果可能是几万字的网页内容,全部塞进 DOM,浏览器在这一个面板上就能卡住。点「展开全部」才渲染完整内容。

`JsonTree` 是递归组件:遇到对象或数组就渲染一个可折叠的节点,里面对每个键递归;遇到基本类型就渲染一行。默认展开两层,再深的点开再看。字符串值也用 `LongText` 包着,超过 300 个字符先折叠。

然后是消息:

```tsx
// agent-loupe/web/src/components/MessageView.tsx
import { JsonTree } from './JsonTree';
import { LongText } from './LongText';

interface ToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

export interface ChatMessage {
  role?: string;
  content?: unknown;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

function tryParse(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return s; // 模型偶尔会给出不合法的 JSON,原样显示,这本身就是要排查的线索
  }
}

function Body({ value }: { value: unknown }) {
  const parsed = tryParse(value);
  if (parsed == null) return <span className="hint">(空)</span>;
  if (typeof parsed === 'string') return <LongText text={parsed} />;
  return <JsonTree value={parsed} />;
}

export function MessageView({ msg }: { msg: ChatMessage }) {
  return (
    <div className={`msg role-${msg.role ?? 'unknown'}`}>
      <div className="msg-head">
        <span className="role">{msg.role}</span>
        {msg.tool_call_id && <span className="hint">回应 {msg.tool_call_id}</span>}
      </div>
      {msg.reasoning_content && (
        <details className="reasoning">
          <summary>思考过程({msg.reasoning_content.length} 字)</summary>
          <LongText text={msg.reasoning_content} />
        </details>
      )}
      {msg.content != null && <Body value={msg.content} />}
      {msg.tool_calls?.map((tc, i) => (
        <div key={tc.id ?? i} className="tool-call">
          <span className="tool-name">→ {tc.function?.name}</span>
          <span className="hint"> {tc.id}</span>
          <Body value={tc.function?.arguments} />
        </div>
      ))}
    </div>
  );
}
```

几个处理细节。

工具调用的 `arguments` 在 OpenAI 格式里是字符串,`tryParse` 先试着按 JSON 解析,成功就用 JSON 树显示,失败就原样显示字符串。解析失败本身就是一条线索:模型偶尔会给出不合法的 JSON(少个引号、多个逗号),Day 12 讲过这类故障。调试器把它原样亮出来,比偷偷吞掉要有用。

工具结果消息(`role: tool`)的 content 也是字符串,通常是 JSON,同样先试着解析。

`reasoning_content` 放在 `<details>` 里,默认折叠,摘要上显示字数。思考内容往往很长,而且大部分时候你不关心;但当模型做了一个奇怪的决定时,它是第一个要看的地方。

## 详情面板

```tsx
// agent-loupe/web/src/components/StepInspector.tsx
import { useEffect, useRef, useState } from 'react';
import { fetchStep, type StepFull } from '../api';
import { contextComposition } from '../lib/context';
import { fmtCost, fmtDuration, fmtTokens, ms } from '../lib/format';
import { ContextBar } from './ContextBar';
import { JsonTree } from './JsonTree';
import { MessageView, type ChatMessage } from './MessageView';

type Tab = 'overview' | 'input' | 'output' | 'raw';

export function StepInspector({ runId, idx }: { runId: string; idx: number }) {
  const cache = useRef(new Map<number, StepFull>()); // 来回点同几步时不重复请求
  const [step, setStep] = useState<StepFull | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    const hit = cache.current.get(idx);
    if (hit) {
      setStep(hit);
      return;
    }
    setStep(null);
    fetchStep(runId, idx)
      .then((s) => {
        cache.current.set(idx, s);
        if (!cancelled) setStep(s);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [runId, idx]);

  if (error) return <p className="bad">{error}</p>;
  if (!step) return <p className="hint">加载 #{idx}…</p>;

  const isLlm = step.kind === 'llm';
  const messages = isLlm ? ((step.input as { messages?: ChatMessage[] })?.messages ?? []) : [];

  return (
    <div>
      <div className="tabs">
        {(['overview', 'input', 'output', 'raw'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {{ overview: '概览', input: '输入', output: '输出', raw: '原始 JSON' }[t]}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <dl>
            <dt>步骤</dt><dd>#{step.idx} {step.name}</dd>
            <dt>类型</dt><dd>{step.kind}{step.model ? ` · ${step.model}` : ''}</dd>
            <dt>耗时</dt><dd>{fmtDuration(ms(step.started_at, step.ended_at))}</dd>
            <dt>token</dt><dd>输入 {fmtTokens(step.input_tokens)} · 输出 {fmtTokens(step.output_tokens)}</dd>
            <dt>成本</dt><dd>{fmtCost(step.cost_usd)}</dd>
            {step.error && (<><dt>错误</dt><dd className="bad">{step.error}</dd></>)}
          </dl>
          {isLlm && (
            <>
              <h3>上下文构成</h3>
              <ContextBar parts={contextComposition(step.input, step.input_tokens)} />
              <p className="hint">按字符数粗估比例,再按这一步真实的输入 token 缩放。{messages.length} 条消息。</p>
            </>
          )}
        </>
      )}

      {tab === 'input' && (isLlm ? messages.map((m, i) => <MessageView key={i} msg={m} />) : <JsonTree value={step.input} />)}
      {tab === 'output' &&
        (isLlm && step.output ? <MessageView msg={step.output as ChatMessage} /> : <JsonTree value={step.output} />)}
      {tab === 'raw' && <JsonTree value={step} />}
    </div>
  );
}
```

面板分四个标签页:概览、输入、输出、原始 JSON。

点开某一步时请求 `/api/runs/{id}/steps/{idx}`,拿到完整内容。用一个 `useRef` 存的 Map 做缓存,在几步之间来回点不会重复请求。为什么用 ref 而不是 state?缓存的变化不需要触发重新渲染,放在 state 里反而会多渲染一次。和昨天的 `RunDetail` 一样,effect 里有 `cancelled` 标记,快速按 ↓ 键连续切换步骤时,只有最后一步的结果会显示。

「输入」标签页对 llm 步按消息渲染,其他类型的步骤用 JSON 树;「输出」同理。「原始 JSON」把整个 step 对象用 JSON 树显示出来,这是兜底:任何渲染逻辑没覆盖到的字段,都能在这里看到。

## 上下文构成:五块,怎么切

一次模型调用的输入,我把它切成五块:

- **系统提示词**:`role: system` 的消息。
- **工具定义**:请求里的 `tools` 数组。很多人会忘记它也算输入 token,而且每次调用都要发一遍。
- **本轮新增**:最后一条 assistant 消息之后的所有消息。也就是上一次模型调用之后,新塞进上下文的东西:可能是用户的新问题,也可能是刚执行完的工具结果。
- **历史工具结果**:本轮新增之前的 `role: tool` 消息。
- **历史对话**:剩下的,也就是之前的 user 和 assistant 消息。

为什么要单独切出「本轮新增」?因为调试上下文问题时,最想知道的是「这一步比上一步多了什么」。如果第 7 步的本轮新增占了一大块,说明刚才那几个工具返回了太多东西,该去截断工具结果了(Day 12 的话题);如果历史对话越来越大,说明该做压缩或者摘要了(Day 63 的话题)。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="一次模型调用的 messages 按位置切成五块:系统提示词、历史对话、历史工具结果、最后一条 assistant 之后的本轮新增,以及请求里单独的工具定义">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第 7 步(第三次模型调用)的输入</text>
  <rect x="20" y="40" width="380" height="22" fill="none" stroke="var(--ink-soft)"/>
  <text x="30" y="56" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">system  你是一个做事很仔细的中文助手……</text>
  <rect x="20" y="66" width="380" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">user    读一下 cities.txt……</text>
  <rect x="20" y="92" width="380" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">assistant → read_file</text>
  <rect x="20" y="118" width="380" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="30" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">tool    cities.txt 的内容</text>
  <rect x="20" y="144" width="380" height="22" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2"/>
  <text x="30" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">assistant → get_weather ×3   ← 最后一条 assistant</text>
  <rect x="20" y="170" width="380" height="66" fill="none" stroke="var(--ink)" stroke-dasharray="4 3"/>
  <text x="30" y="188" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool    杭州 {...}</text>
  <text x="30" y="206" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool    成都 {...}</text>
  <text x="30" y="224" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool    哈尔滨 {...}</text>
  <text x="420" y="56" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">→ 系统提示词</text>
  <text x="420" y="96" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">→ 历史对话</text>
  <text x="420" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">→ 历史工具结果</text>
  <text x="420" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">→ 历史对话</text>
  <text x="420" y="206" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">→ 本轮新增</text>
  <rect x="20" y="252" width="380" height="26" fill="none" stroke="var(--ink-faint)"/>
  <text x="30" y="270" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">tools: [get_weather, calculate, read_file]</text>
  <text x="420" y="270" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">→ 工具定义</text>
</svg>
<figcaption>以最后一条 assistant 消息为界,之后的是本轮新增,之前的按角色分到历史对话和历史工具结果。工具定义不在 messages 里,但每次都会发。</figcaption>
</figure>

```ts
// agent-loupe/web/src/lib/context.ts
export type Segment = 'system' | 'tools' | 'history' | 'tool_results' | 'current';

export const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'system', label: '系统提示词' },
  { key: 'tools', label: '工具定义' },
  { key: 'history', label: '历史对话' },
  { key: 'tool_results', label: '历史工具结果' },
  { key: 'current', label: '本轮新增' },
];

/** 粗估 token:DeepSeek 文档给的经验值是 1 个英文字符约 0.3 token、1 个汉字约 0.6 token */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[　-〿一-鿿＀-￯]/.test(ch)) cjk++;
    else other++;
  }
  return cjk * 0.6 + other * 0.3;
}

interface Message {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
  reasoning_content?: unknown;
}

const textOf = (v: unknown) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * 把一次 llm 调用的输入拆成五块,各占多少 token。
 * 「本轮新增」= 最后一条 assistant 消息之后追加的内容,也就是上一步到这一步之间新塞进上下文的东西。
 * 估算值只用来算比例,最后按真实的 input_tokens 等比缩放。
 */
export function contextComposition(input: unknown, realInputTokens: number | null): Record<Segment, number> {
  const result: Record<Segment, number> = { system: 0, tools: 0, history: 0, tool_results: 0, current: 0 };
  const inp = (input ?? {}) as { messages?: Message[]; tools?: unknown };
  const messages = Array.isArray(inp.messages) ? inp.messages : [];
  result.tools = estimateTokens(textOf(inp.tools));

  let lastAssistant = -1;
  messages.forEach((m, i) => {
    if (m.role === 'assistant') lastAssistant = i;
  });
  messages.forEach((m, i) => {
    const t = estimateTokens(textOf(m.content) + textOf(m.tool_calls) + textOf(m.reasoning_content));
    if (m.role === 'system') result.system += t;
    else if (i > lastAssistant) result.current += t;
    else if (m.role === 'tool') result.tool_results += t;
    else result.history += t;
  });

  const estimated = Object.values(result).reduce((a, b) => a + b, 0);
  const scale = realInputTokens && estimated > 0 ? realInputTokens / estimated : 1;
  for (const s of SEGMENTS) result[s.key] = Math.round(result[s.key] * scale);
  return result;
}
```

### token 是估出来的,再用真实值校准

前端没有分词器,不知道每段文字精确是多少 token。我用的是 [DeepSeek 文档](https://api-docs.deepseek.com/quick_start/token_usage)给的经验值:一个英文字符大约 0.3 个 token,一个汉字大约 0.6 个 token。文档也说了,不同模型的比例不一样,以接口返回的用量为准。

所以估算值只用来算**比例**,不直接显示。最后一步是校准:把五块的估算值加起来,和这一步真实的 `input_tokens`(接口返回的、记在 trace 里的)相比,得到一个缩放系数,五块都乘上它。这样五块加起来正好等于真实值,比例来自估算。

这个方法有两个误差来源,要心里有数。一是字符到 token 的比例本身是粗估,中英文混排、大量 JSON 符号时会偏。二是服务端实际发给模型的文本比我们看到的 messages 多:每条消息有角色标记和分隔符,工具定义会被渲染成模型训练时见过的格式(Day 8 讲过),这些额外的 token 被等比摊到了五块上。对「哪一块占大头」这个问题,这个精度够用了;要精确数字,得用对应模型的分词器离线算,这是练习 3。

```tsx
// agent-loupe/web/src/components/ContextBar.tsx
import { SEGMENTS, type Segment } from '../lib/context';
import { fmtTokens } from '../lib/format';

/** 一条横向堆叠条:这一次 llm 调用的上下文,各部分各占多少 */
export function ContextBar({ parts }: { parts: Record<Segment, number> }) {
  const total = SEGMENTS.reduce((a, s) => a + parts[s.key], 0) || 1;
  return (
    <div className="ctx">
      <div className="ctx-bar">
        {SEGMENTS.map((s) => (
          <div
            key={s.key}
            className={`ctx-seg seg-${s.key}`}
            style={{ width: `${(parts[s.key] / total) * 100}%` }}
            title={`${s.label} ≈ ${fmtTokens(parts[s.key])}`}
          />
        ))}
      </div>
      <ul className="ctx-legend">
        {SEGMENTS.map((s) => (
          <li key={s.key}>
            <i className={`seg-${s.key}`} />
            {s.label} {fmtTokens(parts[s.key])}({Math.round((parts[s.key] / total) * 100)}%)
          </li>
        ))}
      </ul>
    </div>
  );
}
```

一条横向的堆叠条,每块的宽度是它的占比,下面是图例和具体数字。鼠标悬停在某一块上有提示。

## 上下文增长图

```tsx
// agent-loupe/web/src/components/ContextGrowth.tsx
import { useMemo } from 'react';
import type { StepLight } from '../api';
import { fmtTokens } from '../lib/format';
import { useUi } from '../store';

/** 每次 llm 调用的输入 token 画成柱子;涨得最猛的那一步标出来 */
export function ContextGrowth({ steps }: { steps: StepLight[] }) {
  const select = useUi((s) => s.select);
  const selectedIdx = useUi((s) => s.selectedIdx);
  const llm = useMemo(() => steps.filter((s) => s.kind === 'llm' && s.input_tokens != null), [steps]);

  const { max, jumpIdx, jump } = useMemo(() => {
    let max = 1;
    let jump = 0;
    let jumpIdx = -1;
    llm.forEach((s, i) => {
      max = Math.max(max, s.input_tokens!);
      const d = i > 0 ? s.input_tokens! - llm[i - 1].input_tokens! : 0;
      if (d > jump) [jump, jumpIdx] = [d, s.idx];
    });
    return { max, jumpIdx, jump };
  }, [llm]);

  if (llm.length === 0) return <p className="hint">这条运行里没有带 token 数的 llm 步骤。</p>;
  const W = 1000;
  const H = 60;
  const bw = W / llm.length;

  return (
    <div className="growth">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="每次模型调用的输入 token">
        {llm.map((s, i) => {
          const h = (s.input_tokens! / max) * (H - 2);
          const cls = s.idx === selectedIdx ? 'g-sel' : s.idx === jumpIdx ? 'g-jump' : 'g-bar';
          return (
            <rect key={s.idx} className={cls} x={i * bw} y={H - h} width={Math.max(bw - 1, 0.5)} height={h} onClick={() => select(s.idx)}>
              <title>#{s.idx} 输入 {fmtTokens(s.input_tokens)}</title>
            </rect>
          );
        })}
      </svg>
      <p className="hint">
        {llm.length} 次模型调用,最大输入 {fmtTokens(max)}。
        {jumpIdx >= 0 && (
          <>
            涨得最多的是{' '}
            <button className="link" onClick={() => select(jumpIdx)}>
              #{jumpIdx}
            </button>
            ,比上一次多了 {fmtTokens(jump)}。
          </>
        )}
      </p>
    </div>
  );
}
```

只看 llm 步骤,每次调用一根柱子,高度是输入 token。SVG 用 `viewBox="0 0 1000 60"` 加 `preserveAspectRatio="none"`,横向拉伸填满容器,柱子的宽度自动适配调用次数:4 次调用是四根粗柱子,三千次调用是一片细线。

「涨得最多」的定义是和上一次调用相比增量最大的那一步,标成红色,下面的文字里可以直接点过去。为什么看增量而不是看最大值?因为最大值几乎总是最后一步,上下文只会越来越长,看最大值没有信息量;增量最大的那一步,才是「哪里塞进来了一大坨东西」。

Zustand 在这里体现出好处:`useUi((s) => s.select)` 只订阅了 `select` 这个函数和 `selectedIdx`,时间轴折叠状态的变化不会让这张图重新渲染。点图上的柱子调用 `select`,时间轴和详情面板同时跟着变,三个组件之间没有任何 props 传递。

## 成本冰柱图

```tsx
// agent-loupe/web/src/components/CostFlame.tsx
import { useMemo, useState } from 'react';
import type { StepLight } from '../api';
import { fmtCost, fmtDuration, ms } from '../lib/format';
import { buildIndex } from '../lib/tree';
import { useUi } from '../store';

type Metric = 'cost' | 'time';

interface Box {
  idx: number;
  name: string;
  kind: string;
  x: number;
  w: number;
  depth: number;
  value: number;
}

/**
 * 冰柱图(倒过来的火焰图):每个方块的宽度 = 这一步加上它所有子步骤的成本(或耗时)。
 * 一眼看出钱花在哪棵子树上。
 */
export function CostFlame({ steps }: { steps: StepLight[] }) {
  const [metric, setMetric] = useState<Metric>('cost');
  const select = useUi((s) => s.select);

  const { boxes, maxDepth, total } = useMemo(() => {
    const index = buildIndex(steps);
    const own = (s: StepLight) => (metric === 'cost' ? s.cost_usd ?? 0 : ms(s.started_at, s.ended_at));
    const subtotal = new Map<number, number>();
    // idx 越大越晚开始,子步骤一定比父步骤大,倒着扫一遍就能自底向上累加
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      const kids = index.children.get(s.idx) ?? [];
      const kidsSum = kids.reduce((a, k) => a + (subtotal.get(k) ?? 0), 0);
      // 耗时:父步骤本身就包含了子步骤的时间,不能再加一遍
      subtotal.set(s.idx, metric === 'cost' ? own(s) + kidsSum : Math.max(own(s), kidsSum));
    }
    const roots = index.children.get(null) ?? [];
    const total = roots.reduce((a, r) => a + (subtotal.get(r) ?? 0), 0) || 1;
    const boxes: Box[] = [];
    let maxDepth = 0;
    const place = (idx: number, x: number, depth: number) => {
      const value = subtotal.get(idx) ?? 0;
      const w = value / total;
      if (w < 0.001) return; // 太窄画不出来,省掉
      const s = index.byIdx.get(idx)!;
      boxes.push({ idx, name: s.name, kind: s.kind, x, w, depth, value });
      maxDepth = Math.max(maxDepth, depth);
      let cx = x;
      for (const k of index.children.get(idx) ?? []) {
        place(k, cx, depth + 1);
        cx += (subtotal.get(k) ?? 0) / total;
      }
    };
    let rx = 0;
    for (const r of roots) {
      place(r, rx, 0);
      rx += (subtotal.get(r) ?? 0) / total;
    }
    return { boxes, maxDepth, total };
  }, [steps, metric]);

  const W = 1000;
  const ROW = 22;
  const fmt = (v: number) => (metric === 'cost' ? fmtCost(v) : fmtDuration(v));

  return (
    <div className="flame">
      <div className="tabs">
        <button className={metric === 'cost' ? 'active' : ''} onClick={() => setMetric('cost')}>按成本</button>
        <button className={metric === 'time' ? 'active' : ''} onClick={() => setMetric('time')}>按耗时</button>
        <span className="hint">合计 {fmt(total)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${(maxDepth + 1) * ROW}`} role="img" aria-label="成本冰柱图">
        {boxes.map((b) => (
          <g key={b.idx} onClick={() => select(b.idx)} className={`fl kind-${b.kind}`}>
            <rect x={b.x * W} y={b.depth * ROW} width={Math.max(b.w * W - 1, 1)} height={ROW - 2} />
            {/* 文字大约 7 个单位一个字符,放不下就不画,鼠标悬停看 title */}
            {`${b.name} ${fmt(b.value)}`.length * 7 < b.w * W - 8 && (
              <text x={b.x * W + 4} y={b.depth * ROW + 15}>
                {b.name} {fmt(b.value)}
              </text>
            )}
            <title>#{b.idx} {b.name}:{fmt(b.value)}({Math.round(b.w * 100)}%)</title>
          </g>
        ))}
      </svg>
    </div>
  );
}
```

火焰图是 Brendan Gregg 发明的,用来看 CPU 时间花在了哪个调用栈上:每个方块是一个函数,宽度是它(连同它调用的所有函数)占的时间,子函数叠在父函数上面。我们画的是倒过来的版本,根在上、子在下,通常叫冰柱图(icicle chart),读法一样。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="成本冰柱图示意:根节点 agent.run 占满整行,下面一行是四次模型调用,宽度按各自成本占比">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="600" height="34" fill="none" stroke="var(--ink-soft)"/>
  <text x="30" y="52" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">agent.run  $0.00159(子树合计)</text>
  <rect x="20" y="70" width="85" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="62" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">#1</text>
  <rect x="107" y="70" width="154" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="184" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">#3 $0.00041</text>
  <rect x="263" y="70" width="155" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="340" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">#7 $0.00041</text>
  <rect x="420" y="70" width="200" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="520" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">#9 $0.00055</text>
  <text x="20" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">按成本:工具没有成本,宽度为 0,不画</text>
  <text x="20" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">按耗时:父节点 = max(自身耗时, 子节点耗时之和)</text>
  <text x="20" y="184" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">  因为父步骤的时间本来就包含了子步骤</text>
  <text x="20" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">宽度 = 子树合计 / 根合计;同一层的兄弟节点从左到右排</text>
</svg>
<figcaption>Day 9 那条运行按成本看:四次模型调用,最后一次最贵。第 1 步的方块太窄,放不下文字,鼠标悬停看具体数字。</figcaption>
</figure>

计算分两步。

第一步,自底向上算每个节点的子树合计。又一次用到了「父步骤 idx 小于子步骤」:从数组末尾往前扫,扫到某一步时,它所有子步骤的合计都已经算好了。按成本时,子树合计 = 自身成本 + 子步骤合计;按耗时时不能这么加,父步骤 `agent.run` 的 24 秒本身就包含了所有子步骤的时间,再加一遍就成了 48 秒。所以耗时取 `max(自身, 子步骤之和)`。用 max 而不是直接取自身,是为了处理子步骤并发执行或者时间记录有误差时,子步骤之和超过父步骤的情况,保证子方块不会画出父方块的边界。

第二步,自顶向下摆位置。根节点从 0 开始,宽度是它的合计除以总合计;每个子节点的起点是父节点的起点加上它前面兄弟们的宽度。宽度小于千分之一的节点不画,一万步的运行里有大量这样的细碎节点,画出来只是一堆一像素宽的线。

方块上的文字只在放得下的时候画,按一个字符大约 7 个单位粗估,放不下就只留方块,鼠标悬停时 `<title>` 会显示完整信息。

## 拼到详情页上

```tsx
// agent-loupe/web/src/pages/RunDetail.tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchAllSteps, fetchRun, type Run, type StepLight } from '../api';
import { ContextGrowth } from '../components/ContextGrowth';
import { CostFlame } from '../components/CostFlame';
import { StepInspector } from '../components/StepInspector';
import { Timeline } from '../components/Timeline';
import { fmtCost, fmtDuration, fmtTokens, ms } from '../lib/format';
import { useUi } from '../store';

type Overview = 'growth' | 'flame' | 'none';

export function RunDetail() {
  const { id = '' } = useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<StepLight[] | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<Overview>('growth');
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
      {steps && (
        <section className="overview">
          <div className="tabs">
            <button className={overview === 'growth' ? 'active' : ''} onClick={() => setOverview('growth')}>上下文增长</button>
            <button className={overview === 'flame' ? 'active' : ''} onClick={() => setOverview('flame')}>成本火焰图</button>
            <button className={overview === 'none' ? 'active' : ''} onClick={() => setOverview('none')}>收起</button>
          </div>
          {overview === 'growth' && <ContextGrowth steps={steps} />}
          {overview === 'flame' && <CostFlame steps={steps} />}
        </section>
      )}
      <div className="split">
        {steps ? <Timeline steps={steps} runStart={run.started_at} runEnd={run.ended_at} /> : <p className="hint">{progress}</p>}
        <aside className="inspector">
          {selectedIdx != null ? (
            <StepInspector runId={run.id} idx={selectedIdx} />
          ) : (
            <p className="hint">点左边任意一步,或者用 ↑↓ 键移动、←→ 折叠展开。</p>
          )}
        </aside>
      </div>
    </main>
  );
}
```

和昨天的版本比,多了两样:时间轴上面一个概览区,可以在「上下文增长」「成本火焰图」之间切换,也可以收起来给时间轴腾地方;右边的详情面板换成了 `StepInspector`。

样式追加到 `index.css` 末尾:

```css
/* ---- Day 115 新增:详情面板、上下文、火焰图 ---- */
.tabs { display: flex; gap: 4px; align-items: center; margin-bottom: 8px; }
.tabs button { border-color: transparent; }
.tabs button.active { border-color: var(--line); background: var(--bg); font-weight: 600; }
button.link { border: 0; background: none; color: var(--llm); padding: 0 2px; cursor: pointer; }
.inspector h3 { font-size: 13px; margin: 16px 0 6px; }
.pre { white-space: pre-wrap; word-break: break-word; }
.json-line { font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 1.6; }
.json-toggle { cursor: pointer; }
.json-key { color: var(--soft); }
.json-number { color: var(--llm); }
.json-boolean, .json-null { color: var(--other); }
.msg { border-left: 3px solid var(--line); padding: 6px 10px; margin-bottom: 10px; }
.msg-head { display: flex; gap: 8px; margin-bottom: 4px; }
.role { font-weight: 600; text-transform: uppercase; font-size: 11px; }
.role-system { border-color: var(--faint); }
.role-user { border-color: var(--good); }
.role-assistant { border-color: var(--llm); }
.role-tool { border-color: var(--tool); }
.tool-call { margin-top: 6px; }
.tool-name { color: var(--tool); font-weight: 600; }
.reasoning summary { cursor: pointer; color: var(--soft); }
.ctx-bar { display: flex; height: 14px; border-radius: 3px; overflow: hidden; background: var(--line); }
.ctx-legend { list-style: none; padding: 0; margin: 6px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; }
.ctx-legend i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 2px; }
.seg-system { background: var(--agent); }
.seg-tools { background: var(--other); }
.seg-history { background: var(--llm); }
.seg-tool_results { background: var(--tool); }
.seg-current { background: var(--good); }
.overview { background: var(--panel); border: 1px solid var(--line); padding: 8px 12px; margin-bottom: 12px; }
.growth svg { width: 100%; height: 60px; display: block; }
.g-bar { fill: var(--llm); opacity: 0.55; cursor: pointer; }
.g-jump { fill: var(--bad); cursor: pointer; }
.g-sel { fill: var(--llm); cursor: pointer; }
.flame svg { width: 100%; display: block; }
.fl { cursor: pointer; }
.fl rect { fill: var(--other); opacity: 0.8; }
.fl.kind-llm rect { fill: var(--llm); }
.fl.kind-tool rect { fill: var(--tool); }
.fl.kind-agent rect { fill: var(--agent); opacity: 0.5; }
.fl text { font-size: 11px; fill: #fff; pointer-events: none; }
```

## 动手练习

**练习 1:跑起来,复现我的三个发现。** 把今天的组件放好,`pnpm typecheck`、`pnpm build` 通过以后,打开你自己 Day 112 产出的那条 Day 9 的 trace,回答:

1. 第二次模型调用里,工具定义占了多少?
2. 上下文涨得最多的是哪一步?点开它的「输入」,是哪几条消息带来的增长?
3. 按成本看,最贵的是哪次调用?它贵在输入还是输出?

你的数字和我的不会完全一样(模型每次的回答长度不同),但结构上的结论应该差不多。

**练习 2:用调试器指导一次优化。** 根据练习 1 的发现,对 Day 9 的 Agent 做一处改动,再跑一次,导入,对比两条运行的上下文和成本。可选的改动:

- 精简三个工具的 description 和参数说明,看工具定义的占比降了多少。
- 让 `get_weather` 只返回 `city`、`temperature`、`weather` 三个字段,看第 7 步的增量降了多少。
- 在 `agent_loop.py` 里给模型调用加上 `extra_body={"thinking": {"type": "disabled"}}`,看输出 token 和成本的变化(注意 Day 8 讲过:DeepSeek 带 tools 时,思考模式下要回传 reasoning_content)。

把改动前后的数字记在 `docs/findings.md` 里。这份记录 Day 120 写 README 时就是现成的「用这个工具发现并解决了什么问题」的案例。

**练习 3:精确计数。** 在后端加一个接口 `GET /api/runs/{id}/steps/{idx}/context`,用真实的分词器计算五块各自的 token 数,前端优先用它,接口失败时退回到估算。分词器可以用 Hugging Face `tokenizers` 库加载 DeepSeek 发布的 tokenizer 文件。

<details><summary>参考思路</summary>

后端复用前端的切分规则(最后一条 assistant 之后是本轮新增……),每块拼成文本后用 `tokenizer.encode(text).ids` 计数。注意两点:一是要和你实际用的模型的分词器一致,不同模型差别很大;二是即使用了真分词器,五块之和也不会正好等于接口返回的 input_tokens,因为服务端还加了消息模板和工具渲染格式,差值可以单独显示成「格式开销」一块。分词器文件几 MB,加载一次缓存起来,别每次请求都加载。

</details>

**验收标准**:`pnpm typecheck` 和 `pnpm build` 通过;点开 llm 步能看到按消息渲染的输入、工具调用参数和折叠的思考内容;上下文构成条五块之和等于这一步的输入 token;增长图标出了增量最大的一步;火焰图能在成本和耗时之间切换;`docs/findings.md` 里有一次「发现问题 → 改动 → 前后数字对比」的完整记录。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 上下文构成 | 一次模型调用的输入里,各类内容(系统提示词、工具定义、历史、工具结果)各占多少 token |
| 本轮新增 | 最后一条 assistant 消息之后追加的消息,也就是两次模型调用之间新进入上下文的内容 |
| 校准 | 用估算值算比例,再按真实总数等比缩放 |
| 分词器(tokenizer) | 把文本切成 token 的程序,每个模型有自己的分词器 |
| 火焰图(flame graph) | Brendan Gregg 提出的可视化,方块宽度表示时间或资源占比,上下层表示调用关系 |
| 冰柱图(icicle chart) | 倒过来的火焰图,根在上、子在下 |
| 子树合计 | 一个节点自身加上它所有后代的值 |
| 递归组件 | 在自己的渲染结果里再渲染自己的组件,适合树形数据 |
| `<details>` | HTML 原生的折叠元素,不需要 JavaScript |

## 常见误区

**以为上下文里只有 messages。** 工具定义每次都会发,工具一多,它可能是上下文里最大的一块。我们的例子里它占了三分之二。

**把估算的 token 数当精确值显示。** 字符到 token 的比例只是经验值,直接显示估算值,五块加起来和真实值对不上,用户会困惑。用真实值校准,并在界面上写明是估算比例。

**超长内容不折叠。** 一个网页抓取工具的结果可能几万字,全部渲染进详情面板,这一个面板就能让页面卡顿。先截断,点开再渲染全部。

**按耗时画火焰图时父子相加。** 父步骤的时间已经包含了子步骤,相加会重复计算。成本可以相加(agent 步骤本身没有成本),耗时不行。

**看上下文的最大值找问题。** 上下文只增不减,最大值几乎总是最后一步。要看增量。

**JSON 解析失败就不显示。** 模型生成的参数不合法,恰恰是要排查的问题。原样显示出来,让人看见。

## 学习资料

### 文档与文章

- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):Anthropic 工程博客讲上下文工程,其中讲工具定义和工具结果占用上下文的部分,正是今天这张构成图要帮你看见的东西,30 分钟。
- [DeepSeek:Token 用量计算](https://api-docs.deepseek.com/quick_start/token_usage):中英文字符和 token 的经验比例出处,5 分钟。
- [Brendan Gregg:Flame Graphs](https://www.brendangregg.com/flamegraphs.html):火焰图发明者的主页,读开头的说明,再在页面里搜 icicle,看他怎么解释倒过来画的好处,20 分钟。
- [MDN:details 元素](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Element/details):原生折叠元素的用法和无障碍特性,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1w3GNzeEHb&autoplay=0&high_quality=1" title="🗃️ 上下文工程:优化 Agent 效能的关键技术 🔑" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · 上下文工程:优化 Agent 效能的关键技术 · 22 分钟,讲上下文里都有什么、怎么压缩,看完再去看你的构成图,会知道每一块该怎么优化。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EyypY7EGP&autoplay=0&high_quality=1" title="前端开发小技巧--Performance火焰图怎么看" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>被删 · 前端开发小技巧--Performance火焰图怎么看 · 10 分钟,用浏览器的火焰图讲读法,宽度、层级、颜色分别是什么意思,和我们的成本冰柱图是同一个读法。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/VMpTU15rIZY" title="Visualizing Performance - The Developers' Guide to Flame Graphs • Brendan Gregg • YOW! 2022" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GOTO Conferences · Brendan Gregg:The Developers' Guide to Flame Graphs · 50 分钟,发明者本人讲火焰图怎么读、为什么这样设计,前 15 分钟就够用。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4GiqzUHD5AA" title="Context Engineering for Agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Context Engineering for Agents · 22 分钟,把上下文管理分成写入、选择、压缩、隔离几类策略,可以对照构成图想每一块该用哪种策略。</figcaption>
</figure>

### 书籍

- **Systems Performance(第 2 版)**,Brendan Gregg,Addison-Wesley,2020。第 6 章讲 CPU 分析,里面有专门讲火焰图怎么读的一节;今天只读那一节,约 20 分钟。
- **AI Engineering**,Chip Huyen,O'Reilly,2025。第 9 章讲推理优化,其中关于输入和输出 token 成本差异、上下文长度对成本和延迟影响的部分,能帮你解读今天的成本图,约 40 分钟。

### 开源项目与代码

- [brendangregg/FlameGraph](https://github.com/brendangregg/FlameGraph):火焰图的原始实现,`flamegraph.pl` 里计算方块位置的那段逻辑和我们的 `place` 函数是一个思路。
- [jlfwong/speedscope](https://github.com/jlfwong/speedscope):一个交互式的火焰图查看器,看它的 Left Heavy 视图怎么把相同调用栈合并,可以作为练习的延伸。

## 自测

1. 「本轮新增」是怎么定义的?为什么要单独切出这一块?

<details><summary>答案</summary>

最后一条 assistant 消息之后的所有消息,也就是上一次模型调用之后新进入上下文的东西,通常是刚执行完的工具结果或用户的新问题。单独切出来是因为调试时最想知道「这一步比上一步多了什么」,它直接指向该截断哪个工具结果。

</details>

2. 前端估算的 token 数为什么还要按真实的 input_tokens 缩放?缩放后还有什么误差?

<details><summary>答案</summary>

估算用的是字符到 token 的经验比例,本身不准,直接显示的话五块加起来和真实值对不上。缩放后总数准确,比例来自估算。剩余误差有两部分:经验比例在 JSON 符号多、中英混排时会偏;服务端额外加的消息模板和工具渲染格式被等比摊到了五块上。

</details>

3. 成本冰柱图按耗时计算时,为什么父节点取 `max(自身, 子节点之和)` 而不是相加?

<details><summary>答案</summary>

父步骤(比如 agent.run)的耗时本来就覆盖了它所有子步骤的执行时间,相加会重复计算。取 max 而不是只取自身,是为了处理子步骤并发或时间记录误差导致子步骤之和超过父步骤的情况,保证子方块不会画出父方块的边界。

</details>

4. 我们的例子里,第 3 步输入只比第 1 步多 97 个 token,成本却几乎翻倍,为什么?

<details><summary>答案</summary>

差别在输出:第 3 步输出 181 个 token,第 1 步只有 53 个,而 DeepSeek 输出的单价是输入的 4 倍。这次没有关闭思考模式,思考过程的 token 也计入输出。看成本不能只盯着输入。

</details>

5. 资深面试题:你的 Agent 有 40 个工具,工具定义占了每次调用输入的 70%。你会怎么优化?怎么证明优化有效?

<details><summary>答案</summary>

几个方向:按任务阶段或意图动态挑选工具子集,每次只发相关的几个(工具检索,先用一个小模型或向量检索选工具);精简描述和参数说明,去掉模型用不到的字段;合并功能重叠的工具;利用 prompt caching,把工具定义放在稳定的前缀里让缓存命中,降低成本(但不降低占用的上下文长度)。证明有效要两方面一起看:成本和延迟要降,同时评测集上的任务成功率和工具选择准确率不能掉;动态选工具最容易出的问题是该用的工具没被选上。用 Day 69 的统计方法确认变化是否显著。

</details>

6. 为什么详情面板的缓存用 `useRef` 存而不是 `useState`?

<details><summary>答案</summary>

缓存的内容变化不需要触发重新渲染,界面显示的是 `step` 这个 state。放在 state 里,每存一条缓存都会多渲染一次,而且还要处理旧缓存的不可变更新。ref 是一个在多次渲染之间保持不变的可变容器,正适合放这种「只读写、不驱动界面」的数据。

</details>

## 明天预告

一条运行已经能看得很清楚了。明天(Day 116)做这个项目的第一个核心卖点:**两次运行逐步对比**。改了提示词以后,两次运行从哪一步开始不一样?我们会给每一步算一个签名,用 LCS 算法把两条序列对齐,标出相同、改变、新增、删除,再做一个并排视图和逐词 diff。
