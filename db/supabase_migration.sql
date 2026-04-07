-- Fablescribe Phase 1 — Full Schema Migration
-- Run against the Supabase project via the SQL Editor

-- ═══════════════════════════════════════════════════════════════════════════
-- Extensions
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════════════
-- Custom types
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE platform_role AS ENUM ('admin', 'user');
CREATE TYPE subscription_tier AS ENUM ('free', 'pro');
CREATE TYPE campaign_role AS ENUM ('dm', 'player');
CREATE TYPE session_status AS ENUM ('active', 'ended');
CREATE TYPE memory_kind AS ENUM ('note', 'response', 'event');
CREATE TYPE memory_visibility AS ENUM ('public', 'dm_only');
CREATE TYPE queue_status AS ENUM ('pending', 'playing', 'played', 'cancelled');
CREATE TYPE glossary_type AS ENUM ('character', 'place', 'faction', 'event', 'item', 'lore', 'rule', 'other');
CREATE TYPE file_kind AS ENUM ('docx', 'txt', 'md', 'pdf', 'image', 'other');
CREATE TYPE ingestion_status AS ENUM ('pending', 'ingested', 'skipped', 'failed');
CREATE TYPE character_kind AS ENUM ('npc', 'pc');
CREATE TYPE speaker_role AS ENUM ('dm', 'player', 'unknown');

-- ═══════════════════════════════════════════════════════════════════════════
-- Tables
-- ═══════════════════════════════════════════════════════════════════════════

-- users (extends Supabase auth.users)
CREATE TABLE public.users (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    platform_role   platform_role NOT NULL DEFAULT 'user',
    subscription_tier subscription_tier NOT NULL DEFAULT 'free',
    elevenlabs_chars_used_this_period INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- campaigns
CREATE TABLE public.campaigns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    created_by      UUID NOT NULL REFERENCES public.users(id),
    invite_code     TEXT UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
    discord_voice_channel_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- campaign_members
CREATE TABLE public.campaign_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    campaign_role   campaign_role NOT NULL DEFAULT 'player',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(campaign_id, user_id)
);

-- sessions
CREATE TABLE public.sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    title           TEXT,
    status          session_status NOT NULL DEFAULT 'active',
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    dm_session_notes TEXT,
    paused          BOOLEAN NOT NULL DEFAULT false
);

-- transcript_entries (raw log)
CREATE TABLE public.transcript_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    speaker_user_id     TEXT NOT NULL,
    speaker_display_name TEXT NOT NULL,
    text                TEXT NOT NULL,
    segment_start_ts    TIMESTAMPTZ,
    segment_end_ts      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- characters
CREATE TABLE public.characters (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id         UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    kind                character_kind NOT NULL DEFAULT 'npc',
    description         TEXT,
    personality         TEXT,
    speech_notes        TEXT,
    elevenlabs_voice_id TEXT,
    secrets             TEXT,
    linked_glossary_ids UUID[] DEFAULT '{}',
    qdrant_point_id     UUID,
    vector_updated_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- campaign_speakers (Discord user → role + PC mapping)
CREATE TABLE public.campaign_speakers (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id             UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    discord_user_id         TEXT NOT NULL,
    discord_display_name    TEXT NOT NULL,
    role                    speaker_role NOT NULL DEFAULT 'unknown',
    character_id            UUID REFERENCES public.characters(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(campaign_id, discord_user_id)
);

-- glossary_entries
CREATE TABLE public.glossary_entries (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id             UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    type                    glossary_type NOT NULL DEFAULT 'other',
    name                    TEXT NOT NULL,
    aliases                 TEXT[] DEFAULT '{}',
    description             TEXT,
    known_by_character_ids  UUID[] DEFAULT '{}',
    linked_entry_ids        UUID[] DEFAULT '{}',
    tags                    TEXT[] DEFAULT '{}',
    qdrant_point_id         UUID,
    vector_updated_at       TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- memory_entries (campaign memory — the canonical record)
CREATE TABLE public.memory_entries (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id             UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    session_id              UUID REFERENCES public.sessions(id),
    kind                    memory_kind NOT NULL,
    visibility              memory_visibility NOT NULL DEFAULT 'public',
    source_timestamp        TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- source context
    selected_transcript_ids UUID[] DEFAULT '{}',
    dm_annotation           TEXT,
    linked_glossary_ids     UUID[] DEFAULT '{}',

    -- note/event content
    content                 TEXT,

    -- response-only fields
    character_id            UUID REFERENCES public.characters(id),
    additional_context      TEXT,
    generated_text          TEXT,
    final_text              TEXT,
    audio_file_ref          TEXT,
    queue_position          INTEGER,
    queue_status            queue_status,
    played_at               TIMESTAMPTZ,

    -- vector tracking
    qdrant_point_id         UUID,
    vector_updated_at       TIMESTAMPTZ,

    -- presence (NPCs who witnessed this entry)
    present_character_ids   UUID[] DEFAULT '{}',

    -- soft delete
    deleted_at              TIMESTAMPTZ
);

-- campaign_files
CREATE TABLE public.campaign_files (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id         UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    uploaded_by         UUID NOT NULL REFERENCES public.users(id),
    filename            TEXT NOT NULL,
    display_name        TEXT,
    mime_type           TEXT NOT NULL,
    file_size_bytes     BIGINT NOT NULL,
    storage_path        TEXT NOT NULL,
    file_kind           file_kind NOT NULL DEFAULT 'other',
    description         TEXT,
    tags                TEXT[] DEFAULT '{}',
    ingestion_status    ingestion_status NOT NULL DEFAULT 'skipped',
    qdrant_point_ids    UUID[] DEFAULT '{}',
    extracted_text      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX idx_campaign_members_campaign ON public.campaign_members(campaign_id);
CREATE INDEX idx_campaign_members_user ON public.campaign_members(user_id);
CREATE INDEX idx_sessions_campaign ON public.sessions(campaign_id);
CREATE INDEX idx_transcript_entries_session ON public.transcript_entries(session_id);
CREATE INDEX idx_transcript_entries_created ON public.transcript_entries(created_at);
CREATE INDEX idx_characters_campaign ON public.characters(campaign_id);
CREATE INDEX idx_glossary_entries_campaign ON public.glossary_entries(campaign_id);
CREATE INDEX idx_memory_entries_campaign ON public.memory_entries(campaign_id);
CREATE INDEX idx_memory_entries_session ON public.memory_entries(session_id);
CREATE INDEX idx_memory_entries_kind ON public.memory_entries(kind);
CREATE INDEX idx_memory_entries_deleted ON public.memory_entries(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_memory_entries_queue ON public.memory_entries(queue_status) WHERE queue_status IN ('pending', 'playing');
CREATE INDEX idx_campaign_files_campaign ON public.campaign_files(campaign_id);
CREATE INDEX idx_campaign_speakers_campaign ON public.campaign_speakers(campaign_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Auto-create user row on signup
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════════
-- Auto-add creator as DM on campaign creation
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_campaign_created()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.campaign_members (campaign_id, user_id, campaign_role)
    VALUES (NEW.id, NEW.created_by, 'dm');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_campaign_created
    AFTER INSERT ON public.campaigns
    FOR EACH ROW EXECUTE FUNCTION public.handle_campaign_created();

-- ═══════════════════════════════════════════════════════════════════════════
-- updated_at triggers
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_campaigns
    BEFORE UPDATE ON public.campaigns
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_updated_at_glossary
    BEFORE UPDATE ON public.glossary_entries
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_updated_at_files
    BEFORE UPDATE ON public.campaign_files
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glossary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_speakers ENABLE ROW LEVEL SECURITY;

-- Helper: check if user is a member of a campaign
CREATE OR REPLACE FUNCTION public.is_campaign_member(p_campaign_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.campaign_members
        WHERE campaign_id = p_campaign_id AND user_id = auth.uid()
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if user is DM of a campaign
CREATE OR REPLACE FUNCTION public.is_campaign_dm(p_campaign_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.campaign_members
        WHERE campaign_id = p_campaign_id AND user_id = auth.uid() AND campaign_role = 'dm'
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- users: can read/update own row
CREATE POLICY users_select ON public.users FOR SELECT USING (id = auth.uid());
CREATE POLICY users_update ON public.users FOR UPDATE USING (id = auth.uid());

-- campaigns: members can read, DMs can modify
CREATE POLICY campaigns_select ON public.campaigns FOR SELECT USING (is_campaign_member(id));
CREATE POLICY campaigns_insert ON public.campaigns FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY campaigns_update ON public.campaigns FOR UPDATE USING (is_campaign_dm(id));
CREATE POLICY campaigns_delete ON public.campaigns FOR DELETE USING (is_campaign_dm(id));

-- campaign_members: members can see other members, DMs can manage
CREATE POLICY members_select ON public.campaign_members FOR SELECT USING (is_campaign_member(campaign_id));
CREATE POLICY members_insert ON public.campaign_members FOR INSERT WITH CHECK (is_campaign_dm(campaign_id));
CREATE POLICY members_delete ON public.campaign_members FOR DELETE USING (is_campaign_dm(campaign_id));

-- sessions: scoped to campaign membership
CREATE POLICY sessions_select ON public.sessions FOR SELECT USING (is_campaign_member(campaign_id));
CREATE POLICY sessions_insert ON public.sessions FOR INSERT WITH CHECK (is_campaign_dm(campaign_id));
CREATE POLICY sessions_update ON public.sessions FOR UPDATE USING (is_campaign_dm(campaign_id));
CREATE POLICY sessions_delete ON public.sessions FOR DELETE USING (is_campaign_dm(campaign_id));

-- transcript_entries: scoped via session → campaign
CREATE POLICY transcripts_select ON public.transcript_entries FOR SELECT
    USING (is_campaign_member((SELECT campaign_id FROM public.sessions WHERE id = session_id)));
CREATE POLICY transcripts_insert ON public.transcript_entries FOR INSERT
    WITH CHECK (is_campaign_dm((SELECT campaign_id FROM public.sessions WHERE id = session_id)));

-- characters: scoped to campaign membership
CREATE POLICY characters_select ON public.characters FOR SELECT USING (is_campaign_member(campaign_id));
CREATE POLICY characters_insert ON public.characters FOR INSERT WITH CHECK (is_campaign_dm(campaign_id));
CREATE POLICY characters_update ON public.characters FOR UPDATE USING (is_campaign_dm(campaign_id));
CREATE POLICY characters_delete ON public.characters FOR DELETE USING (is_campaign_dm(campaign_id));

-- glossary_entries: scoped to campaign membership
CREATE POLICY glossary_select ON public.glossary_entries FOR SELECT USING (is_campaign_member(campaign_id));
CREATE POLICY glossary_insert ON public.glossary_entries FOR INSERT WITH CHECK (is_campaign_dm(campaign_id));
CREATE POLICY glossary_update ON public.glossary_entries FOR UPDATE USING (is_campaign_dm(campaign_id));
CREATE POLICY glossary_delete ON public.glossary_entries FOR DELETE USING (is_campaign_dm(campaign_id));

-- memory_entries: scoped to campaign membership, respects visibility
CREATE POLICY memory_select ON public.memory_entries FOR SELECT
    USING (
        is_campaign_member(campaign_id)
        AND deleted_at IS NULL
        AND (visibility = 'public' OR is_campaign_dm(campaign_id))
    );
CREATE POLICY memory_insert ON public.memory_entries FOR INSERT WITH CHECK (is_campaign_dm(campaign_id));
CREATE POLICY memory_update ON public.memory_entries FOR UPDATE USING (is_campaign_dm(campaign_id));
CREATE POLICY memory_delete ON public.memory_entries FOR DELETE USING (is_campaign_dm(campaign_id));

-- campaign_files: scoped to campaign membership
CREATE POLICY files_select ON public.campaign_files FOR SELECT USING (is_campaign_member(campaign_id));
CREATE POLICY files_insert ON public.campaign_files FOR INSERT WITH CHECK (is_campaign_dm(campaign_id));
CREATE POLICY files_update ON public.campaign_files FOR UPDATE USING (is_campaign_dm(campaign_id));
CREATE POLICY files_delete ON public.campaign_files FOR DELETE USING (is_campaign_dm(campaign_id));

-- campaign_speakers: scoped to campaign membership
CREATE POLICY speakers_select ON public.campaign_speakers FOR SELECT USING (is_campaign_member(campaign_id));
CREATE POLICY speakers_insert ON public.campaign_speakers FOR INSERT WITH CHECK (is_campaign_dm(campaign_id));
CREATE POLICY speakers_update ON public.campaign_speakers FOR UPDATE USING (is_campaign_dm(campaign_id));
CREATE POLICY speakers_delete ON public.campaign_speakers FOR DELETE USING (is_campaign_dm(campaign_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- Enable Realtime for transcript_entries
-- ═══════════════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE public.transcript_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.memory_entries;
