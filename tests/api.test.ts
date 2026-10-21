import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { DemoRepository } from '../server/demo-repository.js';
import { demoContext } from '../server/seed.js';
import { signRun, verifyRun, demoQualification, dashboard } from '../server/domain.js';

test('complete lead → qualification → approval → task flow, including repeat approval', async () => {
  const repo = new DemoRepository();
  const app = createApp({ repo, mode: 'demo' });
  const created = await request(app)
    .post('/api/leads')
    .send({
      company: 'Test Studio',
      contact: 'Test Person',
      email: 'test@example.com',
      value: 80000,
      source: 'Website',
      inquiry: 'We need a portfolio website and want to launch next month.',
    })
    .expect(201);
  const id = created.body.id;
  const run = await request(app).post(`/api/leads/${id}/qualify`).send({}).expect(202);
  await request(app).post(`/api/leads/${id}/qualify`).send({}).expect(409);
  await Promise.all(
    [1, 2].map(() =>
      request(app)
        .post(`/api/reviews/${run.body.id}/decision`)
        .send({
          decision: 'approve',
          task_title: 'Discuss our portfolio requirements',
          draft: 'Hello, can we discuss the scope of your portfolio website?',
        })
        .expect(200),
    ),
  );
  const state = await request(app).get('/api/workspace').expect(200);
  const tasks = state.body.tasks.filter(
    (t: { source_run_id: string }) => t.source_run_id === run.body.id,
  );
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Discuss our portfolio requirements');
  assert.equal(state.body.leads.find((l: { id: string }) => l.id === id).stage, 'New');
  assert.equal(state.body.context.token, undefined);
  await request(app).patch(`/api/tasks/${tasks[0].id}`).send({ complete: true }).expect(200);
  const updated = await repo.snapshot(demoContext);
  assert.ok(updated.tasks.find((t) => t.id === tasks[0].id)?.completed_at);
});

test('stale suggestions cannot be approved and can be dismissed', async () => {
  const repo = new DemoRepository();
  const app = createApp({ repo, mode: 'demo' });
  const lead = (await repo.snapshot(demoContext)).leads[0];
  const run = await request(app).post(`/api/leads/${lead.id}/qualify`).send({}).expect(202);
  await request(app)
    .post(`/api/leads/${lead.id}/notes`)
    .send({ message: 'Budget changed after a conversation.' })
    .expect(201);
  await request(app)
    .post(`/api/reviews/${run.body.id}/decision`)
    .send({ decision: 'approve' })
    .expect(409);
  await request(app)
    .post(`/api/reviews/${run.body.id}/decision`)
    .send({ decision: 'reject' })
    .expect(200);
});

test('repository scopes lead, task, and review access to workspace and owner', async () => {
  const repo = new DemoRepository();
  const state = await repo.snapshot(demoContext);
  const other = { ...demoContext, workspaceId: 'different-workspace' };
  assert.equal((await repo.snapshot(other)).leads.length, 0);
  await assert.rejects(repo.updateStage(other, state.leads[0].id, 'Qualified', 1), /not found/);
  await assert.rejects(repo.completeTask(other, state.tasks[0].id, true), /not found/);
  const sales = { ...demoContext, role: 'sales' as const, userId: 'another-salesperson' };
  assert.equal((await repo.snapshot(sales)).leads.length, 0);
  const run = await repo.createRun(demoContext, state.leads[0].id, 'demo');
  await repo.finishRun(run.id, demoQualification(state.leads[0], state.knowledge));
  await assert.rejects(repo.decide(sales, run.id, { decision: 'approve' }), /not found/);
});

test('callback credentials are run-scoped, expiring, and resistant to tampering', () => {
  const secret = 'a-test-secret-that-is-at-least-32-characters';
  const token = signRun('run-one', secret);
  verifyRun(token, 'run-one', secret);
  assert.throws(() => verifyRun(token, 'run-two', secret), /scope/);
  assert.throws(() => verifyRun(signRun('run-one', secret, 0), 'run-one', secret), /expired/);
  assert.throws(() => verifyRun(`${token}x`, 'run-one', secret), /Invalid/);
});

test('internal tools deny unsigned access and reject fabricated evidence', async () => {
  const repo = new DemoRepository();
  const secret = 'test-secret-with-at-least-32-characters';
  const app = createApp({ repo, mode: 'demo', signingSecret: secret });
  const state = await repo.snapshot(demoContext);
  const lead = state.leads[0];
  const run = await repo.createRun(demoContext, lead.id, 'n8n');
  await request(app).post(`/api/internal/runs/${run.id}/tools/context`).send({}).expect(401);
  const auth = `Bearer ${signRun(run.id, secret)}`;
  const context = await request(app)
    .post(`/api/internal/runs/${run.id}/tools/context`)
    .set('Authorization', auth)
    .send({})
    .expect(200);
  assert.equal(context.body.lead.id, lead.id);
  const result = demoQualification(lead, state.knowledge);
  result.evidence[0].quote = 'Invented source text that does not exist.';
  await request(app)
    .post(`/api/internal/runs/${run.id}/result`)
    .set('Authorization', auth)
    .send(result)
    .expect(422);
  assert.equal((await repo.getRun(run.id)).status, 'failed');
});

test('invalid input and invalid sessions do not mutate data', async () => {
  const repo = new DemoRepository();
  const app = createApp({ repo, mode: 'demo' });
  await request(app).post('/api/leads').send({ company: 'x' }).expect(400);
  const live = createApp({ repo, mode: 'supabase' });
  await request(live).get('/api/workspace').expect(401);
  assert.equal((await repo.snapshot(demoContext)).leads.length, 8);
});

test('saved demo state survives repository restart', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'leaddesk-test-'));
  try {
    const file = join(folder, 'demo.json');
    const repo = new DemoRepository(file);
    const lead = (await repo.snapshot(demoContext)).leads[0];
    await repo.addNote(demoContext, lead.id, 'A persistent note.');
    const restored = await new DemoRepository(file).snapshot(demoContext);
    assert.ok(restored.activities.some((a) => a.message === 'A persistent note.'));
  } finally {
    await rm(folder, { recursive: true });
  }
});

test('dashboard has correct denominators and excludes closed leads from pipeline', async () => {
  const data = await new DemoRepository().snapshot(demoContext);
  const d = dashboard(data);
  assert.equal(d.openValue, 655000);
  assert.equal(d.wonValue, 110000);
  assert.equal(d.winRate, 67);
  assert.equal(d.overdue, 1);
  assert.equal(d.reviewed, 0);
  assert.equal(
    dashboard({ leads: [], tasks: [], runs: [], knowledge: [], activities: [] }).winRate,
    null,
  );
});
