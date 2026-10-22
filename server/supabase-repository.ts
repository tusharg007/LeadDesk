import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from './domain.js';
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

type Config = { url: string; key: string; serviceKey: string };
export class SupabaseRepository implements Repository {
  readonly admin: SupabaseClient;
  constructor(private config: Config) {
    this.admin = this.client(config.serviceKey);
  }
  private client(key: string, token?: string) {
    return createClient(this.config.url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
    });
  }
  private user(ctx: Context) {
    return this.client(this.config.key, ctx.token);
  }
  private check(error: { message: string; code?: string } | null) {
    if (!error) return;
    if (error.code === '23505')
      throw new AppError(409, 'An active qualification already exists for this lead.');
    if (error.message.includes('not found') || error.code === 'PGRST116')
      throw new AppError(404, 'Record not found.');
    if (
      error.message.includes('changed') ||
      error.message.includes('resolved') ||
      error.message.includes('Reopen')
    )
      throw new AppError(409, error.message);
    if (error.code === '42501') throw new AppError(403, 'You do not have access to this action.');
    console.error('Database operation failed:', error.code);
    throw new AppError(500, 'The database request failed. Check the server setup and try again.');
  }
  async authenticate(token: string): Promise<Context> {
    const client = this.client(this.config.key, token);
    const { data: auth, error } = await client.auth.getUser(token);
    if (error || !auth.user) throw new AppError(401, 'Your session expired. Please sign in again.');
    const { data, error: memberError } = await client
      .from('memberships')
      .select('workspace_id, role, display_name, workspaces(name)')
      .eq('user_id', auth.user.id)
      .single();
    if (memberError || !data)
      throw new AppError(403, 'Your account needs a workspace membership. See the setup guide.');
    const workspace = data.workspaces as unknown as { name: string };
    return {
      userId: auth.user.id,
      workspaceId: data.workspace_id,
      role: data.role,
      name: data.display_name,
      workspaceName: workspace.name,
      token,
    };
  }
  private async read(
    client: SupabaseClient,
    workspaceId: string,
    leadId?: string,
  ): Promise<Snapshot> {
    const tables = ['leads', 'tasks', 'agent_runs', 'activities', 'knowledge_entries'] as const;
    const results = await Promise.all(
      tables.map((table) => {
        let query = client.from(table).select('*').eq('workspace_id', workspaceId);
        if (leadId && table !== 'knowledge_entries')
          query = query.eq(table === 'leads' ? 'id' : 'lead_id', leadId);
        return query
          .order(
            table === 'tasks' ? 'due_at' : table === 'knowledge_entries' ? 'title' : 'created_at',
            { ascending: table === 'tasks' || table === 'knowledge_entries' },
          )
          .limit(1000);
      }),
    );
    results.forEach((r) => this.check(r.error));
    // Deliberate small-workspace cap. Never display incomplete totals as if complete.
    if (results.some((r) => (r.data?.length || 0) >= 1000))
      throw new AppError(
        422,
        'This starter supports fewer than 1,000 records per table. Add paginated queries before expanding this workspace.',
      );
    return {
      leads: results[0].data!,
      tasks: results[1].data!,
      runs: results[2].data!,
      activities: results[3].data!,
      knowledge: results[4].data!,
    } as Snapshot;
  }
  snapshot(ctx: Context) {
    return this.read(this.user(ctx), ctx.workspaceId);
  }
  async createLead(ctx: Context, input: LeadInput) {
    const { data, error } = await this.user(ctx)
      .from('leads')
      .insert({ ...input, workspace_id: ctx.workspaceId, owner_id: ctx.userId })
      .select()
      .single();
    this.check(error);
    return data as Lead;
  }
  async updateStage(ctx: Context, id: string, stage: Lead['stage'], revision: number) {
    const { error } = await this.user(ctx).rpc('update_lead_stage', {
      p_id: id,
      p_stage: stage,
      p_revision: revision,
    });
    this.check(error);
  }
  async addNote(ctx: Context, id: string, message: string) {
    const { error } = await this.user(ctx).rpc('add_lead_note', { p_id: id, p_message: message });
    this.check(error);
  }
  async completeTask(ctx: Context, id: string, complete: boolean) {
    const { error } = await this.user(ctx).rpc('set_task_complete', {
      p_id: id,
      p_complete: complete,
    });
    this.check(error);
  }
  async createRun(ctx: Context, leadId: string, mode: Run['mode']) {
    const { data, error } = await this.user(ctx).rpc('create_qualification', {
      p_lead_id: leadId,
      p_mode: mode,
    });
    this.check(error);
    return data as Run;
  }
  async getRun(id: string) {
    const { data, error } = await this.admin.from('agent_runs').select('*').eq('id', id).single();
    this.check(error);
    return data as Run;
  }
  agentSnapshot(run: Run) {
    return this.read(this.admin, run.workspace_id, run.lead_id);
  }
  async finishRun(id: string, result: Recommendation) {
    const { error } = await this.admin.rpc('finish_qualification', { p_id: id, p_result: result });
    this.check(error);
  }
  async failRun(id: string, error: string) {
    const { error: dbError } = await this.admin
      .from('agent_runs')
      .update({ status: 'failed', error, completed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'running');
    this.check(dbError);
  }
  async decide(ctx: Context, id: string, decision: Decision) {
    const { error } = await this.user(ctx).rpc('decide_qualification', {
      p_id: id,
      p_decision: decision.decision,
      p_reason: decision.reason,
      p_title: decision.task_title ?? null,
      p_draft: decision.draft ?? null,
    });
    this.check(error);
  }
}
