# Fablescribe — Deployment Guide

> Phase 1.5: Two fully isolated cloud environments — `dev.fablescribe.io` (staging) and `fablescribe.io` (production).

For the Phase 1 single-machine local setup, see [README.md](README.md). For codebase internals, see [DEVELOPER.md](DEVELOPER.md).

---

## 1. Architecture Overview

```
GitHub (jakeverycool/fablescribe)
  │
  ├── dev branch ──→ [push] ──→ GitHub Actions ──→ Build images ──→ GHCR
  │                                     │
  │                                     └──→ SSH deploy ──→ Hetzner DEV box
  │                                                          ├── caddy
  │                                                          ├── backend (FastAPI)
  │                                                          ├── bot (Node)
  │                                                          └── qdrant
  │                  Vercel (dev project) ──→ dev.fablescribe.io
  │                  Supabase Dev project (independent data)
  │
  └── main branch ─→ [push] ──→ GitHub Actions ──→ Build images ──→ GHCR
                                        │
                                        └──→ SSH deploy ──→ Hetzner PROD box
                                                             ├── caddy
                                                             ├── backend
                                                             ├── bot
                                                             └── qdrant
                     Vercel (prod project) ─→ fablescribe.io
                     Supabase Prod project (independent data)
```

**Isolation rules:**
- Two separate Hetzner boxes (one per env). Each runs its own backend, bot, and Qdrant.
- Two separate Supabase projects (`fablescribeio` for prod, `Fablescribe Dev` for dev). Auth, data, and storage are fully separated.
- Two separate Discord bot applications (each with its own token). Same physical Discord server is fine — Discord allows multiple bot users.
- Two separate Anthropic API keys (one labeled "dev", one for prod) so a runaway dev loop doesn't burn prod budget.
- Shared (for now): ElevenLabs, Deepgram, Nomic. Phase 2 will split these too.

---

## 2. One-Time Setup

### 2.1 — Prerequisites
- GitHub repo: `jakeverycool/fablescribe`
- Cloudflare account managing the `fablescribe.io` zone
- Two Hetzner Cloud servers (CX22 or larger, Ubuntu 24.04)
- Two Supabase projects (prod + dev) with the schema migration applied and `campaign-files`, `session-audio`, `response-audio` buckets created
- Two Anthropic API keys
- Vercel account
- Domain `fablescribe.io` registered

### 2.2 — DNS records (Cloudflare)

Add these to the `fablescribe.io` zone in Cloudflare:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `@` (root) | `<vercel ip>` | Off (Vercel manages cert) |
| CNAME | `www` | `cname.vercel-dns.com` | Off |
| CNAME | `dev` | `cname.vercel-dns.com` | Off |
| A | `api` | `<prod hetzner box ip>` | Off (Caddy manages cert) |
| A | `api-dev` | `<dev hetzner box ip>` | Off |

**Why proxy off:** both Vercel and Caddy obtain Let's Encrypt certs directly, which requires DNS-only mode (no Cloudflare proxy in front).

### 2.3 — Provision the Hetzner boxes

For **each** box (dev and prod):

```bash
# Local: copy bootstrap script to the box
scp deploy/bootstrap.sh root@<box_ip>:/tmp/

# On the box: install Docker, configure firewall, create deploy user
ssh root@<box_ip> 'bash /tmp/bootstrap.sh'

# Copy the compose, Caddyfile, and deploy script
scp deploy/docker-compose.yml deploy/Caddyfile deploy/deploy.sh \
    deploy@<box_ip>:/opt/fablescribe/
ssh deploy@<box_ip> 'chmod +x /opt/fablescribe/deploy.sh'

# Create the .env file from env.example and fill in real values
cp deploy/env.example deploy/.env.dev
$EDITOR deploy/.env.dev          # use Supabase Dev + Anthropic Dev key
scp deploy/.env.dev deploy@<dev_box_ip>:/opt/fablescribe/.env

cp deploy/env.example deploy/.env.prod
$EDITOR deploy/.env.prod         # use Supabase Prod + Anthropic Prod key
scp deploy/.env.prod deploy@<prod_box_ip>:/opt/fablescribe/.env
```

**Important:** the `.env.dev` and `.env.prod` files MUST live outside the git repo (or at least be gitignored). The `deploy/env.example` template is the only thing committed.

### 2.4 — GitHub repo secrets

Go to **GitHub repo → Settings → Secrets and variables → Actions** and add:

| Name | Value |
|---|---|
| `DEV_SSH_HOST` | dev box IP or hostname |
| `PROD_SSH_HOST` | prod box IP or hostname |
| `SSH_PRIVATE_KEY` | private key matching the public key in `/home/deploy/.ssh/authorized_keys` on each box |

### 2.5 — Vercel projects

Create **two** Vercel projects, both connected to the GitHub repo:

#### `fablescribe-dev`
- **Framework preset**: Vite
- **Root directory**: `frontend`
- **Branch**: `dev`
- **Domain**: `dev.fablescribe.io`
- **Env vars**:
  - `VITE_SUPABASE_URL` = dev Supabase URL
  - `VITE_SUPABASE_ANON_KEY` = dev anon key
  - `VITE_BACKEND_URL` = `https://api-dev.fablescribe.io`

#### `fablescribe-prod`
- **Framework preset**: Vite
- **Root directory**: `frontend`
- **Branch**: `main`
- **Domain**: `fablescribe.io` (and `www.fablescribe.io`)
- **Env vars**:
  - `VITE_SUPABASE_URL` = prod Supabase URL
  - `VITE_SUPABASE_ANON_KEY` = prod anon key
  - `VITE_BACKEND_URL` = `https://api.fablescribe.io`

### 2.6 — First deploy

Push to `dev` to trigger the first build + deploy:

```bash
git checkout -b dev
git push -u origin dev
```

GitHub Actions will:
1. Build `fablescribe-backend` and `fablescribe-bot` images and push to GHCR
2. SSH into the dev Hetzner box and run `deploy.sh`

After the first deploy, verify:
- `https://api-dev.fablescribe.io/health` returns `{"status":"ok"}`
- `https://dev.fablescribe.io` loads and lets you sign in
- The dev Discord bot comes online when you `/join`

Then merge `dev` → `main` to deploy prod the same way.

---

## 3. Day-to-Day Workflow

### Making a change
```bash
git checkout dev
git pull
git checkout -b feat/your-change
# ... make changes, test locally ...
git push -u origin feat/your-change
gh pr create --base dev
```

Merge the PR. GitHub Actions builds and deploys to dev automatically (~3-5 minutes).

Test on `https://dev.fablescribe.io`. If it works:

```bash
gh pr create --base main --head dev --title "Promote to prod"
```

Merge → prod auto-deploys.

### Schema changes

1. Update `db/supabase_migration.sql` (or add a new file under `db/migrations/` if you've started versioning).
2. Run it manually in the **dev** Supabase SQL Editor first.
3. Test on dev.fablescribe.io.
4. If good, run it in the **prod** Supabase SQL Editor.
5. Merge the code change to `main`.

> **Note:** Phase 1.5 is intentionally manual on migrations — Supabase CLI integration with the deploy pipeline is Phase 2 work. The risk of an automated migration breaking prod is too high without a proven workflow.

### Secret rotation

1. Generate new value at the provider (Anthropic, Discord, etc.)
2. Update the relevant `.env` file on the affected box(es): `ssh deploy@<box> 'vi /opt/fablescribe/.env'`
3. Restart services: `ssh deploy@<box> 'cd /opt/fablescribe && docker compose up -d'`
4. Verify the change took effect, then revoke the old secret at the provider.

### Manual deploy (skip the pipeline)

```bash
ssh deploy@<box_ip>
cd /opt/fablescribe
./deploy.sh latest    # or ./deploy.sh <specific_sha>
```

---

## 4. Rollback

### Frontend (Vercel)
Vercel keeps every previous build. Go to **Vercel dashboard → project → Deployments**, find the last known-good one, click **Promote to Production**.

### Backend / Bot (Hetzner)
Each image is tagged with the commit SHA in GHCR. To roll back:

```bash
ssh deploy@<box_ip>
cd /opt/fablescribe
./deploy.sh <previous_known_good_sha>
```

You can find recent SHAs in GHCR or in the GitHub Actions history.

### Schema migrations
There is no automatic down-migration. If you need to roll back a schema change, write a compensating migration and apply it manually via the Supabase SQL Editor.

---

## 5. Monitoring

Phase 1.5 keeps monitoring minimal. Use:

- **Uptime Robot** (free tier) — set up two HTTP monitors:
  - `https://api.fablescribe.io/health`
  - `https://api-dev.fablescribe.io/health` (optional — dev going down isn't urgent)
  - Alert via email if prod goes down for >5 minutes.

- **Hetzner Cloud console** — basic CPU/RAM/disk graphs per box.

- **Container logs**:
  ```bash
  ssh deploy@<box_ip>
  cd /opt/fablescribe
  docker compose logs -f backend
  docker compose logs -f bot
  ```

---

## 6. Costs (estimated)

| Item | Cost/mo |
|---|---|
| 2× Hetzner CX22 (dev + prod) | ~$8 |
| Domain (`fablescribe.io`) | ~$1/mo amortized |
| Vercel (free tier) | $0 |
| Supabase (free tier × 2) | $0 |
| GitHub Container Registry (free for public; ~$0 for private under quota) | $0 |
| Cloudflare DNS | $0 |
| Anthropic / ElevenLabs / Deepgram / Nomic | usage-based |
| **Infrastructure subtotal** | **~$9/mo** |

---

## 7. Known Gotchas

- **Don't run the same Discord bot token in two places.** The dev box uses the dev bot token; the prod box uses the prod bot token. They're separate Discord applications.
- **Cloudflare proxy mode breaks Let's Encrypt.** Set DNS records to **DNS only** (grey cloud), not proxied.
- **Vercel build cache.** If a deploy seems to ignore env var changes, trigger a fresh build (not a cached redeploy).
- **GHCR auth.** The first time you pull from GHCR on a Hetzner box, you need to authenticate: `echo $GHCR_TOKEN | docker login ghcr.io -u <username> --password-stdin`. The deploy.sh script assumes auth is already set up. (Or make the GHCR repos public and skip auth entirely.)
- **Backend → bot HTTP playback** uses the docker network internal hostname `bot:3001`. This only works when both containers are on the same `fablescribe` network in `docker-compose.yml`.
- **Supabase Realtime** uses the anon key from the frontend's env vars — make sure the frontend env vars match the same Supabase project as the backend on each environment.
- **Two Hetzner boxes ≠ free tier.** Hetzner Cloud is pay-per-hour billed monthly. Don't forget about them if you tear down the project.

---

## 8. References

- Pre-planning: [READ_ME/fablescribe-preplanning.md](READ_ME/fablescribe-preplanning.md)
- Phase 1.5 plan: [READ_ME/fablescribe-phase-1-5.md](READ_ME/fablescribe-phase-1-5.md)
- Codebase internals: [DEVELOPER.md](DEVELOPER.md)
- Local dev quickstart: [README.md](README.md)
