---
title: 'Day 23 · 成本看板：每次实验的 GPU 时长和花费一眼可查'
description: '把每一次开机都变成一行记录：日期、实验名、卡型、小时价、时长、花费、一句结论。启动和销毁脚本自动记账，一段 Python 汇总本月，再把小时价换算成每个实验多少钱、每百万 token 多少钱。答不出「这个月花了多少、花在哪」就是看板没做好。'
pubDate: 2026-09-21
regime: none
tags: ['cost', 'runpod', 'budget', 'tooling', 'aiinfra-365']
series: 'aiinfra-365'
day: 23
lang: 'zh'
---

## 今天要解决的问题

W4 前四天把环境这件事做成了流水线:Day 19 第一次租到卡,Day 20 想清楚了销毁后什么会丢,Day 21 写了 5 分钟起环境的 bootstrap,Day 22 加了三层自动销毁。今天是这条流水线的最后一环:钱。

路线图给这一天的验收标准只有一句话:**能立刻回答「这个月花了多少、花在哪个实验上」**。答不出来,前面四天的工程就少了闸门。三层自动销毁防的是「忘关机」这种单次事故,成本看板防的是另一种更隐蔽的失控:每次都没忘关,但一个月下来花了 180 美元,回头想不起来哪些实验值这个钱。

今天结束时要有三样东西:

1. 一个记录格式,一次实验一行,字段定死。
2. 两段脚本改动,让 Day 21 的 bootstrap 和 Day 22 的销毁脚本自己往记录里写,我不用手动记。
3. 一段汇总代码加两个换算公式:每个实验多少钱、每百万 token 多少钱。

全文的价格数字来自 2026 年 9 月 5 日 RunPod 定价页(Community Cloud 档),下面会给出处。价格会变,公式不变。所有「示例数据」的表格都是我为了演示格式编的,不是实测,以后真实数据填进去会替换掉。

## 看板要回答的三个问题

先想清楚看板是给谁看、回答什么,再定字段。给我自己看,回答三个问题:

**这个月花了多少。** 对着预算 30 到 60 美元看,超了没有,离上限还有多远。这是闸门,每次开机前先看一眼。

**花在哪个实验上。** 同样 20 美元,是 Day 16 那种 batch 扫描花的,还是某次忘了改脚本白跑了两小时。分不清这两种,下个月不知道该省哪里。

**每个实验值不值。** 一次实验的花费除以它产出的东西。W3 一次 batch 扫描产出一条曲线加一个转折点,花 3 美元是值的;一次 7B 模型下载重来三遍花了 4 美元一个数字都没出,不值。这一栏靠一句话结论支撑,写不出结论的实验就是白花。

这三个问题决定了字段:时间、名字、卡、单价、时长、花费、结论。多了没用,少了答不出。

## 记录格式:一行一次实验

用 CSV,不用数据库也不用表格软件。理由是它能被 bash 一行 `echo >>` 追加,能被 git 管,能被 Python 三行读出来,十年后还打得开。文件名 `gpu-ledger.csv`,放在代码仓库的 `cost/` 目录(Day 21 的 `REPO_DIR`,默认 `/workspace/aiinfra-lab`),跟着代码走。

字段定死为九列:

| 列 | 含义 | 谁填 | 例子 |
| --- | --- | --- | --- |
| `date` | 开机日期,ISO 格式 | 启动脚本 | `2026-09-21` |
| `experiment` | 实验名,和当天笔记标题对得上 | 我,开机时传参 | `w3-d4-batch-sweep` |
| `provider` | 云厂商 | 启动脚本 | `runpod` |
| `gpu` | 卡型,从 `nvidia-smi` 读 | 启动脚本 | `A100-SXM4-80GB` |
| `price_per_hour` | 小时价,美元 | 我,开机时传参 | `1.39` |
| `start` | 开机时刻,UTC | 启动脚本 | `2026-09-21T13:02:11Z` |
| `end` | 销毁时刻,UTC | 销毁脚本 | `2026-09-21T14:41:50Z` |
| `cost_usd` | `(end − start) 小时数 × price_per_hour`,保留两位 | 销毁脚本 | `2.31` |
| `note` | 一句话结论,不写就是白花 | 我,销毁前 | `转折点在 batch 48,早于 ridge` |

两个设计上的选择说一下。

小时价手填而不是自动抓,因为 RunPod 和 Vast 的价格在开机那一刻就定了,页面上看得见,填进去比调 API 查稳。Vast 是竞价市场,同一张卡不同机器价格不同,自动抓反而容易抓错机器。

`cost_usd` 由脚本按时长算,不去账单页抄。账单页有存储费、有按秒取整的差异,和我的记录对不上是常态。看板的目的是「我认为这次实验值多少钱」,精确到美分没意义。月底拿账单总数和看板总数对一次,差 10% 以内就算对,差得多说明有我不知道的项目在扣钱,那才是要查的。

## 让脚本替我记账

手动记账三天就会断。所以把记账塞进已经每次必跑的两个脚本里:Day 21 的 `bootstrap.sh` 负责开一行,Day 22 的销毁脚本负责补完这一行。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="记账流程:开机时 bootstrap 追加半行,销毁时 shutdown 补齐时长和花费,月底汇总脚本读整个 CSV">
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-faint)"/>
    </marker>
  </defs>
  <rect x="20" y="40" width="140" height="64" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="90" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">bootstrap.sh</text>
  <text x="90" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">Day 21</text>
  <rect x="250" y="40" width="140" height="64" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="320" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">实验跑着</text>
  <text x="320" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">按小时计费中</text>
  <rect x="480" y="40" width="140" height="64" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="550" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">shutdown.sh</text>
  <text x="550" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">Day 22 三层之一</text>
  <line x1="160" y1="72" x2="248" y2="72" stroke="var(--ink-faint)" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="390" y1="72" x2="478" y2="72" stroke="var(--ink-faint)" stroke-width="1.5" marker-end="url(#arr)"/>
  <rect x="120" y="160" width="400" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="187" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">gpu-ledger.csv(一行一次实验,进 git)</text>
  <line x1="90" y1="104" x2="180" y2="158" stroke="var(--mem)" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="96" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">追加半行:date…start</text>
  <line x1="550" y1="104" x2="470" y2="158" stroke="var(--mem)" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="470" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">补齐:end, cost, note</text>
  <text x="320" y="236" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">月底:summarize.py 读整个文件 → 总额 / 按实验 / 按卡型</text>
</svg>
<figcaption>记账不靠记性。开机脚本写前半行,销毁脚本写后半行,两边都是本来就必跑的。</figcaption>
</figure>

### 开机:追加半行

在 `bootstrap.sh` 末尾加一段。实验名和小时价用环境变量传进来(和 Day 21 的 `run.sh` 用同一个 `EXP_NAME`),其余自动:

```bash
# bootstrap.sh 末尾追加。用法:EXP_NAME=batch-sweep PRICE=1.39 bash bootstrap.sh
EXP_NAME="${EXP_NAME:?EXP_NAME required}"
PRICE="${PRICE:?PRICE (USD per hour) required}"
REPO_DIR="${REPO_DIR:-/workspace/aiinfra-lab}"   # Day 21 clone 到这里
LEDGER="$REPO_DIR/cost/gpu-ledger.csv"
mkdir -p "$(dirname "$LEDGER")"

GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1 | tr ' ' '-')
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PROVIDER="${PROVIDER:-runpod}"              # Vast 上启动时 export PROVIDER=vast

[ -f "$LEDGER" ] || echo "date,experiment,provider,gpu,price_per_hour,start,end,cost_usd,note" > "$LEDGER"
echo "${START%%T*},$EXP_NAME,$PROVIDER,$GPU_NAME,$PRICE,$START,,," >> "$LEDGER"

# 把 start 存到一个固定位置,销毁脚本要用
echo "$START" > /tmp/ledger_start
echo "$EXP_NAME" > /tmp/ledger_experiment
echo "$PRICE" > /tmp/ledger_price
```

这一行写进去时 `end`、`cost_usd`、`note` 三列是空的。空着是故意的:月底汇总时如果看到有行 `end` 为空,说明那次实例不是被脚本正常销毁的,可能是 spot 被抢占、可能是我从网页上手动删的。这种行要单独查,是看板顺手带出来的一个异常检测。

### 销毁:补齐后半行

Day 22 的销毁脚本在调云厂商 API 之前,先把这一行补完。结论 `note` 从一个文件读,我在实验结束时用一行 `echo` 写进去;没写就留空,月底一眼看得见哪次没留结论:

```bash
# shutdown.sh 里(也就是 Day 22 run.sh 的 on_exit),调 destroy_self 之前执行
REPO_DIR="${REPO_DIR:-/workspace/aiinfra-lab}"
LEDGER="$REPO_DIR/cost/gpu-ledger.csv"
START=$(cat /tmp/ledger_start)
PRICE=$(cat /tmp/ledger_price)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NOTE=$(cat /tmp/ledger_note 2>/dev/null | tr ',' ';' | tr -d '\n')   # 逗号换成分号,别破坏 CSV

HOURS=$(python3 - "$START" "$END" <<'EOF'
import sys, datetime as dt
s, e = (dt.datetime.fromisoformat(x.replace("Z", "+00:00")) for x in sys.argv[1:3])
print(f"{(e - s).total_seconds() / 3600:.4f}")
EOF
)
COST=$(python3 -c "print(f'{float('$HOURS') * float('$PRICE'):.2f}')")

# 用 python 改最后一行(最后一行就是本次开机写的那一行),然后 git push 出去
python3 - "$LEDGER" "$END" "$COST" "$NOTE" <<'EOF'
import sys, csv
path, end, cost, note = sys.argv[1:5]
rows = list(csv.reader(open(path, newline="")))
rows[-1][6:9] = [end, cost, note]
csv.writer(open(path, "w", newline="")).writerows(rows)
EOF

cd "$REPO_DIR" && git add cost/gpu-ledger.csv && git commit -qm "ledger: $(cat /tmp/ledger_experiment) $COST USD" && git push -q
```

最后一步 `git push` 很重要。实例销毁之后容器盘就没了,记录留在实例上等于没记。这也是 Day 20 那条规则的又一次应用:所有要留下的东西,在销毁前必须离开实例。

实验做完、准备销毁前,我只需要做一件事:

```bash
echo "转折点在 batch 48,早于 ridge 203,显存先满" > /tmp/ledger_note
```

一行结论,然后跑销毁脚本。结论想不出来就是这次实验没产出,也照实留空。

### 被抢占了怎么办

spot 实例被抢占时,销毁脚本不会跑,那一行的 `end` 永远是空的。这种情况月底汇总时会被单独列出来,我按云厂商账单页上那台机器的实际计费时长手动补 `end` 和 `cost_usd`,`note` 写 `preempted`。Day 22 的第二层(空闲检测)也管不到被抢占,所以这个补账动作是必要的。

## 月度汇总:一段 Python

放在仓库里,叫 `summarize.py`,只用标准库,在本机终端跑,不占 GPU 机时:

```python
#!/usr/bin/env python3
"""汇总 gpu-ledger.csv。用法:python3 summarize.py [YYYY-MM],默认当月。"""
import csv, sys, datetime as dt
from collections import defaultdict

month = sys.argv[1] if len(sys.argv) > 1 else dt.date.today().strftime("%Y-%m")
rows = [r for r in csv.DictReader(open("gpu-ledger.csv", newline="")) if r["date"].startswith(month)]

total = 0.0
by_exp, by_gpu = defaultdict(float), defaultdict(float)
hours_by_gpu = defaultdict(float)
open_rows, no_note = [], []

for r in rows:
    if not r["end"]:
        open_rows.append(r); continue
    cost = float(r["cost_usd"] or 0)
    total += cost
    by_exp[r["experiment"]] += cost
    by_gpu[r["gpu"]] += cost
    s = dt.datetime.fromisoformat(r["start"].replace("Z", "+00:00"))
    e = dt.datetime.fromisoformat(r["end"].replace("Z", "+00:00"))
    hours_by_gpu[r["gpu"]] += (e - s).total_seconds() / 3600
    if not r["note"].strip():
        no_note.append(r["experiment"])

BUDGET = 60.0
print(f"== {month} ==  总花费 ${total:.2f} / 预算 ${BUDGET:.0f}  ({total / BUDGET:.0%})\n")

print("按实验:")
for k, v in sorted(by_exp.items(), key=lambda kv: -kv[1]):
    print(f"  {k:<28} ${v:>6.2f}  {v / total:>4.0%}" if total else f"  {k:<28} ${v:>6.2f}")

print("\n按卡型:")
for k, v in sorted(by_gpu.items(), key=lambda kv: -kv[1]):
    print(f"  {k:<20} ${v:>6.2f}   {hours_by_gpu[k]:>5.1f} h   ${v / hours_by_gpu[k]:.2f}/h 实际均价")

if open_rows:
    print(f"\n⚠ {len(open_rows)} 行没有 end(被抢占或手动删的?去账单页补):")
    for r in open_rows:
        print(f"  {r['date']}  {r['experiment']}  start={r['start']}")
if no_note:
    print(f"\n⚠ {len(no_note)} 次实验没写结论:{', '.join(no_note)}")
```

输出是三张小表加两条警告。第一张回答「花了多少」,第二张回答「花在哪个实验」,第三张顺手给出每种卡的实际均价(含开机等待、下载模型这些不产出的时间),两条警告分别抓漏账和白花。

「按卡型」那一栏里的「实际均价」会比标称小时价高一点,因为同一次开机里包括了 bootstrap 那 5 分钟和下载模型的时间。如果实际均价比标称高出 30% 以上,说明每次开机的固定成本太重,该回去把 Day 21 的 bootstrap 再压一压,或者把小实验合并到一次开机里做。

## 示例看板

下面这张表**全部是示例数据**,是我按 W3 那一周会做的实验编出来的,用来演示看板长什么样、汇总脚本会算出什么。真实数据要等真的租了卡才有。

| date | experiment | gpu | price/h | hours | cost | note |
| --- | --- | --- | --- | --- | --- | --- |
| 09-15 | w3-d1-bandwidth | RTX-4090 | 0.34 | 0.6 | 0.20 | 示例:copy 测得约标称 8 成 |
| 09-16 | w3-d2-peak-flops | RTX-4090 | 0.34 | 0.8 | 0.27 | 示例:fp16 4096 方阵打到 7 成 |
| 09-17 | w3-d3-roofline | RTX-4090 | 0.34 | 0.5 | 0.17 | 示例:实测 ridge 比标称低 |
| 09-18 | w3-d4-batch-sweep | A100-SXM4-80GB | 1.39 | 1.7 | 2.36 | 示例:曲线在 batch 48 左右压平 |
| 09-18 | w3-d4-batch-sweep-rerun | A100-SXM4-80GB | 1.39 | 0.9 | 1.25 | 示例:上次 pad 没对齐,重跑 |
| 09-19 | w3-d5-compare | RTX-4090 | 0.34 | 0.4 | 0.14 | 示例:对比表写完 |
| 合计 | | | | 4.9 h | **4.39** | |

按这个节奏,W3 一周不到 5 美元。真正贵的是 A100 那两次:1.39 美元一小时,一次重跑就是 1.25 美元。看板把「重跑」这件事显性化了:两行同名实验挨着,第二行的 note 写着为什么重跑。下个月看到自己重跑了三次,就知道该把脚本在便宜卡上调好再上 A100。

小时价出处:RunPod 定价页 2026 年 9 月 5 日 Community Cloud 档,A100 SXM 1.39、A100 PCIe 1.19、RTX 4090 0.34、L4 0.44、RTX 3090 0.22、H100 SXM 2.69 美元每小时。Secure Cloud 档和 Vast 的竞价市场会不一样,以开机那一刻页面上的数字为准填进 `price_per_hour`。

## 两个换算:每个实验多少钱,每百万 token 多少钱

看板给的是「每次开机花了多少」。再往前推一步,把它换成两个更有判断力的数。

### 每个实验多少钱

这个不用算,就是那一行的 `cost_usd`。但要养成一个习惯:开机前先估。估法是「我这次要跑多久」乘以小时价。W3 的 batch 扫描,五个 batch 值,每个跑 20 步 decode 加 warmup,加上装模型,估 1 小时,A100 就是 1.39 美元。如果实际花了 2.36,超了 70%,回头看是哪一步比估的慢,这个「估 vs 实」的差距本身就是一种校准,和 Day 9 拿实测 TPOT 除理论下限是同一个动作。

### 每百万 token 多少钱

这是推理服务行业真正用的单位,也是产出物 01 那张卡片上要填的数(`$/1M tok ↓__`)。换算只有一步:

```
$/1M token = 小时价 ÷ (每秒 token 数 × 3600 ÷ 1,000,000)
           = 小时价 × 1e6 ÷ (tok/s × 3600)
```

用 W1 算过的数试一遍。A100 SXM 上 Llama-2-7B fp16,Day 5 算出 batch 1 的 decode 上限约 150 tok/s。小时价 1.39 美元:

```
150 tok/s × 3600 s = 540,000 tok/h
1.39 ÷ 0.54 ≈ $2.57 / 1M token
```

batch 1 时一百万 token 要 2.57 美元。现在把 Day 5 那个结论接上来:batch 加到 32,搬权重的 6.6 ms 不变,32 个 token 一起出,吞吐接近 32 倍:

```
150 × 32 = 4,800 tok/s → 17.28M tok/h
1.39 ÷ 17.28 ≈ $0.080 / 1M token
```

同一张卡、同一个模型,单价从 2.57 降到 0.08,差 32 倍,原因就是 roofline 上那个点从算术强度 1 往 153 挪了一段。这是「continuous batching 是吞吐的命门」这句话第一次变成美元。

再往上,batch 128 理论上是 19,200 tok/s,单价 0.020 美元;但 Day 5 也算过 batch 32 × 2048 序列的 KV cache 就要 32 GB,batch 128 同样序列长要 128 GB,80 GB 的卡装不下。所以这个 0.020 是纸面数,实际会被显存先卡住,Day 16 的 batch 扫描就是去看它在哪被卡住的。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="A100 上 7B 模型每百万 token 成本随 batch 下降:batch 1 约 2.57 美元,batch 32 约 0.08 美元,batch 128 纸面 0.02 美元但显存装不下">
  <line x1="70" y1="210" x2="610" y2="210" stroke="var(--rule)"/>
  <line x1="70" y1="30" x2="70" y2="210" stroke="var(--rule)"/>
  <text x="340" y="245" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">decode batch(A100 SXM $1.39/h,Llama-2-7B fp16,按 Day 5 上限算)</text>
  <text x="18" y="24" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">$/1M tok(对数)</text>
  <rect x="120" y="50" width="90" height="160" fill="var(--mem)"/>
  <text x="165" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">$2.57</text>
  <text x="165" y="228" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">batch 1</text>
  <rect x="290" y="150" width="90" height="60" fill="var(--mem)"/>
  <text x="335" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">$0.080</text>
  <text x="335" y="228" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">batch 32</text>
  <rect x="460" y="170" width="90" height="40" fill="var(--mem-wash)" stroke="var(--mem)" stroke-dasharray="4 3"/>
  <text x="505" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">$0.020</text>
  <text x="505" y="228" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">batch 128</text>
  <text x="505" y="118" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">纸面数:2048 序列时</text>
  <text x="505" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">KV cache 128 GB 装不下</text>
  <line x1="210" y1="50" x2="290" y2="150" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <text x="250" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">÷32</text>
</svg>
<figcaption>同一张卡同一个模型,单价随 batch 下降。这张图是 Day 5 那张 roofline 的美元版本;虚线柱表示纸面上算得出、显存上装不下。</figcaption>
</figure>

Colab 免费 T4 上的 TinyLlama 没有小时价,算不出美元。但如果以后在 RunPod 上租 RTX 4090(0.34 美元,带宽 1008 GB/s)跑 Llama-2-7B,可以用同样的方法先估:13.5 GB ÷ 1008 GB/s ≈ 13.4 ms,约 75 tok/s,batch 1 单价 0.34 ÷ 0.27 ≈ 1.26 美元每百万 token。比 A100 便宜一半,虽然快慢也慢一半:单价看的是「每美元买到多少 token」,不是「多快」。这个区别在 M3 做产出物 01 时会反复用到。

## 月预算 30 到 60 美元怎么分

预算是 Day 0 定的:月 30 到 60 美元。有了看板,可以反过来规划这笔钱怎么用,而不是花完了才知道。

一个粗略的原则:**便宜卡调试,贵卡出数**。脚本、数据加载、计时逻辑在 RTX 3090 或 4090 上调通,0.22 到 0.34 美元一小时,调两三小时也就一美元。确认无误再上 A100 跑正式的那一遍,1.39 美元一小时,一小时内跑完。反着做,在 A100 上边想边调,一小时 1.39 美元里一半是在等我 debug。

按这个原则,M1 剩下的周和 M2 大致的分法(**示例规划,不是实际支出**):

| 用途 | 卡 | 预估时长 | 预估花费 |
| --- | --- | --- | --- |
| W4 环境工程化本身(试开机、试销毁、试抢占) | RTX 3090 | 3 h | ~$0.70 |
| W3 补做:在真 A100 上重跑带宽/算力/roofline | A100 SXM | 1.5 h | ~$2.10 |
| W5 KV cache 开关对比 | RTX 4090 调试 2 h + A100 1 h | 3 h | ~$2.10 |
| W6 batching 时序图(要 vLLM,装环境时间长) | A100 SXM | 3 h | ~$4.20 |
| W7 量化三角(GPTQ/AWQ 要装工具链) | RTX 4090 3 h + A100 2 h | 5 h | ~$3.80 |
| 意外重跑与浪费的余量 | | | ~$5 |
| 合计 | | | **~$18** |

也就是说照纪律做,M1 加 M2 两个月加起来不到 20 美元,远低于月预算下限。路线图把预算写成 30 到 60 是给 M3 之后留的:那时候要跑 vLLM 对比、要租两张卡测 TP、要做量化精度评测,单次开机时长会到几个小时。看板在那个阶段才真正开始紧张。

## 为什么这件事要做成脚本而不是靠账单页

云厂商都有账单页,为什么还要自己记?三个原因。

账单页只有卡型和时长,没有「实验名」和「结论」。它能告诉我 9 月 18 日 A100 用了 2.6 小时,不能告诉我那 2.6 小时里 0.9 小时是因为 pad 没对齐重跑的。而后者才是下个月能省钱的信息。

账单页是每家一份。RunPod 一份、Vast 一份,以后可能还有别家。看板是一份,跨厂商。

最重要的一条:账单页是事后的,看板是事前的。开机脚本要求我传实验名和小时价才能启动,这两个参数本身就是一个小小的闸门,逼我在按下开机前想一下「这次是干什么、值不值这个价」。Day 22 三层自动销毁管的是「忘了关」,这个参数管的是「不该开」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| ledger | 账本。这里指 `gpu-ledger.csv`,一行一次开机 |
| Community Cloud / Secure Cloud | RunPod 的两档机器。前者是第三方机房的卡,便宜;后者是 RunPod 自家数据中心,贵一些但更稳。本文小时价按 Community Cloud |
| spot / interruptible | 便宜但随时可能被收回的实例。Vast 叫 interruptible;RunPod 2026 年 9 月的价格页已经没有 Spot 档(Day 19 查证),只剩 On-demand / Savings plan / Community-Secure 两种机房。被收回时销毁脚本不会跑,账本那行 `end` 会是空的 |
| $/1M token | 每生成一百万个 token 花多少美元。推理服务的通用单价,= 小时价 × 1e6 ÷ (tok/s × 3600) |
| 实际均价 | 一段时间内某种卡的总花费 ÷ 总开机小时数。含开机等待、下载模型等不产出的时间,所以比标称小时价高 |
| 固定成本 | 每次开机不管做什么都要付的那段时间:bootstrap、下载权重。压低它靠 Day 21 的脚本和 Day 20 的持久化策略 |
| 幂等 | 同一个脚本跑两遍结果一样。记账脚本里 `[ -f "$LEDGER" ] || echo 表头` 那行就是为了幂等 |
| UTC | 世界协调时。账本里时间戳全用 UTC 带 Z 后缀,免得跨时区换算出错 |

## 常见误区

**以为账单页就是看板。** 账单页有卡型和时长,没有实验名和结论,回答不了「花在哪个实验上」,更回答不了「值不值」。看板是自己的判断,账单是厂商的事实,月底拿两者对一次账,平时靠看板。

**手动记账。** 三天以后一定断。记账必须塞进本来就每次必跑的脚本里,开机写半行,销毁补半行。我需要手动做的只剩一句结论。

**小时价填成 Secure Cloud 或 on-demand 的价格,实际开的是 spot。** 或者反过来。填价的时候看清页面上当前那台机器的价格,不同档、不同机房的同一张卡价格能差 40%。

**把 $/1M token 当成「多快」。** 它是「每美元买到多少 token」。RTX 4090 跑 7B 比 A100 慢一半但单价便宜一半,两张卡在 $/1M token 上差不多,在延迟上差两倍。产出物 01 里这两个数都要给,不能只给一个。

**记录留在实例上。** 销毁之后容器盘就没了。账本必须在销毁脚本里先 `git push` 再调销毁 API,顺序反了就丢。

**结论栏空着不管。** 空着的行代表一次没有产出的开机。月底汇总脚本会把它们列出来,列出来的意义是逼自己面对「这几次为什么白花」,而不是把它们藏在总数里。

## 参考资料

### 文档

- RunPod 定价页,本文小时价的出处,2026 年 9 月 5 日 Community Cloud 档。https://www.runpod.io/pricing
- RunPod 文档 Pod pricing,讲清 container disk、volume disk、network volume 三种存储在运行和停机时各怎么计费(网络卷每 GB 每月 0.07 美元,volume disk 停机反而涨到 0.20),Day 20 那道「值不值」的题的算据。https://docs.runpod.io/pods/pricing
- RunPod 文档 Billing information,按分钟计费、余额扣到零怎么处理,Day 22 第三层的依据。https://docs.runpod.io/references/billing-information
- Vast.ai 定价页,竞价市场,同一张卡价格随机器不同。https://vast.ai/pricing
- Vast.ai 文档 Billing,讲 interruptible 实例和存储的计费规则。https://vast.ai/docs/billing
- runpodctl 文档,销毁脚本里调的命令行工具。https://docs.runpod.io/runpodctl/overview
- Vast.ai CLI 文档,Vast 侧的对应工具。https://docs.vast.ai/cli

### 视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/cIQN38OYr-o" title="Runpod Tutorial - 2026 | How to Run AI Models in the Cloud (Step-by-Step)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dan - Smart Tutorials《Runpod Tutorial - 2026 | How to Run AI Models in the Cloud (Step-by-Step)》。从注册到开 Pod 到删掉的完整流程,重点看它在哪一步选价格、在哪里看余额,对照本文 <code>price_per_hour</code> 该从哪抄。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9tvJ_GYJA-o" title="Mastering LLM Inference Optimization From Theory to Cost Effective Deployment: Mark Moyou" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer 频道,Mark Moyou《Mastering LLM Inference Optimization From Theory to Cost Effective Deployment》。讲的是推理部署怎么算成本,和本文「$/1M token 随 batch 下降」那一节是同一件事的行业版本;能听懂它讲 batching 和成本的那一段,说明 Day 5 加今天的换算是通的。</figcaption>
</figure>

## 自测

合上笔记做。

1. 成本看板必须能回答哪三个问题?账单页为什么回答不了其中两个?

<details><summary>答案</summary>

这个月花了多少、花在哪个实验上、每个实验值不值。账单页只有卡型和时长,没有实验名和结论,所以回答不了后两个。前一个它能答,月底拿来和看板对账。

</details>

2. 账本那一行由谁在什么时候写?哪几列是我手动填的?

<details><summary>答案</summary>

开机时 bootstrap 脚本写前半行(date、experiment、provider、gpu、price、start),销毁时销毁脚本补后半行(end、cost、note)并 git push。手动填的只有开机时传入的实验名和小时价,以及销毁前 echo 到文件里的一句结论。

</details>

3. A100 SXM 小时价 1.39 美元,Llama-2-7B fp16 在 batch 1 时 decode 上限约 150 tok/s。每百万 token 多少钱?batch 32 呢?为什么差这么多?

<details><summary>答案</summary>

batch 1:150 × 3600 = 540,000 tok/h,1.39 ÷ 0.54 ≈ 2.57 美元。batch 32:吞吐接近 32 倍,4,800 tok/s,17.28M tok/h,1.39 ÷ 17.28 ≈ 0.08 美元。差 32 倍是因为搬权重的 6.6 ms 是固定成本,batch 32 时同一遍搬运服务了 32 个 token,算术强度从 1 往 153 挪了一段,GPU 闲置的算力被用上了。

</details>

4. 汇总脚本发现有一行 `end` 为空,可能是什么原因?怎么处理?

<details><summary>答案</summary>

销毁脚本没跑:spot 被抢占,或者我从网页手动删了实例。处理是去云厂商账单页查那台机器的实际计费时长,手动补 end 和 cost,note 写 preempted 或 manual。

</details>

5. 「便宜卡调试,贵卡出数」是什么意思?反着做的代价是什么?

<details><summary>答案</summary>

脚本、数据加载、计时逻辑在 RTX 3090/4090(0.22 到 0.34 美元每小时)上调通,确认无误再上 A100(1.39 美元)跑一遍正式的。反着做,A100 一小时里一半时间是在等我 debug,每小时多花一美元买不到任何数字。

</details>

6. 账本记录为什么要在销毁 API 调用之前 git push?

<details><summary>答案</summary>

实例销毁后容器盘就没了,留在实例上的文件等于没记。这是 Day 20 那条规则的应用:所有要留下的东西,在销毁前必须离开实例。

</details>

## 明天预告

Day 24 是 W4 的收口:把这一周的东西压成一张「一条命令起环境」的完整清单,从开机参数、bootstrap、持久化、三层销毁到账本,每一项打勾才算环境工程化做完。然后做路线图 W4 的五道验收题:spot 被抢占时会丢什么、network volume 关机后还计不计费、从零到能跑代码实际几分钟、三层销毁分别在什么情况下生效、这周花了多少钱花在哪。最后整理错题本:volume 计费、忘关机、脚本不幂等、token 泄漏进 git。W4 结束后 M1 还有一周加餐,补硬件和数值格式的地基。
