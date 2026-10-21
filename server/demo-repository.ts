import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { seed } from './seed.js';
import { AppError, validateEvidence } from './domain.js';
import type { Repository } from './repository.js';
import type {
  Context,
  Snapshot,
  LeadInput,
  Lead,
  Run,
  Recommendation,
  Decision,
} from '../shared/types.js';

export class DemoRepository implements Repository {
  private queue: Promise<unknown> = Promise.resolve();
  private state: Snapshot | undefined;
  constructor(private file?: string) {}
  private async load() {
    if (this.state) return this.state;
    try {
      this.state = this.file ? JSON.parse(await readFile(this.file, 'utf8')) : seed();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.state = seed();
    }
    return this.state!;
  }
  private change<T>(fn: (data: Snapshot) => T): Promise<T> {
    const op = this.queue.then(async () => {
      const next = structuredClone(await this.load());
      const result = fn(next);
      if (this.file) {
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2));
        await rename(`${this.file}.tmp`, this.file);
      }
      this.state = next;
      return structuredClone(result);
    });
    this.queue = op.catch(() => {});
    return op;
  }
  private lead(data: Snapshot, ctx: Context, id: string) {
    const lead = data.leads.find(
      (l) =>
        l.id === id &&
        l.workspace_id === ctx.workspaceId &&
        (ctx.role === 'admin' || l.owner_id === ctx.userId),
    );
    if (!lead) throw new AppError(404, 'Lead not found.');
    return lead;
  }
  private activity(data: Snapshot, lead: Lead, message: string) {
    data.activities.unshift({
      id: randomUUID(),
      workspace_id: lead.workspace_id,
      lead_id: lead.id,
      message,
      created_at: new Date().toISOString(),
    });
  }
  async snapshot(ctx: Context) {
    await this.queue;
    const data = structuredClone(await this.load());
    data.leads = data.leads.filter(
      (l) =>
        l.workspace_id === ctx.workspaceId && (ctx.role === 'admin' || l.owner_id === ctx.userId),
    );
    const ids = new Set(data.leads.map((l) => l.id));
    data.tasks = data.tasks.filter((t) => ids.has(t.lead_id));
    data.runs = data.runs.filter((r) => ids.has(r.lead_id));
    data.activities = data.activities.filter((a) => ids.has(a.lead_id));
    data.knowledge = data.knowledge.filter((k) => k.workspace_id === ctx.workspaceId);
    return data;
  }
  createLead(ctx: Context, input: LeadInput) {
    return this.change((data) => {
      const now = new Date().toISOString();
      const lead: Lead = {
        ...input,
        id: randomUUID(),
        workspace_id: ctx.workspaceId,
        owner_id: ctx.userId,
        stage: 'New',
        revision: 1,
        created_at: now,
        updated_at: now,
      };
      data.leads.unshift(lead);
      this.activity(data, lead, 'Lead added to the workspace.');
      return lead;
    });
  }
  updateStage(ctx: Context, id: string, stage: Lead['stage'], revision: number) {
    return this.change((data) => {
      const lead = this.lead(data, ctx, id);
      if (lead.revision !== revision)
        throw new AppError(409, 'This lead changed. Refresh and try again.');
      if (lead.stage === stage) return;
      const old = lead.stage;
      lead.stage = stage;
      lead.revision++;
      lead.updated_at = new Date().toISOString();
      this.activity(data, lead, `Stage changed from ${old} to ${stage}.`);
    });
  }
  addNote(ctx: Context, id: string, message: string) {
    return this.change((data) => {
      const lead = this.lead(data, ctx, id);
      lead.revision++;
      lead.updated_at = new Date().toISOString();
      this.activity(data, lead, message);
    });
  }
  completeTask(ctx: Context, id: string, complete: boolean) {
    return this.change((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new AppError(404, 'Task not found.');
      const lead = this.lead(data, ctx, task.lead_id);
      task.completed_at = complete ? new Date().toISOString() : null;
      this.activity(data, lead, `${complete ? 'Completed' : 'Reopened'} task: ${task.title}`);
    });
  }
  createRun(ctx: Context, leadId: string, mode: Run['mode']) {
    return this.change((data) => {
      const lead = this.lead(data, ctx, leadId);
      if (['Won', 'Lost'].includes(lead.stage))
        throw new AppError(409, 'Reopen this lead before qualifying it.');
      if (
        data.runs.some(
          (r) =>
            r.lead_id === leadId &&
            (r.status === 'running' ||
              (r.status === 'awaiting_review' && r.lead_revision === lead.revision)),
        )
      )
        throw new AppError(409, 'This lead already has an active qualification.');
      const run: Run = {
        id: randomUUID(),
        workspace_id: ctx.workspaceId,
        lead_id: leadId,
        lead_revision: lead.revision,
        status: 'running',
        mode,
        recommendation: null,
        error: null,
        created_at: new Date().toISOString(),
        completed_at: null,
      };
      data.runs.unshift(run);
      return run;
    });
  }
  async getRun(id: string) {
    await this.queue;
    const run = (await this.load()).runs.find((r) => r.id === id);
    if (!run) throw new AppError(404, 'Run not found.');
    return structuredClone(run);
  }
  async agentSnapshot(run: Run) {
    const data = structuredClone(await this.load());
    const lead = data.leads.find(
      (l) => l.id === run.lead_id && l.workspace_id === run.workspace_id,
    );
    if (!lead) throw new AppError(404, 'Lead not found.');
    return {
      leads: [lead],
      tasks: data.tasks.filter((t) => t.lead_id === lead.id),
      activities: data.activities.filter((a) => a.lead_id === lead.id),
      knowledge: data.knowledge.filter((k) => k.workspace_id === run.workspace_id),
      runs: [run],
    };
  }
  finishRun(id: string, result: Recommendation) {
    return this.change((data) => {
      const run = data.runs.find((r) => r.id === id);
      if (!run) throw new AppError(404, 'Run not found.');
      if (run.status !== 'running') return;
      const lead = data.leads.find((l) => l.id === run.lead_id)!;
      if (lead.revision !== run.lead_revision)
        throw new AppError(409, 'Lead changed during qualification. Run it again.');
      validateEvidence(
        result,
        lead,
        data.knowledge.filter((k) => k.workspace_id === run.workspace_id),
      );
      run.recommendation = result;
      run.status = 'awaiting_review';
      run.completed_at = new Date().toISOString();
    });
  }
  failRun(id: string, error: string) {
    return this.change((data) => {
      const run = data.runs.find((r) => r.id === id);
      if (run?.status === 'running') {
        run.status = 'failed';
        run.error = error;
        run.completed_at = new Date().toISOString();
      }
    });
  }
  decide(ctx: Context, id: string, decision: Decision) {
    return this.change((data) => {
      const run = data.runs.find((r) => r.id === id);
      if (!run) throw new AppError(404, 'Review not found.');
      const lead = this.lead(data, ctx, run.lead_id);
      if (
        (run.status === 'approved' && decision.decision === 'approve') ||
        (run.status === 'rejected' && decision.decision === 'reject')
      )
        return;
      if (run.status !== 'awaiting_review' || !run.recommendation)
        throw new AppError(409, 'This review has already been resolved.');
      if (decision.decision === 'reject') {
        run.status = 'rejected';
        this.activity(data, lead, 'Qualification suggestion dismissed.');
        return;
      }
      if (lead.revision !== run.lead_revision)
        throw new AppError(
          409,
          'This lead changed after qualification. Dismiss this suggestion and run it again.',
        );
      run.status = 'approved';
      if (!data.tasks.some((t) => t.source_run_id === id))
        data.tasks.unshift({
          id: randomUUID(),
          workspace_id: ctx.workspaceId,
          lead_id: lead.id,
          source_run_id: id,
          title: decision.task_title || run.recommendation.task_title,
          draft: decision.draft || run.recommendation.draft,
          due_at: new Date(Date.now() + 86400_000).toISOString(),
          completed_at: null,
        });
      this.activity(data, lead, 'Approved qualification and created a follow-up task.');
    });
  }
}
