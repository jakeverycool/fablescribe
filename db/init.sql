CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE transcript_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  TEXT NOT NULL,
    speaker_user_id     TEXT NOT NULL,
    speaker_display_name TEXT NOT NULL,
    text        TEXT NOT NULL,
    segment_start_ts    TIMESTAMPTZ,
    segment_end_ts      TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transcript_entries_session ON transcript_entries (session_id);
CREATE INDEX idx_transcript_entries_created ON transcript_entries (created_at);
