# Fablescribe

> AI-powered DM storytelling toolkit: live Discord voice transcription, DM-curated campaign memory, AI-voiced NPC responses, and a campaign-memory chatbot.

**Status:** Phase 1 complete (single-user MVP, runs locally).

For developer documentation, see [DEVELOPER.md](DEVELOPER.md).
For product vision, see [READ_ME/fablescribe-preplanning.md](READ_ME/fablescribe-preplanning.md).

---

## Features (Phase 1)

- **Live Discord transcription** with per-speaker attribution via Deepgram Nova-3
- **Campaign management**: campaigns, sessions, characters (NPC + PC), glossary, file uploads
- **DM-curated memory log**: promote transcript lines to notes, log standalone events
- **NPC response generation** with Claude Sonnet using a three-layer prompt (immediate context + character knowledge + historical RAG via Qdrant)
- **ElevenLabs v3 TTS** with auto-prepended character direction tags
- **Audio queue + Discord playback** — generated NPC responses play through the bot in your voice channel
- **Campaign memory chatbot** powered by Qdrant + Claude
- **Player character tracking**: map Discord speakers to player characters so the AI knows who's speaking
- **Character presence tracking**: NPCs only "remember" what they witnessed
- **Magic link auth** via Supabase

---

## Prerequisites

- **Node.js 18+** (18.17+ preferred for discord.js compatibility)
- **Python 3.11+**
- **Docker** (for Qdrant)
- **A Discord bot** with the **Server Members Intent** enabled, added to your server
- **Supabase project** with the migration applied (`db/supabase_migration.sql`) and three storage buckets: `campaign-files`, `session-audio`, `response-audio`
- **API keys** for:
  - Anthropic (Claude)
  - ElevenLabs (Starter tier or higher — required for library voices via API; key needs `voices_read` permission)
  - Deepgram
  - Nomic Atlas (for embeddings)

---

## First-Time Setup

### 1. Apply the Supabase schema
Open the Supabase SQL Editor and run [db/supabase_migration.sql](db/supabase_migration.sql).

### 2. Create Storage buckets
In the Supabase dashboard → Storage, create three private buckets:
- `campaign-files`
- `session-audio`
- `response-audio`

### 3. Disable email confirmations (dev only)
Supabase dashboard → Authentication → Settings → turn off "Enable email confirmations" so magic links work instantly.

### 4. Install dependencies

```bash
# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Bot
cd ../bot
npm install --legacy-peer-deps
npm run register   # one-time slash command registration

# Frontend
cd ../frontend
npm install
```

### 5. Create env files

**`backend/.env`**:
```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<sb_publishable_...>
SUPABASE_SERVICE_ROLE_KEY=<sb_secret_...>
SUPABASE_DB_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
DEEPGRAM_API_KEY=<...>
ANTHROPIC_API_KEY=<sk-ant-...>
ELEVENLABS_API_KEY=<sk_...>
NOMIC_API_KEY=<nk-...>
QDRANT_URL=http://localhost:6333
BOT_SECRET=fablescribe-bot-secret-phase1
```

**`bot/.env`**:
```
DISCORD_TOKEN=<...>
DISCORD_CLIENT_ID=<app_id>
BACKEND_WS_URL=ws://127.0.0.1:8000/ws/bot
BOT_SECRET=fablescribe-bot-secret-phase1
```

> **Note:** Use `127.0.0.1` rather than `localhost` in connection URLs — on macOS, `localhost` resolves to IPv6 (`::1`) while uvicorn defaults to IPv4, causing silent connection failures.

---

## Quick Start

Run each service in its own terminal:

### 1. Qdrant
```bash
docker compose up -d
```

### 2. Backend (Python)
```bash
cd backend
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Bot (Node.js)
```bash
cd bot
node src/index.js
```

### 4. Frontend (React + Vite)
```bash
cd frontend
npx vite --host
```

Then open [http://localhost:5173](http://localhost:5173).

---

## Usage

1. **Sign in** with your email (magic link)
2. **Create a campaign** from the home page
3. **Add NPCs** in the Characters tab (assign voices from your ElevenLabs "My Voices")
4. **Add player characters** in the Players tab
5. **Add glossary entries** for places, factions, items, lore
6. **Create a session** in the Sessions tab and click "Start Session"
7. **Use `/join`** in Discord — the bot joins your current voice channel
8. **Speak** — transcripts appear live in the dashboard
9. **Map speakers** to roles in the Players tab (DM, player, or unknown). Players can be assigned to specific PCs
10. **Mark NPCs as present** in the right-side panel of the Sessions tab
11. **Select transcript lines** (click or drag) and either:
    - **Promote to Memory** — saves as a note
    - **Generate Response** — Claude writes NPC dialogue → DM edits → ElevenLabs generates audio → audio queue
12. **Click Play** in the audio queue to have the bot play the response in Discord
13. **Ask the chatbot** in the Chatbot tab — it searches across your characters, glossary, and memory entries

---

## Ports

| Service | Port | Notes |
|---|---|---|
| Frontend (Vite) | 5173 | Use `--host` to expose on LAN |
| Backend (FastAPI) | 8000 | Bound to `0.0.0.0` |
| Bot HTTP | 3001 | Localhost only |
| Qdrant | 6333 | Docker, localhost |

---

## LAN Access (let other people on your network try the app)

1. Make sure all services are running
2. Find your LAN IP: `ipconfig getifaddr en0`
3. Tell others to open `http://<your-lan-ip>:5173`
4. They'll need to sign in with their own email and create their own campaign — data is isolated per user via Supabase RLS

---

## Troubleshooting

**Bot joins voice channel but no transcripts appear**
- Check that `@discordjs/voice` is `>=0.19.2` (run `node -e "console.log(require('@discordjs/voice/package.json').version)"` from `bot/`)
- Verify `Server Members Intent` is enabled in the Discord Developer Portal
- Make sure you have an **active session** in the UI before speaking — transcripts are dropped if no session is active

**TTS fails with 402 Payment Required**
- ElevenLabs free tier doesn't allow library voices via API. Upgrade to Starter ($5/mo) or higher
- Make sure your API key has the `voices_read` permission

**Chatbot doesn't know about characters/glossary I created**
- Click the **Reindex** button in the campaign header to backfill Qdrant. This is needed once for entries created before vectorization was wired in

**Voice connection cycles forever without reaching Ready**
- Encryption library missing — verify with `node -e "const { generateDependencyReport } = require('@discordjs/voice'); console.log(generateDependencyReport());"` from `bot/`. You should see `native crypto support for aes-256-gcm: yes`

---

## Architecture

See [DEVELOPER.md](DEVELOPER.md) for the full architecture diagram, data model, and per-flow walkthroughs.
