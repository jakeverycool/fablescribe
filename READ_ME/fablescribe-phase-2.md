# Fablescribe — Phase 2: Multi-User and Invite Flow

> **Goal:** Open Fablescribe to multiple DMs and their players. Add signup, campaign invites, player role, subscription tier enforcement, ElevenLabs and Deepgram budget caps, and Discord recording consent.

**Duration estimate:** ~2 weeks of focused work.

**Prerequisites:**
- Phase 1 is complete and Jake has run at least one real session with it
- **Phase 1.5 is complete** — the dev/prod environments are set up and the promotion pipeline works. All Phase 2 work follows the dev-first workflow: changes land in `dev.fablescribe.io` first, get tested with Jake + beta users, then promote to prod.
- RLS policies from Phase 1 are solid (they carry the multi-tenant weight in this phase)
- A plan for how to handle ElevenLabs and Deepgram billing — either Jake absorbs costs at known caps, or a payment integration is built in this phase (see §7)

---

## 1. Scope

**In scope:**
- Open email signup (not restricted to Jake)
- Campaign invite codes and join flow
- Player role implementation with read-only access to campaign memory
- Platform role enforcement (admin vs. user)
- Subscription tier model (free vs. pro) with feature caps
- ElevenLabs character budget tracking and hard caps per user per period
- Deepgram STT minute budget tracking and hard caps per user per period
- Discord recording consent flow when the bot joins a channel
- Per-user usage dashboard

**Not in scope:**
- Payment integration (Stripe etc.) — tiers exist in data but upgrades happen manually by admin
- Polish features (saved for Phase 3)
- Player-facing chatbot (Phase 4)
- Player-facing live transcript (Phase 4)

---

## 2. Deliverables

- Anyone can sign up with an email
- A DM can generate a campaign invite code and share it
- A player can enter that code and join the campaign
- Players see a read-only view of campaign memory for sessions they're in
- Free tier users hit a hard ElevenLabs cap and get a clear error when they exceed it
- Free tier users hit a hard Deepgram STT cap and see a clear mid-session notification if they exhaust it
- The Discord bot posts a consent notice when it joins a voice channel
- Admin users (just Jake for now) can upgrade other users to pro tier via a simple admin panel

---

## 3. Build Steps

### 3.1 — Open signup and email verification

1. Remove the "Jake only" signup restriction from Phase 1.
2. Enable email confirmation in Supabase Auth settings.
3. On first sign-in, create a row in `users` with default `platform_role=user` and `subscription_tier=free`. Use a Postgres trigger on `auth.users` insert.
4. Add a welcome page for new users: "You don't have any campaigns yet. Create one or enter an invite code."
5. **Test:** Sign up with a new email, verify via the magic link, land on the welcome page, confirm a row exists in `users`.

### 3.2 — Campaign invite codes

1. Add a migration to ensure `campaigns.invite_code` is unique and indexed. Generate a short, human-friendly code on campaign creation (8-character alphanumeric, avoid ambiguous chars like O/0/I/1).
2. Add endpoint `POST /campaigns/{id}/invite-code/rotate` — DM only, generates a new code and invalidates the old one.
3. Add endpoint `POST /campaigns/join` with body `{invite_code}` — looks up the campaign, creates a `campaign_members` row with role=player if the user isn't already a member, returns the campaign.
4. On the campaign detail page (DM view): show the current invite code with a copy button and a rotate button.
5. On the welcome page and top nav: a "Join Campaign" input that accepts an invite code.
6. **Test:** Create a campaign as Jake, copy the code, sign up as a second user, enter the code, verify the second user appears as a player in `campaign_members`, verify the second user sees the campaign in their campaign list.

### 3.3 — Player role and permissions

1. Update the FastAPI permission middleware: every campaign-scoped endpoint checks whether the calling user is a `dm` or a `player` and applies the correct rules.
2. Player permissions:
   - Can read: campaigns they're a member of, sessions in those campaigns, memory_entries where `visibility=public`, characters, glossary_entries, campaign_files (see §3.4 for open question)
   - Cannot read: memory_entries where `visibility=dm_only`, transcript_entries (not applicable in Phase 2 — raw logs are DM-only)
   - Cannot write anything
   - Cannot access the chatbot (DM-only in this phase)
3. Update RLS policies to match.
4. Build a Player view of the campaign: a stripped-down dashboard with Memory and Glossary tabs only (filtered to visible entries), no session controls, no chatbot, no character edit, no file upload.
5. **Test:** As a player, log in, open the joined campaign, verify only the permitted tabs are visible and only public memory entries appear. Try to hit a DM-only endpoint directly via API — verify a 403.

### 3.4 — Campaign files visibility

The pre-planning doc notes this as a TBD. Resolve it in this phase:

**Decision to make:** are uploaded files visible to players by default?

**Recommendation:** add a `visibility` column to `campaign_files` (public|dm_only), default to `dm_only`. DMs can toggle per-file. Players only see public files. This matches the memory entry pattern and is the safer default.

1. Add migration for the `visibility` column.
2. Update the Files UI with a toggle per file.
3. Update RLS and endpoints to enforce visibility.
4. **Test:** Upload two files as DM, mark one public. As player, verify only the public file is visible.

### 3.5 — Subscription tiers and feature caps

1. Define cap constants in a config file:
   ```
   FREE_TIER:
     max_active_campaigns: 1
     max_characters_per_campaign: 10
     max_glossary_entries_per_campaign: 50
     max_file_uploads_per_campaign: 10
     max_file_upload_size_mb: 10
     max_elevenlabs_chars_per_month: 5000
     max_deepgram_stt_minutes_per_month: 240    # ~4 hours of speech = 1-2 sessions
     max_chatbot_queries_per_day: 25

   PRO_TIER:
     max_active_campaigns: 10
     max_characters_per_campaign: 100
     max_glossary_entries_per_campaign: 1000
     max_file_uploads_per_campaign: 200
     max_file_upload_size_mb: 50
     max_elevenlabs_chars_per_month: 100000
     max_deepgram_stt_minutes_per_month: 1200   # ~20 hours of speech = ~5 weekly sessions
     max_chatbot_queries_per_day: 500
   ```
   *(Numbers are suggestions — Jake should confirm before building.)*
2. Add a `usage` view or table that tracks counts per user (campaigns owned, chars used this period, STT minutes this period, queries today).
3. Add a `check_cap` helper function and call it at the start of every mutating endpoint that could be capped.
4. When a cap is hit, return HTTP 402 with a structured error: `{error: "cap_exceeded", cap: "elevenlabs_chars_per_month", limit: 5000, used: 5000}`.
5. Build a Usage panel in the user's account settings showing current usage vs. caps for each category (ElevenLabs chars, Deepgram STT minutes, chatbot queries, etc.).
6. **Test:** Set the free cap to a low number, exceed it, verify the error message is clear and blocks the action.

### 3.6 — ElevenLabs and Deepgram budget enforcement

These are the two per-usage-billed services and both need hard caps to protect against cost blowouts.

**ElevenLabs (TTS):**
1. Before every call to ElevenLabs TTS in the response finalization endpoint, check `users.elevenlabs_chars_used_this_period + len(text)` against the user's tier cap.
2. If it would exceed, return 402 with a clear error.
3. If it fits, proceed with the call and atomically increment `elevenlabs_chars_used_this_period` after the call succeeds.
4. In the dashboard, show a progress bar at the top of the Generate Response modal: "You've used 4,200 of 5,000 ElevenLabs characters this month."

**Deepgram (STT):**
1. Before starting a session (or resuming after a pause), check `users.deepgram_stt_minutes_used_this_period` against the user's tier cap. If at or near the cap, warn the user and either block the session start or allow it with a cap-approaching warning.
2. During the session, the backend tracks audio minutes sent to Deepgram per user. Accumulate into a running counter in Postgres (batched — don't write per-chunk; flush every 30 seconds or on session end).
3. If a user crosses their cap mid-session, the backend stops forwarding audio to Deepgram, closes the Deepgram connection, and notifies the DM in the dashboard that STT is paused due to quota exhaustion. The session itself doesn't end — the DM can finish narratively and continue curation — but no new transcripts come in.
4. In the dashboard, show a similar progress bar in the session view: "STT usage: 180 of 240 min this month."

**Monthly reset (both):**
5. Implement a nightly cron (Supabase Edge Function or a backend scheduled task) that resets both `elevenlabs_chars_used_this_period` and `deepgram_stt_minutes_used_this_period` on the first day of each calendar month.
6. The cron must be idempotent — check a `last_reset_at` timestamp before resetting.

**Testing:**
7. **Test ElevenLabs:** Generate responses until the cap is hit, verify the next generation is blocked with a clear error, verify the counter persisted correctly.
8. **Test Deepgram:** Start a session with the cap set to a low number, speak until exhausted, verify Deepgram stops transcribing mid-session, verify the dashboard shows the cap-hit state, verify curation of already-captured transcripts still works.
9. **Test reset:** Simulate the monthly reset and verify both counters clear.

### 3.7 — Discord recording consent

1. When the bot joins a voice channel (on session start), it sends a text message to the associated text channel:
   > **🎙️ Fablescribe is now recording and transcribing this voice channel for the DM.** Your speech is streamed to Deepgram (a third-party transcription service) to generate the session transcript. Raw audio is deleted at the end of the session. If you do not consent to being recorded and transcribed by a third-party service, please leave the voice channel before speaking. By speaking, you acknowledge and consent to this recording.
2. This notice posts every time the bot joins, not just the first time per server.
3. Add a campaign setting `discord_text_channel_id` where the notice is posted. Default to the first text channel the bot has permission to post in.
4. **Test:** Start a session, verify the notice appears in the expected text channel.

### 3.8 — Admin panel

1. Add an Admin section in the dashboard visible only to users with `platform_role=admin` (Jake sets this manually in the DB for now).
2. Admin features for Phase 2:
   - List all users with signup date, tier, current usage
   - Change a user's subscription tier (free ↔ pro)
   - Change a user's platform_role (user ↔ admin)
   - View system-wide stats: total users, active sessions, total ElevenLabs chars this month, total Deepgram STT minutes this month
3. Protect all admin endpoints with a `require_admin` dependency.
4. **Test:** Log in as Jake (admin), open Admin panel, upgrade a test user to pro, verify the user's new caps take effect.

### 3.9 — End-to-end integration test

Run this as a simulated multi-user scenario:

1. Sign up User A (Jake as admin — upgrade via SQL first).
2. Create a campaign as User A. Populate with characters, glossary, files (one public, one dm_only).
3. Sign up User B as a new user.
4. User B joins User A's campaign via invite code.
5. User A starts a session. User B is present on Discord voice (but not in Fablescribe during the session — they're just a player at the table).
6. User A runs a normal session: transcripts, promotions, response generation, playback.
7. User A ends the session.
8. User B opens the campaign in Fablescribe after the session. Verifies:
   - They see the Memory tab with only public entries (dm_only hidden)
   - They see the Glossary and the public file
   - They do not see the session controls, chatbot, raw log, files marked dm_only, or character edit
9. User A marks one dm_only memory entry as public. User B refreshes and sees it.
10. Set User B's ElevenLabs cap to 0 (manually or via admin). User B tries to generate a response (shouldn't be possible as player anyway — verify the player role blocks it). Then promote User B to a DM of a different campaign and retry; verify the cap blocks the action with a clear error.
11. Set User A's Deepgram STT cap to a very low number (e.g., 2 minutes). Start a new session as User A and speak for more than 2 minutes. Verify Deepgram stops transcribing mid-session, the dashboard shows the cap-hit state, and curation of already-captured transcript still works.
12. Rotate User A's invite code. Sign up User C, try the old code — verify it fails. Try the new code — verify it works.

---

## 4. Testing Protocol

**Automated tests:**
- Unit tests for the permission middleware (dm vs. player vs. admin vs. non-member)
- Unit tests for cap-checking logic with fixture users and campaigns
- Integration test for invite code generation, rotation, and join flow
- Integration test for ElevenLabs cap enforcement (mock the ElevenLabs client)
- Integration test for Deepgram cap enforcement — verify audio forwarding stops and Deepgram connection closes when cap is reached mid-session (mock the Deepgram client)
- RLS policy tests using Supabase's `anon` key to verify players cannot read restricted data

**Manual tests:**
- The Step 3.9 end-to-end test
- Visual check of the player's campaign view — should feel clean, not "crippled DM view"
- Verify the Discord consent message actually posts and reads correctly
- Verify the cap progress bar updates in real time as responses are generated

---

## 5. Definition of Done

- [ ] Anyone can sign up and land on a welcome page
- [ ] Campaign invites work via short codes
- [ ] Players have correct read-only access enforced at API and RLS levels
- [ ] Free tier caps are enforced for all capped features
- [ ] ElevenLabs character usage is tracked and blocks exceedance
- [ ] Deepgram STT minute usage is tracked and blocks exceedance mid-session
- [ ] Monthly reset of ElevenLabs and Deepgram usage is implemented and tested
- [ ] Discord consent message posts on bot join
- [ ] Admin panel lets Jake manage users and view usage
- [ ] Step 3.9 integration test passes
- [ ] No Phase 1 functionality has regressed
- [ ] README is updated with signup instructions and tier explanation

---

## 6. Known Gotchas

- **RLS with auth.uid() is your friend.** Supabase makes `auth.uid()` available in RLS expressions. Use it for the "am I a member of this campaign" check. Don't try to enforce membership in the backend alone — if the frontend ever queries Supabase directly, RLS is the only thing standing between users and other users' data.
- **Rotating an invite code must not kick existing members.** Only the code itself changes; `campaign_members` rows persist.
- **The monthly reset job must be idempotent.** If it runs twice, users shouldn't get double the quota. Check a `last_reset_at` timestamp before resetting.
- **Cap checks should be transactional with the action.** If two response generations fire simultaneously, a naive check-then-increment can race past the cap. Use `SELECT ... FOR UPDATE` or an atomic increment with a constraint.
- **Don't hardcode tier numbers in more than one place.** Put them in a single config module and reference everywhere.
- **Discord consent message placement matters.** Some servers have locked-down text channels; the bot may not have permission to post in the channel associated with the voice channel. Fall back to the system channel or log a warning to the DM in the dashboard.
- **Subscription tier changes take effect immediately**, including cap reductions. If a user is downgraded while above their new cap, future actions are blocked but existing data isn't deleted.

---

## 7. Open Questions for Jake

These should be resolved before starting Phase 2:

1. **Actual cap numbers.** The suggestions in §3.5 are placeholders. What does Jake actually want free vs. pro to look like?
2. **Billing integration.** Is Phase 2 admin-manual tier changes, or does this phase include Stripe/LemonSqueezy? If so, scope triples.
3. **Who pays for ElevenLabs and Deepgram during the free tier?** Jake absorbs the cost up to the caps, but the caps must be low enough that Jake's own budget isn't at risk if 50 people sign up tomorrow. Math to work out for each service: `max_free_users × max_usage_per_month × per_unit_price ≤ Jake's budget`. ElevenLabs is the bigger risk per-user; Deepgram is cheap per-minute but scales with every session minute.
4. **Should players see campaign files at all by default?** The recommendation is dm_only default with per-file override. Confirm or override.
5. **Should player access include the live session view at all** (e.g., a "waiting room" page that just shows "the DM is running a session")? Or is the player experience purely post-session review? The latter is simpler.

---

## 8. Claude Code Execution Notes

- Phase 2 is heavily dependent on RLS correctness. Do not skip the RLS tests.
- Always test with at least two user accounts. Bugs in permission logic are invisible with a single user.
- Keep `PHASE_2_NOTES.md` at the repo root with any deviations.
- Do not add Phase 3 polish features. If something feels rough but works, note it in `FUTURE_IDEAS.md`.
- If billing integration is in scope (per Jake's answer to Q2), treat it as a separate substantial milestone — it is not a side quest.
