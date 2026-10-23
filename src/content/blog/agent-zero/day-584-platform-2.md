---
title: 'Day 584 · 平台(二):隔离四维度,silo/pool/bridge,行级安全'
description: '租户认出来以后,隔离要在四个地方各设一道门:数据(连缓存也算)、配额、密钥、模型。今天先用四个本机小脚本把四道门各漏一次再补上,再讲 silo、pool、bridge 三种部署取舍和一笔粗账,最后在自己新建的 Postgres 库里打开行级安全,看「忘了写 tenant_id」变成一行都查不到,并踩 owner、超级用户、WITH CHECK、连接池四个坑。'
pubDate: 2026-10-23
regime: none
tags: ['platform', 'multi-tenancy', 'postgres', 'rls', 'agent-zero']
series: 'agent-zero'
day: 584
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 583](/blog/agent-zero/day-583-platform-1/) 回答了三个问题:什么信号出现时才值得做平台(第三个团队来要、同一个修复改好几遍、有人要分账);平台该给业务团队七块能力,哪三样必须留给业务团队;以及「租户」是谁。我们写了 `tenants.py`,让租户只从 API key 认出来,不信请求体;又在 `leak_demo.py` 里故意漏写一次 `tenant_id`,让 Maple 的客服 Agent 检索到了云簿 VIP 客户的手机号。

那一课留了一个问题:靠每个写 SQL 的人都记得加 `tenant_id`,迟早出事。今天分两半解决它。前半讲隔离不止数据这一个维度,配额、密钥、模型也要各设一道门,再讲三种部署方式怎么取舍。后半在 Postgres 里打开行级安全,让数据库替你兜底。

## 今天要解决的问题

学完今天你应该能做到:

1. 说出隔离的四个维度,并且对每一个维度都能指出「最容易漏的那个地方」(缓存、批处理抢额度、日志里的 key、回退链),各用一个小脚本复现过一次。
2. 说清 silo、pool、bridge 三种部署模型各自省什么、贵什么,能用一张粗账表说明租户从几个涨到几十个时差在哪,知道为什么默认选 pool 并留好切 silo 的口子。
3. 在 Postgres 里给一张表打开行级安全(RLS),写出带 `USING` 和 `WITH CHECK` 的策略,让忘了设租户的查询返回 0 行;知道超级用户、表的 owner、连接池里的 `SET` 这三个会让 RLS 失效的坑,并能写一个体检脚本检查「有 `tenant_id` 的表是不是都开了 RLS」。

预计用时 3 小时。前置:[Day 583](/blog/agent-zero/day-583-platform-1/)(`part10/platform/tenants.py` 的 `resolve`)、[Day 228](/blog/agent-zero/day-228-postgres-basics/)(Postgres.app、psql、psycopg)、[Day 229](/blog/agent-zero/day-229-pgvector-1/)(`kb_chunks` 表长什么样)、[Day 92](/blog/agent-zero/day-092-python-sqlite-1/)(参数化查询)、[Day 98](/blog/agent-zero/day-098-context-managers/)(`with` 和上下文管理器)、[Day 71](/blog/agent-zero/day-071-pytest-1/)(pytest)。

先说清楚怎么跑的。全部在本机实跑,不调任何付费接口,花费 0 元。前四个脚本是纯 Python,其中第三个(`byok.py`)要 `uv add cryptography`。后半要连 Postgres,我用的是 Postgres.app 的 17.11,在**一个新建的库** `agentzero_platform` 里操作,连带建了两个角色 `migrator` 和 `agent_app`。你不要在 Day 229 建的 `agentzero` 库里做这些实验,角色是整个 Postgres 服务共享的,在别的库里 `DROP ROLE` 会连累别人。需要安装:

```bash
cd agent-zero-lab
uv add cryptography "psycopg[binary]" psycopg-pool
createdb agentzero_platform
```

代码都放在 `agent-zero-lab/part10/platform/`,和昨天的 `tenants.py` 同一个目录。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`tenant_db.py` 的 `tenant_tx`、`rls_setup.py` 里那条策略、`model_policy.py` 的 `pick_model`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 隔离不止「数据分开存」

昨天说租户的数据、配额、账单都和别人分开算。数据好理解,另外几样很容易被忘掉。一个多租户的 Agent 平台至少要在四个地方各设一道门,每一道门都是在「租户认出来」之后才起作用:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="隔离的四个维度:数据、配额、密钥、模型,每个维度各举一个最容易漏的地方">
<rect x="20" y="20" width="130" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="85" y="40" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">请求</text>
<text x="85" y="56" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">已认出租户 maple</text>
<g stroke="var(--rule)" stroke-width="1.5" fill="none">
<path d="M 150 42 L 175 42 L 175 105 L 190 105"/><path d="M 150 42 L 175 42 L 175 105 L 190 105"/>
<path d="M 175 105 L 175 165 L 190 165"/><path d="M 175 165 L 175 215 L 190 215"/>
</g>
<g font-family="var(--font-mono)" font-size="12" fill="var(--ink)">
<rect x="190" y="85" width="120" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="250" y="109" text-anchor="middle">数据</text>
<rect x="190" y="145" width="120" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="250" y="169" text-anchor="middle">配额</text>
<rect x="190" y="195" width="120" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="250" y="219" text-anchor="middle">密钥</text>
<rect x="190" y="25" width="120" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="250" y="49" text-anchor="middle">模型</text>
</g>
<path d="M 175 42 L 190 42" stroke="var(--rule)" stroke-width="1.5"/>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
<text x="325" y="44">回退链悄悄回退到不允许的模型</text>
<text x="325" y="104">缓存 key 里没有租户、trace 和评测集</text>
<text x="325" y="164">一个租户的批处理吃光共享额度</text>
<text x="325" y="214">租户自带的 key 出现在日志里</text>
</g>
<text x="20" y="150" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">每道门最容易漏的地方</text>
</svg>
<figcaption>认出租户以后,往下有四道门。每一道都有一个「功能看起来都对、其实漏了」的位置,下面四个脚本各把它漏一次。</figcaption>
</figure>

### 数据:五类含租户的数据,和一个不起眼的缓存

数据隔离不只是知识库。一个 Agent 平台里至少有五类数据带着租户的内容:知识库切块、会话历史、长期记忆、trace(里面有完整的提示词和回复)、评测集(经常是从线上 trace 里挑出来的)。后两类最容易漏,因为它们看起来是「平台自己的运维数据」,不是「客户数据」。

另一个藏得更深的是**缓存**。网关为了省钱会缓存模型回复:同一个问题问第二次,直接返回上次的答案。缓存的 key 要是只有问题文本,A 租户问过的问题,B 租户再问就会拿到 A 的答案,答案里可能就带着 A 的客户信息。下面把它写出来。新建 `part10/platform/cache_leak.py`:

```python
# agent-zero-lab/part10/platform/cache_leak.py
"""数据维度里最隐蔽的一处:响应缓存。缓存 key 里没有租户,A 问过的问题,B 再问就拿到 A 的答案。
用法:uv run python part10/platform/cache_leak.py
"""
from tenants import Tenant, resolve

ANSWERS = {   # 假装这是「检索 + 模型」的结果:同一个问题,两家公司的答案不一样
    ("yunbu", "退款政策是什么"): "年付 30 天内可全额退款。VIP 客户张三已特批延长到 60 天。",
    ("maple", "退款政策是什么"): "一律不退,可转为下期抵扣。",
}
calls = 0


def answer(t: Tenant, question: str) -> str:
    global calls
    calls += 1                                    # 数一数真正「花钱」算了几次
    return ANSWERS[(t.org, question)]


cache_bad: dict[str, str] = {}
cache_good: dict[tuple[str, str, str], str] = {}


def ask_bad(api_key: str, question: str) -> str:
    t = resolve(api_key)
    if question not in cache_bad:
        cache_bad[question] = answer(t, question)
    return cache_bad[question]


def ask_good(api_key: str, question: str) -> str:
    t = resolve(api_key)
    key = (t.org, t.project, question)
    if key not in cache_good:
        cache_good[key] = answer(t, question)
    return cache_good[key]


if __name__ == "__main__":
    for name, ask in (("缓存 key 只有问题", ask_bad), ("缓存 key 带 org 和 project", ask_good)):
        calls = 0
        print(f"== {name}")
        for who, key in (("yunbu", "sk-yunbu-support"), ("maple", "sk-maple-support"), ("maple", "sk-maple-support")):
            print(f"  {who:<6} → {ask(key, '退款政策是什么')}")
        print(f"  真正算了 {calls} 次")
```

<div class="line-notes">

- `from tenants import Tenant, resolve` 昨天建的 `tenants.py`。从 `agent-zero-lab` 根目录运行这个脚本时,Python 会把脚本所在目录放进导入路径,所以同目录的文件能直接 `import`。
- `ANSWERS = {   # 假装这是「检索 + 模型」的结果:同一个问题,两家公司的答案不一样` 键是 `(org, 问题)`,所以同一句「退款政策是什么」,云簿和 Maple 的答案不同。云簿那条里带着 VIP 客户张三,和昨天的 `leak_demo.py` 是同一份假数据。
- `calls = 0` 数一数「真正去算」的次数。缓存的意义就是少算,所以每次调用 `answer` 都计一次。
- `global calls` 函数里要改模块级变量,必须声明 `global`,否则 Python 会当成新建了一个同名的局部变量,模块级那个就改不到了。JS 里直接赋值就会改到外层变量,这里要多写一句。
- `calls += 1                                    # 数一数真正「花钱」算了几次` 第一种缓存算 1 次,第二种算 2 次,这个数字就是两种写法的差别。
- `cache_bad: dict[str, str] = {}` 错误版本的缓存:键只是问题文本,值是答案。
- `cache_good: dict[tuple[str, str, str], str] = {}` 正确版本:键是 `(org, project, 问题)` 三元组。元组可以当字典的键,列表不行,因为元组创建后不能改,和昨天 `Tenant(frozen=True)` 同一个道理。
- `t = resolve(api_key)` 两个版本都先认租户,问题不出在认证上,出在认完以后缓存没用上租户。
- `if question not in cache_bad:` 只用问题查缓存。云簿先问,答案写进缓存;Maple 再问同一句,命中,拿到的就是云簿的答案。
- `key = (t.org, t.project, question)` 正确版本把租户拼进 key。加上 `project` 是因为同一家公司的客服和销售也不该共享缓存,他们能看到的知识库不一样。
- `for name, ask in (("缓存 key 只有问题", ask_bad), ("缓存 key 带 org 和 project", ask_good)):` 把函数当值放进元组遍历,相当于 JS 里 `[["...", askBad], ["...", askGood]]`。
- `calls = 0` 每轮开始前清零,这一行出现在 `__main__` 里,是模块级的赋值,和前面函数里的 `global calls` 指的是同一个变量。
- `for who, key in (("yunbu", "sk-yunbu-support"), ("maple", "sk-maple-support"), ("maple", "sk-maple-support")):` 三次请求:云簿问一次,Maple 连问两次。第二次 Maple 问是为了确认正确版本的缓存仍然生效(命中,不重算)。

</div>

```bash
uv run python part10/platform/cache_leak.py
```

```text
== 缓存 key 只有问题
  yunbu  → 年付 30 天内可全额退款。VIP 客户张三已特批延长到 60 天。
  maple  → 年付 30 天内可全额退款。VIP 客户张三已特批延长到 60 天。
  maple  → 年付 30 天内可全额退款。VIP 客户张三已特批延长到 60 天。
  真正算了 1 次
== 缓存 key 带 org 和 project
  yunbu  → 年付 30 天内可全额退款。VIP 客户张三已特批延长到 60 天。
  maple  → 一律不退,可转为下期抵扣。
  maple  → 一律不退,可转为下期抵扣。
  真正算了 2 次
```

第一组里,三次请求只算了 1 次,看起来省钱,但 Maple 拿到了云簿的 VIP 备注。第二组算了 2 次(每家各算一次),Maple 第二次问是命中缓存的,没有重算,也没有串。这里有一条规矩:**凡是能让两个请求共享结果的地方(缓存、索引、向量库的 collection、trace 查询),都问一句「这个 key 里有租户吗」**。语义缓存更要小心,它按相似度而不是精确文本命中,不带租户就更容易串。

### 配额:吵闹的邻居

第二个维度是配额。你向模型供应商买的额度是整个平台共用的,供应商那边通常有每分钟请求数的上限,超了回 429。要是某个租户跑批处理,一口气发出几百个请求,把共享额度吃光,别的租户正常的请求也会跟着收到 429。这叫「吵闹的邻居」(noisy neighbor)。

下面用一个假时钟模拟一分钟的流量,不调任何接口。假设供应商整个平台每分钟放行 100 个请求;云簿在跑批处理,发了 300 个,Maple 正常使用,发了 20 个。新建 `part10/platform/noisy_neighbor.py`:

```python
# agent-zero-lab/part10/platform/noisy_neighbor.py
"""配额维度:一个租户把共享额度吃光,别的租户跟着吃 429。用一个假时钟模拟一分钟的流量,不调任何接口。
用法:uv run python part10/platform/noisy_neighbor.py
"""
import random
from collections import Counter

PROVIDER_LIMIT = 100        # 假设:供应商那边整个平台每分钟最多放行 100 个请求,超了就回 429
PER_TENANT_LIMIT = 60       # 方案二:每个租户自己每分钟最多 60 个

random.seed(584)
# 这一分钟里的流量:云簿在跑批处理,发了 300 个;Maple 正常使用,发了 20 个。到达时刻是 0–60 秒里的随机数。
arrivals = sorted([(random.uniform(0, 60), "yunbu") for _ in range(300)] +
                  [(random.uniform(0, 60), "maple") for _ in range(20)])


def simulate(per_tenant_limit: int | None) -> Counter[tuple[str, str]]:
    seen_by_tenant: Counter[str] = Counter()
    total_passed = 0
    result: Counter[tuple[str, str]] = Counter()
    for _, tenant in arrivals:
        if per_tenant_limit is not None and seen_by_tenant[tenant] >= per_tenant_limit:
            result[(tenant, "被平台限流")] += 1          # 在平台这一层就挡下,没有占供应商的额度
            continue
        seen_by_tenant[tenant] += 1
        if total_passed >= PROVIDER_LIMIT:
            result[(tenant, "供应商 429")] += 1
        else:
            total_passed += 1
            result[(tenant, "成功")] += 1
    return result


if __name__ == "__main__":
    for name, limit in (("没有租户配额", None), (f"每租户每分钟 {PER_TENANT_LIMIT} 个", PER_TENANT_LIMIT)):
        r = simulate(limit)
        print(f"== {name}")
        for tenant in ("yunbu", "maple"):
            parts = "  ".join(f"{k} {r[(tenant, k)]}" for k in ("成功", "被平台限流", "供应商 429"))
            print(f"  {tenant:<6} {parts}")
```

<div class="line-notes">

- `PROVIDER_LIMIT = 100        # 假设:供应商那边整个平台每分钟最多放行 100 个请求,超了就回 429` 这是模拟的前提,不是任何真实供应商的数字。全平台共用这一个额度。
- `PER_TENANT_LIMIT = 60       # 方案二:每个租户自己每分钟最多 60 个` 平台自己在入口给每个租户设的上限,比供应商的额度小。真正的算法是令牌桶,[Day 586](/blog/agent-zero/day-586-gateway-1/) 和 [Day 627](/blog/agent-zero/day-627-agentops-gw-2/) 写,今天只用最简单的「一分钟内数个数」。
- `random.seed(584)` 固定种子,你跑出来的数字和我一样。
- `arrivals = sorted([(random.uniform(0, 60), "yunbu") for _ in range(300)] +` 云簿的 300 个请求,到达时刻是 0 到 60 秒之间的随机数。
- `[(random.uniform(0, 60), "maple") for _ in range(20)])` Maple 的 20 个,和上面的列表用 `+` 拼起来。`sorted` 按到达时刻排,元组比较先看第一个元素,所以就是按时刻排。
- `def simulate(per_tenant_limit: int | None) -> Counter[tuple[str, str]]:` 参数是 `None` 表示不设租户配额。返回值是计数器,键是 `(租户, 结果)`。
- `seen_by_tenant: Counter[str] = Counter()` 每个租户这一分钟已经放行了几个。
- `total_passed = 0` 全平台已经向供应商成功发出几个,到 100 就满了。
- `for _, tenant in arrivals:` 按时间顺序一个一个处理请求。下划线表示不用到达时刻,只用它排序。
- `if per_tenant_limit is not None and seen_by_tenant[tenant] >= per_tenant_limit:` 方案二的第一道关:这个租户自己的数超了,在平台这一层就挡下。代入第二组实验,云簿发到第 61 个起全部被挡,300 − 60 = 240 个。
- `result[(tenant, "被平台限流")] += 1          # 在平台这一层就挡下,没有占供应商的额度` 被挡下的请求没有走到供应商,所以不消耗那 100 个额度。这是配额真正起作用的地方。
- `seen_by_tenant[tenant] += 1` 放行一个就记一个。
- `if total_passed >= PROVIDER_LIMIT:` 第二道关:供应商的额度满了。
- `result[(tenant, "供应商 429")] += 1` 对照第一组实验:云簿前面 93 个请求先把额度占满以后,后面不管是谁的请求都吃 429。
- `parts = "  ".join(f"{k} {r[(tenant, k)]}" for k in ("成功", "被平台限流", "供应商 429"))` 计数器访问不存在的键返回 0,所以没发生过的结果直接显示 0。

</div>

```bash
uv run python part10/platform/noisy_neighbor.py
```

```text
== 没有租户配额
  yunbu  成功 93  被平台限流 0  供应商 429 207
  maple  成功 7  被平台限流 0  供应商 429 13
== 每租户每分钟 60 个
  yunbu  成功 60  被平台限流 240  供应商 429 0
  maple  成功 20  被平台限流 0  供应商 429 0
```

第一组里,云簿的 300 个请求和 Maple 的 20 个混在一起到达,额度被先到的请求占满。Maple 的 20 个请求只有 7 个成功,13 个吃了 429,而 Maple 什么都没做错。第二组给每个租户设了 60 个的上限,云簿自己被挡下 240 个,是它自己的批处理被限速;Maple 的 20 个全部成功。

这里的取舍也要说清楚:每租户上限设多少,是一个产品决定。设得太低,租户正常的突发流量会被误伤;设得太高,起不到隔离作用。常见做法是按套餐分档,再留一个「超出后排队,不直接拒绝」的选项。练习 2 会让你改云簿的请求量,看看 Maple 的成功数怎么变。

### 密钥:平台的 key,和租户自带的 key

第三个维度是密钥。有两种模式。一种是平台统一持有供应商的 key,所有租户共用,平台按租户分账。另一种是租户自带 key,英文叫 BYOK(bring your own key)。外部租户里的大客户经常要求 BYOK,因为他们和模型供应商签了自己的数据协议,调用要走自己的账号。平台要能同时支持两种。

自带的 key 要**加密后存放**,日志里不能出现完整的 key。加密用的是对称加密:同一把主密钥既能加密也能解密(对照一下哈希,哈希是单向的,算出来就还原不了)。存 API key 做成加密而不是哈希,因为平台之后还要拿它去调供应商,必须能还原。下面用 Python 的 `cryptography` 库里的 Fernet,新建 `part10/platform/byok.py`:

```python
# agent-zero-lab/part10/platform/byok.py
"""密钥维度:平台统一的供应商 key,和租户自带的 key(BYOK)。自带的 key 加密存放,日志里只出现打码后的样子。
用法:uv run python part10/platform/byok.py
uv add cryptography
"""
from cryptography.fernet import Fernet

MASTER = Fernet(Fernet.generate_key())      # 真实系统里主密钥来自 KMS 或密钥管理服务,不能写在代码里、也不能跟数据放一起
PLATFORM_KEY = "sk-platform-shared-0001"

db: dict[str, bytes] = {}                    # 租户 → 加密后的 key,假装这是数据库里的一列


def save_key(org: str, plain: str) -> None:
    db[org] = MASTER.encrypt(plain.encode())


def key_for(org: str) -> tuple[str, str]:
    """返回 (用哪个 key, 记账记给谁)。"""
    if org in db:
        return MASTER.decrypt(db[org]).decode(), f"{org} 自己付"
    return PLATFORM_KEY, f"平台垫付,按 {org} 分账"


def mask(key: str) -> str:
    return key[:3] + "…" + key[-4:] if len(key) > 8 else "***"


if __name__ == "__main__":
    save_key("maple", "sk-maple-own-9f3a77c1")
    print("数据库里存的:", db["maple"][:6], "…(共", len(db["maple"]), "字节)")
    for org in ("yunbu", "maple"):
        key, who_pays = key_for(org)
        print(f"{org:<6} 调用供应商用 {mask(key)}  → {who_pays}")
    headers = {"Authorization": "Bearer " + key_for("maple")[0], "X-Request-Id": "r-1"}
    print("直接打印请求头:", headers)
    print("打码后再打印:  ", {k: (mask(v.removeprefix("Bearer ")) if k == "Authorization" else v) for k, v in headers.items()})
```

<div class="line-notes">

- `from cryptography.fernet import Fernet` 一个现成的对称加密方案:用一把密钥加密,同一把密钥解密,并且自带时间戳和完整性校验,密文被改过解密时会报错。不要自己拿 AES 拼一个。
- `MASTER = Fernet(Fernet.generate_key())      # 真实系统里主密钥来自 KMS 或密钥管理服务,不能写在代码里、也不能跟数据放一起` `generate_key()` 每次返回一把新的随机密钥。演示里每次运行都新生成,所以这次存的密文下次运行就解不开了。真实系统里主密钥固定来自密钥管理服务,数据库被拖走时,攻击者拿到的只是密文。
- `PLATFORM_KEY = "sk-platform-shared-0001"` 平台自己的供应商 key,没有自带 key 的租户都用它。
- `db: dict[str, bytes] = {}                    # 租户 → 加密后的 key,假装这是数据库里的一列` 值是 `bytes`(字节串),因为密文不是文本。
- `db[org] = MASTER.encrypt(plain.encode())` `plain.encode()` 把字符串变成字节,`encrypt` 返回密文字节。代入 `"sk-maple-own-9f3a77c1"`,存进去的是一串以 `gAAAAA` 开头的字节。
- `if org in db:` Maple 在表里,走自带 key 的分支;云簿不在,走下面平台垫付的分支。
- `return MASTER.decrypt(db[org]).decode(), f"{org} 自己付"` 解密、转回字符串。第二个返回值是「记账记给谁」,调用方拿它写账单。自带 key 的调用成本供应商直接收租户的钱,平台不垫。
- `return PLATFORM_KEY, f"平台垫付,按 {org} 分账"` 平台的 key 调用,钱先由平台付,账单要按租户拆开,这就是昨天 `bill_split.py` 干的事。
- `return key[:3] + "…" + key[-4:] if len(key) > 8 else "***"` 只留开头三个字符和最后四个字符。`sk-` 加末四位足够让人对得上是哪把 key,又不泄露内容。太短的 key 全部打成星号。
- `print("数据库里存的:", db["maple"][:6], "…(共", len(db["maple"]), "字节)")` 只打印密文的前 6 个字节。Fernet 的密文开头固定是 `gAAAAA`(版本字节加时间戳的编码),后面每次运行都不一样,所以只看固定的这一段,共 120 字节。
- `headers = {"Authorization": "Bearer " + key_for("maple")[0], "X-Request-Id": "r-1"}` 模拟一个要发给供应商的请求头。
- `print("打码后再打印:  ", {k: (mask(v.removeprefix("Bearer ")) if k == "Authorization" else v) for k, v in headers.items()})` 日志里要记请求头时,先过一遍 `mask`。字典推导式只处理 `Authorization` 这一项,其余原样。`removeprefix("Bearer ")` 先去掉前缀,不然打码打在 `Bea` 上。

</div>

```bash
uv add cryptography
uv run python part10/platform/byok.py
```

```text
数据库里存的: b'gAAAAA' …(共 120 字节)
yunbu  调用供应商用 sk-…0001  → 平台垫付,按 yunbu 分账
maple  调用供应商用 sk-…77c1  → maple 自己付
直接打印请求头: {'Authorization': 'Bearer sk-maple-own-9f3a77c1', 'X-Request-Id': 'r-1'}
打码后再打印:   {'Authorization': 'sk-…77c1', 'X-Request-Id': 'r-1'}
```

倒数第二行是反面教材:把请求头整个打印出来,完整的 key `sk-maple-own-9f3a77c1` 就进了日志。日志通常发往日志平台、被很多人看到、保存很久,是 key 泄漏最常见的出口。最后一行是打码以后的样子。这里要补一句:打码要放在日志的统一出口里做,不能指望每个写 `print` 的人记得。昨天说的「同一个修复要改好几遍」,这就是一个典型。

### 模型:不同租户能用的模型不一样

第四个维度是模型。Maple 的合同写着「客户数据不出本机房」,它只能用自部署的模型。这种规则要在网关的路由层强制,不能靠业务方自觉。最容易漏的是**回退链**:主模型挂了,网关按预设顺序往下找备用的,备用链是平台默认的,没人想起来要对着每个租户的策略再过一遍。新建 `part10/platform/model_policy.py`:

```python
# agent-zero-lab/part10/platform/model_policy.py
"""模型维度:每个租户能用哪些模型,由平台在路由这一层强制。回退链也要过同一道检查。
用法:uv run python part10/platform/model_policy.py
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Policy:
    allowed: frozenset[str]          # 这个租户能用的模型
    note: str                        # 为什么(合同、合规),写下来,半年后别人才看得懂


POLICIES = {
    "yunbu": Policy(frozenset({"deepseek-v4-pro", "deepseek-flash", "qwen-local"}), "无限制,本地模型 qwen-local 是便宜档"),
    "maple": Policy(frozenset({"qwen-local"}), "合同:客户数据不出本机房,只能用自部署模型"),
}
FALLBACK_CHAIN = ["deepseek-v4-pro", "deepseek-flash", "qwen-local"]       # 平台默认的回退顺序


class ModelNotAllowed(Exception):
    pass


def check(org: str, model: str) -> None:
    if model not in POLICIES[org].allowed:
        raise ModelNotAllowed(f"{org} 不能用 {model}({POLICIES[org].note})")


def pick_model(org: str, outages: set[str]) -> str:
    """按回退链往下找第一个「没挂 + 租户被允许」的模型。"""
    for m in FALLBACK_CHAIN:
        if m in outages:
            continue
        if m in POLICIES[org].allowed:
            return m
    raise ModelNotAllowed(f"{org} 没有可用的模型(挂掉的:{sorted(outages)})")


def pick_model_naive(org: str, outages: set[str]) -> str:
    for m in FALLBACK_CHAIN:
        if m not in outages:
            return m                  # 忘了过租户策略
    raise RuntimeError("全挂了")


if __name__ == "__main__":
    for org, model in (("yunbu", "deepseek-v4-pro"), ("maple", "deepseek-v4-pro"), ("maple", "qwen-local")):
        try:
            check(org, model)
            print(f"{org:<6} 请求 {model:<16} → 放行")
        except ModelNotAllowed as e:
            print(f"{org:<6} 请求 {model:<16} → 拒绝:{e}")
    print("--- deepseek-v4-pro 挂了,回退链往下走")
    print("maple 朴素回退 :", pick_model_naive("maple", {"deepseek-v4-pro"}), "  ← 数据出境了")
    print("maple 过策略   :", pick_model("maple", {"deepseek-v4-pro"}))
    try:
        pick_model("maple", {"qwen-local"})
    except ModelNotAllowed as e:
        print("maple 本地模型也挂:拒绝,", e)
```

<div class="line-notes">

- `allowed: frozenset[str]          # 这个租户能用的模型` `frozenset` 是不能改的集合([Day 583](/blog/agent-zero/day-583-platform-1/) 用 `frozen=True` 冻住 `Tenant` 是同一个思路)。判断「在不在集合里」是常数时间。
- `note: str                        # 为什么(合同、合规),写下来,半年后别人才看得懂` 每条策略都带一句理由。没有理由的限制,半年后没人敢改,也没人说得清能不能删。
- `"maple": Policy(frozenset({"qwen-local"}), "合同:客户数据不出本机房,只能用自部署模型"),` Maple 只有一个模型可选。`qwen-local` 是我们假设的一个自部署模型的名字。
- `FALLBACK_CHAIN = ["deepseek-v4-pro", "deepseek-flash", "qwen-local"]       # 平台默认的回退顺序` 先用最强的,挂了退到便宜的,再退到本地的。这是平台级的配置,不分租户。
- `class ModelNotAllowed(Exception):` 自定义异常,在 HTTP 层翻译成 403。
- `if model not in POLICIES[org].allowed:` 直接请求某个模型时的检查。Maple 请求 `deepseek-v4-pro`,不在它的集合里,拒绝。
- `raise ModelNotAllowed(f"{org} 不能用 {model}({POLICIES[org].note})")` 报错信息里带上理由,排查的人一眼就知道是合同限制,不是配置写错了。
- `for m in FALLBACK_CHAIN:` 按顺序往下找第一个能用的。
- `if m in outages:` 挂掉的跳过。
- `if m in POLICIES[org].allowed:` 回退这一步也要过租户策略,这一行就是和下面朴素版本的全部区别。代入 Maple、`deepseek-v4-pro` 挂了:`deepseek-flash` 没挂但 Maple 不允许,跳过;`qwen-local` 没挂也允许,选它。
- `raise ModelNotAllowed(f"{org} 没有可用的模型(挂掉的:{sorted(outages)})")` 都用不了时宁可拒绝,也不能为了「可用」放宽合规。一个没有答案的错误,比一次出境好处理得多。
- `return m                  # 忘了过租户策略` 朴素版本:第一个没挂的就用。`deepseek-v4-pro` 挂了就选 `deepseek-flash`,Maple 的数据出境了,而且没有任何报错。

</div>

```bash
uv run python part10/platform/model_policy.py
```

```text
yunbu  请求 deepseek-v4-pro  → 放行
maple  请求 deepseek-v4-pro  → 拒绝:maple 不能用 deepseek-v4-pro(合同:客户数据不出本机房,只能用自部署模型)
maple  请求 qwen-local       → 放行
--- deepseek-v4-pro 挂了,回退链往下走
maple 朴素回退 : deepseek-flash   ← 数据出境了
maple 过策略   : qwen-local
maple 本地模型也挂:拒绝, maple 没有可用的模型(挂掉的:['qwen-local'])
```

关键是倒数第三行:朴素回退让 Maple 悄悄用上了 `deepseek-flash`。没有报错,没有告警,只有一次不该发生的数据出境,而且是在主模型故障的时候发生的,最没人盯着的时候。**凡是「失败后换一条路」的逻辑(回退、重试、降级),换出来的那条路都要过一遍同样的权限检查。**

四个维度各漏一次再补上以后,有一个共同的形状:租户在入口认出来,往下每一层都要带着它,哪一层忘了,那一层就是漏洞。昨天的图讲的是同一件事。

## 三种部署模型:silo、pool、bridge

隔离的四道门设好以后,下一个问题是物理上怎么放:租户的数据和计算,是每家一套,还是大家共用?AWS 在 SaaS 架构的白皮书《SaaS Tenant Isolation Strategies》里把这个叫法定了下来,业内现在普遍沿用(这份白皮书页面上自己标了「仅供历史参考」,但三个名字的含义没有变):

- **silo(独立)**:每个租户一整套资源,独立的数据库、独立的 worker,甚至独立的网关实例。隔离最彻底,代价是钱和人:N 个租户就是 N 套东西,升级要升 N 遍。
- **pool(共享)**:所有租户共用一套资源,靠应用层的 `tenant_id` 和数据库的行级安全来隔离。最便宜、运维最省,但隔离要靠代码写对。
- **bridge(混合)**:按资源类型或租户等级混着来。比如计算层共享、数据库每个租户一个 schema;或者普通租户在共享集群里,付了钱的大客户单独一套。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="三种部署模型:silo 每个租户独立的计算和数据库,pool 共享一套靠 tenant_id 和行级安全,bridge 计算共享数据按 schema 或按租户等级分开">
<g font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">
<text x="105" y="26">silo</text><text x="320" y="26">pool</text><text x="535" y="26">bridge</text>
</g>
<line x1="212" y1="38" x2="212" y2="240" stroke="var(--rule)"/><line x1="427" y1="38" x2="427" y2="240" stroke="var(--rule)"/>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">
<rect x="20" y="44" width="50" height="38" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="45" y="67">worker A</text>
<rect x="80" y="44" width="50" height="38" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="105" y="67">worker B</text>
<rect x="140" y="44" width="50" height="38" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="165" y="67">worker C</text>
<rect x="20" y="94" width="50" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="45" y="117">DB A</text>
<rect x="80" y="94" width="50" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="105" y="117">DB B</text>
<rect x="140" y="94" width="50" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="165" y="117">DB C</text>
<rect x="245" y="44" width="150" height="38" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="320" y="67">共享 worker(A B C)</text>
<rect x="245" y="94" width="150" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="320" y="110">共享 DB</text><text x="320" y="124">tenant_id + RLS</text>
<rect x="445" y="44" width="170" height="38" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="530" y="67">共享 worker(A B C)</text>
<rect x="445" y="94" width="80" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="485" y="110">schema A</text><text x="485" y="124">schema B</text>
<rect x="535" y="94" width="80" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="575" y="117">DB C 专属</text>
</g>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">
<text x="105" y="170">隔离最强</text><text x="105" y="188">成本 × N</text><text x="105" y="206">升级要 N 遍</text>
<text x="320" y="170">成本最低</text><text x="320" y="188">一个漏写的 WHERE</text><text x="320" y="206">就是事故</text>
<text x="530" y="170">按资源、按租户等级混用</text><text x="530" y="188">最常见的终态</text><text x="530" y="206">复杂度挪到了路由层</text>
</g>
</svg>
<figcaption>蓝色是计算层,琥珀色是数据层。bridge 右下角画了两种做法:几个租户共用一个库、每人一个 schema,另一个大客户单独一个库。</figcaption>
</figure>

选哪个,不是看哪个听着好,是看租户有几个、合同怎么写、团队有几个人维护。下面写一个很小的路由和一笔粗账。路由的部分只有一个想法:**租户配置里有一个 `deploy_mode` 字段**,请求进来先看它,决定连共享集群还是专属集群。现在所有租户都是 pool,这个字段也要先留着,以后有人要物理隔离时才不用改表结构。新建 `part10/platform/deploy_modes.py`:

```python
# agent-zero-lab/part10/platform/deploy_modes.py
"""silo / pool / bridge:租户配置里多一个 deploy_mode,路由层据此决定请求发到哪;再算一笔粗账,看租户多了以后差在哪。
用法:uv run python part10/platform/deploy_modes.py
"""
from dataclasses import dataclass

SHARED_DSN = "postgresql://shared-db:5432/agentops"


@dataclass(frozen=True)
class TenantConfig:
    org: str
    deploy_mode: str            # "pool"(共享集群)或 "silo"(专属集群)
    dedicated_dsn: str | None = None


CONFIGS = {
    "yunbu": TenantConfig("yunbu", "pool"),
    "maple": TenantConfig("maple", "pool"),
    "vault": TenantConfig("vault", "silo", "postgresql://vault-db.internal:5432/agentops"),   # 合同要求物理隔离的大客户
}


def dsn_for(org: str) -> str:
    cfg = CONFIGS[org]
    if cfg.deploy_mode == "silo":
        assert cfg.dedicated_dsn, f"{org} 是 silo,必须配 dedicated_dsn"
        return cfg.dedicated_dsn
    return SHARED_DSN


# ---- 粗账。下面所有数字都是假设,换成你自己云账单和排期的数字 ----
BASE_CLUSTER = 1500     # 假设:一套完整集群(数据库 + worker)每月 1500 元
SMALL_CLUSTER = 600     # 假设:silo 给一个租户开的最小一套,每月 600 元
PER_TENANT_POOL = 30    # 假设:pool 里多一个租户,增加的存储和算力折成每月 30 元
UPGRADE_MIN = 20        # 假设:给一套集群升一次级,人要花 20 分钟


def monthly(n_tenants: int, n_silo: int) -> tuple[int, int]:
    """返回 (每月云成本, 升级一次要花的分钟)。n_silo 个租户用 silo,其余在共享集群里。"""
    n_pool = n_tenants - n_silo
    clusters = n_silo + (1 if n_pool else 0)
    cost = n_silo * SMALL_CLUSTER + (BASE_CLUSTER + n_pool * PER_TENANT_POOL if n_pool else 0)
    return cost, clusters * UPGRADE_MIN


if __name__ == "__main__":
    for org in CONFIGS:
        print(f"{org:<6} {CONFIGS[org].deploy_mode:<5} → {dsn_for(org)}")
    print(f"\n{'租户数':>6} {'全 silo':>14} {'全 pool':>14} {'bridge(2 个 silo)':>20}")
    for n in (3, 10, 50):
        row = []
        for silo in (n, 0, 2):
            cost, upgrade = monthly(n, silo)
            row.append(f"¥{cost}/{upgrade}分钟")
        print(f"{n:>6} {row[0]:>14} {row[1]:>14} {row[2]:>20}")
```

<div class="line-notes">

- `SHARED_DSN = "postgresql://shared-db:5432/agentops"` 共享集群的连接串。DSN 就是「怎么连这个数据库」的一行字符串,和 Day 228 里的 `postgresql://localhost:5432/agentzero` 同一个格式。主机名是编的,脚本不会真的去连。
- `deploy_mode: str            # "pool"(共享集群)或 "silo"(专属集群)` 部署模式写在租户配置里。真实系统里这一行是租户表的一列。
- `dedicated_dsn: str | None = None` 只有 silo 租户才有专属连接串,其余是 `None`。
- `"vault": TenantConfig("vault", "silo", "postgresql://vault-db.internal:5432/agentops"),   # 合同要求物理隔离的大客户` 一个编出来的客户 `vault`,合同要求物理隔离,所以是 silo,有自己的连接串。
- `assert cfg.dedicated_dsn, f"{org} 是 silo,必须配 dedicated_dsn"` 配置有矛盾(silo 却没填连接串)时,在启动或第一次路由时就炸,不要让请求悄悄落到共享库里。这一句的后果是 vault 的数据写进共享集群,正好是合同禁止的。
- `return SHARED_DSN` 不是 silo 就一律走共享集群。
- `BASE_CLUSTER = 1500     # 假设:一套完整集群(数据库 + worker)每月 1500 元` 下面五个常量都是**假设**,不是任何云的报价。换成你自己的账单。
- `SMALL_CLUSTER = 600     # 假设:silo 给一个租户开的最小一套,每月 600 元` 给单个租户开的一套比共享集群小,所以便宜一些。
- `PER_TENANT_POOL = 30    # 假设:pool 里多一个租户,增加的存储和算力折成每月 30 元` pool 的边际成本很低,这是它能省钱的根本原因。
- `UPGRADE_MIN = 20        # 假设:给一套集群升一次级,人要花 20 分钟` 另一笔账:人的时间。silo 有几套就要升几遍。
- `n_pool = n_tenants - n_silo` 总租户数减去 silo 的,剩下的都在共享集群里。
- `clusters = n_silo + (1 if n_pool else 0)` 要维护的集群数:每个 silo 一套,加上共享集群(只要还有 pool 租户就有这一套)。`1 if n_pool else 0` 是 Python 的三元表达式,相当于 JS 的 `n_pool ? 1 : 0`。
- `cost = n_silo * SMALL_CLUSTER + (BASE_CLUSTER + n_pool * PER_TENANT_POOL if n_pool else 0)` 代入 `monthly(10, 2)`:2 × 600 = 1200,共享集群 1500 + 8 × 30 = 1740,合计 2940。
- `return cost, clusters * UPGRADE_MIN` 返回(每月云成本, 升级一轮要花的分钟)。同样是 `monthly(10, 2)`:3 套集群 × 20 分钟 = 60 分钟。
- `for silo in (n, 0, 2):` 三列:全 silo(所有租户都独立)、全 pool、bridge(固定 2 个大客户 silo,其余 pool)。
- `row.append(f"¥{cost}/{upgrade}分钟")` 把成本和升级时间拼在一格里,方便对照。

</div>

```bash
uv run python part10/platform/deploy_modes.py
```

```text
yunbu  pool  → postgresql://shared-db:5432/agentops
maple  pool  → postgresql://shared-db:5432/agentops
vault  silo  → postgresql://vault-db.internal:5432/agentops

   租户数         全 silo         全 pool     bridge(2 个 silo)
     3     ¥1800/60分钟     ¥1590/20分钟           ¥2730/60分钟
    10    ¥6000/200分钟     ¥1800/20分钟           ¥2940/60分钟
    50  ¥30000/1000分钟     ¥3000/20分钟           ¥4140/60分钟
```

前三行是路由:云簿和 Maple 走共享集群,vault 走自己的专属库。下面的表是粗账,按我的假设读:

3 个租户时,全 pool 是 ¥1590(共享集群底子 1500 加 3 × 30),全 silo 是 ¥1800,差得不多;bridge 反而最贵(¥2730),因为小规模时共享集群的 1500 元底子摊在很少的租户上,又多养了两个 silo。10 个租户时,全 silo 要 ¥6000、升级一轮 200 分钟,全 pool 只要 ¥1800、20 分钟。到 50 个租户,全 silo 是 ¥30000、1000 分钟,全 pool 是 ¥3000、20 分钟。**租户少的时候三种差别不大,多了以后差距是成倍拉开的。** 这就是内部平台一般默认 pool 的原因:租户一般不超过几十个,但哪怕只有几个,silo 的运维成本也远大于收益。

我的建议和这笔账一致:**默认 pool,数据库层用 RLS 兜底,给 silo 留好口子**。口子就是上面的 `deploy_mode`。总会有那么一两家(财务、法务、或者某个大客户)要求物理隔离,到时候给它配一个 `dedicated_dsn`,路由层把它的请求发过去,其余租户不受影响。要注意的是,一旦有了 silo 租户,你就要面对两套部署:迁移要跑两遍,监控要看两处,新功能要灰度两处。口子留得早,切换时痛苦就小,但留口子不等于要现在就用。

bridge 在数据库层的常见做法,AWS 的指南页里写得很明确:silo 是每个租户一个数据库实例,**bridge 是每个租户一个 schema,pool 是用数据库引擎的行级安全**。schema 方案放在文末再看一眼,先把 pool 用的行级安全讲透,它是今天的重点。

## 行级安全:让数据库替你加那个 WHERE

昨天 `leak_demo.py` 的教训是:`tenant_id` 条件靠每个人手写,总有人漏。**行级安全**(row-level security,简称 RLS)是 Postgres 提供的一个办法:在表上挂一条**策略**(policy),之后每一条查询,Postgres 都会自动把策略里的条件加到它后面。应用层忘了写 `WHERE tenant_id = ...`,数据库也只会返回当前租户的行。

前端同学可以类比成一个**强制的中间件**:路由处理函数里你忘了校验权限,中间件已经替你挡了一道,而且这道挡在数据库里,不管请求从哪段代码来、用哪种语言写的,都绕不过去。

策略里要回答「现在是哪个租户」。Postgres 的办法是一个**会话变量**:应用在查询前先设置 `app.tenant_id`,策略里用 `current_setting('app.tenant_id', true)` 读它。第二个参数 `true` 的意思是「变量没设置时返回 NULL,不要报错」。NULL 和任何值比较都不成立,所以**忘了设租户的结果是一行都看不到**,而不是看到全部。这条规则是整个方案安全的关键,让它「没设置就拒绝」而不是「没设置就放行」。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="一个请求在事务里先设置 app.tenant_id,再执行没有 tenant_id 条件的 SQL,Postgres 按策略自动加过滤条件">
<g font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">
<rect x="20" y="70" width="110" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="75" y="94">请求</text><text x="75" y="112" font-size="10" fill="var(--ink-soft)">key → maple</text>
<rect x="165" y="70" width="150" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="240" y="92">事务内</text><text x="240" y="110" font-size="10" fill="var(--ink-soft)">set_config(app.tenant_id,</text><text x="240" y="122" font-size="10" fill="var(--ink-soft)">'maple', true)</text>
<rect x="350" y="70" width="130" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="415" y="92">SELECT …</text><text x="415" y="110" font-size="10" fill="var(--ink-soft)">没写 tenant_id</text>
<rect x="515" y="40" width="110" height="116" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="570" y="64">Postgres</text><text x="570" y="84" font-size="10" fill="var(--ink-soft)">策略自动追加</text><text x="570" y="100" font-size="10" fill="var(--ink-soft)">AND tenant_id =</text><text x="570" y="114" font-size="10" fill="var(--ink-soft)">current_setting(…)</text><text x="570" y="138" font-size="10" fill="var(--ink-soft)">事务结束,变量失效</text>
</g>
<g stroke="var(--rule)" stroke-width="1.5"><line x1="130" y1="98" x2="165" y2="98"/><line x1="315" y1="98" x2="350" y2="98"/><line x1="480" y1="98" x2="515" y2="98"/></g>
<text x="320" y="190" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">变量没设置 → NULL → 条件不成立 → 一行都看不到</text>
</svg>
<figcaption>应用只做一件事:在事务开头设好租户。之后所有查询的租户条件,都由数据库按策略追加。</figcaption>
</figure>

### 准备:新库、两个角色、一张表

RLS 的行为取决于「用谁的身份连库」,所以先建两个普通角色。**角色**(role)是 Postgres 里的账号。`migrator` 负责建表改表,它会成为表的 **owner**(拥有者);`agent_app` 是应用连库用的角色,只给它读写权限。

```bash
createdb agentzero_platform
```

先写一个连库的小工具,后面所有脚本共用。新建 `part10/platform/pgconn.py`:

```python
# agent-zero-lab/part10/platform/pgconn.py
"""连 agentzero_platform 库的小工具:想以谁的身份连,就传谁的角色名。
Postgres.app 默认本机连接不要密码,所以这里不带密码;真实环境的密码从环境变量读,不写在代码里。
"""
import getpass

import psycopg

DB = "agentzero_platform"
ADMIN = getpass.getuser()          # 你本机的用户名(Postgres.app 里它是超级用户)


def connect(role: str, autocommit: bool = False) -> psycopg.Connection:
    return psycopg.connect(host="localhost", port=5432, dbname=DB, user=role, autocommit=autocommit)
```

<div class="line-notes">

- `import getpass` 标准库,取当前操作系统的用户名。
- `DB = "agentzero_platform"` 今天用的库名。
- `ADMIN = getpass.getuser()          # 你本机的用户名(Postgres.app 里它是超级用户)` Postgres.app 初始化时会以你的 Mac 用户名建一个超级用户。我这里是 `minliu`,你那里是你自己的用户名,所以不能写死。
- `def connect(role: str, autocommit: bool = False) -> psycopg.Connection:` 想以谁的身份连,就传谁的角色名。`autocommit=True` 时每条语句自己一个事务,建表、建角色这种 DDL 用它省得到处写提交。
- `return psycopg.connect(host="localhost", port=5432, dbname=DB, user=role, autocommit=autocommit)` 连接参数写成关键字,没有密码。Postgres.app 默认对本机连接用 `trust` 认证,不检查密码;真实环境的密码从环境变量读,不写在代码里。

</div>

再写建表脚本。新建 `part10/platform/rls_setup.py`:

```python
# agent-zero-lab/part10/platform/rls_setup.py
"""建三个角色(超级用户之外的两个)、一张带 tenant_id 的 kb_chunks 表、三行数据。可以重复跑,每次都从头建。
用法:先 createdb agentzero_platform,再 uv run python part10/platform/rls_setup.py
"""
from typing import LiteralString

from psycopg import sql

from pgconn import ADMIN, connect

SETUP: list[LiteralString] = [
    "CREATE ROLE migrator LOGIN",                 # 管建表和改表的角色,会成为表的 owner
    "CREATE ROLE agent_app LOGIN",                # 应用连库用的角色,普通权限
    "GRANT ALL ON SCHEMA public TO migrator",     # Postgres 15 起普通角色默认不能在 public 里建表
]
TABLE: LiteralString = """
CREATE TABLE kb_chunks (
    id        bigserial PRIMARY KEY,
    tenant_id text NOT NULL,
    doc_id    text NOT NULL,
    content   text NOT NULL
);
CREATE INDEX ON kb_chunks (tenant_id, doc_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_chunks TO agent_app;
GRANT USAGE ON SEQUENCE kb_chunks_id_seq TO agent_app;
"""
ROWS = [
    ("yunbu", "kb-001", "云簿套餐:基础版 49 元/月,年付 468 元。"),
    ("yunbu", "kb-002", "云簿退款政策:年付 30 天内可全额退款。VIP 客户张三 13812345678 已特批延长到 60 天。"),
    ("maple", "kb-002", "Maple 退款政策:一律不退,可转为下期抵扣。"),
]

with connect(ADMIN, autocommit=True) as admin:
    admin.execute("DROP TABLE IF EXISTS kb_chunks, traces")
    for role in ("agent_app", "migrator"):         # 重复跑时先把上一次的角色连同它的授权一起清掉
        if admin.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)).fetchone():
            admin.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(role)))
            admin.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))
    for stmt in SETUP:
        admin.execute(stmt)
with connect("migrator", autocommit=True) as mig:
    mig.execute(TABLE)
    with mig.cursor() as cur:
        cur.executemany("INSERT INTO kb_chunks (tenant_id, doc_id, content) VALUES (%s, %s, %s)", ROWS)
    print("建表并写入", mig.execute("SELECT count(*) FROM kb_chunks").fetchone(), "行,owner =",
          mig.execute("SELECT tableowner FROM pg_tables WHERE tablename = 'kb_chunks'").fetchone())
```

<div class="line-notes">

- `SETUP: list[LiteralString] = [` `LiteralString` 是类型标注,意思是「只能是写死在代码里的字符串」,不能是拼出来的。psycopg 的类型要求 `execute` 的 SQL 满足这一点,拼出来的 SQL 必须走 `sql.SQL`,这是它防注入的一道关。
- `"CREATE ROLE migrator LOGIN",                 # 管建表和改表的角色,会成为表的 owner` `LOGIN` 表示这个角色能登录。注意没有 `SUPERUSER`,也没有 `BYPASSRLS`,它只是个普通角色。
- `"CREATE ROLE agent_app LOGIN",                # 应用连库用的角色,普通权限` 应用连库用它。以后写应用代码,只能用这种角色连库,绝不能用超级用户,原因下面第四步会看到。
- `"GRANT ALL ON SCHEMA public TO migrator",     # Postgres 15 起普通角色默认不能在 public 里建表` Postgres 15 起,`public` 这个 schema 不再让所有人都能建表。不加这一行,`migrator` 建表会报 `permission denied for schema public`。
- `CREATE TABLE kb_chunks (` 和 Day 229 的知识库切块表同名,但这里在新库里,没有向量列,只留我们需要的四列。
- `tenant_id text NOT NULL,` 租户列,不允许为空。
- `CREATE INDEX ON kb_chunks (tenant_id, doc_id);` 复合索引,`tenant_id` 放在前面。后面的 `EXPLAIN` 会看到 RLS 加的条件正好能用上它。
- `GRANT SELECT, INSERT, UPDATE, DELETE ON kb_chunks TO agent_app;` 只给增删改查,不给 `ALTER`、`DROP`、`TRUNCATE`。应用角色不该有改表结构的权限。
- `GRANT USAGE ON SEQUENCE kb_chunks_id_seq TO agent_app;` `bigserial` 的自增 id 背后是一个序列。不授权的话 `agent_app` 插入数据会报权限错误。
- `("yunbu", "kb-002", "云簿退款政策:年付 30 天内可全额退款。VIP 客户张三 13812345678 已特批延长到 60 天。"),` 和昨天 `leak_demo.py` 一样的假数据:云簿那篇里有 VIP 客户的手机号,Maple 那篇没有。
- `admin.execute("DROP TABLE IF EXISTS kb_chunks, traces")` 脚本可以重复跑,每次从头来。`traces` 是后面练习里会建的表,顺手清掉。
- `for role in ("agent_app", "migrator"):         # 重复跑时先把上一次的角色连同它的授权一起清掉` 先查角色在不在,在才删。
- `admin.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(role)))` 先把这个角色拥有的东西、以及授给它的权限全部清掉。我第一版直接写 `DROP ROLE`,报了 `role "migrator" cannot be dropped because some objects depend on it`,细节是 `privileges for schema public`:上一次那条 `GRANT ALL ON SCHEMA public` 还挂在它身上。角色名、表名这类**标识符**没法用 `%s` 占位符传,要用 `psycopg.sql` 里的 `sql.Identifier` 拼进去,它会自动加引号、挡住注入。直接写 f-string 拼也跑得了,但 basedpyright 会标红:psycopg 3.3 的类型只放行写死的字符串字面量。
- `with connect("migrator", autocommit=True) as mig:` 之后的建表用 `migrator` 的身份,所以表的 owner 是它,而不是超级用户。这很关键,后面要演示 owner 的坑。
- `with mig.cursor() as cur:` `executemany` 是游标的方法,不是连接的方法。我第一版写成 `mig.executemany(...)`,报了 `AttributeError: 'Connection' object has no attribute 'executemany'`。
- `mig.execute("SELECT tableowner FROM pg_tables WHERE tablename = 'kb_chunks'").fetchone())` `pg_tables` 是系统视图,查出表的 owner,确认是 `migrator`。

</div>

```bash
uv run python part10/platform/rls_setup.py
```

```text
建表并写入 (3,) 行,owner = ('migrator',)
```

### 第一次:没开 RLS、开了 RLS、换三种身份

现在表里有三行,还没开 RLS。新建 `part10/platform/rls_leak.py`,它把同一条「忘了写 `tenant_id`」的查询跑四次:

```python
# agent-zero-lab/part10/platform/rls_leak.py
"""同一条「忘了写 tenant_id」的查询,在没开 RLS、开了 RLS、换三种身份连库时,各看到几行。
用法:uv run python part10/platform/rls_leak.py(要先跑过 rls_setup.py)
"""
from pgconn import ADMIN, connect

FORGOT = "SELECT tenant_id, doc_id FROM kb_chunks WHERE content LIKE '%退款%' ORDER BY id"


def forgot_rows(role: str) -> list[tuple]:
    with connect(role) as conn:
        return conn.execute(FORGOT).fetchall()


def count_as(role: str) -> int:
    with connect(role) as conn:
        row = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()
        assert row is not None
        return row[0]


print("1. 还没开 RLS,agent_app 忘了写 tenant_id:", forgot_rows("agent_app"))

with connect("migrator", autocommit=True) as mig:
    mig.execute("ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY")
    mig.execute("""CREATE POLICY tenant_isolation ON kb_chunks
                   USING (tenant_id = current_setting('app.tenant_id', true))
                   WITH CHECK (tenant_id = current_setting('app.tenant_id', true))""")
print("2. 开了 RLS,同一条查询:             ", forgot_rows("agent_app"))

with connect("agent_app") as conn, conn.transaction():
    conn.execute("SELECT set_config('app.tenant_id', 'maple', true)")
    print("3. 事务里先设租户 maple 再查:        ", conn.execute(FORGOT).fetchall())

print("\n4. 谁连库、没设租户,select count(*) 看到几行(表一共 3 行):")
print(f"   超级用户 {ADMIN:<8}", count_as(ADMIN))
print(f"   表的 owner migrator ", count_as("migrator"), "(还没 FORCE)")
with connect("migrator", autocommit=True) as mig:
    mig.execute("ALTER TABLE kb_chunks FORCE ROW LEVEL SECURITY")
print(f"   表的 owner migrator ", count_as("migrator"), "(加了 FORCE)")
print(f"   普通角色 agent_app  ", count_as("agent_app"))
print(f"   超级用户 {ADMIN:<8}", count_as(ADMIN), "(FORCE 对它也没用)")
```

<div class="line-notes">

- `FORGOT = "SELECT tenant_id, doc_id FROM kb_chunks WHERE content LIKE '%退款%' ORDER BY id"` 昨天的那个 bug 原样搬过来:按内容搜「退款」,没有租户条件。
- `def forgot_rows(role: str) -> list[tuple]:` 以指定角色连库,执行上面那条查询,返回结果。
- `row = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()` `count(*)` 数一共看到几行。表里一共 3 行,看到几行就说明这个身份被挡了多少。
- `assert row is not None` `fetchone()` 在没有结果时返回 `None`,类型检查器要求先排除。`count(*)` 永远有一行,所以这个断言不会触发。
- `print("1. 还没开 RLS,agent_app 忘了写 tenant_id:", forgot_rows("agent_app"))` 第一次:RLS 还没开。预期会看到两家的退款政策。
- `mig.execute("ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY")` 打开 RLS。只有表的 owner(或超级用户)能做这件事,所以用 `migrator`。注意:打开了 RLS 但还没有任何策略,默认是「全部拒绝」。
- `mig.execute("""CREATE POLICY tenant_isolation ON kb_chunks` 建一条叫 `tenant_isolation` 的策略,作用在 `kb_chunks` 上。
- `USING (tenant_id = current_setting('app.tenant_id', true))` `USING` 管**能看到哪些已有的行**:SELECT、UPDATE、DELETE 时,只有满足这个条件的行才可见。`current_setting(…, true)` 在变量没设置时返回 `NULL`。
- `WITH CHECK (tenant_id = current_setting('app.tenant_id', true))""")` `WITH CHECK` 管**能写进去什么样的行**:INSERT、UPDATE 之后的新值必须满足它。本节后面会专门试它不写会怎样。
- `conn.execute("SELECT set_config('app.tenant_id', 'maple', true)")` 设置会话变量。`set_config` 的第三个参数 `true` 表示只在当前事务内有效,事务结束自动失效。这一点下面有一个坑要专门演示。
- `print(f"   超级用户 {ADMIN:<8}", count_as(ADMIN))` 第四部分开始比较不同身份,没设租户时各看到几行。
- `mig.execute("ALTER TABLE kb_chunks FORCE ROW LEVEL SECURITY")` 让表的 owner 也受 RLS 约束。没有这一行,owner 默认不受任何策略限制。

</div>

```bash
uv run python part10/platform/rls_leak.py
```

```text
1. 还没开 RLS,agent_app 忘了写 tenant_id: [('yunbu', 'kb-002'), ('maple', 'kb-002')]
2. 开了 RLS,同一条查询:              []
3. 事务里先设租户 maple 再查:         [('maple', 'kb-002')]

4. 谁连库、没设租户,select count(*) 看到几行(表一共 3 行):
   超级用户 minliu   3
   表的 owner migrator  3 (还没 FORCE)
   表的 owner migrator  0 (加了 FORCE)
   普通角色 agent_app   0
   超级用户 minliu   3 (FORCE 对它也没用)
```

逐条读。第 1 行,没开 RLS,`agent_app` 忘了写租户条件,和昨天一样,两家的退款政策都出来了,云簿那条带着 VIP 的手机号。第 2 行,开了 RLS、同一条查询原样不动,结果是空列表,没有任何报错。第 3 行,事务里先设了租户 `maple`,同一条查询只返回 Maple 自己的那条。

第 4 部分是更值得记的:**RLS 是对「谁连库」有区别的**。表一共 3 行:

- **超级用户**(我这里是 `minliu`)看到 3 行。Postgres 文档写得很直接:超级用户和带 `BYPASSRLS` 属性的角色总是绕过行级安全。`FORCE` 对它也没用,最后一行再测一次仍是 3。
- **表的 owner**(`migrator`)在没加 `FORCE` 时也看到 3 行,表的 owner 默认不受策略约束。加了 `FORCE ROW LEVEL SECURITY` 以后变成 0 行。
- **普通角色** `agent_app` 是 0 行。

这三条合起来给出一条硬规矩:**应用连库必须用普通角色,不能用超级用户,也不能用建表的那个 owner 角色**。很多项目偷懒,迁移脚本和应用共用一个连接串,这个连接串通常是 owner 甚至超级用户,RLS 开了也是摆设。把「建表的角色」(`migrator`)和「运行应用的角色」(`agent_app`)分开,是打开 RLS 的第一步。

### 写入:WITH CHECK,和一个我以为会出的漏洞

读的方向通了,再看写。以 Maple 的身份,往云簿名下塞一行,会怎样?新建 `part10/platform/rls_write.py`,它分三块:写入被拦、策略少写 `WITH CHECK` 会怎样、连接池里的 `SET`:

```python
# agent-zero-lab/part10/platform/rls_write.py
"""两个坑:①只写 USING 不写 WITH CHECK 时能往别家写数据,写了之后被拦;②连接池里 SET 的租户会留在连接上。
用法:uv run python part10/platform/rls_write.py(接在 rls_leak.py 之后,RLS 已经打开)
"""
import psycopg

from pgconn import connect

FORGOT = "SELECT tenant_id, doc_id FROM kb_chunks ORDER BY id"
ADMIN_SQL = "SELECT tenant_id, doc_id FROM kb_chunks ORDER BY id"

print("== 写:以 maple 的身份,往 yunbu 的名下塞一行")
with connect("agent_app") as conn, conn.transaction():
    conn.execute("SELECT set_config('app.tenant_id', 'maple', true)")
    try:
        with conn.transaction():
            conn.execute("INSERT INTO kb_chunks (tenant_id, doc_id, content) VALUES ('yunbu', 'kb-099', '假的退款政策')")
    except psycopg.errors.InsufficientPrivilege as e:
        print("拦下了:", e)
    conn.execute("INSERT INTO kb_chunks (tenant_id, doc_id, content) VALUES ('maple', 'kb-003', 'Maple 新文章')")
    print("写自己的:成功,现在 maple 看到", conn.execute(FORGOT).fetchall())
    try:
        with conn.transaction():
            conn.execute("UPDATE kb_chunks SET tenant_id = 'yunbu' WHERE doc_id = 'kb-003'")
    except psycopg.errors.InsufficientPrivilege as e:
        print("把自己的行改成别家的:", e)
    raise psycopg.Rollback()                     # 主动回滚,演示数据不留下

print("\n== WITH CHECK 不写会怎样:换三种策略,都试一次「maple 往 yunbu 名下写」")
BAD_INSERT = "INSERT INTO kb_chunks (tenant_id, doc_id, content) VALUES ('yunbu', 'kb-098', '假的')"
POLICIES = {
    "只写 USING": "USING (tenant_id = current_setting('app.tenant_id', true))",
    "WITH CHECK (true)": "USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (true)",
    "USING 和 WITH CHECK 都写": "USING (tenant_id = current_setting('app.tenant_id', true)) "
                               "WITH CHECK (tenant_id = current_setting('app.tenant_id', true))",
}
with connect("migrator", autocommit=True) as mig:
    for name, clause in POLICIES.items():
        mig.execute("DROP POLICY tenant_isolation ON kb_chunks")
        mig.execute(f"CREATE POLICY tenant_isolation ON kb_chunks {clause}")
        try:
            with connect("agent_app") as app, app.transaction():
                app.execute("SELECT set_config('app.tenant_id', 'maple', true)")
                app.execute(BAD_INSERT)
                print(f"{name:<22} → 写进去了")
                raise psycopg.Rollback()
        except psycopg.errors.InsufficientPrivilege:
            print(f"{name:<22} → 被拦")

print("\n== 连接池:同一条连接先后服务两个请求")
conn = connect("agent_app", autocommit=True)     # autocommit:每条语句自己一个事务,模拟「拿到连接就是裸连接」
conn.execute("SET app.tenant_id = 'maple'")      # 请求 1:用会话级的 SET
print("请求 1 设了 maple,正常查   :", conn.execute(FORGOT).fetchall())
print("请求 2 拿到同一条连接,忘了设:", conn.execute(FORGOT).fetchall(), " ← 变成了 maple")
conn.execute("RESET app.tenant_id")
with conn.transaction():
    conn.execute("SELECT set_config('app.tenant_id', 'maple', true)")    # 请求 1 改用事务级
    print("\n请求 1 事务内查:", conn.execute(FORGOT).fetchall())
print("事务结束后,请求 2 忘了设:", conn.execute(FORGOT).fetchall(), "  当前值 =",
      conn.execute("SELECT current_setting('app.tenant_id', true)").fetchone())
conn.close()
```

<div class="line-notes">

- `import psycopg` 下面要捕获 `psycopg.errors` 里的异常,所以要直接导入。
- `with connect("agent_app") as conn, conn.transaction():` 一个 `with` 同时开两样:连接和连接上的事务。事务里 `set_config(..., true)` 设的变量,到 `with` 结束就失效。
- `conn.execute("SELECT set_config('app.tenant_id', 'maple', true)")` 以 Maple 的身份。
- `with conn.transaction():` 嵌套的事务(psycopg 会把它变成一个保存点)。里面的 INSERT 失败时,只回滚这一小段,外层事务还能继续用。不套这一层,第一次报错以后整个事务就中止了,后面的语句全都报 `current transaction is aborted`。
- `conn.execute("INSERT INTO kb_chunks (tenant_id, doc_id, content) VALUES ('yunbu', 'kb-099', '假的退款政策')")` Maple 想往云簿名下写一条假的退款政策。被 `WITH CHECK` 挡下,报 `new row violates row-level security policy for table "kb_chunks"`。
- `except psycopg.errors.InsufficientPrivilege as e:` RLS 违规在 psycopg 里是权限类错误。捕获后打印原文。
- `conn.execute("UPDATE kb_chunks SET tenant_id = 'yunbu' WHERE doc_id = 'kb-003'")` 另一条路:先写自己的一行,再把它的 `tenant_id` 改成别家的。UPDATE 之后的新值同样要过 `WITH CHECK`,所以同样被挡。
- `raise psycopg.Rollback()                     # 主动回滚,演示数据不留下` 在 `transaction()` 里抛 `Rollback`,事务回滚并且不向外报错。我第一版写的是 `conn.rollback()`,报了 `Explicit rollback() forbidden within a Transaction context`。
- `"只写 USING": "USING (tenant_id = current_setting('app.tenant_id', true))",` 三种策略写法之一:只有 `USING`。
- `"WITH CHECK (true)": "USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (true)",` 第二种:`WITH CHECK` 写成永远为真,等于「写什么都行」。
- `"USING 和 WITH CHECK 都写": "USING (tenant_id = current_setting('app.tenant_id', true)) "` 第三种:两个都写,和上一节一样。
- `mig.execute("DROP POLICY tenant_isolation ON kb_chunks")` 每换一种写法先删掉旧策略。DDL 在 `migrator` 的连接上做,所以不影响 `agent_app` 的权限。
- `mig.execute(f"CREATE POLICY tenant_isolation ON kb_chunks {clause}")` 把三段子句依次拼进去。`clause` 是上面写死的字符串,不来自用户输入,所以用 f-string 拼 SQL 是安全的。
- `print(f"{name:<22} → 写进去了")` 这一行只有策略允许写时才会执行。
- `conn = connect("agent_app", autocommit=True)     # autocommit:每条语句自己一个事务,模拟「拿到连接就是裸连接」` 下一块要演示连接池。这里用一条连接先后服务两个「请求」。
- `conn.execute("SET app.tenant_id = 'maple'")      # 请求 1:用会话级的 SET` 会话级的 `SET`,变量会一直留在这条连接上。
- `print("请求 2 拿到同一条连接,忘了设:", conn.execute(FORGOT).fetchall(), " ← 变成了 maple")` 请求 2 什么都没设,却看到了 Maple 的行,因为上一个请求的设置还挂在连接上。
- `conn.execute("RESET app.tenant_id")` 清掉会话级的设置,开始第二段实验。
- `conn.execute("SELECT set_config('app.tenant_id', 'maple', true)")    # 请求 1 改用事务级` 事务级的设置。
- `print("事务结束后,请求 2 忘了设:", conn.execute(FORGOT).fetchall(), "  当前值 =",` 事务结束后,请求 2 再忘了设,查到 0 行。后面一个查询把变量当前的值也打出来。

</div>

```bash
uv run python part10/platform/rls_write.py
```

```text
== 写:以 maple 的身份,往 yunbu 的名下塞一行
拦下了: new row violates row-level security policy for table "kb_chunks"
写自己的:成功,现在 maple 看到 [('maple', 'kb-002'), ('maple', 'kb-003')]
把自己的行改成别家的: new row violates row-level security policy for table "kb_chunks"

== WITH CHECK 不写会怎样:换三种策略,都试一次「maple 往 yunbu 名下写」
只写 USING               → 被拦
WITH CHECK (true)      → 写进去了
USING 和 WITH CHECK 都写  → 被拦

== 连接池:同一条连接先后服务两个请求
请求 1 设了 maple,正常查   : [('maple', 'kb-002')]
请求 2 拿到同一条连接,忘了设: [('maple', 'kb-002')]  ← 变成了 maple

请求 1 事务内查: [('maple', 'kb-002')]
事务结束后,请求 2 忘了设: []   当前值 = ('',)
```

先看第一块。往云簿名下塞一行:被拦,原文是 `new row violates row-level security policy for table "kb_chunks"`。写自己的一行成功。把自己的行改成别家的,同样被拦。

第二块是我写的时候改了认知的地方。**我原来以为:只写 `USING` 不写 `WITH CHECK`,租户 A 的代码就能插入一行 B 名下的数据**,很多文章都是这么说的。实测不是:三种写法里,只写 `USING` 也被拦了。Postgres 文档讲得清楚:`FOR ALL` 的策略如果只写了 `USING`,它会**隐式地同时当作 `WITH CHECK` 用**。真正会漏的是第二行:有人为了「写入放宽一点」把 `WITH CHECK` 写成了 `true`,这时 Maple 就真的把一行写进了云簿名下。所以今天的结论不是「必须写 `WITH CHECK`」,而是:**显式写出 `WITH CHECK`,让读和写的规则一眼能对上,以后谁想放宽也得改这一行,评审时看得见**。

第三块是连接池的坑。同一条连接先后服务两个请求。请求 1 用会话级的 `SET`,请求 2 忘了设租户,却看到了 Maple 的数据,因为变量还留在连接上。连接池恰好是这样用连接的:请求结束把连接还回池子,下一个请求拿到的是同一条,会话级的设置不会自动清掉。改成事务级的 `set_config(..., true)` 以后,事务一结束,变量就失效了,请求 2 忘了设再查是空列表。那一行「当前值 = ('',)」值得留意:变量曾经设置过,事务结束后它回到的是**空字符串**而不是 NULL,但空字符串不等于任何 `tenant_id`,所以结果同样是 0 行,仍然是「拒绝」。

### 应用层:租户从 API key 一路带到查询

数据库这一侧准备好了,应用那一侧还差一个连接:每个请求要把「我是谁」交给数据库。这里要用到 Python 的 `contextvars`。**ContextVar** 是「跟着当前请求走的变量」:同一个服务里同时处理很多请求,每个请求看到的是自己那份,互不干扰。前端同学对照一下 Node.js 的 `AsyncLocalStorage`,是同一个思路。普通的全局变量做不到,因为所有请求共用一个。

新建 `part10/platform/tenant_db.py`:

```python
# agent-zero-lab/part10/platform/tenant_db.py
"""应用层怎么把租户交给数据库:租户在入口从 API key 认出来,放进 contextvar;所有查询都走 tenant_tx(),
它在事务里用 set_config(..., true) 设好 app.tenant_id,再把连接交出去。拿不到租户就直接报错。
用法:uv run python part10/platform/tenant_db.py
uv add psycopg-pool
"""
import contextvars
from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg_pool import ConnectionPool

from pgconn import DB
from tenants import UnknownKey, resolve

current_tenant: contextvars.ContextVar[str] = contextvars.ContextVar("current_tenant")

# 连接池只放 1 条连接,逼两个请求共用它,这样「连接复用会不会串租户」一眼就能看出来
pool = ConnectionPool(conninfo=f"host=localhost dbname={DB} user=agent_app", min_size=1, max_size=1, open=True)


@contextmanager
def tenant_tx() -> Iterator[psycopg.Connection]:
    tenant = current_tenant.get()                 # 没设置会抛 LookupError,不会默默变成「查全部」
    with pool.connection() as conn, conn.transaction():
        conn.execute("SELECT set_config('app.tenant_id', %s, true)", (tenant,))
        yield conn


def search_chunks(word: str) -> list[tuple]:
    with tenant_tx() as conn:
        # 故意不写 tenant_id:租户条件由 RLS 加
        return conn.execute("SELECT doc_id, content FROM kb_chunks WHERE content LIKE %s ORDER BY id",
                            (f"%{word}%",)).fetchall()


def handle(api_key: str, word: str) -> None:
    """模拟一个请求:认租户 → 设 contextvar → 查询。"""
    try:
        current_tenant.set(resolve(api_key).org)
    except UnknownKey as e:
        print(f"{api_key:<17} → 拒绝:{e}")
        return
    with tenant_tx() as conn:
        pid = conn.execute("SELECT pg_backend_pid()").fetchone()
    print(f"{api_key:<17} → 连接 pid {pid[0] if pid else '?'}  {search_chunks(word)}")


if __name__ == "__main__":
    handle("sk-maple-support", "退款")
    handle("sk-yunbu-support", "退款")
    handle("sk-guess", "退款")
    print("\n没有 resolve 就直接查(模拟某条代码路径忘了认租户):")
    ctx = contextvars.Context()                    # 一个全新的、什么都没设的上下文
    try:
        ctx.run(search_chunks, "退款")
    except LookupError:
        print("  LookupError:当前请求没有租户,拒绝查询")
    pool.close()
```

<div class="line-notes">

- `import contextvars` 标准库。
- `from psycopg_pool import ConnectionPool` 连接池:提前建好几条连接放着,请求来了借一条,用完还回去,省得每次都重新握手。对照 JS 里 `pg` 库的 `Pool`。
- `current_tenant: contextvars.ContextVar[str] = contextvars.ContextVar("current_tenant")` 声明一个上下文变量,值的类型是字符串,没有默认值。没设置过就去 `get()`,会抛 `LookupError`。
- `pool = ConnectionPool(conninfo=f"host=localhost dbname={DB} user=agent_app", min_size=1, max_size=1, open=True)` 池子最小最大都是 1,所以两个请求只能轮流用同一条连接。真实服务里不会这么小,这里故意用它,让「连接复用会不会串租户」一眼能看出来。连的是 `agent_app`,不是超级用户。
- `@contextmanager` [Day 98](/blog/agent-zero/day-098-context-managers/) 学过:把一个带 `yield` 的函数变成能用在 `with` 里的东西。
- `tenant = current_tenant.get()                 # 没设置会抛 LookupError,不会默默变成「查全部」` 拿租户。这是整个设计的另一个关键:认不出租户就直接报错,而不是退回一个默认值。
- `with pool.connection() as conn, conn.transaction():` 借一条连接,开一个事务,离开时事务提交(或回滚),连接还回池子。
- `conn.execute("SELECT set_config('app.tenant_id', %s, true)", (tenant,))` 事务级设置租户。`%s` 是 psycopg 的参数占位符,和 SQLite 的 `?` 作用一样,租户的值不会被当成 SQL 的一部分。
- `yield conn` 把设好了租户的连接交给 `with` 里面的代码。
- `# 故意不写 tenant_id:租户条件由 RLS 加` 这条查询里没有 `tenant_id`。生产里我仍然建议显式写上,理由在下面 EXPLAIN 之后说。
- `current_tenant.set(resolve(api_key).org)` 模拟入口处:从 key 认出租户,把 `org` 放进上下文变量。真实的 FastAPI 里这一行在鉴权依赖或中间件里。
- `except UnknownKey as e:` 昨天的自定义异常,key 不认识就直接拒绝,连数据库都不碰。
- `pid = conn.execute("SELECT pg_backend_pid()").fetchone()` 取这条连接在 Postgres 服务端的进程号。两个请求打印出同一个 pid,就证明它们真的复用了同一条连接。
- `ctx = contextvars.Context()                    # 一个全新的、什么都没设的上下文` 模拟某条代码路径根本没经过认租户那一步。
- `ctx.run(search_chunks, "退款")` 在这个空上下文里调用查询函数。`current_tenant.get()` 找不到值,抛 `LookupError`。

</div>

```bash
uv run python part10/platform/tenant_db.py
```

```text
sk-maple-support  → 连接 pid 42892  [('kb-002', 'Maple 退款政策:一律不退,可转为下期抵扣。')]
sk-yunbu-support  → 连接 pid 42892  [('kb-002', '云簿退款政策:年付 30 天内可全额退款。VIP 客户张三 13812345678 已特批延长到 60 天。')]
sk-guess          → 拒绝:不认识的 API key

没有 resolve 就直接查(模拟某条代码路径忘了认租户):
  LookupError:当前请求没有租户,拒绝查询
```

三行请求里,前两行 pid 相同,同一条连接先服务 Maple、再服务云簿,各自只看到自己的那条退款政策,云簿的 VIP 手机号没有出现在 Maple 的结果里。第三行是瞎猜的 key,认证这一步就拒绝了。最后一段是「忘了认租户」的代码路径:直接 `LookupError`。**宁可让它在测试里炸,也不要让它悄悄查全部。**

### 看一眼 RLS 到底加了什么

策略不是魔法,它真的被加进了查询计划。新建 `part10/platform/rls_explain.py`:

```python
# agent-zero-lab/part10/platform/rls_explain.py
"""看一眼 RLS 是怎么「自动加条件」的:同一条查询,以不同身份 EXPLAIN。
用法:uv run python part10/platform/rls_explain.py
"""
from pgconn import ADMIN, connect

SQL = "EXPLAIN SELECT doc_id FROM kb_chunks WHERE doc_id = 'kb-002'"

for role in (ADMIN, "agent_app"):
    with connect(role) as conn, conn.transaction():
        conn.execute("SELECT set_config('app.tenant_id', 'maple', true)")
        print(f"== 以 {role} 的身份")
        for (line,) in conn.execute(SQL).fetchall():
            print("  ", line)
```

<div class="line-notes">

- `SQL = "EXPLAIN SELECT doc_id FROM kb_chunks WHERE doc_id = 'kb-002'"` 查询里只有 `doc_id` 条件,没有 `tenant_id`。`EXPLAIN` 让 Postgres 不执行、只打印它打算怎么执行([Day 89](/blog/agent-zero/day-089-sql-5/) 学过)。
- `for role in (ADMIN, "agent_app"):` 同一条查询,两种身份各看一次。
- `for (line,) in conn.execute(SQL).fetchall():` 每行结果只有一列,`(line,)` 直接把那一列拆出来。

</div>

```bash
uv run python part10/platform/rls_explain.py
```

```text
== 以 minliu 的身份
   Seq Scan on kb_chunks  (cost=0.00..17.62 rows=3 width=32)
     Filter: (doc_id = 'kb-002'::text)
== 以 agent_app 的身份
   Index Only Scan using kb_chunks_tenant_id_doc_id_idx on kb_chunks  (cost=0.15..8.17 rows=1 width=32)
     Index Cond: ((tenant_id = current_setting('app.tenant_id'::text, true)) AND (doc_id = 'kb-002'::text))
```

超级用户的计划只有一个 `doc_id` 过滤,因为它绕过了策略。`agent_app` 的计划多了 `tenant_id = current_setting('app.tenant_id', true)`,而且这个条件和 `doc_id` 一起落在了 `(tenant_id, doc_id)` 那个复合索引上,变成 `Index Only Scan`。策略的条件可以用上索引,这是我建议策略写成简单的 `tenant_id = 某个值` 的原因:Postgres 文档也说,只看当前行的值的策略是最简单、性能最好的写法。

这也是为什么我仍然建议应用层的查询**显式写上 `tenant_id`**:RLS 是兜底,不是替代。显式写,代码读起来意图清楚,查询计划也更稳;兜底在你忘了的那一次才起作用。

### 体检:每一张带 tenant_id 的表都开了 RLS 吗

RLS 是**按表**打开的。昨天说过,新表很容易漏。今天你新增了 `traces` 表,有 `tenant_id` 列,但谁也没记得给它开 RLS,这张表就是裸的。下面写一个体检脚本,可以直接接进 CI。新建 `part10/platform/rls_audit.py`:

```python
# agent-zero-lab/part10/platform/rls_audit.py
"""体检:库里凡是带 tenant_id 列的表,是不是都开了 RLS、加了 FORCE、至少有一条策略。有一张不合格就退出码 1,可以接进 CI。
用法:uv run python part10/platform/rls_audit.py
"""
import sys

from pgconn import ADMIN, connect

AUDIT = """
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, count(p.polname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY c.relname
"""

if __name__ == "__main__":
    bad = 0
    with connect(ADMIN) as conn:
        for name, rls, force, n_policy in conn.execute(AUDIT).fetchall():
            problems = [msg for ok, msg in ((rls, "没开 RLS"), (force, "没加 FORCE"), (n_policy > 0, "没有策略")) if not ok]
            print(f"{'不合格' if problems else '合格  '} {name:<10} rls={rls} force={force} 策略 {n_policy} 条  {'、'.join(problems)}")
            bad += bool(problems)
    sys.exit(1 if bad else 0)
```

<div class="line-notes">

- `JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'` `pg_class` 是 Postgres 的系统表,每张表、索引、序列都有一行;`pg_namespace` 是 schema 列表。这一行把范围限定在 `public`。
- `JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped` `pg_attribute` 是列的清单。只留下有 `tenant_id` 这一列的表,并且这列没被删掉过(`attisdropped`)。
- `LEFT JOIN pg_policy p ON p.polrelid = c.oid` 左连接策略表:有策略的表会匹配出行,没有策略的表也保留,只是 `polname` 为空。
- `WHERE c.relkind = 'r'` `r` 表示普通表,排除索引、视图、序列。
- `GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity` 每张表一行,`count(p.polname)` 是策略条数,`relrowsecurity` 是有没有开 RLS,`relforcerowsecurity` 是有没有加 FORCE。
- `problems = [msg for ok, msg in ((rls, "没开 RLS"), (force, "没加 FORCE"), (n_policy > 0, "没有策略")) if not ok]` 三项检查各配一句说明,没通过的留下。
- `bad += bool(problems)` 有问题就加一。`bool([])` 是 `False`,`bool(["…"])` 是 `True`,相当于 JS 里 `problems.length > 0`。
- `sys.exit(1 if bad else 0)` 有不合格的表,退出码是 1。CI 看退出码就能判断过不过。

</div>

```bash
uv run python part10/platform/rls_audit.py
```

```text
合格   kb_chunks  rls=True force=True 策略 1 条
```

现在只有一张表,通过。模拟「有人新建了 `traces` 表却没开 RLS」:

```bash
psql -U migrator -d agentzero_platform -c "CREATE TABLE traces (id bigserial primary key, tenant_id text not null, payload text); GRANT SELECT,INSERT ON traces TO agent_app;"
uv run python part10/platform/rls_audit.py
echo "退出码 $?"
```

```text
合格   kb_chunks  rls=True force=True 策略 1 条  
不合格 traces     rls=False force=False 策略 0 条  没开 RLS、没加 FORCE、没有策略
```

退出码是 1,CI 就会红。这个体检不能保证策略的内容写对,但能保证「没有哪张含租户数据的表被漏掉」,而漏表是真实世界里最常见的那种错误。把它加进 CI 的做法放在练习 1:顺手把 `traces` 补上。

### 回头看 bridge:每个租户一个 schema

前面答应过,把 bridge 在数据库里的常见做法也看一眼。在同一个库里,每个租户一个 schema,里面各有一份同名的表,路由靠 `search_path`(Postgres 找不带 schema 前缀的表名时的查找顺序)。新建 `part10/platform/schema_per_tenant.py`:

```python
# agent-zero-lab/part10/platform/schema_per_tenant.py
"""bridge 的一种长相:同一个数据库,每个租户一个 schema,里面各有一份同名的表。路由靠 search_path。
用法:uv run python part10/platform/schema_per_tenant.py(需要先跑过 rls_setup.py,用到 migrator 和 agent_app 两个角色)
"""
import psycopg
from psycopg import sql

from pgconn import ADMIN, connect

TENANTS = ["yunbu", "maple"]

with connect(ADMIN, autocommit=True) as admin:
    admin.execute("GRANT CREATE ON DATABASE agentzero_platform TO migrator")
with connect("migrator", autocommit=True) as mig:
    for t in TENANTS:
        schema = sql.Identifier(f"t_{t}")             # 当成标识符拼进去,会自动加引号,不会被当成 SQL 的一部分
        mig.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(schema))
        mig.execute(sql.SQL("CREATE SCHEMA {}").format(schema))
        mig.execute(sql.SQL("CREATE TABLE {}.faq (id bigserial PRIMARY KEY, doc_id text, content text)").format(schema))
        mig.execute(sql.SQL("INSERT INTO {}.faq (doc_id, content) VALUES ('kb-002', %s)").format(schema), (f"{t} 的退款政策",))
        mig.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO agent_app").format(schema))
        mig.execute(sql.SQL("GRANT SELECT ON {}.faq TO agent_app").format(schema))

    print("库里现在有这些租户表:", mig.execute(
        "SELECT table_schema || '.' || table_name FROM information_schema.tables "
        "WHERE table_schema LIKE 't\\_%' ORDER BY 1").fetchall())

    for t in TENANTS:                                 # 加一列:每个 schema 都要来一遍
        mig.execute(sql.SQL("ALTER TABLE {}.faq ADD COLUMN lang text DEFAULT 'zh'").format(sql.Identifier(f"t_{t}")))
    print(f"加一列 lang:执行了 {len(TENANTS)} 次 ALTER TABLE(pool 模式只要 1 次)")

SQL = "SELECT doc_id, content FROM faq"        # 同一条 SQL,不写 schema
for t in TENANTS:
    with connect("agent_app") as app, app.transaction():
        app.execute("SELECT set_config('search_path', %s, true)", (f"t_{t}",))
        print(f"search_path = t_{t}  →", app.execute(SQL).fetchall())

with connect("agent_app") as app:
    try:
        app.execute(SQL)
    except psycopg.errors.UndefinedTable as e:
        print("忘了设 search_path   →", str(e).splitlines()[0])

with connect(ADMIN, autocommit=True) as admin:        # 收拾干净,后面的演示不受影响
    for t in TENANTS:
        admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(f"t_{t}")))
```

<div class="line-notes">

- `admin.execute("GRANT CREATE ON DATABASE agentzero_platform TO migrator")` 在库里建 schema 需要库级别的 `CREATE` 权限,`migrator` 之前没有。
- `schema = sql.Identifier(f"t_{t}")             # 当成标识符拼进去,会自动加引号,不会被当成 SQL 的一部分` 每个租户一个 schema,名字 `t_yunbu`、`t_maple`。schema 名是标识符,不能用 `%s`,要用 `sql.Identifier` 拼。
- `mig.execute(sql.SQL("CREATE TABLE {}.faq (id bigserial PRIMARY KEY, doc_id text, content text)").format(schema))` 两个 schema 里各有一张 `faq` 表,结构相同。表名故意不用 `kb_chunks`,理由在最后一个 `except` 那一条。
- `mig.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO agent_app").format(schema))` 应用角色要先有 schema 的使用权,才能访问里面的表。
- `"WHERE table_schema LIKE 't\\_%' ORDER BY 1").fetchall())` `LIKE` 里下划线是通配符,要写成 `\_` 才表示字面的下划线。Python 字符串里反斜杠又要再写一次,所以是 `\\_`。
- `mig.execute(sql.SQL("ALTER TABLE {}.faq ADD COLUMN lang text DEFAULT 'zh'").format(sql.Identifier(f"t_{t}")))` 加一列:每个 schema 都要执行一遍。2 个租户是 2 次,50 个租户是 50 次,而且要保证每次都成功。pool 模式只需要 1 次。这是 schema 方案最大的运维成本。
- `app.execute("SELECT set_config('search_path', %s, true)", (f"t_{t}",))` 事务级设置 `search_path`,这次是值,可以用 `%s`。同一条 `SELECT doc_id, content FROM faq` 随后就落到不同租户的 schema 里。
- `except psycopg.errors.UndefinedTable as e:` 没设置 `search_path` 时,`faq` 找不到,报 `relation "faq" does not exist`。这是 schema 方案天然的「忘了设置就拒绝」,和 RLS 殊途同归。要是表名取了 `kb_chunks`,`public` 里也有同名的表,查询不会报错,而是悄悄查到 `public` 那张(被 RLS 挡成 0 行),反而更难发现问题,所以起名时要避开。
- `admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(f"t_{t}")))` 收拾干净,不影响后面的演示。

</div>

```bash
uv run python part10/platform/schema_per_tenant.py
```

```text
库里现在有这些租户表: [('t_maple.faq',), ('t_yunbu.faq',)]
加一列 lang:执行了 2 次 ALTER TABLE(pool 模式只要 1 次)
search_path = t_yunbu  → [('kb-002', 'yunbu 的退款政策')]
search_path = t_maple  → [('kb-002', 'maple 的退款政策')]
忘了设 search_path   → relation "faq" does not exist
```

schema 方案把租户拆在不同的表里,「忘了写租户条件」这类错误基本不可能发生。但代价在第二行:改一次表结构要执行 N 次,租户多了迁移就是一场噩梦,每个 schema 还要单独建索引、单独占统计信息。这就是为什么我把它放在 bridge,适合租户少、结构稳定、想要比 RLS 更硬的物理分隔的场景,租户上百以后一般就不用它了。

### RLS 管不到的地方

最后要泼一盆冷水。RLS 只管 Postgres 里的那张表。你的系统里还有这些地方不在它的保护范围里:

- 独立的向量库(Milvus、Qdrant)、搜索引擎(Elasticsearch):要用它们自己的 collection、partition 或 payload 过滤做隔离,而且同样要在一个统一的数据访问层里**强制**加上租户条件,不能让业务代码拿着客户端直接去查。
- Redis 等缓存:key 里要有租户(今天最前面的 `cache_leak.py`)。
- 对象存储里的文件、trace 平台、日志:按租户分前缀、分项目,或者在写入时就打上租户标签、查询时强制带。
- 备份和分析库:数据拷出去以后,RLS 的策略不会跟着走。分析用的只读库经常是超级用户在连,谁都能看到所有租户。

另外,Postgres 文档里还提了几条要知道的限制:唯一约束、外键这类完整性检查是**绕过 RLS** 的,所以可能通过报错信息探测到别的租户有没有某个值,属于「隐蔽通道」;策略里写子查询(比如去另一张表查「这个用户属于哪些租户」)在默认的 READ COMMITTED 隔离级别下可能有竞态,性能也差。**策略保持「只看当前行的值」,租户 id 来自会话变量,是最简单也最稳的写法。**

### 零件和今天的位置

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| 从 API key 认出租户 | Day 583 | `tenant_db.py` 的 `handle` 里 `resolve(api_key).org` |
| 自定义异常 | Day 583 | `ModelNotAllowed`、`UnknownKey` |
| frozen dataclass | Day 50、Day 583 | `Policy`、`TenantConfig` |
| 参数占位符 | Day 92 | `tenant_db.py` 的 `%s`(psycopg 版的 `?`) |
| `with` 和 `@contextmanager` | Day 98 | `tenant_tx` |
| `EXPLAIN` | Day 89 | `rls_explain.py` |
| 事务 | Day 91 | `rls_write.py` 里 `conn.transaction()` |
| Postgres 和 psycopg | Day 228 | `pgconn.py` |
| 哈希 | Day 582 的 sha256 清单 | 对照 `byok.py` 的 Fernet:哈希不能还原,加密能 |

## 动手练习

练习 1 到 3 在 `agent-zero-lab` 根目录运行。练习 4 在 psql 里做。练习 5 是开放题。

1. **把 traces 补上,让体检通过。** 上面体检报出 `traces` 表不合格。写一个脚本给它开 RLS、加 FORCE、建策略、给序列授权,最后自己再跑一遍体检。

<details><summary>参考答案</summary>

新建 `part10/platform/fix_traces.py`:

```python
# agent-zero-lab/part10/platform/fix_traces.py
"""给 traces 表补上 RLS(开、FORCE、加策略、授权),再跑一遍体检。
用法:uv run python part10/platform/fix_traces.py
"""
import subprocess
import sys
from pathlib import Path

from pgconn import connect

with connect("migrator", autocommit=True) as mig:
    mig.execute("ALTER TABLE traces ENABLE ROW LEVEL SECURITY")
    mig.execute("ALTER TABLE traces FORCE ROW LEVEL SECURITY")
    mig.execute("""CREATE POLICY tenant_isolation ON traces
                   USING (tenant_id = current_setting('app.tenant_id', true))
                   WITH CHECK (tenant_id = current_setting('app.tenant_id', true))""")
    mig.execute("GRANT USAGE ON SEQUENCE traces_id_seq TO agent_app")
sys.exit(subprocess.run([sys.executable, str(Path(__file__).with_name("rls_audit.py"))]).returncode)
```

<div class="line-notes">

- `from pathlib import Path` 下面要用脚本自己的位置去找兄弟文件。
- `with connect("migrator", autocommit=True) as mig:` 改表结构必须是表的 owner,用 `migrator`。应用角色没有这个权限,这是故意的。
- `mig.execute("ALTER TABLE traces ENABLE ROW LEVEL SECURITY")` 打开 RLS。
- `mig.execute("ALTER TABLE traces FORCE ROW LEVEL SECURITY")` 加 FORCE,让 owner 也受约束。体检脚本要求这一项。
- `mig.execute("""CREATE POLICY tenant_isolation ON traces` 和 `kb_chunks` 同样的一条策略,读写都显式写出。
- `mig.execute("GRANT USAGE ON SEQUENCE traces_id_seq TO agent_app")` 前面建表时只授了 `SELECT, INSERT`,但 `bigserial` 的序列没授权,应用一插入就报权限错误。补上。
- `sys.exit(subprocess.run([sys.executable, str(Path(__file__).with_name("rls_audit.py"))]).returncode)` 用同一个 Python 解释器去跑体检脚本,把它的退出码当成自己的。我第一版写的是 `"part10/platform/rls_audit.py"` 这样的相对路径,在 `part10` 目录里运行就找不到文件,改成按脚本自己的位置找就和当前目录无关了。

</div>

```bash
uv run python part10/platform/fix_traces.py
```

```text
合格   kb_chunks  rls=True force=True 策略 1 条  
合格   traces     rls=True force=True 策略 1 条
```

两张表都合格了。把这一行放进 CI 的流程里,新表忘了开 RLS 就会红灯,不用等人在评审里发现。

</details>

2. **云簿批处理的量变了,Maple 受多大影响。** 把云簿的请求数分别改成 100、300、1000,Maple 固定 20 个。对比有租户配额(每家 60 个)和没有的两种情况,看 Maple 的 20 个请求成功几个。

<details><summary>参考答案</summary>

新建 `part10/platform/noisy_sweep.py`,把 `noisy_neighbor.py` 的模拟收成一个函数,云簿的请求数当参数:

```python
# agent-zero-lab/part10/platform/noisy_sweep.py
"""练习 2:云簿的批处理发 100、300、1000 个请求时,Maple 的 20 个请求能成功几个?有租户配额和没有各一遍。
用法:uv run python part10/platform/noisy_sweep.py
"""
import random

PROVIDER_LIMIT, PER_TENANT_LIMIT = 100, 60


def maple_success(yunbu_n: int, quota: bool) -> int:
    rng = random.Random(584)
    arrivals = sorted([(rng.uniform(0, 60), "yunbu") for _ in range(yunbu_n)] +
                      [(rng.uniform(0, 60), "maple") for _ in range(20)])
    seen = {"yunbu": 0, "maple": 0}
    passed = ok = 0
    for _, tenant in arrivals:
        if quota and seen[tenant] >= PER_TENANT_LIMIT:
            continue
        seen[tenant] += 1
        if passed < PROVIDER_LIMIT:
            passed += 1
            ok += tenant == "maple"
    return ok


for n in (100, 300, 1000):
    print(f"云簿发 {n:>4} 个:Maple 成功 没配额 {maple_success(n, False):>2}/20   有配额 {maple_success(n, True):>2}/20")
```

<div class="line-notes">

- `PROVIDER_LIMIT, PER_TENANT_LIMIT = 100, 60` 和 `noisy_neighbor.py` 同样的两个常数。
- `def maple_success(yunbu_n: int, quota: bool) -> int:` 参数是云簿发多少个,以及有没有开租户配额;返回 Maple 成功了几个。
- `rng = random.Random(584)` 用独立的随机数发生器而不是全局的 `random.seed`,每次调用都从同一个种子开始,所以三个云簿请求量下,Maple 的到达时刻是一样的,变的只有云簿那边。
- `arrivals = sorted([(rng.uniform(0, 60), "yunbu") for _ in range(yunbu_n)] +` 云簿发 `yunbu_n` 个。
- `seen = {"yunbu": 0, "maple": 0}` 这次只有两个租户,直接用普通字典记各自放行了几个。
- `if quota and seen[tenant] >= PER_TENANT_LIMIT:` 开了配额且这家已经满 60 个,直接丢掉,不占供应商额度。`continue` 跳到下一个请求。
- `ok += tenant == "maple"` 布尔值能直接加到整数上(`True` 是 1),所以这一行是「如果是 Maple 的请求就加 1」。

</div>

```bash
uv run python part10/platform/noisy_sweep.py
```

```text
云簿发  100 个:Maple 成功 没配额 16/20   有配额 20/20
云簿发  300 个:Maple 成功 没配额  7/20   有配额 20/20
云簿发 1000 个:Maple 成功 没配额  1/20   有配额 20/20
```

没有配额时,云簿的量越大,Maple 越吃亏:发 100 个时 Maple 还有 16 个成功,发 300 个降到 7 个,发 1000 个只剩 1 个,而 Maple 自己的流量一点没变。有了租户配额,不管云簿发多少,Maple 的 20 个都成功,云簿多出来的部分在平台入口就被挡下了。

</details>

3. **给回退链写测试。** 用 pytest 给 `model_policy.py` 写四个测试:Maple 直接请求 `deepseek-v4-pro` 被拒;回退链上不管哪几个模型挂了,Maple 拿到的都只能是 `qwen-local`;所有可用模型都挂了就拒绝;云簿主模型挂了会按顺序退到 `deepseek-flash`。

<details><summary>参考答案</summary>

测试文件放在 `tests/` 下,但 `model_policy.py` 在 `part10/platform/`,pytest 默认找不到它。先在 `pyproject.toml` 里加一段,告诉 pytest 多去哪里找模块([Day 71](/blog/agent-zero/day-071-pytest-1/) 讲过 pytest 配置):

```toml
[tool.pytest.ini_options]
pythonpath = ["part10/platform"]
```

新建 `tests/test_model_policy.py`:

```python
# agent-zero-lab/tests/test_model_policy.py
import pytest

from model_policy import ModelNotAllowed, check, pick_model


def test_maple_cannot_use_deepseek():
    with pytest.raises(ModelNotAllowed):
        check("maple", "deepseek-v4-pro")


def test_fallback_never_leaves_allowed_set():
    for outages in (set(), {"deepseek-v4-pro"}, {"deepseek-v4-pro", "deepseek-flash"}):
        assert pick_model("maple", outages) == "qwen-local"


def test_no_model_left_raises():
    with pytest.raises(ModelNotAllowed):
        pick_model("maple", {"qwen-local"})


def test_yunbu_falls_back_in_order():
    assert pick_model("yunbu", {"deepseek-v4-pro"}) == "deepseek-flash"
```

<div class="line-notes">

- `import pytest` 用它的 `raises` 断言「这里应该抛异常」。
- `def test_maple_cannot_use_deepseek():` pytest 会收集所有 `test_` 开头的函数。
- `with pytest.raises(ModelNotAllowed):` 里面的代码必须抛出 `ModelNotAllowed`,没抛就算测试失败。相当于 jest 的 `expect(() => ...).toThrow(...)`。
- `for outages in (set(), {"deepseek-v4-pro"}, {"deepseek-v4-pro", "deepseek-flash"}):` 三种「挂了哪些」的情况:都没挂、挂一个、挂两个。`set()` 是空集合(`{}` 在 Python 里是空字典,不是空集合)。
- `assert pick_model("maple", outages) == "qwen-local"` 不管回退链怎么走,Maple 只能拿到允许的那一个。
- `pick_model("maple", {"qwen-local"})` 唯一允许的本地模型也挂了,期望拒绝,不是悄悄退到一个不允许的模型。
- `assert pick_model("yunbu", {"deepseek-v4-pro"}) == "deepseek-flash"` 云簿没有限制,主模型挂了,退到链上的下一个。

</div>

```bash
uv run pytest tests/test_model_policy.py -q
```

```text
....                                                                     [100%]
4 passed in 0.02s
```

四个都过。第二个测试是最值得保留的那一个:它把「回退不能越过租户策略」这条规矩变成了会红的东西。以后有人改回退链(加一个新模型进去),这个测试会替你盯着。

</details>

4. **观察会发生什么:只给 SELECT 建策略。** 在 psql 里以 `migrator` 的身份建一张新表 `ex4`,打开 RLS,只建一条 `FOR SELECT` 的策略,给 `agent_app` 授 `SELECT, INSERT`。然后以 `agent_app` 的身份,先设租户 maple,再 INSERT 一行,猜一猜会怎样,再试。

<details><summary>参考答案</summary>

```bash
psql -U migrator -d agentzero_platform <<'SQL'
CREATE TABLE ex4 (tenant_id text);
ALTER TABLE ex4 ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON ex4 TO agent_app;
CREATE POLICY only_select ON ex4 FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true));
SQL
psql -U agent_app -d agentzero_platform -c "begin; select set_config('app.tenant_id','maple',true); insert into ex4 values ('maple'); rollback;"
psql -U migrator -d agentzero_platform -c "DROP TABLE ex4"
```

实跑里最后一步输出的是:

```text
ERROR:  new row violates row-level security policy for table "ex4"
```

连 Maple 自己的一行也写不进去。原因是:开了 RLS 的表,**每一种命令都要有一条适用的策略,没有就默认拒绝**。`FOR SELECT` 的策略只管读,INSERT 没有策略可用,就被拒绝了。反过来说,如果你想让某个角色只读,只建一条 `FOR SELECT` 策略就够了,其余命令自动是禁止的。我们今天用的 `FOR ALL`(不写 `FOR` 时的默认值)一条策略同时管所有命令。

</details>

5. **用你自己的数字重算粗账(开放题)。** `deploy_modes.py` 里的五个常量都是假设。写一个脚本,算出租户数到几个时全 silo 比全 pool 贵,再把升级的人力(假设工程师每小时折 200 元、每月给每套集群升 2 次级)折成钱加进去重算。最后说一句:你的结论对哪个假设最敏感?

<details><summary>参考答案</summary>

新建 `part10/platform/break_even.py`:

```python
# agent-zero-lab/part10/platform/break_even.py
"""练习 5:租户多到几个时,全 silo 比全 pool 贵?再把「升级人力」折成钱(每小时 200 元,每月升 2 次)重算一遍。
用法:uv run python part10/platform/break_even.py
"""
from deploy_modes import monthly

HOURLY, UPGRADES_PER_MONTH = 200, 2          # 假设:工程师每小时折 200 元,每月给每套集群升 2 次级


def total(n: int, n_silo: int) -> float:
    cost, minutes = monthly(n, n_silo)
    return cost + minutes / 60 * HOURLY * UPGRADES_PER_MONTH


for label, with_labor in (("只算云账单", False), ("加上升级人力", True)):
    n = 1
    while (total(n, n) if with_labor else monthly(n, n)[0]) <= (total(n, 0) if with_labor else monthly(n, 0)[0]):
        n += 1
    print(f"{label}:从 {n} 个租户起,全 silo 比全 pool 贵")
print(f"检查:n=2 时 全 silo ¥{total(2, 2):.0f}  全 pool ¥{total(2, 0):.0f}(含人力)")
```

<div class="line-notes">

- `from deploy_modes import monthly` 直接用今天的 `deploy_modes.py`,不复制第二份算式。
- `HOURLY, UPGRADES_PER_MONTH = 200, 2          # 假设:工程师每小时折 200 元,每月给每套集群升 2 次级` 两个新的假设。
- `cost, minutes = monthly(n, n_silo)` `monthly` 返回(云成本, 升一轮的分钟数),拆开接。
- `return cost + minutes / 60 * HOURLY * UPGRADES_PER_MONTH` 把分钟折成小时,乘每小时的价格,再乘每月升级次数,和云成本相加。代入 `total(2, 2)`:云成本 1200,分钟 40,人力 40 ÷ 60 × 200 × 2 ≈ 267,合计约 1467。
- `while (total(n, n) if with_labor else monthly(n, n)[0]) <= (total(n, 0) if with_labor else monthly(n, 0)[0]):` 从 n=1 往上加,只要全 silo 还不比全 pool 贵就继续。两边各有一个条件表达式,决定要不要算人力。
- `print(f"{label}:从 {n} 个租户起,全 silo 比全 pool 贵")` 循环停下的那个 n 就是临界点。

</div>

```bash
uv run python part10/platform/break_even.py
```

```text
只算云账单:从 3 个租户起,全 silo 比全 pool 贵
加上升级人力:从 3 个租户起,全 silo 比全 pool 贵
检查:n=2 时 全 silo ¥1467  全 pool ¥1693(含人力)
```

按我的这组假设,两种算法的临界点都是 3 个租户:2 个租户时全 silo 反而便宜,到 3 个就倒过来了。把人力加进去并没有改变临界点,是因为这组假设下云账单的差距已经够大了。对哪个假设最敏感?答案是 `SMALL_CLUSTER`(给单个租户开的最小一套要多少钱):它每个租户都乘一遍。你的云上要是能把一套最小集群压到几十块钱(比如用共享的小规格实例),全 silo 的临界点会推得很远;反过来,每个租户都要一整套数据库加 worker 加监控,临界点就是 2。所以别记我算出来的 3,记这个算式的形状:silo 的成本随租户数线性涨,pool 的底子是固定的、边际成本很低。

</details>

验收标准:体检脚本在含 `tenant_id` 的表都合格时返回 0;`tests/test_model_policy.py` 四个测试全绿;你能不看文章,在 psql 里手写出一条带 `USING` 和 `WITH CHECK` 的策略,并说出超级用户、表的 owner、会话级 `SET` 这三种会让它失效的情形。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 隔离维度 | 租户之间要分开的几个方面:数据、配额、密钥、模型。每个维度各有一道门 |
| 吵闹的邻居(noisy neighbor) | 一个租户用掉共享额度,让别的租户跟着变慢或报错。例:云簿的批处理让 Maple 吃 429 |
| BYOK | bring your own key,租户自带供应商 key,平台代为调用。要加密存放,日志里要打码 |
| 对称加密 | 同一把密钥既能加密又能解密,存了以后还要还原的东西(如租户 key)用它;哈希是单向的,不能还原 |
| Fernet | Python `cryptography` 库里的一种对称加密方案,自带时间戳和篡改检测 |
| silo | 每个租户一整套独立资源,隔离最强,成本和运维随租户数线性增长 |
| pool | 所有租户共用一套资源,靠 `tenant_id` 和数据库行级安全隔离,最省钱 |
| bridge | silo 和 pool 混用:按资源类型(计算共享、数据分开)或按租户等级(大客户独立) |
| 行级安全(RLS) | Postgres 的功能:在表上挂策略,每条查询自动追加过滤条件,数据库替你加 `WHERE` |
| 策略(policy) | RLS 里的一条规则,用 `CREATE POLICY` 建,包含 `USING` 和可选的 `WITH CHECK` |
| `USING` / `WITH CHECK` | 前者管能看到哪些已有的行,后者管能写进去什么样的行;只写 `USING` 时它也被用作 `WITH CHECK` |
| 角色(role) | Postgres 里的账号。超级用户和带 `BYPASSRLS` 的角色会绕过 RLS |
| owner | 表的拥有者。默认不受 RLS 约束,要 `FORCE ROW LEVEL SECURITY` 才受约束 |
| 会话变量 | 用 `set_config` / `current_setting` 读写的自定义变量,这里用来传「当前租户」 |
| ContextVar | Python 里「跟着当前请求走的变量」,每个请求看到自己的值,类似 Node 的 AsyncLocalStorage |
| 连接池 | 提前建好、反复借还的一组数据库连接,所以连接上残留的设置会被下一个请求继承 |
| schema | 一个库里的命名空间,可以放同名的表。bridge 模式里每个租户一个 schema |
| `search_path` | Postgres 查找不带 schema 前缀的表名时的顺序 |

## 常见误区

**以为打开 RLS 就安全了。** 应用要是用超级用户或表的 owner 连库,RLS 对它完全没有作用。我们的实测:超级用户看到 3 行、没加 FORCE 的 owner 看到 3 行,只有普通角色是 0 行。建表的角色和跑应用的角色必须分开。

**用会话级的 `SET` 设租户。** 连接池里的连接会被不同请求复用,`SET app.tenant_id = 'maple'` 留在连接上,下一个请求忘了设就以 Maple 的身份查询。用事务内的 `set_config('app.tenant_id', 租户, true)`,事务结束自动失效。

**策略里写 `current_setting('app.tenant_id')` 少了第二个参数。** 变量没设置时会直接报 `unrecognized configuration parameter`,看似「也拒绝了」,但会让所有还没接入租户的后台任务一起炸。带上 `true` 变成 NULL,不报错,也一行都查不到,行为是确定的。

**只检查回退链的第一选择。** 主模型能不能用租户策略查过了,备用模型没查,主模型一出故障数据就悄悄出境。凡是「失败后换一条路」的逻辑,换出来的路都要过同样的权限检查。

**把「缓存」当成纯性能问题。** 缓存 key 里没有租户,是多租户系统里最隐蔽的一类串数据,A 的答案被 B 命中,没有任何报错。向量库的 collection、trace 的查询条件、评测集的导出,同理。

**重复跑脚本时角色删不掉。** 我第一版 `rls_setup.py` 直接 `DROP ROLE migrator`,报了:

```text
psycopg.errors.DependentObjectsStillExist: role "migrator" cannot be dropped because some objects depend on it
DETAIL:  privileges for schema public
```

要先 `DROP OWNED BY migrator` 把它拥有的对象和授给它的权限清掉,再删角色。角色是整个 Postgres 服务共享的,所以演示一律在自己新建的库里做,别在别人用的库里删。

## 学习资料

### 文档与文章

- [PostgreSQL 17 文档 · Row Security Policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html):今天内容的一手来源。重点读超级用户和 owner 怎么绕过、FORCE、「只写 USING 时隐式当 WITH CHECK」那一段,以及性能和 leakproof 的提醒,约 20 分钟。
- [PostgreSQL 17 文档 · CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html):每种命令(SELECT、INSERT、UPDATE、DELETE)需要哪一类子句的对照表,练习 4 的答案就在里面。
- [AWS · SaaS Tenant Isolation Strategies](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/saas-tenant-isolation-strategies.html):silo、pool、bridge 三个叫法的出处。页面标注为历史参考,概念没过时。[bridge 一节](https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/the-bridge-model.html) 很短。
- [Supabase · Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security):把 RLS 当作产品核心功能的一家公司,看它怎么讲策略写法和常见坑,对前端同学很友好。
- [Fernet 的文档](https://cryptography.io/en/latest/fernet/):`cryptography` 库里 Fernet 的用法和限制,约 10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Ve4y1g7Bk&autoplay=0&high_quality=1" title="【IT老齐249】SAAS多租户系统数据如何隔离?三种方案综合对比" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐249】SAAS多租户系统数据如何隔离?三种方案综合对比 · 12 分钟。独立数据库、共享库独立 schema、共享表加租户字段三种方案的对比,正好对应 silo、bridge、pool。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hu4y1R7BY&autoplay=0&high_quality=1" title="一个视频搞懂多租户架构该怎么做?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>侠梦的开发笔记 · 一个视频搞懂多租户架构该怎么做? · 17 分钟。从租户识别到数据隔离的整体思路,和昨天、今天的内容对照着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/nRVqir9eaUs" title="Row Level Security (RLS) Policies in PostgreSQL Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Knowledge 360 · Row Level Security (RLS) Policies in PostgreSQL Explained · PostgreSQL 系列的一集,从建策略到测试一遍走完,可以对照今天的 `rls_leak.py` 看。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017):第 7 章 Transactions 讲隔离级别,理解 READ COMMITTED 以后,才明白 Postgres 文档为什么提醒策略里写子查询有竞态。

### 开源项目与代码

- [supabase/supabase](https://github.com/supabase/supabase):把 Postgres RLS 做成产品的开源项目,文档和示例里有大量策略写法可以抄。
- [langgenius/dify](https://github.com/langgenius/dify):昨天提过,几乎每张业务表都带 `tenant_id`。看它的模型层怎么用 `tenant_id` 过滤,对比我们今天靠数据库兜底的做法。

## 自测

1. 隔离的四个维度是什么?各举一个「看起来都对、其实漏了」的位置。

<details><summary>答案</summary>

数据、配额、密钥、模型。数据:缓存的 key 里没有租户(也包括 trace 和评测集);配额:一个租户的批处理吃光共享额度,别人吃 429;密钥:租户自带的 key 完整地出现在日志里;模型:主模型挂了以后回退链悄悄回退到租户合同不允许的模型。

</details>

2. 给 silo、pool、bridge 各说一句最大的代价。你会怎么给一个内部平台选?

<details><summary>答案</summary>

silo 的代价是成本和运维都随租户数线性增长,升级要升 N 遍;pool 的代价是隔离靠代码和数据库策略写对,漏一个条件就是事故;bridge 的代价是复杂度挪到了路由层,要同时维护两套部署。内部平台的租户通常不超过几十个,我会默认 pool,数据库层用 RLS 兜底,租户配置里留一个 `deploy_mode` 字段,给有合同要求的租户切 silo 留口子。

</details>

3. RLS 的策略里为什么要用 `current_setting('app.tenant_id', true)`,而且第二个参数是 `true`?

<details><summary>答案</summary>

`current_setting` 读会话变量,拿到当前请求的租户。第二个参数 `true` 表示变量没设置时返回 NULL 而不是报错。NULL 和任何值比较都不成立,所以忘了设租户的结果是「一行都看不到」,是拒绝而不是放行。少了这个参数,没设置时会直接报错,让所有没接入租户的后台任务一起失败。

</details>

4. 应用层用 `SET app.tenant_id = ...` 设租户有什么问题?应该怎么写?

<details><summary>答案</summary>

`SET` 是会话级的,设置会一直留在这条连接上。连接池会把连接复用给后面的请求,下一个请求如果忘了设租户,就以上一个请求的租户身份查询。应该在事务内用 `set_config('app.tenant_id', 租户, true)`,第三个参数 `true` 表示只在当前事务有效,事务结束自动失效。

</details>

5. (面试题)你们的多租户系统每张表都有 `tenant_id`,也开了 Postgres 行级安全,安全审计仍然发现某个租户能读到别家数据。给出至少三种可能,以及各自怎么查。

<details><summary>答案</summary>

一、应用用超级用户、`BYPASSRLS` 角色或表的 owner 连库:查连接串用的角色,看 `pg_roles` 里的 `rolsuper` 和 `rolbypassrls`,表是否加了 `FORCE ROW LEVEL SECURITY`。二、某张表漏开了 RLS:用体检脚本查所有含 `tenant_id` 列的表的 `relrowsecurity` 和策略数,接进 CI。三、会话级 `SET` 配合连接池,租户串到下一个请求:搜代码里的 `SET app.tenant_id`,改成事务内 `set_config(..., true)`。四、数据不在这张表里:缓存的 key 没带租户、向量库没做租户过滤、分析用的只读库用超级用户连。五、策略本身写宽了,比如 `WITH CHECK (true)` 或 `USING` 里有 `OR`:读一遍 `pg_policy` 里每条策略的表达式。

</details>

## 明天预告

Day 585 · 平台(三):控制面和数据面,中间件放在哪。今天我们把租户隔开了:数据、配额、密钥、模型,加上数据库里的兜底。明天回到平台自己的结构上:租户和项目的增删改、提示词和 Agent 版本这些「管理」的东西,和每次请求都要走的「执行」的东西,为什么要分成控制面和数据面?Redis、队列、向量库、对象存储这些中间件,又各自该放在哪一面?
