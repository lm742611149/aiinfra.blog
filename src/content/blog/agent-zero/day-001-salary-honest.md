---
title: 'Day 1 · 岗位能拿多少钱,学完能做到什么'
description: '用 557 条带薪资的真实 JD 看 AI Agent 工程师的挂牌年包,先学会「35-65K·16薪」这种数字怎么折算、中位数为什么比平均数靠谱,再诚实地说这门课学完能做到什么、做不到什么。'
pubDate: 2026-10-22
regime: none
tags: ['career', 'salary', 'agent-zero']
series: 'agent-zero'
day: 1
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 0](/blog/agent-zero/day-000-overview/) 讲了 AI Agent 工程师是干什么的:用现成的大模型搭系统,模型负责做决定,查数据、搜文档、执行操作全是工程师写的代码。我们在 Console 里写了一个 `check()` 函数,靠关键词判断一份 JD 是不是开发岗,还踩了大小写的坑。最后看了这门课 711 天的地图和三步学法。知道了这个岗位干什么,下一个自然的问题就是:它值多少钱,我学完能不能拿到。

## 今天要解决的问题

1. 看懂招聘页上「35-65K·16薪」这种写法,能把它折算成年包,并且知道这个数字和你真正拿到手的钱差在哪。
2. 知道为什么看薪资要看中位数而不是平均数,能在 Console 里自己算一组 JD 的中位数。
3. 记住 2026 年 10 月这批数据里国内外 Agent 岗的大致行情:国内挂牌年包中位 48 万,以及按年限、城市、公司规模怎么变。
4. 诚实地知道这门课学完能做到什么、做不到什么,尤其是对只会前端的人。

预计用时:2 小时。读正文 1 小时,敲代码和做练习 1 小时。

前置:[Day 0](/blog/agent-zero/day-000-overview/)(会在 Console 里跑代码,知道 `includes` 和数组的 `filter`)。

学法提示:先对照文章逐行敲一遍代码(不复制粘贴)并跑通;第二天合上文章,把 `toYearly` 和求中位数那几行默写出来;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先看懂一个薪资数字

Boss 直聘和猎聘上的岗位,薪资一般写成这样:`35-65K·16薪`。这是 2026 年 10 月我抓到的阿里巴巴一个杭州岗位「AI Agent 智能体/RAG 研发工程师」的真实写法。拆开看:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="把 35-65K·16薪 拆成下限、上限和薪数三部分,算出中点 50K,再乘 16 得到年包 80 万">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)">
<rect x="150" y="30" width="60" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="180" y="56" text-anchor="middle" font-size="16" fill="var(--ink)">35</text>
<text x="222" y="56" text-anchor="middle" font-size="16" fill="var(--ink-soft)">-</text>
<rect x="234" y="30" width="60" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="264" y="56" text-anchor="middle" font-size="16" fill="var(--ink)">65</text>
<text x="312" y="56" text-anchor="middle" font-size="16" fill="var(--ink-soft)">K·</text>
<rect x="330" y="30" width="60" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="360" y="56" text-anchor="middle" font-size="16" fill="var(--ink)">16</text>
<text x="408" y="56" text-anchor="middle" font-size="16" fill="var(--ink-soft)">薪</text>
<line x1="180" y1="70" x2="180" y2="95" stroke="var(--rule)"/>
<line x1="264" y1="70" x2="264" y2="95" stroke="var(--rule)"/>
<line x1="360" y1="70" x2="360" y2="95" stroke="var(--rule)"/>
<text x="180" y="112" text-anchor="middle" font-size="11" fill="var(--ink-soft)">月薪下限</text>
<text x="264" y="112" text-anchor="middle" font-size="11" fill="var(--ink-soft)">月薪上限</text>
<text x="360" y="112" text-anchor="middle" font-size="11" fill="var(--ink-soft)">一年发几个月</text>
<text x="180" y="128" text-anchor="middle" font-size="11" fill="var(--ink-faint)">35,000 元</text>
<text x="264" y="128" text-anchor="middle" font-size="11" fill="var(--ink-faint)">65,000 元</text>
<text x="360" y="128" text-anchor="middle" font-size="11" fill="var(--ink-faint)">12 + 4(多为年终奖)</text>
<text x="320" y="170" text-anchor="middle" font-size="13" fill="var(--ink)">中点 (35 + 65) / 2 = 50K   ×16 = 800K = 80 万</text>
<text x="320" y="198" text-anchor="middle" font-size="11" fill="var(--ink-faint)">没写「·N薪」的按 12 薪算;K 是千,1K = 0.1 万,所以 K × 月数 ÷ 10 = 万</text>
</g>
</svg>
<figcaption>一个挂牌薪资的三部分。这门课引用的所有国内年包,都是按这个口径算的:区间中点乘薪数。</figcaption>
</figure>

`35-65K` 是月薪区间,K 是「千」,也就是每月 3.5 万到 6.5 万税前。`16薪` 是一年发 16 个月的钱,多出来的 4 个月通常是年终奖。没写薪数的,默认按 12 薪算。

为了能比较,调研里统一用**区间中点 × 薪数**折算成一个年包数字:(35 + 65) ÷ 2 = 50K,50K × 16 = 800K,也就是 80 万。这种把一个原始数字换算成可比数字的规则,叫**口径**。口径不同,同一批数据能算出完全不一样的结论,所以以后你看到任何薪资数字,第一件事是问它的口径。

这个 80 万和你真正拿到手的钱差在三处。第一,这是**挂牌价**,是招聘方愿意出的范围,不是成交价;区间上沿一般只给面试表现很强的人。第二,它是**税前**,还没扣社保、公积金和个税。第三,年终奖那几个月**不一定发满**,很多公司写 16 薪,实际按绩效发 2 到 6 个月不等。所以挂牌年包适合拿来横向比较「这类岗位大概在什么档位」,不适合直接当成你的预期收入。

## 动手:把薪资字符串变成数字

我们用 JS 把上面的算法写出来。还是打开 Chrome,地址栏输入 `about:blank`,`Cmd + Option + J` 打开 Console(Day 0 讲过)。

第一步,只处理一个字符串。这里要用一个你可能写前端时用过、但不一定熟的东西:**正则表达式**。它是一种描述「字符串长什么样」的小语言,`\d+` 表示「一个或多个数字」,用括号括起来的部分会被单独取出来。

```js
// agent-zero-lab/part01/salary1.js
const salary = '35-65K·16薪';
const m = salary.match(/(\d+)-(\d+)K(?:·(\d+)薪)?/);
console.log(m);
const low = Number(m[1]);
const high = Number(m[2]);
const months = Number(m[3] ?? 12);
const yearly = (low + high) / 2 * months / 10;
console.log(low, high, months);
console.log('年包中点约', yearly, '万');
```

<div class="line-notes">

- `const salary = '35-65K·16薪';` 阿里那个岗位的原始写法。中间那个点是中文的间隔号 `·`,不是英文句号,原样复制自招聘页。
- `const m = salary.match(/(\d+)-(\d+)K(?:·(\d+)薪)?/);` 从左往右读这个正则:`(\d+)` 取一串数字(35),`-` 匹配减号,`(\d+)` 再取一串(65),`K` 匹配字母 K,`(?:·(\d+)薪)?` 整体可有可无,有的话把中间的数字(16)取出来。`(?:...)` 是「只分组、不单独取出」,末尾 `?` 是「可有可无」。`match` 找到了就返回一个数组,找不到返回 `null`。
- `console.log(m);` 打印出来是 `['35-65K·16薪', '35', '65', '16', index: 0, ...]`。下标 0 是整段匹配到的文字,1、2、3 是三个括号取出来的东西。注意它们都是**字符串** `'35'`,不是数字 35。
- `const low = Number(m[1]);` 把 `'35'` 转成数字 35。不转的话 `'35' + '65'` 会拼成 `'3565'`,这是 JS 老坑,你应该见过。
- `const high = Number(m[2]);` 65。
- `const months = Number(m[3] ?? 12);` `??` 是「左边是 `null` 或 `undefined` 时用右边」。这里 `m[3]` 是 `'16'`,所以是 16;如果字符串是 `50-65K`,没有薪数,`m[3]` 是 `undefined`,就用 12。
- `const yearly = (low + high) / 2 * months / 10;` (35 + 65) / 2 = 50,× 16 = 800(单位是 K,也就是千),÷ 10 换成万,得 80。
- `console.log(low, high, months);` 打印 `35 65 16`。
- `console.log('年包中点约', yearly, '万');` 打印 `年包中点约 80 万`。

</div>

我用 Node 24 跑出来是(Chrome Console 里数组会显示成可以点开的样子,内容一样):

```text
[
  '35-65K·16薪',
  '35',
  '65',
  '16',
  index: 0,
  input: '35-65K·16薪',
  groups: undefined
]
35 65 16
年包中点约 80 万
```

### 先故意踩一个坑

把 `salary` 换成猎聘上一个北京岗位「大模型应用开发」的真实写法 `25-35k·15薪`,别的不动,再跑:

```js
// agent-zero-lab/part01/salary_err.js
const salary = '25-35k·15薪';
const m = salary.match(/(\d+)-(\d+)K(?:·(\d+)薪)?/);
console.log(m);
const low = Number(m[1]);
```

<div class="line-notes">

- `const salary = '25-35k·15薪';` 注意这里是小写 `k`。我抓的数据里,Boss 直聘写大写 `K`,猎聘写小写 `k`。
- `const m = salary.match(` 正则里写的是大写 `K`,和小写 `k` 对不上,整个匹配失败,`m` 是 `null`。
- `console.log(m);` 打印 `null`。
- `const low = Number(m[1]);` 对 `null` 取 `[1]`,直接报错。

</div>

真实输出:

```text
null
TypeError: Cannot read properties of null (reading '1')
```

在 Chrome Console 里这行报错前面会多一个 `Uncaught`,意思是「没人接住这个错误」,浏览器和 Node 用的是同一个 V8 引擎,报错原文一样。这个报错你写前端时一定见过,比如接口返回 `null` 你直接取了字段。修法有两处:正则末尾加一个 `i` 标志,写成 `/.../i`,表示不区分大小写;再在取值之前判断一下 `m` 是不是 `null`。下一段代码两处都改了。

这个坑和 Day 0 的 `Function Calling` 是同一类问题:真实数据从来不整齐,不同平台、不同人写法都不一样。处理真实数据的代码,一半的工作量在应付这些不整齐。

## 一组数据看中位数

第二步,处理一组。下面是我从调研数据里随机抽的 10 条 Boss 直聘和猎聘岗位(固定随机种子抽的,不是挑过的),公司名去掉了,标题、城市、薪资、年限是原样。

```js
// agent-zero-lab/part01/salary2.js
const jobs = [
  { title: 'AI Agent 智能体/RAG 研发工程师', city: '杭州', salary: '35-65K·16薪', years: '3-5年' },
  { title: 'AI 应用工程师', city: '深圳', salary: '50-65K', years: '3-5年' },
  { title: 'AI Agent 工程师 - 豆包', city: '杭州', salary: '20-40K·15薪', years: '经验不限' },
  { title: 'AI Agent 应用师', city: '深圳', salary: '8-10K', years: '1-3年' },
  { title: '可观测领域 AI Agent 开发工程师', city: '杭州', salary: '30-60K·16薪', years: '3-5年' },
  { title: '大模型应用开发', city: '北京', salary: '25-35k·15薪', years: '经验不限' },
  { title: '算法开发岗(多模态大模型)', city: '北京', salary: '40-50K', years: '经验不限' },
  { title: 'AI agent 工程师', city: '上海', salary: '30-50K·15薪', years: '3-5年' },
  { title: 'AI Agent 全栈开发工程师 (TypeScript)', city: '深圳', salary: '18-35K', years: '1-3年' },
  { title: 'AI 应用开发工程师', city: '杭州', salary: '12-20k·13薪', years: '3-5年' },
];

function toYearly(salary) {
  const m = salary.match(/(\d+)-(\d+)k(?:·(\d+)薪)?/i);
  if (!m) return null;
  const months = Number(m[3] ?? 12);
  return (Number(m[1]) + Number(m[2])) / 2 * months / 10;
}

const yearly = jobs.map((j) => toYearly(j.salary));
console.log(yearly);

const sorted = [...yearly].sort((a, b) => a - b);
console.log(sorted);

const mid = sorted.length / 2;
const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
const average = yearly.reduce((sum, x) => sum + x, 0) / yearly.length;
console.log('中位数', median, '万;平均数', average.toFixed(1), '万');
```

<div class="line-notes">

- `const jobs = [` 一个对象数组,每个对象是一条岗位。你写前端时天天在渲染这种结构。
- `salary: '8-10K', years: '1-3年'` 这条是 Day 0 那个电商「Ai Agent 应用师」,月薪 8-10K。它混在 Agent 岗的搜索结果里,但实际是运营岗,待会儿看它怎么影响平均数。
- `salary: '25-35k·15薪'` 刚才报错的那条,小写 `k`。
- `salary: '18-35K', years: '1-3年'` Day 0 那个 TypeScript 全栈岗。
- `function toYearly(salary) {` 把刚才那几行收进一个函数,输入一个薪资字符串,输出年包(万)。
- `const m = salary.match(/(\d+)-(\d+)k(?:·(\d+)薪)?/i);` 两处改动:正则里写小写 `k`,末尾加 `i` 标志,大小写 `K` `k` 都能匹配。
- `if (!m) return null;` 匹配不上(比如「面议」或者「150-200元/天」这种实习日薪)就返回 `null`,不往下算,不会再报 TypeError。
- `return (Number(m[1]) + Number(m[2])) / 2 * months / 10;` 和第一步一样的算法,写成一行。
- `const yearly = jobs.map((j) => toYearly(j.salary));` 对每条岗位算年包。打印出来是 `[80, 69, 45, 10.8, 72, 45, 54, 60, 31.8, 20.8]`。第二条 `50-65K` 没写薪数,按 12 薪是 57.5 × 12 ÷ 10 = 69;第四条 9 × 12 ÷ 10 = 10.8。
- `const sorted = [...yearly].sort((a, b) => a - b);` `[...yearly]` 先复制一份,因为 `sort` 会改原数组。`(a, b) => a - b` 是按数字从小到大排,这个比较函数不能省,常见误区里会演示省了会怎样。排完是 `[10.8, 20.8, 31.8, 45, 45, 54, 60, 69, 72, 80]`。
- `const mid = sorted.length / 2;` 10 条,`mid` 是 5。
- `const median = sorted.length % 2 === 0 ?` 条数是偶数时,中位数取正中间两个的平均:`sorted[4]` 是 45,`sorted[5]` 是 54,(45 + 54) ÷ 2 = 49.5。奇数时直接取正中间那个。
- `const average = yearly.reduce(` 全部加起来除以条数,加起来是 488.4,÷ 10 = 48.84。
- `console.log('中位数', median` `toFixed(1)` 保留一位小数,打印 `中位数 49.5 万;平均数 48.8 万`。

</div>

```text
[
    80,   69, 45, 10.8,
    72,   45, 54,   60,
  31.8, 20.8
]
[
  10.8, 20.8, 31.8, 45,
    45,   54,   60, 69,
    72,   80
]
中位数 49.5 万;平均数 48.8 万
```

**中位数**就是把所有数从小到大排好,站在正中间的那个。这 10 条里中位数和平均数差不多,看不出区别。区别在有极端值的时候:招聘数据里总会有几条 200 万以上的顶级岗位(这批数据里最高的折算 243 万),一条就能把平均数拉高一大截,而中位数几乎不动。练习 1 你会亲手加一条进去看。所以看薪资**只看中位数,不看平均数**。

和中位数配套的还有两个数:**P25** 和 **P75**。把 100 条岗位从低到高排成一队,第 25 个人的薪资是 P25,第 75 个人的是 P75。中间这一半人(P25 到 P75)代表「大多数岗位」的范围,比只看一个中位数更有用。今天不写算 P25 的代码,知道意思就够了。

## 2026 年 10 月的行情

上面 10 条是演示,真实结论要看全量。这门课开课前抓的数据里,Boss 直聘和猎聘一共 557 条能解析出薪资的岗位(另有 7 条「面议」、几条实习日薪不计),按上面的口径折算,我今天又用 Python 重算了一遍,和调研报告里的数一致:

| 国内(Boss + 猎聘,557 条) | P25 | 中位 | P75 |
| --- | --- | --- | --- |
| 全部 | 36 万 | **48 万** | 68 万 |
| 1–3 年 | 26 万 | 40 万 | 54 万 |
| 3–5 年 | 35 万 | 48 万 | 66 万 |
| 5–10 年 | 36 万 | 54 万 | 68 万 |
| 经验不限 | 36 万 | 52 万 | 78 万 |

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="按年限的挂牌年包范围:每条横线从 P25 到 P75,圆点是中位数">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<line x1="140" y1="190" x2="620" y2="190" stroke="var(--rule)"/>
<text x="140" y="208" text-anchor="middle" fill="var(--ink-faint)">20</text>
<text x="260" y="208" text-anchor="middle" fill="var(--ink-faint)">40</text>
<text x="380" y="208" text-anchor="middle" fill="var(--ink-faint)">60</text>
<text x="500" y="208" text-anchor="middle" fill="var(--ink-faint)">80 万</text>
<text x="20" y="44" fill="var(--ink)">全部</text>
<line x1="236" y1="40" x2="428" y2="40" stroke="var(--mem)" stroke-width="6"/><circle cx="308" cy="40" r="6" fill="var(--ink)"/>
<text x="20" y="79" fill="var(--ink)">1–3 年</text>
<line x1="176" y1="75" x2="344" y2="75" stroke="var(--mem)" stroke-width="6"/><circle cx="260" cy="75" r="6" fill="var(--ink)"/>
<text x="20" y="114" fill="var(--ink)">3–5 年</text>
<line x1="230" y1="110" x2="416" y2="110" stroke="var(--mem)" stroke-width="6"/><circle cx="308" cy="110" r="6" fill="var(--ink)"/>
<text x="20" y="149" fill="var(--ink)">5–10 年</text>
<line x1="236" y1="145" x2="428" y2="145" stroke="var(--mem)" stroke-width="6"/><circle cx="344" cy="145" r="6" fill="var(--ink)"/>
<text x="20" y="176" fill="var(--ink)">经验不限</text>
<line x1="236" y1="172" x2="488" y2="172" stroke="var(--compute)" stroke-width="6"/><circle cx="332" cy="172" r="6" fill="var(--ink)"/>
</g>
</svg>
<figcaption>国内挂牌年包,蓝条是 P25 到 P75,黑点是中位数。「经验不限」里大厂校招和 AI 公司多,所以上沿很高(琥珀色)。</figcaption>
</figure>

再细分几个维度。**城市**:上海中位 54 万,深圳 48 万,北京 47 万,杭州 42 万。**公司规模**:万人以上的公司中位 57 万,20 人以下的 36 万,差了二十多万。**学历**(只有 Boss 的数据):本科 52 万,硕士 60 万,大专 20 万。

几个容易读错的地方。这是挂牌价,上面讲过。大厂官网不写薪资,所以这张表主要是 Boss 和猎聘上的公司,字节、腾讯在里面是因为它们也在 Boss 上挂了岗。还有,最早我只抓到智联招聘上 24 条带薪资的,中位数折年只有 24 万,补上 Boss 和猎聘之后翻了一倍,所以千万别拿一个平台、几条 JD 就下结论。练习 2 你会用 10 条数据按年限分组,看到小样本能偏得多离谱。

对你最相关的一个数:这个站另一篇文章《[前端工程师转 Agent](/blog/frontend-to-agent-engineer/)》里,我从同一批数据里挑出标题带「全栈」或「前端」的 43 条,中位数也是 48 万,P25 36 万,P75 68 万,和全部样本几乎一样。也就是说全栈 Agent 岗不是「低一档的前端岗」。43 条样本不大,只能说明「没有明显打折」。

海外的数字:

| 地区 | 有薪资的样本 | 中位数 |
| --- | --- | --- |
| 新加坡 | 29 条(政府职位库 MyCareersFuture) | 月薪 7,500–10,000 新币,年约 9–12 万新币 |
| 香港 | LinkedIn 23 条,没有一条写薪资 | 无数据 |
| 海外远程 | 8 条 | 年薪 18 万–25 万美元 |
| 美国本土 | 26 条 | 年薪 19.8 万–33.5 万美元 |

海外远程看着诱人,但要看清限制:46 条远程岗里,限美国加拿大的 18 条,限欧洲时区的 6 条,限其他特定国家的 8 条,没写清的 11 条,**明确写「全球任何地方都可以」的只有 3 条**。人在国内,能拿美国薪资的远程 Agent 岗非常少。新加坡的样本里外包和中介公司多,所以中位数偏低。

## 诚实地说,学完能做到什么

先说门槛,这些是数据里看得到的硬约束。

**年限**:国内 JD 最常见的要求是 3 到 5 年(Boss 上占 31.5%,猎聘上占 43.6%),1 到 3 年的只占 14% 到 21%。这里的年限一般指「软件开发工作年限」,不要求全是 Agent 经验,因为这个岗位才火了两三年,没人有五年 Agent 经验。所以如果你做了几年前端,**这几年是算数的**。

**学历**:Boss 列表里八成写本科,明确写硕士或博士的大约一成,集中在大厂和偏算法的岗位。本科靠作品去碰卡硕士的岗位很难,与其硬碰,不如优先投不卡学历的。

**项目经验**:国内中小公司常写「至少 1 个已上线的大模型应用项目,本人承担主要开发」,海外几乎每条都写「shipped to production」(交付到生产环境)。这是这门课最想帮你补的一条。

然后按阶段说能做到什么。

学完**第一部分**(Day 105):会用终端、git,能写几百行的 Python 脚本,懂 HTTP、数据库、Docker 的基本用法。这时候还不能投 Agent 岗,但你已经不是「只会前端」了。

学完**普通篇**(Day 517):能独立搭一个带工具调用、知识库检索、流程编排、评测、监控、部署上线的 Agent 系统,也就是毕业项目 SupportPilot,并且能讲清楚为什么这么设计、数据怎么样、踩过什么坑。这时你可以投 Agent 工程师岗位。你的定位是「N 年前端 + 一个完整上线的 Agent 项目」,最对口的是「全栈 Agent 工程师」和「大模型应用开发」这两类。

学完**进阶篇**(Day 648):对准资深岗位的面试,能讲架构取舍、评测方法论、平台化、成本和规模。学完**作品篇**(Day 701):手上多两个别人能在线试用的项目。

做不到的也要说清楚。

**这门课不会让你变成五年后端**。后端深度是一点点踩坑踩出来的,线上出过事故、半夜处理过数据库锁表的人,和学过这些知识的人,面试官问三个问题就分得出来。你在第一部分和第七部分会把后端的地基补起来,但工作年限上,你应该按「前端年限 + Agent 项目」去投,别指望学完直接按资深后端的价位谈。

**薪资取决于你原来的级别和城市,Agent 能力是往上加的部分**。如果你现在是三年前端、在杭州,学完更现实的预期是去够上面表里「3–5 年、杭州」那一档,而不是 P75。

**真实上线经验最好在工作里拿**。如果你现在的公司有任何一点 AI 相关的需求,比如给内部工具加一个问答、做一个客服草稿生成,主动去接。哪怕只做了界面和后端的一小块,写进简历都比个人项目有说服力。这门课的作品是补充,不是替代。

最后,薪资的上限更多取决于你的工程能力,而不是你会不会用某个框架。面试官最终在看的是「这个人能不能把一个不靠谱的模型做成一个靠谱的系统」。只会调 API 搭演示的人很多,能把 Agent 稳定跑在生产环境的人少,这门课后半段花大量篇幅讲评测、监控、安全和成本,原因就在这。

## 动手练习

### 练习 1:加一条极端值,看平均数和中位数谁动得多

调研数据里有 7 条要求「10 年以上」的岗位,中位年包 160 万,最高的一条挂的是 `110-160K·18薪`,折算 243 万。往正文那 10 条的年包里加一个 243,再算中位数和平均数。

<details><summary>参考答案</summary>

```js
// agent-zero-lab/part01/ex1_1.js
const yearly = [80, 69, 45, 10.8, 72, 45, 54, 60, 31.8, 20.8];
yearly.push(243);

function median(list) {
  const sorted = [...list].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
}
const average = yearly.reduce((sum, x) => sum + x, 0) / yearly.length;

console.log('11 条的中位数', median(yearly), '万');
console.log('11 条的平均数', average.toFixed(1), '万');
```

<div class="line-notes">

- `const yearly = [80, 69,` 直接用正文算出来的 10 个年包,省掉解析那一步。
- `yearly.push(243);` 加一条 243 万,现在 11 条。`const` 数组也能 `push`,`const` 只是不让你把 `yearly` 指向别的数组。
- `function median(list) {` 把求中位数收成函数,练习 2 还会用。
- `const sorted = [...list].sort((a, b) => a - b);` 排完是 `[10.8, 20.8, 31.8, 45, 45, 54, 60, 69, 72, 80, 243]`。
- `const mid = sorted.length / 2;` 11 ÷ 2 = 5.5。
- `return sorted.length % 2 === 0 ?` 11 是奇数,走后半句 `sorted[Math.floor(5.5)]`,也就是 `sorted[5]`,是 54。
- `const average = yearly.reduce(` 原来的总和 488.4 加 243 是 731.4,÷ 11 ≈ 66.49。
- `console.log('11 条的中位数'` 打印 54。
- `console.log('11 条的平均数'` `toFixed(1)` 保留一位,打印 66.5。

</div>

```text
11 条的中位数 54 万
11 条的平均数 66.5 万
```

一条 243 万把平均数从 48.8 拉到 66.5,涨了将近 18 万;中位数从 49.5 变成 54,只动了 4.5 万。如果有人告诉你「Agent 工程师平均年薪 66 万」,你现在知道该先问一句:平均数还是中位数,样本里有没有几条特别高的。

</details>

### 练习 2:按年限分组,看小样本有多不靠谱

用正文的 10 条数据,分别算「1-3年」「3-5年」「经验不限」三组的中位数,和上面全量表里的数字比一比。

<details><summary>参考答案</summary>

```js
// agent-zero-lab/part01/ex1_2.js
const jobs = [
  { salary: '35-65K·16薪', years: '3-5年' },
  { salary: '50-65K', years: '3-5年' },
  { salary: '20-40K·15薪', years: '经验不限' },
  { salary: '8-10K', years: '1-3年' },
  { salary: '30-60K·16薪', years: '3-5年' },
  { salary: '25-35k·15薪', years: '经验不限' },
  { salary: '40-50K', years: '经验不限' },
  { salary: '30-50K·15薪', years: '3-5年' },
  { salary: '18-35K', years: '1-3年' },
  { salary: '12-20k·13薪', years: '3-5年' },
];

function toYearly(salary) {
  const m = salary.match(/(\d+)-(\d+)k(?:·(\d+)薪)?/i);
  if (!m) return null;
  return (Number(m[1]) + Number(m[2])) / 2 * Number(m[3] ?? 12) / 10;
}
function median(list) {
  const sorted = [...list].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
}

for (const years of ['1-3年', '3-5年', '经验不限']) {
  const list = jobs.filter((j) => j.years === years).map((j) => toYearly(j.salary));
  console.log(years, list.length, '条,中位数', median(list), '万');
}
```

<div class="line-notes">

- `const jobs = [` 和正文同样的 10 条,只留薪资和年限两个字段。
- `function toYearly(salary) {` 和正文一样,只是把 `months` 那一行合进了 `return`。
- `function median(list) {` 练习 1 写的那个。
- `for (const years of ['1-3年', '3-5年', '经验不限']) {` 依次处理三个分组。`for...of` 遍历数组的值,和你在 JS 里用的一样。
- `const list = jobs.filter((j) => j.years === years).map(` 先 `filter` 出这一组,再 `map` 成年包。「1-3年」组是 `[10.8, 31.8]`;「3-5年」组是 `[80, 69, 72, 60, 20.8]`;「经验不限」组是 `[45, 45, 54]`。
- `console.log(years, list.length` 「1-3年」两条取平均 (10.8 + 31.8) ÷ 2 = 21.3;「3-5年」排好是 `[20.8, 60, 69, 72, 80]`,中间是 69;「经验不限」排好是 `[45, 45, 54]`,中间是 45。

</div>

```text
1-3年 2 条,中位数 21.3 万
3-5年 5 条,中位数 69 万
经验不限 3 条,中位数 45 万
```

和全量 557 条对比:1–3 年全量中位 40 万,这里 21.3 万,差了将近一半;3–5 年全量 48 万,这里 69 万,高了 21 万。原因就是样本太小,「1-3年」组里刚好有那条 8-10K 的运营岗,「3-5年」组里刚好有两条大厂高薪岗。几条数据算出来的数字,别当结论。

</details>

### 练习 3:手算三个薪资

不跑代码,先手算下面三个挂牌薪资的年包中点,再用 `toYearly()` 验证:`20-40K·15薪`、`18-35K`、`12-20k·13薪`。

<details><summary>参考答案</summary>

手算:`20-40K·15薪` 中点 30K × 15 = 450K = 45 万;`18-35K` 中点 26.5K × 12 = 318K = 31.8 万;`12-20k·13薪` 中点 16K × 13 = 208K = 20.8 万。

在 Console 里接着正文的代码跑 `['20-40K·15薪', '18-35K', '12-20k·13薪'].map(toYearly)`,得到的就是正文 `yearly` 数组里第 3、9、10 个值:45、31.8、20.8。注意 `18-35K` 没写薪数,按 12 薪;`12-20k` 是小写 k,`toYearly` 加了 `i` 标志才能处理。

</details>

### 练习 4:写一份自己的诚实预期

写一段 100 字左右的话,回答三个问题:我现在的工作年限和城市对应上面表里哪一档;学完普通篇之后我准备投哪一类岗位;我现在的工作里有没有能接的 AI 相关需求。

<details><summary>参考答案</summary>

一个示范(按一个虚构的读者写):

「我做了 4 年前端,在杭州,对应表里 3–5 年那档,中位 48 万,杭州整体偏低一些,我按 40 万左右做预期。学完普通篇我优先投标题带全栈的 Agent 岗和大模型应用开发岗,不投卡硕士的。现在公司的内部运营后台有人提过想加一个『帮我写周报』的功能,我去跟组长说我想接,先做界面和接口。」

检查一下你的版本:如果写的是 P75 或者更高的数,问问自己凭什么是前 25%;如果第三个问题写的是「没有」,再想想内部工具、客服后台、文档站有没有能用上模型的地方。

验收标准:正文两段代码跑出和文中一样的输出,并且亲眼看到了小写 `k` 的 TypeError;练习 1、2 自己写出来并跑通;能不看文章说出国内挂牌年包中位数和它的口径;手里有一段自己的诚实预期。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 挂牌薪资 | 招聘页上写的薪资范围,是招聘方的报价,不是成交价 |
| 薪数 | 一年发几个月的钱。`16薪` 是 12 个月工资加 4 个月,多出来的一般是年终奖,不一定发满 |
| 年包 | 一年的总收入,这门课里指税前、按「区间中点 × 薪数」折算的数 |
| 口径 | 把原始数字换算成可比数字的规则。同一批数据换个口径,结论可能完全不同 |
| 正则表达式 | 描述「字符串长什么样」的小语言,比如 `\d+` 表示一串数字,用来从文本里取东西 |
| 中位数 | 从小到大排好后正中间的那个数,不受极端值影响,看薪资用它 |
| 平均数 | 全部加起来除以个数,一两个极端值就能把它拉偏 |
| P25 / P75 | 从低到高排成一队,第 25% 和第 75% 位置上的数。两者之间是「大多数」的范围 |
| 样本 | 拿来算统计的那批数据。样本越小,算出来的数越容易偏 |

## 常见误区

**拿平均数说事。** 练习 1 演示过,一条 243 万能把 10 条数据的平均数拉高将近 18 万,中位数只动 4.5 万。网上「某某岗位平均年薪 XX 万」的说法,先问是不是中位数。

**数组排序不传比较函数。** 正文里 `sort((a, b) => a - b)` 那个比较函数不能省。JS 的 `sort()` 默认把每个元素转成字符串再按字典序排,我在 Node 里跑 `[80, 100, 9].sort()`,结果是 `[ 100, 80, 9 ]`,因为字符串 `'1'` 排在 `'8'` 前面,`'8'` 又在 `'9'` 前面。正文那 10 个数刚好都是两位数,省了也能排对,这种「碰巧对」的代码最危险。

**以为挂牌价就是能拿到的钱。** 区间上沿给面试表现最强的人,16 薪里的年终奖按绩效发,还要扣税和社保公积金。比较行情用挂牌价,算自己的收入预期要往下打折。

**拿几条 JD 下结论。** 练习 2 里 10 条数据按年限一分组,1–3 年那组算出 21.3 万,全量是 40 万。我自己一开始只看智联的 24 条,得出中位 24 万,补全数据后是 48 万。看到一个薪资数字,先问样本有多少条、来自哪个平台。

**以为前端年限不算数。** JD 里的「3–5 年」一般指软件开发年限。你的前端年限算数,而且 Day 0 看过,三分之一以上的国内 Agent JD 提到前端或全栈。真正要补的是后端和 Agent 项目经验,不是从零开始。

**把海外远程当主路线。** 46 条海外远程里明确不限地区的只有 3 条。人在国内,更现实的是国内岗、新加坡或香港的岗位,或者以合同工身份接海外项目。

## 学习资料

### 文档与文章

- [880 条真实 JD 拆解](/blog/agent-jd-report-2026-10/):今天所有数字的出处。看「国内薪资、学历、年限」那一节,里面还有按公司规模的细表。
- [前端工程师转 Agent](/blog/frontend-to-agent-engineer/):这个站写给前端转 Agent 的人的一篇,今天先看「先看数据」和「必须补的短板」两节,20 分钟。
- [MDN String.prototype.match()](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/String/match):中文,看「返回值」那段,对应今天 `m` 为什么是数组或 `null`。
- [MDN Array.prototype.sort()](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/sort):中文,看「比较函数」那段,对应常见误区里 `[80, 100, 9]` 的坑。
- [MyCareersFuture](https://www.mycareersfuture.gov.sg):新加坡政府的职位库,每条都写月薪。搜「AI Engineer」看看新加坡的实际报价,10 分钟。
- [levels.fyi](https://www.levels.fyi):海外程序员自己报的真实薪资(成交价,不是挂牌价),英文,搜你感兴趣的公司看看,和今天的挂牌价对比一下口径的区别。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zfKr6vEnv&autoplay=0&high_quality=1" title="前端转AI应用岗-面试真题第一波" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>三十的前端课 · 前端转AI应用岗-面试真题第一波 · 18 分钟。一个前端出身的 UP 讲转 AI 应用岗被问了什么,听听面试官对前端背景的人关心哪些问题,和今天「做不到什么」那一节对照着看。播放量不高,当一份一手经验听。</figcaption>
</figure>

- B 站搜「大模型应用开发 面试」能找到不少面经类视频。听的时候注意分辨:讲的是应用开发岗还是算法岗,薪资是挂牌价还是自己拿到的。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LCEmiRjPEtQ" title="Andrej Karpathy: Software Is Changing (Again)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Y Combinator · Andrej Karpathy: Software Is Changing (Again) · 40 分钟,英文,可开自动字幕。Karpathy 讲软件开发怎么被大模型改变、为什么现阶段该做「部分自主」的产品。听完你会更明白这个岗位为什么值钱:模型不靠谱,把它做靠谱的人才稀缺。</figcaption>
</figure>

### 书籍

- Gergely Orosz《The Software Engineer's Guidebook》,2023 年作者自出版,[官网](https://www.engguidebook.com)。讲软件工程师从初级到资深每个阶段要会什么、怎么升级、怎么谈薪。不是 AI 的书,但「诚实预期」那部分的很多判断来自这类经验。今天不用读,找工作前读「Part I」。没查到中文版。

### 开源项目与代码

- [roadmap.sh 的 AI Engineer 路线图](https://roadmap.sh/ai-engineer):一张社区维护的「AI 工程师要学什么」的图,源码在 [developer-roadmap](https://github.com/kamranahmedse/developer-roadmap) 仓库。拿它和 Day 0 的课程地图对照,看看哪些这门课有、哪些它列了而我们不学(比如训练模型)。10 分钟。

## 自测

1. `30-60K·16薪` 折算成年包中点是多少万?写出算式。

<details><summary>答案</summary>

(30 + 60) ÷ 2 = 45K,45K × 16 = 720K = 72 万。正文 10 条里那个「可观测领域 AI Agent 开发工程师」就是这个薪资,`toYearly` 算出来也是 72。

</details>

2. 为什么看薪资用中位数而不是平均数?举一个今天的数字。

<details><summary>答案</summary>

平均数会被极端值拉偏,中位数不会。练习 1 里往 10 条数据加一条 243 万,平均数从 48.8 万涨到 66.5 万,中位数从 49.5 万只变成 54 万。

</details>

3. `'25-35k·15薪'.match(/(\d+)-(\d+)K(?:·(\d+)薪)?/)` 返回什么?接着取 `[1]` 会怎样?怎么修?

<details><summary>答案</summary>

返回 `null`,因为正则里是大写 `K`,字符串是小写 `k`。接着取 `[1]` 会报 `TypeError: Cannot read properties of null (reading '1')`。修法:正则末尾加 `i` 标志忽略大小写,并且取值前先判断 `if (!m) return null;`。

</details>

4. 国内这批数据里,3–5 年的挂牌年包中位数是多少?万人以上公司和 20 人以下公司的中位数各是多少?

<details><summary>答案</summary>

3–5 年中位 48 万(P25 35 万、P75 66 万)。万人以上公司中位 57 万,20 人以下的 36 万。

</details>

5. 一个做了 4 年前端的人,学完普通篇后最现实的定位是什么?

<details><summary>答案</summary>

「4 年前端 + 一个完整上线的 Agent 项目」,优先投全栈 Agent 工程师和大模型应用开发这两类,不按资深后端的价位谈。4 年前端算软件开发年限,真正要用项目证明的是后端和 Agent 能力。

</details>

## 明天预告

Day 2 · 准备工作:要装的软件、要注册的 API、整门课花多少钱。今天算的是你能挣多少,明天算你要花多少。明天会列一张整门课要装的软件清单,写清每样东西哪一天才需要装;然后用和今天类似的 JS 小脚本,一步步算出整门课的大模型 API 大概花多少钱。今天写的「区间中点 × 薪数」那种口径思维,明天算钱时还会用到。
