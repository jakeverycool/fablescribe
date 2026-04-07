# Fablescribe — Developer Documentation

> AI-powered DM storytelling toolkit: live Discord voice transcription, DM-curated campaign memory, AI-voiced NPC responses, and a campaign-memory chatbot.

This document describes the current state of the codebase through Phase 1.5 (deployed dev + prod environments). For product vision and design rationale, see [`READ_ME/fablescribe-preplanning.md`](READ_ME/fablescribe-preplanning.md). For phase-by-phase build plans, see [`READ_ME/fablescribe-phase-*.md`](READ_ME/). For the deployment runbook, see [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## 1. Repo Structure

```
fablescribe/
├── bot/                            # Node.js Discord bot (voice receive + audio playback)
│   ├── src/
│   │   ├── index.js                    # Main bot entry: slash commands, voice receive, HTTP server
│   │   ├── audio-processor.js          # 48kHz stereo → 16kHz mono PCM downsampler
│   │   └── register-commands.js        # One-time slash command registration
│   ├── Dockerfile                  # Production image (Node 20-slim)
│   ├── .dockerignore
│   ├── .env.example                # Template for local dev
│   └── package.json
│
├── backend/                        # Python FastAPI backend
│   ├── main.py                     # FastAPI app, lifespan, CORS, WebSocket + voices endpoints
│   ├── config.py                   # Env-driven config (ENV, ALLOWED_ORIGINS, BOT_HTTP_URL, etc.)
│   ├── auth.py                     # Supabase JWT verification, DM permission helper
│   ├── db.py                       # Async psycopg connection + query helpers
│   ├── vectorization.py            # Qdrant client (with optional API key) + Nomic embedding wrapper
│   ├── routers/                    # FastAPI routers
│   │   ├── campaigns.py                # CRUD + audio queue + reindex
│   │   ├── sessions.py                 # Lifecycle + transcript fetch
│   │   ├── characters.py               # CRUD with kind=npc/pc filter
│   │   ├── speakers.py                 # Discord speaker → role/PC mapping
│   │   ├── glossary.py                 # CRUD with auto-vectorization
│   │   ├── files.py                    # Upload/download via Supabase Storage
│   │   ├── memory.py                   # Notes, events, response generation, finalization
│   │   └── chatbot.py                  # Qdrant RAG → Claude historian
│   ├── prompts/
│   │   └── response.py             # Three-layer prompt assembly for NPC responses
│   ├── stt/
│   │   ├── deepgram_client.py          # Per-speaker Deepgram WebSocket manager
│   │   └── vad_gate.py                 # Silero VAD gate + transcript routing
│   ├── Dockerfile                  # Production image (Python 3.11-slim)
│   ├── .dockerignore
│   └── .env.example                # Template for local dev
│
├── frontend/                       # React + Vite + TypeScript SPA
│   ├── src/
│   │   ├── App.tsx                     # Router + auth gate + ToastProvider
│   │   ├── lib/
│   │   │   ├── supabase.ts             # Supabase client + apiFetch (env-driven backend URL)
│   │   │   ├── auth.tsx                # AuthProvider context
│   │   │   └── toast.tsx               # Global toast notifications
│   │   ├── pages/
│   │   │   ├── Login.tsx               # Magic link sign-in
│   │   │   ├── Campaigns.tsx           # Campaign list + create
│   │   │   └── CampaignDetail.tsx      # Tab shell + Reindex button
│   │   └── components/
│   │       ├── SessionsTab.tsx         # Live transcript, presence panel, generate flow
│   │       ├── CharactersTab.tsx       # NPC CRUD with voice picker + preview
│   │       ├── PlayersTab.tsx          # PC CRUD + Discord speaker assignment
│   │       ├── GlossaryTab.tsx         # Glossary entries CRUD
│   │       ├── FilesTab.tsx            # File upload/download
│   │       ├── MemoryTab.tsx           # Memory log (notes/events/responses)
│   │       ├── ChatbotTab.tsx          # RAG chat interface (state lifted to parent)
│   │       └── AudioQueue.tsx          # Floating audio queue panel
│   ├── .env.example                # Template for local dev
│   └── package.json
│
├── db/
│   ├── init.sql                    # (Phase 0) Local Postgres schema (legacy)
│   └── supabase_migration.sql      # Full Supabase schema with RLS, applied to both projects
│
├── deploy/                         # Phase 1.5 production deployment artifacts
│   ├── docker-compose.yml              # Production stack: caddy + backend + bot + qdrant
│   ├── Caddyfile                       # Reverse proxy with auto Let's Encrypt
│   ├── env.example                     # Production env template
│   ├── bootstrap.sh                    # One-time Hetzner box setup (Docker, ufw, deploy user)
│   └── deploy.sh                       # Server-side pull-and-restart, called by GHA over SSH
│
├── .github/
│   └── workflows/
│       └── deploy.yml              # Build images → push to GHCR → SSH deploy to Hetzner
│
├── docker-compose.yml              # Local Qdrant container (dev only)
├── README.md                       # Local quickstart
├── DEPLOYMENT.md                   # Production deploy runbook
└── DEVELOPER.md                    # This file
```

---

## 2. Tech Stack

### Application
| Layer | Tech | Notes |
|---|---|---|
| Discord bot | Node.js 20, discord.js v14, @discordjs/voice 0.19.2, opusscript, libsodium-wrappers | v0.19.2 required for native AES-256-GCM crypto support |
| Backend API | Python 3.11, FastAPI, async psycopg | Single uvicorn process |
| STT | Deepgram Nova-3 streaming WebSocket | Raw `websockets` library, not the SDK |
| VAD | Silero VAD (ONNX, CPU-only) | Filters silence before audio reaches Deepgram |
| LLM | Anthropic Claude (Sonnet 4) | Used for both response generation and chatbot |
| TTS | ElevenLabs `eleven_v3` | With auto-prepended character direction tags |
| Vector DB | Qdrant (self-hosted via Docker on each Hetzner box) | Single collection: `fablescribe_campaign_memory` |
| Embeddings | Nomic Embed v1.5 (768 dims) | Via Nomic Atlas API — no local compute |
| DB / Auth / Realtime / Storage | Supabase (Postgres + Auth + Realtime + Storage) | Hosted free tier, two projects (dev + prod) |
| Frontend | React 18, Vite 5, TypeScript, react-router-dom | No CSS framework — inline styles |

### Infrastructure (Phase 1.5)
| Layer | Tech | Notes |
|---|---|---|
| Frontend hosting | Vercel | Two projects, one per branch (`dev` ↔ `dev.fablescribe.io`, `main` ↔ `fablescribe.io`) |
| Backend + bot + Qdrant hosting | Hetzner Cloud (CX22, Ubuntu 24.04) | Two boxes — one per env |
| Reverse proxy / SSL | Caddy 2 (Docker) on each Hetzner box | Auto Let's Encrypt for `api.fablescribe.io` and `api-dev.fablescribe.io` |
| DNS | Cloudflare (DNS-only mode) | Proxy off so Vercel + Caddy can issue certs directly |
| Container registry | GitHub Container Registry (`ghcr.io/jakeverycool`) | Public images, no auth on Hetzner pulls |
| CI / deploy | GitHub Actions | Build → push to GHCR → SSH deploy via `appleboy/ssh-action` |
| Domain registrar | Porkbun | Nameservers delegated to Cloudflare |

---

## 3. Architecture Diagram

### 3.1 — Application data flow (single environment)

```
┌──────────────────┐       ┌──────────────────────┐
│  Discord Voice   │──────▶│  Node.js Bot         │
│  Channel         │       │  (port 3001 HTTP +   │
│                  │◀──────│   WS client to       │
└──────────────────┘       │   backend)           │
                           │                      │
                           │  - /join /leave      │
                           │  - Voice receive     │
                           │  - Opus → PCM        │
                           │  - Audio playback    │
                           └──────┬───────────────┘
                                  │ WS (binary PCM + JSON metadata)
                                  ▼
┌──────────────────┐       ┌──────────────────────┐         ┌─────────────────┐
│   React SPA      │──────▶│  Python Backend      │────────▶│  Deepgram       │
│                  │  REST │  (FastAPI, port 8000)│◀────────│  Nova-3 stream  │
│                  │       │                      │         └─────────────────┘
│   - Auth         │       │  - Auth middleware   │
│   - Campaign UI  │       │  - CRUD routers      │         ┌─────────────────┐
│   - Live xscript │◀──────│  - Silero VAD gate   │────────▶│  Anthropic      │
│   - Generate     │  WS   │  - Deepgram client   │         │  Claude         │
│   - Audio queue  │       │  - Prompt assembly   │         └─────────────────┘
│   - Chatbot      │       │  - Vectorization     │
└──────┬───────────┘       │  - HTTP → bot for    │         ┌─────────────────┐
       │                   │    audio playback    │────────▶│  ElevenLabs     │
       │ Realtime          └──┬───────┬───────────┘         │  TTS v3         │
       │ (transcripts)        │       │                     └─────────────────┘
       │                      │       │
       │              ┌───────┘       └────────┐            ┌─────────────────┐
       │              ▼                        ▼            │  Nomic Embed    │
       │      ┌───────────────┐        ┌───────────────┐    │  (Atlas API)    │
       └─────▶│   Supabase    │        │    Qdrant     │◀───┴─────────────────┘
              │   - Postgres  │        │  (Docker)     │
              │   - Auth JWT  │        │               │
              │   - Realtime  │        │               │
              │   - Storage   │        └───────────────┘
              └───────────────┘
```

### 3.2 — Deployment topology (Phase 1.5)

```
                       GitHub: jakeverycool/fablescribe
                                     │
                ┌────────────────────┴──────────────────────┐
                │                                           │
            dev branch                                  main branch
                │                                           │
                ▼                                           ▼
        ┌───────────────┐                           ┌───────────────┐
        │ GitHub Actions│                           │ GitHub Actions│
        │  (deploy.yml) │                           │  (deploy.yml) │
        └───────┬───────┘                           └───────┬───────┘
                │                                           │
                │ build + push                              │ build + push
                ▼                                           ▼
        ┌───────────────┐                           ┌───────────────┐
        │     GHCR      │                           │     GHCR      │
        │ :<sha>        │                           │ :<sha>        │
        │ :dev (branch) │                           │ :main (branch)│
        │ :dev (env)    │                           │ :prod (env)   │
        └───────┬───────┘                           └───────┬───────┘
                │                                           │
                │  SSH deploy                               │  SSH deploy
                ▼                                           ▼
   ╔═════════════════════════╗                ╔═════════════════════════╗
   ║   Hetzner DEV box       ║                ║   Hetzner PROD box      ║
   ║   5.161.211.220         ║                ║   5.161.48.217          ║
   ║                         ║                ║                         ║
   ║  ┌──────────────────┐   ║                ║  ┌──────────────────┐   ║
   ║  │ Caddy            │   ║                ║  │ Caddy            │   ║
   ║  │ (Let's Encrypt)  │   ║                ║  │ (Let's Encrypt)  │   ║
   ║  └─────────┬────────┘   ║                ║  └─────────┬────────┘   ║
   ║            │            ║                ║            │            ║
   ║  ┌─────────▼────────┐   ║                ║  ┌─────────▼────────┐   ║
   ║  │ Backend (FastAPI)│◀──┼──┐             ║  │ Backend (FastAPI)│◀──┼──┐
   ║  └─────────┬────────┘   ║  │             ║  └─────────┬────────┘   ║  │
   ║            │ HTTP       ║  │             ║            │ HTTP       ║  │
   ║  ┌─────────▼────────┐   ║  │             ║  ┌─────────▼────────┐   ║  │
   ║  │ Bot (Node)       │   ║  │             ║  │ Bot (Node)       │   ║  │
   ║  └──────────────────┘   ║  │             ║  └──────────────────┘   ║  │
   ║            ▲            ║  │             ║            ▲            ║  │
   ║            │ WS         ║  │             ║            │ WS         ║  │
   ║            └────────────╫──┘             ║            └────────────╫──┘
   ║  ┌──────────────────┐   ║                ║  ┌──────────────────┐   ║
   ║  │ Qdrant           │   ║                ║  │ Qdrant           │   ║
   ║  └──────────────────┘   ║                ║  └──────────────────┘   ║
   ║                         ║                ║                         ║
   ║  api-dev.fablescribe.io ║                ║  api.fablescribe.io     ║
   ╚═════════════════════════╝                ╚═════════════════════════╝
                ▲                                           ▲
                │                                           │
   ┌────────────┴────────────┐                ┌─────────────┴───────────┐
   │  Supabase Dev project   │                │  Supabase Prod project  │
   │  (qdbytyxvlsqtzpfkdpxd) │                │  (jgfwglxufcxchtiqbzwu) │
   │  - independent data     │                │  - independent data     │
   │  - own auth users       │                │  - own auth users       │
   │  - own storage buckets  │                │  - own storage buckets  │
   └─────────────────────────┘                └─────────────────────────┘
                ▲                                           ▲
                │ Realtime + apiFetch                       │ Realtime + apiFetch
                │                                           │
   ┌────────────┴────────────┐                ┌─────────────┴───────────┐
   │  Vercel: fablescribe-dev│                │ Vercel: fablescribe-prod│
   │  built from `dev` branch│                │ built from `main` branch│
   │  dev.fablescribe.io     │                │ fablescribe.io          │
   │                         │                │ www.fablescribe.io      │
   │  env: dev Supabase URL  │                │  env: prod Supabase URL │
   │       api-dev backend   │                │       api backend       │
   └─────────────────────────┘                └─────────────────────────┘
```

**Isolation guarantees:**
- Cross-environment requests are blocked at the backend by CORS (only the env's own frontend origin is allowed)
- Each Hetzner box has its own `.env` with environment-specific Supabase credentials
- Two separate Discord bot applications (`Fablescribe Dev#1813` for dev, `Fablescribe#2729` for prod)
- Two separate Anthropic API keys
- Two separate Supabase projects with fully independent auth, data, and storage

---

## 4. Data Model

All tables live in Supabase Postgres. RLS is enabled on every public table and gated by helper functions `is_campaign_member(campaign_id)` and `is_campaign_dm(campaign_id)`.

### `users`
Extends `auth.users` (1:1 via `id`). Fields: `email`, `platform_role` (admin/user), `subscription_tier` (free/pro), `elevenlabs_chars_used_this_period`. Auto-created via trigger on `auth.users` insert.

### `campaigns`
`id, name, description, created_by, invite_code, discord_voice_channel_id, created_at, updated_at`. Trigger auto-adds the creator as a DM member.

### `campaign_members`
`(campaign_id, user_id, campaign_role)` where `campaign_role` is `dm` or `player`. Unique on `(campaign_id, user_id)`.

### `sessions`
`id, campaign_id, title, status (active/ended), started_at, ended_at, dm_session_notes, paused`. The `paused` flag is checked by the VAD gate to drop audio.

### `transcript_entries`
`id, session_id, speaker_user_id (Discord user), speaker_display_name, text, segment_start_ts, segment_end_ts, created_at`. Raw working material — never vectorized.

### `characters`
`id, campaign_id, name, kind (npc/pc), description, personality, speech_notes, elevenlabs_voice_id, secrets, linked_glossary_ids[], qdrant_point_id, vector_updated_at, created_at`. PCs are managed in the Players tab and never appear in the response generation picker.

### `glossary_entries`
`id, campaign_id, type, name, aliases[], description, known_by_character_ids[], linked_entry_ids[], tags[], qdrant_point_id, vector_updated_at`.

### `memory_entries`
The canonical campaign record. Single table with `kind` discriminator (`note`, `response`, `event`).
- Common: `id, campaign_id, session_id, kind, visibility (public/dm_only), source_timestamp, content, deleted_at`
- Source context: `selected_transcript_ids[], dm_annotation, linked_glossary_ids[]`
- Response-only: `character_id, additional_context, generated_text, final_text, audio_file_ref, queue_position, queue_status, played_at`
- Presence: `present_character_ids[]` — which NPCs witnessed this entry
- Vector: `qdrant_point_id, vector_updated_at`

### `campaign_files`
`id, campaign_id, uploaded_by, filename, display_name, mime_type, file_size_bytes, storage_path, file_kind, description, tags[], ingestion_status`. Phase 1 is storage-only.

### `campaign_speakers`
`id, campaign_id, discord_user_id, discord_display_name, role (dm/player/unknown), character_id, created_at, updated_at`. Auto-upserted by the VAD gate when a Discord speaker is heard. Mapped manually in the Players tab.

---

## 5. Bot — Discord Voice Receive & Playback

### Slash commands
- `/join` — connects to the DM's current voice channel, opens a WebSocket to the backend, and starts streaming per-speaker audio
- `/leave` — disconnects voice + WS, cleans up

### Voice receive flow ([bot/src/index.js](bot/src/index.js))
1. `joinVoiceChannel()` with `selfDeaf: false, selfMute: true` — must be undeafened to receive audio
2. Wait for `VoiceConnectionStatus.Ready` (the disconnect handler also waits 5s for reconnection before cleanup, matching DiscordBuddy's pattern)
3. Subscribe to `connection.receiver.speaking.on('start')` events
4. For each speaker, `receiver.subscribe(userId, { end: AfterSilence, duration: 1000 })` returns an Opus stream
5. Decode each Opus packet via `opusscript` → 48kHz stereo PCM
6. Downsample to 16kHz mono via [bot/src/audio-processor.js](bot/src/audio-processor.js) (simple decimation: every 3rd frame, left channel)
7. Send a JSON metadata frame followed immediately by a binary PCM frame to the backend WebSocket

### Audio playback ([bot/src/index.js](bot/src/index.js))
The bot runs a small HTTP server on port 3001 with one endpoint:
- `POST /play` (auth: `Bearer ${BOT_SECRET}`) — receives `{ guild_id, audio_url }`, fetches the MP3, creates an `AudioResource`, subscribes the active voice connection to a player, and plays it. Returns when playback completes.

### Encryption gotcha
`@discordjs/voice` v0.18.x cycles the connection state forever without ever reaching Ready because it lacks crypto support. **You must use v0.19.2+** which has native AES-256-GCM support via Node's `crypto` module, plus `@snazzah/davey` for Discord's DAVE protocol. We also have `libsodium-wrappers` as a fallback. Verify with:

```js
import { generateDependencyReport } from "@discordjs/voice";
console.log(generateDependencyReport());
```

---

## 6. Backend — Python FastAPI

### Lifecycle ([backend/main.py](backend/main.py))
- `lifespan` opens the DB connection lazily and closes it on shutdown
- CORS allows any localhost / RFC1918 LAN IP origin (so other PCs on your network can use the dev frontend)
- Routers are imported lazily inside `main.py` to avoid circular imports between `main.py` ↔ `stt/vad_gate.py`

### Auth ([backend/auth.py](backend/auth.py))
- `get_current_user(credentials)` — FastAPI dependency that extracts the Bearer token and verifies it by hitting Supabase's `/auth/v1/user` endpoint. Returns `{id, email}`. We use Supabase's own endpoint instead of local JWT verification to avoid managing JWT secrets / JWKS rotation.
- `require_campaign_dm(user, campaign_id)` — raises 403 unless the user is a DM of that campaign. Called manually in every route handler.

### Database ([backend/db.py](backend/db.py))
- Single async psycopg connection (`autocommit=True`, `dict_row` factory)
- Helpers: `fetch_one`, `fetch_all`, `execute`, `execute_returning`
- The connection is lazily created on first call and cached as a module-level singleton

### Routers (all under `routers/`)

**`campaigns.py`** — Campaign CRUD + audio queue. The `/play` endpoint signs the audio file URL via Supabase Storage API and HTTP-POSTs it to the bot at `http://127.0.0.1:3001/play`.

**`sessions.py`** — Session CRUD plus `/start`, `/end`, `/pause`, `/resume`, and `/transcript` endpoints.

**`characters.py`** — Character CRUD with optional `?kind=npc|pc` filter. On create/update, auto-vectorizes via `vectorization.upsert_entry()`. The vectorized text is `name + description + personality + speech_notes` (see `_character_text`).

**`speakers.py`** — Lists Discord speakers for a campaign and lets the DM update their role/PC mapping. Setting role to `dm` automatically clears any other `dm` in the same campaign (one DM rule).

**`glossary.py`** — Glossary CRUD. Vectorized text is `name + aliases + description`.

**`files.py`** — Multipart file upload with extension validation (`docx, txt, md, pdf, png, jpg, jpeg, gif, webp`) and 25 MB cap. Files go to Supabase Storage at `campaigns/{campaign_id}/files/{file_id}/{filename}`. Download endpoint returns a signed URL valid for 1 hour.

**`memory.py`** — The biggest router. Endpoints:
- `GET /campaigns/{id}/memory` — list with optional `session_id` and `kind` filters
- `POST .../memory/note` — create a note from selected transcript lines (auto-fills `source_timestamp` from earliest selected line)
- `POST .../memory/event` — create a standalone event entry
- `PATCH .../memory/{entry_id}` — edit content/annotation/visibility/glossary links
- `DELETE .../memory/{entry_id}` — soft-delete (sets `deleted_at`)
- `POST .../memory/generate-response` — assembles three-layer prompt and calls Claude. Returns the generated text without saving (DM reviews/edits before finalize)
- `POST .../memory/finalize-response` — saves the response with the (possibly edited) text, generates ElevenLabs TTS, uploads MP3 to Supabase Storage, vectorizes, and tracks ElevenLabs character usage on the user

**`chatbot.py`** — `POST /campaigns/{id}/chatbot` — embeds the query, runs Qdrant similarity search (top-k=8) filtered by `campaign_id`, builds a context window from hit payloads, and asks Claude to answer as a "campaign historian" using only the retrieved entries.

### STT pipeline

**`stt/deepgram_client.py`** — Manages per-`(session_id, user_id)` Deepgram streaming WebSocket connections. Each connection:
- Sends linear16 16kHz mono audio chunks
- Receives transcript events on a background asyncio task
- Calls `on_transcript(session_id, user_id, display_name, text, start_ts, end_ts)` for each final result
- Closes via `CloseStream` message + `ws.close()`

Uses raw `websockets` library directly because the Deepgram Python SDK has had breaking changes across major versions.

**`stt/vad_gate.py`** — The orchestration layer between the bot and Deepgram. For each incoming PCM chunk:
1. Check the cached active session paused state (refreshed every 2s via `_refresh_session_cache` to avoid hammering Supabase)
2. Drop audio if paused or no active session
3. Buffer 512-sample chunks (32ms at 16kHz) for Silero VAD
4. Run VAD on each chunk; if speech_prob > 0.5, mark as speaking
5. Open a Deepgram connection for this user if not already open. The first time, fetch keyterms from the campaign's glossary (max 100 terms, prioritized by character > place > other) and pass them to Deepgram for keyterm boosting
6. Forward audio to Deepgram while in speech state + 600ms trailing window
7. Close the Deepgram connection after 30s of continuous silence

The `_on_transcript` callback:
1. Looks up the active session ID dynamically (cached) so the bot can join before or after a session is created
2. Auto-upserts the speaker into `campaign_speakers` for this campaign so the DM can later assign roles
3. Inserts the transcript row with the resolved `active_session_id`

### Vectorization ([backend/vectorization.py](backend/vectorization.py))
- One Qdrant collection: `fablescribe_campaign_memory` (created on first use). Vector size 768 (Nomic Embed v1.5), cosine distance. Indexed payload fields: `campaign_id`, `entry_type`
- `embed_text` / `embed_query` — calls Nomic Atlas API with the appropriate `task_type` for documents vs queries
- `upsert_entry(entry_type, entry_id, campaign_id, text, metadata)` — generates a deterministic UUID5 point ID from `entry_type:entry_id` so updates overwrite cleanly. Stores truncated text in payload for retrieval display
- `delete_entry` / `search` — straightforward filtered queries
- All called from the routers on create/update/delete to keep Postgres and Qdrant in sync

### Three-layer prompt assembly ([backend/prompts/response.py](backend/prompts/response.py))

When the DM clicks "Generate Response":

**Layer 1 — Immediate context**
- Fetch the selected transcript lines
- Look up speaker mappings (`campaign_speakers`) and rewrite display labels:
  - DM speakers: `Alex (DM/Narrator)`
  - Players mapped to PCs: shown as the PC name (e.g. `Torg`), and we record the PC ID in `pcs_in_context`
  - Unmapped speakers: their Discord display name as-is

**Layer 1.5 — Player character context**
- For any PCs whose voice lines appear in the selected context, fetch their description + personality and inject them into the system prompt under `[Player characters in this scene]`. This is how NPC responses can reference details about the PCs without leaking out-of-scene info

**Layer 2 — Character knowledge**
- The responding NPC's full character sheet
- Depth-1 resolution of `linked_glossary_ids` — only the glossary entries explicitly linked to this character are exposed. Information containment is structural

**Layer 3 — Historical context (RAG)**
- Query Qdrant with `"{character_name} previous encounters interactions"`, top-k=12
- Filter:
  - Skip the character's own glossary/character entry
  - Skip other characters' glossary/character entries
  - For response-type memory entries: include only if `responding_char == this_character` OR `this_character in present_characters`. Witnessed entries are tagged `[X was present and witnessed this]`
  - Notes and events are always included
- Take top 3 after filtering

**TTS formatting rules** appear at the very end of the system prompt (recency bias for adherence). They forbid asterisks, parentheticals, stage directions, and instruct number/abbreviation spelling and natural punctuation pacing.

### TTS generation ([backend/routers/memory.py](backend/routers/memory.py) `_generate_tts`)
- Builds a character direction tag from `speech_notes` (or `personality` as fallback), capped at 150 chars
- Prepends it to the text: `[gruff, deep voice, slow Scottish accent] Aye, I've seen yer kind...`
- Calls ElevenLabs `text-to-speech/{voice_id}` with `model_id: "eleven_v3"` and `output_format: "mp3_44100_128"`
- Uploads the MP3 to Supabase Storage `response-audio` bucket at `campaigns/{campaign_id}/responses/{uuid}.mp3`
- Returns the storage path (saved as `audio_file_ref` on the memory entry)

---

## 7. Frontend — React SPA

### Routing ([frontend/src/App.tsx](frontend/src/App.tsx))
- `/login` — magic link sign-in
- `/` — campaign list (protected)
- `/campaigns/:campaignId` — campaign detail with tabs (protected)

`ProtectedRoute` checks the auth context and redirects to `/login` if no session.

### Auth ([frontend/src/lib/auth.tsx](frontend/src/lib/auth.tsx))
`AuthProvider` wraps the app, subscribes to Supabase auth state changes, exposes `{session, user, loading, signOut}` via context.

### API client ([frontend/src/lib/supabase.ts](frontend/src/lib/supabase.ts))
- `supabase` — the Supabase JS client. Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from build-time env vars (Vite injects these from `.env.local` locally and from Vercel project settings in production). **Throws loudly at module load time if either is missing**, so misconfigured deploys fail the build instead of silently authenticating against the wrong project.
- `apiFetch(path, options)` — wrapper around `fetch` that automatically attaches the user's JWT as `Authorization: Bearer ...` and sets `Content-Type: application/json` when there's a string body. Skips Content-Type for `FormData` bodies (file uploads).
- `API_BASE` resolution order:
  1. `VITE_BACKEND_URL` env var (set per Vercel project — `https://api.fablescribe.io` for prod, `https://api-dev.fablescribe.io` for dev)
  2. Falls back to `${window.location.protocol}//${window.location.hostname}:8000` for local dev / LAN access

### Tabs

**SessionsTab** — The most complex component.
- Lists sessions, lets you create one, and shows controls (pause/resume/end) for the active session
- Subscribes to `transcript_entries` via Supabase Realtime filtered by `session_id` for live updates (deduplicates by ID to handle React StrictMode double-mount)
- Drag-to-select transcript lines: `onMouseDown` starts a drag, `onMouseEnter` updates the selection range, `onMouseUp` (window-level) ends it. Shift-click is additive (preserves snapshot)
- Speaker labels rewritten via `getSpeakerLabel` lookup against `campaign_speakers`: PCs show as `Torg (Alex)`, DM as `Alex (DM)`, others as plain names
- Right-side **presence panel** lists all NPCs with checkboxes; the toggled set is the default for the next response
- Action bar appears below the transcript when lines are selected: **Promote to Memory** (creates a note) and **Generate Response** (opens modal)
- Generate Response modal: pick character, optional additional context, **per-response presence override** (defaults to session-level toggles, can be unchecked for whispered exchanges), Generate (returns text only), edit, **Generate Audio & Save** (calls finalize)

**CharactersTab** — NPC CRUD only (filtered with `?kind=npc`). Voice picker fetches from `/voices` (which calls ElevenLabs `My Voices`), displays a Preview button that plays `voice.preview_url` directly in the browser via `new Audio(url)` — no tokens spent.

**PlayersTab** — PC CRUD plus the Discord speaker mapping table. Speakers appear here automatically once they've spoken in any session. Each row has:
- Role dropdown: `unknown / dm / player`
- If `player`, a second dropdown to assign them to a specific PC

**GlossaryTab** — Standard CRUD with type/aliases/description/tags. All operations vectorize.

**FilesTab** — Drag-and-drop upload, list with file kind badges, edit (rename/describe/tag), download (signed URL opens in a new tab), delete.

**MemoryTab** — Lists all memory entries (notes, events, responses) with kind/visibility badges. Response entries display the full conversation content (selected transcript lines + the character's reply, joined with a blank line). New Note and New Event buttons.

**ChatbotTab** — Chat UI. State is **lifted to `CampaignDetail`** so chat history persists across tab switches. Each assistant message renders source pills derived from the Qdrant hits.

**AudioQueue** — A floating panel pinned to the bottom-right of every campaign detail page. Polls `/audio-queue` every 3 seconds. Shows pending entries with Play and Cancel buttons. Play triggers backend → bot HTTP → Discord playback. Entries without `audio_file_ref` show "No audio (TTS failed)".

---

## 8. Key Flows

### 8.1 Live Transcription Flow

```
DM: /join in Discord
  ↓
Bot connects to ws://backend:8000/ws/bot?session_id=X&secret=Y
  ↓
Bot joins voice channel, waits for Ready state
  ↓
For each speaker:
  Bot subscribes to opus stream
  Decodes opus → 48kHz stereo PCM
  Downsamples to 16kHz mono
  Sends JSON metadata frame + binary PCM frame
  ↓
Backend WebSocket receives frames
  ↓
vad_gate.process_audio_chunk():
  - Check active session paused (cached, refresh every 2s)
  - Buffer 512-sample chunks
  - Run Silero VAD
  - If speech detected, open/reuse Deepgram stream with glossary keyterms
  - Forward audio to Deepgram
  ↓
Deepgram returns final transcripts
  ↓
vad_gate._on_transcript():
  - Resolve active session ID
  - Auto-upsert speaker into campaign_speakers
  - INSERT into transcript_entries
  ↓
Supabase Realtime broadcasts the new row
  ↓
SessionsTab subscription receives the row
  ↓
Live transcript appears in browser
```

### 8.2 NPC Response Generation Flow

```
DM selects transcript lines (drag-to-select)
  ↓
Clicks "Generate Response"
  ↓
Modal: pick character, additional context, presence override
  ↓
Click "Generate"
  ↓
POST /memory/generate-response
  ↓
prompts/response.py assemble_prompt():
  Layer 1: fetch transcript lines, rewrite speaker labels via campaign_speakers,
           detect PCs in selected context
  Layer 1.5: fetch PC sheets for any PCs in context
  Layer 2: character sheet + depth-1 glossary
  Layer 3: Qdrant search filtered to entries this character was involved in
           (responder OR present), tag witnessed entries
  ↓
Claude API call (Sonnet 4)
  ↓
Return generated_text to frontend (NOT saved yet)
  ↓
DM reviews/edits the text
  ↓
Click "Generate Audio & Save"
  ↓
POST /memory/finalize-response
  ↓
1. Build conversation_content = selected lines + "\n\n{character}: {final_text}"
2. Add responding character to present_character_ids (always)
3. Resolve present_names from character IDs
4. _generate_tts():
   - Build [direction tag] from speech_notes
   - Call ElevenLabs eleven_v3 with [tag] + final_text
   - Upload MP3 to Supabase Storage response-audio bucket
5. INSERT memory_entries with kind=response, queue_status=pending
6. Vectorize the conversation_content with payload {kind, character, present_characters}
7. Track ElevenLabs char usage on user
  ↓
Entry appears in Memory tab and AudioQueue panel
```

### 8.3 Audio Playback Flow

```
DM clicks Play in AudioQueue panel
  ↓
POST /campaigns/{id}/audio-queue/{entry_id}/play
  ↓
Backend:
  1. Fetch audio_file_ref from memory_entries
  2. Sign URL via Supabase Storage /sign endpoint (5 min expiry)
  3. UPDATE queue_status = 'playing'
  4. POST http://127.0.0.1:3001/play
     headers: Authorization: Bearer ${BOT_SECRET}
     body: {guild_id: "any", audio_url: <signed url>}
  ↓
Bot HTTP server receives the request
  ↓
playAudioInGuild():
  1. Find first active session (guild_id "any" → first match)
  2. fetch(audio_url) → buffer
  3. Create Readable stream from buffer
  4. createAudioPlayer() + createAudioResource(stream)
  5. connection.subscribe(player) → player.play(resource)
  6. Wait for AudioPlayerStatus.Idle
  ↓
Bot returns {success: true}
  ↓
Backend UPDATE queue_status = 'played', played_at = now()
  ↓
Audio queue panel polls and removes the entry
```

### 8.4 Chatbot Flow

```
DM types question in ChatbotTab
  ↓
POST /campaigns/{id}/chatbot {query}
  ↓
1. embed_query(query) via Nomic
2. Qdrant similarity search filtered by campaign_id, top_k=8
3. Build context from hit payloads (label by entry type/name/kind)
4. Claude API call:
   System: "You are a helpful campaign historian..."
   User: [Retrieved memory]\n{context}\n\nDM question: {query}
5. Return {answer, sources}
  ↓
ChatbotTab renders answer + source pills
```

---

## 9. Local Development

### Prerequisites
- Node.js 18+ (note: 18.16 works but discord.js prefers 18.17+)
- Python 3.11+
- Docker (for Qdrant)
- A Discord bot with Server Members Intent enabled
- Supabase project (with the migration applied + storage buckets created)
- API keys for: Deepgram, Anthropic, ElevenLabs (Starter+ tier required for library voices via API), Nomic

### One-time setup
```bash
# Qdrant
docker compose up -d

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

### Run all four services (separate terminals)
```bash
# Terminal 1 — Qdrant (already running via docker compose up -d)

# Terminal 2 — Backend
cd backend && source .venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 3 — Bot
cd bot && node src/index.js

# Terminal 4 — Frontend
cd frontend && npx vite --host
```

Then open `http://localhost:5173`.

### Ports

| Service | Port | Notes |
|---|---|---|
| Frontend (Vite) | 5173 | LAN-accessible via `--host` |
| Backend (FastAPI) | 8000 | Bound to 0.0.0.0 |
| Bot HTTP | 3001 | Localhost only (backend → bot playback) |
| Qdrant | 6333 | Docker, localhost |

---

## 10. Environment Variables

Each service has a `.env.example` checked into the repo. Copy to `.env` (or `.env.local` for the frontend) and fill in real values.

### `backend/.env`
```
ENV=local                                      # local | dev | prod
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxx
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx
# Use the Supabase Session pooler connection string (IPv4-routable),
# NOT the direct connection — Hetzner Cloud doesn't enable IPv6 outbound.
SUPABASE_DB_URL=postgresql://postgres.<project>:<password>@aws-1-us-east-1.pooler.supabase.com:5432/postgres
DEEPGRAM_API_KEY=
ANTHROPIC_API_KEY=sk-ant-xxx
ELEVENLABS_API_KEY=sk_xxx                      # Starter+ tier, with voices_read permission
NOMIC_API_KEY=nk-xxx
QDRANT_URL=http://localhost:6333               # On Hetzner: http://qdrant:6333 (docker network)
QDRANT_API_KEY=                                # Optional, only if Qdrant has API key auth enabled
BOT_SECRET=fablescribe-bot-secret-phase1
BOT_HTTP_URL=http://127.0.0.1:3001             # On Hetzner: http://bot:3001 (docker network)
ALLOWED_ORIGINS=                               # Comma-separated; LAN/localhost regex always allowed
```

### `bot/.env`
```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
BACKEND_WS_URL=ws://127.0.0.1:8000/ws/bot      # On Hetzner: ws://backend:8000/ws/bot
BOT_SECRET=fablescribe-bot-secret-phase1
ENV=local
```

### `frontend/.env.local`
```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
# Optional. If unset, derives from window.location.hostname:8000 (works for LAN dev).
# In production set per Vercel project:
#   dev:  https://api-dev.fablescribe.io
#   prod: https://api.fablescribe.io
# VITE_BACKEND_URL=
```

> **Important — Supabase DB connection on Hetzner:** Use the **Session pooler** connection string (`postgres.<project>@aws-X.pooler.supabase.com:5432`), not the direct (`db.<project>.supabase.co:5432`). Hetzner Cloud doesn't route IPv6 outbound by default, and Supabase's direct hostname resolves to IPv6 first, causing `Network is unreachable` errors. The pooler endpoint is IPv4 and just works.

---

## 11. Production Deployment (Phase 1.5)

For a complete deployment runbook (DNS, secrets, rollback procedure), see [DEPLOYMENT.md](DEPLOYMENT.md). High-level summary here:

### CI/CD pipeline

Push to `dev` or `main` triggers `.github/workflows/deploy.yml`:

1. **Build job** — checks out, builds the backend and bot Docker images, pushes to GHCR with three tags:
   - `:<commit_sha>` — immutable, used by the deploy step for the exact version
   - `:<branch>` — `dev` or `main`, useful for git-history clarity
   - `:<env>` — `dev` or `prod` (different from branch for `main` ↔ `prod` mapping)
2. **Deploy job** — SSHs into the matching Hetzner box (`DEV_SSH_HOST` or `PROD_SSH_HOST` from GitHub secrets) as the `deploy` user, runs `/opt/fablescribe/deploy.sh <commit_sha>`, which pulls the new images and restarts the compose stack.

### Hetzner box layout

Each box runs a single `docker compose` stack at `/opt/fablescribe/`:
- `caddy` — port 80/443, auto-issues Let's Encrypt for `api.fablescribe.io` (or `api-dev.fablescribe.io`), reverse-proxies `/` to `backend:8000`
- `backend` — pulled from GHCR, env loaded from `/opt/fablescribe/.env`
- `bot` — pulled from GHCR, connects to `backend` over the docker network
- `qdrant` — local Docker volume, never exposed publicly

The `.env` file lives **only on the box** (not in git), and contains environment-specific Supabase credentials, the Discord bot token for that env, the Anthropic key for that env, and the Caddy `API_DOMAIN` so SSL is issued for the right hostname.

### Frontend hosting

Two Vercel projects, both pointed at the same GitHub repo but built from different branches:
- `fablescribe-dev` — built from `dev` branch, served at `dev.fablescribe.io`
- `fablescribe-prod` — built from `main` branch, served at `fablescribe.io` and `www.fablescribe.io`

Each Vercel project has its own `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_BACKEND_URL` env vars baked in at build time. **A Vercel redeploy is required to pick up env var changes.**

### Manual ops on a Hetzner box

```bash
# SSH in
ssh -i ~/.ssh/fablescribe_deploy deploy@<box_ip>

# View running containers
cd /opt/fablescribe && docker compose ps

# Tail logs
docker compose logs -f backend
docker compose logs -f bot

# Pull and restart (uses :env tag fallback if IMAGE_TAG isn't set — see compose file)
docker compose pull && docker compose up -d

# Or pin a specific commit
IMAGE_TAG=<sha> docker compose up -d backend
```

---

## 12. Known Quirks & Decisions

### Application

- **`localhost` vs `127.0.0.1` on macOS**: Node resolves `localhost` to IPv6 `::1` while uvicorn defaults to IPv4 `0.0.0.0`. Always use `127.0.0.1` in connection URLs to avoid silent connection failures.

- **Bot session_id mapping**: The bot generates a random UUID session ID at `/join` time, but this won't match any session in the DB. We solve this by having `vad_gate._on_transcript` dynamically resolve the active session ID on each insert (cached for 2 seconds). This means the bot can join before or after the DM creates a session.

- **VAD cache TTL**: 2 seconds. Pause/resume reflects within 2 seconds at most. Trade-off between freshness and remote DB load.

- **Deepgram keyterm cache**: Loaded once per session into `_session_keyterms`. Glossary edits during a session don't update active streams (Phase 1 limitation).

- **Qdrant point IDs**: Deterministic UUID5 from `entry_type:entry_id` so updates always overwrite cleanly. No risk of duplicates from re-vectorization.

- **Memory entry kinds**: All three kinds (`note`, `response`, `event`) live in the same table with a discriminator. Vectorization payloads tag them with `kind` so the chatbot and response RAG can filter appropriately.

- **Information containment**: NPCs only know what's explicitly linked to them via `linked_glossary_ids` plus what they witnessed (in `present_character_ids`). This is enforced structurally in the prompt assembly, not via "please don't reveal" instructions to Claude.

- **Single-DM rule**: Only one speaker can be marked as DM in a campaign. Setting role to `dm` in the speakers router auto-clears any previous DM.

- **TTS direction tags**: Auto-prepended from `speech_notes` (or `personality` as fallback), capped at 150 chars. ElevenLabs v3 uses these for character performance — see [their character direction docs](https://elevenlabs.io/blog/eleven-v3-character-direction).

- **Audio queue polling**: 3-second interval. Could be replaced with Supabase Realtime in a future iteration.

- **`@discordjs/voice` v0.18.x is broken**: Voice connections cycle forever without reaching Ready. Must use v0.19.2+ which has native AES-256-GCM crypto support. See [bot/package.json](bot/package.json).

### Deployment / Infrastructure (Phase 1.5)

- **Hetzner IPv6 → Supabase direct connection fails** with `Network is unreachable`. Hetzner Cloud doesn't enable IPv6 outbound routing by default, and Supabase's direct DB hostname (`db.<project>.supabase.co`) resolves to IPv6 first. **Always use the Supabase Session pooler connection string** (`postgres.<project>@aws-X.pooler.supabase.com:5432`) on Hetzner — it's IPv4-routable.

- **Cloudflare proxy mode breaks Let's Encrypt issuance.** All DNS records that point at Vercel or Caddy must be in **DNS-only mode (grey cloud)**, not proxied. Caddy and Vercel both issue certs directly, which requires direct A/CNAME resolution.

- **Vercel apex IP conflicts.** Vercel is rolling out new anycast IPs (`44.227.65.245`, `44.227.76.166`) but its UI still expects the older `76.76.21.21` for apex domains. If Vercel reports "Invalid Configuration" with extra A records flagged, delete the new IPs and keep only `76.76.21.21`.

- **GHCR images must be public** for the Hetzner deploy boxes to pull them without auth. After the **first** GHA build, manually flip `fablescribe-backend` and `fablescribe-bot` packages to Public via the GitHub Packages UI. The Docker images don't contain secrets — those come from `.env` at runtime.

- **Compose `IMAGE_TAG` fallback** is `${ENV}` (resolves to `dev` or `prod`), not `latest`. The build pipeline never publishes a `:latest` tag — it publishes three tags per build (`:<sha>`, `:<branch>`, `:<env>`). Manual `docker compose up -d backend` without an explicit `IMAGE_TAG` env var will pick up the `:<env>` tag, which is always the most recent successful build for that environment.

- **Vercel env vars are baked in at build time.** Changing them in the Vercel project settings has no effect until you trigger a redeploy. If a frontend is calling the wrong backend, it's almost certainly stale env vars from a build that ran before the env was corrected.

- **Supabase Auth redirect URL** must match the deployed domain. After deploying, set the **Site URL** in each Supabase project's Authentication → URL Configuration page (`https://dev.fablescribe.io` for dev, `https://www.fablescribe.io` for prod), and add the corresponding `https://<domain>/**` patterns to **Redirect URLs**. Otherwise magic links bake in `localhost:3000` and break.

- **Two separate Discord bot applications** are required for env isolation. A single Discord token can only be logged in from one place at a time. The dev box uses `Fablescribe Dev#1813`, the prod box uses `Fablescribe#2729`. Both can be invited to the same test server.

- **CORS isolation is enforced at the backend.** The dev backend's `ALLOWED_ORIGINS=https://dev.fablescribe.io` and prod's is `https://fablescribe.io,https://www.fablescribe.io`. Cross-environment preflight requests get rejected at the backend before any handler runs, preventing accidental dev → prod data leaks via misconfigured frontends.

---

## 13. What's NOT Built Yet (Phase 2+)

### Product
- Multi-user invite codes & player join flow
- Player-facing dashboard / read-only views
- Subscription tier enforcement
- ElevenLabs char-cap and Deepgram minute-cap enforcement (tracking exists, no caps)
- Discord recording consent flow on bot join
- AI ingestion of uploaded files (text extraction → vectorization)
- Vision-model ingestion of images
- Voice cloning
- Drag-to-reorder audio queue
- Glossary filtering / bulk import / linking visualizer
- Cross-session memory linking suggestions

### Operations / Infrastructure
- **Automated migration runner** — schema changes are still applied manually via the Supabase SQL Editor on each project. Phase 2 should add Supabase CLI migrations + a `scripts/migrate.sh` helper run from the deploy pipeline.
- **Uptime monitoring** — Uptime Robot was suggested in the Phase 1.5 doc but not set up. Should add HTTP monitors for `/health` on both API domains.
- **Per-env API key separation for ElevenLabs / Deepgram / Nomic** — currently shared between dev and prod. Anthropic is correctly split.
- **Backup strategy for the Hetzner Qdrant volumes** — currently relying on the ability to rebuild from Postgres via the `/reindex` endpoint, but no automated backups.
- **Rollback automation** — `DEPLOYMENT.md` documents the manual rollback steps but there's no one-command revert.
- **Structured logging / observability** — backend just uses Python's `logging` module to stdout, captured by Docker. No centralized log aggregation.
- **Schema drift detection** — nothing alerts if dev and prod databases diverge.

---

## 14. References

- Pre-planning doc: [READ_ME/fablescribe-preplanning.md](READ_ME/fablescribe-preplanning.md)
- Phase 0 build doc: [READ_ME/fablescribe-phase-0.md](READ_ME/fablescribe-phase-0.md)
- Phase 1 build doc: [READ_ME/fablescribe-phase-1.md](READ_ME/fablescribe-phase-1.md)
- Phase 1.5 build doc: [READ_ME/fablescribe-phase-1-5.md](READ_ME/fablescribe-phase-1-5.md)
- Deployment runbook: [DEPLOYMENT.md](DEPLOYMENT.md)
- Local quickstart: [README.md](README.md)
- ElevenLabs TTS best practices: https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices
- ElevenLabs v3 character direction: https://elevenlabs.io/blog/eleven-v3-character-direction
- Reference voice bot project: [REF/DiscordBuddy/](REF/DiscordBuddy/) (gitignored, not in repo)
