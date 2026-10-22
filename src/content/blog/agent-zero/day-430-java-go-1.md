---
title: 'Day 430 · 用 Java 和 Go 写 Agent(一):全景和 Spring AI'
description: '国内 Agent 岗里 Java 和 Go 各占两成多,很多公司的业务系统根本不是 Python。今天先看一眼 JVM 和 Go 上有哪些 Agent 框架,再从零装好 JDK 和 Maven,用十分钟对照 TypeScript 读懂 Java 语法,最后用 Spring AI 2.0 的 ChatClient 和 @Tool 把 Day 429 的查账 Agent 用 Java 重写一遍,实跑并和 Python 版逐项对照。'
pubDate: 2026-10-22
regime: none
tags: ['java', 'spring-ai', 'tool-calling', 'frameworks', 'agent-zero']
series: 'agent-zero'
day: 430
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 429](/blog/agent-zero/day-429-managed-runtimes/) 我们问了一个「要不要自己扛」的问题:Agent 的循环、沙箱、会话存储,是自己写还是租托管运行时。为了对比,我们写了一个自建版 `part07/managed/self_loop.py`:DeepSeek 加两个查账工具 `find_customer` 和 `list_invoices`,数据放在 `part07/managed/ledger.db` 这个三个客户、四张发票的迷你账本里。实跑一次大约 1530 个输入 token、252 个输出 token,两秒多,半分钱。

那一课里,循环换了地方(从自己进程换到厂商那边),语言没换,一直是 Python。可现实里你进的公司,后端很可能是 Spring Boot 或者一堆 Go 微服务,Agent 要嵌进去。今天和明天两天,把同一个查账 Agent 用 Java 和 Go 各写一遍。今天先看全景,再写 Spring AI 版。

## 今天要解决的问题

学完今天你应该能:

1. 说出 JVM 和 Go 上四个主流 Agent 框架(Spring AI、LangChain4j、Eino、Google ADK)是谁做的、2026 年 10 月是什么版本、适合什么团队。
2. 在自己电脑上装好 JDK 25 和 Maven,跑通一个 Java 程序,能对照 TypeScript 读懂 `class`、`record`、`List`、类型声明这些基本语法。
3. 用 Spring AI 的 **ChatClient** 问模型一句话,拿到回答和 token 用量。
4. 用 `@Tool` 注解把两个 Java 方法变成工具,跑通完整的工具循环,说清楚工具抛异常时模型看到什么、循环上限在哪配。

今天只有两个新概念:**ChatClient**(Spring AI 调模型的入口)和 **Java 里的 tool calling**(用注解声明工具,框架替你跑循环)。Java 语法和 Maven 是为了跑起来必须的脚手架,只讲到够用,不展开。

预计用时 2.5–3 小时,其中半小时可能花在装 JDK 和第一次下载依赖上。前置:[Day 157](/blog/agent-zero/day-157-tool-schema/) 的工具 JSON Schema、[Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 的 tool 消息一来一回、[Day 166](/blog/agent-zero/day-166-agent-min/) 的最小 Agent 循环、[Day 424](/blog/agent-zero/day-424-secrets-mgmt/) 的环境变量,以及 Day 429 建的 `ledger.py` 和 `ledger.db`。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `LedgerTools.java` 里一个工具方法和 `LedgerApp.java` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先看全景:为什么要看 Java 和 Go

先看数字。我们 10 月抓过一批 Agent 岗位 JD(站里 `docs/jd-research/summary.md`,正则关键词统计,不是人工标注):国内 334 条带正文的样本里,写了 Java 的占 23%,写了 Go 的也是 23%;只看大厂官网那 120 条,Go 高到 34%。海外 185 条里,这两个数字是 10% 和 14%。

这说明一件事:国内相当一部分 Agent 岗,干的是「在现有的 Java/Go 业务系统里加 Agent 能力」。面试官问你的常常不是「LangGraph 的 checkpoint 怎么用」,而是「我们订单系统是 Spring Boot,你打算怎么接」。课程到今天全是 Python,这两天补上这一块。你不需要变成 Java 工程师,目标是能读懂、能跑通、能在面试里说清楚取舍。

下面是 2026 年 10 月 22 日我从 Maven Central 和 Go 模块代理(proxy.golang.org)直接查的版本,不是从博客抄的:

| 框架 | 谁做的 | 语言 | 当前稳定版 | 一句话 |
| --- | --- | --- | --- | --- |
| Spring AI | Spring 官方(Broadcom) | Java | 2.0.1(2026-08-20;2.0.0 是 06-12) | Spring Boot 团队的首选,配置、注解、监控都是 Spring 那一套 |
| LangChain4j | 社区项目 | Java | 1.22.0(2026-10-07) | 不绑 Spring,纯 Java 就能用,用一个接口声明 Agent |
| Eino | 字节跳动 CloudWeGo | Go | v0.9.22(2026-10-19) | 国内 Go 团队用得最多,还在 0.x |
| Google ADK | Google | Python/Java/Go/TS | Go 版 v2.6.0(10-13),Java 版 1.13.0 | 围绕 Gemini 设计,Go 版从 v2.1 起有实验性的 OpenAI 协议支持 |

几个容易误会的地方先说清楚。**LangChain4j 和 Python 的 LangChain 没有隶属关系**,名字像,API 风格完全不同,简历上别写成「LangChain(Java)」。Spring AI 2.0 是跟着 Spring Boot 4 走的,要 JDK 17 以上。Eino 还在 0.x,小版本之间改 API 是常事,锁版本比 Java 那边要紧得多。国内 Java 圈还有阿里在 Spring AI 之上做的 Spring AI Alibaba,接通义和百炼方便,我这次没核对它的版本和维护状态,公司在用的话先去 GitHub 看最近几个月的提交。

名字一大堆,其实底下全是你学过的同一套东西:模型、工具定义、循环、循环上限、工具出错怎么回给模型。换了语言,只是换了叫法。

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="同一套 Agent 概念在 Python 手写版、Spring AI、LangChain4j、Eino 里的叫法对照">
  <rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="14" y="26" fill="var(--ink-soft)">概念</text>
    <text x="130" y="26" fill="var(--ink)">Python 手写</text>
    <text x="260" y="26" fill="var(--ink)">Spring AI</text>
    <text x="390" y="26" fill="var(--ink)">LangChain4j</text>
    <text x="520" y="26" fill="var(--ink)">Eino(Go)</text>
    <line x1="10" y1="36" x2="630" y2="36" stroke="var(--rule)"/>
    <rect x="10" y="44" width="620" height="40" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="14" y="68" fill="var(--ink)">调模型</text>
    <text x="130" y="68" fill="var(--ink)">client.chat...</text>
    <text x="260" y="68" fill="var(--ink)">ChatClient</text>
    <text x="390" y="68" fill="var(--ink)">OpenAiChatModel</text>
    <text x="520" y="68" fill="var(--ink)">openai.NewChatModel</text>
    <rect x="10" y="92" width="620" height="40" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="14" y="116" fill="var(--ink)">声明工具</text>
    <text x="130" y="116" fill="var(--ink)">手写 schema</text>
    <text x="260" y="116" fill="var(--ink)">@Tool 注解</text>
    <text x="390" y="116" fill="var(--ink)">@Tool 注解</text>
    <text x="520" y="116" fill="var(--ink)">InferTool 结构体</text>
    <rect x="10" y="140" width="620" height="40" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="14" y="164" fill="var(--ink)">跑循环</text>
    <text x="130" y="164" fill="var(--ink)">for 循环</text>
    <text x="260" y="164" fill="var(--ink)">.call() 里</text>
    <text x="390" y="164" fill="var(--ink)">AiServices 代理</text>
    <text x="520" y="164" fill="var(--ink)">ChatModelAgent</text>
    <rect x="10" y="188" width="620" height="40" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="14" y="212" fill="var(--ink)">循环上限</text>
    <text x="130" y="212" fill="var(--ink)">range(5)</text>
    <text x="260" y="212" fill="var(--ink)">工具调用总次数</text>
    <text x="390" y="212" fill="var(--ink)">连续工具轮数</text>
    <text x="520" y="212" fill="var(--ink)">MaxIterations</text>
    <rect x="10" y="236" width="620" height="40" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="14" y="260" fill="var(--ink)">工具出错</text>
    <text x="130" y="260" fill="var(--ink)">try/except</text>
    <text x="260" y="260" fill="var(--ink)">异常消息回模型</text>
    <text x="390" y="260" fill="var(--ink)">异常消息回模型</text>
    <text x="520" y="260" fill="var(--ink)">默认整次失败</text>
  </g>
</svg>
<figcaption>蓝色行是模型那一侧,琥珀色行是工具那一侧。今天写第一、二列的对照(Spring AI),明天写后两列。最后一行是三个框架差得最大的地方,明天会实测。</figcaption>
</figure>

## 第一步:装 JDK 和 Maven

前端的你装 Node 时会装两样东西:`node`(运行时)和 `npm`(包管理和脚本)。Java 这边也是两样:

- **JDK**(Java Development Kit):编译器 `javac` 加运行时 `java`,相当于 Node 本身。只装了 JRE(只有运行时没有编译器)是不够的。
- **Maven**:Java 最常用的构建工具,管依赖、编译、运行,相当于 npm。它读的配置文件叫 `pom.xml`,相当于 `package.json`。

版本选 **JDK 25**,它是 2025 年 9 月发布的长期支持版(LTS),2026 年 10 月最新的补丁是 25.0.4.1;Spring Boot 4 最低要 JDK 17,用最新 LTS 省心。装法二选一:

```bash
# 方法一:Homebrew(推荐)
brew install openjdk@25 maven

# 方法二:去 https://adoptium.net/ 下载 Temurin 25 的 .pkg 安装包双击装,Maven 用 brew 装
```

装完先确认版本。这里很容易踩坑,我第一次就栽在这:

```bash
java -version
mvn -version
```

我这台 2019 年的 Intel Mac 上,系统里本来就有一个很老的 Java 8,`java -version` 显示的是它:

```text
java version "1.8.0_321"
```

这时候直接在 Spring AI 项目里跑 `mvn compile`,Maven 会用这个 Java 8,报的错还特别不直观:

```text
[ERROR] COMPILATION ERROR :
[ERROR] No compiler is provided in this environment. Perhaps you are running on a JRE rather than a JDK?
```

原因是系统那份 Java 8 只是 JRE,没有编译器。解决办法是用环境变量 `JAVA_HOME` 告诉 Maven 用哪个 JDK,再把它的 `bin` 放到 `PATH` 最前面:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 25)
export PATH="$JAVA_HOME/bin:$PATH"
java -version
mvn -version
```

<div class="line-notes">

- `export JAVA_HOME=$(/usr/libexec/java_home -v 25)` `/usr/libexec/java_home` 是 macOS 自带的小工具,`-v 25` 让它打印装好的 JDK 25 的路径,`$(...)` 叫命令替换:先执行括号里的命令,再把它打印的内容当作值填进来。用 brew 装的话,如果这条找不到,按 brew 安装结束时提示的那行 `sudo ln -sfn ...` 链接一下。
- `export PATH="$JAVA_HOME/bin:$PATH"` 把 JDK 25 的 `bin` 放到最前面,之后敲 `java` 先找到它。这两行想长期生效就写进 `~/.zshrc`([Day 7](/blog/agent-zero/day-007-terminal-4/) 讲过 PATH 和 shell 配置文件)。
- `mvn -version` Maven 会打印它用的是哪个 Java。我这里实跑显示 `Apache Maven 3.8.6` 和 `Java version: 25.0.4.1, vendor: Eclipse Adoptium`,对上了才往下走。

</div>

`java -version` 这次输出:

```text
openjdk version "25.0.4.1" 2026-08-18 LTS
OpenJDK Runtime Environment Temurin-25.0.4.1+1 (build 25.0.4.1+1-LTS)
OpenJDK 64-Bit Server VM Temurin-25.0.4.1+1 (build 25.0.4.1+1-LTS, mixed mode)
```

用 Maven 3.8.6 加 JDK 25 跑的时候,终端还会先冒出四行 `WARNING: A restricted method in java.lang.System has been called`,来自 Maven 自己带的一个彩色输出库 jansi,是 JDK 新版本对老库的提醒,不影响结果。下面贴输出时我都把它去掉了。新版 Maven 没有这个问题。

## 第二步:给前端看的 Java 十分钟

Spring AI 的代码看起来吓人,主要是 Java 的语法比 TypeScript 啰嗦。先用一个 20 行的小程序把会遇到的语法过一遍,全部对着 TS 讲。

```bash
cd ~/agent-zero-lab
mkdir -p part07/java_go/hello-java
```

```java
// agent-zero-lab/part07/java_go/hello-java/Hello.java
import java.util.List;

public class Hello {

    record Invoice(String id, double amount, String status) {}

    static double unpaidTotal(List<Invoice> invoices) {
        double total = 0;
        for (Invoice inv : invoices) {
            if (inv.status().equals("open")) {
                total += inv.amount();
            }
        }
        return total;
    }

    public static void main(String[] args) {
        var invoices = List.of(
                new Invoice("INV-2026-0123", 2392.00, "paid"),
                new Invoice("INV-2026-0071", 2392.00, "open"));
        System.out.println(invoices.get(1));
        System.out.println("未付合计:" + unpaidTotal(invoices));
    }
}
```

<div class="line-notes">

- `import java.util.List;` 相当于 TS 的 `import { List } from "java/util"`。Java 的标准库按包组织,`java.util` 里是各种容器。每行语句以分号结尾,不能省。
- `public class Hello {` Java 里**所有代码都必须写在类里**,没有 TS 那种文件顶层的函数。文件名必须和 public 类名一样,所以这个文件只能叫 `Hello.java`。
- `record Invoice(String id, double amount, String status) {}` record 是 Java 16 起的「只装数据的类」,一行声明三个只读字段。相当于 TS 的 `type Invoice = Readonly<{ id: string; amount: number; status: string }>` 再加一个构造函数,也相当于 [Day 50](/blog/agent-zero/day-050-dataclass/) 学的 `@dataclass(frozen=True)`。类型写在名字**前面**:`String id` 对应 TS 的 `id: string`。
- `static double unpaidTotal(List<Invoice> invoices) {` 一个函数(Java 叫方法)。最前面的 `double` 是返回类型,相当于 TS 的 `function unpaidTotal(invoices: Invoice[]): number`。`static` 表示不用 new 出对象就能调,属于类本身。`List<Invoice>` 的尖括号是泛型,和 TS 的 `Array<Invoice>` 一个意思。
- `for (Invoice inv : invoices) {` 相当于 TS 的 `for (const inv of invoices)`。
- `if (inv.status().equals("open")) {` 两个坑。record 的字段读取要带括号 `inv.status()`,因为它其实是一个自动生成的方法。比较字符串要用 `.equals`,不能用 `==`:Java 的 `==` 比较的是「是不是同一个对象」,有时两个内容一样的字符串也会得到 false,这个坑每个 Java 新手都踩过。
- `public static void main(String[] args) {` 程序入口,相当于 Python 的 `if __name__ == "__main__":`([Day 32](/blog/agent-zero/day-032-modules/))。`void` 是「不返回值」,`String[] args` 是命令行参数数组,等于 Python 的 `sys.argv[1:]`。
- `var invoices = List.of(` `var` 让编译器自己推断类型,像 TS 的 `const` 加类型推断。`List.of(...)` 造一个**不可修改**的列表,往里 add 会抛异常。
- `new Invoice("INV-2026-0123", 2392.00, "paid"),` 造对象要写 `new`,和 JS 的 class 一样。两张发票的数据和 Day 429 的 `ledger.db` 一致。
- `System.out.println(invoices.get(1));` 相当于 `console.log(invoices[1])`。Java 的列表不能用 `[1]` 下标,要写 `.get(1)`。record 自动带了一个好看的打印格式,实跑打印 `Invoice[id=INV-2026-0071, amount=2392.0, status=open]`。
- `System.out.println("未付合计:" + unpaidTotal(invoices));` 字符串和数字用 `+` 拼接,和 JS 一样。实跑打印 `未付合计:2392.0`,`double` 打印时至少带一位小数。

</div>

JDK 11 起,单个文件的程序可以不先编译直接跑:

```bash
cd part07/java_go/hello-java
java Hello.java
```

```text
Invoice[id=INV-2026-0071, amount=2392.0, status=open]
未付合计:2392.0
```

一张表收一下今天要用到的对照:

| Java | TypeScript | Python |
| --- | --- | --- |
| `String id` | `id: string` | `id: str` |
| `double`、`int`、`long` | `number` | `float`、`int` |
| `List<Invoice>` | `Invoice[]` | `list[Invoice]` |
| `record Invoice(...)` | 只读的 type + 构造函数 | `@dataclass(frozen=True)` |
| `a.equals(b)` | `a === b` | `a == b` |
| `null` | `null` | `None` |
| `@Tool`(注解) | 装饰器 `@Tool` | 装饰器 `@tool` |
| `throw new IllegalArgumentException("...")` | `throw new Error("...")` | `raise ValueError("...")` |
| `try (...) { }` 自动关闭资源 | 无直接对应 | `with ...:` |

最后两行马上会在工具代码里见到。注解(annotation)长得和 TS、Python 的装饰器一样都是 `@名字`,区别是 Java 注解本身不执行任何代码,它只是贴在方法上的一张标签,框架启动时用**反射**(程序运行时读取自己的类、方法、参数信息的能力)把标签读出来再做事。Spring AI 就是靠读 `@Tool` 标签知道哪些方法是工具的。

## 第三步:Maven 项目和 pom.xml

单文件 `java Hello.java` 只适合玩具。要用 Spring AI 这种第三方库,得有一个 Maven 项目。Maven 对目录结构有固定约定,不按约定放它就找不到代码:

```text
part07/java_go/spring-ai/
├── pom.xml                                    ≈ package.json
└── src/main/
    ├── java/dev/agentzero/hello/HelloApp.java  ≈ src/ 里的源码
    ├── java/dev/agentzero/ledger/...
    └── resources/application.properties        ≈ .env 之外的配置文件
```

`java/` 下面的 `dev/agentzero/hello` 是**包名**按点拆成的目录。包名一般是倒过来的域名,我们没有域名,就用 `dev.agentzero`。代码文件第一行的 `package dev.agentzero.hello;` 必须和目录对得上。

```bash
cd ~/agent-zero-lab/part07/java_go
mkdir -p spring-ai/src/main/java/dev/agentzero/hello spring-ai/src/main/java/dev/agentzero/ledger spring-ai/src/main/resources
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- agent-zero-lab/part07/java_go/spring-ai/pom.xml -->
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.1.1</version>
  </parent>
  <groupId>dev.agentzero</groupId>
  <artifactId>ledger-spring-ai</artifactId>
  <version>0.1.0</version>
  <properties>
    <java.version>21</java.version>
    <spring-ai.version>2.0.1</spring-ai.version>
  </properties>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework.ai</groupId>
        <artifactId>spring-ai-bom</artifactId>
        <version>${spring-ai.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.ai</groupId>
      <artifactId>spring-ai-starter-model-openai</artifactId>
    </dependency>
    <dependency>
      <groupId>org.xerial</groupId>
      <artifactId>sqlite-jdbc</artifactId>
      <version>3.53.4.0</version>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
```

<div class="line-notes">

- `<?xml version="1.0" encoding="UTF-8"?>` XML 声明必须是文件第一行,前面连注释和空行都不能有,所以路径注释放在第二行。pom 是 XML 格式,写起来比 package.json 啰嗦,意思差不多。
- `<artifactId>spring-boot-starter-parent</artifactId>` 继承 Spring Boot 的「父 pom」。它替你管好了几百个依赖的版本,还默认给编译器打开了 `-parameters` 参数(让方法参数名保留到运行时),后面 `@Tool` 方法的参数名 `query`、`customerId` 能原样进工具 schema,靠的就是它。明天的 LangChain4j 没有这个父 pom,会实测不开的后果。
- `<version>4.1.1</version>` Spring Boot 4.1.1,2026-08-20 发布到 Maven Central。Spring AI 2.0.1 是按它构建的,别配 Boot 3.x。
- `<groupId>dev.agentzero</groupId>` 我们自己项目的「组织名 + 项目名 + 版本」三件套,相当于 package.json 的 `name` 和 `version`。Maven 里每个包都用 groupId:artifactId:version 定位。
- `<java.version>21</java.version>` 编译出的字节码按 Java 21 的标准,JDK 25 能编译也能运行它。写 21 是 Spring Boot 4 文档里常见的写法,你写 25 也行。
- `<spring-ai.version>2.0.1</spring-ai.version>` 2026 年 10 月最新稳定版。Maven Central 上还有 2.1.0-M1,M 是里程碑(预览)版,别用。
- `<artifactId>spring-ai-bom</artifactId>` BOM(Bill of Materials,物料清单)只声明一组库的版本,不引任何代码。`<scope>import</scope>` 把这些版本合并进来,下面引 Spring AI 的东西就不用每个都写版本号了。前端类比:像 monorepo 里统一锁版本的那份 catalog。
- `<artifactId>spring-ai-starter-model-openai</artifactId>` 「OpenAI 协议的聊天模型」启动包。DeepSeek、通义这些兼容 OpenAI 协议的厂商都走它,改 base-url 就行,和我们 Python 里用 openai SDK 调 DeepSeek 是一个道理。
- `<artifactId>sqlite-jdbc</artifactId>` SQLite 的 JDBC 驱动。JDBC 是 Java 访问数据库的标准接口,相当于 Python 的 DB-API(`sqlite3` 模块遵守的那套规范)。版本 3.53.4.0 是 2026-08-26 发布的,前三段跟着 SQLite 本身的版本走。
- `<artifactId>spring-boot-maven-plugin</artifactId>` 给 Maven 加一个 `spring-boot:run` 命令,相当于在 package.json 的 scripts 里加了一个 `start`。

</div>

## 第四步:环境变量,先踩一个坑

Python 这边我们一直用 `load_dotenv()` 读 `agent-zero-lab/.env`。Java 不引第三方库读 `.env`,让 shell 把变量导出给子进程就行。很多教程会这么写:

```bash
cd ~/agent-zero-lab
set -a; source .env; set +a
```

`set -a` 的意思是「之后定义的变量都自动 export」,然后 `source .env` 把文件当 shell 脚本执行一遍。在我们的 `.env` 上,zsh 直接报错:

```text
.env:5: parse error near `{'
```

第 5 行是 [Day 136](/blog/agent-zero/day-136-llm-client-2/) 起加的那行 `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`。`.env` 不是 shell 脚本,python-dotenv 能读这一行,zsh 不能,大括号在 shell 里有特殊意思。这个坑很常见:**`.env` 文件长得像 shell,但不是 shell**。

所以我们写一个只导出需要那几个变量的小脚本:

```bash
# agent-zero-lab/part07/java_go/env.sh
# 用法:在 agent-zero-lab 目录里 source part07/java_go/env.sh
for name in LLM_BASE_URL LLM_API_KEY LLM_MODEL; do
  export "$name=$(grep "^$name=" .env | cut -d= -f2-)"
done
export LEDGER_DB="$PWD/part07/managed/ledger.db"
echo "已导出 LLM_BASE_URL=$LLM_BASE_URL LLM_MODEL=$LLM_MODEL LEDGER_DB=$LEDGER_DB"
```

<div class="line-notes">

- `# 用法:在 agent-zero-lab 目录里 source part07/java_go/env.sh` 必须用 `source`,不能 `bash env.sh`。`bash` 会开一个子 shell 执行,export 的变量随子 shell 一起消失;`source` 在当前 shell 里执行,变量留下来,之后启动的 java、go 进程才能继承到。
- `for name in LLM_BASE_URL LLM_API_KEY LLM_MODEL; do` 只导出这三个,跳开那行 JSON。`for 变量 in 列表; do ...; done` 是 shell 的循环,相当于 JS 的 `for (const name of [...])`。`grep` 和管道 `|` 是 [Day 5](/blog/agent-zero/day-005-terminal-3/) 学的。
- `export "$name=$(grep "^$name=" .env | cut -d= -f2-)"` 从里往外读:`grep "^LLM_MODEL=" .env` 找出 `LLM_MODEL=deepseek-flash` 那一行;`cut -d= -f2-` 以等号切开,取第 2 段及之后(写 `-f2-` 而不是 `-f2`,是因为 API key 里万一有等号也不会被截断);最后 `export "LLM_MODEL=deepseek-flash"`。
- `export LEDGER_DB="$PWD/part07/managed/ledger.db"` Day 429 的迷你账本,写成绝对路径。Java 程序是在 `part07/java_go/spring-ai` 里启动的,写相对路径很容易数错 `../`。
- `echo "已导出 LLM_BASE_URL` 打印出来确认一下,**不打印 API key**,终端输出可能被截图分享。

</div>

```bash
cd ~/agent-zero-lab
source part07/java_go/env.sh
```

```text
已导出 LLM_BASE_URL=https://api.deepseek.com LLM_MODEL=deepseek-flash LEDGER_DB=/Users/你/agent-zero-lab/part07/managed/ledger.db
```

如果 `ledger.db` 不存在,先回去跑一遍 Day 429 的 `uv run python part07/managed/ledger.py`。

## 第五步:ChatClient,用 Java 问模型一句话

先不碰工具,只问一句话,把 Spring AI 的配置跑通。配置写在 `application.properties`:

```properties
# agent-zero-lab/part07/java_go/spring-ai/src/main/resources/application.properties
spring.main.web-application-type=none
spring.main.banner-mode=off
spring.ai.openai.base-url=${LLM_BASE_URL}
spring.ai.openai.api-key=${LLM_API_KEY}
spring.ai.openai.chat.model=${LLM_MODEL}
spring.ai.openai.chat.temperature=0
spring.ai.openai.chat.extra-body.thinking.type=disabled
spring.ai.tools.limits.max-total-tool-calls=6
ledger.db=${LEDGER_DB}
```

<div class="line-notes">

- `spring.main.web-application-type=none` 我们写的是命令行程序,不起 Web 服务器。Spring Boot 本来是做 Web 服务的,这一行告诉它跑完就退出。
- `spring.main.banner-mode=off` 关掉启动时那个很大的 ASCII 字符画 logo,输出干净一点。
- `spring.ai.openai.base-url=${LLM_BASE_URL}` `${...}` 是 Spring 的占位符,启动时去环境变量里找同名变量填进来,这里就是刚导出的 `https://api.deepseek.com`。不用加 `/v1`。
- `spring.ai.openai.chat.model=${LLM_MODEL}` 不写的话 Spring AI 会用它自己的默认模型名(OpenAI 的),拿 DeepSeek 的 key 去请求一个 DeepSeek 不认识的模型,报 400。
- `spring.ai.openai.chat.temperature=0` 和 Python 版一样设 0,方便对比。
- `spring.ai.openai.chat.extra-body.thinking.type=disabled` 相当于 Python 里的 `extra_body={"thinking": {"type": "disabled"}}`:往请求体里额外塞一个 `thinking` 字段,关掉 DeepSeek 的思考模式。点号表示嵌套,`extra-body.thinking.type` 会变成 `{"thinking": {"type": "disabled"}}`。
- `spring.ai.tools.limits.max-total-tool-calls=6` 工具调用总次数上限,第七步讲。
- `ledger.db=${LEDGER_DB}` 我们自己的配置项,工具类会读它。

</div>

主程序:

```java
// agent-zero-lab/part07/java_go/spring-ai/src/main/java/dev/agentzero/hello/HelloApp.java
package dev.agentzero.hello;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class HelloApp {

    public static void main(String[] args) {
        SpringApplication.run(HelloApp.class, args);
    }

    @Bean
    CommandLineRunner hello(ChatClient.Builder builder) {
        return args -> {
            ChatClient client = builder.build();
            ChatResponse resp = client.prompt()
                    .system("你是云簿 CloudLedger 的客服助手,回答不超过 30 个字。")
                    .user("你们的发票可以改抬头吗?")
                    .call()
                    .chatResponse();
            System.out.println(resp.getResult().getOutput().getText());
            System.out.println(resp.getMetadata().getUsage());
        };
    }
}
```

<div class="line-notes">

- `package dev.agentzero.hello;` 必须和文件所在目录 `java/dev/agentzero/hello/` 对上。
- `import org.springframework.ai.chat.client.ChatClient;` ChatClient 是今天第一个新概念:Spring AI 里调聊天模型的统一入口。不管背后是 OpenAI、DeepSeek 还是 Anthropic,代码都写成 `client.prompt()...call()`。
- `@SpringBootApplication` 一个注解顶三件事:这个类是配置类、打开自动配置、扫描当前包里的组件。**自动配置**是 Spring 的招牌:它看到依赖里有 OpenAI starter,又在配置里读到 base-url 和 api-key,就自动替你建好一个模型对象和一个 `ChatClient.Builder`,你一行初始化代码都不用写。
- `SpringApplication.run(HelloApp.class, args);` 启动 Spring。它会创建一个「容器」,把所有组件建好、互相接好。`HelloApp.class` 是把这个类本身当参数传进去(相当于传一个构造函数引用)。
- `@Bean` 告诉 Spring:「下面这个方法返回的对象,请你管起来。」被管起来的对象叫 bean。
- `CommandLineRunner hello(ChatClient.Builder builder) {` 关键在参数:我们没有 new 任何 builder,Spring 看到这个方法要一个 `ChatClient.Builder`,就把自动配置建好的那个**塞进来**。这叫依赖注入(dependency injection):你声明要什么,容器负责给。前端类比是 React 的 Context,组件说「我要 theme」,Provider 负责提供。`CommandLineRunner` 是「容器启动完要跑的一段代码」。
- `return args -> {` `args -> { ... }` 是 Java 的 lambda,相当于 JS 的箭头函数 `(args) => { ... }`。
- `ChatClient client = builder.build();` 用 builder 造出 client。builder 模式在 Java 里到处都是,因为 Java 没有 JS 那种 `{ model: "...", temperature: 0 }` 对象字面量传参。
- `ChatResponse resp = client.prompt()` 链式调用开始。`prompt()` 开一次请求。
- `.system("你是云簿 CloudLedger 的客服助手,回答不超过 30 个字。")` 等于 messages 里加一条 `{"role": "system", ...}`。
- `.user("你们的发票可以改抬头吗?")` 等于加一条 `{"role": "user", ...}`。
- `.call()` 同步发出请求,等结果。还有一个 `.stream()`,练习 1 用。
- `.chatResponse();` 要完整的响应对象。只想要文字的话写 `.content()`,直接得到一个 String。
- `System.out.println(resp.getResult().getOutput().getText());` 一层层往里取:结果、输出消息、文字。相当于 Python 的 `resp.choices[0].message.content`。实跑打印 `可以，在开票前联系客服修改抬头即可。`
- `System.out.println(resp.getMetadata().getUsage());` token 用量。实跑打印 `DefaultUsage{promptTokens=30, completionTokens=12, totalTokens=42, cacheReadInputTokens=0}`。

</div>

运行。Maven 会先下载依赖,第一次大约 150MB,要几分钟;我的练习目录里有两个入口类(后面还会加),所以用 `-Dspring-boot.run.main-class` 指定跑哪个:

```bash
cd ~/agent-zero-lab/part07/java_go/spring-ai
mvn -q spring-boot:run -Dspring-boot.run.main-class=dev.agentzero.hello.HelloApp
```

```text
2026-10-22T18:51:18.963+08:00  INFO 76249 --- [           main] dev.agentzero.hello.HelloApp             : Starting HelloApp using Java 25.0.4.1 with PID 76249 (...)
2026-10-22T18:51:18.970+08:00  INFO 76249 --- [           main] dev.agentzero.hello.HelloApp             : No active profile set, falling back to 1 default profile: "default"
2026-10-22T18:51:23.763+08:00  INFO 76249 --- [           main] dev.agentzero.hello.HelloApp             : Started HelloApp in 6.202 seconds (process running for 7.56)
可以，在开票前联系客服修改抬头即可。
DefaultUsage{promptTokens=30, completionTokens=12, totalTokens=42, cacheReadInputTokens=0}
```

`-q` 让 Maven 自己少说话,但 Spring 的启动日志还在。注意 `Started HelloApp in 6.202 seconds`:光启动 Spring 就花了 6 秒,整条命令(含编译)跑了 20 秒。Python 脚本是一秒内就开始干活的。对一个长期运行的服务这无所谓,启动一次跑几个月;对命令行小工具就很难受。这是 Java 生态的一个真实代价,面试被问「为什么 Agent 原型都用 Python」时可以提一句。

还有一个细节值得看:模型答了「在开票前联系客服修改抬头即可」。我们没给它任何云簿的资料,这句话是它编的,也就是 [Day 114](/blog/agent-zero/day-114-hallucination/) 讲的幻觉。换成 Java 不会让这个问题消失,接下来给它工具,让它查了再说。

这一次花了多少钱:按 DeepSeek 2026 年 10 月忙时价(输入未命中 2 元/百万 token、输出 8 元/百万 token,和 Day 429 用的同一组数),(30 × 2 + 12 × 8) ÷ 1,000,000 = 0.000156 元。

## 第六步:@Tool,把 Java 方法变成工具

现在是第二个新概念。回忆 Python 版 Day 429 的 `self_loop.py`:我们手写了两个工具的 JSON Schema(那个 `fn(...)` 小函数),手写了按名字查表执行(`LOCAL_TOOLS`),手写了出错时把错误文字交给模型(`run_local`)。Spring AI 把这三件事都换成了**注解 + 反射**:你在普通 Java 方法上贴 `@Tool`,框架启动时读出方法名、参数名、参数类型和你写的描述,自动生成 JSON Schema。

```java
// agent-zero-lab/part07/java_go/spring-ai/src/main/java/dev/agentzero/ledger/LedgerTools.java
package dev.agentzero.ledger;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class LedgerTools {

    public record Customer(String id, String name, String email, String company) {}

    public record Invoice(String id, double amount, String status, String issuedOn) {}

    private final String jdbcUrl;

    public LedgerTools(@Value("${ledger.db}") String dbPath) {
        if (!Files.exists(Path.of(dbPath))) {
            throw new IllegalStateException("找不到 " + dbPath + ",先跑 Day 429 的 ledger.py 建库");
        }
        this.jdbcUrl = "jdbc:sqlite:" + dbPath;
    }

    @Tool(name = "find_customer",
          description = "按邮箱、姓名、公司名或客户编号查客户。查发票之前先用它拿 customer_id。")
    public List<Customer> findCustomer(@ToolParam(description = "邮箱、姓名、公司名或编号") String query) {
        System.out.println("[工具] find_customer(query=" + query + ")");
        String sql = "SELECT id, name, email, company FROM customers "
                + "WHERE id = ? OR email = ? OR name LIKE ? OR company LIKE ? LIMIT 5";
        List<Customer> out = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(jdbcUrl);
             PreparedStatement ps = conn.prepareStatement(sql)) {
            String like = "%" + query + "%";
            ps.setString(1, query);
            ps.setString(2, query);
            ps.setString(3, like);
            ps.setString(4, like);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new Customer(rs.getString("id"), rs.getString("name"),
                            rs.getString("email"), rs.getString("company")));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("查客户失败:" + e.getMessage(), e);
        }
        if (out.isEmpty()) {
            throw new IllegalArgumentException("没找到和「" + query + "」匹配的客户。换成邮箱、姓名或公司名再试。");
        }
        return out;
    }

    @Tool(name = "list_invoices", description = "列出客户最近 3 张发票,金额单位元。status 可选 paid/open。")
    public List<Invoice> listInvoices(
            @ToolParam(description = "客户编号,如 C007") String customerId,
            @ToolParam(description = "paid 或 open,不填就查全部", required = false) String status) {
        System.out.println("[工具] list_invoices(customerId=" + customerId + ", status=" + status + ")");
        String sql = "SELECT id, amount, status, issued_on FROM invoices WHERE customer_id = ?"
                + (status != null ? " AND status = ?" : "")
                + " ORDER BY issued_on DESC LIMIT 3";
        List<Invoice> out = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(jdbcUrl);
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, customerId);
            if (status != null) {
                ps.setString(2, status);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new Invoice(rs.getString("id"), rs.getDouble("amount"),
                            rs.getString("status"), rs.getString("issued_on")));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("查发票失败:" + e.getMessage(), e);
        }
        if (out.isEmpty()) {
            throw new IllegalArgumentException("客户 " + customerId + " 没有发票记录。确认编号是否来自 find_customer 的结果。");
        }
        return out;
    }
}
```

<div class="line-notes">

- `@Component` 让 Spring 扫描到这个类,自动 new 一个出来管着(它也是一个 bean)。下面主程序要用它时,直接写成参数让 Spring 注入,不用自己 new。
- `public record Customer(String id, String name, String email, String company) {}` 工具的返回值类型。Spring AI 会用 Jackson(Java 最常用的 JSON 库)把它转成 JSON 交给模型,字段名就是 JSON 的键,得到 `{"id":"C007","name":"刘静","email":"user007@example.com","company":"半岛咖啡"}`。和 Python 版 `dict(r)` 的结果一模一样。
- `public record Invoice(String id, double amount, String status, String issuedOn) {}` 注意 Java 习惯驼峰命名 `issuedOn`,所以给模型的 JSON 键也是 `issuedOn`,而 Python 版是 `issued_on`。混用两种语言时,这种小差异会让评测脚本对不上,要统一可以给字段加 Jackson 的 `@JsonProperty("issued_on")`。
- `private final String jdbcUrl;` `private` 只有类内部能用,`final` 赋值一次后不能改,相当于 TS 的 `private readonly`。
- `public LedgerTools(@Value("${ledger.db}") String dbPath) {` 构造函数,名字和类名相同。`@Value("${ledger.db}")` 让 Spring 把配置文件里 `ledger.db` 的值(也就是环境变量 `LEDGER_DB`)注入进来。
- `if (!Files.exists(Path.of(dbPath))) {` 这里有个三种语言都会踩的坑:**SQLite 驱动遇到不存在的路径不报错,会悄悄新建一个空库**,然后工具报 `no such table: customers`,模型拿到这个错还会一本正经地编理由。所以启动时就检查文件在不在。
- `this.jdbcUrl = "jdbc:sqlite:" + dbPath;` JDBC 用 URL 描述「连哪个数据库」,SQLite 的写法是 `jdbc:sqlite:` 加文件路径。
- `@Tool(name = "find_customer",` 贴上工具标签。`name` 不写时默认用方法名 `findCustomer`,我们显式写成和 Python 版一样的蛇形名字,trace 和评测里才对得上。
- `description = "按邮箱、姓名、公司名或客户编号查客户。查发票之前先用它拿 customer_id。")` 和 Python 版的工具描述一字不差。[Day 180](/blog/agent-zero/day-180-tool-design-1/) 讲过,后半句是写给模型的调用顺序提示。
- `public List<Customer> findCustomer(@ToolParam(description = "邮箱、姓名、公司名或编号") String query) {` `@ToolParam` 给参数写描述,对应 JSON Schema 里的 `description`。Spring AI 默认所有参数都必填。
- `System.out.println("[工具] find_customer(query=" + query + ")");` 打印一行,好在终端里看到模型传了什么参数。
- `try (Connection conn = DriverManager.getConnection(jdbcUrl);` try 后面带括号叫 try-with-resources:括号里打开的连接,块结束时自动关闭,哪怕中间抛了异常。和 Python 的 `with sqlite3.connect(DB) as conn:` 是一回事。
- `PreparedStatement ps = conn.prepareStatement(sql)) {` 预编译的 SQL,`?` 是占位符,和 Python 版一样防 SQL 注入,模型传什么都只会被当成值。
- `ps.setString(1, query);` 给第 1 个 `?` 填值。**JDBC 的下标从 1 开始**,不是 0,这是 Java 新手最常写错的地方之一。四个 `?` 依次填邮箱精确匹配、编号精确匹配、姓名模糊、公司名模糊。
- `while (rs.next()) {` `ResultSet` 像一个游标,`next()` 往下挪一行,没有下一行就返回 false。相当于 Python 的 `for row in cursor`。
- `} catch (SQLException e) {` 数据库出错时抛的是 `SQLException`,它是**受检异常**:Java 编译器强制你要么 catch 它,要么在方法签名上声明 `throws SQLException`。TS 和 Python 都没有这个概念。
- `throw new IllegalStateException("查客户失败:" + e.getMessage(), e);` 把受检异常包成运行时异常再抛。原因下一步实测时讲:Spring AI 只会把**运行时异常**的消息交给模型。
- `throw new IllegalArgumentException("没找到和「" + query + "」匹配的客户。换成邮箱、姓名或公司名再试。");` 查不到不返回空列表,而是抛一个写给模型看的错误,告诉它下一步怎么做。这就是 [Day 282](/blog/agent-zero/day-282-mcp-errors/) 学的「出错时让模型看得懂」,也是 Python 版 `raise ValueError(...)` 的翻版。
- `@ToolParam(description = "paid 或 open,不填就查全部", required = false) String status) {` 可选参数。模型没传时 `status` 是 `null`。
- `+ (status != null ? " AND status = ?" : "")` 三元表达式和 JS 一样。有 status 时多拼一个条件。
- `ps.setString(2, status);` 有 status 时它是第 2 个 `?`。代入实测的第二个问题「北岸设计有没有没付的发票」:模型传了 `customerId=C012, status=open`,SQL 里两个 `?` 都填上,查出 `INV-2026-0130`。

</div>

框架生成的 schema 长什么样?Spring AI 提供了一个 `ToolCallbacks.from(...)`,能在不启动模型的情况下把工具定义打印出来:

```java
// agent-zero-lab/part07/java_go/spring-ai/src/main/java/dev/agentzero/schema/SchemaDump.java
package dev.agentzero.schema;

import org.springframework.ai.support.ToolCallbacks;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.ToolDefinition;

import dev.agentzero.ledger.LedgerTools;

public class SchemaDump {

    public static void main(String[] args) {
        LedgerTools tools = new LedgerTools(System.getenv("LEDGER_DB"));
        for (ToolCallback cb : ToolCallbacks.from(tools)) {
            ToolDefinition def = cb.getToolDefinition();
            System.out.println("== " + def.name() + ":" + def.description());
            System.out.println(def.inputSchema());
        }
    }
}
```

<div class="line-notes">

- `public class SchemaDump {` 一个普通的 main,没有 `@SpringBootApplication`,不启动 Spring 容器,所以秒出结果。要放在 `java/dev/agentzero/schema/` 目录下。
- `LedgerTools tools = new LedgerTools(System.getenv("LEDGER_DB"));` 没有 Spring 帮忙注入,就自己 new,自己从环境变量取路径。`System.getenv` 相当于 Python 的 `os.environ.get`,取不到返回 `null`。
- `for (ToolCallback cb : ToolCallbacks.from(tools)) {` `ToolCallbacks.from` 用反射扫出对象上所有贴了 `@Tool` 的方法,每个方法变成一个 `ToolCallback`(能执行的工具)。这里扫出 2 个。
- `ToolDefinition def = cb.getToolDefinition();` 工具的「说明书」部分:名字、描述、参数 schema,就是会发给模型的那段。
- `System.out.println(def.inputSchema());` 打印参数的 JSON Schema 字符串。

</div>

```bash
mvn -q spring-boot:run -Dspring-boot.run.main-class=dev.agentzero.schema.SchemaDump
```

```text
== find_customer:按邮箱、姓名、公司名或客户编号查客户。查发票之前先用它拿 customer_id。
{
  "$schema" : "https://json-schema.org/draft/2020-12/schema",
  "type" : "object",
  "properties" : {
    "query" : {
      "type" : "string",
      "description" : "邮箱、姓名、公司名或编号"
    }
  },
  "required" : [ "query" ],
  "additionalProperties" : false
}
== list_invoices:列出客户最近 3 张发票,金额单位元。status 可选 paid/open。
{
  "$schema" : "https://json-schema.org/draft/2020-12/schema",
  "type" : "object",
  "properties" : {
    "customerId" : {
      "type" : "string",
      "description" : "客户编号,如 C007"
    },
    "status" : {
      "type" : "string",
      "description" : "paid 或 open,不填就查全部"
    }
  },
  "required" : [ "customerId" ],
  "additionalProperties" : false
}
```

拿它和 Day 429 `self_loop.py` 里手写的那两个 `fn(...)` 对一下:结构完全一样,都是 Day 157 学的 `type: object` + `properties` + `required`。差别有两处。一是 `required` 是框架根据 `required = false` 推出来的,`status` 不在里面。二是参数名变成了 `customerId`(驼峰),Python 版是 `customer_id`。参数名是从 Java 方法的参数名读出来的,所以那个 `-parameters` 编译选项很要紧,明天会看到没开它时参数名变成什么。

## 第七步:跑通完整的工具循环

工具有了,主程序把它们交给 ChatClient:

```java
// agent-zero-lab/part07/java_go/spring-ai/src/main/java/dev/agentzero/ledger/LedgerApp.java
package dev.agentzero.ledger;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class LedgerApp {

    public static void main(String[] args) {
        SpringApplication.run(LedgerApp.class, args);
    }

    @Bean
    CommandLineRunner ask(ChatClient.Builder builder, LedgerTools tools) {
        return args -> {
            ChatClient client = builder
                    .defaultSystem("你是云簿 CloudLedger 的客服助手。先用工具核实,再用中文回答,金额写元。")
                    .defaultTools(tools)
                    .build();
            String question = args.length > 0 ? String.join(" ", args)
                    : "user007@example.com 这个客户最近三张发票都付了吗?";
            long start = System.currentTimeMillis();
            ChatResponse resp = client.prompt().user(question).call().chatResponse();
            System.out.println(resp.getResult().getOutput().getText());
            var usage = resp.getMetadata().getUsage();
            System.out.printf("整个循环合计:输入 %d / 输出 %d token,总用时 %.1fs%n",
                    usage.getPromptTokens(), usage.getCompletionTokens(),
                    (System.currentTimeMillis() - start) / 1000.0);
        };
    }
}
```

<div class="line-notes">

- `CommandLineRunner ask(ChatClient.Builder builder, LedgerTools tools) {` 这次要两样东西,Spring 都会注入:builder 来自自动配置,`tools` 是刚才那个 `@Component`。
- `.defaultSystem("你是云簿 CloudLedger 的客服助手。先用工具核实,再用中文回答,金额写元。")` 和 Python 版 `self_loop.py` 的 system 一字不差。`default` 前缀表示这个 client 每次请求都带上它。
- `.defaultTools(tools)` 把整个对象交进去,框架扫出两个 `@Tool` 方法,每次请求都带上这两个工具定义。官方文档提醒过:有副作用的工具(比如退款)别放进 defaults,按次用 `.tools(...)` 传,只在需要时才给模型看到。我们这两个都是只读的。
- `String question = args.length > 0 ? String.join(" ", args)` 命令行参数可以换问题,不传就问默认的那句,和 Python 版 `sys.argv[1]` 的写法对应。
- `long start = System.currentTimeMillis();` 记开始时间(毫秒)。放在 Spring 启动**之后**,所以下面的用时不含那 6 秒启动。
- `ChatResponse resp = client.prompt().user(question).call().chatResponse();` 整个 Agent 循环都藏在这一行的 `.call()` 里:发请求,模型说要调 `find_customer`,框架执行方法、把结果塞回消息、再请求,模型又要 `list_invoices`,再执行、再请求,直到模型不再要工具。Python 版里那个 `for _ in range(5):` 循环,在 Spring AI 里是一个叫 `ToolCallingAdvisor` 的类替你跑的。
- `var usage = resp.getMetadata().getUsage();` 用量是**整个循环所有轮次加起来**的。实跑 `输入 1768 / 输出 265`。
- `System.out.printf("整个循环合计:输入 %d / 输出 %d token,总用时 %.1fs%n",` `printf` 和 C、Python 的 `%` 格式化一样,`%d` 整数,`%.1f` 一位小数,`%n` 换行。

</div>

```bash
mvn -q spring-boot:run -Dspring-boot.run.main-class=dev.agentzero.ledger.LedgerApp
```

实跑输出(去掉了 Spring 的 INFO 启动日志):

```text
[工具] find_customer(query=user007@example.com)

[工具] list_invoices(customerId=C007, status=null)
刘静（半岛咖啡，客户编号 C007）最近三张发票情况如下：

| 发票号 | 开票日期 | 金额 | 状态 |
|---|---|---|---|
| INV-2026-0123 | 2026-10-08 | 2392 元 | 已付 |
| INV-2026-0098 | 2026-09-08 | 2392 元 | 已付 |
| INV-2026-0071 | 2026-08-08 | 2392 元 | **未付** |

结论：**没有全部付清**。最近两张（9 月、10 月）已付款，但 8 月 8 日开出的 INV-2026-0071（2392 元）仍处于未付状态，建议跟进催收。
整个循环合计:输入 1768 / 输出 265 token,总用时 9.3s
```

和 Python 版一样:先查客户拿到 C007,再查发票,找到那张未付的 INV-2026-0071。换个问题,用公司名问:

```bash
mvn -q spring-boot:run -Dspring-boot.run.main-class=dev.agentzero.ledger.LedgerApp \
  -Dspring-boot.run.arguments="北岸设计有没有没付的发票?"
```

```text
[工具] find_customer(query=北岸设计)

[工具] list_invoices(customerId=C012, status=open)
北岸设计（客户编号 C012，联系人王磊）目前有 **1 张未付发票**：

- 发票号：INV-2026-0130
- 金额：599 元
- 状态：未付
- 开票日期：2026-10-12

需要我帮您查看这张发票的详情，或者核对已付记录吗？
整个循环合计:输入 1700 / 输出 188 token,总用时 8.1s
```

模型自己想到传 `status=open`,和 Python 版那次一样。把两版的数字放一起看:

| | Python `self_loop.py`(Day 429) | Spring AI `LedgerApp` |
| --- | --- | --- |
| 默认问题的工具调用 | find_customer → list_invoices | find_customer → list_invoices |
| 输入 / 输出 token | 1530 / 252 | 1768 / 265 |
| 循环用时(不含启动) | 2.3s | 9.3s |
| 写了多少行循环代码 | 约 25 行 | 0 行(在 `.call()` 里) |

输入 token 多了两百多,来自 Spring AI 生成的 schema 比我们手写的啰嗦(`$schema`、`additionalProperties` 这些字段,外加每个参数的 description)。用时差得多:9.3 秒对 2.3 秒。我在同一台机器、同一时段连跑了几次都是 8 到 9 秒,而明天的 LangChain4j 版是 4.2 秒、Go 版是 2.7 秒。我没有往下查是 Spring AI 的哪一层慢(它底层用的是 OpenAI 官方的 Java SDK,第一次请求可能有初始化开销),这里只记一个实测现象:**同一个任务,换框架后延迟可能差好几倍,上线前要自己测**。

两次的花费:(1768 × 2 + 265 × 8) ÷ 1,000,000 ≈ 0.0057 元,(1700 × 2 + 188 × 8) ÷ 1,000,000 ≈ 0.0049 元。

### 想看框架在背后做了什么

`.call()` 把循环藏起来了,调试时得把它翻出来。打开 Spring AI 的 DEBUG 日志。这里我先踩了个坑:想当然地写成 `-Dspring-boot.run.arguments="--logging.level.org.springframework.ai=DEBUG"`,结果这串字被当成了用户问题传给模型,模型很认真地回了一句「你发来的这行内容看起来是 Spring 的日志配置,不是我能处理的账户或发票问题」。原因是我们的代码把 `args` 全部拼成了问题。改成走 JVM 参数:

```bash
mvn -q spring-boot:run -Dspring-boot.run.main-class=dev.agentzero.ledger.LedgerApp \
  -Dspring-boot.run.jvmArguments="-Dlogging.level.org.springframework.ai=DEBUG"
```

```text
... DEBUG ... o.s.a.m.tool.DefaultToolCallingManager   : Executing tool call: find_customer
... DEBUG ... o.s.ai.tool.method.MethodToolCallback    : Starting execution of tool: find_customer
... DEBUG ... o.s.ai.tool.method.MethodToolCallback    : Successful execution of tool: find_customer
... DEBUG ... o.s.a.t.e.DefaultToolCallResultConverter : Converting tool result to JSON.
... DEBUG ... o.s.a.m.tool.DefaultToolCallingManager   : Executing tool call: list_invoices
... DEBUG ... o.s.ai.tool.method.MethodToolCallback    : Starting execution of tool: list_invoices
... DEBUG ... o.s.ai.tool.method.MethodToolCallback    : Successful execution of tool: list_invoices
... DEBUG ... o.s.a.t.e.DefaultToolCallResultConverter : Converting tool result to JSON.
```

这八行就是 Python 版循环里那几步的 Java 名字:`DefaultToolCallingManager` 按名字找到工具(我们的 `LOCAL_TOOLS[name]`),`MethodToolCallback` 用反射调方法(我们的 `run_local`),`DefaultToolCallResultConverter` 把返回的 record 列表转成 JSON(我们的 `json.dumps`)。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="Spring AI 的 call() 内部:ChatClient 经 ToolCallingAdvisor 调模型,模型要工具时由 ToolCallingManager 找到 MethodToolCallback 执行 LedgerTools 的方法,结果转 JSON 回到消息里再调模型">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="100" width="100" height="50" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="66" y="122" text-anchor="middle" fill="var(--ink)">你的代码</text>
    <text x="66" y="138" text-anchor="middle" fill="var(--ink-soft)">.call()</text>
    <line x1="116" y1="125" x2="150" y2="125" stroke="var(--ink-soft)"/>
    <rect x="150" y="30" width="250" height="200" rx="4" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="275" y="48" text-anchor="middle" fill="var(--ink-faint)">ToolCallingAdvisor 的循环</text>
    <rect x="166" y="62" width="218" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="275" y="86" text-anchor="middle" fill="var(--ink)">请求模型(带两个工具定义)</text>
    <rect x="166" y="120" width="218" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="275" y="144" text-anchor="middle" fill="var(--ink)">ToolCallingManager 按名字找</text>
    <rect x="166" y="176" width="218" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="275" y="200" text-anchor="middle" fill="var(--ink)">MethodToolCallback 反射调用</text>
    <line x1="275" y1="102" x2="275" y2="120" stroke="var(--ink-soft)"/>
    <text x="282" y="115" fill="var(--ink-faint)">要工具</text>
    <line x1="275" y1="160" x2="275" y2="176" stroke="var(--ink-soft)"/>
    <path d="M 384 196 L 398 196 L 398 82 L 384 82" fill="none" stroke="var(--ink-soft)"/>
    <text x="404" y="140" fill="var(--ink-faint)">结果转 JSON 塞回消息</text>
    <rect x="470" y="176" width="150" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="545" y="194" text-anchor="middle" fill="var(--ink)">LedgerTools</text>
    <text x="545" y="208" text-anchor="middle" fill="var(--ink-soft)">findCustomer()</text>
    <line x1="384" y1="206" x2="470" y2="206" stroke="var(--compute)" stroke-dasharray="3 3"/>
    <rect x="470" y="62" width="150" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="545" y="86" text-anchor="middle" fill="var(--ink)">DeepSeek API</text>
    <line x1="384" y1="82" x2="470" y2="82" stroke="var(--mem)"/>
    <text x="66" y="200" text-anchor="middle" fill="var(--ink-faint)">不要工具时</text>
    <text x="66" y="216" text-anchor="middle" fill="var(--ink-faint)">返回最终回答</text>
  </g>
</svg>
<figcaption>虚线框里就是 Day 166 那个循环,Spring AI 把它拆成了几个类。蓝色是模型那一侧,琥珀色是工具那一侧。</figcaption>
</figure>

## 第八步:工具出错,和循环上限

两件 Python 版里我们亲手处理过的事,看 Spring AI 怎么做。

**工具抛异常。** 问一个不存在的客户,同时把工具相关的日志打开:

```bash
mvn -q spring-boot:run -Dspring-boot.run.main-class=dev.agentzero.ledger.LedgerApp \
  -Dspring-boot.run.arguments="user999@example.com 有没有没付的发票?" \
  -Dspring-boot.run.jvmArguments="-Dlogging.level.org.springframework.ai.tool=DEBUG"
```

输出里先是一大段异常堆栈(我删掉了中间 30 多行 `at ...`),然后是模型的回答:

```text
[工具] find_customer(query=user999@example.com)

... DEBUG ... e.DefaultToolExecutionExceptionProcessor : Exception thrown by tool: find_customer. Message: 没找到和「user999@example.com」匹配的客户。换成邮箱、姓名或公司名再试。

org.springframework.ai.tool.execution.ToolExecutionException: 没找到和「user999@example.com」匹配的客户。换成邮箱、姓名或公司名再试。
	at org.springframework.ai.tool.method.MethodToolCallback.callMethod(MethodToolCallback.java:192) ~[spring-ai-model-2.0.1.jar:2.0.1]
	...
Caused by: java.lang.IllegalArgumentException: 没找到和「user999@example.com」匹配的客户。换成邮箱、姓名或公司名再试。
	at dev.agentzero.ledger.LedgerTools.findCustomer(LedgerTools.java:59) ~[classes/:na]
	... 35 common frames omitted

没有找到与 user999@example.com 匹配的客户记录，所以暂时无法查询发票。

麻烦您确认一下：
- 邮箱是否输入正确（比如有没有拼写错误、是否用了另一个邮箱）
- 或者提供客户的姓名、公司名或客户编号，我再帮您查一次
整个循环合计:输入 1039 / 输出 109 token,总用时 5.5s
```

看到那么长的堆栈先别慌,程序没有崩。那是 DEBUG 日志顺手把异常打印出来了,真正发生的事是:我们抛的 `IllegalArgumentException` 被框架包成 `ToolExecutionException`,交给 `DefaultToolExecutionExceptionProcessor`,它把异常消息当成工具结果发回给模型,模型读到那句中文,老老实实请用户确认。Spring AI 文档的规则是:**运行时异常的消息回给模型;受检异常和 `Error` 直接抛给调用方**,整个 `.call()` 失败。这就是上一步为什么要把 `SQLException`(受检异常)包成 `IllegalStateException`(运行时异常)再抛。想要「工具一出错就整个失败」,可以设 `spring.ai.tools.throw-exception-on-error=true`。

**循环上限。** Python 版用 `for _ in range(5)` 限制最多 5 轮。Spring AI 没有「最多几轮」的设置,它限制的是**工具调用次数**:文档里的默认值是单个工具每轮对话 40 次、所有工具合计 150 次。对一个查账任务来说 150 太宽了,所以我们的配置里写了 `max-total-tool-calls=6`。把它临时压到 1 看看(用 JVM 参数覆盖配置文件,不用改文件):

```bash
mvn -q spring-boot:run -Dspring-boot.run.main-class=dev.agentzero.ledger.LedgerApp \
  -Dspring-boot.run.jvmArguments="-Dspring.ai.tools.limits.max-total-tool-calls=1"
```

```text
[工具] find_customer(query=user007@example.com)

Total tool call limit (1) exceeded for this turn. No further tool calls are allowed.
整个循环合计:输入 1049 / 输出 88 token,总用时 5.0s
```

第一个工具调完,模型要第二个时触线。注意最后的「回答」是一句英文,它不是模型写的,是框架在超限时直接塞进来的结果。文档说默认行为 `on-limit-exceeded=THROW` 会抛 `ToolCallLimitExceededException`,`ToolCallingAdvisor` 接住它,把这句话作为最终回复返回,finish reason 标成超限。所以你的代码拿到的是一个「正常」的回复,内容却是给开发者看的英文。上线时一定要检查 finish reason,别把这句话原样推给用户。练习 3 会试另一个选项。

| | Python 手写(Day 429) | Spring AI 2.0.1 |
| --- | --- | --- |
| 声明工具 | 手写 JSON Schema | `@Tool` + `@ToolParam`,反射生成 |
| 执行工具 | `LOCAL_TOOLS[name](**args)` | `ToolCallingManager` 找、`MethodToolCallback` 调 |
| 工具出错 | `except ValueError` 转成文字 | 运行时异常消息自动回模型,受检异常直接失败 |
| 循环上限 | `range(5)` 按轮数 | `max-total-tool-calls` 按工具调用次数,默认 150 |
| 超限之后 | 循环结束,没有回答 | 默认返回一句英文提示作为最终回复 |

## 动手练习

### 练习 1:改成流式输出

前端最在意的是首字延迟。`HelloApp` 用的是 `.call()`,等整段回答生成完才返回。请新写一个 `StreamApp`,用 `.stream().content()` 让回答一段一段打印出来,并记录第一段到达的时间、一共收到几段。问题换成「用三句话说说发票抬头怎么改。」

<details><summary>参考答案</summary>

```java
// agent-zero-lab/part07/java_go/spring-ai/src/main/java/dev/agentzero/hello/StreamApp.java
package dev.agentzero.hello;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class StreamApp {

    public static void main(String[] args) {
        SpringApplication.run(StreamApp.class, args);
    }

    @Bean
    CommandLineRunner streamHello(ChatClient.Builder builder) {
        return args -> {
            long start = System.currentTimeMillis();
            int[] pieces = {0};
            builder.build().prompt()
                    .system("你是云簿 CloudLedger 的客服助手。")
                    .user("用三句话说说发票抬头怎么改。")
                    .stream()
                    .content()
                    .doOnNext(piece -> {
                        if (pieces[0] == 0) {
                            System.out.printf("[首段 %.2fs] ", (System.currentTimeMillis() - start) / 1000.0);
                        }
                        pieces[0]++;
                        System.out.print(piece);
                    })
                    .blockLast();
            System.out.printf("%n共收到 %d 段,用时 %.2fs%n", pieces[0], (System.currentTimeMillis() - start) / 1000.0);
        };
    }
}
```

<div class="line-notes">

- `int[] pieces = {0};` 一个只有一个元素的数组当计数器。Java 的 lambda 里不能修改外面的普通局部变量(要求它「实际上是 final」),但可以改数组里的元素。这是 Java 里常见的小技巧,JS 没有这个限制。
- `.stream()` 换成流式请求,底层就是 [Day 379](/blog/agent-zero/day-379-sse-server/) 讲的 SSE。
- `.content()` 只要文字片段,得到一个 `Flux<String>`。Flux 来自 Reactor 库,可以理解成「会陆续吐出很多个值的 Promise」,很像 JS 的 async iterator 或者 RxJS 的 Observable。
- `.doOnNext(piece -> {` 每来一段执行一次,相当于 `for await (const piece of stream) { ... }` 的循环体。
- `if (pieces[0] == 0) {` 第一段到达时打印用时,就是首字延迟。实跑 `2.87s`。
- `.blockLast();` 一直等到最后一段到达。命令行程序必须等,不然 main 结束了流还没跑完。在 Web 服务里不要 block,直接把 Flux 交给框架推给前端。

</div>

```bash
mvn -q spring-boot:run -Dspring-boot.run.main-class=dev.agentzero.hello.StreamApp
```

```text
[首段 2.87s] 1. 打开云簿，进入「发票管理」找到对应发票，点击「编辑」修改抬头信息后保存。  
2. 若发票已开具，需先作废或红冲原发票，再重新开具正确抬头的发票。  
3. 抬头涉及企业税号的，请确保与营业执照一致，修改后建议核对无误再提交。
共收到 77 段,用时 3.42s
```

首字 2.87 秒,全部 3.42 秒,中间 77 段陆续到达。顺带再看一眼内容:「发票管理」「编辑」按钮都是模型编的,我们没给它任何产品文档。流式只改变了「什么时候看到」,不改变「说的是不是真的」。

</details>

### 练习 2:加一个统计未付金额的工具

给 `LedgerTools` 加第三个工具 `count_unpaid(customerId)`,返回这个客户所有未付发票的张数和合计金额(用一条 `COUNT` / `SUM` 的 SQL)。然后问「半岛咖啡一共欠我们多少钱?」,看模型会不会选它而不是 `list_invoices`。

<details><summary>参考答案</summary>

在 `LedgerTools.java` 最后一个方法后面、类的右大括号前面加:

```java
    public record UnpaidSummary(String customerId, int count, double total) {}

    @Tool(name = "count_unpaid", description = "统计客户所有未付(open)发票的张数和合计金额,金额单位元。")
    public UnpaidSummary countUnpaid(@ToolParam(description = "客户编号,如 C007") String customerId) {
        System.out.println("[工具] count_unpaid(customerId=" + customerId + ")");
        String sql = "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total "
                + "FROM invoices WHERE customer_id = ? AND status = 'open'";
        try (Connection conn = DriverManager.getConnection(jdbcUrl);
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, customerId);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return new UnpaidSummary(customerId, rs.getInt("n"), rs.getDouble("total"));
            }
        } catch (SQLException e) {
            throw new IllegalStateException("统计失败:" + e.getMessage(), e);
        }
    }
```

<div class="line-notes">

- `public record UnpaidSummary(String customerId, int count, double total) {}` 返回一个小对象,模型收到的 JSON 是 `{"customerId":"C007","count":1,"total":2392.0}`。
- `description = "统计客户所有未付(open)发票的张数和合计金额,金额单位元。")` 描述里写清「所有」,和 `list_invoices` 的「最近 3 张」区分开。不写清的话,模型可能拿最近 3 张去加,客户发票一多就算错。
- `"SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total "` `COALESCE(x, 0)`:没有未付发票时 `SUM` 得到 NULL,用它换成 0([Day 88](/blog/agent-zero/day-088-sql-4/) 的聚合函数)。
- `rs.next();` 聚合查询一定返回一行,所以直接挪到第一行,不用 while。
- `return new UnpaidSummary(customerId, rs.getInt("n"), rs.getDouble("total"));` C007 实测 `count=1, total=2392.0`。

</div>

`defaultTools(tools)` 不用改,新方法贴了 `@Tool` 会被自动扫到。

```bash
mvn -q spring-boot:run -Dspring-boot.run.main-class=dev.agentzero.ledger.LedgerApp \
  -Dspring-boot.run.arguments="半岛咖啡一共欠我们多少钱?"
```

```text
[工具] find_customer(query=半岛咖啡)

[工具] count_unpaid(customerId=C007)
半岛咖啡（客户编号 C007，联系人刘静）目前共有 **1 张未付发票，合计欠款 2,392 元**。

需要我列出这张发票的明细吗？
整个循环合计:输入 1947 / 输出 126 token,总用时 5.7s
```

模型选了 `count_unpaid`。输入 token 从 1768 涨到 1947,多出来的约 180 个就是第三个工具的定义,每轮请求都要带上它。工具越多,每次请求越贵,这是 [Day 184](/blog/agent-zero/day-184-tool-search-1/) 讲工具检索的起点。

</details>

### 练习 3:超限时让模型知道,而不是直接返回

第八步里,超过工具调用上限后,框架直接返回一句英文给你。文档里 `spring.ai.tools.limits.on-limit-exceeded` 还有一个取值 `RETURN_ERROR_RESPONSE`。把上限设成 1,换成这个取值,观察和默认行为有什么不同。

<details><summary>参考答案</summary>

不改文件,两个配置都用 JVM 参数覆盖:

```bash
mvn -q spring-boot:run -Dspring-boot.run.main-class=dev.agentzero.ledger.LedgerApp \
  -Dspring-boot.run.jvmArguments="-Dspring.ai.tools.limits.max-total-tool-calls=1 -Dspring.ai.tools.limits.on-limit-exceeded=RETURN_ERROR_RESPONSE"
```

<div class="line-notes">

- `-Dspring.ai.tools.limits.max-total-tool-calls=1` JVM 系统属性的优先级比 `application.properties` 高,所以这次跑上限是 1,文件里的 6 不生效。同一行后半段的 `on-limit-exceeded=RETURN_ERROR_RESPONSE` 是说:超限时不再终止,而是跳过这次调用,伪造一个「已达上限」的错误工具结果交给模型,对话继续。

</div>

```text
[工具] find_customer(query=user007@example.com)

已确认客户身份：刘静（半岛咖啡，客户编号 C007）。但我在查询发票时触发了本轮工具调用次数上限，暂时没能取到发票数据，所以还不能回答"是否都付清"。

麻烦您再回复一句（比如"继续查"），我就立刻调取 C007 最近三张发票的付款状态给您。
整个循环合计:输入 1686 / 输出 162 token,总用时 6.8s
```

现象:`list_invoices` 没有被执行(终端里没有那行 `[工具] list_invoices`),但模型收到了「超限」的工具结果,用中文跟用户解释了情况,而且没有编造发票状态。默认的 `THROW` 适合「超限就是 bug,要报警」的场景;`RETURN_ERROR_RESPONSE` 适合「宁可少答一点,也要给用户一句人话」的场景,多花一轮模型调用(这次输入 1686 token,比 `THROW` 那次多了 600 多)。

</details>

**验收标准**:`HelloApp` 和 `LedgerApp` 都跑通;默认问题的回答里出现 INV-2026-0071 和 2392 元;能在终端里指出模型调了哪两个工具、各传了什么参数;能不看文章说出 Spring AI 里工具出错和循环上限分别是怎么处理的。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| JDK | Java Development Kit,Java 编译器加运行时,相当于 Node 本身;只有运行时的叫 JRE,不能编译 |
| Maven | Java 的构建和依赖管理工具,相当于 npm,配置文件是 `pom.xml` |
| pom.xml | Maven 项目的配置文件,声明依赖、版本和插件,相当于 package.json |
| BOM | Bill of Materials,只声明一组依赖版本的 pom,`import` 进来后各依赖不用再写版本 |
| JAVA_HOME | 告诉 Maven 等工具用哪个 JDK 的环境变量 |
| record | Java 16 起的只读数据类,一行声明字段,自动带构造函数和打印格式 |
| 注解 | `@Tool` 这种贴在类、方法、参数上的标签,本身不执行,由框架在运行时读取 |
| 反射 | 程序运行时读取自己的类、方法、参数信息的能力,框架靠它从 `@Tool` 方法生成 schema |
| Spring Boot | Java 最流行的服务端框架,靠自动配置和依赖注入少写样板代码 |
| 自动配置 | Spring 根据依赖和配置自动创建对象,比如看到 OpenAI starter 就建好模型客户端 |
| 依赖注入 | 方法或构造函数声明要什么对象,由 Spring 容器负责传进来,类似 React Context |
| bean | 被 Spring 容器创建和管理的对象 |
| Spring AI | Spring 官方的 AI 集成框架,2.0 配套 Spring Boot 4 |
| ChatClient | Spring AI 调聊天模型的统一入口,`prompt().system().user().call()` |
| @Tool / @ToolParam | Spring AI 声明工具和参数描述的注解 |
| ToolCallingAdvisor | Spring AI 里替你跑工具循环的组件,`.call()` 内部用它 |
| JDBC | Java 访问数据库的标准接口,相当于 Python 的 DB-API |
| 受检异常 | Java 编译器强制你处理的异常(如 `SQLException`),TS 和 Python 没有这个概念 |
| try-with-resources | `try (资源) { }`,块结束自动关闭资源,相当于 Python 的 `with` |
| Flux | Reactor 库里「陆续吐出多个值」的类型,Spring AI 流式输出用它,类似 async iterator |

## 常见误区

**以为系统里有 java 就能编译。** 我这台 Mac 上 `java -version` 是 1.8 的 JRE,Maven 报 `No compiler is provided in this environment. Perhaps you are running on a JRE rather than a JDK?`。装 JDK 25,用 `JAVA_HOME` 指过去,`mvn -version` 里看到 25 再往下走。

**用 `source .env` 导出变量。** `.env` 不是 shell 脚本,我们第 5 行的 JSON 让 zsh 报 `parse error near '{'`。要么像 `env.sh` 那样只取需要的几行,要么给值加单引号,但后者会让 python-dotenv 读到的值也带上引号处理规则,改动面更大。

**比较字符串用 `==`。** Java 的 `==` 比较是不是同一个对象,内容一样也可能得到 false。工具里判断 `status` 一律用 `"open".equals(status)`,把字面量写在前面还能顺便防 `null`。

**把 Spring 配置当成命令行参数传。** 我们的程序把 `args` 全部拼成用户问题,所以 `-Dspring-boot.run.arguments="--logging.level..."` 会被模型当成问题读。改日志级别用 `-Dspring-boot.run.jvmArguments="-D..."`。

**看到 DEBUG 里的异常堆栈就以为程序崩了。** 工具抛运行时异常时,Spring AI 会把消息回给模型、对话继续,DEBUG 日志只是顺手把堆栈打印出来。真正崩溃的标志是最后没有模型回答、进程以错误退出。

**在 Spring AI 里找 max_steps。** 它没有按轮数的上限,只有按工具调用次数的 `spring.ai.tools.limits.*`,总数默认 150。不调小的话,一个出了问题的 Agent 可以连调一百多次工具才停,每次都要付 token 钱。

**超限后把框架的英文提示推给用户。** 默认超限时 `.call()` 正常返回,内容是 `Total tool call limit (1) exceeded...`。上线前要检查 finish reason,或者改用 `RETURN_ERROR_RESPONSE` 让模型自己解释。

## 学习资料

### 文档与文章

- [Spring AI 参考文档 · ChatClient API](https://docs.spring.io/spring-ai/reference/api/chatclient.html):`prompt()`、`call()`、`stream()`、`defaultSystem` 这些今天用到的方法都在这页。先读前三节,20 分钟。
- [Spring AI 参考文档 · Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html):`@Tool`、`@ToolParam`、异常处理、`tools.limits` 的默认值和两种超限行为,今天第六到第八步基本照着它写。重点读「Tool call limits」和「Error handling」两节,30 分钟。
- [Spring AI 参考文档 · OpenAI Chat](https://docs.spring.io/spring-ai/reference/api/chat/openai-chat.html):`spring.ai.openai.*` 全部配置项,查属性名时用。
- [Spring AI 参考文档 · DeepSeek Chat](https://docs.spring.io/spring-ai/reference/api/chat/deepseek-chat.html):官方给的 DeepSeek 接法,和我们「OpenAI starter 改 base-url」的做法对照着看。
- [Maven in 5 Minutes](https://maven.apache.org/guides/getting-started/maven-in-five-minutes.html):Maven 官方的五分钟入门,读懂目录约定和 `mvn compile`、`mvn package` 就够了。英文,15 分钟。
- [dev.java · Learn](https://dev.java/learn/):Oracle 官方的 Java 学习站,想系统补 Java 语法从「Getting Started」和「Records」两篇开始。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Bp4D6CEYx&autoplay=0&high_quality=1" title="【拒绝冗长】完整版 Spring AI 2.0 超浓缩实战：8集从零到MCP，Java工程师的AI第一课" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>乐哥聊编程 · 完整版 Spring AI 2.0 超浓缩实战:8 集从零到 MCP · 2026 年 8 月上传,讲的就是 2.0。今天先看 ChatClient 和工具调用那几集,和第五到第七步的代码对照,MCP 那集留到想接 Day 280 的 CloudLedger server 时再看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pk4y127UH&autoplay=0&high_quality=1" title="Java 从零码起 类与对象 Class &amp; Object" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农小g · Java 从零码起:类与对象 · 16 分钟。第二步只讲了够用的语法,如果 class、new、构造函数这些还是模糊,看这一集补上。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/nHnKReitDXc" title="Bootiful Spring AI by Josh Long / James Ward @ Spring I/O 2026" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Spring I/O · Bootiful Spring AI(Josh Long、James Ward,Spring I/O 2026)· Spring 布道师现场写代码,从 ChatClient 讲到工具、MCP、记忆,节奏很快。跑通今天的代码后再看,能看懂七八成就说明今天学到位了。</figcaption>
</figure>

### 书籍

- Craig Walls《Spring AI in Action》(Manning, 2025):作者写过《Spring 实战》系列。书从第一个 ChatClient 讲到 RAG、工具、MCP 和可观测。写作时 Spring AI 还是 1.x,包名和配置属性有变化,当概念书读,API 以 2.0 文档为准。先读工具调用那一章。
- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 6 章:讲 Agent 的工具、规划和失败模式,和语言无关。今天的「循环上限」「工具出错怎么回给模型」在这一章有更系统的讨论。

### 开源项目与代码

- [spring-projects/spring-ai](https://github.com/spring-projects/spring-ai):想看工具循环怎么实现的,在仓库里搜 `ToolCallingAdvisor` 和 `DefaultToolCallingManager`,对照 Day 166 的 25 行循环读,半小时。

## 自测

1. 为什么 `LedgerTools` 要把 `SQLException` 包成 `IllegalStateException` 再抛?如果直接在方法签名上写 `throws SQLException` 往外抛,数据库出错时会发生什么?

<details><summary>答案</summary>

Spring AI 默认的 `DefaultToolExecutionExceptionProcessor` 只把运行时异常的消息作为工具结果回给模型,受检异常和 `Error` 会直接重新抛出,整个 `.call()` 失败,模型什么也看不到。`SQLException` 是受检异常,包成 `IllegalStateException`(运行时异常)后,数据库出错时模型能读到「查客户失败:...」并告诉用户稍后再试。直接 `throws SQLException` 的话,数据库一出错用户就得到一个异常,没有任何回答。哪种对要看场景:数据库挂了可能更希望直接报警而不是让模型去解释,这时就别包。

</details>

2. 同一个默认问题,Python 版输入 1530 token,Spring AI 版输入 1768 token。多出来的从哪来?怎么验证你的猜测?

<details><summary>答案</summary>

主要来自工具定义。Spring AI 生成的 schema 带 `$schema`、`additionalProperties: false`,每个参数还有 description,比 Python 版手写的 `fn(...)` 更长;而每一轮请求都要带上全部工具定义,两轮下来差距翻倍。验证方法:用 `SchemaDump` 打印出 schema,和 `self_loop.py` 里的 `TOOLS` 逐字段对比;或者把 Python 版的 schema 改成和 Spring AI 一样长再跑一次,看输入 token 是否接近。

</details>

3. `.call()` 一行就跑完了整个工具循环。请按顺序说出这一行里发生了哪几件事,每件对应 Day 429 `self_loop.py` 里的哪段代码。

<details><summary>答案</summary>

① 带着 system、user 消息和两个工具定义请求模型,对应 `client.chat.completions.create(..., tools=TOOLS)`;② 模型返回 tool_calls,`ToolCallingManager` 按名字找到工具,对应 `LOCAL_TOOLS[name]`;③ `MethodToolCallback` 把 JSON 参数转成 Java 参数、反射调用方法,对应 `json.loads(arguments)` 和 `run_local`;④ 返回值转成 JSON,作为 tool 消息塞回历史,对应 `messages.append({"role": "tool", ...})`;⑤ 再请求模型,直到它不再要工具,对应 `for _ in range(5)` 和 `if not msg.tool_calls: break`。超过工具调用次数上限时提前结束,对应 range 用完。

</details>

4. `spring.ai.tools.limits.max-total-tool-calls=6` 和 Python 版的 `range(5)`,哪个限制更紧?举一个两者行为不同的例子。

<details><summary>答案</summary>

计数单位不同,没法简单比。`range(5)` 限的是模型调用的轮数,一轮里模型可以并行要好几个工具;`max-total-tool-calls` 限的是工具执行的总次数。例子:模型第一轮一次要了 4 个 `find_customer`(比如用户问了四个客户),Python 版这只算 1 轮,还剩 4 轮;Spring AI 版已经用掉 4 次,只剩 2 次。反过来,如果每轮只调一个工具,Spring AI 能跑 6 轮工具再加一轮回答,比 Python 版多。

</details>

5. **面试题**:你们的订单系统是 Spring Boot,产品想在订单详情页加一个「帮我看看这笔账」的 AI 按钮。用 Spring AI 直接在现有服务里做,你会注意哪几件事?

<details><summary>答案</summary>

答题要点:工具直接调现有的 Service 层方法,复用事务、权限和审计,不要让工具绕开权限直接查库;客户身份从登录态取,不作为工具参数让模型填(Day 411 讲的过度授权);只读工具可以放 `defaultTools`,有副作用的(改单、退款)按次用 `.tools()` 传,并且只生成待审批记录;把 `spring.ai.tools.limits.max-total-tool-calls` 从默认 150 调到个位数,检查超限时的 finish reason,别把框架的英文提示推给用户;工具异常分清楚哪些回给模型(业务上查不到)、哪些直接失败报警(数据库故障);流式用 `.stream()` 返回 Flux 给前端;最后要补评测,Java 这边没有 Python 那么现成的评测工具,可以把评测集和打分脚本放在 Python 里,通过 HTTP 调这个接口跑。还可以提一句我们实测的延迟:同一任务 Spring AI 版比 Python 版慢好几倍,上线前要压测。

</details>

## 明天预告

明天是 Day 431 · 用 Java 和 Go 写 Agent(二):LangChain4j、Eino、ADK Go,什么时候拆服务。今天的 Spring AI 是「Spring 容器 + 链式调用」,明天先看另一种 Java 写法:LangChain4j 的 AiServices,写一个接口,框架替你生成 Agent;顺带实测不开 `-parameters` 时工具参数会变成什么。然后换到 Go,用字节的 Eino 写第三个版本,看「工具出错」这一行为什么在 Go 里完全不同。最后回答面试里最常被问的那个问题:Java 公司上 Agent,是全用 Java,还是拆一个 Python 服务出来。
