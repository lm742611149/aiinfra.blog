---
title: 'Day 41 · 部署上线:Docker、密钥管理、云服务器,以及本地开源模型'
description: '用 uv 写一个小而安全的 Dockerfile,用 Compose 把 API、worker、Postgres、Redis、Caddy 编排在一起;密钥不进镜像不进 git;给国内轻量云和海外平台各一条部署路线,讲清楚备案这道坎;配一个最小的 GitHub Actions 流水线;最后算一算什么时候值得用 Ollama 或 vLLM 自己跑开源模型。'
pubDate: 2026-10-12
regime: none
tags: ['deploy', 'docker', 'compose', 'caddy', 'ci-cd', 'ollama', 'vllm', 'agent-60']
series: 'agent-60'
day: 41
lang: 'zh'
---

## 今天要解决的问题

招聘方看你的项目时,最有说服力的一句话是「这是线上地址,你可以现在就试」。一个只能在作者笔记本上跑的 Agent,和一个任何人点开链接就能用的 Agent,在面试官眼里差别很大。站长整理的 305 条 AI Agent 岗位 JD 里,提到部署、Docker、K8s 或云的,国内占 41%,海外 53%,新加坡和香港更是高达 73%。

今天结束时你应该能:

1. 写出一个用 uv 管依赖、非 root 运行、分层缓存合理的 Dockerfile。
2. 写一个 Compose 文件,一条命令拉起 API、worker、Postgres、Redis 和带自动 HTTPS 的 Caddy,并且数据库迁移自动执行。
3. 管好密钥:不进镜像、不进 git、能轮换,知道到了 K8s 环境对应的做法。
4. 选一条部署路线把服务放上公网:国内轻量云(以及备案问题)或海外平台/海外 VPS。
5. 配一个最小的 CI/CD:推代码自动跑测试、构建镜像、部署。
6. 用 Ollama 在本机跑一个开源模型,接进同一套代码;能用算式说明什么时候自部署模型划算。

预计用时 5–7 小时(第一次买服务器、配域名会花些时间)。前置:Day 36–40 的全部代码。

## Dockerfile:小、快、不用 root

先看完整的文件,再逐段解释:

```dockerfile
# agent-60-lab/Dockerfile
FROM python:3.12-slim-trixie AS base

# uv 官方文档推荐的安装方式:从官方镜像复制二进制,并钉住版本
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /uvx /bin/

ENV UV_NO_DEV=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

# 第一层:只装依赖。pyproject.toml 和 uv.lock 不变,这一层就走缓存
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-install-project

# 第二层:复制代码。改代码只会让这一层重建,几秒钟
COPY . .
RUN uv sync --locked

# 非 root 用户运行
RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"

CMD ["uvicorn", "w6.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
```

配一个 `.dockerignore`,这一步经常被忘,忘了的后果是本地的 `.venv`、`.env` 甚至 `.git` 被打进镜像:

```text
# agent-60-lab/.dockerignore
.venv
.env
.env.*
.git
__pycache__
*.pyc
evals/results
data/raw
```

几处要说明的地方。

依赖和代码分两层复制,是 Docker 构建提速的基本功。依赖一个月改不了几次,代码每天都改。如果 `COPY . .` 写在 `uv sync` 前面,每改一行代码都要重新下载安装全部依赖,在国内网络下一次可能要好几分钟。

uv 的版本钉死在 `0.13.0`。这是 uv 官方 Docker 指南推荐的做法,我写这篇时文档里给的示例版本就是这个,你学到这里时去 uv 的 GitHub releases 看一眼当前版本再改。不钉版本的话,某天 uv 发了一个行为变化的新版本,你的构建会莫名其妙地挂。

`HEALTHCHECK` 需要一个 `/healthz` 接口,Day 36 的代码里没有,加上:

```python
# agent-60-lab/w6/app/main.py(追加)
@app.get("/healthz")
async def healthz():
    async with app.state.sessions.pool.connection() as conn:
        await conn.execute("SELECT 1")
    return {"ok": True}
```

健康检查连一下数据库,而不是只返回 200。只返回 200 的健康检查会在数据库挂掉时依然报告「健康」,这就失去了它的意义。但也不要在健康检查里调模型 API,那样每 30 秒烧一次钱,而且模型 API 偶尔慢一下就会让容器被判定为不健康。

`--proxy-headers` 是因为服务会跑在 Caddy 后面。不加的话,应用拿到的客户端 IP 全是 Caddy 的内网地址,限流和审计日志里的 IP 就都错了。

在国内构建镜像,`pip` 和 `docker pull` 都可能很慢。uv 可以通过环境变量 `UV_DEFAULT_INDEX` 换成国内 PyPI 镜像(清华、阿里云都有),Docker Hub 的拉取速度问题在国内一直存在,各云厂商都提供镜像加速服务,买了服务器以后在控制台里能找到。

## Compose:一条命令拉起整个系统

```yaml
# agent-60-lab/compose.yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: agent
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d agent"]
      interval: 5s
      retries: 10
    restart: unless-stopped
    # 不映射端口到宿主机:只有同一网络里的容器能访问

  redis:
    image: redis:7
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    restart: unless-stopped

  migrate:
    image: postgres:17
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      PGPASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./w6/sql:/sql:ro
    entrypoint: ["sh", "-c", "for f in /sql/*.sql; do echo \"== $$f\"; psql -h postgres -U postgres -d agent -v ON_ERROR_STOP=1 -f $$f || exit 1; done"]
    restart: "no"

  api:
    build: .
    env_file: .env
    environment:
      DATABASE_URL: postgresql://agent_writer:${AGENT_WRITER_PASSWORD}@postgres:5432/agent
      REDIS_URL: redis://redis:6379
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_started }
    restart: unless-stopped

  worker:
    build: .
    command: ["arq", "w6.app.jobs.WorkerSettings"]
    env_file: .env
    environment:
      DATABASE_URL: postgresql://agent_writer:${AGENT_WRITER_PASSWORD}@postgres:5432/agent
      REDIS_URL: redis://redis:6379
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_started }
    restart: unless-stopped
    stop_grace_period: 60s   # 给正在跑的任务留时间收尾(Day 37)

  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
    depends_on: [api]
    restart: unless-stopped

volumes:
  pgdata:
  redisdata:
  caddydata:
```

`migrate` 是一个跑完就退出的一次性服务。它等 Postgres 健康后,按文件名顺序执行 `w6/sql/` 下的全部 SQL 文件。`api` 和 `worker` 等它成功退出后才启动。这样数据库结构永远在应用启动之前就绪。我们这几天写的 SQL 都带了 `IF NOT EXISTS`,重复执行是安全的;Day 40 建角色的那个文件要改成幂等的写法(先判断角色是否存在),否则第二次部署时 `CREATE ROLE` 会报错退出。正式项目里迁移会交给 Alembic 这类工具,它会记录哪些迁移执行过,但概念是一样的。

`$$f` 是 Compose 文件里转义美元符号的写法,否则 Compose 会把 `$f` 当成它自己的变量去替换。

Postgres 和 Redis 都没有映射端口到宿主机。它们只在 Compose 创建的内部网络里可见,公网扫不到。我见过不少个人项目把 Postgres 的 5432 映射出去、密码还是 `postgres`,上线几小时就被勒索脚本清库。**对外只开 80 和 443**。

API 用的是 Day 40 建的 `agent_writer` 账号,不是超级用户。

### Caddy:三行配置拿到 HTTPS

```text
# agent-60-lab/deploy/Caddyfile
support.your-domain.com {
	reverse_proxy api:8000
}
```

就这样。Caddy 会自动向 Let's Encrypt 申请证书、自动续期、自动把 HTTP 跳转到 HTTPS。前提是这个域名已经解析到你服务器的公网 IP,而且 80 和 443 端口在云厂商的安全组里放行了。

Day 36 担心过代理缓冲会让流式输出变成一次性返回。Caddy 的文档写明:响应的 `Content-Type` 是 `text/event-stream` 时,它会忽略缓冲设置、每次写入后立即刷新给客户端。所以用 Caddy 做反向代理,SSE 不需要任何额外配置。如果你用 Nginx,则要记得 `proxy_buffering off` 和足够长的 `proxy_read_timeout`。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="单机部署拓扑:公网只能访问 Caddy 的 80 和 443 端口,Caddy 转发给 API,API 和 worker 访问内部网络里的 Postgres 和 Redis,并调用外部的模型 API">
<rect x="10" y="100" width="90" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="55" y="130" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">用户</text>
<rect x="130" y="20" width="490" height="220" rx="8" fill="none" stroke="var(--rule)" stroke-dasharray="6 4"/>
<text x="140" y="38" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">云服务器 · Docker Compose 内部网络</text>
<rect x="150" y="100" width="90" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<text x="195" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Caddy</text>
<text x="195" y="139" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">:443</text>
<rect x="280" y="70" width="100" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="330" y="97" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">api</text>
<rect x="280" y="140" width="100" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="330" y="167" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">worker</text>
<rect x="430" y="60" width="110" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="485" y="87" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">postgres</text>
<rect x="430" y="120" width="110" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="485" y="147" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">redis</text>
<rect x="430" y="180" width="110" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="485" y="207" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">migrate(跑完退出)</text>
<line x1="100" y1="125" x2="150" y2="125" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="240" y1="120" x2="280" y2="95" stroke="var(--ink-soft)"/>
<line x1="380" y1="90" x2="430" y2="82" stroke="var(--ink-soft)"/>
<line x1="380" y1="100" x2="430" y2="140" stroke="var(--ink-soft)"/>
<line x1="380" y1="160" x2="430" y2="90" stroke="var(--ink-soft)"/>
<line x1="380" y1="165" x2="430" y2="145" stroke="var(--ink-soft)"/>
<rect x="545" y="236" width="90" height="0" fill="none"/>
<text x="560" y="253" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">→ 模型 API</text>
<line x1="380" y1="175" x2="560" y2="245" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="10" y="180" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">公网只开</text>
<text x="10" y="196" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">80 / 443</text>
</svg>
<figcaption>单机部署的拓扑。公网能碰到的只有 Caddy,数据库和 Redis 只在内部网络可见。worker 和 api 是同一个镜像,只是启动命令不同。</figcaption>
</figure>

## 密钥管理

整个系统里需要保密的东西有:模型 API key、embedding API key、数据库的几个密码、Langfuse 的密钥、邮件服务的 key、Day 40 的 E2B key(如果用了)。规则只有三条:

**不进 git。** `.env` 写进 `.gitignore`,另外提交一个 `.env.example`,列出所有变量名但值留空或写占位符。新人照着它填。如果你不小心把 key 提交过,删掉文件再提交是没用的,它还在 git 历史里。正确的做法是立刻去厂商后台作废这个 key,换一个新的。GitHub 会扫描公开仓库里的常见密钥格式并通知厂商,很多厂商会自动吊销,但不要指望这个。

**不进镜像。** 不要在 Dockerfile 里写 `ENV LLM_API_KEY=...`,也不要 `COPY .env`。镜像会被推到镜像仓库,任何能拉镜像的人都能用 `docker history` 或解包看到。`.dockerignore` 里排除 `.env` 就是为了这个。

**能轮换。** 假设每个 key 迟早会泄露,问自己:换一个 key 需要几步?在我们的设置里是:改服务器上的 `.env`,`docker compose up -d` 重启相关服务。如果你的回答是「要改代码重新构建」,说明 key 被写死在某处了。

服务器上的 `.env` 文件权限设成 `600`,只有部署用户能读。

到了公司的 K8s 环境,对应的东西是 Kubernetes Secret,或者更常见的云厂商密钥管理服务(阿里云 KMS、AWS Secrets Manager 之类),配合 External Secrets 这类组件同步进集群。概念是一样的:密钥和代码、镜像分开存放,运行时注入。

## 选一条部署路线

### 路线 A:国内轻量云

阿里云、腾讯云都有轻量应用服务器,新用户活动价很低。我 2026 年 10 月查到的第三方汇总里,2 核 2G 的活动价从几十元到一百多元一年不等,限新用户、限购一台,续费价格另算,一切以官网当时的页面为准。

配置建议至少 **2 核 4G**。我们的 Compose 里有 Postgres、Redis、API、worker、Caddy 五个常驻容器,2G 内存跑起来能用,但构建镜像时容易内存不足,而且没有余量给 Langfuse。Langfuse v3 自托管需要 web、worker、Postgres、ClickHouse、Redis、对象存储六个组件,第三方部署指南建议至少 4 核 8G。对个人项目来说,我的建议是 Langfuse 直接用它的云版免费额度,不要和应用挤在一台小机器上。

国内服务器有一道绕不开的坎:**ICP 备案**。用中国大陆的服务器、通过域名在 80/443 端口对外提供网站服务,需要先完成备案。备案要提交身份证明、填写网站信息,通常需要一到几周。没有备案的话,域名访问会被云厂商拦截。

几种应对办法:

- 先用 IP 加非标准端口访问做演示(比如 `1.2.3.4:8080`),不走域名,不需要备案。缺点是没有 HTTPS,浏览器会提示不安全,简历上放这样的链接观感一般。
- 买香港或海外地域的服务器。不需要备案,国内访问速度一般但能用,调 DeepSeek 等国内模型 API 也没问题。价格比大陆地域贵一些。
- 认真走一遍备案。如果你打算长期维护个人项目和博客,备案一次能用很久。

### 路线 B:海外平台或海外 VPS

Render 有免费的 Web Service,但空闲 15 分钟后会休眠,下次访问要冷启动几十秒到一分钟;免费的 Postgres 30 天后过期。最便宜的常驻实例大约每月 7 美元起。Fly.io 现在是纯按量计费,新账号只有短期试用,最小的常驻机器每月几美元。这些数字来自 2026 年的第三方价格汇总,两家官网的定价页链接放在后面,以官网为准。

这类平台的好处是不用管服务器,推代码就部署;坏处是我们这套多容器的 Compose 要拆成多个服务分别配置,而且托管数据库和 Redis 要另外付费。

对这门课的项目,我更推荐**海外 VPS 加同一份 Compose 文件**。Hetzner、Vultr、DigitalOcean 这些厂商每月 5 到 10 美元就有 2 核 4G 左右的机器,部署步骤和国内轻量云完全一样,也没有备案问题。

### 通用部署步骤

不管选哪条路线,拿到一台装好 Docker 的 Linux 服务器以后,步骤都是:

```bash
# 在服务器上,以一个非 root 的部署用户执行
git clone https://github.com/<you>/agent-60-lab.git && cd agent-60-lab
cp .env.example .env && chmod 600 .env && vim .env      # 填密钥和密码
vim deploy/Caddyfile                                     # 改成你的域名
docker compose up -d --build
docker compose ps                                        # 全部 running / healthy,migrate 是 exited (0)
docker compose logs -f api worker                        # 看启动日志
curl -s https://support.your-domain.com/healthz
```

云厂商的安全组(防火墙)只放行 22、80、443。SSH 关掉密码登录,只用密钥。

### 别忘了备份

数据库里有会话、checkpoint、审计日志,丢了就真丢了。最简单的每日备份:

```bash
# 服务器 crontab:每天凌晨 3 点备份,保留 7 天
0 3 * * * cd /home/deploy/agent-60-lab && docker compose exec -T postgres pg_dump -U postgres agent | gzip > /home/deploy/backups/agent-$(date +\%F).sql.gz && find /home/deploy/backups -name 'agent-*.sql.gz' -mtime +7 -delete
```

备份放在同一台机器上只能防误操作,防不了机器坏掉。定期把备份文件同步到对象存储(阿里云 OSS、Cloudflare R2 之类)。另外,**没恢复过的备份不算备份**,至少恢复演练一次。

## 最小的 CI/CD

JD 里对 CI/CD 的要求很常见,有一条平台方向的岗位把 CI/CD 和基础设施即代码(IaC)直接列为硬门槛。对个人项目,一个够用的流水线是:推到 main 分支时,跑测试和评测、构建镜像推到镜像仓库、SSH 到服务器拉新镜像重启。

```yaml
# agent-60-lab/.github/workflows/deploy.yml
name: test-and-deploy
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv sync --locked
      - run: uv run pytest -q tests w6/evals/test_injection.py   # Day 35 和 Day 39 的测试
        env:
          LLM_BASE_URL: ${{ secrets.LLM_BASE_URL }}
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
          LLM_MODEL: ${{ vars.LLM_MODEL }}

  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }},ghcr.io/${{ github.repository }}:latest
      - name: Deploy over SSH
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          HOST: ${{ secrets.DEPLOY_HOST }}
        run: |
          install -m 600 /dev/null key && echo "$SSH_KEY" > key
          ssh -i key -o StrictHostKeyChecking=accept-new deploy@"$HOST" \
            "cd agent-60-lab && git pull --ff-only && IMAGE_TAG=${{ github.sha }} docker compose pull api worker && IMAGE_TAG=${{ github.sha }} docker compose up -d"
```

要让服务器用 CI 构建好的镜像,而不是在服务器上自己构建,`compose.yaml` 里的 `api` 和 `worker` 要加一行 `image: ghcr.io/<you>/agent-60-lab:${IMAGE_TAG:-latest}`。各个 action 的大版本号写的是我写这篇时的版本,用之前去它们的 GitHub 页面确认一下。

评测要不要放进 CI?Day 35 的结论是放,但要注意成本和时间:每次推代码都跑 100 条评测,一天推 20 次就是 2,000 次 Agent 运行。常见做法是 CI 里只跑确定性测试和一个 20 条左右的冒烟评测集,完整评测每天定时跑一次或者合并前手动触发。

这个流水线离公司里的做法还差很多:没有预发环境、没有灰度、回滚要手动、基础设施没有用 Terraform 这类工具描述。但面试时你能讲清楚「我的项目是怎么从提交到上线的」,并且知道下一步该补什么,已经够了。K8s 也一样,知道 Deployment、Service、Secret、HPA 这几个概念各自对应你 Compose 文件里的什么,比没碰过强很多。

## 自己跑开源模型:Ollama 和 vLLM

到目前为止我们都在调云端的模型 API。有些场景会要求模型跑在自己的机器上:数据绝对不能出内网的金融和政务客户;调用量极大、API 账单已经很吓人的公司;需要用自己微调过的模型。JD 里也常见「熟悉开源模型私有化部署」这样的描述。

### Ollama:本机试一试

Ollama 是在个人电脑上跑开源模型最简单的工具。装好以后:

```bash
ollama pull qwen3:8b        # 下载一个 80 亿参数的通义千问 3,4-bit 量化版本约 5 GB
ollama run qwen3:8b "用一句话解释什么是幂等"
```

关键在于,Ollama 提供了 OpenAI 兼容的接口。我们从 Day 3 开始就坚持用环境变量切换厂商,现在收到回报了:

```bash
# .env.local
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama            # Ollama 本地不校验 key,但 SDK 要求非空
LLM_MODEL=qwen3:8b
```

不改一行代码,整个工单 Agent 就跑在了本地模型上。然后你应该做的第一件事,是用 Day 35 的评测集跑一遍,和云端模型比较。一个 8B 的量化模型在分类这种简单任务上可能还行,在多步工具调用和起草回复上,通常会明显落后于云端的大模型。这个差距是多少,用你的评测集说话,不要凭印象。

在 Mac 上,Ollama 用的是统一内存。站长那台 2019 年的 Intel MacBook 跑 8B 模型会非常慢,能跑起来但每秒只有几个 token;Apple 芯片的 Mac 或者有独立显卡的 PC 体验会好很多。B 站上那个讲「普通电脑怎么本地跑大模型」的视频(资料区第二个)把显存、量化和模型大小的关系讲得很清楚,看完你就知道自己的电脑能跑多大的模型。

### vLLM:生产环境的推理服务

Ollama 适合个人和开发。真要在服务器上给很多用户提供服务,业界主流是 vLLM。它的核心是 PagedAttention 和连续批处理,能让一张 GPU 同时服务很多请求,吞吐量比简单的推理脚本高很多。它同样提供 OpenAI 兼容接口:

```bash
# 需要 NVIDIA GPU 的 Linux 机器
uv pip install vllm
vllm serve Qwen/Qwen3-8B --port 8000
# 然后 LLM_BASE_URL=http://<gpu-host>:8000/v1,LLM_MODEL=Qwen/Qwen3-8B
```

工具调用要额外的启动参数(启用自动工具选择和对应模型的解析器),不同模型的参数不同,看 vLLM 文档里的 Tool Calling 一节。

### 什么时候值得自己部署

算一笔账。假设租一张能跑 8B 模型的 GPU 每小时 0.5 美元(这是假设值,不同平台和卡型差别很大,自己去查),对比 `deepseek-flash` 的输入价每百万 token 0.30 美元(标准时段,未命中缓存):

```text
GPU 每小时成本 ÷ API 每 token 价格 = 打平所需的每小时 token 量
0.5 美元 ÷ (0.30 / 1,000,000) ≈ 167 万 token / 小时 ≈ 463 token / 秒,24 小时不停
```

这还只算了输入,而且没算缓存命中后 API 价格会降到五十分之一,没算运维的人力,没算 8B 模型和云端大模型之间的质量差距。对绝大多数中小规模的 Agent 应用,直接调 API 便宜得多。

自部署真正成立的理由通常不是省钱,而是**数据不能出去**,或者**需要自己微调的模型**,或者调用量大到了每天几十亿 token 的级别。面试时被问「为什么不自己部署模型」,用这个算式回答,比说「API 方便」有说服力得多。

## 动手练习

1. 写好 `Dockerfile` 和 `.dockerignore`,本地 `docker build` 成功。改一行 Python 代码再构建,确认依赖层走了缓存(构建日志里显示 `CACHED`)。
2. 写好 `compose.yaml`,本地 `docker compose up -d`(本地测试可以先把 Caddy 换成直接映射 api 的 8000 端口)。确认 `migrate` 正常退出、api 健康检查通过、Day 36 的测试页能用。
3. 用 `docker compose exec api whoami` 确认是非 root 用户;用 `docker history` 确认镜像里没有任何密钥。
4. 选一条路线,把服务部署到公网,配上域名和 HTTPS。用手机 4G 网络打开测试页,跑通一张需要审批的工单,确认流式输出是逐字出现的。
5. 配好每日备份,做一次恢复演练:新起一个 Postgres 容器,把备份导进去,查一下会话表的行数。
6. 配好 GitHub Actions,推一个小改动,看着它自动部署上线。
7. 用 Ollama 跑一个本地模型,把 `LLM_BASE_URL` 指过去,用评测集跑 20 条,和云端模型对比。

**验收标准**:公网 HTTPS 地址可用,流式正常;仓库和镜像里没有密钥;做过一次备份恢复;CI 能自动部署;填好下面这张对比表。

| 模型 | 部署方式 | 评测通过率(20 条) | P50 首字延迟 | 单工单成本 |
| --- | --- | --- | --- | --- |
| deepseek-flash | 云端 API | | | |
| qwen3:8b | 本机 Ollama | | | (电费,约等于 0) |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 镜像分层缓存 | Dockerfile 每条指令生成一层,输入没变的层直接复用,所以要把变化少的步骤放前面 |
| `.dockerignore` | 构建镜像时排除的文件列表,防止把本地环境和密钥打进镜像 |
| 健康检查 | 定期探测容器是否真正可用,失败时编排工具可以重启它 |
| 反向代理 | 位于应用前面接收公网请求并转发的服务,负责 HTTPS、限流等 |
| ICP 备案 | 在中国大陆用服务器通过域名提供网站服务前必须完成的登记 |
| CI/CD | 持续集成/持续部署:代码提交后自动测试、构建、发布 |
| IaC | 基础设施即代码,用 Terraform 等工具以代码形式描述服务器、网络等资源 |
| OpenAI 兼容接口 | 和 OpenAI API 请求格式一致的接口,Ollama、vLLM 和多数国内厂商都提供 |
| vLLM | 主流的开源大模型推理服务框架,以高吞吐著称 |

## 常见误区

**把数据库端口映射到公网。** 加上弱密码,几小时内就会被扫到。数据库只在内部网络可见。

**密钥写在 Dockerfile 或代码里。** 进了镜像和 git 历史就收不回来了。泄露后第一件事是去厂商后台作废。

**健康检查只返回 200。** 数据库挂了它还说健康。至少检查关键依赖,但别在里面调模型 API。

**以为国内服务器买了就能用域名访问。** 大陆地域要先备案,时间要算进计划里。

**备份放在同一台机器上,而且从没恢复过。** 机器坏了一起没,恢复时才发现备份是坏的。

**为了「省钱」自己部署模型。** 算一下打平所需的 token 量,再加上运维和质量差距,对大多数应用 API 更便宜。自部署的理由通常是数据和定制,不是钱。

## 学习资料

### 文档与文章

- [uv · Using uv in Docker](https://docs.astral.sh/uv/guides/integration/docker/):官方 Docker 指南,分层缓存、钉版本、非 root 的写法都在里面。今天的 Dockerfile 就是照它改的。30 分钟。
- [Docker Compose 文档](https://docs.docker.com/compose/):重点看 `depends_on` 的 `condition`、健康检查和环境变量插值。30 分钟。
- [Caddy · reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy):看 `flush_interval` 一段,确认 SSE 为什么不需要额外配置。10 分钟。
- [pgvector 镜像](https://hub.docker.com/r/pgvector/pgvector):可用的标签列表。5 分钟。
- [GitHub Actions 文档](https://docs.github.com/en/actions):第一次写工作流的话,看 Quickstart 和 Secrets 两节。30 分钟。
- [Langfuse · Self-hosting](https://langfuse.com/self-hosting):看一眼自托管的组件和资源要求,你就明白为什么建议个人项目用云版。10 分钟。
- [Render 定价](https://render.com/pricing)、[Fly.io 定价](https://fly.io/docs/about/pricing/):部署前自己核对当前价格。
- [Ollama · OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)、[vLLM · OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html):两个工具的 OpenAI 兼容接口说明,包括支持哪些参数、工具调用怎么开。各 20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1THKyzBER6&autoplay=0&high_quality=1" title="40分钟的Docker实战攻略，一期视频精通Docker" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · 40 分钟的 Docker 实战攻略 · 70 万播放,从核心概念、镜像加速到 Compose 一次讲完,节奏很紧凑。Docker 不熟的话今天先看这个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QWpK68EFA&autoplay=0&high_quality=1" title="普通电脑怎么本地跑大模型？显存、量化、7B/8B、Ollama 一次讲透" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI算法工程师Power · 普通电脑怎么本地跑大模型?显存、量化、7B/8B、Ollama 一次讲透 · 10 分钟,讲清楚模型参数量、量化位数和内存需求的关系。跑 Ollama 之前看,能帮你判断自己的电脑能跑多大的模型。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bi0cKgmRuiA" title="Docker Tutorial For Beginners - How To Containerize Python Applications" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Patrick Loeber · Docker Tutorial For Beginners: How To Containerize Python Applications · 22 分钟,专门讲 Python 应用怎么容器化,和今天的内容贴得最近。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/UtSSMs6ObqY" title="Learn Ollama in 15 Minutes - Run LLM Models Locally for FREE" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Tech With Tim · Learn Ollama in 15 Minutes · 120 多万播放,装 Ollama、拉模型、用 Python 调用,15 分钟走完。</figcaption>
</figure>

想系统学 Ollama 做应用的话,freeCodeCamp 有一门 3 小时的《Ollama Course: Build AI Apps Locally》([YouTube](https://www.youtube.com/watch?v=GWB9ApTPTv4));B 站上大模型观察员的 Ollama 保姆级教程合集([BV1qfPQzBEYR](https://www.bilibili.com/video/BV1qfPQzBEYR/))有 49 集,挑安装、API 调用和私有化部署几集看即可。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 9 章「Inference Optimization」里讲推理服务的部分,以及第 10 章的架构总图:看完你会知道 vLLM 这类推理服务在整个 AI 应用架构里处在什么位置。1 小时。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024)第 7 章前后讲本地加载和量化模型的部分,适合想多了解开源模型的人。中文版《图解大模型》(人民邮电出版社)。40 分钟。

### 开源项目与代码

- [ollama/ollama](https://github.com/ollama/ollama):README 里有支持的模型列表和 REST API 说明。
- [vllm-project/vllm](https://github.com/vllm-project/vllm):看 README 了解它的定位和支持的硬件,不用读源码。

## 自测

1. Dockerfile 里为什么先 `COPY pyproject.toml uv.lock` 装依赖,再 `COPY . .`?

<details><summary>答案</summary>

Docker 按指令分层缓存,某一层的输入没变就复用。依赖文件很少变,代码经常变。先复制依赖文件并安装,改代码时这一层仍然命中缓存,只重建复制代码那一层,构建从几分钟变成几秒。反过来写,每改一行代码都要重装全部依赖。

</details>

2. `migrate` 服务为什么要独立出来,而不是在 API 启动时执行 SQL?

<details><summary>答案</summary>

API 和 worker 可能有多个副本同时启动,都去执行迁移会互相冲突。独立的一次性服务只执行一次,`api` 和 `worker` 通过 `service_completed_successfully` 条件等它成功后再启动,保证应用启动时数据库结构已就绪;迁移失败时应用不会带着错误的表结构启动。

</details>

3. 你不小心把 `.env` 推到了公开的 GitHub 仓库,第一时间该做什么?

<details><summary>答案</summary>

立刻去各个厂商后台作废泄露的 key 并生成新的,改服务器上的配置重启服务。然后再处理仓库:删除文件、必要时用工具清理 git 历史、把 `.env` 加进 `.gitignore`。顺序很重要,删文件不能让已经泄露的 key 失效,git 历史和各种镜像站可能早已抓取。

</details>

4. 为什么建议个人项目的 Langfuse 用云版而不是和应用部署在同一台小服务器上?

<details><summary>答案</summary>

Langfuse v3 自托管包含 web、worker、Postgres、ClickHouse、Redis、对象存储等多个组件,第三方部署指南建议至少 4 核 8G,远超一台 2 核 4G 小机器的余量,会和应用抢资源。云版有免费额度,对个人项目的 trace 量足够,也省去了运维。

</details>

5. (面试题)「你们为什么不自己部署开源模型?」请用数字回答。

<details><summary>答案</summary>

参考答法:算了打平点。假设一张 GPU 每小时 0.5 美元,对比 API 输入价每百万 token 0.3 美元,要每小时处理约 167 万输入 token,也就是 24 小时不间断约 460 token/秒才打平,这还没算缓存命中后 API 更便宜、没算运维人力、没算开源小模型和云端模型的质量差距(用评测集测过)。我们的量远达不到。自部署的真实理由是数据不能出域、需要微调模型或调用量极大,目前这些都不成立。架构上我们用 OpenAI 兼容协议,需要时改一个环境变量就能切到 vLLM。

</details>

6. (面试题)你的 Agent 服务从提交代码到上线经过哪些步骤?还缺什么?

<details><summary>答案</summary>

现状:推到 main 触发 GitHub Actions,跑单元测试、注入测试和冒烟评测集;通过后构建镜像推到 GHCR,打上 commit sha 标签;SSH 到服务器拉新镜像,Compose 滚动重启,数据库迁移由一次性服务先执行;worker 有优雅退出时间,未完成任务依靠队列重投和幂等键。还缺:预发环境、灰度或蓝绿发布、自动回滚、基础设施用 Terraform 描述、完整评测定时跑并和上线门禁打通、迁移的版本管理(Alembic)。

</details>

## 明天预告

Day 42 · W6 复习 + 生产化清单。这一周我们把工单 Agent 从命令行带到了公网:流式服务、任务队列、成本控制、两天的安全加固、部署上线。明天把六天的内容收拢成一张上线前检查清单,把完整代码整理好,过一遍本周的面试题和踩过的坑,确认你的 Agent 真的经得起陌生人来用。
