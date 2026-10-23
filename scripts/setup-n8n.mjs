import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const target = new URL('../n8n/.env', import.meta.url);
const names = ['N8N_ENCRYPTION_KEY', 'N8N_WEBHOOK_SECRET', 'AGENT_SIGNING_SECRET'];
try {
  const existing = parse(await readFile(target, 'utf8'));
  if (names.some((name) => !existing[name] || existing[name].length < 32)) {
    throw new Error(
      'n8n/.env exists but has missing/short secrets. Inspect it locally; nothing was overwritten.',
    );
  }
  console.log('n8n/.env already configured. Existing secrets preserved.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeFile(
    target,
    '# Local secrets. Keep this file and your n8n data volume together when backing up.\n' +
      names.map((name) => `${name}=${randomBytes(32).toString('hex')}`).join('\n') +
      '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log(`Created ${fileURLToPath(target)}. Secrets are not printed or committed.`);
}
console.log('Start: docker compose --project-directory n8n up -d');
console.log('Editor: http://localhost:5678');
