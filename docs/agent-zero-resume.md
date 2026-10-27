# agent-zero 续写手册(新会话从这里接)

用户说「继续写 agent-zero」或「额度 reset 了」时:
1. 跑下面的脚本算每条流的下一组起点(看 src/content/blog/agent-zero/ 已有哪些天):
   ```
   cd ~/Documents/blog/src/content/blog/agent-zero && python3 -c "
   import os,re
   d=set(int(re.match(r'day-(\d+)',f).group(1)) for f in os.listdir('.') if f.startswith('day-'))
   R=[(0,35),(36,70),(71,106),(107,141),(142,177),(178,212),(213,248),(249,283),(284,319),(320,355),(356,390),(391,426),(427,461),(462,497),(498,532),(533,568),(569,603),(604,639),(640,674),(675,710)]
   for a,b in R:
       x=a
       while x<=b and x in d: x+=1
       print(a,b,x if x<=b else 'done')"
   ```
2. 每条流派 1 个 general-purpose 写手,一次写起点开始的连续 3 天。**10-27 起的定法**:写手一律 sonnet(model: "sonnet"),5 个并发;**挑写得最少的 5 条流**(脚本算完按已写篇数排序);**每组 API 硬上限 ¥2**,**模型只用 deepseek-flash(10-27 用户定:禁止调 deepseek-v4-pro 等大模型,需要大小模型对比的天引用已有结果或标「没实跑」,提示词里必须写明)**,提示里写明「先小样本调通再放大、快到上限就停用已有数据写」;周复习日先确认要汇总的 6 天都已写好;涉及注入/执行命令/读文件/支付的天加安全红线(只打 127.0.0.1 假服务和假机密、不碰真钱/真钱包/主网/真私钥、不读家目录和真实仓库)。(Fable 试写批 10-27 已用 sonnet 补完,对比没做成。)交稿后主会话:check-course 全量 + grep /Users/minliu、Documents/nue → 抽读一篇(篇幅/逐行讲解/代入数据/实跑/「没实跑」标注)→ 把拆天建议/接口约定/待修追加到 docs/agent-zero-split-notes.md → 一起 commit+push。**DeepSeek 余额 10-27 约 ¥25**,每轮约 ¥2–5,低于 ¥10 提醒用户充值;硅基流动只有 bge-m3/bge-reranker 等免费模型能用,余额不足(Batch 会 402)。
3. 5 小时额度用完就停,等用户说 reset 再继续。定期 `git add src/content/blog/agent-zero docs/ && git commit && git push` 备份(全是 draft:true,线上不显示)。
4. 写手提示词模板(把 A/B/C 和子目录名换掉;涉及执行命令/浏览器的天加安全红线一句):

> 你是课程写手。课程是 ~/Documents/blog 里的「AI Agent 工程师:从零到资深」(series agent-zero),你负责 Day A、Day B、Day C 三篇(按顺序)。先看 src/content/blog/agent-zero/ 里这几天是否已有文件(可能是上一个写手中断留下的半成品),有就检查补完,没有就新写;前一两天已写好的先读,保持代码/文件名衔接,衔接约定见 docs/agent-zero-split-notes.md 里的相关条目。
> 必读:①docs/course-writing-guide-zero.md 全文(最高优先级,含 0 基础规则、frontmatter、实跑约定与安全红线、5.1 共享模块接口、并行约定);②docs/course-writing-guide-agent.md 的 3.0、3.1、4.1–4.3 节;③docs/agent-zero-outline.md 第 1 节和第 2 节里这三天及前后各 3 天的行;④大纲「来源」列提到的旧课小节。
> 用 ToolSearch 加载 WebSearch/WebFetch 查证。DeepSeek 只用 deepseek-flash,不准调 deepseek-v4-pro 或其他大模型;API 花费硬上限 ¥2,先小样本调通再放大。代码在 scratchpad 下只属于你的子目录 `wA/` 里实跑,别碰别人的目录,不写用户真实目录;文中路径写 /Users/你。Postgres 只在你新建的库里操作。不 git commit,只动这三篇。
> 写完跑 `python3 scripts/check-course.py --series=agent-zero` 修自己文件的问题。汇报不超过 8 行:文件名、汉字数、花费、没实跑的、建议拆天、假设的前置。

安全红线(执行命令/读写文件/浏览器类 Agent 的天必须加):第一版就关在 scratchpad 子目录(sandbox-exec 或工具层限定路径),绝不能读到用户家目录、~/Documents/nue 或真实仓库;演示「没沙箱」只用伪造目录。

## 全部写完后的收尾
见 docs/agent-zero-split-notes.md:统一拆天建议(可能新增天→重跑大纲生成脚本重新编号)、修各条「待修」、全量 grep /Users/minliu 与 Documents/nue、核对 LLMClient/embed 路径一致(part04/embed.py vs common/embed.py)、去 draft、切 COURSE_SERIES 和目录页到 agent-zero、旧 agent-60 做 301(映射在大纲第 3 节)、npm run og、build、推送;清理写手留下的 Postgres 库(w252kg、w255eval、w258eval、agentzero_w56/w57、sp_zero_w465/w468 等)、8080 的 restate-server、scratchpad Redis;告诉用户可删 ~/Library/Caches/ms-playwright 新增浏览器和 ~/Library/pnpm/store。
