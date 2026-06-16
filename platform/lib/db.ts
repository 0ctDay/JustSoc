import { Pool } from 'pg';

const connectionString = process.env.SELK_PLATFORM_DATABASE_URL
  ?? process.env.CONTROLPLANE_DATASOURCE_URL?.replace(/^jdbc:/, '')
  ?? 'postgresql://postgres:<change-me>@localhost:5432/selk_controlplane';

const globalForDb = globalThis as typeof globalThis & { __justsocPgPool?: Pool };

export const db = globalForDb.__justsocPgPool ?? new Pool({
  connectionString,
  max: 5,
});

if (!globalForDb.__justsocPgPool) {
  globalForDb.__justsocPgPool = db;
}
