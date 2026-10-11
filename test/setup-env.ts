import { e2eDatabaseUrl } from './e2e-database';

// A LOG_LEVEL from the developer's .env would flood the test output; E2E_LOG_LEVEL opts back in.
process.env.LOG_LEVEL = process.env.E2E_LOG_LEVEL ?? 'warn';
process.env.DATABASE_URL = e2eDatabaseUrl();
