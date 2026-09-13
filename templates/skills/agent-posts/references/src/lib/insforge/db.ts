import "server-only";
import { Pool } from "pg";

// Singleton pool — survives hot-reload in dev via globalThis.
const globalForPg = globalThis as unknown as { _mosPool?: Pool };

export const dbConfigured = Boolean(process.env.DATABASE_URL);

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (Insforge Postgres connection).");
  }
  if (!globalForPg._mosPool) {
    globalForPg._mosPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 10_000,
      query_timeout: 8000,
      statement_timeout: 8000,
    });
  }
  return globalForPg._mosPool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}
