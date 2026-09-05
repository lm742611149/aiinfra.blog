---
title: 'Day 21 · bootstrap 脚本：从零到能跑代码 5 分钟'
description: '把「开机之后手工装环境」这件事变成一个幂等的脚本：装依赖、拉代码、配 token、预热模型、打印 nvidia-smi。每一步都计时，找出最慢的那一步。验收标准只有一条：从实例启动到能跑第一行 GPU 代码，全自动，不超过 5 分钟。'
pubDate: 2026-09-05
regime: none
tags: ['runpod', 'vast', 'bootstrap', 'bash', 'environment', 'aiinfra-365']
series: 'aiinfra-365'
day: 21
lang: 'zh'
---

## 今天要解决的问题

昨天(Day 20)定下了「什么放哪」:代码进 git,数据每次重下,结果推出去,实例本身随时可以死。今天解决的是这条规则的另一半:实例死了之后,**怎么在几分钟之内把一个能跑代码的环境重新变出来**,而且每次变出来的都一样。

为什么这件事值得花一天。两个原因,一个是钱,一个是数字。

钱的那一半很直接。GPU 实例按秒计费,从开机那一刻起就在扣。如果每次开机之后我要花 15 到 20 分钟手工 `pip install`、`git clone`、找 token、下模型,这 15 分钟里 GPU 一个 kernel 都没跑,钱照扣。按 Day 19 查到的价格口径,A100 80GB 每小时大约 1.5 到 2.5 美元,15 分钟就是 0.4 到 0.6 美元。一周开三次,一个月 5 美元左右。看起来不多,但月预算是 30 到 60 美元,这是白扔掉 10% 到 15%。

数字的那一半更要命。W3 整周都在强调一件事:前后两次测量必须在同一个环境下,不然数字不可比。手工装环境做不到这一点。今天 `pip install torch` 装到 2.4,下周装到 2.5,cuBLAS 的 kernel 选择变了,matmul 打到的算力就变了,然后我会以为是自己的代码有问题。**环境必须是版本锁死、可复现的,这只有脚本做得到。**

今天结束时要交出的东西:

1. 一个 `bootstrap.sh`,在一台刚启动的 RunPod 或 Vast 实例上一行命令跑起来,结束后能直接 `python run.py`。
2. 脚本里每一步都有耗时记录,能指出哪一步最慢、为什么。
3. 连跑两次不出错,第二次几乎不花时间。这叫幂等,下面会讲为什么必须幂等。
4. **验收:从实例进入 running 状态到 `torch.cuda.is_available()` 返回 True,全自动,不超过 5 分钟。**

## 5 分钟花在哪:先做时间预算

写脚本之前先算一遍,5 分钟够不够,每一步大概多久。不算这一步的话,写出来发现要 12 分钟,再回头找原因,就是在按小时计费的机器上想逻辑,Day 0 的成本纪律明说过不许这么干。

| 步骤 | 预期耗时 | 依据 | 能不能省 |
| --- | --- | --- | --- |
| 镜像拉取和容器启动 | 30 秒到 2 分钟 | 云厂商侧,不算在我的 5 分钟里,但它决定了我能不能少装东西 | 选厂商已缓存的官方 PyTorch 镜像,拉取快 |
| apt 装系统工具(git、tmux、htop) | 10 到 30 秒 | 几个小包,取决于镜像源 | 官方镜像通常带 git,只补缺的 |
| 装 PyTorch | 0 秒 或 2 到 5 分钟 | torch + CUDA 依赖约 2.5 GB,pip 下载加解压 | **这是最大的一笔,只有一个省法:选自带 torch 的镜像,一行都不装** |
| 装 transformers、accelerate 等 | 20 到 60 秒 | 纯 Python 包,几十 MB | 用 uv 代替 pip,解析和安装快几倍 |
| git clone 我的代码 | 2 到 10 秒 | 仓库几 MB | 没必要省 |
| 预热下载模型权重 | 看模型大小 | TinyLlama 2.2 GB;7B fp16 13.5 GB | 下面单算 |
| 打印 nvidia-smi、跑 smoke test | 5 到 10 秒 | CUDA context 初始化 | 不省,它是验收 |

模型下载单算一下。云厂商机房到 HuggingFace 的下载速度,一般在 100 MB/s 到 500 MB/s 之间,差别很大,看机房和时段。

```
TinyLlama 2.2 GB ÷ 100 MB/s = 22 s      ÷ 500 MB/s ≈ 4.5 s
Llama-2-7B fp16 13.5 GB ÷ 100 MB/s = 135 s ≈ 2.3 min   ÷ 500 MB/s = 27 s
```

所以 W2 和 W3 用 TinyLlama 时,模型下载不是瓶颈。等 M2 W7 开始碰 7B 量化模型,13.5 GB 在慢机房上要两分多钟,这时候 Day 20 说的 network volume 才开始值回票价,否则每次开机就要吃掉预算里的两分钟。这个判断留到那时候再做,现在按重下算。

把表加起来:选对镜像的话,apt 20 秒 + Python 包 40 秒 + clone 5 秒 + TinyLlama 下载 20 秒 + smoke test 10 秒,**约 1.5 到 2 分钟**,离 5 分钟有一倍余量。选错镜像多装一次 torch,直接变 5 到 7 分钟,验收不过。所以整个脚本最重要的决策其实不在脚本里,是**镜像选择**。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="bootstrap 脚本的步骤流程与时间预算条形图">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">bootstrap.sh 时间预算(选自带 torch 的镜像)</text>
  <line x1="150" y1="40" x2="150" y2="250" stroke="var(--rule)" stroke-width="1"/>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
    <text x="20" y="62">① apt 系统工具</text>
    <text x="20" y="97">② 装 Python 包</text>
    <text x="20" y="132">③ git clone</text>
    <text x="20" y="167">④ 预热模型下载</text>
    <text x="20" y="202">⑤ smoke test</text>
    <text x="20" y="237">(选错镜像)装 torch</text>
  </g>
  <g>
    <rect x="152" y="50" width="40" height="18" fill="var(--mem)"/>
    <text x="198" y="63" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">~20 s</text>
    <rect x="152" y="85" width="80" height="18" fill="var(--mem)"/>
    <text x="238" y="98" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">~40 s</text>
    <rect x="152" y="120" width="10" height="18" fill="var(--mem)"/>
    <text x="168" y="133" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">~5 s</text>
    <rect x="152" y="155" width="44" height="18" fill="var(--mem)"/>
    <text x="202" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">~22 s(TinyLlama 2.2 GB @ 100 MB/s)</text>
    <rect x="152" y="190" width="20" height="18" fill="var(--mem)"/>
    <text x="178" y="203" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">~10 s</text>
    <rect x="152" y="225" width="440" height="18" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1"/>
    <text x="300" y="238" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">2–5 min,一项就吃光预算</text>
  </g>
  <line x1="152" y1="258" x2="592" y2="258" stroke="var(--rule)" stroke-width="1"/>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="152" y="272">0</text>
    <text x="352" y="272">100 s</text>
    <text x="552" y="272">220 s</text>
  </g>
  <text x="20" y="292" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">比例尺 2 px = 1 s。合计约 100 s,5 分钟上限有一倍余量。</text>
</svg>
<figcaption>五步加起来大约一分半到两分钟,前提是镜像自带 PyTorch。最下面那条是选错镜像的代价:光装 torch 就把 5 分钟预算吃光。脚本里最重要的决策不在脚本里,在镜像选择。</figcaption>
</figure>

## 选镜像:唯一一个不能靠脚本弥补的决定

RunPod 和 Vast 都让你在开实例时选一个 Docker 镜像。原则只有一条:**选官方 PyTorch 镜像,带 CUDA runtime 的那种,版本和我本地要求的一致。**

Docker Hub 上 `pytorch/pytorch` 的 tag 长这样:`2.5.1-cuda12.4-cudnn9-runtime`。三段信息:torch 版本、CUDA 版本、runtime 还是 devel。M1 到 M4 只跑推理和 profiler,`runtime` 够用,体积小一半;到 M5 写 Triton kernel 需要 nvcc 编译时再换 `devel`。

两家的差别在哪里能选:

- **RunPod** 叫 template。官方提供了一批预装 PyTorch 的 template,选它们的好处是镜像已经在机房缓存,拉取几十秒。也可以填任意 Docker Hub 镜像名,但第一次拉要等。Template 里还能填「Container Start Command」和环境变量,后面用它来自动执行 bootstrap。
- **Vast** 叫 template 或直接填 image。它多一个 **On-start script** 字段,实例起来之后自动执行,正好是放 bootstrap 的地方。

两个坑现在写下来:

1. **CUDA 版本要和卡的驱动匹配。** 镜像里的 CUDA runtime 版本不能高于宿主机驱动支持的版本。Vast 的机器五花八门,有的驱动旧,选 CUDA 12.4 的镜像可能起不来。Vast 搜实例时可以按 `cuda_vers >= 12.4` 过滤,RunPod 官方 template 不用操心。
2. **别选带 Jupyter 的「全家桶」镜像当默认。** 它们体积大、启动慢、预装的包版本不受我控制。需要 notebook 的时候在脚本里装一行 `jupyterlab` 就行。

## 版本锁:驱动、CUDA runtime、torch wheel 三层怎么对上

`requirements.txt` 钉死了 Python 包,但 GPU 这边还有三层版本,任何一层错位脚本都会在 smoke test 上死。第一次遇到时我分不清它们,现在按从下到上的顺序摆清楚:

| 层 | 是什么 | 谁决定 | 怎么看 |
| --- | --- | --- | --- |
| 驱动(driver) | 装在宿主机内核里的 NVIDIA 驱动,容器共用宿主机的 | 云厂商的那台物理机 | `nvidia-smi` 左上角 `Driver Version` |
| CUDA runtime | 镜像里的 CUDA 库(libcudart、cuBLAS 等) | 我选的 Docker 镜像 tag,如 `cuda12.4` | `python -c 'import torch;print(torch.version.cuda)'` |
| torch wheel | PyTorch 编译时链接的 CUDA 版本 | `pip install` 时的 index URL,如 `/whl/cu124` | 同上,torch 报的就是它编译用的版本 |

规则只有一条:**驱动支持的 CUDA 版本 ≥ runtime 版本 = torch wheel 版本。** 驱动向下兼容,新驱动能跑旧 runtime;反过来旧驱动跑新 runtime 会在第一次 CUDA 调用时报 `CUDA driver version is insufficient for CUDA runtime version`。官方 `pytorch/pytorch:2.5.1-cuda12.4-*` 镜像已经把后两层配成一对,我只要保证第一层够新,这就是上面说 Vast 搜实例要按 `cuda_vers >= 12.4` 过滤的原因。

一个我第一次就搞错的地方:`nvidia-smi` 右上角显示的 `CUDA Version: 12.6` **不是**「这台机器装了 CUDA 12.6」,而是「这个驱动最高支持到 12.6」。容器里的 runtime 可以是 12.4,两个数不一致完全正常。真正在用的 CUDA 版本看 `torch.version.cuda`。

脚本在 smoke test 之前把三层一起打出来,验收不过时先看这三行:

```bash
nvidia-smi --query-gpu=driver_version --format=csv,noheader
python -c 'import torch; print("torch", torch.__version__, "| built with CUDA", torch.version.cuda, "| cudnn", torch.backends.cudnn.version())'
```

Python 包这一层的锁法再加一道:`requirements.txt` 是我手写的「想要什么」,`uv pip freeze > requirements.lock` 是机器吐出的「实际装了什么」,包括所有间接依赖。每次 bootstrap 成功后把 lock 文件和 timing 一起留档(不进仓库主分支,放 results 目录随结果提交)。W3 那种「上周 90% 这周 82%」的数字漂移,先 `diff` 两次的 lock 文件,再怪代码。

## 脚本本体

下面是完整的 `bootstrap.sh`。放在我自己的 git 仓库根目录,和实验代码在一起。逐段解释在脚本后面。

```bash
#!/usr/bin/env bash
# bootstrap.sh —— 在一台刚启动的 GPU 实例上,从零到能跑代码。
# 用法(实例内):  curl -fsSL https://raw.githubusercontent.com/<me>/<repo>/main/bootstrap.sh | bash
# 或已 clone 后:  bash bootstrap.sh
# 依赖的环境变量(在云厂商控制台以 secret 形式注入,绝不写进本文件):
#   HF_TOKEN   HuggingFace 读 token(只在下 gated 模型时需要)
#   REPO_URL   我的实验仓库,默认见下
set -euo pipefail

# ---------- 0. 常量与计时 ----------
WORKDIR="${WORKDIR:-/workspace}"            # RunPod 默认持久盘挂在 /workspace;Vast 也可挂到这里
REPO_URL="${REPO_URL:-https://github.com/<me>/aiinfra-lab.git}"
REPO_DIR="$WORKDIR/aiinfra-lab"
export HF_HOME="${HF_HOME:-$WORKDIR/hf-cache}" # 模型缓存放持久盘;没挂盘就是容器盘,重下也无妨
TIMING_CSV="$WORKDIR/bootstrap-timing.csv"
MODEL_ID="${MODEL_ID:-TinyLlama/TinyLlama-1.1B-Chat-v1.0}"

mkdir -p "$WORKDIR" "$HF_HOME"
T0=$(date +%s)
STEP_T=$T0
step() {                                     # 每一步结束时调用:打印并追加到 CSV
  local now; now=$(date +%s)
  printf '%-28s %4d s\n' "$1" $((now - STEP_T))
  printf '%s,%s,%d\n' "$(date -u +%FT%TZ)" "$1" $((now - STEP_T)) >> "$TIMING_CSV"
  STEP_T=$now
}
have() { command -v "$1" >/dev/null 2>&1; }

echo "== bootstrap on $(hostname)  $(date -u +%FT%TZ)"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader || echo "!! nvidia-smi 不可用"

# ---------- 1. 系统工具(幂等:已装的跳过) ----------
PKGS=()
for p in git tmux htop curl; do have "$p" || PKGS+=("$p"); done
if ((${#PKGS[@]})); then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq --no-install-recommends "${PKGS[@]}" >/dev/null
fi
step "1.apt"

# ---------- 2. Python 依赖(uv 比 pip 快;版本全部锁死在 requirements.txt) ----------
have uv || curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null
export PATH="$HOME/.local/bin:$PATH"
if ! python -c 'import torch' 2>/dev/null; then
  echo "!! 镜像没带 torch,这一步会多花 2–5 分钟。下次换 pytorch/pytorch:*-runtime 镜像。"
  uv pip install --system --quiet "torch==2.5.1" --index-url https://download.pytorch.org/whl/cu124
fi
step "2a.torch-check"

# ---------- 3. 拉代码(幂等:存在则 pull) ----------
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" pull -q --ff-only
else
  git clone -q --depth 1 "$REPO_URL" "$REPO_DIR"
fi
step "3.git"

uv pip install --system --quiet -r "$REPO_DIR/requirements.txt"
step "2b.python-deps"

# ---------- 4. HF token:只从环境变量读,只写到 HF 自己的配置位置 ----------
if [ -n "${HF_TOKEN:-}" ]; then
  python - <<'PY'
import os
from huggingface_hub import login
login(token=os.environ["HF_TOKEN"], add_to_git_credential=False)
PY
fi
step "4.hf-login"

# ---------- 5. 预热模型下载(幂等:HF 自带缓存,已有的文件秒过) ----------
python - <<PY
from huggingface_hub import snapshot_download
p = snapshot_download("$MODEL_ID", allow_patterns=["*.json", "*.safetensors", "tokenizer*"])
print("model at", p)
PY
step "5.model-prefetch"

# ---------- 6. smoke test:验收就看这一行 ----------
python - <<'PY'
import torch, time
assert torch.cuda.is_available(), "CUDA 不可用"
t = time.perf_counter()
x = torch.randn(4096, 4096, device="cuda", dtype=torch.float16)
y = x @ x
torch.cuda.synchronize()
print(f"cuda ok: {torch.cuda.get_device_name(0)}  torch {torch.__version__}  "
      f"matmul 4096² fp16 {1e3*(time.perf_counter()-t):.1f} ms (含首次初始化)")
PY
step "6.smoke"

echo "== total $(( $(date +%s) - T0 )) s   timing -> $TIMING_CSV"
```

配套的 `requirements.txt`,版本必须钉死:

```text
transformers==4.46.3
accelerate==1.1.1
huggingface_hub==0.26.2
safetensors==0.4.5
```

版本号本身不重要,重要的是**有版本号**。写这篇的时候这几个是当前稳定版;以后升级时改这个文件、提交、在文章里记一笔「从哪天起数字口径换了」。W3 说过的那句话在这里落地:数字不可比的原因之一就是环境漂移。

### 逐段说明

**`set -euo pipefail`**。`-e` 任何一条命令失败就停,`-u` 用到未定义变量就停,`pipefail` 管道里任何一段失败整条算失败。三个都开,脚本才会在出错的那一行停下,而不是带着坏状态跑到最后打印一句「done」。

**`step` 函数**。每一步结束调一次,打印这一步用了几秒,并且追加一行到 CSV。这就是路线图里说的「用 `time` 计每一步耗时找最慢一步」,只是不用 `time` 命令,因为我要的是跨步骤的表,不是单条命令的三个时间。CSV 三列:UTC 时间、步骤名、秒数。以后 Day 23 的成本看板直接读它。

**`have` 函数**。`command -v` 查一个命令存不存在,存在就跳过安装。这是幂等的第一个手段。

**第 1 步 apt**。只装缺的。官方镜像大多带 git,所以通常只装 tmux、htop 两个小包,十几秒。`--no-install-recommends` 不拖推荐包,`DEBIAN_FRONTEND=noninteractive` 防止某个包弹交互框卡住整个脚本,这个坑在无人值守的启动脚本里非常常见。

**第 2 步 uv 和 torch 检查**。uv 是 Astral 出的 Python 包管理器,解析依赖和装包比 pip 快很多,一条 curl 装好。`--system` 表示装到系统 Python 而不是建虚拟环境,容器里就一个 Python,没必要多一层。然后**检查 torch 在不在**,在就一秒跳过,不在就打一行警告再装,并且告诉自己下次换镜像。这个警告是给未来的我看的:验收不过的时候,timing 表里 `2a.torch-check` 那一行会是 200 多秒,原因一眼可见。

**第 3 步 git**。`.git` 目录存在就 `pull --ff-only`,不存在就 `clone --depth 1`。`--depth 1` 只拉最新一次提交,几 MB 的仓库无所谓,但习惯要养成。`--ff-only` 保证不会在实例上产生合并提交,实例上的仓库只读不写,写的动作在本地做。

**第 4 步 HF token**。`login()` 把 token 写到 `~/.cache/huggingface/token`,这是 HuggingFace 库自己找 token 的位置。`add_to_git_credential=False` 是防止它顺手把 token 塞进 git 凭据存储,那样 `git push` 时可能带出去。**token 只从环境变量来**,环境变量由云厂商控制台注入,RunPod 叫 Secrets(注入后以 `RUNPOD_SECRET_` 前缀出现,脚本里要么按那个名字读,要么在 template 里映射成 `HF_TOKEN`),Vast 在 template 的环境变量栏填。脚本文件和仓库里永远没有 token 的明文。TinyLlama 不是 gated 模型,没 token 也能下,所以这一步整个用 `if` 包起来,没 token 就跳过。

**第 5 步预热下载**。`snapshot_download` 把模型拉进 `HF_HOME`。用 `allow_patterns` 只要 safetensors 和配置,跳过 `.bin`、`.h5` 等重复格式,能省一半流量。HuggingFace 的缓存自带去重,第二次运行时文件已在,几乎零耗时,这是幂等的第二个手段,不用我自己写判断。`HF_HOME` 指到 `/workspace` 下,如果 Day 20 决定挂 network volume,把 volume 挂到 `/workspace`,模型就跨实例存活;没挂就是容器盘,实例销毁跟着没,下次重下,也符合 Day 20 的决定。

**第 6 步 smoke test**。`torch.cuda.is_available()` 是验收的唯一判据。顺手乘一个 4096 方阵并 `synchronize()`,打印耗时,这个数会含 CUDA context 初始化和 cuBLAS 第一次选 kernel 的开销(Day 7、Day 8 讲过的第一次慢),所以它**不是性能数据**,只是证明链路通了。真正的测量要走 W3 那套 warmup 流程。

### 关于 `curl | bash`

用法那行写的是 `curl -fsSL <raw url> | bash`。这种一行流有争议,因为它执行的是网络上任意内容。我接受它的理由:URL 指向我自己的仓库、`-f` 让 HTTP 错误直接失败不会把 404 页面当脚本跑、`-S` 出错时打印错误。不接受的话,替代方案是先 `curl -o bootstrap.sh` 再 `less` 看一眼再 `bash bootstrap.sh`,多花十秒,取舍自己定。仓库是私有的话,raw URL 需要 token,那就退回「先 clone 再执行」的顺序,把第 3 步挪到最前面。

## 脚本怎么上机:三种路径

写好了脚本,下一个问题是实例启动后谁来执行它。三种办法,从手动到全自动。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="把 bootstrap 脚本送到实例上执行的三种路径对比">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" fill="var(--ink)">
    <text x="20" y="28">脚本怎么到实例上</text>
  </g>
  <!-- path A -->
  <rect x="20" y="50" width="190" height="170" rx="4" fill="none" stroke="var(--rule)" stroke-width="1"/>
  <text x="32" y="72" font-family="var(--font-mono)" font-size="11" font-weight="600" fill="var(--ink)">A · 手动 scp</text>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">
    <text x="32" y="95">本机 scp bootstrap.sh →</text>
    <text x="32" y="110">ssh 进去 bash 执行</text>
    <text x="32" y="140">人在场:✓ 必须</text>
    <text x="32" y="155">步数:3</text>
    <text x="32" y="170">适合:第一次调脚本</text>
  </g>
  <!-- path B -->
  <rect x="225" y="50" width="190" height="170" rx="4" fill="none" stroke="var(--mem)" stroke-width="1.5"/>
  <text x="237" y="72" font-family="var(--font-mono)" font-size="11" font-weight="600" fill="var(--mem)">B · ssh 后一行 curl</text>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">
    <text x="237" y="95">ssh 进去</text>
    <text x="237" y="110">curl raw.github…| bash</text>
    <text x="237" y="140">人在场:✓ 一次</text>
    <text x="237" y="155">步数:2</text>
    <text x="237" y="170">适合:日常,M1–M2 默认</text>
  </g>
  <!-- path C -->
  <rect x="430" y="50" width="190" height="170" rx="4" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
  <text x="442" y="72" font-family="var(--font-mono)" font-size="11" font-weight="600" fill="var(--mem)">C · 启动命令自动跑</text>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">
    <text x="442" y="95">RunPod template 的</text>
    <text x="442" y="110">Start Command / Vast 的</text>
    <text x="442" y="125">On-start script 填 curl|bash</text>
    <text x="442" y="155">人在场:✗ 不需要</text>
    <text x="442" y="170">步数:0,开机即跑</text>
    <text x="442" y="185">适合:配合 Day 22 无人值守</text>
  </g>
  <text x="20" y="240" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">先用 A 把脚本调通,再切到 B;Day 22 做自动销毁时必须是 C,否则「一条命令起环境,跑完自己消失」的前半句就不成立。</text>
</svg>
<figcaption>三条路径的差别在「人要不要在场」。今天用 A 和 B 就够,但明天做三层自动销毁时,启动、跑任务、销毁要串成一条无人值守的链,那时候必须是 C。</figcaption>
</figure>

**路径 A,手动 scp。** 本机 `scp bootstrap.sh root@<ip>:/workspace/`,ssh 进去 `bash /workspace/bootstrap.sh`。最笨,但第一次调脚本时最合适,因为改一行、传一次、跑一次,循环快。

**路径 B,ssh 后一行 curl。** 脚本已经在 git 仓库里,ssh 进去之后 `curl -fsSL <raw url> | bash`。日常用这个。

**路径 C,启动命令。** RunPod template 里有 Container Start Command 字段,Vast 有 On-start script 字段。填一行 `bash -c 'curl -fsSL <raw url> | bash'`,实例起来自己跑。要注意 RunPod 官方 PyTorch template 的默认启动命令负责起 ssh 服务和 Jupyter,**直接替换会把 ssh 干掉**,正确做法是在原命令后面追加,或者把原命令里的启动脚本路径保留、把 curl 那行加在它前面。具体字段名和默认值以当前控制台为准,两家改界面都很勤。

顺序建议:今天用 A 把脚本调到连跑两次都干净,再切 B。C 留给明天,因为 C 一旦配上,「实例起来 → 脚本跑 → 任务跑 → 实例销毁」就是一条不需要我在场的链,那正是 Day 22 要做的事。

## 路径 C 的隐患:没有终端,输出去哪了

路径 A 和 B 都是我在 ssh 会话里执行,输出直接打在屏幕上,出错一眼看见。路径 C 不一样:脚本由容器启动进程执行,**没有任何人看着那个终端**。如果第 2 步 uv 装包失败,`set -e` 让脚本停下,但停下的消息打给了一个不存在的屏幕。我 ssh 进去只会发现 `python run.py` 报 `ModuleNotFoundError`,然后花十分钟猜是哪一步没跑完。

解法是在脚本开头把标准输出和标准错误都复制一份到文件:

```bash
# 放在 set -euo pipefail 之后、常量定义之前
LOG="${WORKDIR:-/workspace}/bootstrap.log"
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1
echo "== bootstrap log -> $LOG"
```

`exec > >(tee -a FILE) 2>&1` 这一行的意思是:把当前 shell 之后的所有输出,同时送到屏幕和文件。`>>` 追加不覆盖,每次运行的日志接在后面,配合 timing CSV 就能对上「哪次运行、哪一步、报了什么」。ssh 进去之后第一件事是 `tail -n 40 /workspace/bootstrap.log`,脚本的死因写在最后几行。

还有一个配套习惯:脚本最后一行打印的 `== total N s` 是一个明确的成功标记。`grep -c '== total' bootstrap.log` 等于运行次数,说明每次都跑到了底;少了就是某次中途死了。这比翻整个日志快。

## 分两层:bootstrap 管环境,run 管任务

到这里 bootstrap.sh 只做一件事,把机器变成能跑代码的状态,**它不跑任何实验**。实验交给另一个脚本 `run.sh`,两层分开的理由有三个。

第一,变化频率不同。环境一个月改一两次,实验每天都在改。混在一个文件里,改实验参数时容易顺手动了环境那一段,幂等性和版本锁就破了。

第二,失败处理不同。环境装失败应该直接停,没有任何理由继续;实验跑失败则要先把已产生的日志和部分结果同步出去,然后才轮到销毁实例,顺序反了结果就丢了。Day 22 的第一层自动销毁正好挂在 run.sh 的退出路径上,和 bootstrap 无关。

第三,执行次数不同。bootstrap 一台实例跑一次,run 可能跑十次:扫 batch、换模型、改 dtype,每次一个参数。

`run.sh` 的骨架现在就定下来,Day 22 往里加销毁逻辑:

```bash
#!/usr/bin/env bash
# run.sh —— 跑一个实验,把结果推出去。环境由 bootstrap.sh 负责,这里不装任何东西。
set -euo pipefail
REPO_DIR="${REPO_DIR:-/workspace/aiinfra-lab}"
RESULTS="$REPO_DIR/results/$(date -u +%Y%m%d-%H%M%S)-${EXP_NAME:-exp}"
mkdir -p "$RESULTS"
cd "$REPO_DIR"

echo "== run ${EXP_NAME:-exp} -> $RESULTS"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | tee "$RESULTS/gpu.txt"
python -c 'import torch, transformers; print(torch.__version__, transformers.__version__)' | tee "$RESULTS/versions.txt"

python "$@" 2>&1 | tee "$RESULTS/stdout.log"     # 实验脚本和参数从命令行传进来

# 结果推出去:实例随时会死,结果不能只在它的盘上
git add results && git commit -qm "results: ${EXP_NAME:-exp} $(date -u +%F)" && git push -q
echo "== run done"
```

用法是 `EXP_NAME=batch-sweep bash run.sh sweep.py --batches 1,4,16,64,128`。三个细节:

- **每次运行一个带时间戳的结果目录**,里面先落 `gpu.txt` 和 `versions.txt` 再跑实验。W3 说数字必须附带卡型和版本才可比,这两个文件就是「附带」的实现,以后看任何一组数字先看它旁边这两个文件。
- **结果目录进 git**。实验结果是几 KB 到几 MB 的 CSV 和 JSON,直接提交推走最省事,不需要对象存储。trace 文件(Day 10 的 chrome trace 常有几十 MB)例外,`.gitignore` 掉,需要时单独 scp 回本机。
- **`python "$@"`**。run.sh 不关心跑的是什么,参数原样透传。这样 run.sh 本身一个月不用改。

### tmux:ssh 断了任务不能跟着死

bootstrap 里装 tmux 就是为这一层准备的。ssh 会话里直接跑 `bash run.sh ...`,网络一抖、笔记本一合盖,ssh 断开,shell 收到 SIGHUP,run.sh 和它起的 python 一起被杀,半小时的扫参白跑,钱照扣。

规矩:**任何超过一分钟的任务,都在 tmux 里跑。**

```bash
tmux new -s exp                              # 开一个叫 exp 的会话
EXP_NAME=batch-sweep bash run.sh sweep.py    # 在会话里跑
# Ctrl-b 然后按 d 脱离会话;ssh 断了也没关系
tmux attach -t exp                           # 重新 ssh 进来后接回去看输出
```

tmux 是个会话管理器,进程挂在它下面而不是挂在 ssh 会话下面,ssh 断了它不受影响。路径 C 下由启动命令自动执行的任务本来就不在 ssh 会话里,不需要 tmux;它是给路径 A、B 手动跑长任务时用的。这也是 Day 22 第二层空闲检测要小心的地方:我脱离了 tmux 会话但任务还在跑,GPU 忙着,检测脚本不能因为「没有 ssh 连接」就把实例杀掉,要看 GPU 利用率和进程,不能只看连接。

## 上机之前:在本机把能查的都查完

脚本第一次上机前,有三样检查在 2018 年的 MacBook 上就能做,一分钱不花。

**语法检查。** `bash -n bootstrap.sh` 只解析不执行,少一个 `fi`、引号没闭合这类错误当场报出来。这类错误在实例上暴露的代价是「开机、跑、报错、改、再跑」一个循环,几美分到几毛钱加五分钟。

**shellcheck。** `brew install shellcheck` 之后 `shellcheck bootstrap.sh`。它会抓一批 bash 常见坑:变量没加引号导致带空格的路径断开、`$?` 用错位置、`cd` 失败后继续执行、数组语法错。上面脚本里 `"${PKGS[@]}"`、`"$(dirname "$LOG")"` 这些引号就是按它的要求写的。shellcheck 报的每一条都值得看一遍,不一定都改,但要知道为什么不改。

**在 Docker 里跑一遍前五步。** 2018 Intel MBP 上 Docker Desktop 能跑,只是慢。`docker run --rm -it -v "$PWD":/repo pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime bash /repo/bootstrap.sh`,前五步全部能走,第六步 smoke test 因为没有 GPU 会在 `assert torch.cuda.is_available()` 上失败,这是预期的。这一步验的是幂等和 timing 逻辑,不验 GPU。镜像 2.5 GB 第一次拉要几分钟,拉一次以后一直在。

这三样加起来十分钟,能挡掉一大半「上机才发现」的错误。留给按小时计费的机器的,只剩真正需要 GPU 的那一步。

## 两家控制台字段对照

同一个脚本在两家落地时,要填的字段名不一样。第一次配 template 时我在两个控制台之间来回切了半小时才对上,现在把对照表写下来,以后换厂商直接查:

| 我要做的事 | RunPod 里叫什么 | Vast 里叫什么 | 脚本里对应 |
| --- | --- | --- | --- |
| 选镜像 | Template → Container Image | Template → Image Path/Tag | 决定 `2a.torch-check` 是 0 秒还是 5 分钟 |
| 开机自动执行 | Container Start Command(追加,别替换) | On-start Script | 路径 C |
| 注入 token | Secrets(注入后前缀 `RUNPOD_SECRET_`) | Environment Variables(`-e KEY=VALUE`) | `${HF_TOKEN:-}` |
| 持久目录 | Volume Path,默认 `/workspace` | Disk Space 设大小,目录随镜像 | `WORKDIR` 变量 |
| 容器盘大小 | Container Disk | Disk Space | 7B 模型至少 30 GB |
| ssh 公钥 | Settings → SSH Public Keys | Account → SSH Keys | 脚本不碰 |
| 暴露端口 | Expose TCP Ports | 镜像默认 22,加 `-p` | Jupyter 时才用 |
| 实例自己的 ID | 环境变量 `RUNPOD_POD_ID` | 以容器内 `env` 实际看到的为准 | Day 22 销毁时要用 |

表里唯一带「以实际为准」的是 Vast 的实例 ID 变量,文档里没找到明确写法,上机后第一件事 `env | sort` 看一遍,把变量名记进 Day 22 的脚本。两家改控制台都很勤,字段名以我上机当天看到的为准,这张表是路标不是地图。

## 幂等:为什么必须连跑两次都干净

幂等的意思是:一个脚本跑一次和跑十次,最终状态一样,而且第二次以后不做多余的事。上面的脚本用了三种手段做到这一点:

| 手段 | 用在哪 | 第二次跑时的行为 |
| --- | --- | --- |
| 先查存在再动作 | `have git`、`[ -d .git ]`、`import torch` | 存在就跳过,零耗时 |
| 交给工具自己去重 | `uv pip install`(已装同版本秒过)、`snapshot_download`(缓存命中) | 工具内部判断,我不写逻辑 |
| 只追加不覆盖 | timing CSV 用 `>>` | 每次运行留一行记录,不丢历史 |

为什么必须幂等,三个具体场景:

1. **脚本中途断了。** ssh 掉线、网络抖一下 pip 失败、我按了 Ctrl-C。`set -e` 让它停在那一行,但已经完成的步骤留下了半成品状态。重跑一遍,幂等的脚本会跳过已完成的、补上没完成的;不幂等的脚本会在 `git clone` 那一步报「目录已存在」直接死掉。
2. **实例没销毁,第二天接着用。** 一个实例开着,今天跑完想明天继续。重新执行脚本应该是 10 秒的事,不该重装一遍。
3. **用它做 Day 22 的启动命令。** 实例重启(RunPod 的 stop/resume、Vast 的 stop/start)会再执行一次启动命令。不幂等的话,每次重启都重装,或者直接失败导致 ssh 起不来。

测法就一句话:**跑两次,比 timing 表。** 第一次总计一两分钟,第二次每一步都应该是 0 到 2 秒,除了 smoke test。

## 找最慢的一步:记录表

脚本每跑一次,timing CSV 多几行。下面是我给自己准备的记录表,**现在是空的**,W4 真上机之后填。填三次,同一家厂商同一种卡,看方差。

| 步骤 | 第 1 次 (s) | 第 2 次 (s) | 第 3 次 (s) | 备注(机房、镜像、卡型) |
| --- | --- | --- | --- | --- |
| 1.apt | | | | |
| 2a.torch-check | | | | 应为 0–2 s,否则镜像选错 |
| 3.git | | | | |
| 2b.python-deps | | | | |
| 4.hf-login | | | | |
| 5.model-prefetch | | | | 第 1 次看下载速度 = 2.2 GB ÷ 秒数 |
| 6.smoke | | | | 含 CUDA 初始化,不是性能数据 |
| **total** | | | | **验收线 300 s** |

按上面的预算,我**预期**第一次 90 到 150 秒,第二次 15 到 30 秒。如果第一次超过 300 秒,最可能的三个原因按概率排:镜像没带 torch(看 2a 那行)、机房到 HuggingFace 慢(看 5 那行,算出 MB/s)、apt 源慢(看 1 那行,换 `--no-install-recommends` 或干脆不装 htop)。

这里也是路线图 W4 D3 验收题的答案来源:「从零到能跑代码实际要几分钟?卡在哪一步最久?」答案不是猜的,是表里那一列最大的数。

验收线定在 300 秒而不是「越快越好」,是因为再往下压的边际收益很小:从 120 秒压到 60 秒,一个月开机 12 次省 12 分钟机时,不到半美元,而为此去折腾镜像缓存、并行下载、换 apt 源,要花掉一个晚上。5 分钟以内就算过,把时间留给 GPU 上真正要测的东西。反过来,超过 300 秒必须查,因为超出的那部分几乎一定是结构性问题(镜像选错、机房到 HuggingFace 慢),会在每一次开机重复出现。

## 脚本 vs 自定义 Docker 镜像

还有一条路是把所有依赖打进自己的 Docker 镜像,推到 Docker Hub 或 GHCR,开实例直接选它,连脚本都不用。什么时候值得:

| | 启动脚本(今天的做法) | 自定义镜像 |
| --- | --- | --- |
| 改一个依赖版本 | 改 `requirements.txt`,提交,下次开机生效 | 改 Dockerfile,build 几分钟,push 几 GB,再开机 |
| 开机耗时 | 拉官方镜像(已缓存,快)+ 脚本 1–2 分钟 | 拉自定义镜像,第一次可能 3–10 分钟(未缓存,几 GB) |
| 可复现性 | 依赖锁版本,但 apt 包和 uv 本身可能漂 | 最强,镜像 digest 唯一 |
| 维护成本 | 一个 bash 文件 | Dockerfile + registry + 本机要有 Docker(2018 MBP 上跑 Docker build 很慢) |
| 适合阶段 | M1–M2:依赖少,变得快 | M3 起:vLLM 依赖重、编译慢,每次装要十几分钟 |

现在的判断:**M1 到 M2 用脚本**。依赖就三四个包,一分钟装完,而且这两个月我会频繁改版本做对比。到 M3 装 vLLM 时,它的依赖树和编译时间会让脚本路线撑不住,那时候切镜像。切的时候 bootstrap.sh 不会白写,它会变成 Dockerfile 里的 `RUN` 段,逻辑一样。

## 在便宜的 CPU 实例上调脚本

调脚本要跑十几遍。每一遍在 A100 上跑,就是十几次 1 到 2 美元每小时的计费,而脚本调试的 95% 时间和 GPU 毫无关系。

RunPod 有纯 CPU 的 pod,每小时几美分。先在 CPU pod 上把 apt、uv、git、HF 下载这四步调干净,只有 smoke test 那一步会因为没有 GPU 而失败,这是预期的。等前五步的 timing 稳定了,再开 GPU 实例跑完整一遍。Vast 可以筛最便宜的旧卡(GTX 1080 级别每小时一两毛)做同样的事,但要记得 Day 19 说的:旧卡驱动可能不支持新 CUDA 镜像,所以 Vast 上调脚本时选和目标 GPU 同 CUDA 版本的机器。

这条其实是 Day 0 成本纪律「不在按小时计费的机器上想逻辑」的直接应用。想逻辑的时候,按小时计费的那个数字越小越好。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/90rKuVaQ-DY" title="How to Deploy a Low-Cost Ubuntu CPU Pod on Runpod For Development and Training" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Runpod 官方 · How to Deploy a Low-Cost Ubuntu CPU Pod on Runpod For Development and Training。看怎么开一个每小时几美分的 CPU pod,用它调 bootstrap 的前五步,GPU 实例只跑验收那一遍。</figcaption>
</figure>

## 安全:token 和 key 的三条规矩

脚本会碰到三种敏感信息:HuggingFace token、云厂商 API key(明天销毁实例要用)、ssh 私钥。规矩写死:

1. **明文只存在于云厂商的 secret 存储和我本机的环境变量里。** 脚本通过 `${HF_TOKEN:-}` 读,读不到就跳过,绝不 `HF_TOKEN=hf_xxx` 硬编码。
2. **仓库里有 `.gitignore`,至少包含 `.env`、`*.token`、`hf-cache/`、`bootstrap-timing.csv`。** timing CSV 也不进仓库,它是每台实例自己的记录,Day 23 会用另一种方式收集。
3. **提交前 grep 一遍。** 在本机 `.git/hooks/pre-commit` 里放一行:

```bash
#!/usr/bin/env bash
# 阻止带 token 形状的字符串进入提交
if git diff --cached -U0 | grep -E 'hf_[A-Za-z0-9]{20,}|rpa_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}' ; then
  echo "!! 疑似 token 出现在暂存区,拒绝提交"; exit 1
fi
```

`hf_` 是 HuggingFace token 的前缀,`rpa_` 是 RunPod API key 的常见前缀。这个 hook 只是兜底,真正的防线是第一条:根本不让 token 出现在文件里。

ssh 私钥在本机,公钥贴到云厂商控制台,实例启动时厂商把公钥写进 `authorized_keys`。脚本不碰这一层。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="敏感信息的流向:云厂商 secret 与本机环境变量流入脚本,脚本从不写回仓库">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">token 只走一个方向</text>
  <!-- sources -->
  <rect x="20" y="50" width="170" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="68" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">云厂商 Secrets</text>
  <text x="30" y="84" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">RunPod Secrets / Vast env</text>
  <rect x="20" y="110" width="170" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">本机 shell 环境变量</text>
  <text x="30" y="144" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">export HF_TOKEN=…(不进文件)</text>
  <!-- script -->
  <rect x="260" y="80" width="140" height="44" rx="4" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
  <text x="270" y="98" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">bootstrap.sh</text>
  <text x="270" y="114" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">${HF_TOKEN:-} 读取</text>
  <!-- arrows in -->
  <line x1="190" y1="72" x2="260" y2="96" stroke="var(--mem)" stroke-width="1.5"/>
  <line x1="190" y1="132" x2="260" y2="108" stroke="var(--mem)" stroke-width="1.5"/>
  <polygon points="260,96 251,90 252,99" fill="var(--mem)"/>
  <polygon points="260,108 251,105 252,114" fill="var(--mem)"/>
  <!-- sinks -->
  <rect x="470" y="50" width="150" height="44" rx="4" fill="none" stroke="var(--rule)"/>
  <text x="480" y="68" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">~/.cache/huggingface</text>
  <text x="480" y="84" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">HF 库自己的 token 位置</text>
  <line x1="400" y1="96" x2="470" y2="72" stroke="var(--ink-soft)" stroke-width="1.5"/>
  <polygon points="470,72 460,72 464,80" fill="var(--ink-soft)"/>
  <!-- forbidden -->
  <rect x="470" y="130" width="150" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)" stroke-dasharray="4 3"/>
  <text x="480" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">git 仓库 / 脚本文件</text>
  <text x="480" y="164" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">pre-commit hook 拦截</text>
  <line x1="400" y1="108" x2="470" y2="150" stroke="var(--compute)" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="418" y="140" font-family="var(--font-mono)" font-size="14" fill="var(--compute)">✕</text>
  <text x="20" y="215" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">左边两处是明文唯一允许存在的地方;箭头只往右走;虚线那条是 hook 要拦的。</text>
</svg>
<figcaption>敏感信息的流向图。明文只在云厂商的 secret 存储和本机环境变量里,脚本读进来交给 HuggingFace 库自己的配置位置,永远不流向仓库。虚线那条路是 pre-commit hook 存在的理由。</figcaption>
</figure>

## 把 Vast 那一侧也走一遍

上面的脚本两家通用,差别只在「怎么把脚本送上去」和「持久盘挂在哪」。Vast 的官方 quickstart 视频把从搜卡、选镜像、配 ssh 到进实例的整条路走了一遍,看它主要为了对照:Vast 的 On-start script 字段在哪、环境变量在哪填、实例的磁盘怎么设大小。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GxCLo1vYrbY" title="Vast.ai Quickstart Guide (2025 Update) – Run AI Models on Cloud GPUs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Vast AI 官方 · Vast.ai Quickstart Guide (2025 Update) – Run AI Models on Cloud GPUs。重点看 template 编辑界面里 On-start script 和环境变量两个字段,那是路径 C 在 Vast 上的落点。</figcaption>
</figure>

Vast 侧要额外注意两点。一是 `WORKDIR`:Vast 实例的默认持久目录不一定是 `/workspace`,看镜像和磁盘设置,脚本顶部的 `WORKDIR` 变量就是为这个留的,开机时 `WORKDIR=/root/work bash bootstrap.sh` 覆盖即可。二是磁盘大小要在开实例时设够:TinyLlama 加依赖 10 GB 够,7B 模型要 30 GB 起,设小了 `snapshot_download` 会在中途报磁盘满,而且 Vast 创建后不能改大。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| bootstrap | 引导脚本,让一台空机器从零变成能干活的状态。名字来自「拉自己的鞋带把自己提起来」 |
| 幂等(idempotent) | 执行一次和执行多次结果相同。对脚本来说还要求第二次以后不做多余的事 |
| `set -euo pipefail` | bash 的三个严格模式开关:出错即停、未定义变量即停、管道任一段失败即失败 |
| uv | Astral 出的 Python 包管理器,兼容 pip 的命令,解析和安装快很多 |
| `--system` | uv 的选项,装到系统 Python 而不是虚拟环境 |
| runtime / devel 镜像 | PyTorch 官方镜像的两种变体:runtime 只有运行时库,devel 多带 nvcc 编译器,体积大约一倍 |
| template | RunPod 和 Vast 对「镜像 + 启动命令 + 环境变量 + 磁盘」这一组配置的叫法 |
| On-start script | Vast 实例启动后自动执行的脚本字段;RunPod 对应 Container Start Command |
| `HF_HOME` | HuggingFace 库的缓存根目录环境变量,模型权重和 token 都在它下面 |
| `snapshot_download` | huggingface_hub 的函数,把一个模型仓库拉到本地缓存,自带去重 |
| gated 模型 | HuggingFace 上需要同意许可才能下载的模型,如 Llama 系列,下载时要 token |
| secret | 云厂商控制台里加密存放、启动时注入为环境变量的敏感值 |
| pre-commit hook | git 在 commit 前自动执行的脚本,可以拒绝提交 |
| 驱动 / runtime / wheel | GPU 侧三层版本:宿主机驱动、镜像里的 CUDA 库、torch 编译时链接的 CUDA;规则是驱动 ≥ runtime = wheel |
| `torch.version.cuda` | torch 编译时用的 CUDA 版本,才是「实际在用」的那个 |
| smoke test | 最简单的通不通测试,这里就是 `torch.cuda.is_available()` 加一次矩阵乘 |
| `exec > >(tee -a FILE) 2>&1` | 把脚本之后所有输出同时送到屏幕和文件,无人值守时留日志用 |
| tmux | 终端会话管理器,进程挂在它下面,ssh 断开不影响;`Ctrl-b d` 脱离,`tmux attach` 接回 |
| SIGHUP | 终端断开时发给进程的信号,默认行为是终止进程;ssh 掉线杀死任务就是它 |
| shellcheck | bash 脚本静态检查工具,抓引号、数组、错误处理等常见坑 |
| `bash -n` | 只做语法解析不执行,上机前先跑一遍 |

## 常见误区

**在 GPU 实例上一行行手工装环境。** 每分钟都在计费,而且下次开机还得重来一遍,环境版本还不一定一样。脚本化不是为了优雅,是为了钱和数字可比。

**镜像随便选,想着「反正脚本会装」。** 装 torch 是 2 到 5 分钟、2.5 GB 流量,一项就把 5 分钟预算吃光。选自带 torch 的官方镜像是整个脚本里最省时间的一个决定,而且它不在脚本里。

**把 `nvidia-smi` 右上角的 CUDA Version 当成已安装版本。** 那是驱动支持的上限。容器里实际在用的看 `torch.version.cuda`,两个数不同很正常;只有 runtime 高于驱动上限时才会出错。

**`requirements.txt` 不写版本号。** 今天装的和下周装的不是同一个 transformers,W3 测出来的数字就不能和 W2 比。数字漂了先怪环境,再怪代码。

**脚本不幂等,以为「反正实例用完就销毁」。** 中途断线重跑、实例 stop/resume 后再跑、第二天接着用同一台,三种场景都会让不幂等的脚本要么报错要么重装。测法是连跑两次比 timing。

**把 token 写进脚本「先跑通再说」。** 跑通之后就忘了,然后 `git push` 出去。规矩是 token 只从环境变量读,仓库里放 pre-commit hook 兜底。

**替换掉官方 template 的默认启动命令。** RunPod 官方镜像的启动命令负责起 ssh 和 Jupyter,整个替换掉之后 ssh 进不去,实例只能销毁重开。要追加,不要替换。

**用启动命令自动执行却不留日志。** 路径 C 下没人看着终端,脚本死在哪一步只有日志知道。开头一行 `exec > >(tee -a LOG) 2>&1`,进实例先 `tail` 它。

**长任务直接在 ssh 会话里跑。** 网络一抖 SIGHUP 把任务连带杀掉,钱照扣。超过一分钟的任务一律进 tmux。

**在 A100 上调脚本。** 脚本调试 95% 的时间和 GPU 无关,在几美分每小时的 CPU pod 上调,最后在 GPU 上跑一遍验收。

## 参考资料

### 文档

- RunPod 文档首页,https://docs.runpod.io/ 。Pods、templates、storage、环境变量、runpodctl 各章都在这里,界面改得勤,以文档为准。
- RunPod · Pod 环境变量参考,https://docs.runpod.io/pods/references/environment-variables 。`RUNPOD_POD_ID`、`RUNPOD_SECRET_*`、`RUNPOD_VOLUME_ID` 等变量的出处,明天销毁实例要用 `RUNPOD_POD_ID`。
- RunPod · Templates 概览,https://docs.runpod.io/pods/templates/overview 。Container Start Command 和环境变量字段的说明。
- RunPod · 连接到 Pod,https://docs.runpod.io/pods/connect-to-a-pod 。ssh 公钥怎么配。
- RunPod · runpodctl 概览,https://docs.runpod.io/runpodctl/overview 。CLI 安装与子命令列表,`runpodctl pod` 一组子命令以 `--help` 为准。
- Vast.ai 文档首页,https://docs.vast.ai/ 。
- Vast.ai · SSH 与 SCP,https://docs.vast.ai/instances/sshscp 。scp 上传脚本、ssh 端口怎么看。
- Vast.ai · Templates,https://docs.vast.ai/instances/templates 。On-start script 与环境变量字段。
- Vast.ai · CLI,https://docs.vast.ai/cli 和源码 https://github.com/vast-ai/vast-cli 。所有 `vastai` 子命令的定义都在 `vast.py` 一个文件里,看不懂文档直接读它。
- uv 文档,https://docs.astral.sh/uv/ 。`uv pip install --system` 的用法在 pip 兼容那一章。
- PyTorch 安装页,https://pytorch.org/get-started/locally/ 。选 CUDA 版本对应的 index URL。
- `pytorch/pytorch` 官方镜像,https://hub.docker.com/r/pytorch/pytorch 。tag 命名规则看这里。
- huggingface_hub · 环境变量,https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables 。`HF_HOME`、`HF_TOKEN`、`HF_HUB_ENABLE_HF_TRANSFER` 等。
- huggingface_hub · CLI 指南,https://huggingface.co/docs/huggingface_hub/guides/cli 。命令行下载模型的写法,新版命令名有变化,以 `--help` 为准。
- TinyLlama-1.1B-Chat-v1.0 模型页,https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0 。文件列表能看到 safetensors 大小,核对 2.2 GB。
- GNU Bash 手册,https://www.gnu.org/software/bash/manual/bash.html 。`set` 内建命令那一节解释 `-e -u -o pipefail`。
- Dockerfile 参考,https://docs.docker.com/reference/dockerfile/ 。M3 切自定义镜像时用。

### 视频

- Runpod 官方,《How to Deploy a Low-Cost Ubuntu CPU Pod on Runpod For Development and Training》,已嵌入上文。
- Vast AI 官方,《Vast.ai Quickstart Guide (2025 Update) – Run AI Models on Cloud GPUs》,已嵌入上文。
- Bijan Bowen,《Runpod Setup FULL Tutorial – Run Large AI Models On The Cloud!》,YouTube 按标题搜索。从注册到跑模型的完整流程,比官方短片长,适合第一次。

## 自测

合上笔记做。

**1. bootstrap 脚本 5 分钟预算里,哪一步最可能把预算吃光?这一步在脚本里还是脚本外解决?**

<details><summary>答案</summary>

装 PyTorch。torch 加 CUDA 依赖约 2.5 GB,pip 下载加解压 2 到 5 分钟,一项就超过 5 分钟上限。它在脚本外解决:选自带 torch 的官方 `pytorch/pytorch:*-runtime` 镜像,脚本里只做一次 `import torch` 检查,存在就跳过。脚本里那行警告是给验收不过时的自己看的。

</details>

**2. 说出脚本里实现幂等的三种手段,各举一个例子。**

<details><summary>答案</summary>

一是先查存在再动作:`have git` 查命令、`[ -d .git ]` 查目录、`python -c 'import torch'` 查包,存在就跳过。二是交给工具自己去重:`uv pip install` 同版本已装秒过,`snapshot_download` 缓存命中不重下。三是只追加不覆盖:timing CSV 用 `>>`,每次运行留记录。验证方法是连跑两次比 timing 表,第二次除 smoke test 外每步应为 0 到 2 秒。

</details>

**3. 为什么脚本必须幂等?给出三个会重复执行的具体场景。**

<details><summary>答案</summary>

一是脚本中途断了(ssh 掉线、网络抖动、Ctrl-C),重跑要能跳过已完成的步骤而不是在 `git clone` 报目录已存在。二是实例没销毁第二天接着用,重跑应该是 10 秒不是重装。三是把它配成启动命令后,实例 stop/resume 会再执行一次,不幂等会导致重装或失败,严重时 ssh 起不来。

</details>

**4. TinyLlama 2.2 GB 和 Llama-2-7B fp16 13.5 GB,在 100 MB/s 和 500 MB/s 的机房分别要下多久?这个结果对 Day 20 的持久化决策有什么影响?**

<details><summary>答案</summary>

TinyLlama:22 秒和 4.5 秒。7B:135 秒(约 2.3 分钟)和 27 秒。结论是 W2、W3 用 TinyLlama 时模型下载不是瓶颈,每次重下即可;到 M2 W7 用 7B 模型时,慢机房上每次开机要吃两分多钟,network volume 才开始值回票价,那时候再决定挂不挂。

</details>

**5. HF token 在整条链路上允许以明文出现在哪两个地方?脚本用什么机制保证它不进仓库?**

<details><summary>答案</summary>

云厂商的 secret 存储(RunPod Secrets、Vast 环境变量栏)和我本机 shell 的环境变量。脚本只通过 `${HF_TOKEN:-}` 读取,读不到就跳过登录;`login()` 时 `add_to_git_credential=False` 防止写进 git 凭据;仓库 `.gitignore` 排除 `.env` 等;`.git/hooks/pre-commit` 用正则拦截 `hf_`、`rpa_`、`sk-` 前缀的字符串。第一条是真防线,hook 是兜底。

</details>

**6. 脚本上机的三种路径分别是什么?为什么 Day 22 必须用第三种?**

<details><summary>答案</summary>

A 手动 scp 后 ssh 执行,B ssh 后一行 `curl | bash`,C 填进 RunPod 的 Container Start Command 或 Vast 的 On-start script 让实例开机自动跑。Day 22 要做的是「实例起来 → 脚本跑 → 任务跑 → 实例自己销毁」的无人值守链,前两种都需要我在场敲命令,链就断了。注意 C 在 RunPod 上要追加到官方默认启动命令后面,不能替换,否则 ssh 服务起不来。

</details>

**7. `nvidia-smi` 右上角显示 CUDA Version 12.6,容器里 `torch.version.cuda` 是 12.4,这正常吗?什么情况才是错的?**

<details><summary>答案</summary>

正常。nvidia-smi 显示的是宿主机驱动支持的 CUDA 上限,不是已安装版本;容器里实际在用的是镜像里的 CUDA runtime,torch 报的 12.4 就是它。规则是驱动上限 ≥ runtime = torch wheel。只有反过来,runtime 高于驱动上限(比如驱动只到 12.2 却选了 cuda12.4 镜像),第一次 CUDA 调用才会报 driver version is insufficient。Vast 上按 `cuda_vers >= 12.4` 过滤机器就是为了这一条。

</details>

## 明天预告

Day 22 做 W4 最重要的一件事:三层自动销毁。忘记关机是这条路上预算失控的唯一原因,而它不会因为「这次一定记得」而消失。三层分别防三种不同的失败方式:脚本末尾自动销毁管正常收尾,空闲检测管我中途走开忘了回来,余额上限和告警管前两层都失效的情况。每一层都要写出来、跑一遍,验收是故意跑完一个任务,然后看实例自己消失。
