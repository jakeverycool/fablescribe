# Fablescribe — Phase 1.5: Deployment and Environments

> **Goal:** Take the locally-running Phase 1 MVP and deploy it to two fully isolated cloud environments — `dev.fablescribe.io` for staging and `fablescribe.io` for production — with a clean promotion pipeline so changes flow dev → test → prod without breaking anything.

**Duration estimate:** ~1 week of focused work. No new product features; this is all infrastructure and plumbing.

**Prerequisites:**
- Phase 1 is complete and working end-to-end on Jake's local machine
- The `fablescribe.io` domain is registered (or whatever domain you end up using)
- GitHub repo for the project (private is fine)
- Accounts: Vercel, Railway, Supabase, Qdrant Cloud, a second Discord bot application, separate API keys for Claude and ElevenLabs dedicated to dev

---

## 1. Scope

**In scope:**
- Two fully isolated environments (dev and prod) for every service
- Domain and DNS setup (`dev.fablescribe.io` and `fablescribe.io`)
- Git branching strategy (`dev` and `main`)
- Semi-automated deploys: push to `dev` branch → auto-deploy to dev env; push to `main` → auto-deploy to prod
- Database migration tooling with env-aware runs
- Second Discord bot application for dev
- Separate API keys and secrets per environment (Claude, ElevenLabs, Deepgram all dev/prod-split)
- Basic monitoring and logging per environment
- Documented rollback procedure

**Not in scope:**
- New product features (none)
- CI with automated test gates (that's Phase 3+ polish; Phase 1.5 is semi-auto)
- Load balancing, multi-region, or high-availability infrastructure

---

## 2. Architecture

```
                    ┌──────────────────────────────────┐
                    │          GitHub Repo              │
                    │   ┌──────────┐    ┌──────────┐    │
                    │   │   dev    │    │   main   │    │
                    │   │  branch  │    │  branch  │    │
                    │   └────┬─────┘    └────┬─────┘    │
                    └────────┼───────────────┼──────────┘
                             │               │
              ┌──────────────┘               └──────────────┐
              ▼                                             ▼
     ┌────────────────┐                           ┌────────────────┐
     │  DEV ENV       │                           │  PROD ENV      │
     │                │                           │                │
     │ Vercel (front) │                           │ Vercel (front) │
     │ Railway (back) │                           │ Railway (back) │
     │ Railway (bot)  │                           │ Railway (bot)  │
     │ Supabase (dev) │                           │ Supabase (prod)│
     │ Qdrant Cloud   │                           │ Qdrant self-   │
     │  (free tier)   │                           │  hosted (Hetz) │
     │ Dev Discord bot│                           │ Prod Discord   │
     │ Dev Deepgram   │                           │ Prod Deepgram  │
     │ Dev API keys   │                           │ Prod API keys  │
     │                │                           │                │
     │ dev.fable-     │                           │ fablescribe.io │
     │ scribe.io      │                           │                │
     └────────────────┘                           └────────────────┘
```

**Key rule:** nothing in dev can reach prod data or services, and vice versa. Every service, database, vector store, Discord bot, and API key is fully duplicated. Because STT runs through Deepgram's cloud API (not on local hardware), there is no shared physical infrastructure between environments — both envs are pure cloud-to-cloud.

---

## 3. Build Steps

### 3.1 — Domain and DNS

1. Point `fablescribe.io` at Vercel (prod).
2. Point `dev.fablescribe.io` at Vercel (dev).
3. Add subdomains for the backend APIs so the frontend can talk to them:
   - `api.fablescribe.io` → prod Railway backend
   - `api-dev.fablescribe.io` → dev Railway backend
4. Add subdomains for the bots if they need inbound webhooks:
   - `bot.fablescribe.io` → prod Railway bot
   - `bot-dev.fablescribe.io` → dev Railway bot
5. Enable SSL everywhere (Vercel and Railway do this automatically via Let's Encrypt).
6. **Test:** `dev.fablescribe.io` and `fablescribe.io` both resolve. HTTPS works. A placeholder page serves on each.

### 3.2 — Two Supabase projects

1. Create a new Supabase project called `fablescribe-dev`. Copy all Phase 1 migrations into it. Run them.
2. Create a new Supabase project called `fablescribe-prod`. Run the same migrations.
3. Create separate service role keys, anon keys, and JWT secrets for each. Store them somewhere safe (password manager or a secrets vault).
4. Enable Supabase CLI locally and link both projects so migrations can be pushed to either env with a flag.
5. **Test:** Both Supabase dashboards show the correct schema. Both have independent auth. A test user in dev does not exist in prod.

### 3.3 — Migration tooling

1. Choose the migration tool: **Supabase CLI migrations** for schema changes (works well with the Supabase CLI and both projects). If Phase 1 used raw SQL files, convert them to versioned migration files in `supabase/migrations/`.
2. Add a helper script `scripts/migrate.sh` that takes an environment flag (`dev` or `prod`) and runs `supabase db push` against the correct project.
3. Document the migration workflow in `DEPLOYMENT.md`:
   - Never edit an already-applied migration
   - New migrations are always additive when possible
   - Destructive migrations (drop column, rename, etc.) require a two-step rollout: first add new + backfill, then drop old in a subsequent deploy
4. **Test:** Create a dummy migration, run against dev, verify it applies. Run against prod, verify it applies. Revert (create a compensating migration) and verify.

### 3.4 — Two Qdrant environments

1. Sign up for Qdrant Cloud free tier for dev. Create a cluster `fablescribe-dev`.
2. Set up a self-hosted Qdrant instance on the Hetzner box for prod (you already run one for ExpertAI — use a separate collection or a separate instance to keep it isolated).
3. Store the Qdrant URL and API key for each env separately.
4. **Test:** Both are reachable from your local backend with the appropriate env config. Writing to dev does not appear in prod and vice versa.

### 3.5 — Two Discord bots

1. Create a new Discord application at discord.com/developers called "Fablescribe Dev" with its own bot user and token.
2. The existing Phase 1 Discord bot becomes the prod bot. Rename it to "Fablescribe" cleanly if needed.
3. Both bots can be invited to the same test server — Discord allows multiple bots per server. Your own server with a dedicated voice channel per env ("dev-testing" and "live") is probably easiest.
4. Store both bot tokens in their respective env configs.
5. **Test:** Both bots come online in your test server. Each responds only to commands directed at it. `/join` with the dev bot connects to the dev env's backend; `/join` with the prod bot connects to prod.

### 3.6 — Separate API keys

1. Generate a second Anthropic API key exclusively for dev. Label it in the Anthropic console.
2. For ElevenLabs: ideally a separate ElevenLabs account for dev with a low character cap. If that's not feasible, at minimum a separate API key and a hard char-count safeguard in the dev backend config that aborts any TTS call over a small threshold (say, 500 chars per call).
3. For Deepgram: create a second project in the Deepgram console for dev, with its own API key. Deepgram's free $200 credit is per-project, so dev effectively gets its own free budget. Set a separate project credit limit on dev if possible to cap runaway usage.
4. Store all keys in environment variables, never in git.
5. **Test:** Verify dev's Claude calls show up in the dev API key's usage and not the prod key's. Same for ElevenLabs. Same for Deepgram (check the Deepgram console's per-project usage page).

### 3.7 — Git branching strategy

1. Set up two long-lived branches:
   - `dev` — the working branch for the dev environment
   - `main` — the production branch
2. All day-to-day work happens on feature branches cut from `dev`. Feature branches merge back into `dev` via PR.
3. When `dev` is stable and tested, merge `dev` → `main` via a PR. This triggers the prod deploy.
4. Protect `main` in GitHub so direct pushes are not allowed. Require PR with at least one passing check (can be a trivial lint check for now).
5. **Test:** Create a feature branch, open a PR into `dev`, merge it. Create a PR from `dev` into `main`, merge it. Confirm `main` cannot be pushed to directly.

### 3.8 — Frontend deployment (Vercel)

1. Create two Vercel projects:
   - `fablescribe-dev` — connected to the repo, configured to deploy the `dev` branch
   - `fablescribe-prod` — connected to the repo, configured to deploy the `main` branch
2. Add environment variables to each project:
   - `VITE_SUPABASE_URL` (dev vs. prod)
   - `VITE_SUPABASE_ANON_KEY` (dev vs. prod)
   - `VITE_BACKEND_URL` (`api-dev.fablescribe.io` vs. `api.fablescribe.io`)
3. Attach the custom domains: `dev.fablescribe.io` for dev, `fablescribe.io` for prod.
4. **Test:** Push a trivial commit to `dev`. Verify Vercel auto-deploys to dev. Merge `dev` → `main`. Verify Vercel auto-deploys to prod. Verify the frontend on each domain talks to its own backend.

### 3.9 — Backend deployment (Railway)

1. Create two Railway services:
   - `fablescribe-backend-dev` — deploys the backend code from the `dev` branch
   - `fablescribe-backend-prod` — deploys the backend code from the `main` branch
2. Add environment variables per service:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
   - `QDRANT_URL`, `QDRANT_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `DEEPGRAM_API_KEY`
   - `BOT_WEBSOCKET_SECRET`
   - `ENV` = `dev` or `prod`
3. Railway CPU-only instances are fine — there is no GPU requirement anywhere in the stack.
4. Attach custom domains: `api-dev.fablescribe.io` and `api.fablescribe.io`.
5. Run migrations against the corresponding Supabase project as part of the deploy (Railway supports pre-deploy commands — run `scripts/migrate.sh $ENV` there).
6. **Test:** Push a trivial backend change to `dev`, verify Railway redeploys, verify `/health` responds. Merge to `main`, verify prod redeploys. Verify each backend talks to its own Supabase, Qdrant, and Deepgram project.

### 3.10 — Bot deployment (Railway)

1. Create two Railway services for the Node bot:
   - `fablescribe-bot-dev`
   - `fablescribe-bot-prod`
2. Environment variables per service:
   - `DISCORD_BOT_TOKEN` (dev token vs. prod token)
   - `BACKEND_URL` (dev API vs. prod API)
   - `BOT_WEBSOCKET_SECRET` (matching the backend's)
   - `ENV` = `dev` or `prod`
3. No custom domain needed unless the bot exposes a webhook (it shouldn't for Phase 1.5 — the bot is an outbound websocket client).
4. **Test:** Push a bot change to `dev`, verify the dev bot reconnects after redeploy and shows online in Discord. Same for prod.

### 3.11 — Deepgram project isolation verification

Since Deepgram is cloud-hosted and each environment uses its own project + API key (set up in §3.6), there's no infrastructure to deploy here — just verification that the isolation actually works end-to-end.

1. Confirm the dev backend's `DEEPGRAM_API_KEY` env var is set to the dev project's key and the prod backend's is set to the prod project's key.
2. Open the Deepgram console, go to the dev project's usage tab, note the current credit balance.
3. Run a short test session on dev, speak for 30 seconds.
4. Verify the dev project's usage increased and the prod project's usage did not.
5. Run a short test session on prod, speak for 30 seconds.
6. Verify the prod project's usage increased and the dev project's usage did not.
7. **Test:** Attempt to use the prod Deepgram key in the dev backend (temporarily, in a test env var override) and confirm dev explicitly rejects it. Restore the correct key. This is a paranoid sanity check but worth doing once.

**No local processes, no tunnels, no GPU setup.** This step exists entirely as a checkpoint to confirm the API-key isolation done in §3.6 actually holds.

### 3.12 — Secrets management

1. Never commit secrets to git.
2. Store secrets in:
   - Vercel project env vars (for frontend builds)
   - Railway project env vars (for backend and bot)
3. Document all required env vars in `.env.example` at the repo root so new environments can be bootstrapped from the list.
4. Keep a password-manager entry with every secret and its purpose. If Jake gets hit by a bus, someone needs to know what's where.
5. **Test:** Clone the repo fresh, attempt to run it without any env vars, verify you get clear errors identifying what's missing.

### 3.13 — Rollback procedure

1. Document a one-command prod rollback in `DEPLOYMENT.md`:
   - Identify the previous known-good commit on `main`
   - `git revert` it or `git reset --hard` + force-push (the latter requires temporary unprotecting main)
   - Railway and Vercel will auto-redeploy the reverted commit
   - If migrations were applied in the broken release, run the compensating migration manually against prod Supabase
2. Test the rollback procedure at least once in a safe scenario (deploy a cosmetic change, roll it back, verify the old version is live).
3. **Test:** Simulated broken deploy → execute rollback → verify prod is back to previous state within 5 minutes.

### 3.14 — Monitoring and logging basics

1. Railway and Vercel both include basic logs — make sure you know how to find them for each service.
2. Add a minimal health endpoint on every service and a simple uptime check (Uptime Robot free tier works):
   - `api.fablescribe.io/health`
   - `api-dev.fablescribe.io/health`
3. Configure Uptime Robot to alert Jake via email/Discord if any prod service goes down for more than 5 minutes.
4. Add basic structured logging in the backend so errors are queryable (just console logs with JSON structure is fine for Phase 1.5; proper observability is Phase 3+).
5. **Test:** Intentionally break the prod health endpoint for 5 minutes, verify alert fires, restore it, verify alert clears.

### 3.15 — End-to-end pipeline test

This is the Phase 1.5 definition-of-done test:

1. Make a small visible change in the frontend (e.g., change a button label).
2. Commit to a feature branch, open a PR into `dev`, merge.
3. Verify dev.fablescribe.io shows the change within ~5 minutes of merge.
4. Open a dev session, run the Phase 1 end-to-end test (create campaign, generate response, play audio, ask chatbot).
5. Verify no prod data or secrets were touched during dev testing.
6. Open a PR from `dev` → `main`, merge.
7. Verify fablescribe.io shows the change within ~5 minutes.
8. Run the same end-to-end test in prod with a prod campaign.
9. Verify dev data and prod data remained fully separated.
10. Practice the rollback: revert the main PR, verify prod reverts.

---

## 4. Testing Protocol

**Automated tests:**
- A basic smoke test on each deploy that hits `/health` on frontend, backend, and bot
- Supabase migration dry-run before applying (Supabase CLI supports this)

**Manual tests:**
- The Step 3.15 end-to-end pipeline test
- Intentional-break drills: break the dev backend, verify dev is down but prod is untouched
- Migration rollback drill: apply a reversible migration, revert it
- Secret rotation drill: rotate the dev Claude API key and verify dev keeps working

---

## 5. Definition of Done

- [ ] `dev.fablescribe.io` and `fablescribe.io` both serve the app with full isolation
- [ ] Push to `dev` branch auto-deploys to dev env; push to `main` auto-deploys to prod
- [ ] Both Discord bots are live and connect only to their own env's backend
- [ ] Dev uses dev-only Anthropic, ElevenLabs, and Deepgram keys; prod uses prod keys
- [ ] Dev Supabase and prod Supabase contain independent data
- [ ] Dev and prod Qdrant collections are independent
- [ ] Deepgram usage is correctly attributed to the right project per environment
- [ ] Migration tooling is documented and tested in both envs
- [ ] Rollback procedure is documented and tested at least once
- [ ] Uptime monitoring is live for prod services
- [ ] `DEPLOYMENT.md` documents the full workflow, env vars, and common operations
- [ ] Phase 1 end-to-end test passes on dev and prod independently
- [ ] No Phase 1 functionality has regressed

---

## 6. Known Gotchas

- **Discord bot tokens are single-session.** You cannot run the same bot token in two places at once. If you see "logged in somewhere else" errors, you're almost certainly using the same token for dev and prod.
- **Vercel builds cache aggressively.** If a deploy seems to ignore env var changes, trigger a fresh build (not a cached redeploy).
- **Railway free tier is no longer a thing.** Budget for ~$5/month per Railway service, so ~$10/month for dev backend + dev bot and another ~$10 for prod equivalents.
- **Supabase CLI migrations are one-way.** There's no "down" migration by default. Plan schema changes carefully; when in doubt, write forward-only migrations and handle rollback via compensating migrations.
- **Don't mix dev and prod cookies.** If you test dev and prod in the same browser, the Supabase SDK can get confused about which session is which. Use separate browser profiles or incognito for prod testing.
- **Rate limits are per-key.** Dev and prod each count against their own Anthropic, ElevenLabs, and Deepgram rate limits. A runaway dev loop eats the dev quota, not the prod quota — which is the point.
- **Domain propagation can take up to 48 hours** for first-time setup. Do §3.1 first so propagation completes while you work on other steps.
- **Deepgram outages take both envs down for transcription.** Since dev and prod share Deepgram as a vendor (though not as projects), a Deepgram-side incident affects both. Subscribe to their status page. No offline fallback is planned for v1; document this in the service status page when it exists.
- **Deepgram's $200 free credit is per-project.** Dev gets its own credit, prod gets its own. Budget accordingly — once prod credit runs out, you're paying per-minute in real money.

---

## 7. Ongoing Workflow (post-deployment)

Document this in `DEPLOYMENT.md` for reference during regular development:

### Making a change
1. Create a feature branch from `dev`: `git checkout -b feature/whatever`
2. Build and test locally
3. Open a PR into `dev`
4. Merge PR → dev branch updates → dev env auto-deploys
5. Test on `dev.fablescribe.io` with real browser + Discord flow

### Promoting to prod
1. When dev is stable, open a PR from `dev` → `main`
2. Review the diff once more
3. Merge → prod env auto-deploys
4. Smoke-test on `fablescribe.io` immediately after deploy
5. If anything is broken, execute the rollback procedure

### Schema changes
1. Create migration file: `supabase migration new <name>`
2. Edit the SQL
3. Run against local dev: `supabase db push --project-ref <dev>`
4. Commit the migration file to `dev` branch
5. Merge to `dev` — migration runs automatically via pre-deploy hook
6. When promoting to prod, migration runs against prod Supabase on the same merge

### Secret rotation
1. Generate new secret from the relevant provider
2. Update in Railway / Vercel env vars
3. Trigger a redeploy of affected services
4. Verify new secret works
5. Revoke old secret at the provider

---

## 8. Claude Code Execution Notes

- Phase 1.5 is almost entirely configuration and deployment work. Very little code is written beyond small helper scripts and the migration runner.
- Do not rush §3.2 (two Supabase projects) or §3.6 (separate API keys including Deepgram). Getting isolation wrong at either point is the worst-case scenario — it means dev can see or write prod data, or dev usage gets billed to prod.
- Test every isolation boundary explicitly: dev bot should not be able to reach prod backend, dev Supabase queries should never return prod data, dev Qdrant should never contain prod vectors.
- If any isolation test fails, STOP and fix it before proceeding. Do not "fix later."
- Document any deviations from this plan in `PHASE_1_5_NOTES.md`. Future phases will reference the exact infrastructure choices made here.
- When in doubt about an infrastructure choice, prefer the simpler option. This phase is not a chance to perfect ops practices; it's a chance to get a working dev/prod split in place cheaply.
