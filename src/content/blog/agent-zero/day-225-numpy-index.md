---
title: 'Day 225 · 建索引:向量存成 numpy 文件'
description: '把 Day 224 的 42 块编码成 (42, 1024) 的数组,用 np.save 存进 index/vectors.npy,块的文字和元数据存进 chunks.json,再写一个带检查的 load_index()。中间踩两个坑:np.save 会自动补 .npy 后缀,两个文件不是同一次建的时候检索会安静地取错块。'
pubDate: 2026-10-22
regime: none
tags: ['rag', 'numpy', 'embedding', 'python', 'agent-zero']
series: 'agent-zero'
day: 225
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 224](/blog/agent-zero/day-224-chunking/) 把 `data/kb/` 的 20 篇帮助中心文章切成了 42 块:按 `##` 小节切,每块开头拼上「文章标题 > 小节标题」,太长的小节再按长度切并留重叠。最后得到 `part04/chunking.py`,`load_chunks()` 返回 42 个 `Chunk`,每个带 `id`、`doc_id`、`title`、`category`、`section`、`text` 六个字段。

[Day 221](/blog/agent-zero/day-221-why-rag/) 讲过 RAG 有两条流水线,索引线负责「切块、编码、存起来」。前两步已经有了,今天做第三步:把 42 块的向量和文字存成文件,让查询线以后每次启动直接读文件,不用再切一遍、编码一遍。Day 221 的 `toy_index.py` 是 6 篇小文章的玩具版,今天是正式版。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 `np.save` / `np.load` 存取一个 numpy 数组,说出 `.npy` 文件里装了什么(文件头记形状和类型,后面是原始字节),能用「128 + 行数 × 维度 × 4」算出文件大小。
2. 说出为什么向量存 `.npy`、文字存 JSON,而不是全存 JSON:实测同样 42 × 1024 个数,`.npy` 172 KB、JSON 953 KB,读一次 0.23 毫秒对 36 毫秒。
3. 写出 `part04/build_index.py`:`load_chunks()` → `embed()` → `index/vectors.npy` + `index/chunks.json`,并写一个 `load_index()`,读回来时检查模型名和行数,两个文件对不上就报错。
4. 知道两个安静的坑:`np.save` 自动补后缀,`np.load` 不补;向量和块不是同一次建的,检索不报错却会取错块。

预计用时 2 小时:`.npy` 格式和两个小实验 40 分钟,`Chunk` 和 JSON 互转 20 分钟,`build_index.py` 30 分钟,剩下做练习。前置:[Day 224](/blog/agent-zero/day-224-chunking/) 的 `part04/chunking.py`,[Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py`(`embed`、`embed_one`、`usage`、`EMB_MODEL`),[Day 214](/blog/agent-zero/day-214-numpy-basics/) 的 numpy 数组,[Day 218](/blog/agent-zero/day-218-sim-matrix/) 的相似度矩阵,[Day 39](/blog/agent-zero/day-039-json/) 的 JSON,[Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass。

实跑花费:embedding 走硅基流动的 `BAAI/bge-m3`,免费;今天不调大模型。正文和练习一共建了一次正式索引(5 次请求、2219 个 token)、发了两次单条查询,API 花费 0 元。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `build_index()` 和 `load_index()`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 索引到底是什么

先把名字说清楚。**索引**(index)在这里指「为了快速查找,提前算好、存起来的东西」。前端里最像的是打包产物:`npm run build` 把源码处理一遍,生成 `dist/`,线上只读 `dist/`,不会每个请求都重新编译一次 TypeScript。我们的索引也一样,源头是 `data/kb/` 的 Markdown,产物是 `index/` 目录下的两个文件,查询线只读产物。

为什么非要存下来?算一下不存的代价。查询线每次启动都要 `load_chunks()` 切 20 篇,再把 42 块发给 embedding 服务编码,5 次请求,网络好的时候也要一两秒。真实知识库有几万块,每启动一次就编码几万块,又慢又费钱(Day 220 算过这笔账)。而这些向量只在文章变了的时候才会变,所以算一次、存起来,文章改了再重建。

存成什么样?向量是一个 `(42, 1024)` 的 float32 数组,块的文字和元数据是 42 个 `Chunk`。这两样东西性质完全不同,所以存成两个文件:

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="索引目录里两个文件:vectors.npy 的第 i 行对应 chunks.json 里第 i 个块">
<rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">index/</text>
<rect x="20" y="40" width="250" height="220" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="34" y="62" fill="var(--ink)">vectors.npy  172,160 字节</text>
<text x="34" y="82" fill="var(--ink-soft)" font-size="11">头 128 字节:'&lt;f4' (42, 1024)</text>
<rect x="34" y="94" width="222" height="26" fill="none" stroke="var(--ink-faint)"/>
<text x="42" y="112" fill="var(--ink)" font-size="11">第 0 行 [-0.055 -0.039 …] 1024 个</text>
<rect x="34" y="124" width="222" height="26" fill="none" stroke="var(--ink-faint)"/>
<text x="42" y="142" fill="var(--ink)" font-size="11">第 1 行 [ … ]</text>
<text x="140" y="172" fill="var(--ink-faint)" text-anchor="middle">⋮</text>
<rect x="34" y="216" width="222" height="26" fill="none" stroke="var(--ink-faint)"/>
<text x="42" y="234" fill="var(--ink)" font-size="11">第 41 行 [ … ]</text>
<rect x="370" y="40" width="250" height="220" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="384" y="62" fill="var(--ink)">chunks.json  14,771 字节</text>
<text x="384" y="82" fill="var(--ink-soft)" font-size="11">model / dim / count / built_at …</text>
<rect x="384" y="94" width="222" height="26" fill="none" stroke="var(--ink-faint)"/>
<text x="392" y="112" fill="var(--ink)" font-size="11">chunks[0]  kb-001#1</text>
<rect x="384" y="124" width="222" height="26" fill="none" stroke="var(--ink-faint)"/>
<text x="392" y="142" fill="var(--ink)" font-size="11">chunks[1]  kb-001#2</text>
<text x="490" y="172" fill="var(--ink-faint)" text-anchor="middle">⋮</text>
<rect x="384" y="216" width="222" height="26" fill="none" stroke="var(--ink-faint)"/>
<text x="392" y="234" fill="var(--ink)" font-size="11">chunks[41] kb-020#2</text>
<line x1="256" y1="107" x2="384" y2="107" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<line x1="256" y1="137" x2="384" y2="137" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<line x1="256" y1="229" x2="384" y2="229" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="320" y="190" fill="var(--ink-soft)" text-anchor="middle" font-size="11">靠下标对齐</text>
<text x="320" y="280" fill="var(--ink-soft)" text-anchor="middle" font-size="11">两个文件必须同一次生成;load_index() 读回时核对模型名和行数</text>
</g>
</svg>
<figcaption>蓝色是给数学用的(只有数字,算余弦时整块拿去做矩阵乘法),琥珀色是给人和大模型用的(文字、编号、标题)。两边没有任何字段互相指向,全靠「第 i 行 ↔ 第 i 块」这个顺序。大小是今天实测的。</figcaption>
</figure>

这张图里最要紧的是那几条虚线:两个文件之间没有「外键」,对应关系只靠顺序。这既是它简单的原因,也是今天第二个坑的来源。

## 第一步:np.save 和 np.load

今天第一个新东西是 **`.npy` 文件**:numpy 自己的二进制格式,专门存一个数组。**二进制**的意思是文件里直接放数字在内存里的原始字节,不像 JSON 那样把每个数字写成一串字符。先用一个 2 行 3 列的小数组看清楚它长什么样。

在 `agent-zero-lab/` 下新建 `part04/npy_first.py`:

```python
# agent-zero-lab/part04/npy_first.py
from pathlib import Path

import numpy as np

OUT = Path("part04/tmp_npy")
OUT.mkdir(exist_ok=True)

a = np.array([[0.6, 0.8, 0.0], [0.0, 0.6, 0.8]], dtype=np.float32)
np.save(OUT / "small.npy", a)

b = np.load(OUT / "small.npy")
print("读回来:", b.shape, b.dtype)
print(b)
print("和原来一样吗:", np.array_equal(a, b))

size = (OUT / "small.npy").stat().st_size
print("文件大小:", size, "字节 = 头", size - a.nbytes, "+ 数据", a.nbytes)
print("文件开头:", (OUT / "small.npy").read_bytes()[:70])
```

<div class="line-notes">

- `OUT = Path("part04/tmp_npy")` 今天几个小实验的临时目录,做完可以整个删掉。路径是相对的,所以要在 `agent-zero-lab/` 根目录运行。
- `OUT.mkdir(exist_ok=True)` 建目录,已存在不报错(Day 221 用过)。
- `a = np.array([[0.6, 0.8, 0.0], [0.0, 0.6, 0.8]], dtype=np.float32)` 两行,每行长度正好是 1(0.6² + 0.8² = 1),就像两个归一化过的小向量。`dtype=np.float32` 指定每个数用 4 字节的浮点数存,和 `embed()` 返回的类型一样。
- `np.save(OUT / "small.npy", a)` 把数组写进文件。第一个参数是路径,第二个是数组。相当于 Node 里 `fs.writeFileSync(path, buffer)`,只是 numpy 会先在前面加一段文件头。
- `b = np.load(OUT / "small.npy")` 读回来,得到一个新的数组。不需要告诉它形状和类型,文件头里都记着。
- `print("读回来:", b.shape, b.dtype)` 实测 `(2, 3) float32`,和存进去时一样。
- `np.array_equal(a, b)` 形状一样、每个数都一样才返回 `True`。实测 `True`,存取是无损的。
- `size = (OUT / "small.npy").stat().st_size` `stat()` 拿文件信息,`.st_size` 是字节数,相当于 Node 的 `fs.statSync(p).size`。实测 152。
- `size - a.nbytes` `a.nbytes` 是数组数据本身占的字节数:2 × 3 × 4 = 24。152 − 24 = 128,就是文件头。
- `(OUT / "small.npy").read_bytes()[:70]` 按字节读整个文件,取前 70 个字节看看。`read_bytes` 返回 `bytes`,打印时前面有个 `b`。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.npy_first
```

真实输出:

```text
读回来: (2, 3) float32
[[0.6 0.8 0. ]
 [0.  0.6 0.8]]
和原来一样吗: True
文件大小: 152 字节 = 头 128 + 数据 24
文件开头: b"\x93NUMPY\x01\x00v\x00{'descr': '<f4', 'fortran_order': False, 'shape': (2, 3), } "
```

最后一行就是 `.npy` 的全部秘密。开头 `\x93NUMPY` 是一个「魔数」,让程序一眼认出这是 numpy 文件(PNG 文件开头也有一个类似的 `\x89PNG`);接着是版本号和头的长度;然后是一段几乎能直接读懂的文字:`'descr': '<f4'` 表示小端序(`<`)的 4 字节浮点数(`f4`,即 float32),`'shape': (2, 3)` 是形状。头后面用空格补齐到 128 字节,再往后就是 24 个字节的原始数据,没有逗号、没有换行。

所以用 Zed 打开 `.npy` 只能看到乱码,这是正常的,它本来就不是给人看的。要看内容就用 `np.load`。文件大小可以直接算:**128 + 行数 × 列数 × 4**。42 块 × 1024 维就是 128 + 172,032 = 172,160 字节,Day 220 和 Day 221 都这样算过。

## 为什么不全存 JSON

你可能会想:`chunks.json` 本来就要写,干脆把向量也塞进去,一个文件多省事。Day 39 学的 `json.dumps` 也能存列表套列表。别猜,量一下。

新建 `part04/npy_vs_json.py`。为了不花钱,这里用随机数代替真向量,形状和类型和真索引一模一样:

```python
# agent-zero-lab/part04/npy_vs_json.py
import json
import time
from pathlib import Path

import numpy as np

OUT = Path("part04/tmp_npy")
OUT.mkdir(exist_ok=True)

rng = np.random.default_rng(0)
vecs = rng.standard_normal((42, 1024)).astype(np.float32)
vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)

np.save(OUT / "v32.npy", vecs)
np.save(OUT / "v64.npy", vecs.astype(np.float64))
(OUT / "v.json").write_text(json.dumps(vecs.tolist()), encoding="utf-8")

for name in ["v32.npy", "v64.npy", "v.json"]:
    print(f"{name:<8} {(OUT / name).stat().st_size:>9,} 字节")

t = time.perf_counter()
for _ in range(100):
    np.load(OUT / "v32.npy")
t_npy = (time.perf_counter() - t) / 100

t = time.perf_counter()
for _ in range(100):
    np.array(json.loads((OUT / "v.json").read_text(encoding="utf-8")), dtype=np.float32)
t_json = (time.perf_counter() - t) / 100
print(f"读一次: npy {t_npy * 1000:.2f} 毫秒, json {t_json * 1000:.2f} 毫秒")
```

<div class="line-notes">

- `rng = np.random.default_rng(0)` 一个随机数生成器,种子是 0,所以每次跑出来的随机数都一样,你的结果能和我对上。
- `vecs = rng.standard_normal((42, 1024)).astype(np.float32)` 42 行 1024 列的随机数。`standard_normal` 默认给 float64(8 字节),`.astype(np.float32)` 转成 4 字节的,和真向量一致。
- `vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)` 每行除以自己的长度,归一化成长度 1(Day 215 和 Day 217 的写法)。这样它在各方面都和 `embed()` 的输出一样,只是数字没有意义。
- `np.save(OUT / "v64.npy", vecs.astype(np.float64))` 对照组:同样的数存成 8 字节的 float64。
- `json.dumps(vecs.tolist())` numpy 数组不能直接 `json.dumps`,要先 `.tolist()` 变成 Python 的列表套列表。每个数会写成 `-0.012345678...` 这样一长串字符。
- `print(f"{name:<8} {(OUT / name).stat().st_size:>9,} 字节")` `:>9,` 右对齐占 9 格,并用逗号分千位。
- `t = time.perf_counter()` 高精度计时器,相当于浏览器的 `performance.now()`,只是单位是秒。
- `for _ in range(100):` 读 100 次取平均,单次太快量不准。`_` 表示这个循环变量用不到。
- `t_npy = (time.perf_counter() - t) / 100` 平均每次多少秒。
- `np.array(json.loads(` JSON 那边要读文本、解析成列表、再变回数组,三步。

</div>

```bash
uv run python -m part04.npy_vs_json
```

真实输出:

```text
v32.npy    172,160 字节
v64.npy    344,192 字节
v.json     953,042 字节
读一次: npy 0.23 毫秒, json 36.39 毫秒
```

同样 43,008 个数,JSON 是 `.npy` 的 5.5 倍大,读起来慢 150 多倍。原因不复杂:`.npy` 的每个数固定 4 字节,读的时候整块拷进内存就是数组;JSON 每个数要写成十几个字符,读的时候要一个字符一个字符地解析,再一个个转回浮点数。42 块时 36 毫秒还无所谓,到了 4 万块就是半分钟。

float64 那一行也值得记住:同样的数,类型从 4 字节换成 8 字节,文件就翻倍,内存也翻倍,而 embedding 用 float32 的精度完全够。我们的 `embed()` 里写了 `dtype=np.float32`,就是为了这个。如果你自己写 `np.array(一个 Python 列表)` 又忘了写 `dtype`,numpy 默认给的是 float64。

文字和元数据就不一样了:每块几十到两百个字,字段名有意义,还希望人能直接打开看。这些放 JSON 正合适。所以分工是:**数字给 `.npy`,文字给 JSON**。

## 故意踩坑:np.save 自己补后缀

这个坑我自己踩过。新建 `part04/npy_suffix.py`,存的时候路径不写 `.npy`:

```python
# agent-zero-lab/part04/npy_suffix.py
from pathlib import Path

import numpy as np

OUT = Path("part04/tmp_npy")
a = np.ones((2, 3), dtype=np.float32)

np.save(OUT / "vectors", a)
print("目录里有:", sorted(p.name for p in OUT.iterdir()))
np.load(OUT / "vectors")
```

<div class="line-notes">

- `a = np.ones((2, 3), dtype=np.float32)` 一个全是 1 的小数组,内容不重要。
- `np.save(OUT / "vectors", a)` 路径没有后缀。`np.save` 的规矩是:文件名不以 `.npy` 结尾,就**自动补上** `.npy`。
- `sorted(p.name for p in OUT.iterdir())` `iterdir()` 列出目录里的每个文件,相当于 Node 的 `fs.readdirSync`;只取文件名并排序。
- `np.load(OUT / "vectors")` 读的时候也不写后缀。`np.load` **不会**帮你补。

</div>

```bash
uv run python -m part04.npy_suffix
```

真实输出:

```text
目录里有: ['small.npy', 'v.json', 'v32.npy', 'v64.npy', 'vectors.npy']
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File "/Users/你/agent-zero-lab/part04/npy_suffix.py", line 11, in <module>
    np.load(OUT / "vectors")
  File "/Users/你/agent-zero-lab/.venv/lib/python3.12/site-packages/numpy/lib/_npyio_impl.py", line 454, in load
    fid = stack.enter_context(open(os.fspath(file), "rb"))
                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^
FileNotFoundError: [Errno 2] No such file or directory: 'part04/tmp_npy/vectors'
```

目录里明明有 `vectors.npy`,报错却说找不到 `vectors`。存和读不对称:存的时候补,读的时候不补。读报错的方式是 Day 36 学过的 `FileNotFoundError`,看最后一行就够了,中间那些 `site-packages` 里的行是 numpy 内部的调用链,不用管。修法很简单,**存和读都把 `.npy` 写全**,两边一眼就能对上。

做完这三个小实验,临时目录可以删掉:

```bash
rm -r part04/tmp_npy
```

## 第二步:Chunk 和 JSON 互相转换

向量的事解决了,再看文字那半边。`chunks.json` 要存 42 个 `Chunk`,读回来时最好还是 `Chunk`,这样查询线可以继续写 `c.id`、`c.title`,编辑器也能提示字段名。这里有一个小坑和一个新写法。新建 `part04/chunk_json.py`:

```python
# agent-zero-lab/part04/chunk_json.py
import json
from dataclasses import asdict

from part04.chunking import Chunk, load_chunks

chunks = load_chunks()
c = chunks[4]

try:
    json.dumps(c)
except TypeError as e:
    print("直接 dumps:", e)

d = asdict(c)
s = json.dumps(d, ensure_ascii=False)
print("asdict 以后:", s[:60], "…")

back = Chunk(**json.loads(s))
print("还原回来:", type(back).__name__, back.id)
print("和原来相等吗:", back == c)
```

<div class="line-notes">

- `from part04.chunking import Chunk, load_chunks` Day 224 的模块。这次除了函数,还要拿 `Chunk` 这个类,读回来时要用它重建对象。
- `c = chunks[4]` 第 5 块,实测是 `kb-002#3`(《退款政策》的「重复扣款」)。kb-001 有两块,kb-002 从第 3 块开始。
- `json.dumps(c)` 直接把 dataclass 对象交给 `json.dumps`。JS 里 `JSON.stringify(任何对象)` 都能出点东西,Python 的 `json` 只认 dict、list、str、数字、布尔和 None 这几种。
- `except TypeError as e:` 实测报 `Object of type Chunk is not JSON serializable`。
- `d = asdict(c)` Day 224 用过的 `asdict`,把对象变成普通字典,六个字段六个键。
- `s = json.dumps(d, ensure_ascii=False)` 这回可以了。`ensure_ascii=False` 让中文原样写出。
- `back = Chunk(**json.loads(s))` 先 `json.loads` 变回字典,再用 `**` 把字典**拆成关键字参数**传给 `Chunk`。`Chunk(**{"id": "kb-002#3", "doc_id": "kb-002", ...})` 等于 `Chunk(id="kb-002#3", doc_id="kb-002", ...)`。[Day 30](/blog/agent-zero/day-030-functions-3/) 讲过函数定义里的 `**kwargs` 是「收集」,这里用在调用处是反过来「展开」,有点像 JS 的 `{...obj}` 展开到参数里。
- `type(back).__name__` 对象的类名,实测 `Chunk`,说明真的变回了 dataclass,不是字典。
- `back == c` dataclass 自动生成的 `==` 会逐个字段比较。实测 `True`。

</div>

```bash
uv run python -m part04.chunk_json
```

真实输出:

```text
直接 dumps: Object of type Chunk is not JSON serializable
asdict 以后: {"id": "kb-002#3", "doc_id": "kb-002", "title": "退款政策", "cat …
还原回来: Chunk kb-002#3
和原来相等吗: True
```

存的方向是 `asdict` → `json.dumps`,读的方向是 `json.loads` → `Chunk(**d)`。这个来回很常见,以后存会话记录、存评测结果都是同一个套路。`Chunk(**d)` 还有一个顺带的好处:如果 JSON 里少了一个字段或多了一个字段,它会直接报 `TypeError`,不会悄悄建出一个缺字段的对象。

## 拼起来:part04/build_index.py

零件齐了。今天的第二个知识点是把 `load_chunks()` 接到索引线上:切块、编码、存两个文件,外加一个读回来的函数。新建 `part04/build_index.py`,这是明天 `rag_numpy.py` 要 import 的模块:

```python
# agent-zero-lab/part04/build_index.py
"""索引线:切块 → embedding → 存进 index/。文章或切块参数变了就重跑。"""
import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from common.embed import EMB_MODEL, embed, usage
from part04.chunking import Chunk, load_chunks

INDEX = Path("index")


def build_index(out: Path = INDEX, max_chars: int = 300, overlap: int = 50) -> tuple[list[Chunk], np.ndarray]:
    chunks = load_chunks(max_chars, overlap)
    if not chunks:
        raise ValueError("一块都没切出来,先检查 data/kb/ 和 chunking.py")
    vectors = embed([c.text for c in chunks])
    out.mkdir(exist_ok=True)
    np.save(out / "vectors.npy", vectors)
    meta = {
        "model": EMB_MODEL,
        "dim": int(vectors.shape[1]),
        "count": len(chunks),
        "max_chars": max_chars,
        "overlap": overlap,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "chunks": [asdict(c) for c in chunks],
    }
    (out / "chunks.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return chunks, vectors


def load_index(index_dir: Path = INDEX) -> tuple[list[Chunk], np.ndarray]:
    meta_path = index_dir / "chunks.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"{index_dir}/ 里没有索引,先跑 uv run python -m part04.build_index")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    vectors = np.load(index_dir / "vectors.npy")
    chunks = [Chunk(**d) for d in meta["chunks"]]
    if meta["model"] != EMB_MODEL:
        raise ValueError(f"索引是用 {meta['model']} 建的,现在配置的是 {EMB_MODEL},先重建索引")
    if vectors.shape != (len(chunks), meta["dim"]):
        raise ValueError(
            f"vectors.npy 是 {vectors.shape},chunks.json 有 {len(chunks)} 块,两个文件不是同一次建的,先重建索引"
        )
    return chunks, vectors


if __name__ == "__main__":
    chunks, vectors = build_index()
    print(f"建好:{len(chunks)} 块,向量 {vectors.shape} {vectors.dtype}")
    print(f"embedding {usage['requests']} 次请求,{usage['tokens']} token")
    for name in ["vectors.npy", "chunks.json"]:
        print(f"  {INDEX / name}  {(INDEX / name).stat().st_size:,} 字节")
    chunks2, vectors2 = load_index()
    print(f"读回:{len(chunks2)} 块,第 0 行是 {chunks2[0].id},第 41 行是 {chunks2[41].id}")
    best = (vectors2 @ vectors2.T).argmax(axis=1)
    print("每一块最像的都是它自己:", bool((best == np.arange(len(chunks2))).all()))
```

<div class="line-notes">

- `from datetime import datetime, timezone` 标准库里处理日期时间的模块,今天只用它记一下「索引是什么时候建的」。
- `from common.embed import EMB_MODEL, embed, usage` 三样都是 Day 217 的:`EMB_MODEL` 是模型名常量(实测 `BAAI/bge-m3`),要写进索引;`usage` 是记请求次数和 token 的字典。`usage` 是一个字典,`embed()` 往里面加数,我们拿到的是同一个字典,所以能看到最新的值。
- `INDEX = Path("index")` 索引放在 `agent-zero-lab/index/`,和 `data/` 平级。`data/` 是源头,`index/` 是产物,和前端项目里 `src/` 与 `dist/` 的关系一样,`index/` 随时可以删掉重建。
- `def build_index(out: Path = INDEX, max_chars: int = 300, overlap: int = 50)` 三个参数都有默认值。切块参数透传给 `load_chunks`,Day 224 说过块大小是要测的参数,所以这里也留着口子。返回值是 `(块列表, 向量数组)` 两个东西。
- `chunks = load_chunks(max_chars, overlap)` 实测 42 块。
- `if not chunks:` Day 224 的教训:忘了 `re.M` 时 `load_chunks()` 安静地返回空列表。空列表再往下走,`embed([])` 返回 `(0, 1024)`,会建出一个空索引。在这里挡住,报一个看得懂的错。
- `vectors = embed([c.text for c in chunks])` 把 42 块的 `text`(带「标题 > 小节」前缀的那个)按顺序取出来编码。`EMB_BATCH=10`,实际发 5 次请求(10+10+10+10+2),返回 `(42, 1024)`,每行已经归一化。**第 i 行对应 `chunks[i]`** 就是在这一行定下来的。
- `out.mkdir(exist_ok=True)` 建 `index/` 目录。
- `np.save(out / "vectors.npy", vectors)` 后缀写全。实测 172,160 字节。
- `meta = {` 除了块,还存几样「这份索引是怎么来的」:用哪个模型、几维、几块、切块参数、建造时间。以后出问题时,这些就是线索。
- `"dim": int(vectors.shape[1]),` 维度 1024。`vectors.shape[1]` 是 numpy 的整数类型,`json.dumps` 不认,`int(...)` 转成普通 Python 整数。这种「numpy 的数不能直接进 JSON」的坑和上面 `.tolist()` 是同一类。
- `"built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),` 当前的 UTC 时间,转成 `2026-10-22T11:18:01+00:00` 这种标准格式字符串,相当于 JS 的 `new Date().toISOString()`。`timespec="seconds"` 只保留到秒。
- `"chunks": [asdict(c) for c in chunks],` 上一步的存法,42 个字典。
- `json.dumps(meta, ensure_ascii=False, indent=1)` `indent=1` 缩进一个空格,人能看清结构,文件也不会太大。实测 14,771 字节。
- `def load_index(index_dir: Path = INDEX) -> tuple[list[Chunk], np.ndarray]:` 查询线用的入口。参数能改目录,下面的踩坑实验会用到。
- `if not meta_path.exists():` 没建过索引就来查,给一句告诉你该干什么的报错,比 numpy 那一长串 `FileNotFoundError` 好懂。
- `vectors = np.load(index_dir / "vectors.npy")` 读回 `(42, 1024)` float32。
- `chunks = [Chunk(**d) for d in meta["chunks"]]` 每个字典还原成 `Chunk`。
- `if meta["model"] != EMB_MODEL:` Day 217 的铁律、Day 221 玩具版已经有的检查:索引和查询必须用同一个模型。
- `if vectors.shape != (len(chunks), meta["dim"]):` 新加的检查。形状 `(42, 1024)` 是一个元组,可以直接和元组比较。行数对不上,说明两个文件不是同一次生成的。
- `chunks, vectors = build_index()` 用默认参数建一次。
- `print(f"embedding {usage['requests']} 次请求` 实测 5 次、2219 个 token。
- `chunks2, vectors2 = load_index()` 刚建完马上读回来,确认读写对得上。
- `best = (vectors2 @ vectors2.T).argmax(axis=1)` [Day 218](/blog/agent-zero/day-218-sim-matrix/) 的相似度矩阵:`(42, 1024) @ (1024, 42)` 得到 `(42, 42)`,第 i 行第 j 列是第 i 块和第 j 块的余弦。`argmax(axis=1)` 找出每一行最大值在哪一列。
- `(best == np.arange(len(chunks2))).all()` `np.arange(42)` 是 `[0, 1, …, 41]`。每块和自己的余弦是 1,一定最大,所以 `best` 应该正好等于 `[0, 1, …, 41]`。这是一个很便宜的自检:如果存的时候行被打乱了,或者有一行是空的,这里会变成 `False`。实测 `True`。

</div>

```bash
uv run python -m part04.build_index
ls -la index
```

真实输出:

```text
建好:42 块,向量 (42, 1024) float32
embedding 5 次请求,2219 token
  index/vectors.npy  172,160 字节
  index/chunks.json  14,771 字节
读回:42 块,第 0 行是 kb-001#1,第 41 行是 kb-020#2
每一块最像的都是它自己: True
total 376
drwxr-xr-x   4 你  wheel       128 22 Oct 19:18 .
drwxr-xr-x  11 你  wheel       352 22 Oct 19:18 ..
-rw-r--r--   1 你  wheel     14771 22 Oct 19:18 chunks.json
-rw-r--r--   1 你  wheel    172160 22 Oct 19:18 vectors.npy
```

`vectors.npy` 172,160 字节,和前面算的一个字节都不差。`chunks.json` 能直接用 Zed 打开,开头是这样的:

```text
{
 "model": "BAAI/bge-m3",
 "dim": 1024,
 "count": 42,
 "max_chars": 300,
 "overlap": 50,
 "built_at": "2026-10-22T11:18:01+00:00",
 "chunks": [
  {
   "id": "kb-001#1",
   "doc_id": "kb-001",
   "title": "套餐与价格",
   "category": "套餐与计费",
   "section": "三种套餐",
   "text": "套餐与价格 > 三种套餐\nCloudLedger 提供免费版、专业版和企业版三种套餐。……"
```

这就是我们的「向量数据库」:一个数组加一个 JSON。看着简陋,但几千块以内它比任何数据库都快,因为整个矩阵就在内存里,查询时一次矩阵乘法就算完所有块(明天就做)。块数涨到几十万、要多人同时写、要按分类过滤时,它才开始不够用,那是 [Day 228](/blog/agent-zero/day-228-postgres-basics/) 起换 Postgres 和 pgvector 的理由。

和 Day 221 的玩具版对比,正式版多了三样东西:块是 `Chunk` 而不是一句话,所以存的是六个字段;元数据多了维度、块数、切块参数和时间;读回来的时候多了行数检查。为什么行数检查值得单独加,看下一节。

零件和大代码的对应关系:

| 零件(今天的小脚本) | 在 `build_index.py` 的哪一段 |
| --- | --- |
| `npy_first.py` 的 `np.save` / `np.load` | `build_index` 的 `np.save(...)`,`load_index` 的 `np.load(...)` |
| `npy_vs_json.py` 的结论 | 向量进 `.npy`、块进 `chunks.json` 的分工 |
| `npy_suffix.py` 的教训 | 两处路径都写全 `vectors.npy` |
| `chunk_json.py` 的 `asdict` / `Chunk(**d)` | `"chunks": [asdict(c) ...]` 和 `[Chunk(**d) for d in ...]` |
| Day 221 `toy_query.py` 的模型检查 | `if meta["model"] != EMB_MODEL` |
| Day 224 「切完数一下块数」 | `if not chunks:` |

## 故意踩坑:两个文件不是同一次建的

想象这个场景:你在 Day 224 练习 1 里把切块参数改成了 `(100, 20)`,想看看块小一点效果怎样。你写了个小脚本只把新的块写进 `chunks.json`,心想向量反正「差不多」,或者重建到一半网络断了,`chunks.json` 写好了、`vectors.npy` 还是旧的。会发生什么?

新建 `part04/index_mismatch.py`,在一份索引的**副本**上模拟这件事,不碰真正的 `index/`:

```python
# agent-zero-lab/part04/index_mismatch.py
import json
import shutil
from dataclasses import asdict
from pathlib import Path

import numpy as np

from common.embed import embed_one
from part04.build_index import load_index
from part04.chunking import load_chunks

TMP = Path("part04/tmp_index")
shutil.copytree("index", TMP, dirs_exist_ok=True)

meta = json.loads((TMP / "chunks.json").read_text(encoding="utf-8"))
new_chunks = load_chunks(100, 20)
meta["chunks"] = [asdict(c) for c in new_chunks]
(TMP / "chunks.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")

vectors = np.load(TMP / "vectors.npy")
scores = vectors @ embed_one("重复扣款多久能退回来")
i = int(scores.argmax())
print(f"不检查:第 {i} 行最像,分数 {scores[i]:.3f},取出来的块是 {new_chunks[i].id} {new_chunks[i].section}")

load_index(TMP)
```

<div class="line-notes">

- `import shutil` 标准库里复制、移动、删除整个目录的工具。
- `shutil.copytree("index", TMP, dirs_exist_ok=True)` 把整个 `index/` 复制成 `part04/tmp_index/`,相当于 `cp -r index part04/tmp_index`。`dirs_exist_ok=True` 让重复运行时不因目标已存在而报错。
- `new_chunks = load_chunks(100, 20)` 用小一点的参数重新切,实测 45 块(Day 224 练习 1 的数)。
- `meta["chunks"] = [asdict(c) for c in new_chunks]` 只换掉块,`vectors.npy` 还是 42 行的旧向量。
- `scores = vectors @ embed_one("重复扣款多久能退回来")` 用旧向量检索。旧向量里最像的是第 4 行,也就是当初的 `kb-002#3`「重复扣款」。
- `i = int(scores.argmax())` 最高分的行号。`argmax` 返回的是 numpy 整数,`int()` 转成普通整数,打印时干净些。
- `new_chunks[i].id` 关键在这里:拿旧向量的行号去**新的**块列表里取块。45 块的切法下,第 4 行已经不是「重复扣款」了。
- `load_index(TMP)` 同样两个文件,交给带检查的 `load_index`。

</div>

```bash
uv run python -m part04.index_mismatch
```

真实输出:

```text
不检查:第 4 行最像,分数 0.820,取出来的块是 kb-002#1 年付套餐
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File "/Users/你/agent-zero-lab/part04/index_mismatch.py", line 26, in <module>
    load_index(TMP)
  File "/Users/你/agent-zero-lab/part04/build_index.py", line 46, in load_index
    raise ValueError(
ValueError: vectors.npy 是 (42, 1024),chunks.json 有 45 块,两个文件不是同一次建的,先重建索引
```

第一行是这一课最该记住的输出。分数 0.820,看起来检索得很准,和 Day 224 测的「重复扣款」那一块一模一样;但取出来的块是「年付套餐」。为什么?切成 100 字一块以后,kb-001 的「三种套餐」被切成了 3 块(Day 224 练习 1 看到过),后面所有块的下标都往后挪了两位,第 4 行在新列表里变成了 `kb-002#1`。

这时如果接着往下走,大模型拿到的是年付规则,用户问的是重复扣款,它会认认真真地答一个错的东西,还标着出处。**没有任何报错**,分数还很好看。这就是「靠顺序对齐」的代价。

`load_index` 的形状检查把它变成了一个当场报出来的 `ValueError`。它挡不住所有情况:如果新旧两次碰巧切出一样多的块,只是内容变了,行数检查会放行。那种情况要靠更强的办法,比如在 `chunks.json` 里给每块存一个内容指纹,读回来时重新算一遍对比,Day 231 做增量更新时会用到指纹。今天先挡住最常见的一种。

真正的修法只有一条:**两个文件永远由 `build_index()` 一次性写出来**,改了文章或切块参数,就整个重跑。别手工改其中一个。做完实验删掉副本:

```bash
rm -r part04/tmp_index
```

## 动手练习

**练习 1:看看索引里装了什么。** 用 `load_index()` 读出索引,打印形状、类型、第 0 行前 5 个数、所有行长度的最小值和最大值;再找出和 `kb-012#2`(E2017 的「解决办法」)最像的另外 3 块。

<details><summary>参考答案</summary>

新建 `part04/ex_index_peek.py`:

```python
# agent-zero-lab/part04/ex_index_peek.py
import numpy as np

from part04.build_index import load_index

chunks, vectors = load_index()
ids = [c.id for c in chunks]
print("形状", vectors.shape, "类型", vectors.dtype)
print("第 0 行前 5 个数:", vectors[0, :5])
norms = np.linalg.norm(vectors, axis=1)
print(f"每行长度:最小 {norms.min():.4f},最大 {norms.max():.4f}")

row = ids.index("kb-012#2")
scores = vectors @ vectors[row]
for i in np.argsort(-scores)[1:4]:
    print(f"  和 kb-012#2 最像:{ids[i]:<9} {scores[i]:.3f}  {chunks[i].title} > {chunks[i].section}")
```

<div class="line-notes">

- `ids = [c.id for c in chunks]` 42 个块编号排成列表,下标和向量的行号一致。
- `vectors[0, :5]` 第 0 行(`kb-001#1`)的前 5 个数。Day 214 学的二维切片:逗号前选行,逗号后选列。
- `norms = np.linalg.norm(vectors, axis=1)` 每一行的长度,得到 42 个数。
- `row = ids.index("kb-012#2")` 列表的 `.index()` 返回元素第一次出现的下标,相当于 JS 的 `indexOf`,找不到时直接报 `ValueError`(JS 返回 -1)。实测 24。
- `scores = vectors @ vectors[row]` 拿第 24 行当「问题」,和全部 42 行算余弦。
- `for i in np.argsort(-scores)[1:4]:` 从高到低排,`[1:4]` 跳过第 0 名(它自己,分数 1),取第 2 到第 4 名。

</div>

```bash
uv run python -m part04.ex_index_peek
```

真实输出:

```text
形状 (42, 1024) 类型 float32
第 0 行前 5 个数: [-0.0552498  -0.03916057 -0.06101763 -0.03384809  0.00474329]
每行长度:最小 1.0000,最大 1.0000
  和 kb-012#2 最像:kb-012#1  0.894  错误码 E2017:发票识别失败 > 原因
  和 kb-012#2 最像:kb-010#2  0.746  错误码 E1042:银行流水导入失败 > 解决办法
  和 kb-012#2 最像:kb-013#2  0.709  错误码 E3001:支付失败 > 解决办法
```

每行长度都是 1,说明存进去的确实是 `embed()` 归一化过的向量,读回来没变。和 E2017「解决办法」最像的,第一是同一篇的「原因」,接着是另外两篇错误码文章的「解决办法」:前缀里都有「错误码」,小节名也一样。这正是 Day 222 埋的考点,问题问得含糊时,检索很可能在这几块之间搞混。

</details>

**练习 2:换个模型读索引会怎样?** 用临时环境变量把 `EMB_MODEL` 换成 `BAAI/bge-large-zh-v1.5`,调用 `load_index()`,看报什么错、退出码是多少。不用重建索引。

<details><summary>参考答案</summary>

不用写文件,`python -c` 直接跑一行:

```bash
EMB_MODEL=BAAI/bge-large-zh-v1.5 uv run python -c "from part04.build_index import load_index; load_index()"
echo "exit=$?"
```

真实输出(只留最后一行报错):

```text
ValueError: 索引是用 BAAI/bge-m3 建的,现在配置的是 BAAI/bge-large-zh-v1.5,先重建索引
exit=1
```

命令前面的 `EMB_MODEL=...` 只对这一条命令生效,`load_dotenv()` 不会覆盖已经存在的环境变量(Day 221 用过)。`common.embed` 导入时读到的 `EMB_MODEL` 变成了 bge-large,和 `chunks.json` 里记的 bge-m3 不一样,`load_index` 拒绝工作。没被捕获的异常会让 Python 以退出码 1 结束。这里根本没发 embedding 请求,检查发生在查询之前,0 元。

</details>

**练习 3:不读向量,只看索引的「身份证」。** 写一个只读 `chunks.json` 的脚本:打印模型、维度、块数、切块参数、建造时间,再统计每篇文章各有几块,找出块最多的文章和只有 1 块的文章。

<details><summary>参考答案</summary>

新建 `part04/ex_index_info.py`:

```python
# agent-zero-lab/part04/ex_index_info.py
import json
from pathlib import Path

meta = json.loads(Path("index/chunks.json").read_text(encoding="utf-8"))
print(f"模型 {meta['model']}  维度 {meta['dim']}  {meta['count']} 块  切块参数 {meta['max_chars']}/{meta['overlap']}")
print("建于", meta["built_at"])

per_doc: dict[str, int] = {}
for c in meta["chunks"]:
    per_doc[c["doc_id"]] = per_doc.get(c["doc_id"], 0) + 1
most = max(per_doc, key=lambda k: per_doc[k])
print(f"{len(per_doc)} 篇文章,块最多的是 {most}({per_doc[most]} 块)")
print("只有 1 块的:", [d for d, n in per_doc.items() if n == 1])
```

<div class="line-notes">

- `meta = json.loads(Path("index/chunks.json").read_text(encoding="utf-8"))` 只读 JSON,不碰 `.npy`,也不 import `common.embed`,所以不需要 `.env`,飞快。
- `per_doc: dict[str, int] = {}` 文章编号 → 块数。
- `per_doc[c["doc_id"]] = per_doc.get(c["doc_id"], 0) + 1` 计数的老写法:没出现过就当 0,再加 1(Day 24 的 `get` 带默认值)。这里的 `c` 是字典,不是 `Chunk`,所以用 `c["doc_id"]`。
- `most = max(per_doc, key=lambda k: per_doc[k])` 对字典的键求最大,比较的依据是 `per_doc[k]`。`key=` 和 Day 30 的 lambda 一起用,相当于 JS 里手写一个按值比较的 reduce。
- `[d for d, n in per_doc.items() if n == 1]` 带条件的列表推导式,挑出只有 1 块的。

</div>

```bash
uv run python -m part04.ex_index_info
```

真实输出:

```text
模型 BAAI/bge-m3  维度 1024  42 块  切块参数 300/50
建于 2026-10-22T11:18:01+00:00
20 篇文章,块最多的是 kb-002(4 块)
只有 1 块的: ['kb-007']
```

20 篇都在,块最多的是《退款政策》的 4 块,只有一个小节的是 kb-007《修改发票抬头》。`built_at` 是 UTC 时间,北京时间要加 8 小时,也就是 19:18。这类只看元数据的小脚本很有用:线上出问题时,第一件事往往是确认「现在跑的是哪一版索引、什么时候建的、用的什么参数」。

</details>

**练习 4:默写 `load_index`。** 合上文章写出 `load_index()`,要有三道检查:没有索引文件、模型不一致、行数不一致。然后复制一份 `index/` 到 `part04/tmp_index/`,用 Python 删掉 `vectors.npy` 的最后一行再存回去,验证你的函数能报出行数不一致。

<details><summary>参考答案</summary>

标准答案就是 `build_index.py` 里的 `load_index`。验证脚本可以这样写,新建 `part04/ex_drop_row.py`:

```python
# agent-zero-lab/part04/ex_drop_row.py
import shutil
from pathlib import Path

import numpy as np

from part04.build_index import load_index

TMP = Path("part04/tmp_index")
shutil.copytree("index", TMP, dirs_exist_ok=True)
v = np.load(TMP / "vectors.npy")
np.save(TMP / "vectors.npy", v[:-1])
try:
    load_index(TMP)
except ValueError as e:
    print("挡住了:", e)
shutil.rmtree(TMP)
```

<div class="line-notes">

- `np.save(TMP / "vectors.npy", v[:-1])` `v[:-1]` 是除最后一行以外的所有行,形状 `(41, 1024)`,覆盖写回副本。
- `except ValueError as e:` 预期行数检查抛出 `ValueError`。
- `shutil.rmtree(TMP)` 删掉整个临时目录,相当于 `rm -r`。

</div>

```bash
uv run python -m part04.ex_drop_row
```

真实输出:

```text
挡住了: vectors.npy 是 (41, 1024),chunks.json 有 42 块,两个文件不是同一次建的,先重建索引
```

默写时最常见的漏洞是把检查写成 `len(vectors) != meta["count"]`:它比的是向量行数和 JSON 里记的 `count`,而 `count` 和 `chunks` 列表本身也可能不一致(比如有人只改了 `chunks`)。直接拿 `len(chunks)` 比更稳,因为后面真正要按下标去取的就是 `chunks`。

</details>

**验收标准:** `npy_first.py` 输出「头 128 + 数据 24」;能用 128 + 行数 × 维度 × 4 算出 `vectors.npy` 的大小;`npy_suffix.py` 复现 `FileNotFoundError` 并说出原因;`uv run python -m part04.build_index` 输出 42 块、`(42, 1024)`、自检 `True`;`index_mismatch.py` 能看到「分数 0.820 却取到年付套餐」,并被 `load_index` 挡住;能说出为什么向量和文字分开存。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 索引(index) | 为了快速查找而提前算好、存下来的东西。今天指 `index/` 下的向量文件和块文件,是 `data/kb/` 的产物 |
| `.npy` 文件 | numpy 存单个数组的二进制格式:128 字节左右的文件头(记类型和形状)+ 原始字节 |
| 二进制格式 | 文件里直接放数据在内存里的字节,不写成字符;文本编辑器打开是乱码 |
| `np.save(path, arr)` / `np.load(path)` | 存 / 读 `.npy`。`save` 会自动补 `.npy` 后缀,`load` 不补 |
| 魔数(magic number) | 文件开头固定的几个字节,用来认出文件类型,`.npy` 是 `\x93NUMPY` |
| `<f4` | 文件头里的类型描述:小端序、4 字节浮点数,即 float32 |
| float32 / float64 | 每个数 4 字节 / 8 字节的浮点数。embedding 用 float32 足够,float64 文件和内存都翻倍 |
| `asdict` / `Chunk(**d)` | dataclass 对象转字典 / 字典拆成关键字参数重建对象,配合 JSON 存取 |
| `**`(调用处) | 把字典展开成关键字参数,`f(**{"a": 1})` 等于 `f(a=1)` |
| 元数据(metadata) | 正文之外描述数据的信息,这里是模型名、维度、块数、切块参数、建造时间 |
| 按下标对齐 | 两份数据之间没有显式关联,只靠「第 i 个对第 i 个」对应;顺序一乱就张冠李戴 |

## 常见误区

**把向量也塞进 JSON。** 能用,但实测 42 × 1024 时 JSON 953 KB、`.npy` 172 KB,读一次 36 毫秒对 0.23 毫秒。数据一大就拖慢查询线的启动。数字给 `.npy`,文字给 JSON。

**存的时候不写 `.npy`。** `np.save("index/vectors", v)` 生成的是 `vectors.npy`,接着 `np.load("index/vectors")` 报 `FileNotFoundError`,目录里明明有文件。存和读都把后缀写全。

**忘了 dtype,存成 float64。** `np.array(一个 Python 列表)` 默认是 float64,文件和内存都翻倍。从 embedding 服务拿回来的数,转数组时写上 `dtype=np.float32`。

**`json.dumps` 一个 dataclass 或 numpy 数字。** 报 `Object of type Chunk is not JSON serializable`;numpy 的整数、数组同理。先 `asdict`、`.tolist()`、`int()`。

**只重建了一个文件。** 向量和块靠下标对齐,两个文件不是同一次建的,检索照样返回很好看的分数,取出来的却是另一块。实测 0.820 的「重复扣款」向量取出了「年付套餐」。两个文件永远由 `build_index()` 一起写,读的时候核对行数。

**改了文章或切块参数,不重建索引。** Day 221 演示过:查询线不知道资料变了,继续答旧内容,不报错。`index/` 是产物,源头一变就重跑 `build_index`。

**以为 `np.load` 读回来的东西是可信的。** 行数检查只能挡住块数变了的情况,块数碰巧一样、内容变了它放行。要更稳就存内容指纹,Day 231 讲。

## 学习资料

### 文档与文章

- [NumPy 文档 · numpy.save](https://numpy.org/doc/stable/reference/generated/numpy.save.html):看参数说明里那句「如果文件名没有 .npy 后缀,会自动加上」,今天的坑就写在官方文档里。
- [NumPy 文档 · numpy.lib.format](https://numpy.org/doc/stable/reference/generated/numpy.lib.format.html):`.npy` 格式的规范,魔数、版本号、头长度、头里那个字典,对照今天打印的文件开头看。
- [Python 文档 · dataclasses](https://docs.python.org/zh-cn/3.12/library/dataclasses.html):查 `asdict` 那一条,中文版。
- [Python 文档 · json](https://docs.python.org/zh-cn/3.12/library/json.html):查 `ensure_ascii` 和 `indent` 两个参数,还有「哪些类型能直接序列化」那张对照表。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TA411u7Y6&autoplay=0&high_quality=1" title="python numpy 常用文件格式 导出与载入(npy,npz,txt,csv,xls,xlsx,ods)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>RobotZhu · python numpy 常用文件格式 导出与载入(npy,npz,txt,csv,xls,xlsx,ods) · 11 分钟。看开头讲 npy 的部分,再看它和 txt/csv 的对比,和今天「为什么不全存 JSON」是同一个道理。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1uV411K7e5&autoplay=0&high_quality=1" title="F_库1_numpy教程_文件读取与保存" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>嘿旺子 · F_库1_numpy教程_文件读取与保存 · 22 分钟。慢节奏的入门讲解,save/load 和 savetxt/loadtxt 都演示了一遍,适合第一次接触 numpy 文件读写时看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4paHKF4bJtI" title="Saving and loading NumPy arrays is easy!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Bro Code · Saving and loading NumPy arrays is easy! · 英文,很短。把 np.save、np.load 和 npz 一口气过一遍,当今天第一节的复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/klTvEwg3oJ4" title="Vector databases are so hot right now. WTF are they?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Fireship · Vector databases are so hot right now. WTF are they? · 英文,几分钟。今天的「数组 + JSON」就是最小的向量库;看它讲真正的向量数据库还多做了什么,为 Day 228 起换 pgvector 做铺垫。</figcaption>
</figure>

### 书籍

- Wes McKinney《Python for Data Analysis》第 3 版(O'Reilly,2022),作者在 [wesmckinney.com/book](https://wesmckinney.com/book/) 免费放了全文。第 4 章 4.5 节「File Input and Output with Arrays」正好讲 `np.save` / `np.load` / `np.savez`,两页就能读完。中文版目前能买到的是机械工业出版社 2018 年的《利用 Python 进行数据分析(原书第 2 版)》,对应章节内容基本一样。
- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 6 章讲 RAG 的部分里有检索系统和向量存储的介绍,今天读讲 embedding-based retrieval 的那几页。

### 开源项目与代码

- [facebookresearch/faiss](https://github.com/facebookresearch/faiss):Meta 开源的向量检索库,本质上也是「一个 float32 矩阵 + 一堆查找方法」,它的 `IndexFlatIP` 做的事和我们明天的矩阵乘法一样。今天只看 README 了解它是什么。
- [chroma-core/chroma](https://github.com/chroma-core/chroma):一个嵌入式向量库,看它的 README 里怎么「add 文档、query」,对照我们手写的两个函数,它帮你把向量和元数据存在一起,省掉了「靠下标对齐」这件事。

## 自测

**1. `vectors.npy` 存 42 块 1024 维的 float32 向量,文件多大?如果误存成 float64 呢?**

<details><summary>答案</summary>

128 + 42 × 1024 × 4 = 172,160 字节;float64 是 128 + 42 × 1024 × 8 = 344,192 字节,今天 `npy_vs_json.py` 实测都对得上。128 是文件头,记着 `'<f4'` 和 `(42, 1024)`。

</details>

**2. 为什么向量存 `.npy`、块存 JSON,而不是全存 JSON?**

<details><summary>答案</summary>

数字存成 JSON 要把每个数写成十几个字符,读的时候再逐个解析,实测 42 × 1024 时 JSON 953 KB、读一次 36 毫秒,`.npy` 172 KB、0.23 毫秒。块的文字和元数据字段名有意义、希望人能直接打开看,而且量不大,适合 JSON。按用途分开:数字给矩阵运算,文字给人和大模型。

</details>

**3. `np.save("index/vectors", v)` 之后 `np.load("index/vectors")` 会怎样?**

<details><summary>答案</summary>

报 `FileNotFoundError: No such file or directory: 'index/vectors'`。`np.save` 发现文件名没有 `.npy` 后缀会自动补上,实际写的是 `index/vectors.npy`;`np.load` 不会补,去找没有后缀的文件。存和读都写全 `.npy`。

</details>

**4. `load_index()` 做了哪几道检查?各自防的是什么事故?哪种情况它挡不住?**

<details><summary>答案</summary>

三道。没有 `chunks.json`:没建过索引就来查,给出「先跑 build_index」的提示。模型名不一致:索引用 bge-m3 建、查询用别的模型编码,向量不在同一个空间,分数没有意义(Day 217)。行数和块数不一致:两个文件不是同一次建的,检索会按旧行号取到新列表里的另一块,今天实测 0.820 的分数取出了错的块。挡不住的是块数碰巧一样、内容变了的情况,要靠内容指纹。

</details>

**5. 面试题:「你们的向量索引是怎么存的?为什么不直接用向量数据库?」**

<details><summary>答案</summary>

先说现状:几千块以内,我用一个 `(N, 1024)` 的 float32 numpy 数组存向量,块的文字和元数据(编号、文章、标题、分类、小节)存在一个顺序对应的 JSON 里,同时记下 embedding 模型名、维度、切块参数和建造时间。查询时整个矩阵在内存里,一次矩阵乘法算完全部相似度,比走网络的数据库还快,而且没有任何运维成本。

再说边界和防护:两个文件靠下标对齐,所以由同一个构建函数一次写出,读回来时核对模型名和行数,不一致就拒绝查询;文章或参数变了就整体重建。什么时候换数据库:块数到几十万以上内存放不下或全量扫描太慢、需要增量写入和多人并发、需要按元数据过滤或和业务数据放一起做事务,这时候换 pgvector 这类方案,用近似索引(HNSW)换速度。

</details>

## 明天预告

明天是 [Day 226 · 检索和回答:top-k 拼进 prompt](/blog/agent-zero/day-226-retrieve-answer/)。今天的 `load_index()` 给出了 42 个 `Chunk` 和 `(42, 1024)` 的矩阵,明天在查询线上用它:问题编码成一个向量,和矩阵一乘得到 42 个分数,取最高的 k 块包进 `<doc>` 标签拼进 prompt,让大模型回答并标出处,再写一个函数检查它标的出处是不是真的在资料里。
