// Runs the same attack suite against the real LLM from ../../.env
process.env.ATTACK_LIVE = '1';
await import('./attack.test.js');
