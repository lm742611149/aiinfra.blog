// Week structure of the agent-60 course, shared by the course index and the post layout.
export const weekOf = (day: number) => {
	if (day === 0) return 0;
	if (day <= 42) return Math.ceil(day / 7);
	if (day <= 54) return 7;
	return 9;
};

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
};
