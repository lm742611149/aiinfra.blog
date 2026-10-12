---
title: 'Day 81 · W12 复习:给 AgentOps 训练一个路由小模型'
description: 'W12 收尾。把选型、自部署、LoRA、蒸馏、置信度路由串成一条能重复执行的流水线,产出 AgentOps 平台的第一个自研模型:分诊路由小模型,连同数据卡、模型卡和上线方案。最后过一遍这周的资深面试题和最容易踩的坑。'
pubDate: 2026-10-12
regime: none
tags: ['review', 'model-pipeline', 'lora', 'routing', 'model-card', 'agentops', 'agent-60']
series: 'agent-60'
day: 81
lang: 'zh'
---

## 今天要解决的问题

这一周你做了很多实验,但实验和能上线的东西之间还差一截:实验是一次性的,上线的模型要能重复训练、能追溯、能回滚、出了问题能说清楚它是用什么数据训的。资深工程师交付的不是一个模型文件,而是一条流水线和一套文档。

今天的目标:

1. 用一张知识地图把 W12 的六天串起来,说清楚每种方法解决什么问题、什么时候用。
2. 把分诊路由小模型的完整流程整理成 AgentOps 仓库里可重复执行的步骤:数据 → 训练 → 评测 → 部署 → 路由 → 监控。
3. 写出数据卡和模型卡,让一个没参与训练的同事能看懂这个模型能做什么、不能做什么、怎么回滚。
4. 填一张成本对比表,给出上线建议。
5. 过一遍这周的资深面试题和坑清单。

预计用时 6–8 小时,主要是把前几天的产出物整理成流水线。前置:Day 75–80 全部。

## 一页知识地图

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="W12 知识地图:从选型到自部署、训练方法和路由">
<rect x="20" y="20" width="600" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="40" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">Day 75 选型:硬约束过滤 → 自有评测集 → TCO → 节点路由表</text>
<text x="320" y="56" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">问题:哪个节点用哪个模型,为什么</text>
<line x1="320" y1="64" x2="320" y2="84" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="20" y="84" width="600" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="104" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">Day 76 自部署:显存账、vLLM、压测、量化</text>
<text x="320" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">问题:能不能、值不值得自己跑模型</text>
<line x1="320" y1="128" x2="320" y2="148" stroke="var(--rule)" stroke-width="1.5"/>
<g font-family="var(--font-mono)">
<rect x="20" y="148" width="140" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="172" font-size="12" fill="var(--ink)" text-anchor="middle">Day 77 SFT</text>
<text x="90" y="190" font-size="10" fill="var(--ink-soft)" text-anchor="middle">模仿标准答案</text>
<text x="90" y="206" font-size="10" fill="var(--ink-soft)" text-anchor="middle">LoRA / QLoRA</text>
<rect x="173" y="148" width="140" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="243" y="172" font-size="12" fill="var(--ink)" text-anchor="middle">Day 78 DPO</text>
<text x="243" y="190" font-size="10" fill="var(--ink-soft)" text-anchor="middle">学「A 比 B 好」</text>
<text x="243" y="206" font-size="10" fill="var(--ink-soft)" text-anchor="middle">没有唯一答案时</text>
<rect x="326" y="148" width="140" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="396" y="172" font-size="12" fill="var(--ink)" text-anchor="middle">Day 79 蒸馏</text>
<text x="396" y="190" font-size="10" fill="var(--ink-soft)" text-anchor="middle">大模型批量打标</text>
<text x="396" y="206" font-size="10" fill="var(--ink-soft)" text-anchor="middle">上限是老师</text>
<rect x="479" y="148" width="141" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="549" y="172" font-size="12" fill="var(--ink)" text-anchor="middle">Day 80 RLVR</text>
<text x="549" y="190" font-size="10" fill="var(--ink-soft)" text-anchor="middle">从结果对错中学</text>
<text x="549" y="206" font-size="10" fill="var(--ink-soft)" text-anchor="middle">GRPO、奖励设计</text>
</g>
<line x1="320" y1="218" x2="320" y2="238" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="20" y="238" width="600" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="258" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">Day 79 路由:置信度级联 + 风险规则,扫阈值选工作点</text>
<text x="320" y="274" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">问题:小模型什么时候该把请求交给大模型</text>
<text x="320" y="315" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">贯穿全周的一条线:每个决定都用 Day 50 的评测集说话,test 集只用一次</text>
</svg>
<figcaption>这一周的六天其实是同一个问题的不同层次:先决定用什么模型,再决定在哪里跑,最后决定要不要、用什么方法改造它。</figcaption>
</figure>

几句话串一遍。Day 75 讲选模型是带数据的工程决策:先用硬约束过滤,再用自己的评测集比,最后算包含失败成本的 TCO,产出不是一个赢家而是一张路由表。Day 76 讲自部署的账:卡开着就在计费,显存被权重和 KV cache 瓜分,连续批处理让吞吐上去,压测找满足 SLO 的工作点,大部分时候只值得把高频简单节点自部署。Day 77 讲微调的定位:提示词管「不知道你要什么」,RAG 管「不知道某些事实」,微调管「知道但不稳或太贵」;LoRA 只训 1% 左右的参数,学习率比全量高一个数量级。Day 78 讲偏好优化:没有唯一标准答案时用相对偏好,DPO 把 RLHF 的三步压成一步,最大的风险是学到长度这类副作用。Day 79 讲蒸馏和路由:序列级蒸馏是应用团队最实用的,上限是老师;用 logprobs 算置信度,扫阈值画取舍曲线,先看校准再信置信度。Day 80 讲强化学习:从结果对错中学,有机会超过示范;GRPO 用组内平均代替价值模型;奖励设计就是评测设计,每条规则都要想一遍会被怎么钻空子。

## 把实验变成流水线

AgentOps 是进阶篇的毕业项目(Day 96 开题),今天先给它放进第一个零件。在 AgentOps 仓库里给每个自研模型一个目录,所有步骤都能用一条命令重跑:

```text
agentops/
└── models/
    └── triage-router/
        ├── README.md              # 模型卡
        ├── DATA_CARD.md           # 数据卡
        ├── Makefile               # 一条命令跑一步
        ├── config/
        │   ├── train.yaml         # 训练超参数(LLaMA-Factory 格式或你自己的)
        │   └── route.yaml         # 阈值、风险规则、回退模型
        ├── data/                  # 只放脚本和数据清单,数据本身放对象存储
        │   └── MANIFEST.json      # 每个数据文件的路径、行数、sha256、来源
        ├── scripts/
        │   ├── label_with_teacher.py   # Day 79
        │   ├── build_sft_data.py       # Day 77
        │   ├── per_class.py            # Day 77
        │   ├── confidence.py           # Day 79
        │   └── sweep.py                # Day 79
        └── reports/
            └── 2026-10-12-v1.md   # 每次训练一份评测报告
```

`Makefile` 把流程写成可重复的步骤。关键原则是每一步的输入输出都有版本:数据有清单和哈希,训练记下配置和基座模型的版本,评测报告记下用的是哪个模型文件、哪份评测集:

```makefile
# agentops/models/triage-router/Makefile
VERSION ?= v1
BASE    ?= Qwen/Qwen3-1.7B
EVAL    ?= ../../../supportpilot/evals/datasets/tickets_v1.jsonl

label:            ## 用老师给无标签工单打标(Day 79)
	python scripts/label_with_teacher.py data/unlabeled.jsonl

dataset: label    ## 去重、去评测集、平衡类别(Day 77),并写数据清单
	python scripts/build_sft_data.py labeled.jsonl $(EVAL) data/$(VERSION)/
	python -c "import hashlib,json,pathlib; d=pathlib.Path('data/$(VERSION)'); \
	json.dump({p.name: {'rows': sum(1 for _ in p.open()), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} \
	for p in d.glob('*.jsonl')}, open('data/MANIFEST.json','w'), indent=2)"

train:            ## 在 GPU 机器上执行,产出 LoRA 适配器
	llamafactory-cli train config/train.yaml

serve:            ## 基座 + LoRA 挂到 vLLM(Day 76、77)
	vllm serve $(BASE) --enable-lora --lora-modules triage-$(VERSION)=out/$(VERSION) \
	  --max-lora-rank 16 --max-model-len 4096 --api-key $$VLLM_API_KEY

eval:             ## 小模型和大模型各跑一遍 dev,扫阈值(Day 79)
	python scripts/run_both.py --split dev --small triage-$(VERSION) --out reports/
	python scripts/sweep.py reports/small.jsonl reports/big.jsonl | tee reports/sweep-$(VERSION).txt

final:            ## 选定阈值后,test 集只跑这一次
	python scripts/run_both.py --split test --small triage-$(VERSION) --out reports/test-
```

`run_both.py` 是把 Day 79 的 `router.py` 和 Day 75 的 `bakeoff.py` 组合起来的小脚本:对每条评测用例分别调小模型(带 logprobs)和大模型,写出 `small.jsonl` 和 `big.jsonl`。它几乎全是复用前面的代码,留给你自己拼,这本身就是一个很好的检验:如果拼不起来,说明前面几天的代码接口设计得不够干净。

路由配置单独放一个文件,改阈值不用改代码:

```yaml
# agentops/models/triage-router/config/route.yaml
model: triage-v1
threshold: 0.90            # 由 reports/sweep-v1.txt 选出,选择规则见模型卡
always_big:                # 高风险类别不走置信度判断
  - refund
  - billing
fallback:
  model: deepseek-v4-pro
  on_parse_error: true     # 小模型输出解析失败也回退
shadow_mode: true          # 上线第一周:小模型只记录不生效
```

`shadow_mode` 是上线的第一步:小模型和大模型同时分类,线上用大模型的结果,小模型的结果只写进日志。跑一周后统计两者一致率、小模型在各类别上的准确率,确认没有意外再切流量。这一步几乎不花额外的钱(小模型自部署),却能在真实分布上验证模型,避免离线评测和线上表现脱节。

## 数据卡和模型卡

模型卡这个做法来自 Google 2019 年的一篇论文,现在 Hugging Face 上每个模型都有。它回答的是:这个模型是什么、用什么训练的、在哪些情况下表现如何、不该用在哪里。对公司内部的模型同样重要,半年后你自己都会忘记当时的细节。下面是一个精简模板,数字留空给你填:

```markdown
# triage-router v1 模型卡

## 用途
CloudLedger 客服工单分诊:输出 category / needs_account_data / needs_human / urgency 四个字段的 JSON。
只用于分诊节点。不用于起草回复、不用于任何涉及金额的判断。

## 基座与训练
- 基座:Qwen/Qwen3-1.7B(Apache-2.0),推理时关闭思考模式
- 方法:LoRA SFT,r=16,alpha=16,lr=2e-4,2 epochs(config/train.yaml)
- 训练数据:见 DATA_CARD.md,data/MANIFEST.json 中的 sha256 = ______

## 评测(Day 50 评测集 tickets_v1,test 集只评一次)
| 指标 | 本模型 | deepseek-v4-pro | 级联(阈值 0.90) |
| 分类准确率 test | | | |
| JSON 合法率 | | | |
| 回退率 | — | — | |
| 单次 P50 延迟 | | | |

按类别的准确率见 reports/2026-10-12-v1.md。

## 已知局限
- 多意图工单(同时要退款和开票)倾向于只给一个类别
- ______(从错误分析里补)

## 路由与阈值的选择规则
准确率不低于 ____(Day 43 容忍线)的阈值中选成本最低的。refund / billing 不走小模型。

## 上线与回滚
- 第一周 shadow_mode,一致率 ≥ ____% 才切流量
- 回滚:route.yaml 中 model 改回 deepseek-v4-pro,或 threshold 改为 1.01(全部回退)
- 监控:回退率、各类别人工改判率,回退率周环比上升 50% 告警
```

数据卡记录训练数据的来源构成、标注方式、时间范围、已知偏差(比如线上数据里 billing 占多数被下采样过)、隐私处理方式(工单里的手机号、邮箱在打标前脱敏)、以及和评测集的隔离方式。这些问题在安全审查和事故复盘时都会被问到。

## 成本对比与上线建议

最后一张表把这一周的结论落到钱上。用 Day 52 账本的月调用量,按三种方案算分诊节点的月成本。数字留空,你用自己的测量值和查到的价格填:

| 方案 | 分诊准确率(test) | 月调用费 | 自部署卡费 | 运维人力(折算) | 失败成本估算 | 合计 |
| --- | --- | --- | --- | --- | --- | --- |
| 全部用 deepseek-v4-pro | | | 0 | 0 | | |
| 全部用 deepseek-flash | | | 0 | 0 | | |
| 自研小模型 + 级联回退 | | | | | | |

写上线建议时,用这个结构:结论一句话;支撑数据(准确率差多少、成本省多少、回退率多少);风险和对策(分布漂移、单点故障、版本升级);上线步骤(shadow、灰度比例、切换条件、回滚方式);需要谁配合(GPU 资源、客服主管的改判数据)。这个结构 Day 106 写设计文档时还会用到。

## 资深面试题汇总

这一周每篇都有资深面试题,这里补几道综合性的,试着每道用三分钟口头讲清楚。

1. 你们的 Agent 一个月模型费用 20 万,老板要求降到 10 万,不能明显影响质量。给出你的分析框架和方案。

<details><summary>答案</summary>

先拆账:按节点、按模型、按缓存命中统计花费,找出前两三个大头。再看每个大头的优化空间:前缀稳定提高缓存命中(几乎无损);按节点路由,简单节点换便宜模型(用评测集验证);高频简单节点考虑自研小模型加级联(要算自部署 TCO);减少无效调用(重试、过长上下文、不必要的自检轮次)。方案按「风险从低到高、收益从大到小」排序分阶段做,每一步都用同一个评测集做配对比较,线上灰度看转人工率和客户重问率。最后给出预计节省、质量变化和取舍,并说明哪些高风险环节保持不动。

</details>

2. 同事说「我们把所有帮助中心文章都拿来微调模型,这样就不用 RAG 了」。你怎么回应?

<details><summary>答案</summary>

微调不擅长可靠地灌入事实,政策变化后要重训,回答无法追溯出处,事实准确性也难保证;RAG 更新一篇文章即时生效、能引用出处。微调适合的是格式、风格、固定判断任务和降成本。可以两者结合:RAG 提供事实,微调让模型更好地使用检索结果(比如学会引用格式、学会在检索不到时说不知道)。

</details>

3. 怎么判断一个自部署推理服务的容量够不够?

<details><summary>答案</summary>

先定 SLO(TTFT、TPOT 的 P99 上限),用接近线上分布的请求(长度分布、共享前缀比例)压测不同并发,找满足 SLO 的最大吞吐作为单卡工作点;按峰值流量而不是平均流量算需要的卡数,加冗余;上线后用真实流量回放验证,并监控队列长度、KV cache 使用率、抢占次数,接近上限时告警扩容。

</details>

4. 你的小模型离线评测准确率 95%,上线一周后客服反馈「分类经常错」。怎么排查?

<details><summary>答案</summary>

先量化:用线上被人工改判的工单算真实准确率,确认问题是否存在、多大。然后对比离线评测集和线上数据的分布(类别比例、工单长度、新出现的主题),看是不是分布漂移;检查推理时的模板和训练时是否一致、思考模式是否关闭、量化版本是否和评测时一致;检查路由日志,高置信度的错误多不多(校准问题)。处理上先调整阈值或把问题类别加入强制回退规则止血,再收集线上错误样本打标重训,并把这批样本加进评测集。

</details>

5. DPO、SFT、RLVR 你会怎么给一个新人解释,各用一句话?

<details><summary>答案</summary>

SFT 是照着标准答案抄,学会「该怎么做」;DPO 是看一对答案里哪个更好,学会「怎么做得更好」;RLVR 是自己去做,用程序判对错,学会「怎么做对」,而且有机会做得比示范还好。

</details>

6. 如果让你在团队里推动「自研小模型」这件事,你会怎么说服老板,又会提前说清楚哪些风险?

<details><summary>答案</summary>

用数据说话:当前分诊的月成本和占比、离线评测中小模型与大模型的准确率差距、级联方案的回退率和预计节省、shadow 模式验证计划。风险提前讲:需要 GPU 资源和运维投入;模型要随数据分布定期重训;基座模型升级时要重新训练评测;线上有回退兜底所以质量风险可控。给出明确的止损条件:shadow 一致率达不到某个值、或节省不到某个数字,就停止,只损失几周的投入。

</details>

## 坑清单

这一周最容易踩的坑,按出现的频率排:

- 训练集混进评测用例,测出来的提升是假的。用指纹去重和场景黑名单在脚本里强制拦截。
- chat template 训练和推理不一致,或者推理时忘了关思考模式,小模型表现莫名其妙。
- `--max-model-len` 用默认值,小卡上 vLLM 起不来。
- 用随机数据压测的吞吐直接当线上容量。
- 自部署端口开在公网没加 `--api-key`。
- 只看训练损失或训练奖励,不看独立评测集。
- DPO 数据有长度偏差,模型学会写长。
- 直接相信微调后小模型的置信度,没看校准表就用来路由。
- 用 dev 集调阈值,再用 dev 集报结果。
- GRPO 数据太简单或太难,`frac_reward_zero_std` 很高,训练空转。
- 奖励函数解析宽松,模型学会在 JSON 外面加内容。
- 用完云 GPU 忘了销毁实例。

## 动手练习

今天的产出物就是 AgentOps 的第一个模型目录。

1. 在 AgentOps 仓库(可以先建一个空仓库,Day 96 再完善)里按上面的结构建 `models/triage-router/`,把这周的脚本放进去,补全 `run_both.py`。
2. 让 `make dataset`、`make eval`、`make final` 都能一条命令跑通(训练那一步可以在 GPU 机器上单独执行)。
3. 写完模型卡和数据卡,所有空白都填上你的实测数字或明确标注「未测」。
4. 填成本对比表,写一页上线建议,按上面的五段结构。
5. 把 `route.yaml` 接进 SupportPilot 的分诊节点(用 Day 79 的 `router.py` 读这个配置),先开 shadow 模式,跑一遍 dev 集确认日志里记录了 `_route` 和 `_conf`。
6. 口头练习面试题汇总里的六道题,每道录音三分钟,听一遍自己哪里讲得含糊。

验收标准:换一台机器,别人照着 README 能复现你的评测报告;模型卡里的每个数字都能在 `reports/` 里找到出处;上线建议包含明确的回滚方式和止损条件。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 模型卡 | 描述模型用途、训练数据、评测结果、局限和使用限制的文档 |
| 数据卡 | 描述训练数据来源、标注方式、偏差、隐私处理和版本的文档 |
| 数据清单(manifest) | 记录每个数据文件路径、行数、哈希的文件,保证训练可追溯 |
| shadow 模式 | 新模型和旧模型同时运行,只记录新模型结果不生效,用于线上验证 |
| 灰度 | 只把一部分流量切给新方案,观察指标再逐步扩大 |
| 止损条件 | 事先约定的「达不到就停止」的指标阈值 |
| 回滚 | 出问题时恢复到旧方案的操作,应当是一个配置开关 |

## 常见误区

**把实验当成交付。** 一次性跑通的笔记本不是可上线的模型。要能重复训练、数据可追溯、评测报告可复现、配置和代码分开。

**跳过 shadow 直接切流量。** 离线评测再好,也替代不了真实分布上的验证。shadow 模式几乎不花钱,却能挡住大部分意外。

**模型卡写成宣传材料。** 模型卡最有价值的部分是「已知局限」和「不该用在哪里」。只写优点的模型卡,出事故时没有任何帮助。

**只算调用费省了多少。** 自研模型要加上卡费、运维人力、定期重训的成本,以及可能增加的失败成本。合计之后才是真实的节省。

## 学习资料

### 文档与文章

- [Model Cards for Model Reporting](https://arxiv.org/abs/1810.03993):模型卡的原始论文,读第 4 节的模板,30 分钟。
- [Hugging Face · Model Cards](https://huggingface.co/docs/hub/model-cards):Hugging Face 上模型卡的写法和元数据字段。
- [Thinking Machines · LoRA Without Regret](https://thinkingmachines.ai/blog/lora/) 和 [On-Policy Distillation](https://thinkingmachines.ai/blog/on-policy-distillation/):这周最值得反复读的两篇,复习时再过一遍结论部分。
- [vLLM · LoRA Adapters](https://docs.vllm.ai/en/latest/features/lora.html):多 LoRA 挂载和运行时动态加载适配器(`/v1/load_lora_adapter`),AgentOps 里做模型热更新会用到。
- [LLaMA-Factory 中文文档](https://llamafactory.readthedocs.io/zh-cn/latest/):把训练写成配置文件的参考。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BtLq6CEHb&autoplay=0&high_quality=1" title="【喂饭教程】逼自己在一周学会微调Qwen3-0.6B小模型,原理+架构+微调+实战一次讲清的详细教程!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大模型微调教程 · 【喂饭教程】逼自己在一周学会微调Qwen3-0.6B小模型 · 6 个分 P 共约 1 小时 20 分,2026 年 5 月,把小模型从原理到微调实战串一遍,当作 W12 训练部分的复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17jGdzAETg&autoplay=0&high_quality=1" title="unsloth微调Qwen3大模型保姆级视频教程!从数据处理到LoRA微调Qwen3-14B到4比特量化并且用LM Studio运行!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI超元域 · unsloth微调Qwen3大模型保姆级视频教程 · 13 分钟,从数据处理到 LoRA 训练再到量化导出,和 Day 77 的 Unsloth 路线对照。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/o6l6tJQgUg4" title="Post-Training and RLHF Overview | Post-Training Book Course, Lecture 1" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Nathan Lambert · Post-Training and RLHF Overview · 后训练全景的一讲,SFT、偏好优化、强化学习的关系讲得很清楚,适合当这一周的总复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4JofSJIrjwU" title="How to Fine-Tune any AI Model Locally (FULL Tutorial)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Tech With Tim · How to Fine-Tune any AI Model Locally (FULL Tutorial) · 从环境搭建到训练导出的完整演示,如果你这周的训练环境还没顺利跑通,照着它排查。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 7 章 Finetuning、第 8 章 Dataset Engineering、第 9 章 Inference Optimization,这周的内容几乎都在这三章里,复习时按章对照。
- Paul Iusztin、Maxime Labonne《LLM Engineer's Handbook》(Packt, 2024):讲 LLM 系统的工程化流水线,数据、训练、评测、部署怎么串起来,和今天的流水线思路一致,挑第 5、6、8 章读。

### 开源项目与代码

- [mlabonne/llm-course](https://github.com/mlabonne/llm-course):《LLM Engineer's Handbook》作者之一维护的免费课程,其中 LLM Engineer 部分的微调、偏好对齐、量化、部署章节可以当作这一周的延伸阅读清单。
- [hiyouga/LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory):把训练写成 YAML 配置、纳入流水线的现成工具。
- [vllm-project/vllm](https://github.com/vllm-project/vllm):多 LoRA 服务的实现,AgentOps 后面做模型热更新时会再回来看。

## 自测

1. 用一句话分别说出 Day 75 到 Day 80 每天解决的核心问题。

<details><summary>答案</summary>

Day 75:哪个节点用哪个模型,用数据和 TCO 决定。Day 76:能不能、值不值得自己跑模型,以及一张卡能撑多少流量。Day 77:什么问题该微调,怎么用 LoRA 低成本微调。Day 78:没有唯一标准答案时,怎么用偏好数据让模型变好。Day 79:怎么用大模型造数据训练小模型,并让小模型知道什么时候该交给大模型。Day 80:怎么让模型从结果对错中学习、怎么设计不被钻空子的奖励。

</details>

2. 为什么 test 集在整个流程里只能用一次?如果用了两次会怎样?

<details><summary>答案</summary>

test 集是对最终方案的无偏估计。只要根据 test 集的结果做过任何调整(换阈值、换模型、改数据),它就变成了另一个 dev 集,报出来的数字会偏乐观。用了两次以上,就需要一份新的、没见过的 test 集来做最终评估。

</details>

3. shadow 模式能发现哪些离线评测发现不了的问题?

<details><summary>答案</summary>

线上真实分布和评测集的差异(新主题、新错误码、不同渠道的写法);推理环境和评测环境的差异(模板、量化版本、思考模式开关);真实负载下的延迟和稳定性;以及在大样本上才显现的低频错误类型。

</details>

4. (资深面试题)讲一个你负责的模型从训练到上线的完整过程,重点讲你怎么保证它可以被回滚和复现。

<details><summary>答案</summary>

按流水线讲:数据来源和清单(哈希、行数、来源构成、和评测集的隔离方式)→ 训练配置(基座版本、超参数、配置文件进版本控制)→ 评测报告(dev 调参、test 只用一次、按类别和与基线的对比)→ 模型卡(用途、局限、选择规则)→ 上线(shadow、灰度、切换条件)→ 回滚(路由配置一个开关切回大模型,或阈值设为全部回退)→ 监控(回退率、改判率告警)→ 重训机制(线上错误样本回流)。复现靠数据哈希加配置文件加固定基座版本;回滚靠「新模型只是路由配置里的一个选项」,而不是替换掉旧的调用路径。

</details>

5. 模型卡里最重要的是哪一部分?为什么?

<details><summary>答案</summary>

「已知局限」和「不该用在哪里」。它决定了别人会不会把模型用在不合适的场景,出事故时也能快速判断是不是越界使用。只写优点和分数的模型卡对风险控制几乎没有帮助。

</details>

## 明天预告

Day 82 · 从一个 Agent 到一个平台:多租户 Agent 平台架构。今天你给 AgentOps 放进了第一个模型。下一周进入 W13 平台化与规模:当公司里有十个团队都想做 Agent 时,怎么把模型、工具、评测、可观测做成大家共用的平台,而不是每个团队各造一遍轮子。
