"""Silero VAD gate: filters silence from per-user audio before routing to Deepgram.

Flow: incoming PCM chunks → VAD → (if speech) forward to Deepgram stream.

- Opens a Deepgram connection when speech is first detected for a user.
- Continues forwarding during speech + a trailing window after speech stops.
- Closes the Deepgram connection after sustained silence.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone

import numpy as np
import torch

from silero_vad import load_silero_vad

import db
from stt.deepgram_client import deepgram_manager

logger = logging.getLogger("fablescribe.stt.vad")

# ── VAD config ───────────────────────────────────────────────────────────────
SAMPLE_RATE = 16000
# Silero VAD works best with 512-sample (32ms) chunks at 16kHz
VAD_CHUNK_SAMPLES = 512
# How long to keep forwarding after speech stops (covers natural mid-sentence pauses)
TRAILING_SPEECH_WINDOW_S = 0.6
# How long of continuous silence before closing the Deepgram connection
SILENCE_CLOSE_TIMEOUT_S = 30.0

# ── Module state ─────────────────────────────────────────────────────────────
_vad_model = None
_vad_lock = asyncio.Lock()

# Per-user state keyed by (session_id, user_id)
_user_states: dict[tuple[str, str], "_UserVADState"] = {}


class _UserVADState:
    def __init__(self):
        self.pcm_buffer = bytearray()
        self.is_speaking = False
        self.last_speech_time = 0.0
        self.deepgram_active = False
        self.session_start_time: float | None = None


def _get_vad_model():
    global _vad_model
    if _vad_model is None:
        _vad_model = load_silero_vad(onnx=True)
        logger.info("Silero VAD model loaded (ONNX)")
    return _vad_model


def _run_vad(pcm_chunk: np.ndarray) -> float:
    """Run Silero VAD on a chunk and return speech probability (0.0–1.0)."""
    model = _get_vad_model()
    audio_tensor = torch.from_numpy(pcm_chunk).float() / 32768.0
    with torch.no_grad():
        prob = model(audio_tensor, SAMPLE_RATE).item()
    return prob


# ── Cached session state (avoids hammering remote DB on every audio chunk) ───
_cached_active_session_id: str | None = None
_cached_session_paused: bool = False
_cache_last_refreshed: float = 0.0
CACHE_REFRESH_INTERVAL_S = 2.0  # Refresh every 2 seconds


async def _refresh_session_cache() -> None:
    """Refresh the cached active session ID and paused state from the DB."""
    global _cached_active_session_id, _cached_session_paused, _cache_last_refreshed

    now = time.monotonic()
    if now - _cache_last_refreshed < CACHE_REFRESH_INTERVAL_S:
        return

    _cache_last_refreshed = now
    row = await db.fetch_one(
        "SELECT id, paused FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1"
    )
    if row:
        _cached_active_session_id = str(row["id"])
        _cached_session_paused = bool(row.get("paused"))
    else:
        _cached_active_session_id = None
        _cached_session_paused = False


async def _resolve_active_session() -> str | None:
    """Return the cached active session ID, refreshing if stale."""
    await _refresh_session_cache()
    return _cached_active_session_id


async def _on_transcript(
    session_id: str,
    user_id: str,
    display_name: str,
    text: str,
    start_ts: float,
    end_ts: float,
) -> None:
    """Callback when Deepgram produces a final transcript — persist and broadcast."""
    # Always resolve to the current active session, regardless of what session_id
    # the bot WebSocket was opened with. This means the bot can join before or after
    # the DM creates a session and it will just work.
    active_session_id = await _resolve_active_session()
    if not active_session_id:
        logger.warning(f"No active session — dropping transcript from {display_name}: {text}")
        return

    # Auto-upsert speaker for this campaign so the DM can later assign them to a PC
    campaign_row = await db.fetch_one(
        "SELECT campaign_id FROM sessions WHERE id = %s", (active_session_id,)
    )
    if campaign_row:
        await db.execute(
            """
            INSERT INTO campaign_speakers (campaign_id, discord_user_id, discord_display_name)
            VALUES (%s, %s, %s)
            ON CONFLICT (campaign_id, discord_user_id) DO UPDATE
            SET discord_display_name = EXCLUDED.discord_display_name,
                updated_at = now()
            """,
            (campaign_row["campaign_id"], user_id, display_name),
        )

    state = _user_states.get((session_id, user_id))
    session_start = state.session_start_time if state else None

    # Convert relative Deepgram timestamps to absolute timestamps
    seg_start = None
    seg_end = None
    if session_start is not None:
        seg_start = datetime.fromtimestamp(session_start + start_ts, tz=timezone.utc).isoformat()
        seg_end = datetime.fromtimestamp(session_start + end_ts, tz=timezone.utc).isoformat()

    await db.execute_returning(
        """
        INSERT INTO transcript_entries
            (session_id, speaker_user_id, speaker_display_name, text,
             segment_start_ts, segment_end_ts)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (active_session_id, user_id, display_name, text, seg_start, seg_end),
    )
    logger.info(f"[{display_name}] {text}")


async def _is_session_paused(session_id: str) -> bool:
    """Check if the active session is paused using the cached state."""
    await _refresh_session_cache()
    if not _cached_active_session_id:
        return True  # No active session = treat as paused (drop audio)
    return _cached_session_paused


# Cache keyterms per session to avoid repeated DB queries
_session_keyterms: dict[str, list[str]] = {}


async def _get_keyterms(session_id: str) -> list[str]:
    """Get glossary keyterms for the session's campaign."""
    if session_id in _session_keyterms:
        return _session_keyterms[session_id]

    row = await db.fetch_one(
        "SELECT campaign_id FROM sessions WHERE id = %s", (session_id,)
    )
    if not row:
        return []

    campaign_id = row["campaign_id"]
    # Character names first, then place names, then the rest — up to 100
    entries = await db.fetch_all(
        """
        SELECT name, aliases, type FROM glossary_entries
        WHERE campaign_id = %s
        ORDER BY
            CASE WHEN type = 'character' THEN 0
                 WHEN type = 'place' THEN 1
                 ELSE 2 END,
            name
        """,
        (campaign_id,),
    )

    # Also include character names from characters table
    characters = await db.fetch_all(
        "SELECT name FROM characters WHERE campaign_id = %s", (campaign_id,)
    )

    terms: list[str] = []
    for c in characters:
        if c["name"] and c["name"] not in terms:
            terms.append(c["name"])
    for e in entries:
        if e["name"] and e["name"] not in terms:
            terms.append(e["name"])
        for alias in (e.get("aliases") or []):
            if alias and alias not in terms:
                terms.append(alias)
        if len(terms) >= 100:
            break

    _session_keyterms[session_id] = terms[:100]
    logger.info(f"Loaded {len(terms[:100])} keyterms for session {session_id}")
    return terms[:100]


async def process_audio_chunk(
    session_id: str,
    user_id: str,
    display_name: str,
    pcm_data: bytes,
) -> None:
    """Process an incoming PCM chunk through VAD and route to Deepgram if speech."""
    # Check pause state
    if await _is_session_paused(session_id):
        return

    key = (session_id, user_id)

    if key not in _user_states:
        _user_states[key] = _UserVADState()
        _user_states[key].session_start_time = time.time()

    state = _user_states[key]
    state.pcm_buffer.extend(pcm_data)

    chunk_bytes = VAD_CHUNK_SAMPLES * 2  # 16-bit = 2 bytes per sample

    while len(state.pcm_buffer) >= chunk_bytes:
        raw = bytes(state.pcm_buffer[:chunk_bytes])
        del state.pcm_buffer[:chunk_bytes]

        pcm_array = np.frombuffer(raw, dtype=np.int16)
        speech_prob = _run_vad(pcm_array)

        now = time.monotonic()
        is_speech = speech_prob > 0.5

        if is_speech:
            state.last_speech_time = now
            state.is_speaking = True

            # Open Deepgram connection if not active
            if not state.deepgram_active:
                keyterms = await _get_keyterms(session_id)
                await deepgram_manager.get_or_create_stream(
                    session_id=session_id,
                    user_id=user_id,
                    display_name=display_name,
                    on_transcript=_on_transcript,
                    keyterms=keyterms,
                )
                state.deepgram_active = True
                logger.debug(f"Speech detected for {display_name}, Deepgram stream opened")

            # Forward audio to Deepgram
            stream = await deepgram_manager.get_or_create_stream(
                session_id=session_id,
                user_id=user_id,
                display_name=display_name,
                on_transcript=_on_transcript,
            )
            await stream.send_audio(raw)

        elif state.is_speaking:
            # In trailing window — keep forwarding
            elapsed_since_speech = now - state.last_speech_time

            if elapsed_since_speech <= TRAILING_SPEECH_WINDOW_S:
                # Still in trailing window, forward audio
                if state.deepgram_active:
                    stream = await deepgram_manager.get_or_create_stream(
                        session_id=session_id,
                        user_id=user_id,
                        display_name=display_name,
                        on_transcript=_on_transcript,
                    )
                    await stream.send_audio(raw)
            else:
                # Past trailing window
                state.is_speaking = False

                if elapsed_since_speech > SILENCE_CLOSE_TIMEOUT_S and state.deepgram_active:
                    await deepgram_manager.close_stream(session_id, user_id)
                    state.deepgram_active = False
                    logger.debug(f"Silence timeout for {display_name}, Deepgram stream closed")


async def cleanup_session(session_id: str) -> None:
    """Clean up all per-user state and caches for a session."""
    _session_keyterms.pop(session_id, None)
    await deepgram_manager.close_session(session_id)
    keys_to_remove = [k for k in _user_states if k[0] == session_id]
    for key in keys_to_remove:
        del _user_states[key]
    logger.info(f"Cleaned up VAD state for session {session_id}")
