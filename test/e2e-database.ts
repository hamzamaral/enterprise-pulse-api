import { config } from 'dotenv';

/**
 * E2E tests run against a sibling database (`<name>_e2e`) so they never pollute the demo data.
 * Override with DATABASE_URL_E2E.
 */
export function e2eDatabaseUrl(): string {
  config({ quiet: true });
  if (process.env.DATABASE_URL_E2E) return process.env.DATABASE_URL_E2E;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set');
  const url = new URL(base);
  const name = url.pathname.slice(1);
  if (!name.endsWith('_e2e')) url.pathname = `/${name}_e2e`;
  return url.toString();
}
