import { z } from 'zod';

import { stages } from './constants.js';
export { stages } from './constants.js';
export const leadInput = z.object({
  company: z.string().trim().min(2).max(100),
  contact: z.string().trim().min(2).max(100),
  email: z.email().max(200),
  value: z.number().int().min(0).max(100_000_000),
  source: z.enum(['Website', 'Referral', 'LinkedIn', 'Other']),
  inquiry: z.string().trim().min(15).max(6000),
});
export const leadUpdate = z.object({
  stage: z.enum(stages),
  revision: z.number().int().positive(),
});
export const recommendationSchema = z.object({
  summary: z.string().trim().min(10).max(1600),
  fit: z.enum(['good_fit', 'needs_details', 'out_of_scope']),
  missing: z.array(z.string().min(1).max(200)).max(6),
  evidence: z
    .array(z.object({ source_id: z.string().min(1).max(100), quote: z.string().min(5).max(600) }))
    .min(1)
    .max(6),
  task_title: z.string().trim().min(5).max(160),
  draft: z.string().trim().min(10).max(3000),
});
export const decisionInput = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(10).max(1000),
  task_title: z.string().trim().min(5).max(160).optional(),
  draft: z.string().trim().min(10).max(3000).optional(),
});
export type LeadInput = z.infer<typeof leadInput>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type Decision = z.infer<typeof decisionInput>;
export type Lead = LeadInput & {
  id: string;
  workspace_id: string;
  owner_id: string;
  stage: (typeof stages)[number];
  revision: number;
  created_at: string;
  updated_at: string;
};
export type Task = {
  id: string;
  workspace_id: string;
  lead_id: string;
  title: string;
  draft: string;
  due_at: string;
  completed_at: string | null;
  source_run_id: string;
};
export type Run = {
  id: string;
  workspace_id: string;
  lead_id: string;
  lead_revision: number;
  status: 'running' | 'awaiting_review' | 'approved' | 'rejected' | 'failed';
  mode: 'demo' | 'n8n';
  recommendation: Recommendation | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  review_audit?: {
    reviewer_id: string;
    reviewer_name: string;
    reviewed_at: string;
    reason: string;
    decision: 'approve' | 'reject';
    lead_company: string;
    lead_revision: number;
    approved_task_title: string | null;
    approved_draft: string | null;
  } | null;
};
export type Activity = {
  id: string;
  workspace_id: string;
  lead_id: string;
  message: string;
  created_at: string;
};
export type Knowledge = {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  keywords: string[];
};
export type Context = {
  userId: string;
  workspaceId: string;
  role: 'admin' | 'sales';
  name: string;
  workspaceName: string;
  token?: string;
};
export type Snapshot = {
  leads: Lead[];
  tasks: Task[];
  runs: Run[];
  activities: Activity[];
  knowledge: Knowledge[];
};
export type Dashboard = {
  openValue: number;
  wonValue: number;
  winRate: number | null;
  overdue: number;
  pending: number;
  stageCounts: { stage: string; count: number; value: number }[];
  reviewed: number;
  approved: number;
};
export type Bootstrap = Snapshot & {
  context: Context;
  dashboard: Dashboard;
  mode: 'demo' | 'supabase';
  agentEnabled: boolean;
};
