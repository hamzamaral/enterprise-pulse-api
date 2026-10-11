import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl } from './e2e-database';

/** Creates, migrates and seeds the e2e database. Set E2E_RESET=1 to start from an empty database. */ export default async function globalSetup() {
  const url = new URL(e2eDatabaseUrl());
  const name = decodeURIComponent(url.pathname.slice(1));
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';

  const admin = new PrismaClient({ datasourceUrl: maintenance.toString() });
  try {
    if (process.env.E2E_RESET === '1') {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    const existing = await admin.$queryRaw<
      unknown[]
    >`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (!existing.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }

  // The seed is idempotent; re-running it keeps roles in sync with newly added permissions.
  const env = { ...process.env, DATABASE_URL: url.toString() };
  execSync('pnpm exec prisma migrate deploy', { env, stdio: 'ignore' });
  execSync('pnpm db:seed', { env, stdio: 'ignore' });
}
