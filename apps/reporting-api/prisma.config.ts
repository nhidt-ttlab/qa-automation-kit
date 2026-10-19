import { config } from 'dotenv';
import path from 'node:path';

// A deploying project may keep its .env outside this app; see src/common/reporting-data-dir.ts.
config({ path: path.join(process.env.REPORTING_DATA_DIR ?? process.cwd(), '.env') });
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
