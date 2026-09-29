import { describe, expect, it, vi } from "vitest";
import { SelectGuard, type Dialect, type Relation } from "./select-guard.js";

const make = (dialect: Dialect) => {
  const fold = (value: string) =>
    dialect === "postgres" ? value.toLowerCase() : value.toUpperCase();
  const secret: Relation = {
    schema: fold("sample"),
    table: fold("personnel"),
    columns: [fold("emp_no"), fold("id_card"), fold("amount")],
  };
  const view: Relation = {
    schema: fold("sample"),
    table: fold("person_view"),
    columns: [fold("emp_no"), fold("private_value")],
    viewSql: "SELECT emp_no, id_card AS private_value FROM sample.personnel",
  };
  const lookup = vi.fn(
    async (table: string) => [secret, view].find((r) => r.table === table) ?? null
  );
  const guard = new SelectGuard(
    dialect,
    {
      enabled: true,
      blocked_columns: [
        { schema: secret.schema, table: secret.table, columns: [fold("id_card"), fold("amount")] },
      ],
      blocked_functions: ["decrypt_one", "decrypt_secret", "decrypt_two"],
    },
    lookup,
    secret.schema
  );
  return { guard, lookup };
};

for (const dialect of ["postgres", "oracle"] as const) {
  describe(`${dialect} SELECT output`, () => {
    it("preserves disabled-policy behavior", async () => {
      const lookup = vi.fn();
      const guard = new SelectGuard(
        dialect,
        { enabled: false },
        lookup,
        dialect === "postgres" ? "public" : "TEST"
      );
      await expect(guard.check("SELECT anything FROM anywhere")).resolves.toBeUndefined();
      expect(lookup).not.toHaveBeenCalled();
    });
    it("allows a protected predicate while returning only a public field", async () => {
      await expect(
        make(dialect).guard.check(
          "SELECT emp_no FROM sample.personnel WHERE id_card = 'test' ORDER BY id_card"
        )
      ).resolves.toBeUndefined();
      await expect(
        make(dialect).guard.check("SELECT COUNT(*) FROM sample.personnel")
      ).resolves.toBeUndefined();
      await expect(
        make(dialect).guard.check(
          "SELECT p.emp_no FROM sample.personnel p JOIN sample.personnel q ON p.id_card = q.id_card GROUP BY p.emp_no HAVING COUNT(*) > 0 ORDER BY MIN(q.id_card)"
        )
      ).resolves.toBeUndefined();
      await expect(
        make(dialect).guard.check(
          "WITH x AS (SELECT emp_no FROM sample.personnel WHERE id_card = 'test') SELECT * FROM x"
        )
      ).resolves.toBeUndefined();
    });
    it.each([
      "SELECT id_card FROM sample.personnel",
      "SELECT id_card AS hidden FROM sample.personnel",
      "SELECT SUBSTR(id_card, 1, 3) FROM sample.personnel",
      "SELECT CAST(id_card AS VARCHAR(30)) FROM sample.personnel",
      "SELECT SUM(amount) FROM sample.personnel",
      "SELECT * FROM sample.personnel",
      "SELECT p.* FROM sample.personnel p",
      "WITH x AS (SELECT id_card FROM sample.personnel) SELECT * FROM x",
      "SELECT private_value FROM sample.person_view",
      "SELECT emp_no FROM sample.personnel UNION ALL SELECT id_card FROM sample.personnel",
    ])("rejects protected output: %s", async (sql) => {
      await expect(make(dialect).guard.check(sql)).rejects.toThrow("PRIVACY_SELECT_DENIED");
    });
    it("honors quoted catalog spelling", async () => {
      const quoted = dialect === "postgres" ? '"sample"."personnel"' : '"SAMPLE"."PERSONNEL"';
      const column = dialect === "postgres" ? '"id_card"' : '"ID_CARD"';
      await expect(make(dialect).guard.check(`SELECT ${column} FROM ${quoted}`)).rejects.toThrow(
        "PRIVACY_SELECT_DENIED"
      );
    });
    it("allows unlisted functions but still traces their protected arguments", async () => {
      await expect(make(dialect).guard.check("SELECT md5('demo')")).resolves.toBeUndefined();
      await expect(
        make(dialect).guard.check("SELECT mystery(id_card) FROM sample.personnel")
      ).rejects.toThrow("PRIVACY_SELECT_DENIED");
      await expect(
        make(dialect).guard.check("SELECT md5(id_card) FROM sample.personnel")
      ).rejects.toThrow("PRIVACY_SELECT_DENIED");
      await expect(
        make(dialect).guard.check("SELECT sample.md5(emp_no) FROM sample.personnel")
      ).resolves.toBeUndefined();
    });
    it("blocks configured functions anywhere in the query without matching comments or literals", async () => {
      await expect(make(dialect).guard.check("SELECT decrypt_one('demo')")).rejects.toThrow("PRIVACY_SELECT_DENIED");
      await expect(make(dialect).guard.check("SELECT sample.decrypt_two('demo')")).rejects.toThrow("PRIVACY_SELECT_DENIED");
      await expect(make(dialect).guard.check("SELECT emp_no FROM sample.personnel WHERE pkg.decrypt_secret(emp_no) = 'x'")).rejects.toThrow("PRIVACY_SELECT_DENIED");
      await expect(make(dialect).guard.check("SELECT 'decrypt_one(x)' /* decrypt_secret(x) */" )).resolves.toBeUndefined();
    });
    it("rejects an unresolved output source", async () => {
      await expect(
        make(dialect).guard.check("SELECT private_value FROM sample.unknown_view")
      ).rejects.toThrow("PRIVACY_QUERY_UNSUPPORTED");
    });
    it("checks all statements before any business execution", async () => {
      const { guard, lookup } = make(dialect);
      await expect(
        guard.check("SELECT emp_no FROM sample.personnel; SELECT id_card FROM sample.personnel")
      ).rejects.toThrow("PRIVACY_SELECT_DENIED");
      expect(lookup).toHaveBeenCalled();
    });
    it("rejects session search path changes that would invalidate source resolution", async () => {
      await expect(
        make(dialect).guard.check(
          "SELECT 1 FROM sample.personnel WHERE set_config('search_path', 'other', false) IS NOT NULL"
        )
      ).rejects.toThrow("PRIVACY_QUERY_UNSUPPORTED");
    });
    it("keeps EXPLAIN on its existing path", async () => {
      const { guard, lookup } = make(dialect);
      await expect(
        guard.check("EXPLAIN SELECT id_card FROM sample.personnel")
      ).resolves.toBeUndefined();
      expect(lookup).not.toHaveBeenCalled();
    });
  });
}
