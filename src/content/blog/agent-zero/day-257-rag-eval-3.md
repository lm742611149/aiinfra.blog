---
title: 'Day 257 · RAG 评估(三):建 30 条评估集,五种题型'
description: '手挑三道题算出来的 MRR,一道题就占三分之一。今天给 CloudLedger 帮助中心建第一份正式评估集:30 道题分政策、错误码、口语、一句两问、无答案五类,每题标好答案在哪几篇文章和好回答必须有的要点,存成 JSONL。先踩一次 ensure_ascii 和 json.loads 读 JSONL 的坑,再写个检查脚本,故意改坏三条看它能不能抓出来;最后实测:同一个意思换成口语问,BM25 的倒数排名从 1 掉到 0。'
pubDate: 2026-10-22
regime: none
tags: ['rag-evaluation', 'eval-set', 'jsonl', 'python', 'agent-zero']
series: 'agent-zero'
day: 257
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 256](/blog/agent-zero/day-256-rag-eval-2/) 在纸上手算了三个检索指标,又写成了 `part04/metrics.py`:recall@k 看该找的文章找到了几成,precision@k 看前 k 名里几成有用,MRR 看第一个答案平均排第几。三道题跑三种检索,向量 MRR 1.000,混合 + rerank 0.778,BM25 0.667。

但那三道题是我挑的。三道题求平均,一道题就占三分之一,换三道题排名可能就反过来。要让这些数字能拿来做决定,得先有一份像样的题库。今天就建它。

## 今天要解决的问题

学完你应该能做到:

1. 说出一份 RAG 评估集该有哪些字段,每个字段给谁用。
2. 知道题要按类型覆盖,为什么一定要有「口语题」和「无答案题」,为什么标「要点」不标「标准答案全文」。
3. 用 `make_eval_set.py` 生成 30 条的 `data/eval/rag_eval.jsonl`,会读 JSONL,会写一个检查脚本挡住标注里的低级错误。
4. 知道 30 条的局限:一道题占检索层分数 3.8%,小差别不能下结论。

预计用时 2 小时。今天大部分代码不调任何接口,只有练习 4 调了检索(embedding 和 rerank 是硅基流动免费模型),花费 ¥0。

前置:[Day 256](/blog/agent-zero/day-256-rag-eval-2/) 的 `metrics.py`;[Day 255](/blog/agent-zero/day-255-rag-eval-1/) 的无答案题和「按文章标」;[Day 222](/blog/agent-zero/day-222-kb-data/) 造的 20 篇帮助中心文章 `data/kb/kb-001.md` 到 `kb-020.md`;[Day 39](/blog/agent-zero/day-039-json/) 的 `json.dumps/loads` 和 `ensure_ascii`;[Day 37](/blog/agent-zero/day-037-pathlib/) 的 `Path`;[Day 38](/blog/agent-zero/day-038-files-with/) 的 `with open`。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `eval_set.py` 的 `load_eval_set()` 和 `check_eval_set()`,并且不看文章写出五种题型各两道题;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 评估集是什么,为什么它比代码还值钱

**评估集**(eval set)就是一组带标注的测试题:问题是什么、标准答案在哪、好回答长什么样。你可以把它想成前端项目里的测试用例,只不过断言不是 `expect(sum(1, 2)).toBe(3)` 这种一个萝卜一个坑,而是「这道题的答案应该在 kb-002 里」「好回答要提到月付不退」。

它比今天写的任何代码都值钱。以后你要回答的问题,切块 300 字还是 500 字、k 取 4 还是 6、上不上 rerank、换不换模型,全靠在它上面跑出来的数字。题出得偏,所有结论都跟着偏。代码写错了能看出来,题出偏了,数字照样好看,你根本不知道。

一条用例长什么样?先手写一条看看。新建 `part04/eval_one.py`:

```python
# agent-zero-lab/part04/eval_one.py  一条评估用例长什么样,写成 JSON 是什么样
import json

case = {
    "id": "q02",
    "question": "月付的能退钱吗",
    "expected_docs": ["kb-002"],
    "type": "policy",
    "answer_points": ["月付不支持退款", "当前周期结束后停止服务"],
}
print(json.dumps(case))
print(json.dumps(case, ensure_ascii=False))
```

<div class="line-notes">

- `case = {` 一条用例就是一个字典,相当于 JS 的对象字面量。五个字段下面一个个说。
- `"id": "q02",` 编号。以后报告里说「q02 检索错了」,大家知道是哪道题。不要用问题原文当编号,问题会改措辞,编号不变。
- `"question": "月付的能退钱吗",` 用户问题,用用户自己会说的话写。
- `"expected_docs": ["kb-002"],` 能回答这道题的文章 id。检索层(Day 259)拿它和检索结果比。存成列表而不是集合,因为 JSON 里没有集合这种类型,用的时候再 `set()` 一下。
- `"type": "policy",` 题型,下一节讲五种。算分时可以按题型拆开看。
- `"answer_points": ["月付不支持退款", "当前周期结束后停止服务"],` 好回答必须包含的要点。生成层(Day 260)的裁判拿它对照。
- `print(json.dumps(case))` 不加参数,中文会被转义成 `\uXXXX`。
- `print(json.dumps(case, ensure_ascii=False))` 加上 `ensure_ascii=False`,中文原样输出。[Day 39](/blog/agent-zero/day-039-json/) 讲过,这里再踩一次,因为评估集是要人打开看、`git diff` 对比的。

</div>

```bash
uv run python -m part04.eval_one
```

```text
{"id": "q02", "question": "月付的能退钱吗", "expected_docs": ["kb-002"], "type": "policy", "answer_points": ["月付不支持退款", "当前周期结束后停止服务"]}
{"id": "q02", "question": "月付的能退钱吗", "expected_docs": ["kb-002"], "type": "policy", "answer_points": ["月付不支持退款", "当前周期结束后停止服务"]}
```

第一行机器读得懂,人读不懂。评估集会被反复打开、改、在 code review 里看 diff,第一种写法等于让每个审阅的人先去解码。程序读这两行得到的东西一模一样,所以没有理由不加 `ensure_ascii=False`。

**为什么标要点,不标标准答案全文?** 假如标准答案写成「月付套餐不支持中途退款,取消后当期结束停止服务」,模型回答「月付的不能退,不过取消以后这个月还能用完」,意思完全对,一个字一个字比就会判错。标两三个要点,裁判(不管是人还是大模型)只要检查「每个要点都提到了吗」,措辞随便。人工复核也快,扫一眼就知道漏了哪条。

## 五种题型,每种在考什么

题不能随手写 30 道。随手写出来的,八成都是「请问年付套餐的退款政策是什么」这种照着文档标题问的题,分数会虚高,上线一塌糊涂。我把 CloudLedger 的题分成五类,每类对着前面几天发现的一个风险点:

| 类型 | 条数 | 考什么 | 对着哪个风险 | 例子 |
| --- | --- | --- | --- | --- |
| policy | 10 | 直接问政策规则 | 最常见的流量,保底 | 降级以后多出来的账本会被删吗 |
| error_code | 6 | 精确的编号匹配 | 向量检索对编号不敏感([Day 219](/blog/agent-zero/day-219-embed-limits/)) | 导入流水报 E1042 |
| colloquial | 6 | 口语,和文档措辞差得远 | BM25 只认字面([Day 255](/blog/agent-zero/day-255-rag-eval-1/) 的配置 B) | 老板想看所有账但不能让他改 |
| multi | 4 | 一句话两个问题,要两篇文章 | 资料只拿到一半(Day 256 的 recall 0.5) | 发票抬头写错了,而且我想退款 |
| unanswerable | 4 | 帮助中心里没有 | 模型编答案(Day 255 的「公司位于杭州」) | 客服电话是多少 |

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="30 道题按五种题型分布:政策 10 道、错误码 6 道、口语 6 道、一句两问 4 道、无答案 4 道;前四类 26 道进检索层算分,无答案 4 道只进生成层考拒答">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">30 道题,每一格是一道</text>
<g>
<rect x="20" y="44" width="200" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="230" y="64" fill="var(--ink)">policy 10</text>
<rect x="20" y="82" width="120" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="150" y="102" fill="var(--ink)">error_code 6</text>
<rect x="20" y="120" width="120" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="150" y="140" fill="var(--ink)">colloquial 6</text>
<rect x="20" y="158" width="80" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="178" fill="var(--ink)">multi 4</text>
<rect x="20" y="196" width="80" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="216" fill="var(--ink)">unanswerable 4</text>
</g>
<line x1="360" y1="44" x2="360" y2="188" stroke="var(--compute)"/>
<text x="376" y="100" fill="var(--compute)">26 道进检索层</text>
<text x="376" y="120" fill="var(--ink-soft)" font-size="11">recall@k / precision@k / MRR</text>
<text x="376" y="138" fill="var(--ink-faint)" font-size="11">一道题 = 3.8%</text>
<line x1="360" y1="196" x2="360" y2="226" stroke="var(--mem)"/>
<text x="376" y="208" fill="var(--mem)">4 道只进生成层</text>
<text x="376" y="224" fill="var(--ink-soft)" font-size="11">考会不会说「没找到」</text>
</g>
</svg>
<figcaption>五种题型的分布。前四类都有标准文章,进检索层算分;无答案题没有标准文章,只在生成层考拒答。</figcaption>
</figure>

分类型的意义在于:总分会把短板盖住。整体 recall 85% 听着不错,拆开可能是政策类 100%、口语类 33%。而且以后每次改动都要按类型看,防止「错误码类涨了 10 个点,口语类跌了 20 个点」这种拆东墙补西墙,总分看着差不多,用户体验已经变了。

**问题要像真实用户。** 用户不会说「请告诉我年付套餐的退款政策」,他们说「买错了能把钱要回来吗」「Excel 存的 csv 传上去说格式不对」。最好的题来自真实的客服记录和搜索日志;还没上线没有日志,就自己扮演三种用户写:急躁的(「被扣了两次钱!」)、不懂行的(「外币的账怎么记」)、描述很绕的(「老板想看所有账但不能让他改」)。练习 2 会用代码查一遍,哪些题有照抄文档的嫌疑。

**一定要有无答案题。** 它们在检索层不算分(没有标准文章,Day 256 演示过放进分母会除以 0),但在生成层专门考模型会不会老实说「不知道」。客服场景里,编一个不存在的电话号码,或者说「支持微信支付」,危害比答一句「没找到,建议转人工」大得多。这类题的要点写的是「行为」而不是「事实」:说没找到或转人工,不能编。

## 第一步:用脚本生成 30 条

30 条手写成 JSON 很累,也容易漏逗号。我的做法是在 Python 里用元组写,一行一题,脚本负责编号和转成 JSON。新建 `part04/make_eval_set.py`:

```python
# agent-zero-lab/part04/make_eval_set.py  CloudLedger 帮助中心的第一份 RAG 评估集,30 条,写到 data/eval/rag_eval.jsonl
"""字段:
  id             q01 … q30
  question       用户问题(尽量用真实用户的说法)
  expected_docs  能回答这个问题的文章 id;空列表表示帮助中心里没有答案
  type           policy / error_code / colloquial / multi / unanswerable
  answer_points  一个好回答必须包含的要点,给 Day 260 的裁判对照用
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "eval" / "rag_eval.jsonl"

CASES = [
    # policy:直接问政策
    ("年付专业版用了两个月,想退款可以吗", ["kb-002"], "policy", ["按剩余整月比例退款", "已用月份和当月不退"]),
    ("月付的能退钱吗", ["kb-002"], "policy", ["月付不支持退款", "当前周期结束后停止服务"]),
    ("这个月被扣了两次钱", ["kb-002"], "policy", ["重复的那一笔全额退还", "3 个工作日内原路退回"]),
    ("退款多久到账", ["kb-002"], "policy", ["客服主管审批后原路退回", "支付宝 1–3 个工作日、银行卡 3–7 个工作日"]),
    ("怎么申请退款", ["kb-003"], "policy", ["设置 → 订阅 → 申请退款", "客服主管 1 个工作日内审批"]),
    ("已经开了发票还能退款吗", ["kb-003"], "policy", ["先红冲发票", "红冲完成后才能退款"]),
    ("自动扣款失败了会怎样", ["kb-004"], "policy", ["每 24 小时重试,最多 3 次", "7 天宽限期"]),
    ("降级以后多出来的账本会被删吗", ["kb-005"], "policy", ["不会删除", "变成只读"]),
    ("能开增值税专用发票吗", ["kb-006"], "policy", ["企业版或年付专业版可以开专票"]),
    ("优惠码能和别的优惠一起用吗", ["kb-008"], "policy", ["不能叠加", "每笔订单一个优惠码"]),
    # error_code:带错误码
    ("导入流水报 E1042", ["kb-010"], "error_code", ["列名不匹配或日期格式不是 YYYY-MM-DD", "下载模板,日期列设为文本"]),
    ("E1043 怎么解决", ["kb-011"], "error_code", ["文件不是 UTF-8", "另存为 CSV UTF-8 或上传 XLSX"]),
    ("上传发票提示 E2017", ["kb-012"], "error_code", ["图片模糊、短边低于 1000 像素或 PDF 加密", "重新拍摄或上传原始 PDF"]),
    ("付款时出现 E3001", ["kb-013"], "error_code", ["支付渠道拒绝", "换卡或用支付宝"]),
    ("API 返回 E4029", ["kb-019"], "error_code", ["超过每分钟 60 次限制", "等待一分钟后重试"]),
    ("连续付款失败被锁了,多久能再付", ["kb-013"], "error_code", ["连续 5 次失败锁定 1 小时"]),
    # colloquial:口语化,和文档措辞差得远
    ("买错了能把钱要回来吗", ["kb-002"], "colloquial", ["年付按剩余整月比例退款,当月不退", "月付不退当期"]),
    ("Excel 存的 csv 传上去说格式不对,好像是乱码", ["kb-011"], "colloquial", ["编码问题,需要 UTF-8", "另存为 CSV UTF-8"]),
    ("老板想看所有账但不能让他改", ["kb-015"], "colloquial", ["设为只读成员"]),
    ("换了手机号,收不到验证码登不上", ["kb-016"], "colloquial", ["旧手机号不能用可以提交人工审核", "2 个工作日"]),
    ("不想用了,怎么把账号删掉", ["kb-017"], "colloquial", ["设置 → 账号 → 注销账号", "30 天冷静期"]),
    ("外币的账怎么记", ["kb-020"], "colloquial", ["专业版及以上支持多币种", "汇率每天 8 点更新"]),
    # multi:一句话两个问题,需要两篇文章
    ("发票抬头写错了,而且我想退款", ["kb-007", "kb-003"], "multi", ["30 天内可红冲重开一次", "退款前需先红冲发票"]),
    ("免费版能建几个账本,一天能导出几次", ["kb-001", "kb-014"], "multi", ["1 个账本", "每天导出 1 次"]),
    ("扣款失败数据会丢吗,降级后账本还能用吗", ["kb-004", "kb-005"], "multi", ["超出额度的数据保留 90 天", "超出的账本只读"]),
    ("导入流水支持哪些银行,文件编码有要求吗", ["kb-009", "kb-011"], "multi", ["工行、招行、建行自动识别", "需要 UTF-8 编码"]),
    # unanswerable:帮助中心里没有,正确行为是说不知道或转人工
    ("你们支持微信支付吗", [], "unanswerable", ["说没有找到相关说明或建议转人工,不能编造支持微信支付"]),
    ("有没有手机 App", [], "unanswerable", ["说没有找到相关说明或建议转人工"]),
    ("有学生优惠吗", [], "unanswerable", ["说没有找到相关说明或建议转人工"]),
    ("客服电话是多少", [], "unanswerable", ["说没有找到相关说明或建议转人工,不能编造电话号码"]),
]


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        for i, (q, docs, typ, points) in enumerate(CASES, start=1):
            row = {"id": f"q{i:02d}", "question": q, "expected_docs": docs, "type": typ, "answer_points": points}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"写入 {len(CASES)} 条到 {OUT}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"""字段:` 模块 docstring 当字段说明书用。半年后你或同事打开这个文件,第一眼就知道每个字段是干什么的。
- `OUT = Path(__file__).resolve().parent.parent / "data" / "eval" / "rag_eval.jsonl"` 从里往外读:`__file__` 是这个脚本自己的路径,`.resolve()` 转成绝对路径,`.parent` 是 `part04/`,再 `.parent` 是 `agent-zero-lab/`,然后拼上 `data/eval/rag_eval.jsonl`。`/` 拼路径是 `Path` 的写法([Day 37](/blog/agent-zero/day-037-pathlib/)),相当于 Node 的 `path.join`。这样不管你在哪个目录运行,文件都写到同一个地方。
- `CASES = [` 每道题一个四元组:(问题,文章 id 列表,题型,要点列表)。用元组手写比写字典省一半字,一行一题,一眼能扫完。
- `("年付专业版用了两个月,想退款可以吗", ["kb-002"], "policy", ["按剩余整月比例退款", "已用月份和当月不退"]),` 每个要点都是我对着 kb-002 原文确认过的:「按剩余的整月数比例退款」「已经使用的月份和当前所在的月份不退」。标要点的时候一定要回去翻原文,凭记忆写很容易把 3 个工作日写成 5 个。
- `("降级以后多出来的账本会被删吗", ["kb-005"], "policy", ["不会删除", "变成只读"]),` 有的题要点只要一两条。要点数量不要凑,能区分好坏回答就够了。
- `("连续付款失败被锁了,多久能再付", ["kb-013"], "error_code", ["连续 5 次失败锁定 1 小时"]),` 这题问题里没有错误码,但答案在错误码文章 E3001 里。我把它归到 error_code,是因为它考的是「能不能找到错误码那篇」。题型的边界不用太较真,自己定一个说得通的规矩,前后一致就行。
- `("买错了能把钱要回来吗", ["kb-002"], "colloquial", ["年付按剩余整月比例退款,当月不退", "月付不退当期"]),` 和 q01、q02 是同一篇文章,换成口语问。故意让几道题答案相同、说法不同,正好看检索对说法敏不敏感。
- `("发票抬头写错了,而且我想退款", ["kb-007", "kb-003"], "multi", ["30 天内可红冲重开一次", "退款前需先红冲发票"]),` 两篇文章。Day 256 说过,这类题 recall 和 hit 会不一样。
- `("你们支持微信支付吗", [], "unanswerable", ["说没有找到相关说明或建议转人工,不能编造支持微信支付"]),` 文章是空列表。要点写的是正确的**行为**。帮助中心提到了支付宝和银行卡,模型很容易顺嘴说「也支持微信」,所以把「不能编造支持微信支付」写明。
- `OUT.parent.mkdir(parents=True, exist_ok=True)` 先建 `data/eval/`。`parents=True` 相当于 `mkdir -p`,上级没有就一起建;`exist_ok=True` 目录已经在了也不报错,脚本可以反复跑。
- `with OUT.open("w", encoding="utf-8") as f:` `"w"` 是覆盖写,每次跑都是最新的 30 条,不会越积越多。`with` 保证块结束时文件被关上([Day 38](/blog/agent-zero/day-038-files-with/))。
- `for i, (q, docs, typ, points) in enumerate(CASES, start=1):` `enumerate` 从 1 开始编号;每个四元组在括号里直接解包成四个变量,相当于 JS 的 `const [q, docs, typ, points] = c`。
- `row = {"id": f"q{i:02d}", "question": q, "expected_docs": docs, "type": typ, "answer_points": points}` `{i:02d}` 是 f-string 的格式说明:整数,至少两位,不够补 0。1 变成 `q01`。补零是为了按字符串排序时 `q02` 排在 `q10` 前面,不然会是 q1、q10、q11……q2。写成文件时换成带名字的字段,后面的脚本按 `row["question"]` 取值,比按位置 `row[0]` 清楚,以后加字段也不怕顺序乱。
- `f.write(json.dumps(row, ensure_ascii=False) + "\n")` 一条一行,后面加换行。这就是 JSONL 格式。
- `print(f"写入 {len(CASES)} 条到 {OUT}")` 打出绝对路径,确认写到哪了。

</div>

在 `agent-zero-lab/` 下跑:

```bash
uv run python -m part04.make_eval_set
head -3 data/eval/rag_eval.jsonl
wc -l data/eval/rag_eval.jsonl
```

```text
写入 30 条到 /Users/你/agent-zero-lab/data/eval/rag_eval.jsonl
{"id": "q01", "question": "年付专业版用了两个月,想退款可以吗", "expected_docs": ["kb-002"], "type": "policy", "answer_points": ["按剩余整月比例退款", "已用月份和当月不退"]}
{"id": "q02", "question": "月付的能退钱吗", "expected_docs": ["kb-002"], "type": "policy", "answer_points": ["月付不支持退款", "当前周期结束后停止服务"]}
{"id": "q03", "question": "这个月被扣了两次钱", "expected_docs": ["kb-002"], "type": "policy", "answer_points": ["重复的那一笔全额退还", "3 个工作日内原路退回"]}
      30 data/eval/rag_eval.jsonl
```

`head -3` 看前三行,`wc -l` 数行数([Day 5](/blog/agent-zero/day-005-terminal-3/) 学过),30 行就是 30 条。

### 为什么用 JSONL

**JSONL**(JSON Lines)是「每行一个 JSON 对象」的文件格式,扩展名 `.jsonl`。它不是一个大 JSON 数组,文件开头没有 `[`,行与行之间也没有逗号。你在前端可能见过类似的东西:流式接口一行吐一个 JSON,`fetch` 读 body 时按换行切开再逐行 `JSON.parse`,思路一样。

评估集几乎都用它存,原因很实际:加一条就是在文件末尾追加一行,不用管前面那条后面要不要补逗号;`git diff` 里改了哪条一目了然,一行就是一道题;文件很大时可以一行一行读,不用一次全装进内存。

评估集要和代码一起进 git。改了评估集(加题、改标注),之前跑出来的分数就不能直接和新分数比了,所以以后每次实验记录都要写上用的是哪个版本的评估集。最简单的办法是记 git 的 commit 号,或者像练习 1 那样另存一个 `rag_eval_v2.jsonl`。

## 故意踩一次坑:把 JSONL 当 JSON 读

JSONL 读起来有一个所有人都踩过的坑:用 `json.loads` 一口气读整个文件。新建 `part04/load_wrong.py` 试一下:

```python
# agent-zero-lab/part04/load_wrong.py  把整个 JSONL 文件当成一个 JSON 读,会怎样
import json
from pathlib import Path

path = Path("data/eval/rag_eval.jsonl")
rows = json.loads(path.read_text(encoding="utf-8"))
print(len(rows))
```

<div class="line-notes">

- `path = Path("data/eval/rag_eval.jsonl")` 相对路径,要在 `agent-zero-lab/` 下运行才找得到文件。
- `rows = json.loads(path.read_text(encoding="utf-8"))` `read_text` 把整个文件读成一个字符串,交给 `json.loads` 当一整段 JSON 解析。

</div>

```bash
uv run python -m part04.load_wrong
```

```text
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File "/Users/你/agent-zero-lab/part04/load_wrong.py", line 6, in <module>
    rows = json.loads(path.read_text(encoding="utf-8"))
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python3.12/json/__init__.py", line 346, in loads
    return _default_decoder.decode(s)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python3.12/json/decoder.py", line 341, in decode
    raise JSONDecodeError("Extra data", s, end)
json.decoder.JSONDecodeError: Extra data: line 2 column 1 (char 139)
```

`Extra data: line 2 column 1` 的意思是:第 1 行是一个完整的 JSON 对象,解析完了,结果第 2 行开头还有东西,不知道该拿它怎么办。一段 JSON 只能有一个顶层值。在浏览器 Console 里 `JSON.parse('{"a":1}\n{"b":2}')` 也会报类似的 `Unexpected non-whitespace character after JSON`。看到 `Extra data`,八成就是把 JSONL 当 JSON 读了。修法是一行一行读,每行单独 `json.loads`,下一步写成函数。

## 第二步:读评估集,顺手检查标注

30 条是手写的,手写就会手滑。常见的错:文章 id 多打一个字(`kb-0111`),一句两问的题只标了一篇,无答案题被顺手标了一篇文章。这些错不会让脚本报错,只会让分数悄悄变歪。所以评估集旁边要配一个检查脚本,每次改完跑一遍,就像前端提交前跑一遍 lint。

新建 `part04/eval_set.py`,一个函数读,一个函数查:

```python
# agent-zero-lab/part04/eval_set.py  读评估集,并检查它有没有低级错误
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVAL_PATH = ROOT / "data" / "eval" / "rag_eval.jsonl"
KB_DIR = ROOT / "data" / "kb"
TYPES = {"policy", "error_code", "colloquial", "multi", "unanswerable"}


def load_eval_set(path: Path = EVAL_PATH) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def check_eval_set(rows: list[dict]) -> list[str]:
    known_docs = {p.stem for p in KB_DIR.glob("kb-*.md")}
    problems = []
    ids = Counter(r["id"] for r in rows)
    problems += [f"{i}: id 重复 {n} 次" for i, n in ids.items() if n > 1]
    for r in rows:
        rid, docs, typ = r["id"], r["expected_docs"], r["type"]
        if typ not in TYPES:
            problems.append(f"{rid}: 未知题型 {typ}")
        for d in docs:
            if d not in known_docs:
                problems.append(f"{rid}: 文章 {d} 不存在")
        if (typ == "unanswerable") != (len(docs) == 0):
            problems.append(f"{rid}: 题型 {typ} 和 expected_docs={docs} 对不上")
        if typ == "multi" and len(docs) < 2:
            problems.append(f"{rid}: multi 题至少要两篇文章")
        if not r["answer_points"]:
            problems.append(f"{rid}: 没有 answer_points")
    return problems


if __name__ == "__main__":
    rows = load_eval_set()
    print(f"共 {len(rows)} 条")
    for typ, n in Counter(r["type"] for r in rows).most_common():
        print(f"  {typ:<13}{n}")
    problems = check_eval_set(rows)
    print("检查结果:", problems or "没有问题")
```

<div class="line-notes">

- `from collections import Counter` `Counter` 是一个专门用来数数的字典:给它一串东西,它告诉你每样出现了几次。JS 里你会写 `arr.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {})`,这里一行搞定。
- `ROOT = Path(__file__).resolve().parent.parent` 和 `make_eval_set.py` 一样,定位到 `agent-zero-lab/`。
- `TYPES = {"policy", "error_code", "colloquial", "multi", "unanswerable"}` 合法题型用集合存,判断「在不在里面」很快。
- `def load_eval_set(path: Path = EVAL_PATH) -> list[dict]:` 默认读 v1,传别的路径就能读 v2。Day 259 的检索评估脚本会 import 这个函数。
- `for line in f:` 直接遍历文件对象,每次拿到一行(带着末尾的 `\n`),不会一次把整个文件读进内存。
- `if line.strip():` 跳过空行。文件末尾多一个空行很常见(很多编辑器保存时会加),空字符串交给 `json.loads` 会报 `Expecting value`。`strip()` 去掉首尾空白,剩下空字符串就是假。
- `rows.append(json.loads(line))` 每行单独解析。这就是上一节那个报错的修法。
- `known_docs = {p.stem for p in KB_DIR.glob("kb-*.md")}` `glob("kb-*.md")` 找出所有文章文件;`p.stem` 是文件名去掉扩展名,`kb-002.md` 变成 `kb-002`。集合推导式,得到 20 个 id。用真实文件当「合法 id 名单」,而不是手写一份,这样以后加文章不用改这里。
- `ids = Counter(r["id"] for r in rows)` 数每个 id 出现几次。正常情况每个都是 1。
- `problems += [f"{i}: id 重复 {n} 次" for i, n in ids.items() if n > 1]` 列表推导式带 `if` 过滤,只留出现超过一次的。`+=` 把新列表接到 `problems` 后面,相当于 JS 的 `problems.push(...list)`。
- `rid, docs, typ = r["id"], r["expected_docs"], r["type"]` 一行取三个字段,下面写起来短。
- `for d in docs:` 每篇标注的文章都得真的存在。
- `if (typ == "unanswerable") != (len(docs) == 0):` 这行最绕,拆开看:左边「是不是无答案题」,右边「文章列表是不是空的」,两个应该同真同假。`!=` 用在两个布尔值上,就是「一真一假」。无答案题标了文章,或者普通题忘了标文章,都会被抓到。
- `if typ == "multi" and len(docs) < 2:` 一句两问至少两篇。
- `if not r["answer_points"]:` 空列表在 `if` 里算假。没有要点,Day 260 的裁判就没法判。
- `for typ, n in Counter(r["type"] for r in rows).most_common():` `most_common()` 按次数从多到少排好,返回 `[(题型, 条数), ...]`。
- `print(f"  {typ:<13}{n}")` `:<13` 左对齐占 13 格,最长的 `unanswerable` 是 12 个字母,留一格空。
- `print("检查结果:", problems or "没有问题")` `a or b`:a 为真就是 a,否则是 b。`problems` 是空列表时打印「没有问题」,相当于 JS 的 `problems.length ? problems : "没有问题"`。

</div>

```bash
uv run python -m part04.eval_set
```

```text
共 30 条
  policy       10
  error_code   6
  colloquial   6
  multi        4
  unanswerable 4
检查结果: 没有问题
```

没有问题不代表检查有用。检查脚本也要测:故意改坏几条,看它抓不抓得到。新建 `part04/check_broken.py`,在内存里改,不动文件:

```python
# agent-zero-lab/part04/check_broken.py  故意改坏三条,看检查能不能抓出来
import copy

from part04.eval_set import check_eval_set, load_eval_set

rows = copy.deepcopy(load_eval_set())
rows[11]["expected_docs"] = ["kb-0111"]      # q12 手滑多打一个 1
rows[22]["expected_docs"] = ["kb-007"]       # q23 multi 题漏标一篇
rows[29]["expected_docs"] = ["kb-016"]       # q30 无答案题被标了文章
for p in check_eval_set(rows):
    print(p)
```

<div class="line-notes">

- `rows = copy.deepcopy(load_eval_set())` 深拷贝。这里其实每次都是新读的,不拷也不会改到文件;养成习惯是因为以后你可能把读好的 `rows` 缓存起来给好几个函数用,改坏一份会连累其他人。相当于 JS 的 `structuredClone`。
- `rows[11]["expected_docs"] = ["kb-0111"]` 下标 11 是第 12 条,也就是 q12,下标从 0 开始。
- `rows[29]["expected_docs"] = ["kb-016"]` q30「客服电话是多少」,假装标注的人觉得「账号安全那篇应该有电话吧」。
- `for p in check_eval_set(rows):` 逐条打印问题。

</div>

```bash
uv run python -m part04.check_broken
```

```text
q12: 文章 kb-0111 不存在
q23: multi 题至少要两篇文章
q30: 题型 unanswerable 和 expected_docs=['kb-016'] 对不上
```

三条全抓到。想想 q30 如果没被抓到会怎样:它会进检索层算分,检索十有八九拿不到 kb-016,于是 recall 被冤枉地拉低一截,你还会去「优化」一个根本不存在的问题。

## 30 条够不够

作为第一版够了,它能抓住大问题:BM25 在口语题上不行、无答案题会编话,这些 30 条里都看得出来。但要清楚它的局限。

检索层能算分的是 26 道(练习 3 会数一遍),一道题就是 3.8 个百分点。两套配置差 4 个点,可能就是一道题的差别,而 Day 255 已经看到同样的代码跑两次会有一道题跳格子。所以小于两三道题的差距,不要急着下结论,多跑几次,或者扩大题库。题目多大才够、差多少才算真的有差别,要用到一点统计,放在 [Day 353](/blog/agent-zero/day-353-stats-intuition/) 讲。

实际项目里,我会从 30 条起步,上线后每发现一个线上答错的案例就加一条进来,几个月自然长到几百条。一份半年没更新的评估集,大概率已经不代表真实流量了。

另一个要提防的是**过拟合评估集**:盯着这 30 道题反复调,调到 30 道全对,上线一看没变好,因为你调的是这 30 道的特例。办法是留一部分题平时不看,只在最后验收时跑一次,这个做法在 Day 348 讲测试集时展开。

## 今天的文件

| 文件 | 干什么 | 谁会用 |
| --- | --- | --- |
| `part04/make_eval_set.py` | 30 道题的源头,生成 JSONL | 以后加题改这里 |
| `data/eval/rag_eval.jsonl` | 评估集 v1,进 git | Day 259、260、261 |
| `part04/eval_set.py` | `load_eval_set()`、`check_eval_set()` | Day 259 import |
| `part04/eval_one.py`、`load_wrong.py`、`check_broken.py` | 今天的演示 | 只今天 |

## 动手练习

**练习 1:加 5 道自己的题,存成 v2。** 至少一道无答案题、一道一句两问。不要改 v1,另存成 `data/eval/rag_eval_v2.jsonl`,存完跑一遍检查。写 `part04/ex257_1.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex257_1.py  练习 1:加 5 条自己的题,写成 v2,不覆盖 v1
import json

from part04.eval_set import EVAL_PATH, check_eval_set, load_eval_set

EXTRA = [
    ("专业版最多能加几个人", ["kb-015"], "policy", ["专业版最多 3 名成员"]),
    ("误删了数据还能找回来吗", ["kb-018"], "colloquial", ["企业版可申请从备份恢复,每次 500 元", "其他套餐不提供"]),
    ("E1042 是啥意思,模板去哪下", ["kb-010"], "error_code", ["列名或日期格式不对", "下载最新导入模板"]),
    ("想从专业版升到企业版,差价怎么算,升完能开专票吗", ["kb-005", "kb-006"], "multi", ["按剩余天数折算补差价", "企业版可以开专票"]),
    ("能开英文发票吗", [], "unanswerable", ["说没有找到相关说明或建议转人工,不能编造"]),
]

rows = load_eval_set()
for i, (q, docs, typ, points) in enumerate(EXTRA, start=len(rows) + 1):
    rows.append({"id": f"q{i:02d}", "question": q, "expected_docs": docs, "type": typ, "answer_points": points})
out = EVAL_PATH.with_name("rag_eval_v2.jsonl")
out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
print(f"v2 共 {len(rows)} 条,最后一条 id = {rows[-1]['id']}")
print("检查结果:", check_eval_set(rows) or "没有问题")
```

<div class="line-notes">

- `("误删了数据还能找回来吗", ["kb-018"], "colloquial", ["企业版可申请从备份恢复,每次 500 元", "其他套餐不提供"]),` 对着 kb-018 原文写的要点:「企业版客户误删数据后,可以申请从备份恢复,每次收费 500 元。其他套餐不提供备份恢复服务」。
- `("能开英文发票吗", [], "unanswerable", ["说没有找到相关说明或建议转人工,不能编造"]),` kb-006 讲了发票类型,但没讲语言,模型很可能顺着「电子普通发票」编一句。这种「有相关文章、但恰好没写这一点」的无答案题最难,比「客服电话」那种完全无关的更能考出问题。
- `for i, (q, docs, typ, points) in enumerate(EXTRA, start=len(rows) + 1):` 编号从 31 接着往下编,`len(rows)` 是 30。
- `out = EVAL_PATH.with_name("rag_eval_v2.jsonl")` `with_name` 换掉文件名、保留目录,得到 `data/eval/rag_eval_v2.jsonl`。
- `out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")` 先把每行拼好再一次写入。和 `make_eval_set.py` 的逐行 `f.write` 效果一样,条数少时这样写更短。
- `print("检查结果:", check_eval_set(rows) or "没有问题")` 加完题立刻检查。

</div>

```text
v2 共 35 条,最后一条 id = q35
检查结果: 没有问题
```

v1 不动,v2 另存。Day 259 用 v1 跑出的分数,和以后用 v2 跑出的分数,不能放在同一张表里直接比。

</details>

**练习 2:哪些题有照抄文档的嫌疑?** 对每道有答案的题,找出问题和它的答案文章之间最长的公共子串(连续相同的一段字),按长度排序,看前 5 和后 3。提示:标准库 `difflib.SequenceMatcher` 有 `find_longest_match`。写 `part04/ex257_2.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex257_2.py  练习 2:找出「照抄文档」的题:问题和答案文章的最长公共子串
from difflib import SequenceMatcher

from part04.eval_set import KB_DIR, load_eval_set


def longest_common(a: str, b: str) -> str:
    m = SequenceMatcher(None, a, b, autojunk=False).find_longest_match(0, len(a), 0, len(b))
    return a[m.a : m.a + m.size]


rows = [r for r in load_eval_set() if r["expected_docs"]]
scored = []
for r in rows:
    text = "".join((KB_DIR / f"{d}.md").read_text(encoding="utf-8") for d in r["expected_docs"])
    common = longest_common(r["question"], text)
    scored.append((len(common), r["id"], r["type"], r["question"], common))
scored.sort(reverse=True)
for n, rid, typ, q, common in scored[:5]:
    print(f"{n:>2} 字  {rid} {typ:<11} {q}  ← 「{common}」")
print("…")
for n, rid, typ, q, common in scored[-3:]:
    print(f"{n:>2} 字  {rid} {typ:<11} {q}  ← 「{common}」")
```

<div class="line-notes">

- `from difflib import SequenceMatcher` `difflib` 是 Python 自带的文本比较库,`git diff` 那种「哪里相同哪里不同」的算法。不用装。
- `m = SequenceMatcher(None, a, b, autojunk=False).find_longest_match(0, len(a), 0, len(b))` 第一个参数 `None` 表示没有要忽略的字符;`autojunk=False` 关掉它的一个优化(长文本里出现很频繁的字符会被当成「垃圾」跳过,中文常用字容易被误伤)。`find_longest_match` 在 a 的 `[0, len(a))` 和 b 的 `[0, len(b))` 范围里找最长的公共连续片段,返回 `m.a`(在 a 里的起点)、`m.size`(长度)。
- `return a[m.a : m.a + m.size]` 用起点和长度从问题里切出那一段。
- `rows = [r for r in load_eval_set() if r["expected_docs"]]` 无答案题没有文章可比,先滤掉。
- `text = "".join((KB_DIR / f"{d}.md").read_text(encoding="utf-8") for d in r["expected_docs"])` 一句两问的题有两篇文章,拼在一起比。
- `scored.append((len(common), r["id"], r["type"], r["question"], common))` 长度放元组第一位,排序时就按长度排。
- `scored.sort(reverse=True)` 元组按第一个元素比大小,`reverse=True` 从大到小。

</div>

```text
 7 字  q09 policy      能开增值税专用发票吗  ← 「增值税专用发票」
 6 字  q18 colloquial  Excel 存的 csv 传上去说格式不对,好像是乱码  ← 「Excel 」
 6 字  q15 error_code  API 返回 E4029  ← 「 E4029」
 6 字  q14 error_code  付款时出现 E3001  ← 「 E3001」
 6 字  q13 error_code  上传发票提示 E2017  ← 「 E2017」
…
 1 字  q22 colloquial  外币的账怎么记  ← 「外」
 1 字  q19 colloquial  老板想看所有账但不能让他改  ← 「看」
 1 字  q17 colloquial  买错了能把钱要回来吗  ← 「要」
```

最长的也就 7 个字,没有整句照抄的。错误码题重合 6 个字是应该的,错误码本来就是用户原样从报错里抄过来的。q09 的「增值税专用发票」是个专有名词,真实用户多半会说「专票」,可以考虑在 v2 里加一道「能开专票吗」。口语题和文档只重合 1 个字,符合它的设计。这个检查很粗,但能把「整句照着文档问」的题筛出来。

</details>

**练习 3:按题型筛选。** 打印所有 multi 题和它们的文章,再算出检索层能算分的题有几道、一道题占多少百分比。写 `part04/ex257_3.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex257_3.py  练习 3:按题型筛选,算出检索层能算分的题有几道
from part04.eval_set import load_eval_set

rows = load_eval_set()
multi = [r for r in rows if r["type"] == "multi"]
for r in multi:
    print(r["id"], r["question"], r["expected_docs"])
scorable = [r for r in rows if r["expected_docs"]]
print(f"检索层能算分 {len(scorable)} 道,无答案题 {len(rows) - len(scorable)} 道")
print(f"一道题占检索层分数的 {1 / len(scorable):.1%}")
```

<div class="line-notes">

- `multi = [r for r in rows if r["type"] == "multi"]` 列表推导式带条件,相当于 JS 的 `rows.filter(r => r.type === "multi")`。
- `scorable = [r for r in rows if r["expected_docs"]]` 文章列表非空的才能算检索分。
- `print(f"一道题占检索层分数的 {1 / len(scorable):.1%}")` `:.1%` 把小数乘 100、保留一位、加百分号,`1/26` 显示成 `3.8%`。

</div>

```text
q23 发票抬头写错了,而且我想退款 ['kb-007', 'kb-003']
q24 免费版能建几个账本,一天能导出几次 ['kb-001', 'kb-014']
q25 扣款失败数据会丢吗,降级后账本还能用吗 ['kb-004', 'kb-005']
q26 导入流水支持哪些银行,文件编码有要求吗 ['kb-009', 'kb-011']
检索层能算分 26 道,无答案题 4 道
一道题占检索层分数的 3.8%
```

</details>

**练习 4(开放题):同一个意思,换个说法。** 挑三条文档里有的规则,各写一个「照着文档问」和一个「口语问」的版本,分别用 BM25 和混合 + rerank 检索,比较倒数排名。写 `part04/ex257_4.py`。

<details><summary>参考答案</summary>

示范解法:选降级、注销、换手机号三条。

```python
# agent-zero-lab/part04/ex257_4.py  练习 4:同一个意思,照着文档问和口语问,倒数排名差多少
from part04.metrics import dedup_docs, reciprocal_rank
from part04.retrieve import retrieve

PAIRS = [
    ("降级后超出额度的账本会怎样", "降了套餐以后那几个账本是不是就没了", {"kb-005"}),
    ("如何注销账号", "这个号我不要了,能销户吗", {"kb-017"}),
    ("更换手机号需要旧手机号接收验证码吗", "手机丢了,换了新号怎么改绑", {"kb-016"}),
]
for mode in ["bm25", "hybrid+rerank"]:
    print(f"== {mode}")
    for doc_style, user_style, expected in PAIRS:
        rr = []
        for q in (doc_style, user_style):
            docs = dedup_docs([c.doc_id for c, _ in retrieve(q, k=6, mode=mode)])
            rr.append(reciprocal_rank(docs, expected))
        print(f"  原话式 {rr[0]:.3f}  口语式 {rr[1]:.3f}  {user_style}")
```

<div class="line-notes">

- `("降级后超出额度的账本会怎样", "降了套餐以后那几个账本是不是就没了", {"kb-005"}),` 前一个几乎是 kb-005 原文的改写,后一个是用户会说的话。
- `for q in (doc_style, user_style):` 同一条规则的两种问法依次检索。
- `rr.append(reciprocal_rank(docs, expected))` 用 Day 256 的函数。

</div>

```text
== bm25
  原话式 1.000  口语式 0.500  降了套餐以后那几个账本是不是就没了
  原话式 1.000  口语式 0.000  这个号我不要了,能销户吗
  原话式 1.000  口语式 0.000  手机丢了,换了新号怎么改绑
== hybrid+rerank
  原话式 1.000  口语式 1.000  降了套餐以后那几个账本是不是就没了
  原话式 1.000  口语式 1.000  这个号我不要了,能销户吗
  原话式 1.000  口语式 1.000  手机丢了,换了新号怎么改绑
```

照着文档问,两种检索全是满分;换成口语,BM25 三题掉到 0.5、0、0。如果评估集里全是原话式的题,你会得出「BM25 和混合检索一样好」的结论,上线后口语用户全找不到答案。这就是为什么口语题必须进评估集。

</details>

**验收标准:** `data/eval/rag_eval.jsonl` 30 行,`eval_set.py` 检查「没有问题」,`check_broken.py` 三条都抓到;不看文章,能说出五种题型各考什么、为什么无答案题不进检索层、为什么标要点不标全文。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 评估集(eval set) | 一组带标注的测试题,用来给系统打分。今天的 v1 有 30 道 |
| 标注 / 用例 | 一道题和它的标准答案信息。今天每条有 id、question、expected_docs、type、answer_points 五个字段 |
| 题型(type) | 按考什么给题分类,今天五类:policy、error_code、colloquial、multi、unanswerable |
| 答案要点(answer points) | 好回答必须包含的几条信息,比标准答案全文更容易判、不受措辞影响 |
| JSONL(JSON Lines) | 每行一个 JSON 对象的文件格式,没有外层数组、行间没有逗号,方便追加和看 diff |
| `JSONDecodeError: Extra data` | 一段 JSON 后面还有多余的内容,常见于把 JSONL 当 JSON 一次读 |
| `Counter` | Python 标准库里专门数数的字典,`most_common()` 按次数排序 |
| 评估集版本 | 改了题或标注就是新版本,不同版本的分数不能直接比 |
| 过拟合评估集 | 盯着评估集的题反复调,分数变高但真实效果没变 |

## 常见误区

**题都照着文档问。** 练习 4 实测:照文档问,BM25 三题满分;换成口语,两题掉到 0。评估集里没有口语题,就测不出这个短板。

**没有无答案题。** 系统最危险的行为,编造事实,完全没被测到。Day 255 宽松提示词说「公司位于杭州」,只有无答案题能抓到这种事。

**标准答案写全文。** 意思对、措辞不同就判错。标两三条要点,裁判和人工复核都更好判。

**用 `json.loads` 读整个 JSONL。** 报 `JSONDecodeError: Extra data: line 2 column 1`。一行一行读,每行单独解析,并跳过空行。

**`json.dumps` 忘了 `ensure_ascii=False`。** 文件里全是 `月付`,机器读没问题,人没法审,code review 时 diff 也看不懂。

**标注凭记忆写。** 把「3 个工作日」记成「5 个工作日」,裁判会拿错的要点去判对的回答。每条要点都回原文核对。

**不写检查脚本。** 文章 id 打错、多答案题漏标一篇,脚本不报错,分数悄悄变歪,你还会去「修」一个不存在的检索问题。

**改了评估集还和旧分数比。** v1 和 v2 的分数不能放在一张表里直接比,实验记录要写评估集版本。

## 学习资料

### 文档与文章

- [Jason Liu · Systematically Improving Your RAG](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/):先用合成题建检索评估、再按题型拆开找短板,和今天五种题型的思路一样,重点读「synthetic data」和「segment」两段,40 分钟。
- [Jason Liu · The RAG Playbook](https://jxnl.co/writing/2024/08/19/rag-flywheel/):讲怎么让评估集随着线上反馈一直长,对应今天「每发现一个线上 bug 就加一条」。
- [Hamel Husain · A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/):讲为什么要先看真实数据、怎么系统地造测试数据(按维度组合出题),和今天按题型覆盖是同一个意思,1 小时。
- [Claude 文档 · Define success criteria and build evaluations](https://docs.claude.com/en/docs/test-and-evaluate/develop-tests):Anthropic 官方的「怎么设计评测用例」,看「edge cases」那部分,无答案题就是一种边界情况。
- [JSON Lines](https://jsonlines.org/):JSONL 格式的官方说明,一页就读完,看「为什么用它」和示例。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WPnuzPEzD&autoplay=0&high_quality=1" title="为什么AI评估是产品构建者最热门的新技能 | Hamel Husain & Shreya Shankar [附文稿]" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Web3天空之城 · 为什么AI评估是产品构建者最热门的新技能(Hamel Husain、Shreya Shankar,中文字幕搬运)· 106 分钟,两位做评估的人讲怎么从真实数据里找错误、怎么建测试集。今天看前 40 分钟讲「先看数据、再出题」的部分。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1b69gB5E3h&autoplay=0&high_quality=1" title="面试官问:如何评估RAG系统的效果?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI深度幻觉 · 面试官问:如何评估RAG系统的效果? · 12 分钟。Day 255 看过的话,这次只听讲「测试集怎么来」的那段,对照今天的五种题型。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/mF4CaijvJos" title="How To Build AI Evals" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How To Build AI Evals · 英文,讲评测数据从哪来、怎么按维度覆盖、怎么一点点长大,开自动字幕。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 4 章「Evaluate AI Systems」里讲评估数据怎么准备的部分:怎么按切片(slice)组织测试数据、为什么要单独看每个切片的分数,和今天按题型拆开是一回事。

### 开源项目与代码

- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):RAGAS 有一个「测试集生成」模块,能用大模型从文档里自动出题并分类型。先看它的文档目录里 testset generation 部分,知道有这个东西,Day 261 再讲自动出题的利弊。
- [beir-cellar/beir](https://github.com/beir-cellar/beir):学术界的检索评测基准,每个数据集都是「queries + corpus + qrels(哪道题对应哪篇文档)」三件套,和今天的 question + data/kb + expected_docs 一一对应,看一眼它的数据格式说明。

## 自测

**1. 今天一条用例有哪五个字段?检索层和生成层各用哪几个?**

<details><summary>答案</summary>

id、question、expected_docs、type、answer_points。检索层用 question(拿去检索)和 expected_docs(和结果比);生成层用 question 和 answer_points(裁判对照要点),无答案题看要点里写的「该有的行为」。type 两层都用,用来按题型拆开看分数。

</details>

**2. 为什么评估集里一定要有口语题?用今天的实测说明。**

<details><summary>答案</summary>

用户说话和文档措辞差得远。练习 4 里同一条规则,照文档问 BM25 三题倒数排名都是 1,换成口语变成 0.5、0、0。全是原话式的题,BM25 和混合检索会显得一样好,上线后口语用户找不到答案。

</details>

**3. 读 JSONL 时报 `JSONDecodeError: Extra data: line 2 column 1`,是什么原因,怎么改?**

<details><summary>答案</summary>

把整个 JSONL 文件当成一段 JSON 交给 `json.loads`,第一行解析完后面还有内容。改成逐行读,每行单独 `json.loads`,跳过空行。

</details>

**4. `check_eval_set` 里 `(typ == "unanswerable") != (len(docs) == 0)` 能抓到哪两种错误?**

<details><summary>答案</summary>

无答案题被标了文章(左真右假),和普通题忘了标文章(左假右真)。两个条件本来应该同真同假,不相等就说明标注错了。

</details>

**5.(面试题)让你给一个刚做出来、还没上线的 RAG 客服建第一份评估集,你怎么做?**

<details><summary>答案</summary>

先定结构:每条有问题、答案所在文档、题型、答案要点。题从哪来:没有线上日志,就找客服同事要常见问题清单,再自己扮演急躁、不懂行、描述很绕三种用户改写;按风险分类型覆盖,至少有直接问政策、带错误码或编号、口语化、一句多问、知识库里没有答案的几类,每类都要有。标注:答案按文档标(块会随切块参数变),要点对着原文写两三条,不写全文。质量:配检查脚本防 id 打错、类型和标注不一致,再用最长公共子串之类的方法查有没有照抄文档的题。规模:第一版三五十条先跑起来,知道一道题占多少百分点、小差距不下结论;上线后每个答错的案例都加进来,评估集进 git、记版本,留一部分题只在验收时用,防止过拟合。

</details>

## 明天预告

Day 258 · 第 37 周复习:RAG 与上下文(Day 252–257)。这一周前三天做 GraphRAG,后三天开始做评估:分两层、三个检索指标、30 条评估集。明天把这六天串成一张知识地图,整理错题和坑,再默写 `metrics.py` 和 `eval_set.py` 的核心函数跑通。复习完,Day 259 就拿今天的 30 条、Day 256 的指标,写第一个完整的检索评估脚本。
