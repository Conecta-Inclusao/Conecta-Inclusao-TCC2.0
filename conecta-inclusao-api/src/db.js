import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const connectionString = process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING || "";

function convertPlaceholders(query, params = []) {
  let index = 0;
  const convertedQuery = query.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });

  return { text: convertedQuery, values: params || [] };
}

function isWriteQuery(query) {
  const normalized = String(query).trim().split(/\s+/)[0].toUpperCase();
  return ["INSERT", "UPDATE", "DELETE"].includes(normalized);
}

function mapResult(result) {
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const firstRow = rows[0] || {};

  return {
    insertId: firstRow.id ?? null,
    affectedRows: result.rowCount ?? 0,
    changedRows: result.rowCount ?? 0,
    rowCount: result.rowCount ?? 0,
    rows
  };
}

const pgPool = new Pool({
  connectionString,
  ssl: connectionString.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined
});

export const pool = {
  async execute(query, params = []) {
    const { text, values } = convertPlaceholders(query, params);
    const result = await pgPool.query(text, values);

    if (isWriteQuery(query)) {
      return [mapResult(result), result.fields];
    }

    return [result.rows, result.fields];
  },

  async query(query, params = []) {
    const { text, values } = convertPlaceholders(query, params);
    return pgPool.query(text, values);
  },

  async getConnection() {
    const client = await pgPool.connect();

    return {
      async execute(query, params = []) {
        const { text, values } = convertPlaceholders(query, params);
        const result = await client.query(text, values);

        if (isWriteQuery(query)) {
          return [mapResult(result), result.fields];
        }

        return [result.rows, result.fields];
      },

      async query(query, params = []) {
        const { text, values } = convertPlaceholders(query, params);
        return client.query(text, values);
      },

      async beginTransaction() {
        await client.query("BEGIN");
      },

      async commit() {
        await client.query("COMMIT");
      },

      async rollback() {
        await client.query("ROLLBACK");
      },

      async release() {
        client.release();
      }
    };
  },

  async end() {
    return pgPool.end();
  }
};