import { describe, expect, it } from "vitest";
import { PostgresConnector } from "../connectors/postgres/index.js";

describe("PostgreSQL privacy startup", () => {
  it("rejects an init script that this connector would otherwise ignore", async () => {
    const connector = new PostgresConnector();
    await expect(connector.connect("postgres://unused:unused@localhost/unused", "SELECT 1", {
      privacy: { enabled: true, blocked_columns: [{ schema: "public", table: "people", columns: ["id_card"] }] },
    })).rejects.toThrow("PRIVACY_QUERY_UNSUPPORTED");
  });
});
