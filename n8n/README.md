# Local n8n + Gemini qualification

LeadDesk uses one bounded tool-using qualification agent. n8n reads a lead and curated knowledge, returns a recommendation, and stops for human review. Express validates the evidence and creates a task only after approval. This setup uses self-hosted n8n Community Edition and a Gemini API project with free-tier quota, with no n8n Cloud trial dependency.

## 1. Start persistent local n8n

Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) and start it using Linux containers. Complete any WSL/restart steps requested by the installer. In a new PowerShell window, check `docker version` and `docker compose version`.

From `E:\CRM`:

```powershell
node scripts/setup-n8n.mjs
docker compose --project-directory n8n up -d
docker compose --project-directory n8n ps
```

The setup script creates three independent secrets in ignored `n8n/.env`. It preserves existing secrets on subsequent runs and never changes your CRM `.env`. No pnpm command is needed. Open **http://localhost:5678** and create your local n8n owner account. This account is separate from Supabase.

The stack pins n8n 2.44.6, uses SQLite in a named Docker volume for workflow/credential storage, and binds local ports only to loopback. `N8N_ENCRYPTION_KEY` encrypts n8n credentials; retain it with the volume. n8n storage stays separate from Supabase's CRM tables. A single production execution runs at a time to limit model concurrency.

## 2. Import and configure the workflow

1. In the local editor's workflow menu, select **Import from File** and choose `n8n/qualification.workflow.json`.
2. Open `n8n/.env` locally, for example with `notepad n8n\.env`.
3. On **Qualification webhook**, add a **Header Auth** credential: name `X-LeadDesk-Secret`, value the file's `N8N_WEBHOOK_SECRET`. Keep authentication enabled.
4. Create an API key in [Google AI Studio](https://aistudio.google.com/api-keys) using a project on the free tier. Add that key as the **Google Gemini (PaLM) API** credential on **Choose a chat model**. The model key belongs in n8n credentials, never in React or Git.
5. The workflow selects `models/gemini-3.8-flash`. Check that your project has free-tier quota for it in AI Studio; select another available, tool-capable free-tier Gemini model if necessary. Availability and quota are account-dependent. Do not enable paid billing to follow this guide.
6. Publish/activate the workflow. Its production path is `/webhook/leaddesk-qualification`. The temporary `/webhook-test/` path is intentionally blocked by our gateway.

The context tool includes a dynamic `context_request` argument because Gemini requires a nonempty tool schema. The server only accepts `current_lead` (or the original empty body) and always derives lead scope from the signed run. The model cannot select a tenant, lead ID, or arbitrary URL.

Free-tier requests can hit rate limits, and Google may use free-tier content to improve products. Use synthetic inquiries and sample leads. See [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) and check your project's quotas in AI Studio. One qualification can make several model calls; six iterations is a ceiling, not six guaranteed requests of free capacity. No automatic provider switch or paid fallback is configured.

## 3. Connect the deployed CRM through a temporary tunnel

For portfolio demonstration sessions, start the optional Cloudflare Quick Tunnel container:

```powershell
docker compose --project-directory n8n --profile tunnel up -d
docker compose --project-directory n8n logs --tail 80 tunnel
```

Find the generated `https://something.trycloudflare.com` address in the output. Only the gateway is tunneled. It accepts POST to the exact qualification webhook path; editor, login, REST API, and other routes return 404. The webhook still requires Header Auth.

In **Render → LeadDesk service → Environment**, set:

```dotenv
N8N_WEBHOOK_URL=https://YOUR_TUNNEL.trycloudflare.com/webhook/leaddesk-qualification
N8N_WEBHOOK_SECRET=copy_from_n8n_local_env
AGENT_SIGNING_SECRET=copy_from_n8n_local_env
API_PUBLIC_URL=https://YOUR_RENDER_HOST
```

Save and redeploy Render. Keep your existing Supabase settings. `API_PUBLIC_URL` has no `/api` suffix. n8n can reach the deployed HTTPS API directly, so no second tunnel is needed. The n8n editor may display a localhost production URL: use the tunnel hostname plus the exact path above in Render instead.

Quick Tunnels need no Cloudflare account/domain, but the hostname changes on restart. Whenever it changes, update `N8N_WEBHOOK_URL` in Render and redeploy. They have no uptime guarantee and are intended for testing/development, not permanent hosting. Laptop sleep, Docker shutdown, or tunnel shutdown makes AI unavailable; the deployed manual CRM and Supabase data continue working. Do not promise always-on AI. A stable, independently running server is a later hosting decision. See [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

For fully local development instead, set the CRM `.env` to `N8N_WEBHOOK_URL=http://localhost:5679/webhook/leaddesk-qualification`, use the same two secrets, and set `API_PUBLIC_URL=http://host.docker.internal:3001`. Restart the API. The callback must be reachable from the container; if the loopback-bound API is unreachable through Docker Desktop, use the deployed API setup above rather than exposing the unauthenticated demo on your network.

## 4. Verify one real qualification

1. Open your deployed CRM, sign in, and open a synthetic non-closed lead.
2. Select **Qualify this lead** and check that n8n starts an execution.
3. Inspect the recommendation, evidence, and missing information in LeadDesk.
4. Edit the draft, add a decision note, and approve. Confirm one task and one audit record.
5. Complete the task and refresh to confirm persistence.

Keep the laptop awake during demonstrations. Open the Render app first so its API is awake before starting the model run. Quota/model errors appear as a failed qualification; wait for quota recovery or correct the selected model, then start a new run. Do not repeatedly retry quota errors.

## Daily use and backups

```powershell
# Start a demonstration session; read its current tunnel URL.
docker compose --project-directory n8n --profile tunnel up -d
docker compose --project-directory n8n logs --tail 80 tunnel
# Stop everything while keeping your stored workflows and credentials.
docker compose --project-directory n8n --profile tunnel stop
```

Do not use `down -v`: it deletes the data volume. Keep the same encryption key. Export sanitized workflow JSON after changes; credential values are not included and need separate backup. For a complete local backup, stop the stack, then use Docker Desktop to export the named `n8n_data` volume, and store that backup with `n8n/.env` privately. Restore both together. Do not commit backups, secret files, or execution payloads.

The n8n image is pinned; review release notes and back up before changing its version. The tunnel helper uses Cloudflare's current image; a restarted tunnel can require a Render URL update even without an upgrade.

## Workflow contract and verification status

- Authenticated webhook responds with HTTP 202; React polls for the result.
- Read-context and knowledge-search tools use short-lived tokens bound to one run. Tokens stay in workflow expressions, outside the model prompt.
- Schema validation and exact source quotation checks precede human review. Stale recommendations cannot be approved.
- Repeated callbacks are harmless and repeated approvals create one task per run.
- Model/parse errors report a generic failure. Abandoned executions expire on the next workspace read after 15 minutes.
- Workflow timeout is 180 seconds. Result delivery retries once. Entire model runs are not automatically retried.
- Execution-data retention is disabled for success and failure. Manual debugging can still expose inputs to the local operator; use synthetic data.

Repository tests validate API authorization, tool arguments, callback evidence, and the workflow graph. Docker startup, live import, Gemini quality, and the public tunnel require local Docker and your credential; these are not inferred from fixture tests. Demo mode remains deterministic, not actual AI.
