import { config } from 'dotenv';
import * as path from 'path';
import { reportingDataDir } from './reporting-data-dir';

/** Loads `<REPORTING_DATA_DIR>/.env` for the maintenance scripts — the same file the API reads. */
config({ path: path.join(reportingDataDir(), '.env') });
