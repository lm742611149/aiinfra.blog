import re
S = {
 'Python': r'python',
 '评测 Eval': r'evaluat|评估|测试集|\beval|评测|评估体系|评估指标|效果评估|benchmark|基准|回归测试|llm[- ]as[- ]a?[- ]?judge|测评',
 'RAG / 检索': r'\brag\b|检索增强|retrieval|向量检索|语义检索|混合检索|搜索增强|检索策略|召回|知识库|knowledge base',
 'LLM API / Function Calling / Tool Use': r'function[ _-]?call|tool[ _-]?(use|call)|工具调用|函数调用|调用工具|api 调用|api调用|llm api|openai api|大模型\s*api',
 '部署 / Docker / K8s / 云': r'\bcloud\b|docker|kubernetes|\bk8s\b|容器化|部署|\baws\b|\bgcp\b|azure|云原生',
 'Context Engineering / 记忆': r'上下文|context engineering|context window|context management|long context|记忆|memory',
 '高并发 / 分布式': r'高并发|分布式|distributed|scal(able|ability|e)|高可用|微服务|microservice',
 'Prompt 工程': r'prompt|提示词|提示工程',
 'Agent 框架(LangChain/LangGraph/LlamaIndex/AutoGen/CrewAI)': r'agent\s*(框架|framework)|智能体框架|claude agent sdk|langchain|langgraph|llama[ _-]?index|autogen|crewai|semantic kernel|dify|coze|agents? sdk',
 '面向客户 / 交付': r'客户|交付|customer|client-facing|\bclients?\b|forward deployed|deployment engineer',
 '成本 / 延迟 / ROI': r'成本|cost|延迟|latency|\broi\b|时延|耗时|token 用量|token用量',
 'SQL / 数据系统': r'\bsql\b|mysql|postgres|数据库|database|data pipeline|data warehouse|snowflake|bigquery|\betl\b|数据仓库|clickhouse',
 '可观测 / Tracing': r'tracing|\btraces?\b|可观测|observab|opentelemetry|langsmith|langfuse|链路追踪',
 '多 Agent': r'multi[- ]?agent|多\s*agent|多智能体|多个智能体|agent\s*协作|智能体协作',
 '全栈 / 前端': r'全栈|前端|full[- ]?stack|frontend|front-end|react|vue',
 'TypeScript/JS': r'typescript|javascript|\bts\b|node\.?js|\bjs\b',
 '向量数据库': r'向量(数据)?库|向量检索|vector|milvus|faiss|chroma|pinecone|weaviate|qdrant|pgvector|elasticsearch',
 'Go': r'\bgo\b|golang',
 '微调 / RL': r'微调|fine[- ]?tun|\bsft\b|\brlhf\b|\bdpo\b|lora|强化学习|reinforcement',
 'MCP': r'\bmcp\b|model context protocol',
 '熟练用 Coding Agent(Claude Code/Cursor/Codex)': r'claude code|cursor|codex|coding agent|ai 编程|ai编程|vibe cod|windsurf',
 '安全(注入/权限/沙箱)': r'注入|沙箱|权限隔离|最小权限|安全(机制|模型|策略|防护|审计|边界|合规)|injection|sandbox|guardrail|prompt security|\bsecurity\b',
 'Java': r'\bjava\b',
 'Skills': r'agent skills?|claude skills?|skill\.md|skills?\s*(体系|机制|开发|系统|框架|生态)|(mcp|工具|插件)\s*[、/与和,]\s*skills?|skills?\s*[、/与和,]\s*(mcp|工具|插件)',
 '产品意识': r'产品意识|产品思维|产品sense|product sense|产品嗅觉',
 'Computer / Browser Use': r'computer[ _-]?use|browser[ _-]?use|浏览器自动化|浏览器 agent|playwright|selenium|gui agent|操作电脑',
 '语音 Agent': r'语音\s*agent|voice agent|语音智能体|\btts\b|\basr\b',
}
C = {k: re.compile(v, re.I) for k, v in S.items()}
def tag(text):
    return [k for k, rx in C.items() if rx.search(text or '')]
