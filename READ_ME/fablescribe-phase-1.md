# Fablescribe — Phase 1: Single-User MVP

> **Goal:** Build the complete end-to-end Fablescribe experience for one user (Jake). Every core feature should work: campaigns, sessions, characters, glossary, files, raw log, memory curation, Claude-generated NPC responses with ElevenLabs voices, Discord playback, and the Qdrant-powered campaign memory chatbot.

**Duration estimate:** several weeks of focused work. This is the bulk of the product.

**Prerequisites:**
- Phase 0 is complete and the STT pipeline is working reliably
- Anthropic API key (Claude)
- ElevenLabs API key (Creator tier minimum)
- Deepgram API key (still on free tier is fine — $200 credit goes a long way)
- Supabase project (free tier to start)
- Running Qdrant instance (Jake has one from ExpertAI)
- Everything from Phase 0's prerequisites still applies

---

## 1. Scope

**In scope:**
- Supabase auth (single user: Jake)
- Full data model per §4 of the pre-planning doc
- Campaign, session, character, glossary, file CRUD
- Raw transcript log (migrated from Phase 0's local Postgres to Supabase)
- Campaign memory log with note/response/event entry kinds
- Promote-to-memory flow from raw transcript
- Standalone memory entry creation (notes and events)
- Claude integration with three-layer prompt assembly
- ElevenLabs Flash v2.5 streaming TTS with playback queue
- Discord playback of queue items on DM command
- Qdrant vectorization of memory entries, characters, and glossary
- Campaign-memory chatbot (DM-only)
- Pause STT control
- File upload with rename/tag/describe/delete (storage only, no AI ingestion)
- DM-only visibility field on memory entries (no dedicated toggle UI yet — API must support it)

**Not in scope:**
- Multi-user signup, invites, player roles
- Subscription tier enforcement
- Polish features (drag-to-reorder queue, glossary filtering UI, etc.)
- AI ingestion of uploaded files
- Voice cloning
- Player-facing views
- **Cloud deployment of any kind** — Phase 1 runs entirely on Jake's local machine. The dev/prod split and all deployment work is Phase 1.5.

---

## 2. Deliverables

A working single-user app where Jake can:
1. Log in
2. Create a campaign
3. Populate it with characters, glossary entries, and uploaded files
4. Start a session → bot joins voice channel → raw transcript streams live
5. Promote lines from the raw transcript into campaign memory
6. Create standalone note and event entries
7. Generate an NPC response: select context → pick character → Claude writes dialogue → edit → generate audio → queue → play in Discord
8. Ask the chatbot questions about the campaign and get answers pulled from curated memory
9. Pause and resume STT
10. End the session (raw audio cleaned up, memory persists)

---

## 3. Build Steps

### 3.1 — Supabase setup and schema migration

1. Create a new Supabase project.
2. Enable email auth (magic link, no password for simplicity). Restrict signups to Jake's email for now via Supabase Auth settings or a first-user-only trigger.
3. Write SQL migrations for every table in §4 of the pre-planning doc:
   - `users` (extends Supabase `auth.users` with platform_role, subscription_tier, elevenlabs_chars_used_this_period)
   - `campaigns`
   - `campaign_members`
   - `sessions`
   - `transcript_entries` (migrated from Phase 0)
   - `memory_entries`
   - `characters`
   - `glossary_entries`
   - `campaign_files`
4. Create RLS policies scoped to `campaign_members`. For Phase 1 with one user this is belt-and-suspenders but it must be in place now — retrofitting RLS later is painful. Policy pattern: a user can select/insert/update/delete rows where they're a member of the associated campaign.
5. Create a Supabase Storage bucket `campaign-files` with a matching RLS policy (access gated by campaign membership, path pattern `campaigns/{campaign_id}/files/{file_id}/{filename}`).
6. Create a Supabase Storage bucket `session-audio` for raw audio with auto-delete after session end.
7. Create a Supabase Storage bucket `response-audio` for generated TTS audio (persistent).
8. **Test:** Apply migrations, verify schema in the Supabase dashboard, insert a test user and campaign via SQL, verify RLS blocks access from an anonymous client.

### 3.2 — Backend refactor for Supabase

1. Replace the local Postgres connection from Phase 0 with the Supabase Postgres connection.
2. Replace the in-memory pub/sub with Supabase Realtime subscriptions. The backend writes to Postgres; Supabase Realtime broadcasts to subscribed frontend clients automatically.
3. Add Supabase Auth verification middleware to FastAPI: every protected endpoint verifies the JWT from `Authorization: Bearer ...` and extracts the user ID.
4. Keep the `/ws/bot` WebSocket endpoint — it's how the Node bot streams audio. Secure it with a bot-specific secret, not a user JWT (the bot isn't a user).
5. **Test:** Existing Phase 0 end-to-end flow still works, but transcripts now persist in Supabase and the dashboard receives them via Realtime instead of the old websocket.

### 3.3 — Auth and minimal dashboard shell

1. In `frontend/`, add Supabase client SDK and an auth flow: magic link sign-in → session stored in browser.
2. Build a minimal protected shell: if not logged in, show sign-in page; if logged in, show an empty dashboard with a sidebar for future navigation.
3. Add a `/campaigns` page that lists the user's campaigns and has a "create campaign" button.
4. **Test:** Sign in as Jake, see empty campaign list, create a campaign, see it appear, refresh and confirm persistence.

### 3.4 — Campaign, session, character, glossary CRUD

1. Build REST endpoints in FastAPI for each resource:
   - `GET/POST/PATCH/DELETE /campaigns`
   - `GET/POST/PATCH/DELETE /campaigns/{id}/sessions`
   - `GET/POST/PATCH/DELETE /campaigns/{id}/characters`
   - `GET/POST/PATCH/DELETE /campaigns/{id}/glossary`
2. Each endpoint enforces: user must be a DM of the campaign (via `campaign_members` lookup).
3. Build React pages for each:
   - Campaign list → campaign detail
   - Campaign detail has tabs: Sessions, Characters, Glossary, Files, Memory, Chatbot (some tabs are placeholders until later steps)
   - Characters tab: grid of character cards, create form with name/description/personality/speech_notes/secrets/elevenlabs_voice_id (dropdown populated from a static list of ElevenLabs voice IDs for now) and linked_glossary_ids (multi-select)
   - Glossary tab: table view with inline create form; supports all fields from the data model
4. **Test:** Create a campaign, add 2 characters, add 5 glossary entries, link one glossary entry to a character. Edit all. Delete one. Refresh to verify persistence.

### 3.5 — Campaign file uploads

1. Add endpoints:
   - `POST /campaigns/{id}/files` — accepts multipart upload, validates MIME type against allowed list, writes to Supabase Storage at `campaigns/{campaign_id}/files/{file_id}/{filename}`, creates a `campaign_files` row.
   - `GET /campaigns/{id}/files` — list
   - `PATCH /campaigns/{id}/files/{file_id}` — rename, edit description, edit tags
   - `DELETE /campaigns/{id}/files/{file_id}` — soft-delete row and remove from Storage
   - `GET /campaigns/{id}/files/{file_id}/download` — returns a signed URL from Supabase Storage
2. Validate file size against a per-upload cap (start at 25 MB).
3. Validate extensions: `.docx .txt .md .pdf .png .jpg .jpeg .gif .webp`.
4. Build Files tab in the frontend: drag-and-drop upload area, list of uploaded files with rename/describe/tag/delete controls, image thumbnails for image files, a simple "download" button for everything else.
5. **Test:** Upload one of each supported file type, rename one, add tags, download one, delete one. Confirm Storage contents match DB rows.

### 3.6 — Session lifecycle and raw transcript view

1. Add endpoints:
   - `POST /campaigns/{id}/sessions/{session_id}/start` — sets status to active, started_at to now, triggers the bot to join the configured voice channel
   - `POST /campaigns/{id}/sessions/{session_id}/end` — sets status to ended, ended_at to now, triggers bot to leave, closes all Deepgram connections for the session, deletes raw audio from Storage
   - `POST /campaigns/{id}/sessions/{session_id}/pause` — sets a session flag; the VAD gate checks this and stops forwarding audio to Deepgram while paused (closing the Deepgram connections to save any charges)
   - `POST /campaigns/{id}/sessions/{session_id}/resume` — clears the pause flag
2. Update the Node bot to accept a "join channel" command from the backend via a backend-to-bot WebSocket or HTTP endpoint. The bot needs to know which voice channel to join — for Phase 1, hardcode it per campaign via a `discord_voice_channel_id` column on campaigns.
3. Update the backend STT orchestration to include `session_id` in every transcript entry and to gate all audio forwarding on the session's `paused` flag.
4. **Keyterm injection from the glossary:** at session start, the backend assembles a keyterm list from the campaign's glossary — character names first, then place names, then the rest — up to Deepgram's 100-keyterm limit per stream. These keyterms are passed on every Deepgram streaming connection opened during the session. When a glossary entry is edited mid-session, use Deepgram's `Configure` control message to update keyterms on live connections without reconnecting.
5. Build a Session page in the frontend with a start/end/pause/resume control strip and a live raw transcript panel (subscribed to Supabase Realtime, filtered by session_id). Optionally show interim Deepgram results in a dimmed/italic style before they're finalized.
6. **Test:** Create a session with a glossary containing several fantasy names, start it, verify the Deepgram connections include the keyterms (check request logs), speak a sentence containing one of those names, verify the name is transcribed correctly. Test pause/resume — no transcripts during pause, transcripts resume cleanly. Test end — all Deepgram connections close, raw audio cleaned up.

### 3.7 — Memory entries: schema access and basic UI

1. Add endpoints:
   - `GET /campaigns/{id}/memory` — list, with filter params for session_id, kind, visibility
   - `POST /campaigns/{id}/memory` — create a `note` or `event` entry (not `response` — that's a separate flow)
   - `PATCH /campaigns/{id}/memory/{entry_id}` — edit
   - `DELETE /campaigns/{id}/memory/{entry_id}` — soft-delete
2. Build a Memory tab in the frontend:
   - Shows entries ordered by `source_timestamp` (fallback `created_at`)
   - Each entry is a card with kind badge, visibility badge, timestamp, content, and edit/delete controls
   - "New Note" and "New Event" buttons at the top for standalone entries (opens a form with content + optional linked_glossary_ids + visibility toggle)
3. Add a "Promote to Memory" button on the raw transcript panel: when one or more lines are selected, clicking this opens a form pre-filled with `selected_transcript_ids`, an annotation field, and linked glossary dropdown. Submit creates a `note` entry.
4. **Test:** Create a standalone note. Create a standalone event. Select 3 raw transcript lines and promote them. Verify all three appear in the memory log in correct order. Edit one, delete one.

### 3.8 — Qdrant setup and vectorization

1. Create a Qdrant collection named `fablescribe_campaign_memory` with vector size matching the chosen embedding model (Nomic Embed = 768 dimensions).
2. Configure the collection with `campaign_id` as an indexed payload field so queries can filter by campaign.
3. Add a backend service module `backend/vectorization.py` with:
   - `embed_text(text: str) -> list[float]` using Nomic Embed (local or via API)
   - `upsert_entry(entry_type, entry_id, campaign_id, text, metadata)` — writes to Qdrant
   - `delete_entry(entry_id)` — removes from Qdrant
   - `search(campaign_id, query, top_k, filters)` — returns scored results
4. Wire vectorization into the CRUD endpoints:
   - On create of memory_entry, character, glossary_entry → upsert to Qdrant
   - On update → upsert (overwrites existing point)
   - On delete → remove from Qdrant
5. For memory entries, the text to embed is `final_text` (for responses) or `dm_annotation + selected_transcript_content` (for notes) or the content field (for events).
6. For characters, the text is `name + description + personality + speech_notes`.
7. For glossary entries, the text is `name + aliases + description`.
8. Store the Qdrant point ID on the Postgres row after upsert.
9. **Test:** Create a character, verify it appears in Qdrant via the Qdrant dashboard. Edit the character's description, verify the vector is updated. Delete the character, verify it's removed from Qdrant. Repeat for memory entries and glossary entries.

### 3.9 — NPC response generation with Claude

1. Add endpoint `POST /campaigns/{id}/memory/generate-response` with request body:
   ```
   {
     selected_transcript_ids: [...],
     character_id: "...",
     additional_context: "..."
   }
   ```
2. Implement the three-layer prompt assembly in `backend/prompts/response.py`:
   - **Layer 1:** Fetch transcript text for selected_transcript_ids
   - **Layer 2:** Fetch character sheet + depth-1 glossary resolution via `linked_glossary_ids`
   - **Layer 3:** Query Qdrant with `"{character_name} previous encounters"` filtered by campaign_id, fetch top 3 memory entries. Compute time-since-last-encounter from session timestamps.
3. Assemble the full prompt per §5 of the pre-planning doc and call Claude (claude-sonnet model) via the Anthropic SDK.
4. Return the generated text to the frontend WITHOUT saving anything yet — the DM hasn't approved it.
5. Add a second endpoint `POST /campaigns/{id}/memory/finalize-response` that:
   - Accepts the (possibly edited) final text, selected_transcript_ids, character_id, additional_context
   - Calls ElevenLabs Flash v2.5 streaming TTS with the character's `elevenlabs_voice_id`
   - Saves the resulting audio to Supabase Storage (`response-audio` bucket)
   - Creates a `memory_entry` with kind=response, queue_status=pending
   - Vectorizes the new entry into Qdrant
   - Returns the created entry
6. Build the Generate Response UI:
   - Button on selected transcript lines: "Generate Response"
   - Modal: character dropdown, additional context textarea, Generate button
   - On generation: show the returned text in an editable textarea with "Regenerate" and "Generate Audio" buttons
   - On Generate Audio: show a loading state, then a success toast, and the new entry appears in the audio queue
7. **Test:** Create a session, capture some transcript, select lines, generate a response, edit the text, generate audio, verify the memory entry exists with kind=response and audio file, verify it's in Qdrant.

### 3.10 — Audio queue and Discord playback

1. Add endpoints:
   - `GET /campaigns/{id}/audio-queue` — list response entries where `queue_status in (pending, playing)`, ordered by `queue_position`
   - `POST /campaigns/{id}/audio-queue/{entry_id}/play` — triggers the bot to play the audio in the current voice channel, sets queue_status to playing, then played on completion
   - `DELETE /campaigns/{id}/audio-queue/{entry_id}` — remove from queue (sets queue_status to cancelled, keeps the memory entry for history)
2. Extend the Node bot with a `play-audio` command received over the backend-to-bot channel: fetch the audio file from a signed Supabase Storage URL, transcode to Opus frames via `prism-media`, play through the active voice connection.
3. Gate STT: while the bot is playing, set the `bot_is_speaking` flag so the STT worker skips incoming audio from the bot's user ID (and optionally all audio — start with just the bot's own ID; revisit if mic bleed is a problem).
4. Build the Audio Queue panel in the frontend: list of pending entries with character name, text preview, and a prominent Play button. Played entries disappear from the queue but remain in the memory log.
5. **Test:** Generate a response, verify it appears in the queue, click Play, verify audio plays in Discord, verify the entry moves out of the queue and shows as played in the memory log.

### 3.11 — Campaign memory chatbot

1. Add endpoint `POST /campaigns/{id}/chatbot` with request body `{query: string}`.
2. Flow:
   - Embed the query with Nomic Embed
   - Qdrant similarity search filtered by campaign_id, top_k=8
   - Retrieve full payloads (memory entries, characters, glossary) from Postgres
   - Call Claude with the system prompt from §6.4 of the pre-planning doc and the retrieved entries
   - Stream the response back to the frontend
3. Return source entry IDs alongside the answer so the frontend can render clickable citations.
4. Build the Chatbot tab: single text input, message history, each assistant message renders citations as clickable pills that scroll to the corresponding memory entry.
5. For Phase 1, each chatbot query is stateless (no multi-turn memory). Simplifies things.
6. **Test:** Ask "what do I know about [character name]" — verify an accurate answer grounded in the character's glossary entry and any related memory entries. Ask about something not in the campaign — verify the chatbot says it doesn't know. Click a citation — verify it navigates to the entry.

### 3.12 — End-to-end integration test

The Phase 1 definition-of-done test. Run this as a full session:

1. Log in.
2. Create a new campaign "Test Campaign."
3. Add two characters with distinct ElevenLabs voices: a gruff innkeeper and a nervous stable boy.
4. Add four glossary entries: the tavern they work at, the nearby town, a faction, and a rumor the innkeeper knows (linked to the innkeeper via `known_by_character_ids`).
5. Upload a test PDF and a test image to the Files tab.
6. Create a session "Test Session 1" and start it.
7. Have two people on Discord voice. Speak for a minute or two with some pauses. Verify transcripts appear live.
8. Pause the session, speak, verify no transcripts. Resume.
9. Select 3 transcript lines and promote them to memory as a note.
10. Create a standalone event entry: "The party arrived at the tavern at sunset."
11. Select some transcript lines, generate a response from the innkeeper with additional context "he's suspicious of strangers." Verify the generated text reflects the character's personality and references the linked rumor. Edit the text slightly. Generate audio. Play it in Discord. Verify the voice matches.
12. Generate a second response from the stable boy. Queue it.
13. Play the stable boy response. Verify correct voice and order.
14. Ask the chatbot "What do we know about [innkeeper name]?" Verify the answer is accurate.
15. Ask the chatbot "What happened at the tavern?" Verify it cites the event entry and the innkeeper's response.
16. End the session. Verify the bot leaves Discord and raw audio is deleted from Storage.
17. Refresh the browser. Verify everything persists except raw audio.

---

## 4. Testing Protocol

**Automated tests Claude Code should write:**
- Unit tests for prompt assembly (Layer 1/2/3 composition) with fixture data
- Unit tests for vectorization service (mock Qdrant client)
- Integration test for the session lifecycle state machine
- Integration test for the promote-to-memory flow
- Integration test for the full response generation flow with mocked Claude and ElevenLabs clients

**Manual tests Claude Code should document:**
- The Step 3.12 end-to-end test
- ElevenLabs character budget tracking accuracy
- Chatbot answer quality on a campaign with at least 20 memory entries (to verify retrieval actually works, not just runs)
- Latency profiling: time from "Generate Response" click to first audio byte in Discord; target under 6 seconds

---

## 5. Definition of Done

Phase 1 is complete when:
- [ ] All endpoints in Steps 3.1–3.11 are implemented and tested
- [ ] The Step 3.12 end-to-end test passes
- [ ] RLS policies are in place and verified (even though single-user, foundation for Phase 2)
- [ ] Raw audio is reliably deleted on session end
- [ ] Qdrant stays in sync with Postgres on all CRUD operations
- [ ] The chatbot produces grounded answers on a real populated campaign
- [ ] ElevenLabs character usage is tracked per call (even if no cap is enforced yet)
- [ ] Errors in Claude or ElevenLabs calls produce clear user-facing messages, not silent failures
- [ ] README is updated with full local-run instructions including env vars for all services

---

## 6. Known Gotchas

- **Supabase Realtime has message size limits** — for long transcript entries this should be fine, but be aware.
- **Claude prompt caching** is worth implementing for the character/glossary layers of the response prompt. Cache the layers that don't change per-generation; only the transcript/additional-context varies. This materially reduces cost and latency.
- **ElevenLabs streaming to Discord requires transcoding.** ElevenLabs returns MP3 or PCM; Discord needs Opus. Use `prism-media` in the Node bot with `ffmpeg` as the underlying transcoder. Pre-buffer a few hundred ms before starting playback to avoid stutter.
- **Qdrant upsert on edit must use the same point ID** as the original insert, or you'll accumulate duplicates. Store the point ID on the Postgres row.
- **Deepgram's keyterm limit is 100 per stream.** If a campaign's glossary exceeds this, truncate intelligently — prioritize character names, then place names, then the rest. Aliases count against the limit, so consider whether to include them based on how confusable they are.
- **Supabase RLS with service_role key bypasses policies.** The FastAPI backend should use a service_role key for admin operations but must manually enforce user permissions on every query — don't rely on RLS for the backend; rely on it for the frontend direct-access patterns.
- **Magic link auth can be annoying during development.** Consider enabling the "email confirmations off" dev setting in Supabase for local work.
- **Don't vectorize empty strings.** Guard against it in `vectorization.upsert_entry`.
- **ElevenLabs voice IDs differ between free/creator/pro tiers.** Use IDs from the tier Jake actually has.

---

## 7. Claude Code Execution Notes

- Steps 3.1–3.11 are in dependency order. 3.8 (Qdrant) is independent of 3.7 (memory UI) and can be parallelized if convenient, but both must be done before 3.9 (response generation).
- After each step, run its test. Fix failures before proceeding.
- Keep `PHASE_1_NOTES.md` at the repo root with any deviations, decisions, and version pins.
- **Do not** add Phase 2/3 features opportunistically. If you notice something that would be a nice polish feature, note it in `FUTURE_IDEAS.md` and move on.
- Consult the pre-planning doc (`fablescribe-preplanning.md`) for any ambiguity about data shapes or flows. It is the source of truth. If you find a genuine contradiction, flag it before resolving.
- If a real-world detail invalidates the plan (e.g., an API changed, a library doesn't work as expected), stop and document the issue instead of silently working around it.
