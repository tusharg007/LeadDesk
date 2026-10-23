# LeadDesk portfolio release

LeadDesk is a deployed, scoped CRM MVP built with React, TypeScript, Express, Supabase PostgreSQL/Auth, self-hosted n8n, and Gemini. The interface uses a Cupcake-inspired palette: teal actions, plum text, warm neutral surfaces, and pink/amber accents.

## Verified behavior

- Supabase sign-in and persisted workspace data work on the Render deployment.
- A real n8n/Gemini qualification read lead context, searched service knowledge, and delivered a validated, evidence-backed recommendation to the CRM.
- That successful sample took approximately 11 seconds. This is one observed run, not a latency benchmark or service guarantee.
- Human approval recorded a reviewer, decision note, approved wording, and source context, and created exactly one follow-up task.
- Task completion persisted after refresh. Earlier failed attempts remain in qualification history.
- The automated suite contains 13 tests covering API/database behavior, access controls, callback scope/evidence, approval idempotency, audit export, workflow contracts, and a stale-failure display regression.
- The Cupcake theme was checked across Overview, Leads, Reviews, Tasks, sign-in, lead creation, qualification review, expanded audit details, and desktop/mobile layouts using synthetic preview data.

## Resume wording

**LeadDesk — Agent-assisted CRM**

Built and deployed a React/TypeScript and Node.js CRM with Supabase PostgreSQL/Auth, sales dashboards, and a tool-using n8n/Gemini qualification agent; implemented evidence validation, human-reviewed task creation, row-level access controls, and exportable approval audit trails.

Use React/Node/PostgreSQL or PERN to describe the stack. This project uses PostgreSQL rather than MongoDB. Describe the compliance feature as decision traceability and human oversight.

## Scope and operational limits

The first release has one qualification agent and four product areas. It is ready to present as a portfolio MVP. The larger IMPLEMENTATION_PLAN.md includes future work, not additional shipped capabilities.

The public CRM is hosted on Render. AI execution uses local n8n and a temporary webhook tunnel, so the laptop, Docker, and tunnel must remain online during demonstrations. A changed tunnel hostname requires a Render environment update. Gemini free-tier quotas and free-host cold starts apply. These conditions mean the AI feature is not an always-on hosted service.

There is no claim of regulatory certification, production-scale reliability, measured model accuracy, or conversion improvement. A multi-scenario agent evaluation, permanent independent n8n hosting, public onboarding, a second follow-up agent, and autonomous outbound messaging are outside this release. Evaluation results should be published only after running and measuring those cases.

For a recruiter demonstration: sign in, create a synthetic inquiry, qualify it, inspect source evidence, edit the draft, approve with a decision note, complete the task, and inspect/export the audit record. Keep a short recording available when local AI infrastructure is offline.
