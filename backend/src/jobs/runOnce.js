// Run a single refresh cycle from the CLI: `npm run refresh`
import 'dotenv/config';
import { initDb } from '../db/database.js';
import { runRefresh } from './refresh.js';

const dbPath = process.env.DATABASE_PATH ?? './data/radar.db';
initDb(dbPath);

const summary = await runRefresh();
console.log('Refresh summary:', summary);
process.exit(summary.errors.length ? 1 : 0);
