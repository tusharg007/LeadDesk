import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeadDrawer } from '../src/App.js';
import { seed, demoContext } from '../server/seed.js';
import { dashboard, demoQualification } from '../server/domain.js';
import type { Run, Bootstrap } from '../shared/types.js';

function render(runs: Run[]) {
  const snapshot = seed();
  const data: Bootstrap = {
    ...snapshot,
    runs,
    context: demoContext,
    dashboard: dashboard({ ...snapshot, runs }),
    mode: 'supabase',
    agentEnabled: true,
  };
  return renderToStaticMarkup(
    createElement(LeadDrawer, {
      lead: data.leads[0],
      data,
      busy: false,
      error: '',
      onClose: () => {},
      mutate: async () => true,
    }),
  );
}

function run(status: Run['status'], created_at: string): Run {
  const snapshot = seed();
  const lead = snapshot.leads[0];
  return {
    id: `${status}-${created_at}`,
    workspace_id: lead.workspace_id,
    lead_id: lead.id,
    lead_revision: lead.revision,
    status,
    mode: 'n8n',
    created_at,
    completed_at: created_at,
    recommendation: status === 'failed' ? null : demoQualification(lead, snapshot.knowledge),
    error: status === 'failed' ? 'Earlier qualification failed.' : null,
  };
}

test('lead panel hides an older failure after a later reviewed qualification in either input order', () => {
  const failed = run('failed', '2026-10-23T12:00:00Z');
  for (const status of ['approved', 'rejected'] as const) {
    const reviewed = run(status, '2026-10-24T12:00:00Z');
    for (const runs of [
      [failed, reviewed],
      [reviewed, failed],
    ]) {
      assert.doesNotMatch(render(runs), /Earlier qualification failed/);
    }
  }
});

test('lead panel still shows a genuine latest failure after an older approval', () => {
  const approved = run('approved', '2026-10-23T12:00:00Z');
  const failed = run('failed', '2026-10-24T12:00:00Z');
  assert.match(render([approved, failed]), /Earlier qualification failed/);
});
