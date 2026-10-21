# Connect the qualification agent

This is one bounded tool-using agent, not a second application backend. It reads a lead and curated service knowledge, returns evidence-backed qualification, and stops for human review. Express validates the result; the user approves an editable follow-up in React. Approval creates a task transactionally in Postgres.

## Setup

1. Configure Supabase mode first (see the root README).
2. Import `qualification.workflow.json` into a recent n8n installation supporting AI Agent v2.2 and HTTP Request tool v4.2. The workflow is inactive by default.
3. On **Qualification webhook**, create/select a **Header Auth** credential: header name `X-LeadDesk-Secret`, value a random secret. Put the same value in the API's `N8N_WEBHOOK_SECRET`. Do not remove webhook authentication.
4. On **Choose a chat model**, configure an Anthropic credential and choose a model available to your account. The supplied model ID is a starting configuration, not a guarantee of future availability. You can replace this node with another n8n chat-model provider that supports tools.
5. Publish/activate the workflow. Copy its **Production** webhook URL into `N8N_WEBHOOK_URL` in LeadDesk's `.env`.
6. Set `AGENT_SIGNING_SECRET` to an independent random value of at least 32 characters. Generate locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`; keep it in `.env`, not in source control.
7. Set `API_PUBLIC_URL` to an API address reachable **from n8n**. A desktop-hosted n8n can use `http://127.0.0.1:3001`. A container may use `http://host.docker.internal:3001`, depending on network configuration. A hosted n8n needs your deployed HTTPS API. Do not point this at the Vite frontend.
8. Restart LeadDesk. Sign in, open a non-closed lead, and select **Qualify this lead**.

LeadDesk sends only a run ID, API URL, and expiring run token to n8n. The prompt does not include credentials. Tool URLs and Authorization headers use fixed workflow expressions; the model supplies only a short knowledge search query. Each token is bound to one run for 15 minutes.

## Workflow contract

- The webhook responds immediately with HTTP 202; the UI polls for the result.
- `Read lead context` retrieves only that run's lead, notes, and open tasks.
- `Search service knowledge` searches knowledge only inside its workspace.
- The model chooses searches from the inquiry; at most six agent iterations are configured.
- `Parse recommendation` parses a JSON response. `Save for human review` calls the API's validated callback. Evidence quotes must match their cited source exactly.
- Invalid output, source mismatch, or changed lead state cannot produce a task. A failed run is visible and can be retried by starting a new qualification.
- Model/parse errors report a generic failure. Executions interrupted before that callback expire when the workspace is next loaded after 15 minutes.
- The API owns duplicate prevention. Repeated result delivery is harmless; repeated approval creates one task per run.

The workflow has a 180-second execution timeout. It does not retry the entire model execution automatically. The result delivery node retries once. Success/error execution-data retention is disabled in the export because run tokens and lead text are in execution inputs. Manual debug sessions can still expose those inputs to trusted n8n operators; prune them and use synthetic data for debugging.

## Verification status

The JSON graph and prompt contracts are checked locally, and the API callback/tool behavior is integration-tested. A live import and paid model run require your n8n instance and model credential and have **not** been performed. Validate node versions/credentials after importing. Do not describe the local simulated mode as actual AI.

Future additions should follow demonstrated need. A follow-up agent, embeddings, campaign sending, and a separate queue are intentionally absent from this first version.
