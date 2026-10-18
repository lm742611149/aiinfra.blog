---
title: 'Day 16 · 第一个 RAG:切块、向量化、检索、拼 prompt(numpy 暴力版)'
description: '不用向量数据库、不用框架,一百多行代码搭出完整的 RAG:造出 CloudLedger 帮助中心的 20 篇文章,切块、向量化、存成 numpy 文件,对问题做检索,再让大模型带着引用出处回答。'
pubDate: 2026-10-12
regime: none
tags: ['rag', 'chunking', 'numpy', 'citation', 'agent-60']
series: 'agent-60'
day: 16
lang: 'zh'
---

## 今天要解决的问题

昨天你学会了把文字变成向量,并且看到「我想把钱要回来」和「退款政策」在向量空间里挨得很近。今天把这件事变成一个能用的系统:用户问一个问题,程序先去帮助中心里找最相关的几段,把它们和问题一起交给大模型,大模型照着资料回答,并且告诉你每句话出自哪篇文章。

这个模式就叫 RAG(Retrieval-Augmented Generation,检索增强生成)。名字听起来唬人,拆开就是三步:检索(Retrieval)、拼进 prompt(Augmented)、生成(Generation)。今天我们一行框架代码都不用,用 numpy 暴力算相似度,把每一步都摊开看。

今天结束时你应该能做到:

1. 说清楚 RAG 为什么存在,以及什么时候不需要 RAG。
2. 画出 RAG 的两条流水线:离线建索引、在线回答问题。
3. 用一个脚本造出 CloudLedger 帮助中心(20 篇文章),后面整个课程都会复用这份数据。
4. 实现按标题切块,并说出切块大小对效果的影响。
5. 跑通 `ask.py`:问「年付买错了能退吗」,拿到带 `[kb-002#1]` 这种引用的回答;问一个资料里没有的问题,模型老实说不知道。

预计用时 4–5 小时。前置:Day 15 的 `embed.py`,Day 4 的多轮消息概念,Day 5 的提示词写法。

## RAG 为什么存在

大模型的知识有两个天生的限制。一是截止日期:它只知道训练时见过的东西,CloudLedger 上个月刚调整的退款规则,它不可能知道。二是私有数据:你公司的帮助中心、内部文档、客户合同,模型从来没见过。

你当然可以把整个帮助中心直接塞进 prompt。CloudLedger 这 20 篇文章加起来也就几千字,现在动辄几十万 token 的上下文窗口塞得下。这其实是个合理的选择,文档量小的时候,我真的会推荐你先这么干,简单、不会漏。但是一旦文档变多,三个问题马上出现:

- 钱。每问一个问题都要为整个知识库付一次输入 token 的钱。一个 50 万字的知识库,一次提问几十万 token,一天一千个问题,账单很难看。prompt caching(Day 38)能缓解,但不能根治。
- 慢。输入越长,首 token 延迟越高。
- 准。上下文太长时,模型对中间部分的注意力会变差,这个现象有篇很有名的论文叫 [Lost in the Middle](https://arxiv.org/abs/2307.03172)。Day 20 讲上下文工程时还会回来。

RAG 的思路是:别让模型读全部,只读跟问题有关的那几段。读得少,所以便宜、快、准。代价是多了一个「找」的环节,而这个环节找错了,后面就全错了。W3 剩下几天,本质上都在优化「找」这件事。

RAG 的概念最早来自 2020 年 Facebook AI 的论文 [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401),但今天大家说的 RAG,已经泛指「先检索再生成」这一类做法,跟论文里的具体模型关系不大了。

## 两条流水线

RAG 系统由两条独立的流水线组成,这点一定要分清楚,面试画架构图时常考。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="RAG 的离线建索引流水线和在线问答流水线">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">离线:建索引(文档变了才跑)</text>
<rect x="20" y="42" width="100" height="40" rx="4" fill="none" stroke="var(--compute)"/>
<text x="70" y="66" fill="var(--ink)" text-anchor="middle">帮助中心 .md</text>
<rect x="150" y="42" width="90" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="195" y="66" fill="var(--ink)" text-anchor="middle">切块</text>
<rect x="270" y="42" width="110" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="325" y="66" fill="var(--ink)" text-anchor="middle">embed 每一块</text>
<rect x="410" y="42" width="200" height="40" rx="4" fill="none" stroke="var(--compute)"/>
<text x="510" y="60" fill="var(--ink)" text-anchor="middle">chunks.json</text>
<text x="510" y="75" fill="var(--ink)" text-anchor="middle">vectors.npy</text>
<line x1="120" y1="62" x2="150" y2="62" stroke="var(--ink-faint)" marker-end="url(#a16)"/>
<line x1="240" y1="62" x2="270" y2="62" stroke="var(--ink-faint)" marker-end="url(#a16)"/>
<line x1="380" y1="62" x2="410" y2="62" stroke="var(--ink-faint)" marker-end="url(#a16)"/>
<line x1="20" y1="112" x2="620" y2="112" stroke="var(--rule)" stroke-dasharray="4 4"/>
<text x="20" y="140" fill="var(--ink-soft)">在线:回答问题(每次提问都跑)</text>
<rect x="20" y="156" width="100" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="70" y="180" fill="var(--ink)" text-anchor="middle">用户问题</text>
<rect x="150" y="156" width="90" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="195" y="180" fill="var(--ink)" text-anchor="middle">embed 问题</text>
<rect x="270" y="156" width="110" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="325" y="174" fill="var(--ink)" text-anchor="middle">点积 → top-k</text>
<text x="325" y="189" fill="var(--ink-faint)" text-anchor="middle" font-size="11">读 vectors.npy</text>
<rect x="410" y="156" width="200" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="510" y="180" fill="var(--ink)" text-anchor="middle">拼 prompt:资料 + 问题</text>
<rect x="410" y="236" width="200" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="510" y="260" fill="var(--ink)" text-anchor="middle">大模型生成 + 引用</text>
<rect x="150" y="236" width="230" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="265" y="260" fill="var(--ink)" text-anchor="middle">回答 … [kb-002#1]</text>
<line x1="120" y1="176" x2="150" y2="176" stroke="var(--ink-faint)" marker-end="url(#a16)"/>
<line x1="240" y1="176" x2="270" y2="176" stroke="var(--ink-faint)" marker-end="url(#a16)"/>
<line x1="380" y1="176" x2="410" y2="176" stroke="var(--ink-faint)" marker-end="url(#a16)"/>
<line x1="510" y1="196" x2="510" y2="236" stroke="var(--ink-faint)" marker-end="url(#a16)"/>
<line x1="410" y1="256" x2="380" y2="256" stroke="var(--ink-faint)" marker-end="url(#a16)"/>
<line x1="510" y1="82" x2="510" y2="100" stroke="var(--compute)" stroke-dasharray="3 3"/>
<line x1="325" y1="100" x2="510" y2="100" stroke="var(--compute)" stroke-dasharray="3 3"/>
<line x1="325" y1="100" x2="325" y2="156" stroke="var(--compute)" stroke-dasharray="3 3" marker-end="url(#a16)"/>
<text x="20" y="310" fill="var(--ink-faint)" font-size="11">蓝色 = 调模型(花钱);琥珀色 = 你自己的数据和存储</text>
</g>
<defs><marker id="a16" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</svg>
<figcaption>上半部分只在文档变化时跑一次,下半部分每个问题都跑。两条流水线必须用同一个 embedding 模型。</figcaption>
</figure>

离线流水线:读文档 → 切块 → 每块算 embedding → 存起来。这一步可以慢,可以批量,文档改了才重跑。

在线流水线:用户问题 → 算问题的 embedding → 和所有块的向量算相似度 → 取最高的 k 个 → 把这 k 块和问题拼成 prompt → 大模型回答。这一步每个请求都跑,要快。

这么分的意义在于,两边的优化方向完全不同。离线那边关心的是切得好不好、元数据全不全、更新时能不能只重建改动的部分;在线那边关心的是延迟、召回准不准、prompt 怎么写模型才不乱编。

## 先造一份数据:CloudLedger 帮助中心

从 W4 开始,整门课的例子都用一个虚构的公司:云簿 CloudLedger,一家做在线记账和订阅软件的 SaaS 公司。今天先造它的帮助中心。我故意把规则写得很具体,有价格、有天数、有错误码,因为模糊的数据测不出 RAG 的问题。

```python
# w3/make_helpcenter.py
"""造 CloudLedger 帮助中心的 20 篇文章,写到 data/helpcenter/*.md。

后面 W3–W8 都复用这份数据。内容全部虚构。
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "helpcenter"

ARTICLES = [
    ("kb-001", "套餐与价格", "套餐与计费", """
## 三种套餐
CloudLedger 提供免费版、专业版和企业版三种套餐。
免费版:1 个账本,每月最多记录 200 条流水,1 名成员。
专业版:每月 49 元,或按年付 468 元(相当于每月 39 元)。最多 5 个账本,流水不限条数,最多 3 名成员,支持多币种。
企业版:每月 199 元,或按年付 1908 元。账本和成员都不限,包含开放 API、专属客服和增值税专用发票。

## 怎么选
个人记账用免费版就够了。小团队或者需要多个账本的,选专业版。需要对接自己系统、或者成员超过 3 人的,选企业版。
"""),
    ("kb-002", "退款政策", "退款", """
## 年付套餐
年付套餐(专业版和企业版)中途取消的,按剩余的整月数比例退款。已经使用的月份和当前所在的月份不退。
例如年付专业版 468 元,折合每月 39 元。在第 3 个月中途取消,前 2 个月加当月共 3 个月不退,退剩余 9 个月,即 351 元。

## 月付套餐
月付套餐不支持中途退款。取消订阅后,当期结束时停止服务,不再续费,当期费用不退。

## 重复扣款
同一笔订阅被重复扣款的,核实后全额退还重复的那一笔,3 个工作日内原路退回。

## 审批与到账
所有退款都需要客服主管审批后执行。审批通过后原路退回,支付宝 1 到 3 个工作日到账,银行卡 3 到 7 个工作日到账。
"""),
    ("kb-003", "如何申请退款", "退款", """
## 操作步骤
进入「设置 → 订阅 → 申请退款」,选择退款原因并提交。客服主管会在 1 个工作日内审批。
审批通过后进入退款流程,退款金额和到账时间见《退款政策》。

## 已经开了发票怎么办
如果这笔订单已经开具发票,需要先申请发票红冲(作废),红冲完成后才能退款。电子普通发票红冲一般当天完成,增值税专用发票需要你方配合退回或开具红字信息表。
"""),
    ("kb-004", "自动续费与扣款规则", "套餐与计费", """
## 什么时候扣款
开启自动续费的订阅,会在到期前 3 天自动扣款。

## 扣款失败
扣款失败后,系统每 24 小时重试一次,最多重试 3 次。到期后有 7 天宽限期,宽限期内所有功能正常。
宽限期结束仍未付款的,账户降为免费版。超出免费版额度的数据会保留 90 天,补缴后恢复。
"""),
    ("kb-005", "升级与降级", "套餐与计费", """
## 升级
升级立即生效。差价按当前周期剩余天数折算,只需补差价。

## 降级
降级在当前计费周期结束后生效,不退差价。降级后,超出新套餐额度的账本会变成只读,数据不会删除。
例如从专业版降到免费版,5 个账本里只有 1 个可以继续编辑,其余 4 个只读。
"""),
    ("kb-006", "发票类型与开具", "发票", """
## 可以开哪种发票
所有付费订单都可以开电子普通发票。增值税专用发票仅限企业版,或年付的专业版。

## 怎么申请
付款后 90 天内,在「账单 → 发票」里提交申请,填写抬头和税号。发票会在 1 到 2 个工作日内开出,发送到你填写的邮箱。
超过 90 天未申请的订单,不再支持开票。
"""),
    ("kb-007", "修改发票抬头", "发票", """
## 开错了怎么办
发票开具后 30 天内,可以在「账单 → 发票」里申请红冲并重新开具,每张发票只能重开一次。
超过 30 天的,需要联系客服,并提供加盖公章的情况说明。
"""),
    ("kb-008", "优惠码使用规则", "套餐与计费", """
## 使用方法
在结算页面输入优惠码即可。每笔订单只能使用一个优惠码,不能叠加。
优惠码不适用于企业版。

## 退款时怎么算
使用优惠码的订单退款时,按实际支付的金额退款,优惠部分不退现金。
"""),
    ("kb-009", "导入银行流水", "数据导入导出", """
## 支持的格式
支持 CSV 和 XLSX 文件。单个文件不超过 10 MB,不超过 5 万行。
工商银行、招商银行、建设银行网银导出的流水文件可以自动识别格式,其他银行请使用模板。

## 模板字段
模板包含四列:日期、金额、对方户名、摘要。日期格式必须是 YYYY-MM-DD,金额支出为负数。
"""),
    ("kb-010", "错误码 E1042:银行流水导入失败", "错误码", """
## 原因
E1042 表示文件的列名和模板不匹配,或者日期列的格式不是 YYYY-MM-DD。最常见的情况是 Excel 自动把日期转成了 2026/10/1 这种格式。

## 解决办法
下载最新的导入模板,把日期列的单元格格式设置为「文本」,重新填写日期后再导入。
"""),
    ("kb-011", "错误码 E1043:文件编码错误", "错误码", """
## 原因
E1043 表示文件不是 UTF-8 编码。用 Excel 直接另存为 CSV 时,默认编码通常是 GBK,就会出现这个错误。

## 解决办法
在 Excel 里选择「另存为 → CSV UTF-8(逗号分隔)」,或者直接上传 XLSX 文件。
"""),
    ("kb-012", "错误码 E2017:发票识别失败", "错误码", """
## 原因
E2017 表示发票图片无法识别。常见原因有三个:图片模糊,图片短边分辨率低于 1000 像素,或者上传的 PDF 文件设置了密码。

## 解决办法
重新拍摄清晰的照片,或上传发票原始 PDF。加密的 PDF 需要先去掉密码。识别失败的发票也可以手动录入。
"""),
    ("kb-013", "错误码 E3001:支付失败", "错误码", """
## 原因
E3001 表示支付渠道拒绝了这笔付款,常见原因是银行卡余额不足、超过单笔限额,或者银行风控拦截。

## 解决办法
更换银行卡或改用支付宝支付。同一账户连续 5 次支付失败,会锁定支付功能 1 小时。
"""),
    ("kb-014", "导出数据和报表", "数据导入导出", """
## 导出格式
支持导出 CSV、Excel 和 PDF 报表。

## 次数限制
免费版每天可以导出 1 次,专业版和企业版每天 20 次。
超过 10 万行的导出会在后台异步生成,完成后发送下载链接到你的邮箱,链接 7 天内有效。
"""),
    ("kb-015", "团队成员与权限", "团队与权限", """
## 角色
团队有三种角色:管理员可以管理账单和成员;记账员可以新增和修改流水;只读成员只能查看和导出。

## 人数上限
免费版只有 1 名成员,专业版最多 3 名,企业版不限。

## 邀请成员
在「设置 → 团队」生成邀请链接,链接 7 天内有效,过期需要重新生成。
"""),
    ("kb-016", "账号安全与两步验证", "账号与安全", """
## 两步验证
支持短信验证码和验证器 App 两种方式,建议开启。

## 更换手机号
在「设置 → 账号」里更换手机号,需要旧手机号接收验证码。旧手机号已经不用了的,可以提交人工审核,上传身份证明,2 个工作日内处理。
"""),
    ("kb-017", "注销账号", "账号与安全", """
## 注销流程
在「设置 → 账号 → 注销账号」提交申请。提交后有 30 天冷静期,期间可以随时撤销。
有未结束的付费订阅时,需要先取消订阅才能注销。

## 数据处理
冷静期结束后账号正式注销,所有数据在 30 天后永久删除,无法恢复。
"""),
    ("kb-018", "数据安全与备份", "账号与安全", """
## 数据存在哪
所有数据存储在中国大陆杭州的数据中心,传输全程 TLS 加密。

## 备份
每天自动备份,备份保留 30 天。
企业版客户误删数据后,可以申请从备份恢复,每次收费 500 元。其他套餐不提供备份恢复服务。
"""),
    ("kb-019", "开放 API", "开发者", """
## 谁能用
开放 API 仅对企业版开放。在「设置 → 开发者」创建 API Key。

## 速率限制
每个 API Key 每分钟最多 60 次请求。超过限制会返回 HTTP 429,错误码 E4029,请等待一分钟后重试。
"""),
    ("kb-020", "多币种记账", "套餐与计费", """
## 支持范围
专业版和企业版支持多币种记账,共支持 30 种货币。

## 汇率
汇率每天早上 8 点更新,数据来源是中国银行外汇牌价。你也可以在单笔流水上手动修改汇率。
"""),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for doc_id, title, category, body in ARTICLES:
        text = f"---\nid: {doc_id}\ntitle: {title}\ncategory: {category}\n---\n\n# {title}\n{body}"
        (OUT / f"{doc_id}.md").write_text(text, encoding="utf-8")
    print(f"写入 {len(ARTICLES)} 篇到 {OUT}")


if __name__ == "__main__":
    main()
```

```bash
uv run python w3/make_helpcenter.py
# 写入 20 篇到 .../agent-60-lab/data/helpcenter
```

每篇文章的开头有一小段 frontmatter,记录 `id`、`title`、`category`。这三个字段叫元数据,现在看着不起眼,Day 17 做过滤(「只在退款类文章里找」)、Day 21 做引用展示时都要用。我见过很多 RAG 项目一开始只存正文,后来想按产品线过滤,只好把几十万篇文档重新导一遍。元数据在导入时就带上,成本几乎是零。

注意几个我刻意埋的「考点」:E1042 和 E1043 两个错误码长得很像;退款规则分年付(按剩余整月退,当月不退)、月付(当期不退)、重复扣款(全额退)三种情况,还要客服主管审批;发票有 90 天和 30 天两个不同的期限。这份退款政策和 Day 23 MCP server 里的 `cloudledger://policy/refund` 是同一套规则,后面 W5 的评测也按它判。这些考点都会在 Day 18 和 Day 19 用来考验检索。

## 切块:为什么要切,怎么切

为什么不把一整篇文章当成一个检索单位?有三个原因。

第一,embedding 模型有最大输入长度,超出的部分会被截断。第二,一个向量要概括整篇文章,文章越长,这个向量越「平均」,什么都沾一点,检索时什么都匹配不上。第三,就算检索到了,把整篇长文塞给大模型,里面大部分内容跟问题无关,浪费 token 也干扰回答。

所以要切成块(chunk)。常见的切法有三种:

固定长度切。 每 500 字切一刀,相邻两块重叠 50 字。最简单,适合没有结构的长文本。重叠是为了防止一句话被从中间切断,前一块的结尾和后一块的开头都保留了完整的上下文。缺点是不管语义,可能把「年付」和「按剩余整月退款」切到两块里。

按结构切。 按 Markdown 的标题、HTML 的段落、代码的函数来切。帮助中心这种结构清晰的文档,按 `##` 二级标题切最自然,每一块恰好是一个完整的小主题。

语义切分。 用 embedding 计算相邻句子的相似度,在话题跳变的地方切。听起来高级,实际效果不一定比按结构切好,而且慢。[Greg Kamradt 的视频](https://www.youtube.com/watch?v=8OJC21T2SL4)把五个级别的切法都演示了一遍,值得看看,但我的经验是:有结构就按结构切,没结构用固定长度加重叠,先跑起来再说。

我们用第二种,再加一个保险:如果某一节特别长(超过 `max_chars`),再按固定长度切开。还有一个小技巧很值得学:**每一块的开头都加上文章标题和小节标题**。比如「错误码 E1042:银行流水导入失败 > 原因」。这样即使这一块正文里没出现「E1042」,它的向量里也带着这个信息。Day 18 你会看到,Anthropic 提出的 Contextual Retrieval 就是把这个思路做到了极致。

```python
# agent-60-lab/w3/chunking.py
"""把帮助中心文章切成块。按 ## 小节切,太长的小节再按长度切并重叠。"""
import re
from dataclasses import asdict, dataclass
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "helpcenter"


@dataclass
class Chunk:
    id: str          # 形如 kb-002#1,引用时用
    doc_id: str      # kb-002
    title: str       # 文章标题
    category: str    # 元数据,Day 17 用来过滤
    section: str     # 小节标题
    text: str        # 送去 embedding 和送给大模型的正文(已带标题前缀)


def parse_article(path: Path) -> tuple[dict, str]:
    raw = path.read_text(encoding="utf-8")
    _, fm, body = raw.split("---", 2)
    meta = dict(line.split(": ", 1) for line in fm.strip().splitlines())
    return meta, body.strip()


def split_long(text: str, max_chars: int, overlap: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    pieces, start = [], 0
    while start < len(text):
        pieces.append(text[start:start + max_chars])
        if start + max_chars >= len(text):
            break
        start += max_chars - overlap
    return pieces


def chunk_article(path: Path, max_chars: int = 300, overlap: int = 50) -> list[Chunk]:
    meta, body = parse_article(path)
    # 按 "## " 切成小节;第一段是 "# 标题",丢掉
    parts = re.split(r"^## ", body, flags=re.M)
    chunks: list[Chunk] = []
    n = 0
    for part in parts[1:]:
        section, _, content = part.partition("\n")
        for piece in split_long(content.strip(), max_chars, overlap):
            n += 1
            chunks.append(Chunk(
                id=f"{meta['id']}#{n}",
                doc_id=meta["id"],
                title=meta["title"],
                category=meta["category"],
                section=section.strip(),
                text=f"{meta['title']} > {section.strip()}\n{piece}",
            ))
    return chunks


def load_chunks(max_chars: int = 300, overlap: int = 50) -> list[Chunk]:
    out: list[Chunk] = []
    for path in sorted(DATA.glob("kb-*.md")):
        out.extend(chunk_article(path, max_chars, overlap))
    return out


if __name__ == "__main__":
    chunks = load_chunks()
    print(f"{len(chunks)} 块")
    for c in chunks[:3]:
        print(asdict(c))
```

```bash
uv run python w3/chunking.py
```

**`parse_article()` 在干什么?** 把一篇文章拆成「元数据」和「正文」。文件开头两条 `---` 之间那几行是 frontmatter(`id: kb-002`、`title: 退款政策`…),返回值形如 `({"id": "kb-002", "title": "退款政策", "category": "退款"}, "# 退款政策\n## 年付套餐\n…")`。

- `raw.split("---", 2)`:第二个参数是「最多切 2 刀」,所以一定得到 3 段:第一个 `---` 前的空字符串(用 `_` 接住表示不要)、frontmatter、后面的全部正文。限制刀数是为了正文里再出现 `---`(Markdown 分隔线)时不被切碎。注意 TS 的 `split(sep, n)` 意思不同,是「最多返回 n 段、多余的丢掉」。
- `dict(line.split(": ", 1) for line in fm.strip().splitlines())`:按行切,每行按**第一个** `": "` 切成 `[键, 值]`,再用 `dict()` 拼成字典,相当于 TS 的 `Object.fromEntries(...)`。只切 1 刀,所以标题里本身带冒号也没事。
- 局限:这是给我们自己生成、格式固定的文件写的简化版。frontmatter 里只要有一行不含 `": "`(空行、YAML 列表),就会报 `ValueError: dictionary update sequence element #0 has length 1`。真实项目用 `python-frontmatter` 这类库解析完整的 YAML。

**`split_long()` 在干什么?** 小节超过 `max_chars` 时按固定长度切,相邻两块留 `overlap` 个字重叠。拿 20 个字、每块 8 字、重叠 3 字实跑:

```text
'一二三四五六七八'
'六七八九十ABC'
'ABCDEFGH'
'FGHIJ'
```

- `pieces, start = [], 0`:同时给两个变量赋值,相当于 `let pieces: string[] = [], start = 0`。
- `text[start:start + max_chars]`:切片,相当于 `text.slice(a, b)`,超出末尾不报错,有多少取多少。
- `if start + max_chars >= len(text): break`:这一块已经到末尾就停,否则会多出几块只有重叠部分的短尾巴。
- `start += max_chars - overlap`:下一刀不从这一块末尾开始,而是往回退 `overlap` 个字,所以上例起点依次是 0、5、10、15。重叠是为了让被一刀切断的关键句,至少在一块里是完整的。
- 隐藏的坑:`overlap` 必须小于 `max_chars`。两者相等时 `start += 0` 起点不动,`while` 变成死循环,程序卡住还不报错。真实项目在函数开头加一行 `assert 0 <= overlap < max_chars`。

输出应该是「42 块」(如果你改过文章,数字会不同),外加前三块的内容。打开看一眼第一块,`text` 字段应该以「套餐与价格 > 三种套餐」开头。

切块大小怎么定?没有标准答案,但有几个经验:

- 太小(比如 100 字):每块信息太少,「年付按剩余整月比例退款」和「当月不退」可能被切开,模型拿到一半信息就开始回答。
- 太大(比如 2000 字):向量被稀释,检索不准;塞给模型的无关内容也多。
- 中文客服文档,300 到 800 字一块是常见起点。我们的文章很短,大部分小节本来就不到 300 字,所以基本是一个小节一块。

最终答案要靠 Day 19 的评估集来定:换三种切块大小,看哪种 recall 最高。现在先记住这是一个需要测的参数,不是拍脑袋的常数。

## 建索引:向量存成 numpy 文件

```python
# agent-60-lab/w3/build_index.py
"""离线流水线:切块 → embedding → 存到 index/。文档变了就重跑。"""
import json
from dataclasses import asdict
from pathlib import Path

import numpy as np

import embed as emb
from chunking import load_chunks

INDEX = Path(__file__).resolve().parent.parent / "index"


def main() -> None:
    chunks = load_chunks()
    vectors = emb.embed([c.text for c in chunks])
    INDEX.mkdir(exist_ok=True)
    np.save(INDEX / "vectors.npy", vectors)
    (INDEX / "chunks.json").write_text(
        json.dumps([asdict(c) for c in chunks], ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"{len(chunks)} 块,向量形状 {vectors.shape},消耗约 {emb.total_tokens} token")


if __name__ == "__main__":
    main()
```

```bash
uv run python w3/build_index.py
# 42 块,向量形状 (42, 1024),消耗约 …… token
```

这就是我们的「向量数据库」:一个 `(块数, 1024)` 的 numpy 数组,加一个顺序对应的 JSON。第 i 行向量对应 JSON 里第 i 个块。简陋,但对几千块以内的数据,它比任何向量数据库都快,因为整个矩阵就在内存里,一次矩阵乘法搞定。

这里我插一句:`import embed as emb` 然后用 `emb.total_tokens`,而不是 `from embed import total_tokens`。后者会在导入那一刻把值(0)复制过来,之后 `embed()` 里的 `global total_tokens += ...` 改的是模块里的变量,你这边看到的永远是 0。这是 Python 新手很常踩的坑,跟 Java 的引用语义不一样。

## 检索和回答

先写检索。和昨天的相似度矩阵一模一样,只不过一边是 1 个问题向量,一边是全部块:

```python
# agent-60-lab/w3/rag_numpy.py
"""在线流水线:问题 → 检索 top-k → 拼 prompt → 大模型回答。"""
import json
from pathlib import Path

import numpy as np

from embed import embed_one
from llm import chat

INDEX = Path(__file__).resolve().parent.parent / "index"
CHUNKS: list[dict] = json.loads((INDEX / "chunks.json").read_text(encoding="utf-8"))
VECTORS: np.ndarray = np.load(INDEX / "vectors.npy")


def search(question: str, k: int = 4) -> list[tuple[dict, float]]:
    q = embed_one(question)
    scores = VECTORS @ q                 # (块数,) 每块和问题的余弦相似度
    top = np.argsort(-scores)[:k]        # 分数从高到低取前 k 个下标
    return [(CHUNKS[i], float(scores[i])) for i in top]


SYSTEM = """你是云簿 CloudLedger 的客服助手。
只根据 <资料> 里的内容回答用户问题,不要用你自己的常识补充 CloudLedger 的规则。
每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。一句话用到多块资料就都标上。
出处只能原样照抄 <doc> 标签里的 id,不要在后面再加编号。
如果资料里没有足够的信息回答,就直接说「帮助中心里没有找到这个问题的说明,建议转人工客服」,不要猜。
回答用简洁的中文,先给结论,再给条件和步骤。"""


def build_prompt(question: str, hits: list[tuple[dict, float]]) -> list[dict]:
    docs = "\n\n".join(
        f'<doc id="{c["id"]}" title="{c["title"]}">\n{c["text"]}\n</doc>' for c, _ in hits
    )
    user = f"<资料>\n{docs}\n</资料>\n\n用户问题:{question}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def answer(question: str, k: int = 4, show_hits: bool = True) -> str:
    hits = search(question, k)
    if show_hits:
        for c, s in hits:
            print(f"  {s:.3f}  {c['id']:<9} {c['title']} > {c['section']}")
    return chat(build_prompt(question, hits), temperature=0)
```

`llm.py` 是一个很小的封装,用的还是 W1 那组 `LLM_*` 环境变量。如果你 Day 4 写的 `LLMClient` 已经顺手,直接换成它就行,这里单独写一个只是为了让 W3 的目录能独立运行:

```python
# agent-60-lab/w3/llm.py
import json
import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
_client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
EXTRA_BODY = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))  # 和 Day 13 一样:比如关掉 DeepSeek 的思考模式


def chat(messages: list[Any], **kwargs: Any) -> str:
    resp = _client.chat.completions.create(model=MODEL, messages=messages, extra_body=EXTRA_BODY, **kwargs)
    return resp.choices[0].message.content or ""
```

两处和最朴素的写法不一样,都是实跑踩出来的。一是 `messages: list[Any]`:如果写成 `list[dict]`,Zed 里会出两条类型红线(`No overloads for "create"`),因为 SDK 要的是它自己定义的消息类型,普通 `dict` 对不上,和 Day 8、Day 13 是同一个原因。二是 `extra_body=EXTRA_BODY`:读 `.env` 里的 `LLM_EXTRA_BODY`,用来关掉 DeepSeek 的思考模式,没配就是空字典,不影响别的厂商。

最后一个命令行入口:

```python
# agent-60-lab/w3/ask.py
import sys

from rag_numpy import answer

if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "年付套餐买错了能退款吗"
    print(f"问:{q}\n检索到:")
    print("\n答:" + answer(q))
```

```bash
uv run python w3/ask.py 年付套餐买错了能退款吗
```

今天所有脚本都**按文件路径运行**(`uv run python w3/xxx.py`),不要用 `-m w3.xxx`,原因和 Day 15 的 `sim_matrix.py` 一样:脚本之间是 `from embed import ...`、`from chunking import ...` 这种平级导入,只有按路径运行时 Python 才会把 `w3/` 加进搜索路径。

输出大致长这样(分数和措辞会因模型而异):

```text
问:年付套餐买错了能退款吗
检索到:
  0.7xx  kb-002#1  退款政策 > 年付套餐
  0.6xx  kb-003#1  如何申请退款 > 操作步骤
  0.6xx  kb-002#2  退款政策 > 月付套餐
  0.6xx  kb-002#4  退款政策 > 审批与到账

答:可以退,但不是全额。年付套餐中途取消,按剩余的整月数比例退款,已经用过的月份和当前这个月不退 [kb-002#1]。
比如年付专业版 468 元,在第 3 个月取消,退剩余 9 个月共 351 元 [kb-002#1]。
申请路径是「设置 → 订阅 → 申请退款」,客服主管会在 1 个工作日内审批 [kb-003#1],通过后原路退回 [kb-002#4]。
```

## prompt 里的几个讲究

上面那段 `SYSTEM` 看着平平无奇,每一句其实都是踩坑踩出来的。

「只根据资料回答,不要用你自己的常识补充」。不加这句,模型看到「退款」两个字,会顺手加上一句「一般 SaaS 产品支持 7 天无理由退款」,这在 CloudLedger 是错的。模型的常识在这里是噪音。

「标注出处」。引用有两个用处。对用户,他能点进原文核对;对你,引用是排查问题的线索。用户投诉回答错了,你一看引用,就知道是检索拿错了资料(检索问题),还是资料对了但模型理解错了(生成问题)。这个区分是 Day 19 评估的基础。

「出处只能原样照抄 id」。这句是我实跑后补的。没有它的时候,我问「退款几天能到账」三次,有两次模型写出了 `[kb-002#4#1]` 这种编号:它想精确到块里的第几句,就自己在 id 后面又加了一层。这个 id 在 `chunks.json` 里根本不存在,Day 21 做引用展示时就对不上任何一块资料。加上这句以后三次都是合法的 id。另外注意,即使 `temperature=0`,同一个问题三次的输出也不完全一样,所以验证提示词改动要多跑几次。

「没有就说不知道」。这句最重要,也最难做到。试试问一个帮助中心里没有的问题:

```bash
uv run python w3/ask.py 你们支持微信支付吗
```

帮助中心只提到了支付宝和银行卡。检索依然会返回 4 块(top-k 总会返回 k 个,哪怕都不相关),比如 E3001 支付失败那篇。好的回答应该是「帮助中心里没有找到」,或者「帮助中心只提到了支付宝和银行卡」。如果模型回答「支持微信支付」,那就是幻觉。这种「资料里没有」的问题一定要放进 Day 19 的测试集里。

用 XML 标签 `<doc>` 包住每块资料,是 Day 5 讲过的结构化技巧:模型能清楚分辨哪部分是资料、哪部分是问题,也更容易准确地抄出 id。`temperature=0` 是为了让同一个问题的回答尽量稳定,方便对比和评估。

还有一个顺序问题:资料放在问题前面。Anthropic 的提示词文档建议长文档放在 prompt 前部、问题放在最后,我在中文模型上也观察到类似的倾向。这不是铁律,Day 19 有了评估集你可以自己测一下两种顺序。

## 什么时候不用 RAG

讲完怎么做,也得说说什么时候别做。面试官很喜欢问这个,因为它能看出你是在用技术解决问题,还是为了用技术而用技术。

- 知识库很小(几万字以内)、更新不频繁:直接全塞进 system prompt,配合 prompt caching,简单可靠。
- 问题需要「全局视角」:比如「总结一下我们所有的退款相关规则」,RAG 只拿 top-4,天然会漏。这类问题要么全量给,要么换思路(先列目录再逐篇读)。
- 答案在结构化数据里:比如「客户 C-1024 这个月的账单是多少」,这根本不是检索文档,而是查数据库,应该做成工具(W4 的 MCP)。

客服 Agent 两者都需要:政策类问题走 RAG,订单账单类问题走工具。这正是毕业项目 SupportPilot 的结构。

## 动手练习

我 2026-10-17 用硅基流动 bge-m3 + deepseek-flash 跑过下面的练习,结果写在每题后面供你对照,你的数字会略有不同。

1. 跑通 `make_helpcenter.py` → `chunking.py` → `build_index.py` → `ask.py`,问下面五个问题,把检索结果和回答记下来。

| 问题 | top-1 是哪块 | 回答对吗 | 引用对吗 |
| --- | --- | --- | --- |
| 年付套餐买错了能退款吗 |  |  |  |
| 导入流水提示 E1042 怎么办 |  |  |  |
| 发票开错了还能改吗 |  |  |  |
| 专业版最多几个人 |  |  |  |
| 你们支持微信支付吗 |  |  |  |

我的结果:前四题 top-1 分别是 kb-002#1、kb-010#2、kb-007#1、kb-015#2,全对,回答和引用也都对;第五题回答「帮助中心里没有找到这个问题的说明」,没有编造。

2. 把 `max_chars` 改成 80,`overlap` 改成 20,重建索引,再问「年付用了两个月取消能退多少」。观察回答有没有变差,看看是不是关键信息被切散了。(改的是 `load_chunks()` 的默认参数,`build_index.py` 调它时没传参数。)我的结果:块数只从 42 变成 49,因为大部分小节本来就不到 80 字;「年付套餐」那一节被切成两块,两块都被检索到了,所以答案还是对的,但模型变得更犹豫,多了一句「其他情形建议转人工客服确认」。想看到明显变差,可以再改小到 40。

3. 去掉 `text` 里的标题前缀(只用 `piece`),重建索引,再问「E1043 怎么解决」,看 top-4 里还有没有「错误码 E1043 > 解决办法」那一块。我的结果:有前缀时它排第 2(0.609);去掉前缀后它掉出了 top-4,模型只拿到「原因」那块,答不出解决步骤。原因是「解决办法」那块的正文是「在 Excel 里选择另存为 CSV UTF-8…」,里面根本没有「E1043」,全靠前缀里的标题把它和错误码连起来。如果问的是「E1043 是什么错误」就看不出差别,因为「原因」那块正文里本身就写着 E1043。

4. 把 SYSTEM 里「不知道就说不知道」那句删掉,问「你们支持微信支付吗」,看模型会不会开始编。我的结果:deepseek-flash 三次都没编,还是说「资料中没有相关信息」;连「只根据资料回答」那句一起删掉,三次也都没编。新一代模型在这类问题上已经比较克制了。这不说明那两句可以删:换一个小模型、或者问题里有一半信息能在资料里找到时,模型更容易顺着编下去。练习的意义是让你知道,提示词里每一句防线都要用测试验证它有没有用,而不是凭感觉加或删。

**验收标准:** 前四个问题 top-1 都是对的文章;回答带引用而且引用的块确实包含答案;第五个问题模型没有说「支持微信支付」。练习 2–4 至少完成两个,并用一两句话写下你观察到的变化。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| RAG | 检索增强生成:先检索相关资料,再让大模型根据资料回答 |
| chunk(块) | 文档切分后的检索单位,一块对应一个向量 |
| overlap(重叠) | 相邻两块共享的字符数,防止一句话被切断 |
| top-k | 按相似度取最高的 k 个结果 |
| 元数据(metadata) | 正文之外的结构化信息,如文章 id、标题、分类、更新时间 |
| 离线流水线 | 切块、向量化、存储,文档变化时才跑 |
| 在线流水线 | 问题向量化、检索、拼 prompt、生成,每个请求都跑 |
| 引用(citation) | 回答中标注的资料出处,如 [kb-002#1] |
| grounding | 让回答「落地」在给定资料上,而不是模型自己的记忆 |
| 幻觉(hallucination) | 模型生成了资料里没有、而且不正确的内容 |

## 常见误区

**以为检索结果都是相关的。** top-k 一定会返回 k 个结果,哪怕知识库里根本没有相关内容。所以 prompt 里必须告诉模型「资料可能不相关,没有就说不知道」。

**切块不带上下文。** 一块正文写着「已经使用的月份和当前所在的月份不退」,但没说是年付还是月付。这样的块被检索到,模型也没法正确回答。块的开头带上文章标题和小节标题,成本极低,收益很大。

**只存正文不存元数据。** 等到要按分类过滤、要显示文章链接、要按更新时间判断新旧的时候,才发现没存,只能重建索引。

**觉得 RAG 能解决所有知识问题。** 需要汇总全局的问题、需要查结构化数据的问题,都不适合 RAG。

**k 越大越好。** k 大了召回率上去了,但塞进 prompt 的噪音也多了,成本和延迟也涨。客服场景 k=3 到 8 是常见范围,同样要靠评估集来定。

**改了切块参数忘了重建索引。** 切块变了,块的数量和内容都变了,旧的 `vectors.npy` 和新的 `chunks.json` 对不上,检索结果会错位,而且不会报错。我把重建索引做成一个独立脚本,就是为了每次改完无脑重跑。

## 学习资料

### 文档与文章

- [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401):RAG 这个名字的出处。读摘要和引言就够了,了解来龙去脉,面试被问「RAG 是谁提出的」能答上来。
- [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172):为什么「全塞进去」不总是好主意。看图 1 和结论,15 分钟。
- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):今天「块前面加标题」的进阶版,先读前半部分理解问题,Day 18 再细读方法。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JLN2z4EZQ&autoplay=0&high_quality=1" title="RAG 工作机制详解——一个高质量知识库背后的技术全流程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · RAG 工作机制详解——一个高质量知识库背后的技术全流程 · 17 分钟,全看。B 站讲 RAG 播放量最高的视频之一,和今天的两条流水线一一对应。</figcaption>
</figure>

- 名校课程-顶级中配《【中文配音】吴恩达RAG检索增强生成|从检索到生产落地完整课》(BV1zeMD6hEab,48 集):DeepLearning.AI 的 RAG 课程中配版。今天看第 11–15 集(RAG 导论、架构总览、应用场景、RAG vs 微调),其余的留到 Day 21 复习时对照着看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/T-D1OfcDW1M" title="What is Retrieval-Augmented Generation (RAG)?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · What is Retrieval-Augmented Generation (RAG)? · 6 分钟,白板讲解 RAG 解决的两个问题(过时和没来源),两百多万播放。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/8OJC21T2SL4" title="The 5 Levels Of Text Splitting For Retrieval" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Greg Kamradt · The 5 Levels Of Text Splitting For Retrieval · 1 小时,讲切块讲得最全的视频。先看前 30 分钟(字符切、递归切、按文档结构切),语义切和 Agent 切了解即可。</figcaption>
</figure>

- freeCodeCamp《Learn RAG From Scratch – Python AI Tutorial from a LangChain Engineer》(YouTube ID `sVcwVQRHIc8`,2.5 小时):LangChain 工程师 Lance Martin 的 RAG 系列合集,用的是 LangChain,适合本周学完后回头看框架怎么封装这些步骤。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「RAG and Agents」的 RAG 部分:讲检索架构、切块、评估,今天的内容在这里都有更系统的版本,约 2 小时。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024)第 8 章「Semantic Search and Retrieval-Augmented Generation」;中文版《图解大模型:生成式AI原理与实践》对应章节。图多,1 小时。

### 开源项目与代码

- [datawhalechina/llm-universe](https://github.com/datawhalechina/llm-universe):中文的大模型应用开发教程,有搭建个人知识库助手的完整章节,可以对照看国内厂商接口的写法。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):Datawhale 的 Agent 中文教程,里面关于记忆与检索的章节和本周相关。
- [microsoft/ai-agents-for-beginners](https://github.com/microsoft/ai-agents-for-beginners):有一课专门讲 Agentic RAG,带中文翻译,Day 20 会用到,今天先收藏。

## 自测

**1. RAG 的「离线」和「在线」两条流水线分别做什么?哪条要优化延迟?**

<details><summary>答案</summary>

离线:读文档、切块、向量化、存储,文档变化时才跑,可以慢、可以批量。在线:问题向量化、检索 top-k、拼 prompt、调大模型生成,每个请求都跑,要优化延迟。两条必须用同一个 embedding 模型。

</details>

**2. 为什么要在每块的开头加上文章标题和小节标题?**

<details><summary>答案</summary>

很多块的正文缺少上下文,比如「已经使用的月份和当前所在的月份不退」没说是哪种付费方式。加上「退款政策 > 年付套餐」这样的前缀后,向量里带上了主题信息,检索更准;模型读到这块时也知道它在说什么,回答更不容易张冠李戴。成本只是每块多几个字。

</details>

**3. 用户问了一个知识库里完全没有的问题,检索会返回什么?系统应该怎么处理?**

<details><summary>答案</summary>

top-k 依然会返回 k 个分数最高的块,只是它们都不相关。处理办法是在 prompt 里明确要求「资料不足时说不知道」,并把这类问题放进评估集专门测;也可以加相关性判断(rerank 分数阈值,或者让模型先判断资料是否相关),Day 18 和 Day 19 会讲。

</details>

**4. 你把 `max_chars` 从 300 改成 100 之后,一些问题回答变差了,可能的原因是什么?**

<details><summary>答案</summary>

块太小,一个完整的规则被切成了几块,比如「年付中途取消按剩余整月比例退款」和「已用月份和当月不退」分到了两块,top-k 可能只取到其中一块,模型只拿到一半信息。另外块数变多,同一篇文章的碎片可能占满 top-k,挤掉别的相关文章。

</details>

**5. 下面哪些问题适合用 RAG,哪些不适合?(a)年付能不能退款;(b)客户 C-1024 上个月付了多少钱;(c)列出帮助中心里所有和发票有关的规则。**

<details><summary>答案</summary>

(a)适合,典型的政策查询。(b)不适合,答案在业务数据库里,应该做成查询工具让 Agent 调用。(c)不太适合纯 top-k 检索,因为要求全面,top-k 会漏;可以按元数据 category=发票 取出全部文章再交给模型,或者直接全量给。

</details>

**6.(面试题)你做的 RAG 客服上线后,用户反馈「回答有时候是错的」。你怎么排查?**

<details><summary>答案</summary>

先把问题分到两段:检索错还是生成错。拿出出错的 case,看检索到的 top-k 里有没有包含正确答案的块。没有,就是检索问题:看是切块切散了、embedding 对这类词不敏感(编号、否定)、还是问题表述和文档差太远,对应的手段是调切块、加混合检索、加 rerank、做 query 改写。有,但模型答错了,就是生成问题:看 prompt 是否要求只依据资料、资料是否互相矛盾、k 是否太大引入噪音。然后把这些 case 加进评估集,改完回归测试。能说出「先分检索还是生成」再「加进评估集回归」,就是有方法论的回答。

</details>

## 明天预告

Day 17 · 向量数据库:pgvector 上手、HNSW 索引与元数据过滤。今天的 numpy 数组在几千块的规模上很好用,但它没法增删改、没法过滤、没法多个服务共享。明天用 Docker 起一个带 pgvector 的 Postgres,把今天的索引搬进去,用 SQL 做向量检索和「只搜退款类文章」这样的过滤,再搞清楚 HNSW 索引为什么快、什么时候会漏掉结果。
