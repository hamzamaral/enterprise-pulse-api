import { e2eDatabaseUrl } from './e2e-database';

process.env.LOG_LEVEL ??= 'warn';
process.env.DATABASE_URL = e2eDatabaseUrl();
