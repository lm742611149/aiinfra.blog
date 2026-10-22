# agent-zero 写手建议(拆天/衔接/待办),写完全部后统一处理

- Day 214 偏重(ndarray+向量化+点积范数+二维表/axis/广播),建议把「几篇文章叠成一张表」拆成单独一天;Day 215 的 keepdims/.T 挪到 Day 218。
- Day 213–215 假设 Day 212 建好 agent-zero-lab/part04/,例子用《退款政策》「买错了能把钱要回来吗」。
- Day 38 超概念(open 模式+编码+缓冲+with),建议把编码/UnicodeDecodeError+read_text/write_text 拆出。Day 36 自定义异常用了 class(Day 40 才讲)当模板交代。Day 36–38 假设 Day 35 slug day-035-exceptions-1、Day 10 建 agent-zero-lab 根、part01/、工单字段 id/title/amount(金额字符串)。
- Day 1 讲了薪资口径+中位数/P25/P75+诚实预期+正则,建议「诚实预期」拆一天;Day 2 软件清单+token×单价偏满,token 实测可挪 Day 107。Day 0–2 代码都是 JS(浏览器 Console),云/GPU/embedding 价格是旧课二手。引用站内非课程文章 /blog/agent-jd-report-2026-10/ /blog/frontend-to-agent-engineer/。
- Day 640 放了旧 106「评审:怎么接住质疑」(大纲漏了),偏长,建议拆一天或并进 645。Day 640–642 假设 common/llm.py LLMClient 有 chat/ledger/cost/cache_hit_tokens/latency。旧 107「500 万/天=5.8 QPS」算错,实为 57.9,新课已改。
- Day 500 两个独立概念(诚实改写+检查脚本 / 年限学历门槛正则),建议拆;Day 498 正则词边界坑可拆半天。Day 498–500 假设 Day 491 有 supportpilot/docs/results.md、part09/。
- 10-22:多个写手在 scratchpad 共享 agent-zero-lab 里互相覆盖过 common/llm.py;已在规范 5.1 定 LLMClient 唯一蓝本=旧 lab common/llm.py。最后一致性检查要核对各篇 LLMClient 用法。
- Day 73 超概念(fixture/yield/tmp_path/conftest/scope+parametrize),建议拆两天。Day 71–73 约定:tests/ 目录;pyproject 用 pytest 9 的 [tool.pytest] + pythonpath=["."] + testpaths=["tests"];part01/cost.py 有 total_cost(负数检查)、total_from_file;tests/conftest.py 有 flash_peak/flash_idle/usage_file。假设 Day 33 建 part01/__init__.py 并用 -m 运行、Day 70 是天气 CLI。大纲 Day 10 的 agent-60-lab 已改为 agent-zero-lab。
- Day 109 超概念(窗口/截断/长上下文),建议把「窗口大≠用得好」拆一天。Day 108 实测:DeepSeek 分词下中文比英文省 22%,cl100k 下中文贵 35%(标题回答改为分情况)。分词器存 data/deepseek_v4_tokenizer/。大纲「要实跑」列里残留旧路径 w1/ 等,以规范 partNN/ 为准。
- Day 143 偏重(标签分隔+注入实验+预填,5 道练习),建议拆「标签分隔与注入」「预填与固定开头」。提示词文件命名 refund_cot_v1.md 格式(Day 145 要知道)。Day 142–144 假设 part02/ 存在。
- Day 358 超概念,建议拆「标注与三指标」「对齐迭代与修正通过率」。Day 356–358 假设:Day 350 判题器 part06/oracle.py 的 expected_refund(大纲写 judge.py);LLM 评分器 part06/llm_judge.py;Day 280 建 cloudledger/seed.py→cloudledger/cloudledger.db;Day 346 有 Streamlit 标注页;.env 有 LLM_EXTRA_BODY。
