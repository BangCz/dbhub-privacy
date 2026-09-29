# 本 fork：敏感字段输出拦截

适用于 PostgreSQL 和 Oracle。规则写在每个 `[[sources]]` 连接下面；不配置或设置 `enabled = false` 时保持上游行为。配置文件应放在仓库外，密码用环境变量注入，切勿提交真实主机、账号、密码或本地隐私字段清单。

## 配置项

| 字段 | 作用 |
| --- | --- |
| `[sources.privacy] enabled` | 必填布尔值；`true` 时启用该连接的输出检查，且必须至少配置一组 `blocked_columns`。 |
| `blocked_functions` | 可选函数名数组；匹配业务 SQL 中调用的函数，大小写不敏感，只比较函数名最后一段。例如 `decrypt_secret` 也拦截 `pkg.decrypt_secret(...)`。按连接分别维护；不要把任意点号限定名写进数组。 |
| `[[sources.privacy.blocked_columns]] schema` | 基表所在 Schema，使用数据库目录中的实际拼写。 |
| `table` | 基表名；视图输出会尽可能追溯到基表。 |
| `columns` | 非空列名数组；这些列流入最终 SELECT 输出时整条 SQL 被拒绝。 |
| `[[tools]] readonly` | `execute_sql` 或每个自定义 SQL 工具分别配置 `true`；不能写在 `[[sources]]` 下。 |
| `[[tools]] max_rows` | 可选正整数，只限制返回行数，不是隐私保护开关。 |

PostgreSQL 未加引号的目录名通常为小写；Oracle 未加引号的目录名通常为大写。多个连接应分别配置，不会共用保护规则。以下均为**虚构示例**：

```toml
[[sources]]
id = "example"
type = "oracle"
host = "db.example.internal"
port = 1521
database = "EXAMPLE_SERVICE"
user = "read_user"
password = "${DBHUB_EXAMPLE_PASSWORD}"

[sources.privacy]
enabled = true
blocked_functions = ["decrypt_secret"]

[[sources.privacy.blocked_columns]]
schema = "APP"
table = "PEOPLE"
columns = ["PERSONAL_EMAIL", "ID_NUMBER"]

[[tools]]
name = "execute_sql"
source = "example"
readonly = true
max_rows = 1000

[[tools]]
name = "search_objects"
source = "example"
```

如果添加自定义 SQL 工具，也要为**每一个**工具设置 `readonly = true`。`search_objects` 不执行用户提供的业务 SQL，不能设置 `readonly` 或 `max_rows`；它仍能返回对象结构和字段名称。

## 拦截范围

- 禁止输出受保护的基表列，包括直接 SELECT、改别名、CAST、截取、拼接、聚合、`*`、CTE、子查询、集合查询以及可追溯视图。命中返回 `PRIVACY_SELECT_DENIED`。
- `WHERE`、`JOIN ON`、`GROUP BY`、`HAVING`、`ORDER BY` 使用受保护列，但最终不输出该列时仍允许；`COUNT(*)` 允许。这不是防推断机制。
- `blocked_functions` 中的函数在业务 SQL 任何位置被调用都会拒绝；未列出的函数可用，但其输出参数仍做受保护字段来源检查。
- 对象来源或 SQL 结构无法可靠解析时，返回 `PRIVACY_QUERY_UNSUPPORTED`，不降级放行。检查只读取目录元数据；被拒绝的业务 SQL 不交给数据库驱动执行。
- 普通 `explain_sql`、对象结构及健康检查维持现有行为。Oracle 内置 EXPLAIN 会写入并清理 `PLAN_TABLE`，但不会运行被解释的业务 SQL；不要将此视为通用写库授权。
- 配置更改后重启 DBHub；热更新不会半更新隐私规则。本功能仅作用于运行本 fork 且加载该配置的 DBHub；SQLcl、其他数据库客户端不受保护。

## 一句话让 AI 配置

> 请只在仓库外为我指定的 PostgreSQL/Oracle DBHub 连接生成 TOML：核对真实 Schema/表/列后启用 `privacy.enabled`，配置 `blocked_columns` 和解密函数 `blocked_functions`，把 `execute_sql` 及自定义 SQL 工具设为 `readonly = true`、`max_rows = 1000`；不要读取、展示或提交密码和业务敏感值，完成后先让我审阅。
