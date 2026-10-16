---
title: 'Day 24 · W4 复习：一条命令起环境的完整清单、五道验收题、错题本'
description: '把 W4 五天的工程活压成一张能打勾的清单：开机前、开机后、收尾三段，每项对应哪个脚本、哪条计费事实。然后做路线图 W4 的五道验收题，把这周三篇文章里口径不一致的地方统一掉，最后整理错题本。W4 结束时的标准只有一句：一条命令起环境，跑完自己消失，钱花在哪一眼可查。'
pubDate: 2026-09-05
regime: none
tags: ['review', 'week-4', 'runpod', 'vast', 'cost', 'automation', 'aiinfra-365']
series: 'aiinfra-365'
day: 24
lang: 'zh'
---

## 这一周解决了什么

W4 一行 GPU 代码没写。五天干的全是工程杂务:租卡、存储、开机脚本、自动销毁、记账。但这周决定了后面十一个月会不会因为一次忘关机把三个月预算烧光,以及每次实验的数字能不能在同一个环境下复现。

W1 到 W3 的产出是数字,W4 的产出是一条流水线。它的验收标准路线图写得很死:**一条命令起环境,跑完自动销毁**。拆成五天就是:

| 天 | 做了什么 | 交出的东西 |
| --- | --- | --- |
| Day 19 | 第一次租 GPU,搞清两家平台的结构,选卡,读 nvidia-smi | 选卡三步法(显存 → 带宽 → 每美元带宽)、第一次开机的 12 条清单 |
| Day 20 | 实例销毁后什么会丢,三种存储的命运和费率,「存着」还是「重下」的账 | 三类资产各自的去处,一棵决策树,一张写死的方案表 |
| Day 21 | bootstrap 脚本,5 分钟起环境,幂等,每步计时 | `bootstrap.sh` + `requirements.txt` + `run.sh` 骨架 |
| Day 22 | 三层自动销毁:trap、看门程序、余额上限 | `run.sh` 完整版、`idle-watch.sh`、控制台三个开关、失效方式表 |
| Day 23 | 成本看板,一次开机一行,脚本自动记账,$/1M token 换算 | `gpu-ledger.csv` 格式、开机/销毁两段记账代码、`summarize.py` |

要诚实地说一件事:这五篇写的时候还没有真正开过机。所有脚本在本机干跑过、所有计费事实从文档核对过、所有价格是 2026 年 9 月初从官网和公开接口查的,但「从零到能跑代码几分钟」「这周花了多少钱」这两道验收题的答案现在是预期值,不是实测值。这篇复习把该留空的地方留空,等 W4 真上机那天填。

## 一页笔记

以下是 W4 五篇里以后会反复查的事实,全部压在这里。价格以 2026 年 9 月为准,会变;规则不会变。

### 两家平台

| | RunPod | Vast.ai |
| --- | --- | --- |
| 结构 | 平台统一定价,Secure / Community 两档机器 | 市场,房东各自定价 |
| 计费 | 按秒计量,每 5 分钟结算扣款,不收流量费 | 按秒,存储和上传下载流量都另收,房东自定 |
| 便宜档 | **2026-09 文档里已无 Spot**,便宜靠 Community Cloud 和 Savings plan | Interruptible,出价制,被更高出价顶掉时**暂停**不销毁 |
| 余额归零 | Pod 停机;无 network volume 的直接销毁 | 实例停机;没绑卡则排期删除实例和数据 |
| CLI | `runpodctl`,新版 pod 操作收在 `runpodctl pod` 下 | `vastai`,pip 装,所有子命令在 `vast.py` 一个文件里 |
| 实例自己的 ID | 环境变量 `RUNPOD_POD_ID` | 文档无明确页面,上机 `env \| sort` 看,常见 `CONTAINER_ID` |
| 什么时候用 | 第一次,流程要稳 | 流程稳了之后省钱,搜索时必加过滤 |

Vast 搜索的完整过滤条件,五个一个都不能省:

```bash
vastai search offers 'gpu_name=RTX_4090 num_gpus=1 verified=true reliability>0.98 inet_down>200 inet_down_cost<0.01 storage_cost<0.3' -o 'dph'
```

### 选卡

顺序是显存装得下 → 带宽决定 decode 快慢 → 小时价决定每美元买到多少带宽。算力那列 M5 之前排最后。

| 卡 | 显存 | 带宽 GB/s | 7B fp16 decode 上限 tok/s | 7B @2048 序列 KV cache 最多装 | 用途 |
| --- | --- | --- | --- | --- | --- |
| T4(Colab) | 16 GB | 320 | 装不下 | 装不下 | W1–W3 已用完价值 |
| RTX 3090 / 4090 | 24 GB | 936 / 1008 | 69 / 75 | ≈ 18,000 token,batch 8 | **W5–W7 主力**,便宜卡调试 |
| L4 | 24 GB | 300 | 22 | 同上 | 同显存带宽差 3 倍,不选 |
| A100 80GB SXM | 80 GB | 2039 | 150 | ≈ 130,000 token,batch 64 | 贵卡出数,M3 两卡 TP |
| H100 80GB SXM | 80 GB | 3352 | 248 | 同上 | M9 之前用不上 |

一个 W4 才看清的结论:7B 在 24 GB 卡上 KV cache 只装得下 batch 8,离 ridge point 164 差二十倍,**永远是 memory-bound**。要看 Day 16 那种「曲线离开斜线」,在 24 GB 卡上得用 TinyLlama(每 token 22.5 KB,batch 128 × 2048 才 6 GB)。显存决定你能不能爬到屋顶,和算力无关。

### 存储:三种盘,三种死法

| | Container Disk 容器盘 | Volume Disk 卷盘 | Network Volume 网络卷 |
| --- | --- | --- | --- |
| 挂在哪 | `/`,`~` 也在这 | `/workspace` | `/workspace`,替代卷盘 |
| stop 时 | **清空** | 保留 | 保留 |
| delete 时 | 清空 | **清空** | 保留 |
| 运行费率 | 0.10 美元/GB/月 | 0.10 | 0.07 |
| 停机费率 | 不收 | **0.20,翻倍** | 0.07 |
| 坑 | `~/.cache/huggingface` 在这,stop 就没 | 50 GB 停一个月 10 美元 | 锁数据中心,创建 Pod 时必须挂上 |

Vast 只有一块容器盘,停机照收且可能比运行时贵,`--disk` 创建后不能改,7B 模型 30 GB 起步。Vast 的 Volume 绑物理机器,几乎用不上。

存着还是重下的账:50 GB 卷盘每周开机 6 小时停机 162 小时,一个月约 10 美元,占月预算 17% 到 33%,还不保证重启有 GPU;重下 13.5 GB 权重在千兆网上 1 到 2 分钟。**默认每次 delete、每次重下。** 例外只有两条:连续几天每天开机不止一次可以 stop 过夜(50 GB 一晚 0.33 美元),以及 M3 之后数据超过 100 GB 再开网络卷。

### 三类资产各放哪

决策树第一问:**丢了 5 分钟能重造吗?** 这里的 5 分钟指几乎零成本的时间,有 GPU 时间参与就算不能重造。

| 资产 | 放哪 | 开机怎么来 | 收尾怎么走 |
| --- | --- | --- | --- |
| 代码、配置、脚本 | 私有 git | clone | push |
| 密钥(HF / 云 API / R2 / webhook) | 本机 `.env`,不进 git | scp 后注入环境变量 | 随实例销毁 |
| pip 依赖 | 不存 | bootstrap 装,版本锁死 | 销毁 |
| 模型权重、公开数据集 | 不存,`HF_HOME=/workspace/hf` | `hf download` 后台预热 | 销毁 |
| 小结果(< 10 MB 的 CSV / JSON / PNG) | git,跟代码 | 无 | push |
| 大结果(trace、自己量化出的权重) | Cloudflare R2 | 需要时 rclone 拉 | rclone 推 |
| 自己筛出来的固定 prompt 集 | git | clone | push |

### 五个脚本各干什么

| 文件 | 干什么 | 关键设计 |
| --- | --- | --- |
| `bootstrap.sh` | 装系统工具、检查 torch、clone、装 Python 依赖、HF 登录、预热模型、smoke test、起看门程序、写账本前半行 | `set -euo pipefail`;`step` 函数每步计时写 CSV;幂等三手段;`exec > >(tee -a LOG) 2>&1` 留日志;**看门程序挪到第一步之前** |
| `requirements.txt` | 钉死 Python 包版本 | 版本号本身不重要,有版本号才重要;`uv pip freeze` 出 lock 随结果留档 |
| `run.sh` | 跑一个实验,推结果,通知,销毁自己 | `trap on_exit EXIT`;顺序**推结果 → 通知 → 销毁**;`KEEP_ALIVE=1` 逃生口;`DRY_RUN=1` 本机干跑 |
| `idle-watch.sh` | 每分钟查 GPU 利用率、python 进程、ssh 会话,连续空闲 20 分钟销毁 | **不开 `-e`**;读不到利用率当 100;提前 5 分钟通知;`/workspace/.keep` 保命开关 |
| `common.sh` | `destroy_self` 和 `notify` 只留一份 | 两边 `source`,改 API 字段只改一处 |
| `summarize.py` | 本机跑,汇总当月账本 | 按实验、按卡型、列出 `end` 为空和没写结论的行 |

### 三层保险

| 层 | 防的失败 | 机制 | 响应 | 最可能怎么失效 |
| --- | --- | --- | --- | --- |
| 第一层 trap | 任务正常跑完,我不在场 | `run.sh` 退出路径调 API 销毁自己 | 几秒 | **最高**:任务没通过 `run.sh` 起(手动 ssh 调试);`trap` 注册前崩;API key 过期 |
| 第二层看门 | 实例活着,GPU 没人用 | 三条件连续 20 分钟空闲 → 销毁 | 20 分钟,第 15 分钟先通知 | 看门程序没起来或被 OOM 杀;`.keep` 忘删;开着 ssh 去吃饭 |
| 第三层余额 | 前两层全失效 | 只充 10 到 20 美元不绑卡;低余额告警阈值 5 美元 | 余额 ÷ 小时价 | 某次充多了;开了 auto-pay;告警进垃圾箱 |
| 容器外每日检查 | interruptible 被顶掉后 stop 状态计磁盘费;看门程序静默死亡 | 本机或 CF Worker 每天列出 stop 超 24 小时的实例,销毁并通知 | 一天 | 还没写,W4 上机前补 |

第二层是主力,第一层只是快。第三层生效一次的代价是整个余额,它把「灾难」从三个月预算改写成两周预算。

### 账本

`gpu-ledger.csv` 九列:`date, experiment, provider, gpu, price_per_hour, start, end, cost_usd, note`。开机时 bootstrap 写前六列,销毁时补后三列并 `git push`,push 在销毁 API 之前。`end` 为空的行是被抢占或手动删的,月底单独查;`note` 为空的行是没产出的开机,月底单独面对。

$/1M token 的换算只有一步,是产出物 01 那张卡片上要填的数:

```
$/1M token = 小时价 × 1e6 ÷ (tok/s × 3600)
A100 SXM 1.39 美元/时,7B decode batch 1 ≈ 150 tok/s  → 2.57 美元
batch 32 ≈ 4,800 tok/s                              → 0.08 美元
```

差 32 倍,原因就是 Day 5 那个点从算术强度 1 往 153 挪了一段。这是「continuous batching 是吞吐的命门」第一次变成美元。

## 一次完整生命周期,东西在哪、谁在看着

把五篇的东西拼成一条线。上面一行是步骤,中间一行是此刻盘上有什么,下面三条横杠是三层保险各自覆盖哪一段。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="GPU 实例一次完整生命周期:六个步骤、每一步盘上有什么、三层保险各覆盖哪一段">
<text x="12" y="20" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一次开机的生命周期(实线框 = 实例上执行,虚线框 = 本机执行)</text>
<g font-family="var(--font-mono)" font-size="10">
<rect x="12" y="44" width="96" height="60" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="1.2" stroke-dasharray="4 3"/>
<text x="60" y="64" text-anchor="middle" fill="var(--ink)">1 开机</text>
<text x="60" y="78" text-anchor="middle" fill="var(--ink-soft)">pod create</text>
<text x="60" y="92" text-anchor="middle" fill="var(--ink-soft)">scp .env</text>
<rect x="116" y="44" width="96" height="60" fill="var(--paper-raised)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="164" y="64" text-anchor="middle" fill="var(--ink)">2 bootstrap</text>
<text x="164" y="78" text-anchor="middle" fill="var(--ink-soft)">先起看门程序</text>
<text x="164" y="92" text-anchor="middle" fill="var(--ink-soft)">apt · uv · 记账半行</text>
<rect x="220" y="44" width="96" height="60" fill="var(--paper-raised)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="268" y="64" text-anchor="middle" fill="var(--ink)">3 拉东西</text>
<text x="268" y="78" text-anchor="middle" fill="var(--ink-soft)">git clone</text>
<text x="268" y="92" text-anchor="middle" fill="var(--ink-soft)">hf download</text>
<rect x="324" y="44" width="96" height="60" fill="var(--paper-raised)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="372" y="64" text-anchor="middle" fill="var(--ink)">4 run.sh</text>
<text x="372" y="78" text-anchor="middle" fill="var(--ink-soft)">tmux 里跑实验</text>
<text x="372" y="92" text-anchor="middle" fill="var(--ink-soft)">结果写 results/</text>
<rect x="428" y="44" width="96" height="60" fill="var(--paper-raised)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="476" y="64" text-anchor="middle" fill="var(--ink)">5 trap 退出</text>
<text x="476" y="78" text-anchor="middle" fill="var(--ink-soft)">push → 通知</text>
<text x="476" y="92" text-anchor="middle" fill="var(--ink-soft)">→ 销毁自己</text>
<rect x="532" y="44" width="96" height="60" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="1.2" stroke-dasharray="4 3"/>
<text x="580" y="64" text-anchor="middle" fill="var(--ink)">6 收尾</text>
<text x="580" y="78" text-anchor="middle" fill="var(--ink-soft)">git pull</text>
<text x="580" y="92" text-anchor="middle" fill="var(--ink-soft)">控制台确认为空</text>
<line x1="108" y1="74" x2="116" y2="74" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="212" y1="74" x2="220" y2="74" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="316" y1="74" x2="324" y2="74" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="420" y1="74" x2="428" y2="74" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="524" y1="74" x2="532" y2="74" stroke="var(--ink-faint)" stroke-width="1.5"/>
</g>
<text x="12" y="132" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">此刻盘上有什么</text>
<g font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)">
<text x="60" y="150" text-anchor="middle">空 /workspace</text>
<text x="60" y="162" text-anchor="middle">.env 在可写层</text>
<text x="164" y="150" text-anchor="middle">torch 在可写层</text>
<text x="164" y="162" text-anchor="middle">timing.csv</text>
<text x="268" y="150" text-anchor="middle">代码、权重在卷盘</text>
<text x="268" y="162" text-anchor="middle">可重造</text>
<text x="372" y="150" text-anchor="middle">结果在卷盘</text>
<text x="372" y="162" text-anchor="middle" fill="var(--compute)">唯一副本,不可重造</text>
<text x="476" y="150" text-anchor="middle">副本已在 GitHub / R2</text>
<text x="476" y="162" text-anchor="middle">盘可以死了</text>
<text x="580" y="150" text-anchor="middle">盘没了</text>
<text x="580" y="162" text-anchor="middle">本机有一切要留的</text>
</g>
<text x="12" y="196" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">谁在看着</text>
<line x1="428" y1="214" x2="524" y2="214" stroke="var(--mem)" stroke-width="4" stroke-linecap="round"/>
<text x="536" y="218" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">第一层 trap,秒级</text>
<line x1="116" y1="244" x2="524" y2="244" stroke="var(--mem)" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 4"/>
<text x="536" y="248" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">第二层看门,20 分钟</text>
<line x1="12" y1="274" x2="628" y2="274" stroke="var(--compute)" stroke-width="4" stroke-linecap="round"/>
<text x="12" y="296" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">第三层余额上限,从充值那一刻起覆盖一切,包括我忘了做第 6 步</text>
<text x="12" y="318" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">第 4 步是全程唯一有「不可重造」东西的时刻,所以第 5 步的顺序是推结果在前、销毁在后,永远如此。</text>
</svg>
<figcaption>六步里只有第 4 步结束时盘上有不可重造的东西。三层保险的覆盖范围从窄到宽:trap 只管第 5 步,看门管实例活着的全程,余额从充值那刻起兜底一切。</figcaption>
</figure>

## 一条命令起环境:完整清单

W4 的验收就是这张表。每一项对应哪一天、哪个脚本、哪条事实,打完勾才算环境工程化做完。

### 开机前(本机,不花钱)

- [ ] 账户余额 ≤ 20 美元,没有保存的信用卡,auto-pay 关,低余额告警开、阈值 5 美元。(Day 19、Day 22 第三层)
- [ ] 本机 `.env` 齐:`HF_TOKEN`(只读)、`RUNPOD_API_KEY` 或 `VAST_API_KEY`(只开 Pod 读写)、R2 的 access key(只开一个 bucket)、`NOTIFY_URL`。文件权限 600,在 `.gitignore` 里。(Day 20、Day 21)
- [ ] 仓库里有 `.git/hooks/pre-commit`,拦 `hf_` / `rpa_` / `sk-` 前缀的字符串。(Day 21)
- [ ] `bash -n bootstrap.sh run.sh idle-watch.sh` 和 `shellcheck` 过;`DRY_RUN=1` 干跑 `run.sh` 两次,一次 rc=0 一次 rc=3,通知里的 rc 对得上,dry-run 销毁在 push 和通知之后。(Day 21、Day 22)
- [ ] 想好这次实验叫什么、跑多久、值多少钱。实验名和小时价是开机命令的必填参数,这就是「不该开」的闸门。(Day 23)
- [ ] 选卡按显存 → 带宽 → 每美元带宽。W5–W7 是 RTX 3090 / 4090,A100 留给 M3。(Day 19)
- [ ] 镜像选官方 PyTorch runtime,CUDA 版本 ≤ 目标机器驱动上限。Vast 上按 `cuda_vers>=12.4` 过滤。(Day 21)
- [ ] Vast 搜索带全五个过滤条件;出价比 `min_bid` 高 10%,`dph_total` 和 `min_bid` 差不到 30% 就直接 on-demand。(Day 19、Day 20)
- [ ] 容器盘 20 GB、卷盘 30 GB(RunPod);Vast `--disk 30` 起,量化实验 50。不开网络卷。(Day 20)
- [ ] 不勾 Jupyter 端口;只用密钥登录。(Day 19)

### 开机后(实例,按秒计费,不在这里想逻辑)

- [ ] 本机 `~/.ssh/config` 的 `gpu` 项改成这次的 ip 和端口,`ssh gpu` 进去。(Day 19)
- [ ] 第一件事 `tmux new -s work`。任何超过一分钟的任务都在 tmux 里跑。(Day 19、Day 21)
- [ ] `scp .env gpu:/root/.env`,`bash bootstrap.sh <实验名> <小时价>`。看门程序应该在第一步就起来,`tail idle-watch.log` 确认每分钟一行。(Day 21、Day 22)
- [ ] `nvidia-smi` 核对:卡型和租的一致,Processes 为空,驱动 CUDA Version ≥ `torch.version.cuda`。(Day 19、Day 21)
- [ ] 5 秒验货:带宽在标称 75% 到 90%。低于 60% 直接销毁换机器。(Day 19、Day 13)
- [ ] Vast 上顺手测 `curl` 下载速率和 `dd` 写入速率;`env | sort` 记下实例 ID 变量名进 `common.sh`。(Day 20、Day 22)
- [ ] `df -h /workspace` 看剩多少;`hf cache scan` 看缓存里有什么。(Day 20)
- [ ] 另开一个 tmux 窗格 `nvidia-smi dmon -s u -d 2` 挂着,`sm%` 和 `mem%` 并排看就是终端里最便宜的 roofline 近似。(Day 19)
- [ ] 实验通过 `EXP_NAME=xxx bash run.sh <脚本> <参数>` 起,不手敲 python。(Day 21、Day 22)
- [ ] 本机另一个终端把 `runpodctl pod delete <id>` 或 `vastai destroy instance <id>` 敲好不回车,或设闹钟。第一层第二层都是我写的代码,这是手动版兜底。(Day 19)

### 收尾(实例 → 本机)

- [ ] `echo "一句结论" > /tmp/ledger_note`。想不出结论就照实留空,月底面对它。(Day 23)
- [ ] `run.sh` 的 trap 自己跑:push 小结果、rclone 推大结果、通知、销毁。看手机上通知先到、ssh 后断。(Day 22)
- [ ] 手动跑的情况:`rclone ls r2:aiinfra-lab/...` 确认远端有文件,再销毁。**同步成功是销毁的硬前置条件。**(Day 20)
- [ ] 销毁用 delete / destroy,不用 stop。(Day 19、Day 22)
- [ ] 回控制台确认实例列表为空,network volume 列表也为空。CLI 返回成功不等于真的没了。(Day 19、Day 22)
- [ ] 本机 `git pull`,账本那行 `end`、`cost_usd`、`note` 三列都填上了。(Day 23)
- [ ] 每周跑一次 `python3 summarize.py`,月底和 Billing Explorer 对一次账,差 10% 以内算对。(Day 23)

一条命令的意思不是真的只敲一次回车,是**开机之后我不需要想任何事**:参数在命令行里,密钥在 `.env` 里,顺序在脚本里,销毁在 trap 和看门程序里,账在 CSV 里。我要做的只剩看结果和写一句结论。

## 五篇文章里口径不一致的地方,统一掉

复习的另一个用处是把五天里各自为政的地方对齐。读一遍发现三处,现在写死。

**账本放哪。** Day 20 的仓库结构里写 `cost/runs.csv`,Day 21 的 bootstrap 用 `/workspace/aiinfra-lab`,Day 23 的记账代码写 `$HOME/work/gpu-ledger.csv` 且 bootstrap 接两个位置参数。统一为:仓库 clone 到 `/workspace/aiinfra-lab`(Day 21 的 `REPO_DIR`),账本是 `$REPO_DIR/cost/gpu-ledger.csv`,bootstrap 的两个位置参数改成环境变量 `EXP_NAME` 和 `PRICE`,和 `run.sh` 用的 `EXP_NAME` 同名。这样三个脚本共用一套变量。Day 23 那段记账代码已经按这个口径改回去了,Day 20 的 `cost/runs.csv` 也改成了同一个文件名,现在回头读不会再看到三个版本。

**RunPod 的 spot。** Day 19 和 Day 20 按 2026 年 9 月的文档写清了 RunPod 已无 Spot 档位,但 Day 22 讨论抢占时沿用了「RunPod 的 spot pod 被抢占进入 stop 状态」的说法,Day 23 的名词表也写「RunPod 叫 Spot」。以 Day 19 为准:**当前 RunPod 没有可中断实例,抢占那一整套逻辑只对 Vast 的 interruptible 成立**。Day 22 那节的结论不受影响,因为 Vast 被顶掉同样是 stop 状态、磁盘照收,容器外每日检查照样要写;只是标题里的「spot」在 RunPod 上对应不到任何按钮。如果 RunPod 以后重新上 Spot,再把这条改回来。

**价格是哪一档。** Day 19 的表写 RunPod on-demand 4090 约 0.74、A100 SXM 1.59、H100 3.29 美元;Day 23 写 4090 0.34、A100 SXM 1.39、H100 2.69。两组都对,前者是 Secure Cloud,后者是 Community Cloud,同一天查的。账本里 `price_per_hour` 填的是开机那一刻页面上那台机器的价,不用管哪一档;但估算时按 Community 算,因为 W5–W7 全在 Community 上开。

还有一条不算不一致,算补充:RunPod 计费 Day 19 写「按秒」,Day 22 写「每 5 分钟结算」。文档的原意是按秒计量、每 5 分钟从余额里扣一次,两句都对,合起来说才完整。

## 三层保险覆盖矩阵

Day 22 最后那张失效方式表是按层列的,这里换成按失败方式列,一眼看出哪一格是空的。

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="六种失败方式与四道保险的覆盖矩阵:实心圆表示能拦住,空心圆表示有条件拦住,叉表示拦不住">
<text x="12" y="20" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">谁能拦住哪种失败</text>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">
<text x="318" y="52">第一层</text><text x="318" y="64">trap</text>
<text x="408" y="52">第二层</text><text x="408" y="64">看门</text>
<text x="498" y="52">容器外</text><text x="498" y="64">每日检查</text>
<text x="588" y="52">第三层</text><text x="588" y="64">余额</text>
</g>
<line x1="12" y1="74" x2="628" y2="74" stroke="var(--rule)" stroke-width="1"/>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink)">
<text x="12" y="98">任务正常跑完,我不在场</text>
<text x="12" y="134">ssh 手动调试,被叫走(没走 run.sh)</text>
<text x="12" y="170">run.sh 在 trap 注册前就崩了</text>
<text x="12" y="206">开着 ssh 会话去吃饭,两小时没动</text>
<text x="12" y="242">interruptible 被顶掉,stop 状态计磁盘费</text>
<text x="12" y="278">看门程序自己被 OOM 杀,静默死亡</text>
</g>
<g stroke="var(--mem)" stroke-width="1.8" fill="var(--mem)">
<circle cx="318" cy="94" r="6"/><circle cx="408" cy="94" r="6"/><circle cx="498" cy="94" r="6"/>
<circle cx="408" cy="130" r="6"/><circle cx="498" cy="130" r="6"/>
<circle cx="408" cy="166" r="6"/><circle cx="498" cy="166" r="6"/>
<circle cx="498" cy="238" r="6"/>
<circle cx="318" cy="274" r="6" fill="var(--paper-raised)"/><circle cx="498" cy="274" r="6"/>
<circle cx="498" cy="202" r="6" fill="var(--paper-raised)"/>
</g>
<g stroke="var(--compute)" stroke-width="1.8" fill="var(--compute)">
<circle cx="588" cy="94" r="6"/><circle cx="588" cy="130" r="6"/><circle cx="588" cy="166" r="6"/>
<circle cx="588" cy="202" r="6"/><circle cx="588" cy="238" r="6"/><circle cx="588" cy="274" r="6"/>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.6">
<line x1="313" y1="125" x2="323" y2="135"/><line x1="323" y1="125" x2="313" y2="135"/>
<line x1="313" y1="161" x2="323" y2="171"/><line x1="323" y1="161" x2="313" y2="171"/>
<line x1="313" y1="197" x2="323" y2="207"/><line x1="323" y1="197" x2="313" y2="207"/>
<line x1="403" y1="197" x2="413" y2="207"/><line x1="413" y1="197" x2="403" y2="207"/>
<line x1="313" y1="233" x2="323" y2="243"/><line x1="323" y1="233" x2="313" y2="243"/>
<line x1="403" y1="233" x2="413" y2="243"/><line x1="413" y1="233" x2="403" y2="243"/>
<line x1="403" y1="269" x2="413" y2="279"/><line x1="413" y1="269" x2="403" y2="279"/>
</g>
<g font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">
<text x="12" y="312">● 能拦住   ○ 有条件:trap 那格要任务走了 run.sh;每日检查那格要 ssh 会话超过 24 小时才算  ✕ 拦不住</text>
<text x="12" y="328">第二层那两个 ✕ 是设计上的盲区:有 ssh 连接就不杀。改法是 `who -u` 看会话空闲时间,超过 30 分钟不算活跃,被坑一次之后加。</text>
</g>
</svg>
<figcaption>第一层只拦得住第一行,所以它不是主力。第二层拦住前三行但对「开着 ssh」和「容器停了」两种情况是盲的,容器外每日检查补的就是这两格。第三层那一列全是实心,代价是生效一次烧光余额。</figcaption>
</figure>

看这张图的方法:横着看一行,如果只有最后一列是实心,说明这种失败发生时我的损失是整个余额,要么补一道保险,要么接受。第四行「开着 ssh 去吃饭」就是这种情况,现在接受,因为改法只有几行(`who -u` 读会话空闲时间),留到被坑一次再加。第五行「interruptible 被顶掉」在写容器外每日检查之前也是这种情况,所以那个检查要在 W4 上机前写完,不能拖。

## 五道验收题

路线图给 W4 的五道题。前两道是事实题,现在就能答;后三道要真上机才有数,这里写预期值和留空的格子。

**1. spot 被抢占时你会丢什么?怎么让损失最小?**

先纠正题目:2026 年 9 月 RunPod 没有 Spot,能被抢占的只有 Vast 的 interruptible。被更高出价顶掉时实例**暂停**不销毁:GPU 被拿走,进程冻结,显存里的一切(权重、KV cache、正在算的张量)全没;磁盘保留,存储费照收;价格回落后恢复,但 Python 进程以为还在显存里的东西已经不在,大多数情况下报 CUDA 错误退出。

丢的是:显存内容(可重造),以及**上次 push 之后、被顶掉之前产生的结果**(不可重造)。损失最小的办法有三条:一,只把「重跑不心疼」的任务放 interruptible,W5–W7 十几分钟一次的扫描都符合;二,结果边跑边落盘、每完成一个 batch 就 push 一次,不要全部跑完再 push;三,暂停状态超过 30 分钟就销毁,不让它挂着计磁盘费,这条靠容器外每日检查(暂停后容器内的看门程序也停了)。出价比 `min_bid` 高 10%,少被顶几次比省那 10% 划算,因为每次恢复都要重新加载模型。

顺带一句:被顶掉其实是免费的演习。顶掉之后如果我丢的只是「重开一台 bootstrap 两分钟」,Day 20 的持久化决策就做对了;如果丢了半小时结果,说明 `run.sh` 里 push 的频率不够。这个习惯到 M9 训练侧会变成正式课题,叫 checkpoint。

**2. network volume 关机后还计费吗?你最终选了什么方案、为什么?**

计费。RunPod 网络卷不管 Pod 开不开、甚至 Pod 删了都按 0.07 美元/GB/月收,按小时计费;卷盘停机后翻倍到 0.20;Vast 容器盘停机照收且可能更贵。

最终方案是**不开网络卷,每次 delete,每次重下**。三个理由:一,重下 13.5 GB 权重在千兆网上 1 到 2 分钟,和 pip 装依赖并行,几乎不占实际时间,折成 4090 机时不到 3 美分;二,50 GB 卷盘停机一个月 10 美元,占月预算 17% 到 33%,买的只是省那两分钟,还附带「重启可能分到零张 GPU」;三,网络卷把我锁在一个数据中心,那里的 Community 便宜卡缺货时数据在别处用不了,而且创建 Pod 时忘了挂就等于没有。什么时候改主意:M3 之后数据集加多个模型超过 100 GB、每次重下超过十分钟,再开;W7 自己量化出的 AWQ 权重要烧 20 到 40 分钟 GPU 才能重造,那是「不可重造」,推 R2 而不是重量化。

**3. 从零到能跑代码实际要几分钟?卡在哪一步最久?**

现在没有实测,只有预算。按 Day 21 的时间预算,选对镜像(自带 torch)的话:apt 20 秒 + Python 依赖 40 秒 + clone 5 秒 + TinyLlama 下载 20 秒 + smoke test 10 秒,**预期第一次 90 到 150 秒,第二次(幂等)15 到 30 秒**,验收线 300 秒。

最可能卡最久的一步,按概率排:`2a.torch-check` 那行超过 100 秒说明镜像没带 torch,换镜像;`5.model-prefetch` 那行算出下载速率低于 50 MB/s 说明机房到 HuggingFace 慢,Vast 上换房东;`1.apt` 超过 60 秒说明 apt 源慢,砍掉 htop。真实答案是 timing 表那一列最大的数,不是猜的。记录表留在这里,上机填三次看方差:

| 步骤 | 预期 (s) | 第 1 次 | 第 2 次 | 第 3 次 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 0.idle-watch(挪到最前) | 0–1 | | | | |
| 1.apt | 10–30 | | | | |
| 2a.torch-check | 0–2 | | | | 超 100 s = 镜像选错 |
| 3.git | 2–10 | | | | |
| 2b.python-deps | 20–60 | | | | |
| 4.hf-login | 1–3 | | | | |
| 5.model-prefetch | 5–30 | | | | 算 2.2 GB ÷ 秒数 = MB/s |
| 6.smoke | 5–10 | | | | 含 CUDA 初始化,不是性能数据 |
| total | 90–150 | | | | 验收线 300 |

**4. 三层自动销毁分别在什么情况下生效?哪一层最可能失效?**

第一层 trap 在**任务通过 `run.sh` 起并走到退出路径**时生效,正常结束、`set -e` 中断、`exit 1`、ssh 断线导致的 SIGHUP 都算,任务结束后几秒销毁。第二层看门在**实例活着但 GPU 利用率低于 5%、没有 python 进程、没有 ssh 会话**连续 20 分钟时生效,第 15 分钟先推通知。第三层在**前两层全失效、实例跑到余额归零**时由厂商计费系统停机,损失上限等于余额。

最可能失效的是第一层,因为它的前提「任务走了 `run.sh`」在调试阶段大部分时间不成立,我 ssh 进去手敲命令时根本没有 trap;`run.sh` 在 `trap` 那行之前崩、API key 过期、Vast 实例 ID 变量名对不上也都会让它哑掉。所以第二层是主力,第一层的价值只是快。第二层自己的盲区是「开着 ssh 会话去吃饭」和「容器被停后看门程序随之消失」,后者由容器外每日检查补,前者暂时接受。

**5. 这周花了多少钱?花在哪?**

没上机,答案是预期。W4 五天真正要花钱的只有 Day 19 第一次开机和 Day 22 的两次验收,其余全在本机干跑或查文档:

| 项 | 卡 | 时长 | 预期花费 |
| --- | --- | --- | --- |
| Day 19 第一次开机:nvidia-smi、5 秒验货、填记录表 | RTX 4090 Community | 25 分钟 | ≈ 0.15 美元(0.34/时) |
| Day 21 在 CPU pod 上调 bootstrap 前五步 | CPU pod | 1 小时 | ≈ 0.05 美元 |
| Day 21 在 GPU 上跑完整 bootstrap 三次 | RTX 3090 / 4090 | 15 分钟 | ≈ 0.08 美元 |
| Day 22 验收一:跑五分钟任务看实例自己消失 | RTX 3090 / 4090 | 10 分钟 | ≈ 0.06 美元 |
| Day 22 验收二:空转 20 分钟看看门程序销毁 | RTX 3090 / 4090 | 22 分钟 | ≈ 0.12 美元 |
| 存储(容器盘 20 GB + 卷盘 30 GB,合计约 1.5 小时) | | | ≈ 0.01 美元 |
| 合计 | | ≈ 2.2 小时 | **≈ 0.5 美元,不到 1 美元** |

对照一下不做 W4 的代价:4090 忘关一晚 8 小时是 5.9 美元(Secure 档价),A100 忘关一个周末 65 小时是 100 到 160 美元。W4 全周的花费不到一次忘关一晚的十分之一。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="W4 全周预期花费与忘关机一晚、忘关机一个周末的对比条形图">
<text x="12" y="20" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">W4 花的钱 vs W4 防的钱(美元,横条按 4 px = 1 美元,最长一条截断)</text>
<g font-family="var(--font-mono)" font-size="10">
<text x="12" y="62" fill="var(--ink)">W4 全周预期</text>
<rect x="200" y="50" width="2" height="16" fill="var(--mem)"/>
<text x="210" y="63" fill="var(--mem)">≈ 0.5</text>
<text x="12" y="104" fill="var(--ink)">4090 忘关一晚(8 h)</text>
<rect x="200" y="92" width="24" height="16" fill="var(--compute)"/>
<text x="232" y="105" fill="var(--compute)">5.9</text>
<text x="12" y="146" fill="var(--ink)">A100 忘关一个周末(65 h)</text>
<rect x="200" y="134" width="400" height="16" fill="var(--compute)"/>
<line x1="592" y1="130" x2="600" y2="154" stroke="var(--paper-raised)" stroke-width="3"/>
<line x1="598" y1="130" x2="606" y2="154" stroke="var(--paper-raised)" stroke-width="3"/>
<text x="470" y="146" fill="var(--paper-raised)">100 到 160</text>
</g>
<text x="12" y="184" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">第三行是三个月的实验预算。三层保险加起来一个下午加不到 1 美元机时,回报率不用再算。</text>
</svg>
<figcaption>W4 的账要这样看:不是花了多少,是防住了多少。</figcaption>
</figure>

「花在哪」这一问真正的答案是账本。上机之后 `python3 summarize.py 2026-09` 打出来的三张小表就是答案,上面这张预算表只是用来和它对照的。如果实际比预期高出一倍以上,先看是不是某次验收重跑了,再看是不是在 GPU 上想逻辑了。

## 自测:换平台再走一遍

上面五道是路线图的题。再加几道,专门考「换到另一家平台,规则还成立吗」。合上笔记做。

**1. 同一套 bootstrap 搬到 Vast 上,哪四处要改?**

<details><summary>答案</summary>

一,`WORKDIR`:Vast 没有卷盘和 `/workspace` 的约定,开机时 `WORKDIR=/root/work bash bootstrap.sh` 覆盖。二,磁盘大小在创建实例时 `--disk 30` 设够,创建后不能改。三,实例 ID 的环境变量名以 `env | sort` 看到的为准,写进 `common.sh` 的 `destroy_self`。四,脚本上机走 On-start script 字段,不是 RunPod 的 Container Start Command;密钥用 `--env` 传或 scp `.env`,注意 `--env` 会留在本机 shell 历史里。另外 Vast 有流量费,搜索时 `inet_down_cost<0.01` 不能省。

</details>

**2. Vast 上 `dph_total` 0.37、`min_bid` 0.27 的一台 4090,走 on-demand 还是 interruptible?出多少?**

<details><summary>答案</summary>

差 27%,在「差 30% 以上值得出价、10% 以内直接 on-demand」的规则边缘。任务是十几分钟的扫描、结果边跑边 push,可以走 interruptible,出 `min_bid` 上浮 10% 约 0.30 美元;如果是要连续跑一小时以上的量化,直接 on-demand 0.37,省下的几美分抵不过被顶一次重新加载模型的时间。

</details>

**3. RunPod 上一个 Pod 处于 stop 状态过了周末,它扣了什么钱?为什么 Day 22 的看门程序管不到它?**

<details><summary>答案</summary>

卷盘按停机费率 0.20 美元/GB/月扣,30 GB 三天约 0.06 美元,不多但一直扣;容器盘已清空不扣;如果挂了网络卷再加 0.07/GB/月。看门程序在容器里,stop 时容器被丢掉,看门程序随之消失,所以第二层对 stop 状态是盲的。管它的是容器外每日检查(列出 stop 超 24 小时的实例销毁),兜底的是第三层余额。

</details>

**4. `run.sh` 的 trap 里如果先销毁再 push,会发生什么?如果 push 失败呢?**

<details><summary>答案</summary>

先销毁,容器一没,后面的 push 永远不会执行,实验结果随实例消失,这是整个脚本里后果最重的一个错。顺序永远是推结果 → 通知 → 销毁。push 失败时如果只打一行日志继续往下走,**脚本会照样销毁**,结果丢了,这是我第一版 `on_exit` 的写法。正确的写法是 push 失败就置 `KEEP_ALIVE=1` 跳过销毁、发通知、留给我手动处理,Day 20 那句「同步成功是销毁的硬前置条件」说的就是这个。Day 22 里的 `on_exit` 已经改成了这个版本,多付几小时机时,换结果不丢。

</details>

**5. 看门程序三个条件里,为什么读不到 GPU 利用率时要当作 100 而不是 0?**

<details><summary>答案</summary>

nvidia-smi 偶尔超时或挂掉时,我不知道 GPU 在不在忙。当作 0 会累加空闲计数,20 分钟后杀掉一个可能正在跑的任务;当作 100 只是多等 20 分钟。错杀的代价是一次实验重跑,多等的代价是 20 分钟机时,前者贵得多。同理看门程序不开 `set -e`,任何一次检查失败都不能让它自己退出。

</details>

**6. A100 SXM 1.39 美元/时和 RTX 4090 0.34 美元/时,跑 7B fp16 各是多少 $/1M token?哪张卡「便宜」?**

<details><summary>答案</summary>

A100:150 tok/s × 3600 = 0.54M tok/h,1.39 ÷ 0.54 ≈ 2.57 美元。4090:13.5 GB ÷ 1008 GB/s ≈ 13.4 ms,约 75 tok/s,0.27M tok/h,0.34 ÷ 0.27 ≈ 1.26 美元。4090 每百万 token 便宜一半,但每个 token 慢一倍。$/1M token 是「每美元买到多少 token」,不是「多快」,产出物 01 两个数都要给。

</details>

## 错题本

W4 的错和 W1 到 W3 性质不同:前三周错在形状、单位、异步,这周错在**以为**。以为 stop 了不花钱,以为账单页就是看板,以为这次一定记得关。按五篇的常见误区汇总,分四类。

### 计费类:以为不花钱的地方在花钱

| 错 | 实际 | 出处 |
| --- | --- | --- |
| stop 了就不花钱 | 卷盘停机费率翻倍到 0.20 美元/GB/月;Vast 容器盘停机照收且可能更贵;RunPod 停机 Pod 重启可能分到零张 GPU | Day 19、20、22 |
| 网络卷「便宜又永久」 | 0.07 美元/GB/月不管开不开机,锁数据中心,创建时必须挂上;现在的数据量重下只要两分钟 | Day 20 |
| 只比 GPU 小时价 | Vast 房东流量费差 15 倍(0.0026 vs 0.039 美元/GB),下 174 GB 模型流量费是 GPU 费四倍的账单真实存在 | Day 20 |
| 200 Mbps 下行「够快」 | Mbps 除以 8 才是字节,25 MB/s,13.5 GB 要 9 分钟不是 1 分钟 | Day 20 |
| 账单页就是看板 | 账单页没有实验名和结论,回答不了「花在哪个实验」「值不值」 | Day 23 |
| 记录留在实例上 | 销毁后容器盘就没了,账本必须在销毁 API 之前 push | Day 23 |

### 纪律类:以为靠记性

| 错 | 实际 | 出处 |
| --- | --- | --- |
| 「这次一定记得关」 | 忘关不是粗心,是去睡觉、被叫走、ssh 断了以为任务死了的正常状态;靠记性的方案失败是确定的,只是时间未定 | Day 22 |
| 绑卡开 auto-pay | 余额永远不归零,第三层作废,损失上界从余额变成银行卡额度 | Day 19、22 |
| 在按秒计费的机器上想逻辑 | 脚本在本机 `bash -n` + shellcheck + `DRY_RUN=1` 干跑完再上机;调脚本用几美分的 CPU pod | Day 21、22 |
| 第一层跑通就够了 | 第一层依赖任务走了 `run.sh`,调试时大部分不满足;第二层才是主力 | Day 22 |
| 验收在脑子里过 | 不故意触发一次,不知道通知能不能到、API 能不能通、顺序对不对;两次验收不到 1 美元 | Day 22 |

### 脚本类:以为跑一次就够

| 错 | 实际 | 出处 |
| --- | --- | --- |
| 脚本不幂等 | 中途断线重跑、stop/resume 再跑、第二天接着用,三种场景都会让不幂等的脚本报错或重装;测法是连跑两次比 timing | Day 21 |
| 镜像随便选「反正脚本会装」 | 装 torch 2 到 5 分钟、2.5 GB,一项吃光 5 分钟预算;镜像选择是整个脚本里最重要的决定,而它不在脚本里 | Day 21 |
| `requirements.txt` 不写版本 | 今天和下周装的不是同一个 transformers,W3 的数字就不能和 W2 比 | Day 21 |
| 替换官方 template 的启动命令 | 它负责起 ssh 和 Jupyter,替换掉就进不去了;要追加 | Day 21 |
| 无人值守不留日志 | 路径 C 没人看着终端,`exec > >(tee -a LOG) 2>&1`,进去先 `tail` | Day 21 |
| 长任务直接在 ssh 里跑 | SIGHUP 连带杀掉,钱照扣;超过一分钟进 tmux | Day 19、21 |
| 看门程序开 `set -e` | 一次 nvidia-smi 超时就让它自己退出,第二层静默消失 | Day 22 |
| trap 里先销毁再 push | 容器一没后面的命令永远不执行,结果随实例消失 | Day 22 |
| 只看 GPU 利用率判空闲 | 下载模型、装包阶段利用率是 0 但任务在跑;加 python 进程和 ssh 会话两个条件 | Day 22 |

### 安全类:以为「先跑通再说」

| 错 | 实际 | 出处 |
| --- | --- | --- |
| token 写进脚本先跑通 | 跑通就忘了,然后 push 出去;token 只从环境变量读,pre-commit hook 拦 `hf_` / `rpa_` / `sk-` 兜底 | Day 20、21 |
| 私人 SSH 私钥拷进租来的机器 | 机器是别人的,Vast 上是某位房东的;拉代码用 deploy key 或带 token 的 https | Day 20 |
| 脚本里 `echo $HF_TOKEN` 或 `set -x` 跑过 source | 日志进 tmux 回滚缓冲、进记录,一次打印等于一次泄露 | Day 20 |
| 不需要 Jupyter 也开着端口 | 公网 ip 开着 Jupyter 等于开着门;部署时取消勾选 | Day 19 |

W1 到 W3 的错是「不知道」,读一遍就补上;W4 的错是「知道但会忘」。所以 W4 的治法不是记住,是把每一条变成脚本里的一行、控制台里的一个开关、或者 pre-commit 里的一个正则。清单那一节每个勾后面括号里的出处,就是这张错题本的另一种排法。

## 学习方法反思

W4 和前三周最大的不同是没有「算出数字就是过」这条硬标准。工程活的验收容易变成「我觉得差不多了」。这周的做法是把路线图那句「一条命令起环境,跑完自动销毁」拆成能打勾的清单,每一项都要么对应一个能跑的脚本,要么对应一条能核对的文档原文。写清单的时候发现三处口径不一致,这是复习真正的收益:五天各写各的,不回头看不会发现账本路径有三个版本。

另一件事是**诚实标注预期和实测**。这周五篇全是纸上工程,所有「几分钟」「多少钱」都是算的不是测的。把它们写成预期值加留空表,比写成「我测到 120 秒」诚实,也比空着不写有用,因为上机那天就知道该填哪一格、和什么比。这条规则 W2、W3 已经在用,W4 一样。

还有一条是**用自己已经会的东西做锚点**。第二层看门程序是「cron 读一个指标、低于阈值 N 分钟推一条通知」,这和我给 BTC 信号做的那套 CF Worker 是同一个骨架;心跳(dead man's switch)也是那个 Worker 加一个 KV 键。Day 0 说的「用已经懂的东西做锚点」在 W1 是 matmul 和显存,在 W4 是 cron 和 webhook。新东西没有想象中那么多。

## 全周名词总表

| 名词 | 一句话 | 首次出现 |
| --- | --- | --- |
| on-demand / interruptible | 独占不打断 vs 出价制可暂停。RunPod 2026-09 已无 Spot | Day 19 |
| Secure / Community Cloud | RunPod 两档机器来源,后者便宜两三成 | Day 19 |
| `dph_total` / `min_bid` / `reliability` / `inet_down` | Vast offer 的四个关键字段:总价、最低出价、房东在线率、下行带宽 | Day 19 |
| Container Disk / Volume Disk / Network Volume | RunPod 三种盘:stop 即清空 / stop 保留费率翻倍 / 独立于 Pod 锁数据中心 | Day 19、20 |
| 镜像 / 可写层 | 容器启动自的只读分层快照和叠在其上的一层;容器盘就是可写层 | Day 20 |
| `HF_HOME` / blobs / snapshots / refs | HF 缓存根目录和它的三层结构 | Day 20 |
| `hf download` / `hf_xet` | huggingface_hub 命令行下载和当前的加速后端;`hf_transfer` 已弃用 | Day 20 |
| 对象存储 / Cloudflare R2 / rclone | 按 GB 收费的文件服务;R2 出站免费 10 GB 内免费;rclone 统一操作各家 | Day 20 |
| deploy key | 只对一个仓库有效的只读密钥,放租来的机器上 | Day 20 |
| bootstrap / 幂等 | 从零到能跑的引导脚本;跑一次和跑十次结果一样 | Day 21 |
| `set -euo pipefail` | 出错即停、未定义变量即停、管道任一段失败即失败 | Day 21 |
| runtime / devel 镜像 | 只有运行时库 vs 多带 nvcc;M5 写 kernel 才要 devel | Day 21 |
| 驱动 ≥ runtime = wheel | GPU 侧三层版本规则;nvidia-smi 右上角是驱动上限不是已装版本 | Day 19、21 |
| uv / `--system` | 快的 Python 包管理器;装到系统 Python 不建虚拟环境 | Day 21 |
| `exec > >(tee -a LOG) 2>&1` | 之后所有输出同时进屏幕和文件 | Day 21 |
| tmux / SIGHUP / nohup | 会话管理器;终端断开时的信号;忽略该信号 | Day 19、21、22 |
| `trap CMD EXIT` / `$?` | 退出时执行;退出码要在 trap 函数第一行取 | Day 22 |
| `RUNPOD_POD_ID` / `podTerminate` | RunPod 注入的实例 ID;GraphQL 销毁 mutation | Day 22 |
| utilization.gpu | 采样窗口内有 kernel 在跑的时间比例,测忙不忙不测算力 | Day 5、19、22 |
| dead man's switch | 定期报平安,平安消失才告警;抓看门程序静默死亡 | Day 22 |
| `DRY_RUN` / `KEEP_ALIVE` | 本机干跑开关 / 调试时跳过销毁的逃生口 | Day 22 |
| low balance alert / auto-pay / spend limit | 低余额邮件;自动扣卡充值(不开);默认 80 美元/时上限(用不到) | Day 22 |
| ledger / `$/1M token` | 一次开机一行的账本;小时价 × 1e6 ÷ (tok/s × 3600) | Day 23 |
| 实际均价 | 某卡总花费 ÷ 总开机小时,含 bootstrap 和下载的不产出时间 | Day 23 |
| MiB vs GB / Mbps vs MB/s | 1024 进制 vs 1000 进制;比特 vs 字节差 8 倍 | Day 2、19、20 |

## 全周参考资料汇总

文档,全部 2026 年 9 月核对过可达:

- RunPod 价格页 https://www.runpod.io/pricing ,Pod 计费 https://docs.runpod.io/pods/pricing ,存储类型 https://docs.runpod.io/pods/storage/types ,管理 Pod(stop 后卷盘计费、重启可能零 GPU)https://docs.runpod.io/pods/manage-pods 。
- RunPod 账单总览(每 5 分钟结算、余额归零行为、低余额告警、auto-pay、80 美元/时上限)https://docs.runpod.io/accounts-billing/billing 。
- RunPod Pod 环境变量(`RUNPOD_POD_ID`、`RUNPOD_SECRET_*`)https://docs.runpod.io/pods/references/environment-variables ;GraphQL 管理 Pod(`podStop` / `podResume`,`podTerminate` 字段以此页为准)https://docs.runpod.io/sdks/graphql/manage-pods 。
- Vast.ai 租用类型与定价 https://docs.vast.ai/instances/rental-types ,存储 https://docs.vast.ai/instances/storage ,CLI https://docs.vast.ai/cli ,CLI 源码(所有子命令在 `vast.py`)https://github.com/vast-ai/vast-cli 。
- Hugging Face 缓存管理 https://huggingface.co/docs/huggingface_hub/guides/manage-cache ,环境变量 https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables 。
- Cloudflare R2 价格(10 GB 免费、出站免费)https://developers.cloudflare.com/r2/pricing/ ;rclone https://rclone.org/ 。
- nvidia-smi 文档 https://docs.nvidia.com/deploy/nvidia-smi/index.html 。
- uv 文档 https://docs.astral.sh/uv/ ;shellcheck https://www.shellcheck.net/ ;tmux wiki https://github.com/tmux/tmux/wiki ;GNU Bash 手册(`set`、`trap`)https://www.gnu.org/software/bash/manual/bash.html 。

视频,两段选的都是「一次看全流程」的对照:

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/3YX6Y-sJw1g" title="Runpod vs Vast ai Which Is Better??" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LearnBase · Runpod vs Vast ai Which Is Better?? · 两家平台的界面和定价并排走一遍,看的时候对照本文「两家平台」那张表,注意它讲的价格是录制时的,规则才是要记的。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BHhA_ZKjyxo" title="Basic tmux Tutorial - Windows, Panes, and Sessions over SSH" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>tutoriaLinux · Basic tmux Tutorial - Windows, Panes, and Sessions over SSH · W4 里出现最多次的工具。看会话、窗格、脱离和接回四个动作就够,Day 19 的「一个窗格跑实验、一个窗格挂 nvidia-smi dmon」就是它的用法。</figcaption>
</figure>

- 攒钱换房车的福叔,《Runpod 设置完整教程 – 在云端运行大型AI模型!》,B 站 `BV1YGsDzCE35`,28 分钟中文版,Day 19 已嵌入。
- Day 21、22、23 嵌入过的 RunPod 官方 CPU pod 教程、Vast 官方 Quickstart、trap 教学、nvidia-smi 监控视频,不重复列。

## 下周预告:M1 加餐周

W1 到 W4 走完,路线图里 M1 的四周任务结束了。但离 M2 开始还有六天,而且这四周里有几个词一直在用却没有真正讲过:SM、tensor core、bf16、warp、dense 和 sparse。W2 在 T4 上撞到「不支持 bf16」时只知道绕开,W3 测算力时只知道「要走 fp16 tensor core 才对得上 65 TFLOPS」,W4 选卡时只会比带宽。这些地方现在都是黑盒,M2 开始碰 KV cache 实测、量化、continuous batching,黑盒会越来越碍事。所以 M1 最后六天补硬件和数值的地基,顺序是从硅片到规格表再到市场:

| Day | 标题 | 补的是哪个黑盒 |
| --- | --- | --- |
| 25 | GPU 解剖:SM、tensor core、寄存器/shared/L2/HBM 到底是什么 | Day 5 说「权重装不进片上」、Day 13 测带宽层次时那张没展开的图 |
| 26 | 数值格式:fp32/tf32/fp16/bf16/fp8/int8/int4 各占几位、差在哪 | T4 为什么不支持 bf16;量化省字节为什么直接换来 decode 速度 |
| 27 | CUDA 执行模型:kernel、grid、block、warp、stream 与 launch 开销 | Day 11 timeline 上的 gap 背后是什么;为 M5 Triton 铺路 |
| 28 | 怎么读一张 GPU 规格表:dense 与 sparse、SXM 与 PCIe、NVLink 与 $/token | Day 14 的 312 vs 624 陷阱;Day 19 选卡表里那些数字从哪来 |
| 29 | 2026-09 市场校准:JD 里要什么,路线图哪里要加勾 | 学了四周,对照一下招聘方到底要什么,路线图加六个勾 |
| 30 | M1 总复习:一页笔记、20 道全月自测、错题本汇总与 M2 预告 | 把 W1 的数字、W2 的计时、W3 的实测、W4 的环境、加餐周的硬件压成一页 |

加餐周和 W4 一样零成本,全是纸笔和文档。它不在路线图原本的 M1 里,是我自己加的,理由只有一个:M2 的每一个实验都要在一张真实的卡上跑,而我到现在还说不清那张卡里面有什么。

W4 一行 GPU 代码没写,但从下周开始,每次开机都不用再想任何事了。
