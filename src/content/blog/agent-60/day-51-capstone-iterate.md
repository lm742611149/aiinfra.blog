---
title: 'Day 51 · 迭代:按错误分析改 prompt、工具和检索,把分数提上去'
description: '拿着 Day 50 的基线报告做错误分析:读失败用例、写一句话笔记、归类、计数、挑最多的先修。修法分四种:改代码规则、改检索、改提示词、改评测集本身。每次只改一处,在 dev 上跑并记进改动日志;最后跑一次 test,看提升是不是真的。附我在写这个项目时实际踩到的四个 bug。'
pubDate: 2026-10-12
regime: none
tags: ['capstone', 'error-analysis', 'evals', 'prompt-engineering', 'iteration', 'supportpilot', 'agent-60']
series: 'agent-60'
day: 51
lang: 'zh'
---

## 今天要解决的问题

昨天你拿到了第一份基线分数,还有一长串失败用例。大部分人这时候的反应是:打开提示词,看哪里不顺眼改哪里,改完跑一遍,分数涨了就高兴,跌了就改回去。这样做一两轮还行,五六轮之后你就说不清哪个改动起了作用、哪个是在帮倒忙,也说不清现在的提示词为什么长这样。

今天学的是一套更慢但更可靠的流程。Hamel Husain 把它叫作 AI 工程里投入产出比最高的事情:错误分析。

今天结束时你应该做到:

1. 对基线报告里的失败用例做一次完整的错误分析:逐条读、写笔记、归类、计数,得到一张"失败类型 × 数量"的表。
2. 判断每类失败该在哪一层修:代码规则、检索、提示词,还是评测集本身错了。
3. 按"一次只改一处"的原则做至少 4 轮改动,每轮都记进改动日志,写清楚改了什么、分数怎么变。
4. 改完后跑一次 test 集,判断 dev 上的提升有没有泛化。
5. 能在面试里讲一个"我是怎么把分数从 X 提到 Y 的"完整故事。

预计用时 5–8 小时,取决于你的失败用例有多少。评测每跑一次 dev 大约 ¥3、20–30 分钟,今天可能跑六七次。前置:Day 30(错误分析)、Day 50。

## 错误分析:先读,再分类,再数

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="错误分析与迭代循环">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="90" width="100" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="60" y="112" text-anchor="middle" fill="var(--ink)">跑 dev</text>
<text x="60" y="128" text-anchor="middle" fill="var(--ink-soft)">出报告</text>
<rect x="135" y="20" width="110" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="190" y="42" text-anchor="middle" fill="var(--ink)">逐条读失败</text>
<text x="190" y="58" text-anchor="middle" fill="var(--ink-soft)">写一句话笔记</text>
<rect x="270" y="20" width="110" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="325" y="42" text-anchor="middle" fill="var(--ink)">归类 + 计数</text>
<text x="325" y="58" text-anchor="middle" fill="var(--ink-soft)">挑最多的一类</text>
<rect x="405" y="20" width="110" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="460" y="42" text-anchor="middle" fill="var(--ink)">定位该修哪层</text>
<text x="460" y="58" text-anchor="middle" fill="var(--ink-soft)">规则/检索/提示/题</text>
<rect x="530" y="90" width="100" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="580" y="112" text-anchor="middle" fill="var(--ink)">只改一处</text>
<text x="580" y="128" text-anchor="middle" fill="var(--ink-soft)">写测试</text>
<rect x="270" y="160" width="110" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="325" y="182" text-anchor="middle" fill="var(--ink)">记改动日志</text>
<text x="325" y="198" text-anchor="middle" fill="var(--ink-soft)">涨了留,跌了撤</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3" fill="none">
<path d="M60 90 L 150 70"/><line x1="245" y1="45" x2="268" y2="45"/><line x1="380" y1="45" x2="403" y2="45"/>
<path d="M515 60 L 565 88"/><path d="M570 140 L 380 185"/><path d="M270 185 L 60 140"/>
</g>
</svg>
<figcaption>一轮迭代。最耗时间的是左上那两步:读失败用例、写笔记、归类。这两步省了,后面所有改动都是在猜。</figcaption>
</figure>

### 第一步:导出失败用例,逐条读

```python
# supportpilot/evals/failures_to_csv.py
"""把一份评测报告里的失败用例导成 CSV,用表格软件做错误分析(开放编码)。
uv run python -m evals.failures_to_csv evals/reports/xxx-dev-baseline.json > failures.csv

导出后加两列:note(读完这条你觉得哪里不对,一句话,自由写)和 bucket(第二遍归类时填)。"""

import csv
import json
import sys


def main(path: str) -> None:
    report = json.load(open(path, encoding="utf-8"))
    w = csv.writer(sys.stdout)
    w.writerow(["id", "failed_checks", "category", "tools", "refund_created", "outcome", "reply",
                "findings", "judge_critique", "note", "bucket"])
    for r in report["results"]:
        if r["all_pass"]:
            continue
        run = r["run"]
        failed = [k for k, v in r["scores"].items() if v is False]
        critique = " / ".join(v for k, v in run.get("judge", {}).items() if k.endswith("critique"))
        w.writerow([r["id"], ",".join(failed), run["category"], " > ".join(run["tool_names"]),
                    run["refund_created"], run["outcome"], run["text"][:300], run["findings"][:300],
                    critique[:300], "", ""])


if __name__ == "__main__":
    main(sys.argv[1])
```

<div class="line-notes">

- `"""把一份评测报告里的失败用例导成 CSV` 下面的数据来自我在本机临时库里真跑的一份小报告:只跑了 `refund_ask_only`、`past_due`、`legal_threat`、`import_format` 四个场景,共 13 条,4 条全通过、9 条失败,花了大约 ¥0.26。
- `import csv` 标准库的 CSV 读写。中文、逗号、换行都会被自动加引号转义,比自己拼字符串可靠。
- `report = json.load(open(path, encoding="utf-8"))` `json.load` 读文件对象(`json.loads` 读字符串)。报告顶层有 `results` 列表,每条的键是 `id, scenario, expect_category, scores, all_pass, run`。
- `w = csv.writer(sys.stdout)` 直接写到标准输出,命令行里用 `> failures.csv` 重定向到文件。
- `w.writerow(["id", "failed_checks", "category", "tools", "refund_created", "outcome", "reply",` 表头 11 列,最后 `note` 和 `bucket` 两列留空给你手填。
- `if r["all_pass"]:` 全通过的跳过。实测 13 条里 `import_format-2` 和 `legal_threat-1/2/3` 被跳过,导出 9 行。
- `failed = [k for k, v in r["scores"].items() if v is False]` 用 `is False` 而不是 `not v`:`scores` 里 `None` 表示「这条用例不考这一项」(比如 `must_call: None`),不能算失败。实测 `past_due-3` 得到 `['retrieval_hit', 'judge_grounded', 'judge_resolved']`。
- `critique = " / ".join(v for k, v in run.get("judge", {}).items() if k.endswith("critique"))` 评审结果里 `grounded`、`resolved` 是布尔值,`grounded_critique`、`resolved_critique` 是理由文字,只取理由。没跑评审的用例 `judge` 不存在,`.get(..., {})` 给空字典,join 出空串。
- `w.writerow([r["id"], ",".join(failed), run["category"], " > ".join(run["tool_names"]),` 工具调用顺序用 ` > ` 连起来。实测 `refund_ask_only-1` 这一列是 `list_invoices > list_subscriptions > check_refund_eligibility`,`import_format-1` 是空的(纯知识问答,没调工具)。
- `run["refund_created"], run["outcome"], run["text"][:300], run["findings"][:300],` 回复和调查结论各截 300 字,表格里够判断了。实测 `past_due-1` 这一行:`failed_checks` 是 `handoff,facts`,`outcome` 是 `escalated`,回复是转人工的固定话术。回到报告里看,它的 `revisions` 是 2:草稿两次没过质检被转了人工,而这条用例期望不转人工,所以 `handoff` 挂了;转人工时不检查事实,`facts` 也跟着挂。
- `critique[:300], "", ""])` 最后两个空串就是留给你的 `note` 和 `bucket`。实测这 9 行里有 7 行挂在 `judge_grounded`,理由多是「Pro 无直接依据」「客户未提供报错码」这类,也就是回复里写了资料没给的细节。这就是错误分析该从哪一类先看的线索。
- `main(sys.argv[1])` 命令行第一个参数是报告路径。注意 CSV 里的回复带换行,用 `wc -l` 数行会多出很多(实测 9 条失败数出 74 行),用表格软件打开才是 9 行。

</div>

```bash
uv run python -m evals.failures_to_csv evals/reports/xxx-dev-baseline.json > failures.csv
```

用表格软件打开,每行是一条失败用例:挂了哪几项检查、分类结果、调了哪些工具(按顺序)、有没有建退款申请、回复前 300 字、调查结论、评审的理由。最后两列 `note` 和 `bucket` 是空的,留给你填。

然后一条一条读。每条读完,在 `note` 里用一句话写下你觉得哪里不对。不要套用预设的分类,就写你看到的现象,比如:

- "客户只说'能退吗',它直接建了申请"
- "回复说'请在规定时间内申请发票',没写 90 天"
- "E3001 的问题,检索出来的是 E3002 的文章"
- "客户说要去 12315,没转人工,回复了一大段退款政策"
- "回复内容是对的,但事实检查要求出现'逾期'两个字,它写的是'账套变为只读'"

这一步叫开放编码,来自定性研究。关键是先不分类,让失败自己告诉你它们是什么样的。如果你一上来就按"分类错误、检索错误、幻觉"这种框框去套,你会错过那些不在框框里的问题,而这类问题往往最有价值。

失败用例多的话,读 30 到 50 条就够了,通常读到二三十条之后就很少出现新的现象。

### 第二步:归类,计数

读完一遍,回头看 `note` 那一列,把相似的归成一类,填进 `bucket`。然后数每一类有多少条。你会得到一张类似这样的表(这是格式示意,类别和数量以你自己的数据为准):

| 失败类型 | 条数 | 例子 |
| --- | --- | --- |
| 把"询问"当"要求",误建退款申请 | | refund_ask_only-1 |
| 回复漏了关键数字 | | invoice_how-2 |
| 报错码检索到相邻编号的文章 | | |
| 该转人工没转 | | |
| 评测期望太死板(回复对的,检查判错) | | past_due-3 |
| …… | | |

这张表决定了今天先修什么:条数最多、风险最高的那类先修。如果"误建退款申请"有 5 条、"语气不够热情"有 8 条,我会先修前者,因为它涉及钱,而后者对 PRD 里的验收指标影响很小。

### 第三步:判断该修哪一层

每类失败,先问一个问题:这个问题能不能用确定的代码解决?

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="失败该在哪一层修">
<g font-family="var(--font-mono)" font-size="11">
<rect x="220" y="10" width="200" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="33" text-anchor="middle" fill="var(--ink)">一类失败</text>
<rect x="10" y="90" width="145" height="60" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="82" y="112" text-anchor="middle" fill="var(--ink)">回复其实是对的?</text>
<text x="82" y="132" text-anchor="middle" fill="var(--compute)">→ 改评测集</text>
<rect x="165" y="90" width="145" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="237" y="112" text-anchor="middle" fill="var(--ink)">规则能写清楚?</text>
<text x="237" y="132" text-anchor="middle" fill="var(--compute)">→ 改代码</text>
<rect x="320" y="90" width="145" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="392" y="112" text-anchor="middle" fill="var(--ink)">资料没找到?</text>
<text x="392" y="132" text-anchor="middle" fill="var(--compute)">→ 改检索/知识库</text>
<rect x="475" y="90" width="155" height="60" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="552" y="112" text-anchor="middle" fill="var(--ink)">资料有,模型没用好?</text>
<text x="552" y="132" text-anchor="middle" fill="var(--mem)">→ 改提示词</text>
<text x="320" y="190" text-anchor="middle" fill="var(--ink-faint)">从左往右依次判断,能在左边解决的不要拖到右边</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3"><line x1="290" y1="46" x2="90" y2="88"/><line x1="305" y1="46" x2="240" y2="88"/><line x1="335" y1="46" x2="390" y2="88"/><line x1="350" y1="46" x2="550" y2="88"/></g>
</svg>
<figcaption>修复的优先顺序。提示词是最后的手段,不是第一反应。</figcaption>
</figure>

**先怀疑题目。** 回复其实没问题,是评测的期望写得太死。比如 `past_due` 场景的必含事实是"逾期",Agent 写的是"您的订阅因扣款失败,账套已变为只读",意思完全对,只是没用"逾期"这个词。这时候该改的是评测集,不是 Agent。改评测集要非常克制,并且每次都记进日志,否则你会不知不觉把题改简单。我的标准是:换一个懂业务的人来看,也会认为这个回复是对的,才改题。

**能写成代码的写成代码。** 客户说"12315""律师""曝光",要不要转人工?这件事有明确的规则,写一个正则比在提示词里反复强调可靠得多。代码规则的好处是确定、可测、不会因为换了模型就失效。坏处是会误判,下面会说怎么用评测衡量误判。

**资料没找到的改检索。** 回复说错或说不出来,先去看 `retrieved` 字段,资料有没有被检索到。没检索到,改提示词没用,模型不可能用它看不到的东西。

**最后才是提示词。** 资料检索到了、规则也没问题,模型还是没用好,才改提示词。

## 我实际踩到的四个坑

下面四个问题是我写 SupportPilot 时真实遇到的,不是编的例子。有意思的是,其中三个是"判断代码"本身的 bug,不是 Agent 的问题。

**坑一:检索漏了换了说法的问题。** Day 45 的检索基线里,纯 BM25 在 31 条种子查询上漏了 2 条,在 86 条完整数据上漏了 7 条。漏掉的几乎都是"说法换了"的情况:客户说"扣了两次""多扣钱了",文章写"重复扣款";客户说"突然不能新增凭证了",文章写"账套变为只读"。这类问题靠关键词怎么调都没用,要靠向量检索补。所以如果你的混合检索 recall 不如预期,先单独看向量那一路有没有把这几条找回来。

**坑二:报错码的正则对中文不友好。** 为了让报错码一定能被关键词检索命中(下面的改动 v2-a),我写了个正则从工单里抠出 `E3001` 这种编码。第一版用的是 `\bE\d{4}\b`,测试时发现"还有E5001和E3001"里的 E5001 抽不出来。原因和 Day 50 的 `norm` 函数一样:Python 正则的 `\b` 在 Unicode 模式下把中文字符也当成"单词字符","有"和"E"之间没有词边界。中国用户写报错码前面经常不加空格,这个 bug 上线后会让一大半带报错码的工单检索变差。改成 `(?<![A-Za-z0-9])E\d{4}(?!\d)` 才对。

**坑三:质检正则误伤合规回复。** Day 47 的质检规则用正则拦"已为您退款""马上到账"这种违规承诺。第一版的正则把"已为您办理退款申请"也拦了,这是一句完全合规的话。误判的后果是好草稿被打回、白白重写一次,严重时连续两次被打回直接转人工。加了 `(?!申请)` 的否定前瞻,并且给这个正则单独写了参数化测试。

**坑四:评测的数字比对没处理 `.00`。** Day 50 讲过,`norm` 函数的 `\.00\b` 在"1,000.00元"上失效。如果没发现,所有回复里写了".00 元"的用例,事实检查都会挂,你会以为是 Agent 漏写了金额。

这四个坑给我的教训是:**判断代码和业务代码一样会出错,而且更难被发现**。Agent 答错了,你会去看;判断代码判错了,你会以为是 Agent 答错了,然后去改一个本来没问题的提示词。所以每一个正则、每一个检查函数都要有测试,失败用例要回到原文核对,而不是只看分数。

## 改动:一次一处

下面是我针对 SupportPilot 设计的 v2 改动。每一项都对应一类在错误分析里常见的失败,每一项都单独提交、单独跑评测、单独记日志。你的错误分析结果可能和我的不一样,那就按你的来。

### v2-a:检索加报错码关键词

分诊模型会把客户的话改写成检索查询(`search_query`),但改写时偶尔会把报错码丢掉或改掉。改动:从工单原文(而不是模型改写后的查询)里抠出报错码,单独加进 BM25 那一路,并且重复一次加权。向量那一路仍然用改写后的查询。

```python
# 不用 \b:中文字符也算"单词字符","还有E5001"里 E 前面没有词边界
ERROR_CODE_RE = re.compile(r"(?<![A-Za-z0-9])E\d{4}(?!\d)", re.I)


def extract_keywords(text: str) -> str:
    """从工单原文里抠出必须字面匹配的东西。目前只有报错码,以后可以加套餐名、功能名。"""
    return " ".join(dict.fromkeys(m.upper() for m in ERROR_CODE_RE.findall(text)))
```

<div class="line-notes">

- `# 不用 \b:中文字符也算"单词字符","还有E5001"里 E 前面没有词边界` 实测旧写法 `\bE\d{4}\b` 在 `"又是e3001,还有E5001和E3001"` 上一个都没抓到,返回 `[]`;`"导入报错E2001"` 也是 `[]`。只有前面带空格的 `"报错码 E3001。"` 才抓得到。
- `ERROR_CODE_RE = re.compile(r"(?<![A-Za-z0-9])E\d{4}(?!\d)", re.I)` `(?<!...)` 是否定后顾:E 前面不能是英文字母或数字;`(?!\d)` 是否定前瞻:4 位数字后面不能再跟数字;`re.I` 忽略大小写。实测同一句话抓到 `['e3001', 'E5001', 'E3001']`;`"订单号E30012345"` 不抓(后面还有数字),`"LE3001"` 不抓(前面是字母)。
- `def extract_keywords(text: str) -> str:` 返回空格分隔的字符串,直接拼进 BM25 的查询里。
- `return " ".join(dict.fromkeys(m.upper() for m in ERROR_CODE_RE.findall(text)))` 先统一转大写,再用 `dict.fromkeys` 去重。它和 `set` 的区别是保留第一次出现的顺序:`dict.fromkeys(["E3001", "E5001", "E3001"])` 的键是 `['E3001', 'E5001']`。实测结果是 `"E3001 E5001"`,和下面那条测试的期望一致。

</div>

```python
    def search(self, query: str, k: int | None = None, pool: int = 20, keywords: str = "") -> list[Hit]:
        """query 走向量检索;query + keywords 走 BM25。keywords 放报错码、账单号这类必须字面命中的词。"""
        k = k or self.s.retrieve_k
        if self._bm25 is None:
            self._load()
        vec_ids = self.vector_search(query, pool)
        kw_ids = self.bm25_search(f"{query} {keywords} {keywords}".strip(), pool)  # 关键词重复一次 = 加权
```

<div class="line-notes">

- `def search(self, query: str, k: int | None = None, pool: int = 20, keywords: str = "") -> list[Hit]:` 新增 `keywords` 参数,默认空串,Day 45 的老调用不用改。
- `k = k or self.s.retrieve_k` 没传 k 就用配置里的 5。
- `if self._bm25 is None:` BM25 索引第一次用到时才从数据库把所有块读进内存建好。
- `vec_ids = self.vector_search(query, pool)` 向量那一路只用模型改写后的查询,报错码对语义向量帮助不大。
- `kw_ids = self.bm25_search(f"{query} {keywords} {keywords}".strip(), pool)  # 关键词重复一次 = 加权` BM25 的分数随查询里词出现的次数累加,写两遍就是给报错码双倍权重。实测 `search("导入银行流水报错", keywords="E3001")` 时传给 BM25 的字符串是 `'导入银行流水报错 E3001 E3001'`。`.strip()` 处理 keywords 为空时末尾多出的空格。<br>顺带一个实测:我的环境开着 rerank,`"导入报错怎么办"` 加不加 `keywords="E3001"`,前三名都是 KB-error-003、KB-error-004、KB-error-003,只是分数从 0.4116 微调到 0.4162。rerank 会在融合之后重新打分,所以加权的效果要用评测集整体看,别拿一两条查询下结论。

</div>

改完 `retrieve` 节点(下一节的代码)之后,节点会用 `keywords=` 调检索器,Day 47 `tests/fakes.py` 里的假检索器也要跟着加这个参数,否则原来的冒烟测试会报 `TypeError: FakeRetriever.search() got an unexpected keyword argument 'keywords'`:

```python
class FakeRetriever:
    def search(self, query, k=5, keywords=""):
```

真实的类和假的类签名要保持一致,这是用假对象写测试时最容易漏的地方。

### v2-b:投诉和人工关键词强制转人工

```python
# 这些说法一出现就转人工,不交给模型判断:漏判的代价(客户去监管投诉)远大于误判(多转一张人工)
HUMAN_RE = re.compile(r"转人工|人工客服|真人|12315|投诉|律师|起诉|曝光|媒体|被盗|异地登录|不是我本人")
```

```python
    def classify(state: SupportState) -> dict:
        before = deps.spent()
        triage = deps.small_llm.structured(
            [{"role": "system", "content": prompts.CLASSIFY}, {"role": "user", "content": _ticket_text(state)}],
            Triage)
        if HUMAN_RE.search(state["turns"][-1]["content"] + state["ticket"]["subject"]):
            triage.needs_human = True
        _emit({"type": "step", "node": "classify", "category": triage.category})
        return {"triage": triage.model_dump(), "cost_cny": deps.spent() - before}

    def retrieve(state: SupportState) -> dict:
        tr = state["triage"]
        query = tr.get("search_query") or f"{state['ticket']['subject']} {state['ticket']['body']}"
        t = state["ticket"]
        keywords = extract_keywords(f"{t['subject']} {state['turns'][-1]['content']}")
        hits = deps.retriever.search(query, k=deps.settings.retrieve_k, keywords=keywords)
        _emit({"type": "step", "node": "retrieve", "docs": [h.doc_id for h in hits]})
        return {"hits": [asdict(h) for h in hits]}
```

<div class="line-notes">

- `def classify(state: SupportState) -> dict:` 分诊节点,v2 只在原来的基础上加了正则兜底那两行。
- `before = deps.spent()` 记下调用前的累计花费,节点结束时用差值算这一步花了多少。
- `triage = deps.small_llm.structured(` 用小模型按 `Triage` 的结构输出。实测 v2 提示词对三条工单的分诊:<br>「先问问能退吗」→ `category: refund, needs_account_data: True, needs_human: False, search_query: 'Pro 年付 退款 能退吗'`<br>「9 月 12 号扣了两笔 39 块,请把多扣的退给我」→ `refund`,`search_query: '重复扣款 39元 退回 多扣'`<br>「提示账套只读,是不是扣款没成功」→ `billing`,`urgency: high`
- `if HUMAN_RE.search(state["turns"][-1]["content"] + state["ticket"]["subject"]):` 查的是「客户最新一条消息 + 工单主题」。`turns[-1]` 是最后一条,多轮对话时就是最新追问。实测 `HUMAN_RE` 在「再不退款我就去 12315 投诉」上命中 `12315`;在「我不是要投诉,就是想问问发票」上命中 `投诉`;在「我们是做社交媒体运营的」上命中 `媒体`,后两条就是正文说的误判。
- `triage.needs_human = True` 只会把 False 改成 True,不会反过来。模型已经判了要转人工的,正则没命中也不撤销。
- `_emit({"type": "step", "node": "classify", "category": triage.category})` 往流里推一条事件,Day 49 的界面靠它实时显示「正在分诊」。
- `query = tr.get("search_query") or f"{state['ticket']['subject']} {state['ticket']['body']}"` 优先用分诊改写的查询,改写为空时退回到工单原文。
- `keywords = extract_keywords(f"{t['subject']} {state['turns'][-1]['content']}")` 报错码从客户原话里抠,不从模型改写后的 `search_query` 里抠,因为模型改写时可能把 E3001 弄丢或写成 E3002。
- `hits = deps.retriever.search(query, k=deps.settings.retrieve_k, keywords=keywords)` 向量用改写查询,BM25 用改写查询加报错码。
- `return {"hits": [asdict(h) for h in hits]}` `asdict` 把 dataclass 转成字典,LangGraph 的状态要能序列化进 checkpoint。

</div>

模型判 `needs_human=False` 时,正则还能兜一次底。这条规则的取舍写在注释里:漏判一个要去 12315 投诉的客户,代价远大于多转一张人工。

但它会误判。客户写"我不是要投诉,就是想问问发票",也会被转人工;"我们是做社交媒体运营的"里有"媒体"两个字。误判率高不高,评测会告诉你:dev 集里不该转人工的用例如果被转了,`handoff` 检查会挂。改完跑一遍,看 `handoff` 有没有新增失败。如果误判多,就收紧正则(比如"媒体"改成"找媒体|曝光到媒体"),而不是删掉规则。

### v2-c 到 v2-e:提示词

提示词改动放在最后,而且三处改动分三次提交。下面是 v2 的完整提示词文件:

```python
# supportpilot/src/supportpilot/agent/prompts.py
"""所有提示词集中放这里,带版本号。评测报告里会记录 PROMPT_VERSION,改提示词就改版本号。"""

PROMPT_VERSION = "v2"

CLASSIFY = """你是 CloudLedger(云簿,在线记账 SaaS)的工单分诊员。读客户工单,输出分类结果。

分类定义:
- billing:扣费、扣款失败、重复扣款、支付方式、账单查询(不涉及退钱的诉求)
- refund:客户要求退钱,或者问能不能退、退多少
- invoice:开发票、发票错误、重开发票
- account:登录、验证码、密码、账号锁定、绑定手机邮箱、成员权限、注销
- technical:导入导出、银行流水同步、结账、报表、App 同步等产品使用问题和报错
- plan_change:升级、降级、换年付月付、取消订阅、试用
- api:开放 API、API Key、限流、Webhook
- other:以上都不是

needs_account_data:回答必须依赖这个客户自己的订阅、账单或历史记录时为 true(比如"我被扣了两次""我能退多少");
纯政策或操作问题(比如"专票怎么开")为 false。
needs_human:客户威胁投诉到监管/媒体/律师、涉及账号被盗等安全事件、或者明确要求人工客服时为 true。

容易分错的情况:
- "被扣了两次""多扣了钱"并要求退回:refund(诉求是退钱),不是 billing。
- "账套变只读""不能新增凭证"并且提到扣款或欠费:billing。
- "怎么取消自动续费""不想续了":plan_change。
- 只问价格、套餐区别:plan_change。
- search_query 里必须保留原文中的报错码(如 E3001)和关键名词(年付、专票、席位)。"""

ACT = """你是 CloudLedger 客服后台的调查员。你的任务是用工具查清回答这张工单需要的客户数据,不直接回复客户。

规则:
1. 客户 ID 已经给你了,不需要再查 get_customer。
2. 涉及退款:先用 list_invoices 找到相关账单,再对它调用 check_refund_eligibility。退款金额只以工具返回为准,不要自己算。
3. 只有当客户明确要求退款、并且 check_refund_eligibility 返回 eligible=true 时,才调用 create_refund_request。
   客户只是询问"能不能退"时不要创建申请。
4. 只查和这张工单有关的数据,查到够用就停。
5. 区分"询问"和"要求":
   - "能退吗""先问问""如果退能退多少" = 询问,只调 check_refund_eligibility,不创建申请;
   - "请退款""帮我退掉""申请退款""把钱退给我" = 要求,符合条件就创建申请。
6. 结束时不再调用工具,输出「调查结论」:用几条短句列出查到的关键事实(账单号、金额、状态、规则结论),不要写给客户的话。"""

DRAFT = """你是 CloudLedger 的客服,给客户写工单回复。

写作要求:
- 只使用【帮助中心资料】和【调查结论】里的事实。资料里没有的,不要猜,直接说会转给同事跟进。
- 用到帮助中心资料的句子,在句末标注来源编号,格式严格为 [KB-xxx-000],只能用资料里出现过的编号。
- 如果有待审批的退款申请:只能说"已提交退款申请,审核通过后会原路退回",不能说已经退款或承诺到账时间以外的东西。
- 如果客户不符合退款条件:说明依据的规则,给出可行的替代办法(比如关闭自动续费)。
- 如果没查到客户账户:请客户提供注册邮箱。
- 资料里和客户问题直接相关的时限、金额、次数,要写出具体数字(比如"付款后 90 天内""5 分钟"),不要只说"一定时间内"。
- 客户只是询问能否退款时:告诉他是否符合条件、可退金额,并问他是否需要办理,不要说已经提交申请。
- 语气礼貌、直接,先回答问题再补充说明。不超过 250 字。称呼用"您好"开头,不要落款。"""

CHECK = """你是客服质检员。检查这封回复草稿能不能发给客户。

逐条核对:
1. 草稿里每一个具体事实(金额、天数、规则、操作路径)是否都能在【帮助中心资料】或【调查结论】里找到依据。
2. 是否答非所问,或者漏掉了客户的主要诉求。
3. 是否承诺了没有依据的事(比如"已经为您退款""马上到账")。

全部没问题 passed=true。有任何一条问题 passed=false,并在 problems 里逐条写清楚哪句话有什么问题。"""
```

<div class="line-notes">

- `PROMPT_VERSION = "v2"` 评测报告会记录这个版本号。实测导入后 `prompts.PROMPT_VERSION` 是 `'v2'`,四段提示词长度分别是 CLASSIFY 678 字、ACT 506 字、DRAFT 428 字、CHECK 212 字。
- `- refund:客户要求退钱,或者问能不能退、退多少` 「问能不能退」也算 refund。实测「先问问能退吗」分成了 refund,是不是真去建申请由 ACT 的第 5 条管。
- `needs_account_data:回答必须依赖这个客户自己的订阅、账单或历史记录时为 true` 这个字段决定图里 retrieve 之后走不走 act 节点去查账。实测上面三条工单都判成了 True。
- `- "被扣了两次""多扣了钱"并要求退回:refund(诉求是退钱),不是 billing。` 实测「扣了两笔 39 块,请把多扣的退给我」分成 refund。
- `- "账套变只读""不能新增凭证"并且提到扣款或欠费:billing。` 实测「提示账套只读,是不是扣款没成功」分成 billing。
- `- search_query 里必须保留原文中的报错码(如 E3001)和关键名词(年付、专票、席位)。` 实测「能退吗」那条的 search_query 保留了「Pro 年付」。报错码这一条有 `extract_keywords` 兜底,提示词和代码两边都管。
- `1. 客户 ID 已经给你了,不需要再查 get_customer。` 图的第一个节点 `load_customer` 已经查过了,省一次工具调用。
- `2. 涉及退款:先用 list_invoices 找到相关账单,再对它调用 check_refund_eligibility。` 实测 `refund_ask_only-1` 的工具顺序是 `list_invoices > list_subscriptions > check_refund_eligibility`,中间多查了一次订阅,规则 4「查到够用就停」没完全管住。
- `5. 区分"询问"和"要求":` v2 最重要的改动。实测 `refund_ask_only` 两条都只调了 `check_refund_eligibility`,`refund_created` 都是 False,`must_not_call` 和 `refund_gate` 两项全过。
- `6. 结束时不再调用工具,输出「调查结论」` act 节点的最后一条文字就是 findings,交给 draft 节点用。实测 `refund_ask_only-1` 的 findings 开头是「客户 C0002(李娜,非 VIP)仅有 1 张账单:INV-202609-0002,金额 950 元,状态 paid……」。
- `- 用到帮助中心资料的句子,在句末标注来源编号,格式严格为 [KB-xxx-000]` 引用格式写死,`check_citations` 才能用正则校验。实测 13 条里 `citation_valid` 和 `cited` 都是 100%。
- `- 资料里和客户问题直接相关的时限、金额、次数,要写出具体数字` v2 新增,针对回复只说「一定时间内」。实测 `refund_ask_only-1` 的回复写了「付款日为 2026-09-24,今天是第 7 天,仍在首次购买后 14 天内(含第 14 天)」。
- `- 客户只是询问能否退款时:告诉他是否符合条件、可退金额,并问他是否需要办理` 和 ACT 第 5 条配套,起草时也不能说「已提交」。
- `CHECK = """你是客服质检员。` 质检是 LLM 判断,另外还有 `PROMISE_RE` 正则在代码里兜底。实测那条正则不拦「已为您办理退款申请」「已提交退款申请」,拦「已为您退款」「退款已到账」「马上到账」「已经办理退款」,和坑三说的一致。

</div>

和 v1 比,改了三处:

- **分诊提示词**加了"容易分错的情况"一节,针对的是分类混淆。注意它写的是判断规则("被扣了两次并要求退回:refund,诉求是退钱"),不是评测集里的原句。如果你把"9 月 12 号扣了两笔钱"这种 dev 里的原话直接写进提示词当例子,dev 分数会涨,但那是在背答案。
- **调查提示词**加了第 5 条,区分"询问"和"要求",针对的是误建退款申请。这是我认为最重要的一处改动,因为它直接关系到 `must_not_call` 和 `refund_gate` 两项必须 100% 的指标。
- **起草提示词**加了两条:时限和金额要写具体数字;客户只是询问时不要说已提交申请。针对的是漏关键事实和"询问"场景下的措辞。

`PROMPT_VERSION` 改成了 `v2`,评测报告会记录这个版本号。

### 评测集修正

评测侧的改动也要记日志,而且要比 Agent 侧的改动更谨慎:

```python
        # facts 里的 "a|b" 表示说出任意一种就算(v2 起支持,见 docs/eval-changelog.md)
        "facts": (all(any(norm(alt) in text for alt in f.split("|")) for f in e["facts"])
                  if e["facts"] and not e["handoff"] else None),
```

<div class="line-notes">

- `# facts 里的 "a|b" 表示说出任意一种就算` 这段替换 Day 50 `checks.py` 里原来的那一行 `all(norm(f) in text for f in e["facts"])`。
- `"facts": (all(any(norm(alt) in text for alt in f.split("|")) for f in e["facts"])` 两层:外层 `all` 要求每个事实都满足,内层 `any` 要求这个事实的几种说法里至少出现一种。`"逾期|只读|past_due".split("|")` 得到 `['逾期', '只读', 'past_due']`。`norm` 会去掉空格、千分位逗号,并把 `374.00` 规范成 `374`。
- `if e["facts"] and not e["handoff"] else None),` 没有必含事实的用例、期望转人工的用例,这一项都记 None(不考)。实测 `past_due-1` 被意外转了人工,它期望 `handoff: False`,所以 facts 照样要考,回复是转人工话术,里面没有「逾期」,facts 就挂了。

</div>

`facts` 支持 `a|b` 写法,说出任意一种就算。`past_due` 场景的必含事实从"逾期"放宽成"逾期|只读|past_due"。只改了这一个场景,因为只有这个场景在错误分析里出现了"回复对、检查错"的情况。改完重新生成评测集,版本号仍是 v1,但在 `build_dataset.py` 里留了注释写明 v1.1 改了什么。

### 新增的测试

每个改动都配一个测试,防止以后改回去:

```python
def test_extract_keywords_handles_chinese_neighbors():
    assert extract_keywords("又是e3001,还有E5001和E3001") == "E3001 E5001"
```

<div class="line-notes">

- `def test_extract_keywords_handles_chinese_neighbors():` 坑二的回归测试,防止以后有人「顺手」把正则改回 `\b`。
- `assert extract_keywords("又是e3001,还有E5001和E3001") == "E3001 E5001"` 一句话里同时覆盖了三件事:小写转大写、中文紧挨着报错码、重复去重。实测返回值正是 `"E3001 E5001"`。

</div>

```python
def test_keyword_rule_forces_handoff_even_if_model_misses():
    triage = {**REFUND_TRIAGE, "needs_human": False}           # 模型漏判
    tools = FakeTools(customer={"id": "C0005"})
    ticket = {**TICKET, "body": "再不退款我就去 12315 投诉"}
    out = build_graph(make_deps(FakeLLM(triage, [], DRAFT), tools)).invoke({"ticket": ticket})
    assert out["outcome"] == "escalated"
```

<div class="line-notes">

- `def test_keyword_rule_forces_handoff_even_if_model_misses():` 测的是「模型漏判时,正则能兜住」。用假模型,不花钱。
- `triage = {**REFUND_TRIAGE, "needs_human": False}           # 模型漏判` 复制 Day 47 `fakes.py` 里的标准分诊结果,只把 needs_human 改成 False,模拟模型没看出来要转人工。
- `ticket = {**TICKET, "body": "再不退款我就去 12315 投诉"}` 工单正文换成投诉威胁。实测 `HUMAN_RE` 在这句话上命中的是 `12315`。
- `out = build_graph(make_deps(FakeLLM(triage, [], DRAFT), tools)).invoke({"ticket": ticket})` `FakeLLM` 按顺序吐出预设的分诊结果、工具调用(空列表)、草稿。图跑到 classify 时正则把 needs_human 改成 True,直接走 handoff。
- `assert out["outcome"] == "escalated"` 最终状态是转人工。如果把 classify 里那两行正则删掉,这条会失败。

</div>

## 改动日志

```markdown
# 评测改动日志

每次改动一行。只改一处,只在 dev 上跑;test 只在里程碑跑(标 ★)。

| 日期 | 版本 | 改了什么(一处) | 针对哪类失败 | dev 全通过率 | 关键分项变化 | 成本/延迟变化 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | v1 | 基线 | | | | | |
| | v1 + 评测集修正 | past_due 的必含事实放宽为"逾期\|只读\|past_due" | 评测集太死板 | | facts | 无 | 保留 |
| | v2-a | 检索加报错码关键词 | 报错码检索不准 | | retrieval_hit | | |
| | v2-b | 投诉/人工关键词强制转人工 | 漏转人工 | | handoff | | |
| | v2-c | 分诊提示词加"容易分错的情况" | 分类错 | | category | | |
| | v2-d | act 提示词区分"询问"和"要求" | 误建退款申请 | | must_not_call, refund_gate | | |
| | v2-e | 起草提示词要求写出具体数字 | 漏关键事实 | | facts, judge_resolved | | |
| | ★ v2 | test 集 | | test: | | | |
```

每一行写清楚改了什么、针对哪类失败、dev 分数和关键分项怎么变、成本和延迟有没有变化、结论是保留还是撤回。数字那几列留空,填你自己跑出来的。

这张表是你面试时讲这个项目最有力的素材。"我把通过率从 62% 提到了 85%"是一句空话;"基线是 62%,错误分析发现最大的一类失败是把客户的询问当成退款要求,一共 6 条,我在调查提示词里加了询问和要求的区分规则,这一项改动让 refund_gate 从 81% 到了 100%,整体通过率涨了 8 个点;然后……"这样讲,面试官就知道你真做过。

**一次只改一处**,是因为两处改动同时上,分数涨了你不知道是哪个起的作用,跌了你不知道该撤哪个。更隐蔽的是两个改动互相抵消:一个涨 5 个点、一个跌 3 个点,合起来涨 2 个点,你以为两个都有用。每次只改一处慢一点,但每一步都是确定的。

**跌了就撤**。有些改动你觉得肯定有用,跑出来分数跌了。别找理由留着它,撤掉,在日志里写清楚为什么撤。我见过最多的情况是"加了一段很详细的说明,结果模型被说明带偏了,别的场景开始出错"。

## 防止对 dev 过拟合

迭代几轮之后,dev 分数会越来越好看。但你要时刻问自己:这是 Agent 真的变好了,还是在背 dev 的题?

几条纪律:

**提示词里不放 dev 的原句。** 写规则,不写题目。如果某条规则只对 dev 里那一条用例有用,它很可能是在背答案。

**test 只在里程碑跑。** 我的做法是 v2 全部改完,跑一次 test。test 分数和 dev 差距在 5 个点以内,说明改动是泛化的;差距很大,说明 dev 上有些改动是在背题,回头看哪些改动只修了一两条用例。

**关注不变量,而不是平均分。** `refund_gate`、`must_not_call`、`forbid`、`handoff` 这几项是 PRD 里写了必须 100% 的。平均分涨了但这几项里有一项从 100% 掉到了 95%,这个版本不能上线。

**定期补新题。** 每轮错误分析如果发现了一个评测集没覆盖的现象,就补一个新场景进去(放进 test 还是 dev 由哈希决定)。评测集要跟着你对问题的理解一起长。Shreya Shankar 有一篇论文专门讨论这个现象:评测的标准会随着你看到的输出而漂移,人在看了足够多的输出后才真正知道自己想要什么。这很正常,把它记录下来就行。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/e2i6JbU2R-s" title="Error Analysis: The Highest ROI Technique In AI Engineering" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · Error Analysis: The Highest ROI Technique In AI Engineering · 今天方法的出处。他演示了怎么逐条读 trace、怎么写开放编码笔记、怎么归类计数,强烈建议整段看。</figcaption>
</figure>

## 常见提分手段清单

按失败类型整理,错误分析之后对号入座。每一条都是候选,用评测决定留不留。

| 失败类型 | 先试 | 再试 |
| --- | --- | --- |
| 分类错 | 分诊提示词写清边界和易混淆情况 | 分类允许多选;把分类拆成两步(先判是否要查账) |
| 检索漏 | 关键词抽取(报错码、产品名);检查切块 | 开 rerank;查询改写多路召回;补知识库文章 |
| 检索错(找到相邻的) | BM25 加权字面关键词 | 元数据过滤(按分类缩小范围) |
| 误调工具 / 漏调工具 | 工具描述写清前置条件和"什么时候不要调" | 调查提示词加流程规则;必要时拆成固定步骤 |
| 工具参数错 | 参数 description 写格式示例;用枚举 | 工具错误信息写清怎么改 |
| 漏关键事实 | 起草提示词要求写具体数字 | 调查结论格式化为"事实清单" |
| 幻觉(说了资料里没有的) | 质检节点 + 提示词"不知道就说转同事" | 减少无关检索结果(降 k);提高质检模型能力 |
| 该转人工没转 | 关键词规则兜底 | 分诊提示词加例子 |
| 回复太长/太短 | 起草提示词限字数 | |
| 成本高 | 见 Day 52 | |

## 最后跑一次 test

v2 的几处改动都在 dev 上验证完、记进日志之后:

```bash
make eval-test LABEL=v2
```

把 test 结果写进日志的 ★ 那一行。然后诚实地看这个数字:

- test 和 dev 接近,说明改动泛化了,可以作为当前版本。
- test 明显低于 dev,回头看 test 的失败用例属于哪类,是不是 dev 里没覆盖到的。看完之后**不要**针对 test 的失败直接改,而是把这类情况补进 dev(新写一个类似但不同的场景),在 dev 上修。否则 test 就失去了意义。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1PM3J6fEdu&autoplay=0&high_quality=1" title="深入理解 AI Agent(06-Agent 的评估)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Miracle_c_l · 深入理解 AI Agent(06-Agent 的评估)· 3 个分 P 共约两小时,中文系统讲 Agent 评估的方法和迭代,挑和错误分析、评测驱动迭代相关的部分看。</figcaption>
</figure>

## 动手练习

**步骤 1:错误分析。** 导出基线的失败用例,读至少 30 条,写 note,归类,数出每类条数,做成上面那张表,存进 `docs/error-analysis-v1.md`。

**步骤 2:先修评测集。** 找出"回复是对的、检查判错"的用例。逐条确认,确实是题的问题才改。改了什么记进日志。重新生成评测集,重跑 dev,这个分数作为修正后的基线。

**步骤 3:改代码规则。** 按 v2-a(报错码关键词)和 v2-b(转人工关键词)各做一次:改代码、加测试、`make test`、跑 dev、记日志。v2-b 跑完特别看 `handoff` 有没有新增误判。

**步骤 4:改提示词。** v2-c、v2-d、v2-e 三处分三次提交,每次跑 dev、记日志。哪一处让分数跌了就撤掉,在日志里写原因。

**步骤 5:针对你自己的头号失败类型设计一个改动。** 前面的改动是我按常见失败设计的。看你的错误分析表,条数最多的那一类如果不在上面,自己设计一个改动,按同样流程验证。

**步骤 6:跑 test,写结论。** 跑一次 test,填进日志。在日志末尾写一段话:v2 相比 v1 改了什么、dev 和 test 各涨了多少、哪些不变量现在是 100%、还剩哪些已知问题。

**验收标准:** `docs/error-analysis-v1.md` 有归类计数表;`docs/eval-changelog.md` 至少 5 行改动,每行都有 dev 分数;`must_not_call`、`refund_gate`、`forbid`、`handoff` 四项在 dev 上达到 100%,或者在日志里写清楚剩下的失败是什么、为什么暂时修不了;test 跑过一次且只跑了一次。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 错误分析 | 逐条阅读失败用例、归类计数、按数量和风险决定修什么的过程 |
| 开放编码 | 不预设分类,先用自己的话描述每条失败 |
| 归类(轴向编码) | 把相似的开放编码笔记合并成失败类型 |
| 改动日志 | 每次改动、针对的问题和分数变化的记录 |
| 一次一处 | 每轮只改一个地方,保证分数变化能归因 |
| 不变量 | 必须保持 100% 的指标,比如退款闸门 |
| 过拟合 dev | 改动只对 dev 里的特定用例有效,对没见过的情况无效 |
| 标准漂移 | 看了更多输出后,人对"好"的定义发生变化 |
| 否定前瞻 | 正则里的 `(?!...)`,表示后面不能紧跟某内容 |

## 常见误区

**不读失败用例,只看分数改提示词。** 分数告诉你"差多少",不告诉你"差在哪"。不读原文,你会去修一个不存在的问题。

**一次改好几处。** 分数变化无法归因,互相抵消的改动会让你误以为都有用。

**什么问题都用提示词修。** 能写成代码的规则、检索不到的资料,改提示词都修不好或者修不稳。

**把 dev 的原句写进提示词。** dev 分数涨了,但那是在背答案,test 会揭穿。

**看到 test 失败就去改。** 一旦针对 test 改,test 就变成了 dev。把 test 暴露的问题类型补进 dev,在 dev 上修。

**只看平均分。** 平均分涨了,但退款闸门从 100% 掉到 95%,这个版本不能上线。

**相信判断代码不会错。** 正则、事实比对、评审,都是代码,都会有 bug。失败用例要回到原文核对。

## 学习资料

### 文档与文章

- [Hamel Husain · A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/):错误分析、数据查看工具、评测驱动迭代的完整实战指南,今天最重要的一篇,1 小时。
- [Hamel Husain · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):其中关于"读多少条 trace""怎么归类""什么时候该写代码检查"的几问,和今天直接相关,30 分钟。
- [Who Validates the Validators?](https://arxiv.org/abs/2404.12272):Shreya Shankar 等人关于评测标准漂移的论文,读摘要和第 1、2 节,理解为什么评测集要跟着迭代,30 分钟。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):复习"从失败中构建评测"的部分,15 分钟。
- [Applied LLMs · What We've Learned From A Year of Building with LLMs](https://applied-llms.org/):"Tactical"部分关于提示词迭代和评测的经验,30 分钟。

### B 站视频

- 上面嵌的 Miracle_c_l《深入理解 AI Agent(06-Agent 的评估)》。
- ShiianAI《【重制版】RAG 系统怎么评估?|RAGAS 框架详解:6 大指标带你科学优化 RAG》(BV1adYwzbEv6,12 分钟):如果你的头号失败类型在检索上,看这个了解检索侧还能测哪些指标,下面嵌了。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1adYwzbEv6&autoplay=0&high_quality=1" title="【重制版】RAG系统怎么评估?|RAGAS框架详解:6大指标带你科学优化RAG" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ShiianAI · RAG 系统怎么评估?RAGAS 框架详解 · 12 分钟,重点看 context recall 和 faithfulness 两个指标,对应我们的 retrieval_hit 和 judge_grounded。</figcaption>
</figure>

### 其他经典视频

- 上面嵌的 Hamel Husain《Error Analysis: The Highest ROI Technique In AI Engineering》。
- How I AI《Evals, error analysis, and better prompts: A systematic approach to improving your AI products》(YouTube,PgzOBNse2EA):另一个视角的错误分析演示,偏产品视角,适合想了解"怎么和产品经理一起做"的同学。

### 书籍

- Chip Huyen《AI Engineering》第 4 章 Evaluate AI Systems 后半部分"Design Your Evaluation Pipeline":评测流程的迭代,包括怎么根据失败补数据、怎么避免数据污染,约 1 小时。
- 同书第 5 章 Prompt Engineering 中关于提示词版本管理和迭代的部分,30 分钟。

### 开源项目与代码

- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):专门做提示词回归测试的工具,用配置文件定义测试用例和断言,和我们手写的 `run_eval.py` 思路一样,想用现成工具可以看看它的 [文档](https://www.promptfoo.dev/docs/intro/)。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看它的 README 里 pass^k 的结果,模型在多次运行中稳定做对的比例远低于单次做对的比例。你可以把 dev 跑 3 次,算一下自己的 pass^3。

## 自测

**1. 错误分析为什么要先写开放编码笔记,而不是直接按"分类错误、检索错误、幻觉"归类?**

<details><summary>答案</summary>

预设分类会让你只看到框框里的问题,错过框框外的现象,而那些往往最有价值(比如"评测期望太死板""询问被当成要求")。先用自己的话描述每条失败,再从笔记里归纳出类型,得到的分类贴合你的系统真实的失败方式。

</details>

**2. `past_due` 场景的回复写了"账套已变为只读",事实检查要求"逾期"所以没过。你会怎么处理?依据是什么?**

<details><summary>答案</summary>

先确认回复在业务上是对的:换一个懂业务的人看也会认为它正确回答了客户的问题。确认后改评测集:让 facts 支持多个可接受的说法("逾期|只读|past_due"),并在改动日志里记录。不应该去改提示词逼模型说"逾期"这个词。改题要克制,只在"回复对、检查错"时改。

</details>

**3. 加了"投诉/12315 强制转人工"的关键词规则后,怎么知道它误判多不多?**

<details><summary>答案</summary>

跑 dev 评测,看不该转人工的用例里 `handoff` 检查有没有新增失败。新增失败的就是误判。误判多就收紧正则(用更具体的短语),而不是删掉规则,因为漏判的代价更高。

</details>

**4. 为什么提示词里不应该放 dev 集里的原句当例子?**

<details><summary>答案</summary>

那样 dev 上对应的用例几乎一定会过,分数上涨,但这是在背答案,不代表模型学会了处理这类情况。test 集会揭穿:dev 涨了 test 不涨。应该写判断规则和与评测集不同的例子。

</details>

**5. 「面试题」讲一个你把 Agent 效果提上去的具体过程。**

<details><summary>答案</summary>

按"基线 → 错误分析 → 分层修复 → 验证"讲,带数字和具体改动。比如:基线 dev 通过率是多少;读了 40 条失败用例,归出五类,数量最多、风险最高的是"把询问当成退款要求"(若干条);这类问题模型理解偏差导致,于是在调查提示词里加入询问和要求的区分规则,单独提交、跑 dev,refund_gate 从多少到 100%,整体涨了多少;接着用代码规则修了报错码检索和投诉转人工,并说明过程中发现并修复了判断代码自身的两个正则 bug;所有改动记在日志里;最后跑一次 test,和 dev 的差距在几个点以内,说明改动泛化了。

</details>

**6. 「面试题」怎么防止对评测集过拟合?**

<details><summary>答案</summary>

按场景拆分 dev 和 test,同一场景的变体不跨集合;只在 dev 上迭代,test 只在里程碑跑一次;提示词写规则不写 dev 原句;一次只改一处并记录,只修一两条用例的改动要警惕;test 暴露的问题类型补进 dev 再修,不直接针对 test 改;关注必须 100% 的不变量而不只是平均分;定期从新发现的失败里补充新场景。

</details>

## 明天预告

Day 52 · 可观测与成本:接 Langfuse、算单工单成本、缓存与模型路由。今天的改动让效果上去了,明天看钱和时间:给每张工单接上 tracing,在 Langfuse 里看到每一步的输入输出、耗时和花费;做一张成本看板,找出最贵的节点;用 prompt caching 和"小模型分诊、大模型起草"的路由把单张工单成本压下来,并用今天的评测确认效果没有跟着降。
