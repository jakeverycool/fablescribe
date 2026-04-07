# Fablescribe — Phase 3: Polish and Power Features

> **Goal:** Take Fablescribe from "functional MVP" to "actually pleasant to use in a real campaign." This phase is a collection of independent improvements, each of which can be built and shipped standalone. Unlike Phases 0–2, the features here do not have strict dependencies on each other and can be prioritized based on Jake's actual pain points after running sessions with the Phase 2 product.

**Duration estimate:** variable. Each feature below is ~1–5 days of work. Ship them incrementally.

**Prerequisites:**
- Phase 2 is complete and stable
- Jake has run at least 3–5 real sessions with real players and captured specific pain points
- Feedback from any early external users (if applicable)

---

## 1. Scope

Phase 3 is a menu. Pick features based on real usage pain, not the order in this doc. Each feature is self-contained.

**Features in this phase:**
1. Rich glossary UI (filtering, search, bulk import, linking visualizer)
2. Explicit DM-only visibility toggle and future-reveal scheduling
3. Audio queue management UI (reorder, regenerate, batch delete)
4. Session history and campaign timeline
5. Chatbot query history and saved searches
6. Cross-session memory linking suggestions
7. Transcript edit and cleanup tools
8. Character quick-reference drawer during active session
9. File drawer during active session
10. DM annotation layer over the raw transcript

Each feature below has its own mini-build doc.

---

## 2. Feature 1 — Rich Glossary UI

**Why:** By mid-campaign, a DM may have 50+ glossary entries. The Phase 1 table view stops scaling around 20.

**Deliverables:**
- Search bar that matches name, aliases, and description (client-side substring search is fine)
- Filter by type (character/place/faction/etc.)
- Filter by tags
- Sort by name, type, or last updated
- Bulk import from a JSON or CSV file
- Linking visualizer: click an entry, see a small graph of its direct links (depth 1 only)

**Build steps:**
1. Refactor the Glossary tab to use a sidebar list + detail pane layout (instead of a single table).
2. Add filter/sort controls above the list.
3. Add a "Bulk Import" button that accepts JSON matching the `glossary_entries` schema (minus IDs). Validate and insert in a transaction.
4. Add a "Links" visualizer: on entry detail, show incoming and outgoing links as a small interactive graph (use `react-flow` or a lightweight d3 setup).
5. Re-vectorize all bulk-imported entries immediately.

**Testing:**
- Import 50 entries via JSON, verify they all appear and are searchable
- Search by alias, verify matching works
- Visualizer renders for an entry with 5+ links without breaking layout
- Chatbot answers remain correct after bulk import

---

## 3. Feature 2 — DM-Only Visibility Toggle and Future Reveals

**Why:** Phase 1 has a `visibility` field in the schema but no dedicated UI. Phase 2 exposes the toggle minimally. Phase 3 makes it a first-class control and adds the ability to schedule reveals.

**Deliverables:**
- A prominent visibility toggle on every memory entry
- A "Reveal at session X" scheduler — the entry stays DM-only until the specified session starts
- A filter on the memory log: "Show DM-only entries" (DM view only)

**Build steps:**
1. Add a `reveal_at_session_id` column to `memory_entries` (nullable).
2. Add UI: toggle and a session-picker dropdown for scheduled reveals.
3. Modify the memory read endpoint to automatically flip `dm_only` → `public` when the active session matches `reveal_at_session_id`.
4. Add an explicit visibility filter on the DM memory view.

**Testing:**
- Mark an entry as dm_only, verify players can't see it
- Schedule a reveal for a future session, start that session, verify the entry becomes visible to players
- Verify the filter toggle correctly shows/hides dm_only entries in the DM view

---

## 4. Feature 3 — Audio Queue Management UI

**Why:** The Phase 1 queue is a list with play and delete. In practice, DMs want to reorder on the fly, regenerate with edits, and sometimes clear the whole queue.

**Deliverables:**
- Drag-and-drop reorder
- Regenerate button (edits text and regenerates audio in place, consuming ElevenLabs quota)
- Change voice button (picks a different character's voice for the same text)
- Clear queue button
- Preview before playing (plays locally in the browser, not in Discord)

**Build steps:**
1. Install `@dnd-kit/sortable` or equivalent in the frontend.
2. Add drag handles to queue items; on drop, call a `PATCH /audio-queue/reorder` endpoint with the new order.
3. Add a Regenerate button that opens a modal with the current text, edit field, and a "regenerate" action that calls a new endpoint combining the text edit + new TTS call.
4. Add a "Preview in browser" button that plays the audio via an HTML5 audio tag without going through Discord.
5. Add a "Clear all" with confirmation.

**Testing:**
- Reorder a queue of 5+ items and verify persistence
- Regenerate an item with edited text, verify new audio and updated memory entry
- Preview plays in the browser without triggering Discord playback
- Clear all removes items from the queue but preserves memory entries

---

## 5. Feature 4 — Session History and Campaign Timeline

**Why:** Long-running campaigns need a way to scroll back through sessions chronologically. The Phase 2 UI defaults to the current session.

**Deliverables:**
- A "Sessions" tab that lists all sessions in the campaign
- Each session shows date, title, DM notes, and a count of memory entries created
- Clicking a session scopes the memory view to that session
- A campaign-wide timeline view: memory entries across all sessions in chronological order

**Build steps:**
1. Build a Sessions tab with a table: date, title, duration, entry counts.
2. Add a session detail page: notes, stats, filtered memory view.
3. Build a Timeline tab that's the campaign's full memory log, ordered by source timestamp, with session boundaries visually marked.
4. Add a title/notes edit for sessions after they're ended.

**Testing:**
- Create 3 sessions across multiple days with memory entries in each
- Verify the Sessions tab shows all three with correct counts
- Verify the Timeline renders them in order with clear boundaries
- Edit a past session's notes, verify persistence

---

## 6. Feature 5 — Chatbot Query History and Saved Searches

**Why:** DMs repeatedly ask the same questions. Caching and saving queries saves time and Claude API calls.

**Deliverables:**
- Persistent chat history per campaign (not stateless anymore)
- Saved queries: DM stars a useful question and it appears in a sidebar
- Short-term conversation context: follow-up questions know what the previous question was about

**Build steps:**
1. Add a `chatbot_conversations` table: `id, campaign_id, user_id, created_at, title`.
2. Add a `chatbot_messages` table: `id, conversation_id, role, content, citations, created_at`.
3. Update the chatbot endpoint to take an optional `conversation_id`; if provided, include the last N messages in the Claude prompt for context.
4. Build a sidebar of past conversations with title auto-generation (use Claude to generate a title from the first message).
5. Add a "Save this question" star on any message.

**Testing:**
- Ask a multi-turn question (e.g., "Who is Gareth?" then "And what did he tell us?") and verify the follow-up uses the context
- Save a question, verify it appears in the saved list
- Start a new conversation, verify it's separate from previous ones

---

## 7. Feature 6 — Cross-Session Linking Suggestions

**Why:** DMs often forget that a new NPC the party met is actually the same NPC from 10 sessions ago.

**Deliverables:**
- When a new memory entry is created, a background job queries Qdrant for very similar entries and suggests "this might be related to X"
- Suggestions appear as a non-blocking notification the DM can accept or dismiss

**Build steps:**
1. Add a background task (or post-create hook) that takes a new memory entry, queries Qdrant for its top 3 most similar historical entries (threshold > 0.85 similarity), and creates a suggestion row.
2. Add a `memory_suggestions` table: `id, campaign_id, source_entry_id, suggested_entry_id, similarity_score, status, created_at`.
3. Build a notification UI for the DM showing pending suggestions.
4. On accept, create a bidirectional link between the two entries (add each other's IDs to a `linked_entry_ids` array on both).
5. On dismiss, mark the suggestion as dismissed and don't suggest it again.

**Testing:**
- Create two memory entries with very similar content, verify a suggestion appears
- Accept the suggestion, verify both entries reference each other
- Verify dismissed suggestions don't reappear

---

## 8. Feature 7 — Transcript Edit and Cleanup Tools

**Why:** Whisper makes mistakes. The DM should be able to correct a transcript line before promoting it, and should be able to clean up the raw log during or after a session.

**Deliverables:**
- Edit a raw transcript line inline (fixes typos, proper nouns)
- Merge adjacent lines from the same speaker
- Hide individual lines without deleting them
- "Clean up this session" — a bulk view that shows every line and lets the DM quickly edit/hide in sequence

**Build steps:**
1. Add PATCH/DELETE endpoints for `transcript_entries`, DM-only, campaign-scoped.
2. Add an inline edit UI on the raw transcript panel.
3. Add a "merge" action when two adjacent entries have the same speaker.
4. Add a "hide" toggle that soft-hides without deleting.
5. Build a "Clean up session" full-screen view optimized for fast keyboard-driven editing.

**Testing:**
- Edit a transcript line, verify the edit persists and is reflected in any promoted memory entries (optional: re-vectorize the related memory entry)
- Merge two adjacent lines, verify they combine correctly
- Hide a line, verify it's excluded from the default view but still selectable for promotion

---

## 9. Feature 8 — Character Quick-Reference Drawer

**Why:** Mid-session, the DM wants to glance at a character's personality notes without leaving the session view.

**Deliverables:**
- A collapsible side drawer listing all characters in the campaign
- Clicking a character shows their full sheet in a panel
- A search/filter box at the top of the drawer
- Works on top of the active session view without scrolling it away

**Build steps:**
1. Add a drawer component that slides in from the right.
2. List all characters with name and small voice indicator.
3. On click, show the character sheet as a read-only panel.
4. Add a keyboard shortcut (e.g., `C`) to toggle the drawer.

**Testing:**
- Open during an active session, verify it doesn't interrupt the live transcript
- Search filters the list correctly
- Keyboard shortcut works

---

## 10. Feature 9 — File Drawer During Active Session

**Why:** DMs need quick access to handouts and maps during play. Phase 1's Files tab requires navigating away from the session.

**Deliverables:**
- A session-view drawer for campaign files
- Image files preview inline
- PDFs open in a modal viewer
- Fast search

**Build steps:**
1. Similar drawer component as Feature 8, keyed to `F`.
2. List files with type icons and thumbnails for images.
3. On click: images open in a modal, PDFs open in a modal PDF viewer (use `react-pdf`), other files download.
4. Add a "pin" option so frequently used files stick to the top.

**Testing:**
- Verify image previews load quickly (use Supabase Storage signed URLs with caching)
- Verify PDF modal works with a multi-page file
- Pin a file, verify it stays at the top across sessions

---

## 11. Feature 10 — DM Annotation Layer Over the Raw Transcript

**Why:** Sometimes the DM wants to add notes to the raw transcript without promoting to memory (e.g., "the party is being sneaky here" or "Jake rolled a 20").

**Deliverables:**
- Inline annotations attached to transcript lines
- Annotations are visible only to the DM
- Optional: promote an annotation to a memory note

**Build steps:**
1. Add a `transcript_annotations` table: `id, transcript_entry_id, user_id, content, created_at`.
2. Add a + icon on transcript lines that opens an annotation input.
3. Render annotations inline below their parent line, styled differently.
4. Add a "promote annotation to memory note" action.

**Testing:**
- Add annotations on 3 lines, verify they persist
- Promote one to memory, verify the memory entry contains the annotation content
- As player (if players had access to raw log, which they don't in current design), verify annotations are not visible

---

## 12. Testing Protocol (Phase 3 as a whole)

Since features ship independently, each has its own tests above. The integration test for Phase 3 is less about a single end-to-end scenario and more about:

- **Regression:** after each feature, run the Phase 2 Step 3.9 test and the Phase 1 Step 3.12 test to confirm nothing earlier broke
- **UX walkthrough:** Jake does a full session using the latest build and reports any rough edges
- **Performance check:** with a campaign containing 100+ memory entries and 50+ glossary entries, verify the dashboard is still responsive

---

## 13. Definition of Done (Per Feature)

Each feature's DoD is its own checklist at the end of its section. Phase 3 as a whole is "done" when Jake has stopped adding items to `FUTURE_IDEAS.md` for the current session pain points — i.e., when the product is comfortable enough to not actively annoy him.

---

## 14. Known Gotchas

- **Drag-and-drop state management is fiddly.** Use a tested library (`@dnd-kit`) and follow its recommended patterns for optimistic updates.
- **Qdrant re-vectorization on transcript edits is a design call.** If a promoted memory entry references an edited transcript line, should the memory entry's vector update? Probably yes, but decide explicitly and document.
- **Reveal scheduling needs a trigger.** Either a backend job checks on session start, or the frontend filter evaluates at read time. The read-time check is simpler and doesn't require a cron.
- **The linking suggestion feature can create notification spam** on busy campaigns. Throttle it to at most N suggestions per session.
- **Feature 9 PDF viewer memory use** can blow up on large PDFs. Consider a server-side image rendering fallback for files over ~20 MB.
- **Don't skip the regression tests between features.** Phase 3 is where cruft accumulates.

---

## 15. Claude Code Execution Notes

- Features are independent and can be built in any order. Start with the ones Jake actually asks for based on Phase 2 usage — don't default to the order in this doc.
- Each feature gets its own branch/PR and its own test run.
- Keep `PHASE_3_NOTES.md` with status of each feature (not started / in progress / shipped / skipped).
- If a feature turns out to be a bad idea after a few days of use, it's okay to revert. Note the reason in `FUTURE_IDEAS.md`.
- If a feature reveals a deeper architectural issue (e.g., "the whole memory query layer needs to be cached"), stop the feature work and fix the foundation before continuing.
