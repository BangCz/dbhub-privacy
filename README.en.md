# DBHub Privacy

[中文](README.md) | English

This is an unofficial fork of [Bytebase DBHub](https://github.com/bytebase/dbhub). It adds **protected base-table output columns** and a **configurable function denylist** for PostgreSQL and Oracle. The upstream MySQL, MariaDB, SQL Server, and SQLite connectors remain available, but this fork's privacy guard currently supports PostgreSQL and Oracle only.

## What it does

- Configure protected `schema.base_table.column` entries independently for each database source. The guard traces final SELECT output before the business query reaches the database driver.
- Deny protected output through direct references, aliases, expressions, aggregates, `SELECT *`, CTEs, subqueries, set operations, and views whose definitions can be traced. Queries with unresolvable output origins are denied.
- Deny configured function calls, such as decryption functions. The last component of a function name is matched case-insensitively.
- Preserve DBHub's existing per-tool read-only mode, row limits, object search, custom tools, and execution-plan tools.

This is **not** a complete inference-prevention system. Protected columns may still appear in `WHERE`, `JOIN`, sorting, and grouping when they do not flow into final output; repeated queries can still reveal information indirectly. Database privileges, MCP client permissions, and network access controls must be managed separately.

## Quick start

Node.js 22.5.0 or newer is required. Install dependencies, build this repository, and launch the **local build**:

```bash
pnpm install
pnpm run build:backend
node dist/index.js --transport stdio --config /path/outside/repo/dbhub.toml
```

`npx @bytebase/dbhub@latest` runs the upstream package; it **does not include this fork's privacy guard**. Keep real TOML configuration outside the repository. Never commit connection endpoints, accounts, passwords, or local protected-column lists.

The example below uses fictional objects only. For Oracle, set the correct type, port, service name, and catalog spelling; unquoted Oracle objects are normally uppercase.

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

| Setting | Purpose |
| --- | --- |
| `sources.privacy.enabled` | Enable output checks for this source. Omitted or disabled means upstream behavior. |
| `sources.privacy.blocked_columns[].schema/table/columns` | Identify protected base-table columns using their actual catalog names. Configure each source separately. |
| `sources.privacy.blocked_functions` | Deny named functions in business SQL; `decrypt_secret` also matches `pkg.decrypt_secret(...)`. |
| `tools[].readonly` | Enable read-only mode separately for `execute_sql` and **every custom SQL tool**. This is not a source-level option. |
| `tools[].max_rows` | Cap result rows for that tool. It is not a substitute for read-only mode or privacy protection. |

Restart DBHub after changing privacy settings; hot reload will not partially apply a new privacy policy. `search_objects` can still return object definitions and column names. `explain_sql` keeps its upstream behavior: Oracle's built-in execution-plan implementation writes and cleans up `PLAN_TABLE` rows but does not execute the explained business query. See the [privacy configuration guide](docs/privacy-select-guard.md) for details.

## A one-sentence instruction for an AI assistant

> Create a TOML file outside this repository for the PostgreSQL/Oracle DBHub sources I specify; verify the actual schema, tables, and columns, enable `privacy.enabled`, configure `blocked_columns` and decryption-function `blocked_functions`, set `readonly = true` and `max_rows = 1000` on `execute_sql` and every custom SQL tool, do not read, display, or commit passwords or sensitive business values, and show me the result for review before activation.

## License and privacy boundaries

- This repository retains the upstream [MIT License](LICENSE). It permits commercial use, modification, and distribution if the original copyright and license notice are preserved. It does not grant trademark rights or guarantee production security.
- The [Bytebase website privacy policy](https://www.bytebase.com/privacy/) primarily describes data handling when visiting or purchasing from `bytebase.com`. It should **not** be treated as a specific promise about how a self-hosted DBHub runtime handles database contents. This repository makes no separate legal guarantee that query results never leave your environment.
- This fork restricts **output** of configured columns and **calls** to configured functions. It does not cover unconfigured fields, statistical inference, or what an AI client does after receiving permitted results. Review dependencies, network exposure, logs, effective database privileges, and the terms of the AI service before production use.

## Verification

```bash
./node_modules/.bin/vitest run --project unit
./node_modules/.bin/tsup
```

Container integration tests require a working container runtime. Please distinguish fork-specific issues from features of the [upstream project](https://github.com/bytebase/dbhub).
