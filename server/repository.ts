import type {
  Context,
  Snapshot,
  LeadInput,
  Lead,
  Run,
  Recommendation,
  Decision,
} from '../shared/types.js';
export interface Repository {
  snapshot(ctx: Context): Promise<Snapshot>;
  createLead(ctx: Context, input: LeadInput): Promise<Lead>;
  updateStage(ctx: Context, id: string, stage: Lead['stage'], revision: number): Promise<void>;
  addNote(ctx: Context, id: string, message: string): Promise<void>;
  completeTask(ctx: Context, id: string, complete: boolean): Promise<void>;
  createRun(ctx: Context, leadId: string, mode: Run['mode']): Promise<Run>;
  getRun(id: string): Promise<Run>;
  agentSnapshot(run: Run): Promise<Snapshot>;
  finishRun(id: string, result: Recommendation): Promise<void>;
  failRun(id: string, error: string): Promise<void>;
  decide(ctx: Context, id: string, decision: Decision): Promise<void>;
}
