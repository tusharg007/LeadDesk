import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { DemoRepository } from './demo-repository.js';
import { SupabaseRepository } from './supabase-repository.js';

const mode = process.env.APP_MODE || 'demo';
if (mode !== 'demo' && mode !== 'supabase') throw new Error('APP_MODE must be demo or supabase.');
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See .env.example.`);
  return value;
};
const host = process.env.HOST || '127.0.0.1';
if (mode === 'demo' && !['127.0.0.1', 'localhost', '::1'].includes(host))
  throw new Error(
    'Demo mode has no authentication and must bind to loopback. Use Supabase mode for deployment.',
  );
if (process.env.N8N_WEBHOOK_URL && (process.env.AGENT_SIGNING_SECRET?.length || 0) < 32)
  throw new Error('Set AGENT_SIGNING_SECRET to at least 32 random characters.');
const supabase =
  mode === 'supabase'
    ? new SupabaseRepository({
        url: required('SUPABASE_URL'),
        key: required('SUPABASE_PUBLISHABLE_KEY'),
        serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
      })
    : undefined;
const app = createApp({
  mode,
  repo: supabase || new DemoRepository(resolve('.data/demo.json')),
  authenticate: supabase ? (token) => supabase.authenticate(token) : undefined,
  supabaseUrl: mode === 'supabase' ? process.env.SUPABASE_URL : undefined,
  supabaseKey: mode === 'supabase' ? process.env.SUPABASE_PUBLISHABLE_KEY : undefined,
  n8nUrl: process.env.N8N_WEBHOOK_URL,
  n8nSecret: process.env.N8N_WEBHOOK_SECRET,
  signingSecret: process.env.AGENT_SIGNING_SECRET,
  publicUrl: process.env.API_PUBLIC_URL,
});
if (existsSync(resolve('dist/index.html'))) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
}
const server = app.listen(Number(process.env.PORT || 3001), host, () =>
  console.log(`LeadDesk API · ${mode} mode · http://${host}:${process.env.PORT || 3001}`),
);
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
