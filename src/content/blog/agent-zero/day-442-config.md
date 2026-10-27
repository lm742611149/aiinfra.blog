---
title: 'Day 442 · 搭骨架(二):配置管理'
description: '给 supportpilot 写 src/supportpilot/config.py:用 pydantic-settings 把模型地址、密钥、单价、数据库、业务阈值都从环境变量和 .env 里读进来。过程中会实测配错值怎么在启动时炸、真环境变量和 .env 谁赢、从别的目录运行为什么读不到 .env,再把「今天」固定成一个可复现的配置,最后写七条配置测试并和 .env.example 对账。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'pydantic-settings', 'config', 'agent-zero']
series: 'agent-zero'
day: 442
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 441](/blog/agent-zero/day-441-repo-init/) 建好了 `~/supportpilot` 仓库:uv 管依赖,ruff、pytest、basedpyright 配进了 `pyproject.toml`,pre-commit 挂在 `git commit` 上,目录按 Day 438 的方块表摆好。当时顺手装了 `pydantic-settings`,但一行都没用。

今天用它。后面每一天写的代码几乎都要问同一个问题:模型地址是什么?key 在哪?一百万个 token 多少钱?数据库连哪里?最多让 Agent 调几步工具?这些答案不该散落在二十个文件里,所以先建一个地方,把它们全收进来。

## 今天要解决的问题

今天的新东西只有两个:**`BaseSettings`**(一个会自己去读环境变量和 `.env` 的 pydantic 类)和**固定「今天」**(把按日期算的业务规则从系统时钟上摘下来)。学完你应该能:

1. 写出 `src/supportpilot/config.py` 里的 `Settings` 类和 `get_settings()`,说清一个配置值最后是从哪里来的(真环境变量、`.env`、默认值,谁覆盖谁)。
2. 故意配错三种值,认出启动时的报错长什么样,知道为什么「启动就炸」比「跑到一半才炸」好。
3. 解释从别的目录运行为什么会读不到 `.env`,并用绝对路径修好它。
4. 用 `.env.example` 加一条测试,保证「模板里写的变量」和「代码里认识的变量」一个不多一个不少。

今天不调模型,花费 0 元,也不联网(依赖 Day 441 都装好了)。预计用时 2.5 小时。前置:[Day 53](/blog/agent-zero/day-053-env-secrets/) 的 `.env` 和 `.gitignore`、[Day 51](/blog/agent-zero/day-051-pydantic-1/) 和 [Day 52](/blog/agent-zero/day-052-pydantic-2/) 的 pydantic、[Day 74](/blog/agent-zero/day-074-pytest-4/) 的 `monkeypatch.setenv`、[Day 441](/blog/agent-zero/day-441-repo-init/) 的仓库。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `Settings` 类的前十个字段和 `get_settings` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

命令都在 `~/supportpilot` 里跑。文中路径里的家目录我写成 `/Users/你`。我实际是在一个临时目录里复刻了 Day 441 结束时的仓库来跑的,所以输出里的路径会不一样,我只贴和你机器上应该一致的部分。

## 先从前端看:配置是什么

你的前端项目里一定有这些东西:`process.env.NEXT_PUBLIC_API_URL`、`import.meta.env.VITE_XXX`、一个 `.env.local`,再讲究一点的会用 zod 把 `process.env` 过一遍,缺了变量启动就报错(比如 `@t3-oss/env` 做的事)。Python 这边是同一套思路,只是有现成的类:

| 前端 | Python(今天) | 管什么 |
| --- | --- | --- |
| `process.env.X` | `os.environ["X"]`([Day 53](/blog/agent-zero/day-053-env-secrets/)) | 读一个环境变量,拿到的永远是字符串 |
| `.env.local` + dotenv | `.env` 文件 | 本机的密钥和个性化设置,不进 git |
| zod 的 `z.object({...}).parse(process.env)` | `pydantic_settings.BaseSettings` | 读取、转类型、校验,一步到位 |
| `.env.example` | `.env.example` | 给新同事看的模板,进 git |

Day 53 你自己手写过一个 `settings.py`:先 `load_dotenv()`,再逐个 `os.environ[...]`,再套一个 pydantic 模型校验。那是为了讲清每一步在干什么。今天换成 `BaseSettings`,它把那几步合成了一个类:你只要声明字段和类型,它自己去读、自己转、自己校验。

配置在这个项目里还有个特别的角色。Day 437 的 PRD 和 Day 439 的成本估算里出现的那些数字,比如单价、退款复核线、最多重写几次,迟早要变。把它们放进配置,改的时候改一处、重启就生效,不用在代码里到处搜。

## 第一步:最小的 Settings

先别管那几十个字段,只写三个,看 `BaseSettings` 最基本的行为。在 `supportpilot/scratch/` 里新建 `s1.py`(`scratch/` 是 Day 441 建的随手实验目录,里面的文件不会被提交):

```python
# supportpilot/scratch/s1.py
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    llm_model: str = "deepseek-flash"
    max_act_steps: int = 5
    rerank_enabled: bool = False


s = Settings()
print(s)
print(type(s.max_act_steps), type(s.rerank_enabled))
```

<div class="line-notes">

- `from pydantic_settings import BaseSettings` 注意是 `pydantic_settings`,不是 `pydantic`。pydantic 第 2 版起把「读环境变量」拆成了单独的包,Day 441 装的就是它。
- `class Settings(BaseSettings):` 和 [Day 51](/blog/agent-zero/day-051-pydantic-1/) 的 `class Ticket(BaseModel)` 写法一样,每个类属性是一个字段,冒号后面是类型,等号后面是默认值。区别在于:`BaseModel` 的值从你传的参数来,`BaseSettings` 的值还会去环境变量里找。
- `llm_model: str = "deepseek-flash"` 字段名全小写。它会去找名字叫 `LLM_MODEL` 的环境变量,大小写不敏感,所以 `llm_model`、`LLM_MODEL`、`Llm_Model` 都行。找不到就用默认值。
- `max_act_steps: int = 5` 环境变量永远是字符串,这里声明了 `int`,pydantic 会把 `"7"` 转成 `7`。
- `rerank_enabled: bool = False` 布尔值有自己的解析规则:`true`、`1`、`yes`、`on` 都算真。后面会实测。
- `s = Settings()` 不传任何参数。三个值各自去环境变量里找,找不到用默认值。
- `print(type(s.max_act_steps), type(s.rerank_enabled))` 看转换后的真实类型。

</div>

在仓库根目录运行,依次试四种情况:

```bash
uv run python scratch/s1.py
LLM_MODEL=other max_act_steps=7 RERANK_ENABLED=yes uv run python scratch/s1.py
MAX_ACT_STEPS=abc uv run python scratch/s1.py
RERANK_ENABLED=maybe uv run python scratch/s1.py
```

第一次什么都不设,三个字段都是默认值:

```text
llm_model='deepseek-flash' max_act_steps=5 rerank_enabled=False
<class 'int'> <class 'bool'>
```

第二次在命令前面临时设了三个环境变量(`VAR=值 命令` 是 shell 的写法,只对这一条命令生效,[Day 7](/blog/agent-zero/day-007-terminal-4/) 讲过)。我故意把第二个写成了小写的 `max_act_steps=7`:

```text
llm_model='other' max_act_steps=7 rerank_enabled=True
<class 'int'> <class 'bool'>
```

三个都生效了:大小写不敏感,`"7"` 变成了整数 7,`yes` 变成了 `True`。注意 `type(...)` 打出来的是 `int` 和 `bool`,不是字符串。

第三次、第四次是配错值。我只留报错的最后几行(完整的栈有十几行,真正有用的是最后一段):

```text
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
max_act_steps
  Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='abc', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/int_parsing
```

```text
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
rerank_enabled
  Input should be a valid boolean, unable to interpret input [type=bool_parsing, input_value='maybe', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/bool_parsing
```

报错就是 Day 51 你见过的 `ValidationError`,第二行直接写着是哪个字段(`max_act_steps`)、收到了什么值(`'abc'`)。关键在于它发生在 `Settings()` 这一行,也就是**程序刚启动的时候**。如果没有这层校验,`"abc"` 会一路传下去,等 Agent 跑到第三轮、要比较 `step < "abc"` 时才炸出一个 `TypeError`,那时你得从日志里倒推是哪个配置错了。这是第一个要记住的好处:配置错了,让它在启动的第一秒就死。

## 第二步:.env 文件,谁覆盖谁

真正的项目不会每次在命令前面敲一堆变量,密钥放在 `.env` 里。让 `BaseSettings` 读 `.env` 只要加一行 `model_config`。新建 `scratch/s2.py`:

```python
# supportpilot/scratch/s2.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    llm_model: str = "deepseek-flash"
    max_act_steps: int = 5


print(Settings())
```

<div class="line-notes">

- `from pydantic_settings import BaseSettings, SettingsConfigDict` `SettingsConfigDict` 是一个带类型提示的字典,专门用来写这个类的配置项。
- `model_config = SettingsConfigDict(env_file=".env")` `model_config` 是 pydantic 约定的名字,类里写了它,pydantic 就按它办事。`env_file=".env"` 的意思是:除了环境变量,还要去读一个叫 `.env` 的文件。注意这里写的是相对路径,它相对的是**你运行命令时所在的目录**,这一点马上会出问题。
- `llm_model: str = "deepseek-flash"` 和上一步一样的两个字段,这样可以直接对比有没有 `.env` 的区别。
- `print(Settings())` 直接打印,看最后每个字段的值。

</div>

先建一个 `.env`,里面写两行:

```bash
printf 'LLM_MODEL=from-dotenv\nMAX_ACT_STEPS=9\n' > .env
uv run python scratch/s2.py
LLM_MODEL=from-shell uv run python scratch/s2.py
```

```text
llm_model='from-dotenv' max_act_steps=9
llm_model='from-shell' max_act_steps=9
```

第一次两个值都来自 `.env`。第二次我在命令前又设了 `LLM_MODEL=from-shell`,`llm_model` 变成了 `from-shell`,而 `max_act_steps` 还是 `.env` 里的 9。把三个来源按优先级排出来:

<figure>
<svg viewBox="0 0 640 190" role="img" aria-label="配置值的三个来源,优先级从高到低:真环境变量、.env 文件、代码里的默认值">
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="20" y="30" width="180" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="110" y="56" text-anchor="middle" fill="var(--ink)">① 真环境变量</text>
    <text x="110" y="76" text-anchor="middle" fill="var(--ink-soft)">LLM_MODEL=x 命令</text>
    <text x="110" y="92" text-anchor="middle" fill="var(--ink-faint)" font-size="10">最高:临时覆盖</text>
    <rect x="230" y="30" width="180" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="320" y="56" text-anchor="middle" fill="var(--ink)">② .env 文件</text>
    <text x="320" y="76" text-anchor="middle" fill="var(--ink-soft)">本机密钥、个人设置</text>
    <text x="320" y="92" text-anchor="middle" fill="var(--ink-faint)" font-size="10">中:不进 git</text>
    <rect x="440" y="30" width="180" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="530" y="56" text-anchor="middle" fill="var(--ink)">③ 代码里的默认值</text>
    <text x="530" y="76" text-anchor="middle" fill="var(--ink-soft)">llm_model: str = "…"</text>
    <text x="530" y="92" text-anchor="middle" fill="var(--ink-faint)" font-size="10">最低:什么都没设时</text>
    <line x1="200" y1="65" x2="228" y2="65" stroke="var(--ink-soft)"/>
    <line x1="410" y1="65" x2="438" y2="65" stroke="var(--ink-soft)"/>
    <text x="214" y="58" text-anchor="middle" fill="var(--ink-soft)" font-size="10">没有?</text>
    <text x="424" y="58" text-anchor="middle" fill="var(--ink-soft)" font-size="10">没有?</text>
    <text x="20" y="140" fill="var(--ink-soft)">按顺序往右找,谁先有值谁赢。三处都没有,又没有默认值,就报「缺字段」。</text>
    <text x="20" y="162" fill="var(--ink-soft)">部署到服务器时,密钥通常走 ①(平台的环境变量设置),不放 .env 文件。</text>
  </g>
</svg>
<figcaption>一个配置值的三个来源。优先级的好处是:本机调试时临时在命令前加一个变量就能覆盖,不用去改文件。</figcaption>
</figure>

再试两个会出事的情况。第一个:`.env` 里多写了一个类里没有的变量,比如你给别的工具留了一行 `PG_DSN`:

```bash
printf 'LLM_MODEL=from-dotenv\nPG_DSN=postgresql://x\n' > .env
uv run python scratch/s2.py
```

```text
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
pg_dsn
  Extra inputs are not permitted [type=extra_forbidden, input_value='postgresql://x', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/extra_forbidden
```

`.env` 里出现了 `Settings` 不认识的变量,pydantic-settings 默认**直接报错**(`Extra inputs are not permitted`)。我第一次看到的时候觉得很烦,后来觉得这是对的:`.env` 里写错一个变量名(把 `LLM_MODEL` 拼成 `LLM_MODLE`),如果被悄悄忽略,你会一直以为自己改了模型,其实用的是默认值。我们的 `.env.example` 和 `Settings` 字段是一一对应的(第七步会用测试守住这一点),所以保持默认的严格就好。

第二个更隐蔽。同样的 `.env` 放在仓库根目录,但这次我进到 `scratch/` 目录里再运行:

```bash
printf 'LLM_MODEL=from-dotenv\n' > .env
cd scratch && uv run python s2.py && cd ..
```

```text
llm_model='deepseek-flash' max_act_steps=5
```

`.env` 明明写了 `LLM_MODEL=from-dotenv`,结果却是默认值,而且**没有任何报错**。原因是 `env_file=".env"` 是相对路径,相对的是当前所在的目录(这里是 `scratch/`),那个目录里没有 `.env`,pydantic-settings 就当它不存在,静默地继续往下走。Day 53 讲 `load_dotenv()` 时你已经见过同一个坑。这类坑最恶心的地方是:你以为连的是 DeepSeek,其实 key 是空的,要等调用返回 401 才知道。第三步的正式版本会用绝对路径把它修掉。先把这个 `.env` 删了:

```bash
rm .env
```

## 第三步:写出真正的 Settings

现在把后面几十天要用的配置一次写全。新建 `src/supportpilot/config.py`:

```python
# supportpilot/src/supportpilot/config.py
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]  # config.py → supportpilot/ → src/ → 仓库根目录


class Settings(BaseSettings):
    """所有配置都从环境变量 / .env 读,代码里不出现任何密钥。"""

    model_config = SettingsConfigDict(env_file=ROOT / ".env", env_file_encoding="utf-8")

    # 大模型:OpenAI 兼容协议,换厂商只改这几行
    llm_base_url: str = "https://api.deepseek.com"
    llm_api_key: SecretStr = SecretStr("")
    llm_model: str = "deepseek-flash"
    llm_extra_body: dict[str, Any] = {}  # 环境变量里写 JSON,比如 {"thinking": {"type": "disabled"}}
    # 单价,元 / 百万 token。默认是 2026 年 10 月查到的 deepseek-flash 高峰价,按最贵的算
    price_in_per_m: float = 2.0
    price_out_per_m: float = 8.0

    # embedding 和 rerank:同样走 OpenAI 兼容接口
    emb_base_url: str = "https://api.siliconflow.cn/v1"
    emb_api_key: SecretStr = SecretStr("")
    emb_model: str = "BAAI/bge-m3"
    emb_dim: int = 1024
    rerank_enabled: bool = False
    rerank_model: str = "BAAI/bge-reranker-v2-m3"

    database_url: str = "postgresql://supportpilot:supportpilot@localhost:5432/supportpilot"

    # 业务规则。sp_today 固定「今天」,让按日期算的退款规则在评测里可复现
    sp_today: date = date(2026, 10, 1)
    refund_review_threshold: float = 1000.0  # 超过这个金额,审批时标红提示要财务复核

    # Agent 行为
    max_act_steps: int = 5
    max_revisions: int = 1
    retrieve_k: int = 5


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

<div class="line-notes">

- `from datetime import date` `sp_today` 的类型要用它。
- `from functools import lru_cache` 给最后的 `get_settings()` 用,第四步讲。
- `from pathlib import Path` [Day 37](/blog/agent-zero/day-037-pathlib/) 的路径对象,下面算 `ROOT` 用。
- `from typing import Any` `llm_extra_body` 是个字典,值的类型不固定,所以用 `Any`。
- `from pydantic import SecretStr` [Day 53](/blog/agent-zero/day-053-env-secrets/) 讲过:包一层之后,打印出来是一串星号,要取原文必须显式调用 `get_secret_value()`。
- `ROOT = Path(__file__).resolve().parents[2]` 把「仓库根目录」算出来。`__file__` 是这个文件自己的路径,`.resolve()` 把它变成绝对路径,`.parents[2]` 往上走三级里的第三级:`config.py` 的上一级是 `supportpilot/`,再上是 `src/`,再上才是仓库根目录。算出来的值就是 `~/supportpilot`。
- `class Settings(BaseSettings):` 所有配置都放在这一个类里。
- `model_config = SettingsConfigDict(env_file=ROOT / ".env", env_file_encoding="utf-8")` 和第二步的区别就一处:`env_file` 从相对路径 `".env"` 换成了 `ROOT / ".env"`,不管你在哪个目录运行,读的都是仓库根目录那一个。`/` 是 `Path` 重载的拼接运算符。
- `llm_base_url: str = "https://api.deepseek.com"` 模型地址。我们走 OpenAI 兼容协议,换厂商只改地址、key 和模型名这几行。
- `llm_api_key: SecretStr = SecretStr("")` 默认空串。没填 key 也能 import、能跑 `make test`,只是真调模型时才会收到 401。
- `llm_model: str = "deepseek-flash"` 2026 年 10 月查到的模型名,旧的 `deepseek-chat` 已经下线。
- `llm_extra_body: dict[str, Any] = {}` 一个字典。环境变量里写成 JSON 字符串,pydantic-settings 会自动 `json.loads` 变成字典。DeepSeek 要通过它传 `{"thinking": {"type": "disabled"}}` 关掉思考模式,Day 462 之后的好几天都要用。
- `price_in_per_m: float = 2.0` 输入单价,元/百万 token。我 2026 年 10 月 27 日在 DeepSeek 官方价格页查到的 deepseek-flash 价格分高峰和空闲两档,高峰(北京时间工作日 9–12、14–18 点)输入未命中缓存 2 元、输出 8 元,空闲时段是一半。默认值按最贵的高峰价写,估算成本宁可高估。
- `price_out_per_m: float = 8.0` 输出单价,同上。
- `emb_base_url: str = "https://api.siliconflow.cn/v1"` embedding 和 rerank 走硅基流动,和 DeepSeek 是两个厂商、两套 key,所以单独一组。
- `emb_api_key: SecretStr = SecretStr("")` embedding 的 key。
- `emb_dim: int = 1024` bge-m3 输出的向量维度。明天建表时 `vector(1024)` 必须和它一致,Day 443 会写一条测试盯住这件事。
- `rerank_enabled: bool = False` 重排序默认关,Day 450 以后做混合检索时才可能打开。
- `database_url: str = "postgresql://supportpilot:supportpilot@localhost:5432/supportpilot"` 默认连 Day 443 用 Docker 起的那个库。用 Postgres.app 的话,在 `.env` 里写成 `DATABASE_URL=postgresql://你的用户名@localhost:5432/supportpilot`。
- `sp_today: date = date(2026, 10, 1)` 业务里的「今天」。类型是 `date`,环境变量里写 `2026-11-15` 会被转成真正的日期对象。下面第五步专门讲它为什么存在。
- `refund_review_threshold: float = 1000.0` 退款超过这个金额要财务复核。帮助中心退款文章里写的「超过 1,000 元要财务复核」(Day 444 会生成这篇),放进配置,财务以后说改成 2,000 时只改一个数。
- `max_act_steps: int = 5` Agent 一轮最多调几次工具,防止无限循环。Day 460 的 act 节点用。
- `max_revisions: int = 1` 质检没过时最多重写几次。Day 462 的路由函数用,默认值 1 是文章里已经写死的。
- `retrieve_k: int = 5` 检索每次取几块。Day 450 起用。
- `@lru_cache` 缓存装饰器,下一步讲。
- `def get_settings() -> Settings:` 全项目都通过它拿配置,不在别的模块里到处 `Settings()`。

</div>

几件事单独说一下。

**为什么 API key 用 `SecretStr`。** 配置对象早晚会被 `print` 出来:调试时随手一打,或者日志里记了一整个对象。用普通字符串,key 就进了日志;用 `SecretStr`,打出来是 `SecretStr('**********')`。我实测一下(这是第三步最后要跑的 `s3.py`):

```python
# supportpilot/scratch/s3.py
from supportpilot.config import Settings, get_settings

s = Settings()
print(s.llm_model, s.sp_today, type(s.sp_today).__name__, s.llm_extra_body)
print(repr(s.llm_api_key), "|", s.llm_api_key.get_secret_value()[:6])
print(s.model_dump()["llm_api_key"])
print(get_settings() is get_settings())
```

<div class="line-notes">

- `from supportpilot.config import Settings, get_settings` 包已经以可编辑方式装进 `.venv`(Day 441),所以任何位置的脚本都能按包名导入。
- `s = Settings()` 这次是真正的 `Settings`,会去读仓库根目录的 `.env`。
- `print(s.llm_model, s.sp_today, type(s.sp_today).__name__, s.llm_extra_body)` 一行看四样东西:模型名、日期、日期的类型名、extra_body 字典。
- `print(repr(s.llm_api_key), "|", s.llm_api_key.get_secret_value()[:6])` `repr` 看它被打印时的样子;`get_secret_value()[:6]` 取前 6 个字符,证明原文还在里面。
- `print(s.model_dump()["llm_api_key"])` `model_dump()` 是 [Day 52](/blog/agent-zero/day-052-pydantic-2/) 的导出成字典,看 key 在字典里是不是也被遮住了。
- `print(get_settings() is get_settings())` 连续取两次,问它们是不是同一个对象,第四步解释。

</div>

先不设任何东西跑一次,再带着假 key 和另外几个变量跑一次(key 是我随手编的,不是真的):

```bash
uv run python scratch/s3.py
LLM_API_KEY=sk-fake-1234567890 LLM_EXTRA_BODY='{"thinking": {"type": "disabled"}}' SP_TODAY=2026-11-15 uv run python scratch/s3.py
```

```text
deepseek-flash 2026-10-01 date {}
SecretStr('') | 

True
```

```text
deepseek-flash 2026-11-15 date {'thinking': {'type': 'disabled'}}
SecretStr('**********') | sk-fak
**********
True
```

第一段全是默认值,`llm_extra_body` 是空字典,key 是空串,第二行 `|` 后面什么都没有,第三行是空行。第二段:`SP_TODAY=2026-11-15` 这个字符串变成了真正的日期,`type(...)` 是 `date`;JSON 字符串变成了字典;key 在 `repr` 和 `model_dump()` 里都是 10 个星号,只有 `get_secret_value()` 拿得到原文 `sk-fak…`。

再跑一次从别的目录运行的实验,验证绝对路径真的有用。先把 `.env` 写成两行,再分别在根目录和 `scratch/` 里运行同一个脚本 `scratch/s9.py`:

```python
# supportpilot/scratch/s9.py
from supportpilot.config import Settings

print(Settings().llm_model, "|", Settings().llm_api_key.get_secret_value()[:5] or "(空)")
```

<div class="line-notes">

- `from supportpilot.config import Settings` 还是正式版的 `Settings`。
- `print(Settings().llm_model, "|"` 打印模型名,再打印 key 的前 5 个字符;`or "(空)"` 的意思是前面那个值是空串(在 Python 里为假)时,改成显示「(空)」。

</div>

```bash
printf 'LLM_MODEL=from-dotenv\nLLM_API_KEY=sk-fake-for-local-demo-0001\n' > .env
uv run python scratch/s9.py
(cd scratch && uv run python s9.py)
(cd scripts && uv run python ../scratch/s9.py)
```

```text
from-dotenv | sk-fa
from-dotenv | sk-fa
from-dotenv | sk-fa
```

括号 `( … )` 是让里面的 `cd` 只在这一条命令里有效,不影响外面的当前目录。三个目录运行结果一样,读的都是仓库根目录的 `.env`。作为对比,我在把 `env_file` 改成绝对路径**之前**也跑过一遍同样的脚本,根目录里是 `from-dotenv | sk-fa`,`scratch/` 里是 `deepseek-flash | (空)`:这就是第二步的静默失败。

**`llm_extra_body` 为什么是字典。** Day 135 之后你在练习仓库里一直用 `json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` 手工解析。放进 `Settings` 之后,这一步由 pydantic 代劳,类型也有保证:`LLM_EXTRA_BODY={"thinking"` 写到一半没闭合,会在启动时报错,而不是传给模型一个坏掉的请求。

**`database_url` 里有密码。** 默认值里 `supportpilot:supportpilot@` 是用户名和密码。我没有把它也包成 `SecretStr`,因为 Day 464 的 `psycopg.connect(url)` 要的是普通字符串。代价是:`print(Settings())` 会把数据库密码打出来。练习 4 会处理它。

## 第四步:get_settings 和缓存

每个模块想用配置,都是 `get_settings()`。为什么不直接在模块顶层写 `settings = Settings()`?因为那样一 `import` 这个模块,配置就被读了、校验就跑了。如果环境没配好,连 `pytest` 收集测试都会炸。放进函数里,谁调用谁才读。

那为什么要 `@lru_cache`?每次调用都新建一个 `Settings()` 意味着每次都重新读环境变量、重新读 `.env` 文件、重新校验,没必要。`lru_cache` 是标准库的缓存装饰器:函数没有参数,所以缓存里永远只有一份结果,第一次调用算出来,之后直接返回同一个对象。这就是 `get_settings() is get_settings()` 打出 `True` 的原因。

缓存有个副作用,用 `scratch/s4.py` 看一下:

```python
# supportpilot/scratch/s4.py
import os

from supportpilot.config import get_settings

print(get_settings().max_act_steps)
os.environ["MAX_ACT_STEPS"] = "9"
print(get_settings().max_act_steps)
get_settings.cache_clear()
print(get_settings().max_act_steps)
```

<div class="line-notes">

- `import os` 要用 `os.environ` 在程序运行中改环境变量。
- `print(get_settings().max_act_steps)` 第一次调用,真的去读了配置,创建了对象。此时 `.env` 和环境变量里都没有 `MAX_ACT_STEPS`,所以是默认值 5。
- `os.environ["MAX_ACT_STEPS"] = "9"` 在程序里把环境变量改成 9。`os.environ` 像个字典,可以赋值。
- `print(get_settings().max_act_steps)` 第二次调用,直接返回缓存里的旧对象,不会重新读,所以还是 5。
- `get_settings.cache_clear()` `lru_cache` 给函数加了一个 `cache_clear` 方法,把缓存清空。
- `print(get_settings().max_act_steps)` 缓存清了,这次重新读,拿到 9。

</div>

```text
5
5
9
```

第二个 5 就是副作用:进程启动之后再改环境变量,`get_settings()` 看不见。生产里这是好事(配置在运行中途不该突然变),写测试时是个坑:一个测试改了环境变量,下一个测试拿到的还是缓存里的旧配置。所以测试里有两条规矩:换配置就直接 `Settings(...)` 新建一个传进去;万不得已用 `get_settings`,每个测试前后调 `cache_clear()`。第七步的测试会这么做。

## 第五步:固定「今天」

`sp_today` 是整个配置里我最想讲清楚的一项。

退款规则全是按日期算的:「首次购买 14 天内」「续费 7 天内」。要判断一笔订单能不能退,代码得知道今天是几号。最自然的写法是 `date.today()`,读系统时钟。问题在于这样写,同一份数据在不同的日子跑出来的标准答案不一样。写个脚本看看,用 Day 445 要造的剧情客户李娜的付款日 2026-09-24:

```python
# supportpilot/scratch/s5.py
from datetime import date

from supportpilot.config import get_settings

paid = date(2026, 9, 24)  # 剧情客户李娜的付款日(Day 445 会造这条数据)
by_clock = (date.today() - paid).days
by_config = (get_settings().sp_today - paid).days
print("按系统时钟:", by_clock, "天;按 SP_TODAY:", by_config, "天")
print("14 天无理由退款?", "按时钟:", by_clock <= 14, " 按配置:", by_config <= 14)
```

<div class="line-notes">

- `from datetime import date` 标准库的日期类型。
- `paid = date(2026, 9, 24)` 付款日。`date(年, 月, 日)` 直接构造一个日期对象。
- `by_clock = (date.today() - paid).days` `date.today()` 读系统时钟。两个日期相减得到一个时间差对象,`.days` 取天数。我写这篇的当天是 2026 年 10 月 27 日,所以是 33。
- `by_config = (get_settings().sp_today - paid).days` 同样的减法,但「今天」取自配置,默认 2026-10-01,所以是 7。
- `print("按系统时钟:"` 把两个天数一起打出来。
- `print("14 天无理由退款?"` 同一笔订单,两种算法,判断结果会不会不同。

</div>

```text
按系统时钟: 33 天;按 SP_TODAY: 7 天
14 天无理由退款? 按时钟: False  按配置: True
```

同一张订单,在我写文章的这天(10 月 27 日)用系统时钟算,已经 33 天,不能全额退;用配置里固定的 10 月 1 日算,第 7 天,可以。如果评测集里写的标准答案是「李娜可以全额退 950 元」(Day 476 的评测集就是这么写的),用系统时钟的话,这条用例**每过一天就更不可能通过**,而你改的代码一行都没动。分数下降,你却以为是自己改坏了什么,会花几个小时去找一个不存在的 bug。

所以「今天」也是配置:默认固定在 2026-10-01,造数据(Day 445)、业务规则(Day 452)、评测(Day 476)都读它。真上线时再让它跟着系统时间走,到时候把读取的地方换成一个 `today()` 函数就行,业务代码不用动。这类「让测试可复现」的小设计,面试官很喜欢听,因为一听就知道你踩过这个坑。

## 第六步:.env.example 和 .gitignore

`.env` 里是真密钥,不能进 git(Day 441 的 `.gitignore` 里已经写了 `.env`、`.env.*` 和 `!.env.example` 三行)。但新同事克隆仓库后,怎么知道要填哪些变量?答案是 `.env.example`:同样的变量名,值换成占位符,提交进仓库。新建 `.env.example`:

```bash
# supportpilot/.env.example  复制成 .env 再填。.env 已在 .gitignore 里,别提交。
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-xxxx
LLM_MODEL=deepseek-flash
LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}
PRICE_IN_PER_M=2.0
PRICE_OUT_PER_M=8.0

EMB_BASE_URL=https://api.siliconflow.cn/v1
EMB_API_KEY=sk-xxxx
EMB_MODEL=BAAI/bge-m3
EMB_DIM=1024
RERANK_ENABLED=false
RERANK_MODEL=BAAI/bge-reranker-v2-m3

DATABASE_URL=postgresql://supportpilot:supportpilot@localhost:5432/supportpilot

SP_TODAY=2026-10-01
REFUND_REVIEW_THRESHOLD=1000
MAX_ACT_STEPS=5
MAX_REVISIONS=1
RETRIEVE_K=5
```

<div class="line-notes">

- `# supportpilot/.env.example` 第一行注释写清楚用法:复制成 `.env` 再填。
- `LLM_BASE_URL=https://api.deepseek.com` 不敏感的值直接写成真的默认值,新同事不用改。
- `LLM_API_KEY=sk-xxxx` 密钥永远写占位符 `sk-xxxx`。后面的测试专门检查这一点,防止有人手滑把真 key 贴进模板。
- `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}` 字典写成 JSON。dotenv 对这一行很友好,里面有空格和双引号也不用再加引号。
- `PRICE_IN_PER_M=2.0` 价格两项。
- `EMB_API_KEY=sk-xxxx` embedding 的 key,和上面的 LLM key 是两把。
- `RERANK_ENABLED=false` 布尔值写 `false`。
- `DATABASE_URL=postgresql://supportpilot:supportpilot@localhost:5432/supportpilot` 默认给 Docker 起的库用。
- `SP_TODAY=2026-10-01` 固定「今天」。
- `MAX_ACT_STEPS=5` 后面四行是业务和 Agent 行为的默认值,同样写成真值。

</div>

然后 `cp .env.example .env`,把里面两个 `sk-xxxx` 换成你真的 key。我在临时目录里跑的时候填的是假 key,今天不调模型,所以不影响。

用 git 确认一下:

```bash
git status --short
```

```text
?? .env.example
?? scratch/s1.py
?? scratch/s2.py
?? scratch/s3.py
?? scratch/s4.py
?? scratch/s5.py
?? scratch/s9.py
?? src/supportpilot/config.py
```

`.env.example` 和 `config.py` 在列表里(还没 `git add`),`.env` 不在。它被 `.gitignore` 挡住了,这就是我们要的效果。另外你会看到 `scratch/` 里的实验文件也冒了出来,第八步先把它们挡掉再提交。

## 第七步:配置测试

配置是后面所有代码的地基,值得有几条测试,而且这几条测试自己就藏着两个坑。新建 `tests/test_config.py`:

```python
# supportpilot/tests/test_config.py
"""配置测试:默认值、环境变量覆盖、配错就炸、.env.example 和 Settings 对得上。"""

import re
from datetime import date
from pathlib import Path

import pytest
from pydantic import ValidationError
from pydantic_settings import SettingsConfigDict

from supportpilot.config import Settings, get_settings

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch):
    """每个测试前,把 Settings 认识的环境变量全清掉,免得开发者本机的设置混进来。"""
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    get_settings.cache_clear()


class IsolatedSettings(Settings):
    """和 Settings 一模一样,只是不读 .env:测试结果不该取决于谁的电脑上有什么 .env。"""

    model_config = SettingsConfigDict(env_file=None)


def fresh() -> Settings:
    return IsolatedSettings()


def test_defaults():
    s = fresh()
    assert s.llm_model == "deepseek-flash"
    assert s.sp_today == date(2026, 10, 1)
    assert s.max_revisions == 1
    assert s.llm_extra_body == {}


def test_env_overrides_default_and_converts_type(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MAX_ACT_STEPS", "7")
    monkeypatch.setenv("SP_TODAY", "2026-11-15")
    monkeypatch.setenv("RERANK_ENABLED", "true")
    monkeypatch.setenv("LLM_EXTRA_BODY", '{"thinking": {"type": "disabled"}}')
    s = fresh()
    assert s.max_act_steps == 7
    assert s.sp_today == date(2026, 11, 15)
    assert s.rerank_enabled is True
    assert s.llm_extra_body == {"thinking": {"type": "disabled"}}


def test_bad_value_fails_at_startup(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MAX_ACT_STEPS", "abc")
    with pytest.raises(ValidationError, match="max_act_steps"):
        fresh()


def test_api_key_is_masked(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LLM_API_KEY", "sk-fake-1234567890")
    s = fresh()
    assert "sk-fake" not in repr(s)
    assert s.llm_api_key.get_secret_value() == "sk-fake-1234567890"


def test_get_settings_is_cached():
    assert get_settings() is get_settings()


def test_env_example_matches_settings():
    """模板里的变量名 = Settings 的字段名(大写),一个不多一个不少。"""
    text = (ROOT / ".env.example").read_text(encoding="utf-8")
    names = set(re.findall(r"^([A-Z_]+)=", text, flags=re.MULTILINE))
    assert names == {n.upper() for n in Settings.model_fields}


def test_env_example_has_no_real_key():
    text = (ROOT / ".env.example").read_text(encoding="utf-8")
    for line in text.splitlines():
        if "API_KEY" in line:
            assert line.split("=", 1)[1] == "sk-xxxx"
```

<div class="line-notes">

- `import re` 后面用正则从 `.env.example` 里抽变量名。
- `from datetime import date` 比较日期用。
- `from pathlib import Path` 算仓库根目录。
- `import pytest` 要用 `fixture` 和 `raises`。
- `from pydantic import ValidationError` 配错值时抛出的异常类型。
- `from pydantic_settings import SettingsConfigDict` 下面的子类要改配置。
- `from supportpilot.config import Settings, get_settings` 被测的对象。
- `ROOT = Path(__file__).resolve().parent.parent` 测试文件在 `tests/` 里,往上一级就是仓库根目录。这里不能 import `config.ROOT`,因为那是被测代码,测试不该靠它算路径。
- `@pytest.fixture(autouse=True)` [Day 73](/blog/agent-zero/day-073-pytest-3/) 的 fixture。`autouse=True` 表示每个测试都自动用它,不用在参数里点名。
- `def clean_env(monkeypatch: pytest.MonkeyPatch):` `monkeypatch` 是 pytest 自带的 fixture,所有用它改的东西测试结束时自动还原([Day 74](/blog/agent-zero/day-074-pytest-4/))。
- `for name in Settings.model_fields:` `model_fields` 是 pydantic 类上记录所有字段的字典,遍历它得到全部字段名。
- `monkeypatch.delenv(name.upper(), raising=False)` 把对应的环境变量(字段名转大写)全删掉。`raising=False` 表示本来就没设也不报错。这一段保证:不管你本机的终端里 export 过什么,测试看到的都是干净环境。
- `get_settings.cache_clear()` 每个测试前清掉缓存,第四步讲过。
- `class IsolatedSettings(Settings):` 继承 `Settings`,字段全部沿用,只改一处。
- `model_config = SettingsConfigDict(env_file=None)` 把 `env_file` 改成 `None`:不读 `.env`。子类的 `model_config` 会和父类合并,只覆盖写出来的这一项。
- `def fresh() -> Settings:` 测试里统一用它新建配置。
- `return IsolatedSettings()` 返回不读 `.env` 的那一个。
- `def test_defaults():` 默认值测试。
- `assert s.llm_model == "deepseek-flash"` 模型名的默认值。
- `assert s.sp_today == date(2026, 10, 1)` 固定的「今天」。
- `assert s.max_revisions == 1` Day 462 文章里写死了「默认是 1」,这条测试让它不能悄悄变。
- `def test_env_overrides_default_and_converts_type(monkeypatch: pytest.MonkeyPatch):` 环境变量能覆盖默认值,并且类型被转对。
- `monkeypatch.setenv("MAX_ACT_STEPS", "7")` 临时设一个环境变量,值必须是字符串。
- `monkeypatch.setenv("LLM_EXTRA_BODY", '{"thinking": {"type": "disabled"}}')` 外面是单引号,里面的双引号才不用转义。
- `assert s.max_act_steps == 7` 字符串 `"7"` 变成了整数。
- `assert s.rerank_enabled is True` 用 `is True` 而不是 `== True`,确认拿到的真的是布尔值,不是字符串 `"true"`。
- `assert s.llm_extra_body == {"thinking": {"type": "disabled"}}` JSON 字符串变成了字典。
- `def test_bad_value_fails_at_startup(` 配错就炸。
- `with pytest.raises(ValidationError, match="max_act_steps"):` 期望里面的代码抛出 `ValidationError`,且报错信息里包含字段名 `max_act_steps`。`match` 是个正则。
- `def test_api_key_is_masked(` key 不会被打印出来。
- `assert "sk-fake" not in repr(s)` `repr(s)` 是整个配置对象被打印时的样子,里面不能有 key 原文。
- `assert s.llm_api_key.get_secret_value() == "sk-fake-1234567890"` 但显式取值还是能拿到原文。
- `def test_get_settings_is_cached():` 两次调用是同一个对象。
- `def test_env_example_matches_settings():` 模板和代码对账。
- `names = set(re.findall(r"^([A-Z_]+)=", text, flags=re.MULTILINE))` 正则逐行匹配「大写字母和下划线开头、后面跟等号」的行,抽出变量名,放进集合。`re.MULTILINE` 让 `^` 匹配每一行的开头。注释行以 `#` 开头,匹配不上。
- `assert names == {n.upper() for n in Settings.model_fields}` 集合推导式([Day 23](/blog/agent-zero/day-023-comprehensions/)):把所有字段名转成大写。两个集合相等,等于「一个不多一个不少」。
- `def test_env_example_has_no_real_key():` 占位符检查。
- `if "API_KEY" in line:` 只看带 `API_KEY` 的行。
- `assert line.split("=", 1)[1] == "sk-xxxx"` 按第一个等号切开,等号右边必须正好是占位符。

</div>

```bash
uv run pytest tests/test_config.py -v
```

```text
tests/test_config.py::test_defaults PASSED                               [ 14%]
tests/test_config.py::test_env_overrides_default_and_converts_type PASSED [ 28%]
tests/test_config.py::test_bad_value_fails_at_startup PASSED             [ 42%]
tests/test_config.py::test_api_key_is_masked PASSED                      [ 57%]
tests/test_config.py::test_get_settings_is_cached PASSED                 [ 71%]
tests/test_config.py::test_env_example_matches_settings PASSED           [ 85%]
tests/test_config.py::test_env_example_has_no_real_key PASSED            [100%]
============================== 7 passed in 0.10s ===============================
```

这份测试里有两个设计,是我踩过之后才加的。

**第一,为什么要 `IsolatedSettings`,不直接 `Settings()`。** 先看不加会怎样。我把 `fresh()` 临时改成 `return Settings()`,然后在仓库根目录建一个 `.env`,里面写 `LLM_MODEL=my-own-model`(模拟你本机有个人设置),再跑:

```text
    def test_defaults():
        s = fresh()
>       assert s.llm_model == "deepseek-flash"
E       AssertionError: assert 'my-own-model' == 'deepseek-flash'
E         
E         - deepseek-flash
E         + my-own-model

tests/test_config.py:37: AssertionError
=========================== short test summary info ============================
FAILED tests/test_config.py::test_defaults - AssertionError: assert 'my-own-m...
1 failed, 14 passed in 0.20s
```

你本机 `.env` 里随便改一个值,「默认值」测试就红了。测试结果取决于谁的电脑上有什么文件,是最典型的「在我机器上能过」。`autouse` 的 fixture 清掉的是环境变量,管不到 `.env` 文件,所以才需要一个不读 `.env` 的子类。我最初的想法是 `Settings(_env_file=None)`,pydantic-settings 确实支持这个参数,但 basedpyright 会报 `No parameter named "_env_file"`(类型标注里没有这个参数),所以我改成了子类,0 报错。

**第二,`.env.example` 对账。** 这是我最喜欢的一条。今后每个人加字段都会忘记同步模板,这条测试会替你记着。练习 2 会演示它抓人。

三个检查和提交:

```bash
uv run ruff check . && uv run ruff format --check .
uv run basedpyright
uv run pytest -q
```

```text
All checks passed!
12 files already formatted
0 errors, 0 warnings, 0 notes
...............                                                          [100%]
15 passed in 0.06s
```

15 个测试:Day 441 的 8 个冒烟测试加今天的 7 个(我这里的文件数是我临时目录里的,你那边如果多了别的文件,数字会不一样)。

## 第八步:提交,和架构表对账

提交之前先处理上面冒出来的 `scratch/` 文件。实验脚本不该进仓库,在 `.gitignore` 末尾补两行:`scratch/*` 忽略目录里的所有东西,`!scratch/.gitkeep` 把 Day 441 建的占位文件例外放回来(感叹号表示排除,顺序不能反,[Day 441](/blog/agent-zero/day-441-repo-init/) 讲过):

```gitignore
# 随手实验,只留目录
scratch/*
!scratch/.gitkeep
```

然后提交:

```bash
git add -A
git status --short
git commit -m "feat: 配置管理 Settings、.env.example 和配置测试"
```

```text
A  .env.example
M  .gitignore
A  src/supportpilot/config.py
A  tests/test_config.py
```

```text
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...........................................(no files to check)Skipped
check toml...........................................(no files to check)Skipped
check for added large files..............................................Passed
detect private key.......................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
```

提交里正好四个文件,没有 `.env`,没有 `scratch/` 的东西。下面是 pre-commit 在干活:`check yaml`、`check toml` 显示 `Skipped`,是因为这次提交里没有 YAML 和 TOML 文件。`detect private key` 通过了:它找的是 `-----BEGIN PRIVATE KEY-----` 这类私钥文件头,**抓不到** `sk-…` 这种 API key,所以 `.gitignore` 才是挡住 `.env` 的真正防线。

最后照 Day 441 的惯例,用 `check_arch.py` 和架构表对账。在练习仓库根目录运行:

```bash
cd ~/agent-zero-lab
uv run python -m part08.check_arch --day 442 ~/supportpilot
```

我撞上了一件小事。`.env` 是你本机真实存在的文件,`check_arch.py` 的「文件有归属」会把它当成孤儿(没有任何方块认领它),`scratch/` 里的实验文件也一样。我在 Day 442 结束时的仓库状态上实测:

```text
方块有文件: 通过
文件有归属: 7 个问题
  - 文件不属于任何方块:.env
  - 文件不属于任何方块:scratch/s1.py
  - 文件不属于任何方块:scratch/s2.py
  - 文件不属于任何方块:scratch/s3.py
  - 文件不属于任何方块:scratch/s4.py
  - 文件不属于任何方块:scratch/s5.py
  - 文件不属于任何方块:scratch/s9.py
依赖方向: 通过
```

这两样都不是「漏了方块」,是检查脚本该忽略它们:`.env` 不进仓库,`scratch/` 是随手实验。改 `part08/check_arch.py` 开头的两个集合,各加一项:

```python
# agent-zero-lab/part08/check_arch.py(只改开头这两行)
IGNORE = {"__init__.py", ".gitkeep", ".DS_Store", ".env"}
IGNORE_DIRS = {".git", ".venv", "__pycache__", ".ruff_cache", ".pytest_cache", "node_modules", "scratch"}
```

<div class="line-notes">

- `IGNORE = {"__init__.py", ".gitkeep", ".DS_Store", ".env"}` 不属于任何方块也不报的**文件名**,新加了 `.env`。
- `IGNORE_DIRS = {".git", ".venv", "__pycache__", ".ruff_cache", ".pytest_cache", "node_modules", "scratch"}` 整个跳过的**目录**,新加了 `scratch`。

</div>

再跑一遍:

```text
方块有文件: 通过
文件有归属: 通过
依赖方向: 通过
```

不带 `--day` 时,「方块有文件」的问题数从 Day 441 文章里的 47 降到 45:`config.py` 和 `.env.example` 两个方块今天有了文件。

## 零件和结果的对照

| 文件 | 哪一步 | 作用 |
| --- | --- | --- |
| `src/supportpilot/config.py` | 一、二、三、四 | `Settings` 类、`ROOT`、`get_settings()` |
| `.env.example` | 六 | 变量清单模板,进 git |
| `.env` | 二、六 | 你本机的真值,不进 git |
| `tests/test_config.py` | 七 | 默认值、覆盖、配错、遮 key、缓存、模板对账 |
| `.gitignore` 末尾两行 | 八 | `scratch/*` 实验文件不提交 |
| `part08/check_arch.py` 两个集合 | 八 | 忽略 `.env` 和 `scratch/` |
| `scratch/s1.py` ~ `s5.py`、`s9.py` | 一到五 | 每一步的实验,不提交 |

## 动手练习

### 练习 1:配错三种值,读报错

**题目:** 在不改任何代码的前提下,用环境变量依次把三个字段配错:`SP_TODAY=2026-13-01`、`MAX_ACT_STEPS=abc`、`RERANK_ENABLED=maybe`。每次运行 `uv run python -c "from supportpilot.config import Settings; Settings()"`,读最后几行报错,说出每次是哪个字段、收到了什么、期望什么。

<details><summary>参考答案</summary>

```bash
SP_TODAY=2026-13-01 uv run python -c "from supportpilot.config import Settings; Settings()" 2>&1 | tail -4
MAX_ACT_STEPS=abc uv run python -c "from supportpilot.config import Settings; Settings()" 2>&1 | tail -4
RERANK_ENABLED=maybe uv run python -c "from supportpilot.config import Settings; Settings()" 2>&1 | tail -4
```

实测输出(各留最后几行):

```text
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
sp_today
  Input should be a valid date or datetime, month value is outside expected range of 1-12 [type=date_from_datetime_parsing, input_value='2026-13-01', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/date_from_datetime_parsing
```

```text
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
max_act_steps
  Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='abc', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/int_parsing
```

```text
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
rerank_enabled
  Input should be a valid boolean, unable to interpret input [type=bool_parsing, input_value='maybe', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/bool_parsing
```

每条报错的第二行是字段名,第三行是人话说明加 `type=` 错误类型,`input_value` 是收到的原值。三种都在 `Settings()` 这一行,也就是启动时就炸了。`SP_TODAY` 那条的说明写得特别具体:「月份超出 1–12」,这是 pydantic 帮你检查了日期是不是真的存在。

</details>

### 练习 2:加一个 log_level,让 .env.example 的对账测试抓你一次

**题目:** 给 `Settings` 加字段 `log_level`,只允许 `DEBUG`、`INFO`、`WARNING`、`ERROR` 四个值,默认 `INFO`。**先只改 `config.py`,不改 `.env.example`**,跑测试,观察哪条红。再补 `.env.example`,再测。最后试一下 `LOG_LEVEL=loud`。

<details><summary>参考答案</summary>

`config.py` 顶部 import 改成 `from typing import Any, Literal`(`Literal` 是 [Day 47](/blog/agent-zero/day-047-type-hints-3/) 的字面量类型),在「Agent 行为」那组最后加:

```python
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
```

<div class="line-notes">

- `log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"` 类型写成四个字面量之一。传别的值,pydantic 直接拒绝。默认值 `"INFO"`。

</div>

先不动 `.env.example`,跑 `uv run pytest -q`:

```text
E       AssertionError: assert {'DATABASE_UR...API_KEY', ...} == {'DATABASE_UR...API_KEY', ...}
E         
E         Extra items in the right set:
E         'LOG_LEVEL'
E         Use -v to get more diff
FAILED tests/test_config.py::test_env_example_matches_settings - AssertionErr...
1 failed, 14 passed in 0.11s
```

「Extra items in the right set」指的是右边那个集合(`Settings` 的字段名)多了 `LOG_LEVEL`:代码认识这个变量,模板里没写。在 `.env.example` 末尾补一行 `LOG_LEVEL=INFO`,再跑:`15 passed`。最后试配错:

```text
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
log_level
  Input should be 'DEBUG', 'INFO', 'WARNING' or 'ERROR' [type=literal_error, input_value='loud', input_type=str]
```

`Literal` 做枚举比 `str` 加手写判断省事得多,报错里还直接列出了所有合法值。做完把改动撤掉(`git checkout src/supportpilot/config.py .env.example`),后面的天不用这个字段。

</details>

### 练习 3:给数字配置加上下限

**题目:** `max_act_steps` 配成 0 或者负数,Agent 就一步都不能走;单价配成负数,算出来的成本是负的。用 [Day 52](/blog/agent-zero/day-052-pydantic-2/) 的 `Field` 约束给它们加上限制:`max_act_steps` 取 1 到 20,两个单价不能为负。写出配错时的报错,并确认 basedpyright 0 报错。

<details><summary>参考答案</summary>

`config.py` 里 `from pydantic import Field, SecretStr`,三个字段改成:

```python
    price_in_per_m: float = Field(default=2.0, ge=0)
    price_out_per_m: float = Field(default=8.0, ge=0)
    max_act_steps: int = Field(default=5, ge=1, le=20)
```

<div class="line-notes">

- `price_in_per_m: float = Field(default=2.0, ge=0)` `ge` 是 greater than or equal(大于等于),`ge=0` 表示不能小于 0。
- `price_out_per_m: float = Field(default=8.0, ge=0)` 输出单价同理。
- `max_act_steps: int = Field(default=5, ge=1, le=20)` `le` 是 less than or equal。取值 1 到 20 都可以。

</div>

注意 `default=` 要写出名字。写成 `Field(2.0, ge=0)`(位置参数)运行没问题,但 basedpyright 会报错 2 处,把位置参数的 2.0 当成缺了必填参数。我实测的就是这样,改成 `default=2.0` 后 `0 errors`。

配错:

```text
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
max_act_steps
  Input should be greater than or equal to 1 [type=greater_than_equal, input_value='0', input_type=str]
```

```text
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
price_in_per_m
  Input should be greater than or equal to 0 [type=greater_than_equal, input_value='-1', input_type=str]
```

我做完撤回了,后面的天都按没有这些约束的版本写。如果你想保留,也不会影响别的文件,因为默认值没变。

</details>

### 练习 4:别让 print(settings) 泄露数据库密码

**题目:** 第三步说过,`database_url` 里有密码,`print(Settings())` 会打出来。写一个函数 `safe_dump(s: Settings) -> dict`,返回配置的字典,但 `database_url` 里的密码换成 `***`,API key 保持遮住。用环境变量 `DATABASE_URL=postgresql://supportpilot:s3cret@localhost:5432/supportpilot` 验证。

<details><summary>参考答案</summary>

先确认问题真的存在,用假密码 `s3cret`:

```bash
DATABASE_URL=postgresql://supportpilot:s3cret@localhost:5432/supportpilot uv run python -c "
from supportpilot.config import Settings
print(Settings())" | tr ' ' '\n' | grep -i "database_url\|llm_api_key"
```

```text
llm_api_key=SecretStr('**********')
database_url='postgresql://supportpilot:s3cret@localhost:5432/supportpilot'
```

key 遮住了,数据库密码 `s3cret` 明文在输出里。写 `scratch/ex4_safe.py`:

```python
# supportpilot/scratch/ex4_safe.py
import re

from supportpilot.config import Settings


def mask_url(url: str) -> str:
    """postgresql://用户:密码@主机/库  →  把密码换成 ***。"""
    return re.sub(r"(://[^:/@]+:)[^@]+@", r"\1***@", url)


def safe_dump(s: Settings) -> dict:
    data = s.model_dump(mode="json")  # SecretStr 在这里就已经是 "**********"
    data["database_url"] = mask_url(data["database_url"])
    return data


s = Settings()
print(s.database_url)
print(safe_dump(s)["database_url"])
print(safe_dump(s)["llm_api_key"])
```

<div class="line-notes">

- `import re` 正则模块,[Day 1](/blog/agent-zero/day-001-salary-honest/) 用过。
- `def mask_url(url: str) -> str:` 只负责一件事:把连接串里的密码打码。
- `return re.sub(r"(://[^:/@]+:)[^@]+@", r"\1***@", url)` `re.sub(模式, 替换, 原文)`。模式里的括号圈出第一组:`://` 加上用户名(不含 `:`、`/`、`@` 的若干字符)再加一个冒号;后面的 `[^@]+@` 是密码和 `@`。替换里的 `\1` 表示「原样放回第一组」,所以得到 `://supportpilot:***@`。没有密码的连接串(比如 `postgresql://minliu@localhost/x`)匹配不上,原样返回。
- `def safe_dump(s: Settings) -> dict:` 返回一个普通字典,专门给日志和调试用。
- `data = s.model_dump(mode="json")` `mode="json"` 让所有值变成能写进 JSON 的形式,`SecretStr` 在这里变成了 `"**********"`,日期变成字符串。
- `data["database_url"] = mask_url(data["database_url"])` 只处理连接串这一项。
- `print(safe_dump(s)["llm_api_key"])` 看 key 在这个字典里是什么。

</div>

运行(顺便设一个假 key):

```bash
DATABASE_URL=postgresql://supportpilot:s3cret@localhost:5432/supportpilot LLM_API_KEY=sk-fake-1234567890 uv run python scratch/ex4_safe.py
```

```text
postgresql://supportpilot:s3cret@localhost:5432/supportpilot
postgresql://supportpilot:***@localhost:5432/supportpilot
**********
```

第一行是原始连接串(代码连库要用),第二行是打码后的,第三行 key 还是星号。以后要把配置写进日志,一律走 `safe_dump`,别直接打印 `Settings` 对象。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 配置(config) | 程序里会变、又不想改代码就能改的值:地址、密钥、单价、阈值。 |
| 环境变量 | 操作系统传给进程的一组键值对,值永远是字符串。前端的 `process.env` 就是它。 |
| `BaseSettings` | pydantic-settings 提供的类。继承它声明字段,实例化时自动从环境变量和 `.env` 里取值、转类型、校验。 |
| `model_config` | pydantic 约定的类属性名,用来写这个类的行为设置,比如 `env_file`。 |
| `SecretStr` | pydantic 的「秘密字符串」类型,打印时显示星号,要原文得调用 `get_secret_value()`。 |
| `lru_cache` | Python 标准库的缓存装饰器。无参函数加上它,只会真正执行一次,之后返回同一个结果。 |
| `Literal` | 类型标注里的「只能是这几个值之一」,相当于 TS 里的 `"a" \| "b"`。 |
| `.env.example` | 配置模板文件:变量名齐全、值是占位符,提交进 git,给新同事照着复制成 `.env`。 |
| 静默失败 | 出了问题但没有任何报错,程序拿默认值继续跑。比报错更难排查。 |
| 固定的「今天」(`sp_today`) | 把业务规则里的「今天」放进配置,让按日期算的结果不随真实日期漂移,评测才能前后对比。 |
| 孤儿文件 | 仓库里存在、但架构表里没有任何方块认领的文件。 |

## 常见误区

**把 `.env` 当成「必须存在」的东西。** 我们的 `Settings` 里每个字段都有默认值,所以没有 `.env` 也能 import、能跑 `make test`。key 没填只会在真调模型时收到 401。如果你希望缺了 key 就启动失败,是另一种取舍,代价是 CI 里和没有 key 的新机器上连测试都跑不了。我选了前者。

**`env_file=".env"` 写成相对路径。** 相对的是当前所在目录,不是这个 Python 文件所在的目录。从别的目录运行时读不到 `.env`,而且没有任何报错,只是所有值都变成默认值。我自己第一次是 `scripts/` 里的脚本调 API 时发现 key 是空的才反应过来。用 `Path(__file__).resolve().parents[2]` 算出仓库根目录再拼上去。

**以为 `get_settings()` 能感知运行中改的环境变量。** `lru_cache` 之后它只读一次。要么在测试里直接 `Settings(...)` 新建,要么 `cache_clear()`。

**测试里直接 `Settings()`。** 它会读你本机的 `.env`,测试结果就取决于谁的电脑上有什么。用一个不读 `.env` 的子类,再用 `monkeypatch.delenv` 把环境变量也清掉。

**`.env` 里写了个拼错的变量名,以为生效了。** `LLM_MODLE=xxx` 在 pydantic-settings 默认设置下会报 `Extra inputs are not permitted`,这是好事,不要为了「省事」去加 `extra="ignore"`。真的需要和别的工具共用一个 `.env` 时,再单独处理。

**以为 pre-commit 的 `detect-private-key` 能拦住 API key。** 它找的是私钥文件的头部(`BEGIN PRIVATE KEY` 这类),找不到 `sk-` 开头的字符串。真正的防线是 `.gitignore` 里的 `.env`,加上 `.env.example` 里只准写占位符(今天的测试盯着这一条)。

**默认值写成 `Field(2.0, ge=0)`。** 位置参数能跑,basedpyright 会报错,要写成 `Field(default=2.0, ge=0)`。

## 学习资料

### 文档与文章

- [pydantic 文档 · Settings Management](https://docs.pydantic.dev/latest/concepts/pydantic_settings/):`BaseSettings` 的官方说明。先读开头的 Usage 和「Dotenv (.env) support」两节,再翻「Field value priority」看优先级的完整规则,今天第二步的图就是它的简化版。30 分钟。
- [FastAPI 中文文档 · 设置和环境变量](https://fastapi.tiangolo.com/zh/advanced/settings/):中文,从「为什么需要设置」讲到 `lru_cache` 缓存 `get_settings()`,和我们的写法几乎一样,第四步那段可以对照着看。20 分钟。
- [The Twelve-Factor App · 配置](https://12factor.net/zh_cn/config):十多年前就写下的「配置要放进环境变量」原则,中文版,一页纸。读它能明白为什么部署时密钥走环境变量,不走文件。10 分钟。
- [Python 文档 · functools.lru_cache](https://docs.python.org/zh-cn/3.12/library/functools.html):`lru_cache` 和 `cache_clear` 的官方说明,往下翻一点是 `cache`(没有大小限制的写法)。
- [pytest 文档 · monkeypatch](https://docs.pytest.org/en/stable/how-to/monkeypatch.html):`setenv`、`delenv` 在这里,第七步用到的两个。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oYphecETh&autoplay=0&high_quality=1" title="Python使用dotenv库管理敏感信息(Python五分钟)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>赛博红兔CyberHongTu · Python使用dotenv库管理敏感信息(Python五分钟) · 约 7 分钟,2024 年。讲 `.env` 文件为什么存在、怎么读,Day 53 看过一遍。今天带着「我现在不用 dotenv 了,换成 BaseSettings」的问题再看,对比视频里手动读取的那几步,我们的 `Settings` 替你做了哪几件事。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV124m8YXEbt&autoplay=0&high_quality=1" title="10.Pydantic" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>霍格沃兹软件测试测吧 · 10.Pydantic · 约 17 分钟,2024 年。Day 54 推荐过。`BaseSettings` 是 `BaseModel` 的子类,字段类型、默认值、`Field` 约束的写法完全一样,今天遇到的报错格式在这里能看到更多种。这个视频没有讲 pydantic-settings 本身,以文章为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/502XOB0u8OY" title="Why Python Needs Pydantic for Real Applications" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Why Python Needs Pydantic for Real Applications · 英文,可开自动字幕。讲为什么真实项目要在边界上用 pydantic 校验数据,今天的配置就是最典型的一类「外部来的数据」。我没有逐字核对它有没有专门讲 BaseSettings,把它当作 pydantic 动机的补充看。</figcaption>
</figure>

### 书籍

今天这组不需要。配置这件事,上面的 Twelve-Factor 一页文章已经讲到位。

### 开源项目与代码

- [pydantic/pydantic-settings](https://github.com/pydantic/pydantic-settings):`BaseSettings` 的源码仓库。想知道「环境变量、`.env`、默认值」的优先级是怎么实现的,看 `sources` 目录。
- [theskumar/python-dotenv](https://github.com/theskumar/python-dotenv):Day 53 用的 `load_dotenv`,pydantic-settings 读 `.env` 底层也依赖它(Day 441 装依赖时它自己被带进来了)。

## 自测

1. 一个配置值可能来自哪三个地方?优先级从高到低是什么?

<details><summary>答案</summary>

真环境变量(shell 里 export 的,或者命令前面临时写的)最高,其次是 `.env` 文件,最低是代码里写的默认值。找到第一个有值的就用它。所以本机调试时,可以在命令前临时加一个变量覆盖 `.env`,不用改文件。我在第二步实测过:`.env` 里 `LLM_MODEL=from-dotenv`,命令前加 `LLM_MODEL=from-shell`,结果是 `from-shell`。

</details>

2. 为什么配置要在「启动时」校验,配错就炸?

<details><summary>答案</summary>

因为越早发现越好定位。启动时炸,报错直接写着字段名和收到的值。要是不校验,`"abc"` 会一路传下去,等 Agent 跑到第三轮要用的时候才抛一个无关的 `TypeError`,那时你得从日志里倒推是哪个配置错了。配置是整个系统的输入,第一个关口就该把它关死。

</details>

3. `env_file=".env"` 和 `env_file=ROOT / ".env"` 有什么区别?各自出事的表现是什么?

<details><summary>答案</summary>

前者是相对路径,相对于你运行命令时所在的目录;后者用 `__file__` 算出了仓库根目录的绝对路径。用前者,从 `scratch/` 或 `scripts/` 运行时读不到 `.env`,而且没有任何报错,所有值静默变成默认值,表现是调 API 时 key 是空的,返回 401。第二步我实测过:同一个 `.env`,在根目录读得到,在 `scratch/` 里读到的是默认值 `deepseek-flash`。

</details>

4. `get_settings()` 为什么要加 `@lru_cache`?测试里为什么要小心它?

<details><summary>答案</summary>

没有它每次调用都会重新读环境变量、读 `.env`、重新校验,浪费且无意义。加了之后整个进程只创建一次,所有调用拿到同一个对象。代价是进程启动后再改环境变量它看不见:第四步实测,先读到 5,把环境变量改成 9 后再读还是 5,`cache_clear()` 之后才变成 9。测试里一个测试改了配置,下一个测试会拿到旧缓存,所以要么直接 `Settings(...)` 新建,要么每个测试前清缓存。

</details>

5. 为什么 `sp_today` 要做成配置,而不是在退款规则里直接用 `date.today()`?

<details><summary>答案</summary>

退款规则按「付款后第几天」算,用系统时钟的话,同一张订单、同一份评测标准答案,每过一天结果就不一样。第五步实测:李娜 9 月 24 日付款,我写文章那天(10 月 27 日)按系统时钟是 33 天,不能全额退;按固定的 `SP_TODAY=2026-10-01` 是 7 天,可以。评测分数下降时你分不清是代码改坏了,还是日期走远了。固定「今天」让结果可复现,到真上线再让它跟着系统时间走。

</details>

6. **面试题**:「你的项目里,配置是怎么管理的?」

<details><summary>答案</summary>

我用 pydantic-settings 的 `BaseSettings` 写了一个 `Settings` 类,所有可变的东西(模型地址和模型名、API key、单价、数据库地址、业务阈值、Agent 的步数上限)都是它的字段,值按「真环境变量、`.env`、默认值」的优先级读,类型由 pydantic 校验,配错在启动时就报错。API key 用 `SecretStr`,打印出来是星号。`.env` 不进 git,仓库里放 `.env.example`,并且有一条测试保证模板里的变量名和 `Settings` 字段一一对应,不会有人加了字段忘了改模板。全项目通过一个 `lru_cache` 缓存的 `get_settings()` 取配置;测试里用一个不读 `.env` 的子类,结果不依赖开发者本机。还有一个细节:业务规则里的「今天」是配置项,默认固定,这样按日期算的评测结果可以复现。

</details>

## 明天预告

明天是 Day 443 · 搭骨架(三):数据库。今天的 `Settings` 里已经有了 `database_url` 和 `emb_dim` 两项,明天就用上它们:写 `db/schema.sql`,把业务表(客户、订阅、账单、退款申请、工单)和知识库表(文章、文本块、向量列)建进 Postgres,再写 `src/supportpilot/db.py` 的 `connect()`。重点是「表怎么设计才能让 Agent 的错误写不进去」,外键和 CHECK 约束各拦住一类错;还会做一次「迁移」:表建好以后要加一列,怎么改才不丢数据。
