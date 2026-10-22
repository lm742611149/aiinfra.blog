---
title: 'Day 431 · 用 Java 和 Go 写 Agent(二):LangChain4j、Eino、ADK Go,什么时候拆服务'
description: '昨天用 Spring AI 写了 Java 版查账 Agent,今天再写两版:LangChain4j 的 AiServices 用一个接口声明 Agent,顺带实测不开 -parameters 时参数名变成 arg0;Go 版用字节的 Eino ChatModelAgent,实测工具出错时默认整次运行失败,再用 WrapToolWithErrorHandler 修好。最后看一眼 Google ADK Go,回答「Java 公司上 Agent,全用 Java 还是拆一个 Python 服务」。'
pubDate: 2026-10-22
regime: none
tags: ['java', 'golang', 'langchain4j', 'eino', 'frameworks', 'architecture', 'agent-zero']
series: 'agent-zero'
day: 431
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 430](/blog/agent-zero/day-430-java-go-1/) 我们装好了 JDK 25 和 Maven,用十分钟对照 TypeScript 读懂了 Java 的基本语法,然后用 Spring AI 2.0.1 把 Day 429 的查账 Agent 重写了一遍:`ChatClient` 负责调模型,`@Tool` 注解把两个 Java 方法变成工具,整个循环藏在 `.call()` 里。实测发现,工具抛运行时异常时消息会自动回给模型;循环上限按工具调用次数算,默认 150 次,超限后框架直接返回一句英文。

昨天那张对照图还剩两列没写:LangChain4j 和 Eino。今天补齐,而且会看到最后一行「工具出错」在 Go 里的表现完全不一样。写完三个版本,再回答这两天真正想回答的问题:公司是 Java 或 Go 的,Agent 到底该怎么接。

## 今天要解决的问题

学完今天你应该能:

1. 用 LangChain4j 的 **AiServices** 写一个 Java 接口,让框架生成 Agent;说清楚它和 Spring AI 在风格上的差别,以及为什么纯 Maven 项目要自己开 `-parameters`。
2. 装好 Go,对照 TypeScript 读懂 Go 的结构体、多返回值和 `err != nil`。
3. 用 Eino 的 **ChatModelAgent** 写 Go 版查账 Agent,实测工具出错时默认会怎样,用 `WrapToolWithErrorHandler` 改成把错误交给模型。
4. 面对「Java/Go 公司要上 Agent」的场景,在三种接法里选一种,说出依据。

今天两个新概念:**AiServices**(LangChain4j 用接口声明 Agent)和 **ChatModelAgent**(Eino 的 Agent 循环)。Go 语法和昨天的 Java 语法一样,是跑起来要用的脚手架,只讲够用的部分。

预计用时 2.5–3 小时。前置:昨天的 Day 430(JDK、Maven、`env.sh`、`LedgerTools.java`),Day 429 的 `part07/managed/ledger.db`,[Day 282](/blog/agent-zero/day-282-mcp-errors/) 的「出错时让模型看得懂」,[Day 411](/blog/agent-zero/day-411-permissions-1/) 的工具分级。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `Main.java` 里的接口和 builder、`main.go` 里的 `NewChatModelAgent` 那一段和错误处理默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 第一步:LangChain4j,写一个接口就是一个 Agent

LangChain4j 是一个独立的社区项目,和 Python 的 LangChain 没有关系。它不依赖 Spring(也提供 Spring Boot 集成,今天不用),一个普通的 `main` 方法就能跑。它最有特色的是 **AiServices**:你只写一个 Java 接口(interface,只声明方法、不写实现),框架在运行时替你生成实现,你调接口的方法,背后就是一次完整的 Agent 运行。

前端类比:你用过 tRPC 或者 OpenAPI 生成的客户端吧,你只拿到一个类型定义 `api.getUser(id)`,调用时它替你发 HTTP。AiServices 是同一个思路,只是「背后」从发一个 HTTP 请求变成了跑一整个工具循环。

先建项目。这次不继承 Spring Boot 的父 pom,所以有几样东西要自己写:

```bash
cd ~/agent-zero-lab/part07/java_go
mkdir -p langchain4j/src/main/java/dev/agentzero/ledger
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- agent-zero-lab/part07/java_go/langchain4j/pom.xml -->
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>dev.agentzero</groupId>
  <artifactId>ledger-langchain4j</artifactId>
  <version>0.1.0</version>
  <properties>
    <maven.compiler.release>21</maven.compiler.release>
    <maven.compiler.parameters>true</maven.compiler.parameters>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <langchain4j.version>1.22.0</langchain4j.version>
    <exec.mainClass>dev.agentzero.ledger.Main</exec.mainClass>
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
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.15.0</version>
      </plugin>
      <plugin>
        <groupId>org.codehaus.mojo</groupId>
        <artifactId>exec-maven-plugin</artifactId>
        <version>3.6.4</version>
      </plugin>
    </plugins>
  </build>
</project>
```

<div class="line-notes">

- `<maven.compiler.release>21</maven.compiler.release>` 没有 Spring Boot 父 pom 替你设,要自己告诉编译器按 Java 21 编译。
- `<maven.compiler.parameters>true</maven.compiler.parameters>` 打开 javac 的 `-parameters`,把方法参数名保留到运行时。Spring Boot 父 pom 默认开了,这里得自己写。第二步会实测不开时的后果。
- `<project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>` 源码按 UTF-8 读。我们的工具描述全是中文,不写这一行,有的系统上会按平台默认编码读,中文变乱码。
- `<langchain4j.version>1.22.0</langchain4j.version>` 2026-10-07 发布的最新版。下面两个依赖共用这个版本号,保持一致。
- `<exec.mainClass>dev.agentzero.ledger.Main</exec.mainClass>` 告诉 `mvn exec:java` 默认跑哪个类。写成属性而不是写在插件的 `<configuration>` 里,命令行上 `-Dexec.mainClass=...` 才能覆盖它。我一开始写在 configuration 里,结果命令行指定别的类完全没效果,还在跑 Main,下面第二步要换类跑,所以改成了属性。
- `<artifactId>langchain4j</artifactId>` 核心库:AiServices、`@Tool`、对话记忆都在这里。
- `<artifactId>langchain4j-open-ai</artifactId>` OpenAI 协议的模型实现,DeepSeek 也走它。
- `<artifactId>exec-maven-plugin</artifactId>` 给 Maven 加 `mvn exec:java` 命令,直接运行 main 方法,不用自己打 jar。3.6.4 是 2026-09 的最新版。

</div>

主程序。工具部分和昨天 Spring AI 版的 `LedgerTools` 几乎一样,只是注解换了名字,所以我把它写成 `Main` 里的一个内部类,整个程序一个文件:

```java
// agent-zero-lab/part07/java_go/langchain4j/src/main/java/dev/agentzero/ledger/Main.java
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
import java.util.Map;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.Result;
import dev.langchain4j.service.SystemMessage;

public class Main {

    interface LedgerAssistant {
        @SystemMessage("你是云簿 CloudLedger 的客服助手。先用工具核实,再用中文回答,金额写元。")
        Result<String> ask(String question);
    }

    record Customer(String id, String name, String email, String company) {}

    record Invoice(String id, double amount, String status, String issuedOn) {}

    static class LedgerTools {
        private final String jdbcUrl;

        LedgerTools(String dbPath) {
            if (dbPath == null || !Files.exists(Path.of(dbPath))) {
                throw new IllegalStateException("找不到 " + dbPath + ",先跑 Day 429 的 ledger.py 建库");
            }
            this.jdbcUrl = "jdbc:sqlite:" + dbPath;
        }

        @Tool(name = "find_customer", value = "按邮箱、姓名、公司名或客户编号查客户。查发票之前先用它拿 customer_id。")
        public List<Customer> findCustomer(@P("邮箱、姓名、公司名或编号") String query) {
            System.out.println("[工具] find_customer(query=" + query + ")");
            String like = "%" + query + "%";
            List<Customer> out = new ArrayList<>();
            try (Connection conn = DriverManager.getConnection(jdbcUrl);
                 PreparedStatement ps = conn.prepareStatement(
                         "SELECT id, name, email, company FROM customers "
                                 + "WHERE id = ? OR email = ? OR name LIKE ? OR company LIKE ? LIMIT 5")) {
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

        @Tool(name = "list_invoices", value = "列出客户最近 3 张发票,金额单位元。status 可选 paid/open。")
        public List<Invoice> listInvoices(@P("客户编号,如 C007") String customerId,
                                          @P(value = "paid 或 open,不填就查全部", required = false) String status) {
            System.out.println("[工具] list_invoices(customerId=" + customerId + ", status=" + status + ")");
            String sql = "SELECT id, amount, status, issued_on FROM invoices WHERE customer_id = ?"
                    + (status != null ? " AND status = ?" : "") + " ORDER BY issued_on DESC LIMIT 3";
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

    public static void main(String[] args) {
        OpenAiChatModel model = OpenAiChatModel.builder()
                .baseUrl(System.getenv("LLM_BASE_URL"))
                .apiKey(System.getenv("LLM_API_KEY"))
                .modelName(System.getenv("LLM_MODEL"))
                .temperature(0.0)
                .customParameters(Map.of("thinking", Map.of("type", "disabled")))
                .build();

        LedgerAssistant assistant = AiServices.builder(LedgerAssistant.class)
                .chatModel(model)
                .tools(new LedgerTools(System.getenv("LEDGER_DB")))
                .maxSequentialToolsInvocations(6)
                .build();

        String question = args.length > 0 ? String.join(" ", args)
                : "user007@example.com 这个客户最近三张发票都付了吗?";
        long start = System.currentTimeMillis();
        Result<String> result = assistant.ask(question);
        System.out.println(result.content());
        System.out.printf("工具执行 %d 次,%s,用时 %.1fs%n", result.toolExecutions().size(),
                result.tokenUsage(), (System.currentTimeMillis() - start) / 1000.0);
    }
}
```

<div class="line-notes">

- `import dev.langchain4j.agent.tool.P;` LangChain4j 的参数注解叫 `@P`(parameter 的缩写),作用和昨天 Spring AI 的 `@ToolParam` 一样。
- `interface LedgerAssistant {` 整个 Agent 的「外观」就是这个接口。我们没写任何实现,下面 `AiServices.builder(LedgerAssistant.class)...build()` 会在运行时用**动态代理**生成一个:调用它的方法时,代理拦下这次调用,把参数变成用户消息,跑完工具循环,再把结果变成返回值。
- `@SystemMessage("你是云簿 CloudLedger 的客服助手。先用工具核实,再用中文回答,金额写元。")` system prompt 写在注解上,和前两版一字不差。还支持 `{{变量}}` 模板,今天用不到。
- `Result<String> ask(String question);` 返回类型决定你拿到什么。写成 `String ask(...)` 就只拿到回答文字;写成 `Result<String>` 还能拿到 token 用量和每次工具执行的记录,下面要打印这些。
- `record Customer(String id, String name, String email, String company) {}` 和昨天一样的 record。LangChain4j 也会把返回值转成 JSON 交给模型。
- `static class LedgerTools {` 内部类。`static` 表示它不依赖外面 `Main` 的实例,可以直接 `new Main.LedgerTools(...)`。
- `if (dbPath == null || !Files.exists(Path.of(dbPath))) {` 比昨天多判断一个 `null`:这里没有 Spring 帮忙,`System.getenv("LEDGER_DB")` 取不到时就是 `null`,直接 `Path.of(null)` 会抛一个看不懂的空指针异常。忘了 `source env.sh` 是最常见的原因。
- `@Tool(name = "find_customer", value = "按邮箱、姓名、公司名或客户编号查客户。查发票之前先用它拿 customer_id。")` 注意 LangChain4j 的 `@Tool` 用 `value` 写描述,Spring AI 用 `description`。两个框架的注解都叫 `@Tool`,包名不同、属性名不同,从一个抄到另一个最容易错在这。
- `public List<Customer> findCustomer(@P("邮箱、姓名、公司名或编号") String query) {` 方法体和昨天一样。
- `throw new IllegalArgumentException("没找到和「" + query + "」匹配的客户。换成邮箱、姓名或公司名再试。");` LangChain4j 文档写的默认行为:工具抛异常时,`e.getMessage()` 作为工具结果发给模型。和 Spring AI 一样。文档同时说了两件要当心的事:异常消息通常是写给开发者看的,可能带出内部细节(比如 SQL 报错里的表名);这个默认行为**计划在以后的版本里改成** `failInvocationUnlessVisibleToLlm()`,也就是只有实现了 `ToolErrorVisibleToLlm` 接口的异常才给模型看,其余直接失败。
- `@P(value = "paid 或 open,不填就查全部", required = false) String status) {` 可选参数,写法和 Spring AI 的 `required = false` 一样。
- `OpenAiChatModel model = OpenAiChatModel.builder()` 自己建模型对象。这里没有 Spring 的自动配置,所以 base-url、key、模型名都要自己从环境变量读。
- `.baseUrl(System.getenv("LLM_BASE_URL"))` 填 `https://api.deepseek.com`,和 Spring AI 一样不加 `/v1`。
- `.customParameters(Map.of("thinking", Map.of("type", "disabled")))` 往请求体里额外塞字段,相当于 Python 的 `extra_body`、Spring AI 的 `extra-body.thinking.type`。`Map.of("k", v)` 相当于 JS 的 `{ k: v }`,只是不能修改。
- `LedgerAssistant assistant = AiServices.builder(LedgerAssistant.class)` 今天第一个新概念的核心。把接口的「类对象」交给 builder,告诉它要生成哪个接口的实现。
- `.chatModel(model)` 用哪个模型。
- `.tools(new LedgerTools(System.getenv("LEDGER_DB")))` 把工具对象交进去,框架反射扫出两个 `@Tool` 方法。和 Spring AI 的 `.defaultTools(tools)` 一个意思。
- `.maxSequentialToolsInvocations(6)` 循环上限。名字里说是「连续工具调用」,但我在 1.22.0 的字节码里看到它设置的字段叫 `maxToolCallingRoundTrips`,默认 100,按「模型要了一次工具、我们执行完再问模型」这样的**来回次数**计,一次来回里模型并行要几个工具都只算一次。和 Spring AI 按工具调用次数计不一样。练习 1 会实测超限。
- `Result<String> result = assistant.ask(question);` 一行调用就是一次 Agent 运行。调用接口方法,背后发生的事和昨天 `.call()` 里一样。
- `System.out.printf("工具执行 %d 次,%s,用时 %.1fs%n", result.toolExecutions().size(),` `toolExecutions()` 是这次运行里每一次工具执行的记录(工具名、参数、结果),调试和写评测时很有用。实跑是 2 次。

</div>

跑之前先在 `agent-zero-lab` 目录里 `source part07/java_go/env.sh`(昨天写的那个导出变量的脚本),然后:

```bash
cd ~/agent-zero-lab/part07/java_go/langchain4j
mvn -q compile exec:java
```

```text
SLF4J(W): No SLF4J providers were found.
SLF4J(W): Defaulting to no-operation (NOP) logger implementation
SLF4J(W): See https://www.slf4j.org/codes.html#noProviders for further details.
[工具] find_customer(query=user007@example.com)
[工具] list_invoices(customerId=C007, status=null)
刘静（半岛咖啡，客户编号 C007）最近三张发票中，**有两张已付、一张未付**：

| 发票号 | 开票日期 | 金额 | 状态 |
|---|---|---|---|
| INV-2026-0123 | 2026-10-08 | 2392 元 | 已付 |
| INV-2026-0098 | 2026-09-08 | 2392 元 | 已付 |
| INV-2026-0071 | 2026-08-08 | 2392 元 | **未付** |

未付的是 2026-08-08 开出的 INV-2026-0071，金额 2392 元。需要我帮您查一下这张的付款截止日期或发送催款提醒吗？
工具执行 2 次,OpenAiTokenUsage { inputTokenCount = 1612, inputTokensDetails = OpenAiTokenUsage.InputTokensDetails { cachedTokens = 1024, cacheWriteTokens = null }, outputTokenCount = 263, outputTokensDetails = null, totalTokenCount = 1875 },用时 4.2s
```

结论和前两版一样。三处值得看:

- 开头三行 `SLF4J(W)`。SLF4J 是 Java 世界通用的日志接口,LangChain4j 只依赖接口、不带具体实现,你没加实现时它就提醒一句「日志全被丢掉了」。不影响运行,但也意味着 LangChain4j 自己打的所有日志你都看不到,包括文档里说的「工具没配错误处理器时会警告一次」那条。想看就在 pom 里加一个 `org.slf4j:slf4j-simple` 依赖。
- `cachedTokens = 1024`。1612 个输入 token 里有 1024 个命中了 DeepSeek 的缓存([Day 397](/blog/agent-zero/day-397-prompt-caching/) 的 prompt caching),因为前面几次实验已经用同样的 system 和工具定义请求过。命中部分按 0.04 元/百万 token 算,这次的钱是 (1024 × 0.04 + 588 × 2 + 263 × 8) ÷ 1,000,000 ≈ 0.0033 元。
- 用时 4.2 秒,比昨天 Spring AI 版的 9.3 秒快一倍,比 Python 版的 2.3 秒慢。

问一个不存在的客户,看工具出错时的表现:

```bash
mvn -q exec:java -Dexec.args="user999@example.com 有没有没付的发票?"
```

```text
[工具] find_customer(query=user999@example.com)
没有找到与 user999@example.com 匹配的客户记录，因此无法查询该客户的发票。

请确认一下邮箱是否写对了，或者提供客户的姓名、公司名或客户编号，我再帮您查。
工具执行 1 次,OpenAiTokenUsage { inputTokenCount = 935, inputTokensDetails = OpenAiTokenUsage.InputTokensDetails { cachedTokens = 512, cacheWriteTokens = null }, outputTokenCount = 93, outputTokensDetails = null, totalTokenCount = 1028 },用时 3.1s
```

模型读到了异常消息,请用户换个查法,和 Spring AI 一样。

Spring AI 和 LangChain4j 放在一起看,差别主要在风格。Spring AI 是「一个 Spring 应用 + 链式调用」,配置都在 properties 里,模型对象由容器建好注入,天然接 Spring 的监控(Micrometer、Actuator)。LangChain4j 是「接口 + 注解」,不绑框架,老的非 Spring 项目、Quarkus、甚至安卓里都能用。我的选法很简单:公司是标准的 Spring Boot 技术栈,选 Spring AI,运维和监控那一套白捡;不是,选 LangChain4j,更轻。

## 第二步:不开 -parameters,参数名会变成什么

上面 pom 里那行 `<maven.compiler.parameters>true</maven.compiler.parameters>`,我说「不开会出事」。口说无凭,实测一次。写一个小程序,只打印 LangChain4j 从工具类上推出来的参数名,不调模型:

```java
// agent-zero-lab/part07/java_go/langchain4j/src/main/java/dev/agentzero/ledger/SchemaDump.java
package dev.agentzero.ledger;

import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.agent.tool.ToolSpecifications;

public class SchemaDump {

    public static void main(String[] args) {
        for (ToolSpecification spec : ToolSpecifications.toolSpecificationsFrom(Main.LedgerTools.class)) {
            System.out.println(spec.name() + " -> " + spec.parameters().properties().keySet()
                    + " 必填 " + spec.parameters().required());
        }
    }
}
```

<div class="line-notes">

- `import dev.langchain4j.agent.tool.ToolSpecification;` ToolSpecification 是 LangChain4j 里的「工具说明书」:名字、描述、参数 schema,和昨天 Spring AI 的 `ToolDefinition` 对应。
- `ToolSpecifications.toolSpecificationsFrom(Main.LedgerTools.class)` 不需要建对象,直接扫类上的 `@Tool` 方法,用反射生成说明书。
- `spec.parameters().properties().keySet()` 只打印参数名的集合,不打印整段 schema,好对比。
- `+ " 必填 " + spec.parameters().required());` 必填参数列表。

</div>

先正常跑一次,再用 `-Dmaven.compiler.parameters=false` 覆盖 pom 里的设置,`clean` 掉旧的编译结果重新编译再跑:

```bash
mvn -q clean compile exec:java -Dexec.mainClass=dev.agentzero.ledger.SchemaDump
mvn -q clean compile exec:java -Dexec.mainClass=dev.agentzero.ledger.SchemaDump -Dmaven.compiler.parameters=false
```

```text
find_customer -> [query] 必填 [query]
list_invoices -> [customerId, status] 必填 [customerId]

find_customer -> [arg0] 必填 [arg0]
list_invoices -> [arg0, arg1] 必填 [arg0]
```

第二次参数名全变成了 `arg0`、`arg1`。Java 编译器默认不把参数名写进编译产物,框架用反射只能拿到「第几个参数」。程序照样能跑,不报任何错,模型只能靠 `@P` 里的描述猜 `arg0` 是什么。两个参数还好猜,参数一多、描述一模糊,调用准确率会悄悄下降,而你从现象上很难查到是这一行配置的原因。跑完记得再 `mvn -q clean compile` 一次恢复正常编译。

## 第三步:装 Go,给前端看的 Go 十分钟

换语言。Go 是 Google 出的一门编译型语言,语法比 Java 简单得多,国内后端用得很多(字节、B 站、滴滴的大量服务都是 Go)。装法:

```bash
brew install go        # 或者去 https://go.dev/dl/ 下载 macOS 的 .pkg 安装包
go version
```

我这里实跑是 `go version go1.27.3 darwin/amd64`,2026 年 10 月 go.dev 上的最新稳定版就是 1.27.3。Go 自带了包管理,不需要另装一个 Maven:`go mod init` 建项目(≈ `npm init`),`go get` 装依赖(≈ `npm install 包名`),`go run .` 编译并运行(≈ `npx tsx index.ts`)。依赖清单写在 `go.mod`(≈ package.json),精确版本和校验和在 `go.sum`(≈ package-lock.json)。

先写一个小程序,把后面会遇到的语法过一遍:

```bash
cd ~/agent-zero-lab/part07/java_go
mkdir hello-go && cd hello-go
go mod init example.com/hello-go
```

```go
// agent-zero-lab/part07/java_go/hello-go/main.go
package main

import (
	"encoding/json"
	"errors"
	"fmt"
)

type Invoice struct {
	ID     string  `json:"id"`
	Amount float64 `json:"amount"`
	Status string  `json:"status"`
}

func findInvoice(invoices []Invoice, id string) (Invoice, error) {
	for _, inv := range invoices {
		if inv.ID == id {
			return inv, nil
		}
	}
	return Invoice{}, errors.New("没有这张发票:" + id)
}

func main() {
	invoices := []Invoice{
		{ID: "INV-2026-0123", Amount: 2392.00, Status: "paid"},
		{ID: "INV-2026-0071", Amount: 2392.00, Status: "open"},
	}
	inv, err := findInvoice(invoices, "INV-2026-0071")
	if err != nil {
		fmt.Println("出错:", err)
		return
	}
	b, _ := json.Marshal(inv)
	fmt.Println(string(b))

	_, err = findInvoice(invoices, "INV-9999")
	fmt.Println("出错:", err)
}
```

<div class="line-notes">

- `package main` 每个 Go 文件第一行都声明自己属于哪个包。叫 `main` 的包是可执行程序,里面必须有 `func main()`。
- `import (` 一次导入多个标准库包。Go 很严格:导入了却没用的包,编译直接报错,不是警告。
- `type Invoice struct {` 结构体,Go 里装数据的类型,相当于 TS 的 `type Invoice = { ... }`。Go 没有 class,方法另外挂在结构体上(今天用不到)。
- `ID     string  `json:"id"`` 字段名在前、类型在后,和 TS 一样的顺序(和 Java 相反)。**首字母大写表示公开**,小写表示只在包内可见,Go 没有 `public`/`private` 关键字,全靠大小写。反引号里的是 **struct tag**,一段给库看的元数据:`json:"id"` 告诉 JSON 库这个字段序列化成 `id`。等会儿 Eino 也是读 tag 来生成工具 schema 的。
- `func findInvoice(invoices []Invoice, id string) (Invoice, error) {` 函数可以**返回多个值**,这里返回一张发票和一个错误。`[]Invoice` 是切片,当成 TS 的 `Invoice[]`。
- `for _, inv := range invoices {` 相当于 `for (const inv of invoices)`。`range` 每次给出下标和元素,下标用不到就写 `_` 丢掉。`:=` 是「声明并赋值」,类型自动推断,像 TS 的 `const x = ...`。
- `return inv, nil` 找到了:返回发票,错误是 `nil`(Go 的 null)。
- `return Invoice{}, errors.New("没有这张发票:" + id)` 没找到:返回一个空发票和一个错误。**Go 没有 throw/try/catch**,错误是一个普通的返回值。这是 Go 和 JS、Python、Java 最大的不同,后面 Eino 的工具出错行为就是从这里来的。
- `inv, err := findInvoice(invoices, "INV-2026-0071")` 两个返回值用两个变量接。
- `if err != nil {` Go 代码里出现最多的一行。每次调用可能出错的函数,都要立刻检查 `err`。相当于把 `try/catch` 拆散,写在每个调用后面。
- `b, _ := json.Marshal(inv)` `json.Marshal` 相当于 `JSON.stringify`,返回字节和错误,这里用 `_` 把错误丢掉(演示用,正式代码别这么干)。
- `fmt.Println(string(b))` 字节转成字符串打印,实跑 `{"id":"INV-2026-0071","amount":2392,"status":"open"}`。注意 `2392.00` 序列化后是 `2392`,Go 的 JSON 库不保留多余的小数位。
- `_, err = findInvoice(invoices, "INV-9999")` 这次 `err` 已经声明过了,用 `=` 而不是 `:=`。实跑打印 `出错: 没有这张发票:INV-9999`。

</div>

```bash
go run .
```

```text
{"id":"INV-2026-0071","amount":2392,"status":"open"}
出错: 没有这张发票:INV-9999
```

| Go | TypeScript | Python |
| --- | --- | --- |
| `type Invoice struct { ID string }` | `type Invoice = { id: string }` | `@dataclass class Invoice: id: str` |
| `[]Invoice` | `Invoice[]` | `list[Invoice]` |
| `map[string]any` | `Record<string, unknown>` | `dict[str, Any]` |
| `x := 1` | `const x = 1` | `x = 1` |
| `return v, err` 再 `if err != nil` | `throw` / `try...catch` | `raise` / `try...except` |
| `nil` | `null` | `None` |
| 首字母大写 = 公开 | `export` | 不以下划线开头 |
| `` `json:"id"` `` struct tag | 无直接对应 | pydantic 的 `Field(alias="id")` |

## 第四步:Eino 的 ChatModelAgent

Go 生态的 Agent 框架没有 Java 那么多,国内团队基本是字节 CloudWeGo 的 **Eino**。它有两层 API:比较早的 `flow/agent/react`(ReAct Agent),和这一年主推的 `adk` 包(Agent Development Kit,名字和 Google ADK 一样,但是两回事)。官方示例现在都用 `adk.NewChatModelAgent` 加 `adk.NewRunner`,我们也用这套。下面的代码是我对着 eino v0.9.22 源码里的 `adk/chatmodel.go`、`adk/runner.go` 写的。

**ChatModelAgent** 是今天第二个新概念:Eino 里「一个模型 + 一组工具 + 一个循环」的现成 Agent。你给它模型、工具、system prompt 和最大轮数,它负责跑循环;**Runner** 负责把它跑起来,并把过程中的每条消息作为**事件**一条条交给你。

建项目、装依赖:

```bash
cd ~/agent-zero-lab/part07/java_go
mkdir eino && cd eino
go mod init example.com/ledger-eino
go get github.com/cloudwego/eino@v0.9.22
go get github.com/cloudwego/eino-ext/components/model/openai@v0.1.13
go get modernc.org/sqlite@v1.61.0
```

<div class="line-notes">

- `go mod init example.com/ledger-eino` 建 `go.mod`。模块名一般写成代码仓库地址,我们不发布,随便起一个合法的名字就行。我这里生成的 go.mod 第三行是 `go 1.27.3`,也就是当前安装的 Go 版本。
- `go get github.com/cloudwego/eino@v0.9.22` Eino 核心,2026-10-19 打的标签。**0.x 版本小版本之间也会改 API,一定写死版本号**,教程(包括这篇)和你装的版本对不上时,先看 go.mod。
- `go get github.com/cloudwego/eino-ext/components/model/openai@v0.1.13` 模型实现放在单独的 `eino-ext` 仓库里,每个组件是独立的 Go 模块,版本号和核心不同步。v0.1.13 是 2026-04-16 的,仍是最新。
- `go get modernc.org/sqlite@v1.61.0` 纯 Go 写的 SQLite 驱动,2026-10-21 刚发的版本。它不需要 C 编译器(另一个常用驱动 mattn/go-sqlite3 需要),装起来省心。

</div>

主程序,一个文件:

```go
// agent-zero-lab/part07/java_go/eino/main.go
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	_ "modernc.org/sqlite"
)

type FindCustomerInput struct {
	Query string `json:"query" jsonschema_description:"邮箱、姓名、公司名或编号"`
}

type Customer struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Email   string `json:"email"`
	Company string `json:"company"`
}

type ListInvoicesInput struct {
	CustomerID string `json:"customer_id" jsonschema_description:"客户编号,如 C007"`
	Status     string `json:"status,omitempty" jsonschema_description:"paid 或 open,不填就查全部"`
}

type Invoice struct {
	ID       string  `json:"id"`
	Amount   float64 `json:"amount"`
	Status   string  `json:"status"`
	IssuedOn string  `json:"issued_on"`
}

func newTools(db *sql.DB) ([]tool.BaseTool, error) {
	findCustomer, err := utils.InferTool("find_customer",
		"按邮箱、姓名、公司名或客户编号查客户。查发票之前先用它拿 customer_id。",
		func(ctx context.Context, in *FindCustomerInput) ([]Customer, error) {
			like := "%" + in.Query + "%"
			rows, err := db.QueryContext(ctx,
				"SELECT id, name, email, company FROM customers WHERE id = ? OR email = ? OR name LIKE ? OR company LIKE ? LIMIT 5",
				in.Query, in.Query, like, like)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			var out []Customer
			for rows.Next() {
				var c Customer
				if err := rows.Scan(&c.ID, &c.Name, &c.Email, &c.Company); err != nil {
					return nil, err
				}
				out = append(out, c)
			}
			if len(out) == 0 {
				return nil, fmt.Errorf("没找到和「%s」匹配的客户。换成邮箱、姓名或公司名再试。", in.Query)
			}
			return out, rows.Err()
		})
	if err != nil {
		return nil, err
	}

	listInvoices, err := utils.InferTool("list_invoices",
		"列出客户最近 3 张发票,金额单位元。status 可选 paid/open。",
		func(ctx context.Context, in *ListInvoicesInput) ([]Invoice, error) {
			q := "SELECT id, amount, status, issued_on FROM invoices WHERE customer_id = ?"
			args := []any{in.CustomerID}
			if in.Status != "" {
				q += " AND status = ?"
				args = append(args, in.Status)
			}
			rows, err := db.QueryContext(ctx, q+" ORDER BY issued_on DESC LIMIT 3", args...)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			var out []Invoice
			for rows.Next() {
				var inv Invoice
				if err := rows.Scan(&inv.ID, &inv.Amount, &inv.Status, &inv.IssuedOn); err != nil {
					return nil, err
				}
				out = append(out, inv)
			}
			if len(out) == 0 {
				return nil, fmt.Errorf("客户 %s 没有发票记录。确认编号是否来自 find_customer 的结果。", in.CustomerID)
			}
			return out, rows.Err()
		})
	if err != nil {
		return nil, err
	}

	tools := []tool.BaseTool{findCustomer, listInvoices}
	if os.Getenv("RAW_TOOL_ERRORS") == "" {
		for i, t := range tools {
			tools[i] = utils.WrapToolWithErrorHandler(t, func(_ context.Context, err error) string {
				return "出错:" + err.Error()
			})
		}
	}
	return tools, nil
}

func main() {
	ctx := context.Background()

	dbPath := os.Getenv("LEDGER_DB")
	if _, err := os.Stat(dbPath); err != nil {
		log.Fatalf("找不到 %q,先跑 Day 429 的 ledger.py 建库", dbPath)
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
		ExtraFields: map[string]any{"thinking": map[string]any{"type": "disabled"}},
	})
	if err != nil {
		log.Fatal(err)
	}

	tools, err := newTools(db)
	if err != nil {
		log.Fatal(err)
	}

	agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:          "ledger_assistant",
		Description:   "云簿查账助手",
		Instruction:   "你是云簿 CloudLedger 的客服助手。先用工具核实,再用中文回答,金额写元。",
		Model:         cm,
		ToolsConfig:   adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: tools}},
		MaxIterations: 6,
	})
	if err != nil {
		log.Fatal(err)
	}

	question := "user007@example.com 这个客户最近三张发票都付了吗?"
	if len(os.Args) > 1 {
		question = strings.Join(os.Args[1:], " ")
	}
	start := time.Now()
	runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent})
	iter := runner.Query(ctx, question)
	for {
		event, ok := iter.Next()
		if !ok {
			break
		}
		if event.Err != nil {
			log.Fatalf("运行出错:%v", event.Err)
		}
		if event.Output == nil || event.Output.MessageOutput == nil || event.Output.MessageOutput.Message == nil {
			continue
		}
		msg := event.Output.MessageOutput.Message
		for _, tc := range msg.ToolCalls {
			fmt.Printf("[模型要调] %s %s\n", tc.Function.Name, tc.Function.Arguments)
		}
		if msg.Role == schema.Tool {
			fmt.Printf("[工具结果] %.90s\n", msg.Content)
		} else if msg.Content != "" {
			fmt.Println(msg.Content)
			if u := msg.ResponseMeta; u != nil && u.Usage != nil {
				fmt.Printf("这一轮:输入 %d / 输出 %d token\n", u.Usage.PromptTokens, u.Usage.CompletionTokens)
			}
		}
	}
	fmt.Printf("总用时 %.1fs\n", time.Since(start).Seconds())
}
```

<div class="line-notes">

- `"context"` Go 的 context 用来在一串函数调用之间传递「截止时间」和「取消信号」。[Day 392](/blog/agent-zero/day-392-timeouts/) 讲的超时链,在 Go 里就是靠一路往下传 ctx 实现的。今天只用最简单的 `context.Background()`,表示「没有截止时间」。
- `_ "modernc.org/sqlite"` 下划线导入:只执行这个包的初始化代码,把名叫 `sqlite` 的驱动注册进标准库 `database/sql`,代码里不直接用它的任何东西。少了这一行,下面 `sql.Open("sqlite", ...)` 会报 `sql: unknown driver "sqlite"`。
- `Query string `json:"query" jsonschema_description:"邮箱、姓名、公司名或编号"`` Eino 从**输入结构体**推导工具 schema:`json` tag 给参数名,`jsonschema_description` tag 给参数说明。这是 Go 版的 `@ToolParam(description=...)`。参数名我们直接写成蛇形的 `query`、`customer_id`,和 Python 版一致,比 Java 版的 `customerId` 还对得上。
- `Status     string `json:"status,omitempty"` 带 `omitempty` 的字段在 schema 里是可选的,不带的(`customer_id`)是必填。模型没传时 `in.Status` 是 Go 字符串的零值 `""`,所以下面用 `!= ""` 判断。
- `IssuedOn string  `json:"issued_on"`` 输出结构体的 tag 决定模型看到的 JSON 键,我们和 Python 版保持一样的 `issued_on`。
- `func newTools(db *sql.DB) ([]tool.BaseTool, error) {` `*sql.DB` 是指针,先当成「对同一个对象的引用」就行。`*sql.DB` 本身就是一个连接池,建一次全程复用,不像 Java 版每次调用都 `getConnection`。
- `findCustomer, err := utils.InferTool("find_customer",` `InferTool` 是 Eino 把普通 Go 函数变成工具的辅助函数。它是泛型函数,看你传进来的函数参数类型 `*FindCustomerInput` 和返回类型 `[]Customer`,自动生成 schema、负责把模型给的 JSON 参数解析成结构体、把返回值序列化成 JSON。
- `func(ctx context.Context, in *FindCustomerInput) ([]Customer, error) {` 工具函数的固定形状:第一个参数是 ctx,第二个是输入结构体的指针;返回结果和错误。和 hello-go 里的 `findInvoice` 一样是「值 + error」两个返回值。
- `rows, err := db.QueryContext(ctx,` 用 `?` 占位,四个值依次填进去,和 Java、Python 版一样防注入。带 ctx 的版本在 ctx 被取消时会中断查询。
- `defer rows.Close()` `defer` 表示「这个函数返回时再执行」,不管从哪个 return 出去都会执行。相当于 Java 的 try-with-resources、Python 的 with 的收尾部分。
- `if err := rows.Scan(&c.ID, &c.Name, &c.Email, &c.Company); err != nil {` `Scan` 把当前行的四列依次写进四个字段。`&` 是取地址,意思是「把值写到这里」。
- `return nil, fmt.Errorf("没找到和「%s」匹配的客户。换成邮箱、姓名或公司名再试。", in.Query)` 查不到时返回一个 Go 的 error。在 Java 里这对应 `throw`,在 Go 里只是第二个返回值。下一步会看到 Eino 对这个 error 默认怎么处理。
- `args := []any{in.CustomerID}` `any` 是任意类型,和 TS 的 `unknown` 差不多。SQL 参数个数要看有没有 status,所以先放进一个切片。
- `rows, err := db.QueryContext(ctx, q+" ORDER BY issued_on DESC LIMIT 3", args...)` `args...` 把切片展开成多个参数,相当于 JS 的 `...args`。代入「北岸设计」那次实测:`args` 是 `["C012", "open"]`。
- `tools := []tool.BaseTool{findCustomer, listInvoices}` 两个工具放进一个切片。`tool.BaseTool` 是 Eino 里所有工具都满足的接口。
- `if os.Getenv("RAW_TOOL_ERRORS") == "" {` 一个实验开关:设了 `RAW_TOOL_ERRORS` 环境变量就跳过下面的包装,方便你对比两种行为。正式代码里不需要这个开关。
- `tools[i] = utils.WrapToolWithErrorHandler(t, func(_ context.Context, err error) string {` 给每个工具套一层:工具返回 error 时,不再往外抛,而是调用我们给的函数把错误变成一段文字,当作工具结果交给模型。下一步专门讲它。
- `if _, err := os.Stat(dbPath); err != nil {` 又是那个 SQLite 路径写错会悄悄建空库的坑。`sql.Open` 只检查参数,不真的去连库,所以启动时自己先 `Stat` 一下文件。
- `temperature := float32(0)` 配置里 `Temperature` 是 `*float32` 指针,用指针是为了区分「没设」(nil,用服务端默认)和「设成 0」。Go 不允许直接写 `&0` 取字面量的地址,所以先放进一个变量。
- `ExtraFields: map[string]any{"thinking": map[string]any{"type": "disabled"}},` 第三次见到这个字段了:Python 的 `extra_body`、Spring AI 的 `extra-body`、LangChain4j 的 `customParameters`,Eino 叫 `ExtraFields`。四种写法,同一个 JSON。
- `agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{` 今天第二个新概念的核心。配置字段名我是从 v0.9.22 的 `adk/chatmodel.go` 里抄的。
- `Instruction:   "你是云簿 CloudLedger 的客服助手。先用工具核实,再用中文回答,金额写元。",` Eino 管 system prompt 叫 Instruction,还支持 `{Time}` 这种占位符从会话里取值。
- `ToolsConfig:   adk.ToolsConfig{ToolsNodeConfig: compose.ToolsNodeConfig{Tools: tools}},` 两层嵌套是因为 Eino 底层把 Agent 拼成了一张图(`compose` 包),工具执行是图里的一个「工具节点」。我们只填最里面的 `Tools`。
- `MaxIterations: 6,` 模型生成的最大轮数,源码注释写着默认 20,超过就以错误结束。三个框架里,它和 LangChain4j 的 round trips 一样按「轮」计,Spring AI 按工具调用次数计。
- `runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent})` Runner 负责驱动 Agent。它还管断点续跑和流式(今天都不开),不设 `EnableStreaming` 就是非流式,每个事件里是一条完整的消息。
- `iter := runner.Query(ctx, question)` `Query` 是简便写法,传一个字符串当用户消息。返回一个迭代器,Agent 每产出一条消息就是一个事件。
- `event, ok := iter.Next()` 取下一个事件,没有了 `ok` 是 false。相当于 JS 里 `const { value, done } = await it.next()`。
- `if event.Err != nil {` 运行出的错从这里冒出来:模型接口报错、超过 MaxIterations、工具返回了没被处理的 error。
- `for _, tc := range msg.ToolCalls {` 模型要调工具时,消息里带 `ToolCalls`,打印工具名和 JSON 参数,就是 [Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 那张时序图里的 assistant 消息。
- `if msg.Role == schema.Tool {` 工具执行完,Runner 也会把 tool 消息作为一个事件交给你。`%.90s` 只打印前 90 个字节,省得刷屏。字节不是字符,中文可能被截在半个字上,调试输出无所谓。
- `if u := msg.ResponseMeta; u != nil && u.Usage != nil {` 模型消息上挂着这一轮的 token 用量。注意是**每一轮各自的**,不像 Spring AI 和 LangChain4j 给的是全部合计。

</div>

```bash
cd ~/agent-zero-lab && source part07/java_go/env.sh
cd part07/java_go/eino
go run .
```

```text
WARNING: sonic/ast only supports (go1.17~1.26 and amd64 CPU) or (go1.20~1.26 and arm64 CPU), but your environment is not suitable and will fallback to encoding/json
[模型要调] find_customer {"query": "user007@example.com"}
我先查一下这位客户的资料。
这一轮:输入 442 / 输出 48 token
[工具结果] [{"id":"C007","name":"刘静","email":"user007@example.com","company":"半岛咖啡"}]
[模型要调] list_invoices {"customer_id": "C007"}
[工具结果] [{"id":"INV-2026-0123","amount":2392,"status":"paid","issued_on":"2026-10-08"},{"id":"INV-
刘静（半岛咖啡，客户编号 C007）最近三张发票的情况如下：

| 发票号 | 开票日期 | 金额 | 状态 |
|---|---|---|---|
| INV-2026-0123 | 2026-10-08 | 2392 元 | 已付 |
| INV-2026-0098 | 2026-09-08 | 2392 元 | 已付 |
| INV-2026-0071 | 2026-08-08 | 2392 元 | **未付** |

结论：**没有全部付清**。最近两张（9 月、10 月）已付款，但 8 月 8 日开出的 INV-2026-0071（2392 元）目前仍是未付状态。需要我帮您查一下这张发票的账期或催款记录吗？
这一轮:输入 673 / 输出 189 token
总用时 2.9s
```

第一行 WARNING 是 Eino 依赖的 JSON 库 sonic(字节自己写的高性能 JSON 库)在说:它只支持到 Go 1.26,我们用的 1.27.3 太新,自动退回标准库的 `encoding/json`。功能不受影响,只是 JSON 处理慢一点。这种「依赖跟不上语言新版本」的情况在 Go 生态里很常见,生产项目一般锁一个依赖都支持的 Go 版本。

这次能看到每一个事件:模型先说了一句「我先查一下这位客户的资料」并要 `find_customer`,工具结果回来,模型再要 `list_invoices`(这一轮它没说话,`Content` 为空,所以没打印用量),工具结果回来,最后一轮给出回答。用时 2.9 秒,和 Python 版的 2.3 秒在同一个量级。

用公司名再问一次:

```bash
go run . "北岸设计有没有没付的发票?"
```

```text
[模型要调] find_customer {"query": "北岸设计"}
我来查一下北岸设计的未付发票。
这一轮:输入 435 / 输出 49 token
[工具结果] [{"id":"C012","name":"王磊","email":"user012@example.com","company":"北岸设计"}]
[模型要调] list_invoices {"customer_id": "C012", "status": "open"}
[工具结果] [{"id":"INV-2026-0130","amount":599,"status":"open","issued_on":"2026-10-12"}]
北岸设计（客户编号 C012，联系人王磊）目前有 **1 张未付发票**：

- 发票号：INV-2026-0130
- 金额：599 元
- 开票日期：2026-10-12
- 状态：未付

需要我帮您查看这张发票的详情，或者核对已付记录吗？
这一轮:输入 621 / 输出 83 token
总用时 3.2s
```

(sonic 那行 WARNING 每次都有,后面的输出里我就不重复贴了。)

## 第五步:工具出错,Go 里默认整次失败

昨天的 Spring AI、今天的 LangChain4j,工具一抛异常,消息就自动回给了模型。Eino 呢?用 `RAW_TOOL_ERRORS=1` 跳过包装,问一个不存在的客户:

```bash
RAW_TOOL_ERRORS=1 go run . "user999@example.com 有没有没付的发票?"
```

```text
[模型要调] find_customer {"query": "user999@example.com"}
我先查一下这位客户的资料。
这一轮:输入 438 / 输出 48 token
2026/10/22 19:02:33 运行出错:[NodeRunError] failed to invoke tool[name:find_customer id:call_00_rAOzaddfpZvN0Faa0Ww81079]: [LocalFunc] failed to invoke tool, toolName=find_customer, err=没找到和「user999@example.com」匹配的客户。换成邮箱、姓名或公司名再试。
------------------------
node path: [node_1, ToolNode]
exit status 1
```

整次运行直接失败了。工具函数返回的 error 被 Eino 当成「工具节点执行出错」,沿着图往外冒,最后从 `event.Err` 出来,我们的代码 `log.Fatalf` 退出。模型根本没机会看到那句「换成邮箱、姓名或公司名再试」。

这就是那张对照图最后一行的意思。在 Go 的世界观里,error 就是「出事了」,框架不会替你假设某个 error 其实是「正常的业务结果」。从 Python 或 Java 迁过来的人最容易在这里栽跟头:查不到客户就返回 error,上线后用户看到的是一个 500。

修法有两种。一种是不返回 error,把「查不到」写进返回值(比如输出结构体加一个 `Error string` 字段),这是旧一点的写法。另一种是用 Eino 提供的 `utils.WrapToolWithErrorHandler`,也就是我们代码里默认打开的那段:给工具套一层,工具返回 error 时调用你的函数,把 error 变成一段文字当作工具结果交给模型。去掉开关再跑:

```bash
go run . "user999@example.com 有没有没付的发票?"
```

```text
[模型要调] find_customer {"query": "user999@example.com"}
我先查一下这位客户的资料。
这一轮:输入 438 / 输出 48 token
[工具结果] 出错:[LocalFunc] failed to invoke tool, toolName=find_customer, err=没找到和「user999@example.com
抱歉，我在系统里没有查到与 **user999@example.com** 匹配的客户，因此无法确认该邮箱名下是否有未付发票。

可能的原因：
- 该邮箱未在云簿登记，或登记的是其他邮箱
- 邮箱拼写有差异

方便的话，请提供客户的**姓名、公司名或客户编号**，我再帮您核实未付发票情况。
这一轮:输入 540 / 输出 83 token
总用时 2.2s
```

好了,模型看到了错误,请用户换个查法。但仔细看工具结果那一行:模型收到的是 `[LocalFunc] failed to invoke tool, toolName=find_customer, err=...`。我们的 error 在传给处理函数之前,已经被 Eino 包了一层框架内部的信息。这次包的只是工具名,无伤大雅;可如果是数据库报错,`err.Error()` 里可能带着 SQL、表名、文件路径,原样发给模型就是 LangChain4j 文档里警告的那种泄露。练习 3 把它改成「只有业务错误给模型看,其余错误只记日志」。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三个框架处理工具错误的路径对比:Spring AI 和 LangChain4j 默认把异常消息回给模型,Eino 默认让整次运行失败,包一层 ErrorHandler 后才回给模型">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="96" width="120" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="76" y="118" text-anchor="middle" fill="var(--ink)">工具出错</text>
    <text x="76" y="134" text-anchor="middle" fill="var(--ink-soft)">查不到客户</text>
    <line x1="136" y1="110" x2="200" y2="50" stroke="var(--ink-soft)"/>
    <line x1="136" y1="121" x2="200" y2="121" stroke="var(--ink-soft)"/>
    <line x1="136" y1="132" x2="200" y2="196" stroke="var(--ink-soft)"/>
    <rect x="200" y="28" width="190" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="295" y="46" text-anchor="middle" fill="var(--ink)">Spring AI / LangChain4j</text>
    <text x="295" y="62" text-anchor="middle" fill="var(--ink-soft)">运行时异常 → 消息</text>
    <rect x="200" y="99" width="190" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="295" y="117" text-anchor="middle" fill="var(--ink)">Eino 默认</text>
    <text x="295" y="133" text-anchor="middle" fill="var(--ink-soft)">返回 error</text>
    <rect x="200" y="174" width="190" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="295" y="192" text-anchor="middle" fill="var(--ink)">Eino + ErrorHandler</text>
    <text x="295" y="208" text-anchor="middle" fill="var(--ink-soft)">error → 一段文字</text>
    <line x1="390" y1="50" x2="450" y2="80" stroke="var(--mem)"/>
    <line x1="390" y1="196" x2="450" y2="100" stroke="var(--mem)"/>
    <rect x="450" y="66" width="174" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="537" y="86" text-anchor="middle" fill="var(--ink)">模型读到错误</text>
    <text x="537" y="102" text-anchor="middle" fill="var(--ink-soft)">换个查法 / 问用户</text>
    <line x1="390" y1="121" x2="450" y2="160" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
    <rect x="450" y="146" width="174" height="48" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="537" y="166" text-anchor="middle" fill="var(--ink)">整次运行失败</text>
    <text x="537" y="182" text-anchor="middle" fill="var(--ink-soft)">event.Err,用户看到 500</text>
  </g>
</svg>
<figcaption>同一个「查不到客户」,三条路。琥珀色是工具侧,蓝色是模型侧。从 Java 或 Python 迁到 Go 时,中间那条虚线最容易被忽略。</figcaption>
</figure>

三个版本放在一起:

| | Spring AI 2.0.1 | LangChain4j 1.22.0 | Eino v0.9.22 |
| --- | --- | --- | --- |
| Agent 的写法 | ChatClient 链式调用 | 接口 + AiServices 代理 | ChatModelAgent + Runner |
| 工具声明 | `@Tool(description=)` | `@Tool(value=)` + `@P` | `InferTool` + 结构体 tag |
| 工具出错默认 | 运行时异常消息回模型 | 异常消息回模型(计划改) | 整次运行失败 |
| 循环上限 | 工具调用总次数,默认 150 | 来回次数,默认 100 | 模型轮数,默认 20 |
| 拿到中间过程 | DEBUG 日志 | `Result.toolExecutions()` | 事件迭代器,逐条拿 |
| 实测用时(默认问题) | 9.3s | 4.2s | 2.9s |

用时只是我这台机器、这一天的几次实测,换网络和时段会变,别当基准测试看。

## 第六步:Google ADK,Go 和 Java 也有

Google 的 ADK(Agent Development Kit)有 Python、Java、Go、TypeScript 四个版本,版本号各自独立:Go 版模块路径是 `google.golang.org/adk/v2`,我查的时候最新是 v2.6.0(2026-10-13);Java 版在 Maven Central 上是 `com.google.adk:google-adk` 1.13.0(10-21)。2.0 最大的变化是加了 Workflow Runtime,把 Agent 运行变成一个图执行引擎,思路和 LangGraph 越来越像。

ADK 是围绕 Gemini 设计的,文档和示例默认都是 Gemini 和 Vertex AI。不过 [官方文档](https://adk.dev/agents/models/openai/) 写着 Go 版从 v2.1.0 起有一个**实验性**的 `openaimodel` 包,默认走 OpenAI 的 Responses API,v2.5.0 起可以通过 `ClientConfig.API: openaimodel.APIChatCompletions` 改走 Chat Completions,再配上 `BaseURL`,理论上就能接 DeepSeek 这类兼容厂商。我读了 v2.6.0 里 `examples/openai/completions/main.go` 这个官方示例,写法是 `llmagent.New` 建 Agent、`functiontool.New` 建工具,结构和 Eino 很像。今天我没有实跑它,因为示例走的是 ADK 自带的命令行启动器,要另讲一套东西;这个包又标着实验性,可能改。选型时把它当成一个信号就够了:**Go 和 Java 也有大厂官方维护的 Agent 框架**,如果你们在 Google Cloud 上、主力模型是 Gemini,ADK 会很顺手。

## 第七步:什么时候全用 Java/Go,什么时候拆服务

回到这两天真正的问题:公司的业务系统是 Java 或 Go,Agent 怎么接?我在真实团队里见过三种做法:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="Java 或 Go 公司接入 Agent 的三种方式:拆出 Python Agent 服务、在 Spring Boot 里内嵌 Spring AI 或 LangChain4j、在 Go 服务里内嵌 Eino">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <text x="20" y="26" fill="var(--ink)">A 拆服务</text>
    <rect x="20" y="38" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="60" fill="var(--ink)">Java 订单系统</text>
    <text x="32" y="80" font-size="11" fill="var(--ink-soft)">业务、权限、审批</text>
    <rect x="250" y="38" width="180" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="262" y="60" fill="var(--ink)">Python Agent 服务</text>
    <text x="262" y="80" font-size="11" fill="var(--ink-soft)">循环 + 评测</text>
    <line x1="200" y1="58" x2="250" y2="58" stroke="var(--ink-soft)"/>
    <text x="206" y="52" font-size="10" fill="var(--ink-faint)">HTTP</text>
    <line x1="250" y1="76" x2="200" y2="76" stroke="var(--ink-soft)" stroke-dasharray="3 3"/>
    <text x="206" y="90" font-size="10" fill="var(--ink-faint)">MCP</text>
    <text x="20" y="130" fill="var(--ink)">B 内嵌 Java</text>
    <rect x="20" y="142" width="410" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="168" fill="var(--ink)">Spring Boot 应用</text>
    <rect x="200" y="150" width="220" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="212" y="169" font-size="11" fill="var(--ink)">Spring AI / LangChain4j</text>
    <text x="20" y="214" fill="var(--ink)">C 内嵌 Go</text>
    <rect x="20" y="222" width="410" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="242" fill="var(--ink)">Go 微服务</text>
    <rect x="200" y="226" width="220" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="212" y="241" font-size="11" fill="var(--ink)">Eino / ADK Go</text>
    <text x="460" y="60" font-size="11" fill="var(--ink-soft)">评测、实验最快</text>
    <text x="460" y="78" font-size="11" fill="var(--ink-soft)">多一个服务要运维</text>
    <text x="460" y="164" font-size="11" fill="var(--ink-soft)">事务、权限、监控</text>
    <text x="460" y="180" font-size="11" fill="var(--ink-soft)">直接复用</text>
    <text x="460" y="242" font-size="11" fill="var(--ink-soft)">框架还在 0.x</text>
  </g>
</svg>
<figcaption>蓝色是 Agent 逻辑,琥珀色是业务系统。三种接法的差别是 Agent 逻辑放在哪个进程、用什么语言写。A 里的虚线是 MCP:业务系统把能力包成 MCP server,Agent 服务来调。</figcaption>
</figure>

**A. 拆一个 Python Agent 服务。** Agent 逻辑用 Python 写,独立部署;Java 系统通过 HTTP 调它,或者反过来,Java 系统把查订单、发起退款这些能力包成 MCP server(第五部分学的),让 Agent 来调。好处是评测和实验工具链最全:第六部分那一整套评测、Langfuse、LangGraph 的 checkpoint 全在 Python 这边,换模型、改提示词、跑回归都快;Agent 组和业务组的边界也清楚。代价是多一个服务要部署和值班,跨服务的 trace 要打通,一次请求要过两个进程。

**B. 在 Spring Boot 里内嵌 Spring AI 或 LangChain4j。** 适合 Agent 只是业务系统里的一个功能,比如订单详情页上一个「帮我看看这笔账」的按钮。工具直接调本地的 Service 方法,数据库事务、权限检查、审计日志全部复用,不用为 Agent 再搭一套。代价是评测和实验没 Python 方便,得自己补;团队里懂 Agent 的人要懂 Java。

**C. 在 Go 服务里内嵌 Eino。** 逻辑和 B 一样,只是换成 Go。额外的代价是 Eino 还在 0.x,升级要留出改代码的时间;今天也看到了,错误处理的默认行为和 Python 习惯不同,要专门写进团队规范。

我的判断规则就两条。第一条:**Agent 是不是产品的核心、需不需要频繁迭代。** 是核心、每周都要看错误分析、改提示词、跑回归的,选 A,让 Agent 逻辑待在评测工具最好的地方;只是业务里的一个辅助功能、几个月才改一次的,选 B 或 C,少一个服务就少一份运维。第二条经常被忽略:**谁值班。** Agent 半夜出问题,值班的如果是 Java 组,那 Agent 代码最好也写在他们看得懂的语言里。

还有一个常见的折中:Agent 循环放在 Java 里(B),但评测集和打分脚本放在 Python 里,通过 HTTP 调 Java 服务的接口来跑评测。这样业务团队不用学 Python,评测又能用上现成的工具。

面试被问到这个问题,别只说「Python 生态好」。能说出数据库事务、权限复用、跨服务 trace、值班归属这些具体的东西,再加一句「我实测过三个框架的工具出错行为不一样」,面试官就知道你真的动过手。

## 动手练习

### 练习 1:把两个框架的循环上限都调到 1

LangChain4j 把 `maxSequentialToolsInvocations(6)` 改成 1,Eino 把 `MaxIterations: 6` 改成 1,各跑一次默认问题。记录:超限时工具执行了几次、程序是正常结束还是报错、报错原文是什么。再和昨天 Spring AI 的结果放进一张三行的表。

<details><summary>参考答案</summary>

LangChain4j:把 `Main.java` 里那一行改成 `.maxSequentialToolsInvocations(1)`,然后 `mvn -q compile exec:java`:

```text
[工具] find_customer(query=user007@example.com)
[ERROR] Failed to execute goal org.codehaus.mojo:exec-maven-plugin:3.6.4:java (default-cli) on project ledger-langchain4j: An exception occurred while executing the Java class. Something is wrong, exceeded 1 tool calling round trips (maxToolCallingRoundTrips) -> [Help 1]
```

Eino:把 `main.go` 里改成 `MaxIterations: 1,`,然后 `go run .`:

```text
[模型要调] find_customer {"query": "user007@example.com"}
我先查一下这位客户的编号。
这一轮:输入 442 / 输出 48 token
[工具结果] [{"id":"C007","name":"刘静","email":"user007@example.com","company":"半岛咖啡"}]
2026/10/22 19:02:47 运行出错:[NodeRunError] run node[ChatModel] pre processor fail: exceeds max iterations
------------------------
node path: [node_1, ChatModel]
exit status 1
```

| 框架 | 超限前执行了几次工具 | 超限后 | 原文 |
| --- | --- | --- | --- |
| Spring AI(Day 430,`max-total-tool-calls=1`) | 1 | 正常返回,内容是框架的英文提示 | `Total tool call limit (1) exceeded for this turn.` |
| LangChain4j(`maxSequentialToolsInvocations(1)`) | 1 | 抛异常,`ask()` 没有返回值 | `exceeded 1 tool calling round trips (maxToolCallingRoundTrips)` |
| Eino(`MaxIterations: 1`) | 1 | `event.Err` 报错 | `exceeds max iterations` |

三个框架都只让第一个工具跑完。区别在超限之后:Spring AI 默认给你一个「看起来正常」的回复,另外两个直接报错。报错的好处是不会把半截结果当成答案,坏处是你的代码必须接住它,给用户一句人话。练习完把两处都改回 6。

</details>

### 练习 2:给 LangChain4j 版加上对话记忆

现在每次 `ask()` 都是全新的对话。请给 `AiServices` 加上记忆,让下面两句连着问能答对:先问「user007@example.com 是哪家公司的?」,再问「那他们最近三张发票都付了吗?」。提示:LangChain4j 的 `MessageWindowChatMemory` 保留最近 N 条消息,builder 上用 `.chatMemory(...)` 挂上去。

<details><summary>参考答案</summary>

把 `main` 方法换成下面这样(工具类不动),另存为 `MemoryMain.java`,类名 `MemoryMain`:

```java
// agent-zero-lab/part07/java_go/langchain4j/src/main/java/dev/agentzero/ledger/MemoryMain.java
package dev.agentzero.ledger;

import java.util.Map;

import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.service.AiServices;

public class MemoryMain {

    public static void main(String[] args) {
        OpenAiChatModel model = OpenAiChatModel.builder()
                .baseUrl(System.getenv("LLM_BASE_URL"))
                .apiKey(System.getenv("LLM_API_KEY"))
                .modelName(System.getenv("LLM_MODEL"))
                .temperature(0.0)
                .customParameters(Map.of("thinking", Map.of("type", "disabled")))
                .build();

        Main.LedgerAssistant assistant = AiServices.builder(Main.LedgerAssistant.class)
                .chatModel(model)
                .tools(new Main.LedgerTools(System.getenv("LEDGER_DB")))
                .chatMemory(MessageWindowChatMemory.withMaxMessages(20))
                .maxSequentialToolsInvocations(6)
                .build();

        for (String q : new String[] {"user007@example.com 是哪家公司的?", "那他们最近三张发票都付了吗?"}) {
            System.out.println("用户:" + q);
            var result = assistant.ask(q);
            System.out.println("助手:" + result.content());
            System.out.println("本轮输入 token:" + result.tokenUsage().inputTokenCount());
        }
    }
}
```

<div class="line-notes">

- `import dev.langchain4j.memory.chat.MessageWindowChatMemory;` 「滑动窗口」记忆:只保留最近 N 条消息,超出的丢掉最早的。和 [Day 464](/blog/agent-zero/day-464-memory-session/) 会讲的会话记忆是一类东西,今天先用最简单的。
- `Main.LedgerAssistant assistant = AiServices.builder(Main.LedgerAssistant.class)` 复用 `Main` 里的接口和工具类。它们没写 `private`,同一个包里能直接用。
- `.chatMemory(MessageWindowChatMemory.withMaxMessages(20))` 挂上记忆。之后每次 `ask()`,框架会把记忆里的历史消息(包括工具调用和工具结果)一起发给模型,再把这一轮的新消息存进去。20 条对两轮对话足够了。
- `for (String q : new String[] {"user007@example.com 是哪家公司的?", "那他们最近三张发票都付了吗?"}) {` 依次问两句。第二句里的「他们」只有记得上一轮才知道指谁。
- `System.out.println("本轮输入 token:" + result.tokenUsage().inputTokenCount());` 打印每轮的输入 token,看记忆让请求变大了多少。

</div>

```bash
mvn -q compile exec:java -Dexec.mainClass=dev.agentzero.ledger.MemoryMain
```

```text
用户:user007@example.com 是哪家公司的?
[工具] find_customer(query=user007@example.com)
助手:user007@example.com 对应的是客户 **刘静**，所属公司为 **半岛咖啡**（客户编号 C007）。

需要我帮您查一下该客户的发票情况吗？
本轮输入 token:927
用户:那他们最近三张发票都付了吗?
[工具] list_invoices(customerId=C007, status=null)
助手:半岛咖啡（刘静，C007）最近三张发票情况如下：

| 发票号 | 金额 | 开票日期 | 状态 |
|---|---|---|---|
| INV-2026-0123 | 2392 元 | 2026-10-08 | 已付 |
| INV-2026-0098 | 2392 元 | 2026-09-08 | 已付 |
| INV-2026-0071 | 2392 元 | 2026-08-08 | **未付** |

结论：**并非全部付清**。最近两张（9 月、10 月）已付款，但 8 月 8 日开出的 INV-2026-0071（2392 元）仍为未付状态。需要我帮您进一步处理这张未付发票吗？
本轮输入 token:1264
```

第二问只出现了一行 `[工具] list_invoices(customerId=C007, ...)`,模型从记忆里拿到了 C007,没有再查一次客户。代价是输入 token:第二轮 1264,里面包含了第一轮的问题、工具调用、工具结果和回答。

对照一下,把 `.chatMemory(...)` 那一行删掉(我另存成 `NoMemoryMain` 跑的)再问同样两句:

```text
用户:user007@example.com 是哪家公司的?
[工具] find_customer(query=user007@example.com)
助手:user007@example.com 对应的是 **半岛咖啡**，联系人刘静，客户编号 C007。
本轮输入 token:927
用户:那他们最近三张发票都付了吗?
助手:我需要先确认您指的是哪位客户。您能提供一下客户的邮箱、姓名、公司名或客户编号吗?

（另外，如果这是接着之前的对话，我这边没有看到上文信息，麻烦您再说明一下客户是谁。）
本轮输入 token:424
```

没有记忆时第二问只有 424 个输入 token,但模型不知道「他们」是谁。记忆让第二轮从 424 涨到 1264,多出来的 840 个 token 就是「记住上文」的价格,对话越长涨得越多,这也是第四部分讲上下文压缩的原因。

</details>

### 练习 3:只把业务错误给模型看

第五步里,`WrapToolWithErrorHandler` 把 `err.Error()` 原样给了模型,里面混着 `[LocalFunc] failed to invoke tool` 这种框架内部信息;如果是数据库报错,还可能带出文件路径和表名。请改成:定义一个 `BizError` 类型表示「写给模型看的业务错误」,处理函数只把 `BizError` 的消息交给模型,其他错误只写日志,给模型一句通用的「系统暂时查不到」。提示:Go 用 `errors.As` 从一串被包过的 error 里找出某种类型。

<details><summary>参考答案</summary>

复制一份到 `eino-ex/` 目录改,原版留着对比:

```bash
cd ~/agent-zero-lab/part07/java_go
mkdir eino-ex && cp eino/go.mod eino/go.sum eino/main.go eino-ex/
cd eino-ex && sed -i '' 's#example.com/ledger-eino#example.com/ledger-eino-ex#' go.mod
```

新建一个文件放错误类型和处理函数(同一个目录、同一个 `package main` 的文件会一起编译):

```go
// agent-zero-lab/part07/java_go/eino-ex/errors.go
package main

import (
	"context"
	"errors"
	"log"
)

// BizError 是「写给模型看」的业务错误,其余错误一律不外传。
type BizError struct{ Msg string }

func (e *BizError) Error() string { return e.Msg }

func toolErrorText(_ context.Context, err error) string {
	var biz *BizError
	if errors.As(err, &biz) {
		return "出错:" + biz.Msg
	}
	log.Printf("工具内部错误(不发给模型):%v", err)
	return "出错:系统暂时查不到,请稍后再试。"
}
```

<div class="line-notes">

- `type BizError struct{ Msg string }` 一个只有一个字段的结构体。
- `func (e *BizError) Error() string { return e.Msg }` 给 `BizError` 挂一个 `Error()` 方法。Go 里任何有 `Error() string` 方法的类型都自动算作 error,不用声明「实现了某接口」。这叫隐式接口,有点像 TS 的结构类型:形状对上就行。
- `var biz *BizError` 准备一个空的 `*BizError` 变量,等着 `errors.As` 往里填。
- `if errors.As(err, &biz) {` Eino 把我们的 error 包了一层(`[LocalFunc] failed to invoke tool, ... err=...`),`errors.As` 会一层层剥开,找到第一个 `*BizError` 就填进 `biz` 并返回 true。相当于 JS 里 `if (err.cause instanceof BizError)`,只是它会一直往里找。
- `return "出错:" + biz.Msg` 业务错误:只给模型看我们自己写的那句话,框架加的前缀不要。
- `log.Printf("工具内部错误(不发给模型):%v", err)` 其他错误(数据库坏了、SQL 写错)完整写日志给开发者看。
- `return "出错:系统暂时查不到,请稍后再试。"` 给模型一句不带任何内部细节的话。

</div>

`main.go` 改三处:两个 `fmt.Errorf(...)` 换成 `&BizError{Msg: fmt.Sprintf(...)}`,包装那里换成新函数:

```go
				return nil, &BizError{Msg: fmt.Sprintf("没找到和「%s」匹配的客户。换成邮箱、姓名或公司名再试。", in.Query)}
				return nil, &BizError{Msg: fmt.Sprintf("客户 %s 没有发票记录。确认编号是否来自 find_customer 的结果。", in.CustomerID)}
			tools[i] = utils.WrapToolWithErrorHandler(t, toolErrorText)
```

<div class="line-notes">

- `return nil, &BizError{Msg: fmt.Sprintf("没找到和「%s」` `fmt.Sprintf` 和 `fmt.Errorf` 的格式化写法一样,只是返回字符串。`&BizError{...}` 造一个结构体并取它的指针,因为 `Error()` 方法挂在指针类型上。
- `return nil, &BizError{Msg: fmt.Sprintf("客户 %s 没有发票记录。` `list_invoices` 里那处同样改。数据库查询出错的那几个 `return nil, err` 不改,它们不是业务错误。
- `tools[i] = utils.WrapToolWithErrorHandler(t, toolErrorText)` 处理函数从匿名函数换成 `errors.go` 里的具名函数,签名一样。

</div>

先测业务错误:

```bash
cd ~/agent-zero-lab && source part07/java_go/env.sh && cd part07/java_go/eino-ex
go run . "user999@example.com 有没有没付的发票?"
```

```text
[模型要调] find_customer {"query": "user999@example.com"}
我先查一下这位客户的资料。
这一轮:输入 438 / 输出 48 token
[工具结果] 出错:没找到和「user999@example.com」匹配的客户。换成邮箱、姓名或公司名再试。
没有查到与 user999@example.com 匹配的客户，因此无法查询发票。

请确认一下邮箱是否写对了，或者提供客户的姓名、公司名或客户编号（如 C007），我再帮您查。
这一轮:输入 523 / 输出 46 token
总用时 1.5s
```

工具结果里只剩我们写的那句话,`[LocalFunc]` 前缀没了,输入 token 也从 540 降到 523。

再测非业务错误:故意把 `LEDGER_DB` 指到一个不是数据库的文件(用 `go.mod` 冒充):

```bash
LEDGER_DB=$PWD/go.mod go run . "C007 的发票"
```

```text
[模型要调] list_invoices {"customer_id": "C007"}
2026/10/22 19:14:54 工具内部错误(不发给模型):[LocalFunc] failed to invoke tool, toolName=list_invoices, err=file is not a database (26)
[工具结果] 出错:系统暂时查不到,请稍后再试。
[模型要调] list_invoices {"customer_id": "C007"}
查询时系统报错了，我先重试一次。
这一轮:输入 494 / 输出 50 token
2026/10/22 19:14:55 工具内部错误(不发给模型):[LocalFunc] failed to invoke tool, toolName=list_invoices, err=file is not a database (26)
[工具结果] 出错:系统暂时查不到,请稍后再试。
抱歉，C007 的发票暂时查不到——发票系统连续两次返回「系统暂时查不到，请稍后再试」的错误，我这边无法确认具体数据。

建议您稍后再让我查一次。如果比较急，也可以提供一下客户邮箱或公司名，我换个方式核实客户信息后再试。
这一轮:输入 567 / 输出 66 token
总用时 3.1s
```

日志里有完整的 `file is not a database (26)`,模型只看到通用的那句。还有一个意外收获:模型看到「请稍后再试」就自己重试了一次,第二次还是失败才放弃。这种重试对网络抖动有用,对「数据库文件坏了」没用,只会白花一轮钱。要不要让模型重试,可以靠这句话的措辞控制,比如写成「系统故障,不要重试,请告知用户稍后再来」。

</details>

**验收标准**:LangChain4j 版和 Eino 版都跑通,默认问题回答里有 INV-2026-0071 和 2392 元;能复现 `arg0` 和「Eino 工具出错整次失败」这两个现象;能不看文章画出第七步那张三种接法的图,并各说出一个代价。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| LangChain4j | 独立的 Java LLM 框架,和 Python LangChain 没有隶属关系,核心是 AiServices |
| AiServices | LangChain4j 用动态代理把一个 Java 接口变成 Agent 的机制,调接口方法就跑一次工具循环 |
| 接口(interface) | Java 里只声明方法、不写实现的类型,相当于 TS 的 interface 加上「必须有人实现」 |
| 动态代理 | 运行时生成一个实现某接口的对象,拦下每次方法调用做别的事,类似 JS 的 Proxy |
| @P | LangChain4j 给工具参数写描述的注解 |
| `-parameters` | javac 编译选项,把方法参数名保留到运行时;不开时反射只能拿到 arg0、arg1 |
| SLF4J | Java 通用的日志接口,库只依赖它,具体输出由你加的实现决定 |
| Go | Google 的编译型语言,语法简单,国内后端常用 |
| go.mod / go.sum | Go 的依赖清单和校验文件,相当于 package.json 和 package-lock.json |
| struct tag | Go 结构体字段后反引号里的元数据,如 `json:"id"`,给库读取 |
| `err != nil` | Go 的错误处理:错误是普通返回值,每次调用后检查 |
| defer | Go 里「函数返回时再执行」的语句,常用来关闭资源 |
| context | Go 在调用链里传递截止时间和取消信号的对象 |
| Eino | 字节跳动 CloudWeGo 的 Go 语言 LLM 应用框架 |
| ChatModelAgent | Eino adk 包里「模型 + 工具 + 循环」的现成 Agent |
| Runner | Eino 里驱动 Agent 运行、把过程作为事件流交出来的组件 |
| InferTool | Eino 从 Go 函数的输入输出结构体推导工具 schema 的辅助函数 |
| WrapToolWithErrorHandler | Eino 把工具返回的 error 转成文字交给模型的包装函数 |
| errors.As | Go 从被层层包装的 error 里找出某种类型的函数 |
| Google ADK | Google 的 Agent Development Kit,有 Python/Java/Go/TS 版本,围绕 Gemini 设计 |

## 常见误区

**以为 LangChain4j 是 LangChain 的 Java 官方版。** 它是独立的社区项目,API、版本节奏、文档都和 Python LangChain 不一样。简历上写 LangChain4j,别写「LangChain(Java)」。

**从 Spring AI 抄注解到 LangChain4j。** 两边都叫 `@Tool`,Spring AI 的描述写在 `description`,LangChain4j 写在 `value`,参数注解一个叫 `@ToolParam` 一个叫 `@P`,包名也不同。抄混了编译会报找不到属性。

**纯 Maven 项目忘了开 `-parameters`。** 不报错,参数名变成 `arg0`,模型调用准确率悄悄变差。我们实测 `find_customer -> [arg0]`。

**把 exec 插件的主类写死在 `<configuration>` 里。** 写死以后命令行 `-Dexec.mainClass=...` 不生效,永远跑同一个类。写成 `<properties>` 里的 `exec.mainClass` 属性,命令行才能覆盖。

**在 Go 里用 error 表示「查不到」。** Eino 默认把工具返回的 error 当成运行失败,实测 `[NodeRunError] failed to invoke tool`,模型看不到那句提示。用 `WrapToolWithErrorHandler`,或者把业务结果写进返回值。

**`WrapToolWithErrorHandler` 里直接返回 `err.Error()`。** 这串文字已经被框架包了一层 `[LocalFunc] failed to invoke tool...`,数据库错误还会带上内部细节。用 `errors.As` 区分业务错误和系统错误,只把前者给模型看。

**Eino 不锁版本。** 0.x 阶段小版本也会改签名,网上的教程(包括这篇)对不上时先看 go.mod 里的版本。另外 sonic 这类依赖会落后于 Go 新版本,我们在 1.27.3 上实测它退回了 `encoding/json`。

**以为三个框架的「循环上限」是一回事。** Spring AI 数工具调用次数(默认 150),LangChain4j 数来回次数(默认 100),Eino 数模型轮数(默认 20)。同样设 6,一轮里并行调多个工具时,允许的工具调用次数差很多。

## 学习资料

### 文档与文章

- [LangChain4j 文档 · AI Services](https://docs.langchain4j.dev/tutorials/ai-services):接口怎么写、返回类型 `Result<T>`、`@SystemMessage` 模板、记忆怎么挂。第一步和练习 2 的出处,30 分钟。
- [LangChain4j 文档 · Tools](https://docs.langchain4j.dev/tutorials/tools):`@Tool`、`@P`,重点读错误处理那一节,`toolExecutionErrorHandler` 的几个内置选项和「默认行为将要改变」的说明。
- [Eino 文档 · ADK ChatModelAgent](https://www.cloudwego.io/docs/eino/core_modules/eino_adk/agent_implementation/chat_model/):中文,`ChatModelAgentConfig` 各字段的说明。版本以你 go.mod 里的为准。
- [Eino 快速开始](https://www.cloudwego.io/docs/eino/quick_start/):官方的分章教程目录,想系统学 Eino 从这里开始。
- [A Tour of Go](https://go.dev/tour/):Go 官方的交互式入门,浏览器里就能跑,有中文版。今天第三步只讲了够用的部分,想补全看前三章,1 小时。
- [Go by Example](https://gobyexample.com/):一个知识点一个能跑的小例子,查语法时用。
- [ADK 文档 · OpenAI models](https://adk.dev/agents/models/openai/):ADK Go 接 OpenAI 协议的实验性 `openaimodel` 包,第六步的出处。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HW4y1n7BF&autoplay=0&high_quality=1" title="Go 语言快速入门看这个就够了，仅需 15 分钟！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>峰华前端工程师 · Go 语言快速入门看这个就够了,仅需 15 分钟 · 一个前端工程师讲 Go,视角和我们一样。看完第三步再看,把结构体、切片、多返回值、error 再过一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1auJw6CECD&autoplay=0&high_quality=1" title="【Go语言后端转Agent开发】2026年B站最完整的工程化实战字节大模型Eino框架教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大秦的勤 · Go 语言后端转 Agent 开发:字节 Eino 框架工程化实战 · 2026 年 6 月上传,27 集近 10 小时。不用全看,挑 ChatModel、Tool、Agent 那几集;视频里的 Eino 版本比 v0.9.22 早,API 对不上时以源码为准。</figcaption>
</figure>

- 黑马程序员《LangChain4j 从入门到实战项目全套视频课程》(B 站 BV1sDMqzpEQ3,23 集):2025 年 6 月的课,播放量五十多万。讲 AiServices 和工具的部分概念没变,版本是 1.x 早期,API 细节以文档为准。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/8SrHjaKWuck" title="Building AI agents with LangChain4j's new &quot;Agentic&quot; module" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Microsoft for Java Developers · Building AI agents with LangChain4j's new "Agentic" module · LangChain4j 1.x 新增的 `langchain4j-agentic` 模块,可以编排多个 Agent 做顺序、并行、循环工作流,概念上接近 LangGraph。今天没讲,想知道 Java 这边多 Agent 怎么写时看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 10 章「AI Engineering Architecture and User Feedback」:讲一个 AI 应用的架构怎么一层层长出来(上下文、护栏、路由、缓存、Agent、监控),和语言无关。第七步「拆不拆服务」的判断,放进这张架构图里看会更清楚。
- Alan A. A. Donovan、Brian W. Kernighan《The Go Programming Language》(Addison-Wesley, 2015):Go 的经典教材,中文版《Go 程序设计语言》(机械工业出版社)。语法部分到今天仍然适用,想认真学 Go 读前五章。

### 开源项目与代码

- [cloudwego/eino-examples](https://github.com/cloudwego/eino-examples):`adk/intro/chatmodel/` 是今天 Go 代码的原型;`adk/human-in-the-loop/` 有工具审批的例子,对应 [Day 414](/blog/agent-zero/day-414-approval-design/) 的审批设计。
- [cloudwego/eino](https://github.com/cloudwego/eino):读 `adk/chatmodel.go` 里 `TypedChatModelAgentConfig` 的字段注释,比文档更新得快;`components/tool/utils/error_handler.go` 是第五步那个包装函数,只有几十行。
- [langchain4j/langchain4j](https://github.com/langchain4j/langchain4j):`langchain4j/src/main/java/dev/langchain4j/service/AiServices.java` 是 builder 的全部入口,能看到所有可配的旋钮。
- [google/adk-go](https://github.com/google/adk-go):`examples/openai/completions/` 是第六步提到的那个官方示例,想自己试 ADK Go 接 DeepSeek 从这里开始。

## 自测

1. LangChain4j 的 `LedgerAssistant` 接口没有任何实现类,`assistant.ask(question)` 为什么能跑?调用这一行时背后发生了什么?

<details><summary>答案</summary>

`AiServices.builder(LedgerAssistant.class)...build()` 在运行时用动态代理生成了一个实现这个接口的对象。调用 `ask()` 时,代理拦下调用:读接口方法上的 `@SystemMessage` 作为 system 消息,把参数 `question` 作为 user 消息,带上 `.tools(...)` 里反射扫出的工具定义请求模型;模型要工具就执行对应的 `@Tool` 方法、把结果作为 tool 消息塞回去再请求,直到模型不再要工具或超过 `maxSequentialToolsInvocations`;最后按方法的返回类型 `Result<String>` 把回答、token 用量和工具执行记录包起来返回。

</details>

2. 同一个「查不到客户」,Spring AI 和 LangChain4j 的模型都读到了提示,Eino 默认却整次失败。从语言设计的角度解释为什么会有这个差别。

<details><summary>答案</summary>

Java 有异常机制,框架可以约定「运行时异常 = 工具的一种结果」,catch 住以后把消息当作工具输出;Spring AI 还专门区分了运行时异常(回模型)和受检异常(直接失败)。Go 没有异常,error 是普通返回值,而 Go 的惯例是「error 不为 nil 就是出事了,往上传」,Eino 的工具节点照这个惯例把 error 当成节点失败,沿着图冒到 `event.Err`。框架不替你判断某个 error 是不是「正常的业务结果」,所以要你自己用 `WrapToolWithErrorHandler` 或返回值字段表达。

</details>

3. 第二步里关掉 `-parameters` 之后,程序没有报任何错。为什么说这种问题比报错更危险?

<details><summary>答案</summary>

因为它让系统悄悄变差而不是停下来。参数名变成 `arg0`、`arg1` 后,schema 照样合法,模型照样能调,只是要靠描述猜每个参数的含义;简单工具可能看不出差别,参数一多、描述一模糊,参数传错、传反的比例会上升。评测分数下降时,你会先去怀疑提示词、模型、数据,很难想到是编译配置。报错至少会让你第一时间知道哪里不对。

</details>

4. 三个框架同样把上限设成 6。如果模型每一轮都并行要 3 个工具,三个框架分别最多能执行多少次工具?

<details><summary>答案</summary>

Spring AI 按工具调用总次数计,最多 6 次,也就是两轮(第三轮要的 3 个会触线)。LangChain4j 按来回次数计,每次来回不管调几个工具都算 1 次,最多 6 次来回、18 次工具调用。Eino 按模型轮数计,6 轮里最后一轮通常要用来给回答,工具大约能跑 5 轮、15 次左右;具体在哪一刻判定超限要看源码,但量级远大于 Spring AI 的 6 次。所以「设成 6」在三个框架里意思完全不同,迁移代码时不能照搬数字。

</details>

5. **面试题**:我们是一家用 Go 写后端的公司,要做一个对外的智能客服 Agent,能查订单、发起退款(要主管审批)。你会用 Eino 在现有 Go 服务里做,还是单独起一个 Python Agent 服务?

<details><summary>答案</summary>

先问清楚两件事:客服 Agent 是不是核心产品、要不要频繁迭代;谁维护、谁值班。对外客服通常是核心卖点,要每周看错误分析、跑回归、对比模型,我倾向单独的 Python Agent 服务:评测、trace、LangGraph 的 checkpoint 和审批中断都现成;Go 服务把查订单、发起退款包成内部 API 或 MCP server,退款只能创建待审批记录,审批流和权限仍在 Go 这边,客户身份由网关注入、不让模型填。代价是多一个服务和跨服务 trace,用 OpenTelemetry 串起来。如果团队没有人能维护 Python,或者这个 Agent 只是一个辅助功能,就用 Eino 内嵌:锁死 Eino 版本,所有工具统一用 `WrapToolWithErrorHandler` 并区分业务错误和系统错误,`MaxIterations` 调到个位数,评测集和打分脚本放在 Python 里通过 HTTP 调。两种方案不变的是:审批不交给模型,权限在业务层检查,评测集要先建起来。

</details>

## 明天预告

明天是 Day 432 · 小项目(一):整合代码和上线检查清单。这两周我们一块一块学了生产化的东西:SSE 接口、会话、队列和重试、超时、成本、注入防御、权限和审计、Docker、密钥、CI/CD,还横向看了托管运行时和 Java/Go 框架。明天不学新东西,把散在各天的零件拼成一个能跑的工单 Agent 服务,再按一份「这一项没做,上线第一周会出什么事」排序的清单逐项检查,用一个脚本把能自动检查的项都查一遍。
