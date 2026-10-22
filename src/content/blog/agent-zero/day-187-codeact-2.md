---
title: 'Day 187 · 代码即动作(二):工具桥加子进程,两种做法实测'
description: '把昨天只打印不执行的那段代码真正跑起来:代码在 sandbox-exec 关住的子进程里执行,读不到工作目录以外的文件、连不上网,工具函数是桩,调用经「工具桥」转发回主进程。接进 Agent 循环后同一道题连跑三轮,JSON 做法输入 8,415–10,301 个 token、两轮金额算错,写代码做法输入 550–1,428 个、三轮全对;订单加到 12,000 条,写代码那边输入还是 566 个。最后讲这个沙箱还挡不住什么。'
pubDate: 2026-10-22
regime: none
tags: ['code-execution', 'codeact', 'sandbox', 'subprocess', 'agent-zero']
series: 'agent-zero'
day: 187
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 186](/blog/agent-zero/day-186-codeact-1/) 用一道「退款最多的三个城市」看清了 JSON 工具调用的两个弱点:116 条订单 3,486 个 token 原样进上下文、每一步重发;按城市求和只能靠模型「心算」,三遍金额全错。然后让模型写了一段调用工具的 Python,只花 141 个输入 token,逻辑和标准答案一模一样。

那段代码一直没执行,原因昨天说了:模型写的代码能做的事和你自己写的代码一样多,读文件、删目录、往外网发数据都行,所以执行它的第一版就必须带沙箱。今天就做这个执行环境,接进 Agent 循环,把两种做法完整地比一遍。

## 今天要解决的问题

学完你应该能:

1. 用 `subprocess` 在子进程里执行一段字符串形式的代码,拿回它的输出、报错和退出码。
2. 写出「工具桥」:子进程里的工具函数是桩,调用时通过 stdout 把请求发回主进程,主进程用注册表执行后把结果写回 stdin。
3. 用 macOS 的 `sandbox-exec` 把子进程关在一个工作目录里,禁止联网,再加 CPU 和墙钟时间限制,并能用一组「坏代码」验证这些限制真的生效。
4. 说出这个沙箱还挡不住什么(内存、内核漏洞、工具本身的权限),以及生产环境换什么。

今天两个新概念:**工具桥**(实现)和**沙箱边界**(它能挡什么、不能挡什么)。

预计用时 2.5 小时。前置:[Day 186](/blog/agent-zero/day-186-codeact-1/)(`orders_tools.py`、`json_mode.py`)、[Day 170](/blog/agent-zero/day-170-agent-full/)(`run_agent`)、[Day 169](/blog/agent-zero/day-169-tool-registry-2/)(注册表从函数签名生成 schema)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)(`LLMClient` 和 `ledger`)。代码在 `agent-zero-lab/part03/`,命令都在 `agent-zero-lab/` 根目录跑。正文实跑约 ¥0.064,四道练习约 ¥0.017,一共约 ¥0.08。

**今天的代码只能在 macOS 上原样跑。** `sandbox-exec` 是 macOS 自带的命令;Linux 和 Windows 的同学看「沙箱边界」那一节的替代写法,那几段我没有实跑。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `run_code` 里「读一行、判断是不是工具请求、执行、写回」那个循环,和 `BRIDGE` 的四行;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 第一步:在子进程里跑一段代码

先只解决一个问题:手里有一段字符串形式的 Python 代码,怎么让它在**另一个进程**里跑,再把它 print 的东西拿回来。

进程你在前端其实天天见。Chrome 给每个标签页开一个渲染进程,一个页面卡死不会拖垮整个浏览器;Node 里 `child_process.spawn("node", ["-e", code])` 就是开一个子进程跑一段代码。Python 里对应的是标准库 `subprocess`。

为什么要另开进程,而不是在当前程序里 `exec(code)`?因为当前进程手里有你的 API key、注册表、数据库连接。`exec` 等于让模型的代码坐到你的位置上。另开一个进程,它就是一个全新的 Python,不认识你的任何变量,后面才谈得上给它加限制。

```python
# agent-zero-lab/part03/sub_hello.py  第一步:在子进程里跑一段字符串形式的代码,拿回它 print 的内容
import os
import subprocess
import sys

code = "import os\nprint(1 + 1)\nprint('子进程的进程号', os.getpid())"
done = subprocess.run(
    [sys.executable, "-I", "-c", code],
    capture_output=True, text=True, timeout=10,
)
print("父进程的进程号", os.getpid())
print("退出码", done.returncode)
print("stdout:", repr(done.stdout))
print("stderr:", repr(done.stderr))
```

<div class="line-notes">

- `import subprocess` 标准库,开子进程用。相当于 Node 的 `child_process`。
- `code = "import os\nprint(1 + 1)` 要执行的代码就是一个普通字符串,`\n` 是换行。今天这段是我们自己写的,明白之后才换成模型写的。
- `[sys.executable, "-I", "-c", code],` 要执行的命令,写成列表,一项一个参数。`sys.executable` 是当前正在跑的这个 Python 的路径(实测是 `/Users/你/agent-zero-lab/.venv/bin/python`);`-c code` 表示「执行后面这段字符串」,和 `node -e` 一样;`-I` 是隔离模式,下面细讲。
- `capture_output=True, text=True, timeout=10,` `capture_output` 把子进程的 stdout 和 stderr 收集起来,不直接打到你的终端;`text=True` 让收回来的是字符串而不是字节;`timeout=10` 超过 10 秒还没结束就杀掉并抛 `TimeoutExpired`。
- `print("父进程的进程号", os.getpid())` 进程号(PID)是操作系统给每个进程的编号。实测父进程 79913,子进程 79914,两个不同的进程。
- `print("退出码", done.returncode)` 程序结束时交给操作系统的一个整数。0 表示正常结束,非 0 表示出错。`npm test` 失败时 CI 变红,看的就是这个数。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part03.sub_hello
```

```text
父进程的进程号 79913
退出码 0
stdout: '2\n子进程的进程号 79914\n'
stderr: ''
```

子进程 print 的两行都进了 `done.stdout`。stdout(标准输出)和 stderr(标准错误)是每个进程天生就有的两个输出通道,`print` 写前者,报错的 traceback 写后者;还有一个 stdin(标准输入)是进来的通道。这三个通道第三步会全部用上。

再看出错的样子,把 `code` 换成 `"x = 1/0"` 跑一下(我在终端里直接跑的):

```text
1 'Traceback (most recent call last):\n  File "<string>", line 1, in <module>\nZeroDivisionError: division by zero\n'
```

退出码变成 1,traceback 在 stderr 里,父进程什么事都没有。报错被关在子进程里,这正是我们要的:等会儿把它原样交给模型,模型看了自己改代码。

`-I` 再多说一句。不加它时,Python 启动会把当前目录加进模块搜索路径,还会读 `PYTHONPATH` 这类环境变量和你用户目录下的 site-packages。假如模型的代码先在工作目录里写了一个 `json.py`,下一次执行时 `import json` 就会导入它而不是标准库。`-I` 把这些都关掉,子进程只认解释器自带的标准库。

## 第二步:把子进程关进沙箱

子进程是另一个 Python,可它仍然是**你**启动的,拥有你的全部权限:你能读的文件它能读,你能连的网它能连。另开进程只是分开了内存,没有分开权限。

这一点必须先亲眼看到,但不能拿真文件看。下面的脚本伪造了一个「家目录」`sandbox_fake/home/.zshrc`,里面写一个假 key,然后用同一段「探测」代码跑两次:一次不加限制,一次用 macOS 的 `sandbox-exec` 关起来。

`sandbox-exec` 是 macOS 自带的命令,用法是 `sandbox-exec -p 规则 要执行的命令`。规则用一种括号很多的小语言写(Apple 内部叫 Seatbelt,写法来自 Lisp 家族的 Scheme),内核会按规则检查这个进程的每一次读文件、写文件、联网、启动程序。浏览器把网页关在沙箱里,页面里的 JS 读不到你的硬盘,道理一样,只是这次规则是我们自己写的。OpenAI 的 Codex CLI 在 macOS 上就是用 `sandbox-exec -p` 加一份规则来关住它执行的命令([Codex 安全文档](https://developers.openai.com/codex/security)),Anthropic 给 Claude Code 做的沙箱在 macOS 上也用 Seatbelt。

```python
# agent-zero-lab/part03/sandbox_try.py  第二步:同一段「探测」代码,不关沙箱跑一次,关进 sandbox-exec 再跑一次
import subprocess
import sys
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent          # agent-zero-lab/ 的绝对路径
WORK = LAB / "sandbox_work"                            # 唯一允许读写的目录
FAKE = LAB / "sandbox_fake" / "home" / ".zshrc"        # 伪造的「家目录配置文件」,里面是假 key
PY = Path(sys.executable).resolve()                    # 真正的解释器文件(不是 .venv 里的链接)
PY_HOME = Path(sys.base_prefix).resolve()              # 解释器的安装目录,标准库在里面

PROFILE = f"""(version 1)
(deny default)
(allow process-exec (literal "{PY}"))
(allow sysctl-read)
(allow file-read* (literal "/") (subpath "{PY_HOME}") (subpath "{WORK}")
                  (subpath "/usr/lib") (subpath "/System")
                  (literal "/dev/null") (literal "/dev/urandom"))
(allow file-write* (subpath "{WORK}"))
"""

PROBE = f"""
import os, urllib.request
def t(name, f):
    try:
        print(name, "成功", f())
    except Exception as e:
        print(name, "失败", type(e).__name__)
t("读伪造的 .zshrc", lambda: open({str(FAKE)!r}).read().strip())
t("写工作目录", lambda: open("note.txt", "w").write("hi"))
t("写工作目录外", lambda: open({str(FAKE.parent / "x.txt")!r}, "w").write("hi"))
t("联网", lambda: urllib.request.urlopen("https://example.com", timeout=5).status)
t("环境变量", lambda: sorted(os.environ))
"""

if __name__ == "__main__":
    WORK.mkdir(exist_ok=True)
    FAKE.parent.mkdir(parents=True, exist_ok=True)
    FAKE.write_text("export OPENAI_API_KEY=sk-fake-0000\n")
    env = {"PATH": "/usr/bin:/bin", "HOME": str(WORK)}
    for label, prefix in [("不关沙箱", []), ("sandbox-exec", ["/usr/bin/sandbox-exec", "-p", PROFILE])]:
        done = subprocess.run([*prefix, str(PY), "-I", "-c", PROBE],
                              capture_output=True, text=True, cwd=WORK, env=env, timeout=20)
        print(f"== {label}(退出码 {done.returncode})")
        print(done.stdout + done.stderr)
```

<div class="line-notes">

- `LAB = Path(__file__).resolve().parent.parent` `__file__` 是这个脚本自己的路径,`.resolve()` 变成绝对路径并解开符号链接,往上两级就是 `agent-zero-lab/`。实测是 `/Users/你/agent-zero-lab`。沙箱规则里必须写绝对路径,相对路径不认。
- `WORK = LAB / "sandbox_work"` 子进程唯一能读写的目录。`/` 拼路径是 [Day 37](/blog/agent-zero/day-037-pathlib/) 学的 `pathlib` 写法。
- `FAKE = LAB / "sandbox_fake" / "home" / ".zshrc"` 伪造的文件,放在工作目录**外面**。演示「没沙箱会怎样」只用它,不碰你真正的家目录。
- `PY = Path(sys.executable).resolve()` `.venv/bin/python` 只是一个指向真正解释器的链接。实测解开后是 `/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/bin/python3.12`,uv 把 Python 装在你家目录下的这个位置。规则要允许执行的是这个真文件。
- `PY_HOME = Path(sys.base_prefix).resolve()` 解释器的安装目录,标准库 `json`、`urllib` 这些 `.py` 文件都在它下面。子进程启动时要读它们,所以要放行。我们只放行这一个目录,不是整个家目录。
- `(deny default)` 第一条规则:**默认什么都不许**。后面每一条 `allow` 都是在这堵墙上开一个小口。反过来写成「默认都许,再禁掉几个目录」也能跑,但漏写一个目录就漏一个,不如白名单稳。
- `(allow process-exec (literal "{PY}"))` 只许执行这一个程序文件。`literal` 是「正好这个路径」,`subpath` 是「这个目录和它下面所有东西」。
- `(allow sysctl-read)` 允许读系统信息(CPU 个数、系统版本这类),Python 启动时要用。
- `(allow file-read* (literal "/") (subpath "{PY_HOME}") (subpath "{WORK}")` 能读的范围:根目录 `/` 本身(只是这一个目录项,不含下面的东西)、Python 安装目录、工作目录。我一开始没写 `(literal "/")`,子进程一启动就崩,退出码 134,加上才好。
- `(subpath "/usr/lib") (subpath "/System")` 系统动态库在这两个地方,任何程序启动都要读。
- `(literal "/dev/null") (literal "/dev/urandom"))` 两个特殊文件。`/dev/urandom` 是系统随机数来源,Python 启动时要读它初始化哈希种子。
- `(allow file-write* (subpath "{WORK}"))` 只能写工作目录。注意规则里**没有任何 network 的 allow**,所以联网被 `deny default` 挡住。
- `t("读伪造的 .zshrc", lambda: open({str(FAKE)!r}).read().strip())` 外层是 f-string,`{str(FAKE)!r}` 把路径以带引号的形式拼进探测代码里。`!r` 相当于对它调用 `repr()`,得到 `'/Users/你/agent-zero-lab/sandbox_fake/home/.zshrc'` 这样一个合法的 Python 字符串字面量。
- `t("联网", lambda: urllib.request.urlopen("https://example.com", timeout=5).status)` `urllib.request` 是标准库里的 HTTP 客户端,相当于最朴素的 `fetch`。
- `env = {"PATH": "/usr/bin:/bin", "HOME": str(WORK)}` 子进程的环境变量**只给这两个**。你 `.env` 里的 `LLM_API_KEY`、终端里 export 过的任何东西都不会传过去。HOME 指向工作目录,子进程里 `Path.home()` 就是它。
- `for label, prefix in [("不关沙箱", []), ("sandbox-exec", ["/usr/bin/sandbox-exec", "-p", PROFILE])]:` 两次运行唯一的区别是命令前面有没有 `sandbox-exec -p 规则`。
- `done = subprocess.run([*prefix, str(PY), "-I", "-c", PROBE],` `*prefix` 把列表展开拼进去,相当于 JS 的 `[...prefix, py, "-I", "-c", probe]`。
- `capture_output=True, text=True, cwd=WORK, env=env, timeout=20)` `cwd=WORK` 让子进程在工作目录里启动,代码里写相对路径 `note.txt` 就落在这里。

</div>

```bash
uv run python -m part03.sandbox_try
```

```text
== 不关沙箱(退出码 0)
读伪造的 .zshrc 成功 export OPENAI_API_KEY=sk-fake-0000
写工作目录 成功 2
写工作目录外 成功 2
联网 成功 200
环境变量 成功 ['HOME', 'LC_CTYPE', 'PATH', '__CF_USER_TEXT_ENCODING']

== sandbox-exec(退出码 0)
读伪造的 .zshrc 失败 PermissionError
写工作目录 成功 2
写工作目录外 失败 PermissionError
联网 失败 URLError
环境变量 成功 ['HOME', 'PATH']
```

不关沙箱的那次,伪造的 key 被读了出来,工作目录外写进了一个 `x.txt`,example.com 返回了 200。这就是「执行模型的代码而不加沙箱」的样子:它读到的如果是你真正的 `~/.zshrc`,再配上能联网,一行 `urlopen` 就能把 key 发到任何地方。

关进沙箱以后,读外面的文件和写外面的文件都是 `PermissionError`,联网是 `URLError`(连域名都解析不了),只有工作目录能写。环境变量里那两个 macOS 自己补的 `LC_CTYPE`、`__CF_USER_TEXT_ENCODING` 也没了,因为补它们的系统组件被规则挡住了。

不关沙箱那次在 `sandbox_fake/home/` 下写了一个 `x.txt`,跑完删掉它:`rm sandbox_fake/home/x.txt`。

## 第三步:工具桥,子进程里的工具是桩

现在有了一个关得住的子进程,下一个问题是:模型的代码要调 `list_orders`,可子进程里没有这个函数,也不该有。真正的 `list_orders` 背后在真实项目里是数据库连接和 API key,这些东西进了沙箱,沙箱就白做了。

办法是**工具桥**(本课的叫法):在子进程里放一个同名的假函数,叫桩(stub),它不干活,只把「我要调 `list_orders`,参数是 `status='refunded'`」这句话通过 stdout 发给主进程;主进程收到后用注册表真正执行,把结果写进子进程的 stdin;桩读到这一行,解析成 Python 对象返回给模型的代码。对模型的代码来说,它就是调了一个普通函数。

前端有个很像的东西:Web Worker。Worker 里没有 DOM,要改页面就 `postMessage` 给主线程,主线程收到后去改,再把结果 `postMessage` 回来。工具桥就是用 stdin/stdout 当 `postMessage`。Anthropic 的程序化工具调用(Day 186 讲的 PTC)也是这个结构:代码在 Anthropic 的容器里跑,调工具时 API 暂停、把调用交给你执行。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="工具桥的一次往返:主进程启动子进程,子进程在 stdout 写工具请求,主进程执行后写回 stdin,其余 stdout 行是代码输出">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
  <rect x="50" y="18" width="180" height="38" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="140" y="36" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">主进程 run_code</text>
  <text x="140" y="50" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">有注册表、有 key</text>
  <rect x="410" y="18" width="180" height="38" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="500" y="36" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">子进程(sandbox-exec)</text>
  <text x="500" y="50" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只有桩,没有 key</text>
  <line x1="140" y1="56" x2="140" y2="250" stroke="var(--rule)"/>
  <line x1="500" y1="56" x2="500" y2="250" stroke="var(--rule)"/>
  <line x1="140" y1="82" x2="500" y2="82" stroke="var(--ink-soft)"/>
  <text x="320" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">启动:BRIDGE + 桩 + 模型的代码</text>
  <line x1="500" y1="116" x2="140" y2="116" stroke="var(--compute)" stroke-width="2"/>
  <text x="320" y="110" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">stdout: \0TOOL {"name":"list_orders",...}</text>
  <rect x="60" y="126" width="160" height="28" fill="var(--compute-wash)" stroke="var(--compute)" rx="3"/>
  <text x="140" y="145" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">registry.call 真执行</text>
  <line x1="140" y1="174" x2="500" y2="174" stroke="var(--compute)" stroke-width="2"/>
  <text x="320" y="168" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">stdin: 结果 JSON 一行(116 条订单)</text>
  <line x1="500" y1="208" x2="140" y2="208" stroke="var(--mem)"/>
  <text x="320" y="202" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">普通 print 行 → 收起来交给模型</text>
  <text x="320" y="240" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">进程退出 / CPU 超 5 秒 / 墙钟超 20 秒 → RunResult</text>
</svg>
<figcaption>工具桥的一次往返。116 条订单只在两个进程之间走一趟 stdin,从头到尾不进模型的上下文;回到模型的只有代码 print 的那几行。</figcaption>
</figure>

主进程怎么分清「这是工具请求」还是「这是代码正常 print 的一行」?约定一个前缀:工具请求那一行以 `\x00TOOL ` 开头。`\x00` 是空字符(编码为 0 的那个字符),正常代码几乎不可能 print 出以它开头的行。

完整的执行器在这里,沙箱规则直接用第二步那份。它是今天最核心的文件,慢慢读。

```python
# agent-zero-lab/part03/sandbox.py  执行器:模型的代码关在 sandbox-exec 里的子进程中跑,工具调用经「工具桥」回主进程执行
import inspect
import json
import resource
import subprocess
import sys
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path

from part03.agent_loop import ToolRegistry

LAB = Path(__file__).resolve().parent.parent
WORK_ROOT = LAB / "sandbox_work"          # 每次执行在这下面建一个临时目录,用完删掉
PY = Path(sys.executable).resolve()
PY_HOME = Path(sys.base_prefix).resolve()
TOOL_MARK = "\x00TOOL "                   # 子进程用这个前缀告诉主进程「我要调工具」

PROFILE = """(version 1)
(deny default)
(allow process-exec (literal "{py}"))
(allow sysctl-read)
(allow file-read* (literal "/") (subpath "{py_home}") (subpath "{work}")
                  (subpath "/usr/lib") (subpath "/System")
                  (literal "/dev/null") (literal "/dev/urandom"))
(allow file-write* (subpath "{work}"))
"""

BRIDGE = '''
import json, sys
def _call_tool(name, **kwargs):
    sys.__stdout__.write("\\x00TOOL " + json.dumps({"name": name, "args": kwargs}, ensure_ascii=False) + "\\n")
    sys.__stdout__.flush()
    return json.loads(sys.stdin.readline())
'''


def tool_stubs(registry: ToolRegistry) -> str:
    """给每个工具生成一个同名函数,函数体只是把调用转发给主进程。"""
    blocks = []
    for name, fn in registry.funcs.items():
        params = list(inspect.signature(fn).parameters.values())
        sig = ", ".join(p.name if p.default is inspect.Parameter.empty else f"{p.name}={p.default!r}" for p in params)
        kwargs = ", ".join(f"{p.name}={p.name}" for p in params)
        blocks.append(f"def {name}({sig}):\n    return _call_tool({name!r}, {kwargs})\n")
    return "\n".join(blocks)


@dataclass
class RunResult:
    stdout: str
    stderr: str
    tool_calls: int
    timed_out: bool
    returncode: int | None


def _limits() -> None:  # 在子进程里、开始执行之前运行
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))  # 最多 5 秒 CPU


def run_code(code: str, registry: ToolRegistry, timeout: float = 20, max_out: int = 2000) -> RunResult:
    if sys.platform != "darwin":
        raise RuntimeError("这个执行器用 macOS 的 sandbox-exec;Linux 换 bubblewrap,Windows 用 Docker,见文中说明")
    program = BRIDGE + tool_stubs(registry) + "\n# ---- 模型写的代码 ----\n" + code
    WORK_ROOT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=WORK_ROOT) as tmp, tempfile.TemporaryFile("w+") as err_file:
        work = Path(tmp).resolve()
        profile = PROFILE.format(py=PY, py_home=PY_HOME, work=work)
        proc = subprocess.Popen(
            ["/usr/bin/sandbox-exec", "-p", profile, str(PY), "-I", "-c", program],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err_file,
            text=True, cwd=work, preexec_fn=_limits,
            env={"PATH": "/usr/bin:/bin", "HOME": str(work), "PYTHONIOENCODING": "utf-8"},
        )
        assert proc.stdin and proc.stdout
        timer = threading.Timer(timeout, proc.kill)
        timer.start()
        out: list[str] = []
        calls = 0
        try:
            for line in proc.stdout:
                if line.startswith(TOOL_MARK):
                    req = json.loads(line[len(TOOL_MARK):])
                    calls += 1
                    result = registry.call(req["name"], json.dumps(req["args"], ensure_ascii=False))
                    proc.stdin.write(result + "\n")
                    proc.stdin.flush()
                else:
                    out.append(line)
            proc.wait()
        finally:
            timed_out = not timer.is_alive()  # 计时器已经触发过 = 超时被杀
            timer.cancel()
        err_file.seek(0)
        err = err_file.read()
    stdout = "".join(out)
    if len(stdout) > max_out:
        stdout = stdout[:max_out] + f"\n...(输出共 {len(stdout)} 字符,已截断,请只 print 需要的部分)"
    return RunResult(stdout, err[-1500:], calls, timed_out, proc.returncode)


if __name__ == "__main__":
    from part03.orders_tools import reg

    demo = 'rows = list_orders("refunded")\nprint(len(rows), rows[0])\nprint(get_city_manager("杭州"))'
    print(tool_stubs(reg))
    print(run_code(demo, reg))
    print(run_code("while True: pass", reg))
    print(run_code("import time; time.sleep(30)", reg, timeout=3))
    print(run_code("print(open('/etc/hosts').read()[:20])", reg))
```

<div class="line-notes">

- `import resource` 标准库,设置进程资源上限用,只在 macOS 和 Linux 上有。
- `import tempfile` 建临时目录、临时文件用,用完自动删。
- `import threading` 开一个计时线程做墙钟超时。
- `from part03.agent_loop import ToolRegistry` Day 168–170 的注册表,`funcs` 是「工具名 → 函数」的字典,`call(name, arguments)` 执行一个工具并返回 JSON 字符串,出错时返回 `{"error": ...}` 而不是抛异常。
- `WORK_ROOT = LAB / "sandbox_work"` 所有执行的临时目录都建在这下面,不会散落到系统别的地方。
- `TOOL_MARK = "\x00TOOL "` 工具请求的前缀。
- `PROFILE = """(version 1)` 和第二步一样的规则,只是路径改成 `{py}` `{work}` 这样的占位符,每次执行时用 `.format()` 填进本次的临时目录。这里是普通三引号字符串,不是 f-string,规则里的括号不用转义。
- `BRIDGE = '''` 这段字符串会被拼在模型代码前面,在子进程里执行。里面的 `\\x00` 和 `\\n` 写了两个反斜杠:外层字符串先把 `\\` 变成一个 `\`,子进程拿到的源码才是 `"\x00TOOL "` 和 `"\n"`。只写一个的话,外层就已经把它变成真正的空字符塞进了源码,而源码是当命令行参数传给子进程的,实测主进程在 `Popen` 那一行就报 `ValueError: embedded null byte`。
- `def _call_tool(name, **kwargs):` 所有桩都调它。`**kwargs` 把关键字参数收成一个字典,相当于 JS 里 `function f(name, opts)` 接一个对象。
- `sys.__stdout__.write(` 用 `sys.__stdout__` 而不是 `print`:`sys.stdout` 是模型代码可以改的(比如重定向到别处),`sys.__stdout__` 是进程启动时那个原始的 stdout,工具请求不会被吞掉。
- `sys.__stdout__.flush()` 立刻把这一行推给主进程。写到管道的输出默认会先攒在缓冲区里,不 flush 主进程就收不到,子进程却已经在下一行等回复了,两边互相等。常见误区里有实测。
- `return json.loads(sys.stdin.readline())` 阻塞读一行回复,解析成 Python 对象。主进程写回的是 `registry.call` 的返回值,本来就是 JSON,所以模型的代码拿到的是 list 和 dict。
- `params = list(inspect.signature(fn).parameters.values())` `inspect.signature` 读出真函数的参数列表,Day 169 生成 schema 时用过。
- `sig = ", ".join(p.name if p.default is inspect.Parameter.empty else f"{p.name}={p.default!r}" for p in params)` 有默认值的参数带上默认值,没有的只写名字。实测 `list_orders` 得到 `status='all'`,`get_city_manager` 得到 `city`。类型标注故意丢掉,子进程用不上它们(练习 1 会看到丢掉的代价)。
- `kwargs = ", ".join(f"{p.name}={p.name}" for p in params)` 拼出 `status=status`,把桩收到的参数原样转给 `_call_tool`。
- `blocks.append(f"def {name}({sig}):\n    return _call_tool({name!r}, {kwargs})\n")` 拼出一个函数的源码。实测打印见下面的输出。
- `class RunResult:` 一次执行的结果:输出、报错、工具调用了几次、是不是超时、退出码。`@dataclass` 是 [Day 50](/blog/agent-zero/day-050-dataclass/) 学的,自动生成 `__init__` 和打印格式。
- `resource.setrlimit(resource.RLIMIT_CPU, (5, 5))` 这个进程最多用 5 秒 CPU 时间,超了操作系统发 SIGXCPU 信号把它杀掉。(5, 5) 是软上限和硬上限。
- `if sys.platform != "darwin":` `darwin` 是 macOS 内核的名字。不是 macOS 就直接报错,而不是悄悄不加沙箱就跑。**宁可跑不起来,不可无沙箱运行**,这是今天最重要的一行防御。
- `program = BRIDGE + tool_stubs(registry) + "\n# ---- 模型写的代码 ----\n" + code` 子进程真正执行的源码 = 桥 + 桩 + 模型的代码。模型看不到桥,它只知道有几个函数可以调。
- `with tempfile.TemporaryDirectory(dir=WORK_ROOT) as tmp, tempfile.TemporaryFile("w+") as err_file:` 每次执行建一个全新的临时目录(名字类似 `sandbox_work/tmpk3x9a1/`),`with` 结束自动删除,上一次代码写的文件不会留给下一次。`err_file` 是存 stderr 的临时文件,原因在下面 `stderr=` 那一行。
- `work = Path(tmp).resolve()` 解开路径里的链接。规则里必须是真实路径,否则对不上。
- `profile = PROFILE.format(py=PY, py_home=PY_HOME, work=work)` 把本次的临时目录填进规则。工作目录每次不一样,所以规则每次现生成。
- `["/usr/bin/sandbox-exec", "-p", profile, str(PY), "-I", "-c", program],` 用绝对路径调 `sandbox-exec`,不靠 PATH 去找,防止被同名程序顶替。
- `stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err_file,` stdin 和 stdout 都接成管道,工具桥要靠它们来回传话;stderr 写进临时文件。为什么不也接管道?管道的缓冲区只有几十 KB,我们在循环里只读 stdout,如果代码往 stderr 写了一大堆东西把缓冲区写满,它就会卡住等人读,而我们在等 stdout,两边又互相等上了。写文件没有这个问题。
- `text=True, cwd=work, preexec_fn=_limits,` `preexec_fn` 在新进程启动之后、开始执行命令之前运行,所以 CPU 上限只加在子进程身上,主进程不受影响。
- `env={"PATH": "/usr/bin:/bin", "HOME": str(work), "PYTHONIOENCODING": "utf-8"},` 只给三个环境变量,没有任何 key。`PYTHONIOENCODING` 保证中文在管道里按 UTF-8 传。
- `assert proc.stdin and proc.stdout` 告诉类型检查器这两个一定不是 None(接了 PIPE 就一定有),否则下面 `.write` 会画红线。
- `timer = threading.Timer(timeout, proc.kill)` 20 秒后调用 `proc.kill` 杀掉子进程,相当于 JS 的 `setTimeout(() => child.kill(), 20000)`。CPU 上限管不住「不占 CPU 的卡住」,比如 `sleep` 或者等网络,所以还要这一层墙钟时间。
- `for line in proc.stdout:` 一行一行读子进程的输出,直到子进程退出、管道关闭。
- `if line.startswith(TOOL_MARK):` 是工具请求。
- `req = json.loads(line[len(TOOL_MARK):])` 去掉前缀,剩下的是 `{"name": "list_orders", "args": {"status": "refunded"}}`。
- `result = registry.call(req["name"], json.dumps(req["args"], ensure_ascii=False))` **真正执行工具的地方,在主进程里。**权限检查、日志、审批以后都加在这一层,练习 3 就在这里拦写操作。
- `proc.stdin.write(result + "\n")` 把结果写回子进程,末尾的换行让那边的 `readline()` 能读到完整的一行。116 条订单就是在这里走了一趟,8,212 个字符,不经过模型。
- `out.append(line)` 不是工具请求,就是代码的正常输出,攒起来。
- `timed_out = not timer.is_alive()  # 计时器已经触发过 = 超时被杀` 子进程自己结束时,计时器还在倒计时,`is_alive()` 是 True;计时器已经结束,说明它触发过 `kill`。
- `timer.cancel()` 子进程正常结束就取消计时器。放在 `finally` 里,中途出异常也会取消。
- `stdout = stdout[:max_out] + f"\n...(输出共 {len(stdout)} 字符,已截断,请只 print 需要的部分)"` 代码 print 太多时截断,并告诉模型怎么改。和截断工具结果不同,这里截掉的只是展示,数据本身还在执行环境里,模型下一段代码可以只 print 需要的部分。
- `return RunResult(stdout, err[-1500:], calls, timed_out, proc.returncode)` 报错只留最后 1,500 个字符,traceback 最有用的是末尾那几行。
- `print(run_code("while True: pass", reg))` 死循环,测 CPU 上限。
- `print(run_code("import time; time.sleep(30)", reg, timeout=3))` 不占 CPU 的卡住,测墙钟超时,这里把超时调成 3 秒省得等。
- `print(run_code("print(open('/etc/hosts').read()[:20])", reg))` 读一个系统文件,测文件规则。`/etc/hosts` 不在白名单里。

</div>

```bash
uv run python -m part03.sandbox
```

```text
def list_orders(status='all'):
    return _call_tool('list_orders', status=status)

def get_city_manager(city):
    return _call_tool('get_city_manager', city=city)

RunResult(stdout="116 {'id': 'O0001', 'city': '武汉', 'amount': 165.52, 'status': 'refunded'}\n{'city': '杭州', 'manager': '刘洋'}\n", stderr='', tool_calls=2, timed_out=False, returncode=0)
RunResult(stdout='', stderr='', tool_calls=0, timed_out=False, returncode=-24)
RunResult(stdout='', stderr='', tool_calls=0, timed_out=True, returncode=-9)
RunResult(stdout='', stderr='Traceback (most recent call last):\n  File "<string>", line 14, in <module>\nPermissionError: [Errno 1] Operation not permitted: \'/etc/hosts\'\n', tool_calls=0, timed_out=False, returncode=1)
```

一行一行对。生成的两个桩和预想的一样。第一个 `RunResult` 里 `tool_calls=2`,两次调用都走了桥,代码拿到了 116 条订单和杭州的负责人。

死循环那次退出码 `-24`。负数表示进程是被信号杀死的,24 就是 SIGXCPU(CPU 超限),整个脚本跑这一项要等 5 秒左右。`sleep(30)` 那次退出码 `-9`,9 是 SIGKILL,也就是我们的计时器调了 `proc.kill`,`timed_out=True`。

读 `/etc/hosts` 那次的报错里写着 `line 14`,可模型的代码只有一行。因为子进程执行的是「桥 + 桩 + 模型代码」拼起来的程序,前面 13 行是我们加的。模型看到的行号会偏,这个小问题我们先忍着;想修可以把桥和桩写进一个模块文件,让模型的代码单独编译。

## 第四步:接进 Agent 循环

执行器有了,把它接进一个循环。结构和 [Day 170](/blog/agent-zero/day-170-agent-full/) 的 `run_agent` 一样,只是「动作」从 `tool_calls` 换成了回复里的 python 代码块,「观察」从 tool 消息换成了代码的执行结果;回复里没有代码块就当作最终回答。

```python
# agent-zero-lab/part03/code_agent.py  代码即动作的 Agent 循环:模型回复里的 python 代码块就是动作
import inspect
import re
from typing import Any

from common.llm import LLMClient
from part03.agent_loop import ToolRegistry
from part03.sandbox import run_code, tool_stubs

FENCE = "`" * 3  # 三个反引号,直接写进源码会把文章的代码块提前截断
CODE_RE = re.compile(FENCE + r"python\n(.*?)" + FENCE, re.S)

SYSTEM = """你通过写 Python 代码来完成任务。下面这些函数已经定义好,直接调用,返回值是普通的 Python 对象:

{api}

规则:
1. 每次回复最多一个 python 代码块(用 {fence}python 开头、{fence} 结尾)。代码执行后,print 出来的内容会发给你看。
2. 数据的筛选、排序、求和都在代码里做,只 print 你需要看的结果,不要把整份数据打印出来。
3. 只能用 Python 标准库,不能联网,不能读写文件。
4. 信息够了就不要再写代码,直接用中文给出最终回答。"""


def api_doc(registry: ToolRegistry) -> str:
    docs = []
    for stub, fn in zip(tool_stubs(registry).split("\n\n"), registry.funcs.values()):
        header = stub.splitlines()[0].removesuffix(":")
        docs.append(f'{header}\n    """{inspect.getdoc(fn)}"""')
    return "\n".join(docs)


class CodeAgent:
    def __init__(self, registry: ToolRegistry, llm: LLMClient, max_steps: int = 6, extra_rule: str = "") -> None:
        self.registry = registry
        self.llm = llm
        self.max_steps = max_steps
        system = SYSTEM.format(api=api_doc(registry), fence=FENCE) + extra_rule
        self.messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
        self.tool_calls = 0

    def run(self, task: str) -> str:
        self.messages.append({"role": "user", "content": task})
        for step in range(1, self.max_steps + 1):
            r = self.llm.chat(self.messages)
            self.messages.append(r.message)
            m = CODE_RE.search(r.content)
            print(f"[step {step}] 输入 {r.prompt_tokens} tok | 输出 {r.completion_tokens} tok")
            if not m:  # 没写代码 = 最终回答
                return r.content
            res = run_code(m.group(1), self.registry)
            self.tool_calls += res.tool_calls
            print(f"    执行代码:工具调用 {res.tool_calls} 次,退出码 {res.returncode},输出 {len(res.stdout)} 字符")
            feedback = f"代码执行结果(退出码 {res.returncode}):\n{res.stdout or '(没有输出)'}"
            if res.stderr:
                feedback += f"\n报错:\n{res.stderr}"
            if res.timed_out:
                feedback += "\n代码超时被终止。"
            self.messages.append({"role": "user", "content": feedback})
        return f"到了最大步数 {self.max_steps} 还没做完"
```

<div class="line-notes">

- `from part03.sandbox import run_code, tool_stubs` 执行只走 `run_code`,这个循环里没有任何别的地方会执行模型的代码。
- `FENCE = ` 三个反引号,和 Day 186 `write_code_only.py` 里同一个技巧。
- `CODE_RE = re.compile(FENCE + r"python\n(.*?)" + FENCE, re.S)` 从回复里抠出第一个 python 代码块。`(.*?)` 是非贪婪匹配,遇到第一个结束的反引号就停;`re.S` 让 `.` 也能匹配换行,否则多行代码抓不到。相当于 JS 的 `/```python\n([\s\S]*?)```/`。
- `{api}` 这里会填进工具的函数签名和说明。
- `2. 数据的筛选、排序、求和都在代码里做,只 print 你需要看的结果,不要把整份数据打印出来。` 这条规则决定了代码模式省不省 token。模型要是第一步就 `print(list_orders("refunded"))`,116 条订单又回到上下文,白干。
- `3. 只能用 Python 标准库,不能联网,不能读写文件。` 沙箱本来就不让,提前告诉模型,省得它写了再撞墙浪费一轮。
- `for stub, fn in zip(tool_stubs(registry).split("\n\n"), registry.funcs.values()):` 把桩代码按空行切开,和注册表里的函数一一配对。`zip` 相当于把两个数组按下标配成对。
- `header = stub.splitlines()[0].removesuffix(":")` 取桩的第一行 `def list_orders(status='all'):`,去掉末尾冒号,当成给模型看的签名。
- `docs.append(f'{header}\n    """{inspect.getdoc(fn)}"""')` 签名下面配上工具原来的 docstring。实测生成的说明见下面的轨迹。
- `extra_rule: str = ""` 留一个口子往系统提示词末尾追加规则,练习 2 用它故意塞错误文档。
- `self.messages: list[dict[str, Any]] = [{"role": "system", "content": system}]` 对话历史,第一条是系统提示词。
- `r = self.llm.chat(self.messages)` 注意**没有传 `tools=`**。对模型来说这只是普通对话,工具都在系统提示词里以函数说明的形式出现。所以不支持 function calling 的模型也能跑这个循环。
- `self.messages.append(r.message)` 把模型的回复原样追加进历史。
- `if not m:  # 没写代码 = 最终回答` 结束条件。缺点是模型如果在最终回答里顺手贴了一段示例代码,会被当成动作执行。smolagents 要求模型调用 `final_answer()` 来结束,更严格。
- `res = run_code(m.group(1), self.registry)` `m.group(1)` 是正则里括号抓到的那段代码。在沙箱里执行。
- `feedback = f"代码执行结果(退出码 {res.returncode}):\n{res.stdout or '(没有输出)'}"` 执行结果作为一条 user 消息发回去。`res.stdout or '(没有输出)'` 是空字符串时用后面那个,相当于 JS 的 `||`。
- `feedback += f"\n报错:\n{res.stderr}"` 报错也发回去,模型看到 `TypeError` 会自己改代码,练习 2 实测。
- `return f"到了最大步数 {self.max_steps} 还没做完"` 和 `run_agent` 一样要有步数上限,代码模式也可能陷进「改代码、报错、再改」的圈子里。

</div>

## 第五步:同一道题,两种做法各跑三轮

JSON 那边直接用 Day 170 的 `run_agent` 和 Day 186 的 `json_mode.py` 里的题目和判卷函数,一行不改;代码这边用刚写的 `CodeAgent`。每一轮两边各用一个新的 `LLMClient`,账本分开记。

```python
# agent-zero-lab/part03/compare.py  同一道题:JSON 工具调用和写代码调用各跑一遍,比 token、调用次数和对错
import json
import sys

from common.llm import LLMClient
from part03.agent_loop import run_agent
from part03.code_agent import FENCE, CodeAgent
from part03.json_mode import SYSTEM, TASK, grade
from part03.orders_tools import ground_truth, reg

if __name__ == "__main__":
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    print("标准答案:", ground_truth())
    for k in range(1, runs + 1):
        print(f"\n######## 第 {k} 轮\n== JSON 工具调用")
        answer, a = run_agent(reg, SYSTEM, TASK, max_steps=6)
        print("判卷:", grade(answer), "|", a.ledger)

        print("== 写代码调用")
        b = LLMClient()
        agent = CodeAgent(reg, b)
        answer = agent.run(TASK)
        print(answer)
        print("判卷:", grade(answer), f"| 工具调用 {agent.tool_calls} 次 |", b.ledger)
        with open(f"code_trace_{k}.json", "w") as f:
            json.dump(agent.messages, f, ensure_ascii=False, indent=1)
        if k == runs:  # 最后一轮,把模型写的代码打印出来看看
            print("\n模型写的代码:")
            for m in agent.messages:
                if m.get("role") == "assistant" and FENCE + "python" in (m.get("content") or ""):
                    print(m["content"])
```

<div class="line-notes">

- `from part03.json_mode import SYSTEM, TASK, grade` 题目、JSON 那边的系统提示词和判卷函数都是 Day 186 的,保证两边考的是同一道题、用同一把尺子判。
- `answer, a = run_agent(reg, SYSTEM, TASK, max_steps=6)` JSON 做法,`run_agent` 里自己新建 `LLMClient`,返回回答和它的客户端,`a.ledger` 是这一轮的账。
- `agent = CodeAgent(reg, b)` 同一个注册表 `reg`,两边的工具和数据完全一样。
- `json.dump(agent.messages, f, ensure_ascii=False, indent=1)` 把代码模式每一轮的完整对话存成 `code_trace_1.json` 这样的文件,出了怪事回来翻。`ensure_ascii=False` 让中文原样存,不变成 `上`。
- `if m.get("role") == "assistant" and FENCE + "python" in (m.get("content") or ""):` 只挑模型写了代码的那几条回复打印。

</div>

```bash
uv run python -m part03.compare 3
```

DeepSeek `deepseek-flash`,思考关闭(课程默认的 `.env`),2026 年 10 月 22 日实测。代码模式的回答只留了第一轮的全文:

````text
标准答案: [('上海', 10731.38, '陈静'), ('广州', 8613.37, '李娜'), ('成都', 8137.58, '赵敏')]

######## 第 1 轮
== JSON 工具调用
[step 1] 输入 389 tok | 输出 49 tok
    调用 list_orders({"status": "refunded"}) -> 返回 8212 字符
[step 2] 输入 3931 tok | 输出 689 tok
    调用 get_city_manager({"city": "上海"}) -> 返回 31 字符
    调用 get_city_manager({"city": "广州"}) -> 返回 31 字符
    调用 get_city_manager({"city": "成都"}) -> 返回 31 字符
[step 3] 输入 4687 tok | 输出 159 tok
判卷: 上海错 广州错 成都对 | 3 次调用 | 输入 9007 / 输出 897 tokens | 约 ¥0.0152
== 写代码调用
[step 1] 输入 196 tok | 输出 88 tok
    执行代码:工具调用 4 次,退出码 0,输出 130 字符
[step 2] 输入 354 tok | 输出 131 tok
退款总金额最高的三个城市如下：

| 排名 | 城市 | 退款总额（元） | 区域负责人 |
|------|------|----------------|------------|
| 1 | 上海 | 10,731.38 | 陈静 |
| 2 | 广州 | 8,613.37 | 李娜 |
| 3 | 成都 | 8,137.58 | 赵敏 |

上海以 10,731.38 元位居退款总额首位，明显高于第二名的广州（8,613.37 元）；成都以 8,137.58 元排在第三。
判卷: 上海对 广州对 成都对 | 工具调用 4 次 | 2 次调用 | 输入 550 / 输出 219 tokens | 约 ¥0.0026

######## 第 2 轮
== JSON 工具调用
……(三步,和第 1 轮同样的调用)
判卷: 上海错 广州错 成都对 | 3 次调用 | 输入 8415 / 输出 598 tokens | 约 ¥0.0128
== 写代码调用
[step 1] 输入 196 tok | 输出 107 tok
    执行代码:工具调用 4 次,退出码 0,输出 130 字符
[step 2] 输入 373 tok | 输出 120 tok
判卷: 上海对 广州对 成都对 | 工具调用 4 次 | 2 次调用 | 输入 569 / 输出 227 tokens | 约 ¥0.0027

######## 第 3 轮
== JSON 工具调用
[step 1] 输入 389 tok | 输出 53 tok
    调用 list_orders({"status": "refunded"}) -> 返回 8212 字符
[step 2] 输入 3935 tok | 输出 1975 tok
    ……三次 get_city_manager
[step 3] 输入 5977 tok | 输出 189 tok
判卷: 上海对 广州对 成都对 | 3 次调用 | 输入 10301 / 输出 2217 tokens | 约 ¥0.0258
== 写代码调用
[step 1] 输入 196 tok | 输出 96 tok
    执行代码:工具调用 1 次,退出码 0,输出 0 字符
[step 2] 输入 309 tok | 输出 42 tok
    执行代码:工具调用 2 次,退出码 0,输出 25 字符
[step 3] 输入 374 tok | 输出 105 tok
    执行代码:工具调用 4 次,退出码 0,输出 130 字符
[step 4] 输入 549 tok | 输出 107 tok
判卷: 上海对 广州对 成都对 | 工具调用 7 次 | 4 次调用 | 输入 1428 / 输出 350 tokens | 约 ¥0.0044

模型写的代码:
```python
# 按城市汇总退款金额
refund = {}
for o in list_orders('退款'):
    refund[o['city']] = refund.get(o['city'], 0) + o['amount']

top3 = sorted(refund.items(), key=lambda x: x[1], reverse=True)[:3]
for city, total in top3:
    print(city, round(total, 2), get_city_manager(city))
```
```python
# 先看一下有哪些状态值
statuses = set(o['status'] for o in list_orders('all'))
print(statuses)
print(len(list_orders('all')))
```
```python
# 用实际状态值 'refunded' 重新汇总
refund = {}
for o in list_orders('refunded'):
    refund[o['city']] = refund.get(o['city'], 0) + o['amount']

top3 = sorted(refund.items(), key=lambda x: x[1], reverse=True)[:3]
for city, total in top3:
    print(city, round(total, 2), get_city_manager(city))
```
````

整理成表:

| 轮 | 做法 | 模型调用 | 工具调用 | 输入 token | 输出 token | 花费 | 三个金额全对 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | JSON | 3 | 4 | 9,007 | 897 | ¥0.0152 | 否 |
| 1 | 代码 | 2 | 4 | 550 | 219 | ¥0.0026 | 是 |
| 2 | JSON | 3 | 4 | 8,415 | 598 | ¥0.0128 | 否 |
| 2 | 代码 | 2 | 4 | 569 | 227 | ¥0.0027 | 是 |
| 3 | JSON | 3 | 4 | 10,301 | 2,217 | ¥0.0258 | 是 |
| 3 | 代码 | 4 | 7 | 1,428 | 350 | ¥0.0044 | 是 |

### 读这张表

**代码模式三轮全对,JSON 模式三轮对一轮。** JSON 那一轮对的,输出是 2,217 个 token,是另外两轮的两倍半到近四倍,和 Day 186 看到的一样:模型在回答里把加法一笔笔列出来,碰巧算对了,但贵。代码模式的求和是 Python 做的,`10731.38` 是算出来的,不是猜出来的。

**输入 token 差了 7 到 16 倍。** 代码模式第一轮一共 550 个输入 token,JSON 是 9,007。差在那 116 条订单:JSON 做法里它们进了上下文两次,代码做法里它们只在两个进程的管道里走了一趟。代码模式第一步的 196 个 token 里,大半是系统提示词和两个函数的说明。

**第一轮只用了两次模型调用,却调了 4 次工具。** 一段代码里先调 `list_orders`,再在循环里调三次 `get_city_manager`。JSON 做法里「先拿到列表才知道查谁」要分两个回合,代码里就是一个变量。

**第三轮最值得翻轨迹。** 模型第一段代码写的是 `list_orders('退款')`。`'退款'` 不是合法的状态值,可我们的工具不校验,直接返回空列表,于是代码跑完什么也没 print,退出码还是 0。模型看到「(没有输出)」,没有乱猜,而是写了第二段代码去查到底有哪些状态值,看到 `{'paid', 'refunded'}` 以后第三段改对了。多花了两轮,但最后是对的。

为什么 JSON 做法从没犯这个错?因为 Day 169 的注册表把 `Literal["paid", "refunded", "all"]` 变成了 schema 里的 `enum`,模型看得见这三个取值。而我们给代码模式生成的说明是 `def list_orders(status='all')`,类型标注在 `tool_stubs` 里被丢掉了,模型只能猜。工具说明写得越少,模型越会猜,这在 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 的原则四里讲过,换成代码模式照样成立。练习 1 把它补上。

**花费。** 三轮 JSON 一共 ¥0.0538,代码 ¥0.0097,差 5.5 倍。数据再多,这个差距只会更大,练习 4 会把订单加到 12,000 条看看。

还有一点表里看不出来:**代码模式多了一个沙箱要维护,多了一层失败方式。** 第三轮的空列表就是一种 JSON 模式里不会出现的错。所以「代码更好」只对这类拿大量数据做计算的任务成立。

## 沙箱边界:它挡住了什么,还挡不住什么

前面在第二步用一段探测代码看过沙箱。现在执行器、桥、限制都齐了,用一组「坏代码」把 `run_code` 的边界完整摸一遍。读写的目标仍然只是伪造的目录。

```python
# agent-zero-lab/part03/escape_test.py  拿几段「坏代码」试 run_code 的边界。读写只针对伪造目录 sandbox_fake/
from part03.orders_tools import reg
from part03.sandbox import LAB, run_code

FAKE = LAB / "sandbox_fake" / "home" / ".zshrc"
FAKE.parent.mkdir(parents=True, exist_ok=True)
FAKE.write_text("export OPENAI_API_KEY=sk-fake-0000\n")

tests = {
    "读环境变量": "import os; print(sorted(os.environ))",
    "读伪造家目录文件": f"print(open({str(FAKE)!r}).read())",
    "看文件在不在": f"import os; print(os.path.exists({str(FAKE)!r}))",
    "列伪造目录": f"import os; print(os.listdir({str(FAKE.parent.parent)!r}))",
    "写工作目录外": f"open({str(FAKE.parent / 'pwned.txt')!r}, 'w').write('x')",
    "联网": "import urllib.request; print(urllib.request.urlopen('https://example.com', timeout=5).status)",
    "起别的程序": "import subprocess; print(subprocess.run(['/bin/ls', '/'], capture_output=True).returncode)",
    "调不存在的工具": "print(refund_order('O0001'))",
    "参数写错": "print(list_orders(state='refunded'))",
    "吃内存": "x = bytearray(2 * 1024**3); print('分到了', len(x) // 1024**2, 'MB')",
}
for name, code in tests.items():
    r = run_code(code, reg)
    last = r.stderr.strip().splitlines()[-1] if r.stderr.strip() else ""
    print(f"{name}: 退出码 {r.returncode} | 输出 {r.stdout.strip()[:60]!r} | 报错末行 {last[:90]!r}")
```

<div class="line-notes">

- `from part03.sandbox import LAB, run_code` 只用今天的执行器跑,没有「关掉沙箱」的开关。
- `"看文件在不在": f"import os; print(os.path.exists({str(FAKE)!r}))",` 不读内容,只问「这个文件存在吗」。知道某个路径存在本身也是信息泄露,比如知道你机器上有 `~/Documents/某公司`。
- `"列伪造目录": f"import os; print(os.listdir({str(FAKE.parent.parent)!r}))",` 列出 `sandbox_fake/` 下有什么,相当于 `ls`。
- `"起别的程序": "import subprocess; print(subprocess.run(['/bin/ls', '/'], capture_output=True).returncode)",` 模型的代码自己再开一个子进程跑别的程序,这是绕过「只能用 Python」最常见的路子。
- `"调不存在的工具": "print(refund_order('O0001'))",` 注册表里没有 `refund_order`,所以连桩都没生成。
- `"吃内存": "x = bytearray(2 * 1024**3); print('分到了', len(x) // 1024**2, 'MB')",` 申请 2 GB 内存。`1024**3` 是 1024 的三次方,`**` 是乘方。
- `last = r.stderr.strip().splitlines()[-1] if r.stderr.strip() else ""` 只取报错的最后一行,就是异常类型和信息那一行。

</div>

```bash
uv run python -m part03.escape_test
```

输出里的长路径我换成了 `/Users/你/...`,90 个字符的截断保留:

```text
读环境变量: 退出码 0 | 输出 "['HOME', 'PATH', 'PYTHONIOENCODING']" | 报错末行 ''
读伪造家目录文件: 退出码 1 | 输出 '' | 报错末行 "PermissionError: [Errno 1] Operation not permitted: '/Users/你/agent-zero-lab/sandbox_fake/h"
看文件在不在: 退出码 0 | 输出 'False' | 报错末行 ''
列伪造目录: 退出码 1 | 输出 '' | 报错末行 "PermissionError: [Errno 1] Operation not permitted: '/Users/你/agent-zero-lab/sandbox_fake'"
写工作目录外: 退出码 1 | 输出 '' | 报错末行 "PermissionError: [Errno 1] Operation not permitted: '/Users/你/agent-zero-lab/sandbox_fake/h"
联网: 退出码 1 | 输出 '' | 报错末行 'urllib.error.URLError: <urlopen error [Errno 8] nodename nor servname provided, or not kno'
起别的程序: 退出码 1 | 输出 '' | 报错末行 'PermissionError: [Errno 1] Operation not permitted'
调不存在的工具: 退出码 1 | 输出 '' | 报错末行 "NameError: name 'refund_order' is not defined"
参数写错: 退出码 1 | 输出 '' | 报错末行 "TypeError: list_orders() got an unexpected keyword argument 'state'"
吃内存: 退出码 0 | 输出 '分到了 2048 MB' | 报错末行 ''
```

前八项都挡住了。环境变量里没有 key;读、列、写工作目录外都是 `PermissionError`;`os.path.exists` 对一个确实存在的文件返回 `False`,因为连「看一眼文件属性」都不被允许;联网连域名都解析不了;再开 `/bin/ls` 也被拒,因为规则里只许执行那一个 Python。后两项是我们想要的「好失败」:错误关在子进程里,变成模型看得懂的 `NameError` 和 `TypeError`。

**最后一项没挡住:代码拿到了 2 GB 内存。** 我试过在 `_limits` 里用 `resource.setrlimit(resource.RLIMIT_AS, ...)` 限制内存,macOS 上直接报 `ValueError: current limit exceeds maximum limit`,这个上限在 macOS 上设不了。Linux 上 `RLIMIT_AS` 是能用的。所以在这台 Mac 上,模型写一段申请 20 GB 的代码,能把你的电脑拖到卡死,只有 CPU 上限和墙钟超时兜底。

把它们放在一张图里,就是今天这个沙箱的形状:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="执行器的几层限制:sandbox-exec 管文件、网络、启动程序;rlimit 管 CPU;计时器管墙钟;环境变量白名单管密钥;工具桥管工具权限;内存和内核漏洞还没管">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="20" width="600" height="190" fill="none" stroke="var(--ink-soft)" rx="6"/>
  <text x="34" y="40" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">sandbox-exec(内核按规则检查每次系统调用)</text>
  <rect x="40" y="54" width="170" height="60" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="125" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">文件:只读写工作目录</text>
  <text x="125" y="96" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">连 exists 都看不到</text>
  <rect x="235" y="54" width="170" height="60" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="320" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">网络:全部禁止</text>
  <text x="320" y="96" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">DNS 都解析不了</text>
  <rect x="430" y="54" width="170" height="60" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="515" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">程序:只许那个 Python</text>
  <text x="515" y="96" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">/bin/ls 被拒</text>
  <rect x="40" y="128" width="170" height="64" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="125" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">rlimit:CPU 5 秒</text>
  <text x="125" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">计时器:墙钟 20 秒</text>
  <rect x="235" y="128" width="170" height="64" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="320" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">env 白名单</text>
  <text x="320" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">没有任何 key</text>
  <rect x="430" y="128" width="170" height="64" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="515" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">工具桥</text>
  <text x="515" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工具在主进程执行</text>
  <rect x="20" y="226" width="600" height="56" fill="none" stroke="var(--ink-faint)" stroke-dasharray="5 4" rx="6"/>
  <text x="320" y="248" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">还没管:内存(macOS 设不了 RLIMIT_AS)</text>
  <text x="320" y="268" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">和宿主共享内核 · 工具本身能做什么 · sandbox-exec 已标为弃用</text>
</svg>
<figcaption>今天这个执行器的几层限制。实线框里的都用坏代码实测过;虚线框里是它还挡不住的,上线前要换更强的隔离。</figcaption>
</figure>

除了内存,还有三件事要心里有数。

**它和你的电脑共享同一个内核。** `sandbox-exec` 的规则是内核在执行,规则写得再严,内核本身有漏洞就能绕过去。这对在自己电脑上跑练习够了,对「陌生人的请求进来、我替他执行任意代码」的线上服务不够。

**`sandbox-exec` 已经被苹果标为弃用。** 在终端里 `man sandbox-exec`,第一行就写着 `(DEPRECATED)`,苹果建议 App 改用 App Sandbox。它现在还能用,Codex CLI 和 Anthropic 的沙箱都还在用它,但规则语言没有公开文档,哪天系统更新改了行为,你只能靠实测发现。所以上面那个 `escape_test.py` 值得每次升级系统后再跑一遍。

**沙箱管不了工具本身。** `list_orders` 是在主进程里执行的,不受沙箱限制。代码里写个循环把 `refund_order` 调一百次,沙箱一点都不会拦,因为每次调用都是「合法」地走桥回主进程的。工具的权限只能在桥这一层管,练习 3 就做这件事。这也是工具桥结构真正的价值:**沙箱里只放代码,不放凭据和权限**,审批、日志、限流都留在主进程原来的位置上。

### Linux 和 Windows 怎么办,线上换什么

这一小节的命令我**没有实跑**,本机是 Mac、没有 Docker。

- **Linux**:用 bubblewrap(命令叫 `bwrap`),Anthropic 的 Claude Code 沙箱在 Linux 上用的就是它。思路和我们的规则一样:只把需要的目录挂进去,`--unshare-net` 断网,`--die-with-parent` 主进程退出时一起退出。大致是 `bwrap --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 --bind 工作目录 工作目录 --chdir 工作目录 --unshare-all --die-with-parent python3 -I -c 程序`。Linux 上 `RLIMIT_AS` 能设,内存也能限住。
- **Windows**:没有现成的等价物,最省事的是 Docker:`docker run -i --rm --network none --memory 256m --pids-limit 64 --read-only python:3.12-slim python -I -c 程序`,把 `run_code` 里的命令换成这一串、去掉 `preexec_fn`。容器同样和宿主共享内核。
- **线上**:用每个沙箱有自己内核的方案。E2B 用 Firecracker 微虚拟机,Modal 的 Sandbox 基于 gVisor,也可以用 Anthropic 托管的代码执行或 Cloudflare 的 V8 isolate(Day 186 讲过)。代码不在你的机器上跑了,stdin/stdout 的桥要换成别的通道,比如在沙箱里调一个你提供的 HTTP 回调。

不管换哪种,工具桥这个结构都不用变。

## 什么时候不该用

[Day 186](/blog/agent-zero/day-186-codeact-1/) 最后那一节说了判断的两个问题:数据需要穿过模型吗?组合方式能预先知道吗?今天跑完,再补三条实测里看到的东西。

一两步、结果很短的任务,老老实实用 JSON 工具调用。代码模式多一次执行、多一个沙箱、多一类失败(第三轮的空列表),收益几乎为零。

写操作不要开放给代码随便调。退款、发邮件、改数据库,一个 `for` 循环就能执行一百次。要么不放进代码能调的函数列表,要么在桥上强制拦截、改走审批。

工具说明要比 JSON 模式写得更细,不能更粗。JSON 模式里 schema 会自动带上 `enum`,代码模式里你给模型看什么它就只知道什么。

## 动手练习

### 练习 1:把丢掉的类型说明补回去

第三轮里模型写了 `list_orders('退款')`,原因是 `api_doc` 给的签名里没有取值范围。写一个 `api_doc_typed`,用 `inspect.signature` 原样输出带类型标注的签名,替换掉 `CodeAgent` 的系统提示词,跑三次,看第一段代码里写的是不是 `'refunded'`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/code_agent_typed.py  练习 1:给模型看的函数说明带上类型和取值,看「list_orders('退款')」还会不会出现
import inspect

from common.llm import LLMClient
from part03.agent_loop import ToolRegistry
from part03.code_agent import FENCE, SYSTEM, CodeAgent
from part03.json_mode import TASK, grade
from part03.orders_tools import reg


def api_doc_typed(registry: ToolRegistry) -> str:
    docs = []
    for name, fn in registry.funcs.items():
        sig = str(inspect.signature(fn)).replace("typing.", "")
        docs.append(f'def {name}{sig}\n    """{inspect.getdoc(fn)}"""')
    return "\n".join(docs)


if __name__ == "__main__":
    print(api_doc_typed(reg))
    for k in range(1, 4):
        llm = LLMClient()
        agent = CodeAgent(reg, llm)
        agent.messages[0]["content"] = SYSTEM.format(api=api_doc_typed(reg), fence=FENCE)
        answer = agent.run(TASK)
        first_code = agent.messages[2]["content"]
        print(f"第 {k} 次 | 第一段代码里写的是 {'refunded' if 'refunded' in first_code else '别的'} | 判卷:", grade(answer), "|", llm.ledger)
```

<div class="line-notes">

- `sig = str(inspect.signature(fn)).replace("typing.", "")` 签名对象转成字符串就是带类型标注的完整签名。有些情况下类型前面会带 `typing.` 前缀,去掉它让模型看得清爽。
- `agent.messages[0]["content"] = SYSTEM.format(api=api_doc_typed(reg), fence=FENCE)` 直接替换第一条系统消息,`CodeAgent` 本身不用改。
- `first_code = agent.messages[2]["content"]` `messages[0]` 是系统提示词,`[1]` 是任务,`[2]` 就是模型的第一条回复。
- `print(f"第 {k} 次 | 第一段代码里写的是 {'refunded' if 'refunded' in first_code else '别的'} | 判卷:"` 只检查第一段代码有没有用对状态值。

</div>

```bash
uv run python -m part03.code_agent_typed
```

```text
def list_orders(status: Annotated[Literal['paid', 'refunded', 'all'], '订单状态'] = 'all') -> list[dict[str, Any]]
    """按状态列出订单。每条订单有 id、city、amount(元)、status。"""
def get_city_manager(city: Annotated[str, "城市名,例如 '杭州'"]) -> dict[str, str]
    """查某个城市的区域负责人。"""
[step 1] 输入 246 tok | 输出 95 tok
    执行代码:工具调用 4 次,退出码 0,输出 152 字符
[step 2] 输入 425 tok | 输出 107 tok
第 1 次 | 第一段代码里写的是 refunded | 判卷: 上海对 广州对 成都对 | 2 次调用 | 输入 671 / 输出 202 tokens | 约 ¥0.0025
[step 1] 输入 246 tok | 输出 96 tok
    执行代码:工具调用 4 次,退出码 0,输出 130 字符
[step 2] 输入 412 tok | 输出 110 tok
第 2 次 | 第一段代码里写的是 refunded | 判卷: 上海对 广州对 成都对 | 2 次调用 | 输入 658 / 输出 206 tokens | 约 ¥0.0025
[step 1] 输入 246 tok | 输出 90 tok
    执行代码:工具调用 4 次,退出码 0,输出 130 字符
[step 2] 输入 406 tok | 输出 110 tok
第 3 次 | 第一段代码里写的是 refunded | 判卷: 上海对 广州对 成都对 | 2 次调用 | 输入 652 / 输出 200 tokens | 约 ¥0.0024
```

三次第一段代码都用了 `'refunded'`,都是两步完成。系统提示词多了 50 个 token(第一步 196 → 246),换来模型不用猜。三次不出错不能证明以后永远不出错(原来那版三轮里也只错了一次),要下结论得像 [Day 183](/blog/agent-zero/day-183-tool-design-3/) 那样多跑几遍数成功率。更稳的做法是两手都做:说明写清楚,工具里也校验参数,传了 `'退款'` 就返回 `{"error": "status 只能是 paid/refunded/all"}`,而不是安静地返回空列表。

第一次输出 152 个字符而不是 130,是那次模型 print 的格式稍有不同,不影响结果。

</details>

### 练习 2:看模型怎么从报错里恢复

用 `CodeAgent` 的 `extra_rule` 故意塞一条错误的文档:「list_orders 的参数名是 state」。跑一次,把模型每一步写的代码和收到的执行结果打印出来,找到它收到 `TypeError` 之后怎么改。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/wrong_doc.py  练习 2:故意给错文档,看模型怎么从 TypeError 里恢复
from common.llm import LLMClient
from part03.code_agent import CodeAgent
from part03.json_mode import TASK, grade
from part03.orders_tools import reg

llm = LLMClient()
agent = CodeAgent(reg, llm, extra_rule="\n5. 注意:list_orders 的参数名是 state,例如 list_orders(state='refunded')。")
answer = agent.run(TASK)
for m in agent.messages[2:]:
    text = m.get("content") or ""
    print(f"--- {m['role']}\n{text[:400]}")
print("判卷:", grade(answer), "|", llm.ledger)
```

<div class="line-notes">

- `agent = CodeAgent(reg, llm, extra_rule="\n5. 注意:list_orders 的参数名是 state,例如 list_orders(state='refunded')。")` 在系统提示词末尾追加第 5 条规则,和上面的函数签名互相矛盾,看模型信哪个。
- `for m in agent.messages[2:]:` 跳过系统提示词和任务,从模型的第一条回复开始打印。
- `print(f"--- {m['role']}\n{text[:400]}")` 每条只打前 400 个字符。

</div>

```bash
uv run python -m part03.wrong_doc
```

```text
[step 1] 输入 221 tok | 输出 109 tok
    执行代码:工具调用 0 次,退出码 1,输出 0 字符
[step 2] 输入 387 tok | 输出 109 tok
    执行代码:工具调用 4 次,退出码 0,输出 130 字符
[step 3] 输入 566 tok | 输出 133 tok
--- assistant
(代码第一行是 refunded = list_orders(state='refunded'),其余和正文第一轮一样)
--- user
代码执行结果(退出码 1):
(没有输出)
报错:
Traceback (most recent call last):
  File "<string>", line 14, in <module>
TypeError: list_orders() got an unexpected keyword argument 'state'

--- assistant
(同一段代码,只把第一行改成 refunded = list_orders(status='refunded'))
--- user
代码执行结果(退出码 0):
上海 10731.38 {'city': '上海', 'manager': '陈静'}
广州 8613.37 {'city': '广州', 'manager': '李娜'}
成都 8137.58 {'city': '成都', 'manager': '赵敏'}
……
判卷: 上海对 广州对 成都对 | 3 次调用 | 输入 1174 / 输出 351 tokens | 约 ¥0.0042
```

模型第一次信了错误的第 5 条规则,写了 `state=`。报错在桩函数那一层就被 Python 拦下来了(`tool_calls=0`,主进程的工具根本没被调用),`TypeError` 原样回到模型。模型下一步只改了一个参数名,别的都没动,第三步给出正确答案。这就是 CodeAct 论文说的「报错是现成的反馈」:解释器的错误信息比你自己设计的提示更清楚。

注意报错里的 `line 14`,模型的代码其实只有 8 行,行号偏了 13 行(桥和桩)。这次模型没被误导,但代码长了以后偏移的行号可能让它改错地方。

想一想:如果错的不是一条附加规则,而是函数说明本身写错了,模型就只能靠报错一点点试,每试一次多一轮。文档的质量还是第一位的。

</details>

### 练习 3:在工具桥上拦住写操作

给注册表加一个 `refund_order(order_id)` 工具(用一个列表假装退款系统)。先用一段「恶意」代码循环给 100 笔订单退款,直接用 `run_code` 跑,看退了多少;再写一个 `GuardedRegistry` 包住原注册表,写操作一律返回报错,同一段代码再跑一次。不调模型,不花钱。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/bridge_guard.py  练习 3:写操作工具在工具桥这一层拦住,代码里循环一百次也只会收到报错
import json
from typing import Annotated

from part03.agent_loop import ToolRegistry
from part03.orders_tools import reg
from part03.sandbox import run_code

REFUNDED: list[str] = []  # 假的「退款系统」,记下被退款的订单号


@reg.tool
def refund_order(order_id: Annotated[str, "订单号,例如 'O0001'"]) -> dict[str, str]:
    """给一笔订单退款。写操作,会真的退钱。"""
    REFUNDED.append(order_id)
    return {"order_id": order_id, "result": "已退款"}


class GuardedRegistry(ToolRegistry):
    """包一层:只读工具照常执行,写操作一律拒绝,让它去走人工审批。"""

    def __init__(self, inner: ToolRegistry, writes: set[str]) -> None:
        super().__init__()
        self.funcs, self.schemas, self.inner, self.writes = inner.funcs, inner.schemas, inner, writes
        self.blocked = 0

    def call(self, name: str, arguments: str) -> str:
        if name in self.writes:
            self.blocked += 1
            return json.dumps({"error": f"{name} 是写操作,代码里不能直接调用,请在最终回答里列出要退款的订单,交给人工审批"}, ensure_ascii=False)
        return self.inner.call(name, arguments)


if __name__ == "__main__":
    evil = "for o in list_orders('paid')[:100]:\n    r = refund_order(o['id'])\nprint(r)"
    raw = run_code(evil, reg)
    print("不拦:", raw.stdout.strip(), "| 工具调用", raw.tool_calls, "| 退款单数", len(REFUNDED))
    REFUNDED.clear()
    guarded = GuardedRegistry(reg, writes={"refund_order"})
    safe = run_code(evil, guarded)
    print("拦住:", safe.stdout.strip(), "| 工具调用", safe.tool_calls, "| 被拦", guarded.blocked, "| 退款单数", len(REFUNDED))
```

<div class="line-notes">

- `REFUNDED: list[str] = []  # 假的「退款系统」,记下被退款的订单号` 用一个列表模拟「钱真的退出去了」,数它的长度就知道退了几笔。
- `@reg.tool` 登记到 `orders_tools` 的同一个注册表上,`run_code` 生成桩时就会有 `refund_order`。
- `class GuardedRegistry(ToolRegistry):` 继承注册表([Day 42](/blog/agent-zero/day-042-classes-2/) 学的继承),只重写 `call`。`run_code` 只用到 `funcs` 和 `call`,所以把它传进去不用改执行器。
- `self.funcs, self.schemas, self.inner, self.writes = inner.funcs, inner.schemas, inner, writes` 工具清单直接借用原注册表的,桩照常生成,模型的代码以为能调。
- `if name in self.writes:` 名字在写操作名单里就不执行。这一行跑在**主进程**里,沙箱里的代码无论怎么写都绕不过它。
- `return json.dumps({"error": f"{name} 是写操作,代码里不能直接调用,请在最终回答里列出要退款的订单,交给人工审批"}, ensure_ascii=False)` 报错按 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 原则六写:告诉模型下一步该怎么做。
- `evil = "for o in list_orders('paid')[:100]:\n    r = refund_order(o['id'])\nprint(r)"` 模拟一段被注入、或者单纯理解错任务的代码:给前 100 笔已付款订单全部退款。

</div>

```bash
uv run python -m part03.bridge_guard
```

```text
不拦: {'order_id': 'O0140', 'result': '已退款'} | 工具调用 101 | 退款单数 100
拦住: {'error': 'refund_order 是写操作,代码里不能直接调用,请在最终回答里列出要退款的订单,交给人工审批'} | 工具调用 101 | 被拦 100 | 退款单数 0
```

不拦时一段三行的代码退了 100 笔,101 次工具调用(1 次列订单 + 100 次退款)全部合法地走桥执行,沙箱一次都没拦。拦住以后调用次数一样,但 100 次退款全部被桥拒绝,一分钱没退。这就是「沙箱管代码,桥管权限」。Anthropic PTC 文档里说 `allowed_callers` 不是安全边界,意思也在这:模型被引导着不去调,不等于调不了,真正的拦截要写在执行工具的那一侧。

</details>

### 练习 4:数据加到 12,000 条

Day 186 练习 1 把订单加到 1,200 条,JSON 做法输入涨到两三万 token、花费涨了五倍。用 `CodeAgent` 跑 1,200 条和 12,000 条,看输入 token 变不变。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/code_mode_big.py  练习 4:订单加到 1200 条、再到 12000 条,写代码做法的 token 变不变
import sys

from common.llm import LLMClient
from part03 import orders_tools
from part03.code_agent import CodeAgent
from part03.json_mode import TASK, grade

n = int(sys.argv[1]) if len(sys.argv) > 1 else 1200
orders_tools.ORDERS[:] = orders_tools._make_orders(n=n)
print("订单", n, "| 标准答案:", orders_tools.ground_truth())
llm = LLMClient()
agent = CodeAgent(orders_tools.reg, llm)
answer = agent.run(TASK)
print("判卷:", grade(answer), "|", llm.ledger)
```

<div class="line-notes">

- `orders_tools.ORDERS[:] = orders_tools._make_orders(n=n)` 和 Day 186 练习 1 一样原地替换列表,工具和标准答案都跟着变。
- `agent = CodeAgent(orders_tools.reg, llm)` 工具说明和题目都没变,变的只有数据量。

</div>

```bash
uv run python -m part03.code_mode_big 1200
uv run python -m part03.code_mode_big 12000
```

```text
订单 1200 | 标准答案: [('杭州', 26080.82, '刘洋'), ('西安', 24965.31, '周婷'), ('成都', 23051.19, '赵敏')]
[step 1] 输入 196 tok | 输出 111 tok
    执行代码:工具调用 4 次,退出码 0,输出 132 字符
[step 2] 输入 377 tok | 输出 127 tok
判卷: 杭州对 西安对 成都对 | 2 次调用 | 输入 573 / 输出 238 tokens | 约 ¥0.0028
订单 12000 | 标准答案: [('上海', 220770.75, '陈静'), ('西安', 220079.86, '周婷'), ('深圳', 218542.91, '张伟')]
[step 1] 输入 196 tok | 输出 104 tok
    执行代码:工具调用 4 次,退出码 0,输出 135 字符
[step 2] 输入 370 tok | 输出 96 tok
判卷: 上海对 西安对 深圳对 | 2 次调用 | 输入 566 / 输出 200 tokens | 约 ¥0.0025
```

400 条、1,200 条、12,000 条,代码做法的输入都在 550–573 之间,花费都是两三厘钱,全对。12,000 条时前三名之间只差几千元(220,770.75 对 220,079.86),换成心算基本没戏;JSON 做法在这个量级上光退款单就有三千多条,按 Day 186 的密度估算是十万 token 量级,单次请求就可能放不下(这一项我没跑)。数据在主进程和子进程之间走管道,12,000 条的那一行 JSON 有几十万字符,对管道来说不算什么。

</details>

**验收标准**:正文 `sandbox_try.py` 两次运行的对比和 `escape_test.py` 的十项结果你都能跑出来并解释;`compare.py` 三轮的表格填好,能说出代码模式为什么省 token、为什么算得对、第三轮多出来的两步是怎么回事;练习 1 第一段代码都用对状态值;练习 2 能在轨迹里找到 `TypeError` 和随后的修改;练习 3 拦截后退款单数为 0;练习 4 两个数据量的输入 token 基本不变。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 进程(process) | 操作系统里一个正在运行的程序,有自己的内存和编号(PID)。Chrome 每个标签页一个渲染进程 |
| 子进程 | 由当前程序启动的另一个进程,比如 `subprocess.run` 启动的那个 Python。相当于 Node 的 `child_process.spawn` |
| `subprocess` | Python 标准库,启动子进程、和它的 stdin/stdout/stderr 打交道 |
| stdin / stdout / stderr | 每个进程天生的三个通道:标准输入、标准输出(`print` 写这里)、标准错误(traceback 写这里) |
| 退出码(return code) | 进程结束时交给操作系统的整数,0 正常,正数是程序自己报错,负数在 Python 里表示被几号信号杀死 |
| `-I` 隔离模式 | Python 启动参数,不把当前目录加进模块搜索路径,忽略 `PYTHON*` 环境变量和用户 site-packages |
| 管道(pipe) | 两个进程之间传数据的通道,一边写一边读,缓冲区满了写的一方会卡住 |
| 工具桥 | 本课的叫法:沙箱里的工具函数只是桩,调用请求经 stdout 转发回主进程执行,结果经 stdin 送回 |
| 桩函数(stub) | 和真函数同名同参数,函数体只负责转发调用的假函数 |
| `sandbox-exec` | macOS 自带的命令,按一份规则(Seatbelt 规则)限制进程能读写的文件、能否联网、能启动什么程序。已被苹果标为弃用,但仍可用 |
| `(deny default)` | 沙箱规则的白名单写法:默认全部禁止,只放行列出来的 |
| rlimit | 操作系统给进程设的资源上限,`resource.setrlimit` 设置,今天用了 CPU 时间这一项 |
| SIGXCPU / SIGKILL | 操作系统发给进程的信号。24 号 SIGXCPU 表示 CPU 超限,9 号 SIGKILL 是强制杀死 |
| 墙钟时间(wall-clock time) | 墙上挂钟走过的时间,包括睡眠和等网络;CPU 时间只算真正在计算的时间 |
| bubblewrap | Linux 上的轻量沙箱工具(命令 `bwrap`),Claude Code 在 Linux 上用它 |

## 常见误区

**以为开了子进程就等于有了沙箱。** 子进程只是分开了内存,权限和你一样。第二步不关沙箱那次,伪造的 key 被读出来、外面写进了文件、example.com 返回 200。没有 `sandbox-exec` 这一层之前,一行模型的代码都别执行。

**桥里忘了 `flush()`。** 我把 `BRIDGE` 里那行 `sys.__stdout__.flush()` 删掉试了一次,调用 `get_city_manager("杭州")` 的代码卡了整整 5 秒,结果是 `RunResult(stdout='', stderr='', tool_calls=0, timed_out=True, returncode=-9)`:子进程的请求还在自己的缓冲区里没发出去,就开始等回复;主进程收不到请求,一直在等下一行。两边互相等,直到计时器把它杀掉。写到管道的输出默认是攒一批才发的,一问一答的协议每次都要 flush。

**stderr 也接成管道,却只读 stdout。** 代码往 stderr 写满几十 KB 的缓冲区就会卡住,主进程在等 stdout,又是互相等。今天的执行器把 stderr 写进临时文件,就是为了躲开这个坑。

**沙箱规则写成「默认允许,再禁掉几个目录」。** 能跑,但漏一个目录就漏一个。`(deny default)` 起手、一条条放行,启动不了就看缺什么再补,我第一版就是因为缺 `(literal "/")` 退出码 134 崩掉,补上就好。崩掉比漏掉好。

**以为 macOS 上能用 `RLIMIT_AS` 限内存。** 实测报 `ValueError: current limit exceeds maximum limit`,设不上。今天的执行器在 Mac 上没有内存限制,一段申请 2 GB 的代码照样成功。要限内存,Linux 上用 `RLIMIT_AS`,或者用 Docker 的 `--memory`。

**以为沙箱能管住工具。** 工具在主进程里执行,沙箱完全不知道。练习 3 里三行代码退了 100 笔,沙箱一次都没拦。写操作要在桥这一层拦。

**给代码模式的工具说明写得比 JSON 模式还简略。** JSON 模式里注册表自动把 `Literal` 变成 `enum`,代码模式里我们的 `api_doc` 把类型全丢了,模型写出了 `list_orders('退款')`,还因为工具不校验参数安静地拿到一个空列表。说明要写全,工具也要校验参数。

## 学习资料

### 文档与文章

- [Python 文档 · subprocess](https://docs.python.org/3/library/subprocess.html):看 `run`、`Popen`、`communicate` 三部分,以及文档里关于管道死锁的警告(搜 deadlock),英文。
- [Python 文档 · resource](https://docs.python.org/3/library/resource.html):`setrlimit` 和各种 `RLIMIT_*` 的含义,英文。
- [Python 文档 · 命令行与环境](https://docs.python.org/3/using/cmdline.html):搜 `-I`,看隔离模式到底关掉了哪些东西,英文。
- [Anthropic · Beyond permission prompts: making Claude Code more secure and autonomous](https://www.anthropic.com/engineering/claude-code-sandboxing):2025 年 10 月 20 日,讲 Claude Code 的沙箱为什么要同时做文件隔离和网络隔离,底层是 macOS Seatbelt 和 Linux bubblewrap;内部使用中权限弹窗少了 84%,英文。
- [OpenAI · Codex 安全文档](https://developers.openai.com/codex/security):Codex CLI 在 macOS 上用 `sandbox-exec -p` 加规则、在 Linux 上用 Landlock 和 seccomp,可以和今天的规则对照着看,英文。
- [Simon Willison · Codex 沙箱调查](https://simonwillison.net/2025/Nov/9/codex-sandbox-investigation/):他把 Codex 实际生成的 Seatbelt 规则翻出来逐条读,看真实产品里的规则长什么样,英文。
- [smolagents 文档 · Secure code execution](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution):本地受限解释器和 E2B、Docker、Modal 等远程执行器的对比,以及「本地沙箱不可能完全安全」那段,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14sorBiEgP&autoplay=0&high_quality=1" title="AI Agent的沙箱是什么？它和Docker容器/虚拟机有什么区别?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小白debug · AI Agent 的沙箱是什么?它和 Docker 容器、虚拟机有什么区别? · 7 分钟,把进程隔离、容器、虚拟机三种强度讲清楚,看完再回来读「沙箱边界」那一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13VdyBmEgb&autoplay=0&high_quality=1" title="Claude Code Sandbox 搞懂:安全+告别弹窗" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>乾坤下一站 · Claude Code Sandbox 搞懂:安全 + 告别弹窗 · 8 分钟,看一个真实产品怎么设文件和网络两道边界,和今天的规则是同一套思路。</figcaption>
</figure>

- 想看沙箱技术选型的,可以再看量子菠萝_《运行 AI Agent 该选哪种沙箱?Docker、gVisor 与 Firecracker 隔离对比》(BV1s9WF6zEm7),13 分钟。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/8hWb6yvcBCA" title="Sandboxing AI agents: from containers to gVisor, Firecracker and Kata" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>base case · Sandboxing AI agents: from containers to gVisor, Firecracker and Kata · 从容器讲到微虚拟机,看「共享内核」为什么是容器的软肋,英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bm6jegefGyY" title="Create a Python Sandbox for Agents to Run Code" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Trelis Research · Create a Python Sandbox for Agents to Run Code · 动手搭一个给 Agent 跑代码的 Python 沙箱,可以和今天的写法比一比,英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agent 部分把代码解释器列为一类重要工具,并讨论了让 Agent 执行代码的安全风险,英文。

### 开源项目与代码

- [anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime):Anthropic 开源的沙箱运行时(命令 `srt`),Claude Code 的沙箱用它,macOS 上生成 Seatbelt 规则、Linux 上用 bubblewrap,网络走代理过滤。它在 macOS 上默认允许读、再禁掉指定路径,和我们 `(deny default)` 的写法正好相反,可以想想各自的取舍。
- [containers/bubblewrap](https://github.com/containers/bubblewrap):Linux 上的 `bwrap`,README 里有参数说明。
- [huggingface/smolagents](https://github.com/huggingface/smolagents):`local_python_executor.py` 是另一种思路,不开进程,而是自己解释执行语法树,限制能用的操作。

## 自测

1. 子进程和沙箱是一回事吗?用今天的实测说明。

<details><summary>答案</summary>

不是。子进程只是另一个进程,内存分开了,权限没分开。`sandbox_try.py` 不关沙箱那次,子进程读出了伪造 `.zshrc` 里的 key、在工作目录外写了文件、联网拿到 200;加上 `sandbox-exec` 规则后,这三样分别变成 `PermissionError`、`PermissionError`、`URLError`。

</details>

2. 工具桥里,模型的代码调 `list_orders("refunded")` 时,数据是怎么走的?116 条订单经过模型的上下文了吗?

<details><summary>答案</summary>

桩函数 `list_orders` 调 `_call_tool`,往原始 stdout 写一行以 `\x00TOOL ` 开头的 JSON 请求并 flush,然后阻塞读 stdin;主进程识别出前缀,用注册表执行真正的 `list_orders`,把结果 JSON 一行写进子进程的 stdin;桩读到后解析成 list 返回。116 条订单只在两个进程的管道里走了一趟,没进模型的上下文,回到模型的只有代码 print 出来的三行。

</details>

3. 为什么已经有 CPU 时间上限,还要墙钟超时?为什么已经有沙箱,还要清空环境变量?

<details><summary>答案</summary>

CPU 上限只管真正在计算的时间,`time.sleep(30)` 或卡在网络等待上几乎不占 CPU,管不住,实测要靠计时器 `proc.kill`(退出码 -9)。清空环境变量是因为环境变量是进程启动时直接给它的,不经过文件读取,沙箱的文件规则拦不住;不清空的话 `os.environ` 里就有你的 API key。两层各管一件事,缺一不可。

</details>

4. 第三轮代码模式多走了两步,原因是什么?为什么 JSON 模式没犯同样的错?怎么修?

<details><summary>答案</summary>

模型写了 `list_orders('退款')`,工具不校验参数,返回空列表,代码什么都没 print。原因是 `tool_stubs` 丢掉了类型标注,给模型看的签名只有 `status='all'`,不知道取值只能是 paid/refunded/all;JSON 模式的 schema 里有 `enum`,模型看得见。修法两手都做:说明里带上类型和取值(练习 1),工具里校验参数,非法值返回明确的报错而不是空结果。

</details>

5. 面试题:你要上线一个「让模型写 Python 分析用户上传的数据」的功能。你会怎么设计执行环境?

<details><summary>答案</summary>

示范回答:执行环境和工具权限分开设计。执行环境用每个沙箱有独立内核的方案(Firecracker 微虚拟机或 gVisor,比如 E2B、Modal),默认断网、只挂本次任务的数据目录、限制 CPU、内存、墙钟时间和进程数,每次任务用新的沙箱、用完销毁;沙箱里不放任何凭据。需要访问内部系统时,用工具桥的结构:沙箱里只有桩,调用回到我们自己的服务执行,在那一层做权限检查、写操作审批、限流和审计日志。另外限制输出长度并提示模型只 print 需要的部分,报错原样回给模型让它自己改,设步数上限防止「改代码、报错、再改」停不下来。最后准备一组越权测试(读别的目录、联网、起子进程、吃内存、循环调写操作)放进 CI,每次升级镜像或依赖都跑一遍。

</details>

## 明天预告

明天是 **Day 188 · 第 27 周复习:工具与 Agent 循环(Day 182–187)**。这一周从「一个工具该怎么写」一路走到「工具多了怎么挂」「结果大了怎么办」,最后让模型写代码、在沙箱里执行。明天把六天串成一张图,默写本周最核心的两段代码(工具检索和工具桥),再做一个只用本周知识的小项目。
