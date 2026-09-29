> [!NOTE]  
> If you need an enterprise-level database MCP server with built-in guardrails like approval flow, access control, data masking, and audit logging beyond what DBHub offers, check out [Bytebase](https://www.bytebase.com/).

<p align="center">
 <a href="https://www.star-history.com/bytebase/dbhub">
  <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=bytebase/dbhub&type=trending&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/badge?repo=bytebase/dbhub&type=trending" />
   <img alt="GitHub Trending Repository of the Day" src="https://api.star-history.com/badge?repo=bytebase/dbhub&type=trending" />
  </picture>
 </a>
</p>

<p align="center">
<a href="https://dbhub.ai/" target="_blank">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/bytebase/dbhub/main/docs/images/logo/full-dark.svg" width="75%">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/bytebase/dbhub/main/docs/images/logo/full-light.svg" width="75%">
  <img src="https://raw.githubusercontent.com/bytebase/dbhub/main/docs/images/logo/full-light.svg" width="75%" alt="DBHub Logo">
</picture>
</a>
</p>

```bash
            +------------------+    +--------------+    +------------------+
            |                  |    |              |    |                  |
            |  Claude Desktop  +--->+              +--->+    PostgreSQL    |
            |                  |    |              |    |                  |
            |  Claude Code     +--->+              +--->+    SQL Server    |
            |                  |    |              |    |                  |
            |  Cursor          +--->+    DBHub     +--->+    Oracle        |
            |                  |    |              |    |                  |
            |  VS Code         +--->+              +--->+    SQLite        |
            |                  |    |              |    |                  |
            |  Copilot CLI     +--->+              +--->+    MySQL         |
            |                  |    |              |    |                  |
            |                  |    |              +--->+    MariaDB       |
            |                  |    |              |    |                  |
            +------------------+    +--------------+    +------------------+
                 MCP Clients           MCP Server             Databases
```

DBHub is a minimal MCP server: token-efficient, zero-dependency, and just two tools by default with opt-in extras. This lightweight gateway allows MCP-compatible clients to connect to and explore different databases:

- **Minimal**: Zero dependency, token efficient with a minimal set of MCP tools to maximize context window
- **Multi-Database**: PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, and SQLite through a single interface
- **Multi-Connection**: Connect to multiple databases simultaneously with TOML configuration
- **Guardrails**: Read-only mode, row limiting, and query timeout to prevent runaway operations
- **Fork-specific privacy guard**: Configure protected PostgreSQL/Oracle base-table output columns in TOML ([guide](docs/privacy-select-guard.md))
- **Secure Access**: SSH tunneling and SSL/TLS encryption

> DBHub is the official example in the [Claude Code docs](https://code.claude.com/docs/en/mcp#example-query-your-postgresql-database) for connecting to PostgreSQL via MCP.

## Token Efficiency

DBHub loads just 2 tools by default at **1.4k tokens** — 13-14x fewer than alternatives — keeping the context window open for your actual work.

| MCP Server | Default Config | Default Tools |
|------------|---------------|--------------|
| **DBHub** | **1.4k** | 2 (`execute_sql`, `search_objects`) |
| MCP Toolbox | 19.0k | 28 |
| Supabase MCP | 19.3k | all |

## Use Cases

- **Local Development**: Schema exploration, query validation, and data debugging with Claude Code, VS Code, Cursor, etc.
- **Non-Technical Access**: Expose curated, read-only views to non-technical staff via Claude Desktop, VS Code, Cursor, etc.
- **Multi-Database Consolidation**: Replace separate MCP servers for each database with a single DBHub process
- **Production Troubleshooting**: Read-only diagnostics with guardrails against runaway queries

## Supported Databases

PostgreSQL, MySQL, SQL Server, MariaDB, Oracle, and SQLite.

## MCP Tools

DBHub implements MCP tools for database operations:

- **[execute_sql](https://dbhub.ai/tools/execute-sql)**: Execute SQL queries with transaction support and safety controls
- **[search_objects](https://dbhub.ai/tools/search-objects)**: Search and explore database schemas, tables, columns, indexes, and procedures with progressive disclosure
- **[explain_sql](https://dbhub.ai/tools/explain-sql)** (opt-in): Show a query's execution plan without running it
- **[health_check](https://dbhub.ai/tools/health-check)** (opt-in): Report connection pool state and buffer cache hit ratio
- **[Custom Tools](https://dbhub.ai/tools/custom-tools)**: Define reusable, parameterized SQL operations in your `dbhub.toml` configuration file

## Workbench

DBHub includes a [built-in web interface](https://dbhub.ai/workbench/overview) for interacting with your database tools. It provides a visual way to execute queries, run custom tools, and view request traces without requiring an MCP client.

![workbench](https://raw.githubusercontent.com/bytebase/dbhub/main/docs/images/workbench/workbench.webp)

## Installation

### 本 fork 的只读与隐私配置

本 fork 支持 PostgreSQL、Oracle 的**逐连接敏感字段输出拦截**。在仓库外保存 TOML，给每个连接配置 `[sources.privacy]`，并给每个可执行 SQL 的工具设置 `readonly = true`。它会在执行业务查询前拒绝输出受保护的基表字段（包括别名、表达式、聚合、`SELECT *`）；条件中使用这些字段不受此输出规则限制。未列入黑名单的函数仍可能读取数据，因此应同时限制数据库账号权限。

```toml
[[sources]]
id = "example"
type = "postgres" # Oracle 改为 "oracle"，并使用实际服务名和目录中的大写对象名
host = "db.example.internal"
port = 5432
database = "example_db"
user = "read_user"
password = "${DBHUB_EXAMPLE_PASSWORD}"

[sources.privacy]
enabled = true
blocked_functions = ["decrypt_secret"]

[[sources.privacy.blocked_columns]]
schema = "app"
table = "people"
columns = ["personal_email", "id_number"]

[[tools]]
name = "execute_sql"
source = "example"
readonly = true
max_rows = 1000

[[tools]]
name = "search_objects"
source = "example"
```

| 安全字段 | 用途 |
| --- | --- |
| `sources.privacy.enabled` | 对该连接启用输出检查；关闭或不配置则维持原行为。 |
| `sources.privacy.blocked_columns[].schema/table/columns` | 按数据库目录中的真实基表及列名，配置禁止输出的字段；每个连接单独配置。 |
| `sources.privacy.blocked_functions` | 配置禁止在业务 SQL 中调用的函数名；按函数名最后一段、不区分大小写匹配。 |
| `tools[].readonly` | 给 `execute_sql` 及每个自定义 SQL 工具分别开启只读；不是连接级字段。 |
| `tools[].max_rows` | 限制该 SQL 工具返回的最大行数，不代替只读或隐私配置。 |

用本地构建启动：`node dist/index.js --transport stdio --config /path/outside/repo/dbhub.toml`。**不要用上游 `npx @bytebase/dbhub@latest` 来验证本 fork 的隐私功能，也不要把含密码或真实连接地址的 TOML 提交到仓库。**修改隐私配置后重启进程；详细行为、例外和限制见[隐私配置说明](docs/privacy-select-guard.md)。

可以直接这样让 AI 配置：**“请只在仓库外为我指定的 PostgreSQL/Oracle DBHub 连接生成 TOML：核对真实 Schema/表/列后启用 `privacy.enabled`，配置 `blocked_columns` 和解密函数 `blocked_functions`，把 `execute_sql` 及自定义 SQL 工具设为 `readonly = true`、`max_rows = 1000`；不要读取、展示或提交密码和业务敏感值，完成后先让我审阅。”**

```bash
npx @bytebase/dbhub@latest --transport http --port 8080 --dsn "postgres://user:password@localhost:5432/dbname?sslmode=disable"
```

Also available as:

- [Docker image](https://dbhub.ai/installation#docker)
- [MCP Bundle](https://dbhub.ai/mcpb) (one-click install, read-only)
- [Claude Code plugin](https://dbhub.ai/claude-code-plugin)

See the [Installation Guide](https://dbhub.ai/installation) for all options, [Command-Line Options](https://dbhub.ai/config/command-line) for parameters, and [Multi-Database Configuration](https://dbhub.ai/config/toml) for connecting several databases at once.

## Development

Requires Node.js >= 22.5.0 (DBHub uses the built-in `node:sqlite` module).

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build and run for production
pnpm build && pnpm start --transport stdio --dsn "postgres://user:password@localhost:5432/dbname"
```

See [Testing](.claude/skills/testing/SKILL.md) and [Debug](https://dbhub.ai/config/debug).

## Contributors

<a href="https://github.com/bytebase/dbhub/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=bytebase/dbhub" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=bytebase%2Fdbhub&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=bytebase/dbhub&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=bytebase/dbhub&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=bytebase/dbhub&type=date&legend=top-left" />
 </picture>
</a>
