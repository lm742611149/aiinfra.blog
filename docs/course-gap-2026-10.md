# Agent 课程缺口清单(2026-10-22)

来源三路:①对照 13 份公开课程/书目录(HF Agents/MCP、DLAI、Berkeley MOOC、LangChain Academy、Anthropic Academy、Hamel evals、Chip Huyen《AI Engineering》、Microsoft AI Agents for Beginners、Kaggle 5-Day、OpenAI Cookbook、极客时间、ai-agents-from-zero、慕课);②2026-06~10 新发布;③docs/jd-research 881 条 JD 正文词频 vs 课程提及次数。已 grep 核对过课程正文,已覆盖的不列。

## A. 建议新开一课

| # | 主题 | 证据 | 建议位置 |
|---|---|---|---|
| 1 | Agent Skills(SKILL.md、渐进加载、分发、恶意技能风险) | Anthropic Academy、DLAI、Kaggle 2026 版、极客时间等 5 家;40+ 客户端采用;JD 国内 10% | Day 23 后 |
| 2 | 代码即动作:CodeAct / Cloudflare Code Mode / Programmatic Tool Calling + 沙箱实操(E2B/Modal/Daytona 选型) | HF Unit 2、DLAI Agentic AI M3/M5;Code Mode 输入 token −78% | Day 11–12 之间 |
| 3 | 工具多了怎么办:Tool Search / 延迟加载 / 工具检索 | Anthropic advanced tool use;课程仅 1 处提及 | 并 2 或紧随其后 |
| 4 | 用 coding agent 干活:CLAUDE.md/AGENTS.md、hooks、headless+CI、Spec Kit 1.0(08-21)、harness engineering | Anthropic Claude Code 课、DLAI 4 门;JD 国内 21% | Day 14 后 |
| 5 | GraphRAG / 知识图谱(含代码图) | DLAI×3、慕课 1013、极客时间;JD 36 条、课程 0 | Day 18 后 |
| 6 | Text-to-SQL / 问数 ChatBI Agent | DLAI Data Agents、ai-agents-from-zero;JD「数据分析」46 条 | 小项目(仿 Day 28) |
| 7 | 自动 prompt 优化:DSPy / GEPA / ACE | DLAI DSPy、Berkeley、ICLR 2026 两篇;课程 0 | Day 35 后 |
| 8 | 多模态:视觉理解、文档解析(OCR/版面/MinerU/Docling)、多模态 RAG | DLAI Document AI、Berkeley;JD 60 条、课程只 6 处 | Day 21 前后 |
| 9 | Guardrails 分层防御(输入/输出分类器、Llama Guard/Qwen3Guard、moderation) | DLAI、OpenAI 实战指南、MS 两课;JD 49 条 | Day 39–40 之间 |
| 10 | 事件驱动 / 后台 Ambient Agent(webhook、邮件、cron 触发,Agent Inbox 审核) | LangChain Ambient Agents、DLAI LlamaIndex、HF MCP U3 | Day 25 后 |
| 11 | 上线后反馈闭环 / 数据飞轮(显隐式反馈→badcase→测试集→改进) | Chip 第 10 章、LangSmith Engine、OpenAI Cookbook | Day 71 附近 |
| 12 | 推理模型与 test-time compute(thinking budget、self-consistency、ToT/LATS) | Berkeley 三讲 + Denny Zhou | Day 10 后或并 Day 75 |
| 13 | 低代码平台实操:Dify / 扣子 3.0 / 百炼 / n8n,何时转代码;OpenAI Agent Builder 11-30 停用当反例 | 慕课 2 门、ai-agents-from-zero;JD Dify 76 条 | 短课,Day 27 后 |
| 14 | 生成式 UI:MCP Apps vs A2UI vs AG-UI | MCP 首个官方扩展;A2UI v0.9;课程 0;前端背景加分 | Day 94 扩成整课 |
| 15 | Agent 支付:AP2 / ACP / x402 / UCP 三层 | x402 Foundation 04-02;课程 0 | 进阶篇新课 |
| 16 | Agent 供应链安全:MCP rug pull、Deadbugz、恶意 Skills、OpenClaw 案例 | 91.8% 公网 MCP 无鉴权 | Day 40 后 |
| 17 | 中国智能体合规:《智能体规范应用与创新发展实施意见》(05-08)、拟人化互动办法(07-15 施行)、GB/Z 185 智能体互联、AI 内容标识、清朗专项 | 网信办一手 | 从 Day 86 拆出 |
| 18 | Java / Go 生态 Agent:Spring AI、LangChain4j、Eino、ADK Go 2.0 | JD 国内 Java 23%、Go 23%;课程几乎全 Python | 选修 |
| 19 | 托管 Agent 运行时:Claude/Gemini Managed Agents、Bedrock AgentCore、Vertex(自建 vs 租) | Kaggle Day 5、LangSmith Deployment、MS | Day 41 前后 |
| 20 | TS 生态:Mastra 1.0(Durable Agents)、Vercel AI SDK 6 | JD 海外 TS 34% | 选修,配 Day 49 |
| 21 | Agent 身份与委托授权:OBO、AAuth、AIMS(SPIFFE) | IETF 草案 07/08 | Day 84 后 |
| 22 | WebMCP:网站直接给浏览器 agent 暴露工具 | Chrome 149 origin trial | Day 90 后 |

## B. 并进现有课

- Day 22/23:MCP 2026-07-28 规范里还没写的 `Mcp-Method`/`Mcp-Name` 头、tasks 扩展、`ttlMs`;写一个最小 MCP client/host;Gradio `mcp_server=True` + HF Spaces 部署
- Day 13:reflection 用外部反馈(编译器/测试/SQL 执行结果)而非自评
- Day 18:代码库 RAG(AST 切块、repo map);递归语言模型 RLM 做对照
- Day 26:subagent 只为省上下文(和多 Agent 分工不同);Claude Agent SDK fork/嵌套子 agent 上限
- Day 27:Google ADK 2.0、Microsoft Agent Framework 1.0(AutoGen 进维护)、Pydantic AI v2、LangGraph 1.2/Deep Agents 0.7、smolagents、CrewAI
- Day 31/32/70:维度组合生成合成数据、人工标注工具与一致性、judge 用 TPR/TNR 对齐
- Day 38/75:Advisor 模式(便宜模型执行、强模型顾问)
- Day 62:Deep Agents(todo、虚拟文件系统)、planner/generator/evaluator 三角色长任务 harness、OpenAI harness engineering
- Day 63:context editing / server 端 compaction / memory tool 的分工
- Day 73:Terminal-Bench 2.x、τ²/τ³-bench、OSWorld 2.0、LongMemEval-V2;拿 GAIA 当期末打榜题
- Day 77:function calling 微调的数据格式与 chat template;训练数据清洗去重
- Day 85:OTel GenAI agent span(invoke_agent/execute_tool,仍是 Development 状态)
- Day 87:OpenClaw CVE-2026-25253 当复盘案例
- Day 90:浏览器 agent 注入(PleaseFix)、视觉 agent
- Day 93:A2A v1.0 破坏性变更核对
- Day 1/57:Transformer / 注意力 / MoE 面试够用版
- Day 54:Gradio/Streamlit/HF Spaces 快速上线 demo
- Day 56/59:LangChain LCAE 认证
- Day 106:AI 立项、build vs buy、ROI
- 行业速览(新加一段或一课):金融/医疗/电商客服各一例(JD 43/21/20 条)
- 中间件位置图:Milvus/ES/Kafka/Redis 在 agent 系统里各干什么(JD 常见,课程少)
