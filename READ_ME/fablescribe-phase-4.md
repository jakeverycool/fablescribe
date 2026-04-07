# Fablescribe — Phase 4: Deferred and Future Features

> **Goal:** Document the features and improvements that are explicitly deferred beyond the core product. These are real ideas worth building, but only after Phases 0–3 are solid and the product has enough real usage to justify the added complexity. This doc is more roadmap than build plan.

**When to build Phase 4:** only after Fablescribe has a stable user base using Phases 0–3 in real campaigns, and specific features here have been requested or identified as bottlenecks.

---

## 1. Scope

This phase is a collection of larger, more speculative efforts. Unlike Phase 3 (which is polish on existing flows), Phase 4 items tend to require new infrastructure, new pipelines, or significant external dependencies. Each one is its own mini-project.

**Deferred features:**
1. ElevenLabs voice cloning
2. Player chatbot access
3. Player-facing live transcript
4. Bulk fight-summary helper
5. AI ingestion of uploaded files (text extraction and vectorization)
6. Vision-model ingestion of uploaded images
7. Cross-campaign lore sharing
8. Export and backup tooling

Each section below sketches the rough scope. A full build doc for any of these should be written when it's actually being built.

---

## 2. ElevenLabs Voice Cloning

**Why:** Some DMs will want NPCs that sound like specific people — e.g., a long-dead PC voiced by their actual player, or a custom villain voice. ElevenLabs supports Professional Voice Cloning on Pro tier.

**Rough scope:**
- Add a Voice Clones section under campaign settings
- Upload voice samples (5+ minutes of clean audio)
- Submit to ElevenLabs for cloning via their API
- Poll for cloning completion
- Store the resulting voice_id on a `custom_voices` table keyed to campaign
- Allow assigning custom voices to characters the same way as library voices

**Key decisions:**
- Consent and abuse: voice cloning is the feature most likely to be misused. Require explicit confirmation that the DM has permission to clone the voice, log it, and don't allow cloning public figures.
- Cost: ElevenLabs voice cloning requires Pro tier at minimum. This is not a free-tier feature.
- Quality varies with sample quality. Need clear UX around sample requirements.

**Dependencies:** Pro-tier ElevenLabs account, a clear TOS update for consent, and enough user demand to justify the compliance overhead.

---

## 3. Player Chatbot Access

**Why:** Phase 1–2 keep the chatbot DM-only. Players reviewing between sessions would benefit from a "catch me up" chatbot, but it has to respect DM-only visibility.

**Rough scope:**
- Extend the chatbot endpoint with a player mode
- In player mode: filter Qdrant results by `visibility=public` and exclude DM-only entries from both retrieval and prompt
- Verify Claude can't be jailbroken into revealing hidden entries by testing prompt injection scenarios
- Add a separate chatbot UI on the player view
- Add per-player chat history scoped to their user + campaign

**Key decisions:**
- Cost model: chatbot queries cost Claude tokens. Are player queries counted against the DM's cap, the player's cap (if any), or a shared pool?
- Safety: even with RLS and payload filtering, there's residual risk of information leakage via inference ("What happened at the altar?" could reveal the existence of the altar). Test thoroughly.
- Should players see citations to the same extent DMs do?

**Dependencies:** actual player demand. Some campaigns might prefer players stay "in the dark" outside sessions.

---

## 4. Player-Facing Live Transcript

**Why:** Players who miss a part of a session (bathroom break, technical issue) could benefit from seeing what was said.

**Rough scope:**
- Expose the raw transcript to players during an active session, filtered to the current session only
- Add player-level muting (DM can hide specific lines that contain spoilers or OOC content from players)
- Consider a slight delay (10–30 seconds) to give the DM time to redact

**Key decisions:**
- Delay vs. real-time: real-time means any DM narration slip is instantly exposed; delay makes the feature awkward
- Retention: players shouldn't be able to scroll back through entire historical raw transcripts (that's what the curated memory is for)
- Opt-in per campaign: some DMs will hate this, some will love it

**Dependencies:** clear signal from real users that this is wanted. Don't build it speculatively.

---

## 5. Bulk Fight-Summary Helper

**Why:** Combat is the most common "don't transcribe this in detail" moment. Phase 1 handles it via standalone `event` entries, but the DM still has to type the summary manually.

**Rough scope:**
- A "Log Fight" button in the session view that opens a structured form:
  - Participants (multi-select from characters + freeform)
  - Outcome (victory / retreat / truce / custom)
  - Notable moments (textarea)
  - Casualties / loot / consequences (textareas)
- On submit, creates a memory entry with kind=event and structured metadata in the content field
- Optionally: an "Auto-summarize from transcript" button that takes the last N minutes of raw transcript and asks Claude to produce a fight summary based on it. DM edits before saving.

**Key decisions:**
- Structured vs. freeform: the form adds UI weight. Is the structured metadata worth it, or is a rich text event entry enough?
- Auto-summarization eats Claude tokens — cap it

**Dependencies:** evidence from real sessions that the current "standalone event entry" flow is too much friction for combats.

---

## 6. AI Ingestion of Uploaded Files

**Why:** Phase 1 stores uploaded files but doesn't let the AI reference them. A DM with a 40-page homebrew setting doc probably wants NPCs to know that lore and the chatbot to cite it.

**Rough scope:**
- Background job triggered on upload (text-based files only)
- Extract text: `docx` → python-docx or pandoc, `pdf` → pdfplumber, `txt/md` → read directly
- Chunk the extracted text into semantically meaningful pieces (by heading, paragraph, or fixed token size)
- Embed each chunk and store in Qdrant with `file_id` and `chunk_index` metadata
- Update the chatbot retrieval to include file chunks in the top-K results
- Update the response generator to optionally pull file chunks as an additional context layer
- DM opt-in per file (set `ingestion_status` on `campaign_files`)
- Re-ingest on file update

**Key decisions:**
- Chunking strategy: fixed-size vs. semantic (heading-based). Semantic is better but harder.
- Token budget: a large ingested corpus plus the three-layer prompt could blow the context window. Need careful retrieval caps.
- Cost: ingesting large files costs embedding API calls (even with a local Nomic model, it's CPU/GPU time)
- Update strategy: re-ingest on every file edit, or only on explicit "re-ingest" action?
- Cap per user: free tier should have a low limit on ingested file total tokens

**Dependencies:** Phase 3 glossary UI mature enough that file ingestion doesn't duplicate what's already possible via manually-entered glossary entries.

---

## 7. Vision-Model Ingestion of Uploaded Images

**Why:** Maps and handouts are often image files. The DM can't search for them or have NPCs reference them without text descriptions.

**Rough scope:**
- Background job on image upload
- Send image to Claude (which has vision) with a prompt like "Describe this image in detail for a tabletop RPG context. Identify locations, characters, items, and lore clues visible in the image."
- Store the resulting description as `extracted_text` on the `campaign_files` row
- Vectorize the description into Qdrant
- Include in chatbot retrieval and optionally response generation

**Key decisions:**
- Cost per image: Claude vision is not free
- DM review: should the auto-generated description be editable before it's vectorized?
- Handling multi-image handouts (a "tavern" image with a map on one side and text on the other)

**Dependencies:** §6 (text ingestion) should probably ship first since it's the more common case.

---

## 8. Cross-Campaign Lore Sharing

**Why:** DMs who run multiple campaigns in the same homebrew setting want shared glossary entries — the same factions, gods, world history.

**Rough scope:**
- Introduce a `worlds` concept above campaigns
- A world owns a shared glossary
- Campaigns belong to a world and can reference world glossary entries alongside their own
- When generating responses or answering chatbot queries, retrieval pulls from both the campaign's and the world's glossary
- Edits to world-level entries affect all campaigns in that world

**Key decisions:**
- Does this replace campaign-level glossary, or is it additive? (Probably additive.)
- How does visibility work across campaigns? (World lore is likely public within the world by default.)
- Does Qdrant need a per-world collection or can it use filters?

**Dependencies:** evidence that multi-campaign DMs are frustrated by copying glossary entries.

---

## 9. Export and Backup Tooling

**Why:** Users will eventually want to export their campaigns — for backup, for sharing, for moving to another tool, or for generating a "campaign recap" document for players.

**Rough scope:**
- Full campaign export: JSON dump of all entities + a zip of uploaded files + audio files
- Human-readable export: a Markdown or PDF document summarizing the campaign memory chronologically, with character sheets and glossary as appendices
- Selective export: just the glossary, just one session's memory, etc.
- Import from JSON export (restore a backup or clone a campaign)

**Key decisions:**
- PII and consent: exports contain raw voice transcripts. If the campaign had players, they should consent to exports that include their speech.
- Format: JSON for machine, Markdown for human, PDF for "formal recap I can share with the group"
- Storage: generate on demand or pre-generate?

**Dependencies:** Phase 2 stable with real data worth backing up.

---

## 10. Prioritization Framework

When deciding which Phase 4 features to build, evaluate each against:

1. **Actual user demand.** Is anyone asking for this, or is it speculative?
2. **Cost impact.** Does it increase per-user infrastructure cost? By how much?
3. **Abuse surface.** Does it create new vectors for misuse (voice cloning, file ingestion)?
4. **Complexity.** Is it a 1-week feature or a 2-month project?
5. **Reversibility.** If it turns out to be a bad idea, how hard is it to undo?

Features that score well on demand and low on cost/complexity/abuse (like §9 export tooling) ship first. Features that are high-value but high-complexity (like §8 cross-campaign lore sharing) should be planned carefully with a full dedicated build doc.

---

## 11. What Is Explicitly Not in Phase 4 (or Any Phase)

These are ideas that have come up or might come up but are out of scope for Fablescribe's identity:

- **Dice rolling, initiative tracking, HP management.** Not what this tool does. Integrate with a VTT if users want this.
- **Video or webcam integration.** Audio-only by design.
- **Real-time AI DM.** Fablescribe assists the DM, it doesn't replace the DM.
- **Matchmaking players with DMs.** Not a community platform.
- **Automatic rules lookup (e.g., "what does the Grapple action do").** Different tool.

Document these explicitly so they don't creep into scope via feature requests.

---

## 12. Claude Code Execution Notes

- Phase 4 is not a single build pass. Each item here becomes its own full build doc with its own phases when it's actually being built.
- Before starting any Phase 4 item, write a dedicated mini build doc following the structure of Phase 1 and Phase 2.
- Do not build Phase 4 items speculatively "while you're in there." Features without clear demand become dead code.
- When evaluating a Phase 4 item against the current codebase, flag anything that would require breaking changes to the Phase 1–3 foundations. Those are signals to either redesign the item or defer it further.
