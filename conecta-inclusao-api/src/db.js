import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

function buildConnectionString(env) {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }

  if (!env.DB_HOST || !env.DB_USER || !env.DB_NAME) {
    return null;
  }

  const port = env.DB_PORT || 5432;
  const password = env.DB_PASS ? encodeURIComponent(env.DB_PASS) : "";
  return `postgresql://${encodeURIComponent(env.DB_USER)}:${password}@${env.DB_HOST}:${port}/${env.DB_NAME}`;
}

function convertPlaceholders(query, params = []) {
  const normalizedParams = Array.isArray(params) ? params : [params];
  let index = 0;
  const converted = query.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });

  return { query: converted, params: normalizedParams };
}

function buildCompatResult(result, rows, fields) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const rowCount = typeof result.rowCount === "number" ? result.rowCount : normalizedRows.length;
  const insertId = typeof result.rows?.[0]?.id === "number" ? result.rows[0].id : null;
  const compatResult = result.command === "SELECT"
    ? [normalizedRows, fields]
    : [{
        insertId,
        affectedRows: rowCount,
        rowCount,
        command: result.command,
        fields,
        rows: normalizedRows
      }, fields];

  compatResult.rows = normalizedRows;
  compatResult.fields = fields;
  compatResult.insertId = insertId;
  compatResult.affectedRows = rowCount;
  compatResult.rowCount = rowCount;
  compatResult.command = result.command;

  return compatResult;
}

async function runQuery(client, query, params = []) {
  const { query: convertedQuery, params: normalizedParams } = convertPlaceholders(query, params);
  const result = await client.query(convertedQuery, normalizedParams);
  const rows = Array.isArray(result.rows) ? result.rows : [];
  return buildCompatResult(result, rows, result.fields || []);
}

function createClientWrapper(client) {
  return {
    async query(query, params) {
      return runQuery(client, query, params);
    },
    async execute(query, params) {
      return runQuery(client, query, params);
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
    release() {
      client.release();
    }
  };
}

const connectionString = buildConnectionString(process.env);

const pgPool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.DATABASE_URL?.includes("neon.tech") || process.env.PGSSLMODE === "require"
    ? { rejectUnauthorized: false }
    : false
});

export const pool = {
  async query(query, params) {
    const client = await pgPool.connect();
    try {
      return runQuery(client, query, params);
    } finally {
      client.release();
    }
  },
  async execute(query, params) {
    const client = await pgPool.connect();
    try {
      return runQuery(client, query, params);
    } finally {
      client.release();
    }
  },
  async getConnection() {
    const client = await pgPool.connect();
    return createClientWrapper(client);
  },
  async end() {
    return pgPool.end();
  }
};
