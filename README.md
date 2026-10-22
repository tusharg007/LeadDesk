# LeadDesk

A small, complete CRM flow: **capture a lead → qualify it → review the suggestion → create a follow-up → track progress**.

React + TypeScript, Express, Supabase PostgreSQL/Auth, and an importable n8n qualification agent. The product currently has four areas: Overview, Leads, Reviews, and Tasks.

## Run locally

Requires Node 22.12+ and pnpm. From the project directory:

```sh
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5173**. No environment file is needed for the default local demo.

The API runs at **http://127.0.0.1:3001**. `pnpm dev` starts both processes.

### What works now

- Responsive overview with pipeline distribution, open deal value, won value, closed win rate, overdue tasks, and drill-through.
- Lead creation, search, stage filter, details, stage changes, and activity notes.
- Qualification result with source excerpts, missing information, editable follow-up title/message, approve and dismiss.
- Task creation, completion/reopening, and copyable message drafts.
- Approval audit trail with mandatory decision notes, reviewer identity, timestamps, original recommendations, approved wording, and scoped JSON export.
- Review acceptance and run timing summaries, with simulated runs clearly labeled.
- Persisted local demo data and a separate Supabase-backed implementation.
- Supabase sign-in, workspace/owner isolation, SQL migrations, and checked transactional RPCs.
- A real n8n workflow definition with scoped context/retrieval tools and a validated result callback.

**Demo mode is not AI.** It uses deterministic fixture logic so the entire product can be explored without keys. Changes persist in `.data/demo.json`; they do not go to Supabase. Demo mode binds only to loopback and must not be publicly deployed.

### Deliberately small first release

One qualification agent; no autonomous email, follow-up agent, billing, invitations, vector database, Redis, or custom workflow builder. Leads are owned by their creator. Admins can see all workspace leads; salespeople see their own. Team assignment UI and public onboarding are future work. The knowledge catalogue is seeded, not editable through the UI yet.

The original `IMPLEMENTATION_PLAN.md` is the longer roadmap. This README describes the implemented scope. Approving a suggestion creates a task in one API/database transaction; an extra n8n execution workflow or outbox is unnecessary for that local business mutation.

## Connect Supabase

1. Create/use a Supabase project. Apply `supabase/migrations/001_crm.sql`, then `002_review_audit.sql` in order in the SQL editor (or through your migration workflow). Existing installations need only migration 002.
2. Create a confirmed user in Supabase Authentication. This starter has sign-in but no public registration flow.
3. Copy `.env.example` to `.env`. Set:

```dotenv
APP_MODE=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-or-legacy-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
SEED_USER_EMAIL=the-user-you-created@example.com
```

4. Run `pnpm seed:supabase`. This creates a workspace/membership and synthetic sample leads and service knowledge for that account. It will not overwrite an existing membership. It never creates a password or modifies an existing auth user. If a network error leaves a partial seed, inspect the created records rather than rerunning blindly.
5. Restart the API and sign in with that account. Remove `SEED_USER_EMAIL` after seeding if desired.

Only the publishable URL/key goes to the browser. User operations use verified access tokens and a request-scoped Supabase client. Database RLS protects reads; checked RPCs protect mutations and audit entries. The service-role key is used only on the backend for authenticated agent callbacks. Run-scoped HMAC tokens never authorize other leads or workspaces.

For another account, create its `memberships` row through the SQL editor with the intended workspace and `admin` or `sales` role. Accounts without a membership are denied. Membership management is intentionally not exposed as an unauthenticated API.

## Connect n8n

Follow [n8n/README.md](n8n/README.md). Import [the workflow](n8n/qualification.workflow.json), configure webhook authentication and a model credential, and set the n8n environment variables. The live agent button stays disabled until its configuration is supplied.

The tool-using agent reads scoped CRM context and searches curated service knowledge. The server validates its schema and exact source quotations before showing the proposal. A lead revision check prevents approving an outdated recommendation. Approval never sends a message or marks a lead as contacted.

## Project layout

```text
src/                       React UI and styles
shared/                    Contracts, validation, and stage constants
server/                    Express API, domain logic, storage implementations
supabase/migrations/       Tables, RLS, constraints, transactional RPCs
n8n/                       Importable agent workflow and prompt
scripts/                   Development launcher and explicit Supabase seed
tests/                     HTTP, domain, PostgreSQL, and workflow-contract tests
```

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

After a build, Express serves the production frontend on port 3001. CI runs typechecking, tests, and build. Database tests use PGlite (local PostgreSQL) with Supabase-style auth roles; they validate the migration, row isolation, RPC privileges, stale-review rejection, and duplicate-safe approval. They do not replace testing an actual Supabase project.

API tests cover the full create/qualify/approve/complete journey, malformed input, tenant and owner isolation, callback token scope/expiry, invented evidence, dashboard formulas, and persistent demo storage. The browser journey is also checked manually through the local UI.

## Metrics and limits

The compliance-oriented feature is decision traceability: each new approval or dismissal requires a note, records the authenticated reviewer and server timestamp, and preserves approved text separately from the original AI recommendation. Recording and task creation happen in the same transaction. Repeated approvals cannot replace the recorded decision. The Reviews screen exposes a read-only history and JSON export limited to leads visible to the signed-in user. Earlier decisions without audit data are explicitly labeled legacy records.

This demonstrates human oversight and auditability; it is not regulatory certification or a tamper-proof archive. Database administrators/service credentials can modify stored data. Retention policies, independent reviewers, regulated financial advice, and jurisdiction-specific controls are outside this starter's scope. Exports contain message drafts and source excerpts and should be handled as CRM data.

- Open pipeline excludes Won/Lost. Won value is deal amount, not recognized revenue.
- Win rate is Won / (Won + Lost), all time; an empty denominator shows no value.
- The chart shows current stage distribution, not historical conversion rates.
- Review acceptance excludes pending/failed runs. Demo timing is labeled simulated.
- Dates render in the user's locale. Follow-ups are due 24 hours after approval.
- The starter loads a small workspace snapshot. Supabase refuses truncated totals at 1,000 records per table; add pagination/SQL aggregate endpoints before growing beyond that scale.
- Local demo storage supports a single API process. Supabase transactions handle concurrent approvals.
- Callback tokens expire in 15 minutes. Stuck runs become failed on the next workspace read after that timeout. No background recovery service is required in this version.

## Deploying the live version

Build the client and run the Express server on a Node host with `APP_MODE=supabase`, `HOST=0.0.0.0`, and the required environment variables. Serve it behind HTTPS. Host n8n separately with persistent storage and a stable encryption key. Use a reachable HTTPS `API_PUBLIC_URL`. Never deploy the unauthenticated demo or commit `.env`/n8n credentials.

Live Supabase provisioning, n8n import/execution, model evaluation, and public deployment require account configuration and have not been performed by this local build. The repo includes the integration code and setup steps; it does not claim measured AI quality or production scale.
