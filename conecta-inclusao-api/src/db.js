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
    return [result.rows, result.fields];
  },

  async query(query, params = []) {
    const { text, values } = convertPlaceholders(query, params);
    const result = await pgPool.query(text, values);
    return result;
  },

  async end() {
    return pgPool.end();
  }
};