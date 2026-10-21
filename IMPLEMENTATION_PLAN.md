# LeadDesk: agent-assisted agency CRM

> Implementation note: the first release deliberately implements one qualification agent and four product areas. See README.md for the exact working scope, setup, and integration status. The broader items below remain a roadmap; they are not claims about shipped features.

## 1. Objective and scope

Build a CRM for a small web-development agency where two bounded AI agents qualify inquiries and recommend follow-ups for stalled opportunities. Use React, Express, Node.js, TypeScript, n8n, and Supabase PostgreSQL/Auth. This supersedes the MongoDB/LangGraph plan. Describe the stack as React/Node/Postgres or PERN, rather than MERN.

Portfolio objective: combine applied AI engineering with end-to-end product delivery across the interface, API, relational database, and deployment.

Product promise: every lead has an owner, evidence-backed context, and an actionable next step. Agents retrieve information, select tools, and propose actions. Application code validates and executes approved actions.

Target 120–160 focused hours over approximately 8–10 weeks at 15–16 hours/week. This is larger than the earlier drafting workflow. Allocate about 50% to integrated CRM/dashboards, 35% to agents/orchestration/evaluation, and 15% to deployment/documentation; test throughout. Limit scope to two roles, two agents, one pipeline, one curated knowledge source, and one currency per workspace.

## 2. Product scenario

An inquiry requests an e-commerce website with a budget and launch date. The qualification agent reads the lead, retrieves relevant service entries and case studies, identifies missing requirements, and proposes a grounded assessment and follow-up. A salesperson reviews and approves selected actions.

Later, a rule flags a proposal with no recorded response. The follow-up agent reviews activities, existing tasks, previous suggestions, and the playbook. It chooses among clarification, proposal follow-up, internal escalation, or no action. Recent contact or an existing equivalent task may justify abstaining.

The MVP prepares messages for copying. Users send them externally and explicitly record contact/replies. Approval never implies that a message was sent. The system does not observe mailbox activity.

## 3. Architecture and ownership

React application → Express API → Supabase PostgreSQL
React authentication → Supabase Auth
Express dispatch → n8n workflows → AI Agent nodes → one model provider
Agent tools → authenticated, scoped Express endpoints

React owns forms, pipeline, tasks, reviews, dashboards, and error states. Express owns authorization, contracts, action execution, analytics, and dispatch. Postgres owns constraints, transactions, durable state, and queries. n8n owns agent execution, schedules, workflow branches, and operational retries.

n8n's Agent node selects tools to accomplish a task. Connect real context/retrieval/proposal tools; a single prompt inside an Agent node is insufficient for this design. [n8n AI Agent documentation](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent)

Use one repository, one API deployment, and one persistent n8n instance. Do not add LangGraph, BullMQ, or Redis. A small Node outbox dispatcher handles durable event delivery.

n8n needs durable execution and credential storage separate from CRM tables. For a small self-hosted demo, use its SQLite database on a persistent volume, backups, and a stable credential-encryption key. Private Postgres storage is an alternative later. [n8n database configuration](https://docs.n8n.io/deploy/host-n8n/configure-n8n/choose-n8ns-database.md)

Pin versions and export sanitized workflow JSON. The CRM is the user interface; the n8n editor is an operator tool. This is a portfolio demonstration, not a commercial hosting specification.

## 4. CRM scope and fullstack completion rule

- Supabase Auth login/logout; seeded admin and salesperson accounts.
- Admins manage their workspace; salespeople work on assigned leads.
- Lead CRUD, search, filters, pagination, ownership, notes, contact events, tasks, and activity history.
- Fixed pipeline: New → Qualified → Contacted → Proposal → Won/Lost. Validate transitions; log actor/time. Reopening is explicit.
- Approval inbox with evidence, editable drafts, approval/rejection, and execution status.
- Dashboard with Sales, My Work, and Agent Operations tabs.
- Small admin-only knowledge catalogue editor for services, case studies, and follow-up playbooks.

Keep contact and opportunity details in the lead entity. Seed memberships; omit public signup, invitations, billing, and custom organization onboarding.

Build every feature as migration → authorized endpoint → UI → loading/error/empty states → integration check → deployment. Refresh affected views after mutations, preserve input on failure, and handle expired sessions and conflicting edits. Build the manual CRM before connecting the first agent, then integrate agents before adding more CRM features.

## 5. Agent A: lead qualification

Goal: determine known requirements, missing information, service fit, and a justified next step.

Inputs: immutable lead snapshot/revision, current service catalogue, relevant approved case studies, and recent activity.

Tools:

- get_lead_context(): returns the bound lead and recent activity.
- search_knowledge(query, kind): retrieves permitted service, case-study, or playbook entries.
- get_open_tasks(): checks for duplicate work.
- propose_actions(payload): persists validated recommendations, never executes them.

The agent selects retrieval based on the inquiry. Return requirements with evidence references, fit/unclear/out_of_scope, missing fields, a short decision justification, and at most two proposed actions. Unknown values remain null. Do not invent pricing commitments or conversion probabilities.

Example: a low-budget inquiry for a complex marketplace leads the agent to inspect the relevant service entry, recognize a mismatch, and ask whether the prospect would consider a smaller initial scope. A standard website inquiry may need fewer tools.

## 6. Agent B: deal follow-up

Goal: determine whether a stalled lead needs intervention and recommend the most useful next action.

A deterministic rule selects eligible leads. The agent then uses:

- get_lead_context().
- get_activity_history().
- get_open_tasks().
- search_knowledge(query, kind="playbook").
- propose_actions(payload), or a structured no_action result.

Return action type, due date, draft message when useful, source references, and a concise justification. At most two actions per run. Do not infer that silence means lost business or autonomously close a deal.

Include previous accepted/rejected suggestions in context. This is memory from stored business events, not automatic model training. The agent must avoid repeating a rejected suggestion without changed evidence.

Qualification interprets inquiries against services; follow-up reasons over evolving history. Implement two workflows with shared tools. No supervisor, critic, or agent-to-agent conversation is needed.

## 7. AI engineering requirements

- Bounded tool-use loop, initially six tool calls and a configurable run deadline; tune using evaluations.
- Structured output validation; one bounded repair attempt, then visible failure.
- Explicit abstain/no-action and insufficient-evidence outcomes.
- Retrieve fresh CRM context for each run; no unbounded chat memory.
- Curate 15–30 knowledge entries; start with SQL filters/full-text search and return source IDs/excerpts. Add pgvector only if measured retrieval failures justify it.
- Persist prompt/model/workflow versions, safe tool input/output summaries, evidence, timing, usage where available, and final recommendation.
- Show concise decision summaries and tool traces, not private chain-of-thought.
- Treat inquiry/knowledge text as untrusted data. Tools cannot accept arbitrary SQL, arbitrary URLs, or unrestricted tenant/lead identifiers.
- Bound scheduled batch size, reruns, model calls, and workspace usage. Keep secrets and unnecessary customer data out of logs.

The meaningful agent behavior is choosing information sources and next actions based on context. Scheduling, permissions, duplicate prevention, and financial totals remain deterministic code.

## 8. n8n workflows and approval lifecycle

Three main workflows:

1. Qualify lead: authenticated webhook → claim existing run through API → qualification agent/tools → validate and store proposals → finish awaiting_review or no_action.
2. Review stale leads: schedule → API returns a bounded eligible batch → claim one run per lead/revision/review window → follow-up agent → persist proposals/no_action. Skip closed leads, recent contact, and equivalent pending work.
3. Execute approved action: authenticated webhook → load exact approved payload → recheck permissions/revision → transactional API mutation → record result.

Approval lives durably in PostgreSQL. The agent execution finishes after saving proposals; a user's approval triggers workflow 3. This keeps the React review inbox independent of an open workflow execution. Never ask the model to reinterpret an already approved payload.

n8n also supports database-backed waits/webhook resume, but this design does not require them. [Wait node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait)

Keep distinct states:

- Agent run: queued/running/awaiting_review/no_action/failed.
- Action: pending_review/approved_pending_execution/executed/rejected/expired/stale/failed.

Record approval and its outbox event in one Postgres transaction. A small dispatcher sends signed events to n8n and retries boundedly. Claim runs with status/lease fields; recover expired leases and overdue dispatch. Reuse completed output where available. Retries may repeat model cost but must not repeat business actions.

Use a unique source_action_id for tasks. Stage changes require expected revision and a valid transition. Commit mutation, audit event, and action completion together. Recheck membership/ownership at execution time. Source changes require renewed review. Duplicate callbacks return the existing outcome.

## 9. Supabase security and data model

React signs in through Supabase Auth and calls Express with the access token. Express verifies it and reads authoritative membership. For user operations, use a request-scoped Supabase client carrying the user's token so RLS applies. A normal privileged Postgres connection does not automatically inherit user identity.

Enable RLS and explicit grants on exposed tables. Child records inherit lead/workspace restrictions. Dashboard aggregation must honor identical visibility rules. Use security-invoker views/functions where appropriate and test them; privileged functions/views can bypass intended policies.

Privileged credentials bypass RLS and remain server-only. n8n calls Express through authenticated service requests with short-lived run-scoped authorization. Derive lead/workspace scope from the claimed run; never trust tenant IDs from the model. Execution endpoints accept approved action IDs and revalidate them. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)

| Table                             | Purpose                                                      |
| --------------------------------- | ------------------------------------------------------------ |
| profiles, workspaces, memberships | Profile and roles; identity remains in auth.users            |
| leads                             | Contact/opportunity, owner, stage, amount, source, revision  |
| activities                        | Notes, contacts, replies, transitions, actor, occurred_at    |
| tasks                             | Assignee, due/completion timestamps, unique source_action_id |
| knowledge_entries                 | Curated source text, type, revision                          |
| agent_runs                        | Type, lead revision, status/lease, versions, timing, usage   |
| agent_events                      | Ordered tool events and evidence references                  |
| proposed_actions                  | Proposal, immutable approved payload, reviewer, state        |
| outbox_events                     | Dispatch attempts, next retry, delivery state                |

Use typed relational columns for identifiers, values, states, and timestamps; JSONB for bounded agent payloads. Add foreign keys, checks, indexes, and unique idempotency keys. Enforce parent-child workspace consistency in constraints or transactional functions. Version migrations, grants, RLS policies, and seeds.

## 10. Dashboards with actionable metrics

One dashboard screen with three tabs. Each chart supports date filters, applicable owner/source filters, empty states, and drill-through. Admin sees workspace data; salesperson sees assigned data.

| Tab              | Views                                                                                         | Action                          |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------- |
| Sales            | Pipeline distribution/value, won amount trend, closed win rate, stage aging, source breakdown | Inspect the underlying leads    |
| My Work          | Due/overdue tasks, pending reviews, unanswered inquiries, suggestions with evidence           | Review, contact, or complete    |
| Agent Operations | Outcomes/failures, latency, usage/cost estimate, review decisions, executed actions           | Inspect a trace or retry safely |

Metric contracts:

- Stage distribution is a current snapshot, not a conversion funnel. Defer historical funnel/cohort analysis.
- Won amount is deal value, not recognized revenue. Filter closed metrics by close date; one workspace currency.
- Win rate = Won/(Won + Lost) for selected closes; no denominator means an empty state.
- Stage age = now minus latest entry into current stage, using transition events.
- Response lag uses manually recorded first human contact minus inquiry creation. Exclude never-contacted leads from the median and show their count separately.
- Acceptance = approved reviewed proposals / all reviewed proposals; report edited approvals separately and exclude pending reviews.
- Execution success = executed / execution-terminal approved actions; show pending and stale separately.
- Report p50/p95 run latency with sample counts. Cost estimates need dated model pricing and usage coverage; missing usage is unknown, not zero.
- Later task completion and stage movement can be shown descriptively. Do not attribute conversion/revenue improvements causally to agents.

Use authorized, parameterized SQL aggregation endpoints. Display each metric's time basis and verify totals against fixtures. Recharts or a similar chart library is sufficient.

## 11. Representative API and repository

API:

- GET/POST /api/leads; GET/PATCH /api/leads/:id.
- POST /api/leads/:id/stage-transitions.
- GET/POST /api/leads/:id/activities.
- GET/POST /api/tasks; PATCH /api/tasks/:id.
- POST /api/leads/:id/agent-runs; GET /api/agent-runs/:id and /events.
- GET /api/approvals; POST /api/approvals/:id/decision.
- GET /api/dashboard/sales, /work, /agents.
- CRUD /api/knowledge with admin write permissions.
- Internal run-claim, allowlisted-tool, and approved-action execution endpoints.

Agent creation returns 202 and a run ID; poll initially. Internal endpoints require service authentication plus scope enforcement. Tokens never enter model context or browser responses.

Repository: apps/web, apps/api, packages/contracts, supabase/migrations, supabase/tests, n8n/workflows, prompts, evals, and docs. Share request/response contracts, not privileged server code.

## 12. Evaluation and verification

Create approximately 30 synthetic scenarios across the two agents; reserve a held-out subset. Include incomplete inquiries, conflicting dates, unsupported services, recent contact, duplicate tasks, rejected suggestions, prompt injection, stale approvals, and similar leads in different workspaces.

Compare a single-prompt baseline with the tool-using agents on the same cases. Measure:

- Extraction correctness and unsupported claims.
- Retrieval of expected knowledge entries and valid evidence references.
- Service-fit and action/no-action correctness.
- Tool validity, duplicate suggestions, latency, and usage.
- Draft usefulness using a fixed human rubric.

Use deterministic assertions where possible. An LLM judge is optional, not the sole evaluator. Publish measured results and representative failures. The point is to establish when retrieval/tool use helps; simple cases may retain a deterministic fast path.

n8n supports dataset-based evaluation; a versioned fixture set and TypeScript runner are sufficient for this project. [n8n evaluations](https://docs.n8n.io/build/integrate-ai/test-and-improve-ai-workflows/understand-why-to-test.md)

Required tests:

- Cross-workspace, cross-owner, tool-scope, and dashboard isolation, including privileged paths.
- SQL metric correctness on fixed seeds.
- Duplicate approval/callback and crash-after-write produce one mutation.
- Stale/reassigned/expired actions fail visibly.
- n8n downtime preserves events; restart recovers work and approvals.
- Model errors leave manual CRM usable; routine CI uses stubs.
- Browser flow: admin capture/assignment → salesperson review → approved task → completion → updated dashboards, plus an agent no-action case.

## 13. Milestones

| Phase                              | Effort  | Completion gate                                                          |
| ---------------------------------- | ------- | ------------------------------------------------------------------------ |
| Foundation                         | 14–18 h | Auth, migrations/RLS, seeded roles/workspaces, deployed create/read lead |
| Manual CRM and sales dashboard     | 24–30 h | Assignment, pipeline, history, tasks, filters, correct metrics           |
| Qualification agent                | 22–28 h | Scoped tools, retrieval, bounded n8n run, evidence/proposals in React    |
| Approval and execution             | 18–24 h | Editable review, transactional outbox, idempotent execution, recovery    |
| Follow-up and operations dashboard | 22–30 h | Scheduled bounded reviews, no-action behavior, metrics/traces            |
| Evaluation and release             | 20–30 h | Baseline comparison, tests, exports, documentation, demo                 |

Total: 120–160 hours. Deploy early. Cut drag-and-drop, vector search, advanced charts, and styling extras if time slips. One deeply evaluated agent is the fallback release; the target remains two. Do not claim unfinished capabilities.

## 14. Scope exclusions and portfolio delivery

Exclude email sync, autonomous outbound campaigns, WhatsApp, unrestricted web research, payments/invoicing, custom workflow builders, generic chatbots, agent hierarchies, forecasting models, realtime collaboration, and Kubernetes. No general document-ingestion pipeline.

Deliver code, SQL migrations/policies/tests, safe seeds, sanitized n8n exports, prompt/tool contracts, evaluation fixtures/results, setup/deployment instructions, environment templates, architecture diagram, demo credentials, and a short video.

Demo: capture/assign inquiry → agent retrieves relevant case study and identifies missing facts → salesperson edits/approves → task/dashboard update → record proposal/contact → seeded elapsed-time scenario triggers follow-up → inspect justified action or abstention → inspect evidence, tool events, and evaluations → replay execution without duplicate work.

Resume positioning after completion: “Built and deployed an agent-assisted sales CRM with React, Node.js, Supabase PostgreSQL, and n8n; implemented tool-using qualification and follow-up agents, scoped authorization, reviewed action execution, and sales/agent dashboards.” Add measured numbers only after testing.
