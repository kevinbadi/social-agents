# provision-railway

Build the user's Railway worker environment end to end: project, workspace upload, variables, public domain, health check. The user's only jobs were creating the Railway account and pasting an API token — everything else is yours. Uses the Railway CLI (`railway`), which uploads the LOCAL workspace directly — no GitHub connection needed.

**Upload rule that bites: plain `railway up` silently DROPS gitignored files, and `midas/` is gitignored — that deploys a worker with no config, no skills, no automations ("0 automations scheduled"). `.railwayignore` does NOT override `.gitignore`. Every upload must be `railway up --no-gitignore`, which makes `.railwayignore` the only exclusion list.**

## Before anything

1. **Token**: the CLI reads `RAILWAY_API_TOKEN`. It's saved in `~/.midas/credentials.json` under `railwayApiToken` (onboarding put it there). Export it for your commands without ever printing it:
   `export RAILWAY_API_TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.midas/credentials.json','utf8')).railwayApiToken??'')")`
   If empty, ask the human for a token from railway.app/account/tokens — an ACCOUNT token; a project-scoped token locks the CLI to that one existing project and provisioning will refuse to run there. NEVER echo, log, or write any token anywhere.
2. **CLI**: `railway --version` — if missing, `npm install -g @railway/cli` (ask first if global installs need sign-off).
3. **AI credential for the cloud worker — check before asking.** Onboarding usually already collected it: `~/.midas/credentials.json` → `workerAiKey` (the value) + `workerAiKind` (which env var it belongs in: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`). If present, USE IT silently — asking again makes it look like you lost their answer. Only if absent, ask the human for one of: `ANTHROPIC_API_KEY`, or a `claude setup-token` token (their local Claude login does not travel to the cloud).
4. Read `midas/midas.json` for `timezone` and `worker.token` (the generated `MIDAS_WORKER_TOKEN`); `~/.midas/credentials.json` has the CreatorOS `apiKey`. Never ask about spend limits or lecture on API billing — the human knows how their credentials work.

## Procedure

Run from the workspace root:

1. `railway unlink` (a 'not linked' error is fine), then `railway init --name midas-worker` — ALWAYS a fresh project; never reuse an existing one.
2. Set every variable in one shot (values from the sources above — compose the command yourself, never show values in your report):
   `railway variables --set "CREATOROS_API_KEY=…" --set "<workerAiKind>=<workerAiKey>" --set "MIDAS_WORKER_TOKEN=…" --set "TZ=<timezone>" --set "RAILWAY_DOCKERFILE_PATH=Dockerfile.worker"`
   The AI variable NAME comes from `workerAiKind` — a setup-token saved as `CLAUDE_CODE_OAUTH_TOKEN` must not be deployed as `ANTHROPIC_API_KEY`.
   `RAILWAY_DOCKERFILE_PATH` is what makes Railway build from `Dockerfile.worker` instead of autodetecting.
3. **Know what ships before uploading.** With `--no-gitignore`, `.railwayignore` is the ONLY exclusion list — make sure it exists in the workspace root with at least: `node_modules`, `.git`, `logs`, `creatoros`, `deploy`, `dist`, `.env` (the Docker build runs `npm ci` itself; a ~350MB node_modules upload chokes; `.env` must never ship). What DOES ship, on purpose: `src/` + package files + `Dockerfile.worker` (the code), `midas/` (config, skills, automations.json — gitignored, which is exactly why `--no-gitignore` is required), `templates/`, and `content-library/` (media the posting automations publish — if it's huge, warn the human that every deploy re-uploads it).
4. `railway up --detach --no-gitignore` — uploads this workspace and builds. Watch with `railway logs --build` until the build succeeds; on failure, read the error, fix, re-up. After the deploy, sanity-check the worker actually got the workspace: `/health` should list the expected automations, not 0.
5. `railway domain` — generates the public URL. Capture it.
6. `railway status --json` — capture the service id.
7. Save to `midas/midas.json`: `worker.url` (the domain, with https://), and `railway.serviceId`. `worker.token` should already be there — if not, set it to the MIDAS_WORKER_TOKEN you deployed.
8. Verify: `curl -s -H "Authorization: Bearer <worker token>" https://<domain>/health` — expect `"service":"midas-worker"`. Give the container a minute to boot before declaring failure; retry twice.

## Judgment rules

- **Secrets never appear in output.** Mask everything as `…last4`. Never write a secret into any repo file — variables live on Railway, tokens in ~/.midas.
- ALWAYS a brand-new project: `railway unlink` first (ignore 'not linked' errors), then `railway init --name midas-worker`. NEVER link to or deploy onto any existing project — not a stale midas-worker from an earlier attempt, not an unrelated app, nothing. If init keeps failing, STOP and report the exact error to the human instead of retrying in a loop or hunting for an existing project to reuse.
- If the build fails on the Dockerfile, check `RAILWAY_DOCKERFILE_PATH` was actually set before re-running.
- Cost honesty: mention once in the final report that the service runs ~$5/mo on Hobby plus AI usage — nothing more; no billing lectures.
- Any step you cannot complete non-interactively (e.g., account not on a paid plan): stop, tell the human exactly what to click, and resume after.

## Verification

`/health` responding with the schedule is the finish line — then open the loop: automations picked in chat land in `midas/automations.json`, and the deployed worker picks up file changes only at the NEXT deploy unless a volume is mounted — so after changing automations, run `railway up --detach --no-gitignore` again, or tell the human "redeploy to sync" in your report. Confirm the dashboard's Automations page shows the worker strip as up. Report: project name, domain, variables set (names only), and the verified health line.
