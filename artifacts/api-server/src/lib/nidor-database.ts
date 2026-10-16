import { Pool } from "pg";

let nidorPool: Pool | undefined;

export function getNidorDatabasePool(): Pool | null {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) return null;
  nidorPool ??= new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });
  return nidorPool;
}
