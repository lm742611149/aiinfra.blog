---
title: 'Day 22 · 三层自动销毁：脚本末尾关机、空闲检测、余额上限'
description: '忘记关机是这条路上预算失控的唯一原因，而它不会因为「这次一定记得」而消失。给三种不同的失败方式各配一道保险：任务结束脚本自己销毁实例，GPU 空闲太久看门程序销毁实例，前两层都失效时账户余额兜底。每一层写出来、跑一遍，验收是故意跑完一个任务，然后看实例自己消失。'
pubDate: 2026-09-05
regime: none
tags: ['runpod', 'vast', 'cost', 'automation', 'bash', 'nvidia-smi', 'aiinfra-365']
series: 'aiinfra-365'
day: 22
lang: 'zh'
---

## 今天要解决的问题

Day 0 写成本纪律时有一句:「跑完立刻销毁实例。忘记关机一晚上的钱够买一周的实验。」到今天为止这句话靠的是我的记性。今天把它变成机制。

先承认一个事实:忘记关机这件事,不会因为「这次一定记得」而消失。它会在某个跑完实验直接去睡觉的晚上发生,或者在 ssh 断线后我以为任务死了其实实例还活着的下午发生,或者在我调 profiler 调到一半被叫走开会的时候发生。每一种都是正常人正常工作的正常状态,不是粗心。**靠记性的方案,失败是确定的,只是时间未定。**

所以今天不是写一个「自动关机」脚本,是给三种不同的失败方式各配一道保险:

| 层 | 防的是哪种失败 | 机制 | 响应时间 |
| --- | --- | --- | --- |
| 第一层 | 任务正常跑完,我不在场 | run.sh 的退出路径上调云厂商 API 销毁自己 | 任务结束后几秒 |
| 第二层 | 我中途走开,任务早结束了或根本没起来,实例空转 | 看门程序每分钟读 GPU 利用率,连续空闲 N 分钟就销毁 | N 分钟,我定 20 |
| 第三层 | 前两层都失效:脚本崩在销毁之前、看门程序被杀、API key 过期 | 账户只预充值不绑自动续费,余额到零厂商自动停机;低余额邮件告警 | 最坏情况损失 = 余额 |

今天结束要交出的东西:

1. 三层各自的脚本或配置,在 RunPod 和 Vast 上都能落地。
2. **验收一:故意跑完一个五分钟的任务,人不碰键盘,看实例自己消失。**
3. **验收二:开一个实例什么都不跑,等 20 分钟,看它被看门程序销毁,并且我的手机收到一条通知。**
4. 一张表,写清每一层在什么情况下会失效,哪一层最可能失效。

## 先算忘关机值多少钱

不算这一步,后面三层的复杂度看起来就不值得。按 Day 19 查到的价格量级(2026 年 9 月,RunPod Community Cloud 价和 Vast 的 interruptible 价,会浮动):

| 场景 | 卡 | 小时价量级 | 空转时长 | 白烧的钱 | 占月预算(30–60 美元) |
| --- | --- | --- | --- | --- | --- |
| 跑完去睡觉,早上才发现 | A100 80GB | 1.5 到 2.5 美元 | 10 小时 | 15 到 25 美元 | 一半 |
| 周五下午忘了,周一想起 | A100 80GB | 1.5 到 2.5 美元 | 65 小时 | 约 100 到 160 美元 | 三个月预算 |
| 同上,便宜卡 | RTX 4090 | 0.4 到 0.7 美元 | 65 小时 | 26 到 45 美元 | 一个月预算 |
| 开机装环境时被叫走,两小时后回来 | A100 80GB | 1.5 到 2.5 美元 | 2 小时 | 3 到 5 美元 | 10% |

第二行是真正的灾难:一次周末忘关等于三个月的实验预算归零,而且这种事一年之内发生一次的概率我不敢说低。第四行是最常见的,看着小,一个月发生四次就是 20 美元。

还有一笔容易漏的:实例销毁了,network volume 还在计费。RunPod 的文档写得很清楚,network volume 1 TB 以下每 GB 每月 0.07 美元,50 GB 一个月 3.5 美元,不用的时候不删就一直扣。这个数不大,但它是「以为关了其实没关完」的典型,Day 20 决定按需重下而不挂 volume,一半原因就是它。

三层保险加起来大约两百行 bash 和半小时配置,换的是把「灾难级」那一行的概率压到接近零。值。

## 第一层:任务结束,实例自己销毁

第一层挂在 Day 21 定下的 `run.sh` 上。原理很简单:脚本结束时,不管是正常结束还是出错退出,最后一件事是调云厂商的 API 把自己所在的实例销毁。

### 先分清 stop 和 destroy

两家都有两个动作,意思不同,选错要么数据丢要么钱照扣:

| 动作 | RunPod 叫 | Vast 叫 | 计算费 | 磁盘费 | 数据 |
| --- | --- | --- | --- | --- | --- |
| 停机保留 | Stop | Stop | 停 | **继续扣**(RunPod volume 盘停机状态每 GB 每月 0.20 美元,比运行时的 0.10 还贵) | 保留在 volume 盘,容器盘清空 |
| 彻底销毁 | Terminate | Destroy | 停 | 停 | 全没,不可恢复 |

按 Day 20 的决定,代码在 git、结果推出去、模型重下,实例上没有任何我舍不得的东西,所以**第一层用彻底销毁**。Stop 只在一种情况下用:今天没跑完,明天一早接着用同一个实例,省一次 bootstrap 的两分钟。这种情况不多,而且要记得 stop 状态的磁盘费,超过一天就不划算了。

### 实例怎么知道自己是谁

销毁自己之前要知道自己的 ID。RunPod 在容器里注入了环境变量 `RUNPOD_POD_ID`,文档里明确列着,直接用。Vast 的容器里也有标识实例的环境变量,但我在文档里没找到明确的页面,上机后 `env | sort` 看一眼,常见的名字是 `CONTAINER_ID`,以实际看到的为准。拿不到的话有个笨办法:开实例时用 `--label` 打标签,销毁时用 `vastai show instances --raw` 按标签查 ID。

### 销毁命令

RunPod 有两条路。一是 `runpodctl`,新版 CLI 把 pod 相关操作收在 `runpodctl pod` 子命令组下,具体动词以 `runpodctl pod --help` 为准。二是直接调 GraphQL API,文档里的 `podStop` 和 `podResume` 写法是这样的:

```bash
curl -s --request POST \
  --header 'content-type: application/json' \
  --url "https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}" \
  --data '{"query": "mutation { podStop(input: {podId: \"'"$RUNPOD_POD_ID"'\"}) { id desiredStatus } }"}'
```

销毁用的 mutation 是 `podTerminate`,参数形状同上,写进脚本前在文档页核对一遍字段名。API key 在控制台生成,以 secret 形式注入成环境变量,和 Day 21 的 HF token 走同一条规矩。

Vast 一条命令:

```bash
vastai destroy instance "$INSTANCE_ID"     # 文档原话:irreversible, deletes data
```

`vastai` 的 API key 同样从环境变量或 `~/.vast_api_key` 读,不进仓库。

### 挂到退出路径上:trap

bash 的 `trap` 可以在脚本退出时执行一段命令,不管是正常走到末尾、`set -e` 触发的错误退出,还是收到信号。这正是「不管怎么结束都要销毁」需要的钩子。把 Day 21 的 `run.sh` 补成完整版:

```bash
#!/usr/bin/env bash
# run.sh —— 跑一个实验,把结果推出去,然后销毁自己所在的实例。
set -euo pipefail
REPO_DIR="${REPO_DIR:-/workspace/aiinfra-lab}"
RESULTS="$REPO_DIR/results/$(date -u +%Y%m%d-%H%M%S)-${EXP_NAME:-exp}"
KEEP_ALIVE="${KEEP_ALIVE:-0}"                  # 调试时 KEEP_ALIVE=1 跳过销毁
NOTIFY_URL="${NOTIFY_URL:-}"                   # 可选:推送通知的 webhook

notify() {                                     # 推一条消息到手机;没配 URL 就只打日志
  echo "[notify] $*"
  [ -n "$NOTIFY_URL" ] && curl -s -m 10 -X POST "$NOTIFY_URL" -H 'content-type: application/json' \
      -d "{\"text\": \"$(hostname): $*\"}" >/dev/null || true
}

destroy_self() {
  if [ -n "${RUNPOD_POD_ID:-}" ] && [ -n "${RUNPOD_API_KEY:-}" ]; then
    curl -s -m 20 --request POST --header 'content-type: application/json' \
      --url "https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}" \
      --data '{"query": "mutation { podTerminate(input: {podId: \"'"$RUNPOD_POD_ID"'\"}) }"}' >/dev/null \
      || echo "!! podTerminate 调用失败,靠第二、三层兜底"
  elif [ -n "${CONTAINER_ID:-}" ] && command -v vastai >/dev/null; then
    vastai destroy instance "$CONTAINER_ID" || echo "!! vastai destroy 失败,靠第二、三层兜底"
  else
    echo "!! 认不出自己是哪家的实例,不销毁。手动检查!"
  fi
}

on_exit() {
  local rc=$?
  # 1) 先把已有的结果推出去,哪怕任务是失败的
  if [ -d "$RESULTS" ]; then
    git -C "$REPO_DIR" add results 2>/dev/null || true
    git -C "$REPO_DIR" commit -qm "results: ${EXP_NAME:-exp} rc=$rc $(date -u +%FT%TZ)" 2>/dev/null || true
    if ! git -C "$REPO_DIR" push -q 2>/dev/null; then
      # push 失败说明结果只在实例上。这时销毁 = 丢数据,宁可多付几小时机时。
      echo "!! push 失败,结果只在实例上,本次不销毁,等人来处理"
      KEEP_ALIVE=1
    fi
  fi
  # 2) 通知(push 失败会在这里报出来;注意第二层空闲检测不看这个标志,所以收到通知后要尽快人工处理)
  notify "run ${EXP_NAME:-exp} exited rc=$rc, destroying=$([ "$KEEP_ALIVE" = 1 ] && echo no || echo yes)"
  # 3) 最后才销毁自己。前提:结果已经不在这台机器上独有
  [ "$KEEP_ALIVE" = 1 ] || destroy_self
}
trap on_exit EXIT

mkdir -p "$RESULTS"
cd "$REPO_DIR"
echo "== run ${EXP_NAME:-exp} -> $RESULTS"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | tee "$RESULTS/gpu.txt"
python -c 'import torch, transformers; print(torch.__version__, transformers.__version__)' | tee "$RESULTS/versions.txt"

python "$@" 2>&1 | tee "$RESULTS/stdout.log"
echo "== run done"
```

几个必须说清楚的点:

**顺序:先推结果,再通知,最后销毁。** 反过来的话销毁一执行,容器就没了,后面的 push 永远不会发生。这是整个脚本里最容易犯、后果最重的错误:实验跑了一小时,结果随实例一起消失。

**`trap on_exit EXIT` 抓的是所有退出。** 正常走完、`set -e` 中断、`exit 1`,都会触发。`$?` 在 trap 函数第一行取,取晚了就被后面的命令覆盖。`rc` 写进提交信息,以后看 results 目录就知道那次是成功还是失败。

**`KEEP_ALIVE=1` 是逃生口。** 调脚本的时候不想每跑一次实例就没了,`KEEP_ALIVE=1 bash run.sh ...` 跳过销毁。但默认值必须是 0,也就是默认销毁,忘了设的时候是安全的一边。

**销毁失败不能让脚本挂住。** `destroy_self` 里每条 API 调用都跟着 `|| echo`,失败就打一行日志继续,`-m 20` 限制 curl 最多等 20 秒。API 挂了、key 过期了,第一层就是失效了,那是第二、三层的事,不该让脚本卡在这里等。

**trap 里不要做耗时的事。** push 几 KB 的结果几秒钟,可以。如果结果有几百 MB 的 trace,push 要几分钟,应该在主流程里做而不是塞进 trap,trap 只负责「兜底再推一次」。

### 信号:ssh 断线时会发生什么

Day 21 说过,ssh 会话里直接跑长任务,断线时 shell 收到 SIGHUP 会把任务杀掉。有了 trap 之后情况变了:SIGHUP 让 `python` 被杀、`set -e` 触发退出、`on_exit` 跑起来、实例被销毁。这是好事还是坏事?

对无人值守(路径 C 由启动命令自动跑)没有影响,那个进程不在 ssh 会话里。对手动跑的情况,**这正是我要的行为**:任务已经死了,实例没有理由活着。半跑的结果 trap 会尽力推出去。如果不想要这个行为,就按 Day 21 的规矩进 tmux,tmux 下的进程不收 SIGHUP。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="三层自动销毁在一次实例生命周期上的时序图">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一次实例生命周期上的三层保险</text>
  <!-- timeline -->
  <line x1="60" y1="70" x2="600" y2="70" stroke="var(--ink)" stroke-width="1.5"/>
  <polygon points="600,70 592,66 592,74" fill="var(--ink)"/>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="60" y="58">开机</text>
    <text x="140" y="58">bootstrap</text>
    <text x="235" y="58">run.sh 任务</text>
    <text x="392" y="58">结束</text>
    <text x="560" y="58">时间 →</text>
  </g>
  <rect x="60" y="76" width="70" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <rect x="130" y="76" width="260" height="12" fill="var(--mem)"/>
  <text x="260" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="9" fill="var(--paper-raised)">GPU 忙</text>
  <rect x="390" y="76" width="210" height="12" fill="var(--compute-wash)" stroke="var(--compute)" stroke-dasharray="3 2"/>
  <text x="495" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="9" fill="var(--compute)">若无保险:空转,钱照扣</text>
  <!-- layer 1 -->
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="125" fill="var(--ink)">第一层</text>
    <line x1="392" y1="92" x2="392" y2="130" stroke="var(--mem)" stroke-width="1.5"/>
    <circle cx="392" cy="130" r="4" fill="var(--mem)"/>
    <text x="402" y="126" fill="var(--ink-soft)">trap EXIT:推结果 → 通知 → podTerminate</text>
    <text x="402" y="140" fill="var(--ink-faint)" font-size="10">响应:任务结束后几秒</text>
  </g>
  <!-- layer 2 -->
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="185" fill="var(--ink)">第二层</text>
    <line x1="60" y1="190" x2="600" y2="190" stroke="var(--rule)" stroke-dasharray="2 4"/>
    <g fill="var(--ink-soft)">
      <circle cx="80" cy="190" r="2.5"/><circle cx="120" cy="190" r="2.5"/><circle cx="160" cy="190" r="2.5"/><circle cx="200" cy="190" r="2.5"/><circle cx="240" cy="190" r="2.5"/><circle cx="280" cy="190" r="2.5"/><circle cx="320" cy="190" r="2.5"/><circle cx="360" cy="190" r="2.5"/>
    </g>
    <g fill="var(--compute)">
      <circle cx="400" cy="190" r="2.5"/><circle cx="440" cy="190" r="2.5"/><circle cx="480" cy="190" r="2.5"/><circle cx="520" cy="190" r="2.5"/>
    </g>
    <circle cx="560" cy="190" r="5" fill="var(--compute)"/>
    <text x="70" y="208" fill="var(--ink-faint)" font-size="10">看门程序每分钟读 nvidia-smi 利用率</text>
    <text x="400" y="176" fill="var(--compute)" font-size="10">连续 N=20 分钟低于 5% 且无 python 进程</text>
    <text x="470" y="208" fill="var(--compute)" font-size="10">→ 通知 + 销毁</text>
  </g>
  <!-- layer 3 -->
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="255" fill="var(--ink)">第三层</text>
    <line x1="60" y1="262" x2="600" y2="262" stroke="var(--rule)"/>
    <line x1="60" y1="262" x2="60" y2="300" stroke="var(--rule)"/>
    <line x1="60" y1="300" x2="600" y2="300" stroke="var(--ink-faint)" stroke-width="1.5"/>
    <path d="M60 262 L600 296" stroke="var(--ink-soft)" stroke-width="1.5" fill="none"/>
    <text x="64" y="275" fill="var(--ink-soft)" font-size="10">余额 $15,每 5 分钟结算一次往下走</text>
    <text x="420" y="292" fill="var(--ink-soft)" font-size="10">到 $0 厂商自动停机</text>
    <text x="64" y="316" fill="var(--ink-faint)" font-size="10">低余额邮件告警阈值($5)在到零之前几小时先响。最坏损失 = 余额,不会再多。</text>
  </g>
</svg>
<figcaption>三层在同一条时间线上的位置。第一层在任务结束那一刻触发,第二层在 GPU 连续空闲 20 分钟后触发,第三层是余额这条斜线碰到零。它们防的不是同一件事,所以缺任何一层都会留下一个缺口。</figcaption>
</figure>

## 第二层:看门程序,空闲 20 分钟就销毁

第一层有个前提:任务是通过 run.sh 起的,而且跑到了退出路径。这个前提在很多真实情况下不成立:

- 我 ssh 进去手动调东西,调到一半被叫走,根本没有 run.sh 在跑。
- bootstrap 装环境时报错停了,实例起来了但什么都没跑,我没注意。
- run.sh 起了,python 进程 OOM 被内核杀掉,trap 正常触发销毁,这个没问题。但如果 run.sh 本身在 `trap` 那行之前就崩了,比如 `mkdir` 失败,trap 还没注册,实例就留下了。
- 我在 Jupyter 里交互式实验,GPU 大部分时间闲着,不知不觉过了两小时。

这些情况的共同点是:**实例活着,GPU 没在干活。** 第二层就盯这一个信号。

### 信号怎么取

`nvidia-smi` 可以查询式输出,不要那张大表:

```bash
nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits
# 输出一个整数,比如 0 或 97,单位是百分比
```

这个利用率的含义 Day 5 讲过,它是「过去一小段采样窗口里有没有 kernel 在跑」,不是算力用了多少。对第二层来说这正合适:我不关心 kernel 效率,只关心「有没有人在用这张卡」。decode 阶段 memory-bound 到只用 1% 算力的时候,这个数照样是 90 以上,不会误判成空闲。

只看利用率有一个漏洞:模型下载和数据预处理阶段 GPU 是 0,但任务明明在跑。Day 21 算过,慢机房下 7B 模型要两分多钟,加上 pip 装包,bootstrap 阶段可能有五分钟 GPU 利用率为零。所以再加两个条件:

1. **有没有 python 进程活着。** `pgrep -x python` 或 `pgrep -f run.sh`。有就不算空闲,不管 GPU 忙不忙。
2. **有没有活跃的 ssh 会话。** `who | wc -l` 或 `ss -tn state established '( sport = :22 )' | tail -n +2 | wc -l`。有人连着就不算空闲,防止我正在敲命令的时候实例被从脚下抽走。

三个条件同时满足才算空闲:GPU 利用率低于 5%,没有 python 进程,没有 ssh 会话。连续 20 次(每分钟一次)都空闲,才销毁。

### 脚本

容器里通常没有 cron,也没有 systemd,所以看门程序就是一个后台 while 循环,由 bootstrap 最后一步用 `nohup` 起起来:

```bash
#!/usr/bin/env bash
# idle-watch.sh —— 每分钟检查一次,GPU 连续空闲 IDLE_LIMIT 分钟就销毁实例。
# 由 bootstrap.sh 最后一步启动:  nohup bash idle-watch.sh >/workspace/idle-watch.log 2>&1 &
set -uo pipefail                        # 注意:不开 -e,任何一次检查失败都不能让看门程序自己死掉
IDLE_LIMIT="${IDLE_LIMIT:-20}"          # 连续空闲多少分钟才动手
UTIL_THRESHOLD="${UTIL_THRESHOLD:-5}"   # 利用率低于这个百分比算空闲
NOTIFY_URL="${NOTIFY_URL:-}"
idle=0

notify() {
  echo "$(date -u +%FT%TZ) [notify] $*"
  [ -n "$NOTIFY_URL" ] && curl -s -m 10 -X POST "$NOTIFY_URL" -H 'content-type: application/json' \
      -d "{\"text\": \"$(hostname): $*\"}" >/dev/null || true
}

destroy_self() {   # 与 run.sh 里的同一份逻辑;实际项目里抽成 common.sh 两边 source
  if [ -n "${RUNPOD_POD_ID:-}" ] && [ -n "${RUNPOD_API_KEY:-}" ]; then
    curl -s -m 20 --request POST --header 'content-type: application/json' \
      --url "https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}" \
      --data '{"query": "mutation { podTerminate(input: {podId: \"'"$RUNPOD_POD_ID"'\"}) }"}' >/dev/null
  elif [ -n "${CONTAINER_ID:-}" ] && command -v vastai >/dev/null; then
    vastai destroy instance "$CONTAINER_ID"
  else
    echo "!! 认不出实例身份,无法销毁"; return 1
  fi
}

while true; do
  util=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d ' ')
  util=${util:-100}                                  # 读不到就当忙,宁可不杀
  py=$(pgrep -c -x python 2>/dev/null || echo 0)
  ssh_n=$(who 2>/dev/null | wc -l | tr -d ' ')

  if [ "$util" -lt "$UTIL_THRESHOLD" ] && [ "$py" -eq 0 ] && [ "$ssh_n" -eq 0 ]; then
    idle=$((idle + 1))
  else
    idle=0
  fi
  echo "$(date -u +%FT%TZ) util=$util% python=$py ssh=$ssh_n idle=$idle/$IDLE_LIMIT"

  if [ "$idle" -eq $((IDLE_LIMIT - 5)) ]; then
    notify "GPU 已空闲 $idle 分钟,5 分钟后销毁。要保留就 ssh 进来或 touch /workspace/.keep"
  fi
  if [ -f /workspace/.keep ]; then idle=0; fi     # 手动保命开关:touch 一个文件

  if [ "$idle" -ge "$IDLE_LIMIT" ]; then
    notify "GPU 连续空闲 $IDLE_LIMIT 分钟,销毁实例"
    destroy_self && exit 0
    echo "!! 销毁失败,10 分钟后重试"; sleep 600; idle=$((IDLE_LIMIT - 1))
  fi
  sleep 60
done
```

逐条说明几个设计选择:

**不开 `set -e`。** 这个脚本的任何一次检查失败(nvidia-smi 偶尔超时、pgrep 返回非零)都不能让它自己退出。看门程序死了等于第二层没了,而且是静默地没了。所以只开 `-u` 和 `pipefail`,每条命令都处理失败情况。

**读不到利用率就当 100。** `util=${util:-100}` 这一行是「宁可不杀」的原则:nvidia-smi 挂了的时候我不知道 GPU 在不在忙,这时候杀实例可能杀掉正在跑的任务。宁可多花 20 分钟的钱。

**提前 5 分钟通知一次。** `idle == IDLE_LIMIT - 5` 时推一条消息,给我 5 分钟反应时间。ssh 进去看一眼,或者 `touch /workspace/.keep`,计数归零。这个 `.keep` 文件是手动保命开关,用完记得删,不然第二层永久失效。更稳的做法是让 `.keep` 只保 60 分钟,`find /workspace/.keep -mmin +60 -delete` 加进循环里,留给以后。

**销毁失败要重试,而且要通知。** API 偶尔会失败。失败后等 10 分钟再试,期间 `idle` 保持在阈值边缘,下一轮循环直接再试。如果连续失败,通知会一直响,我总会看到。

**20 分钟这个数怎么定。** 太短,比如 5 分钟,会在「模型下载完、python 还没起」这种缝隙里误杀,虽然有 python 进程那个条件兜着,还是留点余量。太长,比如 60 分钟,一次忘关就是一小时的钱。20 分钟按 A100 算是 0.5 到 0.8 美元,是我愿意为「不误杀」付的保险费。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="看门程序 idle-watch 的状态机:忙、空闲计数、预警、销毁">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">idle-watch.sh 每分钟走一遍</text>
  <!-- check box -->
  <rect x="40" y="50" width="200" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="50" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">三个条件</text>
  <text x="50" y="86" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">util &lt; 5%</text>
  <text x="50" y="100" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">无 python 进程</text>
  <text x="50" y="114" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">无 ssh 会话</text>
  <!-- busy -->
  <rect x="40" y="170" width="200" height="44" rx="4" fill="none" stroke="var(--rule)"/>
  <text x="50" y="188" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">任一不满足 → 忙</text>
  <text x="50" y="204" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">idle = 0,60 秒后再查</text>
  <line x1="140" y1="120" x2="140" y2="170" stroke="var(--ink-soft)" stroke-width="1.5"/>
  <polygon points="140,170 136,162 144,162" fill="var(--ink-soft)"/>
  <!-- idle count -->
  <rect x="300" y="50" width="160" height="70" rx="4" fill="none" stroke="var(--ink)"/>
  <text x="310" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">全部满足 → 空闲</text>
  <text x="310" y="86" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">idle += 1</text>
  <text x="310" y="100" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">.keep 存在则归零</text>
  <line x1="240" y1="85" x2="300" y2="85" stroke="var(--ink)" stroke-width="1.5"/>
  <polygon points="300,85 292,81 292,89" fill="var(--ink)"/>
  <!-- warn -->
  <rect x="300" y="150" width="160" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="310" y="170" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">idle = 15</text>
  <text x="310" y="186" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">推通知:5 分钟后销毁</text>
  <line x1="380" y1="120" x2="380" y2="150" stroke="var(--compute)" stroke-width="1.5"/>
  <polygon points="380,150 376,142 384,142" fill="var(--compute)"/>
  <!-- destroy -->
  <rect x="300" y="230" width="160" height="50" rx="4" fill="var(--compute)" stroke="var(--compute)"/>
  <text x="310" y="250" font-family="var(--font-mono)" font-size="11" fill="var(--paper-raised)">idle = 20</text>
  <text x="310" y="266" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">通知 → destroy_self</text>
  <line x1="380" y1="200" x2="380" y2="230" stroke="var(--compute)" stroke-width="1.5"/>
  <polygon points="380,230 376,222 384,222" fill="var(--compute)"/>
  <!-- retry -->
  <path d="M460 255 C 520 255, 520 85, 460 85" fill="none" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="500" y="175" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">销毁失败:</text>
  <text x="500" y="189" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">等 10 分钟重试</text>
  <!-- guard note -->
  <text x="40" y="250" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">nvidia-smi 读不到 → util 当 100 → 忙</text>
  <text x="40" y="266" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">(宁可多花 20 分钟,不误杀正在跑的任务)</text>
</svg>
<figcaption>看门程序的状态机。三个条件同时满足才往「空闲」计数,任一不满足立刻归零。第 15 分钟先推通知给我 5 分钟反应,第 20 分钟销毁。读不到 GPU 状态时一律按「忙」处理。</figcaption>
</figure>

### 通知走哪条路

`notify()` 往一个 webhook URL 发一段 JSON,URL 从环境变量 `NOTIFY_URL` 来。用什么服务都行,只要它能把一个 HTTP POST 变成手机上的一条推送:Telegram bot、Bark、Server酱、企业微信机器人,或者自己在 Cloudflare Worker 上写一个转发。我之前给别的项目做过一个 CF Worker 把定时任务的结果推到微信,这里完全是同一个模式:一个只接受 POST 的端点,收到就转发到推送渠道。花半小时把那个 Worker 加一个路由,就能复用。

通知的价值不在「销毁时告诉我」,在「销毁前 5 分钟告诉我」。前者只是记录,后者能救下正在做的事。

### 怎么启动它

bootstrap.sh 的第 6 步 smoke test 之后加两行:

```bash
# ---------- 7. 起看门程序 ----------
nohup bash "$REPO_DIR/idle-watch.sh" >"$WORKDIR/idle-watch.log" 2>&1 &
step "7.idle-watch"
```

`nohup` 让它不受终端关闭影响,`&` 放后台。这一步在路径 C(启动命令自动执行)下尤其重要:实例一起来,看门程序就在,哪怕 bootstrap 后面的步骤失败了。所以更稳的写法其实是**把第 7 步挪到第 1 步之前**,先起看门再装环境,装环境失败也有人看着。Day 21 的时间预算表里它是零耗时,挪到最前面没有代价。

## 第三层:余额兜底

前两层都是我写的代码,我写的代码会有 bug。第三层不靠我的代码,靠厂商的计费系统。

### RunPod 的机制,按文档原话

RunPod 的计费文档里有几条对第三层直接有用,写这篇时逐条核对过:

- **预充值模式。** 账户是充进去的余额,按秒扣费,每 5 分钟结算一次。
- **余额到零自动停。** 余额到 0 时所有运行中的 pod 被自动停掉。挂了 network volume 的 pod 变成 stop 状态、数据保留在 volume 上;没挂的直接 terminate,数据不可恢复。
- **volume 在停机后继续扣费。** 余额一直是 0 的话,network volume 最终也会被删。
- **低余额通知。** 控制台 Billing 页有 Low balance alert,自定义阈值,低于阈值发邮件。
- **auto-pay 是可选的。** 余额低于阈值自动从银行卡充值。**这个功能就是第三层的敌人,绝对不开。**
- **默认每小时消费上限 80 美元。** 这个限制防的是误开一堆多卡实例,不是防忘关机;对我的预算规模它永远不会触发。
- **开 pod 要求余额至少够跑一小时。**

### 落地成三个动作

1. **只充 10 到 20 美元,不绑自动续费。** 这一条本身就是第三层的核心。最坏情况,前两层全失效,实例跑到余额归零自动停,我的损失上限就是余额。Day 19 说「只充 10 到 20 美元」的时候我以为是节俭,今天才明白它是一道保险:损失有上界,而且上界是我定的。
2. **低余额告警阈值设成 5 美元。** 按 A100 每小时 2 美元算,从 5 美元到 0 还有两个半小时,邮件到手机上足够我打开控制台手动销毁。阈值太高告警太频繁会被我忽略,太低来不及反应,5 美元是月预算的十分之一,合适。
3. **每周看一次 Billing Explorer。** 花了多少、花在哪个 pod 上,这是 Day 23 成本看板的数据源之一。

Vast 那边逻辑一样:预充值,`vastai show user` 能看到余额,控制台有充值和通知设置,同样不开自动充值。具体字段以当天控制台为准。

### 第三层的代价

第三层生效的方式是「余额烧光」,所以它生效一次的代价就是整个余额,10 到 20 美元。它不是用来日常兜底的,是用来把「灾难」的定义从「三个月预算」改写成「两周预算」。如果第三层真的触发了一次,那说明前两层都出了问题,第一件事不是充钱,是回头看日志找前两层为什么没拦住。

## 把销毁逻辑抽出来,并且能在本机干跑

run.sh 和 idle-watch.sh 里各有一份 `destroy_self` 和 `notify`,两份一模一样。这是我为了让上面两段代码各自完整才复制的,真正放进仓库时抽成 `common.sh`,两边 `source "$REPO_DIR/common.sh"`。逻辑只留一份,以后改 API 字段名只改一处。

抽出来还有一个好处:可以加一个 `DRY_RUN` 开关,在 2018 年的 MacBook 上把整条销毁链干跑一遍,一分钱不花。

```bash
# common.sh 片段
destroy_self() {
  if [ "${DRY_RUN:-0}" = 1 ]; then
    echo "[dry-run] would destroy: runpod=${RUNPOD_POD_ID:-none} vast=${CONTAINER_ID:-none}"
    return 0
  fi
  # …真正的 API 调用同上…
}
```

本机测试就是:

```bash
DRY_RUN=1 RUNPOD_POD_ID=fake-pod RUNPOD_API_KEY=fake NOTIFY_URL=https://example.invalid \
  EXP_NAME=dry bash run.sh -c 'print("hello")'
```

预期输出里能看到 `hello`、`== run done`、`[notify] run dry exited rc=0`、`[dry-run] would destroy: runpod=fake-pod`,而且顺序正确。再故意让 python 报错(`-c 'raise SystemExit(3)'`),预期 `rc=3` 出现在通知里,dry-run 销毁照样执行。这两次干跑验的是 trap 的注册时机、`$?` 的取值、三个动作的顺序,这些全是 bash 逻辑,和 GPU 无关,不该在按小时计费的机器上第一次运行。

idle-watch.sh 也能干跑:本机没有 nvidia-smi,`util` 会落到 `${util:-100}` 那条兜底,永远判忙,正好验证「读不到就当忙」这条路径。想验空闲路径,把 `nvidia-smi` 那行临时换成 `util=0`,`IDLE_LIMIT=3`,`sleep 60` 改成 `sleep 1`,三秒后应该看到 dry-run 销毁。

## spot 被抢占:免费的第一层演习

Day 19 选的是 spot 实例,它随时可能被厂商收回。被收回时会发生什么,和三层的关系是什么,现在想清楚:

- **RunPod 的 spot pod 被抢占时进入 stop 状态**,不是 terminate。容器盘清空,volume 盘保留并继续计费。也就是说抢占之后如果我不管,它会以 stop 状态一直扣磁盘费,直到我手动 terminate 或余额归零。这是一个前两层都管不到的缝:第一层的 trap 来不及跑(容器被直接停掉,进程没有机会走退出路径),第二层的看门程序随容器一起停了。
- **Vast 的 interruptible 实例被更高出价挤掉时同样是 stop**,逻辑一样。

所以 spot 抢占引出第二层的一个补充:看门程序在容器里,容器停了它就没了。需要一个**在容器外面**的检查。最简单的做法是在本机或 CF Worker 上放一个每天跑一次的脚本,列出账户下所有 stop 状态的实例,超过 24 小时的直接 terminate,并推一条通知。RunPod 用 GraphQL 的 `myself { pods { id desiredStatus } }` 能列出来,Vast 用 `vastai show instances`。这个外部检查同时也覆盖了「看门程序被 OOM 杀」那一格,把上面矩阵里第二列唯一的空心圈补上了。

反过来看,spot 抢占对我也是一次免费演习:它模拟了「实例突然消失」,验证的是 Day 20 的持久化决策是否成立。抢占之后我丢了什么?如果答案是「什么都没丢,重开一台 bootstrap 两分钟」,Day 20 就做对了。如果丢了半小时的结果,说明 run.sh 里结果推送的频率不够,要改成每完成一个 batch 就 push 一次,而不是全部跑完再 push。这一条到 M9 训练侧会变成正式课题,叫 checkpoint,现在先在推理实验上养成习惯。

## 第二层的改进清单,留给被坑之后

写完最简版本,我知道它还有几处粗糙。全部现在做会拖慢 W4,列出来,哪个坑先踩到就先补哪个:

| 粗糙点 | 后果 | 改法 | 什么时候做 |
| --- | --- | --- | --- |
| ssh 条件只看「有没有连接」 | 开着连接去吃饭,永远不算空闲 | `who -u` 读会话空闲时间,超过 30 分钟不算活跃 | 第一次为此多付了钱之后 |
| `.keep` 不过期 | touch 一次第二层永久失效 | 循环里 `find /workspace/.keep -mmin +60 -delete` | 和上一条一起 |
| 看门程序在容器里 | 容器停了它就停,spot 抢占后的 stop 状态没人管 | 容器外每日检查 stop 状态实例,见上一节 | W4 结束前,因为它同时补矩阵的空格 |
| 没有心跳 | 看门程序死了我不知道 | 每分钟往 CF Worker 打一次心跳,Worker 端 5 分钟没收到就推告警(dead man's switch) | M2,Worker 上顺手加 |
| Jupyter 场景 | notebook 开着、kernel 空闲、ssh 端口转发算连接 | 查 Jupyter 的 `/api/kernels` 里 `execution_state` 是否 busy | 真开始用 Jupyter 再说,M1–M2 我用脚本不用 notebook |
| 通知只有一个渠道 | webhook 挂了通知就没了 | 第二渠道:低余额邮件本身就是,第三层顶上 | 已经有了 |

心跳那一条值得多说一句。前面所有机制都是「出事了通知我」,心跳是反过来的:「没出事也每分钟报个平安,平安消失了才是出事」。它能抓住的是「看门程序自己死了」这种静默失效,其他所有机制对这种失效都是盲的。做法很轻:看门程序每轮循环末尾 `curl -s -m 5 "$HEARTBEAT_URL"`,Worker 端记下最后一次心跳时间,一个每 5 分钟跑的 cron 检查它是否超过 5 分钟没更新。这套东西和我做过的定时推送 Worker 是同一个骨架,加一个 KV 键就够。

## 三层各自会怎么失效

写完三层,最后一件事是诚实地列出每一层会在什么情况下失效。这张表回答路线图里那道验收题「三层分别在什么情况下生效?哪一层最可能失效?」

| 层 | 失效方式 | 概率 | 谁兜底 |
| --- | --- | --- | --- |
| 第一层 trap | run.sh 在 `trap` 注册之前崩掉;根本没通过 run.sh 起任务(手动 ssh 调试);API key 过期或 API 挂;实例认不出自己的 ID(Vast 环境变量名对不上) | **最高**。前两种是日常操作方式的问题,不是 bug,天天会发生 | 第二层 |
| 第二层 idle-watch | 看门程序没起来(bootstrap 在它之前失败,或我忘了加那一步);被 OOM killer 顺手杀掉;`.keep` 文件忘了删;我在 Jupyter 里开着 ssh 会话但两小时没动,三条件里的「无 ssh」永远不满足 | 中。最后一种是设计上的盲区:有 ssh 会话就不杀,而我完全可能开着连接去吃饭 | 第三层 |
| 第三层 余额 | 我某次充多了(比如为了跑 8 小时实验一次充了 50 美元);开了 auto-pay;告警邮件进了垃圾箱 | 低,但每一条都是我自己的决定 | 没有了 |

结论:**第一层最可能失效**,因为它依赖「任务是通过 run.sh 起的」这个前提,而调试阶段我经常不走 run.sh。所以第二层不是备胎,是主力;第一层的价值在于响应快,任务一结束几秒钟就销毁,不用等 20 分钟。

第二层那个「开着 ssh 去吃饭」的盲区值得再想一步。解法是把 ssh 条件从「有没有连接」改成「连接上有没有输入」:`who -u` 会显示每个会话的空闲时间,超过 30 分钟没敲键盘的连接不算活跃。这个改进留到第一次被它坑了再加,现在先跑最简单的版本。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="三层保险覆盖的失败场景矩阵">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">哪种失败,哪一层接得住</text>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">
    <text x="240" y="52" text-anchor="middle">第一层 trap</text>
    <text x="380" y="52" text-anchor="middle">第二层 idle-watch</text>
    <text x="520" y="52" text-anchor="middle">第三层 余额</text>
  </g>
  <line x1="20" y1="60" x2="620" y2="60" stroke="var(--rule)"/>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink)">
    <text x="20" y="84">任务正常跑完,我不在</text>
    <text x="20" y="114">ssh 调试到一半被叫走</text>
    <text x="20" y="144">bootstrap 失败,实例空着</text>
    <text x="20" y="174">run.sh 在 trap 前崩</text>
    <text x="20" y="204">看门程序被 OOM 杀</text>
    <text x="20" y="234">API key 过期</text>
  </g>
  <!-- rows: fill circles -->
  <g>
    <!-- row1 -->
    <circle cx="240" cy="80" r="7" fill="var(--mem)"/><circle cx="380" cy="80" r="7" fill="var(--mem)"/><circle cx="520" cy="80" r="7" fill="var(--mem)"/>
    <!-- row2 -->
    <circle cx="240" cy="110" r="7" fill="none" stroke="var(--rule)"/><circle cx="380" cy="110" r="7" fill="var(--mem)"/><circle cx="520" cy="110" r="7" fill="var(--mem)"/>
    <!-- row3 -->
    <circle cx="240" cy="140" r="7" fill="none" stroke="var(--rule)"/><circle cx="380" cy="140" r="7" fill="var(--mem)"/><circle cx="520" cy="140" r="7" fill="var(--mem)"/>
    <!-- row4 -->
    <circle cx="240" cy="170" r="7" fill="none" stroke="var(--rule)"/><circle cx="380" cy="170" r="7" fill="var(--mem)"/><circle cx="520" cy="170" r="7" fill="var(--mem)"/>
    <!-- row5 -->
    <circle cx="240" cy="200" r="7" fill="var(--mem)"/><circle cx="380" cy="200" r="7" fill="none" stroke="var(--rule)"/><circle cx="520" cy="200" r="7" fill="var(--mem)"/>
    <!-- row6 -->
    <circle cx="240" cy="230" r="7" fill="none" stroke="var(--rule)"/><circle cx="380" cy="230" r="7" fill="none" stroke="var(--rule)"/><circle cx="520" cy="230" r="7" fill="var(--compute)"/>
  </g>
  <text x="540" y="234" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">只剩余额</text>
  <text x="20" y="254" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">实心 = 这一层接得住。第二列空得最多,所以第二层是主力,第一层只是快。</text>
</svg>
<figcaption>六种真实的失败方式对三层的覆盖。第一层只在「任务通过 run.sh 起并跑到退出」时有效,日常调试根本不满足;第二层几乎全覆盖,唯一漏的是它自己被杀;第三层永远在,代价是整个余额。</figcaption>
</figure>

## 验收:故意让它发生

三层都写完了,不跑一遍等于没写。两个验收,总共花不到 1 美元。

**验收一,第一层。** 开一个便宜的实例(RTX 3090 或 4090 级别就行,几毛钱一小时),bootstrap 跑完,然后:

```bash
EXP_NAME=selftest bash run.sh -c 'import torch,time; x=torch.randn(4096,4096,device="cuda"); [x@x for _ in range(3000)]; torch.cuda.synchronize(); print("done")'
```

这是一个跑几十秒到几分钟的矩阵乘循环,跑完 run.sh 走到 trap。预期看到的顺序:`== run done` → git push → 手机收到通知 → 几秒后 ssh 连接断开 → 控制台里实例消失。记下从 `run done` 到实例消失的秒数。

**验收二,第二层。** 再开一个实例,bootstrap 跑完(看门程序已起),然后**退出 ssh,什么都不做**。预期:第 15 分钟手机收到「5 分钟后销毁」的通知,第 20 分钟收到「销毁」的通知,控制台里实例消失。这一步的花费是 20 分钟的机时,按 4090 算大约 0.2 美元。

**验收三,第三层,不真跑。** 真跑要烧光余额,不值。改成检查清单:控制台里 auto-pay 是关的、low balance alert 是开的且阈值 5 美元、余额不超过 20 美元。三项都对,第三层就位。

记录表,**现在是空的**,W4 真上机后填:

| 验收 | 预期 | 实际 | 日期 / 厂商 / 卡 | 备注 |
| --- | --- | --- | --- | --- |
| 一:run.sh 结束到实例消失 | 5 到 30 秒 | | | 通知先于销毁到达吗 |
| 一:结果是否已推到 git | 是 | | | 提交信息里 rc=0 |
| 二:第一条通知到达时间 | 空闲后 15 分钟 | | | |
| 二:实例消失时间 | 空闲后 20 分钟 | | | 比通知晚 5 分钟 |
| 二:期间 idle-watch.log 是否连续 | 每分钟一行 | | | 中间断了说明看门程序死过 |
| 三:auto-pay 关 / 告警开 / 余额 ≤ 20 | 三项全对 | | | 截图存档 |
| 两次验收总花费 | < 1 美元 | | | 对照 Billing Explorer |

## 三层本身花多少钱,上机第一天按什么顺序做

三层保险自己也有成本,算一遍免得以后嫌麻烦想省掉:

| 层 | 一次性成本 | 持续成本 | 说明 |
| --- | --- | --- | --- |
| 第一层 | 写 run.sh 的 trap,约 40 行,本机干跑验证 30 分钟 | 每次任务结束多几秒(push + 一次 API 调用) | 零机时成本 |
| 第二层 | idle-watch.sh 约 60 行,验收一次 20 分钟机时约 0.2 美元 | 每分钟一次 nvidia-smi,可忽略;误杀的风险按 20 分钟阈值算每次最多 0.5 到 0.8 美元 | 20 分钟阈值就是保险费 |
| 第三层 | 控制台点三个开关,5 分钟 | 零 | 生效一次的代价是整个余额 |
| 容器外每日检查 | CF Worker 加一个 cron 路由,1 小时 | 零(免费额度内) | 补 spot 抢占后的 stop 状态和看门程序死亡两个缝 |

全部加起来不到一个下午加 1 美元机时。对照第二节那张表里「周末忘关等于三个月预算」,这笔投入的回报率不用再算。

W4 真正上机那天的顺序,按依赖关系排:

1. 本机 `DRY_RUN=1` 干跑 run.sh 和 idle-watch.sh,确认 trap 顺序和空闲计数逻辑。
2. 控制台:充 15 美元,关 auto-pay,开 low balance alert 阈值 5 美元,生成 API key 存成 secret。第三层先就位,后面所有实验都在它下面跑。
3. 开一台便宜卡,bootstrap 跑通(Day 21 的验收),`env | sort` 记下 Vast 的实例 ID 变量名,`tail idle-watch.log` 确认看门程序在跑。
4. 验收一:跑五分钟任务,看实例自己消失,记时间。
5. 再开一台,验收二:什么都不做等 20 分钟,看两条通知和实例消失。
6. 填上面的记录表,截图存档,当天的花费对照 Billing Explorer,应该在 1 美元以内。

第 2 步在第 3 步之前是有意的:第一次上 GPU 之前,余额上界已经定好了。哪怕第 3 到 5 步全做错,最坏损失也就是 15 美元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| stop / terminate(destroy) | 停机保留 vs 彻底销毁。前者磁盘继续计费、数据保留;后者全停、数据全没 |
| `trap CMD EXIT` | bash 在脚本退出时执行 CMD,无论正常结束、出错还是收到信号 |
| `$?` | 上一条命令的退出码,在 trap 函数第一行取才是脚本真正的退出码 |
| SIGHUP | 终端断开时发给进程的信号;ssh 掉线杀死任务就是它,tmux 下的进程不受影响 |
| OOM killer | 内核在内存耗尽时杀进程的机制;显存 OOM 是 CUDA 报错,内存 OOM 是它,两回事 |
| GraphQL mutation | RunPod API 里「改状态」的操作,`podStop`、`podResume`、`podTerminate` 都是 |
| `RUNPOD_POD_ID` | RunPod 注入到容器里的环境变量,实例自己的 ID,销毁自己时用 |
| `nvidia-smi --query-gpu` | nvidia-smi 的查询模式,只输出指定字段,适合脚本解析 |
| utilization.gpu | 采样窗口内有 kernel 在跑的时间比例。测「忙不忙」,不测「算力用了多少」 |
| `nohup` | 让进程忽略 SIGHUP,终端关了也继续跑 |
| webhook | 一个接受 HTTP POST 的 URL,收到就触发动作,这里是转发成手机推送 |
| 预充值 / auto-pay | 先充钱后消费 vs 余额低了自动扣卡充值。第三层的前提是只用前者 |
| low balance alert | RunPod 控制台的低余额邮件告警,阈值自定 |
| spend limit | RunPod 账户默认每小时 80 美元的消费上限,防误开多卡,不防忘关机 |
| Billing Explorer | RunPod 控制台看消费明细的地方 |
| spot 抢占 | 厂商收回低价实例。Vast 的 interruptible 实例被更高出价挤掉时转为 stop 状态,磁盘继续计费,容器内进程没有机会走退出路径;RunPod 2026 年 9 月已无 Spot 档(Day 19 查证),下文关于 RunPod spot 的描述来自其旧文档,对当前 On-demand 实例只有「余额归零停机」这一种被动停止 |
| dead man's switch | 心跳机制:定期报平安,平安消失才告警;能抓住看门程序自己静默死亡 |
| `DRY_RUN` | 干跑开关,销毁和通知只打印不执行,本机不花钱验证 trap 顺序 |

## 常见误区

**以为「这次一定记得关」。** 忘关机不是粗心,是正常工作状态的必然结果:去睡觉、被叫走、ssh 断了以为任务死了。靠记性的方案失败是确定的,只是时间未定。

**先销毁再推结果。** trap 里顺序反了,容器一销毁后面的 git push 永远不会执行,一小时的实验结果随实例一起消失。顺序是推结果 → 通知 → 销毁,永远如此。

**用 stop 代替 terminate 图省事。** stop 状态下磁盘照样计费,RunPod 停机的 volume 盘每 GB 每月 0.20 美元,比运行时还贵。按 Day 20 的决定实例上没有舍不得的东西,一律 terminate。

**看门程序开 `set -e`。** 任何一次 nvidia-smi 超时都会让它自己退出,第二层就静默消失了。看门程序必须自己处理每一条命令的失败,读不到状态就当忙。

**只看 GPU 利用率判断空闲。** 模型下载、pip 装包阶段利用率是 0,任务却在跑。要加「有没有 python 进程」和「有没有 ssh 会话」两个条件。

**开了 auto-pay。** 它让余额永远不会归零,第三层直接作废。灾难级忘关机的损失上界从「余额」变成「银行卡额度」。

**第一层跑通了就觉得够了。** 第一层只在任务通过 run.sh 起并走到退出路径时有效,调试阶段大部分时间不满足。第二层才是主力,第一层只是快。

**验收只在脑子里过一遍。** 三层各有各的失效方式,不故意触发一次就不知道通知能不能到、API 能不能通、顺序对不对。两次验收不到 1 美元。

## 参考资料

### 文档

- RunPod · Billing overview,https://docs.runpod.io/accounts-billing/billing 。第三层的所有事实出处:每 5 分钟结算、余额归零时 pod 的处理、低余额告警、auto-pay、默认 80 美元每小时上限、存储价格表。
- RunPod · Pod 环境变量,https://docs.runpod.io/pods/references/environment-variables 。`RUNPOD_POD_ID` 和 `RUNPOD_SECRET_*` 的出处。
- RunPod · GraphQL 管理 Pod,https://docs.runpod.io/sdks/graphql/manage-pods 。`podStop`、`podResume` 的 curl 写法,`podTerminate` 字段以此页为准。
- RunPod · API keys,https://docs.runpod.io/get-started/api-keys 。生成和权限范围。
- RunPod · runpodctl 概览,https://docs.runpod.io/runpodctl/overview 。`runpodctl pod` 子命令组,动词以 `--help` 为准。
- RunPod · 存储类型,https://docs.runpod.io/pods/storage/types 。容器盘、volume 盘、network volume 的区别,配合 stop/terminate 那张表看。
- Vast.ai · CLI 文档,https://docs.vast.ai/cli 。`vastai destroy instance`、`vastai stop instance`、`vastai show user`。
- Vast.ai CLI 源码,https://github.com/vast-ai/vast-cli 。`vast.py` 里 `destroy__instance` 的帮助文本原话:irreversible, deletes data。
- Vast.ai · Billing,https://docs.vast.ai/billing 。预充值与余额规则。
- NVIDIA System Management Interface,https://developer.nvidia.com/nvidia-system-management-interface 。`--query-gpu` 支持的字段列表在 `nvidia-smi --help-query-gpu`。
- GNU Bash 手册,https://www.gnu.org/software/bash/manual/bash.html 。`trap` 内建命令和 EXIT 伪信号。
- POSIX `trap` 手册页,https://man7.org/linux/man-pages/man1/trap.1p.html 。

### 视频

- theurbanpenguin,《BASH scripting lesson 8 using TRAP to control scripts》,已嵌入下方。
- Dr. Data Science,《NVIDIA System Management Interface (nvidia-smi) to monitor NVIDIA GPU devices》,已嵌入下方。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/0btsvoSt76M" title="BASH scripting lesson 8 using TRAP to control scripts" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>theurbanpenguin · BASH scripting lesson 8 using TRAP to control scripts。十几分钟讲清 trap 抓信号和 EXIT 的用法,看完再回头读 run.sh 的 on_exit 函数。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/S7eUyRL9Jg0" title="NVIDIA System Management Interface (nvidia-smi) to monitor NVIDIA GPU devices" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dr. Data Science · NVIDIA System Management Interface (nvidia-smi) to monitor NVIDIA GPU devices。看 `--query-gpu` 和 `--format=csv` 那段,那是看门程序取信号的方式。</figcaption>
</figure>

## 自测

合上笔记做。

**1. 三层分别防的是哪种失败?各自的响应时间是多少?**

<details><summary>答案</summary>

第一层 trap 防「任务正常跑完但我不在场」,run.sh 退出路径上调 API 销毁自己,响应几秒。第二层看门程序防「实例活着但 GPU 没在干活」:手动调试被叫走、bootstrap 失败实例空着、run.sh 在 trap 前崩,响应 20 分钟(第 15 分钟先通知)。第三层余额防「前两层都失效」,只预充值不开 auto-pay,余额归零厂商自动停机,最坏损失等于余额,响应时间取决于余额除以小时价。

</details>

**2. run.sh 的 trap 函数里三个动作的顺序是什么?为什么不能反?**

<details><summary>答案</summary>

推结果 → 通知 → 销毁。销毁一执行容器就没了,后面的任何命令都不会执行;反过来先销毁,实验结果随实例一起消失。通知放中间是因为它快(一次 curl)且失败无害。

</details>

**3. 看门程序为什么要三个条件同时满足才算空闲?只看 GPU 利用率会出什么问题?**

<details><summary>答案</summary>

模型下载、pip 装包阶段 GPU 利用率是 0 但任务在跑,只看利用率会误杀;我正在 ssh 里敲命令时 GPU 也可能是 0,杀了实例等于从脚下抽凳子。所以加「无 python 进程」和「无 ssh 会话」两个条件。反过来,decode 阶段算力利用率只有 1% 但 utilization.gpu 照样 90 以上,不会误判成空闲,因为那个指标测的是「有没有 kernel 在跑」。

</details>

**4. 为什么看门程序不能开 `set -e`?读不到 nvidia-smi 时应该怎么处理?**

<details><summary>答案</summary>

开了 `-e`,任何一次检查命令失败(nvidia-smi 超时、pgrep 无匹配返回 1)都会让看门程序自己退出,第二层静默消失。读不到利用率时按 100 处理,即「当作忙」,宁可多花 20 分钟的钱也不误杀正在跑的任务。

</details>

**5. stop 和 terminate 的区别是什么?为什么第一层选 terminate?**

<details><summary>答案</summary>

stop 停计算费但磁盘继续计费(RunPod 停机 volume 盘每 GB 每月 0.20 美元,比运行时的 0.10 贵),数据保留在 volume 盘;terminate 全停,数据不可恢复。按 Day 20 的决定,代码在 git、结果推出去、模型重下,实例上没有舍不得的东西,所以 terminate。stop 只在「明天一早接着用同一台」时值得,超过一天磁盘费就不划算。

</details>

**6. 哪一层最可能失效?为什么?那一层失效了谁兜底?**

<details><summary>答案</summary>

第一层。它依赖「任务是通过 run.sh 起的并跑到了退出路径」,而调试阶段我大部分时间是 ssh 进去手动敲命令,根本没有 run.sh;run.sh 在 trap 注册前崩、API key 过期也都会让它失效。第二层兜底,它只看「GPU 有没有人用」,不关心任务怎么起的。所以第二层是主力,第一层的价值只是快。

</details>

**7. 第三层的三个具体动作是什么?auto-pay 为什么是第三层的敌人?**

<details><summary>答案</summary>

只充 10 到 20 美元不绑自动续费;低余额告警阈值设 5 美元(按 A100 每小时 2 美元还有两个半小时反应);每周看一次 Billing Explorer。auto-pay 会在余额低时自动扣卡充值,让余额永远不归零,第三层「损失上界等于余额」的保证直接作废,上界变成银行卡额度。

</details>

## 明天预告

Day 23 做 W4 的最后一件正事:成本看板。三层保险管的是「别多花」,看板管的是「花了多少、花在哪」。格式很简单,一个 CSV,每次实验一行:日期、实验名、卡型、小时价、时长、花费、一句话结论。启动和销毁脚本自动追加,一段 Python 汇总本月。要能立刻回答两个问题:这个月花了多少,以及每个实验、每一百万 token 各花了多少钱。答不出来就是看板没做好。
