import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  stages,
  type Snapshot,
  type Dashboard,
  type Recommendation,
  type Lead,
  type Knowledge,
} from '../shared/types.js';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function dashboard(data: Snapshot, now = Date.now()): Dashboard {
  const won = data.leads.filter((l) => l.stage === 'Won');
  const closed = data.leads.filter((l) => ['Won', 'Lost'].includes(l.stage));
  return {
    openValue: data.leads
      .filter((l) => !['Won', 'Lost'].includes(l.stage))
      .reduce((s, l) => s + l.value, 0),
    wonValue: won.reduce((s, l) => s + l.value, 0),
    winRate: closed.length ? Math.round((won.length / closed.length) * 100) : null,
    overdue: data.tasks.filter((t) => !t.completed_at && Date.parse(t.due_at) < now).length,
    pending: data.runs.filter((r) => r.status === 'awaiting_review').length,
    stageCounts: stages.map((stage) => ({
      stage,
      count: data.leads.filter((l) => l.stage === stage).length,
      value: data.leads.filter((l) => l.stage === stage).reduce((s, l) => s + l.value, 0),
    })),
    reviewed: data.runs.filter((r) => ['approved', 'rejected'].includes(r.status)).length,
    approved: data.runs.filter((r) => r.status === 'approved').length,
  };
}

export function validateEvidence(result: Recommendation, lead: Lead, knowledge: Knowledge[]) {
  for (const item of result.evidence) {
    const source =
      item.source_id === 'inquiry'
        ? lead.inquiry
        : knowledge.find((k) => k.id === item.source_id)?.content;
    if (!source || !source.includes(item.quote))
      throw new AppError(
        422,
        'An evidence quote does not match its source. Run qualification again.',
      );
  }
}

export function signRun(runId: string, secret: string, expiry = Date.now() + 15 * 60_000) {
  const payload = Buffer.from(JSON.stringify({ runId, expiry })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function verifyRun(token: string, runId: string, secret: string) {
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !secret) throw new AppError(401, 'Invalid agent authorization.');
  const expected = createHmac('sha256', secret).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new AppError(401, 'Invalid agent authorization.');
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    throw new AppError(401, 'Invalid agent authorization.');
  }
  if (claims.runId !== runId || typeof claims.expiry !== 'number' || claims.expiry < Date.now())
    throw new AppError(401, 'Agent authorization expired or has the wrong scope.');
}

// Clearly labeled fixture behavior for local development. This is NOT an LLM.
export function demoQualification(lead: Lead, knowledge: Knowledge[]): Recommendation {
  const ecommerce = /shop|commerce|store|checkout/i.test(lead.inquiry);
  const source =
    knowledge.find((k) => k.title.includes(ecommerce ? 'Commerce' : 'Website')) || knowledge[0];
  const missing = [
    !lead.value && 'Confirm the available project budget.',
    !/week|month|launch|deadline|date/i.test(lead.inquiry) && 'Confirm the intended launch date.',
  ].filter(Boolean) as string[];
  return {
    summary: `${lead.company} is exploring ${ecommerce ? 'an online storefront' : 'a website project'}. ${source.title} is a useful starting point. ${missing.length ? 'A few details need clarification before qualification.' : 'Review scope and delivery expectations before moving this lead forward.'}`,
    fit: missing.length ? 'needs_details' : 'good_fit',
    missing,
    evidence: [
      { source_id: 'inquiry', quote: lead.inquiry.slice(0, 240) },
      { source_id: source.id, quote: source.content.slice(0, 240) },
    ],
    task_title: `Discuss ${ecommerce ? 'storefront requirements' : 'project scope'} with ${lead.contact.split(' ')[0]}`,
    draft: `Hi ${lead.contact.split(' ')[0]}, thanks for reaching out about ${lead.company}. We'd love to understand your ${ecommerce ? 'storefront' : 'website'} requirements. Could you share your must-have features${missing.length ? ', budget, and preferred launch date' : ' and any examples you like'}? That will help us suggest a realistic next step.`,
  };
}
