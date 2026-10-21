import type { Snapshot, Context, Lead } from '../shared/types.js';
export const demoContext: Context = {
  userId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  role: 'admin',
  name: 'Alex Morgan',
  workspaceName: 'Studio North',
};
export function seed(): Snapshot {
  const date = (days: number) => new Date(Date.now() + days * 86400_000).toISOString();
  const inputs = [
    [
      'Forma Studio',
      'Maya Patel',
      'maya@forma.example',
      85000,
      'Website',
      'New',
      'We are looking for a new website for our architecture studio. We need a portfolio, project pages, and an inquiry form. Our budget is around 85,000 rupees and we would like to launch next month.',
    ],
    [
      'Bloom & Wild',
      'Rohan Shah',
      'rohan@bloom.example',
      140000,
      'Referral',
      'Qualified',
      'We need an online store for our homegrown skincare range with 40 products, checkout, and inventory integration. We have a budget of 140,000 rupees and a launch date in six weeks.',
    ],
    [
      'Orbit Analytics',
      'Emma Wilson',
      'emma@orbit.example',
      210000,
      'LinkedIn',
      'Proposal',
      'Our analytics platform needs a new marketing website and a product demo flow. We have eight weeks and an approved budget of 210,000 rupees.',
    ],
    [
      'Kanso Living',
      'Aarav Mehta',
      'aarav@kanso.example',
      95000,
      'Referral',
      'Contacted',
      'We sell handmade furniture and need a product catalogue with inquiry forms. We are deciding on the scope and would like to talk through options.',
    ],
    [
      'Fieldwork Coffee',
      'Leah Chen',
      'leah@fieldwork.example',
      65000,
      'Website',
      'Won',
      'A simple website for our coffee roastery with our story, locations, and wholesale inquiries. Launch next month with a budget of 65,000 rupees.',
    ],
    [
      'Nomad Supply',
      'Noah Brown',
      'noah@nomad.example',
      125000,
      'LinkedIn',
      'New',
      'We want to move our outdoor gear catalogue online. We need a store with payment processing and shipping integration, but have not finalized a launch date.',
    ],
    [
      'Paper & Co.',
      'Zara Ali',
      'zara@paper.example',
      45000,
      'Other',
      'Won',
      'A portfolio website for our stationery brand, with a contact form and a wholesale catalogue.',
    ],
    [
      'Atlas Fitness',
      'James Lee',
      'james@atlas.example',
      70000,
      'Website',
      'Lost',
      'A website for our gym with a schedule and trainer profiles. The project was paused while we move locations.',
    ],
  ] as const;
  const leads: Lead[] = inputs.map((x, i) => ({
    id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`,
    workspace_id: demoContext.workspaceId,
    owner_id: demoContext.userId,
    company: x[0],
    contact: x[1],
    email: x[2],
    value: x[3],
    source: x[4],
    stage: x[5],
    inquiry: x[6],
    revision: 1,
    created_at: date(-i * 2 - 1),
    updated_at: date(-i),
  }));
  return {
    leads,
    runs: [],
    tasks: [
      {
        id: '44444444-4444-4444-8444-000000000001',
        workspace_id: demoContext.workspaceId,
        lead_id: leads[2].id,
        title: 'Follow up on the website proposal',
        draft: '',
        due_at: date(-1),
        completed_at: null,
        source_run_id: '',
      },
      {
        id: '44444444-4444-4444-8444-000000000002',
        workspace_id: demoContext.workspaceId,
        lead_id: leads[3].id,
        title: 'Confirm catalogue scope with Aarav',
        draft: '',
        due_at: date(1),
        completed_at: null,
        source_run_id: '',
      },
    ],
    activities: leads.map((lead, i) => ({
      id: `55555555-5555-4555-8555-${String(i + 1).padStart(12, '0')}`,
      workspace_id: demoContext.workspaceId,
      lead_id: lead.id,
      message: i === 2 ? 'Proposal shared. Waiting for feedback.' : 'Lead added to the workspace.',
      created_at: lead.created_at,
    })),
    knowledge: [
      {
        id: '66666666-6666-4666-8666-000000000001',
        workspace_id: demoContext.workspaceId,
        title: 'Website design & development',
        content:
          'Studio North builds focused business websites with portfolio pages, CMS content, and inquiry forms. Discovery is required before committing to pricing or a delivery date.',
        keywords: ['website', 'portfolio', 'cms', 'marketing'],
      },
      {
        id: '66666666-6666-4666-8666-000000000002',
        workspace_id: demoContext.workspaceId,
        title: 'Commerce storefronts',
        content:
          'Studio North builds small commerce storefronts with product catalogues, checkout, and shipping integrations. Confirm catalogue size, payment providers, and inventory requirements before estimating.',
        keywords: ['store', 'commerce', 'shop', 'checkout'],
      },
      {
        id: '66666666-6666-4666-8666-000000000003',
        workspace_id: demoContext.workspaceId,
        title: 'Qualification playbook',
        content:
          'Ask about the business goal, required features, budget, and deadline. Never promise a price or timeline from an inquiry alone. Escalate projects outside the service catalogue.',
        keywords: ['budget', 'deadline', 'scope', 'qualification'],
      },
    ],
  };
}
