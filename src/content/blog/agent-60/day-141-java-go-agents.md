---
title: 'Day 141 · 用 Java 和 Go 写 Agent:Spring AI、LangChain4j、Eino、ADK Go'
description: '国内 JD 里 Java 和 Go 各占两成多,很多公司的业务系统根本不是 Python。今天把 Day 27 那个「查重复扣款」的任务用 Spring AI 2.0、LangChain4j 1.22 和字节的 Eino 各写一遍,对照 Python 版看同一套概念在 JVM 和 Go 里叫什么,再讲清楚什么时候该全用 Java/Go,什么时候让 Python Agent 服务和 Java 业务系统各干各的。'
pubDate: 2026-10-22
regime: none
tags: ['java', 'golang', 'spring-ai', 'langchain4j', 'eino', 'frameworks', 'agent-60']
series: 'agent-60'
day: 141
lang: 'zh'
---

## 今天要解决的问题

这是专题篇的一课,**建议在 [Day 27 · 框架横评](/blog/agent-60/day-27-frameworks-compared/) 之后读**。专题篇不按顺序学,哪篇和你的求职方向有关就先读哪篇。今天要用到的前置只有三样:Day 9 手写的 Agent 循环(知道一轮里模型、工具、消息怎么来回),Day 23 的 CloudLedger 业务库 `cloudledger.db`,以及 Day 27 那个查重复扣款的任务。

为什么专门讲 Java 和 Go?看我们 10 月抓的 JD 数据(`docs/jd-research`)。国内 334 条带正文的样本里,Java 出现在 23% 的岗位里,Go 也是 23%;大厂官网那一批 Go 更高,到了 34%。海外这两个数字只有 10% 和 14%。国内的 Agent 岗有相当一部分是「在现有 Java/Go 业务系统里加 Agent 能力」,面试官问的不是「你会不会 LangGraph」,而是「我们订单系统是 Spring Boot,你打算怎么接」。课程前面全是 Python,这一课补上这一块。

学完你要能做到:

1. 说清 Spring AI、LangChain4j、Eino、Google ADK 各自是谁做的、现在什么版本、适合什么团队。
2. 用 Spring AI 2.0 写一个带两个工具的 Agent,讲清 `@Tool`、`ChatClient`、工具异常怎么回给模型。
3. 用 LangChain4j 的 `AiServices` 和 Go 的 Eino `ChatModelAgent` 各写一遍同一个任务,能指出三个框架里「循环上限」「工具出错」分别在哪配置。
4. 面对「Java 公司要上 Agent」这类场景,能在三种接法里选一种并说出理由。

预计用时 4–6 小时,其中一半时间可能花在装 JDK、Maven、Go 上。本机没有这些环境也能读懂全文,代码我是按 2026 年 10 月查到的版本逐行对着官方文档和源码写的,但**没有在我这台机器上编译运行**(我这里只有 JDK 8),文中凡是运行输出都写成「大致长这样」。

## 先看全景:JVM 和 Go 上有哪些选择

先把名字和版本对齐。下面的版本号都是 2026 年 10 月 22 日我直接从 Maven Central 和 Go 模块代理(proxy.golang.org)查的,不是从博客抄的:

| 框架 | 谁做的 | 语言 | 当前版本 | 一句话 |
| --- | --- | --- | --- | --- |
| Spring AI | Spring 官方(Broadcom) | Java | 2.0.1(2.0.0 在 2026-06-12 发布到 Maven Central) | Spring Boot 团队的首选,自动配置、注解、可观测都是 Spring 那一套 |
| LangChain4j | 社区(和 Python 的 LangChain 没有隶属关系) | Java | 1.22.0(2026-10-07) | 不绑定 Spring,纯 Java 也能用,`AiServices` 用接口声明 Agent |
| Eino | 字节跳动 CloudWeGo | Go | v0.9.22(2026-10-19) | 国内 Go 团队用得最多,有 ADK 风格的 `ChatModelAgent`,还在 0.x |
| Google ADK | Google | Python/Java/Go/TS | Go 版 v2.6.0(模块路径 `google.golang.org/adk/v2`,v2.0.0 标签是 2026-06-30);Java 版 1.13.0 | 以 Gemini 为中心,Workflow Runtime 是 2.0 的主要变化 |

几点背景。Spring AI 2.0 和 Spring Boot 4 是一起走的,我查了 `spring-ai-starter-model-openai` 2.0.1 的 pom,里面直接依赖 `spring-boot-starter-restclient` 4.1.1,所以你得用 Boot 4.1 和 JDK 17 以上(我建议 21)。Spring AI 文档还写明,从 2.0.0-M5 开始,OpenAI 那一套底层换成了 OpenAI 官方的 `openai-java` SDK,配置属性没变。LangChain4j 名字容易误会,它是独立的社区项目,API 风格也和 Python LangChain 很不一样。Eino 目前还是 0.x 版本,小版本之间改 API 是常事,锁版本比 Java 那边更重要。

国内 Java 圈还有 Spring AI Alibaba,是阿里在 Spring AI 之上做的扩展(接通义、百炼,带 Graph 编排)。我这次没有逐个核对它的版本和维护状态,如果你所在的公司在用,先去 GitHub 看它最近几个月的提交和 issue 再决定。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="Java 或 Go 公司接入 Agent 的三种方式:Python Agent 服务通过 HTTP 被调用、在 Java 里内嵌 Spring AI 或 LangChain4j、Go 服务内嵌 Eino">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <text x="20" y="26" fill="var(--ink)">A 拆服务</text>
    <rect x="20" y="38" width="180" height="56" rx="4" fill="none" stroke="var(--compute)"/>
    <text x="32" y="60" fill="var(--ink)">Java 订单系统</text>
    <text x="32" y="80" font-size="11" fill="var(--ink-soft)">只管业务和权限</text>
    <rect x="250" y="38" width="180" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="262" y="60" fill="var(--ink)">Python Agent 服务</text>
    <text x="262" y="80" font-size="11" fill="var(--ink-soft)">LangGraph + 评测</text>
    <line x1="200" y1="58" x2="250" y2="58" stroke="var(--ink-soft)"/>
    <text x="204" y="52" font-size="10" fill="var(--ink-faint)">HTTP</text>
    <line x1="250" y1="76" x2="200" y2="76" stroke="var(--ink-soft)" stroke-dasharray="3 3"/>
    <text x="204" y="90" font-size="10" fill="var(--ink-faint)">MCP</text>

    <text x="20" y="130" fill="var(--ink)">B 内嵌 Java</text>
    <rect x="20" y="142" width="410" height="44" rx="4" fill="none" stroke="var(--compute)"/>
    <text x="32" y="168" fill="var(--ink)">Spring Boot 应用</text>
    <rect x="200" y="150" width="220" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="212" y="169" font-size="11" fill="var(--ink)">Spring AI / LangChain4j</text>

    <text x="20" y="214" fill="var(--ink)">C 内嵌 Go</text>
    <rect x="20" y="222" width="410" height="30" rx="4" fill="none" stroke="var(--compute)"/>
    <text x="32" y="242" fill="var(--ink)">Go 微服务</text>
    <rect x="200" y="226" width="220" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="212" y="241" font-size="11" fill="var(--ink)">Eino / ADK Go</text>

    <text x="460" y="60" font-size="11" fill="var(--ink-soft)">评测、实验快</text>
    <text x="460" y="78" font-size="11" fill="var(--ink-soft)">多一个服务要运维</text>
    <text x="460" y="164" font-size="11" fill="var(--ink-soft)">事务、权限、监控</text>
    <text x="460" y="180" font-size="11" fill="var(--ink-soft)">直接复用</text>
    <text x="460" y="242" font-size="11" fill="var(--ink-soft)">框架还在 0.x</text>
  </g>
</svg>
<figcaption>蓝色是模型那一侧(Agent 逻辑),琥珀色是业务系统。三种接法的差别在于 Agent 逻辑放在哪个进程里、用什么语言写。</figcaption>
</figure>

## 今天的任务和数据

任务和 Day 27 一字不差:「user007@example.com 这个客户 10 月有没有被重复扣款?列出相关发票号和金额。」两个工具也一样:`find_customer` 按邮箱、姓名、公司或编号找客户,`list_invoices` 列出某个客户最近的发票。数据库就是 Day 23 造的 `w4/cloudledger/cloudledger.db`,这里是只读的,不会改数据。

为了后面对照输出,先用 sqlite3 看一眼真实数据(这是我对着自己的库实际跑出来的):

```bash
cd agent-60-lab/w4/cloudledger
sqlite3 -readonly cloudledger.db "SELECT id, amount_cents, status, issued_at, paid_at FROM invoices WHERE customer_id='C007' ORDER BY issued_at DESC, id DESC LIMIT 6;"
```

<div class="line-notes">

- `sqlite3 -readonly cloudledger.db` `-readonly` 表示以只读方式打开,手滑写了 UPDATE 也不会改坏 Day 23 的库。实测返回 5 行:`INV-2026-0123|239200|paid|2026-10-08|2026-10-08`、`INV-2026-0026|239200|paid|2026-10-08|2026-10-08`,然后是 9 月 7 日、8 月 8 日、7 月 9 日各一张 239200 分的发票。10 月 8 日同一天两张同额发票,就是我们要 Agent 找出来的那次重复扣款。

</div>

C007 是半岛咖啡的刘静,企业版 8 个席位,每月 ¥2,392.00。Python 版 Day 27 的实测结论是:INV-2026-0026 和 INV-2026-0123 都是 10 月 8 日的 ¥2,392.00,多扣了一笔。下面三个版本,你跑完之后对照这个结论判断对不对。

新代码统一放在 `agent-60-lab/topics/java-go-agents/` 下面,每个框架一个子目录。三个程序都从环境变量读 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`(和全课一样,默认 DeepSeek),再加一个 `CLOUDLEDGER_DB` 指向数据库。Python 有 `load_dotenv`,Java 和 Go 这边我们不引第三方库读 `.env`,直接在 shell 里导出:

```bash
cd agent-60-lab
set -a; source .env; set +a
export CLOUDLEDGER_DB="$PWD/w4/cloudledger/cloudledger.db"
mkdir -p topics/java-go-agents && cd topics/java-go-agents
```

<div class="line-notes">

- `set -a; source .env; set +a` `set -a` 打开「之后定义的变量都自动 export」,`source .env` 把文件里的 `LLM_BASE_URL=https://api.deepseek.com` 这些行当 shell 赋值执行一遍,`set +a` 再关掉。这样子进程(java、go)才看得到这些变量。只 `source` 不 `set -a`,变量只在当前 shell 里,`mvn` 启动的 JVM 读不到。
- `export CLOUDLEDGER_DB="$PWD/w4/cloudledger/cloudledger.db"` 用绝对路径。后面三个程序都是在各自子目录里启动的,写相对路径很容易数错 `../`。

</div>

还有一个三种语言都会踩的坑,先说在前面:**SQLite 驱动遇到不存在的路径不会报错,会悄悄新建一个空库**。然后你的工具报「no such table: customers」,模型拿到这个错误还会一本正经地编理由。所以下面每个版本启动时都先检查文件存在。

## Spring AI 2.0:注解和自动配置

先装环境。JDK 用 21(macOS 可以 `brew install openjdk@21`,或者用 SDKMAN),Maven 用 3.9 以上。`java -version` 显示 21 再往下走,Spring Boot 4 不认 JDK 8 和 11。

目录结构:

```
topics/java-go-agents/spring-ai/
├── pom.xml
└── src/main/
    ├── java/dev/agent60/ledger/
    │   ├── LedgerApp.java
    │   └── CloudLedgerTools.java
    └── resources/application.properties
```

```xml
<!-- agent-60-lab/topics/java-go-agents/spring-ai/pom.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.1.1</version>
  </parent>
  <groupId>dev.agent60</groupId>
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

- `<artifactId>spring-boot-starter-parent</artifactId>` 继承 Spring Boot 的父 pom,它管好了几百个依赖的版本,还把编译器的 `-parameters` 参数打开了。后面 `@Tool` 方法的参数名(`query`、`customerId`)能原样出现在工具 schema 里,靠的就是这个参数;不开的话 JVM 只知道 `arg0`、`arg1`。
- `<version>4.1.1</version>` 2026-08-20 发布到 Maven Central 的稳定版。Spring AI 2.0.1 的 starter 依赖的就是 Boot 4.1.1,两个版本配套,别混用 Boot 3.x。
- `<spring-ai.version>2.0.1</spring-ai.version>` Maven Central 上 `spring-ai-bom` 的最新稳定版。还有 2.1.0-M1,M 是里程碑版,别在课程里用。
- `<artifactId>spring-ai-bom</artifactId>` BOM(物料清单)只管版本不引代码。`<scope>import</scope>` 的意思是把它里面声明的版本合并进来,所以下面引 Spring AI 的 starter 不用再写版本号。
- `<artifactId>spring-ai-starter-model-openai</artifactId>` OpenAI 协议的聊天模型 starter。它会自动注册 `OpenAiChatModel` 和一个 `ChatClient.Builder` bean。DeepSeek、通义这些兼容厂商也走它,改 base-url 就行。
- `<artifactId>sqlite-jdbc</artifactId>` SQLite 的 JDBC 驱动,3.53.4.0 是 2026-08-26 的版本。前三段跟随 SQLite 本身的版本号。

</div>

配置文件:

```properties
# agent-60-lab/topics/java-go-agents/spring-ai/src/main/resources/application.properties
spring.main.web-application-type=none
spring.ai.openai.base-url=${LLM_BASE_URL}
spring.ai.openai.api-key=${LLM_API_KEY}
spring.ai.openai.chat.model=${LLM_MODEL}
spring.ai.openai.chat.temperature=0
spring.ai.tools.limits.max-total-tool-calls=10
cloudledger.db=${CLOUDLEDGER_DB}
logging.level.org.springframework.ai=DEBUG
```

<div class="line-notes">

- `spring.main.web-application-type=none` 我们写的是命令行程序,不需要 Tomcat。starter 里带了 HTTP 客户端但没带 web 服务器,其实默认也不会起端口,写明白更稳。
- `spring.ai.openai.base-url=${LLM_BASE_URL}` `${...}` 是 Spring 的占位符,会从环境变量里取值。上一步 `set -a; source .env` 导出的 `https://api.deepseek.com` 就到了这里。Spring AI 文档里演示 DeepSeek 用的也是这个写法,不用加 `/v1`。
- `spring.ai.openai.chat.model=${LLM_MODEL}` 默认值是 `gpt-5-mini`,不设的话会拿 DeepSeek 的 key 去请求一个 DeepSeek 不认识的模型名,报 400。
- `spring.ai.openai.chat.temperature=0` 和 Day 27 一样设 0,方便几个版本对比。注意文档说 GPT-5 系列不支持 temperature,设了会报错;换成 OpenAI 的 GPT-5 时要删掉这一行。
- `spring.ai.tools.limits.max-total-tool-calls=10` Spring AI 的工具循环没有「最多几轮」这种设置,文档里给的是工具调用次数上限:单个工具默认 40 次、总共默认 150 次,超了默认抛异常。150 对一个查账任务太宽了,我们收到 10,相当于 Day 12 讲的 `max_steps` 兜底。
- `cloudledger.db=${CLOUDLEDGER_DB}` 自定义属性,下面 `CloudLedgerTools` 的构造函数用 `@Value` 读它。
- `logging.level.org.springframework.ai=DEBUG` 打开 Spring AI 的调试日志,能看到每次调了哪个工具。文档说所有主要操作都在 DEBUG 级别记日志;日志很多,确认跑通后可以改回 INFO。

</div>

工具类。和 Python 版的 `find_customer`、`list_invoices` 逐行对应,连报错文案都照抄,方便你对比:

```java
// agent-60-lab/topics/java-go-agents/spring-ai/src/main/java/dev/agent60/ledger/CloudLedgerTools.java
package dev.agent60.ledger;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class CloudLedgerTools {

    public record Customer(String id, String name, String email, String company) {}

    public record Invoice(String id, long amountCents, String amountYuan, String status,
                          String issuedAt, String paidAt) {}

    private static final Set<String> STATUSES = Set.of("paid", "open", "void", "refunded");

    private final String jdbcUrl;

    public CloudLedgerTools(@Value("${cloudledger.db}") String dbPath) {
        if (!Files.exists(Path.of(dbPath))) {
            throw new IllegalStateException("找不到数据库文件:" + dbPath + ",先跑 Day 23 的 seed.py");
        }
        this.jdbcUrl = "jdbc:sqlite:" + dbPath;
    }

    @Tool(name = "find_customer",
          description = "按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。")
    public List<Customer> findCustomer(
            @ToolParam(description = "客户邮箱、姓名、公司名或客户编号(如 C007),支持部分匹配") String query) {
        String q = query.strip();
        String like = "%" + q + "%";
        String sql = "SELECT id, name, email, company FROM customers "
                + "WHERE id = ? OR email LIKE ? OR name LIKE ? OR company LIKE ? LIMIT 5";
        List<Customer> out = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(jdbcUrl);
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, q.toUpperCase());
            ps.setString(2, like);
            ps.setString(3, like);
            ps.setString(4, like);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new Customer(rs.getString("id"), rs.getString("name"),
                            rs.getString("email"), rs.getString("company")));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("查询客户失败:" + e.getMessage(), e);
        }
        if (out.isEmpty()) {
            throw new IllegalArgumentException("没有找到匹配「" + query + "」的客户。可以换成邮箱或客户编号再试。");
        }
        return out;
    }

    @Tool(name = "list_invoices",
          description = "列出客户最近的发票(按开票日期倒序),金额单位为元。可按状态过滤。")
    public List<Invoice> listInvoices(
            @ToolParam(description = "客户编号,如 C007") String customerId,
            @ToolParam(description = "发票状态:paid / open / void / refunded,不填就不过滤", required = false) String status,
            @ToolParam(description = "返回条数,1 到 20,默认 6", required = false) Integer limit) {
        if (customerId == null || !customerId.matches("C\\d{3}")) {
            throw new IllegalArgumentException("customer_id 应该是 C 加三位数字,如 C007。先用 find_customer 查到编号再来。");
        }
        if (status != null && !STATUSES.contains(status)) {
            throw new IllegalArgumentException("status 只能是 paid、open、void、refunded 之一。");
        }
        int n = (limit == null) ? 6 : Math.max(1, Math.min(20, limit));
        String sql = "SELECT id, amount_cents, status, issued_at, paid_at FROM invoices WHERE customer_id = ?"
                + (status != null ? " AND status = ?" : "")
                + " ORDER BY issued_at DESC, id DESC LIMIT ?";
        List<Invoice> out = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(jdbcUrl);
             PreparedStatement ps = conn.prepareStatement(sql)) {
            int i = 1;
            ps.setString(i++, customerId);
            if (status != null) {
                ps.setString(i++, status);
            }
            ps.setInt(i, n);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    long cents = rs.getLong("amount_cents");
                    out.add(new Invoice(rs.getString("id"), cents, String.format("%.2f", cents / 100.0),
                            rs.getString("status"), rs.getString("issued_at"), rs.getString("paid_at")));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException("查询发票失败:" + e.getMessage(), e);
        }
        return out;
    }
}
```

<div class="line-notes">

- `@Component` 让 Spring 扫描到这个类并创建一个单例。下面 `LedgerApp` 里直接把它当参数注入,不用自己 `new`。
- `public record Customer(` Java 16 起的 record,相当于 Python 的 `@dataclass(frozen=True)` 或 TS 里只读的 interface 加构造函数。Spring AI 会用 Jackson 把返回值序列化成 JSON 交给模型,record 的字段名就是 JSON 的键:`{"id":"C007","name":"刘静","email":"user007@example.com","company":"半岛咖啡"}`。
- `String amountYuan, String status,` 金额同时给分和元两个字段,和 Python 版 `amount_yuan` 一样:分用来精确比较,元给模型照抄进回答。`String.format("%.2f", 239200 / 100.0)` 得到 `"2392.00"`。
- `if (!Files.exists(Path.of(dbPath))) {` 前面说的坑:路径错了 sqlite-jdbc 不报错,会建一个空文件。启动时就检查,比让模型去解释 `no such table` 强得多。
- `@Tool(name = "find_customer",` `name` 不写默认是方法名 `findCustomer`。我们显式写成蛇形命名,和 Python 版、MCP 版的工具名一致,评测和 trace 对比时才对得上。
- `description = "按邮箱/姓名/公司/编号查找客户` 和 Day 23 的 docstring 一字不差,包括最后那半句「查订阅和发票前先用它拿到 customer_id」。Day 23 讲过,这半句是写给模型看的调用顺序提示。
- `@ToolParam(description = "客户邮箱、姓名、公司名` 给参数写说明,对应 Python 的 `Field(description=...)`。Spring AI 默认所有参数必填。
- `ps.setString(1, q.toUpperCase());` 和 Python 版一样,编号用大写精确匹配,所以模型传 `c007` 也能命中。四个 `?` 都用参数绑定,不拼字符串,模型传什么都不会变成 SQL 注入。
- `throw new IllegalArgumentException("没有找到匹配` Spring AI 文档写得很清楚:工具里抛出的 `RuntimeException`,默认处理器会把 `getMessage()` 当成工具结果回给模型;只有受检异常和 `Error` 才会直接抛给调用方。`IllegalArgumentException` 是 RuntimeException,所以模型会读到这句中文,接着换个查法。这相当于 Python MCP 里的 `raise ToolError`。
- `required = false) String status,` 可选参数。注意用 `Integer` 而不是 `int` 接 `limit`:模型没传时值是 `null`,基本类型 `int` 没法表示「没传」。
- `if (customerId == null || !customerId.matches("C\\d{3}")) {` Python 版靠 pydantic 的 `pattern` 在执行前拦截,Spring AI 的 `@ToolParam` 没有正则约束,只能在方法里自己校验。`matches` 要求整个字符串匹配,相当于自带 `^...$`。
- `int n = (limit == null) ? 6 : Math.max(1, Math.min(20, limit));` 对应 Python 版的 `ge=1, le=20` 和默认值 6。区别是 Python 版超范围会报错让模型重试,这里直接夹到 1–20 之间,两种做法都行,夹紧更省一轮调用。
- `ps.setInt(i, n);` `i` 在前面用 `i++` 往后挪,有 status 时 limit 是第 3 个参数,没有时是第 2 个。代入 Day 27 的实测参数 `customerId=C007, limit=20`:SQL 里只有两个 `?`,返回的就是前面 sqlite3 查到的那 5 行。

</div>

主程序:

```java
// agent-60-lab/topics/java-go-agents/spring-ai/src/main/java/dev/agent60/ledger/LedgerApp.java
package dev.agent60.ledger;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class LedgerApp {

    static final String TASK = "user007@example.com 这个客户 10 月有没有被重复扣款?列出相关发票号和金额。";

    public static void main(String[] args) {
        SpringApplication.run(LedgerApp.class, args);
    }

    @Bean
    CommandLineRunner run(ChatClient.Builder builder, CloudLedgerTools tools) {
        return args -> {
            ChatClient client = builder
                    .defaultSystem("你是云簿的账务专员。先用工具查事实,不要编造发票号和金额。")
                    .defaultTools(tools)
                    .build();
            String question = args.length > 0 ? String.join(" ", args) : TASK;
            String answer = client.prompt()
                    .user(question)
                    .call()
                    .content();
            System.out.println(answer);
        };
    }
}
```

<div class="line-notes">

- `@SpringBootApplication` 三个注解的合体:标记配置类、开启自动配置、扫描当前包。自动配置看到 classpath 上有 OpenAI starter,就按 `application.properties` 建好模型和 `ChatClient.Builder`。
- `CommandLineRunner run(ChatClient.Builder builder, CloudLedgerTools tools) {` 容器启动完会调用所有 `CommandLineRunner`。参数由 Spring 注入:`builder` 来自 starter 的自动配置,`tools` 是上面那个 `@Component`。
- `.defaultSystem("你是云簿的账务专员。` system prompt,和 Day 27 三个框架版本用的是同一句。
- `.defaultTools(tools)` 把整个对象交进去,Spring AI 会反射找出所有带 `@Tool` 的方法,生成两个工具定义。文档提醒过,有副作用的危险工具最好按次用 `.tools(...)` 传,不要放进 defaults,这里两个都是只读的,放 defaults 没问题。
- `String question = args.length > 0` 命令行参数可以换问题,`mvn spring-boot:run -Dspring-boot.run.arguments="C007 9 月付了几次"` 这种。不传就用默认任务。
- `.call()` 同步调用。工具循环在这一步里自动跑完:模型要调工具,框架执行、把结果塞回消息、再请求模型,直到模型不再调工具。Day 9 你手写的那 20 行 while 循环,在 Spring AI 里藏在 `ToolCallingAdvisor` 里。
- `.content();` 只取最后的文本。想要 token 用量,改成 `.chatResponse()` 拿完整响应,再读 `getMetadata().getUsage()`。

</div>

运行:

```bash
cd spring-ai
mvn -q spring-boot:run
```

输出大致长这样(DEBUG 日志里会夹着两次工具调用的记录,下面只摘最后的回答;措辞每次会有出入,发票号和金额应该一致):

```text
查到了。客户 C007(刘静,半岛咖啡)10 月有两张发票:
- INV-2026-0026  ¥2,392.00  2026-10-08 已支付
- INV-2026-0123  ¥2,392.00  2026-10-08 已支付
同一天同金额,而 7、8、9 月每月只有一张 ¥2,392.00,10 月很可能重复扣了一次,多扣 ¥2,392.00。
```

如果你看到的是「找不到客户」或者金额对不上,先看 DEBUG 日志里模型传的参数,大多是 `LLM_MODEL` 没导出、或者模型一开始就拿邮箱去调了 `list_invoices`(这时它会收到我们那句「先用 find_customer 查到编号再来」,下一轮自己改过来)。

### 想直接复用 Day 23 的 MCP server

上面我们用 Java 重写了两个工具。现实里更常见的是工具已经有了,比如 Day 23 那个 Python 写的 MCP server。Spring AI 有 MCP 客户端 starter,`spring-ai-starter-mcp-client`,按文档在配置里声明一个 stdio 连接:

```properties
# 追加到 application.properties,并在 pom 里加 spring-ai-starter-mcp-client 依赖
spring.ai.mcp.client.stdio.connections.cloudledger.command=uv
spring.ai.mcp.client.stdio.connections.cloudledger.args=run,--directory,/绝对路径/agent-60-lab,python,w4/cloudledger/server.py
```

<div class="line-notes">

- `spring.ai.mcp.client.stdio.connections.cloudledger.command=uv` `connections` 下面的 `cloudledger` 是你给这个连接起的名字。命令和 Day 23 里给 Claude Code 配的完全一样。
- `args=run,--directory,/绝对路径/agent-60-lab,python,w4/cloudledger/server.py` properties 文件里列表用逗号分隔,等价于文档里 YAML 的多行 `- run`。`/绝对路径/` 换成你自己的路径。

</div>

文档说,工具回调默认是开启的,所有 MCP 工具会以一个 `SyncMcpToolCallbackProvider` 的形式出现在容器里。把它注入到 `run` 方法,然后 `builder.defaultToolCallbacks(provider.getToolCallbacks())` 就能把 Python 写的工具交给 Java 里的模型用。这就是开头那张图里 A 和 B 之间的虚线:**MCP 让工具和 Agent 可以用不同的语言写**。

## LangChain4j:用接口声明一个 Agent

LangChain4j 不依赖 Spring(也有 Spring Boot 集成,今天不用),一个 `main` 方法就能跑。它最有特色的是 `AiServices`:你写一个 Java 接口,框架给你生成实现,方法调用就变成了一次 Agent 运行。

```xml
<!-- agent-60-lab/topics/java-go-agents/langchain4j/pom.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>dev.agent60</groupId>
  <artifactId>ledger-langchain4j</artifactId>
  <version>0.1.0</version>
  <properties>
    <maven.compiler.release>21</maven.compiler.release>
    <maven.compiler.parameters>true</maven.compiler.parameters>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <langchain4j.version>1.22.0</langchain4j.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>dev.langchain4j</groupId>
      <artifactId>langchain4j</artifactId>
      <version>${langchain4j.version}</version>
    </dependency>
    <dependency>
      <groupId>dev.langchain4j</groupId>
      <artifactId>langchain4j-open-ai</artifactId>
      <version>${langchain4j.version}</version>
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
        <groupId>org.codehaus.mojo</groupId>
        <artifactId>exec-maven-plugin</artifactId>
        <version>3.6.4</version>
        <configuration>
          <mainClass>dev.agent60.ledger.Main</mainClass>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
```

<div class="line-notes">

- `<maven.compiler.parameters>true</maven.compiler.parameters>` 这里没有 Spring Boot 父 pom 帮你开 `-parameters`,得自己写。不开的话工具参数在 schema 里叫 `arg0`、`arg1`,模型只能靠 `@P` 的描述猜每个参数是什么。
- `<langchain4j.version>1.22.0</langchain4j.version>` Maven Central 上 2026-10-07 的最新版。`langchain4j` 是核心(AiServices、工具、记忆),`langchain4j-open-ai` 是 OpenAI 协议的模型实现,两个版本号保持一致。
- `<artifactId>exec-maven-plugin</artifactId>` 用来 `mvn exec:java` 直接跑 main,省得自己打 jar。3.6.4 是当前最新版。
- `<mainClass>dev.agent60.ledger.Main</mainClass>` 下面那个类的全名。

</div>

```java
// agent-60-lab/topics/java-go-agents/langchain4j/src/main/java/dev/agent60/ledger/Main.java
package dev.agent60.ledger;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.SystemMessage;

public class Main {

    interface Accountant {
        @SystemMessage("你是云簿的账务专员。先用工具查事实,不要编造发票号和金额。")
        String ask(String question);
    }

    static class LedgerTools {
        private final String jdbcUrl;

        LedgerTools(String dbPath) {
            if (!Files.exists(Path.of(dbPath))) {
                throw new IllegalStateException("找不到数据库文件:" + dbPath);
            }
            this.jdbcUrl = "jdbc:sqlite:" + dbPath;
        }

        @Tool(name = "find_customer",
              value = "按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。")
        public List<Map<String, Object>> findCustomer(
                @P("客户邮箱、姓名、公司名或客户编号(如 C007),支持部分匹配") String query) {
            String q = query.strip();
            String like = "%" + q + "%";
            List<Map<String, Object>> rows = query(
                    "SELECT id, name, email, company FROM customers "
                            + "WHERE id = ? OR email LIKE ? OR name LIKE ? OR company LIKE ? LIMIT 5",
                    q.toUpperCase(), like, like, like);
            if (rows.isEmpty()) {
                throw new IllegalArgumentException("没有找到匹配「" + query + "」的客户。可以换成邮箱或客户编号再试。");
            }
            return rows;
        }

        @Tool(name = "list_invoices", value = "列出客户最近的发票(按开票日期倒序),金额单位为元。")
        public List<Map<String, Object>> listInvoices(
                @P("客户编号,如 C007") String customerId,
                @P(value = "返回条数,1 到 20,默认 6", required = false) Integer limit) {
            if (customerId == null || !customerId.matches("C\\d{3}")) {
                throw new IllegalArgumentException("customer_id 应该是 C 加三位数字,如 C007。先用 find_customer 查到编号再来。");
            }
            int n = (limit == null) ? 6 : Math.max(1, Math.min(20, limit));
            List<Map<String, Object>> rows = query(
                    "SELECT id, amount_cents, status, issued_at, paid_at FROM invoices "
                            + "WHERE customer_id = ? ORDER BY issued_at DESC, id DESC LIMIT ?",
                    customerId, n);
            for (Map<String, Object> r : rows) {
                long cents = ((Number) r.get("amount_cents")).longValue();
                r.put("amount_yuan", String.format("%.2f", cents / 100.0));
            }
            return rows;
        }

        private List<Map<String, Object>> query(String sql, Object... args) {
            List<Map<String, Object>> out = new ArrayList<>();
            try (Connection conn = DriverManager.getConnection(jdbcUrl);
                 PreparedStatement ps = conn.prepareStatement(sql)) {
                for (int i = 0; i < args.length; i++) {
                    ps.setObject(i + 1, args[i]);
                }
                try (ResultSet rs = ps.executeQuery()) {
                    int cols = rs.getMetaData().getColumnCount();
                    while (rs.next()) {
                        Map<String, Object> row = new LinkedHashMap<>();
                        for (int c = 1; c <= cols; c++) {
                            row.put(rs.getMetaData().getColumnLabel(c), rs.getObject(c));
                        }
                        out.add(row);
                    }
                }
            } catch (SQLException e) {
                throw new IllegalStateException("查询失败:" + e.getMessage(), e);
            }
            return out;
        }
    }

    public static void main(String[] args) {
        OpenAiChatModel model = OpenAiChatModel.builder()
                .baseUrl(System.getenv("LLM_BASE_URL"))
                .apiKey(System.getenv("LLM_API_KEY"))
                .modelName(System.getenv("LLM_MODEL"))
                .temperature(0.0)
                .logRequests(true)
                .build();

        Accountant accountant = AiServices.builder(Accountant.class)
                .chatModel(model)
                .tools(new LedgerTools(System.getenv("CLOUDLEDGER_DB")))
                .maxSequentialToolsInvocations(8)
                .build();

        String task = args.length > 0 ? String.join(" ", args)
                : "user007@example.com 这个客户 10 月有没有被重复扣款?列出相关发票号和金额。";
        System.out.println(accountant.ask(task));
    }
}
```

<div class="line-notes">

- `interface Accountant {` 整个 Agent 的「外观」就是这个接口。你没写任何实现,`AiServices.builder(Accountant.class)...build()` 会用动态代理生成一个,调用 `ask()` 就跑一次完整的工具循环。写过 Retrofit 或 Spring Data 的人对这种写法会很熟。
- `@SystemMessage("你是云簿的账务专员。` system prompt 写在注解上。也可以用 `{{变量}}` 模板,今天用不到。
- `@Tool(name = "find_customer",` LangChain4j 的 `@Tool` 用 `value` 写描述(Spring AI 用 `description`,别抄混),`name` 指定工具名。
- `@P("客户邮箱、姓名、公司名` `@P` 是 parameter 的缩写,作用和 Spring AI 的 `@ToolParam` 一样。
- `throw new IllegalArgumentException("没有找到匹配` LangChain4j 文档说,默认情况下工具抛异常时,`e.getMessage()` 会作为工具结果发给模型,效果和 Spring AI 一样。文档同时提醒两件事:异常信息可能带出敏感数据(比如 SQL 报错里的表结构);默认行为计划在以后的版本里改。所以生产环境建议显式配置 `toolExecutionErrorHandler`,比如只把实现了 `ToolErrorVisibleToLlm` 的异常给模型看。
- `@P(value = "返回条数,1 到 20,默认 6", required = false) Integer limit)` 这个版本我们把 status 过滤去掉了,只留 limit,让你看看少一个参数时模型会怎么调。可以当练习自己加回来。
- `r.put("amount_yuan", String.format("%.2f", cents / 100.0));` 用 `LinkedHashMap` 是为了保持列的顺序,序列化后 JSON 的键是 `id, amount_cents, status, issued_at, paid_at, amount_yuan`,和 Python 版完全一致。
- `ps.setObject(i + 1, args[i]);` JDBC 参数下标从 1 开始,Java 数组从 0 开始,这个 `+1` 是 JDBC 新手最常写错的地方。
- `.baseUrl(System.getenv("LLM_BASE_URL"))` 和 Spring AI 一样直接填 `https://api.deepseek.com`。`System.getenv` 拿不到时返回 `null`,`build()` 会报错,报错时先检查有没有执行 `set -a; source .env`。
- `.logRequests(true)` 把请求体打到日志里,能看到工具 schema 长什么样。LangChain4j 用 SLF4J 记日志,没引任何日志实现时只会打一行 SLF4J 的警告,什么也看不到;想看就加一个 `slf4j-simple` 依赖。
- `.maxSequentialToolsInvocations(8)` 连续工具调用的上限,对应 Day 12 的 `max_steps`。我查了 1.22.0 的 `AiServices.java` 源码,这个方法在 builder 上。超过上限会抛异常,不会无限循环下去。
- `System.out.println(accountant.ask(task));` 一行调用就是一次 Agent 运行。和 Spring AI 一样,中间的工具调用都被框架藏起来了。

</div>

```bash
cd ../langchain4j
mvn -q compile exec:java
```

输出和 Spring AI 版应该是同一个结论。两个 Java 框架放在一起看,差异主要在风格:Spring AI 是「一个 Spring Bean + 流式 API」,配置都在 properties 里,天然接 Micrometer、Actuator;LangChain4j 是「接口 + 注解」,不绑框架,在老的非 Spring 项目、Quarkus、甚至安卓里都能用。如果公司是标准的 Spring Boot 技术栈,我会选 Spring AI,运维和监控那一套白捡;如果不是,LangChain4j 更轻。

LangChain4j 1.x 还新增了 agentic 模块(`langchain4j-agentic`),可以编排多个 Agent、做顺序/并行/循环工作流,概念上接近 LangGraph。下面「其他经典视频」里有微软 Java 团队讲这个模块的视频。

## Go 版:Eino 的 ChatModelAgent

Go 生态没有 Java 那么多选择,国内团队基本是 Eino。Eino 有两层 API:老一点的 `flow/agent/react`(ReAct Agent),和 2026 年推的 `adk` 包(Agent Development Kit,和 Google ADK 同名但没关系)。官方示例现在都用 `adk.NewChatModelAgent` 加 `adk.NewRunner`,我们也用这套。下面的代码对照的是 eino v0.9.22 源码里的 `adk/chatmodel.go`、`adk/runner.go`,以及官方 eino-examples 仓库 `adk/intro/chatmodel` 那个例子。

装 Go 1.24 以上(`brew install go`),然后:

```bash
cd ../ && mkdir eino && cd eino
go mod init example.com/ledger-eino
go get github.com/cloudwego/eino@v0.9.22
go get github.com/cloudwego/eino-ext/components/model/openai@v0.1.13
go get modernc.org/sqlite@v1.61.0
```

<div class="line-notes">

- `go get github.com/cloudwego/eino@v0.9.22` Eino 核心,2026-10-19 打的标签。0.x 版本小版本之间也会改 API,一定写死版本。
- `go get github.com/cloudwego/eino-ext/components/model/openai@v0.1.13` 模型实现放在单独的 `eino-ext` 仓库里,每个组件是独立的 Go 模块,版本号和核心不同步。v0.1.13 是 2026-04-16 的,官方示例的 go.mod 用的也是这个版本。
- `go get modernc.org/sqlite@v1.61.0` 纯 Go 写的 SQLite 驱动,不用 cgo,交叉编译省心。驱动名是 `"sqlite"`(另一个常见驱动 mattn/go-sqlite3 叫 `"sqlite3"`,需要 cgo)。

</div>

```go
// agent-60-lab/topics/java-go-agents/eino/main.go
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	_ "modernc.org/sqlite"
)

const task = "user007@example.com 这个客户 10 月有没有被重复扣款?列出相关发票号和金额。"

type FindCustomerInput struct {
	Query string `json:"query" jsonschema_description:"客户邮箱、姓名、公司名或客户编号(如 C007),支持部分匹配"`
}

type Customer struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Email   string `json:"email"`
	Company string `json:"company"`
}

type FindCustomerOutput struct {
	Customers []Customer `json:"customers"`
	Error     string     `json:"error,omitempty"`
}

type ListInvoicesInput struct {
	CustomerID string `json:"customer_id" jsonschema_description:"客户编号,如 C007"`
	Limit      int    `json:"limit,omitempty" jsonschema_description:"返回条数,1 到 20,默认 6"`
}

type Invoice struct {
	ID          string  `json:"id"`
	AmountCents int64   `json:"amount_cents"`
	AmountYuan  string  `json:"amount_yuan"`
	Status      string  `json:"status"`
	IssuedAt    string  `json:"issued_at"`
	PaidAt      *string `json:"paid_at"`
}

type ListInvoicesOutput struct {
	Invoices []Invoice `json:"invoices"`
	Error    string    `json:"error,omitempty"`
}

var customerIDPattern = regexp.MustCompile(`^C\d{3}$`)

func newTools(db *sql.DB) ([]tool.BaseTool, error) {
	findCustomer, err := utils.InferTool("find_customer",
		"按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。",
		func(ctx context.Context, in *FindCustomerInput) (*FindCustomerOutput, error) {
			q := strings.TrimSpace(in.Query)
			like := "%" + q + "%"
			rows, err := db.QueryContext(ctx,
				"SELECT id, name, email, company FROM customers WHERE id = ? OR email LIKE ? OR name LIKE ? OR company LIKE ? LIMIT 5",
				strings.ToUpper(q), like, like, like)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			out := &FindCustomerOutput{}
			for rows.Next() {
				var c Customer
				if err := rows.Scan(&c.ID, &c.Name, &c.Email, &c.Company); err != nil {
					return nil, err
				}
				out.Customers = append(out.Customers, c)
			}
			if len(out.Customers) == 0 {
				out.Error = fmt.Sprintf("没有找到匹配「%s」的客户。可以换成邮箱或客户编号再试。", in.Query)
			}
			return out, rows.Err()
		})
	if err != nil {
		return nil, err
	}

	listInvoices, err := utils.InferTool("list_invoices",
		"列出客户最近的发票(按开票日期倒序),金额单位为元。",
		func(ctx context.Context, in *ListInvoicesInput) (*ListInvoicesOutput, error) {
			if !customerIDPattern.MatchString(in.CustomerID) {
				return &ListInvoicesOutput{Error: "customer_id 应该是 C 加三位数字,如 C007。先用 find_customer 查到编号再来。"}, nil
			}
			n := in.Limit
			if n == 0 {
				n = 6
			}
			n = max(1, min(20, n))
			rows, err := db.QueryContext(ctx,
				"SELECT id, amount_cents, status, issued_at, paid_at FROM invoices WHERE customer_id = ? ORDER BY issued_at DESC, id DESC LIMIT ?",
				in.CustomerID, n)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			out := &ListInvoicesOutput{}
			for rows.Next() {
				var inv Invoice
				if err := rows.Scan(&inv.ID, &inv.AmountCents, &inv.Status, &inv.IssuedAt, &inv.PaidAt); err != nil {
					return nil, err
				}
				inv.AmountYuan = fmt.Sprintf("%.2f", float64(inv.AmountCents)/100)
				out.Invoices = append(out.Invoices, inv)
			}
			return out, rows.Err()
		})
	if err != nil {
		return nil, err
	}
	return []tool.BaseTool{findCustomer, listInvoices}, nil
}

func main() {
	ctx := context.Background()

	dbPath := os.Getenv("CLOUDLEDGER_DB")
	if _, err := os.Stat(dbPath); err != nil {
		log.Fatalf("找不到数据库文件 %q: %v", dbPath, err)
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	temperature := float32(0)
	cm, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
		BaseURL:     os.Getenv("LLM_BASE_URL"),
		APIKey:      os.Getenv("LLM_API_KEY"),
		Model:       os.Getenv("LLM_MODEL"),
		Temperature: &temperature,
	})
	if err != nil {
		log.Fatal(err)
	}

	tools, err := newTools(db)
	if err != nil {
		log.Fatal(err)
	}

	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:        "Accountant",
		Description: "云簿账务专员,查客户和发票",
		Instruction: "你是云簿的账务专员。先用工具查事实,不要编造发票号和金额。",
		Model:       cm,
		ToolsConfig: adk.ToolsConfig{
			ToolsNodeConfig: compose.ToolsNodeConfig{Tools: tools},
		},
		MaxIterations: 8,
	})
	if err != nil {
		log.Fatal(err)
	}

	runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent})
	question := task
	if len(os.Args) > 1 {
		question = strings.Join(os.Args[1:], " ")
	}
	iter := runner.Query(ctx, question)
	for {
		event, ok := iter.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			log.Fatal(event.Err)
		}
		if event.Output == nil || event.Output.MessageOutput == nil {
			continue
		}
		msg := event.Output.MessageOutput.Message
		if msg == nil {
			continue
		}
		for _, tc := range msg.ToolCalls {
			fmt.Printf("[调用工具] %s %s\n", tc.Function.Name, tc.Function.Arguments)
		}
		if msg.Role == schema.Tool {
			fmt.Printf("[工具结果] %.120s\n", msg.Content)
		} else if msg.Content != "" {
			fmt.Printf("\n%s\n", msg.Content)
		}
	}
}
```

<div class="line-notes">

- `_ "modernc.org/sqlite"` 下划线导入:只执行包的 `init()` 把驱动注册进 `database/sql`,代码里不直接用这个包。Go 新手常问为什么不写会报 `sql: unknown driver "sqlite"`,就是少了这一行。
- `jsonschema_description:"客户邮箱` Eino 的 `InferTool` 从结构体推导工具 schema:`json` 标签给参数名,`jsonschema_description` 给说明。这是 Go 版的 `Field(description=...)`。
- `json:"error,omitempty"` 我们把业务错误放进返回值的 `error` 字段,而不是返回 Go 的 `error`。原因是 Eino 和两个 Java 框架不一样:我读 v0.9.22 的 `compose/tool_node.go`,`ToolsNodeConfig` 里没有「把工具错误转成文本交给模型」的开关,工具函数返回的 `error` 会让这次运行出错。查不到客户是正常业务情况,应该让模型看到并换个查法,所以走返回值。数据库连不上这种真故障,才返回 `error` 让整个运行停下。
- `json:"limit,omitempty"` 带 `omitempty` 的字段在生成的 schema 里是可选的,不带的(比如 `customer_id`)是必填。Go 的 `int` 零值是 0,所以下面用 `n == 0` 判断「没传」。
- `json:"paid_at"` `paid_at` 在库里可能是 NULL(未付款的发票)。用 `*string` 接,NULL 扫描出来是 `nil`,序列化成 JSON 的 `null`;用 `string` 接,遇到 NULL 时 `Scan` 会直接报错。
- `func newTools(db *sql.DB) ([]tool.BaseTool, error) {` 工具函数是闭包,捕获 `db`。和 Java 版每次调用都 `getConnection` 不同,Go 的 `*sql.DB` 本身就是连接池,建一个全程复用。
- `findCustomer, err := utils.InferTool("find_customer",` 签名是 `InferTool[T, D any](名字, 描述, func(ctx, *T) (*D, error))`。泛型参数 T 是输入结构体,D 是输出结构体,Eino 负责把模型给的 JSON 参数反序列化成 T、把 D 序列化成 JSON 字符串交回模型。
- `strings.ToUpper(q), like, like, like)` 四个参数对应四个 `?`,和前两个 Java 版本一样。代入 `in.Query = "user007@example.com"`:编号精确匹配不中,email 的 LIKE 命中 C007。
- `n = max(1, min(20, n))` Go 1.21 起内置了 `min` 和 `max`,所以 go.mod 的 Go 版本要在 1.21 以上。`go mod init` 会写当前安装的版本,装的是 1.24 就没问题。
- `inv.AmountYuan = fmt.Sprintf("%.2f", float64(inv.AmountCents)/100)` 239200 → `"2392.00"`,和其他版本一致。
- `if _, err := os.Stat(dbPath); err != nil {` 又是那个空库的坑。`sql.Open` 只校验参数不连库,路径错了要等第一次查询才出事,而且出的是 `no such table`,所以先 `Stat`。
- `temperature := float32(0)` 配置里 `Temperature` 是 `*float32` 指针。用指针是为了区分「没设」(nil,用服务端默认)和「设成 0」。不能直接写 `&0`,Go 不允许取字面量的地址,得先放进变量。
- `cm, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{` 字段名 `BaseURL`、`APIKey`、`Model` 来自 eino-ext v0.1.13 的源码,官方示例也是这么写的。
- `MaxIterations: 8,` 模型生成的最大轮数,源码注释写着默认 20,超过会以错误结束。这是三个框架里唯一真正按「轮」限制的,Spring AI 按工具调用次数,LangChain4j 按连续工具调用次数。面试问「怎么防 Agent 死循环」时,能说出各框架的旋钮叫什么、按什么计数,比只说「设 max_steps」强。
- `runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent})` Runner 负责驱动 Agent 跑起来,还管 checkpoint(中断恢复)、流式等。不设 `EnableStreaming` 就是非流式,每个事件里的 `Message` 是完整消息。
- `iter := runner.Query(ctx, question)` `Query` 是 `Run` 的简便版,传一个字符串当用户消息。返回一个迭代器,每个事件对应 Agent 产出的一条消息:模型的工具调用、工具结果、最终回答。
- `if event.Err != nil {` 前面说的工具返回 `error`、超过 `MaxIterations`、模型接口报错,都从这里冒出来。
- `msg := event.Output.MessageOutput.Message` 非流式模式下消息在 `Message` 字段;开了流式要读 `MessageStream`,官方示例的 `prints.Event` 两种都处理了,可以去看。
- `fmt.Printf("[工具结果] %.120s\n", msg.Content)` `%.120s` 只打印前 120 个字节,免得发票列表刷屏。注意是字节不是字符,中文可能被截在半个字上,调试输出无所谓。

</div>

```bash
go run .
```

输出大致长这样(工具调用的参数和次数每次可能不同,模型有时会先传 `limit` 有时不传):

```text
[调用工具] find_customer {"query":"user007@example.com"}
[工具结果] {"customers":[{"id":"C007","name":"刘静","email":"user007@example.com","company":"半岛咖啡"}]}
[调用工具] list_invoices {"customer_id":"C007","limit":10}
[工具结果] {"invoices":[{"id":"INV-2026-0123","amount_cents":239200,"amount_yuan":"2392.00","status":"paid","issued_at":"2026-10-08","p

客户 C007(刘静,半岛咖啡)10 月 8 日有两张 ¥2,392.00 的已付发票:INV-2026-0026 和 INV-2026-0123……
```

工具结果那两行的内容来自真实数据库,格式由我们的结构体决定,这部分你跑出来应该和上面一字不差;最后一段回答是模型写的,措辞会变。

## Google ADK:Go 和 Java 也有

Google 的 ADK 2026 年出了 2.0,这一版最大的变化是加了 Workflow Runtime,把 Agent 运行变成一个图执行引擎,和 LangGraph 的思路越来越接近。Go 版的模块路径是 `google.golang.org/adk/v2`,v2.0.0 的标签是 2026-06-30,我查的时候最新是 v2.6.0(10-13);Java 版在 Maven Central 上是 `com.google.adk:google-adk` 1.13.0,版本号和 Python 版(2.12.0)不同步。

ADK 的默认模型是 Gemini,文档和示例也都围绕 Gemini 和 Vertex AI。如果你们公司在 Google Cloud 上、用 Gemini,ADK Go 是个很顺手的选择;如果主力模型是 DeepSeek、通义这些,接其他模型要看当前 model 包的支持情况,这一块我没有实测,今天不给代码。选型时把它当成「Go 和 Java 也有官方级框架」的一个信号就行。

## 什么时候全用 Java/Go,什么时候拆服务

回到开头那张图。三种接法我都在真实团队里见过,各有道理:

**A. Python Agent 服务 + Java 业务系统。** Agent 逻辑用 Python 写,作为独立服务;Java 系统通过 HTTP 调它,或者把业务能力包成 MCP server 让 Agent 调。好处是 Python 这边的评测、实验工具链最全(Day 29–35 那一整套),换模型、改 prompt、跑回归都快;Agent 组和业务组边界清楚。代价是多一个服务要部署、要监控,跨服务的 trace 要打通(Day 85 讲的 OTel 就是干这个的)。

**B. 在 Spring Boot 里内嵌 Spring AI 或 LangChain4j。** 适合 Agent 只是业务系统里的一个功能,比如订单详情页加一个「帮我看看这笔账」。工具直接调本地 Service,事务、权限、审计日志全部复用,不用为了 Agent 再搭一套。代价是评测和实验没 Python 方便,得自己补;团队里懂 Agent 的人要懂 Java。

**C. Go 服务内嵌 Eino。** 和 B 一样的逻辑,只是换成 Go。Eino 还在 0.x,升级要预留改代码的时间。

我的判断规则很简单:**Agent 是不是产品核心、需不需要频繁迭代。** 核心、迭代快,选 A,让 Agent 逻辑待在评测工具最好的地方;只是业务里的一个功能、迭代慢,选 B 或 C,少一个服务就少一份运维。还有一个经常被忽略的因素:谁值班。Agent 半夜出问题,如果值班的是 Java 组,那 Agent 代码最好也在他们看得懂的语言里。

面试被问到这个问题,别只说「Python 生态好」。能说出数据库事务、权限复用、值班归属这些具体的东西,面试官才会觉得你在真实团队里做过。

## 动手练习

1. **跑通至少一个版本。** 在 Spring AI、LangChain4j、Eino 三个里挑一个你最可能在工作中用的,按上面步骤跑通默认任务。验收:回答里出现 INV-2026-0026 和 INV-2026-0123,金额是 2392.00。
2. **故意传错,看工具错误怎么回到模型。** 把问题换成「C7 这个客户 10 月的发票」。验收:在日志或事件输出里找到模型第一次调用时收到的那句中文错误(「customer_id 应该是 C 加三位数字」或「没有找到匹配」),以及它下一轮怎么改。把三个框架里这句话分别是怎么传到模型的(异常消息还是返回值字段)写进 `notes/java-go.md`。
3. **把循环上限调到 1。** Spring AI 把 `max-total-tool-calls` 改成 1,LangChain4j 把 `maxSequentialToolsInvocations` 改成 1,Eino 把 `MaxIterations` 改成 1。验收:记录每个框架超限时的表现(抛什么异常、返回什么、有没有部分结果),写成一张三行的表。
4. **给 LangChain4j 版加回 status 过滤。** 参照 Spring AI 版,给 `listInvoices` 加一个可选的 `status` 参数并校验取值。验收:问「C007 有没有未付的发票」时,日志里能看到模型传了 `status=open`。
5. **(选做)Spring AI 接 Day 23 的 MCP server。** 按「想直接复用 Day 23 的 MCP server」一节加依赖和配置,删掉 `.defaultTools(tools)`,改用 `defaultToolCallbacks`。验收:不写任何 Java 工具代码,任务照样能答对;日志里能看到工具名是 Python server 里的那几个。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Spring AI | Spring 官方的 AI 集成框架,2.0 版配套 Spring Boot 4,用 `ChatClient` 和 `@Tool` 写 Agent |
| ChatClient | Spring AI 的流式调用接口,`prompt().user().call().content()`,工具循环在 `call()` 里自动跑完 |
| BOM | Bill of Materials,Maven 里只声明一组依赖版本的 pom,用 `import` 引入后各依赖不用再写版本 |
| `-parameters` | javac 编译参数,把方法参数名保留在字节码里,框架才能把参数名放进工具 schema |
| LangChain4j | 独立的 Java LLM 框架,和 Python LangChain 无隶属关系,核心是 `AiServices` |
| AiServices | LangChain4j 用动态代理把一个 Java 接口变成 Agent 的机制 |
| Eino | 字节跳动 CloudWeGo 的 Go 语言 LLM 应用框架,`adk` 包提供 `ChatModelAgent` 和 `Runner` |
| InferTool | Eino 从 Go 结构体推导工具 schema 的辅助函数 |
| eino-ext | Eino 的扩展仓库,模型、工具等组件各自是独立 Go 模块 |
| Google ADK | Google 的 Agent Development Kit,有 Python/Java/Go/TS 版本,2.0 加了 Workflow Runtime |
| record | Java 16 起的不可变数据类,适合当工具的返回值类型 |
| 下划线导入 | Go 的 `import _ "pkg"`,只为执行包的 `init()`,常用于注册数据库驱动 |

## 常见误区

**以为 LangChain4j 是 LangChain 的 Java 官方版。** 它是独立的社区项目,API 设计、版本节奏、文档都和 Python LangChain 不一样。在简历上写「熟悉 LangChain(Java)」会让面试官困惑,写 LangChain4j。

**以为三个框架遇到工具报错的行为一样。** Spring AI 和 LangChain4j 默认把运行时异常的消息回给模型;Eino 的工具返回 `error` 会让整次运行出错。从 Python 迁过来的人最容易在 Go 里栽这个跟头:查不到客户就返回 error,结果整个 Agent 挂掉,用户看到一个 500。

**忘了开 `-parameters`。** Spring Boot 父 pom 帮你开了,自己写的纯 Maven 项目不会。不开时程序照样能跑,只是工具参数叫 `arg0`,模型调用的准确率会悄悄变差,很难查。

**SQLite 路径写错不报错。** 三种语言的驱动都会建一个空库。症状是工具报 `no such table`,而模型会把这个错误包装成一段像模像样的解释。启动时检查文件存在。

**在 Spring AI 里找 max_steps。** 它没有按轮数的上限,只有按工具调用次数的 `spring.ai.tools.limits.*`,而且总数默认 150。不调小的话,一个出问题的 Agent 可以连调一百多次工具才停。

**Eino 不锁版本。** 0.x 阶段小版本也可能改签名。网上搜到的教程(包括今天这篇)如果版本对不上,先看你 go.mod 里的版本和教程是不是一致。

## 学习资料

### 文档与文章

- [Spring AI 参考文档 · Tool Calling](https://docs.spring.io/spring-ai/reference/api/tools.html):`@Tool`、`@ToolParam`、异常处理、调用次数上限都在这一页,今天的 Spring AI 部分基本是照着它写的。30 分钟。
- [Spring AI 参考文档 · OpenAI Chat](https://docs.spring.io/spring-ai/reference/api/chat/openai-chat.html):配置属性全表,以及「2.0.0-M5 起底层改用官方 openai-java SDK」的说明。查属性名时用。
- [Spring AI · MCP Client Boot Starter](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-client-boot-starter-docs.html):练习 5 用,看 stdio 连接配置和 `SyncMcpToolCallbackProvider`。
- [LangChain4j 文档 · Tools](https://docs.langchain4j.dev/tutorials/tools):`@Tool`、`@P`、`toolExecutionErrorHandler` 的几种取值。重点读错误处理那一节。
- [Eino 文档 · ADK ChatModelAgent](https://www.cloudwego.io/docs/eino/core_modules/eino_adk/agent_implementation/chat_model/):`ChatModelAgentConfig` 各字段的说明,中文。
- [Eino 快速开始](https://www.cloudwego.io/docs/eino/quick_start/):官方的十章教程目录,从 ChatModel 到 DeepAgent,想系统学 Eino 从这里开始。
- [Google ADK 2.0](https://adk.dev/2.0/):2.0 的变化说明,看 Workflow Runtime 那一部分。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Bp4D6CEYx&autoplay=0&high_quality=1" title="【拒绝冗长】完整版 Spring AI 2.0 超浓缩实战：8集从零到MCP，Java工程师的AI第一课" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>乐哥聊编程 · 完整版 Spring AI 2.0 超浓缩实战:8 集从零到 MCP · 2026-08 上传,8 集共 75 分钟,讲的就是 2.0。先看工具调用和 MCP 那几集,和今天的代码对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1auJw6CECD&autoplay=0&high_quality=1" title="【Go语言后端转Agent开发】2026年B站最完整的工程化实战字节大模型Eino框架教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大秦的勤 · Go 语言后端转 Agent 开发:字节 Eino 框架工程化实战 · 2026-06 上传,27 集近 10 小时。不用全看,挑 ChatModel、Tool、Agent 那几集,注意视频里的 Eino 版本可能比 v0.9.22 早。</figcaption>
</figure>

- 黑马程序员《LangChain4j 从入门到实战项目全套视频课程》(B 站 BV1sDMqzpEQ3,23 集):2025 年 6 月的课,播放量很高,讲 AiServices 和工具的部分概念没变,但版本是 1.x 早期,API 细节以文档为准。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/nHnKReitDXc" title="Bootiful Spring AI by Josh Long / James Ward @ Spring I/O 2026" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Spring I/O · Bootiful Spring AI(Josh Long、James Ward,Spring I/O 2026)· Spring 布道师现场写代码,从 ChatClient 讲到工具、MCP、记忆,节奏快,适合看完今天的代码后再看一遍「Spring 官方是怎么想的」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/8SrHjaKWuck" title="Building AI agents with LangChain4j's new &quot;Agentic&quot; module" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Microsoft for Java Developers · Building AI agents with LangChain4j's new "Agentic" module · 讲 LangChain4j 1.x 的多 Agent 编排模块,对应文中提到的 langchain4j-agentic。</figcaption>
</figure>

### 书籍

- Craig Walls《Spring AI in Action》(Manning, 2025):作者是《Spring 实战》系列的作者,书从第一个 ChatClient 讲到 RAG、工具、MCP 和可观测。写作时 Spring AI 还是 1.x,包名和配置属性有变化,当概念书读,API 以 2.0 文档为准。先读工具调用和 MCP 两章。
- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 6 章:讲 Agent 的工具、规划和失败模式,和语言无关。今天讲的「循环上限」「工具出错怎么回给模型」在这一章都有理论上的讨论。

### 开源项目与代码

- [cloudwego/eino-examples](https://github.com/cloudwego/eino-examples):`adk/intro/chatmodel/` 是今天 Go 代码的原型;`adk/human-in-the-loop/` 有工具审批的例子,接 Day 25 的人工审批。半小时浏览目录。
- [cloudwego/eino](https://github.com/cloudwego/eino):读 `adk/chatmodel.go` 里 `TypedChatModelAgentConfig` 的字段注释,比文档更新得快。
- [spring-projects/spring-ai](https://github.com/spring-projects/spring-ai):想知道工具循环怎么实现的,搜 `ToolCallingAdvisor` 和 `DefaultToolCallingManager`,对照 Day 9 的手写循环读。
- [langchain4j/langchain4j](https://github.com/langchain4j/langchain4j):`langchain4j/src/main/java/dev/langchain4j/service/AiServices.java` 是 builder 的全部入口,能看到所有可配的旋钮。
- [google/adk-go](https://github.com/google/adk-go):ADK 的 Go 实现,有兴趣对比 Eino 的设计可以看 examples 目录。

## 自测

1. Spring AI 的 `@Tool` 方法抛出 `IllegalArgumentException`,模型会看到什么?如果抛的是受检异常 `SQLException` 呢?

<details><summary>答案</summary>

`IllegalArgumentException` 是运行时异常,默认的 `DefaultToolExecutionExceptionProcessor` 会把它的 `getMessage()` 作为工具结果回给模型,模型能读到那句中文并调整下一步。受检异常和 `Error` 默认会直接重新抛出,整个 `call()` 失败,模型看不到。所以代码里把 `SQLException` 包成了 `IllegalStateException`,这样数据库出错时模型也能看到一句话。如果你希望数据库故障时直接失败而不是让模型去解释,就别包,或者把 `spring.ai.tools.throw-exception-on-error` 设成 true。

</details>

2. 为什么 Eino 版本把「查不到客户」放进返回结构体的 `error` 字段,而不是返回 Go 的 `error`?

<details><summary>答案</summary>

在 Eino 里工具函数返回的 `error` 会让这次运行出错结束(`ToolsNodeConfig` 没有把错误转成文本交给模型的选项),模型没机会换个查法。查不到客户是正常的业务结果,应该让模型看到并纠正参数,所以放进返回值序列化给模型。数据库连不上、SQL 写错这类真正的故障才返回 `error`,让运行停下来并在 `event.Err` 里暴露出来。

</details>

3. 写一个纯 Maven 的 LangChain4j 项目,没开 `-parameters`,程序能跑吗?会有什么后果?

<details><summary>答案</summary>

能跑,不会报错。但反射拿到的参数名是 `arg0`、`arg1`,生成的工具 schema 里参数名就是这两个,模型只能靠 `@P` 里的描述猜每个参数的含义。简单工具可能还行,参数一多调用准确率会下降,而且这种问题很难从现象定位到原因。解决方法是在 pom 里加 `<maven.compiler.parameters>true</maven.compiler.parameters>`。

</details>

4. 三个框架防止 Agent 无限循环的设置分别叫什么、按什么计数?

<details><summary>答案</summary>

Spring AI:`spring.ai.tools.limits.max-total-tool-calls`(总工具调用次数,默认 150)和 `max-calls-per-tool-default`(单工具,默认 40),按工具调用次数计,超了默认抛异常。LangChain4j:`AiServices.builder().maxSequentialToolsInvocations(n)`,按连续工具调用次数计。Eino:`ChatModelAgentConfig.MaxIterations`,按模型生成轮数计,默认 20,超了以错误结束。一轮里模型可以并行调多个工具,所以「轮数」和「调用次数」不是一回事,同样设 8,Eino 允许的工具调用可能远多于 8 次。

</details>

5. **面试题**:我们的订单系统是 Spring Boot,现在要加一个「客服 Agent」,能查订单、发起退款(需要主管审批)。你会用 Python 单独起一个 Agent 服务,还是直接在 Spring Boot 里用 Spring AI?说说你的判断依据。

<details><summary>答案</summary>

答题要点:先问清楚两个问题,这个 Agent 是不是产品核心、要不要频繁迭代 prompt 和评测;团队里谁维护、谁值班。如果客服 Agent 是核心卖点,需要每周看错误分析、跑回归、换模型,我倾向 Python Agent 服务,订单系统把查订单和发起退款包成 MCP server 或内部 API,退款仍然走订单系统原有的审批流和权限,Agent 只能创建待审批的申请;代价是多一个服务和跨服务追踪,我会用 OTel 把两边的 trace 串起来。如果它只是订单系统里的一个辅助功能、迭代慢、值班是 Java 组,就直接用 Spring AI,工具调本地 Service,事务和审计日志复用,退款工具不放进 defaultTools,按需传并且只生成待审批记录。两种方案里不变的是:审批不交给模型,权限检查在业务层做,评测集要建起来。

</details>

6. Spring AI 2.0.1 能不能配 Spring Boot 3.5 用?怎么确认?

<details><summary>答案</summary>

不建议,基本不行。查 `spring-ai-starter-model-openai` 2.0.1 的 pom,它直接依赖 `spring-boot-starter-restclient` 4.1.1,也就是按 Boot 4.1 构建的,Boot 4 需要 JDK 17 以上。还在 Boot 3.x 上的项目应该用 Spring AI 1.x。确认的方法就是去 Maven Central 打开 starter 的 pom 看它依赖的 Boot 版本,比看博客可靠。

</details>

## 明天预告

专题篇可以跳着读。按编号,下一篇是 **Day 142 · 用 TypeScript 写 Agent:Mastra、Vercel AI SDK 与前后端一体**:海外 JD 里 TypeScript 占了三分之一,我们会用 AI SDK 7 的 `ToolLoopAgent` 和 `useChat` 把查账 Agent 做成一个全 TypeScript 的 Next.js 应用,带工具审批卡片,再用 Mastra 写一遍,对照 Day 49 自己读 SSE 流的做法。
