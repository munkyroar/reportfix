// Runs server + client together without extra dependencies.
import { spawn } from 'node:child_process';

const procs = [
  ['server', 'npm run dev -w server'],
  ['client', 'npm run dev -w client'],
].map(([name, cmd]) => {
  const p = spawn(cmd, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  const tag = (s) => s.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  p.stdout.on('data', (d) => process.stdout.write(tag(d)));
  p.stderr.on('data', (d) => process.stderr.write(tag(d)));
  p.on('exit', (code) => { console.log(`[${name}] exited ${code}`); shutdown(); });
  return p;
});
function shutdown() { for (const p of procs) if (!p.killed) p.kill(); process.exit(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
