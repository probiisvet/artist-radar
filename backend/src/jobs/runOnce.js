// Run a single refresh cycle from the CLI: `npm run refresh`
import 'dotenv/config';
import { initDb } from '../db/database.js';
import { runRefresh } from './refresh.js';

await initDb();

const summary = await runRefresh();
console.log('Refresh summary:', summary);
process.exit(summary.errors.length ? 1 : 0);
