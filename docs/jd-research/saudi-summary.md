# 沙特阿拉伯 AI / Agent 岗位调研(2026-10-12)

只看沙特,不含迪拜 / 阿联酋。明细在同目录 `saudi.json`。

## 1. 样本与来源

| 来源 | 结果 |
| --- | --- |
| LinkedIn 公开职位接口(未登录,location=Saudi Arabia) | 15 组关键词共抓到 173 条卡片,164 条拿到完整描述;去掉销售、培训、标注、助理、PM 等非工程岗后**留下 91 条**:AI 方向 62 条、前端 / 全栈方向 29 条 |
| 公司 ATS 公开接口 | Tamara、Careem(Greenhouse)和 Lean(Ashby)能读,但沙特在招的都是客服、风控、合规岗,工程岗在迪拜;HUMAIN、SDAIA、Aramco、STC、NEOM、Elm、Salla、Foodics、Mozn 没找到公开 ATS 接口 |
| Bayt / GulfTalent / Naukrigulf / Glassdoor | 全部被 Cloudflare 或 403 拦住,没拿到数据 |
| 薪资指南 | 用 WebSearch 找到 Levels.fyi、ZenHR 和几家聚合站;Michael Page / Hays 2025 指南的薪资表在下载墙后面,没拿到 |

口径说明:
- 技能、年限、学历、阿拉伯语、沙特籍限制、福利都是从职位描述里**用关键词规则抽的**,看大的差距,差几个点没意义。
- 「agents」这个关键词也会命中「customer service agents」这类用法,AI 组里的 48% 偏高。
- 91 条里有 7 条是全球远程岗(Jobgether、Scale AI、Cohere),只是对沙特开放,不是沙特本地雇佣;Cohere 同一个职位出现了两次。
- 城市分布:利雅得 64 条,其次达曼、胡拜尔(东部省)。

## 2. 在招的是哪些岗位

**AI 方向(62 条)**
- 标题里明确写 LLM / GenAI / Agent / NLP 的只有 7 条。大部分标题还是笼统的「AI Engineer」「AI 架构师」「数据与 AI 顾问」,到描述里才写 LLM、RAG、Agent。
- 标题直接写 Agent 的有 3 个职位:Sarj「Agent Engineer」、CodeNinja「Senior AI Engineer / Agentic AI Architect」、Cohere「Forward Deployed Engineer, Agentic Platform」。
- **咨询和外包占三分之一**(20 / 62):Deloitte、EY、BCG、McKinsey QuantumBlack、Sia、SoftwareOne、Avensys、Crayon、InnovationTeam 等,做的是给沙特政府和大企业交付 AI 项目。
- **Forward Deployed(驻场交付)岗有 7 条**:SAP 2 条、Cohere 2 条、Crayon、Scale AI、BCG X。这和海外样本里 FDE 很多的结论一致。
- 本地公司:Elm、MOZN、Sarj、Qanoniah(法律 AI)、Tharwah、Saudi Azm、Takamol、Maaden(矿业)、Bupa Arabia、SAB(银行)。
- 中国公司:**字节跳动 BytePlus「GenAI Solutions Architect - Chinese Speaker」**(第三方派遣)、联想「Staff AI Researcher」。阿里云只有一个沙特 BD 岗,已作为非工程岗排除。

**前端 / 全栈方向(29 条)**
- 多是全栈:React + Java / .NET / PHP / Node,Flutter 移动端也不少。纯前端只有几条初级远程岗(PULSE)。
- 本地雇主:MOYASAR(支付)、Emdad by Elm、Zid、think、Kanz、Systems Arabia。
- 前端岗里同时提到 LLM / Agent 的只有 5 条,而且大多是顺带一提。

## 3. 技能频次(有描述的样本)

| 技能 | AI 方向(58 条) | 前端 / 全栈(29 条) |
| --- | --- | --- |
| Python | 59% | 28% |
| LLM | 53% | 14% |
| Agent(含误命中) | 48% | 10% |
| RAG | 38% | 0 |
| Docker / K8s | 36% | 21% |
| 评测 | 36% | 7% |
| MLOps | 34% | 0 |
| 提示词工程 | 29% | 0 |
| GCP / Azure / AWS | 31% / 29% / 28% | 7% / 21% / 14% |
| PyTorch / TensorFlow | 28% / 21% | 0 |
| 计算机视觉 | 21% | 3% |
| 向量库 | 17% | 7% |
| React | 14% | 48% |
| TypeScript | 9% | 38% |
| JavaScript | 10% | 62% |
| 微调 | 12% | 0 |
| LangChain | 7% | 3% |

和国内(334 条有描述)、海外(185 条)对比(数字来自 `summary.md`):
- 沙特 AI 岗**更偏传统 ML 和云平台**:PyTorch、TensorFlow、MLOps、计算机视觉、三大云的比例明显高于国内 Agent 岗。很多岗位其实是「数据与 AI」大杂烩,不是纯 Agent 应用开发。
- 评测 36%,低于国内 48% 和海外 62%。
- LangChain 这类框架点名很少(7%);MCP 在沙特 91 条里**一条都没有**(国内 17%,海外 16%)。
- 阿拉伯语 NLP 是沙特特有的需求点(HUMAIN 的 ALLaM、Sarj、LILT 的阿语标注岗),但样本里明确写「Arabic NLP」的不多。

## 4. 年限、学历、阿拉伯语、国籍

- **年限**:AI 方向有 38 条写了最低年限,P25 / 中位 / P75 = 2 / 4 / 7 年;前端全栈 17 条,中位 4 年。咨询公司的经理岗和架构师岗普遍要 8–10 年。
- **学历**:AI 方向 62 条里,33 条没写学历,14 条本科,11 条提硕士,4 条提博士(多是「或同等经验」)。前端全栈基本只写本科或不写。
- **阿拉伯语**:
  - AI 方向:要求 6 条(10%),加分 6 条(10%),只是顺带提到 6 条,**71% 完全没提**。
  - 前端全栈:要求 2 条,86% 没提。
  - 要求阿语的集中在本地初创(Sarj、Qanoniah)和咨询经理岗。
- **沙特籍限制**:描述里明确写「Saudi National」或沙特化(Saudization)的只有 3 条(SAP AI Industry Architect、UXBERT Mobile Lead、ALTAVE CV Developer)。实际招聘中的沙特化配额不一定写在 JD 里,**外籍可投比例应理解为「JD 上没拦」,不等于一定能拿到工签**。
- **福利**:写了住房的 11 条、医疗 9 条、搬迁 4 条、签证担保 3 条、机票 1 条;写远程或混合办公的 18 条(含全球远程岗)。多数 JD 不写福利,福利通常到 offer 阶段才谈。

## 5. 薪资(两种口径分开)

**汇率**:沙特里亚尔与美元固定汇率 1 USD = 3.75 SAR;人民币按约 1 USD ≈ 7.1 CNY 估算(未实时查证),所以 **1 SAR ≈ 1.89 元**。年包 = 月薪 × 12,不含住房补贴和年终。**沙特不征个人所得税**,下面都是到手数。

**口径 A:JD 明标薪资(样本极少)**

91 条里只有 1 条沙特本地岗写了数:Imploy「Software Engineer」SAR 12,000–18,000 / 月,约人民币 27–41 万 / 年。另有 Jobgether 全球远程 Senior Data Scientist 标 USD 152k–205k / 年,但写明按地区调整,不能当沙特本地价。**结论:沙特 JD 基本不标价,这一口径没有统计意义。**

**口径 B:薪资指南和自报数据**

| 来源 | 口径 | 原数 | 折人民币年包 |
| --- | --- | --- | --- |
| ZenHR 2025 | 软件工程师月薪中位(3–7 年) | SAR 18,000(12k–28k) | 约 41 万(27–64 万) |
| ZenHR 2025 | 高级软件工程师月薪中位 | SAR 25,000 | 约 57 万 |
| Levels.fyi(2026 年中) | 利雅得软件工程师年总包中位 | SAR 161,947 | 约 31 万 |
| Levels.fyi | 利雅得 Senior 年总包 P25 / 中位 / P75 | SAR 300k / 344k / 420k | 约 57 / 65 / 79 万 |
| AI 工程师聚合页(方法未披露,可信度低) | 中级(3–5 年)月薪 | SAR 20k–30k | 约 45–68 万 |
| 同上 | 资深 | SAR 25k–48k | 约 57–109 万 |
| 同上 | Lead / Principal | SAR 50k–75k+ | 约 113–170 万 |

几个说明:
- 几家来源对同一级别能差两倍,AI 岗比普通软件岗的溢价各家说 20%–50%。
- Glassdoor 利雅得 ML 工程师只有约 9 条样本,不采用。
- 住房补贴在沙特很常见,通常相当于月薪的 25% 左右(行业惯例,未在本批 JD 中核实),再加交通补贴、医疗和年度机票。
- 高技能工签档要求本科、5 年以上经验、月薪 SAR 15,000 以上(据检索摘要,未核对官方原文)。

**对照**:
- 国内(Boss + 猎聘 557 条挂牌):年包中位 48 万,5–10 年 54 万,标题带「资深 / 专家 / 架构师」的中位 66 万。
- 新加坡中位 7.5k–10k SGD / 月,约 50–66 万人民币,以中介和外包岗为主。
- 沙特资深 AI 岗如果拿到 SAR 30k–45k / 月,折 68–102 万,**免税再加住房**,比国内资深中位高一截;普通软件岗(SAR 18k–25k)折 41–57 万,和国内差不多,加上免税和补贴才略好。

## 6. 中国公司的机会

- 本批样本里能看到的:**字节跳动 BytePlus「GenAI Solutions Architect - Chinese Speaker」**(要求中文、5 年以上、偏售前和解决方案,第三方派遣合同);联想「Staff AI Researcher」。
- 华为云在利雅得有数据中心,并承诺培训 20 万沙特开发者;阿里云在沙特有 BD 岗。外派工程岗大多走国内招聘渠道(Boss / 猎聘 / 内推),LinkedIn 上看不到,外派补贴也查不到公开数字。
- 想走这条路,更现实的是在国内投「出海 / 中东 / 海外交付」方向的岗位,再申请外派。

## 7. 给这位求职者的建议

**背景**:8 年前端(TypeScript / React)+ 最近半年开始做后端,在美国 SaaS 公司远程,日常重度使用 Claude Code / MCP。

**哪些岗位能投**

1. **AI 产品全栈 / Forward Deployed AI Engineer(最匹配)**
   - AI 方向里有 9 条同时点名 React / TypeScript:UXBERT Senior AI Engineer、Cohere FDE、Qanoniah Senior AI Engineer、MOZN AI Engineer、QuantumBlack Senior / Principal SWE、SAP AI Industry Architect、Hays AI Engineer 等。
   - 这些岗位要的是「能把 Agent 做进产品、做给客户看」的人。8 年前端是加分项,不是短板:Agent 产品的界面层(流式输出、工具调用展示、人工审批)恰恰是很多 ML 背景的人做不好的。
   - FDE 岗面向客户、要出差、英文要好。你在美国公司远程,英文交付经验正对口。
2. **前端 / 全栈技术负责人**:沙特前端全栈岗年限中位只有 4 年,你 8 年属于高配。可以投 MOYASAR、Zid、Elm 系(Emdad)的 Senior / Lead,但薪资大致在普通软件岗区间(SAR 18k–30k,折 41–68 万),相对国内优势不大。
3. **中文方向的解决方案岗**:字节 BytePlus 这类「Chinese Speaker」岗对中国人有天然优势,但偏售前,技术深度要求不高,派遣合同稳定性差。

**要补的缺口**(对照沙特 AI 岗频次)
- Python 工程化(59%):你半年后端如果是 TypeScript / Node,需要补 Python。课程 Day 2 起用 Python 正好覆盖。
- 云和容器(三大云各约 30%,Docker / K8s 36%):至少熟一家。沙特政府项目偏 Azure 和 GCP(GCP 在沙特有本地区域),这一点是推断。
- RAG(38%)和评测(36%):课程 W3、W5 覆盖。
- 传统 ML(PyTorch、MLOps、计算机视觉约 20%–34%):如果只想投 Agent 应用岗,可以不补;投咨询公司的「AI Engineer」会被问到。
- MCP 和 Claude Code 经验在沙特 JD 里没人写,但这是面试里能拉开差距的实战经验,可以作为亮点讲,不用当门槛。

**现实判断**
- **薪资**:以 8 年经验转资深 AI 全栈 / FDE,合理目标是 SAR 30k–45k / 月 + 住房补贴,折人民币约 68–102 万免税。如果只拿到普通软件岗的 SAR 20k 左右,扣掉生活和家庭成本,相比国内不一定划算。
- **签证**:91 条里明写只招沙特籍的只有 3 条,但沙特化配额是真实存在的。拿 offer 前要确认公司愿意担保工签、是否属于高技能档(月薪 SAR 15,000 以上的门槛你能过)。
- **岗位形态**:三分之一 AI 岗是咨询外包和驻场交付,项目制、合同期一般 1–2 年;纯产品公司的 AI 岗不多(MOZN、Sarj、Qanoniah、UXBERT 这类)。
- **样本局限**:91 条只来自 LinkedIn,Bayt 和 GulfTalent 这些本地主力招聘站被拦住了,HUMAIN、SDAIA、Aramco 这类大雇主的岗位基本没进样本。真要投,建议用自己的浏览器在 Bayt 和 LinkedIn 上直接搜,再找在沙特的中国工程师问实际 offer。
