// Week structure of the agent-60 course, shared by the course index and the post layout.
export const weekOf = (day: number) => {
	if (day === 0) return 0;
	if (day <= 42) return Math.ceil(day / 7);
	if (day <= 54) return 7;
	if (day <= 60) return 9;
	if (day <= 95) return 10 + Math.floor((day - 61) / 7);
	if (day <= 105) return 15;
	if (day <= 110) return 17;
	if (day <= 120) return 18;
	return 20;
};

/** Day 61 onward is the senior track. */
export const isAdvanced = (day: number) => day >= 61;

export const WEEK_TITLES: Record<number, string> = {
	0: '序章',
	1: 'W1 地基:大模型与 API',
	2: 'W2 工具调用与 Agent 循环',
	3: 'W3 上下文工程与 RAG',
	4: 'W4 MCP、框架与多 Agent',
	5: 'W5 评测与可观测',
	6: 'W6 生产化',
	7: 'W7–W8 毕业项目 SupportPilot',
	9: 'W9 第二作品与求职',
	10: 'W10 Agent 架构深水区',
	11: 'W11 评测科学',
	12: 'W12 模型层:自部署、微调与强化学习',
	13: 'W13 平台化与规模',
	14: 'W14 前沿形态',
	15: 'W15–W16 进阶毕业项目 AgentOps',
	17: 'W17 资深求职与影响力',
	18: '作品一 Agent Loupe 调试器',
	20: '作品二 BillSleuth 计费争议调查',
};

// Month structure of the aiinfra-365 track: Day 0 is the prologue, then 30 days per month.
export const monthOf = (day: number) => (day === 0 ? 0 : Math.ceil(day / 30));

export const MONTH_TITLES: Record<number, string> = {
	0: '序章 · 为什么走这条路',
	1: 'M1 · 地基:算力和内存花在哪',
	2: 'M2 · 推理机制:KV cache、batching、量化',
	3: 'M3 · 推理深度:读 vLLM',
	4: 'M4 · 产出物 01:推理优化报告',
	5: 'M5 · GPU 编程:Triton 入门',
	6: 'M6 · 产出物 02:自己的 kernel',
	7: 'M7 · 最小推理引擎:设计与分配器',
	8: 'M8 · 产出物 03:开源引擎',
	9: 'M9 · 训练侧:DDP 与 FSDP',
	10: 'M10 · 产出物 04:故障恢复',
	11: 'M11 · 收口:作品集',
	12: 'M12 · 投递与面试',
};
