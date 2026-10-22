---
title: 'Day 136 · 多模态与文档解析:看图、OCR、版面分析、多模态 RAG'
description: '客户不会只发文字:报错截图、手机拍的账单、扫描版合同。这一课先弄清楚模型怎么「看」图、一张图要多少 token,再用 DeepSeek 的视觉输入把一张 CloudLedger 扫描账单抽成结构化数据并和业务库对账,实测改过数字的账单能不能被抓出来;然后让截图进 W3 的检索,最后过一遍 MinerU、Docling、PaddleOCR-VL 和 ColPali 这些 2026 年的文档解析工具。'
pubDate: 2026-10-22
regime: none
tags: ['multimodal', 'vision', 'ocr', 'document-parsing', 'rag', 'agent-60']
series: 'agent-60'
day: 136
lang: 'zh'
---

## 今天要解决的问题

**建议在 [Day 21 · W3 复习 + 小项目:带引用出处的文档问答 Agent](/blog/agent-60/day-21-week3-review-doc-qa/) 之后读。** 专题篇可以跳着读。这一篇用到 Day 6 的结构化输出(`common/structured.py` 里的 `extract`)、Day 18 的 PDF 解析(`doc_parse.py`)、Day 21 的检索,以及 [Day 23](/blog/agent-60/day-23-build-mcp-server/) 造好的 `cloudledger.db`。

W3 的知识库全是干净的 Markdown,真实的客服场景没这么客气。我在 Day 18 里写过一个最小的 PDF 解析器,能处理文字型 PDF 和有边框的表格,扫描页交给 OCR。但有几类东西它处理不了:客户发来一张报错截图,一个字都没写;客户拍了一张账单照片问「为什么扣了我这么多」;合同是扫描件,表格没有边框还跨页。这些都要模型能「看」。

学完你应该能做到:

1. 说清楚一张图进模型时变成了什么、要花多少 token,用 `detail` 参数在清晰度和成本之间取舍(今天实测:同一张账单图 high 约 716 个 token,low 约 195 个)。
2. 用 OpenAI 兼容协议给 DeepSeek 发图片,复用 Day 4 的 `LLMClient`,一行都不用改。
3. 写一个账单抽取器:有文字层走文字,没有文字层走视觉模型,抽出来的数字用代码和业务库对账,改过金额的账单要能被抓出来。
4. 把截图读成检索词,接上 W3 的检索,说出为什么「从截图里读出错误码」比让用户描述问题准。
5. 知道 MinerU、Docling、PaddleOCR-VL、ColPali 各自适合什么场景,多模态 RAG 的两种做法分别贵在哪里。

预计用时 4–5 小时。花费:今天所有练习我实测加起来不到 ¥0.05(DeepSeek,2026 年 10 月价格,算式见后文)。

## 模型怎么「看」图

先建立一个直觉。语言模型只会处理 token 序列,图片要进去,得先变成和文字 token 同一种东西。现在主流的做法是:把图片缩放到一定大小,切成一格一格的小方块(patch,常见是 14×14 或 16×16 像素),每个方块经过一个视觉编码器变成一个向量,再经过一层投影,变成和文字 token 同样维度的「视觉 token」,和你的提示词拼在一起送进模型。模型并不知道哪些 token 来自图片、哪些来自文字,对它来说都是一串向量。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="图片进入大模型的过程:缩放、切块、视觉编码器、投影成视觉 token,和文字 token 拼接">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="40" width="90" height="110" rx="4" fill="none" stroke="var(--compute)"/>
<text x="28" y="98" fill="var(--compute)">账单照片</text>
<text x="22" y="170" fill="var(--ink-faint)" font-size="11">901×1261 像素</text>
<rect x="130" y="40" width="110" height="110" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<g stroke="var(--compute)" stroke-width="0.6">
<line x1="152" y1="40" x2="152" y2="150"/><line x1="174" y1="40" x2="174" y2="150"/><line x1="196" y1="40" x2="196" y2="150"/><line x1="218" y1="40" x2="218" y2="150"/>
<line x1="130" y1="62" x2="240" y2="62"/><line x1="130" y1="84" x2="240" y2="84"/><line x1="130" y1="106" x2="240" y2="106"/><line x1="130" y1="128" x2="240" y2="128"/>
</g>
<text x="132" y="170" fill="var(--ink-faint)" font-size="11">缩放后切成小方块</text>
<rect x="266" y="70" width="110" height="50" rx="6" fill="none" stroke="var(--mem)"/>
<text x="278" y="92" fill="var(--mem)">视觉编码器</text>
<text x="278" y="110" fill="var(--ink-faint)" font-size="11">+ 投影层</text>
<rect x="400" y="40" width="224" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="412" y="65" fill="var(--mem)">视觉 token × 几百到一千多</text>
<rect x="400" y="110" width="224" height="40" rx="4" fill="none" stroke="var(--mem)"/>
<text x="412" y="135" fill="var(--ink)">文字 token:「应付合计是多少?」</text>
<line x1="106" y1="95" x2="128" y2="95" stroke="var(--rule)"/>
<line x1="240" y1="95" x2="264" y2="95" stroke="var(--rule)"/>
<line x1="376" y1="95" x2="398" y2="62" stroke="var(--rule)"/>
<text x="400" y="185" fill="var(--ink-soft)">两段拼成一个序列送进同一个模型,</text>
<text x="400" y="203" fill="var(--ink-soft)">按输入 token 一起计费</text>
</g>
</svg>
<figcaption>图片 token 的数量取决于缩放后的像素数,和图片里有多少字无关。一张空白图和一张密密麻麻的表格,缩放到同样大小,花的钱一样。</figcaption>
</figure>

这个机制直接决定了两件事。

**成本按像素算。** 各家的规则不同,但都是「先缩放、再按缩放后的面积数方块」。DeepSeek 的视觉文档(2026 年 10 月查到)写的是:小于约 544×544 的图会被放大,大于约 1300×1300 像素数的图会被缩小,每张图最多 1024 个 token,多图时每张单独计算。阿里云百炼的通义千问视觉文档给的示例里,一张图片加一句短问题,`image_tokens` 是 1247。

**看不清的东西缩放以后更看不清。** 一张 4000×3000 的手机照片被缩到一百多万像素,上面 8 号字的小票金额可能就糊成一团了。这时候与其换更贵的模型,不如先把要看的区域裁出来再发。

我拿今天要用的扫描账单(901×1261 像素)实测了一下,同一个问题,只改 `detail` 参数:

| detail | prompt_tokens | 只发文字时 | 图片约占 | 回答 |
| --- | --- | --- | --- | --- |
| high | 728 | 12 | 716 | 账单编号:INV-2026-0001,应付合计:98.00 元 |
| low | 207 | 12 | 195 | 账单编号:INV-2026-0001,应付合计:98.00 元 |

DeepSeek 文档里 `low` 是把图缩到 512×512,`high`、`original`、`auto` 都保持原图(`auto` 目前等于 `original`)。这张账单字大、版面简单,low 也读对了,便宜了七成多。但这只说明这一张图可以用 low,换成小字号的表格,low 就可能读错。**detail 是要按图片类型测出来的,不是拍脑袋定的。**

## 第一次发图

DeepSeek 的 `deepseek-flash` 现在直接支持图片输入(2026 年 10 月查到:文档说这个名字现在由 DeepSeek-V4.1-Flash-1017 提供服务,原来的实验名 `deepseek-v4-flash-vision-exp` 还能用,但已经指向同一个模型)。也就是说,你从 Day 0 一直在用的那个 key、那个 `.env`,不用改任何配置就能发图。

图片走的是 OpenAI 兼容协议:`content` 从一个字符串变成一个列表,列表里可以混着放文字块和图片块。图片块有三种给法:base64 内嵌、公开的 http(s) 链接、先用 Files API 上传再引用 `file_id`。本地文件最简单的是 base64。

先准备测试数据。这个脚本从 `cloudledger.db` 里读一张真实的账单,画成 PDF,再造一份「扫描件」:渲染成图片、转 1.2 度、加点模糊和噪点,最后存成只有图片、没有文字层的 PDF。

```python
# agent-60-lab/topics/multimodal/make_invoice.py
"""从 cloudledger.db 读一张发票,生成两份测试文件:
  data/invoices/INV-2026-0001.pdf       文字型 PDF(有文字层)
  data/invoices/INV-2026-0001-scan.pdf  扫描件(只有图片,模拟手机拍照)
依赖:uv add reportlab pillow
运行:uv run python -m topics.multimodal.make_invoice INV-2026-0001
"""

import random
import sqlite3
import sys
from pathlib import Path
from typing import Any

import pdfplumber
from PIL import Image, ImageFilter
from reportlab.lib.pagesizes import A5
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

DB = Path("w4/cloudledger/cloudledger.db")
OUT = Path("data/invoices")
SEAT_PRICE = {"基础版": 4900, "专业版": 9900, "企业版": 29900}  # 分/席位/月,和 Day 23 的 seed 一致
TAX_RATE = 0.06  # 价内含税

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))  # reportlab 自带的中文字体,不用装字体文件


def load(invoice_id: str) -> dict[str, Any]:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        """SELECT i.id, i.amount_cents, i.issued_at, i.status,
                  c.company, c.name, s.plan, s.billing_cycle, s.seats
           FROM invoices i
           JOIN customers c ON c.id = i.customer_id
           JOIN subscriptions s ON s.id = i.subscription_id
           WHERE i.id = ?""",
        (invoice_id,),
    ).fetchone()
    if row is None:
        sys.exit(f"找不到发票 {invoice_id}")
    return dict(row)


def draw_pdf(inv: dict[str, Any], path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=A5)
    w, h = A5
    c.setFont("STSong-Light", 16)
    c.drawString(40, h - 50, "云簿 CloudLedger 账单")
    c.setFont("STSong-Light", 10)
    c.drawString(40, h - 75, f"账单编号:{inv['id']}")
    c.drawString(40, h - 92, f"开具日期:{inv['issued_at']}")
    c.drawString(40, h - 109, f"客户:{inv['company']}({inv['name']})")

    unit = SEAT_PRICE[inv["plan"]]
    months = 12 if inv["billing_cycle"] == "yearly" else 1
    amount = unit * inv["seats"] * months
    y = h - 145
    c.drawString(40, y, "项目")
    c.drawString(200, y, "数量")
    c.drawString(250, y, "单价")
    c.drawString(320, y, "金额")
    c.line(40, y - 5, w - 40, y - 5)
    y -= 22
    c.drawString(40, y, f"{inv['plan']}({'年付' if months == 12 else '月付'})席位")
    c.drawString(200, y, str(inv["seats"] * months))
    c.drawString(250, y, f"{unit / 100:.2f}")
    c.drawString(320, y, f"{amount / 100:.2f}")
    tax = round(amount / (1 + TAX_RATE) * TAX_RATE)
    y -= 30
    c.line(40, y + 12, w - 40, y + 12)
    c.drawString(250, y, "其中税额(6%)")
    c.drawString(320, y, f"{tax / 100:.2f}")
    y -= 18
    c.setFont("STSong-Light", 12)
    c.drawString(250, y, "应付合计")
    c.drawString(320, y, f"{inv['amount_cents'] / 100:.2f} 元")  # 内置字体没有 ¥ 字形,用「元」
    c.save()


def fake_scan(pdf_path: Path, out: Path) -> None:
    with pdfplumber.open(pdf_path) as pdf:
        img = pdf.pages[0].to_image(resolution=150).original.convert("L")
    random.seed(7)
    img = img.rotate(1.2, expand=True, fillcolor=255)  # 拍歪了一点
    img = img.filter(ImageFilter.GaussianBlur(0.6))  # 有点糊
    px = img.load()
    assert px is not None  # 类型上可能是 None,实际不会
    for _ in range(4000):  # 撒点噪点
        x, y = random.randrange(img.width), random.randrange(img.height)
        px[x, y] = random.randrange(120, 256)
    img.save(out.with_suffix(".png"))
    Image.open(out.with_suffix(".png")).convert("RGB").save(out)  # 存成只有图片的 PDF


def main() -> None:
    invoice_id = sys.argv[1] if len(sys.argv) > 1 else "INV-2026-0001"
    OUT.mkdir(parents=True, exist_ok=True)
    inv = load(invoice_id)
    text_pdf = OUT / f"{invoice_id}.pdf"
    draw_pdf(inv, text_pdf)
    fake_scan(text_pdf, OUT / f"{invoice_id}-scan.pdf")
    print(f"已生成 {text_pdf} 和 {OUT / f'{invoice_id}-scan.pdf'}(另有同名 .png)")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `依赖:uv add reportlab pillow` pdfplumber 是 Day 18 装过的。我实测装上的是 reportlab 5.0.1、pillow 13.0.0。pillow 其实 pdfplumber 已经带进来了,写出来是为了让依赖关系清楚。
- `运行:uv run python -m topics.multimodal.make_invoice INV-2026-0001` 和 W2 一样在仓库根目录用 `-m` 跑。`topics/` 和 `topics/multimodal/` 下面不需要 `__init__.py`,Python 3 会把它们当成命名空间包。
- `DB = Path("w4/cloudledger/cloudledger.db")` 相对路径,所以必须在根目录跑。你的库要是还没生成,先按 Day 23 跑一遍 `seed.py`。
- `SEAT_PRICE = {"基础版": 4900` 和 `seed.py` 里的 `PLANS` 一模一样(分/席位/月)。账单上的单价从这里算,不从库里读,因为 invoices 表只存了总额 `amount_cents`。
- `TAX_RATE = 0.06` 价内税:98 元里已经含了税,税额 = 98 ÷ 1.06 × 0.06 ≈ 5.55。
- `pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))` reportlab 自带几种 CID 中文字体,不用找字体文件,换台电脑也能跑。缺点是字形不全,比如没有 ¥,所以合计那一行用了「元」。
- `row = conn.execute(` 三表联查。代入 INV-2026-0001,拿到 `{"id": "INV-2026-0001", "amount_cents": 9800, "issued_at": "2026-10-09", "status": "paid", "company": "星河餐饮", "name": "刘伟", "plan": "基础版", "billing_cycle": "monthly", "seats": 2}`。
- `c = canvas.Canvas(str(path), pagesize=A5)` A5 是 420×595 个 point(1 point = 1/72 英寸)。reportlab 的坐标原点在左下角,所以下面都是 `h - 50` 这种写法,从上往下排。
- `amount = unit * inv["seats"] * months` 4900 × 2 × 1 = 9800 分,和库里的 `amount_cents` 一致。这张是月付,年付的话 months 是 12。
- `tax = round(amount / (1 + TAX_RATE) * TAX_RATE)` 9800 ÷ 1.06 × 0.06 = 554.7,四舍五入成 555 分,显示 5.55。
- `img = pdf.pages[0].to_image(resolution=150).original.convert("L")` 按 150 dpi 渲染,A5 宽 420 point,换算成 420 ÷ 72 × 150 ≈ 875 像素宽,转成灰度。
- `img = img.rotate(1.2, expand=True, fillcolor=255)` 转 1.2 度并扩大画布,转完的图是 901×1261,比原来宽了一点,边角用白色填。
- `px[x, y] = random.randrange(120, 256)` 撒 4000 个灰点。`random.seed(7)` 固定了随机数,每次生成的「扫描件」一模一样,方便对比实验结果。
- `Image.open(out.with_suffix(".png")).convert("RGB").save(out)` PIL 能直接把图片存成 PDF,这样得到的 PDF 里只有一张图,没有文字层。用 pdfplumber 抽它的文字,得到的是空字符串。
- `print(f"已生成 {text_pdf}` 实测输出:`已生成 data/invoices/INV-2026-0001.pdf 和 data/invoices/INV-2026-0001-scan.pdf(另有同名 .png)`。文字型 PDF 抽出来的文字是 `云簿 CloudLedger 账单\n账单编号:INV-2026-0001\n开具日期:2026-10-09\n客户:星河餐饮(刘伟)\n项目 数量 单价 金额\n基础版(月付)席位 2 49.00 98.00\n其中税额(6%) 5.55\n应付合计 98.00 元`。

</div>

然后是最小的发图脚本:

```python
# agent-60-lab/topics/multimodal/vision_ask.py
"""给模型看一张图,问一个问题。用的是 Day 4 的 LLMClient,换的只是 content 的写法。
运行:uv run python -m topics.multimodal.vision_ask data/invoices/INV-2026-0001-scan.png "应付合计是多少?"
"""

import base64
import sys
from pathlib import Path
from typing import Any

from common.llm import LLMClient

MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


def image_part(path: Path, detail: str = "high") -> dict[str, Any]:
    b64 = base64.b64encode(path.read_bytes()).decode()
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{MIME[path.suffix.lower()]};base64,{b64}", "detail": detail},
    }


def main() -> None:
    path, question = Path(sys.argv[1]), sys.argv[2]
    llm = LLMClient()
    messages = [
        {
            "role": "user",  # 图片只能放在 user 消息里,放 system 会 400
            "content": [image_part(path), {"type": "text", "text": question}],
        }
    ]
    r = llm.chat(messages, temperature=0, max_tokens=300)
    print(r.content)
    print(f"输入 {r.prompt_tokens} tokens(图片也算在里面)| 输出 {r.completion_tokens} | 约 ¥{r.cost:.4f}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `MIME = {` data URL 要写 MIME 类型。DeepSeek 文档说它按文件内容识别格式(支持 JPEG、PNG、GIF、WebP),写错了也能认;但百炼的文档要求 MIME 和实际格式一致,所以还是写对。
- `b64 = base64.b64encode(path.read_bytes()).decode()` 这张扫描 PNG 是 47664 字节,base64 以后大约变成 4/3 倍,6.4 万个字符。base64 只是传输编码,计费看的是缩放后的像素,和这个长度无关。
- `"image_url": {"url": f"data:{MIME[path.suffix.lower()]};base64,{b64}", "detail": detail},` 代入后 url 是 `data:image/png;base64,iVBORw0KGgo...`。字段名叫 `image_url`,但 base64 也放在 url 里,这是 OpenAI 协议的历史写法。DeepSeek 单张图上限 32 MiB(用 Files API 是 64 MiB),单边最长 8192 像素。
- `"role": "user",  # 图片只能放在 user 消息里` DeepSeek 文档明确写了 system 和 assistant 消息里放图片返回 400。想给模型一张「参考样例图」,也只能放在 user 消息里。
- `"content": [image_part(path), {"type": "text", "text": question}],` 图在前、问题在后。一个 content 列表里可以放多张图,DeepSeek 上限是每个请求 600 张,总大小不超过 64 MiB。
- `r = llm.chat(messages, temperature=0, max_tokens=300)` 就是 Day 4 的 `chat()`,`.env` 里的 `LLM_EXTRA_BODY` 照样会带上(关思考模式)。类型上 messages 是 `list[dict[str, Any]]`,传进去不会报红线。
- `print(r.content)` 问「应付合计是多少?只回答金额」,实测回答 `98.00`;问「这是哪家公司的账单?买了什么?」,它把账单编号、日期、客户、席位数、单价、税额全部列了出来,都对。
- `print(f"输入 {r.prompt_tokens} tokens` 第一个问题实测 `输入 728 tokens(图片也算在里面)| 输出 3 | 约 ¥0.0015`。按 `.env` 里的价格(未命中缓存 2 元/百万、输出 8 元/百万):728 × 2 / 1e6 + 3 × 8 / 1e6 ≈ ¥0.0015。

</div>

## 读 PDF 的三条路

Day 18 讲过「文字型 PDF 直接抽、扫描页走 OCR」。有了视觉模型,第三条路是**把整页渲染成图片直接给模型看**。三条路不是谁取代谁,各有适用的地方:

| 做法 | 适合 | 代价 | 主要的坑 |
| --- | --- | --- | --- |
| 抽文字层(pdfplumber、PyMuPDF) | 系统导出的 PDF:账单、报表、合同电子版 | 几乎为零,毫秒级 | 多栏版式顺序乱、无边框表格变成散乱数字 |
| OCR(RapidOCR、PaddleOCR) | 扫描件、照片,要拿到每个字和坐标 | 本地 CPU 一页一两秒,不花 API 钱 | 只认字不懂结构,形近字认错 |
| 视觉模型直读(VLM) | 版式复杂、要理解内容、要直接抽字段 | 每页几百到上千 token,有延迟 | 会「脑补」看不清的内容;数据要出网 |

我拿同一张扫描账单跑了一遍 RapidOCR(Day 18 用的那个),1.6 秒出结果,大部分字都对,但有两处错:「客户」认成了「客广」,明细行的金额「98.00」认成了「00.86」(置信度 0.867,是那一页最低的)。视觉模型在同一张图上把所有字段都读对了。这不是说 OCR 不行,一个只认字形的模型遇到模糊的「户」和「广」本来就很难分,而视觉语言模型知道「客户:」后面跟的是公司名,有上下文可以纠正。反过来,OCR 给你每个字的坐标和置信度,能做版面还原、能标出哪里不确定,视觉模型一般只给你一段文字。

顺便说一个装环境的坑。Day 18 写的是 `uv add rapidocr onnxruntime`,在 **Intel 芯片的 Mac** 上会直接装不上:2026 年 10 月最新的 onnxruntime 1.31.0 已经不提供 `macosx_x86_64` 的 wheel,uv 会报 `doesn't have a source distribution or wheel for the current platform`。改成 `uv add rapidocr "onnxruntime<1.23"`,我实测装上的是 1.22.1,能正常跑。Apple 芯片和 Linux 不受影响。

实际系统里通常是三条路组合:每一页先试文字层;抽出来是空的或者明显是乱码,走 OCR 或视觉模型;需要抽字段、理解表格结构的页面,直接交给视觉模型。下面的账单抽取器就是这个逻辑的最小版本。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="账单抽取流程:有文字层走文字,没有走视觉模型,结果都经过代码校验和业务库对账">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="95" width="100" height="50" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="30" y="118" fill="var(--ink)">PDF / 图片</text>
<text x="30" y="135" fill="var(--ink-faint)" font-size="11">客户发来的</text>
<rect x="146" y="95" width="110" height="50" rx="6" fill="none" stroke="var(--compute)"/>
<text x="158" y="118" fill="var(--compute)">有文字层吗</text>
<text x="158" y="135" fill="var(--ink-faint)" font-size="11">pdfplumber</text>
<rect x="290" y="30" width="150" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="302" y="53" fill="var(--mem)">文字 → LLM 抽字段</text>
<text x="302" y="70" fill="var(--ink-faint)" font-size="11">643 tokens</text>
<rect x="290" y="160" width="150" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="302" y="183" fill="var(--mem)">图片 → VLM 抽字段</text>
<text x="302" y="200" fill="var(--ink-faint)" font-size="11">1275–1561 tokens</text>
<rect x="470" y="95" width="154" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="482" y="118" fill="var(--compute)">代码校验 + 对账</text>
<text x="482" y="135" fill="var(--ink-faint)" font-size="11">算术 / 税额 / 业务库</text>
<line x1="116" y1="120" x2="144" y2="120" stroke="var(--rule)"/>
<line x1="256" y1="112" x2="288" y2="60" stroke="var(--rule)"/>
<text x="258" y="80" fill="var(--ink-faint)" font-size="11">有</text>
<line x1="256" y1="128" x2="288" y2="182" stroke="var(--rule)"/>
<text x="258" y="170" fill="var(--ink-faint)" font-size="11">没有</text>
<line x1="440" y1="55" x2="468" y2="112" stroke="var(--rule)"/>
<line x1="440" y1="185" x2="468" y2="128" stroke="var(--rule)"/>
</g>
</svg>
<figcaption>两条路的模型都只负责「读出来」,数对不对由右边那一格的代码说了算。</figcaption>
</figure>

## 账单抽取和对账

场景是这样的:客户在工单里附了一张账单,说「你们这个月多扣了我钱」。客服 Agent 要先知道这张账单上写的是什么,再和系统里的记录对比。这里最关键的设计原则只有一条:**模型负责读,代码负责算和判断。** 让模型去算「明细加起来对不对」,它大概率算对,但「大概率」在钱的问题上不够用。

```python
# agent-60-lab/topics/multimodal/invoice_extract.py
"""把客户发来的账单(PDF 或图片)抽成结构化数据,再和业务库对账。
有文字层 → pdfplumber 抽文字交给模型(便宜、稳);没有文字层 → 渲染成图片交给视觉模型。
运行:uv run python -m topics.multimodal.invoice_extract data/invoices/INV-2026-0001-scan.pdf
"""

import base64
import io
import json
import sqlite3
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import pdfplumber
from pydantic import BaseModel, ValidationError

from common.llm import LLMClient
from common.structured import extract, schema_prompt

DB = Path("w4/cloudledger/cloudledger.db")
TAX_RATE = Decimal("0.06")
CENT = Decimal("0.01")


class LineItem(BaseModel):
    name: str
    quantity: int
    unit_price: Decimal
    amount: Decimal


class Invoice(BaseModel):
    invoice_id: str
    issued_at: date
    customer: str
    items: list[LineItem]
    tax: Decimal
    total: Decimal


INSTRUCTIONS = (
    "你是财务助理,从 CloudLedger 账单里抽取字段。金额只写数字,不带货币符号。"
    "看不清的字段不要猜,填你看到的样子;不要自己重新计算任何金额。"
)


def page_text_and_image(path: Path) -> tuple[str, bytes]:
    if path.suffix.lower() == ".png":
        return "", path.read_bytes()
    with pdfplumber.open(path) as pdf:
        page = pdf.pages[0]
        text = page.extract_text() or ""
        buf = io.BytesIO()
        page.to_image(resolution=150).original.save(buf, format="PNG")
    return text, buf.getvalue()


def extract_from_image(llm: LLMClient, png: bytes, retries: int = 1) -> Invoice:
    b64 = base64.b64encode(png).decode()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": f"{INSTRUCTIONS}\n\n{schema_prompt(Invoice)}"},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                {"type": "text", "text": "抽取这张账单。"},
            ],
        },
    ]
    for _ in range(retries + 1):
        r = llm.chat(messages, temperature=0, max_tokens=800, response_format={"type": "json_object"})
        try:
            return Invoice.model_validate_json(r.content)
        except ValidationError as e:
            messages.append(r.message)
            messages.append({"role": "user", "content": f"JSON 没通过校验:{e.errors()[:3]},请改正后只输出 JSON。"})
    raise RuntimeError("视觉抽取两次都没通过校验")


def check(inv: Invoice) -> list[str]:
    problems = []
    for it in inv.items:
        if it.quantity * it.unit_price != it.amount:
            problems.append(f"{it.name}:{it.quantity} × {it.unit_price} ≠ {it.amount}")
    if sum(it.amount for it in inv.items) != inv.total:
        problems.append(f"明细合计 {sum(it.amount for it in inv.items)} ≠ 应付合计 {inv.total}")
    expected_tax = (inv.total / (1 + TAX_RATE) * TAX_RATE).quantize(CENT)
    if abs(expected_tax - inv.tax) > CENT:
        problems.append(f"税额 {inv.tax},按 6% 价内税应为 {expected_tax}")
    conn = sqlite3.connect(DB)
    row = conn.execute(
        "SELECT i.amount_cents, i.issued_at, c.company FROM invoices i "
        "JOIN customers c ON c.id = i.customer_id WHERE i.id = ?",
        (inv.invoice_id,),
    ).fetchone()
    if row is None:
        problems.append(f"业务库里没有账单 {inv.invoice_id}")
    else:
        cents, issued, company = row
        if Decimal(cents) / 100 != inv.total:
            problems.append(f"业务库金额 {Decimal(cents) / 100},账单上写 {inv.total}")
        if issued != inv.issued_at.isoformat():
            problems.append(f"业务库开具日期 {issued},账单上写 {inv.issued_at}")
        if company not in inv.customer:
            problems.append(f"业务库客户 {company},账单上写 {inv.customer}")
    return problems


def main() -> None:
    path = Path(sys.argv[1])
    llm = LLMClient()
    text, png = page_text_and_image(path)
    if len(text.strip()) > 20:
        route = "文字层"
        inv = extract(llm, Invoice, INSTRUCTIONS, text)
    else:
        route = "视觉模型"
        inv = extract_from_image(llm, png)
    print(f"走的是:{route}")
    print(json.dumps(inv.model_dump(mode="json"), ensure_ascii=False, indent=2))
    problems = check(inv)
    print("校验通过" if not problems else "发现问题:\n- " + "\n- ".join(problems))
    print(llm.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from common.structured import extract, schema_prompt` Day 6 写的两个函数。`extract` 负责「文字 → pydantic 对象」带重试,`schema_prompt` 把 pydantic 模型转成 JSON Schema 写进提示词。视觉那条路要自己拼 messages,所以只借用 `schema_prompt`。
- `TAX_RATE = Decimal("0.06")` 钱一律用 `Decimal`,而且从字符串构造。`Decimal(0.06)` 会把浮点误差也带进来,变成 0.0599999999999999977795539507…。
- `unit_price: Decimal` pydantic 收到 JSON 里的 `49` 或 `49.00` 都会转成 Decimal。实测模型返回的是 `49`,`Decimal("49") == Decimal("49.00")` 为真,所以比较不受影响。
- `issued_at: date` 让 pydantic 帮你校验日期格式。模型要是返回「2026年10月9日」,这里直接校验失败,触发重试。
- `"看不清的字段不要猜,填你看到的样子;不要自己重新计算任何金额。"` 这句是整个设计的关键。不加的话,模型看到明细是 98、合计被改成了 89,有可能「好心」地把合计纠正回 98,你就抓不到篡改了。
- `if path.suffix.lower() == ".png":` 图片文件直接读字节,没有文字层可言。
- `text = page.extract_text() or ""` 文字型 PDF 拿到上面那段完整文字;扫描 PDF 拿到 `None`,`or ""` 把它变成空字符串。
- `page.to_image(resolution=150).original.save(buf, format="PNG")` 这里有个我实测才发现的浪费:我们的扫描 PDF 是 PIL 按 72 dpi 存的,页面尺寸是 901×1261 point,按 150 dpi 渲染出来变成 1878×2628 像素,比原图大了一倍多。放大不会多出任何信息,却让输入从 1275 tokens 涨到 1561。真实的扫描件一般是 300 dpi 存的,150 dpi 渲染是缩小,不会有这个问题。
- `messages: list[dict[str, Any]] = [` 显式标注类型。不标的话,类型检查器会根据第一个元素推断出一个很窄的类型,后面 append 一个结构不同的消息就报红线。
- `{"role": "system", "content": f"{INSTRUCTIONS}\n\n{schema_prompt(Invoice)}"},` system 放指令和 schema(纯文字,可以放 system),图片放在 user 里。
- `r = llm.chat(messages, temperature=0, max_tokens=800, response_format={"type": "json_object"})` Day 6 讲过的 JSON mode。DeepSeek 的 JSON mode 要求提示词里出现「json」这个词,`schema_prompt` 里有「json 对象」,满足。
- `return Invoice.model_validate_json(r.content)` 校验通过直接返回。我第一次对改过的图片跑时,调用次数显示是 2,也就是第一次输出没通过校验、带着错误信息重试了一次才成功;之后再跑都是一次通过。所以重试不是摆设。
- `messages.append({"role": "user", "content": f"JSON 没通过校验:{e.errors()[:3]}` 把 pydantic 的前三条错误原样告诉模型。只说「格式不对」,它不知道改哪里。
- `if it.quantity * it.unit_price != it.amount:` 第一项检查,明细自身的算术:2 × 49 = 98,对。
- `if sum(it.amount for it in inv.items) != inv.total:` 第二项,明细加起来等不等于合计。
- `expected_tax = (inv.total / (1 + TAX_RATE) * TAX_RATE).quantize(CENT)` 第三项,按合计反推税额:98 ÷ 1.06 × 0.06 = 5.547…,`quantize` 到分是 5.55。允许差 1 分,因为各家四舍五入的时机不同。
- `cents, issued, company = row` 第四项,和业务库对账。代入 INV-2026-0001:`(9800, "2026-10-09", "星河餐饮")`。
- `if company not in inv.customer:` 账单上写的是「星河餐饮(刘伟)」,库里是「星河餐饮」,用包含关系判断,不要求完全相等。
- `if len(text.strip()) > 20:` 文字层少于 20 个字符就当成没有。有的扫描件会带一个页码或者水印的文字层,只有几个字符,不能因此就走文字那条路。
- `print(f"走的是:{route}")` 文字型 PDF 实测:`走的是:文字层`、`校验通过`、`1 次调用 | 输入 643 / 输出 75 tokens`。扫描 PDF 实测:`走的是:视觉模型`、`校验通过`、`1 次调用 | 输入 1561 / 输出 75 tokens`。两条路抽出来的 JSON 完全一样。
- `print(llm.ledger)` 文字层那次约 643 × 2 / 1e6 + 75 × 8 / 1e6 ≈ ¥0.0019;视觉那次约 1561 × 2 / 1e6 + 75 × 8 / 1e6 ≈ ¥0.0037。同一张账单,能走文字层就走文字层,便宜一半,也更稳。重复跑的时候命中了缓存,实际花费比这个低。

</div>

现在造一张「改过金额」的账单,看对账能不能抓出来。这个脚本在扫描图上把应付合计的「98.00 元」涂白,写上「89.00」:

```python
# agent-60-lab/topics/multimodal/tamper.py
"""把扫描件上的「应付合计」改成 89.00,模拟客户 P 图或者拍照糊成了别的数字。
运行:uv run python -m topics.multimodal.tamper
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SRC = Path("data/invoices/INV-2026-0001-scan.png")
DST = Path("data/invoices/INV-2026-0001-tampered.png")

img = Image.open(SRC).convert("L")
draw = ImageDraw.Draw(img)
box = (675, 422, 800, 465)  # 「98.00 元」那一块,坐标是在 150 dpi 的扫描图上量的
draw.rectangle(box, fill=255)
draw.text((690, 428), "89.00", fill=0, font=ImageFont.load_default(size=24))
img.save(DST)
print(f"已生成 {DST}")
```

<div class="line-notes">

- `box = (675, 422, 800, 465)` 左、上、右、下。这个框我调了两次:第一次框小了,左边残留了半个「9」,看起来像「9 89.00」,这种图模型反而会读出奇怪的结果。改完用图片查看器打开确认一下再往下做。
- `draw.text((690, 428), "89.00", fill=0, font=ImageFont.load_default(size=24))` Pillow 10.1 以后 `load_default` 可以传字号。它是英文字体,写不了「元」,我第一次写成 `"89.00 元"`,结果「元」变成了一个方框,所以只写数字。字体和周围不一样,人眼一看就知道被改过,但对模型来说它就是 89.00。

</div>

对改过的图跑抽取,实测输出(JSON 部分省略,只有 `total` 变成了 `"89"`):

```text
走的是:视觉模型
发现问题:
- 明细合计 98 ≠ 应付合计 89
- 税额 5.55,按 6% 价内税应为 5.04
- 业务库金额 98,账单上写 89
1 次调用 | 输入 1275 / 输出 75 tokens | 约 ¥0.0024
```

三条检查抓到了同一个问题,从三个角度:明细加不上、税额对不上、和业务库不一致。模型老老实实地把看到的 89 抄了下来,没有自作主张地「纠正」,这就是指令里那句「不要自己重新计算任何金额」的作用。

在真实系统里,这三条检查的结论也不该是 Agent 自己下的「客户在造假」,而是一条交给人工的提示:「客户上传的账单金额与系统记录不一致(89.00 vs 98.00),请核对原件」。拍照模糊、客户截了别的账单、系统真的扣错了,都可能是原因。

## 截图进检索

另一个高频场景:客户发了一张报错截图,一个字都没写。先造一张截图,内容是导入银行流水时弹出 E1043:

```python
# agent-60-lab/topics/multimodal/make_error_shot.py
"""造一张「客户发来的报错截图」:导入账单时弹出 E1043。
运行:uv run python -m topics.multimodal.make_error_shot
"""

import io
from pathlib import Path

import pdfplumber
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

OUT = Path("data/screenshots/import-error.png")
pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))

buf = io.BytesIO()
c = canvas.Canvas(buf, pagesize=(420, 220))
c.setFont("STSong-Light", 11)
c.drawString(20, 195, "CloudLedger  >  数据导入  >  导入银行流水")
c.rect(40, 40, 340, 130)  # 弹窗
c.setFont("STSong-Light", 13)
c.drawString(60, 145, "导入失败")
c.setFont("STSong-Light", 10)
c.drawString(60, 120, "错误码 E1043:无法解析文件「9月流水.csv」")
c.drawString(60, 102, "请检查文件格式后重试。")
c.rect(300, 55, 60, 22)
c.drawString(318, 62, "确定")
c.save()

buf.seek(0)
with pdfplumber.open(buf) as pdf:
    img = pdf.pages[0].to_image(resolution=200).original
OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT)
print(f"已生成 {OUT},{img.size[0]}×{img.size[1]}")
```

<div class="line-notes">

- `c = canvas.Canvas(buf, pagesize=(420, 220))` 画到内存里,不落盘 PDF。用 reportlab 画再用 pdfplumber 渲染成图片,是为了复用同一套中文字体,不依赖系统里装了什么字体。
- `c.drawString(60, 120, "错误码 E1043:无法解析文件「9月流水.csv」")` 注意截图里写的是「无法解析文件」,并没有说是编码问题。知识库 kb-011 的标题是「错误码 E1043:文件编码错误」,两边的文字几乎没有重合,能连上靠的是错误码。
- `img = pdf.pages[0].to_image(resolution=200).original` 实测输出 `已生成 data/screenshots/import-error.png,1167×612`。

</div>

读截图的脚本。第一版我让模型顺便把检索词也写出来,加了一个 `search_query` 字段,结果实测返回的是空字符串。模型把能看到的都抄对了,偏偏这个需要它「再加工一步」的字段没填。第二版改成检索词由代码拼:

```python
# agent-60-lab/topics/multimodal/screenshot_to_query.py
"""客户只发了一张截图、一个字没写。先让视觉模型把截图读成文字,再拿文字去走 W3 的检索。
运行:uv run python -m topics.multimodal.screenshot_to_query data/screenshots/import-error.png
     加 --search 会接着调 W3 的 retrieve(要先把 Postgres 打开,和 Day 21 一样)
"""

import json
import sys
from pathlib import Path

from pydantic import BaseModel

from common.llm import LLMClient
from common.structured import schema_prompt
from topics.multimodal.vision_ask import image_part


class ScreenRead(BaseModel):
    page: str  # 截图停在哪个页面
    error_code: str | None  # 截图里出现的错误码,没有就 null
    error_text: str  # 截图里的报错原文,一字不改
    user_action: str  # 推测用户当时在做什么


SYSTEM = (
    "你在帮客服读客户发来的截图。只写截图里看得到的内容,原文照抄;"
    "推测的部分只放在 user_action 里。\n\n" + schema_prompt(ScreenRead)
)


def read_screenshot(llm: LLMClient, path: Path) -> ScreenRead:
    r = llm.chat(
        [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": [image_part(path), {"type": "text", "text": "读这张截图。"}]},
        ],
        temperature=0,
        max_tokens=400,
        response_format={"type": "json_object"},
    )
    return ScreenRead.model_validate_json(r.content)


def to_query(shot: ScreenRead) -> str:
    # 检索词用代码拼,不让模型写:错误码和报错原文是检索里最值钱的两样东西
    text = " ".join(shot.error_text.split())  # 把换行压成空格
    return f"{shot.error_code} {text}" if shot.error_code else text


if __name__ == "__main__":
    llm = LLMClient()
    shot = read_screenshot(llm, Path(sys.argv[1]))
    print(json.dumps(shot.model_dump(), ensure_ascii=False, indent=2))
    query = to_query(shot)
    print("检索词:", query)
    print(llm.ledger)
    if "--search" in sys.argv:
        sys.path.insert(0, "w3")  # W3 的文件是按平级 import 写的
        from retrieve import retrieve  # pyright: ignore[reportMissingImports]

        for chunk, score in retrieve(query, k=3, mode="hybrid+rerank"):
            print(f"{score:.3f}  {chunk.id}  {chunk.title}")
```

<div class="line-notes">

- `from topics.multimodal.vision_ask import image_part` 复用前面写的图片块函数。用 `-m` 在根目录跑,这个 import 才找得到。
- `error_code: str | None  # 截图里出现的错误码,没有就 null` 单独一个字段,因为它在检索里最值钱:错误码在 BM25 里是一个很稀有、区分度很高的词。
- `error_text: str  # 截图里的报错原文,一字不改` 实测读出来是 `导入失败\n错误码 E1043:无法解析文件「9月流水.csv」\n请检查文件格式后重试。`,一字不差,连书名号都对。
- `user_action: str  # 推测用户当时在做什么` 把「看到的」和「猜的」分在不同字段里。实测它写的是「用户尝试导入银行流水文件「9月流水.csv」时失败,看到错误提示后点击「确定」按钮关闭弹窗」。后半句是它脑补的,截图里并没有点确定的动作。这就是为什么推测要单独放:回复客户时只能引用前两个字段。
- `"推测的部分只放在 user_action 里。` 提示词里对应地规定了哪里可以猜。
- `def to_query(shot: ScreenRead) -> str:` 第一版这一步交给模型,`search_query` 返回了空字符串。能用三行代码确定地拼出来的东西,不要交给模型。
- `text = " ".join(shot.error_text.split())` `split()` 不带参数会按所有空白(含换行)切开,再用空格拼回去。代入后是 `导入失败 错误码 E1043:无法解析文件「9月流水.csv」 请检查文件格式后重试。`。
- `return f"{shot.error_code} {text}" if shot.error_code else text` 把错误码再放一次在最前面。最终检索词是 `E1043 导入失败 错误码 E1043:无法解析文件「9月流水.csv」 请检查文件格式后重试。`。
- `print(llm.ledger)` 实测 `1 次调用 | 输入 696 / 输出 94 tokens`。
- `sys.path.insert(0, "w3")` W3 的文件互相之间是 `from chunking import ...` 这种平级写法,只有把 `w3/` 加进搜索路径才能 import。这是在两种写法之间搭桥,不是好的长期做法,真要用就该把 W3 整理成包。
- `from retrieve import retrieve  # pyright: ignore[reportMissingImports]` 类型检查器不知道运行时改了 sys.path,会报找不到模块,这个注释让它闭嘴。import 的时候会连 Postgres、建 BM25 索引,和 Day 21 一样。
- `for chunk, score in retrieve(query, k=3, mode="hybrid+rerank"):` 实测前三名:`0.978 kb-011#1 错误码 E1043:文件编码错误`、`0.956 kb-009#1 导入银行流水`、`0.944 kb-011#2 错误码 E1043:文件编码错误`。原因和解决办法两块都进了前三。

</div>

作为对照,我用一句客户可能会自己打的话「导入银行流水失败」去检索,第一名是 `kb-010#1 错误码 E1042:银行流水导入失败`,分数 0.98,很自信,但是错的:E1042 是列名或日期格式不对,和这位客户的编码问题是两回事。客户描述问题时会丢掉最关键的信息(错误码),截图里却原样带着。**这就是多模态在客服场景里最实在的价值:不是「能看图」本身,而是截图里有用户自己说不清的精确信息。**

## 文档解析工具,2026 年版

Day 18 的工具表是按「使用印象」写的。这次我查了每个项目 2026 年 10 月的版本。这几个工具我都没有在这台机器上实际跑(要么要显卡,要么要下几个 G 的模型),下面的能力描述来自各自的官方 README,选型前请拿你自己的文档测一下。

**MinerU**(上海人工智能实验室 OpenDataLab):2026-10-11 发布了 4.0.12。4.0 是一次大改,原来的 pipeline / vlm / hybrid 几种后端被换成了四个质量档位 flash、basic、standard、advanced;输入格式扩到了 Office、EPUB、OFD、HTML、CSV;还加了一个本地文档库,解析结果带稳定的引用定位符(形如 `doc:ab12cd3/tier:standard/page:11`),正好可以当 RAG 的引用出处。用法 `uv pip install -U "mineru>=4.0,<5"`,然后 `mineru-kit parse document.pdf -o document.md --tier standard`。按 README,basic 档用 ONNX 跑,CPU 就行,大约 2 GB 内存;standard 和 advanced 档会用到视觉模型(3.3 版的更新说明里是 1.2B 参数的 MinerU2.5-Pro-2605),模型下载约 2 GB,CPU 也能跑,有 GPU 会快很多。我在 Intel Mac 上没试,前面说的 onnxruntime 装不上的问题它很可能也会遇到。网上很多 MinerU 教程还是 2.x、3.x 的命令(`mineru -p xx -o xx -b pipeline`),跟着做之前先看版本。

**Docling**(IBM 开源,现在归 docling-project 组织):迭代非常快,2026-10-20 是 v2.141.0。特点是输出一个统一的文档对象(DoclingDocument),可以导出 Markdown、JSON、HTML,和 LangChain、LlamaIndex 的集成做得好。配套的 granite-docling-258M 是一个只有 2.58 亿参数的端到端文档理解模型,Apache 2.0。

**PaddleOCR**(百度):工具包 2026-06-11 发布了 3.7.0。官方站说 2026-05-28 开源了 PaddleOCR-VL-1.6,在 OmniDocBench v1.6 上报了 96.3% 的分数(这是官方自己报的分数)。中文场景,特别是票据、证件、古籍,它的积累最深。

**OmniDocBench** 是现在比较文档解析效果最常被引用的基准,三家都在用它报分数。但基准上的分数只是参考:你的文档是什么样的(中文发票?英文论文?多栏财报?),就该用它建一个几十页的小测试集,自己比。方法和 Day 19 建检索测试集一样。

我的选型建议很简单。格式规整、量不大的,继续用 Day 18 的 pdfplumber 方案,外加视觉模型兜底读扫描页。量大、版式复杂、中文为主,先试 MinerU。已经在用 LlamaIndex 或者 LangChain、英文文档为主,先试 Docling。票据证件类,看 PaddleOCR。**数据不能出网的**(合同、病历、财务),本地部署是硬要求,视觉模型那条路要换成自部署的 Qwen3-VL 这类开源模型,或者干脆只用本地 OCR。

## 多模态 RAG:图片也要能被搜到

上面那个截图例子是「查询端」多模态:用户的问题是图片,我们把它变成文字再检索。另一个方向是「文档端」:知识库里本身就有大量图片,比如产品操作手册里的截图、财报里的图表、设计文档里的架构图。用户问「导出按钮在哪」,答案在一张截图里,纯文本检索找不到。

有两种做法:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="多模态 RAG 两种做法:先转文字再走原有检索,或者直接对页面图片做多向量检索">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="16" y="28" fill="var(--ink)">做法一:先变成文字</text>
<rect x="16" y="40" width="110" height="44" rx="6" fill="none" stroke="var(--compute)"/>
<text x="28" y="66" fill="var(--compute)">页面 / 图片</text>
<rect x="150" y="40" width="150" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="162" y="60" fill="var(--mem)">VLM 写描述 + 抄字</text>
<text x="162" y="76" fill="var(--ink-faint)" font-size="11">入库时一次性花钱</text>
<rect x="324" y="40" width="150" height="44" rx="6" fill="none" stroke="var(--mem)"/>
<text x="336" y="66" fill="var(--ink)">W3 原有文本检索</text>
<text x="490" y="60" fill="var(--ink-soft)" font-size="11">存储小,能 BM25</text>
<text x="490" y="76" fill="var(--ink-soft)" font-size="11">描述漏了就搜不到</text>
<line x1="126" y1="62" x2="148" y2="62" stroke="var(--rule)"/>
<line x1="300" y1="62" x2="322" y2="62" stroke="var(--rule)"/>
<text x="16" y="138" fill="var(--ink)">做法二:直接检索图片(ColPali 一类)</text>
<rect x="16" y="150" width="110" height="44" rx="6" fill="none" stroke="var(--compute)"/>
<text x="28" y="176" fill="var(--compute)">页面截图</text>
<rect x="150" y="150" width="150" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="162" y="170" fill="var(--mem)">每页约一千个向量</text>
<text x="162" y="186" fill="var(--ink-faint)" font-size="11">每个 patch 一个</text>
<rect x="324" y="150" width="150" height="44" rx="6" fill="none" stroke="var(--mem)"/>
<text x="336" y="170" fill="var(--ink)">逐词找最像的 patch</text>
<text x="336" y="186" fill="var(--ink-faint)" font-size="11">late interaction</text>
<text x="490" y="170" fill="var(--ink-soft)" font-size="11">不丢版面信息</text>
<text x="490" y="186" fill="var(--ink-soft)" font-size="11">存储大,要 GPU</text>
<line x1="126" y1="172" x2="148" y2="172" stroke="var(--rule)"/>
<line x1="300" y1="172" x2="322" y2="172" stroke="var(--rule)"/>
</g>
</svg>
<figcaption>大多数项目先用做法一,它不用改检索架构;做法二适合图表、版面本身携带大量信息的文档。</figcaption>
</figure>

**做法一:先把图片变成文字。** 入库时让视觉模型给每张图写一段描述,外加图里的文字原样抄录,把这段文字和图片路径一起作为一个块存进 W3 的知识库。检索时完全不用改,回答时把原图路径作为引用一并给出。这个做法的成本集中在入库时:一张图一千个 token 上下,一千张图大约 100 万 token,按今天的价格是两块钱左右,一次性的。缺点也明显:描述里没写到的细节就永远搜不到了。提示词里一定要求它「抄录图中所有文字」,不要只写一句「这是一张设置页面的截图」。

**做法二:直接对图片做检索。** 代表是 2024 年的论文 ColPali(arXiv 2407.01449)。它把每一页文档当成一张图,用视觉语言模型给每个小方块生成一个向量,论文里每页约一千个 128 维向量;查询时问题里的每个词都去找这一页里最像的那个方块,把分数加起来作为这一页的得分(这叫 late interaction,和 ColBERT 是同一个思路)。好处是表格、图表、版面这些信息一点不丢,论文里在视觉丰富的文档上明显好于「先 OCR 再检索」。代价是存储:一页一千个向量,按半精度算是 256 KB,而 W3 的一个块只有一个 1024 维向量,4 KB,差了六十多倍。维护它的 `colpali-engine` 库 2026-08-22 发布了 v0.3.18。

我的建议:先做做法一,它能直接接在你已有的系统上,而且 BM25 依然能用(截图里的错误码、按钮名都能精确匹配)。等你确认用户的问题有相当一部分答案在图表和版面里、做法一的召回率上不去,再考虑做法二。

## 成本和隐私

成本用一个算式就够了:**每页 token ≈ 图片 token(几百到一千多)+ 提示词 + 输出**。今天这张账单走视觉一次 1275–1561 个输入 token,按 DeepSeek 未命中缓存 2 元/百万算,一张约 ¥0.003。一天一万张是三十块钱。这个数不大,但有两个地方会让它翻倍:不必要的高分辨率(前面那个 150 dpi 放大的坑),以及对每一页都走视觉模型(其实一半以上的页面有文字层)。

隐私要严肃得多。截图和照片是 PII(个人身份信息)的重灾区:客户截账单页面时,顺手把手机号、邮箱、银行卡后四位一起截进来了;拍纸质发票时,背景里可能有别的文件。几条规矩:发给外部模型 API 之前,先确认你们的数据协议允许;日志里不要存原图的 base64,存一个路径或者哈希;客户上传的图片设保留期限;合同、病历这类敏感文档走本地模型。国内业务还要考虑数据出境:用海外模型 API 处理国内用户的截图,可能涉及数据出境合规,这类场景优先用国内厂商的视觉模型(DeepSeek、通义千问、智谱等)或者自部署。

## 动手练习

1. **准备数据。** 在 `agent-60-lab` 根目录 `uv add reportlab pillow`,把 `make_invoice.py` 和 `tamper.py` 放进 `topics/multimodal/`,依次运行。用 pdfplumber 确认扫描版 PDF 抽不出文字。
2. **第一次发图。** 运行 `vision_ask.py`,问三个问题:应付合计、客户是谁、税率是多少。然后把 `image_part` 的 `detail` 改成 `"low"` 再问一遍,记下两次的 `prompt_tokens`。
3. **抽取和对账。** 分别对文字型 PDF、扫描 PDF、改过的 PNG 运行 `invoice_extract.py`。
4. **换一张年付账单。** 在库里找一张年付订阅的账单(`SELECT i.id FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id WHERE s.billing_cycle = 'yearly' LIMIT 1`),生成后跑抽取,看三项检查是否都过。我实测 INV-2026-0018(专业版年付 12 席,14256 元)三项都过;你的库如果是旧版种子生成的,数字可能不同,有不过的就判断是模型读错了、还是 `make_invoice.py` 的算法和种子数据不一致。
5. **截图进检索。** 运行 `make_error_shot.py` 和 `screenshot_to_query.py --search`(要先打开 Postgres)。再直接用「导入银行流水失败」调 W3 的检索,对比两次的第一名。
6. **(选做)OCR 对照。** `uv add rapidocr "onnxruntime<1.23"`(Apple 芯片可以不加版本限制),用 Day 18 的 `ocr_page` 思路对扫描图跑一次 OCR,和视觉模型的结果逐字段对比。

**验收标准**:

- 第 2 步:high 和 low 两次的 `prompt_tokens` 都记下来,low 明显更少;说得出这张图为什么 low 也能读对,什么样的图不能用 low。
- 第 3 步:前两份校验通过,改过的那份至少报出「业务库金额 98,账单上写 89」。
- 第 5 步:截图生成的检索词带着 E1043,前三名里有 kb-011;「导入银行流水失败」的第一名不是 kb-011。
- 能解释为什么「不要自己重新计算任何金额」这句话不能删。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 多模态(multimodal) | 模型的输入或输出不只是文字,还有图片、音频、视频等 |
| VLM(视觉语言模型) | 能同时接收图片和文字、输出文字的模型,比如 Qwen3-VL、DeepSeek 的视觉输入 |
| patch | 图片被切成的小方块,每个方块变成一个视觉 token 或向量 |
| 视觉 token | 图片经视觉编码器和投影层变成的、和文字 token 同维度的向量,按输入 token 计费 |
| detail | OpenAI 兼容协议里控制图片清晰度的参数,low 便宜但看得糊,high 清楚但贵 |
| data URL | 把文件内容用 base64 直接写进 URL 的格式:`data:image/png;base64,...` |
| 文字层 | PDF 里可以直接选中、复制的文字。系统导出的 PDF 有,扫描件没有 |
| OCR | 光学字符识别,从图片里认出文字和坐标 |
| 版面分析 | 识别页面上哪里是标题、正文、表格、图片,以及阅读顺序 |
| OmniDocBench | 比较文档解析工具效果最常用的公开基准 |
| ColPali | 直接对页面图片做多向量检索的方法,每页存约一千个向量 |
| late interaction | 查询的每个词分别和文档的每个向量比,取最大值再求和,ColBERT 和 ColPali 都用它 |
| PII | 个人身份信息,手机号、邮箱、证件号、银行卡号等 |

## 常见误区

**图越清楚越好。** 超过模型的缩放上限,多出来的像素会被缩掉,你只是多传了几兆数据。反过来,把小图放大也不会多出信息,还会多花 token。要看清细节,裁剪比放大有用。

**有了视觉模型就不需要 OCR 和文字层了。** 文字层零成本而且百分之百准确;OCR 给坐标和置信度,能告诉你哪里没把握。视觉模型适合理解和抽取,不适合当所有页面的默认解析器。

**让模型顺便把账算了。** 模型读数字的准确率很高,但「明细加起来等不等于合计」这种判断要交给代码。而且要明确告诉它不要纠正、只抄录,否则改过的数字会被它「好心」改回去,你就看不到了。

**模型说看到了,就是真看到了。** 今天的截图例子里,它在 `user_action` 里写了「点击确定按钮关闭弹窗」,截图里并没有这个动作。把「看到的」和「推测的」分开存,回复客户时只用看到的。

**多模态 RAG 一上来就上 ColPali。** 它的存储是普通文本向量的几十倍,还要 GPU。先用「图片转描述」接进现有系统,召回率真上不去再换。

**跟着网上的 MinerU 教程敲命令。** 4.0 的命令和 2.x、3.x 完全不同。先看版本,再看对应版本的文档。

## 学习资料

### 文档与文章

- [DeepSeek API · Vision 指南](https://api-docs.deepseek.com/guides/vision):今天用的全部参数(三种传图方式、detail、尺寸和数量上限、计费规则)都在这一页,15 分钟。
- [阿里云百炼 · 视觉理解](https://help.aliyun.com/zh/model-studio/vision):通义千问视觉模型的 OpenAI 兼容调用和 token 计算,想换模型对比时看。
- [Claude · Vision](https://platform.claude.com/docs/en/build-with-claude/vision) 和 [PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support):Claude 的图片输入和直接读 PDF 的方式,可以和今天自己渲染页面的做法对比。
- [ColPali 论文](https://arxiv.org/abs/2407.01449):读摘要、第 3 节方法和结果表,一小时。
- [OmniDocBench](https://github.com/opendatalab/OmniDocBench):看它把文档分成了哪些类型、用什么指标打分,给自己建测试集时参考。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1eqzBYzEd9&autoplay=0&high_quality=1" title="PDF转markdown，AI知识库绝配，科研文献整理必备，MinerU将PDF转化为机器可读格式的工具" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · PDF转markdown,AI知识库绝配,MinerU 将 PDF 转化为机器可读格式的工具 · 7 分钟。看它展示的复杂版面(多栏、公式、表格)转换效果,理解为什么要用版面分析工具。视频是 2024 年的老版本,安装命令以现在的 4.0 README 为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qgGgzzEcd&autoplay=0&high_quality=1" title="深度解析和实战ColPali: RAG告别OCR和布局、从0开始多模态RAG" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>模鱼日记 · 深度解析和实战 ColPali:RAG 告别 OCR 和布局、从 0 开始多模态 RAG · 近两小时。前半段讲原理(late interaction、多向量),对照上面的图看;后半段是实操,有 GPU 再跟着做。</figcaption>
</figure>

想看一套完整的企业级多模态 RAG 工程实战,可以看九天Hector 的[《多模态PDF检索+图文并茂回复》](https://www.bilibili.com/video/BV1CDHQzdEfg)(16 P,很长,挑解析和检索那几 P 看)。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/5zbwT4j_9KY" title="ColPali: Document Retrieval with Vision-Language Models only (with Manuel Faysse)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Zeta Alpha · ColPali: Document Retrieval with Vision-Language Models only · 论文作者 Manuel Faysse 亲自讲,为什么要跳过 OCR、为什么用多向量。英文,适合读论文之前看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BFxSYP5IRjQ" title="I Tested 5 Document Parsers for AI Agents (Docling, Andrew Ng DPT, LlamaParse + RAG)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dr. Maryam Miradi · I Tested 5 Document Parsers for AI Agents · 拿同样的文档比较五个解析工具,看她怎么设计对比,比看结论更有用。</figcaption>
</figure>

另外推荐 DeepLearning.AI 和 LandingAI 合作的短课 [Document AI: From OCR to Agentic Doc Extraction](https://www.deeplearning.ai/short-courses/document-ai-from-ocr-to-agentic-doc-extraction/),从 OCR 一路讲到用 Agent 做文档抽取,和今天的账单抽取是同一个问题,免费,两小时左右。

### 书籍

- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024)第 9 章「Multimodal Large Language Models」:图片怎么变成 token、CLIP 和 BLIP-2 是怎么把视觉和语言接起来的,配图很多,一个半小时。中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社图灵,2025)。

### 开源项目与代码

- [opendatalab/MinerU](https://github.com/opendatalab/MinerU):看中文 README 的档位说明和「文档库」那一节,了解 4.0 的定位符设计。
- [docling-project/docling](https://github.com/docling-project/docling) 和 [granite-docling-258M](https://huggingface.co/ibm-granite/granite-docling-258M):Docling 的示例目录里有现成的 RAG 集成代码。
- [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR):中文票据、证件类场景的首选,看 PaddleOCR-VL 的说明。
- [RapidAI/RapidOCR](https://github.com/RapidAI/RapidOCR):Day 18 和今天用的轻量 OCR。
- [illuin-tech/colpali](https://github.com/illuin-tech/colpali):ColPali 官方实现,README 里有十几行就能跑通的检索示例(需要 GPU)。

## 自测

**1. 同一张图,detail 从 high 改成 low,token 从约 716 降到约 195,为什么?什么样的图不适合用 low?**

<details><summary>答案</summary>

图片 token 数取决于缩放后的像素数。DeepSeek 的 low 把图缩到 512×512,方块数大幅减少;high 保持原图大小(再按上限缩放)。字大、版面简单的图(比如今天的账单)low 也能读对;小字号表格、密集的票据、需要看清细节的截图不适合,缩小后字会糊。要按图片类型实测决定。

</details>

**2. 账单抽取器为什么先试文字层,而不是所有页面都交给视觉模型?**

<details><summary>答案</summary>

文字层是 PDF 里本来就有的文字,零成本、毫秒级、百分之百准确。今天实测同一张账单,文字那条路 643 个输入 token,视觉那条路 1275–1561 个,贵一倍左右,而且视觉模型有读错和脑补的可能。只有文字层为空或者是乱码时,才需要 OCR 或视觉模型。

</details>

**3. 提示词里「不要自己重新计算任何金额」删掉会怎样?**

<details><summary>答案</summary>

模型看到明细是 98、合计是 89,可能认为合计印错了,把它「纠正」成 98 再输出。这样三项检查全部通过,篡改或者拍照误读就被掩盖了。抽取阶段的职责是如实抄录,判断由后面的代码做。

</details>

**4. 为什么客户发来的报错截图,检索效果比客户自己描述问题还好?**

<details><summary>答案</summary>

截图里有精确的错误码和原文(E1043、「无法解析文件」),而客户描述时往往只说「导入失败」,丢掉了最有区分度的信息。今天实测「导入银行流水失败」检索到的第一名是 E1042 那篇,是错的;用截图读出来的检索词,第一名是正确的 E1043 那篇。错误码在 BM25 里是区分度很高的词。

</details>

**5. 多模态 RAG 的两种做法各自的代价是什么?你会先选哪个?**

<details><summary>答案</summary>

做法一(图片转描述再走文本检索):成本在入库时,一张图一千 token 左右,存储和检索架构都不用改,BM25 也能用;缺点是描述里没写到的细节搜不到。做法二(ColPali 类多向量检索):不丢版面信息,对图表和复杂版面效果好;代价是每页约一千个向量,存储是普通文本块的几十倍,检索和编码都需要 GPU。先做做法一,召回率确实上不去再换。

</details>

**6.(面试题)设计一个处理客户上传附件(截图、照片、PDF)的客服 Agent 模块,说说你的处理流程、成本控制和风险控制。**

<details><summary>答案</summary>

流程:按文件类型分流,PDF 先抽文字层,为空再渲染成图;图片和扫描页交给视觉模型,输出结构化结果,「看到的原文」和「推测」分字段存;截图类附件抽出错误码和原文拼成检索词,走知识库检索;账单类附件抽出金额后用代码做算术校验并和业务库对账,不一致时转人工而不是下结论。成本:能走文字层就不走视觉;按图片类型实测选 detail;控制渲染分辨率,避免放大;只对需要的区域裁剪;入库类的描述一次性生成并缓存。风险:模型脑补(推测单独存、关键数字代码校验);PII(发外部 API 前确认数据协议,日志不存原图,设保留期,敏感文档走本地模型);国内用户数据出境合规;提示注入(图片里也可能藏着「忽略之前的指令」这类文字,图片读出来的内容一律当不可信数据,不当指令)。

</details>

## 明天预告

专题篇可以跳着读。按编号,下一篇是 **Day 137 · GraphRAG 与知识图谱:实体关系抽取、图检索与代码图**:向量检索答不好的多跳问题、全局总结问题,用知识图谱怎么解决,以及什么时候不值得上图。
