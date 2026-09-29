import type { PrivacyConfig } from "../types/config.js";

export type Dialect = "postgres" | "oracle";
export type ColumnOrigin = { schema: string; table: string; column: string };
export type Relation = { schema: string; table: string; columns: string[]; viewSql?: string };
export type RelationLookup = (name: string, schema?: string) => Promise<Relation | null>;

export class PrivacyError extends Error {
  constructor(
    public readonly code: "PRIVACY_SELECT_DENIED" | "PRIVACY_QUERY_UNSUPPORTED",
    message: string
  ) {
    super(`${code}: ${message}`);
  }
}

type Token = { value: string; kind: "id" | "quoted" | "literal" | "symbol" };
type Field = { name: string; origins: ColumnOrigin[] };
type Source = { alias: string; fields: Field[] };
const unsupported = (message: string): never => {
  throw new PrivacyError("PRIVACY_QUERY_UNSUPPORTED", message);
};
const word = (t?: Token) => (t?.kind === "id" ? t.value.toUpperCase() : "");
const name = (t: Token, dialect: Dialect) =>
  t.kind === "quoted"
    ? t.value
    : dialect === "postgres"
      ? t.value.toLowerCase()
      : t.value.toUpperCase();
const isName = (t?: Token) => t?.kind === "id" || t?.kind === "quoted";
const exprWords = new Set([
  "AS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "NULL",
  "TRUE",
  "FALSE",
  "DISTINCT",
  "ALL",
  "AND",
  "OR",
  "NOT",
  "IS",
  "IN",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "ESCAPE",
  "OVER",
  "PARTITION",
  "BY",
  "ROWS",
  "RANGE",
  "UNBOUNDED",
  "PRECEDING",
  "FOLLOWING",
  "CURRENT",
  "ROW",
  "ASC",
  "DESC",
  "NULLS",
  "FIRST",
  "LAST",
  "FILTER",
  "WITHIN",
  "ORDER",
  "FROM",
  "AT",
  "TIME",
  "ZONE",
  "COLLATE",
]);
/** Lex to structural tokens. Strings, comments and bind values never become identifiers. */
export function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (/^\s/.test(rest)) {
      i++;
      continue;
    }
    if (rest.startsWith("--")) {
      i = sql.indexOf("\n", i + 2);
      if (i < 0) break;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) unsupported("未闭合的注释");
      i = end + 2;
      continue;
    }
    if (rest[0] === '"') {
      let value = "";
      let closed = false;
      i++;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i++;
            closed = true;
            break;
          }
        } else value += sql[i++];
      }
      if (!closed) unsupported("未闭合的标识符");
      out.push({ kind: "quoted", value });
      continue;
    }
    if (rest[0] === "'") {
      let closed = false;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") i += 2;
          else {
            i++;
            closed = true;
            break;
          }
        } else i++;
      }
      if (!closed) unsupported("未闭合的字符串");
      out.push({ kind: "literal", value: "?" });
      continue;
    }
    const dollar = rest.match(/^\$[A-Za-z_0-9]*\$/);
    if (dollar) {
      const end = sql.indexOf(dollar[0], i + dollar[0].length);
      if (end < 0) unsupported("未闭合的字符串");
      i = end + dollar[0].length;
      out.push({ kind: "literal", value: "?" });
      continue;
    }
    const id = rest.match(/^[A-Za-z_][A-Za-z_0-9$#]*/);
    if (id) {
      out.push({ kind: "id", value: id[0] });
      i += id[0].length;
      continue;
    }
    const literal = rest.match(/^(?:\d+(?:\.\d+)?|\$\d+|:[A-Za-z_][A-Za-z_0-9]*|\?)/);
    if (literal) {
      out.push({ kind: "literal", value: "?" });
      i += literal[0].length;
      continue;
    }
    if (
      rest.startsWith("::") ||
      rest.startsWith("||") ||
      rest.startsWith("->") ||
      rest.startsWith("=>")
    ) {
      out.push({ kind: "symbol", value: rest.slice(0, 2) });
      i += 2;
      continue;
    }
    if ("(),.;*+-/=%<>![]".includes(rest[0])) {
      out.push({ kind: "symbol", value: rest[0] });
      i++;
      continue;
    }
    unsupported("无法解析 SQL 字符");
  }
  return out;
}

function matching(t: Token[], start: number): number {
  if (t[start]?.value !== "(") unsupported("缺少左括号");
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    if (t[i].value === "(") depth++;
    if (t[i].value === ")" && --depth === 0) return i;
  }
  return unsupported("未闭合的括号");
}

function splitTop(t: Token[], delimiter: string): Token[][] {
  const chunks: Token[][] = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i].value === "(") {
      i = matching(t, i);
      continue;
    }
    if (t[i].value === delimiter) {
      chunks.push(t.slice(start, i));
      start = i + 1;
    }
  }
  chunks.push(t.slice(start));
  if (chunks.some((part) => !part.length)) unsupported("空表达式");
  return chunks;
}

function topKeyword(t: Token[], start: number, words: Set<string>): number {
  for (let i = start; i < t.length; i++) {
    if (t[i].value === "(") {
      i = matching(t, i);
      continue;
    }
    if (words.has(word(t[i]))) return i;
  }
  return t.length;
}

function unique(origins: ColumnOrigin[]): ColumnOrigin[] {
  return [...new Map(origins.map((o) => [`${o.schema}.${o.table}.${o.column}`, o])).values()];
}

/** A bounded SELECT syntax tree: projections and relation nodes are retained; predicates are not output. */
export class SelectGuard {
  private readonly blocked: Set<string>;
  private readonly blockedFunctions: Set<string>;
  constructor(
    private readonly dialect: Dialect,
    private readonly privacy: PrivacyConfig,
    private readonly lookup: RelationLookup,
    private readonly defaultSchema: string
  ) {
    this.blocked = new Set(
      (privacy.blocked_columns ?? []).flatMap((entry) =>
        entry.columns.map((column) => `${entry.schema}.${entry.table}.${column}`)
      )
    );
    this.blockedFunctions = new Set((privacy.blocked_functions ?? []).map((fn) => fn.toUpperCase()));
  }

  async check(sql: string): Promise<void> {
    if (!this.privacy.enabled) return;
    const tokens = tokenize(sql);
    const parts = splitTop(
      tokens.filter((t, i) => !(t.value === ";" && i === tokens.length - 1)),
      ";"
    );
    for (const part of parts) {
      if (word(part[0]) === "EXPLAIN") continue; // Existing explain_sql behavior is preserved.
      for (let i = 0; i < part.length - 1; i++) {
        if (isName(part[i]) && part[i + 1].value === "(" &&
            this.blockedFunctions.has(part[i].value.toUpperCase()))
          throw new PrivacyError("PRIVACY_SELECT_DENIED", `函数 ${part[i].value} 不允许调用`);
      }
      // A batch is checked before execution. Its earlier statement must not
      // change search_path and invalidate later catalog resolution.
      if (
        part.some((token, index) => word(token) === "SET_CONFIG" && part[index + 1]?.value === "(")
      ) {
        unsupported("查询不能更改会话对象解析路径");
      }
      const fields = await this.query(part, new Map(), this.defaultSchema, 0);
      for (const field of fields)
        for (const origin of field.origins) {
          const key = `${origin.schema}.${origin.table}.${origin.column}`;
          if (this.blocked.has(key))
            throw new PrivacyError("PRIVACY_SELECT_DENIED", `${key} 不允许作为查询输出`);
        }
    }
  }

  private async query(
    t: Token[],
    inherited: Map<string, Field[]>,
    schema: string,
    depth: number
  ): Promise<Field[]> {
    if (t[t.length - 1]?.value === ";") t = t.slice(0, -1);
    if (depth > 16) unsupported("视图或子查询层级过深");
    if (!t.length) unsupported("空查询");
    if (t[0].value === "(" && matching(t, 0) === t.length - 1)
      return this.query(t.slice(1, -1), inherited, schema, depth + 1);
    const ctes = new Map(inherited);
    let start = 0;
    if (word(t[0]) === "WITH") {
      start = 1;
      if (word(t[start]) === "RECURSIVE") unsupported("递归 CTE 的输出来源不明确");
      while (start < t.length) {
        const cte = t[start++];
        if (!isName(cte)) unsupported("无效 CTE 名称");
        if (t[start]?.value === "(") unsupported("CTE 列名重映射暂不支持");
        if (word(t[start++]) !== "AS" || t[start]?.value !== "(") unsupported("无效 CTE");
        const end = matching(t, start);
        ctes.set(
          name(cte, this.dialect),
          await this.query(t.slice(start + 1, end), ctes, schema, depth + 1)
        );
        start = end + 1;
        if (t[start]?.value !== ",") break;
        start++;
      }
    }
    if (word(t[start]) !== "SELECT") unsupported("隐私模式仅执行可追溯的 SELECT");
    const setAt = topKeyword(t, start + 1, new Set(["UNION", "INTERSECT", "EXCEPT", "MINUS"]));
    if (setAt < t.length) {
      let rhs = setAt + 1;
      if (word(t[rhs]) === "ALL" || word(t[rhs]) === "DISTINCT") rhs++;
      const left = await this.query(t.slice(start, setAt), ctes, schema, depth + 1);
      const right = await this.query(t.slice(rhs), ctes, schema, depth + 1);
      if (left.length !== right.length) unsupported("集合查询列数不一致");
      return left.map((f, i) => ({
        name: f.name,
        origins: unique([...f.origins, ...right[i].origins]),
      }));
    }
    let projectionStart = start + 1;
    if (["ALL", "DISTINCT"].includes(word(t[projectionStart]))) projectionStart++;
    const from = topKeyword(t, projectionStart, new Set(["FROM"]));
    const beforeFrom = topKeyword(
      t,
      projectionStart,
      new Set(["WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "FETCH", "FOR", "WINDOW"])
    );
    if (beforeFrom < from) unsupported("无效 SELECT 子句");
    const projection = t.slice(projectionStart, Math.min(from, beforeFrom));
    const fromEnd =
      from < t.length
        ? topKeyword(
            t,
            from + 1,
            new Set([
              "WHERE",
              "GROUP",
              "HAVING",
              "ORDER",
              "LIMIT",
              "OFFSET",
              "FETCH",
              "FOR",
              "WINDOW",
            ])
          )
        : from;
    const sources =
      from < t.length ? await this.sources(t.slice(from + 1, fromEnd), ctes, schema, depth) : [];
    const result: Field[] = [];
    for (const chunk of splitTop(projection, ",")) {
      const as = topKeyword(chunk, 0, new Set(["AS"]));
      if (as < chunk.length && as !== chunk.length - 2) unsupported("无效输出别名");
      const expr = as < chunk.length ? chunk.slice(0, as) : chunk;
      const alias = as < chunk.length ? name(chunk[as + 1], this.dialect) : undefined;
      if (expr.length === 1 && expr[0].value === "*") {
        if (!sources.length) unsupported("无法展开 SELECT *");
        result.push(...sources.flatMap((s) => s.fields));
        continue;
      }
      if (expr.length === 3 && isName(expr[0]) && expr[1].value === "." && expr[2].value === "*") {
        const source = sources.find((s) => s.alias === name(expr[0], this.dialect));
        if (!source) throw new PrivacyError("PRIVACY_QUERY_UNSUPPORTED", "无法展开表别名.*");
        result.push(...source.fields);
        continue;
      }
      const origins = await this.expression(expr, sources, ctes, schema, depth);
      const inferred =
        expr.length === 1 && isName(expr[0])
          ? name(expr[0], this.dialect)
          : expr.length === 3 && expr[1].value === "."
            ? name(expr[2], this.dialect)
            : "";
      result.push({ name: alias ?? inferred, origins });
    }
    return result;
  }

  private async sources(
    t: Token[],
    ctes: Map<string, Field[]>,
    schema: string,
    depth: number
  ): Promise<Source[]> {
    const out: Source[] = [];
    let i = 0;
    while (i < t.length) {
      const w = word(t[i]);
      if (
        [
          "LEFT",
          "RIGHT",
          "FULL",
          "INNER",
          "CROSS",
          "OUTER",
          "NATURAL",
          "JOIN",
          "LATERAL",
          "APPLY",
        ].includes(w) ||
        t[i].value === ","
      ) {
        i++;
        continue;
      }
      if (w === "ON" || w === "USING") {
        i++;
        while (
          i < t.length &&
          t[i].value !== "," &&
          !["JOIN", "LEFT", "RIGHT", "FULL", "INNER", "CROSS", "NATURAL"].includes(word(t[i]))
        ) {
          if (t[i].value === "(") i = matching(t, i) + 1;
          else i++;
        }
        continue;
      }
      let fields: Field[];
      let relationName: string;
      if (t[i].value === "(") {
        const end = matching(t, i);
        fields = await this.query(t.slice(i + 1, end), ctes, schema, depth + 1);
        relationName = "";
        i = end + 1;
      } else {
        if (!isName(t[i])) unsupported("无法解析 FROM 对象");
        relationName = name(t[i++], this.dialect);
        let explicitSchema: string | undefined;
        if (t[i]?.value === ".") {
          explicitSchema = relationName;
          i++;
          if (!isName(t[i])) unsupported("无效表名");
          relationName = name(t[i++], this.dialect);
        }
        if (!explicitSchema && ctes.has(relationName)) fields = ctes.get(relationName)!;
        else {
          const relation = await this.lookup(
            relationName,
            explicitSchema ?? (schema === this.defaultSchema ? undefined : schema)
          );
          if (!relation)
            throw new PrivacyError("PRIVACY_QUERY_UNSUPPORTED", `无法解析对象 ${relationName}`);
          if (relation.viewSql) {
            const viewFields = await this.query(
              tokenize(relation.viewSql),
              new Map(),
              relation.schema,
              depth + 1
            );
            if (viewFields.length !== relation.columns.length)
              unsupported(`视图 ${relationName} 输出列数无法对应`);
            fields = relation.columns.map((col, n) => ({
              name: col,
              origins: viewFields[n].origins,
            }));
          } else
            fields = relation.columns.map((col) => ({
              name: col,
              origins: [{ schema: relation.schema, table: relation.table, column: col }],
            }));
        }
      }
      if (word(t[i]) === "AS") i++;
      let alias = relationName;
      if (
        isName(t[i]) &&
        ![
          "ON",
          "USING",
          "JOIN",
          "LEFT",
          "RIGHT",
          "FULL",
          "INNER",
          "CROSS",
          "NATURAL",
          "WHERE",
        ].includes(word(t[i]))
      )
        alias = name(t[i++], this.dialect);
      if (!alias) unsupported("派生表必须命名");
      out.push({ alias, fields });
    }
    return out;
  }

  private async expression(
    t: Token[],
    sources: Source[],
    ctes: Map<string, Field[]>,
    schema: string,
    depth: number
  ): Promise<ColumnOrigin[]> {
    const origins: ColumnOrigin[] = [];
    for (let i = 0; i < t.length; i++) {
      const item = t[i];
      if (item.kind === "literal") continue;
      if (item.value === "(") {
        const end = matching(t, i);
        const inner = t.slice(i + 1, end);
        if (word(inner[0]) === "SELECT" || word(inner[0]) === "WITH") {
          const fields = await this.query(inner, ctes, schema, depth + 1);
          origins.push(...fields.flatMap((f) => f.origins));
        } else origins.push(...(await this.expression(inner, sources, ctes, schema, depth + 1)));
        i = end;
        continue;
      }
      if (!isName(item)) continue;
      const keyword = word(item);
      if (exprWords.has(keyword)) continue;
      let functionNameAt = i;
      while (t[functionNameAt + 1]?.value === "." && isName(t[functionNameAt + 2]))
        functionNameAt += 2;
      if (t[functionNameAt + 1]?.value === "(") {
        const end = matching(t, functionNameAt + 1);
        const args = t.slice(functionNameAt + 2, end);
        if (word(t[functionNameAt]) === "CAST") {
          const as = topKeyword(args, 0, new Set(["AS"]));
          if (as === args.length) unsupported("CAST 缺少目标类型");
          origins.push(
            ...(await this.expression(args.slice(0, as), sources, ctes, schema, depth + 1))
          );
        } else if (
          args.length &&
          !(word(t[functionNameAt]) === "COUNT" && args.length === 1 && args[0].value === "*")
        ) {
          for (const arg of splitTop(args, ","))
            origins.push(...(await this.expression(arg, sources, ctes, schema, depth + 1)));
        }
        i = end;
        continue;
      }
      if (t[i + 1]?.value === "::") {
        origins.push(...this.column(item, sources));
        i += 2;
        continue;
      }
      if (t[i + 1]?.value === ".") {
        if (!isName(t[i + 2])) unsupported("无法追溯字段");
        origins.push(...this.column(t[i + 2], sources, name(item, this.dialect)));
        i += 2;
        continue;
      }
      origins.push(...this.column(item, sources));
    }
    return unique(origins);
  }

  private column(t: Token, sources: Source[], alias?: string): ColumnOrigin[] {
    const candidates = sources
      .filter((s) => !alias || s.alias === alias)
      .flatMap((s) => s.fields.filter((f) => f.name === name(t, this.dialect)));
    if (candidates.length !== 1) unsupported(`无法唯一确定输出字段 ${t.value}`);
    return candidates[0].origins;
  }
}
