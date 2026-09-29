# DBHub Privacy

中文 | [English](README.en.md)

这是基于 [Bytebase DBHub](https://github.com/bytebase/dbhub) 的非官方分支，在原有数据库 MCP 服务上增加了 PostgreSQL 和 Oracle 的**基表敏感字段输出拦截**及**可配置函数黑名单**。原有 MySQL、MariaDB、SQL Server、SQLite 等连接能力仍在，但本分支的隐私拦截目前只支持 PostgreSQL 和 Oracle。

## 能做什么

- 按数据库连接分别配置不允许输出的 `Schema.基表.字段`，在业务 SQL 交给数据库驱动前检查最终输出来源。
- 拦截直接输出、别名、表达式、聚合、`SELECT *`、CTE、子查询、集合查询及可追溯视图中的受保护字段；来源无法可靠确认时拒绝。
- 配置禁止调用的函数名，例如解密函数；函数黑名单按名称最后一段匹配，不区分大小写。
- 保留 DBHub 原有的逐工具只读、最大返回行数、对象搜索、自定义工具与执行计划能力。

这不是完整的数据防推断系统：`WHERE`、`JOIN`、排序、分组等条件可以使用受保护字段，只要它们不流入最终输出；反复查询仍可能推断信息。数据库账号权限、MCP 客户端权限和网络访问控制仍须单独管理。

## 快速开始

需要 Node.js 22.5.0 或更新版本。使用已发布的 `1.0.0`：

```bash
npx -y @czbang/dbhub-privacy@1.0.0 --transport stdio --config /path/outside/repo/dbhub.toml
```

开发本仓库时，也可以安装依赖并使用**本地构建产物**启动：

```bash
pnpm install
pnpm run build:backend
node dist/index.js --transport stdio --config /path/outside/repo/dbhub.toml
```

`npx @bytebase/dbhub@latest` 启动的是上游版本，**不会加载本分支新增的隐私拦截代码**。真实配置文件应保存在仓库外，不要提交连接地址、账号、密码或本地隐私字段清单。

## 后续发布

先将代码和 `package.json` 版本号更新到下一个未发布版本（例如 `1.0.1`），并合并到 `main`。推送到 `main` 会自动发布 Docker `latest`；版本号发生变化时还会发布对应版本标签，并自动构建该版本的 MCP Bundle，上传到 GitHub Release。npm 不会自动发布：到 [Publish to npm](https://github.com/BangCz/dbhub-privacy/actions/workflows/npm-publish.yml) 手动运行工作流，选择 `main`，填写与 `package.json` 相同的版本号，稳定版使用 `latest` 标签。已发布的 npm 版本号不能重用。

以下 TOML 仅使用虚构对象；Oracle 请把数据库类型、端口、服务名及目录对象名改成实际值，未加引号的 Oracle 对象通常使用大写名称。

```toml
[[sources]]
id = "example"
type = "postgres"
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

| 配置字段 | 作用 |
| --- | --- |
| `sources.privacy.enabled` | 对当前连接启用输出检查；关闭或省略时保持上游行为。 |
| `sources.privacy.blocked_columns[].schema/table/columns` | 按数据库目录中真实的基表和列名配置禁止输出项；每个连接单独配置。 |
| `sources.privacy.blocked_functions` | 配置禁止在业务 SQL 中调用的函数名；例如配置 `decrypt_secret` 也会拦截 `pkg.decrypt_secret(...)`。 |
| `tools[].readonly` | 为 `execute_sql` 和**每个自定义 SQL 工具**分别开启只读；不能写在连接级。 |
| `tools[].max_rows` | 限制该工具的返回行数，不代替只读或隐私保护。 |

修改隐私配置后要重启 DBHub；配置热更新不会半更新这套策略。`search_objects` 仍可返回对象结构和字段名称；`explain_sql` 维持原有行为，其中 Oracle 内置执行计划会写入并清理 `PLAN_TABLE`，但不运行被解释的业务 SQL。详细规则见[隐私配置说明](docs/privacy-select-guard.md)。

## 一句话让 AI 配置

> 请只在仓库外为我指定的 PostgreSQL/Oracle DBHub 连接生成 TOML：核对真实 Schema、表、列后启用 `privacy.enabled`，配置 `blocked_columns` 和解密函数 `blocked_functions`，给 `execute_sql` 及所有自定义 SQL 工具设置 `readonly = true`、`max_rows = 1000`；不要读取、展示或提交密码和业务敏感值，完成后先让我审阅。

## 许可与隐私边界

- 本仓库保留原项目的 [MIT 许可证](LICENSE)。MIT 允许商用、修改和分发，但再分发时需保留原版权与许可声明；这不是原项目名称或标志的商标授权，也不是生产环境安全保证。
- [Bytebase 官网隐私政策](https://www.bytebase.com/privacy/)主要说明访问或购买 `bytebase.com` 时的信息处理，**不能直接视为自托管 DBHub 对数据库内容的处理承诺**。本仓库没有单独提供“查询结果绝不外传”的法律保证。
- 本分支限制的是所配置字段的**输出**和所配置函数的**调用**，不保护未配置的字段、不阻止统计推断，也不控制 AI 客户端收到结果后的处理。部署前应检查依赖、网络暴露、日志、实际数据库权限和所接入 AI 服务的条款。

## 验证

```bash
./node_modules/.bin/vitest run --project unit
./node_modules/.bin/tsup
```

容器集成测试需要可用的容器运行时。问题反馈和上游通用功能请先区分本分支与[原项目](https://github.com/bytebase/dbhub)。

感谢 [LINUX DO 社区](https://linux.do/) 提供开源交流平台。
