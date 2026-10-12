// Week structure of the agent-60 course, shared by the course index and the post layout.
export const weekOf = (day: number) => {
	if (day === 0) return 0;
	if (day <= 42) return Math.ceil(day / 7);
	if (day <= 54) return 7;
	if (day <= 60) return 9;
	if (day <= 95) return 10 + Math.floor((day - 61) / 7);
	if (day <= 105) return 15;
	return 17;
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
};
