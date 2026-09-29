import { describe, expect, it, vi } from "vitest";
import { OracleConnector } from "../connectors/oracle/index.js";

describe("Oracle connector privacy boundary", () => {
  it("never sends a denied business SELECT to the driver", async () => {
    const connector = new OracleConnector();
    const execute = vi.fn(async (sql: string, binds?: { name?: string }) => {
      if (sql.includes("all_objects") && binds?.name === "PRIVACY_VIEW")
        return {
          rows: [
            {
              OWNER: "TEST",
              OBJECT_NAME: "PRIVACY_VIEW",
              COLUMN_NAME: "EMP_NO",
              OBJECT_TYPE: "VIEW",
              TEXT_VC: "SELECT EMP_NO, ID_CARD AS PRIVATE_VALUE FROM PEOPLE",
            },
            {
              OWNER: "TEST",
              OBJECT_NAME: "PRIVACY_VIEW",
              COLUMN_NAME: "PRIVATE_VALUE",
              OBJECT_TYPE: "VIEW",
              TEXT_VC: "SELECT EMP_NO, ID_CARD AS PRIVATE_VALUE FROM PEOPLE",
            },
          ],
        };
      if (sql.includes("all_objects"))
        return {
          rows: [
            {
              OWNER: "TEST",
              OBJECT_NAME: "PEOPLE",
              COLUMN_NAME: "EMP_NO",
              OBJECT_TYPE: "TABLE",
              TEXT_VC: null,
            },
            {
              OWNER: "TEST",
              OBJECT_NAME: "PEOPLE",
              COLUMN_NAME: "ID_CARD",
              OBJECT_TYPE: "TABLE",
              TEXT_VC: null,
            },
          ],
        };
      if (sql === "SET TRANSACTION READ ONLY") return {};
      return { rows: [{ EMP_NO: "A001" }] };
    });
    const connection = { execute, close: vi.fn(), rollback: vi.fn(), commit: vi.fn() };
    (connector as any).pool = { getConnection: vi.fn(async () => connection) };
    (connector as any).defaultSchema = "TEST";
    (connector as any).privacyConfig = {
      enabled: true,
      blocked_columns: [{ schema: "TEST", table: "PEOPLE", columns: ["ID_CARD"] }],
    };

    await expect(
      connector.executeSQL("SELECT ID_CARD FROM PEOPLE", { readonly: true })
    ).rejects.toThrow("PRIVACY_SELECT_DENIED");
    expect(execute.mock.calls[0][0]).toBe("SET TRANSACTION READ ONLY");
    expect(execute.mock.calls.some(([sql]) => sql.includes("SELECT ID_CARD FROM PEOPLE"))).toBe(
      false
    );
    await expect(
      connector.executeSQL("SELECT PRIVATE_VALUE FROM PRIVACY_VIEW", { readonly: true })
    ).rejects.toThrow("PRIVACY_SELECT_DENIED");
    expect(
      execute.mock.calls.some(([sql]) => sql.includes("SELECT PRIVATE_VALUE FROM PRIVACY_VIEW"))
    ).toBe(false);

    const safe = await connector.executeSQL(
      "SELECT EMP_NO FROM PEOPLE WHERE ID_CARD = :id",
      { readonly: true },
      ["synthetic"]
    );
    expect(safe.resultSets[0].rows).toEqual([{ EMP_NO: "A001" }]);
    expect(execute.mock.calls.some(([sql]) => sql.includes("SELECT EMP_NO FROM PEOPLE"))).toBe(
      true
    );
  });
});
