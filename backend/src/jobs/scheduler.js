import cron from 'node-cron';
import { runRefresh } from './refresh.js';

let task = null;

export function startScheduler() {
  const expr = process.env.REFRESH_CRON ?? '0 9 * * *'; // daily 09:00 local
  if (!cron.validate(expr)) {
    console.warn(`[cron] invalid REFRESH_CRON "${expr}" – falling back to daily 09:00`);
  }
  const validExpr = cron.validate(expr) ? expr : '0 9 * * *';

  task = cron.schedule(validExpr, async () => {
    console.log('[cron] running scheduled refresh');
    try {
      const summary = await runRefresh();
      console.log('[cron] refresh complete', summary);
    } catch (err) {
      console.error('[cron] refresh failed:', err);
    }
  });

  console.log(`[cron] scheduled refresh with expression "${validExpr}"`);
  return task;
}

export function stopScheduler() {
  task?.stop();
  task = null;
}
