import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of [path.join(here, '..', '..', '.env'), path.join(here, '..', '.env')]) {
  try { process.loadEnvFile(f); } catch { /* optional */ }
}

const { createApp } = await import('./app.js');
const { app } = createApp();
const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => {
  console.log(`ReportFix API on http://127.0.0.1:${port} (DEMO_MODE=${process.env.DEMO_MODE}, AI=${process.env.LLM_PROVIDER || 'none'})`);
});
