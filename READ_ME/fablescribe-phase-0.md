# Fablescribe — Phase 0: Proof of Concept (STT Pipeline)

> **Goal:** Prove that per-speaker Discord audio can be transcribed in near real-time and displayed live in a browser dashboard. Nothing else matters yet.

**Duration estimate:** ~1 week of focused work.

**Prerequisites:**
- Local machine (no GPU required — STT is now cloud-based via Deepgram)
- Node.js 20+ and Python 3.11+ installed
- A Discord bot application with token (created at discord.com/developers)
- A Discord server Jake controls with a voice channel for testing
- A Deepgram account with an API key (free tier provides $200 credit, no card required)

---

## 1. Deliverables

A working end-to-end loop:
1. Node.js bot joins a Discord voice channel on command
2. Bot captures per-user PCM audio streams
3. Audio is streamed to a Python backend
4. Python backend runs Silero VAD to gate silence, then streams active speech to Deepgram Nova-3
5. Deepgram returns transcripts; backend writes them to Postgres
6. A minimal React dashboard shows transcripts appearing in real time as people speak

**Not in scope for Phase 0:** auth, campaigns, characters, memory log, curation, response generation, ElevenLabs, Qdrant, the chatbot, file uploads, any UI beyond "live transcript list." This is the plumbing spike.

---

## 2. Repo Structure

Set up a monorepo with three top-level directories:

```
fablescribe/
├── bot/          # Node.js Discord bot
├── backend/      # Python FastAPI + STT worker
├── frontend/     # React SPA
├── docker-compose.yml   # Local Postgres
└── README.md
```

Each subdirectory has its own package manifest. No shared code yet.

---

## 3. Build Steps

### Step 3.1 — Local Postgres
1. Create `docker-compose.yml` at the repo root with a single Postgres 16 service on port 5432.
2. Create a `fablescribe_dev` database and a dev user.
3. Write a minimal migration (SQL file or Alembic) that creates a `transcript_entries` table:
   ```
   id (uuid, pk), session_id (text), speaker_user_id (text),
   speaker_display_name (text), text (text),
   segment_start_ts (timestamptz), segment_end_ts (timestamptz),
   created_at (timestamptz default now())
   ```
4. **Test:** `docker compose up -d`, connect via `psql`, confirm the table exists.

### Step 3.2 — Python backend scaffold
1. Create `backend/` with FastAPI, uvicorn, `psycopg` (async), and `websockets` as dependencies. Use `uv` or `pip` with a `pyproject.toml`.
2. Add a `/health` endpoint that returns `{"status": "ok"}`.
3. Add a WebSocket endpoint at `/ws/bot` that accepts connections from the bot.
4. Add a WebSocket endpoint at `/ws/dashboard` that the frontend subscribes to for live transcript pushes.
5. Implement a simple in-memory pub/sub so messages written to the DB can fan out to dashboard subscribers. (No Supabase Realtime yet — that's Phase 1.)
6. **Test:** run backend, hit `/health`, confirm WebSocket endpoints accept connections (use `websocat` or a browser console).

### Step 3.3 — Deepgram streaming client

1. Add the `deepgram-sdk` Python package to backend dependencies.
2. Create `backend/stt/deepgram_client.py` that:
   - Opens a Deepgram streaming WebSocket connection per speaker using the Python SDK
   - Uses the Nova-3 model (`model=nova-3`, `language=en`)
   - Enables `interim_results=true`, `smart_format=true`, `punctuate=true`
   - Accepts an optional list of keyterms to pass via the `keyterm` query parameter (Phase 0 passes an empty list; Phase 1 wires this to the campaign glossary)
   - Sends raw PCM (16kHz, 16-bit, mono) as binary messages
   - Receives transcript events, filters to final results, and yields `(text, start_ts, end_ts)` tuples
3. Wrap the client in a simple manager that maintains one active Deepgram connection per `(session_id, user_id)` pair, lazily opening connections when a user first speaks and closing them when they stop for more than ~30 seconds or the session ends.
4. Store the Deepgram API key in a backend `.env` file as `DEEPGRAM_API_KEY`.
5. **Test:** write a standalone Python script that opens a Deepgram streaming connection, sends a short WAV file as PCM, and prints the returned transcript. Verify accuracy is reasonable on clean speech and latency is under 500ms per utterance.

### Step 3.4 — Silero VAD gating (cost control)

The Deepgram client will handle endpointing automatically, but sending continuous audio including silence would rack up costs. Silero VAD runs CPU-cheap and filters audio before it reaches Deepgram.

1. Add `silero-vad` to backend dependencies (CPU-only; no CUDA).
2. Create `backend/stt/vad_gate.py` that:
   - Maintains a per-user rolling buffer of PCM
   - Runs Silero VAD on each incoming chunk
   - Opens a Deepgram connection when speech is first detected for a user and begins forwarding audio
   - Continues forwarding while VAD detects speech OR within a ~600ms trailing window after speech stops (covers natural pauses mid-sentence)
   - Closes or pauses the Deepgram connection after ~30 seconds of continuous silence
3. Wire the VAD gate into the `/ws/bot` WebSocket handler: incoming PCM chunks → VAD gate → (if speech) Deepgram → transcripts → Postgres + dashboard pub/sub.
4. **Test:** unit-test the VAD gate with pre-recorded PCM containing known speech and silence regions. Verify Deepgram is only invoked during speech windows and that silence regions don't generate any outbound traffic.

### Step 3.5 — Node.js bot
1. Create `bot/` with `discord.js` v14, `@discordjs/voice`, `prism-media`, and a WebSocket client (`ws`).
2. Implement slash commands:
   - `/join` — bot joins the voice channel the DM is currently in
   - `/leave` — bot leaves and disconnects the WebSocket
3. On `/join`:
   - Connect to the voice channel using `@discordjs/voice`.
   - Open a WebSocket to `ws://localhost:8000/ws/bot` with a generated `session_id` in query params.
   - Subscribe to the voice receiver. For each speaking user, pipe their Opus stream through `prism-media`'s Opus decoder to get 48kHz stereo PCM.
   - Downsample to 16kHz mono (use `prism-media` or an inline transform).
   - Send chunks to the backend as binary WebSocket messages with a small JSON header frame containing `{user_id, display_name, session_id, chunk_ts}`.
4. Handle user disconnect / speaking stop gracefully — flush the segmenter on the backend side.
5. **Test:** run the bot, `/join` a voice channel, speak into the mic, watch backend logs show incoming audio and emitted segments.

### Step 3.6 — Minimal React frontend
1. Create `frontend/` with Vite + React + TypeScript.
2. Single page: a scrolling list of transcript entries grouped by speaker, timestamped.
3. On load, open a WebSocket to `ws://localhost:8000/ws/dashboard` and append each received entry to state.
4. No styling beyond a readable monospace layout. No routing. No auth.
5. **Test:** open the page, speak in Discord, watch lines appear.

### Step 3.7 — End-to-end integration test
This is the Phase 0 "definition of done" test. Run it with a second person on voice call if possible.

1. Start Postgres (`docker compose up -d`).
2. Start backend (`uvicorn main:app --reload`).
3. Start frontend (`npm run dev`).
4. Start bot (`npm run start` in `bot/`).
5. In Discord, run `/join` in a voice channel Jake is in.
6. Open the frontend in a browser.
7. Speak into the mic. **Expectation:** within 2–4 seconds of finishing a sentence, the transcript line appears in the dashboard with Jake's display name and reasonable accuracy.
8. Have a second person join and speak. **Expectation:** their lines appear attributed correctly.
9. Run `/leave`. **Expectation:** bot disconnects, WebSocket closes cleanly, no zombie processes.

---

## 4. Testing Protocol

Claude Code should run these tests automatically where possible and manual tests where not:

**Automated:**
- Unit tests for the VAD gate (using pre-recorded PCM fixtures with known speech/silence boundaries)
- Integration test for the Deepgram client wrapper using a short WAV fixture (can use Deepgram's free tier for this; cost is negligible)
- A smoke test that spins up backend + Postgres in docker-compose and hits `/health`

**Manual (Claude Code should document these and Jake runs them):**
- The full end-to-end test in Step 3.7
- Accuracy sanity check: read a known paragraph, compare transcript to original, note any systematic errors
- Latency check: measure time from end-of-utterance to dashboard display; target is under 1 second for short utterances (Deepgram streaming should hit this easily)
- Concurrent-speaker check: two people talking at once should produce two separate attributed streams via independent Deepgram connections
- Cost sanity check: after a 10-minute test session with two speakers, check the Deepgram usage dashboard and confirm the billed minutes roughly match actual speech time (not silence-inflated)

---

## 5. Definition of Done

Phase 0 is complete when:
- [ ] The full end-to-end test (Step 3.7) passes consistently
- [ ] Latency from speech end to dashboard display is under 1 second for typical utterances (Deepgram streaming target)
- [ ] Two concurrent speakers produce correctly attributed transcripts via separate Deepgram connections
- [ ] The bot handles `/join` and `/leave` cleanly without leaking resources
- [ ] Silence is filtered by VAD before reaching Deepgram (cost control verified via billing dashboard)
- [ ] All services shut down cleanly with Ctrl-C / `docker compose down`
- [ ] README explains how to run the whole stack locally, including where to obtain a Deepgram API key

---

## 6. Known Gotchas

- **`@discordjs/voice` Opus decoding requires native bindings.** Install `@discordjs/opus` or `opusscript`. `@discordjs/opus` is faster but needs a C++ toolchain.
- **Discord sends audio as 48kHz stereo.** Deepgram wants 16kHz mono for best results. Downsample explicitly in the bot before sending.
- **Silero VAD expects 16kHz.** Downsample before VAD, same sample rate you'll send to Deepgram.
- **Deepgram streaming connections have an idle timeout.** If you send no audio for ~60 seconds, the connection closes. Either keep a heartbeat or close/reopen per utterance. Closing is simpler and doesn't cost anything extra.
- **Deepgram bills per second of audio sent**, so never send silence. The VAD gate is not optional — without it, a quiet test session can burn through the free credit faster than expected.
- **Discord voice receive has no "speaking stopped" event in all cases.** Rely on the VAD gate's silence detection, not Discord events, to close the window.
- **WebSocket binary frames and JSON frames can't be trivially interleaved on the same connection.** Either use a length-prefixed binary protocol with embedded metadata, or send a JSON header frame immediately followed by a binary frame and reassemble on the backend. Document the choice clearly.
- **Bot needs the "Server Members Intent" and voice permissions** in the Discord developer portal, or voice receive silently fails.
- **Deepgram interim vs. final results:** in Phase 0 you only care about final results (`is_final: true`). Interim results are useful later for UI polish but add noise if you persist them.

---

## 7. Claude Code Execution Notes

- Work in the order of the steps above. Don't skip ahead — Step 3.5 depends on Step 3.4 being solid.
- After each step, run its test before moving on. If a step's test fails, resolve the issue before continuing.
- Document any deviations from this plan in a `PHASE_0_NOTES.md` file at the repo root. Future phases will reference it.
- If a dependency version pinning decision comes up, pin to the latest stable as of the build date and note it in the notes file.
- **Do not** add any features beyond what's in this doc. Phase 1 will build on this foundation; keeping Phase 0 minimal makes Phase 1 cleaner.
