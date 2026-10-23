import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import {
  leadInput,
  leadUpdate,
  recommendationSchema,
  decisionInput,
  type Context,
} from '../shared/types.js';
import type { Repository } from './repository.js';
import {
  AppError,
  dashboard,
  demoQualification,
  signRun,
  verifyRun,
  validateEvidence,
} from './domain.js';
import { demoContext } from './seed.js';

export type AppOptions = {
  repo: Repository;
  mode: 'demo' | 'supabase';
  authenticate?: (token: string) => Promise<Context>;
  supabaseUrl?: string;
  supabaseKey?: string;
  n8nUrl?: string;
  n8nSecret?: string;
  signingSecret?: string;
  publicUrl?: string;
};
export function createApp(options: AppOptions) {
  const { repo, mode } = options;
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'connect-src': ["'self'", ...(options.supabaseUrl ? [options.supabaseUrl] : [])],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
        },
      },
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode }));
  app.get('/api/config', (_req, res) =>
    res.json({
      mode,
      supabaseUrl: options.supabaseUrl || '',
      supabaseKey: options.supabaseKey || '',
    }),
  );

  const agentEnabled =
    mode === 'demo' ||
    Boolean(options.n8nUrl && options.n8nSecret && options.signingSecret && options.publicUrl);
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please wait a minute.' },
    }),
  );

  // Signed authorization is scoped to a single run and expires after 15 minutes.
  app.use('/api/internal/runs/:id', (req, _res, next) => {
    try {
      verifyRun(
        req.headers.authorization?.replace(/^Bearer /, '') || '',
        req.params.id,
        options.signingSecret || '',
      );
      next();
    } catch (err) {
      next(err);
    }
  });
  app.post('/api/internal/runs/:id/tools/:tool', async (req, res) => {
    const run = await repo.getRun(req.params.id);
    if (run.status !== 'running') throw new AppError(409, 'This run is no longer active.');
    const data = await repo.agentSnapshot(run);
    const lead = data.leads[0];
    if (!lead || lead.revision !== run.lead_revision)
      throw new AppError(409, 'Lead changed during qualification.');
    if (req.params.tool === 'context') {
      z.object({ context_request: z.literal('current_lead').optional() })
        .strict()
        .parse(req.body);
      return res.json({
        lead,
        recent_activity: data.activities.slice(0, 10),
        open_tasks: data.tasks.filter((t) => !t.completed_at),
      });
    }
    if (req.params.tool === 'knowledge') {
      const { query } = z.object({ query: z.string().trim().min(1).max(200) }).parse(req.body);
      const terms = query
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 2);
      const matches = data.knowledge
        .map((k) => ({
          ...k,
          score: terms.filter((t) =>
            `${k.title} ${k.content} ${k.keywords.join(' ')}`.toLowerCase().includes(t),
          ).length,
        }))
        .filter((k) => k.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      return res.json({ sources: matches });
    }
    throw new AppError(404, 'Unknown tool.');
  });
  app.post('/api/internal/runs/:id/result', async (req, res) => {
    const run = await repo.getRun(req.params.id);
    if (run.status !== 'running') return res.json({ ok: true });
    try {
      const result = recommendationSchema.parse(req.body);
      const data = await repo.agentSnapshot(run);
      validateEvidence(result, data.leads[0], data.knowledge);
      await repo.finishRun(run.id, result);
      res.json({ ok: true });
    } catch (error) {
      await repo.failRun(
        run.id,
        'Qualification could not be validated. Review the lead and try again.',
      );
      throw error;
    }
  });
  // Unknown internal routes must not fall through to the normal user API.
  app.post('/api/internal/runs/:id/failure', async (req, res) => {
    await repo.getRun(req.params.id);
    await repo.failRun(
      req.params.id,
      'The qualification workflow failed. Check its execution in n8n, then try again.',
    );
    res.json({ ok: true });
  });
  app.use('/api/internal', (_req, res) =>
    res.status(404).json({ error: 'Unknown internal endpoint.' }),
  );

  app.use('/api', async (req, res, next) => {
    if (mode === 'demo') {
      res.locals.ctx = demoContext;
      return next();
    }
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token || !options.authenticate) throw new AppError(401, 'Sign in to continue.');
    res.locals.ctx = await options.authenticate(token);
    next();
  });
  app.get('/api/workspace', async (_req, res) => {
    const ctx = res.locals.ctx as Context;
    const data = await repo.snapshot(ctx);
    // Recover abandoned external executions without an additional scheduler.
    const expired = data.runs.filter(
      (r) => r.status === 'running' && Date.now() - Date.parse(r.created_at) > 15 * 60_000,
    );
    await Promise.all(
      expired.map((r) => repo.failRun(r.id, 'Qualification timed out. Please try again.')),
    );
    for (const run of expired) {
      run.status = 'failed';
      run.error = 'Qualification timed out. Please try again.';
    }
    const { token: _token, ...safeContext } = ctx;
    res.json({ ...data, context: safeContext, dashboard: dashboard(data), mode, agentEnabled });
  });
  app.post('/api/leads', async (req, res) =>
    res.status(201).json(await repo.createLead(res.locals.ctx, leadInput.parse(req.body))),
  );
  app.patch('/api/leads/:id/stage', async (req, res) => {
    const input = leadUpdate.parse(req.body);
    await repo.updateStage(res.locals.ctx, req.params.id, input.stage, input.revision);
    res.json({ ok: true });
  });
  app.post('/api/leads/:id/notes', async (req, res) => {
    const { message } = z.object({ message: z.string().trim().min(1).max(2000) }).parse(req.body);
    await repo.addNote(res.locals.ctx, req.params.id, message);
    res.status(201).json({ ok: true });
  });
  app.patch('/api/tasks/:id', async (req, res) => {
    const { complete } = z.object({ complete: z.boolean() }).parse(req.body);
    await repo.completeTask(res.locals.ctx, req.params.id, complete);
    res.json({ ok: true });
  });
  app.post(
    '/api/leads/:id/qualify',
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      message: { error: 'Please wait a minute before starting another qualification.' },
    }),
    async (req, res) => {
      if (!agentEnabled)
        throw new AppError(
          503,
          'Connect the n8n qualification workflow to enable the agent. See README.md.',
        );
      const run = await repo.createRun(
        res.locals.ctx,
        String(req.params.id),
        mode === 'demo' ? 'demo' : 'n8n',
      );
      if (mode === 'demo') {
        const data = await repo.agentSnapshot(run);
        await repo.finishRun(run.id, demoQualification(data.leads[0], data.knowledge));
      } else {
        try {
          const response = await fetch(options.n8nUrl!, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-LeadDesk-Secret': options.n8nSecret!,
            },
            body: JSON.stringify({
              run_id: run.id,
              api_url: options.publicUrl,
              run_token: signRun(run.id, options.signingSecret!),
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok) throw new Error('Webhook unavailable');
        } catch {
          await repo.failRun(
            run.id,
            'Could not start n8n. Check the workflow connection and try again.',
          );
          throw new AppError(
            502,
            'Could not reach the qualification workflow. Your lead is saved.',
          );
        }
      }
      res.status(202).json({ id: run.id });
    },
  );
  app.post('/api/reviews/:id/decision', async (req, res) => {
    await repo.decide(res.locals.ctx, req.params.id, decisionInput.parse(req.body));
    res.json({ ok: true });
  });
  app.get('/api/reviews/export', async (_req, res) => {
    const data = await repo.snapshot(res.locals.ctx);
    res.setHeader('Content-Disposition', 'attachment; filename="leaddesk-review-audit.json"');
    res.json({
      schema_version: 1,
      exported_at: new Date().toISOString(),
      scope: 'Reviews visible to the signed-in user',
      records: data.runs
        .filter((r) => ['approved', 'rejected'].includes(r.status))
        .map((r) => ({
          run_id: r.id,
          lead_id: r.lead_id,
          status: r.status,
          mode: r.mode,
          original_recommendation: r.recommendation,
          review: r.review_audit || null,
        })),
    });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof ZodError)
        return res
          .status(400)
          .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: 'Invalid JSON request.' });
      console.error(error instanceof Error ? error.message : 'Unexpected server error');
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    },
  );
  return app;
}
