import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { OracleDbContainer, type StartedOracleDbContainer } from "@testcontainers/oraclefree";
import { PostgresConnector } from "../connectors/postgres/index.js";
import { OracleConnector } from "../connectors/oracle/index.js";
import type { Connector } from "../connectors/interface.js";

const privacy = (schema: string, table: string) => ({
  enabled: true,
  blocked_columns: [{ schema, table, columns: [schema === "TEST" ? "ID_CARD" : "id_card"] }],
});

async function verify(connector: Connector, dsn: string, schema: string, table: string) {
  await connector.connect(dsn);
  await connector.executeSQL(`CREATE TABLE ${table} (emp_no VARCHAR(20), id_card VARCHAR(30))`, {});
  await connector.executeSQL(`INSERT INTO ${table} VALUES ('A001', 'synthetic-secret')`, {});
  await connector.executeSQL(
    `CREATE VIEW privacy_view AS SELECT emp_no, id_card AS private_value FROM ${table}`,
    {}
  );
  await connector.disconnect();

  await connector.connect(dsn, undefined, { privacy: privacy(schema, table) });
  const safe = await connector.executeSQL(
    `SELECT emp_no FROM ${table} WHERE id_card = 'synthetic-secret'`,
    { readonly: true }
  );
  expect(safe.resultSets[0].rowCount).toBe(1);
  await expect(
    connector.executeSQL(`SELECT id_card FROM ${table}`, { readonly: true })
  ).rejects.toThrow("PRIVACY_SELECT_DENIED");
  await expect(
    connector.executeSQL(`SELECT private_value FROM privacy_view`, { readonly: true })
  ).rejects.toThrow("PRIVACY_SELECT_DENIED");
  await expect(connector.executeSQL(`SELECT * FROM ${table}`, { readonly: true })).rejects.toThrow(
    "PRIVACY_SELECT_DENIED"
  );
  await expect(
    connector.executeSQL(`SELECT emp_no FROM ${table}; SELECT id_card FROM ${table}`, {
      readonly: true,
    })
  ).rejects.toThrow("PRIVACY_SELECT_DENIED");
  await connector.disconnect();
}

describe("PostgreSQL privacy connector", () => {
  let container: StartedPostgreSqlContainer;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:15-alpine").start();
  }, 180_000);
  afterAll(async () => {
    await container?.stop();
  });
  it("guards real table and view output", async () => {
    await verify(new PostgresConnector(), container.getConnectionUri(), "public", "privacy_people");
  }, 120_000);
});

describe("Oracle privacy connector", () => {
  let container: StartedOracleDbContainer;
  beforeAll(async () => {
    container = await new OracleDbContainer("gvenzl/oracle-free:23-slim-faststart")
      .withUsername("test")
      .withPassword("test")
      .withStartupTimeout(300_000)
      .start();
  }, 360_000);
  afterAll(async () => {
    await container?.stop();
  });
  it("guards real table and view output", async () => {
    const dsn = `oracle://test:test@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
    await verify(new OracleConnector(), dsn, "TEST", "PRIVACY_PEOPLE");
  }, 120_000);
});
